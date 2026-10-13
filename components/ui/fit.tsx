"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Text that always fits its box: the largest font size (between min and max) at which it does not overflow.
 * Re-measured when the text changes, the box is resized, or the fonts finish loading.
 */
export function FitText({
  text,
  className = "",
  testId,
  maxVh = 9,
  minPx = 16,
}: {
  text: string;
  className?: string;
  testId?: string;
  maxVh?: number;
  minPx?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const b = box.current;
    const t = el.current;
    if (!b || !t) return;
    const fit = () => {
      const max = Math.min(
        (window.innerHeight * maxVh) / 100,
        window.innerWidth * 0.07,
      );
      let lo = minPx;
      let hi = Math.max(max, minPx);
      const fits = (px: number) => {
        t.style.fontSize = `${px}px`;
        return (
          t.scrollHeight <= b.clientHeight + 1 &&
          t.scrollWidth <= b.clientWidth + 1
        );
      };
      if (fits(hi)) return;
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      t.style.fontSize = `${lo}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [text, maxVh, minPx]);

  return (
    <div ref={box} className="flex min-h-0 flex-1 items-center overflow-hidden">
      <h1
        ref={el}
        className={`display w-full [overflow-wrap:anywhere] ${className}`}
        data-testid={testId}
      >
        {text}
      </h1>
    </div>
  );
}

/**
 * Shrinks the CSS variable --k (1 → 0.4) on the returned element until its content no longer
 * overflows it. Sizes written as calc(var(--k) * Nvh) therefore adapt to however much content there is.
 */
export function useFit<T extends HTMLElement>(signature: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const run = () => {
      const ok = () =>
        root.scrollHeight <= root.clientHeight + 1 &&
        root.scrollWidth <= root.clientWidth + 1;
      root.style.setProperty("--k", "1");
      if (ok()) return;
      let lo = 0.35;
      let hi = 1;
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        root.style.setProperty("--k", String(mid));
        if (ok()) lo = mid;
        else hi = mid;
      }
      root.style.setProperty("--k", String(lo));
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(root);
    void document.fonts?.ready.then(run);
    return () => ro.disconnect();
  }, [signature]);
  return ref;
}

/** font-size that follows the fit factor. */
export const fs = (vh: number) => ({ fontSize: `calc(var(--k, 1) * ${vh}vh)` });
