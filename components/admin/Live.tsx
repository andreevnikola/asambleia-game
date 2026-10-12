"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { AdminMember, AdminTeam } from "@/lib/types";
import { AdminHeader } from "./Header";
import type { Ctx } from "./types";

type Moving = { member: AdminMember; from: AdminTeam; x: number; y: number };

export function Live({ ctx }: { ctx: Ctx }) {
  const { state, call, refresh, logout } = ctx;
  const { teams, questions, game, playerCount } = state;
  const [moving, setMoving] = useState<Moving | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  const eligible = teams.filter((t) => t.members.length > 0).length;
  const canAssign = eligible >= questions.length;

  useEffect(() => {
    if (!moving) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoving(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moving]);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const move = (teamId: number) =>
    run(async () => {
      if (!moving) return;
      const id = moving.member.id;
      setMoving(null);
      await call("/api/admin/move", { body: { userId: id, teamId } });
    });

  return (
    <div className="flex h-dvh flex-col">
      <AdminHeader onLogout={logout}>
        {game.isSimulation && (
          <span className="rounded-full bg-gold px-4 py-1.5 text-sm font-semibold text-ink" data-testid="sim-flag">
            Симулация
          </span>
        )}
      </AdminHeader>

      <div className="flex items-center gap-8 px-8 py-4">
        <div>
          <p className="flex items-center gap-2 font-semibold">
            <span className="h-2.5 w-2.5 rounded-full bg-azure [animation:blink_1.6s_ease-in-out_infinite]" />
            Играта тече
          </p>
          <p className="text-ink-soft">
            Участници: <strong className="tnum text-ink" data-testid="player-count">{playerCount}</strong>
            {" · "}Отбори: <strong className="text-ink">{teams.length}</strong>
            {" · "}Въпроси: <strong className="text-ink">{questions.length}</strong>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          {!canAssign && (
            <p className="max-w-[34ch] text-right text-sm font-medium text-signal" data-testid="assign-problem">
              Нужни са поне {questions.length} отбора с участници (сега: {eligible}).
            </p>
          )}
          <button className="chip-btn danger" disabled={busy} onClick={() => setConfirmReset(true)}>
            Нулирай играта
          </button>
          <button
            className="btn btn-lg"
            disabled={busy || !canAssign}
            onClick={() => run(() => call("/api/admin/assign"))}
          >
            Определи лидери
          </button>
        </div>
      </div>

      <main
        className="grid min-h-0 flex-1 auto-cols-[minmax(230px,1fr)] grid-flow-col gap-5 overflow-x-auto px-8 pb-6"
        data-testid="board"
      >
        {teams.map((t) => (
          <section key={t.id} className="flex min-h-0 flex-col border-t-[6px] border-royal bg-white" data-testid={`team-${t.id}`}>
            <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-3">
              <h2 className="display text-[1.9rem] [overflow-wrap:anywhere]">{t.name}</h2>
              <span className="display tnum text-[2.2rem] leading-none text-royal">{t.members.length}</span>
            </div>
            <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto border-t border-line p-0">
              {t.members.length === 0 && <li className="px-4 py-4 text-ink-soft">Още няма участници.</li>}
              {t.members.map((m) => (
                <li key={m.id}>
                  <button
                    className="flex w-full items-center justify-between gap-3 border-b border-line px-4 py-2 text-left hover:bg-paper"
                    data-testid={`member-${m.code}`}
                    onClick={(e) => {
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setMoving({ member: m, from: t, x: r.left, y: r.bottom });
                    }}
                  >
                    <span className="min-w-0 truncate font-medium">{m.name}</span>
                    <span className="display tnum text-[1.25rem] text-royal">{m.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      {moving && (
        <>
          <button className="fixed inset-0 z-40 cursor-default bg-transparent" aria-label="Затвори" onClick={() => setMoving(null)} />
          <div
            role="dialog"
            aria-label={`Премести ${moving.member.name}`}
            className="fixed z-50 w-[270px] rounded-xl border border-line bg-white p-3 shadow-[0_18px_40px_rgba(6,38,63,0.22)] [animation:pop_140ms_ease-out]"
            style={{
              left: Math.min(moving.x, window.innerWidth - 290),
              top: Math.min(moving.y + 4, window.innerHeight - Math.min(70 + teams.length * 44, 420) - 12),
            }}
            data-testid="move-popover"
          >
            <p className="px-1 pb-2 font-semibold">
              Премести <span className="text-royal">{moving.member.name}</span> в:
            </p>
            <div className="flex max-h-[340px] flex-col gap-1.5 overflow-y-auto">
              {teams
                .filter((t) => t.id !== moving.from.id)
                .map((t) => (
                  <button key={t.id} className="chip-btn justify-between !min-h-10" onClick={() => move(t.id)} data-testid={`move-to-${t.id}`}>
                    <span className="truncate">{t.name}</span>
                    <span className="tnum text-ink-soft">{t.members.length}</span>
                  </button>
                ))}
            </div>
          </div>
        </>
      )}

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} className="sheet m-auto" label="Нулиране на играта">
        <h2 className="display text-[2.2rem]">Да нулираме ли играта?</h2>
        <p className="mt-3 text-ink-soft">
          Всички участници и техните кодове ще бъдат изтрити. Отборите, въпросите и времената остават.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            className="btn btn-danger w-full"
            onClick={() => {
              setConfirmReset(false);
              run(() => call("/api/admin/advance", { body: { action: "reset" } }));
            }}
          >
            Нулирай играта
          </button>
          <button className="btn btn-ghost w-full" onClick={() => setConfirmReset(false)} autoFocus>
            Отказ
          </button>
        </div>
      </Modal>
    </div>
  );
}
