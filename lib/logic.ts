// Pure game logic — no I/O, fully unit-testable.

export type Rng = () => number;

export type DrawTeam = { id: number; members: { id: number }[] };
export type DrawResult = { questionId: number; teamId: number; userId: number; slot: number };

/** Round-robin: seq is 1-based (1st player -> team 0). */
export function teamIndexForSeq(seq: number, teamCount: number): number {
  if (teamCount <= 0) throw new Error("No teams");
  return (((seq - 1) % teamCount) + teamCount) % teamCount;
}

/**
 * Cycle through the questions (Q1, Q2, ..., Qn, Q1, ...). At every step take a random
 * not-yet-assigned team (that has members), drop it from the pool and make a random
 * member of it the leader for that question. Stops when the pool is empty.
 * `slot` is the order of the draw within its question.
 */
export function assignLeaders(teams: DrawTeam[], questionIds: number[], rng: Rng = Math.random): DrawResult[] {
  if (questionIds.length === 0) throw new Error("No questions");
  const pool = teams.filter((t) => t.members.length > 0);
  const slots = new Map<number, number>();
  const out: DrawResult[] = [];
  let step = 0;
  while (pool.length > 0) {
    const questionId = questionIds[step % questionIds.length];
    const team = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const member = team.members[Math.floor(rng() * team.members.length)];
    const slot = slots.get(questionId) ?? 0;
    slots.set(questionId, slot + 1);
    out.push({ questionId, teamId: team.id, userId: member.id, slot });
    step++;
  }
  return out;
}

/** Deterministic rng so every reel gets a stable (but different) order. */
export function seededRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Fisher–Yates; returns a new array. */
export function shuffle<T>(items: T[], rng: Rng = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function cleanName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}
