import { InteractLogo } from "@/components/ui/Logos";

export function NoGame({ ended }: { ended: boolean }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-6">
      <InteractLogo className="h-11 w-auto self-start" />
      <div className="flex flex-1 flex-col justify-center pb-16">
        <h1 className="display text-[3.4rem] text-royal">
          {ended ? "Играта приключи." : "В момента няма активна игра."}
        </h1>
        <p className="mt-5 max-w-[30ch] text-lg text-ink-soft">
          {ended
            ? "Благодаря за активността! Данните ти са изтрити."
            : "Тази страница ще се отвори сама, щом играта започне."}
        </p>
        {!ended && (
          <p className="mt-8 flex items-center gap-3 text-sm font-medium text-ink-soft" role="status">
            <span className="h-2.5 w-2.5 rounded-full bg-azure [animation:blink_1.4s_ease-in-out_infinite]" />
            Чакаме началото
          </p>
        )}
      </div>
    </main>
  );
}
