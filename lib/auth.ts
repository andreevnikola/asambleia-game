import { createHash, timingSafeEqual } from "node:crypto";
import { ERR } from "./copy";
import { ApiError, route } from "./http";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function assertAdmin(req: Request): void {
  const expected = process.env.ADMIN_SECRET;
  let given = req.headers.get("x-admin-key") ?? "";
  try {
    // The browser URI-encodes the key: header values must be Latin-1, but a mistyped key may be Cyrillic.
    given = decodeURIComponent(given);
  } catch {
    // not valid encoding: compare as-is (it will simply not match)
  }
  // No secret configured => nobody gets in (never fail open).
  if (!expected || !timingSafeEqual(digest(given), digest(expected))) {
    throw new ApiError(401, ERR.unauthorized);
  }
}

export function adminRoute(handler: (req: Request) => Promise<Response>) {
  return route(async (req) => {
    assertAdmin(req);
    return handler(req);
  });
}
