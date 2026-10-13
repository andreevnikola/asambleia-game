import { ERR } from "@/lib/copy";
import { isLeaderSnapshot, parseCode, playerSnapshot, playerVersion, touchLeader } from "@/lib/game";
import { ApiError, json, toInt } from "@/lib/http";
import type { PlayerSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Hobby with Fluid compute allows 300 s. The stream ends itself well before that (SSE_MAX_MS plus a
// random extra, so the leaders never reconnect in step) and EventSource reconnects instantly with a
// fresh snapshot, so nothing is ever missed. Without Fluid compute Hobby stops at 60 s: set
// SSE_MAX_MS=50000 in the project's environment variables in that case.
export const maxDuration = 300;

const HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events for LEADERS only: a full snapshot on connect and whenever anything it shows changes
 * (reveal, stage, question, timer). Everyone else gets 204 (EventSource then stops for good); their phone
 * just polls /api/me now and then. State-based, so a reconnect can never miss anything. Instances share
 * nothing: each stream checks one tiny version row in Postgres every SSE_POLL_MS.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  let code: number;
  try {
    code = parseCode(url.searchParams.get("code"));
  } catch (err) {
    return json({ error: err instanceof ApiError ? err.message : ERR.generic }, 400);
  }
  const gameId = toInt(url.searchParams.get("gid"));
  const pollMs = Number(process.env.SSE_POLL_MS) || 2000;
  const baseMs = Number(process.env.SSE_MAX_MS) || 240_000;
  const maxMs = baseMs + Math.random() * baseMs * 0.08;

  // Version first, snapshot second: a change in between is picked up by the next tick instead of being lost.
  let lastSig: string;
  let first: PlayerSnapshot;
  try {
    lastSig = await playerVersion(code, gameId);
    first = await playerSnapshot(code, gameId);
  } catch (err) {
    console.warn("[stream]", err);
    return json({ error: ERR.generic }, 503);
  }
  if (!isLeaderSnapshot(first)) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  await touchLeader(code);

  const enc = new TextEncoder();
  let closed = false;
  let wake: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const stop = () => {
        if (closed) return;
        closed = true;
        wake?.();
      };
      req.signal.addEventListener("abort", stop);

      send("retry: 500\n\n");
      send(`data: ${JSON.stringify(first)}\n\n`);
      const startedAt = Date.now();
      let lastSend = Date.now();

      while (!closed && Date.now() - startedAt < maxMs) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, pollMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        if (closed) break;
        try {
          const sig = await playerVersion(code, gameId);
          if (sig !== lastSig) {
            const snap = await playerSnapshot(code, gameId);
            send(`data: ${JSON.stringify(snap)}\n\n`);
            lastSig = sig;
            lastSend = Date.now();
            // No draw any more (unassigned, presentation stopped, game over): the phone closes its feed.
            if (!isLeaderSnapshot(snap)) break;
          }
          if (Date.now() - lastSend >= HEARTBEAT_MS) {
            send(": ping\n\n");
            lastSend = Date.now();
            await touchLeader(code);
          }
        } catch (err) {
          // A transient DB error must never kill the stream; try again on the next tick.
          console.warn("[stream]", err);
        }
      }
      stop();
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
    cancel() {
      closed = true;
      wake?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
