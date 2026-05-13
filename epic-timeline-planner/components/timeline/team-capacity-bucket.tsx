"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowDown, Check, Info, Maximize2, Minimize2, Users, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import { EpicPlanBarIcon } from "@/components/timeline/epic-plan-bar";
import { epicTimelineDraggableId } from "@/lib/epic-dnd-ids";
import { type CapacityLoadBasis } from "@/lib/capacity-load-basis";
import { capacityGaugeFluidStops } from "@/lib/capacity-thermometer";
import { MONTH_TEAM_COLUMNS } from "@/lib/month-team-board";
import { cn } from "@/lib/utils";

/** Compact number fields: hide spinners so read-only and editable cells share identical text alignment. */
export const CAPACITY_DAYS_INPUT_NO_SPIN =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

export const CAPACITY_ROLLUP_INFO_TOOLTIP_CLASS =
  "pointer-events-none absolute left-1/2 top-0 z-[320] w-56 max-w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-normal rounded-lg border border-indigo-200/80 bg-white px-2.5 py-2 text-[12px] font-medium leading-snug text-slate-700 opacity-0 shadow-md ring-1 ring-slate-200/80 transition-opacity duration-150";

const TEAM_CAP_HEADER_ICON_BTN_CLASS =
  "inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200/90 bg-white/90 p-1.5 text-slate-600 shadow-sm outline-none transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-300";

export const rollupOverCapacityPill =
  "inline-flex items-center gap-1.5 rounded-lg border border-rose-300/90 bg-gradient-to-br from-rose-50 to-rose-100 px-2.5 py-1 text-[12px] font-semibold leading-tight text-rose-700 ring-1 ring-rose-200/60";

/** White chip behind rollups when load is within capacity (pairs with {@link rollupOverCapacityPill}). */
export const rollupNeutralPill =
  "inline-flex items-center gap-1 rounded-lg border border-slate-200/80 bg-white px-2.5 py-1 text-[12px] font-semibold leading-tight text-slate-600";

/** Portal + fixed positioning so the tooltip is not clipped by horizontal scroll or overflow parents. */
export function RollupOverCapWarn({
  tooltipId,
  ariaLabel,
  children,
}: {
  tooltipId: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const reposition = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.top, left: r.left + r.width / 2 });
  };

  const show = () => {
    reposition();
    setOpen(true);
  };

  const hide = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => reposition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="-m-px inline-flex shrink-0 items-center rounded p-0.5 align-middle text-rose-800 outline-none hover:text-rose-950 focus-visible:ring-1 focus-visible:ring-rose-500/70"
        aria-label={ariaLabel}
        aria-describedby={open ? tooltipId : undefined}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <AlertTriangle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      </button>
      {mounted && open
        ? createPortal(
            <div
              id={tooltipId}
              role="tooltip"
              className="pointer-events-none fixed z-[9999] w-52 max-w-[min(16rem,calc(100vw-2rem))] whitespace-normal rounded-md border border-rose-200 bg-white px-2 py-1.5 text-[11px] font-medium leading-snug text-slate-700 shadow-md ring-1 ring-slate-200/80"
              style={{
                top: coords.top,
                left: coords.left,
                transform: "translate(-50%, calc(-100% - 8px))",
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

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
  const [draftEst, setDraftEst] = useState<number | null>(null);
  const isEstDirty = draftEst !== null && draftEst !== originalEstimateDays;
  const displayEst = draftEst !== null ? draftEst : originalEstimateDays;
  function commitEst() {
    if (draftEst !== null) { onOriginalEstimateChange(epicId, draftEst); setDraftEst(null); }
  }
  function cancelEst() { setDraftEst(null); }

  return (
    <article
      ref={setNodeRef}
      className={cn(
        "group/card relative min-h-[3.25rem] rounded-lg border border-slate-200/80 bg-white py-2 pl-2 pr-2 shadow-sm transition-colors hover:border-slate-300/70 hover:bg-slate-50/80",
        isDragging && "opacity-60",
      )}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 30 : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => onRemoveEpicFromCapacity(epicId)}
        className="absolute right-1.5 top-1.5 z-50 inline-flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 opacity-0 shadow-sm transition hover:bg-slate-100 hover:text-slate-700 group-hover/card:opacity-100 group-focus-within/card:opacity-100 focus-visible:opacity-100"
        aria-label="Remove epic from team capacity bucket"
        title="Clear team assignment"
      >
        <X className="size-3.5" aria-hidden />
      </button>
      <div className="flex w-full min-w-0 flex-col gap-2.5">
        {/* Title row */}
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className="shrink-0 cursor-grab rounded border border-slate-200/80 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-100 active:cursor-grabbing"
            aria-label="Drag epic card"
            {...attributes}
            {...listeners}
          >
            ::
          </button>
          <div className="min-w-0 flex-1 pr-[calc(0.375rem+1.5rem+0.25rem)]">
            <button
              type="button"
              onClick={() => onOpenEpic(epicId)}
              className="w-full truncate text-left text-[13px] font-semibold leading-snug text-slate-900 hover:text-blue-700"
            >
              <span className="mr-1.5 inline-flex align-middle text-slate-600">
                <EpicPlanBarIcon icon={icon} className="mr-0 text-slate-600 [&_svg]:text-slate-500" />
              </span>
              {title}
            </button>
            <p className="mt-0.5 truncate text-[11px] leading-snug text-slate-500">{initiativeTitle}</p>
          </div>
        </div>
        {/* Bottom row: badges + estimates */}
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            {executionStatusLabel ? (
              <span className={cn("shrink-0 rounded border px-1 py-px text-[10px] font-medium leading-tight", executionStatusClassName)}>
                {executionStatusLabel}
              </span>
            ) : null}
            {planningLabel ? (
              <span className="shrink-0 rounded border border-slate-200/70 bg-slate-50 px-1 py-px text-[10px] font-medium leading-tight text-slate-500">
                {planningLabel}
              </span>
            ) : null}
          </div>
          <div className="grid shrink-0 grid-cols-[auto_2.5rem] items-center gap-x-2 gap-y-1">
            <span className="whitespace-nowrap text-[11px] font-medium text-slate-400">Σ Stories</span>
            <input
              type="number"
              readOnly
              tabIndex={-1}
              value={Math.round(childStoryEstimateDays)}
              onChange={() => {}}
              title="Sum of child story estimates (read-only)"
              aria-label="Sum of child story estimate days (read-only)"
              className={cn(
                "h-5 w-10 rounded border border-slate-200/70 bg-slate-50 px-0.5 text-center text-[10px] font-semibold text-slate-400 pointer-events-none select-none focus:outline-none",
                CAPACITY_DAYS_INPUT_NO_SPIN,
              )}
            />
            <span className="whitespace-nowrap text-[12px] font-semibold text-slate-600">Est Days</span>
            <input
              type="number"
              min={0}
              max={5000}
              step={1}
              value={displayEst}
              onChange={(event) => setDraftEst(Math.max(0, Number(event.target.value || 0)))}
              onKeyDown={(e) => { if (e.key === "Enter") commitEst(); if (e.key === "Escape") cancelEst(); }}
              className={cn(
                "h-5 w-10 shrink-0 rounded border bg-white px-0.5 text-center text-[10px] font-semibold leading-none text-slate-800 focus:outline-none focus:ring-1",
                isEstDirty
                  ? "border-blue-300 focus:border-blue-400 focus:ring-blue-100"
                  : "border-slate-200 focus:border-blue-300 focus:ring-blue-100",
                CAPACITY_DAYS_INPUT_NO_SPIN,
              )}
              aria-label="Original estimate days"
            />
            {isEstDirty && (
              <div className="col-span-2 flex justify-end gap-1">
                <button type="button" onClick={commitEst} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-emerald-300 bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100" aria-label="Confirm" title="Confirm">
                  <Check className="size-3" strokeWidth={2.5} />
                </button>
                <button type="button" onClick={cancelEst} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" aria-label="Cancel" title="Cancel">
                  <X className="size-3" strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
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
  reorderGrip = null,
  /** Drives gauge fill, load %, and “X / capacity” under the thermometer (Est days vs Σ Child). */
  loadBasis = "originalEstimate",
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
  /** Column reorder handle (month / quarter capacity boards). */
  reorderGrip?: ReactNode;
  loadBasis?: CapacityLoadBasis;
}) {
  const sumChildStoryEstimates = cards.reduce((sum, c) => sum + c.childStoryEstimateDays, 0);
  const sumOriginalEstimates = cards.reduce((sum, c) => sum + c.originalEstimateDays, 0);
  const primaryLoad = loadBasis === "child" ? sumChildStoryEstimates : sumOriginalEstimates;
  const childSumOverCapacity = sumChildStoryEstimates > capacity;
  const estSumOverCapacity = sumOriginalEstimates > capacity;
  const utilization = capacity > 0 ? (primaryLoad / capacity) * 100 : primaryLoad > 0 ? 200 : 0;
  const fillPct = Math.max(0, Math.min(100, capacity > 0 ? (primaryLoad / capacity) * 100 : 0));
  /**
   * Fluid height vs team Capacity (not vs period max days).
   * Capped at 100% so e.g. 11d vs 1d capacity reads as a full bar, not 11/60 of the tube.
   */
  const gaugeFillPct = Math.max(0, Math.min(100, utilization));
  /** Dashed line: where this team’s Capacity sits on the period scale (days). */
  const markerPct = Math.max(0, Math.min(100, gaugeScaleMax > 0 ? (capacity / gaugeScaleMax) * 100 : 0));
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  const [draftCap, setDraftCap] = useState<number | null>(null);
  const isCapDirty = draftCap !== null && draftCap !== capacity;
  const displayCap = draftCap !== null ? draftCap : capacity;
  function commitCap() {
    if (draftCap !== null) { onCapacityChange(draftCap); setDraftCap(null); }
  }
  function cancelCap() { setDraftCap(null); }
  const gradientKey = team.id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const stressPct = utilization;
  const fluidStops = capacityGaugeFluidStops(capacity > 0 ? stressPct / 100 : 0);
  const bucketFill =
    "linear-gradient(180deg, rgba(186,230,253,0.06) 0%, rgba(56,189,248,0.16) 45%, rgba(2,132,199,0.30) 100%)";
  const trackGradId = `tcap-track-${gradientKey}-${dropId.replace(/[^a-zA-Z0-9]+/g, "")}`;
  const fluidGradId = `tcap-fluid-${gradientKey}-${dropId.replace(/[^a-zA-Z0-9]+/g, "")}`;
  const rollupInfoTooltipId = `capacity-rollup-info-${dropId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
  const rollupWarnChildId = `rollup-warn-child-${dropId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
  const rollupWarnEstId = `rollup-warn-est-${dropId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
  const bucketColumnShellClass = isPanelExpanded ? "min-h-[28rem]" : "min-h-[24rem]";
  /** 150% of previous fixed list area (24rem → 36rem) before vertical scroll. */
  const bucketScrollMaxClass = isPanelExpanded
    ? "max-h-[min(72vh,66rem)]"
    : "max-h-[36rem]";

  const hasHeaderToolbar =
    Boolean(reorderGrip) || Boolean(panelExpandable && onExpandPanel && onCollapsePanel);

  return (
    <section
      className={cn(
        "group @container min-h-0 min-w-0 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm",
        "transition-[border-color,box-shadow] duration-200 ease-out hover:border-slate-300/70 hover:shadow-md",
      )}
    >
      <div className="-mt-1 mb-2 flex flex-col gap-2 pr-0.5 pb-1">
        <div className="relative grid min-h-8 w-full min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-x-1">
          <div className="min-w-0 justify-self-start" aria-hidden />
          <p className="col-start-2 inline-flex min-w-0 max-w-[min(16rem,85vw)] items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-2.5 py-1 text-[15px] font-bold text-slate-800">
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
              <Users className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0 truncate">
              {teamLabelPrefix ? (
                <>
                  <span className="font-semibold text-slate-500">{teamLabelPrefix}</span> {team.label}
                </>
              ) : (
                team.label
              )}
            </span>
          </p>
          <div className="relative min-h-8 min-w-0 justify-self-stretch self-center">
            {hasHeaderToolbar ? (
              <div className="absolute right-0 top-1/2 z-10 flex items-center gap-1 -translate-y-1/2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto">
                {reorderGrip}
                {panelExpandable && onExpandPanel && onCollapsePanel ? (
                  isPanelExpanded ? (
                    <button
                      type="button"
                      onClick={onCollapsePanel}
                      className={TEAM_CAP_HEADER_ICON_BTN_CLASS}
                      aria-label="Show all team buckets"
                      title="Show all teams"
                    >
                      <Minimize2 className="size-3" aria-hidden />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onExpandPanel}
                      className={TEAM_CAP_HEADER_ICON_BTN_CLASS}
                      aria-label="Expand this team bucket to full width"
                      title="Expand bucket"
                    >
                      <Maximize2 className="size-3" aria-hidden />
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="border-t border-slate-200/80" />
        <div className="flex min-w-0 items-center">
          <div className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-slate-600">
            Available Team Capacity
            <input
              type="number"
              min={0}
              max={capacityInputMax}
              step={1}
              value={displayCap}
              onChange={(event) => setDraftCap(Number(event.target.value || 0))}
              onKeyDown={(e) => { if (e.key === "Enter") commitCap(); if (e.key === "Escape") cancelCap(); }}
              className={cn(
                "h-5 w-10 shrink-0 rounded border bg-white/90 px-1 py-0 text-center text-[11px] font-medium leading-none text-slate-800 focus:outline-none focus:ring-1",
                isCapDirty ? "border-blue-300 focus:border-blue-400 focus:ring-blue-100" : "border-slate-200/90 focus:border-blue-300 focus:ring-blue-100",
                CAPACITY_DAYS_INPUT_NO_SPIN,
              )}
            />
            <span className="text-[13px] font-semibold text-slate-600">Days</span>
            {isCapDirty && (
              <>
                <button type="button" onClick={commitCap} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-emerald-300 bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100" aria-label="Confirm" title="Confirm">
                  <Check className="size-3" strokeWidth={2.5} />
                </button>
                <button type="button" onClick={cancelCap} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" aria-label="Cancel" title="Cancel">
                  <X className="size-3" strokeWidth={2.5} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_56px] items-stretch gap-2">
        <div
          ref={setNodeRef}
          className={cn(
            "relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-300/60 p-2 shadow-[inset_0_2px_6px_-2px_rgba(15,23,42,0.18),inset_0_-1px_3px_-1px_rgba(15,23,42,0.10)]",
            "transition-[background-color,box-shadow,border-color] duration-200 ease-out",
            bucketColumnShellClass,
            isOver && "border-violet-300/70 bg-violet-100/50 ring-1 ring-violet-200/50",
          )}
          style={{
            backgroundImage: "linear-gradient(135deg, #eff6ff 0%, #f5f3ff 50%, #fdf2f8 100%)",
          }}
        >
          {/* Bucket SVG hidden for now — remove `hidden` from className to show again */}
          <img
            src="/images/sprint-capacity-bucket.svg"
            alt="Team capacity bucket"
            className="pointer-events-none absolute top-1 left-1/2 hidden h-[88%] w-[98%] -translate-x-1/2 object-contain opacity-30"
          />
          <div
            className={cn(
              "capacity-bucket-scroll relative z-20 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden",
              bucketScrollMaxClass,
            )}
          >
            <div className="mt-auto flex w-full min-w-0 flex-col-reverse gap-2.5 pb-2 pt-1">
              {cards.length === 0 ? (
                <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300/70 bg-white/70 p-4 text-center text-[12px] font-medium tracking-wide text-slate-400">
                  Drop Epic here
                  <ArrowDown className="size-3.5 text-slate-300" strokeWidth={2} aria-hidden />
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
        </div>
        <div className={cn("flex min-h-0 flex-col items-center rounded-xl bg-slate-50/80 p-2", bucketColumnShellClass)}>
          <div className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Load</p>
            <p className="text-[15px] font-bold text-slate-700">{Math.round(utilization)}%</p>
          </div>
          <div className="flex flex-1 items-center py-1">
            <svg viewBox="0 0 84 292" className="h-full w-[4rem]" aria-label="Team capacity gauge">
              <defs>
                <linearGradient id={trackGradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f8fafc" />
                  <stop offset="100%" stopColor="#eef2f7" />
                </linearGradient>
                <linearGradient id={fluidGradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={fluidStops.top} stopOpacity="1" />
                  <stop offset="42%" stopColor={fluidStops.mid} stopOpacity="0.98" />
                  <stop offset="100%" stopColor={fluidStops.bot} stopOpacity="1" />
                </linearGradient>
                <linearGradient id={`${fluidGradId}-sheen`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
                  <stop offset="38%" stopColor="#ffffff" stopOpacity="0" />
                  <stop offset="100%" stopColor="#0f172a" stopOpacity="0.07" />
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
                opacity="0.97"
              />
              <rect
                x="36"
                y={258 - (gaugeFillPct / 100) * 242}
                width="12"
                height={(gaugeFillPct / 100) * 242}
                rx="6"
                fill={`url(#${fluidGradId}-sheen)`}
                pointerEvents="none"
              />
            </svg>
          </div>
          <div className="text-center text-[11px] text-slate-500">
            <p className="font-semibold text-slate-700">{primaryLoad.toFixed(1)}d</p>
            <p className="text-slate-400">/ {capacity.toFixed(1)}d</p>
          </div>
        </div>
      </div>

      {/* Bottom rollup bar */}
      <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-slate-200/70 pt-2" role="status" aria-live="polite">
        <span className={cn("whitespace-nowrap", rollupNeutralPill)}>
          Σ Stories Estimation
          <span className={cn(
            "inline-flex size-5 items-center justify-center rounded-full text-[10px] tabular-nums font-bold",
            childSumOverCapacity
              ? "bg-rose-600 text-white shadow-sm"
              : "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200/80",
          )}>
            {Math.round(sumChildStoryEstimates)}
          </span>
          {childSumOverCapacity ? (
            <RollupOverCapWarn tooltipId={rollupWarnChildId} ariaLabel="Σ Stories Estimation exceeds team capacity — details">
              <span className="font-semibold text-rose-800">Over capacity</span>
              <span className="mt-0.5 block text-slate-600">
                Σ Stories Estimation totals {Math.round(sumChildStoryEstimates)} Days but team capacity is {capacity} Days.
                Reduce story estimates, raise capacity, or move epics.
              </span>
            </RollupOverCapWarn>
          ) : null}
        </span>
        <span className={cn("whitespace-nowrap", rollupNeutralPill)}>
          Σ Epic Estimations
          <span className={cn(
            "inline-flex size-5 items-center justify-center rounded-full text-[10px] tabular-nums font-bold",
            estSumOverCapacity
              ? "bg-rose-600 text-white shadow-sm"
              : "bg-violet-100 text-violet-700 ring-1 ring-violet-200/80",
          )}>
            {Math.round(sumOriginalEstimates)}
          </span>
          {estSumOverCapacity ? (
            <RollupOverCapWarn tooltipId={rollupWarnEstId} ariaLabel="Σ Epic Estimations exceeds team capacity — details">
              <span className="font-semibold text-rose-800">Over capacity</span>
              <span className="mt-0.5 block text-slate-600">
                Σ Epic Estimations is {Math.round(sumOriginalEstimates)} Days but team capacity is {capacity} Days.
                Lower epic estimates, raise capacity, or remove epics.
              </span>
            </RollupOverCapWarn>
          ) : null}
        </span>
      </div>
    </section>
  );
}
