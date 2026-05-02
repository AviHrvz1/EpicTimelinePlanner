"use client";

import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

import { sprintEndDate } from "@/lib/year-sprint";
import { cn } from "@/lib/utils";

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

export function SprintEndCountdown({ planYear, yearSprint }: { planYear: number; yearSprint: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const end = sprintEndDate(planYear, yearSprint);
  const parts = formatRemainder(end.getTime() - now);

  return (
    <div
      className={cn(
        "inline-flex h-7 max-w-full shrink-0 items-center gap-1 rounded-full bg-slate-200 px-2.5 text-[11px] font-semibold leading-none tracking-[0.02em] text-slate-800 ring-1 ring-slate-300 tabular-nums sm:gap-1.5 sm:px-3 sm:text-[12px]",
        parts.ended && "text-slate-600",
      )}
      title={parts.ended ? "Sprint window has ended" : `Sprint ends ${end.toLocaleString()}`}
    >
      <Clock className="size-3 shrink-0 text-slate-700 sm:size-3.5" strokeWidth={2.25} aria-hidden />
      <span className="min-w-0 truncate" aria-live="polite">
        {parts.ended ? (
          "Sprint ended"
        ) : (
          <>
            <span>{parts.days}d</span>
            <span className="px-0.5 text-slate-500" aria-hidden>
              ·
            </span>
            <span>{parts.hours}h</span>
            <span className="px-0.5 text-slate-500" aria-hidden>
              ·
            </span>
            <span>{String(parts.minutes).padStart(2, "0")}m</span>
            <span className="px-0.5 text-slate-500" aria-hidden>
              ·
            </span>
            <span>{String(parts.seconds).padStart(2, "0")}s</span>
          </>
        )}
      </span>
    </div>
  );
}
