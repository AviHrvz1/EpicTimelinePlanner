"use client";

import { AlertTriangle, Thermometer } from "lucide-react";
import { type ReactNode } from "react";

import { type CapacityLoadBasis } from "@/lib/capacity-load-basis";
import { capacityGaugeFluidStops } from "@/lib/capacity-thermometer";
import { cn } from "@/lib/utils";

export function TeamLoadSummary({
  teamLabel,
  teamLabelSlot,
  gradientKey,
  totalAssigned,
  totalCapacity,
  loadBasis = "originalEstimate",
  onLoadBasisChange,
}: {
  teamLabel: string;
  teamLabelSlot?: ReactNode;
  gradientKey: string;
  totalAssigned: number;
  totalCapacity: number;
  /** Which load figure drives this summary (matches per-bucket gauges). */
  loadBasis?: CapacityLoadBasis;
  /** When set, shows Est days / Σ Child toggle for capacity surfaces. */
  onLoadBasisChange?: (basis: CapacityLoadBasis) => void;
}) {
  const overCapacity = totalAssigned > totalCapacity;
  const utilization = totalCapacity > 0 ? (totalAssigned / totalCapacity) * 100 : totalAssigned > 0 ? 200 : 0;
  const thermometerPct = Math.max(0, Math.min(100, utilization));
  const stressRatio = totalCapacity > 0 ? totalAssigned / totalCapacity : 0;
  const fluidStops = capacityGaugeFluidStops(stressRatio);
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
    <section className="rounded-2xl border border-slate-200/90 bg-slate-50 px-4 py-3 shadow-sm shadow-slate-900/[0.04] ring-1 ring-slate-200/70">
      <div className="flex flex-nowrap items-center gap-2.5 sm:gap-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-indigo-200/60 bg-white/90 shadow-sm shadow-indigo-900/5">
            <Thermometer className="size-3.5 text-indigo-600/90" aria-hidden />
          </span>
          <h3 className="shrink-0 text-[14px] font-bold leading-tight text-slate-800 sm:text-[15px]">
            Team load
            <span className="font-semibold text-slate-400"> · </span>
          </h3>
          {teamLabelSlot ? (
            <div className="min-w-0">{teamLabelSlot}</div>
          ) : (
            <span className="min-w-0 truncate font-semibold text-slate-600">{teamLabel}</span>
          )}
        </div>

        <div
          className="flex w-[6.5rem] shrink-0 flex-col gap-0.5 sm:w-[11rem] md:w-[12.5rem]"
          aria-label="Team capacity gauge"
        >
          <p className="text-right text-[18px] font-bold leading-none tabular-nums text-slate-800 sm:text-[20px]">
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
                <stop offset="0%" stopColor={fluidStops.top} stopOpacity="1" />
                <stop offset="45%" stopColor={fluidStops.mid} stopOpacity="0.98" />
                <stop offset="100%" stopColor={fluidStops.bot} stopOpacity="1" />
              </linearGradient>
              <linearGradient id={`${fluidId}-sheen`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
                <stop offset="40%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="100%" stopColor="#0f172a" stopOpacity="0.06" />
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
              opacity="0.97"
            />
            <rect
              x={innerLeft}
              y="13"
              width={Math.max(0, fillW)}
              height="10"
              rx="5"
              fill={`url(#${fluidId}-sheen)`}
            />
          </svg>
          <p className="text-right text-[11px] font-semibold tabular-nums leading-none text-slate-600 sm:text-[12px]">
            {totalAssigned.toFixed(1)}d / {totalCapacity.toFixed(1)}d
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-200/80 pt-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[13px] font-semibold sm:text-[14px]">
          <span className="tabular-nums text-slate-800">{totalAssigned.toFixed(1)}d planned</span>
          <span className="text-slate-300/90">/</span>
          <span className="tabular-nums text-slate-600">{totalCapacity.toFixed(1)}d available</span>
          <span className="rounded-lg border border-slate-200/70 bg-white/80 px-2.5 py-0.5 text-[12px] font-bold tabular-nums text-slate-800 shadow-sm sm:text-[13px]">
            {Math.round(utilization)}% utilized
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-2.5 py-0.5 text-[12px] font-bold shadow-sm ring-1 sm:text-[13px]",
              statusClass,
            )}
          >
            {statusLabel}
            {overCapacity ? <AlertTriangle className="size-3.5 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden /> : null}
          </span>
        </div>
        {onLoadBasisChange ? (
          <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right sm:max-w-[min(22rem,100%)]">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Gauge &amp; totals</span>
            <div
              className="inline-flex shrink-0 rounded-lg border border-sky-200/90 bg-gradient-to-b from-sky-50 to-sky-100/90 p-0.5 shadow-sm ring-1 ring-sky-200/50"
              role="group"
              aria-label="Choose whether planned load uses epic Est days or Σ Child"
            >
              <button
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/90 focus-visible:ring-offset-1",
                  loadBasis === "originalEstimate"
                    ? "bg-gradient-to-br from-sky-400 via-blue-500 to-sky-500 text-white shadow-md shadow-sky-600/25 ring-1 ring-white/30"
                    : "text-sky-900/75 hover:bg-sky-200/90 hover:text-sky-950",
                )}
                aria-pressed={loadBasis === "originalEstimate"}
                onClick={() => onLoadBasisChange("originalEstimate")}
              >
                Est days
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/90 focus-visible:ring-offset-1",
                  loadBasis === "child"
                    ? "bg-gradient-to-br from-sky-400 via-blue-500 to-sky-500 text-white shadow-md shadow-sky-600/25 ring-1 ring-white/30"
                    : "text-sky-900/75 hover:bg-sky-200/90 hover:text-sky-950",
                )}
                aria-pressed={loadBasis === "child"}
                onClick={() => onLoadBasisChange("child")}
              >
                Σ Child
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
