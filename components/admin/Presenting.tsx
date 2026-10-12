"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { FitText, fs, useFit } from "@/components/ui/fit";
import { useTick } from "@/lib/hooks";
import { formatClock } from "@/lib/logic";
import { StageHeader } from "./StageHeader";
import { qLabel, type Ctx } from "./types";

export function Presenting({ ctx }: { ctx: Ctx }) {
  const { state, call, refresh, logout, serverNow } = ctx;
  const { game, questions, assignments } = state;
  const [busy, setBusy] = useState(false);
  useTick(250);

  const q = questions[game.qIndex];
  const speakers = assignments.filter((a) => a.questionId === q?.id).sort((a, b) => a.slot - b.slot);
  const rootRef = useFit<HTMLDivElement>(`${q?.id}|${speakers.map((s) => s.id + s.userName + s.teamName).join(",")}`);
  if (!q) return null;
  const total = game.speakSeconds * 1000;
  const elapsed = game.timerStartedAt === null ? 0 : Math.max(0, serverNow() - game.timerStartedAt);
  const left = Math.max(0, total - elapsed);
  const over = game.timerStartedAt !== null && left <= 0;
  const frac = Math.min(1, elapsed / total);
  const last = game.qIndex + 1 >= questions.length;
  const urgent = left <= 10_000 ? "bg-signal" : left <= 30_000 ? "bg-gold" : "bg-azure";
  const big = speakers.length <= 3;

  async function next() {
    if (busy) return;
    setBusy(true);
    await call("/api/admin/advance", { body: { action: "next", qIndex: game.qIndex } });
    await refresh();
    setBusy(false);
  }

  return (
    <div ref={rootRef} className="stage grid h-dvh grid-rows-[auto_minmax(14vh,1fr)_auto_auto] overflow-hidden" data-testid="presenting">
      <StageHeader progress={`${qLabel(game.qIndex + 1)} от ${questions.length}`} onLogout={logout} />

      <section className="flex min-h-0 flex-col px-[3vw]" data-testid="question-area">
        <p className="display pt-[1vh] text-[4vh] leading-none text-azure">Въпрос {qLabel(game.qIndex + 1)}</p>
        <FitText text={q.text} testId="presenting-question" />
      </section>

      <section className="flex flex-wrap items-stretch gap-[1.2vw] px-[3vw] pb-[3.5vh]" data-testid="speakers">
        {speakers.map((s) => (
          <div key={s.id} className="flex min-w-[16vw] flex-1 flex-col justify-center bg-gold px-[1.6vw] py-[1.2vh] text-ink [clip-path:polygon(28px_0,100%_0,calc(100%-28px)_100%,0_100%)]">
            <div className="flex items-baseline justify-between gap-[1.2vw] px-[1vw]">
              <span className="display [overflow-wrap:anywhere]" style={fs(big ? 6.4 : 4.2)}>{s.userName}</span>
              <span className="display tnum text-royal-deep" style={fs(big ? 7 : 4.6)}>{s.userCode}</span>
            </div>
            <p className="px-[1vw] font-semibold" style={fs(big ? 2.6 : 2)}>{s.teamName}</p>
          </div>
        ))}
      </section>

      <section className="px-[3vw] pb-[3.2vh]">
        <p
          className="display tnum text-center text-[min(22vh,16vw)] leading-[0.9]"
          role="timer"
          aria-label="Оставащо време"
          data-testid="timer"
        >
          {formatClock(left / 1000)}
        </p>
        <div className="mt-[1.6vh] h-[1.8vh] overflow-hidden rounded-full bg-white/15" aria-hidden>
          <div className={`h-full rounded-full transition-colors ${urgent}`} style={{ width: `${(1 - frac) * 100}%`, transition: "width 250ms linear" }} data-testid="progress" />
        </div>
      </section>

      <Modal open={over} className="sheet !w-[min(90vw,980px)] !bg-gold !p-[4vh_4vw] text-center" label="Времето изтече">
        <h2 className="display text-[min(13vh,9vw)]" data-testid="timeup">
          Времето изтече
        </h2>
        <p className="mt-[1.5vh] text-[3vh] font-medium">Въпрос {qLabel(game.qIndex + 1)} приключи.</p>
        <button className="btn btn-lg mt-[4vh]" onClick={next} disabled={busy} autoFocus data-testid="continue">
          {last ? "Завърши играта" : `Продължи към ${qLabel(game.qIndex + 2)}`}
        </button>
      </Modal>
    </div>
  );
}
