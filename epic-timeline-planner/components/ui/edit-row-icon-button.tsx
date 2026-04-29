"use client";

import { SquarePen } from "lucide-react";

export function EditRowIconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      aria-label={label}
      title={label}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-500 ring-1 ring-transparent transition-[color,background-color,box-shadow] hover:bg-indigo-50/95 hover:text-indigo-700 hover:shadow-sm hover:ring-indigo-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/45"
    >
      <SquarePen className="size-3.5" strokeWidth={2} aria-hidden />
    </span>
  );
}
