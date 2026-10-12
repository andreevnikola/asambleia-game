export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { isGameLive, parseCode, playerSnapshot } from "@/lib/game";
import { json, route, toInt } from "@/lib/http";

// Snapshot for the player page: first paint, and a fallback when the SSE stream is unavailable.
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const rawCode = url.searchParams.get("code");
  if (rawCode === null) return json({ live: await isGameLive() });
  const code = parseCode(rawCode);
  return json(await playerSnapshot(code, toInt(url.searchParams.get("gid"))));
});
