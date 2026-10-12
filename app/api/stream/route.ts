import { ERR } from "@/lib/copy";
import { parseCode, playerSnapshot, playerVersion } from "@/lib/game";
import { ApiError, json, toInt } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Works on every Vercel plan (Hobby without Fluid compute allows at most 60 s). The stream ends itself
// at SSE_MAX_MS and EventSource reconnects instantly with a fresh snapshot, so nothing is ever missed.
export const maxDuration = 60;

const HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events: pushes a full snapshot of the player's state on connect and whenever it changes.
 * State-based (not event-based), so a reconnect can never miss anything. Instances share nothing:
 * each stream checks one tiny version row in Postgres every SSE_POLL_MS. The stream closes itself
 * before the platform limit; EventSource reconnects immediately and receives a fresh snapshot.
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
  const maxMs = Number(process.env.SSE_MAX_MS) || 50_000;

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
      const startedAt = Date.now();
      let lastSig = "";
      let lastSend = Date.now();

      while (!closed && Date.now() - startedAt < maxMs) {
        try {
          const sig = await playerVersion(code, gameId);
          if (sig !== lastSig) {
            send(`data: ${JSON.stringify(await playerSnapshot(code, gameId))}\n\n`);
            lastSig = sig;
            lastSend = Date.now();
          } else if (Date.now() - lastSend >= HEARTBEAT_MS) {
            send(": ping\n\n");
            lastSend = Date.now();
          }
        } catch (err) {
          // A transient DB error must never kill the stream; try again on the next tick.
          console.warn("[stream]", err);
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, pollMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
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
