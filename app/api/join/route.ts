export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { joinPlayer } from "@/lib/game";
import { json, readBody, route } from "@/lib/http";

export const POST = route(async (req) => {
  const body = await readBody(req);
  return json(await joinPlayer(body.name));
});
