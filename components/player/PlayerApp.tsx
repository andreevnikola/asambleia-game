"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, storageGet, storageSet } from "@/lib/client";
import type { PlayerSnapshot } from "@/lib/types";
import { Home } from "./Home";
import { JoinScreen } from "./JoinScreen";
import { NoGame } from "./NoGame";

type Session = { code: number; gameId: number };
type Joined = Extract<PlayerSnapshot, { live: true; user: { code: number } }>;

const SESSION_KEY = "asm.player";
const POLL_WAITING_MS = 5000;
const POLL_BACKUP_MS = 12000;
const OFFLINE_AFTER_MS = 4000;

function readSession(): Session | null {
  try {
    const raw = storageGet(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return Number.isInteger(s?.code) && Number.isInteger(s?.gameId) ? s : null;
  } catch {
    return null;
  }
}

type View = { kind: "loading" } | { kind: "nogame"; ended: boolean } | { kind: "join" } | { kind: "home"; snap: Joined };

export function PlayerApp() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [online, setOnline] = useState(true);
  const sessionRef = useRef<Session | null>(null);
  const [session, setSessionState] = useState<Session | null>(null);

  const setSession = useCallback((s: Session | null) => {
    sessionRef.current = s;
    setSessionState(s);
    storageSet(SESSION_KEY, s ? JSON.stringify(s) : null);
  }, []);

  /** Single place that turns a server snapshot into a screen. */
  const applySnapshot = useCallback(
    (snap: PlayerSnapshot) => {
      const had = sessionRef.current !== null;
      if (!snap.live) {
        setSession(null);
        setView({ kind: "nogame", ended: had });
      } else if (snap.user === null) {
        setSession(null);
        setView({ kind: "join" });
      } else {
        setView((prev) => {
          // Avoid re-rendering when nothing changed (the backup poll re-fetches the same state).
          if (prev.kind === "home" && JSON.stringify(prev.snap) === JSON.stringify(snap)) return prev;
          return { kind: "home", snap: snap as Joined };
        });
      }
    },
    [setSession],
  );

  // First paint.
  useEffect(() => {
    const stored = readSession();
    sessionRef.current = stored;
    setSessionState(stored);
    let cancelled = false;
    (async () => {
      const url = stored ? `/api/me?code=${stored.code}&gid=${stored.gameId}` : "/api/me";
      for (let attempt = 0; !cancelled; attempt++) {
        const res = await api<PlayerSnapshot>(url);
        if (cancelled) return;
        if (res.ok) {
          if (stored) applySnapshot(res.data);
          else setView(res.data.live ? { kind: "join" } : { kind: "nogame", ended: false });
          return;
        }
        // Server/network hiccup: keep the loading state and retry; never strand the user on an error.
        await new Promise((r) => setTimeout(r, Math.min(1000 * (attempt + 1), 5000)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySnapshot]);

  // Waiting for a game to start.
  const waiting = view.kind === "nogame";
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(async () => {
      const res = await api<{ live: boolean }>("/api/me");
      if (res.ok && res.data.live) setView({ kind: "join" });
    }, POLL_WAITING_MS);
    return () => clearInterval(id);
  }, [waiting]);

  // Live updates: SSE primary, slow poll as a backup (corporate proxies sometimes buffer SSE).
  const code = session?.code;
  const gameId = session?.gameId;
  useEffect(() => {
    if (code === undefined || gameId === undefined) return;
    let es: EventSource | null = null;
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const markOffline = () => {
      if (!offlineTimer) offlineTimer = setTimeout(() => setOnline(false), OFFLINE_AFTER_MS);
    };
    const markOnline = () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      offlineTimer = null;
      setOnline(true);
    };
    const open = () => {
      if (disposed) return;
      es?.close();
      es = new EventSource(`/api/stream?code=${code}&gid=${gameId}`);
      es.onopen = markOnline;
      es.onmessage = (e) => {
        markOnline();
        try {
          applySnapshot(JSON.parse(e.data));
        } catch {
          // ignore a malformed frame; the next snapshot fixes it
        }
      };
      es.onerror = () => {
        markOffline();
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          reopenTimer = setTimeout(open, 1500);
        }
      };
    };
    open();

    const poll = async () => {
      const res = await api<PlayerSnapshot>(`/api/me?code=${code}&gid=${gameId}`);
      if (res.ok && !disposed) applySnapshot(res.data);
    };
    const pollId = setInterval(poll, POLL_BACKUP_MS);

    // Phones sleep: when the tab wakes or the network returns, reconnect and refresh right away.
    const wake = () => {
      if (document.visibilityState === "visible") {
        open();
        poll();
      }
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    return () => {
      disposed = true;
      es?.close();
      if (offlineTimer) clearTimeout(offlineTimer);
      if (reopenTimer) clearTimeout(reopenTimer);
      clearInterval(pollId);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [code, gameId, applySnapshot]);

  const enter = useCallback(
    async (path: "/api/join" | "/api/login", body: Record<string, unknown>): Promise<string | null> => {
      const res = await api<Session>(path, { body });
      if (!res.ok) {
        if (res.status === 409) setView({ kind: "nogame", ended: false });
        return res.error;
      }
      setSession(res.data);
      const snap = await api<PlayerSnapshot>(`/api/me?code=${res.data.code}&gid=${res.data.gameId}`);
      if (snap.ok) applySnapshot(snap.data);
      return null;
    },
    [applySnapshot, setSession],
  );

  const signOut = useCallback(() => {
    setSession(null);
    storageSet("asm.ack", null);
    setView({ kind: "join" });
  }, [setSession]);

  return (
    <>
      {!online && view.kind === "home" && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-50 bg-ink px-4 py-2 text-center text-sm font-medium text-white"
        >
          Връзката се възстановява…
        </div>
      )}
      {view.kind === "loading" && <div className="grid min-h-dvh place-items-center text-ink-soft">Зареждане…</div>}
      {view.kind === "nogame" && <NoGame ended={view.ended} />}
      {view.kind === "join" && (
        <JoinScreen
          onJoin={(name) => enter("/api/join", { name })}
          onLogin={(code) => enter("/api/login", { code })}
        />
      )}
      {view.kind === "home" && <Home snap={view.snap} onSignOut={signOut} />}
    </>
  );
}
