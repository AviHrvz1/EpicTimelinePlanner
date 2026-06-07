"use client";

import type { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Compact segmented control used by the Roadmap Health popover AND the
 * Insights view (MonthAnalytics) to drive the same global state — health
 * basis (Epic Est (d) / Σ | Child Est (d) / Stories Completed (%)) and
 * the popover's "Initiative Health / Epic Health" scope toggle.
 *
 * Shared between the two surfaces so the visual treatment stays identical
 * across the planner. Layout-only — the parent owns state and the option
 * list.
 */
export function ToggleGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string; icon?: typeof Check }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      {label ? (
        <div className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</div>
      ) : null}
      <div className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {options.map((opt) => {
          const isOn = opt.value === value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                // `whitespace-nowrap` keeps long labels like
                // "Stories Completed (%)" on a single line; the segmented
                // control grows to fit instead of wrapping the text.
                "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[12px] font-semibold transition-all",
                isOn
                  ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              {Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
