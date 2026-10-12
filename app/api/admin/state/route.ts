export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { adminRoute } from "@/lib/auth";
import { adminState } from "@/lib/game";
import { json } from "@/lib/http";

export const GET = adminRoute(async () => json(await adminState()));
