"use client";

import { useEffect, useRef } from "react";
import { reelTrack } from "@/lib/reel";

/** When one drum starts and where it must come to rest (performance.now() clock). */
export type ReelPlan = { t0: number; stopAt: number };

const COPIES = 3; // the list is tripled so it can wrap without a visible seam
const ROWS = 5; // names in view; the middle one is the pick

const shift = (pos: number, n: number) => {
  const centre = n + (((pos % n) + n) % n); // always in the middle copy
  return `translate3d(0, ${((Math.floor(ROWS / 2) - centre) / (COPIES * n)) * 100}%, 0)`;
};

/**
 * A drum of names. Two copies of the same list move together: a dim one for the names around the
 * pick and a bright, larger one that a mask only lets through in the middle row, so every name
 * lights up as it reaches the middle. The drum spins, slows down and stops with the chosen name
 * in the middle (see lib/reel.ts); it is purely a function of time, so a slow frame can never
 * leave it in the wrong place.
 */
export function Reel({
  names,
  land,
  startPos,
  plan,
}: {
  names: string[];
  land: number;
  startPos: number;
  plan: ReelPlan | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLUListElement>(null);
  const lit = useRef<HTMLUListElement>(null);
  const n = names.length;

  useEffect(() => {
    const r = root.current;
    const a = dim.current;
    const b = lit.current;
    if (!r || !a || !b || !plan) return;
    const draw = (pos: number, speed: number) => {
      const t = shift(pos, n);
      a.style.transform = t;
      b.style.transform = t;
      const level = speed > 9 ? "3" : speed > 5 ? "2" : speed > 2 ? "1" : "0";
      if (r.dataset.speed !== level) r.dataset.speed = level;
    };
    const track = reelTrack(n, land, startPos, plan.stopAt);
    const settle = () => {
      draw(track.final, 0);
      r.dataset.landed = "true";
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      settle();
      return;
    }
    let raf = 0;
    const frame = () => {
      const ms = performance.now() - plan.t0;
      if (ms >= plan.stopAt) return settle();
      const { pos, speed } = track.at(ms);
      draw(pos, speed);
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [plan, n, land, startPos]);

  const rows = Array.from({ length: COPIES * n }, (_, i) => names[i % n]);
  const list = (ref: React.RefObject<HTMLUListElement | null>) => (
    <ul
      ref={ref}
      className="reel-list display"
      style={{ height: `${COPIES * n * (100 / ROWS)}%`, transform: shift(startPos, n) }}
    >
      {rows.map((name, i) => (
        <li key={i} style={{ height: `${100 / (COPIES * n)}%`, "--len": Math.max(name.length, 1) } as React.CSSProperties}>
          <span>{name}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div ref={root} className="reel" data-speed="0" data-landed="false" aria-hidden>
      <div className="reel-band" />
      <div className="reel-layer reel-dim">{list(dim)}</div>
      <div className="reel-layer reel-lit">{list(lit)}</div>
    </div>
  );
}
