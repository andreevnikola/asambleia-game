export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { adminRoute } from "@/lib/auth";
import { json } from "@/lib/http";

export const POST = adminRoute(async () => json({ ok: true }));
