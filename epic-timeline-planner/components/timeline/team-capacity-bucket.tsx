"use client";

import { AlertTriangle, Users, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import { EpicPlanBarIcon } from "@/components/timeline/epic-plan-bar";
import { epicTimelineDraggableId } from "@/lib/epic-dnd-ids";
import { MONTH_TEAM_COLUMNS } from "@/lib/month-team-board";
import { cn } from "@/lib/utils";

export function TeamEpicCard({
  epicId,
  icon,
  title,
  initiativeTitle,
  childStoryEstimateDays,
  originalEstimateDays,
  planningLabel,
  executionStatusLabel,
  executionStatusClassName,
  onOpenEpic,
  onRemoveEpicFromCapacity,
  onOriginalEstimateChange,
}: {
  epicId: string;
  icon: string;
  title: string;
  initiativeTitle: string;
  childStoryEstimateDays: number;
  originalEstimateDays: number;
  planningLabel?: string;
  executionStatusLabel?: string;
  executionStatusClassName?: string;
  onOpenEpic: (epicId: string) => void;
  onRemoveEpicFromCapacity: (epicId: string) => void;
  onOriginalEstimateChange: (epicId: string, estimatedDays: number) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({
    id: epicTimelineDraggableId(epicId),
  });

  return (
    <article
      ref={setNodeRef}
      className={cn(
        "group relative min-h-[5.6rem] rounded-lg border border-slate-200/90 bg-white px-2.5 py-2 shadow-sm transition hover:border-slate-300 hover:shadow-md",
        isDragging && "opacity-60 shadow-lg",
      )}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 30 : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => onRemoveEpicFromCapacity(epicId)}
        className="absolute right-2 top-2 z-20 inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        aria-label="Remove epic from team capacity bucket"
        title="Clear team assignment"
      >
        <X className="size-3.5" aria-hidden />
      </button>
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 shrink-0 cursor-grab rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500 transition hover:bg-slate-100 active:cursor-grabbing"
          aria-label="Drag epic card"
          {...attributes}
          {...listeners}
        >
          ::
        </button>
        <div className="min-w-0 flex-1 pr-1.5">
          <button
            type="button"
            onClick={() => onOpenEpic(epicId)}
            className="block w-full truncate text-left text-[13px] font-semibold leading-snug text-slate-900 transition hover:text-blue-700"
          >
            <span className="mr-1.5 inline-flex align-middle text-slate-600">
              <EpicPlanBarIcon icon={icon} className="mr-0 text-slate-600 [&_svg]:text-slate-500" />
            </span>
            {title}
          </button>
          <p className="mt-0.5 truncate text-[11px] leading-snug text-slate-500">{initiativeTitle}</p>
          {(planningLabel || executionStatusLabel) && (
            <div className="mt-1.5 flex w-full flex-wrap justify-start gap-1.5">
              {planningLabel ? (
                <span className="inline-flex items-center rounded-md border border-violet-200/90 bg-violet-50 px-2 py-0.5 text-[10.5px] font-semibold text-violet-800">
                  {planningLabel}
                </span>
              ) : null}
              {executionStatusLabel ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-2 py-0.5 text-[10.5px] font-semibold",
                    executionStatusClassName ?? "border-blue-200/90 bg-blue-50 text-blue-800",
                  )}
                >
                  {executionStatusLabel}
                </span>
              ) : null}
            </div>
          )}
        </div>
        <div className="ml-auto flex w-[9.25rem] shrink-0 flex-col items-start gap-1.5 self-start pt-7">
          <div className="grid w-full grid-cols-[4.5rem_3.5rem] items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600">Σ Child</span>
            <span className="inline-flex h-6 w-[3.5rem] items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1.5 text-[11px] font-semibold text-slate-800 tabular-nums">
              {Math.round(childStoryEstimateDays)}
            </span>
          </div>
          <label className="grid w-full grid-cols-[4.5rem_3.5rem] items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <span>Est days</span>
            <input
              type="number"
              min={0}
              max={5000}
              step={1}
              value={originalEstimateDays}
              onChange={(event) => onOriginalEstimateChange(epicId, Math.max(0, Number(event.target.value || 0)))}
              className="h-6 w-[3.5rem] rounded-md border border-slate-200 bg-white px-1.5 text-center text-[11px] font-semibold text-slate-800 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
              aria-label="Original estimate days"
            />
          </label>
        </div>
      </div>
    </article>
  );
}

export function TeamCapacityBucket({
  team,
  teamLabelPrefix,
  cards,
  capacity,
  onCapacityChange,
  onOpenEpic,
  onRemoveEpicFromCapacity,
  onEpicOriginalEstimateChange,
  dropId,
  gaugeScaleMax,
  capacityInputMax,
}: {
  team: (typeof MONTH_TEAM_COLUMNS)[number];
  /** e.g. "Team:" — shown before `team.label` (quarter capacity). */
  teamLabelPrefix?: string;
  cards: Array<{
    epicId: string;
    icon: string;
    title: string;
    initiativeTitle: string;
    loadDays: number;
    childStoryEstimateDays: number;
    originalEstimateDays: number;
    planningLabel?: string;
    executionStatusLabel?: string;
    executionStatusClassName?: string;
  }>;
  capacity: number;
  onCapacityChange: (days: number) => void;
  onOpenEpic: (epicId: string) => void;
  onRemoveEpicFromCapacity: (epicId: string) => void;
  onEpicOriginalEstimateChange: (epicId: string, estimatedDays: number) => void;
  dropId: string;
  /** Thermometer “full scale” for the capacity marker (e.g. 60 for one month, 180 for a quarter). */
  gaugeScaleMax: number;
  capacityInputMax: number;
}) {
  const assignedTotal = cards.reduce((sum, c) => sum + c.loadDays, 0);
  const utilization = capacity > 0 ? (assignedTotal / capacity) * 100 : assignedTotal > 0 ? 200 : 0;
  const overCapacity = assignedTotal > capacity;
  const fillPct = Math.max(0, Math.min(100, capacity > 0 ? (assignedTotal / capacity) * 100 : 0));
  const gaugePct = Math.max(0, Math.min(100, utilization));
  const markerPct = Math.max(0, Math.min(100, gaugeScaleMax > 0 ? (capacity / gaugeScaleMax) * 100 : 0));
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  const gradientKey = team.id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const fluidStops = overCapacity
    ? { top: "#fb7185", mid: "#ef4444", bot: "#b91c1c" }
    : utilization >= 85
      ? { top: "#fbbf24", mid: "#f59e0b", bot: "#b45309" }
      : { top: "#22d3ee", mid: "#14b8a6", bot: "#0f766e" };
  const bucketFill =
    "linear-gradient(180deg, rgba(186,230,253,0.06) 0%, rgba(56,189,248,0.16) 45%, rgba(2,132,199,0.30) 100%)";
  const trackGradId = `tcap-track-${gradientKey}-${dropId.replace(/[^a-zA-Z0-9]+/g, "")}`;
  const fluidGradId = `tcap-fluid-${gradientKey}-${dropId.replace(/[^a-zA-Z0-9]+/g, "")}`;

  return (
    <section
      className={cn(
        "min-w-0 rounded-2xl border border-slate-200/85 bg-gradient-to-br from-slate-50/95 via-indigo-50/45 to-sky-100/55 p-3 shadow-sm ring-1 ring-indigo-100/40",
      )}
    >
      <div className="relative mb-2 flex min-h-8 items-center justify-end pr-0.5">
        <p
          className="pointer-events-none absolute left-1/2 top-1/2 flex max-w-[calc(100%-9rem)] items-center justify-center gap-1.5 pr-[84px] text-center text-[15px] font-bold text-slate-800"
          style={{ transform: "translate(-50%, -50%)" }}
        >
          <Users className="size-4 shrink-0 text-indigo-600/90" aria-hidden />
          <span className="truncate">
            {teamLabelPrefix ? (
              <>
                <span className="font-semibold text-slate-600">{teamLabelPrefix}</span> {team.label}
              </>
            ) : (
              team.label
            )}
          </span>
        </p>
        <label className="relative z-10 inline-flex items-center gap-1 text-[12px] font-semibold text-slate-600">
          Capacity
          <input
            type="number"
            min={0}
            max={capacityInputMax}
            step={1}
            value={capacity}
            onChange={(event) => onCapacityChange(Number(event.target.value || 0))}
            className="h-7 w-11 shrink-0 rounded-md border border-slate-200/90 bg-white/90 px-1 text-[11px] font-medium text-slate-800 shadow-sm"
          />
          d
        </label>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_56px] gap-2">
        <div
          ref={setNodeRef}
          className={cn(
            "relative flex h-[24rem] flex-col overflow-hidden rounded-2xl border border-slate-300/80 bg-white p-2 transition",
            isOver && "border-primary ring-2 ring-primary/20",
          )}
        >
          {/* Bucket SVG hidden for now — remove `hidden` from className to show again */}
          <img
            src="/images/sprint-capacity-bucket.svg"
            alt="Team capacity bucket"
            className="pointer-events-none absolute top-1 left-1/2 hidden h-[88%] w-[98%] -translate-x-1/2 object-contain opacity-30"
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] transition-all"
            style={{ height: `${fillPct}%`, background: bucketFill }}
          />
          <div className="relative z-20 flex min-h-0 flex-1 flex-col-reverse gap-2.5 overflow-y-auto pb-2 pt-1 capacity-bucket-scroll">
            {cards.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-200 bg-white/75 p-3 text-center text-[12px] font-medium text-slate-500">
                Drop epic here
              </p>
            ) : (
              cards.map((card) => (
                <TeamEpicCard
                  key={card.epicId}
                  {...card}
                  onOpenEpic={onOpenEpic}
                  onRemoveEpicFromCapacity={onRemoveEpicFromCapacity}
                  onOriginalEstimateChange={onEpicOriginalEstimateChange}
                />
              ))
            )}
          </div>
        </div>
        <div className="flex h-[24rem] flex-col items-center rounded-2xl border border-slate-200/90 bg-slate-50/80 p-2">
          <div className="text-center">
            <p className="text-[11px] font-semibold text-slate-600">Load</p>
            <p className="text-[13px] font-bold text-slate-700">{Math.round(utilization)}%</p>
          </div>
          <div className="flex flex-1 items-center py-1">
            <svg viewBox="0 0 84 292" className="h-full w-[4rem]" aria-label="Team capacity gauge">
              <defs>
                <linearGradient id={trackGradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f8fafc" />
                  <stop offset="100%" stopColor="#eef2f7" />
                </linearGradient>
                <linearGradient id={fluidGradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={fluidStops.top} />
                  <stop offset="52%" stopColor={fluidStops.mid} />
                  <stop offset="100%" stopColor={fluidStops.bot} />
                </linearGradient>
              </defs>
              <rect x="28" y="8" width="28" height="274" rx="14" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
              <rect x="34" y="16" width="16" height="242" rx="8" fill={`url(#${trackGradId})`} stroke="#cbd5e1" strokeWidth="1" />
              {Array.from({ length: 10 }, (_, i) => {
                const y = 258 - i * 24.2;
                return <line key={i} x1="56" y1={y} x2="66" y2={y} stroke="#94a3b8" strokeWidth="1.5" opacity="0.9" />;
              })}
              <line
                x1="24"
                x2="68"
                y1={258 - (markerPct / 100) * 242}
                y2={258 - (markerPct / 100) * 242}
                stroke="#64748b"
                strokeWidth="1.5"
                strokeDasharray="2 3"
                opacity="0.85"
              />
              <rect
                x="36"
                y={258 - (gaugePct / 100) * 242}
                width="12"
                height={(gaugePct / 100) * 242}
                rx="6"
                fill={`url(#${fluidGradId})`}
                opacity="0.95"
              />
              {overCapacity ? <AlertTriangle x={30} y={-25} className="size-4 text-rose-600" /> : null}
            </svg>
          </div>
          <div className="text-center text-[11px] font-semibold text-slate-600">
            <p>{assignedTotal.toFixed(1)}d</p>
            <p>/ {capacity.toFixed(1)}d</p>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[12px] font-semibold">
        <span className="inline-flex items-center gap-1 text-slate-600">{assignedTotal.toFixed(1)}d planned</span>
        <span className={cn("text-slate-500", overCapacity && "inline-flex items-center gap-1 text-rose-600")}>
          {overCapacity ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
          {capacity.toFixed(1)}d available ({Math.round(utilization)}%)
        </span>
      </div>
    </section>
  );
}
