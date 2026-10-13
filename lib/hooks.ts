"use client";

import { useEffect, useState } from "react";

/** Re-renders every `ms` (0 = never); returns Date.now(). */
export function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ms <= 0) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

type WakeLockSentinelLike = { release: () => Promise<void> };

/**
 * Keeps the phone's screen on while `active` (so a waiting leader's popups can show up). Best effort:
 * unsupported browsers and refused requests are ignored, and the lock is requested again whenever the
 * tab becomes visible (the browser drops it when the page is hidden).
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } })
      .wakeLock;
    if (!wl) return;
    let lock: WakeLockSentinelLike | null = null;
    let disposed = false;
    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      try {
        const l = await wl.request("screen");
        if (disposed) {
          void l.release().catch(() => {});
        } else {
          const prev = lock;
          lock = l;
          void prev?.release().catch(() => {});
        }
      } catch {
        // refused (battery saver, no permission): the popups still work while the screen is on
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
