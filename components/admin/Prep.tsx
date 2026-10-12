"use client";

import { useRef, useState } from "react";
import { formatClock } from "@/lib/logic";
import { AdminHeader } from "./Header";
import { qLabel, type Ctx } from "./types";

function Panel({
  title,
  count,
  children,
  className = "",
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col border-t-[6px] border-royal bg-white ${className}`}>
      <div className="flex items-baseline justify-between px-5 pb-3 pt-4">
        <h2 className="display text-[2rem]">{title}</h2>
        {count !== undefined && (
          <span className="display tnum text-[3rem] leading-none text-royal" data-testid={`count-${title}`}>
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

const SETTINGS = [
  { key: "speakSeconds", label: "Време за изказване", hint: "на отбор, по въпрос", clock: true },
  { key: "pauseSeconds", label: "Пауза преди следващия въпрос", hint: "след като всички са разкрити" },
  { key: "revealSeconds", label: "Интервал между разкриванията", hint: "между два екрана на лидери" },
  { key: "scrollSeconds", label: "Въртене на отборите", hint: "преди първото разкриване" },
] as const;
type SettingKey = (typeof SETTINGS)[number]["key"];

export function Prep({ ctx }: { ctx: Ctx }) {
  const { state, call, refresh, logout } = ctx;
  const { teams, questions, game } = state;
  const [teamName, setTeamName] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<SettingKey, string>>(() => pick(game));
  const [saved, setSaved] = useState(false);
  // Last values the server confirmed. The inputs are never overwritten by background polling, so
  // typing can't be clobbered; each field is saved on its own, so quick edits can't overwrite each other.
  const confirmed = useRef<Record<SettingKey, number>>({
    speakSeconds: game.speakSeconds,
    pauseSeconds: game.pauseSeconds,
    revealSeconds: game.revealSeconds,
    scrollSeconds: game.scrollSeconds,
  });

  // Actions run one after another and are never dropped (a quick Enter after another action still counts).
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  function act(fn: () => Promise<unknown>) {
    pending.current++;
    setBusy(true);
    const run = queue.current.then(async () => {
      try {
        await fn();
        await refresh();
      } finally {
        if (--pending.current === 0) setBusy(false);
      }
    });
    queue.current = run.catch(() => undefined);
    return run;
  }

  const addTeam = () => {
    const name = teamName.trim();
    if (!name) return;
    setTeamName("");
    return act(async () => {
      const res = await call("/api/admin/teams", { body: { name } });
      if (!res.ok) setTeamName(name);
    });
  };

  const addQuestion = () => {
    const text = question.trim();
    if (!text) return;
    setQuestion("");
    return act(async () => {
      const res = await call("/api/admin/questions", { body: { text } });
      if (!res.ok) setQuestion(text);
    });
  };

  async function commitSetting(key: SettingKey) {
    const value = Number(draft[key]);
    if (draft[key] !== "" && value === confirmed.current[key]) return;
    const res = await call("/api/admin/settings", { method: "PUT", body: { [key]: draft[key] === "" ? null : value } });
    if (res.ok) {
      confirmed.current[key] = value;
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } else {
      setDraft((d) => ({ ...d, [key]: String(confirmed.current[key]) }));
    }
  }

  const problem =
    teams.length === 0
      ? "Добави поне един отбор."
      : questions.length === 0
        ? "Добави поне един въпрос."
        : teams.length < questions.length
          ? `Отборите (${teams.length}) трябва да са поне колкото въпросите (${questions.length}).`
          : null;

  const start = (simulate: boolean) => act(() => call("/api/admin/start", { body: { simulate } }));

  return (
    <div className="flex h-dvh flex-col">
      <AdminHeader onLogout={logout}>
        <span className="rounded-full bg-paper px-4 py-1.5 text-sm font-semibold text-ink-soft ring-1 ring-line">Подготовка</span>
      </AdminHeader>

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_380px] gap-8 px-8 py-6">
        <Panel title="Отбори" count={teams.length}>
          <form
            className="flex gap-2 px-5 pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              addTeam();
            }}
          >
            <input
              className="field !min-h-12"
              placeholder="Име на отбор"
              aria-label="Име на отбор"
              maxLength={40}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
            />
            <button className="btn btn-sm" disabled={!teamName.trim()}>
              Добави
            </button>
          </form>
          <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto border-t border-line p-0" data-testid="team-list">
            {teams.length === 0 && <li className="px-5 py-6 text-ink-soft">Още няма отбори.</li>}
            {teams.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
                <span className="display text-[1.5rem] [overflow-wrap:anywhere]">{t.name}</span>
                <button
                  className="chip-btn danger"
                  aria-label={`Изтрий отбор ${t.name}`}
                  disabled={busy}
                  onClick={() => act(() => call("/api/admin/teams", { method: "DELETE", body: { id: t.id } }))}
                >
                  Изтрий
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Въпроси" count={questions.length}>
          <form
            className="flex items-end gap-2 px-5 pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              addQuestion();
            }}
          >
            <textarea
              className="field"
              rows={2}
              placeholder="Текст на въпроса"
              aria-label="Текст на въпроса"
              maxLength={400}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  addQuestion();
                }
              }}
            />
            <button className="btn btn-sm mb-1" disabled={!question.trim()}>
              Добави
            </button>
          </form>
          <ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto border-t border-line p-0" data-testid="question-list">
            {questions.length === 0 && <li className="px-5 py-6 text-ink-soft">Още няма въпроси.</li>}
            {questions.map((q, i) => (
              <li key={q.id} className="grid grid-cols-[3rem_1fr_auto] items-baseline gap-3 border-b border-line px-5 py-3">
                <span className="display text-[1.7rem] text-royal">{qLabel(i + 1)}</span>
                <span className="[overflow-wrap:anywhere]">{q.text}</span>
                <button
                  className="chip-btn danger"
                  aria-label={`Изтрий въпрос ${i + 1}`}
                  disabled={busy}
                  onClick={() => act(() => call("/api/admin/questions", { method: "DELETE", body: { id: q.id } }))}
                >
                  Изтрий
                </button>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Времена" className="overflow-y-auto">
          <div className="flex flex-col px-5 pb-2">
            {SETTINGS.map((s) => {
              const n = Number(draft[s.key]);
              return (
                <div key={s.key} className="flex items-center justify-between gap-3 border-t border-line py-2.5">
                  <label htmlFor={s.key} className="min-w-0">
                    <span className="block font-semibold leading-tight">{s.label}</span>
                    <span className="block text-sm leading-tight text-ink-soft">
                      {s.hint}
                      {"clock" in s && n > 0 ? ` · ${formatClock(n)}` : ""}
                    </span>
                  </label>
                  <span className="flex shrink-0 items-center gap-2">
                    <input
                      id={s.key}
                      data-setting={s.key}
                      className="field tnum !min-h-10 !w-[4.5rem] !px-1 text-center"
                      inputMode="numeric"
                      value={draft[s.key]}
                      onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                      onBlur={() => commitSetting(s.key)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                    <span className="w-8 text-sm text-ink-soft">сек.</span>
                  </span>
                </div>
              );
            })}
            <p role="status" className="h-4 text-sm font-medium text-royal">
              {saved ? "Запазено" : ""}
            </p>
          </div>

          <div className="mt-auto flex flex-col gap-3 border-t border-line p-5">
            {problem && (
              <p className="text-sm font-medium text-signal" data-testid="start-problem">
                {problem}
              </p>
            )}
            <button className="btn btn-lg w-full" disabled={busy || problem !== null} onClick={() => start(false)}>
              Започни играта
            </button>
            <button className="btn btn-ghost btn-sm w-full" disabled={busy || problem !== null} onClick={() => start(true)}>
              Старт със симулация (100 участника)
            </button>
          </div>
        </Panel>
      </main>
    </div>
  );
}

function pick(g: Ctx["state"]["game"]): Record<SettingKey, string> {
  return {
    speakSeconds: String(g.speakSeconds),
    pauseSeconds: String(g.pauseSeconds),
    revealSeconds: String(g.revealSeconds),
    scrollSeconds: String(g.scrollSeconds),
  };
}
