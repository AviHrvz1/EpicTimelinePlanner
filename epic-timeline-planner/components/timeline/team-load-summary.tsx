"use client";

import { AlertTriangle, Thermometer } from "lucide-react";

import { cn } from "@/lib/utils";

export function TeamLoadSummary({
  teamLabel,
  gradientKey,
  totalAssigned,
  totalCapacity,
}: {
  teamLabel: string;
  gradientKey: string;
  totalAssigned: number;
  totalCapacity: number;
}) {
  const overCapacity = totalAssigned > totalCapacity;
  const utilization = totalCapacity > 0 ? (totalAssigned / totalCapacity) * 100 : totalAssigned > 0 ? 200 : 0;
  const thermometerPct = Math.max(0, Math.min(100, utilization));
  const fluidStops = overCapacity
    ? { top: "#fb7185", mid: "#ef4444", bot: "#b91c1c" }
    : utilization >= 85
      ? { top: "#fbbf24", mid: "#f59e0b", bot: "#b45309" }
      : { top: "#22d3ee", mid: "#14b8a6", bot: "#0f766e" };
  const statusLabel = overCapacity
    ? "Over capacity"
    : utilization >= 100
      ? "At capacity"
      : utilization >= 85
        ? "Tight"
        : "On track";
  const statusClass = overCapacity
    ? "bg-rose-50 text-rose-800 ring-rose-200/80"
    : utilization >= 100
      ? "bg-amber-50 text-amber-900 ring-amber-200/80"
      : utilization >= 85
        ? "bg-amber-50 text-amber-900 ring-amber-200/80"
        : "bg-emerald-50 text-emerald-900 ring-emerald-200/80";

  const trackId = `team-load-track-${gradientKey}`;
  const fluidId = `team-load-fluid-${gradientKey}`;

  const innerLeft = 12;
  const innerRight = 308;
  const innerW = innerRight - innerLeft;
  const fillW = (thermometerPct / 100) * innerW;

  return (
    <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-white via-slate-50/40 to-slate-50/90 px-3 py-2 shadow-sm ring-1 ring-slate-100/80">
      <div className="flex flex-nowrap items-center gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm">
            <Thermometer className="size-3.5 text-slate-700" aria-hidden />
          </span>
          <h3 className="min-w-0 truncate text-[13px] font-bold leading-tight text-slate-900">
            Team load
            <span className="font-semibold text-slate-400"> · </span>
            <span className="font-semibold text-slate-500">{teamLabel}</span>
          </h3>
        </div>

        <div
          className="flex w-[6.5rem] shrink-0 flex-col gap-0.5 sm:w-[11rem] md:w-[12.5rem]"
          aria-label="Team capacity gauge"
        >
          <p className="text-right text-[16px] font-bold leading-none tabular-nums text-slate-900 sm:text-[18px]">
            {Math.round(utilization)}%
          </p>
          <svg
            viewBox="0 0 320 36"
            className="h-5 w-full min-w-[6rem] sm:h-6"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <linearGradient id={trackId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#f8fafc" />
                <stop offset="100%" stopColor="#eef2f7" />
              </linearGradient>
              <linearGradient id={fluidId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={fluidStops.top} />
                <stop offset="52%" stopColor={fluidStops.mid} />
                <stop offset="100%" stopColor={fluidStops.bot} />
              </linearGradient>
            </defs>
            <rect x="4" y="8" width="312" height="20" rx="10" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.25" />
            <rect x="10" y="11" width="300" height="14" rx="7" fill={`url(#${trackId})`} stroke="#cbd5e1" strokeWidth="0.75" />
            {Array.from({ length: 10 }, (_, i) => {
              const x = innerLeft + (i / 9) * innerW;
              return <line key={i} x1={x} y1="26" x2={x} y2="31" stroke="#94a3b8" strokeWidth="1.25" opacity="0.9" />;
            })}
            <line
              x1={innerRight}
              x2={innerRight}
              y1="7"
              y2="29"
              stroke="#64748b"
              strokeWidth="1.25"
              strokeDasharray="2 2"
              opacity="0.9"
            />
            <rect
              x={innerLeft}
              y="13"
              width={Math.max(0, fillW)}
              height="10"
              rx="5"
              fill={`url(#${fluidId})`}
              opacity="0.95"
            />
          </svg>
          <p className="text-right text-[10px] font-semibold tabular-nums leading-none text-slate-500">
            {totalAssigned.toFixed(1)}d / {totalCapacity.toFixed(1)}d
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-200/80 pt-2 text-[12px] font-semibold">
        <span className="tabular-nums text-slate-800">{totalAssigned.toFixed(1)}d planned</span>
        <span className="text-slate-300">/</span>
        <span className="tabular-nums text-slate-600">{totalCapacity.toFixed(1)}d available</span>
        <span className="rounded-md bg-white px-2 py-0.5 text-[12px] font-bold tabular-nums text-slate-800 ring-1 ring-slate-200/90">
          {Math.round(utilization)}% utilized
        </span>
        <span className={cn("rounded-md px-2 py-0.5 text-[12px] font-bold ring-1", statusClass)}>{statusLabel}</span>
        {overCapacity ? (
          <span className="inline-flex items-center gap-1 text-rose-600">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
          </span>
        ) : null}
      </div>
    </section>
  );
}
