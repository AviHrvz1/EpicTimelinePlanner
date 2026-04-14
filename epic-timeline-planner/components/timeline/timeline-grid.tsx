"use client";

import { useDroppable } from "@dnd-kit/core";
import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { InitiativeTimelineBar } from "@/components/timeline/epic-timeline-bar";
import { EpicPlanBlock } from "@/components/timeline/epic-plan-block";
import { isPostDragClickSuppressed } from "@/components/timeline/drag-context";
import { SprintKanbanBoard } from "@/components/timeline/sprint-kanban";
import { TIMELINE_GANTT_ROWS_CONTAINER_ID } from "@/lib/gantt-lane-from-pointer";
import { collectPlannedEpicsForMonth } from "@/lib/sprint-plan";
import { MONTHS, QUARTERS } from "@/lib/timeline";
import { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type QuarterDef = (typeof QUARTERS)[number];

type GanttLaneRowProps = {
  initiative: InitiativeItem;
  focusedQuarter: QuarterDef | null;
  gridStyle: CSSProperties;
  previewColumnStart: number;
  previewSpan: number;
  rz: { initiativeId: string; side: "left" | "right"; deltaMonths: number } | null;
  handleResizePointerDown: (
    initiativeId: string,
    side: "left" | "right",
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  onResizeInitiativeRange?: (initiativeId: string, startMonth: number, endMonth: number) => void;
  onOpenInitiative: (initiativeId: string) => void;
  barElsRef: React.MutableRefObject<Map<string, HTMLDivElement>>;
  /** Sort index among scheduled initiatives (for pointer-based lane drop). */
  ganttLaneSortIndex: number;
};

function GanttLaneRow({
  initiative,
  focusedQuarter,
  gridStyle,
  previewColumnStart,
  previewSpan,
  rz,
  handleResizePointerDown,
  onResizeInitiativeRange,
  onOpenInitiative,
  barElsRef,
  ganttLaneSortIndex,
}: GanttLaneRowProps) {
  const resizeEdgeClass =
    "pointer-events-auto absolute inset-y-0.5 z-20 w-2.5 touch-none select-none rounded-md bg-white/0 transition-colors hover:bg-white/30 active:bg-white/40";

  return (
    <div
      className={cn("relative", !focusedQuarter && "min-w-max")}
      data-gantt-lane-index={ganttLaneSortIndex}
    >
      <div className={cn("relative grid gap-2", !focusedQuarter && "min-w-max")} style={gridStyle}>
          {!focusedQuarter
            ? [4, 7, 10].map((monthStart) => (
                <div
                  key={`quarter-separator-${initiative.id}-${monthStart}`}
                  className="pointer-events-none border-l-2 border-slate-300/70"
                  style={{ gridColumn: `${monthStart} / span 1`, gridRow: 1 }}
                />
              ))
            : null}
          <div
            ref={(node) => {
              if (node) barElsRef.current.set(initiative.id, node);
              else barElsRef.current.delete(initiative.id);
            }}
            className="relative min-w-0 py-0.5"
            style={{ gridColumn: `${previewColumnStart} / span ${previewSpan}`, gridRow: 1 }}
          >
            <InitiativeTimelineBar
              id={initiative.id}
              title={initiative.title}
              color={initiative.color}
              isResizing={Boolean(rz)}
              onClick={() => onOpenInitiative(initiative.id)}
            />
            {onResizeInitiativeRange ? (
              <>
                <div
                  role="slider"
                  aria-label="Resize initiative start month"
                  title="Drag to change start month"
                  className={cn(resizeEdgeClass, "left-0 cursor-ew-resize")}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    handleResizePointerDown(initiative.id, "left", e);
                  }}
                />
                <div
                  role="slider"
                  aria-label="Resize initiative end month"
                  title="Drag to change end month"
                  className={cn(resizeEdgeClass, "right-0 cursor-ew-resize")}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    handleResizePointerDown(initiative.id, "right", e);
                  }}
                />
              </>
            ) : null}
          </div>
        </div>
    </div>
  );
}

type TimelineGridProps = {
  initiatives: InitiativeItem[];
  zoom: number;
  focusedQuarterLabel: string | null;
  onFocusedQuarterChange: (quarterLabel: string | null) => void;
  /** After dropping an initiative on a month, parent bumps token so we focus that month (left panel month drill). */
  scheduleDrill?: { month: number; token: number } | null;
  onScheduleDrillApplied?: () => void;
  onSprintModeChange: (active: boolean, activeMonth: number | null, activeSprint: 1 | 2 | null) => void;
  onOpenEpic: (epicId: string) => void;
  onOpenInitiative: (initiativeId: string) => void;
  onOpenStory?: (storyId: string) => void;
  onResizeInitiativeRange?: (initiativeId: string, startMonth: number, endMonth: number) => void;
};

const QUARTER_YEAR_FRACTION: Record<string, number> = {
  Q1: 0.25,
  Q2: 0.5,
  Q3: 0.75,
  Q4: 1,
};

function quarterWedgePath(frac: number): string | null {
  if (frac >= 1 - 1e-6) return null;
  const cx = 12;
  const cy = 12;
  const r = 8;
  const start = -Math.PI / 2;
  const end = start + frac * 2 * Math.PI;
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const largeArc = frac > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

function QuarterYearProgressIcon({
  quarterLabel,
  className,
}: {
  quarterLabel: string;
  className?: string;
}) {
  const frac = QUARTER_YEAR_FRACTION[quarterLabel] ?? 0.25;
  const wedge = quarterWedgePath(frac);

  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-[18px] shrink-0", className)}
      aria-hidden
    >
      <circle
        cx={12}
        cy={12}
        r={8}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        className="opacity-40"
      />
      {frac >= 1 - 1e-6 ? (
        <circle cx={12} cy={12} r={7} fill="currentColor" className="opacity-95" />
      ) : wedge ? (
        <path d={wedge} fill="currentColor" className="opacity-95" />
      ) : null}
    </svg>
  );
}


/** Minimal hit target under each month label; no dashed lane stack. */
function MonthDropCell({ month }: { month: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `month:${month}` });
  return (
    <div
      ref={setNodeRef}
      className={cn("h-2 w-full shrink-0 rounded-sm transition", isOver && "bg-primary/25")}
      aria-hidden
    />
  );
}

function EpicPlanDropCell({ month, sprint }: { month: number; sprint: 1 | 2 }) {
  const { setNodeRef, isOver } = useDroppable({ id: `epic-plan:${month}:${sprint}` });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[4.5rem] items-center justify-center rounded-md border border-dashed border-border bg-muted/25 px-1 py-2 text-center text-[10px] font-medium text-slate-500 transition",
        isOver && "border-primary bg-primary/10 text-primary",
      )}
    >
      Drop epic
    </div>
  );
}

export function TimelineGrid({
  initiatives,
  zoom,
  focusedQuarterLabel,
  onFocusedQuarterChange,
  scheduleDrill = null,
  onScheduleDrillApplied,
  onSprintModeChange,
  onOpenEpic,
  onOpenInitiative,
  onOpenStory,
  onResizeInitiativeRange,
}: TimelineGridProps) {
  const [focusedMonth, setFocusedMonth] = useState<number | null>(null);
  const [activeSprint, setActiveSprint] = useState<1 | 2 | null>(null);
  const barElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [resizePreview, setResizePreview] = useState<{
    initiativeId: string;
    side: "left" | "right";
    deltaMonths: number;
  } | null>(null);

  const handleResizePointerDown = useCallback(
    (initiativeId: string, side: "left" | "right", event: React.PointerEvent<HTMLDivElement>) => {
      if (!onResizeInitiativeRange) return;
      const commitResize = onResizeInitiativeRange;
      const barEl = barElsRef.current.get(initiativeId);
      if (!barEl) return;

      event.preventDefault();
      event.stopPropagation();

      const initiative = initiatives.find((i) => i.id === initiativeId);
      if (!initiative || initiative.startMonth == null || initiative.endMonth == null) return;

      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      handle.setPointerCapture(pointerId);

      const startX = event.clientX;
      const barWidth = barEl.getBoundingClientRect().width;
      const span = Math.max(initiative.endMonth - initiative.startMonth + 1, 1);
      const monthWidthPx = barWidth / span;
      const startMonth = initiative.startMonth;
      const endMonth = initiative.endMonth;

      setResizePreview({ initiativeId, side, deltaMonths: 0 });

      function onPointerMove(e: PointerEvent) {
        if (e.pointerId !== pointerId) return;
        e.preventDefault();
        const deltaPx = e.clientX - startX;
        const snapped = Math.round(deltaPx / monthWidthPx);
        setResizePreview((prev) => {
          if (prev && prev.deltaMonths === snapped) return prev;
          return { initiativeId, side, deltaMonths: snapped };
        });
      }

      function onPointerUp(e: PointerEvent) {
        if (e.pointerId !== pointerId) return;
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", onPointerUp);
        handle.removeEventListener("pointercancel", onPointerUp);

        const deltaPx = e.clientX - startX;
        const deltaMonths = Math.round(deltaPx / monthWidthPx);

        if (deltaMonths !== 0) {
          if (side === "right") {
            const nextEnd = Math.min(12, Math.max(startMonth, endMonth + deltaMonths));
            if (nextEnd !== endMonth) {
              commitResize(initiativeId, startMonth, nextEnd);
            }
          } else {
            const nextStart = Math.max(1, Math.min(endMonth, startMonth + deltaMonths));
            if (nextStart !== startMonth) {
              commitResize(initiativeId, nextStart, endMonth);
            }
          }
        }

        setResizePreview(null);
      }

      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp);
      handle.addEventListener("pointercancel", onPointerUp);
    },
    [initiatives, onResizeInitiativeRange],
  );

  const focusedQuarter = useMemo(
    () => QUARTERS.find((quarter) => quarter.label === focusedQuarterLabel) ?? null,
    [focusedQuarterLabel],
  );
  const scheduledInitiatives = useMemo(() => {
    const list = initiatives.filter(
      (i) => i.status === "scheduled" && i.startMonth != null && i.endMonth != null,
    );
    return [...list].sort((a, b) => a.timelineRow - b.timelineRow || a.title.localeCompare(b.title));
  }, [initiatives]);
  const visibleScheduledLanes = useMemo(() => {
    if (!focusedQuarter) return scheduledInitiatives;
    const qs = focusedQuarter.months[0];
    const qe = focusedQuarter.months[focusedQuarter.months.length - 1];
    return scheduledInitiatives.filter((i) => {
      const start = i.startMonth ?? 1;
      const end = i.endMonth ?? start;
      return !(end < qs || start > qe);
    });
  }, [scheduledInitiatives, focusedQuarter]);
  const visibleMonths = focusedQuarter
    ? [...focusedQuarter.months]
    : Array.from({ length: 12 }, (_, index) => index + 1);
  const visibleQuarterHeaders = focusedQuarter ? [focusedQuarter] : QUARTERS;
  const monthWidth = Math.round(90 * zoom);
  const sprintLaneLabels: [string, string] = [
    "Sprint 1 (first half)",
    "Sprint 2 (second half)",
  ];
  const focusedMonthIsVisible = focusedMonth ? visibleMonths.includes(focusedMonth) : false;
  const activeMonth = focusedMonthIsVisible ? focusedMonth : null;

  const quarterLabelByMonth = new Map<number, string>(
    QUARTERS.flatMap((quarter) => quarter.months.map((month) => [month, quarter.label] as const)),
  );
  const quarterTone: Record<string, { active: string; idle: string }> = {
    Q1: {
      active:
        "border-blue-400 bg-gradient-to-r from-blue-500 to-sky-500 text-white shadow-md ring-2 ring-blue-200",
      idle:
        "border-blue-200 bg-gradient-to-r from-blue-50 to-sky-50 text-blue-800 shadow-sm hover:from-blue-100 hover:to-sky-100",
    },
    Q2: {
      active:
        "border-cyan-400 bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-md ring-2 ring-cyan-200",
      idle:
        "border-cyan-200 bg-gradient-to-r from-cyan-50 to-teal-50 text-cyan-800 shadow-sm hover:from-cyan-100 hover:to-teal-100",
    },
    Q3: {
      active:
        "border-emerald-400 bg-gradient-to-r from-emerald-500 to-lime-500 text-white shadow-md ring-2 ring-emerald-200",
      idle:
        "border-emerald-200 bg-gradient-to-r from-emerald-50 to-lime-50 text-emerald-800 shadow-sm hover:from-emerald-100 hover:to-lime-100",
    },
    Q4: {
      active:
        "border-violet-400 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md ring-2 ring-violet-200",
      idle:
        "border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 text-violet-800 shadow-sm hover:from-violet-100 hover:to-fuchsia-100",
    },
  };
  const monthToneByQuarter: Record<string, string> = {
    Q1: "bg-blue-50 text-blue-800 hover:bg-blue-100",
    Q2: "bg-cyan-50 text-cyan-800 hover:bg-cyan-100",
    Q3: "bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    Q4: "bg-violet-50 text-violet-800 hover:bg-violet-100",
  };
  const gridStyle: CSSProperties = {
    gridTemplateColumns: focusedQuarter
      ? `repeat(${visibleMonths.length}, minmax(0, 1fr))`
      : `repeat(12, minmax(${monthWidth}px, 1fr))`,
  };

  useEffect(() => {
    if (!scheduleDrill || !onScheduleDrillApplied) return;
    setFocusedMonth(scheduleDrill.month);
    onScheduleDrillApplied();
  }, [scheduleDrill, onScheduleDrillApplied]);

  const prevActiveMonthRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevActiveMonthRef.current !== activeMonth) {
      prevActiveMonthRef.current = activeMonth;
      setActiveSprint(null);
    }
  }, [activeMonth]);

  useEffect(() => {
    if (activeMonth == null) {
      onSprintModeChange(false, null, null);
      return;
    }
    if (activeSprint != null) {
      onSprintModeChange(true, activeMonth, activeSprint);
    } else {
      onSprintModeChange(false, activeMonth, null);
    }
  }, [activeMonth, activeSprint, onSprintModeChange]);

  const breadcrumbItems: Array<{
    label: string;
    onClick: (() => void) | null;
  }> = [];

  if (focusedQuarter) {
    breadcrumbItems.push({
      label: focusedQuarter.label,
      onClick: () => {
        setFocusedMonth(null);
      },
    });
  } else if (activeMonth) {
    breadcrumbItems.push({
      label: "All Quarters",
      onClick: () => {
        setFocusedMonth(null);
      },
    });
  } else {
    breadcrumbItems.push({ label: "All Quarters", onClick: null });
  }

  if (activeMonth) {
    breadcrumbItems.push({
      label: MONTHS[activeMonth - 1],
      onClick: activeSprint != null ? () => setActiveSprint(null) : null,
    });
    breadcrumbItems.push({
      label: activeSprint != null ? `Sprint ${activeSprint} · Kanban` : "Month · 2 sprints",
      onClick: null,
    });
  }

  return (
    <div className="h-[72vh] w-full overflow-auto rounded-xl bg-card p-4 shadow-lg ring-1 ring-black/5">
      <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[12px] font-medium tracking-[0.01em] text-slate-700">
          {breadcrumbItems.map((item, index) => (
            <div key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.onClick ? (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="cursor-pointer rounded-md bg-white px-2 py-0.5 text-sky-700 shadow-sm ring-1 ring-sky-200 transition hover:bg-sky-50 hover:text-sky-800 hover:ring-sky-300 active:scale-[0.98]"
                >
                  {item.label}
                </button>
              ) : (
                <span className="rounded-md bg-white px-2 py-0.5 text-slate-700 shadow-sm ring-1 ring-black/5">
                  {item.label}
                </span>
              )}
              {index < breadcrumbItems.length - 1 ? (
                <span className="text-slate-400">/</span>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {focusedQuarter || focusedMonth ? (
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-slate-700 shadow-sm ring-1 ring-black/5"
              onClick={() => {
                if (activeSprint != null) {
                  setActiveSprint(null);
                  return;
                }
                if (focusedMonth) {
                  setFocusedMonth(null);
                  return;
                }
                onFocusedQuarterChange(null);
              }}
              aria-label="Go back"
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : null}
          {focusedQuarter ? (
            <button
              type="button"
              className="rounded-md bg-white px-2 py-1 text-[12px] font-medium shadow-sm ring-1 ring-black/5"
              onClick={() => {
                setFocusedMonth(null);
                onFocusedQuarterChange(null);
              }}
            >
              ⌂ Roadmap
            </button>
          ) : null}
        </div>
      </div>
      {!activeMonth ? (
        <div className={cn("mb-4 grid gap-2", !focusedQuarter && "min-w-max")} style={gridStyle}>
          {visibleQuarterHeaders.map((quarter) => (
            <button
              key={quarter.label}
              type="button"
              onClick={() => {
                setFocusedMonth(null);
                onFocusedQuarterChange(focusedQuarterLabel === quarter.label ? null : quarter.label);
              }}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-center text-[12px] font-semibold tracking-[0.02em] transition duration-200",
                focusedQuarterLabel === quarter.label
                  ? quarterTone[quarter.label]?.active ?? "border-primary/30 bg-primary/10 text-primary"
                  : quarterTone[quarter.label]?.idle ?? "border-border/40 bg-muted text-muted-foreground",
              )}
              style={{ gridColumn: `span ${quarter.months.length} / span ${quarter.months.length}` }}
            >
              <QuarterYearProgressIcon quarterLabel={quarter.label} />
              <span>{`Quarter ${quarter.label.replace("Q", "")}`}</span>
            </button>
          ))}
        </div>
      ) : null}
      {activeMonth ? (
        <div className="mb-4 space-y-4 rounded-xl bg-slate-50/70 p-4">
          {activeSprint != null ? (
            <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-black/5">
              <div className="mb-4 rounded-lg bg-slate-100 py-2 text-center ring-1 ring-black/5">
                <span className="text-[13px] font-semibold text-slate-900">{MONTHS[activeMonth - 1]}</span>
                <span className="text-[11px] font-medium text-slate-500"> · Sprint {activeSprint} · Kanban</span>
              </div>
              <SprintKanbanBoard
                initiatives={initiatives}
                month={activeMonth}
                sprintLane={activeSprint}
                onOpenStory={onOpenStory ?? (() => {})}
              />
            </div>
          ) : (
            <>
              <p className="text-[12px] leading-5 text-slate-600">
                Two sprint columns for {MONTHS[activeMonth - 1]} only. Tap a sprint header to open its Kanban; drag epics
                onto a dashed cell to choose the sprint. From the roadmap month row you can also drop on that month
                (defaults to Sprint 1). The parent initiative must be scheduled for {MONTHS[activeMonth - 1]}.
              </p>
              <div className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-black/5">
                <div className="mb-3 rounded-md bg-slate-100 py-2 text-center">
                  <span className="text-[13px] font-semibold text-slate-900">{MONTHS[activeMonth - 1]}</span>
                  <span className="text-[11px] font-medium text-slate-500"> · sprint plan</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {([1, 2] as const).map((sprint) => {
                    const planned = collectPlannedEpicsForMonth(initiatives, sprint, activeMonth);
                    return (
                      <div
                        key={`sprint-col-${sprint}`}
                        className="flex flex-col rounded-lg border border-slate-200/90 bg-slate-50/40 p-2.5"
                      >
                        <button
                          type="button"
                          onClick={() => setActiveSprint(sprint)}
                          className="mb-2 w-full rounded-lg bg-slate-100 py-2 text-center text-[12px] font-semibold text-slate-800 shadow-sm ring-1 ring-black/5 transition hover:bg-slate-200"
                        >
                          {sprintLaneLabels[sprint - 1]}
                        </button>
                        <EpicPlanDropCell month={activeMonth} sprint={sprint} />
                        <div className="mt-2 space-y-1.5">
                          {planned.length === 0 ? (
                            <p className="text-[11px] text-slate-500">No epics yet.</p>
                          ) : null}
                          {planned.map(({ epic }) => (
                            <EpicPlanBlock
                              key={epic.id}
                              epic={epic}
                              onOpenEpic={() => onOpenEpic(epic.id)}
                              onOpenStory={onOpenStory}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className={cn("mb-4 grid gap-2", !focusedQuarter && "min-w-max")} style={gridStyle}>
          {visibleMonths.map((month) => (
            <div
              key={month}
              className={cn(
                "space-y-2",
                !focusedQuarter && [4, 7, 10].includes(month) && "border-l-2 border-slate-300/80 pl-2",
              )}
            >
              <button
                type="button"
                className={cn(
                  "w-full rounded-lg py-1.5 text-center text-[12px] font-medium transition",
                  activeMonth === month
                    ? "bg-blue-100 text-blue-800 shadow-sm ring-1 ring-blue-200"
                    : monthToneByQuarter[quarterLabelByMonth.get(month) ?? ""] ??
                        "bg-slate-100 text-slate-700 hover:bg-slate-200",
                )}
                onClick={() => {
                  if (isPostDragClickSuppressed()) return;
                  setFocusedMonth(month);
                }}
              >
                {MONTHS[month - 1]}
              </button>
              <MonthDropCell month={month} />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {activeMonth ? null : visibleScheduledLanes.length === 0 ? (
          <p className="rounded-md bg-muted/40 p-3 text-[13px] leading-5 text-slate-600">
            Drag initiatives or epics onto a month column (narrow strip under the month name) or move a scheduled bar
            along the timeline.
          </p>
        ) : focusedQuarter ? (
          <div id={TIMELINE_GANTT_ROWS_CONTAINER_ID} className="space-y-2">
            {visibleScheduledLanes.map((initiative) => {
              const start = initiative.startMonth ?? 1;
              const end = initiative.endMonth ?? start;
              const quarterStart = focusedQuarter.months[0];
              const quarterEnd = focusedQuarter.months[focusedQuarter.months.length - 1];
              const visibleStart = Math.max(start, quarterStart);
              const visibleEnd = Math.min(end, quarterEnd);
              const span = Math.max(visibleEnd - visibleStart + 1, 1);
              const columnStart = visibleStart - quarterStart + 1;
              const rz = resizePreview?.initiativeId === initiative.id ? resizePreview : null;
              let previewColumnStart = columnStart;
              let previewSpan = span;
              if (rz) {
                if (rz.side === "right") {
                  const newEnd = Math.min(12, Math.max(start, end + rz.deltaMonths));
                  const qStart = focusedQuarter.months[0];
                  const qEnd = focusedQuarter.months[focusedQuarter.months.length - 1];
                  const visEnd = Math.min(newEnd, qEnd);
                  const visStart = Math.max(start, qStart);
                  previewSpan = Math.max(visEnd - visStart + 1, 1);
                } else {
                  const newStart = Math.max(1, Math.min(end, start + rz.deltaMonths));
                  const qStart = focusedQuarter.months[0];
                  const qEnd = focusedQuarter.months[focusedQuarter.months.length - 1];
                  const visStart = Math.max(newStart, qStart);
                  const visEnd = Math.min(end, qEnd);
                  previewColumnStart = visStart - qStart + 1;
                  previewSpan = Math.max(visEnd - visStart + 1, 1);
                }
              }
              return (
                <GanttLaneRow
                  key={initiative.id}
                  initiative={initiative}
                  focusedQuarter={focusedQuarter}
                  gridStyle={gridStyle}
                  previewColumnStart={previewColumnStart}
                  previewSpan={previewSpan}
                  rz={rz}
                  handleResizePointerDown={handleResizePointerDown}
                  onResizeInitiativeRange={onResizeInitiativeRange}
                  onOpenInitiative={onOpenInitiative}
                  barElsRef={barElsRef}
                  ganttLaneSortIndex={Math.max(
                    0,
                    scheduledInitiatives.findIndex((x) => x.id === initiative.id),
                  )}
                />
              );
            })}
          </div>
        ) : (
          <div id={TIMELINE_GANTT_ROWS_CONTAINER_ID} className="space-y-2">
            {scheduledInitiatives.map((initiative, rowIndex) => {
              const start = initiative.startMonth ?? 1;
              const end = initiative.endMonth ?? start;
              const span = Math.max(end - start + 1, 1);
              const columnStart = start;
              const rz = resizePreview?.initiativeId === initiative.id ? resizePreview : null;
              let previewColumnStart = columnStart;
              let previewSpan = span;
              if (rz) {
                if (rz.side === "right") {
                  const newEnd = Math.min(12, Math.max(start, end + rz.deltaMonths));
                  previewSpan = Math.max(newEnd - start + 1, 1);
                } else {
                  const newStart = Math.max(1, Math.min(end, start + rz.deltaMonths));
                  previewColumnStart = newStart;
                  previewSpan = Math.max(end - newStart + 1, 1);
                }
              }
              return (
                <GanttLaneRow
                  key={initiative.id}
                  initiative={initiative}
                  focusedQuarter={null}
                  gridStyle={gridStyle}
                  previewColumnStart={previewColumnStart}
                  previewSpan={previewSpan}
                  rz={rz}
                  handleResizePointerDown={handleResizePointerDown}
                  onResizeInitiativeRange={onResizeInitiativeRange}
                  onOpenInitiative={onOpenInitiative}
                  barElsRef={barElsRef}
                  ganttLaneSortIndex={rowIndex}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
