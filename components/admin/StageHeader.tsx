import { InteractLogo } from "@/components/ui/Logos";

/** Header for the projector screens: quiet, so the content is the show. */
export function StageHeader({
  progress,
  onLogout,
}: {
  progress?: string;
  onLogout: () => void;
}) {
  return (
    <header className="flex items-center justify-between px-[3vw] pt-[2.4vh]">
      <InteractLogo className="h-[5.5vh] w-auto" />
      <div className="flex items-center gap-[2vw]">
        {progress && (
          <p className="display text-[3.2vh] text-white/80">{progress}</p>
        )}
        <button
          className="text-sm text-white/35 hover:text-white/80"
          onClick={onLogout}
        >
          Изход
        </button>
      </div>
    </header>
  );
}

export function CountdownBadge({
  left,
  total,
  label,
}: {
  left: number;
  total: number;
  label: string;
}) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  return (
    <div
      className="flex items-center gap-[1.2vw] [animation:rise_380ms_ease-out_both]"
      role="timer"
      aria-label={`${label}: ${left}`}
      data-testid="countdown"
    >
      <p className="max-w-[22ch] text-right text-[2.4vh] font-medium leading-tight text-white/80">
        {label}
      </p>
      <div className="relative grid h-[11vh] w-[11vh] place-items-center">
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="7"
          />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="var(--color-gold)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - frac)}
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <span className="display tnum text-[5.4vh]">{left}</span>
      </div>
    </div>
  );
}
