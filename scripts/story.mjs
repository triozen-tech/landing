#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  Story mode tools (docs/STORY-WORKFLOW.md). Every command takes the story name first.
//
//    npm run story:init   -- <story>                 folders + .gitignore block + docs/STORY-LOG.md
//    npm run story:scan   -- <story> [file …] [--every 2]   overview sheets of each source (30 tiles a page)
//                                                    → raw/<story>/scan/, to find the clip times for Round 0
//    npm run story:clips  -- <story> [clip …]        cut the CLIP LIST in site/DESIGN.md → raw/<story>/clips/
//                                                    (+ a contact sheet per clip: <clip>-sheet.jpg)
//    npm run story:stills -- <story> [still …] [--zoom 1.12]   the Stills table in site/DESIGN.md → public/<story>/<still>.webp
//                                                    (HDR tone-mapped; a source may also be an image in raw/<story>/)
//    npm run story:frames -- <story> [clip …]        clips → public/frames/<story>-<clip> (~24/s, max 160, q72, ≤ 15 MB)
//         --zoom 1.12 (trim edges, e.g. uploader watermarks) · --crop w:h:x:y (e.g. baked-in black bars)
//         --vf "eq=gamma=1.2,unsharp=5:5:0.6" (grading) · --max-bright 0.7 (no frame averages over 70% brightness)
//         --drop-flat [0.12] (with --max-bright: remove frames over the cap AND nearly one flat colour, e.g. whiteouts;
//                                 the number = how flat; use less for narrow phone crops)
//         --phone --focus 0.42 | 0.3:0.6            portrait phone set <story>-<clip>-m (9:16, max 120), crop centred
//                                                    on x (0–1); "a:b" = focus moves from a to b across the clip
//    npm run story:record -- <story> <label>         ?record=1 at 1440, 820 and 390 wide → recordings/<story>/
//         [--url http://localhost:3000] [--sizes 1440,820,390] [--query "&at=18:55:00"] [--max 120]
//         --static [--duration 45]                  ?static=1 (no motion) with a slow, steady scroll to the bottom
//    npm run story:check  -- <story>                 nothing of the story in git, credit line present, frames ≤ 15 MB,
//                                                    repo private, story not in SITES-LOG
// ─────────────────────────────────────────────────────────────
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const MAX_FOLDER_MB = 15;
const SIZES = { 1440: [1440, 900], 820: [820, 1180], 390: [390, 844] };
const CREDIT = "Fan-made concept, not affiliated";
// The finale may name the studio in between: "Fan-made concept by <studio>, not affiliated."
const CREDIT_RE = /Fan-made concept\b[^"'`<\n]{0,80}\bnot affiliated/i;

// ---------- args ----------
const [cmd, story, ...rest] = process.argv.slice(2);
const flags = {};
const names = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else flags[key] = rest[++i];
  } else names.push(rest[i]);
}
const commands = { init, scan, clips, stills, frames, record, check };
if (!commands[cmd] || !story || !/^[a-z0-9-]+$/.test(story)) {
  console.log("Usage: npm run story:<init|scan|clips|stills|frames|record|check> -- <story> …   (story = lower-case slug, e.g. last-landing)");
  console.log("See the header of scripts/story.mjs and docs/STORY-WORKFLOW.md.");
  process.exit(1);
}
const RAW = `raw/${story}`;
const CLIPS = `${RAW}/clips`;
const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

// ---------- ffmpeg ----------
// The system ffmpeg (Homebrew) has VideoToolbox (HDR tone-mapping on a Mac); ffmpeg-static is the fallback.
const onPath = spawnSync("ffmpeg", ["-hide_banner", "-version"], { encoding: "utf8" }).status === 0;
const FFMPEG = onPath ? "ffmpeg" : (await import("ffmpeg-static")).default;
const ff = (args, opts = {}) => spawnSync(FFMPEG, ["-hide_banner", ...args], { encoding: "utf8", ...opts });
// Homebrew's ffmpeg has no WebP encoder; the bundled ffmpeg-static does.
const FFMPEG_WEBP = (await import("ffmpeg-static")).default;
const hasFilter = (name) => new RegExp(`\\s${name}\\s`).test(ff(["-filters"]).stdout || "");

function probe(file) {
  const info = ff(["-i", file]).stderr || "";
  const dur = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const size = info.match(/Video:.*?, (\d{2,5})x(\d{2,5})/);
  const fps = info.match(/([\d.]+) fps/);
  const colour = info.match(/Video:[^\n]*?\(([^)]*?(?:smpte2084|arib-std-b67)[^)]*)\)/);
  return {
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    fps: fps ? Number(fps[1]) : 24,
    hdr: Boolean(colour),
  };
}

const folderMB = (dir) =>
  existsSync(dir) ? readdirSync(dir).reduce((s, f) => s + statSync(join(dir, f)).size, 0) / 1024 / 1024 : 0;
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// "12.5", "1:02.5", "0:01:02"  → seconds
function toSeconds(s) {
  const parts = String(s).trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// ---------- tables in site/DESIGN.md ----------
// The first markdown table after the line matching `startRe`: { header: [lower-case], rows: [[cells]] }.
function readTable(startRe, what) {
  if (!existsSync("site/DESIGN.md")) fail("site/DESIGN.md not found (Round 0 writes it).");
  const lines = readFileSync("site/DESIGN.md", "utf8").split("\n");
  const at = lines.findIndex((l) => startRe.test(l.trim()));
  if (at < 0) fail(`No ${what} in site/DESIGN.md.`);
  const rows = [];
  let header = null;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^#+\s/.test(l)) break;
    if (!l.startsWith("|")) {
      if (header && rows.length) break;
      continue;
    }
    const cells = l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/`/g, ""));
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      continue;
    }
    rows.push(cells);
  }
  if (!header) fail(`The ${what} has no table.`);
  return { header, rows, col: (re) => header.findIndex((h) => re.test(h)) };
}
const slug = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// A source is a video in raw/<story>/src/, or (for stills) any file in raw/<story>/.
const sourcePath = (file) => (existsSync(join(RAW, "src", basename(file))) ? join(RAW, "src", basename(file)) : join(RAW, basename(file)));

function readClipList() {
  const { rows, col } = readTable(/^#+\s.*clip list/i, '"## Clip list" heading');
  const c = { name: col(/clip|name/), src: col(/source|file/), time: col(/start|time|sec/), hdr: col(/hdr/), chapter: col(/chapter/) };
  if (c.name < 0 || c.src < 0 || c.time < 0) fail("Clip list needs the columns: Clip · Source · Start–end (s) · HDR · Chapter.");
  return rows.map((r) => {
    const [a, b] = r[c.time].split(/\s*(?:–|—|→|\bto\b|-(?=\s*\d))\s*/).map(toSeconds);
    const name = slug(r[c.name]);
    if (!name || Number.isNaN(a) || Number.isNaN(b) || b <= a) fail(`Clip list row can't be read: | ${r.join(" | ")} |`);
    return {
      name,
      src: join(RAW, "src", basename(r[c.src])),
      start: a,
      end: b,
      hdr: c.hdr >= 0 ? /^y/i.test(r[c.hdr]) : undefined,
      chapter: c.chapter >= 0 ? r[c.chapter] : "",
    };
  });
}

// ---------- init ----------
async function init() {
  for (const d of [`${RAW}/src`, CLIPS, `public/${story}`, `recordings/${story}`]) mkdirSync(d, { recursive: true });

  const block = [
    "",
    "# Story mode (docs/STORY-WORKFLOW.md): no movie footage, stills or recordings in git, ever.",
    "raw/",
    "recordings/",
    "public/frames/",
    `public/${story}/`,
    "docs/STORY-LOG.md",
  ];
  const gi = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
  const have = new Set(gi.split("\n").map((l) => l.trim()));
  const missing = block.filter((l) => l && !l.startsWith("#") && !have.has(l));
  if (missing.length) {
    appendFileSync(".gitignore", (gi.endsWith("\n") ? "" : "\n") + block.filter((l) => !l || l.startsWith("#") || missing.includes(l)).join("\n") + "\n");
    console.log(`✓ .gitignore: added ${missing.join(", ")}`);
  } else console.log("✓ .gitignore already has the story block");

  // Untrack (index only; files on disk are kept) anything that must not be in git.
  const untrack = spawnSync("git", ["rm", "-r", "--cached", "--ignore-unmatch", "-q", "raw", "recordings", "public/frames", `public/${story}`], { encoding: "utf8" });
  if (untrack.status === 0) console.log("✓ raw/, recordings/, public/frames/ and public/" + story + "/ are not tracked by git");

  if (!existsSync("docs/STORY-LOG.md")) {
    writeFileSync(
      "docs/STORY-LOG.md",
      `# Story log (local only, not in git)\n\nOne row per finished story site. Business sites go in SITES-LOG.md, never here.\n\n| Date | Story | Owner (credit) | Chapters | Look (palette · type) | Loader | Hero | Signature | Motion (loader · hero · signature) | Clips | Archive |\n|---|---|---|---|---|---|---|---|---|---|---|\n\n## Uniqueness checks\n`,
    );
    console.log("✓ docs/STORY-LOG.md created");
  }
  console.log(`\nPut the source videos in ${RAW}/src/, then write site/DESIGN.md (Round 0).`);
  return checkPrivate();
}

// ---------- scan ----------
function scan() {
  const dir = `${RAW}/src`;
  if (!existsSync(dir)) fail(`${dir}/ not found. Run: npm run story:init -- ${story}`);
  const every = Number(flags.every ?? 2);
  const files = (names.length ? names : readdirSync(dir)).filter((f) => /\.(mp4|mov|mkv|m4v|webm)$/i.test(f));
  mkdirSync(`${RAW}/scan`, { recursive: true });
  for (const f of files) {
    const src = join(dir, basename(f));
    const p = probe(src);
    const name = basename(f).replace(/\.[^.]+$/, "");
    for (const old of readdirSync(`${RAW}/scan`)) if (old.startsWith(`${name}-p`)) rmSync(join(`${RAW}/scan`, old));
    ff(["-loglevel", "error", "-y", "-i", src, "-an", "-vf", `fps=1/${every},scale=320:-2,tile=6x5:padding=4:margin=4:color=black`, "-q:v", "4", join(`${RAW}/scan`, `${name}-p%02d.jpg`)]);
    const pages = Math.ceil(p.duration / every / 30);
    console.log(`\n${basename(f)}: ${p.duration.toFixed(1)} s, ${p.width}×${p.height}, ${p.hdr ? "HDR" : "SDR"}`);
    for (let i = 0; i < pages; i++)
      console.log(`  ${RAW}/scan/${name}-p${String(i + 1).padStart(2, "0")}.jpg  ${(i * 30 * every).toFixed(0)}–${Math.min(p.duration, (i + 1) * 30 * every).toFixed(0)} s (tile n = ${(i * 30 * every).toFixed(0)} + n × ${every} s, left→right, top→bottom)`);
  }
}

// ---------- clips ----------
function tonemapChain(w, h) {
  // 1. macOS VideoToolbox (works with software-decoded AV1/HEVC 10-bit sources)
  if (process.platform === "darwin" && hasFilter("scale_vt"))
    return {
      pre: ["-init_hw_device", "videotoolbox=vt", "-filter_hw_device", "vt"],
      vf: `format=p010le,hwupload,scale_vt=w=${w}:h=${h}:color_matrix=bt709:color_primaries=bt709:color_transfer=bt709,hwdownload,format=p010le,format=yuv420p`,
    };
  // 2. zimg (Linux / Windows builds with --enable-libzimg)
  if (hasFilter("zscale"))
    return {
      pre: [],
      vf: `zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,scale=${w}:${h}:flags=lanczos`,
    };
  return null;
}

function clips() {
  const list = readClipList().filter((c) => !names.length || names.includes(c.name));
  if (!list.length) fail(`No clip named ${names.join(", ")} in the Clip list.`);
  mkdirSync(CLIPS, { recursive: true });
  const manifestPath = join(CLIPS, "clips.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};

  for (const c of list) {
    if (!existsSync(c.src)) fail(`Source not found: ${c.src}`);
    const src = probe(c.src);
    const dur = c.end - c.start;
    if (c.end > src.duration + 0.05) fail(`${c.name}: ends at ${c.end}s but ${basename(c.src)} is only ${src.duration.toFixed(1)}s long.`);
    if (c.hdr !== undefined && c.hdr !== src.hdr)
      console.log(`  ! ${c.name}: Clip list says HDR ${c.hdr ? "yes" : "no"}, the file is ${src.hdr ? "HDR" : "SDR"}. Using the file (fix the table).`);

    const w = even(Math.min(1920, src.width));
    const h = even((w * src.height) / src.width);
    if (src.width < 1920) console.log(`  ! ${c.name}: source is only ${src.width}px wide (kept, not upscaled). A sharper source would look better.`);

    let pre = [];
    let vf = `scale=${w}:${h}:flags=lanczos,format=yuv420p`;
    if (src.hdr) {
      const t = tonemapChain(w, h);
      if (!t) fail(`${c.name} is HDR but this ffmpeg can't tone-map (needs VideoToolbox on a Mac, or zscale). Try: brew install ffmpeg`);
      ({ pre, vf } = t);
    }
    const out = join(CLIPS, `${c.name}.mp4`);
    console.log(`\n▶ ${c.name}: ${basename(c.src)} ${c.start}s → ${c.end}s (${dur.toFixed(2)}s)${src.hdr ? ", HDR → SDR" : ""}`);
    const run = ff(
      ["-loglevel", "error", "-y", ...pre, "-ss", String(c.start), "-t", dur.toFixed(3), "-i", c.src, "-an", "-vf", vf,
        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-movflags", "+faststart", out],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    if (run.status !== 0) fail(`ffmpeg failed on ${c.name}.`);

    // Contact sheet: 12 frames spread evenly, 4 × 3, read left→right, top→bottom.
    const sheet = join(CLIPS, `${c.name}-sheet.jpg`);
    ff(["-loglevel", "error", "-y", "-i", out, "-vf", `fps=12/${dur.toFixed(3)},scale=480:-2,tile=4x3:padding=6:margin=6:color=black`, "-frames:v", "1", "-q:v", "3", sheet]);
    const times = Array.from({ length: 12 }, (_, i) => (c.start + (i * dur) / 12).toFixed(1));
    console.log(`✓ ${out}  (${w}×${h})`);
    console.log(`✓ ${sheet}  tiles at ${times.join(" · ")} s  → look at it: does it show "${c.chapter || c.name}"?`);

    manifest[c.name] = { source: basename(c.src), start: c.start, end: c.end, duration: +dur.toFixed(3), hdr: src.hdr, width: w, height: h, chapter: c.chapter };
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log("\nNext: open every contact sheet. If any clip doesn't show its moment, STOP and fix the times in the Clip list.");
}

// ---------- stills ----------
function stills() {
  const { rows, col } = readTable(/^(#+\s.*stills|\*\*stills\*\*)/i, '"**Stills**" table');
  const c = { name: col(/still|name/), src: col(/source|file/), time: col(/time|sec/) };
  if (c.name < 0 || c.src < 0) fail("Stills table needs the columns: Still · Source · Time (s).");
  const list = rows.filter((r) => !names.length || names.includes(slug(r[c.name])));
  if (!list.length) fail(`No still named ${names.join(", ")} in the Stills table.`);
  mkdirSync(`public/${story}`, { recursive: true });
  const tmp = join(CLIPS, ".still.png");
  mkdirSync(CLIPS, { recursive: true });
  for (const r of list) {
    const name = slug(r[c.name]);
    const src = sourcePath(r[c.src]);
    if (!existsSync(src)) fail(`Source not found: ${src}`);
    const isVideo = /\.(mp4|mov|mkv|m4v|webm)$/i.test(src);
    const t = isVideo && c.time >= 0 ? toSeconds(r[c.time]) : NaN;
    if (isVideo && Number.isNaN(t)) fail(`${name}: a video still needs a time.`);
    const p = probe(src);
    const w = even(Math.min(isVideo ? 1920 : 2400, p.width));
    const h = even((w * p.height) / p.width);
    let pre = [];
    let vf = `scale=${w}:${h}:flags=lanczos`;
    if (p.hdr) {
      const tm = tonemapChain(w, h);
      if (!tm) fail(`${name} is HDR but this ffmpeg can't tone-map (needs VideoToolbox on a Mac, or zscale).`);
      ({ pre, vf } = tm);
    }
    // --zoom 1.12 trims the edges of film stills too (uploader watermarks sit in the corners)
    const zoom = Number(flags.zoom ?? 1);
    if (isVideo && zoom > 1) vf += `,crop=trunc(iw/${zoom}/2)*2:trunc(ih/${zoom}/2)*2`;
    const seek = isVideo ? ["-ss", String(t)] : [];
    const grab = ff(["-loglevel", "error", "-y", ...pre, ...seek, "-i", src, "-frames:v", "1", "-an", "-vf", vf, tmp]);
    if (grab.status !== 0) fail(`ffmpeg failed on ${name}: ${grab.stderr}`);
    const out = join("public", story, `${name}.webp`);
    const enc = spawnSync(FFMPEG_WEBP, ["-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-c:v", "libwebp", "-quality", "82", out], { encoding: "utf8" });
    if (enc.status !== 0) fail(`WebP encode failed on ${name}: ${enc.stderr}`);
    console.log(`✓ ${out}  (${w}×${h}, ${(statSync(out).size / 1024).toFixed(0)} KB${p.hdr ? ", HDR → SDR" : ""})`);
  }
  rmSync(tmp, { force: true });
}

// ---------- frames ----------
function frames() {
  if (!existsSync(CLIPS)) fail(`${CLIPS}/ not found. Run: npm run story:clips -- ${story}`);
  const all = readdirSync(CLIPS).filter((f) => f.endsWith(".mp4")).map((f) => f.replace(/\.mp4$/, ""));
  const list = names.length ? names : all;
  const phone = Boolean(flags.phone);
  let over = false;

  for (const name of list) {
    const clip = join(CLIPS, `${name}.mp4`);
    if (!existsSync(clip)) fail(`${clip} not found. Run: npm run story:clips -- ${story} ${name}`);
    const folder = `frames/${story}-${name}${phone ? "-m" : ""}`;
    const extra = [];
    if (phone) {
      // Portrait crop (9:16 by default, --aspect 0.46 for a full phone screen) that follows the character:
      // focus = centre x as 0–1 of the width. The page's cover-fit trims the rest around the same centre.
      const { width, height, duration } = probe(clip);
      const [a, b = a] = String(flags.focus ?? "0.5").split(":").map(Number);
      if ([a, b].some((n) => Number.isNaN(n) || n < 0 || n > 1)) fail("--focus takes 0–1, or a:b (e.g. 0.3:0.6).");
      // --crop w:h:x:y with --phone keeps only its vertical band (h, y), e.g. to drop baked-in black bars
      const [, bandH = height, , bandY = 0] = String(flags.crop ?? "").split(":").map(Number);
      const cw = Math.min(width, even(bandH * Number(flags.aspect ?? 0.5625)));
      const fx = `(${a}+(${b - a})*t/${duration.toFixed(3)})`;
      extra.push("--crop", `${cw}:${bandH}:max(0\\,min(iw-${cw}\\,iw*${fx}-${cw / 2})):${bandY}`, "--width", String(Math.min(860, cw)));
    }
    extra.push(...(flags.zoom ? ["--zoom", String(flags.zoom)] : []));
    if (flags.vf) extra.push("--vf", String(flags.vf));
    if (flags.crop && !phone) extra.push("--crop", String(flags.crop)); // e.g. remove black bars baked into a source

    const max = phone ? 120 : 160;
    for (let quality = 72; ; quality -= 8) {
      const run = spawnSync("node", ["scripts/video-to-frames.mjs", clip, folder, "--fps", "24", "--max", String(max), "--quality", String(quality), ...extra], { stdio: "inherit" });
      if (run.status !== 0) fail(`frames failed on ${name}.`);
      const mb = folderMB(join("public", folder));
      if (mb <= MAX_FOLDER_MB) break;
      if (quality - 8 < 48) {
        console.log(`  ✗ public/${folder} is ${mb.toFixed(1)} MB even at quality ${quality}. Shorten the clip or use --max 120.`);
        over = true;
        break;
      }
      console.log(`  ! ${mb.toFixed(1)} MB > ${MAX_FOLDER_MB} MB → again at quality ${quality - 8}`);
    }
    if (flags["max-bright"]) tameBright(join("public", folder), Number(flags["max-bright"]));
  }
  if (over) process.exit(1);
}

// ---------- brightness cap ----------
// Grey-level stats (0–1) of one image: average, and spread between the darkest and brightest 5% (flat = small).
function greyStats(file) {
  const r = spawnSync(FFMPEG_WEBP, ["-hide_banner", "-i", file, "-vf", "scale=96:-2,format=gray,signalstats,metadata=print", "-f", "null", "-"], { encoding: "utf8" });
  const get = (k) => Number((r.stderr || "").match(new RegExp(`signalstats\\.${k}=([\\d.]+)`))?.[1] ?? 0) / 255;
  return { avg: get("YAVG"), spread: get("YHIGH") - get("YLOW") };
}
const brightness = (file) => greyStats(file).avg;

/**
 * No frame may average over `cap` (e.g. 0.7): white explosions and flares are pulled down, first with a
 * highlight curve (the flash still reads), then with a straight darken if that isn't enough.
 */
function tameBright(dir, cap) {
  let files = readdirSync(dir).filter((f) => /^frame_\d+\.webp$/.test(f)).sort();
  if (flags["drop-flat"]) {
    // whiteouts: over the cap and almost one flat colour → nothing to darken, drop them and renumber
    const flat = files.filter((f) => {
      const g = greyStats(join(dir, f));
      return g.avg > cap && g.spread < (flags["drop-flat"] === true ? 0.12 : Number(flags["drop-flat"]));
    });
    if (flat.length) {
      flat.forEach((f) => rmSync(join(dir, f)));
      const keep = files.filter((f) => !flat.includes(f));
      keep.forEach((f, i) => spawnSync("mv", [join(dir, f), join(dir, `.r_${String(i + 1).padStart(4, "0")}.webp`)]));
      keep.forEach((_, i) => spawnSync("mv", [join(dir, `.r_${String(i + 1).padStart(4, "0")}.webp`), join(dir, `frame_${String(i + 1).padStart(4, "0")}.webp`)]));
      const mf = join(dir, "manifest.json");
      const m = JSON.parse(readFileSync(mf, "utf8"));
      writeFileSync(mf, JSON.stringify({ ...m, count: keep.length }, null, 2));
      files = readdirSync(dir).filter((f) => /^frame_\d+\.webp$/.test(f)).sort();
      console.log(`  ✂ ${dir}: dropped ${flat.length} flat whiteout frames → ${files.length} frames`);
    }
  }
  const before = files.map((f) => brightness(join(dir, f)));
  const q = (manifestQuality(dir) ?? 72).toString();
  let fixed = 0;
  const after = before.map((b, i) => {
    if (b <= cap) return b;
    const file = join(dir, files[i]);
    const tmp = file.replace(/\.webp$/, ".tmp.webp");
    let result = b;
    for (const white of [0.85, 0.75, 0.65, 0.55, 0.45]) {
      const curve = `curves=all='0/0 0.5/${(0.5 * (0.6 + white * 0.4)).toFixed(3)} 1/${white}'`;
      const scale = Math.min(1, (cap - 0.02) / Math.max(result, 0.01));
      const vf = white > 0.5 ? curve : `${curve},lutrgb=r=val*${scale.toFixed(3)}:g=val*${scale.toFixed(3)}:b=val*${scale.toFixed(3)}`;
      spawnSync(FFMPEG_WEBP, ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vf", vf, "-c:v", "libwebp", "-quality", q, tmp]);
      const nb = brightness(tmp);
      if (nb <= cap || white === 0.45) {
        rmSync(file);
        spawnSync("mv", [tmp, file]);
        result = nb;
        break;
      }
      rmSync(tmp, { force: true });
    }
    fixed++;
    return result;
  });
  const run = (arr) => arr.reduce((acc, b) => ({ cur: b > cap ? acc.cur + 1 : 0, max: Math.max(acc.max, b > cap ? acc.cur + 1 : 0) }), { cur: 0, max: 0 }).max;
  const pct = (arr) => (Math.max(...arr) * 100).toFixed(0);
  console.log(`  ☼ ${dir}: ${fixed} bright frames tamed · brightest ${pct(before)}% → ${pct(after)}% · longest run over ${Math.round(cap * 100)}%: ${run(before)} → ${run(after)} frames`);
}
const manifestQuality = () => 72;

// ---------- record ----------
async function record() {
  const label = names[0];
  if (!label) fail("Give the recording a label, e.g. npm run story:record -- last-landing r2");
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    fail("Playwright is missing: npm i -D playwright");
  }
  const base = String(flags.url ?? "http://localhost:3000").replace(/\/$/, "");
  const query = String(flags.query ?? "");
  const maxSecs = Number(flags.max ?? 120);
  const sizes = String(flags.sizes ?? "1440,820,390").split(",").map((s) => s.trim());
  try {
    await fetch(base);
  } catch {
    fail(`${base} is not running. Start the production build first: npm run build && npm start`);
  }

  const outDir = `recordings/${story}`;
  mkdirSync(outDir, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome" });
  } catch {
    browser = await chromium.launch();
  }

  for (const s of sizes) {
    const [width, height] = SIZES[s] ?? (s.includes("x") ? s.split("x").map(Number) : [Number(s), 900]);
    const mobile = width < 1024;
    const tmp = join(outDir, ".tmp");
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: 1,
      recordVideo: { dir: tmp, size: { width, height } },
    });
    const page = await context.newPage();
    const logs = [];
    const vt0 = Date.now();
    let done = false;
    page.on("console", (m) => {
      const t = m.text();
      // @12.34 = seconds into the video (the video starts with the page), to find moments in the recording
      if (m.type() === "error" || m.type() === "warning" || t.startsWith("[record]")) logs.push(`@${((Date.now() - vt0) / 1000).toFixed(2)} [${m.type()}] ${t}`);
      if (t.startsWith("[record] done")) done = true;
    });
    page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
    page.on("response", (r) => r.status() >= 400 && logs.push(`[missing] ${r.status()} ${r.url().replace(base, "")}`));

    const t0 = Date.now();
    process.stdout.write(`▶ ${width}×${height} … `);
    if (flags.static) {
      // No motion: open ?static=1 and scroll the whole page at a steady speed (after a 1.5 s look at the top).
      const secs = Number(flags.duration ?? 45);
      await page.goto(`${base}/?static=1${query}`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      await page.evaluate(
        (ms) =>
          new Promise((resolve) => {
            const max = () => document.documentElement.scrollHeight - innerHeight;
            const t0 = performance.now();
            const step = (t) => {
              const p = Math.min(1, (t - t0) / ms);
              window.scrollTo(0, max() * p);
              if (p < 1) requestAnimationFrame(step);
              else resolve();
            };
            requestAnimationFrame(step);
          }),
        secs * 1000,
      );
      done = true;
    } else await page.goto(`${base}/?record=1${query}`, { waitUntil: "load" });
    // Finished = the timeline logs "done", or (constant-speed mode) the page sits at the bottom for 2 s.
    let atBottomSince = 0;
    while (!done && Date.now() - t0 < maxSecs * 1000) {
      await page.waitForTimeout(500);
      const bottom = await page.evaluate(() => window.scrollY > 0 && window.scrollY + innerHeight >= document.documentElement.scrollHeight - 2);
      if (!bottom) atBottomSince = 0;
      else if (!atBottomSince) atBottomSince = Date.now();
      else if (Date.now() - atBottomSince > 2000) done = true;
    }
    await page.waitForTimeout(1500);
    const video = page.video();
    await context.close();
    const file = join(outDir, `${label}-${width}.webm`);
    await video.saveAs(file);
    rmSync(tmp, { recursive: true, force: true });
    writeFileSync(file.replace(/\.webm$/, ".log"), logs.join("\n") + "\n");
    const errors = logs.filter((l) => /^\[(error|pageerror)\]/.test(l)).length;
    const missing = logs.filter((l) => l.startsWith("[missing]")).length;
    console.log(`${done ? "✓" : `✗ stopped after ${maxSecs}s (never finished)`} ${file}  (${((Date.now() - t0) / 1000).toFixed(1)} s, ${errors} console errors, ${missing} missing files → see .log)`);
  }
  await browser.close();
}

// ---------- check ----------
async function checkPrivate() {
  // Asks GitHub anonymously: a public repo answers 200, a private one 404. No login needed.
  const remotes = spawnSync("git", ["remote", "-v"], { encoding: "utf8" }).stdout || "";
  const repos = [...new Set([...remotes.matchAll(/[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\s+\(fetch\)/g)].map((m) => `${m[1]}/${m[2]}`))];
  if (!repos.length) {
    console.log("  ? no git remote yet. When you add one, make it a PRIVATE GitHub repo.");
    return true;
  }
  let ok = true;
  for (const repo of repos) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: { "User-Agent": "story-check" } });
      if (res.status === 200) {
        ok = false;
        console.log(`  ✗ ${repo} is PUBLIC. Story repos must be private (GitHub → Settings → Change visibility).`);
      } else if (res.status === 404) console.log(`  ✓ ${repo} is private`);
      else console.log(`  ? ${repo}: GitHub answered ${res.status}, check by hand that it is private`);
    } catch {
      console.log(`  ? ${repo}: offline, check by hand that it is private`);
    }
  }
  return ok;
}

async function check() {
  let ok = true;
  const bad = (msg) => {
    ok = false;
    console.log(`  ✗ ${msg}`);
  };
  const tracked = spawnSync("git", ["ls-files"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);

  // 1. Nothing of the story in git
  const forbidden = tracked.filter(
    (f) => /^(raw|recordings)\//.test(f) || f.startsWith("public/frames/") || f.startsWith(`public/${story}/`) || /\.(mp4|mov|mkv|webm|m4v)$/i.test(f),
  );
  if (forbidden.length) bad(`${forbidden.length} story/footage files are tracked by git, e.g. ${forbidden.slice(0, 3).join(", ")}. Run: npm run story:init -- ${story}`);
  else console.log("  ✓ no footage, frames, stills or recordings in git");
  const images = tracked.filter((f) => f.startsWith("public/") && /\.(webp|png|jpe?g|avif|gif)$/i.test(f));
  if (images.length) console.log(`  ! ${images.length} images in public/ are tracked (e.g. ${images[0]}). Stills from the film belong in public/${story}/ (ignored).`);

  // 2. .gitignore block
  const gi = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8").split("\n").map((l) => l.trim()) : [];
  const need = ["raw/", "recordings/", "public/frames/", `public/${story}/`];
  const missing = need.filter((l) => !gi.includes(l));
  if (missing.length) bad(`.gitignore is missing ${missing.join(", ")}. Run: npm run story:init -- ${story}`);
  else console.log("  ✓ .gitignore has raw/, recordings/, public/frames/, public/" + story + "/");

  // 3. Credit line in the finale
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(f)) files.push(p);
    }
  };
  if (existsSync("site")) walk("site");
  const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
  if (!CREDIT_RE.test(src)) bad(`credit line missing: the finale must say "${CREDIT}" and name the original owner`);
  else console.log(`  ✓ credit line "${src.match(CREDIT_RE)[0]}" is in site/`);

  // 4. Frame folders ≤ 15 MB
  const fr = existsSync("public/frames") ? readdirSync("public/frames").filter((d) => d.startsWith(`${story}-`)) : [];
  for (const d of fr) {
    const mb = folderMB(join("public/frames", d));
    if (mb > MAX_FOLDER_MB) bad(`public/frames/${d} is ${mb.toFixed(1)} MB (max ${MAX_FOLDER_MB})`);
  }
  if (fr.length) console.log(`  · ${fr.length} frame folders checked (max ${MAX_FOLDER_MB} MB each)`);

  // 5. Not in the business log
  if (existsSync("docs/SITES-LOG.md") && new RegExp(`\\b${story}\\b`, "i").test(readFileSync("docs/SITES-LOG.md", "utf8")))
    bad(`"${story}" appears in docs/SITES-LOG.md. Story sites are logged in docs/STORY-LOG.md only.`);
  else console.log("  ✓ not in docs/SITES-LOG.md");

  // 6. Private repo
  if (!(await checkPrivate())) ok = false;

  console.log(ok ? "\nStory check passed.\n" : "\nStory check FAILED.\n");
  process.exit(ok ? 0 : 1);
}

await commands[cmd]();
