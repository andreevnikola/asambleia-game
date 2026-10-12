"use client";

import { useEffect, useRef } from "react";

/** Native <dialog>: focus trap, Escape and top-layer for free. */
export function Modal({
  open,
  onClose,
  className,
  label,
  children,
}: {
  open: boolean;
  onClose?: () => void;
  className?: string;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}
