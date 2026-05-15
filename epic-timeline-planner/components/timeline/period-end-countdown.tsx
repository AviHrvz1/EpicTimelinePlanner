"use client";

import { CalendarDays, Clock, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export type PeriodScope = "month" | "quarter" | "year";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function quarterOfMonth(month1Indexed: number): 1 | 2 | 3 | 4 {
  return (Math.ceil(month1Indexed / 3) as 1 | 2 | 3 | 4);
}
function quarterMonths(q: 1 | 2 | 3 | 4): [number, number] {
  return [((q - 1) * 3) + 1, q * 3];
}

function periodBounds(
  scope: PeriodScope,
  planYear: number,
  /** 1-indexed month for "month" scope; 1-4 for "quarter" scope. */
  index: number | null,
): { start: Date; end: Date; label: string; longLabel: string } {
  if (scope === "month" && index != null) {
    const m = Math.min(12, Math.max(1, index));
    const start = new Date(planYear, m - 1, 1);
    const lastDay = new Date(planYear, m, 0).getDate();
    const end = new Date(planYear, m - 1, lastDay, 23, 59, 59, 999);
    return {
      start,
      end,
      label: `${MONTH_SHORT[m - 1]} ${planYear}`,
      longLabel: `${MONTH_LONG[m - 1]} ${planYear}`,
    };
  }
  if (scope === "quarter" && index != null) {
    const q = Math.min(4, Math.max(1, index)) as 1 | 2 | 3 | 4;
    const [m1, m2] = quarterMonths(q);
    const start = new Date(planYear, m1 - 1, 1);
    const lastDay = new Date(planYear, m2, 0).getDate();
    const end = new Date(planYear, m2 - 1, lastDay, 23, 59, 59, 999);
    return {
      start,
      end,
      label: `Q${q} ${planYear}`,
      longLabel: `${MONTH_LONG[m1 - 1]} – ${MONTH_LONG[m2 - 1]} ${planYear}`,
    };
  }
  // year scope (default)
  const start = new Date(planYear, 0, 1);
  const end = new Date(planYear, 11, 31, 23, 59, 59, 999);
  return {
    start,
    end,
    label: `${planYear}`,
    longLabel: `${planYear} (Q1 – Q4)`,
  };
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Compact countdown string scaled to the period length. */
function formatPeriodRemainder(scope: PeriodScope, end: Date, now: number): { primary: string; ended: boolean } {
  const ms = end.getTime() - now;
  if (ms <= 0) return { primary: "Ended", ended: true };
  const days = Math.ceil(ms / 86400000);
  if (scope === "month") {
    return { primary: `${days} ${days === 1 ? "Day" : "Days"}`, ended: false };
  }
  if (scope === "quarter") {
    if (days >= 14) {
      const weeks = Math.floor(days / 7);
      const remDays = days - weeks * 7;
      return { primary: `${weeks}w · ${remDays}d`, ended: false };
    }
    return { primary: `${days} ${days === 1 ? "Day" : "Days"}`, ended: false };
  }
  // year
  if (days >= 60) {
    const months = Math.floor(days / 30);
    const remDays = days - months * 30;
    const weeks = Math.floor(remDays / 7);
    const tail = remDays - weeks * 7;
    return { primary: `${months}mo · ${weeks}w · ${tail}d`, ended: false };
  }
  if (days >= 14) {
    const weeks = Math.floor(days / 7);
    const remDays = days - weeks * 7;
    return { primary: `${weeks}w · ${remDays}d`, ended: false };
  }
  return { primary: `${days} ${days === 1 ? "Day" : "Days"}`, ended: false };
}

function workingDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const cur = startOfDay(start);
  const last = startOfDay(end);
  while (cur <= last) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ─── Timeline popup ─────────────────────────────────────────────────────────────

export function PeriodTimelinePopup({
  scope,
  planYear,
  index,
  onClose,
}: {
  scope: PeriodScope;
  planYear: number;
  index: number | null;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 160);
  }, [onClose]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [close]);

  const { start, end, label, longLabel } = periodBounds(scope, planYear, index);
  const today = startOfDay(new Date());
  const nowMs = Date.now();
  const totalMs = end.getTime() - start.getTime();
  const elapsedMs = Math.max(0, Math.min(totalMs, nowMs - start.getTime()));
  const progressPct = Math.round((elapsedMs / totalMs) * 100);

  // Tile granularity: month → days, quarter → months, year → quarters.
  type Tile = { primary: string; secondary?: string; isCurrent: boolean; isPast: boolean };
  const tiles: Tile[] = [];

  if (scope === "month" && index != null) {
    const m = index;
    const lastDay = new Date(planYear, m, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      const day = new Date(planYear, m - 1, d);
      const isCurrent = day.getFullYear() === today.getFullYear() && day.getMonth() === today.getMonth() && day.getDate() === today.getDate();
      const isPast = day < today && !isCurrent;
      const dow = day.getDay();
      const isWeekend = dow === 0 || dow === 6;
      tiles.push({
        primary: String(d),
        secondary: isWeekend ? "·" : undefined,
        isCurrent,
        isPast,
      });
    }
  } else if (scope === "quarter" && index != null) {
    const [m1, m2] = quarterMonths(index as 1 | 2 | 3 | 4);
    for (let m = m1; m <= m2; m++) {
      const monthStart = new Date(planYear, m - 1, 1);
      const monthEnd = new Date(planYear, m, 0);
      const isCurrent = today >= monthStart && today <= monthEnd;
      const isPast = monthEnd < today;
      tiles.push({
        primary: MONTH_SHORT[m - 1] ?? `M${m}`,
        secondary: `${monthStart.getDate()}–${monthEnd.getDate()}`,
        isCurrent,
        isPast,
      });
    }
  } else {
    // year
    for (let q = 1; q <= 4; q++) {
      const [m1, m2] = quarterMonths(q as 1 | 2 | 3 | 4);
      const qStart = new Date(planYear, m1 - 1, 1);
      const qEnd = new Date(planYear, m2, 0);
      const isCurrent = today >= qStart && today <= qEnd;
      const isPast = qEnd < today;
      tiles.push({
        primary: `Q${q}`,
        secondary: `${MONTH_SHORT[m1 - 1]}–${MONTH_SHORT[m2 - 1]}`,
        isCurrent,
        isPast,
      });
    }
  }

  const workingDaysLeft = scope === "month" ? workingDaysBetween(today > start ? today : start, end) : 0;
  const workingDaysTotal = scope === "month" ? workingDaysBetween(start, end) : 0;

  if (!mounted) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[9990] flex items-center justify-center p-4 transition-all duration-150",
        visible ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
      onClick={close}
    >
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />

      <div
        className={cn(
          "relative z-10 w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35),0_8px_20px_-8px_rgba(15,23,42,0.18)] ring-1 ring-black/5 transition-all duration-150",
          visible ? "scale-100 translate-y-0" : "scale-[0.97] translate-y-1",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-br from-indigo-50/80 via-white to-white px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md shadow-indigo-200 ring-1 ring-white">
              <CalendarDays className="size-5 text-white" />
            </div>
            <div>
              <p className="text-[16px] font-bold tracking-tight text-slate-900">
                {scope === "month" ? "Month" : scope === "quarter" ? "Quarter" : "Year"} timeline
                <span className="mx-2 text-slate-300 font-normal">·</span>
                <span className="font-semibold text-slate-700">{label}</span>
              </p>
              <p className="mt-0.5 text-[13px] font-medium text-slate-500">{longLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="flex size-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-slate-700">{scope === "month" ? "Month" : scope === "quarter" ? "Quarter" : "Year"} progress</span>
            <span className="text-[13px] font-bold text-slate-900 tabular-nums">{progressPct}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/60">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 shadow-[0_0_8px_rgba(99,102,241,0.3)] transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[12px] font-medium text-slate-500">
            <span>{MONTH_SHORT[start.getMonth()]} {start.getDate()}</span>
            {scope === "month" && progressPct < 100 && (
              <span className="font-bold text-indigo-600">{workingDaysLeft} working day{workingDaysLeft !== 1 ? "s" : ""} left of {workingDaysTotal}</span>
            )}
            <span>{MONTH_SHORT[end.getMonth()]} {end.getDate()}</span>
          </div>
        </div>

        {/* Tile grid */}
        <div className="px-6 pt-5 pb-5">
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${Math.min(tiles.length, scope === "month" ? 7 : tiles.length)}, minmax(0, 1fr))` }}
          >
            {tiles.map((tile, i) => (
              <div
                key={i}
                className={cn(
                  "flex flex-col items-center justify-center rounded-lg py-2.5 text-[14px] font-bold tabular-nums ring-1",
                  tile.isCurrent
                    ? "bg-gradient-to-b from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-300 ring-indigo-200"
                    : tile.isPast
                      ? "bg-slate-100 text-slate-500 ring-slate-200"
                      : "bg-white text-slate-800 ring-slate-200 hover:bg-indigo-50 hover:text-indigo-700",
                )}
              >
                <span>{tile.primary}</span>
                {tile.secondary && (
                  <span className={cn("mt-0.5 text-[10px] font-medium", tile.isCurrent ? "text-white/85" : "text-slate-400")}>
                    {tile.secondary}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer legend */}
        <div className="flex items-center gap-5 border-t border-slate-200 bg-slate-50 px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="size-3 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm shadow-indigo-200" />
            <span className="text-[12px] font-medium text-slate-700">Current</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-3 rounded-sm bg-slate-100 ring-1 ring-slate-300" />
            <span className="text-[12px] font-medium text-slate-700">Past</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-3 rounded-sm bg-white ring-1 ring-slate-300" />
            <span className="text-[12px] font-medium text-slate-700">Upcoming</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Toolbar clock chip ─────────────────────────────────────────────────────────

export function PeriodEndCountdown({
  scope,
  planYear,
  index,
}: {
  scope: PeriodScope;
  planYear: number;
  /** 1-indexed month (scope=month) or quarter number 1-4 (scope=quarter). Ignored for year. */
  index: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [popupOpen, setPopupOpen] = useState(false);
  useEffect(() => {
    // Days-level granularity — re-tick once a minute is plenty.
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const { end, label } = periodBounds(scope, planYear, index);
  const { primary, ended } = formatPeriodRemainder(scope, end, now);
  const scopeLabel = scope === "month" ? "Mo" : scope === "quarter" ? "Qtr" : "Yr";

  return (
    <>
      <button
        type="button"
        onClick={() => setPopupOpen(true)}
        title={`View ${scope} timeline · ${label}`}
        className={cn(
          "inline-flex h-7 max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-full bg-slate-200 px-2.5 text-[11px] font-semibold leading-none tracking-[0.02em] text-slate-800 ring-1 ring-slate-300 tabular-nums transition hover:bg-slate-300 hover:ring-slate-400 sm:gap-1.5 sm:px-3 sm:text-[12px]",
          ended && "text-slate-600",
        )}
      >
        <Clock className="size-3 shrink-0 text-slate-700 sm:size-3.5" strokeWidth={2.25} aria-hidden />
        <span className="text-slate-500">{scopeLabel}</span>
        <span aria-live="polite">{primary}</span>
      </button>
      {popupOpen && (
        <PeriodTimelinePopup scope={scope} planYear={planYear} index={index} onClose={() => setPopupOpen(false)} />
      )}
    </>
  );
}
