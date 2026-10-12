"use client";

import { useState } from "react";
import { ImpactLogo, InteractLogo } from "@/components/ui/Logos";
import type { Ctx } from "./types";

export function Thanks({ ctx }: { ctx: Ctx }) {
  const { call, refresh, logout } = ctx;
  const [busy, setBusy] = useState(false);

  async function newGame() {
    if (busy) return;
    setBusy(true);
    await call("/api/admin/advance", { body: { action: "new-game" } });
    await refresh();
    setBusy(false);
  }

  return (
    <div className="flex h-dvh flex-col bg-white px-[4vw] py-[4vh]" data-testid="thanks">
      <div className="flex items-start justify-between">
        <InteractLogo className="h-[9vh] w-auto" />
        <button className="text-sm text-ink-soft/60 hover:text-ink" onClick={logout}>
          Изход
        </button>
      </div>
      <main className="flex flex-1 flex-col items-center justify-center text-center">
        <h1 className="display text-[min(20vh,13vw)] text-royal">Благодаря за активността</h1>
        <ImpactLogo className="mt-[5vh] h-auto w-[min(26vh,24vw)]" />
      </main>
      <div className="flex items-center justify-between">
        <p className="text-ink-soft">Данните на участниците са изтрити. Отборите и въпросите остават.</p>
        <button className="btn btn-ghost btn-sm" onClick={newGame} disabled={busy} data-testid="new-game">
          Нова игра
        </button>
      </div>
    </div>
  );
}
