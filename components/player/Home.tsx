"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { InteractLogo } from "@/components/ui/Logos";
import { storageGet, storageSet } from "@/lib/client";
import type { PlayerSnapshot } from "@/lib/types";

type Joined = Extract<PlayerSnapshot, { live: true; user: { code: number } }>;
const ACK_KEY = "asm.ack";

// Long names step down so they stay on one or two lines inside the ticket.
function nameSize(name: string): string {
  const n = name.length;
  if (n <= 7) return "text-[2.6rem]";
  if (n <= 10) return "text-[2.1rem]";
  if (n <= 14) return "text-[1.75rem]";
  return "text-[1.4rem]";
}

export function Home({
  snap,
  onSignOut,
}: {
  snap: Joined;
  onSignOut: () => void;
}) {
  const { user, questions, leader } = snap;
  const [confirmOut, setConfirmOut] = useState(false);
  const [acked, setAcked] = useState<number | null>(null);

  useEffect(() => {
    const v = Number(storageGet(ACK_KEY));
    setAcked(Number.isInteger(v) && v > 0 ? v : null);
  }, []);

  const showTakeover = leader !== null && acked !== leader.assignmentId;
  const leaderId = leader?.assignmentId;
  useEffect(() => {
    if (leaderId !== undefined && acked !== leaderId)
      navigator.vibrate?.([220, 90, 220]);
  }, [leaderId, acked]);

  function dismiss() {
    if (!leader) return;
    storageSet(ACK_KEY, String(leader.assignmentId));
    setAcked(leader.assignmentId);
  }

  return (
    <>
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+8rem)]">
        <header className="flex items-center justify-between py-4">
          <InteractLogo className="h-9 w-auto" />
          <button className="link-btn" onClick={() => setConfirmOut(true)}>
            Изход
          </button>
        </header>

        <h1 className="sr-only">Дистриктна Интеракт Асамблея - „Игра“</h1>

        <section className="ticket mt-1" aria-label="Твоят код">
          <div className="min-w-0 p-5 items-center justify-start flex flex-grow">
            <p
              className={`display [overflow-wrap:anywhere] ${nameSize(user.name)}`}
              data-testid="player-name"
            >
              {user.name}
            </p>
          </div>
          <div className="ticket-stub grid content-center justify-items-center px-5 py-4 text-center">
            <p className="text-sm font-medium text-ink-soft">Твоят код</p>
            <p
              className="display tnum text-[3.4rem] text-royal"
              data-testid="player-code"
            >
              {user.code}
            </p>
          </div>
        </section>

        <section className="mt-9">
          <p className="font-medium text-ink-soft">Отбор:</p>
          <p
            className="display text-[3.6rem] text-royal [overflow-wrap:anywhere]"
            data-testid="player-team"
          >
            {user.team}
          </p>
        </section>

        <section className="mt-9">
          <h2 className="mb-1 text-lg font-semibold">Въпроси за обсъждане</h2>
          <ol className="m-0 list-none p-0">
            {questions.map((q) => {
              const mine = leader?.n === q.n;
              return (
                <li
                  key={q.id}
                  className={`grid grid-cols-[3.2rem_1fr] items-baseline gap-2 border-t border-line py-4 ${
                    mine
                      ? "-mx-4 border-l-[6px] border-l-gold bg-gold/20 pl-[calc(1rem-6px)] pr-4"
                      : ""
                  }`}
                >
                  <span className="display text-[1.9rem] text-royal">
                    В{q.n}
                  </span>
                  <span className="[overflow-wrap:anywhere]">{q.text}</span>
                </li>
              );
            })}
          </ol>
        </section>
      </main>

      {leader && !showTakeover && (
        <aside
          data-testid="leader-bar"
          className="fixed inset-x-0 bottom-0 z-30 bg-gold text-ink [animation:rise_380ms_ease-out_both] [clip-path:polygon(0_14px,100%_0,100%_100%,0_100%)]"
        >
          <div className="mx-auto max-w-[480px] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-7">
            <p className="display text-[1.7rem]">
              Ти представяш отбор{" "}
              <span className="underline">{leader.team}</span> по въпрос{" "}
              <span className="underline">В{leader.n}</span>
            </p>
          </div>
        </aside>
      )}

      <Modal
        open={showTakeover}
        className="takeover"
        label="Ти си избран"
        onClose={dismiss}
      >
        {leader && (
          <div
            className="mx-auto flex h-full w-full max-w-[520px] flex-col px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+2rem)]"
            data-testid="takeover"
          >
            <p className="text-lg font-medium text-white/85">
              {user.name}, избран си за лидер!
            </p>
            <h2 className="display mt-3 text-[3.3rem] [overflow-wrap:anywhere]">
              Ти представяш отбор{" "}
              <span className="underline">{leader.team}</span>
            </h2>
            <div className="parallelogram mt-8 bg-gold px-8 py-6 text-ink">
              <p className="display text-[2rem]">Въпрос В{leader.n}</p>
              <p className="mt-2 text-[1.3rem] font-semibold leading-snug [overflow-wrap:anywhere]">
                {leader.text}
              </p>
            </div>
            <button
              className="btn btn-white mt-auto w-full"
              onClick={dismiss}
              autoFocus
            >
              Разбрах
            </button>
          </div>
        )}
      </Modal>

      <Modal
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        className="sheet m-auto"
        label="Изход"
      >
        <h2 className="display text-[2.2rem]">
          Сигурен ли си, че искаш да излезеш?
        </h2>
        <p className="mt-3 text-ink-soft">
          Запомни кода си — без него не можеш да влезеш отново.
        </p>
        <p
          className="display tnum my-5 rounded-xl bg-paper py-3 text-center text-[5rem] tracking-[0.12em] text-royal"
          data-testid="signout-code"
        >
          {user.code}
        </p>
        <div className="flex flex-col gap-3">
          <button className="btn btn-danger w-full" onClick={onSignOut}>
            Изход
          </button>
          <button
            className="btn btn-ghost w-full"
            onClick={() => setConfirmOut(false)}
            autoFocus
          >
            Остани
          </button>
        </div>
      </Modal>
    </>
  );
}
