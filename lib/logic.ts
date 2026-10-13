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

// ───────────────────────── leader cues (phone + projector share these) ─────────────────────────

/** The previous speakers' last minute: leaders of the next question are called to the stage. */
export const WARN_MS = 60_000;

export type Cue = "wait" | "warn" | "now" | "done";

export type CueInput = {
  stage: string;
  /** 0-based index of the question being presented. */
  qIndex: number;
  /** 1-based number of the question this leader presents. */
  myN: number;
  timerStartedAt: number | null;
  speakSeconds: number;
  /** Server-clock ms. */
  now: number;
};

/** Milliseconds left on the running question's timer (0 when over, full length before it started). */
export function timerLeftMs(timerStartedAt: number | null, speakSeconds: number, now: number): number {
  const total = speakSeconds * 1000;
  const elapsed = timerStartedAt === null ? 0 : Math.max(0, now - timerStartedAt);
  return Math.max(0, total - elapsed);
}

/**
 * Derived from state, never from a one-shot event: it is right after a reconnect, a phone wake-up,
 * a late connection and an admin skip. With a speaking time of 60 s or less the warning starts with
 * the previous question.
 */
export function leaderCue(i: CueInput): Cue {
  if (i.stage !== "presenting") return "wait";
  const cur = i.qIndex + 1;
  if (i.myN < cur) return "done";
  const left = timerLeftMs(i.timerStartedAt, i.speakSeconds, i.now);
  if (i.myN === cur) return left > 0 ? "now" : "done";
  if (i.myN === cur + 1) return left <= WARN_MS ? "warn" : "wait";
  return "wait";
}

/** Rough time until this leader's turn starts (null before the presentation or once it is their turn). */
export function leaderEtaMs(i: CueInput): number | null {
  if (i.stage !== "presenting") return null;
  const cur = i.qIndex + 1;
  if (i.myN <= cur) return null;
  const left = timerLeftMs(i.timerStartedAt, i.speakSeconds, i.now);
  return left + (i.myN - cur - 1) * i.speakSeconds * 1000;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function cleanName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}
