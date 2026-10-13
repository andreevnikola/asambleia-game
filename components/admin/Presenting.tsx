"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { SkipIcon } from "@/components/ui/SkipIcon";
import { FitText, fs, useFit } from "@/components/ui/fit";
import { useTick } from "@/lib/hooks";
import { WARN_MS, formatClock } from "@/lib/logic";
import { StageHeader } from "./StageHeader";
import { qLabel, type Ctx } from "./types";

const PER_ROW = 5;
const GAP_VW = 1.2;

/** Length of the longest piece a name can break into (words and hyphenated parts). */
const longestPart = (name: string) =>
  Math.max(4, ...name.split(/[\s-]+/).map((w) => w.length));

export function Presenting({ ctx }: { ctx: Ctx }) {
  const { state, call, refresh, serverNow } = ctx;
  const { game, questions, assignments } = state;
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  useTick(250);

  const q = questions[game.qIndex];
  const speakers = assignments
    .filter((a) => a.questionId === q?.id)
    .sort((a, b) => a.slot - b.slot);
  const rootRef = useFit<HTMLDivElement>(
    `${q?.id}|${speakers.map((s) => s.id + s.userName + s.teamName).join(",")}`,
  );
  const total = game.speakSeconds * 1000;
  const elapsed =
    game.timerStartedAt === null
      ? 0
      : Math.max(0, serverNow() - game.timerStartedAt);
  const left = Math.max(0, total - elapsed);
  const over = game.timerStartedAt !== null && left <= 0;

  // When the time runs out by itself the "Времето изтече" sheet takes over; the skip question is moot.
  useEffect(() => {
    if (over) setAsk(false);
  }, [over]);

  if (!q) return null;
  const frac = Math.min(1, elapsed / total);
  const last = game.qIndex + 1 >= questions.length;
  const urgent =
    left <= 10_000 ? "bg-signal" : left <= 30_000 ? "bg-gold" : "bg-azure";
  const rows = Math.ceil(speakers.length / PER_ROW);
  // From the last minute on, the stage shows who is next (the phones of those leaders get the same warning).
  const nextQ = questions[game.qIndex + 1];
  const nextSpeakers = nextQ
    ? assignments
        .filter((a) => a.questionId === nextQ.id)
        .sort((a, b) => a.slot - b.slot)
    : [];
  const nextUp =
    nextSpeakers.length > 0 && left <= WARN_MS ? (
      <p
        className="max-w-full truncate rounded-full bg-gold px-[1.4vw] py-[0.7vh] text-[2.5vh] font-semibold leading-tight text-ink"
        data-testid="next-up"
      >
        Следват {qLabel(game.qIndex + 2)}:{" "}
        {nextSpeakers.map((a) => a.userName).join(" · ")}
      </p>
    ) : null;

  // Skipping is the same step as "Продължи" after the time is up: the server moves to the next
  // question (or finishes the game) and starts that question's timer from zero. Nothing about the
  // clock is edited, and a second click for the same question is refused as stale.
  async function next() {
    if (busy) return;
    setBusy(true);
    setAsk(false);
    await call("/api/admin/advance", {
      body: { action: "next", qIndex: game.qIndex },
    });
    await refresh();
    setBusy(false);
  }

  return (
    <div
      ref={rootRef}
      className="stage grid h-dvh grid-rows-[auto_minmax(14vh,1fr)_auto_auto] overflow-hidden"
      data-testid="presenting"
    >
      <StageHeader
        ctx={ctx}
        progress={`${qLabel(game.qIndex + 1)} от ${questions.length}`}
        middle={nextUp}
      />

      <section
        className="flex min-h-0 flex-col px-[3vw]"
        data-testid="question-area"
      >
        <p className="display pt-[1vh] text-[4vh] leading-none text-azure">
          Въпрос {qLabel(game.qIndex + 1)}
        </p>
        <FitText
          text={q.text}
          testId="presenting-question"
          className="text-center pb-10 pt-3"
        />
      </section>

      <section
        className="flex flex-wrap items-stretch justify-center px-[3vw] pb-[3.5vh]"
        style={{ gap: `${GAP_VW}vw` }}
        data-testid="speakers"
      >
        {speakers.map((s) => (
          <div
            key={s.id}
            className="flex min-w-0 items-center justify-between gap-[0.6vw] bg-gold py-[1.1vh] pl-[2.1vw] pr-[1.9vw] text-ink [clip-path:polygon(22px_0,100%_0,calc(100%-22px)_100%,0_100%)]"
            style={{
              width: `calc((100% - ${(PER_ROW - 1) * GAP_VW}vw) / ${PER_ROW})`,
              containerType: "inline-size",
            }}
          >
            <div className="min-w-0">
              {/* As big as the row allows, but small enough that the longest word stays in one piece. */}
              <p
                className="display [overflow-wrap:anywhere]"
                style={
                  {
                    "--part": longestPart(s.userName),
                    fontSize: `calc(var(--k, 1) * min(${rows > 1 ? 3.8 : 4.4}vh, max(1.9vh, calc(112cqw / var(--part)))))`,
                  } as React.CSSProperties
                }
              >
                {s.userName}
              </p>
              <p
                className="mt-[0.3vh] font-semibold leading-tight [overflow-wrap:anywhere]"
                style={fs(rows > 1 ? 1.7 : 2)}
              >
                {s.teamName}
              </p>
            </div>
            <span
              className="display tnum shrink-0 text-royal-deep"
              style={fs(rows > 1 ? 3.4 : 4)}
            >
              {s.userCode}
            </span>
          </div>
        ))}
      </section>

      <section className="px-[3vw] pb-[3.2vh]">
        <div className="relative mx-auto w-fit">
          <p
            className="display tnum text-center text-[min(22vh,16vw)] leading-[0.9]"
            role="timer"
            aria-label="Оставащо време"
            data-testid="timer"
          >
            {formatClock(left / 1000)}
          </p>
          {!over && (
            <button
              type="button"
              onClick={() => setAsk(true)}
              disabled={busy}
              aria-label="Пропусни оставащото време"
              className="absolute left-full top-1/2 ml-[2.2vw] grid h-[9vh] w-[9vh] -translate-y-1/2 place-items-center rounded-full text-white/25 transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white disabled:opacity-40"
              data-testid="skip-timer"
            >
              <SkipIcon className="h-[5.2vh] w-[5.2vh]" />
            </button>
          )}
        </div>
        <div
          className="mt-[1.6vh] h-[1.8vh] overflow-hidden rounded-full bg-white/15"
          aria-hidden
        >
          <div
            className={`h-full rounded-full transition-colors ${urgent}`}
            style={{
              width: `${(1 - frac) * 100}%`,
              transition: "width 250ms linear",
            }}
            data-testid="progress"
          />
        </div>
      </section>

      <Modal
        open={ask && !over}
        onClose={() => setAsk(false)}
        className="sheet"
        label="Пропускане на времето"
      >
        <h2 className="display text-[2.2rem]">
          {last
            ? "Да завършим ли играта?"
            : `Да минем ли към ${qLabel(game.qIndex + 2)}?`}
        </h2>
        <p className="mt-3 text-ink-soft">
          {last
            ? `Остава още ${formatClock(left / 1000)}. Това е последният въпрос: играта приключва, а данните на участниците се изтриват.`
            : `Остава още ${formatClock(left / 1000)} за ${qLabel(game.qIndex + 1)}. Времето не може да бъде върнато.`}
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            className={`btn w-full ${last ? "btn-danger" : ""}`}
            onClick={next}
            disabled={busy}
            autoFocus={!last}
            data-testid="skip-confirm"
          >
            {last ? "Завърши играта" : "Пропусни времето"}
          </button>
          <button
            className="btn btn-ghost w-full"
            onClick={() => setAsk(false)}
            autoFocus={last}
          >
            Отказ
          </button>
        </div>
      </Modal>

      <Modal
        open={over}
        className="sheet !w-[min(90vw,980px)] !bg-gold !p-[4vh_4vw] text-center"
        label="Времето изтече"
      >
        <h2 className="display text-[min(13vh,9vw)]" data-testid="timeup">
          Времето изтече
        </h2>
        <p className="mt-[1.5vh] text-[3vh] font-medium">
          Въпрос {qLabel(game.qIndex + 1)} приключи.
        </p>
        <button
          className="btn btn-lg mt-[4vh]"
          onClick={next}
          disabled={busy}
          autoFocus
          data-testid="continue"
        >
          {last ? "Завърши играта" : `Продължи към ${qLabel(game.qIndex + 2)}`}
        </button>
      </Modal>
    </div>
  );
}
