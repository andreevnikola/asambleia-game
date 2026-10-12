import { InteractLogo } from "@/components/ui/Logos";
import { APP_TITLE } from "@/lib/copy";

export function AdminHeader({ children, onLogout }: { children?: React.ReactNode; onLogout: () => void }) {
  return (
    <header className="flex items-center gap-6 border-b border-line bg-white px-8 py-3">
      <InteractLogo className="h-10 w-auto" />
      <p className="display text-[1.6rem] text-royal">{APP_TITLE}</p>
      <div className="ml-auto flex items-center gap-4">
        {children}
        <button className="chip-btn" onClick={onLogout}>
          Изход
        </button>
      </div>
    </header>
  );
}
