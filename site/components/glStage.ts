import * as THREE from "three";

/*
 * The WebGL stage behind every chapter: one full-screen quad + a particle layer, one renderer.
 *   Quad (M27 + M28): clip A (current, or the outgoing one frozen on its last frame) and clip B (incoming, first
 *   frame). Every chapter boundary has its own transition, a pure function of p (0 → 1), so scrubbing backward
 *   plays it exactly in reverse. `o` = A's bright point (0–1, y up), the origin of the move:
 *     mode 0 · 1→2 HYPERSPACE    radial streaks rush in toward the sun glint, A stretches into them, B bursts out
 *     mode 1 · 2→3 GLITCH        RGB split, block displacement, scanline flicker; B loads in block by block
 *                                (active for 70% of the window = 0.56 s of scroll)
 *     mode 2 · 3→4 HOLO SCAN     a teal line sweeps top → bottom: B printed in above it, A below, grid glow on the line
 *     mode 3 · 4→5 PORTAL RING   fly through the orange ring: the ring passes the camera, B seen inside fills the screen
 *     mode 4 · 5→6 CLOUD PUNCH   push into the sun, white flash, burst out into B with cloud wisps flying past
 *   Particles (M15): dust drifting toward the camera; speed follows scroll velocity.
 * Textures are the decoded frame <img>s (sRGB passed straight through, no colour conversion).
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
uniform sampler2D tA;
uniform sampler2D tB;
uniform float p;      // transition progress (0 = only A)
uniform float hasB;   // 1 while a transition runs
uniform float mode;   // which transition (see above)
uniform vec2 o;       // bright point of A (uv, y up)
uniform float aspect;
varying vec2 vUv;

const float PI = 3.14159265;
const vec3 TEAL = vec3(0.176, 0.831, 0.749);
const vec3 ORANGE = vec3(1.0, 0.416, 0.169);
const vec3 SUN = vec3(1.0, 0.97, 0.92);

vec3 tap(sampler2D t, vec2 u) { return texture2D(t, clamp(u, 0.0, 1.0)).rgb; }
float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float noise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 x) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(x); x *= 2.03; a *= 0.5; }
  return v;
}
float easeIO(float x) { return x < 0.5 ? 2.0 * x * x : 1.0 - pow(-2.0 * x + 2.0, 2.0) / 2.0; }
float easeOut(float x) { return 1.0 - pow(1.0 - x, 3.0); }

// zoom blur toward c (amt = 0 → one tap) with RGB split away from c
vec3 zoomBlur(sampler2D t, vec2 uv, vec2 c, float amt, float ca) {
  if (amt < 0.0005 && ca < 0.0005) return tap(t, uv);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float k = float(i) / 11.0;
    vec2 u = c + (uv - c) * (1.0 - amt * k);
    vec2 d = (u - c) * ca;
    acc.r += texture2D(t, clamp(u + d, 0.0, 1.0)).r;
    acc.g += texture2D(t, clamp(u, 0.0, 1.0)).g;
    acc.b += texture2D(t, clamp(u - d, 0.0, 1.0)).b;
  }
  return acc / 12.0;
}

/* 1→2 · HYPERSPACE */
vec3 hyperspace() {
  vec2 d = (vUv - o) * vec2(aspect, 1.0);
  float r = length(d);
  float ang = (atan(d.y, d.x) + PI) / (2.0 * PI);
  float e1 = smoothstep(0.0, 0.6, p);
  vec3 col = zoomBlur(tA, o + (vUv - o) / mix(1.0, 1.7, e1 * e1), o, 0.6 * e1, 0.025 * e1);
  col *= 1.0 - 0.45 * smoothstep(0.25, 0.55, p);
  // streaks: thin angular lines whose inner end rushes in to the glint point
  float bins = 240.0;
  float bid = floor(ang * bins);
  float n = hash1(bid);
  float line = smoothstep(0.72, 0.95, n) * (1.0 - smoothstep(0.05, 0.42, abs(fract(ang * bins) - 0.5)));
  float rIn = mix(1.4, 0.0, easeIO(clamp(p / 0.58, 0.0, 1.0)) * (0.55 + 0.45 * hash1(bid + 7.0)));
  float streak = line * smoothstep(rIn, rIn + 0.3, r) * (1.0 - smoothstep(1.3, 1.9, r));
  float on = smoothstep(0.02, 0.22, p) * (1.0 - smoothstep(0.55, 0.72, p));
  col += mix(vec3(1.0, 0.86, 0.72), vec3(0.75, 0.9, 1.0), hash1(bid + 3.0)) * streak * on * 1.6;
  col += SUN * exp(-r * r * 30.0) * on * 0.8;
  // burst: B blows out of the centre
  float q = clamp((p - 0.5) / 0.5, 0.0, 1.0);
  if (q > 0.0) {
    vec2 dc = (vUv - 0.5) * vec2(aspect, 1.0);
    float R = easeOut(q) * 1.25;
    float L = length(dc);
    float inside = 1.0 - smoothstep(R - 0.05, R, L);
    vec3 b = zoomBlur(tB, 0.5 + (vUv - 0.5) / mix(1.35, 1.0, easeOut(q)), vec2(0.5), 0.35 * (1.0 - q), 0.02 * (1.0 - q));
    col = mix(col, b, inside);
    col += SUN * exp(-pow((L - R) / 0.035, 2.0)) * (1.0 - q) * 1.2;
  }
  col = mix(col, SUN, clamp(exp(-pow((p - 0.52) / 0.035, 2.0)) * 0.75, 0.0, 1.0));
  return col;
}

/* 2→3 · GLITCH TELEPORT */
vec3 glitch() {
  float g = clamp((p - 0.15) / 0.7, 0.0, 1.0);
  float I = sin(PI * g);
  float st = floor(g * 18.0); // deterministic flicker steps
  vec2 grid = vec2(16.0, 9.0) * (1.0 + floor(hash1(st) * 3.0));
  vec2 bid = floor(vUv * grid);
  vec2 uv = vUv;
  if (hash(bid + st * 1.31) > 1.0 - 0.45 * I) uv.x += (hash(bid + st + 3.0) - 0.5) * 0.14 * I;
  float row = floor(vUv.y * 70.0);
  if (hash(vec2(row, st)) > 1.0 - 0.22 * I) uv.x += (hash(vec2(st, row)) - 0.5) * 0.06 * I;
  float ca = 0.014 * I;
  vec3 a = vec3(tap(tA, uv + vec2(ca, 0.0)).r, tap(tA, uv).g, tap(tA, uv - vec2(ca, 0.0)).b);
  vec3 b = vec3(tap(tB, uv + vec2(ca, 0.0)).r, tap(tB, uv).g, tap(tB, uv - vec2(ca, 0.0)).b);
  // B loads in block by block
  vec2 lb = floor(vUv * vec2(32.0, 18.0));
  float loaded = step(hash(lb * 1.7 + 0.3), (g - 0.2) / 0.6);
  vec3 col = mix(a, b, loaded);
  col *= 1.0 - 0.3 * I * (0.5 + 0.5 * sin(vUv.y * 900.0));
  col *= 1.0 + (hash1(st + 11.0) - 0.5) * 0.6 * I;
  if (hash(bid + st * 2.7) > 1.0 - 0.07 * I) col = mix(col, hash1(st + bid.x) > 0.5 ? TEAL : ORANGE, 0.55);
  return col;
}

/* 3→4 · HOLOGRAM SCAN */
vec3 holoScan() {
  float L = 1.03 - 1.06 * easeIO(clamp((p - 0.03) / 0.94, 0.0, 1.0)); // line y (1 = top)
  float dy = vUv.y - L; // > 0: above the line
  float env = smoothstep(0.0, 0.05, p) * (1.0 - smoothstep(0.95, 1.0, p));
  vec3 col;
  if (dy > 0.0) {
    float tint = exp(-dy * 9.0) * env;
    float jitter = (hash(vec2(floor(vUv.y * 220.0), floor(p * 40.0))) - 0.5) * 0.012 * exp(-dy * 22.0) * env;
    vec3 b = tap(tB, vUv + vec2(jitter, 0.0));
    col = mix(b, b * 0.55 + TEAL * 0.55, tint * 0.85);
    col *= 1.0 - 0.3 * tint * (0.5 + 0.5 * sin(vUv.y * 1100.0));
  } else {
    col = tap(tA, vUv) * (1.0 - 0.4 * exp(dy * 14.0) * env);
  }
  vec2 gg = abs(fract(vUv * vec2(64.0, 36.0)) - 0.5);
  float gl = smoothstep(0.44, 0.5, max(gg.x, gg.y));
  col += TEAL * gl * exp(-abs(dy) * 13.0) * 0.7 * env;
  col += TEAL * (exp(-abs(dy) * 380.0) * 1.6 + exp(-abs(dy) * 38.0) * 0.4) * env;
  col += vec3(1.0) * exp(-abs(dy) * 1600.0) * 0.9 * env;
  return col;
}

/* 4→5 · PORTAL RING */
vec3 portal() {
  float e = easeIO(p);
  float bump = sin(PI * p);
  float sA = exp(log(7.0) * pow(p, 1.6)); // the ring approaches, faster and faster
  vec2 uvA = o + (vUv - o) / sA;
  vec3 a = zoomBlur(tA, uvA, o, 0.14 * bump, 0.02 * bump);
  float el = length((uvA - o) / vec2(0.39, 0.25)); // the ring's inner edge = 1
  float inside = 1.0 - smoothstep(0.9, 1.0, el);
  // B sits on the ring plane at first, then settles to full frame
  vec2 onRing = 0.5 + (uvA - o) / 0.82;
  vec2 uvB = mix(onRing, vUv, e * e);
  vec3 b = zoomBlur(tB, uvB, vec2(0.5), 0.12 * bump, 0.0) * mix(0.6, 1.0, e);
  vec3 col = mix(a, b, inside * smoothstep(0.0, 0.15, p));
  col += ORANGE * exp(-pow((el - 1.0) / 0.06, 2.0)) * 1.1 * bump;
  return col;
}

/* 5→6 · CLOUD PUNCH */
vec3 cloudPunch() {
  vec3 col;
  if (p < 0.5) {
    float q = p / 0.5;
    col = zoomBlur(tA, o + (vUv - o) / mix(1.0, 3.0, q * q), o, 0.35 * q, 0.01 * q) * (1.0 + 0.45 * q * q * q);
  } else {
    float q = (p - 0.5) / 0.5;
    col = zoomBlur(tB, 0.5 + (vUv - 0.5) / mix(1.6, 1.0, easeOut(q)), vec2(0.5), 0.3 * (1.0 - q), 0.0) * (1.0 + 0.6 * pow(1.0 - q, 3.0));
  }
  // cloud wisps rushing past the camera (two layers), clear in the middle of the view
  float env = sin(PI * p);
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float scale = 1.0 + p * 5.0 * (1.0 + fk * 0.8);
    vec2 uvw = (vUv - 0.5) * vec2(aspect, 1.0) / scale;
    float n = fbm(uvw * 3.0 + fk * 7.31);
    float after = step(0.5, p); // wisps thicker once we burst out of the cloud
    float alpha = smoothstep(0.52 - 0.06 * after, 0.8, n) * env * smoothstep(0.12, 0.6, length(vUv - 0.5));
    col = mix(col, SUN * 0.96, alpha * (0.7 + 0.2 * after));
  }
  col = mix(col, SUN, clamp(exp(-pow((p - 0.5) / 0.035, 2.0)) * 1.25, 0.0, 1.0));
  return min(col, vec3(1.0));
}

void main() {
  vec3 col;
  if (hasB < 0.5) col = tap(tA, vUv);
  else if (mode < 0.5) col = hyperspace();
  else if (mode < 1.5) col = glitch();
  else if (mode < 2.5) col = holoScan();
  else if (mode < 3.5) col = portal();
  else col = cloudPunch();
  // soft vignette, always
  vec2 v = vUv - 0.5;
  col *= 1.0 - 0.55 * dot(v, v);
  gl_FragColor = vec4(col, 1.0);
}
`;

function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const frameTexture = () => {
  const t = new THREE.Texture();
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
};

export class GLStage {
  private renderer: THREE.WebGLRenderer;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private texA = frameTexture();
  private texB = frameTexture();
  private dustScene = new THREE.Scene();
  private dustCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  private dust: THREE.Points;
  private dustMat: THREE.PointsMaterial;
  private z: Float32Array;
  private speed = 6;
  private imgA?: HTMLImageElement;
  private imgB?: HTMLImageElement;

  constructor(canvas: HTMLCanvasElement, opts: { particles: number }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // frames are already sRGB: pass through

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tA: { value: this.texA },
        tB: { value: this.texB },
        p: { value: 0 },
        hasB: { value: 0 },
        mode: { value: 0 },
        o: { value: new THREE.Vector2(0.5, 0.5) },
        aspect: { value: 16 / 9 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));

    // dust: a box of points in front of the camera, recycled when they pass it
    const n = opts.particles;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 70;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 40;
      pos[i * 3 + 2] = -Math.random() * 90;
    }
    this.z = pos;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dustMat = new THREE.PointsMaterial({
      size: 0.32,
      map: dotTexture(),
      color: new THREE.Color("#ffe2c6"),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dustScene.add(this.dust);
    this.dustCam.position.set(0, 0, 8);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.mat.uniforms.aspect.value = w / h;
    this.dustCam.aspect = w / h;
    this.dustCam.updateProjectionMatrix();
  }

  /** a = current (or outgoing) frame, b = incoming frame during a transition */
  setFrames(a?: HTMLImageElement, b?: HTMLImageElement) {
    if (a && a !== this.imgA) {
      this.imgA = a;
      this.texA.image = a;
      this.texA.needsUpdate = true;
    }
    if (b && b !== this.imgB) {
      this.imgB = b;
      this.texB.image = b;
      this.texB.needsUpdate = true;
    }
  }

  /** p = transition progress (null = no transition), o = bright point of A (0–1, y down), mode = which transition */
  setTransition(p: number | null, o: [number, number], mode = 0) {
    const u = this.mat.uniforms;
    u.mode.value = mode;
    u.hasB.value = p === null || !this.imgB ? 0 : 1;
    u.p.value = p ?? 0;
    u.o.value.set(o[0], 1 - o[1]);
  }

  /** v = scroll velocity in px/s, boost = 0–1 extra rush (transitions) */
  render(dt: number, v: number, boost: number, dustTint?: string) {
    const target = 5 + Math.min(Math.abs(v) / 40, 70) + boost * 60;
    this.speed += (target - this.speed) * Math.min(1, dt * 4);
    const pos = this.z;
    const step = this.speed * dt;
    for (let i = 2; i < pos.length; i += 3) {
      pos[i] += step;
      if (pos[i] > 8) {
        pos[i] -= 98;
        pos[i - 2] = (Math.random() - 0.5) * 70;
        pos[i - 1] = (Math.random() - 0.5) * 40;
      }
    }
    (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.dustMat.opacity = 0.4 + Math.min(0.4, this.speed / 120);
    if (dustTint) this.dustMat.color.set(dustTint);

    const r = this.renderer;
    r.clear();
    if (this.imgA) r.render(this.quadScene, this.quadCam);
    r.render(this.dustScene, this.dustCam);
  }

  dispose() {
    this.texA.dispose();
    this.texB.dispose();
    this.mat.dispose();
    this.dust.geometry.dispose();
    this.dustMat.map?.dispose();
    this.dustMat.dispose();
    this.renderer.dispose();
  }
}
