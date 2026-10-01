---
name: new-story
description: Build a fan-made cinematic STORY site in this Showreel Kit from film/series footage, told in chapters with scroll-scrubbed clips. Use when the user asks for a story site, a fan-made/movie/character site, "story mode", or gives footage in raw/<story>/src/. Not for business/brand sites (that is /new-site).
---

# New story site

The user gives a brief like: *"Story — <title>: <one-line arc>. Footage in raw/<story>/src/. Mood: <three words>."*

Follow **`docs/STORY-WORKFLOW.md`** (Round 0 + 5 rounds). Never skip a round, stop after each for the user's "ok", and explain in plain simple language. The business rounds in `CLAUDE.md` don't apply here, but the engine, house style and pattern rules do.

**Rules on every story site**
- The finale shows a credit line naming the original owner and **"Fan-made concept, not affiliated"**, readable, visible with `?static=1`, and the record run ends on it.
- `raw/`, `public/frames/`, `public/<story>/` and `recordings/` are always gitignored (`npm run story:init -- <story>`). No footage or stills in git; film stills go in `public/<story>/`.
- The repo stays **private**. `npm run story:check -- <story>` must pass; if a remote is public, tell the user and never push to it.
- Story sites are logged in `docs/STORY-LOG.md` and archived as `story-<name>`, **never** in `docs/SITES-LOG.md`.
- Record mode, `?static=1`, `&at=` sync and `npm run archive` work exactly as in the business kit: don't change `components/engine/`.

**Rounds**
- **Round 0 — Storyboard:** clear the old assets, `story:init`, `story:scan` and read every sheet, then write `site/DESIGN.md`: story line, credit line, chapters (title · story line · headline · clips), look (palette, fonts, mood), **`## Clip list`** table (Clip · Source · Start–end (s) · HDR · Chapter), **Motion map** (one code per chapter from `docs/MOTION-MENU.md`, no repeats, no plain fades, signature marked) + transitions + details, record timeline plan. Stop for approval.
- **Round 1 — Clips + structure:** archive the old site, `story:clips`, **read every contact sheet and STOP if any clip doesn't show its described moment**, `story:frames` (~24/s, max 160, q72, ≤ 15 MB), stills into `public/<story>/`, build every chapter with real frames and no motion, `check` + `build` + `story:check`.
- **Round 2 — Big motion:** loader (fixed length, `&at=`), hero, signature chapter, pinned/scrubbed chapters, hands-free versions. Motion map check.
- **Round 3 — Chapter motion:** every other chapter's code + transitions between chapters. Motion map check.
- **Round 4 — Details + phone:** hover/cursor details with hands-free versions for `?record=1`; phone frame sets centred on the main character (`story:frames … --phone --focus x`), smooth scrub on phone. Motion map check at laptop and phone size.
- **Round 5 — Polish:** record timeline (25–40 s, ends on the credit line), speed check, credit line present, `story:check`, `npm run archive -- story-<name>`, row in `docs/STORY-LOG.md`.
- **After every round from 1 on:** `npm run build && npm start`, then `npm run story:record -- <story> r<N>` (1440, 820, 390). Look at stills from each recording and read the `.log`s yourself before reporting; give the user the file paths.
