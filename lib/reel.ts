// Pure maths of the leader picker (a drum of names). No I/O, no DOM: unit-testable.
import { seededRng, shuffle } from "./logic";

export const REEL_NAMES = 7;

/** Names on one drum: the chosen one plus decoys from the registered players, in a stable random order. */
export function reelNames(
  chosen: string,
  pool: string[],
  seed: number,
  count = REEL_NAMES,
): { names: string[]; land: number } {
  const rng = seededRng(seed);
  const others = shuffle([...new Set(pool)].filter((n) => n !== chosen), rng);
  const decoys: string[] = [];
  // With fewer than count-1 other names, some repeat so the drum still has `count` stops.
  for (let i = 0; i < count - 1; i++) decoys.push(others.length ? others[i % others.length] : chosen);
  const land = Math.floor(rng() * count);
  decoys.splice(land, 0, chosen);
  return { names: decoys, land };
}

const CRUISE = 11; // items per second, at least, before the slow-down starts
const SLOW_MIN_S = 0.8;
const SLOW_MAX_S = 2.8;
const SLOW_SHARE = 0.62; // of the whole spin, when the spin is short
// Cubic ease-out: the speed at the start of the slow-down is 3 × (distance left) / (time left).
const EASE = 3;

export type ReelTrack = {
  /** Where the drum is `ms` after the start (in items; item i is centred at i, i + count, ...). */
  at(ms: number): { pos: number; speed: number };
  /** Final position: congruent to `land` modulo `count`. */
  final: number;
};

/**
 * One spin: runs at a steady speed, then slows down (cubic ease-out, speed continuous at the hand-over)
 * and comes to rest exactly on the item `land` at `stopMs`. The steady speed is picked so the distance
 * works out to a whole number of items past `land`; it never drops below CRUISE.
 */
export function reelTrack(count: number, land: number, startPos: number, stopMs: number): ReelTrack {
  const stopS = Math.max(stopMs, 0) / 1000;
  const slowS = Math.min(stopS, Math.min(SLOW_MAX_S, Math.max(SLOW_MIN_S, stopS * SLOW_SHARE)));
  const cruiseS = stopS - slowS;
  const eff = cruiseS + slowS / EASE; // seconds the spin would take at steady speed
  const minEnd = startPos + CRUISE * eff;
  const final = Math.ceil((minEnd - land) / count) * count + land;
  const v = eff > 0 ? (final - startPos) / eff : 0;
  const posD = startPos + v * cruiseS;
  return {
    final,
    at(ms) {
      const t = ms / 1000;
      if (t >= stopS) return { pos: final, speed: 0 };
      if (t <= cruiseS) return { pos: startPos + v * t, speed: v };
      const s = (t - cruiseS) / slowS;
      return { pos: posD + (final - posD) * (1 - (1 - s) ** EASE), speed: v * (1 - s) ** (EASE - 1) };
    },
  };
}
