// Browser-only helpers.
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Random delay in [minMs, maxMs): phones that did the same thing at the same moment must not stay in step. */
export const jitter = (minMs: number, maxMs: number) => minMs + Math.random() * (maxMs - minMs);

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode / blocked storage: the app still works for this tab
  }
}

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: data?.error ?? "Нещо се обърка. Опитай отново." };
    return { ok: true, status: res.status, data: data as T };
  } catch {
    return { ok: false, status: 0, error: "Няма връзка със сървъра. Опитай отново." };
  }
}

/** Header value for the admin key (URI-encoded so any characters the admin types are legal in HTTP). */
export const adminHeaders = (key: string) => ({ "x-admin-key": encodeURIComponent(key) });
