"use client";

import { useState } from "react";
import { ImpactLogo, InteractLogo } from "@/components/ui/Logos";

export function JoinScreen({
  onJoin,
  onLogin,
}: {
  onJoin: (name: string) => Promise<string | null>;
  onLogin: (code: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"join" | "login" | null>(null);
  const [error, setError] = useState<{ field: "join" | "login"; text: string } | null>(null);

  async function submit(kind: "join" | "login") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    const err = kind === "join" ? await onJoin(name) : await onLogin(code);
    if (err) setError({ field: kind, text: err });
    setBusy(null);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pb-8 pt-6">
      <InteractLogo className="h-11 w-auto self-start" />

      <h1 className="display mt-10 text-royal">
        <span className="block text-[2.5rem]">Дистриктна Интеракт Асамблея</span>
        <span className="block text-[6.5rem] leading-[0.9]">„Игра“</span>
      </h1>

      <form
        className="mt-9"
        onSubmit={(e) => {
          e.preventDefault();
          submit("join");
        }}
      >
        <label htmlFor="name" className="mb-2 block font-semibold">
          Как се казваш?
        </label>
        <input
          id="name"
          className="field"
          placeholder="Първо име"
          autoComplete="given-name"
          maxLength={30}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error?.field === "join"}
          aria-describedby={error?.field === "join" ? "join-error" : undefined}
        />
        {error?.field === "join" && (
          <p id="join-error" role="alert" className="mt-2 font-medium text-signal">
            {error.text}
          </p>
        )}
        <button className="btn mt-4 w-full" disabled={busy !== null || name.trim() === ""}>
          {busy === "join" ? "Влизаме…" : "Влез в играта"}
        </button>
      </form>

      <form
        className="mt-10 border-t border-line pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit("login");
        }}
      >
        <label htmlFor="code" className="mb-2 block font-semibold">
          Вече имаш код?
        </label>
        <div className="flex gap-3">
          <input
            id="code"
            className="field field-code !w-36 shrink-0 !px-2"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={3}
            placeholder="000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
            aria-invalid={error?.field === "login"}
            aria-describedby={error?.field === "login" ? "login-error" : undefined}
          />
          <button className="btn btn-ghost flex-1" disabled={busy !== null || code.length !== 3}>
            {busy === "login" ? "Влизаме…" : "Влез с код"}
          </button>
        </div>
        {error?.field === "login" && (
          <p id="login-error" role="alert" className="mt-2 font-medium text-signal">
            {error.text}
          </p>
        )}
      </form>

      <div className="mt-auto flex justify-center pt-12">
        <ImpactLogo className="h-auto w-28 opacity-90" />
      </div>
    </main>
  );
}
