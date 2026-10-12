"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sleep } from "@/lib/client";
import { FitText } from "@/components/ui/fit";
import { seededRng } from "@/lib/logic";
import { reelNames, REEL_NAMES } from "@/lib/reel";
import type { AdminAssignment } from "@/lib/types";
import { Reel, type ReelPlan } from "./Reel";
import { CountdownBadge, StageHeader } from "./StageHeader";
import { qLabel, type Ctx } from "./types";

const BEAT_MS = 320; // the drum rests on the winner this long before the card is revealed

type Drum = { names: string[]; land: number; startPos: number };

function nameClass(name: string): string {
  const n = name.length;
  if (n <= 8) return "text-[clamp(1.4rem,17cqw,4.6rem)]";
  if (n <= 14) return "text-[clamp(1.2rem,12cqw,3.4rem)]";
  return "text-[clamp(1rem,8.5cqw,2.4rem)]";
}

function Slot({
  a,
  revealed,
  drum,
  plan,
}: {
  a: AdminAssignment;
  revealed: boolean;
  drum: Drum | undefined;
  plan: ReelPlan | null;
}) {
  return (
    <div
      className="[container-type:inline-size]"
      data-testid="slot"
      data-revealed={revealed}
    >
      <div
        className={`relative h-full overflow-hidden [clip-path:polygon(34px_0,100%_0,calc(100%-34px)_100%,0_100%)] ${
          revealed
            ? "bg-gold text-ink [animation:reveal_520ms_cubic-bezier(.2,.9,.3,1.2)_both]"
            : "bg-ink-2"
        }`}
      >
        {revealed ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-[1vh] px-[16%] text-center"
            data-testid="slot-revealed"
          >
            <p className="text-[clamp(.9rem,2.3vh,1.6rem)] font-semibold leading-tight [overflow-wrap:anywhere]">
              {a.teamName}
            </p>
            <p
              className={`display leading-[0.95] [overflow-wrap:anywhere] ${nameClass(a.userName)}`}
            >
              {a.userName}
            </p>
            <p className="display tnum text-[clamp(2rem,22cqw,6rem)] leading-none text-royal-deep">
              {a.userCode}
            </p>
          </div>
        ) : (
          drum && <Reel names={drum.names} land={drum.land} startPos={drum.startPos} plan={plan} />
        )}
      </div>
    </div>
  );
}

export function Picking({ ctx }: { ctx: Ctx }) {
  const { state, call, refresh } = ctx;
  const { game, questions, assignments } = state;
  const q = questions[game.qIndex];
  const slots = useMemo(
    () =>
      assignments
        .filter((a) => a.questionId === q?.id)
        .sort((a, b) => a.slot - b.slot),
    [assignments, q?.id],
  );
  const [localRevealed, setLocalRevealed] = useState<Set<number>>(
    () => new Set(),
  );
  const [countdown, setCountdown] = useState<number | null>(null);
  const [plans, setPlans] = useState<Map<number, ReelPlan>>(() => new Map());
  const stateRef = useRef(state);
  stateRef.current = state;
  const skipRef = useRef<(() => void) | null>(null);

  const isRevealed = (a: AdminAssignment) =>
    a.revealed || localRevealed.has(a.id);

  // What each drum shows: the chosen player plus decoys from everybody registered. Frozen per
  // question (and seeded by the assignment), so a poll or a late sign-up never makes a drum jump.
  const drums = useMemo(() => {
    const pool = state.teams.flatMap((t) => t.members.map((m) => m.name));
    return new Map<number, Drum>(
      slots.map((a, i) => {
        const seed = a.id * 31 + i + game.qIndex * 101;
        const { names, land } = reelNames(a.userName, pool, seed, REEL_NAMES);
        return [a.id, { names, land, startPos: seededRng(seed * 7 + 3)() * REEL_NAMES }];
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.gameId, game.qIndex]);

  // The whole picking show for one question. Everything it does is idempotent and resumable:
  // after a refresh it simply continues with whatever is still unrevealed.
  // Timing is a schedule of absolute deadlines (the Nth card is due scrollSeconds + N × revealSeconds
  // after the start), so network latency never piles up and each drum can be told exactly when
  // to come to rest: BEAT_MS before its card is revealed.
  useEffect(() => {
    let alive = true;
    setCountdown(null);
    // Sleeps that the skip button can cut short. Resolves true when it was skipped.
    const nap = (ms: number) =>
      new Promise<boolean>((resolve) => {
        const id = setTimeout(() => {
          skipRef.current = null;
          resolve(false);
        }, ms);
        skipRef.current = () => {
          clearTimeout(id);
          skipRef.current = null;
          resolve(true);
        };
      });
    (async () => {
      const { scrollSeconds, revealSeconds, pauseSeconds, qIndex } =
        stateRef.current.game;
      const pendingNow = () => {
        const cur = stateRef.current;
        const mine = cur.questions[qIndex];
        return cur.assignments
          .filter((a) => a.questionId === mine?.id && !a.revealed)
          .sort((a, b) => a.slot - b.slot);
      };
      const t0 = performance.now();
      const due = new Map(
        pendingNow().map((a, i) => [a.id, (scrollSeconds + i * revealSeconds) * 1000]),
      );
      setPlans(
        new Map(
          [...due].map(([id, at]) => [id, { t0, stopAt: Math.max(0, at - BEAT_MS) }]),
        ),
      );
      if (due.size === 0) await sleep(scrollSeconds * 1000);
      while (alive) {
        const pending = pendingNow();
        for (const [i, a] of pending.entries()) {
          if (!alive) return;
          const at = due.get(a.id);
          if (at !== undefined) await sleep(Math.max(0, t0 + at - performance.now()));
          else if (i > 0) await sleep(revealSeconds * 1000); // a retry pass keeps the one-by-one pace
          if (!alive) return;
          for (;;) {
            const r = await call("/api/admin/reveal", {
              body: { assignmentId: a.id },
              silent: true,
            });
            if (!alive) return;
            if (r.ok) break;
            await sleep(1000);
          }
          setLocalRevealed((prev) => new Set(prev).add(a.id));
          due.delete(a.id);
        }
        if (pending.length > 0) await sleep(revealSeconds * 1000); // let the last card breathe
        if (!alive) return;
        let skipped = false;
        for (let t = pauseSeconds; t > 0 && !skipped; t--) {
          setCountdown(t);
          skipped = await nap(1000);
          if (!alive) return;
        }
        setCountdown(0);
        const r = await call("/api/admin/advance", {
          body: { action: "next-pick", qIndex },
          silent: true,
        });
        if (!alive) return;
        await refresh();
        if (r.ok) return;
        if (r.status !== 409) await sleep(1000);
        // 409: something was still unrevealed or the stage moved; loop re-evaluates from fresh state.
        await sleep(300);
        if (
          stateRef.current.game.stage !== "picking" ||
          stateRef.current.game.qIndex !== qIndex
        )
          return;
      }
    })();
    return () => {
      alive = false;
      skipRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.gameId, game.qIndex]);

  if (!q) return null;
  const last = game.qIndex + 1 >= questions.length;
  const cols = Math.min(slots.length, 5);

  return (
    <div
      className="stage grid h-dvh grid-rows-[auto_minmax(0,1fr)_38vh_13vh] overflow-hidden"
      data-testid="picking"
    >
      <StageHeader
        ctx={ctx}
        progress={`${qLabel(game.qIndex + 1)} от ${questions.length}`}
      />

      <section
        className="flex min-h-0 flex-col px-[3vw]"
        data-testid="question-area"
      >
        <p className="display pt-[1vh] text-[4vh] leading-none text-azure">
          Въпрос {qLabel(game.qIndex + 1)}
        </p>
        <FitText text={q.text} testId="picking-question" />
      </section>

      <section
        className="grid gap-[1.1vw] px-[3vw]"
        style={
          {
            gridTemplateColumns: `repeat(${Math.max(cols, 1)}, minmax(0, 1fr))`,
            gridAutoRows: "1fr",
            "--slot-rows": Math.max(1, Math.ceil(slots.length / 5)),
          } as React.CSSProperties
        }
        data-testid="slots"
      >
        {slots.map((a) => (
          <Slot
            key={a.id}
            a={a}
            revealed={isRevealed(a)}
            drum={drums.get(a.id)}
            plan={plans.get(a.id) ?? null}
          />
        ))}
      </section>

      <footer className="flex items-center justify-end px-[3vw]">
        {countdown !== null && countdown > 0 && (
          <CountdownBadge
            left={countdown}
            total={game.pauseSeconds}
            label={
              last
                ? "Всички лидери избрани. Следват резултатите."
                : `Следва избор на лидерите за ${qLabel(game.qIndex + 2)}.`
            }
            onSkip={() => skipRef.current?.()}
          />
        )}
      </footer>
    </div>
  );
}
