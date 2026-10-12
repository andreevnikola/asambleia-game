export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { adminRoute } from "@/lib/auth";
import { startGame } from "@/lib/game";
import { json, readBody } from "@/lib/http";

export const POST = adminRoute(async (req) => {
  const b = await readBody(req);
  await startGame(b.simulate === true);
  return json({ ok: true });
});
