import { ERR } from "./copy";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new ApiError(400, ERR.badJson);
}

export function toInt(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}

type Handler = (req: Request) => Promise<Response>;

/** Wraps a handler: ApiError -> JSON error with its status; anything else -> logged 500. Never leaks internals. */
export function route(handler: Handler): Handler {
  return async (req) => {
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof ApiError) return json({ error: err.message }, err.status);
      console.error("[api]", req.method, new URL(req.url).pathname, err);
      return json({ error: ERR.generic }, 500);
    }
  };
}
