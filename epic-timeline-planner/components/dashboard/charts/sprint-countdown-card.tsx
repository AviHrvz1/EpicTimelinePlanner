"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";

import { sprintEndDate, sprintStartDate, monthLaneFromGlobalSprint } from "@/lib/year-sprint";
import { cn } from "@/lib/utils";

type Props = {
  year: number;
  /** 1-24 year-sprint index. */
  sprint: number;
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRemainder(ms: number): { days: number; hours: number; minutes: number; seconds: number; ended: boolean } {
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, ended: true };
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const r1 = s % 86400;
  const hours = Math.floor(r1 / 3600);
  const r2 = r1 % 3600;
  const minutes = Math.floor(r2 / 60);
  const seconds = r2 % 60;
  return { days, hours, minutes, seconds, ended: false };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Dashboard gadget — flip-clock style sprint countdown.
 * Four dark tiles (days / hours / minutes / seconds) with a horizontal flip-divider,
 * top-light gloss, and a colon between each tile. Re-renders every second.
 */
export function SprintCountdownCard({ year, sprint }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const start = sprintStartDate(year, sprint);
  const end = sprintEndDate(year, sprint);
  const { days, hours, minutes, seconds, ended } = formatRemainder(end.getTime() - now);
  const { month, lane } = monthLaneFromGlobalSprint(sprint);
  const totalMs = end.getTime() - start.getTime();
  const elapsedMs = Math.max(0, Math.min(totalMs, now - start.getTime()));
  const pct = Math.round((elapsedMs / totalMs) * 100);
  const urgent = !ended && days <= 1;
  const dateRange = `${MONTH_SHORT[start.getMonth()]} ${start.getDate()} – ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}, ${year}`;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-gradient-to-br from-blue-50 via-violet-50 to-pink-50 p-3 ring-1 ring-violet-100">
      {/* Soft glow accents — on-brand violet/pink */}
      <div className="pointer-events-none absolute -left-12 -top-12 size-40 rounded-full bg-violet-300/25 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -right-12 -bottom-12 size-44 rounded-full bg-pink-300/25 blur-3xl" aria-hidden />

      <div className="relative z-[1] flex w-full items-center justify-between gap-2 text-[11px] font-medium text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="size-3.5 text-indigo-500" aria-hidden />
          Sprint {sprint} · {MONTH_SHORT[month - 1]} {lane === 1 ? "1st half" : "2nd half"}
        </span>
        <span className="tabular-nums text-slate-500">{dateRange}</span>
      </div>

      {/* Caption */}
      <p className="relative z-[1] mt-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {ended ? "This sprint has wrapped" : "Time left until sprint ends"}
      </p>

      {/* Flip-clock tiles */}
      <div className="relative z-[1] flex flex-1 items-center justify-center">
        {ended ? (
          <span className="text-[20px] font-bold tracking-tight text-slate-500">Sprint has ended</span>
        ) : (
          <div className="flex items-end gap-2 sm:gap-3">
            <Tile value={pad(days)} label="DAYS" urgent={urgent} />
            <Colon />
            <Tile value={pad(hours)} label="HOURS" urgent={urgent} />
            <Colon />
            <Tile value={pad(minutes)} label="MINUTES" urgent={urgent} />
            <Colon />
            <Tile value={pad(seconds)} label="SECONDS" urgent={urgent} />
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="relative z-[1] mt-2">
        <div className="mb-1 flex items-center justify-between text-[10px] font-medium text-slate-500">
          <span>Sprint progress</span>
          <span className="tabular-nums font-semibold text-slate-700">{pct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/80 ring-1 ring-violet-100">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              urgent
                ? "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500"
                : "bg-gradient-to-r from-indigo-500 to-violet-500",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Tile({ value, label, urgent }: { value: string; label: string; urgent: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          "relative flex h-[64px] w-[68px] items-center justify-center overflow-hidden rounded-xl shadow-md transition-colors sm:h-[72px] sm:w-[76px]",
          // Tile body always uses the project's violet → indigo gradient.
          // Urgency is indicated by a colored ring + glow shadow + a tiny pulse dot, not by recoloring the whole tile.
          "bg-gradient-to-b from-violet-600 to-indigo-700",
          urgent
            ? "shadow-rose-400/40 ring-2 ring-rose-400/60"
            : "shadow-violet-400/30 ring-1 ring-violet-300/60",
        )}
      >
        {/* Top gloss */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-xl bg-gradient-to-b from-white/22 to-transparent" aria-hidden />
        {/* Horizontal flip divider */}
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-px bg-black/25" aria-hidden />
        {urgent && (
          <span className="pointer-events-none absolute right-1.5 top-1.5 inline-flex size-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-rose-300/80" aria-hidden />
            <span className="relative inline-flex size-1.5 rounded-full bg-rose-300" aria-hidden />
          </span>
        )}
        <span
          className="relative z-[1] text-[34px] font-bold leading-none tabular-nums tracking-tight text-white sm:text-[40px]"
          style={{ fontFamily: "ui-rounded, system-ui, -apple-system, BlinkMacSystemFont, sans-serif" }}
        >
          {value}
        </span>
      </div>
      <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-indigo-700/85 sm:text-[10px]">{label}</span>
    </div>
  );
}

function Colon() {
  return (
    <div className="mb-5 flex flex-col items-center justify-center gap-1.5 sm:mb-6" aria-hidden>
      <span className="size-1.5 rounded-full bg-violet-400" />
      <span className="size-1.5 rounded-full bg-violet-400" />
    </div>
  );
}
