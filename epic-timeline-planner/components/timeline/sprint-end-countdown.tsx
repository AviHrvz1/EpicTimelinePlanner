"use client";

import { CalendarDays, Clock, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { sprintEndDate, sprintStartDate, monthLaneFromGlobalSprint } from "@/lib/year-sprint";
import { cn } from "@/lib/utils";

const DAY_SHORT = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />

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

        {/* Progress bar */}
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-slate-700">Sprint progress</span>
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
            {todayInSprint && (
              <span className="font-bold text-indigo-600">{workingDaysLeft} working day{workingDaysLeft !== 1 ? "s" : ""} left of {totalWorkingDays}</span>
            )}
            <span>{MONTH_SHORT[end.getMonth()]} {end.getDate()}</span>
          </div>
        </div>

        {/* Day cells */}
        <div className="px-6 pt-7 pb-5">
          <div className="flex gap-2">
            {days.map((day, i) => {
              const dow = day.getDay();
              const isWeekend = dow === 0 || dow === 6;
              const isToday = isSameDay(day, today);
              const isPast = day < today && !isToday;

              return (
                <div
                  key={i}
                  className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5"
                >
                  {/* "Today" label */}
                  {isToday && (
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm shadow-indigo-300">
                      Today
                    </span>
                  )}

                  {/* Day name */}
                  <span
                    className={cn(
                      "text-[11px] font-semibold",
                      isWeekend ? "text-slate-400" : isToday ? "text-indigo-700" : isPast ? "text-slate-500" : "text-slate-700",
                    )}
                  >
                    {DAY_SHORT[dow]}
                  </span>

                  {/* Day number cell */}
                  <div
                    className={cn(
                      "flex w-full items-center justify-center rounded-lg py-2.5 text-[14px] font-bold tabular-nums transition-all",
                      isToday
                        ? "bg-gradient-to-b from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-300 ring-2 ring-indigo-200"
                        : isPast && !isWeekend
                          ? "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
                          : isPast && isWeekend
                            ? "bg-slate-50/60 text-slate-400 ring-1 ring-slate-100"
                            : isWeekend
                              ? "bg-slate-50/60 text-slate-400 ring-1 ring-slate-100"
                              : "bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-200",
                    )}
                  >
                    {day.getDate()}
                  </div>

                  {/* Dot indicator */}
                  <div
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      isToday
                        ? "bg-indigo-500 shadow-[0_0_5px_2px_rgba(99,102,241,0.4)]"
                        : isPast && !isWeekend
                          ? "bg-slate-300"
                          : "bg-transparent",
                    )}
                  />
                </div>
              );
            })}
          </div>

          {/* Today progress line */}
          {todayInSprint && (() => {
            const todayIndex = days.findIndex((d) => isSameDay(d, today));
            if (todayIndex < 0) return null;
            const pct = ((todayIndex + 0.5) / days.length) * 100;
            return (
              <div className="relative mt-3 h-1 w-full rounded-full bg-slate-100 ring-1 ring-slate-200/60">
                <div
                  className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-500"
                  style={{ width: `${pct}%` }}
                />
                <div
                  className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500 shadow-md ring-2 ring-white"
                  style={{ left: `${pct}%` }}
                />
              </div>
            );
          })()}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-5 border-t border-slate-200 bg-slate-50 px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="size-3 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm shadow-indigo-200" />
            <span className="text-[12px] font-medium text-slate-700">Today</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-3 rounded-sm bg-slate-100 ring-1 ring-slate-300" />
            <span className="text-[12px] font-medium text-slate-700">Past</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-3 rounded-sm bg-white ring-1 ring-slate-300" />
            <span className="text-[12px] font-medium text-slate-700">Upcoming</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-3 rounded-sm bg-slate-50/60 ring-1 ring-slate-200" />
            <span className="text-[12px] font-medium text-slate-500">Weekend</span>
          </div>
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
          "inline-flex h-7 max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-full bg-slate-200 px-2.5 text-[11px] font-semibold leading-none tracking-[0.02em] text-slate-800 ring-1 ring-slate-300 tabular-nums transition hover:bg-slate-300 hover:ring-slate-400 sm:gap-1.5 sm:px-3 sm:text-[12px]",
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
