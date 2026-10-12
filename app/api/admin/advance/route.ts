export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { adminRoute } from "@/lib/auth";
import { advance } from "@/lib/game";
import { ApiError, json, readBody, toInt } from "@/lib/http";
import { ERR } from "@/lib/copy";
import type { AdvanceAction } from "@/lib/types";

const ACTIONS: AdvanceAction[] = ["next-pick", "start-presentation", "next", "new-game", "reset"];

export const POST = adminRoute(async (req) => {
  const b = await readBody(req);
  const action = ACTIONS.find((a) => a === b.action);
  if (!action) throw new ApiError(400, ERR.badJson);
  await advance(action, toInt(b.qIndex));
  return json({ ok: true });
});
