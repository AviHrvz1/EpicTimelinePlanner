"use client";

import { ChevronDown, X as XIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Compact per-column filter cells rendered as a second row in the drilldown
 *  table's <thead>. Title is a substring text input; sprint/assignee/status
 *  are <select> dropdowns of the unique values present in the raw rows.
 *  Shared by month-analytics + sprint-analytics so the chrome stays in sync.
 *  Both controls render a clear-on-hover X when a value is set so the planner
 *  can drop a single column filter without opening the dropdown. */
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
  const hasValue = value.length > 0;
  return (
    <div className="group relative">
      <input
        type="text"
        name={ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        className={cn(
          "block h-6 w-full rounded-sm border border-slate-300 bg-white px-1.5 text-[11px] !text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300/40",
          hasValue && "pr-5",
        )}
      />
      {hasValue ? (
        <button
          type="button"
          onClick={() => onChange("")}
          tabIndex={-1}
          aria-label={`Clear ${ariaLabel}`}
          title="Clear filter"
          className="absolute right-0.5 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-300"
        >
          <XIcon className="size-3" aria-hidden />
        </button>
      ) : null}
    </div>
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
  /** Substring filter typed inside the popover — narrows the visible
   *  options as the planner searches. Reset to empty whenever the
   *  dropdown closes so re-opening starts fresh. */
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    // Focus the search box on open so the planner can type immediately.
    const tid = window.setTimeout(() => { searchRef.current?.focus(); }, 0);
    return () => window.clearTimeout(tid);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  // Search-box is rendered for non-trivial option lists. Very short lists
  // (statuses, health) get the bare option buttons — typing to filter 4
  // rows reads as overkill.
  const showSearch = options.length > 5;
  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);
  return (
    <div ref={ref} className="group relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        className="flex h-6 w-full items-center gap-1 rounded-sm border border-slate-300 bg-white px-1.5 text-[11px] !text-slate-800 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300/40"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {value == null ? <span className="text-slate-500">{emptyLabel}</span> : renderOption(value)}
        </span>
        {value != null ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label={`Clear ${ariaLabel}`}
            title="Clear filter"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-300"
          >
            <XIcon className="size-3" aria-hidden />
          </span>
        ) : null}
        <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
      </button>
      {open ? (
        <div
          // `min-w-[14rem]` lets the popup breathe past the narrow
          // column cell that holds the trigger button — long option
          // labels (team names like "Data & analytics" or full
          // assignee names) need more horizontal room than the
          // typical 9–14% table column gives them. The popup still
          // anchors to the left edge of the trigger.
          className="absolute left-0 top-full z-50 mt-1 max-h-56 min-w-[14rem] overflow-hidden rounded border border-slate-200 bg-white text-slate-800 shadow-md"
        >
          {showSearch ? (
            <div className="sticky top-0 z-10 border-b border-slate-100 bg-white p-1">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => {
                  const next = e.target.value;
                  setQuery(next);
                  // Push the typed substring directly into the filter
                  // so the parent table updates live as the planner
                  // types — clears when the box is emptied. Picking a
                  // specific option afterward still overrides with the
                  // exact label.
                  onChange(next.length > 0 ? next : null);
                }}
                placeholder="Search…"
                aria-label={`Search ${ariaLabel}`}
                autoComplete="off"
                className="block h-6 w-full rounded-sm border border-slate-200 bg-white px-1.5 text-[11px] !text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300/40"
              />
            </div>
          ) : null}
          <div className="max-h-48 overflow-y-auto py-0.5">
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); }}
              className={cn("block w-full truncate px-2 py-1 text-left text-[11px] text-slate-800 hover:bg-slate-50", value == null && "bg-indigo-50 font-semibold")}
            >
              {emptyLabel}
            </button>
            {filteredOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                className={cn("block w-full truncate px-2 py-1 text-left text-[11px] text-slate-800 hover:bg-slate-50", value === opt && "bg-indigo-50 font-semibold")}
              >
                {renderOption(opt)}
              </button>
            ))}
            {showSearch && filteredOptions.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-slate-400">No matches.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
