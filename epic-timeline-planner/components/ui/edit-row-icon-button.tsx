"use client";

import { SquarePen } from "lucide-react";

import { Button } from "@/components/ui/button";

export function EditRowIconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="size-7 shrink-0 rounded-lg text-slate-500 ring-1 ring-transparent transition-[color,background-color,box-shadow] hover:bg-indigo-50/95 hover:text-indigo-700 hover:shadow-sm hover:ring-indigo-200/70 focus-visible:ring-2 focus-visible:ring-indigo-400/45"
    >
      <SquarePen className="size-3.5" strokeWidth={2} aria-hidden />
    </Button>
  );
}
