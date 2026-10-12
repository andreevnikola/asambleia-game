"use client";

import { useState } from "react";
import { InteractLogo } from "@/components/ui/Logos";
import { adminHeaders, api } from "@/lib/client";

export function Login({ onLogin }: { onLogin: (key: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const key = value.trim();
    if (!key || busy) return;
    setBusy(true);
    setError(null);
    const res = await api("/api/admin/auth", { method: "POST", body: {}, headers: adminHeaders(key) });
    setBusy(false);
    if (res.ok) onLogin(key);
    else setError(res.error);
  }

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <form
        className="w-full max-w-[440px]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <InteractLogo className="h-14 w-auto" />
        <h1 className="display mt-10 text-[3.2rem] text-royal">Администрация</h1>
        <p className="mt-2 text-ink-soft">Дистриктна Интеракт Асамблея - „Игра“</p>
        <label htmlFor="key" className="mb-2 mt-8 block font-semibold">
          Таен ключ
        </label>
        <input
          id="key"
          type="password"
          className="field"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error ? "key-error" : undefined}
        />
        {error && (
          <p id="key-error" role="alert" className="mt-2 font-medium text-signal">
            {error}
          </p>
        )}
        <button className="btn mt-5 w-full" disabled={busy || !value.trim()}>
          {busy ? "Проверяваме…" : "Вход"}
        </button>
      </form>
    </main>
  );
}
