export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { isGameLive, parseCode, playerSnapshot, touchLeader } from "@/lib/game";
import { json, route, toInt } from "@/lib/http";

// Snapshot for the player page: first paint, the slow "has the draw happened?" check, and the leader's
// backup when the live feed is unavailable.
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const rawCode = url.searchParams.get("code");
  if (rawCode === null) return json({ live: await isGameLive() });
  const code = parseCode(rawCode);
  const snap = await playerSnapshot(code, toInt(url.searchParams.get("gid")));
  // A leader's poll also counts as "connected" for the admin screen.
  if (snap.live && snap.user && snap.phase.leader) await touchLeader(code);
  return json(snap);
});
