import type { ApiResult } from "@/lib/client";
import type { AdminState } from "@/lib/types";

export type Call = (
  path: string,
  opts?: { method?: "POST" | "DELETE" | "PUT"; body?: unknown; silent?: boolean },
) => Promise<ApiResult<unknown>>;

export type Ctx = {
  state: AdminState;
  call: Call;
  refresh: () => Promise<void>;
  /** Server-time estimate in ms (immune to a skewed laptop clock). */
  serverNow: () => number;
  logout: () => void;
};

export const qLabel = (n: number) => `В${n}`;
