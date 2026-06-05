"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { FULL_MONTH_NAMES } from "@/lib/timeline";

type Props = {
  /** ISO YYYY-MM-DD value to highlight; empty string = no selection. */
  value: string;
  /** Earliest date the user can pick; empty string disables the lower bound. */
  min?: string;
  /** Anchor element the popover positions itself under. */
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onChange: (next: string) => void;
  onClose: () => void;
  /** Defaults to today. Used to choose which month to open on first show when value is empty. */
  fallbackYear?: number;
  fallbackMonth1?: number;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoOf(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseIso(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function startOfMonth(year: number, month0: number) {
  return new Date(year, month0, 1);
}
function daysInMonth(year: number, month0: number) {
  return new Date(year, month0 + 1, 0).getDate();
}

/** 1-7 with Monday = 1, Sunday = 7 (ISO week). */
function isoDayOfWeek(d: Date) {
  return ((d.getDay() + 6) % 7) + 1;
}

function quarterOfMonth(month1: number): 1 | 2 | 3 | 4 {
  if (month1 <= 3) return 1;
  if (month1 <= 6) return 2;
  if (month1 <= 9) return 3;
  return 4;
}

export function TimelineDatePopover({
  value,
  min,
  anchorRef,
  open,
  onChange,
  onClose,
  fallbackYear,
  fallbackMonth1,
}: Props) {
  const selected = useMemo(() => parseIso(value), [value]);
  const minDate = useMemo(() => (min ? parseIso(min) : null), [min]);

  // Which month the calendar is currently displaying. Initialized from value
  // when open, then user can navigate freely.
  const [view, setView] = useState(() => {
    const base = selected ?? new Date(fallbackYear ?? new Date().getFullYear(), (fallbackMonth1 ?? 1) - 1, 1);
    return { year: base.getFullYear(), month0: base.getMonth() };
  });
  useEffect(() => {
    if (!open) return;
    const base = selected ?? new Date(fallbackYear ?? new Date().getFullYear(), (fallbackMonth1 ?? 1) - 1, 1);
    setView({ year: base.getFullYear(), month0: base.getMonth() });
  }, [open, selected, fallbackYear, fallbackMonth1]);

  // Anchor positioning — opens UPWARD from the anchor's top edge. Falls
  // back to a fixed 300px height estimate on the first paint (the popover
  // is fixed-size: 6-week grid + headers + Q chip), then re-measures and
  // snaps to the actual height once mounted.
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    function updatePos() {
      const a = anchorRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const popoverWidth = 264;
      const desiredLeft = Math.min(window.innerWidth - popoverWidth - 8, Math.max(8, r.left));
      const measuredHeight = popoverRef.current?.offsetHeight ?? 0;
      const popoverHeight = measuredHeight > 0 ? measuredHeight : 300;
      const desiredTop = Math.max(8, r.top - popoverHeight - 6);
      setPosition({ top: desiredTop, left: desiredLeft });
    }
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open, anchorRef]);
  // Re-measure once mounted so the popover snaps to its true height
  // (rather than the initial 300px estimate).
  useLayoutEffect(() => {
    if (!open) return;
    const a = anchorRef.current;
    const popover = popoverRef.current;
    if (!a || !popover) return;
    const r = a.getBoundingClientRect();
    const measured = popover.offsetHeight;
    if (measured <= 0) return;
    const popoverWidth = 264;
    const desiredLeft = Math.min(window.innerWidth - popoverWidth - 8, Math.max(8, r.left));
    setPosition({ top: Math.max(8, r.top - measured - 6), left: desiredLeft });
  }, [open, anchorRef]);

  // Click-outside / Escape close.
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, anchorRef, onClose]);

  if (!open || position == null) return null;
  if (typeof document === "undefined") return null;

  const monthStart = startOfMonth(view.year, view.month0);
  const firstWeekday = isoDayOfWeek(monthStart); // 1-7 (Mon-Sun)
  const days = daysInMonth(view.year, view.month0);

  // Build a flat grid: leading blanks + day numbers, padded to 42 cells (6 weeks).
  const cells: Array<{ day: number | null; iso: string | null }> = [];
  for (let i = 1; i < firstWeekday; i++) cells.push({ day: null, iso: null });
  for (let d = 1; d <= days; d++) {
    cells.push({ day: d, iso: isoOf(new Date(view.year, view.month0, d)) });
  }
  while (cells.length < 42) cells.push({ day: null, iso: null });

  const quarter = quarterOfMonth(view.month0 + 1);
  const selectedIso = selected ? isoOf(selected) : null;
  const minIso = minDate ? isoOf(minDate) : null;

  function goto(deltaMonths: number) {
    setView((prev) => {
      const next = new Date(prev.year, prev.month0 + deltaMonths, 1);
      return { year: next.getFullYear(), month0: next.getMonth() };
    });
  }

  function isDisabled(iso: string | null) {
    if (!iso || !minIso) return false;
    return iso < minIso;
  }

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Pick a date"
      className="fixed z-[9800] w-[264px] rounded-xl border border-slate-200 bg-white p-3 shadow-[0_24px_60px_-10px_rgba(15,23,42,0.35),0_8px_20px_-8px_rgba(15,23,42,0.25)]"
      style={{ top: position.top, left: position.left }}
    >
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => goto(-1)}
          aria-label="Previous month"
          className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <div className="text-[13px] font-semibold text-slate-800">
          {FULL_MONTH_NAMES[view.month0]} {view.year}
        </div>
        <button
          type="button"
          onClick={() => goto(1)}
          aria-label="Next month"
          className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>

      {/* Quarter label above the month grid — per design spec. */}
      <div className="mb-2 flex justify-center">
        <span className="inline-flex h-5 items-center rounded-full bg-indigo-50 px-2 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
          Q{quarter}
        </span>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <span>M</span>
        <span>T</span>
        <span>W</span>
        <span>T</span>
        <span>F</span>
        <span>S</span>
        <span>S</span>
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-0.5 text-[12px]">
        {cells.map((cell, idx) => {
          if (cell.day == null) return <span key={`pad-${idx}`} className="h-7" />;
          const isSelected = cell.iso === selectedIso;
          const disabled = isDisabled(cell.iso);
          return (
            <button
              key={cell.iso}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (!cell.iso) return;
                onChange(cell.iso);
                onClose();
              }}
              className={
                "mx-auto inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors " +
                (isSelected
                  ? "bg-indigo-600 font-semibold text-white shadow-sm"
                  : disabled
                    ? "cursor-not-allowed text-slate-300"
                    : "text-slate-700 hover:bg-indigo-50 hover:text-indigo-700")
              }
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
