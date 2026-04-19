"use client";

import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { EpicPlanTimelineBar, InitiativeTimelineBar } from "@/components/timeline/epic-timeline-bar";
import { QuarterStatus } from "@/components/timeline/quarter-status";
import { isPostDragClickSuppressed } from "@/components/timeline/drag-context";
import { MonthTeamKanbanBoard } from "@/components/timeline/month-team-kanban";
import { SprintAnalytics } from "@/components/timeline/sprint-analytics";
import { SprintKanbanBoard } from "@/components/timeline/sprint-kanban";
import { TIMELINE_GANTT_ROWS_CONTAINER_ID } from "@/lib/gantt-lane-from-pointer";
import { MONTHS, QUARTERS } from "@/lib/timeline";
import {
  MONTH_TEAM_COLUMNS,
  isKnownEpicTeamId,
  monthTeamLabelForId,
  type MonthTeamBoardPersisted,
} from "@/lib/month-team-board";
import { EpicItem, InitiativeItem } from "@/lib/types";
import { clampYearSprint, firstGlobalSprintForMonth, globalSprintFromMonthLane } from "@/lib/year-sprint";
import { cn } from "@/lib/utils";

type GanttLaneRowProps = {
  initiative: InitiativeItem;
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
  const stories = (initiative.epics ?? []).flatMap((epic) => epic.userStories ?? []);
  const totalStories = stories.length;
  const finishedStories = stories.filter((story) => story.status === "done" || story.status === "approved").length;
  const completionPercent = totalStories > 0 ? Math.round((finishedStories / totalStories) * 100) : 0;

  return (
    <div className="relative min-w-0" data-gantt-lane-index={ganttLaneSortIndex}>
      <div className="relative grid min-w-0 gap-2" style={gridStyle}>
          <div
            ref={(node) => {
              if (node) barElsRef.current.set(initiative.id, node);
              else barElsRef.current.delete(initiative.id);
            }}
            className="relative z-20 min-w-0 pt-0.5 pb-2"
            style={{ gridColumn: `${previewColumnStart} / span ${previewSpan}`, gridRow: 1 }}
          >
            <InitiativeTimelineBar
              id={initiative.id}
              title={initiative.title}
              color={initiative.color}
              progressPercent={completionPercent}
              progressLabel={
                totalStories > 0 ? `${finishedStories}/${totalStories} done or approved` : "No user stories"
              }
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

function epicPlanOverlapsMonth(epic: EpicItem, month: number): boolean {
  if (epic.planStartMonth == null || epic.planEndMonth == null) return false;
  return epic.planStartMonth <= month && epic.planEndMonth >= month;
}

type EpicGanttLaneRowProps = {
  epic: EpicItem;
  initiative: InitiativeItem;
  gridStyle: CSSProperties;
  onOpenEpic: (epicId: string) => void;
  ganttLaneSortIndex: number;
};

function formatDayMonthYearShort(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function sprintDateRangeText(year: number, month: number, lane: 1 | 2): string {
  const lastDay = new Date(year, month, 0).getDate();
  const startDay = lane === 1 ? 1 : 16;
  const endDay = lane === 1 ? 15 : lastDay;
  const start = new Date(year, month - 1, startDay);
  const end = new Date(year, month - 1, endDay);
  return `${formatDayMonthYearShort(start)}-${formatDayMonthYearShort(end)}`;
}

function EpicGanttLaneRow({ epic, initiative, gridStyle, onOpenEpic, ganttLaneSortIndex }: EpicGanttLaneRowProps) {
  const stories = epic.userStories ?? [];
  const totalStories = stories.length;
  const finishedStories = stories.filter((story) => story.status === "done" || story.status === "approved").length;
  const completionPercent = totalStories > 0 ? Math.round((finishedStories / totalStories) * 100) : 0;
  const barColor = epic.color?.trim() ? epic.color : initiative.color;

  return (
    <div
      className="relative min-w-0"
      data-gantt-lane-index={ganttLaneSortIndex}
    >
      <p className="mb-1 truncate text-[11px] font-medium text-slate-500">{initiative.title}</p>
      <div className="relative grid min-w-0 gap-2" style={gridStyle}>
        <div
          className="relative z-20 min-w-0 pt-0.5 pb-0.5"
          style={{ gridColumn: "1 / span 1", gridRow: 1 }}
        >
          <EpicPlanTimelineBar
            id={epic.id}
            title={epic.title}
            color={barColor}
            progressPercent={completionPercent}
            progressLabel={
              totalStories > 0 ? `${finishedStories}/${totalStories} done or approved` : "No user stories"
            }
            onClick={() => onOpenEpic(epic.id)}
          />
        </div>
      </div>
    </div>
  );
}

export type MonthPlanSurfaceTab = "epic-gantt" | "team-queue" | "sprint-kanban" | "sprint-status";

type TimelineGridProps = {
  initiatives: InitiativeItem[];
  zoom: number;
  currentYear: number;
  onYearChange?: (year: number) => void | Promise<void>;
  summaryBadges?: {
    totalInitiatives: number;
    scheduledInitiatives: number;
    backlogInitiatives: number;
    totalEpics: number;
    totalStories: number;
  };
  focusedQuarterLabel: string | null;
  focusedMonthExternal?: number | null;
  activeSprintExternal?: number | null;
  activeSprintTabExternal?: "kanban" | "status";
  /** Month drill: team allocation vs sprint tools (controlled from parent for URL sync). */
  monthPlanTab?: MonthPlanSurfaceTab;
  onMonthPlanTabChange?: (tab: MonthPlanSurfaceTab) => void;
  /** Persisted team queues keyed by `year:month` (see monthTeamBoardStorageKey). */
  monthTeamBoardByKey?: Record<string, MonthTeamBoardPersisted>;
  /** Open story Kanban for a global sprint (tabs do not include a sprint-board tab). */
  onEnterSprintStoryBoard?: (yearSprint: number, teamId: string | null) => void;
  /** Delivery team id when sprint story board was opened from a team lane (breadcrumbs + left epic list). */
  sprintStoryBoardTeamId?: string | null;
  /** Sprint view team filter selector (null = all teams). */
  onSprintStoryBoardTeamChange?: (teamId: string | null) => void;
  onFocusedQuarterChange: (quarterLabel: string | null) => void;
  onSprintModeChange: (active: boolean, activeMonth: number | null, activeYearSprint: number | null) => void;
  onSprintTabChange?: (tab: "kanban" | "status") => void;
  onOpenEpic: (epicId: string) => void;
  onOpenInitiative: (initiativeId: string) => void;
  onOpenStory?: (storyId: string) => void;
  onResizeInitiativeRange?: (initiativeId: string, startMonth: number, endMonth: number) => void;
};

const QUARTER_PROGRESS_STEPS: Record<string, number> = {
  Q1: 1,
  Q2: 2,
  Q3: 3,
  Q4: 4,
};

function QuarterYearProgressIcon({
  quarterLabel,
  className,
}: {
  quarterLabel: string;
  className?: string;
}) {
  const activeSteps = Math.max(1, Math.min(4, QUARTER_PROGRESS_STEPS[quarterLabel] ?? 1));

  return (
    <span className={cn("inline-flex h-4 w-4 items-center justify-center", className)} aria-hidden>
      <span className="inline-flex h-3 w-3 items-end gap-[1px]">
        {Array.from({ length: 4 }, (_, idx) => (
          <span
            key={idx}
            className={cn(
              "w-[2px] rounded-[1px] bg-current transition-opacity",
              idx === 0 && "h-[4px]",
              idx === 1 && "h-[6px]",
              idx === 2 && "h-[8px]",
              idx === 3 && "h-[10px]",
              idx < activeSteps ? "opacity-95" : "opacity-25",
            )}
          />
        ))}
      </span>
    </span>
  );
}


/** Drop strip under month header (quarter + month epic plan). */
function MonthDropCell({
  month,
  variant = "compact",
}: {
  month: number;
  variant?: "compact" | "prominent";
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `month:${month}` });
  const isProminent = variant === "prominent";
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "w-full shrink-0 rounded-lg transition",
        isProminent
          ? "mt-2 flex min-h-11 items-center justify-center border border-dashed border-slate-200/90 bg-slate-50/50 px-3 text-center"
          : "h-2",
        isOver
          ? isProminent
            ? "border-primary/35 bg-primary/10 ring-2 ring-primary/15"
            : "h-2.5 bg-primary/25 ring-1 ring-primary/20"
          : isProminent && "hover:border-slate-300/80 hover:bg-slate-50/90",
      )}
      aria-hidden={!isProminent}
    >
      {isProminent ? (
        <span
          className={cn(
            "text-[11px] font-semibold tracking-tight text-slate-500 transition",
            isOver && "text-primary",
          )}
        >
          {isOver ? `Release to place epic in ${MONTHS[month - 1]}` : `Drop epic here to plan in ${MONTHS[month - 1]}`}
        </span>
      ) : null}
    </div>
  );
}

function MonthEpicDropArea({
  month,
  children,
}: {
  month: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `month:${month}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-slate-100/90 p-3 transition ring-1 sm:p-4",
        isOver
          ? "border-primary/35 bg-primary/10 ring-primary/20"
          : "bg-slate-50/35 ring-slate-100/80",
      )}
    >
      {children}
    </div>
  );
}

export function TimelineGrid({
  initiatives,
  zoom,
  currentYear,
  onYearChange,
  summaryBadges,
  focusedQuarterLabel,
  focusedMonthExternal,
  activeSprintExternal,
  activeSprintTabExternal,
  onFocusedQuarterChange,
  onSprintModeChange,
  onSprintTabChange,
  onOpenEpic,
  onOpenInitiative,
  onOpenStory,
  onResizeInitiativeRange,
  monthPlanTab = "epic-gantt",
  onMonthPlanTabChange,
  monthTeamBoardByKey = {},
  onEnterSprintStoryBoard,
  sprintStoryBoardTeamId = null,
  onSprintStoryBoardTeamChange,
}: TimelineGridProps) {
  void zoom;
  const [focusedMonth, setFocusedMonth] = useState<number | null>(null);
  const [activeSprint, setActiveSprint] = useState<number | null>(null);
  const [activeSprintTab, setActiveSprintTab] = useState<"kanban" | "status">("kanban");
  const [quarterViewTab, setQuarterViewTab] = useState<"gantt" | "status">("gantt");
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
  const focusedMonthIsVisible = focusedMonth ? visibleMonths.includes(focusedMonth) : false;
  const activeMonth = focusedMonthIsVisible ? focusedMonth : null;

  const monthEpicGanttRows = useMemo(() => {
    if (activeMonth == null) return [];
    const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const initiative of scheduledInitiatives) {
      const sm = initiative.startMonth ?? 1;
      const em = initiative.endMonth ?? sm;
      if (em < activeMonth || sm > activeMonth) continue;
      for (const epic of initiative.epics ?? []) {
        if (!epicPlanOverlapsMonth(epic, activeMonth)) continue;
        rows.push({ epic, initiative });
      }
    }
    return rows.sort((a, b) => {
      const ir = a.initiative.timelineRow - b.initiative.timelineRow;
      if (ir !== 0) return ir;
      return a.epic.title.localeCompare(b.epic.title);
    });
  }, [scheduledInitiatives, activeMonth]);
  const epicMonthGridStyle = useMemo((): CSSProperties => ({ gridTemplateColumns: "repeat(1, minmax(0, 1fr))" }), []);

  const quarterLabelByMonth = new Map<number, string>(
    QUARTERS.flatMap((quarter) => quarter.months.map((month) => [month, quarter.label] as const)),
  );
  const activeMonthQuarterLabel =
    activeMonth != null ? (quarterLabelByMonth.get(activeMonth) ?? null) : null;
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
  const quarterPanelTone: Record<string, string> = {
    Q1: "bg-blue-50/45 ring-blue-100",
    Q2: "bg-cyan-50/45 ring-cyan-100",
    Q3: "bg-emerald-50/45 ring-emerald-100",
    Q4: "bg-violet-50/45 ring-violet-100",
  };
  const quarterBadgeTone: Record<string, string> = {
    Q1: "bg-blue-500/15 text-blue-900 ring-1 ring-blue-200/70",
    Q2: "bg-cyan-500/15 text-cyan-900 ring-1 ring-cyan-200/70",
    Q3: "bg-emerald-500/15 text-emerald-900 ring-1 ring-emerald-200/70",
    Q4: "bg-violet-500/15 text-violet-900 ring-1 ring-violet-200/70",
  };
  const gridStyle: CSSProperties = {
    gridTemplateColumns: focusedQuarter
      ? `repeat(${visibleMonths.length}, minmax(0, 1fr))`
      : `repeat(12, minmax(0, 1fr))`,
  };

  const prevActiveMonthRef = useRef<number | null>(null);
  useEffect(() => {
    if (focusedMonthExternal === undefined) return;
    setFocusedMonth(focusedMonthExternal);
  }, [focusedMonthExternal]);

  useEffect(() => {
    if (activeSprintExternal === undefined) return;
    setActiveSprint(activeSprintExternal == null ? null : clampYearSprint(activeSprintExternal));
  }, [activeSprintExternal]);

  useEffect(() => {
    if (activeSprintTabExternal === undefined) return;
    setActiveSprintTab(activeSprintTabExternal);
  }, [activeSprintTabExternal]);

  useEffect(() => {
    if (monthPlanTab === "sprint-kanban") setActiveSprintTab("kanban");
    else if (monthPlanTab === "sprint-status") setActiveSprintTab("status");
  }, [monthPlanTab]);

  useEffect(() => {
    if (prevActiveMonthRef.current !== activeMonth) {
      const hadPreviousMonth = prevActiveMonthRef.current != null;
      prevActiveMonthRef.current = activeMonth;
      if (hadPreviousMonth && activeMonth != null) {
        setActiveSprint(firstGlobalSprintForMonth(activeMonth));
        onMonthPlanTabChange?.("epic-gantt");
        setActiveSprintTab("kanban");
      }
    }
  }, [activeMonth, onMonthPlanTabChange]);

  useEffect(() => {
    if (activeMonth != null && activeSprint == null) {
      setActiveSprint(firstGlobalSprintForMonth(activeMonth));
    }
    if (activeSprint == null) {
      setActiveSprintTab("kanban");
    }
  }, [activeMonth, activeSprint]);

  useEffect(() => {
    if (!focusedQuarter) {
      setQuarterViewTab("gantt");
    }
  }, [focusedQuarter]);

  useEffect(() => {
    onSprintTabChange?.(activeSprintTab);
  }, [activeSprintTab, onSprintTabChange]);

  useEffect(() => {
    if (activeMonth == null) {
      onSprintModeChange(false, null, null);
      return;
    }
    onSprintModeChange(true, activeMonth, activeSprint ?? firstGlobalSprintForMonth(activeMonth));
  }, [activeMonth, activeSprint, onSprintModeChange]);

  const breadcrumbItems: Array<{
    label: string;
    onClick: (() => void) | null;
    /** Softer pill for sprint views (avoids heavy black current-page chip). */
    currentTone?: "default" | "sprint";
  }> = [];

  if (activeMonth) {
    const quarterForMonth = QUARTERS.find((q) => q.months.some((m) => m === activeMonth)) ?? null;
    breadcrumbItems.push({
      label: "Roadmap",
      onClick: () => {
        setActiveSprint(null);
        setFocusedMonth(null);
        onFocusedQuarterChange(null);
      },
    });
    if (quarterForMonth) {
      breadcrumbItems.push({
        label: quarterForMonth.label,
        onClick: () => {
          setActiveSprint(null);
          setFocusedMonth(null);
          onFocusedQuarterChange(quarterForMonth.label);
        },
      });
    }
    breadcrumbItems.push({
      label: MONTHS[activeMonth - 1],
      onClick: () => {
        setActiveSprint(null);
        onMonthPlanTabChange?.("epic-gantt");
      },
    });
    if (activeSprint != null && monthPlanTab === "sprint-kanban") {
      breadcrumbItems.push({
        label: `Sprint ${activeSprint}`,
        onClick: null,
        currentTone: "sprint",
      });
    } else if (activeSprint != null && monthPlanTab === "sprint-status") {
      breadcrumbItems.push({
        label: `Sprint ${activeSprint} · insights`,
        onClick: null,
        currentTone: "sprint",
      });
    }
  } else if (focusedQuarter) {
    breadcrumbItems.push({
      label: "Roadmap",
      onClick: () => {
        setFocusedMonth(null);
        onFocusedQuarterChange(null);
      },
    });
    breadcrumbItems.push({
      label: focusedQuarter.label,
      onClick: null,
    });
  }

  const hasBreadcrumbs = breadcrumbItems.length > 0;
  const showSprintTeamPicker =
    activeMonth != null &&
    activeSprint != null &&
    (monthPlanTab === "sprint-kanban" || monthPlanTab === "sprint-status");

  return (
    <div className="h-full min-h-0 w-full overflow-x-hidden overflow-y-auto rounded-xl bg-card p-5 shadow-lg ring-1 ring-black/5">
      <div
        className={cn(
          "mb-4 flex items-center gap-3",
          hasBreadcrumbs ? "px-0 py-1" : "rounded-lg bg-slate-100 px-0 py-2.5",
          hasBreadcrumbs ? "justify-between" : "justify-start",
        )}
      >
        {hasBreadcrumbs ? (
          <div className="inline-flex items-center gap-1 rounded-xl bg-white/85 px-2 py-1.5 shadow-sm ring-1 ring-slate-200/90 backdrop-blur-sm">
            {breadcrumbItems.map((item, index) => (
              <div key={`${item.label}-${index}`} className="flex items-center gap-1">
                {item.onClick ? (
                  <button
                    type="button"
                    onClick={item.onClick}
                    className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-1.5 text-[14px] font-semibold tracking-[0.01em] text-slate-700 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 active:scale-[0.98]"
                  >
                    {item.label}
                  </button>
                ) : (
                  <span
                    aria-current="page"
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-[14px] font-semibold tracking-[0.01em] shadow-sm ring-1",
                      item.currentTone === "sprint"
                        ? "bg-gradient-to-r from-sky-50 via-indigo-50/90 to-violet-50 text-slate-800 ring-sky-200/75"
                        : "bg-slate-800 text-white ring-slate-900/10",
                    )}
                  >
                    {item.label}
                  </span>
                )}
                {index < breadcrumbItems.length - 1 ? (
                  <ChevronRight className="size-4 text-slate-400" aria-hidden />
                ) : null}
              </div>
            ))}
            {showSprintTeamPicker ? (
              <>
                <ChevronRight className="size-4 text-slate-400" aria-hidden />
                <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/90 px-2 py-1 shadow-sm">
                  <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Team</span>
                  <select
                    value={isKnownEpicTeamId(sprintStoryBoardTeamId) ? sprintStoryBoardTeamId : "all"}
                    onChange={(event) => {
                      const next = event.target.value;
                      onSprintStoryBoardTeamChange?.(next === "all" ? null : next);
                    }}
                    className="h-7 min-w-[9.25rem] cursor-pointer rounded-md border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-800 outline-none transition hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300/70"
                    aria-label="Filter sprint views by team"
                  >
                    <option value="all">All teams</option>
                    {MONTH_TEAM_COLUMNS.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
        ) : null}
        {!focusedQuarter && !activeMonth ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <label className="ml-3 inline-flex items-center gap-3 rounded-md border border-indigo-200/80 bg-gradient-to-b from-indigo-50 to-violet-50 px-2.5 py-1 shadow-sm ring-1 ring-indigo-200/60">
              <span className="shrink-0 text-[12px] font-semibold tracking-[0.045em] text-slate-700 uppercase">
                Roadmap
              </span>
              <div className="relative">
                <select
                  value={currentYear}
                  onChange={(event) => onYearChange?.(Number(event.target.value))}
                  className="h-[30px] min-w-[5.75rem] cursor-pointer appearance-none rounded-md border border-indigo-300/75 bg-white/95 py-0 pl-2 pr-7 font-sans text-[12px] font-semibold leading-none text-slate-800 shadow-[0_1px_2px_rgba(67,56,202,0.06)] outline-none transition hover:border-indigo-400/85 hover:bg-white hover:shadow-[0_1px_4px_rgba(67,56,202,0.1)] focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-300/55"
                >
                  <option value={2024}>2024</option>
                  <option value={2025}>2025</option>
                  <option value={2026}>2026</option>
                  <option value={2027}>2027</option>
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-1.5 top-1/2 size-[13px] -translate-y-1/2 text-indigo-600/90"
                  aria-hidden
                />
              </div>
            </label>
            {summaryBadges ? (
              <div className="flex flex-wrap items-center justify-end gap-2 pr-3">
                <div className="rounded-full bg-slate-200 px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] text-slate-800 ring-1 ring-slate-300">
                  {summaryBadges.totalInitiatives} initiatives
                </div>
                <div className="rounded-full bg-emerald-100 px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] text-emerald-800">
                  {summaryBadges.scheduledInitiatives} scheduled
                </div>
                <div className="rounded-full bg-slate-200 px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] text-slate-800">
                  {summaryBadges.backlogInitiatives} backlog
                </div>
                <div className="rounded-full bg-amber-100 px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] text-amber-800">
                  {summaryBadges.totalEpics} epics
                </div>
                <div className="rounded-full bg-blue-100 px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] text-blue-800">
                  {summaryBadges.totalStories} user stories
                </div>
              </div>
            ) : null}
          </div>
        ) : activeMonth ? (
          <div className="inline-flex min-w-0 shrink-0 flex-col gap-2 rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white via-white to-slate-50/90 px-2 py-2 shadow-md ring-1 ring-slate-200/55 backdrop-blur-sm sm:flex-row sm:items-center">
            <div className="inline-flex min-w-0 flex-1 rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/80">
              <button
                type="button"
                onClick={() => {
                  onMonthPlanTabChange?.("epic-gantt");
                }}
                className={cn(
                  "min-w-0 shrink rounded-lg px-3 py-2 text-[12px] font-semibold transition sm:text-[13px]",
                  monthPlanTab === "epic-gantt"
                    ? "bg-white text-slate-900 shadow-md ring-1 ring-slate-300/90"
                    : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
                )}
              >
                Epic plan
              </button>
              <button
                type="button"
                onClick={() => {
                  onMonthPlanTabChange?.("team-queue");
                }}
                className={cn(
                  "min-w-0 shrink rounded-lg px-3 py-2 text-[12px] font-semibold transition sm:text-[13px]",
                  monthPlanTab === "team-queue"
                    ? "bg-white text-slate-900 shadow-md ring-1 ring-slate-300/90"
                    : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
                )}
              >
                Team queue
              </button>
              <button
                type="button"
                onClick={() => {
                  onMonthPlanTabChange?.("sprint-status");
                  setActiveSprintTab("status");
                }}
                className={cn(
                  "min-w-0 shrink rounded-lg px-3 py-2 text-[12px] font-semibold transition sm:text-[13px]",
                  monthPlanTab === "sprint-status"
                    ? "bg-white text-slate-900 shadow-md ring-1 ring-slate-300/90"
                    : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
                )}
              >
                Sprint insights
              </button>
            </div>
          </div>
        ) : focusedQuarter ? (
          <div className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-white/85 px-2 py-1.5 shadow-sm ring-1 ring-slate-200/90 backdrop-blur-sm">
            <div className="inline-flex rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setQuarterViewTab("gantt")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13px] font-semibold transition",
                  quarterViewTab === "gantt"
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-300"
                    : "text-slate-600 hover:text-slate-800",
                )}
              >
                Gantt
              </button>
              <button
                type="button"
                onClick={() => setQuarterViewTab("status")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13px] font-semibold transition",
                  quarterViewTab === "status"
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-300"
                    : "text-slate-600 hover:text-slate-800",
                )}
              >
                Quarter status
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2" />
        )}
      </div>
      {!activeMonth && !(focusedQuarter && quarterViewTab === "status") ? (
        <div className="mb-4 grid min-w-0 gap-2" style={gridStyle}>
          {visibleQuarterHeaders.map((quarter) => (
            <button
              key={quarter.label}
              type="button"
              onClick={() => {
                setFocusedMonth(null);
                onFocusedQuarterChange(focusedQuarterLabel === quarter.label ? null : quarter.label);
              }}
              className={cn(
                "flex w-full min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-center text-[14px] font-semibold tracking-[0.02em] transition duration-200",
                focusedQuarterLabel === quarter.label
                  ? quarterTone[quarter.label]?.active ?? "border-primary/30 bg-primary/10 text-primary"
                  : quarterTone[quarter.label]?.idle ?? "border-border/40 bg-muted text-muted-foreground",
              )}
              style={{ gridColumn: `span ${quarter.months.length} / span ${quarter.months.length}` }}
            >
              <QuarterYearProgressIcon quarterLabel={quarter.label} />
              <span>{quarter.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {activeMonth ? (
        <div
          className={cn(
            "mb-4 rounded-2xl p-1.5 shadow-lg ring-1",
            activeMonthQuarterLabel && quarterPanelTone[activeMonthQuarterLabel]
              ? quarterPanelTone[activeMonthQuarterLabel]
              : "bg-slate-100/70 ring-slate-200/90",
          )}
        >
          <div
            className={cn(
              "flex flex-col overflow-hidden rounded-xl border border-white/70 bg-white/95 shadow-inner ring-1 ring-slate-200/45 backdrop-blur-sm",
              monthPlanTab === "epic-gantt" ||
              monthPlanTab === "team-queue" ||
              monthPlanTab === "sprint-kanban"
                ? "min-h-[56rem]"
                : "min-h-0",
            )}
          >
            {monthPlanTab === "epic-gantt" && activeMonth != null ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 p-3 sm:p-5">
                <div className="grid min-w-0 shrink-0 gap-3" style={epicMonthGridStyle}>
                  <div
                    className={cn(
                      "overflow-hidden rounded-2xl border border-slate-200/55 p-4 shadow-sm ring-1 ring-black/[0.03]",
                      activeMonthQuarterLabel === "Q1" && "bg-gradient-to-br from-blue-50/95 via-white to-white",
                      activeMonthQuarterLabel === "Q2" && "bg-gradient-to-br from-cyan-50/95 via-white to-white",
                      activeMonthQuarterLabel === "Q3" && "bg-gradient-to-br from-emerald-50/95 via-white to-white",
                      activeMonthQuarterLabel === "Q4" && "bg-gradient-to-br from-violet-50/95 via-white to-white",
                      !activeMonthQuarterLabel && "bg-gradient-to-br from-slate-50/90 via-white to-white",
                    )}
                  >
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Timeline</p>
                        <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
                          <h3 className="text-[20px] font-bold tracking-tight text-slate-900 sm:text-[22px]">
                            {MONTHS[activeMonth - 1]}
                          </h3>
                          <span className="rounded-md bg-white/80 px-2 py-0.5 text-[13px] font-semibold tabular-nums text-slate-500 shadow-sm ring-1 ring-slate-200/80">
                            {currentYear}
                          </span>
                        </div>
                      </div>
                      {activeMonthQuarterLabel ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider shadow-sm",
                            quarterBadgeTone[activeMonthQuarterLabel] ??
                              "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
                          )}
                        >
                          {activeMonthQuarterLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        title={`Open sprint ${globalSprintFromMonthLane(activeMonth, 1)} board`}
                        onClick={() => {
                          if (isPostDragClickSuppressed()) return;
                          onEnterSprintStoryBoard?.(globalSprintFromMonthLane(activeMonth, 1), null);
                        }}
                        className="flex min-h-[2rem] items-center justify-center rounded-lg border border-slate-200/80 bg-white py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-black/[0.04] transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99]"
                      >
                        {`Sprint ${globalSprintFromMonthLane(activeMonth, 1)} (${sprintDateRangeText(currentYear, activeMonth, 1)})`}
                      </button>
                      <button
                        type="button"
                        title={`Open sprint ${globalSprintFromMonthLane(activeMonth, 2)} board`}
                        onClick={() => {
                          if (isPostDragClickSuppressed()) return;
                          onEnterSprintStoryBoard?.(globalSprintFromMonthLane(activeMonth, 2), null);
                        }}
                        className="flex min-h-[2rem] items-center justify-center rounded-lg border border-slate-200/80 bg-white py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-black/[0.04] transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99]"
                      >
                        {`Sprint ${globalSprintFromMonthLane(activeMonth, 2)} (${sprintDateRangeText(currentYear, activeMonth, 2)})`}
                      </button>
                    </div>
                  </div>
                </div>
                <MonthEpicDropArea month={activeMonth}>
                  <div id={TIMELINE_GANTT_ROWS_CONTAINER_ID} className="space-y-2">
                  {monthEpicGanttRows.length === 0 ? (
                    <div className="rounded-lg bg-slate-50/70 px-4 py-6 text-center text-[12px] text-slate-600">
                      No epics are planned in {MONTHS[activeMonth - 1]} yet. Drag one from the left panel into the drop
                      area below.
                    </div>
                  ) : (
                    monthEpicGanttRows.map(({ epic, initiative }, rowIndex) => (
                      <EpicGanttLaneRow
                        key={epic.id}
                        epic={epic}
                        initiative={initiative}
                        gridStyle={epicMonthGridStyle}
                        onOpenEpic={onOpenEpic}
                        ganttLaneSortIndex={rowIndex}
                      />
                    ))
                  )}
                  </div>
                </MonthEpicDropArea>
              </div>
            ) : monthPlanTab === "team-queue" ? (
              <div className="flex-1 p-3 sm:p-5">
                <MonthTeamKanbanBoard
                  initiatives={initiatives}
                  month={activeMonth}
                  year={currentYear}
                  board={monthTeamBoardByKey[`${currentYear}:${activeMonth}`]}
                  onOpenEpic={onOpenEpic}
                  onOpenSprintKanban={(yearSprint, teamId) => {
                    onEnterSprintStoryBoard?.(yearSprint, teamId);
                  }}
                />
              </div>
            ) : monthPlanTab === "sprint-kanban" ? (
              <div className="flex-1 p-3 sm:p-5">
                <SprintKanbanBoard
                  initiatives={initiatives}
                  month={activeMonth}
                  yearSprint={activeSprint ?? firstGlobalSprintForMonth(activeMonth)}
                  filterEpicTeamId={isKnownEpicTeamId(sprintStoryBoardTeamId) ? sprintStoryBoardTeamId : null}
                  onOpenStory={onOpenStory ?? (() => {})}
                />
              </div>
            ) : (
              <div className="p-3 sm:p-5">
                <SprintAnalytics
                  initiatives={initiatives}
                  month={activeMonth}
                  yearSprint={activeSprint ?? firstGlobalSprintForMonth(activeMonth)}
                  planYear={currentYear}
                  filterEpicTeamId={isKnownEpicTeamId(sprintStoryBoardTeamId) ? sprintStoryBoardTeamId : null}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {focusedQuarter && quarterViewTab === "gantt" ? (
            <div className="mb-4 grid min-w-0 gap-2" style={gridStyle}>
              {visibleMonths.map((month) => (
                <div
                  key={month}
                  className="space-y-2 rounded-2xl border border-slate-200/50 bg-gradient-to-b from-white to-slate-50/40 p-2.5 shadow-sm ring-1 ring-black/[0.03]"
                >
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded-xl py-2.5 text-center text-[13px] font-bold tracking-tight shadow-sm ring-1 ring-black/[0.04] transition",
                      activeMonth === month
                        ? "bg-gradient-to-br from-blue-100 to-indigo-50 text-blue-900 ring-blue-200/80"
                        : monthToneByQuarter[quarterLabelByMonth.get(month) ?? ""] ??
                            "bg-slate-100 text-slate-700 ring-slate-200/80 hover:-translate-y-px hover:shadow-md",
                    )}
                    onClick={() => {
                      if (isPostDragClickSuppressed()) return;
                      setFocusedMonth(month);
                      onMonthPlanTabChange?.("epic-gantt");
                    }}
                  >
                    {MONTHS[month - 1]}
                  </button>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      title={`Sprint ${globalSprintFromMonthLane(month, 1)}`}
                      onClick={() => {
                        if (isPostDragClickSuppressed()) return;
                        setFocusedMonth(month);
                        onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, 1), null);
                      }}
                      className="flex min-h-[2rem] items-center justify-center rounded-lg border border-slate-200/80 bg-white py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-black/[0.04] transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99]"
                    >
                      {`Sprint ${globalSprintFromMonthLane(month, 1)} (${sprintDateRangeText(currentYear, month, 1)})`}
                    </button>
                    <button
                      type="button"
                      title={`Sprint ${globalSprintFromMonthLane(month, 2)}`}
                      onClick={() => {
                        if (isPostDragClickSuppressed()) return;
                        setFocusedMonth(month);
                        onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, 2), null);
                      }}
                      className="flex min-h-[2rem] items-center justify-center rounded-lg border border-slate-200/80 bg-white py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-black/[0.04] transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99]"
                    >
                      {`Sprint ${globalSprintFromMonthLane(month, 2)} (${sprintDateRangeText(currentYear, month, 2)})`}
                    </button>
                  </div>
                  <MonthDropCell month={month} />
                </div>
              ))}
            </div>
          ) : !focusedQuarter ? (
            <div className="mb-4 grid min-w-0 grid-cols-4 gap-2">
              {QUARTERS.map((quarter) => (
                <section
                  key={quarter.label}
                  className={cn("rounded-lg p-2 ring-1", quarterPanelTone[quarter.label] ?? "bg-slate-50 ring-slate-200")}
                >
                  <div className="grid grid-cols-3 gap-2">
                    {quarter.months.map((month) => (
                      <div key={month} className="space-y-2">
                        <button
                          type="button"
                          className={cn(
                            "w-full rounded-lg py-2 text-center text-[14px] font-semibold shadow-sm ring-1 ring-black/5 transition hover:-translate-y-px hover:shadow-md",
                            monthToneByQuarter[quarter.label] ?? "bg-slate-100 text-slate-700 hover:bg-slate-200",
                          )}
                          onClick={() => {
                            if (isPostDragClickSuppressed()) return;
                            setFocusedMonth(month);
                            onMonthPlanTabChange?.("epic-gantt");
                          }}
                        >
                          {MONTHS[month - 1]}
                        </button>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            type="button"
                            title={`Sprint ${globalSprintFromMonthLane(month, 1)}`}
                            onClick={() => {
                              if (isPostDragClickSuppressed()) return;
                              setFocusedMonth(month);
                              onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, 1), null);
                            }}
                            className="flex h-5 items-center justify-center rounded bg-white/75 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200/80 transition hover:bg-white hover:text-slate-800"
                          >
                            {globalSprintFromMonthLane(month, 1)}
                          </button>
                          <button
                            type="button"
                            title={`Sprint ${globalSprintFromMonthLane(month, 2)}`}
                            onClick={() => {
                              if (isPostDragClickSuppressed()) return;
                              setFocusedMonth(month);
                              onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, 2), null);
                            }}
                            className="flex h-5 items-center justify-center rounded bg-white/75 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200/80 transition hover:bg-white hover:text-slate-800"
                          >
                            {globalSprintFromMonthLane(month, 2)}
                          </button>
                        </div>
                        <MonthDropCell month={month} />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : null}
        </>
      )}

      <div className="space-y-2">
        {activeMonth ? null : focusedQuarter && quarterViewTab === "status" ? (
          <QuarterStatus initiatives={initiatives} quarterMonths={focusedQuarter.months} planYear={currentYear} />
        ) : visibleScheduledLanes.length === 0 ? (
          <p className="rounded-md bg-muted/40 p-3.5 text-[14px] leading-6 text-slate-600">
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
