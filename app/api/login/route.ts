export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { loginPlayer } from "@/lib/game";
import { json, readBody, route } from "@/lib/http";

export const POST = route(async (req) => {
  const body = await readBody(req);
  return json(await loginPlayer(body.code));
});
