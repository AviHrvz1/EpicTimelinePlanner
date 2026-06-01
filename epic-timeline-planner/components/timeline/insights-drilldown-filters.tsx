"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Compact per-column filter cells rendered as a second row in the drilldown
 *  table's <thead>. Title is a substring text input; sprint/assignee/status
 *  are <select> dropdowns of the unique values present in the raw rows.
 *  Shared by month-analytics + sprint-analytics so the chrome stays in sync. */
export function DrilldownFilterInputText({
  value,
  onChange,
  placeholder = "Filter…",
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  return (
    <input
      type="text"
      name={ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoComplete="off"
      className="block h-6 w-full rounded-sm border border-slate-300 bg-white px-1.5 text-[11px] !text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300/40"
    />
  );
}

/**
 * Custom filter dropdown that supports icons/avatars in both the trigger and
 * each option (native <select> can't render JSX inside <option>). Closes on
 * outside click or option select. `renderOption(value)` is invoked for both
 * the trigger label and each menu row so the visual stays consistent.
 */
export function DrilldownFilterDropdown({
  value,
  options,
  renderOption,
  onChange,
  ariaLabel,
  emptyLabel = "All",
}: {
  value: string | null;
  options: string[];
  renderOption: (opt: string) => ReactNode;
  onChange: (v: string | null) => void;
  ariaLabel: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        className="flex h-6 w-full items-center gap-1 rounded-sm border border-slate-300 bg-white px-1.5 text-[11px] !text-slate-800 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300/40"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {value == null ? <span className="text-slate-500">{emptyLabel}</span> : renderOption(value)}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded border border-slate-200 bg-white py-0.5 text-slate-800 shadow-md">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className={cn("block w-full truncate px-2 py-1 text-left text-[11px] text-slate-800 hover:bg-slate-50", value == null && "bg-indigo-50 font-semibold")}
          >
            {emptyLabel}
          </button>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false); }}
              className={cn("block w-full truncate px-2 py-1 text-left text-[11px] text-slate-800 hover:bg-slate-50", value === opt && "bg-indigo-50 font-semibold")}
            >
              {renderOption(opt)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
