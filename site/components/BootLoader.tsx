"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, prefersReducedMotion } from "@/lib/gsap";
import { atFromUrl, waitForClock } from "@/lib/atTime";
import { loading } from "@/lib/loading";

/**
 * M17 loader: the game boots. Wordmark + "LOADING ISLAND" bar, then the cover breaks into a 16×9 grid of
 * squares that flip away from the centre. Always exactly 2.5 s; if the clips are not in yet it waits on its
 * last step (READY) until they are (max 12 s). `data-loader` keeps record mode waiting until it is gone.
 * `?record=1&at=HH:MM:SS`: frozen on its first frame until that time (docs/RECORDING.md).
 */

let booted = false;
const BOOT_EVENT = "boot:done";
/** Run fn once the boot loader has gone (now if it already has). */
export function onBootDone(fn: () => void) {
  if (booted) {
    fn();
    return () => {};
  }
  window.addEventListener(BOOT_EVENT, fn, { once: true });
  return () => window.removeEventListener(BOOT_EVENT, fn);
}

const COLS = 16;
const ROWS = 9;

export default function BootLoader() {
  const root = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const finish = () => {
      booted = true;
      window.dispatchEvent(new Event(BOOT_EVENT));
      setGone(true);
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    window.scrollTo(0, 0);
    window.__lenis?.stop();
    const el = root.current!;
    const target = atFromUrl();
    let ready = false;
    const off = loading.subscribe((_p, done) => {
      if (done) ready = true;
    });
    const giveUp = window.setTimeout(() => (ready = true), 12000);
    let cancelClock = () => {};

    const ctx = gsap.context(() => {
      const pct = el.querySelector("[data-pct]") as HTMLElement;
      const state = el.querySelector("[data-state]") as HTMLElement;
      const bar = { p: 0 };
      const tl = gsap.timeline({ paused: !!target });
      tl.fromTo("[data-boot-letter]", { yPercent: 110 }, { yPercent: 0, duration: 0.5, stagger: 0.03, ease: "power4.out" }, 0)
        .to(bar, {
          p: 1,
          duration: 1.45,
          ease: "power2.inOut",
          onUpdate: () => {
            gsap.set("[data-boot-fill]", { scaleX: bar.p });
            pct.textContent = String(Math.round(bar.p * 100)).padStart(3, "0");
          },
        }, 0.2)
        .add(() => {
          // still loading: hold on 100% until every clip is in
          if (ready) return;
          tl.pause();
          state.textContent = "Syncing squad";
          const wait = () => (ready ? tl.play() : requestAnimationFrame(wait));
          wait();
        }, 1.66)
        .add(() => (state.textContent = "Ready"), 1.68)
        .to("[data-boot-body]", { autoAlpha: 0, scale: 1.04, duration: 0.2, ease: "power2.in" }, 1.85)
        .add(() => window.__lenis?.start(), 1.95)
        .to("[data-cell]", { scale: 0, duration: 0.2, ease: "power2.in", stagger: { grid: [ROWS, COLS], from: "center", amount: 0.33 } }, 1.95)
        .add(finish, 2.5);
      if (target) {
        if (Date.now() < target.getTime()) console.log(`[record] loader frozen until ${target.toLocaleTimeString()}`);
        cancelClock = waitForClock(target, () => tl.play(0));
      }
    }, el);
    return () => {
      off();
      clearTimeout(giveUp);
      cancelClock();
      ctx.revert();
    };
  }, []);

  if (gone) return null;
  return (
    // inline styles: covers the screen from the very first paint, before any stylesheet loads
    <div ref={root} data-loader="" aria-hidden className="boot" style={{ position: "fixed", inset: 0, zIndex: 100 }}>
      <div className="boot-grid">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} data-cell style={{ background: "#0B0D12" }} />
        ))}
      </div>
      <div className="boot-body" data-boot-body>
        <p className="boot-word">
          {"LAST LANDING".split("").map((l, i) => (
            <span key={i} className="boot-mask">
              <span data-boot-letter>{l === " " ? " " : l}</span>
            </span>
          ))}
        </p>
        <div className="boot-status">
          <span data-state>Loading island</span>
          <span className="boot-pct">
            <span data-pct>000</span>%
          </span>
        </div>
        <div className="boot-bar">
          <span data-boot-fill />
        </div>
      </div>
    </div>
  );
}
