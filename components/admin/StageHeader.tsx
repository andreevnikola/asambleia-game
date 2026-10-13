"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { InteractLogo } from "@/components/ui/Logos";
import { SkipIcon } from "@/components/ui/SkipIcon";
import type { Ctx } from "./types";

/** Header for the projector screens: quiet, so the content is the show. */
export function StageHeader({ ctx, progress, middle }: { ctx: Ctx; progress?: string; middle?: React.ReactNode }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function stop() {
    if (busy) return;
    setBusy(true);
    setConfirm(false);
    await ctx.call("/api/admin/advance", { body: { action: "stop-presentation" } });
    await ctx.refresh();
    setBusy(false);
  }

  return (
    <header className="relative flex items-center justify-between px-[3vw] pt-[2.4vh]">
      <InteractLogo className="h-[5.5vh] w-auto" />
      {/* Optional centre slot (the "next up" strip): laid over the middle of the header, so it can never
          push the logo or the buttons; it truncates instead. */}
      {middle && (
        <div className="pointer-events-none absolute inset-x-0 top-[2.4vh] flex h-[5.5vh] items-center justify-center">
          <div className="flex max-w-[34vw] justify-center">{middle}</div>
        </div>
      )}
      <div className="flex items-center gap-[2vw]">
        {progress && <p className="display text-[3.2vh] text-white/80">{progress}</p>}
        <div className="flex items-center gap-[1.2vw]">
          <button
            className="rounded-lg border border-white/25 px-3 py-1 text-sm font-medium text-white/60 transition-colors hover:border-white/70 hover:text-white disabled:opacity-40"
            onClick={() => setConfirm(true)}
            disabled={busy}
            data-testid="stop-presentation"
          >
            Спри презентацията
          </button>
          <button className="text-sm text-white/35 hover:text-white/80" onClick={ctx.logout}>
            Изход
          </button>
        </div>
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} className="sheet" label="Спиране на презентацията">
        <h2 className="display text-[2.2rem]">Да спрем ли презентацията?</h2>
        <p className="mt-3 text-ink-soft">
          Връщаш се към управлението на играта. Избраните лидери се отменят и можеш да ги определиш наново.
          Участниците, отборите и въпросите остават.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button className="btn btn-danger w-full" onClick={stop} data-testid="confirm-stop">
            Спри презентацията
          </button>
          <button className="btn btn-ghost w-full" onClick={() => setConfirm(false)} autoFocus>
            Отказ
          </button>
        </div>
      </Modal>
    </header>
  );
}

/**
 * The wait between two questions. The ring drains over each second (not in steps), so it is
 * completely empty when the number would reach 0. With `onSkip`, hovering the number turns it
 * into a skip button.
 */
export function CountdownBadge({
  left,
  total,
  label,
  onSkip,
}: {
  left: number;
  total: number;
  label: string;
  onSkip?: () => void;
}) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const from = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const to = total > 0 ? Math.max(0, Math.min(1, (left - 1) / total)) : 0;
  const number = <span className="display tnum text-[5.4vh]">{left}</span>;
  return (
    <div
      className="flex items-center gap-[1.2vw] [animation:rise_380ms_ease-out_both]"
      role="timer"
      aria-label={`${label}: ${left}`}
      data-testid="countdown"
    >
      <p className="max-w-[22ch] text-right text-[2.4vh] font-medium leading-tight text-white/80">{label}</p>
      <div className="relative grid h-[11vh] w-[11vh] place-items-center">
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="7" />
          {/* Re-keyed every second: each tick drains one 1/total of the ring; the last one also fades,
              because a round cap on a zero-length arc would otherwise stay behind as a dot. */}
          <circle
            key={left}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="var(--color-gold)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - from)}
            style={
              {
                "--ring-from": c * (1 - from),
                "--ring-to": c * (1 - to),
                animation: `ring-drain 1s linear forwards${left <= 1 ? ", ring-vanish 1s linear forwards" : ""}`,
              } as React.CSSProperties
            }
          />
        </svg>
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            aria-label="Пропусни изчакването"
            className="group absolute inset-0 grid place-items-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:bg-white/10"
            data-testid="countdown-skip"
          >
            <span className="grid place-items-center transition duration-150 group-hover:scale-75 group-hover:opacity-0 group-focus-visible:scale-75 group-focus-visible:opacity-0">
              {number}
            </span>
            <SkipIcon className="absolute h-[4.6vh] w-[4.6vh] scale-75 text-gold opacity-0 transition duration-150 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100" />
          </button>
        ) : (
          number
        )}
      </div>
    </div>
  );
}
