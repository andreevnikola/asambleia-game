export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { adminRoute } from "@/lib/auth";
import { moveUser } from "@/lib/game";
import { ApiError, json, readBody, toInt } from "@/lib/http";
import { ERR } from "@/lib/copy";

export const POST = adminRoute(async (req) => {
  const b = await readBody(req);
  const userId = toInt(b.userId);
  const teamId = toInt(b.teamId);
  if (userId === null || teamId === null) throw new ApiError(400, ERR.badJson);
  await moveUser(userId, teamId);
  return json({ ok: true });
});
