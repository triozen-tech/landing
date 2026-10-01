"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { gsap, prefersReducedMotion, ScrollTrigger } from "@/lib/gsap";
import { getManifest, loadFrames } from "@/lib/frames";
import { loading } from "@/lib/loading";
import { chapters, END_GROW, END_HOLD, endStart, gear, HERO_HOLD, map, match, playEnd, playStart, starts, storySeconds, T } from "../content";
import { chapterUI, colShift, EndCard, Hud, mapGeometry, MatchUI, odoPositions } from "./ChapterUI";
import { onBootDone } from "./BootLoader";
import { GLStage } from "./glStage";

/*
 * The film. A tall scroll track with a sticky 16:9 stage box: the page never moves, scrolling plays the story.
 * One GSAP timeline in story seconds (1 s = var(--k) of scroll), scrubbed by ScrollTrigger:
 *   - the WebGL stage (glStage.ts) reads tl.time() every tick: clip frames (M27), deep transitions (M28),
 *     dust (M15) that speeds up with scroll velocity;
 *   - chapter UI tweens sit on the timeline (M12 logo out, M31 cards, M8 lock-on, M25 JUMP, M24 end card);
 *   - live values (stat bars, odometers, map tracking, the HUD counter) are set from the time each tick.
 * Record mode: invisible markers carry data-record-time per chapter (same seconds on every screen).
 * ?static=1: every chapter as a still panel in its final state (StaticFilm).
 */

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const inOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const pad = (n: number) => String(n).padStart(4, "0");
const posterSrc = (i: number) => {
  const c = chapters[i];
  return `${c.frames}/frame_${pad(Math.max(1, Math.round(c.poster * (c.count - 1)) + 1))}.webp`;
};

type Marker = { at: number; time: number; hold?: number; label: string };
const markers: Marker[] = [
  { at: 0, time: 0, hold: HERO_HOLD, label: "01 Title" },
  ...chapters.map((c, i) => ({ at: playEnd(i), time: playEnd(i) - (i ? starts[i] : 0), label: `${String(c.n).padStart(2, "0")} ${c.name}` })),
  { at: storySeconds, time: END_GROW, hold: END_HOLD, label: "End card + credit" },
];

/** Which clip(s) the stage shows at story time t */
function stageAt(t: number) {
  let i = chapters.length - 1;
  while (i > 0 && t < starts[i]) i--;
  if (i > 0 && t < playStart(i)) return { a: i - 1, fa: 1, b: i, p: (t - starts[i]) / T };
  return { a: i, fa: clamp((t - playStart(i)) / chapters[i].play), b: -1, p: null as number | null };
}

/** M22: letters shuffle and land, left to right */
const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/";
function scramble(el: HTMLElement, text: string, duration = 0.6) {
  const o = { p: 0 };
  gsap.killTweensOf(el);
  return gsap.to(o, {
    p: 1,
    duration,
    ease: "none",
    onUpdate: () => {
      const shown = Math.floor(o.p * text.length);
      el.textContent = text
        .split("")
        .map((ch, i) => (i < shown || ch === " " ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
        .join("");
    },
    onComplete: () => {
      el.textContent = text;
    },
  });
}

function Film() {
  const track = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = box.current!;
    const small = window.matchMedia("(max-width: 767px)").matches;
    const gl = new GLStage(canvas.current!, { particles: small ? 260 : 750 });
    const ro = new ResizeObserver(() => gl.resize(root.clientWidth, root.clientHeight));
    ro.observe(root);
    gl.resize(root.clientWidth, root.clientHeight);

    /* ---------- frames ---------- */
    type Player = { get: (i: number) => HTMLImageElement | undefined; count: number; cancel: () => void };
    const players: (Player | null)[] = chapters.map(() => null);
    let alive = true;
    chapters.forEach((c, i) => {
      const id = `clip:${c.key}`;
      loading.register(id);
      getManifest(c.frames)
        .then((m) => {
          if (!alive) return;
          const seq = loadFrames(c.frames, m, (n, total) => loading.update(id, n / total));
          players[i] = { get: (k) => seq.get(k), count: m.count, cancel: seq.cancel };
        })
        .catch((e) => {
          console.error(e);
          loading.update(id, 1);
        });
    });
    const frameOf = (i: number, f: number) => {
      const pl = players[i];
      return pl ? pl.get(Math.round(clamp(f) * (pl.count - 1))) : undefined;
    };

    /* ---------- elements ---------- */
    const $ = (sel: string, el: ParentNode = root) => el.querySelector(sel) as HTMLElement;
    const $$ = (sel: string, el: ParentNode = root) => Array.from(el.querySelectorAll(sel)) as HTMLElement[];
    const ui = (key: string) => $(`[data-ui="${key}"]`);
    const hudNum = $("[data-hud-num]");
    const hudName = $("[data-hud-name]");
    const gearRows = $$("[data-stat]", ui("gear"));
    const mapEl = ui("map");
    const brackets = $$("[data-bracket]", mapEl);
    const leader = $("[data-leader]", mapEl);
    const reticle = $("[data-reticle]", mapEl);
    const label = $("[data-label]", mapEl);
    const timerCols = $$("[data-odo=timer] [data-col]", root);
    const playerCols = $$("[data-odo=players] [data-col]", root);
    const matchFill = $("[data-match-fill]", root);

    /* ---------- the timeline (story seconds) ---------- */
    const tl = gsap.timeline({ paused: true, defaults: { ease: "none" } });
    tl.set({}, {}, storySeconds);

    // chapter UI layers: on while their chapter is on screen
    chapters.forEach((c, i) => {
      const layer = ui(c.key);
      if (i > 0) tl.fromTo(layer, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, starts[i] + T * 0.55);
      if (i < chapters.length - 1) tl.to(layer, { autoAlpha: 0, duration: T * 0.3 }, starts[i + 1]);
      // M28 support: letterbox bars squeeze in during the deep move, then relax
      if (i > 0) {
        tl.to(root, { "--sq": 1, duration: T / 2, ease: "power2.in" }, starts[i]);
        tl.to(root, { "--sq": 0, duration: T / 2, ease: "power2.out" }, starts[i] + T / 2);
      }
    });

    // 1 · title: hint and "press to start" go first, the logo lifts away by 60% of the chapter
    {
      const d = chapters[0].play;
      const el = ui("title");
      tl.to($("[data-hint]", el), { autoAlpha: 0, y: 10, duration: 0.5 }, 0.15);
      tl.to($("[data-press]", el), { autoAlpha: 0, duration: d * 0.12 }, d * 0.18);
      tl.to($("[data-logo]", el), { autoAlpha: 0, yPercent: -24, scale: 1.06, filter: "blur(10px)", duration: d * 0.22, ease: "power1.in" }, d * 0.38);
      tl.to($(".logo-glow", el), { autoAlpha: 0, duration: d * 0.22 }, d * 0.38);
    }

    // 2 · squad (M31): cards swing in from the right, tilted back in depth; then NOVA lights up
    {
      const ps = playStart(1);
      const d = chapters[1].play;
      const el = ui("squad");
      const cards = $$("[data-card]", el);
      tl.fromTo($(".squad-label", el), { autoAlpha: 0, x: 30 }, { autoAlpha: 1, x: 0, duration: 0.3, ease: "power2.out" }, ps - 0.1);
      cards.forEach((card, k) => {
        tl.fromTo(
          card,
          { autoAlpha: 0, xPercent: 140, rotationY: -62, z: -220, transformPerspective: 900 },
          { autoAlpha: 1, xPercent: 0, rotationY: 0, z: 0, duration: d * 0.2, ease: "power3.out" },
          ps + d * (0.04 + 0.15 * k),
        );
      });
      const lead = cards.find((c) => c.dataset.card === "lead")!;
      const others = cards.filter((c) => c !== lead);
      tl.fromTo(lead, { "--lead": 0, scale: 1 }, { "--lead": 1, scale: 1.07, duration: d * 0.14, ease: "power2.out" }, ps + d * 0.6);
      tl.fromTo(others, { opacity: 1, filter: "saturate(1) brightness(1)" }, { opacity: 0.38, filter: "saturate(0.3) brightness(0.7)", duration: d * 0.14, immediateRender: false }, ps + d * 0.6);
      tl.fromTo($("[data-ready]", lead), { autoAlpha: 0, x: -12 }, { autoAlpha: 1, x: 0, duration: d * 0.08, ease: "power2.out" }, ps + d * 0.68);
    }

    // 3 · gear panel arrives (bars + numbers are live, below)
    tl.fromTo($("[data-panel]", ui("gear")), { autoAlpha: 0, xPercent: -18 }, { autoAlpha: 1, xPercent: 0, duration: 0.4, ease: "power3.out" }, starts[2] + T * 0.6);

    // 4 · map (M8): brackets draw onto the ring, the leader line, then the label snaps on and locks
    {
      const ps = playStart(3);
      const d = chapters[3].play;
      tl.fromTo(reticle, { autoAlpha: 0, scale: 2.4 }, { autoAlpha: 1, scale: 1, duration: d * 0.12, ease: "power3.out" }, ps + d * 0.62);
      tl.fromTo(brackets, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: d * 0.16, ease: "power2.inOut", stagger: d * 0.02 }, ps + d * 0.66);
      tl.fromTo(leader, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: d * 0.07 }, ps + d * 0.82);
      tl.fromTo(label, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: d * 0.08, ease: "power3.out" }, ps + d * 0.87);
      tl.fromTo($("[data-lock]", label), { autoAlpha: 0, scale: 1.6 }, { autoAlpha: 1, scale: 1, duration: d * 0.05, ease: "power3.out" }, ps + d * 0.94);
    }

    // 5 · matchmaking: panel drops in; READY flashes once at the jump (UI only)
    {
      const ps = playStart(4);
      const d = chapters[4].play;
      const el = ui("match");
      tl.fromTo($("[data-panel]", el), { autoAlpha: 0, yPercent: -25 }, { autoAlpha: 1, yPercent: 0, duration: 0.35, ease: "power3.out" }, starts[4] + T * 0.6);
      const ready = $("[data-ready-flash]", el);
      tl.fromTo(ready, { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 1, scale: 1, duration: 0.16, ease: "power3.out" }, ps + d * match.readyAt);
      tl.to(ready, { autoAlpha: 0, scale: 1.3, filter: "blur(6px)", duration: 0.35, ease: "power2.in" }, ps + d * match.readyAt + 0.3);
    }

    // 6 · drop (M25): JUMP grows, then flies past the camera into a white-out
    {
      const ps = playStart(5);
      const d = chapters[5].play;
      const jump = $("[data-jump]", ui("drop"));
      tl.fromTo(jump, { autoAlpha: 0, scale: 0.15 }, { autoAlpha: 1, scale: 1, duration: d * 0.3, ease: "power3.out" }, ps + d * 0.1);
      tl.to(jump, { scale: 9, autoAlpha: 0, duration: d * 0.3, ease: "power2.in" }, ps + d * 0.64);
      tl.fromTo($("[data-whiteout]"), { opacity: 0 }, { opacity: 1, duration: d * 0.24, ease: "power1.in" }, ps + d * 0.76);
    }

    // end card: X2 white → near-black, M24 outline fills from the bottom, the lines and credit arrive
    {
      const endEl = $("[data-end]");
      tl.fromTo(endEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05 }, endStart);
      tl.to($("[data-whiteout]"), { opacity: 0, duration: 0.5, ease: "power2.out" }, endStart);
      tl.to($("[data-hud]"), { autoAlpha: 0, duration: 0.3 }, endStart);
      tl.fromTo($("[data-end-fill]", endEl), { clipPath: "inset(100% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.75, ease: "power2.inOut" }, endStart + 0.2);
      tl.fromTo($$("[data-end-line]", endEl), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.12, ease: "power2.out" }, endStart + 0.65);
    }

    /* ---------- the hero logo builds once the boot loader is gone (M12, plays on its own) ---------- */
    const letters = $$("[data-letter]", ui("title"));
    gsap.set(letters, { yPercent: 115 });
    const offBoot = onBootDone(() => {
      gsap.to(letters, { yPercent: 0, duration: 0.7, stagger: 0.055, ease: "power4.out" });
      gsap.fromTo(
        letters,
        { textShadow: "0 0.2cqw 1.4cqw rgba(11,13,18,0), 0 0 3cqw rgba(255,106,43,1)" },
        { textShadow: "0 0.2cqw 1.4cqw rgba(11,13,18,0.75), 0 0 1.2cqw rgba(255,106,43,0.35)", duration: 0.9, stagger: 0.055, ease: "power2.out" },
      );
      gsap.fromTo($("[data-hint]", ui("title")), { opacity: 0 }, { opacity: 1, duration: 0.6, delay: 1 });
    });

    /* ---------- scroll ---------- */
    let velocity = 0;
    const trig = ScrollTrigger.create({
      trigger: track.current!,
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      animation: tl,
      onUpdate: (self) => {
        velocity = self.getVelocity();
      },
    });

    /* ---------- every tick: stage + live UI ---------- */
    let active = -1;
    let lastT = -1;
    const tick = (_: number, deltaMs: number) => {
      const dt = Math.min(0.05, deltaMs / 1000);
      const t = tl.time();
      const s = stageAt(t);
      gl.setFrames(frameOf(s.a, s.fa), s.b >= 0 ? frameOf(s.b, 0) : undefined);
      gl.setTransition(s.p, chapters[s.a].origin, s.b - 1); // transition into chapter b = mode b − 1
      velocity *= 0.92;
      gl.render(dt, velocity, s.p === null ? 0 : Math.sin(Math.PI * s.p));

      if (t === lastT) return;
      lastT = t;

      // M22: chapter counter scrambles when the chapter changes (half-way through the deep move)
      let now = 0;
      chapters.forEach((_c, i) => {
        if (t >= starts[i] + (i ? T * 0.5 : 0)) now = i;
      });
      if (now !== active) {
        if (active >= 0) {
          scramble(hudNum, String(now + 1).padStart(2, "0"), 0.45);
          scramble(hudName, chapters[now].name.toUpperCase(), 0.6);
        }
        active = now;
      }

      // 3 · gear (M26): each bar fills while the camera passes its part; numbers count with it
      if (s.a === 2 || s.b === 2) {
        const fa = s.a === 2 ? s.fa : 0;
        gear.stats.forEach((st, k) => {
          const f = inOut(clamp((fa - st.window[0]) / (st.window[1] - st.window[0])));
          const row = gearRows[k];
          (row.querySelector("[data-fill]") as HTMLElement).style.transform = `scaleX(${f})`;
          (row.querySelector("[data-num]") as HTMLElement).textContent = String(Math.round(st.value * f));
          row.classList.toggle("is-active", fa >= st.window[0] && (fa < st.window[1] || k === gear.stats.length - 1));
          row.classList.toggle("is-done", f >= 1);
        });
      }

      // 4 · map: brackets, reticle and label track the ring as the camera moves in
      if (s.a === 3 || s.b === 3) {
        const r = map.ring;
        const f = clamp(s.a === 3 ? s.fa : 0, r[0][0], 1);
        let k = 0;
        while (k < r.length - 2 && f > r[k + 1][0]) k++;
        const u = (f - r[k][0]) / (r[k + 1][0] - r[k][0]);
        const box6 = r[k].map((v, j) => v + (r[k + 1][j] - v) * u);
        const g = mapGeometry(box6);
        brackets.forEach((b, j) => b.setAttribute("d", g.brackets[j]));
        leader.setAttribute("d", g.leader);
        reticle.style.left = `${box6[1] * 100}%`;
        reticle.style.top = `${box6[2] * 100}%`;
        label.style.left = g.labelLeft;
        label.style.top = g.labelTop;
      }

      // 5 · matchmaking (M3): timer 0:00 → 0:07 and players 12 → 99 roll with scroll
      if (s.a === 4 || (s.a === 3 && s.b === 4)) {
        const fa = s.a === 4 ? s.fa : 0;
        const timer = match.timer[0] + (match.timer[1] - match.timer[0]) * fa;
        const players = match.players[0] + (match.players[1] - match.players[0]) * clamp(fa / match.playersAt);
        odoPositions(timer, 1).forEach((p, j) => (timerCols[j].style.transform = colShift(p)));
        odoPositions(players, 2).forEach((p, j) => (playerCols[j].style.transform = colShift(p)));
        matchFill.style.transform = `scaleX(${players / 99})`;
      }
    };
    gsap.ticker.add(tick);

    return () => {
      alive = false;
      gsap.ticker.remove(tick);
      offBoot();
      trig.kill();
      tl.kill();
      ro.disconnect();
      players.forEach((p) => p?.cancel());
      gl.dispose();
    };
  }, []);

  return (
    <section ref={track} className="track" style={{ "--story-s": storySeconds } as CSSProperties} aria-label="Last Landing">
      <div className="markers" aria-hidden>
        {markers.map((m) => (
          <div
            key={m.label}
            className="marker"
            style={{ top: `calc(${m.at} * var(--k))` }}
            data-record-time={m.time}
            data-record-hold={m.hold}
            data-record-label={m.label}
          />
        ))}
      </div>
      <div className="sticky">
        <div ref={box} className="box" data-cursor="Deploy" style={{ "--sq": 0 } as CSSProperties}>
          <canvas ref={canvas} className="gl" />
          {chapters.map((c) => {
            const UI = chapterUI[c.key];
            return <UI key={c.key} />;
          })}
          <div className="whiteout" data-whiteout aria-hidden />
          <EndCard />
          <Hud />
        </div>
      </div>
    </section>
  );
}

/** ?static=1: every chapter as a still 16:9 panel with its UI in the final state, then the end card */
function StaticFilm() {
  return (
    <section className="static-film" aria-label="Last Landing">
      {chapters.map((c, i) => {
        const UI = c.key === "match" ? () => <MatchUI showReady /> : chapterUI[c.key];
        return (
          <div key={c.key} className="static-panel">
            <div className="box">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={posterSrc(i)} alt="" className="poster" />
              <UI />
              <Hud n={c.n} />
            </div>
          </div>
        );
      })}
      <div className="static-panel">
        <div className="box">
          <EndCard />
          <Hud n={chapters.length} />
        </div>
      </div>
    </section>
  );
}

export default function Stage() {
  const [isStatic, setStatic] = useState(false);
  useEffect(() => {
    if (!prefersReducedMotion()) return;
    document.documentElement.classList.add("is-static");
    setStatic(true);
    return () => document.documentElement.classList.remove("is-static");
  }, []);
  return isStatic ? <StaticFilm /> : <Film />;
}
