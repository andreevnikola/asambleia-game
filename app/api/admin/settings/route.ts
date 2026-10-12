export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { adminRoute } from "@/lib/auth";
import { saveSettings } from "@/lib/game";
import { json, readBody, toInt } from "@/lib/http";

const FIELDS = ["speakSeconds", "pauseSeconds", "revealSeconds", "scrollSeconds"] as const;

export const PUT = adminRoute(async (req) => {
  const b = await readBody(req);
  // Only the fields that were sent are changed; a sent-but-invalid field is an error (null).
  const input: Partial<Record<(typeof FIELDS)[number], number | null>> = {};
  for (const f of FIELDS) if (f in b) input[f] = toInt(b[f]);
  await saveSettings(input);
  return json({ ok: true });
});
