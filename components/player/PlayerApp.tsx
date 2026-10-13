"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, jitter, storageGet, storageSet } from "@/lib/client";
import type { JoinResult, PlayerSnapshot } from "@/lib/types";
import { Home } from "./Home";
import { JoinScreen } from "./JoinScreen";
import { NoGame } from "./NoGame";

type Session = { code: number; gameId: number };
type Joined = Extract<PlayerSnapshot, { live: true; user: { code: number } }>;

const SESSION_KEY = "asm.player";

// How a signed-in phone stays in sync. Only leaders hold a live connection; everybody else asks
// now and then. Every phone waits its own random time, so 100 phones never ask in step.
const POLL_WAIT_MS: [number, number] = [20_000, 60_000]; // no draw yet: "has it happened?"
const POLL_IDLE_MS: [number, number] = [60_000, 150_000]; // draw done, not a leader: reset / end / team change
const POLL_LEADER_MS: [number, number] = [12_000, 18_000]; // leader: backup next to the live feed
const OFFLINE_AFTER_MS = 4000;

type Mode = "wait" | "idle" | "leader";
const RANGE: Record<Mode, [number, number]> = { wait: POLL_WAIT_MS, idle: POLL_IDLE_MS, leader: POLL_LEADER_MS };

function readSession(): Session | null {
  try {
    const raw = storageGet(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return Number.isInteger(s?.code) && Number.isInteger(s?.gameId) ? { code: s.code, gameId: s.gameId } : null;
  } catch {
    return null;
  }
}

type View = { kind: "loading" } | { kind: "nogame"; ended: boolean } | { kind: "join" } | { kind: "home"; snap: Joined };

/** The server clock changes with every read: it must not count as "something changed". */
const snapKey = (s: PlayerSnapshot) => JSON.stringify(s, (k, v) => (k === "serverNow" ? 0 : v));

export function PlayerApp() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [online, setOnline] = useState(true);
  const sessionRef = useRef<Session | null>(null);
  const [session, setSessionState] = useState<Session | null>(null);
  const offsetRef = useRef(0); // server clock minus this phone's clock, ms
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

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
        if (snap.feed) offsetRef.current = snap.feed.serverNow - Date.now();
        setView((prev) => {
          // Avoid re-rendering when nothing changed (every poll re-fetches the same state).
          if (prev.kind === "home" && snapKey(prev.snap) === snapKey(snap)) return prev;
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

  // Waiting for a game to start: quick at first, slower the longer nothing happens, and quiet while the
  // screen is off or the game is over. Each phone has its own random rhythm.
  const waiting = view.kind === "nogame";
  const ended = view.kind === "nogame" && view.ended;
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const age = Date.now() - started;
      const [lo, hi] = ended ? [30_000, 60_000] : age < 120_000 ? [4_000, 7_000] : [15_000, 30_000];
      timer = setTimeout(tick, jitter(lo, hi));
    };
    const tick = async () => {
      if (document.visibilityState === "visible") {
        const res = await api<{ live: boolean }>("/api/me");
        if (stopped) return;
        if (res.ok && res.data.live) {
          setView({ kind: "join" });
          return;
        }
      }
      schedule();
    };
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [waiting, ended]);

  // Signed in: leaders hold the live feed (SSE) plus a backup poll; everybody else only polls, rarely.
  const code = session?.code;
  const gameId = session?.gameId;
  const phase = view.kind === "home" ? view.snap.phase : null;
  const mode: Mode | null = phase ? (phase.leader ? "leader" : phase.assigned ? "idle" : "wait") : null;
  useEffect(() => {
    if (code === undefined || gameId === undefined || mode === null) return;
    let es: EventSource | null = null;
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let disposed = false;

    const markOffline = () => {
      if (!offlineTimer) offlineTimer = setTimeout(() => setOnline(false), OFFLINE_AFTER_MS);
    };
    const markOnline = () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      offlineTimer = null;
      setOnline(true);
    };
    const visible = () => document.visibilityState === "visible";

    const closeFeed = () => {
      es?.close();
      es = null;
      if (reopenTimer) clearTimeout(reopenTimer);
      reopenTimer = null;
    };
    const openFeed = () => {
      if (disposed || mode !== "leader" || !visible()) return;
      closeFeed();
      es = new EventSource(`/api/stream?code=${code}&gid=${gameId}`);
      es.onopen = markOnline;
      es.onmessage = (e) => {
        failures = 0;
        markOnline();
        try {
          applySnapshot(JSON.parse(e.data));
        } catch {
          // ignore a malformed frame; the next snapshot fixes it
        }
      };
      es.onerror = () => {
        markOffline();
        // CONNECTING: the browser retries by itself. CLOSED (refused, e.g. no longer a leader): back off.
        if (es && es.readyState === EventSource.CLOSED) {
          closeFeed();
          reopenTimer = setTimeout(openFeed, Math.min(1500 * 2 ** failures++, 20_000));
        }
      };
    };

    const poll = async () => {
      if (!visible()) return;
      const res = await api<PlayerSnapshot>(`/api/me?code=${code}&gid=${gameId}`);
      if (disposed) return;
      if (res.ok) {
        markOnline();
        applySnapshot(res.data);
      } else {
        markOffline();
      }
    };
    const schedule = () => {
      pollTimer = setTimeout(async () => {
        await poll();
        if (!disposed) schedule();
      }, jitter(...RANGE[mode]));
    };
    const pollNow = async () => {
      if (pollTimer) clearTimeout(pollTimer);
      await poll();
      if (!disposed) schedule();
    };

    // Phones sleep: when the tab wakes or the network returns, reconnect and refresh right away.
    const onVisibility = () => {
      if (visible()) {
        openFeed();
        void pollNow();
      } else {
        closeFeed(); // nothing can be shown while the screen is off; the wake-up fetches the truth
      }
    };
    const onOnline = () => {
      openFeed();
      void pollNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", markOffline);

    openFeed();
    schedule();

    return () => {
      disposed = true;
      closeFeed();
      if (offlineTimer) clearTimeout(offlineTimer);
      if (pollTimer) clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, [code, gameId, mode, applySnapshot]);

  const enter = useCallback(
    async (path: "/api/join" | "/api/login", body: Record<string, unknown>): Promise<string | null> => {
      const res = await api<JoinResult | Session>(path, { body });
      if (!res.ok) {
        if (res.status === 409) setView({ kind: "nogame", ended: false });
        return res.error;
      }
      const { code: c, gameId: g } = res.data;
      setSession({ code: c, gameId: g });
      if ("snapshot" in res.data) {
        // A sign-up already carries the whole home screen: no second request.
        applySnapshot(res.data.snapshot);
      } else {
        const snap = await api<PlayerSnapshot>(`/api/me?code=${c}&gid=${g}`);
        if (snap.ok) applySnapshot(snap.data);
      }
      return null;
    },
    [applySnapshot, setSession],
  );

  const signOut = useCallback(() => {
    setSession(null);
    storageSet("asm.ack", null);
    storageSet("asm.cue", null);
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
      {view.kind === "home" && <Home snap={view.snap} onSignOut={signOut} serverNow={serverNow} />}
    </>
  );
}
