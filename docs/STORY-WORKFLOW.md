# Story mode: a cinematic fan-made site from film footage

The business workflow (`CLAUDE.md` → Round 0 + 5 rounds) builds a shop-style site for a brand. **Story mode** builds a different kind of showreel: a site that tells a story from a film or series in **chapters**, each chapter driven by a real clip from the footage (scroll-scrubbed frames), with big headlines and a credit line at the end.

Start one with `/new-story <brief>`. Everything else in the kit works exactly as it does for business sites: the engine, `?static=1`, `?record=1` with the section timeline, `&at=HH:MM:SS` sync for two devices, `npm run archive` / `npm run restore`. Story mode adds a few rules, a folder layout and some `npm run story:*` tools.

## The rules (every story site, no exceptions)

1. **Credit line in the finale.** The last chapter/footer shows, readable (≥ 12px, good contrast), a line naming the original owner and the words **"Fan-made concept … not affiliated"** (the studio may be named in between), e.g. *"<Film> and all footage © <Studio>. Fan-made concept, not affiliated."* It is visible with `?static=1`, and the record timeline ends holding on it.
2. **No footage in git, ever.** `raw/`, `public/frames/`, `public/<story>/` and `recordings/` are always gitignored (`npm run story:init -- <story>` adds them and untracks anything already tracked). Film stills go in `public/<story>/`, **not** `public/images/`.
3. **The repo stays private.** `npm run story:check` asks GitHub about every remote and fails if one is public. Never push a story to a business-site remote; create a new private repo for it.
4. **Story sites never go in `docs/SITES-LOG.md`.** They are logged in `docs/STORY-LOG.md` (local only, not in git) and archived as `archive/story-<name>`.
5. **The design is ours.** Don't use the film's official logo, title artwork or poster typography; set the title in the site's own type pair.

## Folders

| Path | What | In git? |
|---|---|---|
| `raw/<story>/src/` | the source videos (trailers, scenes) | no |
| `raw/<story>/scan/` | overview sheets of each source (`story:scan`) | no |
| `raw/<story>/clips/` | cut clips `<clip>.mp4`, contact sheets `<clip>-sheet.jpg`, `clips.json` | no |
| `public/frames/<story>-<clip>` | scroll frames (laptop); `…-m` = phone crop | no |
| `public/<story>/` | stills (webp) for cards, posters, backgrounds | no |
| `recordings/<story>/` | `r<N>-1440.webm`, `r<N>-820.webm`, `r<N>-390.webm` + a `.log` each | no |
| `site/` | the site, as usual (`DESIGN.md` holds the storyboard) | yes |
| `docs/STORY-LOG.md` | one row per finished story | no |

## Tools

| Command | Does |
|---|---|
| `npm run story:init -- <story>` | Makes the folders, adds the story block to `.gitignore`, untracks footage, creates `docs/STORY-LOG.md`, checks the repo is private |
| `npm run story:scan -- <story> [file …] [--every 2]` | Overview sheets of each source: 30 tiles a page, one every 2 s, with the time of every tile printed. Use them to find the clip times |
| `npm run story:clips -- <story> [clip …]` | Cuts every row of the **Clip list** in `site/DESIGN.md`: no audio, 1920 wide (never upscaled), H.264 crf 16, **HDR sources tone-mapped to SDR** (VideoToolbox on a Mac, zscale elsewhere). Makes a 12-tile contact sheet per clip and prints the time of each tile |
| `npm run story:stills -- <story> [still …]` | The `**Stills**` table in `DESIGN.md` → `public/<story>/<still>.webp` (film stills tone-mapped from HDR; image sources like a poster converted as-is) |
| `npm run story:frames -- <story> [clip …]` | Clips → frames: ~24 per second of clip, max 160, webp quality 72. If a folder is over 15 MB it re-runs at a lower quality automatically, and fails if it still doesn't fit |
| `npm run story:frames -- <story> <clip> --vf "eq=gamma=1.2,unsharp=5:5:0.6" --max-bright 0.7 [--drop-flat 0.12]` | Grading: `--vf` adds ffmpeg filters (lift a dark clip, sharpen). `--max-bright 0.7` measures every frame and pulls any frame averaging over 70% brightness down (highlight curve, then a straight darken), so explosions and flares never blind; `--drop-flat` also removes whiteout frames (over the cap and nearly one flat colour), smaller number for narrow phone crops |
| `npm run story:frames -- <story> <clip> --phone --focus 0.45` | Phone frame set `<story>-<clip>-m`: a 9:16 crop centred on x = 0.45 of the width (`--focus 0.3:0.6` follows a character moving left → right), max 120 frames, light enough to scrub smoothly on a phone |
| `npm run story:record -- <story> r<N>` | Opens `?record=1` in Chrome at **1440×900, 820×1180 and 390×844**, films each run to `recordings/<story>/`, stops when the timeline logs `done` and saves console errors + missing files to a `.log` (each line starts with `@seconds` into the video, so `[record] … → <stop>` lines tell you where each moment is in the recording). Needs `npm run build && npm start` running. Options: `--sizes 1440,390`, `--query "&at=18:55:00"`, `--url`, `--max 120`. With `--static [--duration 45]` it records `?static=1` with a slow, steady scroll instead (e.g. `npm run story:record -- <story> r1-static --static --sizes 1440,390`) |
| `npm run story:check -- <story>` | Fails if footage/frames/stills/recordings are tracked by git, the `.gitignore` block is missing, the credit line is missing, a frame folder is over 15 MB, the story is in `SITES-LOG.md` or a GitHub remote is public |

**Clip length:** frames are ~24 per second up to 160, so a clip up to **~6.5 s** plays at full smoothness; a longer clip gets fewer frames per second. Plan clips of 3–6.5 s.

## Round 0 + 5 rounds

Stop after **every** round, tell the user in plain simple language what to check, and wait for their "ok".

**Recordings after every round (1–5):** `npm run build && npm start`, then `npm run story:record -- <story> r<N>`. Before reporting, look at each recording yourself: pull a still per chapter (`ffmpeg -ss <s> -i recordings/<story>/r<N>-390.webm -frames:v 1 -vf scale=480:-2 /tmp/r.jpg`) and read the `.log` (console errors, missing files). Give the user the three file paths. Round 0 has no page, so no recording.

### Round 0: Storyboard (no code yet)
1. **Clear the previous site's assets** (`public/images/<old-slug>/`, `public/frames/*`, `public/<old-story>/`), like a business Round 0.
2. `npm run story:init -- <story>`. The sources go in `raw/<story>/src/`.
3. **Read the brief**, `docs/STORY-LOG.md` (so the look, hero and signature don't repeat the last story), `docs/DESIGN-MENU.md` and `docs/MOTION-MENU.md`.
4. **Watch the footage:** `npm run story:scan -- <story>` and read every sheet. Note the strongest moments with their times. Find the owner for the credit line.
5. **Write `site/DESIGN.md`** with:
   - **The story in one line**, and the **credit line** exactly as it will appear.
   - **Chapters** (5–8, the hero is chapter 1 and the finale the last): table `# · Title · Story line (one sentence) · Headline (2–6 words a line) · Clip(s)`.
   - **Look:** palette (bg, surface, text, muted, one accent; pulled from the footage's grade), type pair (display + text, never the film's logo type), mood in three words, nav, loader, section shape. One-line reason each.
   - **Clip list** (the tools read this table, keep the columns and the heading `## Clip list`):

     ```
     ## Clip list

     | Clip | Source | Start–end (s) | HDR | Chapter |
     |---|---|---|---|---|
     | forge-fire | src-forge.mp4 | 60.0–64.5 | yes | 3 · The forge |
     ```
     Clip = a short slug (it names the frame folder). Source = a file in `raw/<story>/src/`. Times in seconds or `m:ss.s`. HDR = what `story:scan` printed for that file. Say in the Chapter column what the clip must show ("hammer lands in his hand").
   - **Motion map**: the table from the end of `docs/MOTION-MENU.md`, one row per chapter plus loader, nav and finale. **One code each, no code used twice, no plain fades** (`data-reveal` may support, never be the code). Mark the hero and the **signature chapter**. Then the transitions between chapters (X codes) and the planned details (hover, cursor).
   - **Record timeline plan:** seconds per chapter (move + hold) so the whole run is 25–40 s after the loader, ending on the credit line.
6. **Stop for approval** of the storyboard, the Clip list and the Motion map.

### Round 1: Clips + structure (no motion yet)
1. **Save the old site**: `npm run archive -- <its-name>` (if not saved), then clear `site/` except `DESIGN.md`.
2. **Cut the clips:** `npm run story:clips -- <story>`.
3. **Check every contact sheet** (`raw/<story>/clips/<clip>-sheet.jpg`, read the image). If **any** clip doesn't show the moment its Chapter column describes (wrong shot, a cut to another scene, black frames, title cards): **STOP**. Tell the user which clip and what it shows instead, suggest new times from the scan sheets, and don't build until they agree.
4. **Frames:** `npm run story:frames -- <story>`. Every folder ≤ 15 MB (the tool enforces it).
5. **Stills** for cards/posters: list them under a `**Stills**` table in `DESIGN.md` (Still · Source · Time (s) · HDR · Chapter; a source may also be an image in `raw/<story>/`), then `npm run story:stills -- <story>` → `public/<story>/<still>.webp` (HDR tone-mapped; Homebrew's ffmpeg has no WebP encoder, the tool uses the bundled one).
6. **Build every chapter with its real frames**: fonts (`npm i` + `site/fonts.ts`), `site/site.ts`, `site/site.css`, `site/content.ts`, `site/components/*`, `site/Page.tsx`, nav and finale with the credit line. Copy patterns into `site/components/` and restyle (at most 3 imported unchanged). Build the markup the Motion map needs (masks, split text, strips, SVG) but **no motion yet**; everything shows its final state.
7. `npm run check`, `npm run build`, `npm run story:check -- <story>` pass.
8. Recordings (`r1`), then ask the user to review `http://localhost:3000/?static=1` on the laptop and at phone size.

### Round 2: Big motion
1. **Loader:** shows the title in the site's type, then reveals the site with its Motion map code. Fixed length (e.g. 2.5 s) and `&at=` support (`lib/atTime.ts`, like `components/patterns/StartLightsLoader.tsx`).
2. **Hero** (chapter 1): its motion and scroll length; captions have time to be read.
3. **Signature chapter:** make it great.
4. Every pinned / scrubbed chapter (M10, M11, M25, M27–M30 …): scroll lengths tuned so the clip plays at a natural speed.
5. Anything that needs hover/click also plays by itself on screen (filming is hands-free).
6. **Motion map check**, recordings (`r2`), ask the user to watch them.

### Round 3: Chapter motion + transitions
1. **Every other chapter** gets its Motion map code.
2. **Transitions between chapters** (X codes) so the page plays as one film: a clip's last frame handing over to the next chapter's first, a colour wash between grades, a hard cut on the beat after a long pin.
3. Supporting motion stays calmer than the signature; one main thing moves at a time.
4. **Motion map check**, recordings (`r3`), ask the user to watch them.

### Round 4: Details + phone pass
1. **Details:** hover states, cursor labels (`data-cursor="Play"`), magnetic buttons, link micro-interactions. Each one that matters on camera also has a **hands-free version** that plays once by itself during `?record=1` (on screen, or on the `record:hold` event).
2. **Phone crop:** for every frame chapter make a phone set with the main character centred: `npm run story:frames -- <story> <clip> --phone --focus <x>` (`a:b` when they move), and switch to the `-m` folder below 768 px. Check the 390 recording: the character stays in the middle of the screen in every chapter.
3. **Smooth scrub on phone:** phone sets only (max 120 frames), shorter pins (~150vh), no dropped frames in the 390 recording, no sideways page scroll, nothing cut off, text ≥ 12px, the menu opens and closes.
4. **Motion map check** at laptop and phone size, recordings (`r4`), ask the user to check on a real phone.

### Round 5: Polish, record timeline, archive
1. **Record timeline:** `data-record-time` / `data-record-hold` (+ `-mobile`) on every chapter (see `docs/RECORDING.md`); the whole run is 25–40 s after the loader and **ends holding on the credit line**. Test `&at=` on two sizes.
2. **Speed check:** in the recordings, every headline can be read before it leaves, no clip plays too fast (a scrub shouldn't cover a whole clip in under ~1.5 s), no empty screens.
3. **Credit line present** in the finale, readable at 1440 and 390, and on screen at the end of the record run.
4. Performance: frames ≤ 15 MB per folder, stills webp and sized, no layout jumps, no console errors (the recording `.log`s are empty), `npm run build` passes, `?static=1` shows every chapter in its final state.
5. `npm run story:check -- <story>` passes.
6. **Archive:** `npm run archive -- story-<name>`.
7. **Log:** add a row to `docs/STORY-LOG.md` (not `SITES-LOG.md`): date · story · owner · chapters · look · loader · hero · signature · Motion (loader · hero · signature codes) · clips · archive name.
8. Final recordings (`r5`), then report: the chapter list, anything skipped, the recordings, and the filming command from `docs/RECORDING.md`.

### Motion map check (end of Rounds 2, 3 and 4)
Go through the Motion map in `site/DESIGN.md` chapter by chapter, in normal scroll, `?record=1` and the recordings (phone size in Round 4). For each chapter confirm: its main move **is** the planned code (not a plain fade), it plays without hover/click, and `?static=1` shows its final state. Fix every chapter that doesn't match (or, if a better motion was chosen, update the map, still with no code used twice). Report a short table: chapter · code · ✅ / fixed.
