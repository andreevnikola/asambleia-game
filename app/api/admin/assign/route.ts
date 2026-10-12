export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { adminRoute } from "@/lib/auth";
import { assignAllLeaders } from "@/lib/game";
import { json } from "@/lib/http";

export const POST = adminRoute(async () => {
  await assignAllLeaders();
  return json({ ok: true });
});
