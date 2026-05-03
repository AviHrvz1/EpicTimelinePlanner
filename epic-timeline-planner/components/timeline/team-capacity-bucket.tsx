"use client";

import { AlertTriangle, Info, Maximize2, Minimize2, Users, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import { EpicPlanBarIcon } from "@/components/timeline/epic-plan-bar";
import { epicTimelineDraggableId } from "@/lib/epic-dnd-ids";
import { MONTH_TEAM_COLUMNS } from "@/lib/month-team-board";
import { cn } from "@/lib/utils";

/** Compact number fields: hide spinners so read-only and editable cells share identical text alignment. */
const CAPACITY_DAYS_INPUT_NO_SPIN =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

const CAPACITY_ROLLUP_INFO_TOOLTIP_CLASS =
  "pointer-events-none absolute left-1/2 top-0 z-[320] w-56 max-w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-normal rounded-lg border border-indigo-200/80 bg-white px-2.5 py-2 text-[12px] font-medium leading-snug text-slate-700 opacity-0 shadow-md ring-1 ring-slate-200/80 transition-opacity duration-150";

const rollupOverCapacityPill =
  "inline-flex items-center gap-0.5 rounded-sm bg-rose-600 px-1 py-px text-[12px] leading-tight text-white";

const ROLLUP_OVER_CAP_TOOLTIP_BASE =
  "pointer-events-none absolute bottom-full left-1/2 z-[340] mb-1 w-52 max-w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 whitespace-normal rounded-md border border-rose-200 bg-white px-2 py-1.5 text-[11px] font-medium leading-snug text-slate-700 opacity-0 shadow-md ring-1 ring-slate-200/80 transition-opacity duration-150";

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
        "group relative min-h-[5rem] shrink-0 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1.5 shadow-sm transition hover:border-slate-300 hover:shadow-md",
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
        className="absolute right-2 top-2 z-30 inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        aria-label="Remove epic from team capacity bucket"
        title="Clear team assignment"
      >
        <X className="size-3.5" aria-hidden />
      </button>
      <div className="flex flex-col gap-2 @min-[22rem]:grid @min-[22rem]:grid-cols-[auto_minmax(0,1fr)_minmax(9.5rem,auto)] @min-[22rem]:items-start @min-[22rem]:gap-x-2 @min-[22rem]:gap-y-0">
        <div className="flex min-w-0 items-start gap-2 @min-[22rem]:contents">
          <button
            type="button"
            className="mt-0.5 shrink-0 cursor-grab rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500 transition hover:bg-slate-100 active:cursor-grabbing"
            aria-label="Drag epic card"
            {...attributes}
            {...listeners}
          >
            ::
          </button>
          <div className="min-w-0 flex-1 pr-10">
            <button
              type="button"
              onClick={() => onOpenEpic(epicId)}
              className="block w-full text-left text-[13px] font-semibold leading-snug text-slate-900 transition hover:text-blue-700 @min-[22rem]:truncate"
            >
              <span className="mr-1.5 inline-flex align-middle text-slate-600">
                <EpicPlanBarIcon icon={icon} className="mr-0 text-slate-600 [&_svg]:text-slate-500" />
              </span>
              {title}
            </button>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500 @min-[22rem]:truncate">{initiativeTitle}</p>
            {(planningLabel || executionStatusLabel) && (
              <div className="mt-1 flex w-full flex-wrap justify-start gap-1.5">
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
        </div>
        <div className="relative z-10 flex w-full min-w-0 shrink-0 flex-col items-start gap-1 pt-0 @min-[22rem]:col-start-3 @min-[22rem]:row-start-1 @min-[22rem]:ml-auto @min-[22rem]:w-auto @min-[22rem]:justify-self-end @min-[22rem]:pt-6">
          <div className="grid w-full max-w-[9.5rem] grid-cols-[3.5rem_3.5rem] items-center gap-x-1.5 @min-[22rem]:max-w-none">
            <span className="text-right text-[11px] font-semibold text-slate-600">Σ Child</span>
            <input
              type="number"
              readOnly
              tabIndex={-1}
              value={Math.round(childStoryEstimateDays)}
              title="Sum of child user story estimates — edit estimates on each story"
              aria-label="Sum of child story estimate days (read-only)"
              aria-readonly="true"
              className={cn(
                "h-[1.375rem] w-[3.5rem] shrink-0 cursor-default rounded-md border border-slate-200 bg-slate-50 px-1.5 text-center text-[11px] font-semibold text-slate-700 tabular-nums focus:outline-none",
                CAPACITY_DAYS_INPUT_NO_SPIN,
              )}
            />
          </div>
          <label className="grid w-full max-w-[9.5rem] grid-cols-[3.5rem_3.5rem] items-center gap-x-1.5 text-[11px] font-semibold text-slate-600 @min-[22rem]:max-w-none">
            <span className="text-right">Est days</span>
            <input
              type="number"
              min={0}
              max={5000}
              step={1}
              value={originalEstimateDays}
              onChange={(event) => onOriginalEstimateChange(epicId, Math.max(0, Number(event.target.value || 0)))}
              className={cn(
                "h-[1.375rem] w-[3.5rem] shrink-0 rounded-md border border-slate-200 bg-white px-1.5 text-center text-[11px] font-semibold text-slate-800 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100",
                CAPACITY_DAYS_INPUT_NO_SPIN,
              )}
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
  panelExpandable = false,
  isPanelExpanded = false,
  onExpandPanel,
  onCollapsePanel,
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
  /** When true and callbacks are set, header shows expand to fill the board (other buckets hidden). */
  panelExpandable?: boolean;
  isPanelExpanded?: boolean;
  onExpandPanel?: () => void;
  onCollapsePanel?: () => void;
}) {
  const assignedTotal = cards.reduce((sum, c) => sum + c.loadDays, 0);
  const sumChildStoryEstimates = cards.reduce((sum, c) => sum + c.childStoryEstimateDays, 0);
  const sumOriginalEstimates = cards.reduce((sum, c) => sum + c.originalEstimateDays, 0);
  const childSumOverCapacity = sumChildStoryEstimates > capacity;
  const estSumOverCapacity = sumOriginalEstimates > capacity;
  const utilization = capacity > 0 ? (assignedTotal / capacity) * 100 : assignedTotal > 0 ? 200 : 0;
  const fillPct = Math.max(0, Math.min(100, capacity > 0 ? (assignedTotal / capacity) * 100 : 0));
  /**
   * Fluid height = worst case of Σ Est or Σ Child vs team Capacity (not vs period max days).
   * Capped at 100% so e.g. 11d vs 1d capacity reads as a full bar, not 11/60 of the tube.
   */
  const childUtilizationPct =
    capacity > 0 ? (sumChildStoryEstimates / capacity) * 100 : sumChildStoryEstimates > 0 ? 200 : 0;
  const gaugeFillPct = Math.max(0, Math.min(100, Math.max(utilization, childUtilizationPct)));
  /** Dashed line: where this team’s Capacity sits on the period scale (days). */
  const markerPct = Math.max(0, Math.min(100, gaugeScaleMax > 0 ? (capacity / gaugeScaleMax) * 100 : 0));
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  const gradientKey = team.id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const thermometerOverCapacity = estSumOverCapacity || childSumOverCapacity;
  const fluidStops = thermometerOverCapacity
    ? { top: "#fb7185", mid: "#ef4444", bot: "#b91c1c" }
    : utilization >= 85
      ? { top: "#fbbf24", mid: "#f59e0b", bot: "#b45309" }
      : { top: "#22d3ee", mid: "#14b8a6", bot: "#0f766e" };
  const bucketFill =
    "linear-gradient(180deg, rgba(186,230,253,0.06) 0%, rgba(56,189,248,0.16) 45%, rgba(2,132,199,0.30) 100%)";
  const trackGradId = `tcap-track-${gradientKey}-${dropId.replace(/[^a-zA-Z0-9]+/g, "")}`;
  const fluidGradId = `tcap-fluid-${gradientKey}-${dropId.replace(/[^a-zA-Z0-9]+/g, "")}`;
  const rollupInfoTooltipId = `capacity-rollup-info-${dropId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
  const rollupWarnChildId = `rollup-warn-child-${dropId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
  const rollupWarnEstId = `rollup-warn-est-${dropId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
  const bucketColumnHeightClass = isPanelExpanded
    ? "min-h-[28rem] h-[min(72vh,44rem)]"
    : "h-[24rem]";

  return (
    <section
      className={cn(
        "@container min-w-0 rounded-2xl border border-slate-200/85 bg-gradient-to-br from-slate-50/95 via-indigo-50/45 to-sky-100/55 p-3 shadow-sm ring-1 ring-indigo-100/40",
        isPanelExpanded && "min-h-0",
      )}
    >
      <div className="mb-2 flex flex-col gap-2 pr-0.5">
        <div className="flex min-h-8 min-w-0 items-center gap-2">
          <p className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 text-left text-[15px] font-bold text-slate-800">
            <Users className="size-4 shrink-0 text-indigo-600/90" aria-hidden />
            <span className="min-w-0 truncate">
              {teamLabelPrefix ? (
                <>
                  <span className="font-semibold text-slate-600">{teamLabelPrefix}</span> {team.label}
                </>
              ) : (
                team.label
              )}
            </span>
          </p>
          {panelExpandable && onExpandPanel && onCollapsePanel ? (
            isPanelExpanded ? (
              <button
                type="button"
                onClick={onCollapsePanel}
                className="inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200/90 bg-white/90 p-1.5 text-slate-600 shadow-sm outline-none transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-300"
                aria-label="Show all team buckets"
                title="Show all teams"
              >
                <Minimize2 className="size-4" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={onExpandPanel}
                className="inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200/90 bg-white/90 p-1.5 text-slate-600 shadow-sm outline-none transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-300"
                aria-label="Expand this team bucket to full width"
                title="Expand bucket"
              >
                <Maximize2 className="size-4" aria-hidden />
              </button>
            )
          ) : null}
        </div>
        <div className="flex min-h-6 min-w-0 flex-nowrap items-center justify-between gap-x-3">
          <label className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-slate-600">
            Capacity
            <input
              type="number"
              min={0}
              max={capacityInputMax}
              step={1}
              value={capacity}
              onChange={(event) => onCapacityChange(Number(event.target.value || 0))}
              className={cn(
                "h-5 w-10 shrink-0 rounded border border-slate-200/90 bg-white/90 px-1 py-0 text-center text-[11px] font-medium leading-none text-slate-800 shadow-sm",
                CAPACITY_DAYS_INPUT_NO_SPIN,
              )}
            />
            d
          </label>
          <div className="flex min-w-0 shrink items-center justify-end gap-1.5">
            {/* Rollups alone scroll horizontally so overflow does not clip the info tooltip (above the button). */}
            <div className="min-w-0 max-w-full overflow-x-auto overflow-y-visible [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div
                className="flex w-max min-w-0 flex-nowrap items-center justify-end gap-x-2 text-[13px] font-semibold leading-snug text-slate-600"
                role="status"
                aria-live="polite"
              >
                <span
                  className={cn(
                    "whitespace-nowrap",
                    childSumOverCapacity && rollupOverCapacityPill,
                    childSumOverCapacity && "font-medium",
                  )}
                >
                  {childSumOverCapacity ? (
                    <span className="group/wrollup-child relative inline-flex shrink-0 items-center">
                      <button
                        type="button"
                        className="-m-px rounded p-0.5 text-white outline-none hover:text-white/90 focus-visible:ring-1 focus-visible:ring-white/90"
                        aria-label="Σ Child exceeds team capacity — details"
                        aria-describedby={rollupWarnChildId}
                      >
                        <AlertTriangle className="size-3 shrink-0" strokeWidth={2.25} aria-hidden />
                      </button>
                      <span
                        id={rollupWarnChildId}
                        role="tooltip"
                        className={cn(
                          ROLLUP_OVER_CAP_TOOLTIP_BASE,
                          "group-hover/wrollup-child:opacity-100 group-focus-within/wrollup-child:opacity-100",
                        )}
                      >
                        <span className="font-semibold text-rose-800">Over capacity</span>
                        <span className="mt-0.5 block text-slate-600">
                          Σ Child totals {Math.round(sumChildStoryEstimates)}d but team Capacity is {capacity}d. Reduce
                          story estimates, raise Capacity, or move epics.
                        </span>
                      </span>
                    </span>
                  ) : null}
                  Σ Child{" "}
                  <span
                    className={cn("tabular-nums", childSumOverCapacity ? "text-white" : "text-slate-800")}
                  >
                    {Math.round(sumChildStoryEstimates)}
                  </span>
                  <span className={cn("ml-0.5", childSumOverCapacity && "text-white")}>d</span>
                </span>
                <span className="shrink-0 text-slate-300" aria-hidden>
                  ·
                </span>
                <span
                  className={cn(
                    "whitespace-nowrap",
                    estSumOverCapacity && rollupOverCapacityPill,
                    estSumOverCapacity && "font-medium",
                  )}
                >
                  {estSumOverCapacity ? (
                    <span className="group/wrollup-est relative inline-flex shrink-0 items-center">
                      <button
                        type="button"
                        className="-m-px rounded p-0.5 text-white outline-none hover:text-white/90 focus-visible:ring-1 focus-visible:ring-white/90"
                        aria-label="Σ Est exceeds team capacity — details"
                        aria-describedby={rollupWarnEstId}
                      >
                        <AlertTriangle className="size-3 shrink-0" strokeWidth={2.25} aria-hidden />
                      </button>
                      <span
                        id={rollupWarnEstId}
                        role="tooltip"
                        className={cn(
                          ROLLUP_OVER_CAP_TOOLTIP_BASE,
                          "group-hover/wrollup-est:opacity-100 group-focus-within/wrollup-est:opacity-100",
                        )}
                      >
                        <span className="font-semibold text-rose-800">Over capacity</span>
                        <span className="mt-0.5 block text-slate-600">
                          Σ Est (planned load) is {Math.round(sumOriginalEstimates)}d but team Capacity is {capacity}d.
                          Lower Est days on epics, raise Capacity, or remove epics.
                        </span>
                      </span>
                    </span>
                  ) : null}
                  Σ Est{" "}
                  <span className={cn("tabular-nums", estSumOverCapacity ? "text-white" : "text-slate-800")}>
                    {Math.round(sumOriginalEstimates)}
                  </span>
                  <span className={cn("ml-0.5", estSumOverCapacity && "text-white")}>d</span>
                </span>
              </div>
            </div>
            <span className="group/rollupinfo relative inline-flex shrink-0">
              <button
                type="button"
                className="rounded p-0.5 text-slate-400 outline-none transition hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-indigo-300"
                aria-label="About Σ Child and Σ Est rollups"
                aria-describedby={rollupInfoTooltipId}
              >
                <Info className="size-4" aria-hidden />
              </button>
              <span
                id={rollupInfoTooltipId}
                role="tooltip"
                className={cn(
                  CAPACITY_ROLLUP_INFO_TOOLTIP_CLASS,
                  "group-hover/rollupinfo:opacity-100 group-focus-within/rollupinfo:opacity-100",
                )}
              >
                <span className="block font-semibold text-slate-800">Σ Child and Σ Est</span>
                <span className="mt-1.5 block">
                  <strong className="text-slate-800">Σ Child</strong> — sum of all user-story estimate days for epics in
                  this team bucket (same as adding each epic&apos;s Σ Child on the cards).
                </span>
                <span className="mt-1 block">
                  <strong className="text-slate-800">Σ Est</strong> — sum of each epic&apos;s <em>Est days</em> in this
                  bucket (planned load used for the gauge and capacity math).
                </span>
                <span className="mt-1 block text-slate-600">
                  Either figure turns red when it is greater than Capacity (days).
                </span>
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_56px] gap-2">
        <div
          ref={setNodeRef}
          className={cn(
            "relative flex flex-col overflow-hidden rounded-2xl border-0 bg-white p-2 transition",
            bucketColumnHeightClass,
            isOver && "ring-2 ring-primary/25",
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
              <p className="rounded-md bg-slate-50/90 p-3 text-center text-[12px] font-medium text-slate-500">
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
        <div className={cn("flex flex-col items-center p-2", bucketColumnHeightClass)}>
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
                y={258 - (gaugeFillPct / 100) * 242}
                width="12"
                height={(gaugeFillPct / 100) * 242}
                rx="6"
                fill={`url(#${fluidGradId})`}
                opacity="0.95"
              />
            </svg>
          </div>
          <div className="text-center text-[11px] font-semibold text-slate-600">
            <p>{assignedTotal.toFixed(1)}d</p>
            <p>/ {capacity.toFixed(1)}d</p>
          </div>
        </div>
      </div>
    </section>
  );
}
