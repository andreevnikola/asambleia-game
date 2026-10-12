import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// HTTP driver: every query is a stateless fetch, so serverless instances never exhaust connections.
let client: NeonQueryFunction<false, false> | null = null;

export function sql(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL_POOLED / DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}

export type Row = Record<string, unknown>;

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/** Retry for idempotent reads only: network hiccups must not break a stream or a page load. */
export async function retryRead<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if ((err as { code?: string }).code) throw err; // real SQL error: don't retry
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
  }
  throw last;
}
