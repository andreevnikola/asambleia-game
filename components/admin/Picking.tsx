"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sleep } from "@/lib/client";
import { FitText } from "@/components/ui/fit";
import { seededRng, shuffle } from "@/lib/logic";
import type { AdminAssignment } from "@/lib/types";
import { CountdownBadge, StageHeader } from "./StageHeader";
import { qLabel, type Ctx } from "./types";

const REEL_ITEM_S = 0.13; // seconds each name takes to pass the window

function nameClass(name: string): string {
  const n = name.length;
  if (n <= 8) return "text-[clamp(1.4rem,17cqw,4.6rem)]";
  if (n <= 14) return "text-[clamp(1.2rem,12cqw,3.4rem)]";
  return "text-[clamp(1rem,8.5cqw,2.4rem)]";
}

function Reel({ names, seed }: { names: string[]; seed: number }) {
  const { items, duration } = useMemo(() => {
    const base = shuffle(names.length ? names : ["…"], seededRng(seed));
    let list = base;
    while (list.length < 8) list = list.concat(base);
    const duration = list.length * REEL_ITEM_S;
    return { items: list.concat(list), duration }; // doubled for a seamless loop
  }, [names, seed]);
  const delay = useMemo(
    () => -(seededRng(seed * 7 + 3)() * duration),
    [seed, duration],
  );

  return (
    <div
      className="absolute inset-0 overflow-hidden [mask-image:linear-gradient(transparent,#000_28%,#000_72%,transparent)]"
      aria-hidden
    >
      <ul
        className="m-0 list-none p-0 text-center"
        style={{ animation: `reel ${duration}s linear ${delay}s infinite` }}
      >
        {items.map((n, i) => (
          <li
            key={i}
            className="display flex h-[1.5em] items-center justify-center px-[10%] text-[clamp(1.2rem,12cqw,3rem)] text-azure"
          >
            <span className="truncate">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Slot({
  a,
  revealed,
  rollNames,
  seed,
}: {
  a: AdminAssignment;
  revealed: boolean;
  rollNames: string[];
  seed: number;
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
          <Reel names={rollNames} seed={seed} />
        )}
      </div>
    </div>
  );
}

export function Picking({ ctx }: { ctx: Ctx }) {
  const { state, call, refresh, logout } = ctx;
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
  const stateRef = useRef(state);
  stateRef.current = state;

  const isRevealed = (a: AdminAssignment) =>
    a.revealed || localRevealed.has(a.id);

  // The teams still "in the draw" when this question starts. Frozen per question so the reels never jump.
  const rollNames = useMemo(
    () => assignments.filter((a) => !a.revealed).map((a) => a.teamName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game.gameId, game.qIndex],
  );

  // The whole picking show for one question. Everything it does is idempotent and resumable:
  // after a refresh it simply continues with whatever is still unrevealed.
  useEffect(() => {
    let alive = true;
    setCountdown(null);
    (async () => {
      const { scrollSeconds, revealSeconds, pauseSeconds, qIndex } =
        stateRef.current.game;
      await sleep(scrollSeconds * 1000);
      while (alive) {
        const cur = stateRef.current;
        const mine = cur.questions[qIndex];
        const pending = cur.assignments
          .filter((a) => a.questionId === mine?.id && !a.revealed)
          .sort((a, b) => a.slot - b.slot);
        for (const a of pending) {
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
          await sleep(revealSeconds * 1000);
        }
        if (!alive) return;
        for (let t = pauseSeconds; t > 0; t--) {
          setCountdown(t);
          await sleep(1000);
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
        progress={`${qLabel(game.qIndex + 1)} от ${questions.length}`}
        onLogout={logout}
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
        style={{
          gridTemplateColumns: `repeat(${Math.max(cols, 1)}, minmax(0, 1fr))`,
          gridAutoRows: "1fr",
        }}
        data-testid="slots"
      >
        {slots.map((a, i) => (
          <Slot
            key={a.id}
            a={a}
            revealed={isRevealed(a)}
            rollNames={rollNames}
            seed={a.id * 31 + i + game.qIndex * 101}
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
          />
        )}
      </footer>
    </div>
  );
}
