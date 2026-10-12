export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { adminRoute } from "@/lib/auth";
import { revealAssignment } from "@/lib/game";
import { ApiError, json, readBody, toInt } from "@/lib/http";
import { ERR } from "@/lib/copy";

export const POST = adminRoute(async (req) => {
  const id = toInt((await readBody(req)).assignmentId);
  if (id === null) throw new ApiError(400, ERR.badJson);
  await revealAssignment(id);
  return json({ ok: true });
});
