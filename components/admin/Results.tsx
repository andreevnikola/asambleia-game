"use client";

import { useState } from "react";
import { fs, useFit } from "@/components/ui/fit";
import { StageHeader } from "./StageHeader";
import { qLabel, type Ctx } from "./types";

export function Results({ ctx }: { ctx: Ctx }) {
  const { state, call, refresh } = ctx;
  const { questions, assignments } = state;
  const [busy, setBusy] = useState(false);
  const rootRef = useFit<HTMLElement>(
    assignments.map((a) => a.id + a.userName + a.teamName).join(",") +
      questions.map((q) => q.text).join("|"),
  );
  const n = questions.length;
  const cols = n <= 2 ? n : n <= 6 ? 3 : n <= 8 ? 4 : 5;
  // Fewer questions => bigger type, so the room can read it; many => smaller so it still fits one screen.
  const k = n <= 3 ? 1.6 : n <= 6 ? 1.2 : n <= 8 ? 0.95 : 0.8;
  const size = (vh: number) => fs(vh * k);

  async function start() {
    if (busy) return;
    setBusy(true);
    await call("/api/admin/advance", {
      body: { action: "start-presentation" },
    });
    await refresh();
    setBusy(false);
  }

  return (
    <div
      className="stage grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
      data-testid="results"
    >
      <StageHeader ctx={ctx} />

      <main
        ref={rootRef}
        className="min-h-0 overflow-hidden px-[3vw] pb-[1vh] pt-[2vh]"
        data-testid="results-body"
      >
        <h1 className="display mb-[2vh]" style={fs(7 * Math.min(k, 1.2))}>
          Лидерите на отборите
        </h1>
        <div
          className="grid gap-[1.4vw]"
          style={{
            gridTemplateColumns: `repeat(${Math.max(cols, 1)}, minmax(0, 1fr))`,
          }}
        >
          {questions.map((q, i) => {
            const speakers = assignments
              .filter((a) => a.questionId === q.id)
              .sort((a, b) => a.slot - b.slot);
            return (
              <section
                key={q.id}
                className="min-w-0 border-t-[5px] border-azure bg-ink-2 px-[1.4vw] py-[1.6vh]"
                data-testid={`result-${i + 1}`}
              >
                <p className="display text-azure" style={size(3.4)}>
                  {qLabel(i + 1)}
                </p>
                <p
                  className="mt-[0.6vh] font-semibold leading-snug [overflow-wrap:anywhere]"
                  style={size(q.text.length > 140 ? 2.1 : 2.6)}
                >
                  {q.text}
                </p>
                <ul className="m-0 mt-[1.6vh] flex list-none flex-col gap-[1vh] p-0">
                  {speakers.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-baseline justify-between gap-3 bg-gold px-[1vw] py-[0.9vh] text-ink"
                    >
                      <span className="min-w-0">
                        <span
                          className="display block [overflow-wrap:anywhere]"
                          style={size(3.6)}
                        >
                          {s.userName}
                        </span>
                        <span className="block font-medium" style={size(1.9)}>
                          {s.teamName}
                        </span>
                      </span>
                      <span
                        className="display tnum text-royal-deep"
                        style={size(4)}
                      >
                        {s.userCode}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </main>

      <footer className="flex justify-end px-[3vw] pb-[3vh] pt-[1.5vh]">
        <button
          className="btn btn-gold btn-lg"
          disabled={busy}
          onClick={start}
          data-testid="start-presentation"
        >
          Започни презентацията на {qLabel(1)}
        </button>
      </footer>
    </div>
  );
}
