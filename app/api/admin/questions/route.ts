export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { adminRoute } from "@/lib/auth";
import { addQuestion, deleteQuestion } from "@/lib/game";
import { ApiError, json, readBody, toInt } from "@/lib/http";
import { ERR } from "@/lib/copy";

export const POST = adminRoute(async (req) => {
  await addQuestion((await readBody(req)).text);
  return json({ ok: true });
});

export const DELETE = adminRoute(async (req) => {
  const id = toInt((await readBody(req)).id);
  if (id === null) throw new ApiError(400, ERR.badJson);
  await deleteQuestion(id);
  return json({ ok: true });
});
