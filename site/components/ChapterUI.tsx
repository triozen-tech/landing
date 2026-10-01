import type { CSSProperties } from "react";
import { chapters, drop, end, gear, map, match, squad, title } from "../content";

/*
 * The game UI drawn over each clip. Markup = the FINAL state of every chapter (so ?static=1 shows it as is);
 * Stage.tsx animates from hidden/empty states with GSAP, or sets live values (odometers, bars, the map lock-on)
 * every frame from the story time. All sizes are in cqw/cqh of the 16:9 stage box.
 */

/* ---------- odometer (M3) ---------- */

/** Continuous odometer position of each digit column (right-most = ones), carrying like a real counter. */
export function odoPositions(raw: number, digits: number) {
  // each step holds on its number, then rolls in the last 30% (readable on camera)
  const whole = Math.floor(raw);
  const r = (raw - whole - 0.7) / 0.3;
  const e = r <= 0 ? 0 : r >= 1 ? 1 : r * r * (3 - 2 * r);
  const value = whole + e;
  const out: number[] = [];
  for (let k = 0; k < digits; k++) {
    const unit = 10 ** k;
    const base = value / unit;
    if (k === 0) out.push(base % 10);
    else {
      const below = value % unit; // e.g. ones while this is the tens column
      const carry = Math.max(0, below - (unit - 1));
      out.push((Math.floor(base) % 10) + Math.min(1, carry));
    }
  }
  return out.reverse(); // left → right
}

const COL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
export const colShift = (pos: number) => `translateY(${(-pos * 100) / COL.length}%)`;

function Odo({ value, digits, name }: { value: number; digits: number; name: string }) {
  const pos = odoPositions(value, digits);
  return (
    <span className="odo" data-odo={name}>
      {pos.map((p, i) => (
        <span key={i} className="odo-mask">
          <span className="odo-col" data-col style={{ transform: colShift(p) }}>
            {COL.map((d, j) => (
              <span key={j}>{d}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

/* ---------- 1 · title (M12) ---------- */

export function TitleUI() {
  const word = (w: string) =>
    w.split("").map((l, i) => (
      <span key={i} className="logo-mask">
        <span data-letter className="logo-letter">
          {l}
        </span>
      </span>
    ));
  return (
    <div className="ui ui-title" data-ui="title">
      <div className="logo-glow" aria-hidden />
      <h1 className="logo" data-logo aria-label="Last Landing">
        <span className="logo-line logo-top">{word(title.top)}</span>
        <span className="logo-line logo-bottom">{word(title.bottom)}</span>
      </h1>
      <p className="press" data-press>
        <span className="press-key">▶</span> {title.press}
      </p>
      <p className="hint" data-hint>
        {title.hint} <span className="hint-arrow">↓</span>
      </p>
    </div>
  );
}

/* ---------- 2 · squad (M31) ---------- */

function Rank({ tone }: { tone: string }) {
  return (
    <svg viewBox="0 0 20 20" className="rank" aria-hidden>
      <path d="M10 1 19 10 10 19 1 10Z" fill="none" stroke={tone} strokeWidth="2" />
      <path d="M10 6 14 10 10 14 6 10Z" fill={tone} />
    </svg>
  );
}

export function SquadUI() {
  return (
    <div className="ui ui-squad" data-ui="squad">
      <p className="panel-label squad-label">
        {squad.label} <span>3 / 3</span>
      </p>
      <div className="cards">
        {squad.players.map((p) => (
          <article key={p.name} className="pcard" data-card={p.lead ? "lead" : "other"} style={{ "--tone": p.tone } as CSSProperties}>
            <span className="pcard-edge" aria-hidden />
            <div className="pcard-head">
              <span className="pcard-name">{p.name}</span>
              <span className="pcard-role">{p.role}</span>
            </div>
            <div className="pcard-meta">
              <span className="pcard-lv">
                Lv <b>{p.level}</b>
              </span>
              <span className="pcard-rank">
                <Rank tone={p.tone} /> {p.rank}
              </span>
            </div>
            {p.lead && (
              <span className="pcard-ready" data-ready>
                Ready ✓
              </span>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

/* ---------- 3 · gear (M26) ---------- */

export function GearUI() {
  return (
    <div className="ui ui-gear" data-ui="gear">
      <div className="panel gear-panel" data-panel>
        <p className="panel-label">{gear.label}</p>
        <h2 className="panel-title">{gear.item}</h2>
        {gear.stats.map((s) => (
          <div key={s.name} className="stat is-active" data-stat>
            <div className="stat-top">
              <span className="stat-name">{s.name}</span>
              <span className="stat-part">{s.part}</span>
              <span className="stat-num" data-num>
                {s.value}
              </span>
            </div>
            <div className="stat-bar">
              <span className="stat-fill" style={{ width: `${s.value}%` }}>
                <span className="stat-fill-in" data-fill />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- 4 · map (M8) ---------- */

const W = 1600;
const H = 900;
const L = 70; // bracket arm (viewBox units)

/** Corner bracket paths + leader line for a ring box (0–1 of the stage) */
export function mapGeometry(r: number[]) {
  const [, cx, , x0, x1, y0, y1] = r;
  const X0 = x0 * W;
  const X1 = x1 * W;
  const Y0 = y0 * H;
  const Y1 = y1 * H;
  return {
    brackets: [
      `M${X0} ${Y0 + L}V${Y0}H${X0 + L}`,
      `M${X1 - L} ${Y0}H${X1}V${Y0 + L}`,
      `M${X1} ${Y1 - L}V${Y1}H${X1 - L}`,
      `M${X0 + L} ${Y1}H${X0}V${Y1 - L}`,
    ],
    leader: `M${cx * W} ${Y0 - 6}V${Y0 - 0.075 * H}`,
    labelLeft: `${cx * 100}%`,
    labelTop: `${(y0 - 0.075) * 100}%`,
  };
}

export function MapUI() {
  const last = map.ring[map.ring.length - 1];
  const g = mapGeometry(last);
  return (
    <div className="ui ui-map" data-ui="map">
      <svg viewBox={`0 0 ${W} ${H}`} className="map-svg" aria-hidden>
        {g.brackets.map((d, i) => (
          <path key={i} d={d} pathLength={1} className="map-bracket" data-bracket />
        ))}
        <path d={g.leader} pathLength={1} className="map-leader" data-leader />
      </svg>
      <div className="map-reticle" data-reticle style={{ left: `${last[1] * 100}%`, top: `${last[2] * 100}%` }} aria-hidden>
        <span />
      </div>
      <div className="map-label" data-label style={{ left: g.labelLeft, top: g.labelTop }}>
        <span className="map-kicker">{map.kicker}</span>
        <span className="map-place">{map.place}</span>
        <span className="map-meta">{map.meta}</span>
        <span className="map-lock" data-lock>
          Locked
        </span>
      </div>
    </div>
  );
}

/* ---------- 5 · matchmaking (M3) ---------- */

export function MatchUI({ showReady = false }: { showReady?: boolean }) {
  return (
    <div className="ui ui-match" data-ui="match">
      <div className="panel match-panel" data-panel>
        <p className="panel-label">{match.label}</p>
        <p className="match-mode">{match.mode}</p>
        <div className="match-row">
          <span className="match-key">Time</span>
          <span className="match-val">
            0:0
            <Odo value={match.timer[1]} digits={1} name="timer" />
          </span>
        </div>
        <div className="match-row">
          <span className="match-key">Players found</span>
          <span className="match-val">
            <Odo value={match.players[1]} digits={2} name="players" />
            <small>/ 99</small>
          </span>
        </div>
        <div className="match-bar">
          <span data-match-fill />
        </div>
      </div>
      <div className={`ready${showReady ? " is-shown" : ""}`} data-ready-flash>
        {match.ready}
      </div>
    </div>
  );
}

/* ---------- 6 · drop (M25) + end card (M24) ---------- */

export function DropUI() {
  return (
    <div className="ui ui-drop" data-ui="drop">
      <div className="jump" data-jump>
        {drop.word}
      </div>
    </div>
  );
}

export function EndCard() {
  return (
    <div className="endcard" data-end>
      <div className="end-title" aria-label={end.title}>
        <span className="end-outline" aria-hidden>
          {end.title}
        </span>
        <span className="end-fill" data-end-fill aria-hidden>
          {end.title}
        </span>
      </div>
      <p className="end-day" data-end-line>
        <span>{end.day}</span>
        <i aria-hidden />
        <span className="end-follow">{end.follow}</span>
      </p>
      <p className="credit" data-end-line>
        {end.credit}
      </p>
    </div>
  );
}

/* ---------- HUD: wordmark, chapter counter (M22), letterbox ---------- */

export function Hud({ n = 1 }: { n?: number }) {
  const c = chapters[n - 1];
  return (
    <>
      <div className="bar bar-top" aria-hidden />
      <div className="bar bar-bottom" aria-hidden />
      <div className="hud" data-hud>
        <span className="hud-brand">
          <i aria-hidden />
          Last Landing
        </span>
        <span className="hud-counter">
          <b data-hud-num>{String(n).padStart(2, "0")}</b>
          <span className="hud-of">/ {String(chapters.length).padStart(2, "0")}</span>
          <span className="hud-name" data-hud-name>
            {c.name}
          </span>
        </span>
      </div>
    </>
  );
}

export const chapterUI = {
  title: TitleUI,
  squad: SquadUI,
  gear: GearUI,
  map: MapUI,
  match: MatchUI,
  drop: DropUI,
};
