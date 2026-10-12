"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminHeaders, api, storageGet, storageSet } from "@/lib/client";
import type { AdminState } from "@/lib/types";
import { Login } from "./Login";
import { Live } from "./Live";
import { Picking } from "./Picking";
import { Prep } from "./Prep";
import { Presenting } from "./Presenting";
import { Results } from "./Results";
import { Thanks } from "./Thanks";
import type { Call, Ctx } from "./types";

const KEY = "asm.admin";
const POLL_MS = 1500;

export function AdminApp() {
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const keyRef = useRef<string | null>(null);
  const [state, setState] = useState<AdminState | null>(null);
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const seqRef = useRef({ issued: 0, applied: 0 });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const k = storageGet(KEY);
    keyRef.current = k;
    setKey(k);
  }, []);

  const logout = useCallback(() => {
    storageSet(KEY, null);
    keyRef.current = null;
    setState(null);
    setKey(null);
  }, []);

  const login = useCallback((k: string) => {
    storageSet(KEY, k);
    keyRef.current = k;
    setKey(k);
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const refresh = useCallback(async () => {
    if (!keyRef.current) return;
    const mine = ++seqRef.current.issued;
    const res = await api<AdminState>("/api/admin/state", { headers: adminHeaders(keyRef.current) });
    if (res.ok) {
      setOffline(false);
      // Only the newest response wins, so a slow poll can never overwrite a fresher snapshot.
      if (mine > seqRef.current.applied) {
        seqRef.current.applied = mine;
        offsetRef.current = res.data.serverNow - Date.now();
        setState(res.data);
      }
    } else if (res.status === 401) {
      logout();
    } else {
      setOffline(true);
    }
  }, [logout]);

  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, refresh]);

  const call: Call = useCallback(
    async (path, opts = {}) => {
      const res = await api(path, {
        method: opts.method ?? "POST",
        body: opts.body ?? {},
        headers: adminHeaders(keyRef.current ?? ""),
      });
      if (!res.ok) {
        if (res.status === 401) logout();
        else {
          if (!opts.silent) showToast(res.error);
          if (res.status === 409) void refresh(); // state moved under us: show the truth
        }
      }
      return res;
    },
    [logout, refresh, showToast],
  );

  if (key === undefined) return null;
  if (!key) return <Login onLogin={login} />;

  const ctx: Ctx | null = state
    ? { state, call, refresh, logout, serverNow: () => Date.now() + offsetRef.current }
    : null;

  return (
    <>
      {ctx ? <Screen ctx={ctx} /> : <div className="grid min-h-dvh place-items-center text-ink-soft">Зареждане…</div>}
      {offline && (
        <div role="status" className="fixed left-1/2 top-3 z-[60] -translate-x-1/2 rounded-full bg-signal px-5 py-2 font-semibold text-white">
          Няма връзка със сървъра — опитваме отново…
        </div>
      )}
      {toast && (
        <div
          role="alert"
          data-testid="toast"
          className="fixed bottom-6 left-1/2 z-[60] max-w-[60ch] -translate-x-1/2 rounded-xl bg-ink px-5 py-3 font-medium text-white shadow-lg [animation:pop_180ms_ease-out]"
        >
          {toast}
        </div>
      )}
    </>
  );
}

function Screen({ ctx }: { ctx: Ctx }) {
  const { status, stage } = ctx.state.game;
  if (status === "prep") return <Prep ctx={ctx} />;
  if (status === "finished") return <Thanks ctx={ctx} />;
  if (stage === "picking") return <Picking ctx={ctx} />;
  if (stage === "results") return <Results ctx={ctx} />;
  if (stage === "presenting") return <Presenting ctx={ctx} />;
  return <Live ctx={ctx} />;
}
