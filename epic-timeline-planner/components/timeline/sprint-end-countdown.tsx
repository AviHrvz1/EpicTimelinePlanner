"use client";

import { CalendarCheck2, CalendarDays, Clock, Send, Sun, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { sprintEndDate, sprintStartDate, monthLaneFromGlobalSprint } from "@/lib/year-sprint";
import { cn } from "@/lib/utils";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRemainder(ms: number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  ended: boolean;
} {
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, ended: true };
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const remAfterDays = s % 86400;
  const hours = Math.floor(remAfterDays / 3600);
  const remAfterHours = remAfterDays % 3600;
  const minutes = Math.floor(remAfterHours / 60);
  const seconds = remAfterHours % 60;
  return { days, hours, minutes, seconds, ended: false };
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function SprintTimelinePopup({
  planYear,
  yearSprint,
  onClose,
}: {
  planYear: number;
  yearSprint: number;
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

  const start = sprintStartDate(planYear, yearSprint);
  const end = sprintEndDate(planYear, yearSprint);
  const today = new Date();
  const nowMs = Date.now();

  // Build list of days in sprint
  const totalMs = end.getTime() - start.getTime();
  const elapsedMs = Math.max(0, Math.min(totalMs, nowMs - start.getTime()));
  const progressPct = Math.round((elapsedMs / totalMs) * 100);

  const days: Date[] = [];
  let cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  while (cursor <= endDay) {
    days.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }

  const todayInSprint = days.some((d) => isSameDay(d, today));
  const { month, lane } = monthLaneFromGlobalSprint(yearSprint);

  const workingDaysLeft = days.filter((d) => {
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isFutureOrToday = d >= today;
    return !isWeekend && isFutureOrToday;
  }).length;

  const totalWorkingDays = days.filter((d) => {
    const dow = d.getDay();
    return dow !== 0 && dow !== 6;
  }).length;

  const formatDateRange = `${MONTH_SHORT[start.getMonth()]} ${start.getDate()} – ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}, ${planYear}`;

  if (!mounted) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[9990] flex items-center justify-center p-4 transition-all duration-150",
        visible ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
      onClick={close}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px]" />

      {/* Card */}
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
                Sprint {yearSprint}
                <span className="mx-2 text-slate-300 font-normal">·</span>
                <span className="font-semibold text-slate-700">{MONTH_SHORT[month - 1]} {lane === 1 ? "1st half" : "2nd half"}</span>
              </p>
              <p className="mt-0.5 text-[13px] font-medium text-slate-500">{formatDateRange}</p>
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

        {/* Progress bar + circular % badge */}
        <div className="border-b border-slate-100 px-8 pb-5 pt-6">
          <div className="flex items-center gap-6">
            <div className="min-w-0 flex-1">
              <div className="mb-3 text-[14px] font-semibold text-slate-800">Sprint Progress</div>
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/60">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 shadow-[0_0_10px_rgba(99,102,241,0.4)] transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {todayInSprint && (
                <div className="mt-3 text-center text-[13px] font-bold text-indigo-600">
                  {workingDaysLeft} working day{workingDaysLeft !== 1 ? "s" : ""} left of {totalWorkingDays}
                </div>
              )}
            </div>

            {/* Circular % badge */}
            <div
              className="relative flex size-[72px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 via-indigo-500 to-violet-600 text-white shadow-xl shadow-indigo-500/40 ring-[3px] ring-white"
              aria-label={`${progressPct}% complete`}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-1 rounded-full bg-gradient-to-b from-white/30 to-transparent"
              />
              <span className="relative flex items-baseline gap-[1px] text-[22px] font-extrabold leading-none tabular-nums tracking-tight">
                {progressPct}
                <span className="text-[13px] font-bold opacity-90">%</span>
              </span>
            </div>
          </div>
        </div>

        {/* Day cells */}
        <div className="px-8 pt-10 pb-6">
          <div className="flex gap-2.5">
            {days.map((day, i) => {
              const dow = day.getDay();
              const isWeekend = dow === 0 || dow === 6;
              const isToday = isSameDay(day, today);
              const isPast = day < today && !isToday;

              return (
                <div
                  key={i}
                  className="relative flex min-w-0 flex-1 flex-col items-center gap-2"
                >
                  {/* "Today" pill */}
                  {isToday && (
                    <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 px-3 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-white shadow-md shadow-indigo-400/50">
                      Today
                    </span>
                  )}

                  {/* Day name */}
                  <span
                    className={cn(
                      "text-[12px] font-semibold tracking-tight",
                      isWeekend ? "text-slate-400" : isToday ? "text-indigo-700" : isPast ? "text-slate-500" : "text-slate-700",
                    )}
                  >
                    {DAY_SHORT[dow]}
                  </span>

                  {/* Day number cell — taller, softer shadow, more "card" feel */}
                  <div
                    className={cn(
                      "flex w-full items-center justify-center rounded-xl py-3.5 text-[16px] font-extrabold tabular-nums tracking-tight transition-all",
                      isToday
                        ? "bg-gradient-to-b from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-400/40 ring-2 ring-white"
                        : isPast && !isWeekend
                          ? "bg-slate-100 text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ring-1 ring-slate-200/60"
                          : isPast && isWeekend
                            ? "bg-slate-50 text-slate-300 ring-1 ring-slate-100"
                            : isWeekend
                              ? "bg-slate-50 text-slate-400 ring-1 ring-slate-100"
                              : "bg-white text-slate-800 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70 hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-200",
                    )}
                  >
                    {day.getDate()}
                  </div>

                  {/* Dot indicator */}
                  <div
                    className={cn(
                      "size-1.5 rounded-full",
                      isToday
                        ? "bg-indigo-500 shadow-[0_0_6px_2px_rgba(99,102,241,0.5)]"
                        : isPast && !isWeekend
                          ? "bg-slate-300"
                          : "bg-transparent",
                    )}
                  />
                </div>
              );
            })}
          </div>

          {/* Today progress scrubber */}
          {todayInSprint && (() => {
            const todayIndex = days.findIndex((d) => isSameDay(d, today));
            if (todayIndex < 0) return null;
            const pct = ((todayIndex + 0.5) / days.length) * 100;
            return (
              <div className="relative mt-4 h-1.5 w-full rounded-full bg-slate-100 ring-1 ring-slate-200/60">
                <div
                  className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-500"
                  style={{ width: `${pct}%` }}
                />
                <div
                  className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500 shadow-md ring-[3px] ring-white"
                  style={{ left: `${pct}%` }}
                />
              </div>
            );
          })()}
        </div>

        {/* Footer — legend chips with flat colored icons */}
        <div className="flex flex-wrap items-center gap-6 border-t border-slate-200 bg-slate-50/80 px-8 py-4">
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-800">
            <Clock className="size-4 text-indigo-600" strokeWidth={2.25} aria-hidden />
            Today
          </span>
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-800">
            <CalendarCheck2 className="size-4 text-slate-600" strokeWidth={2.25} aria-hidden />
            Past
          </span>
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-800">
            <Send className="size-4 text-sky-600" strokeWidth={2.25} aria-hidden />
            Upcoming
          </span>
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-800">
            <Sun className="size-4 text-amber-500" strokeWidth={2.25} aria-hidden />
            Weekend
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function SprintEndCountdown({ planYear, yearSprint }: { planYear: number; yearSprint: number }) {
  const [now, setNow] = useState(() => Date.now());
  const [popupOpen, setPopupOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const end = sprintEndDate(planYear, yearSprint);
  const parts = formatRemainder(end.getTime() - now);

  return (
    <>
      <button
        type="button"
        onClick={() => setPopupOpen(true)}
        className={cn(
          "inline-flex h-7 max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-full bg-[aliceblue] px-2.5 text-[11px] font-semibold leading-none tracking-[0.02em] text-slate-800 ring-1 ring-sky-200 tabular-nums transition hover:bg-sky-100 hover:ring-sky-300 sm:gap-1.5 sm:px-3 sm:text-[12px]",
          parts.ended && "text-slate-600",
        )}
        title="View sprint timeline"
      >
        <Clock className="size-3 shrink-0 text-slate-700 sm:size-3.5" strokeWidth={2.25} aria-hidden />
        <span className="text-slate-500">Left</span>
        <span className="min-w-0 truncate" aria-live="polite">
          {parts.ended ? (
            "Sprint ended"
          ) : (
            <>
              <span>{parts.days}d</span>
              <span className="px-0.5 text-slate-500" aria-hidden>·</span>
              <span>{parts.hours}h</span>
              <span className="px-0.5 text-slate-500" aria-hidden>·</span>
              <span>{String(parts.minutes).padStart(2, "0")}m</span>
              <span className="px-0.5 text-slate-500" aria-hidden>·</span>
              <span>{String(parts.seconds).padStart(2, "0")}s</span>
            </>
          )}
        </span>
      </button>

      {popupOpen && (
        <SprintTimelinePopup
          planYear={planYear}
          yearSprint={yearSprint}
          onClose={() => setPopupOpen(false)}
        />
      )}
    </>
  );
}
