"use client";

import { useDroppable } from "@dnd-kit/core";
import { BarChart3, ChevronDown, ChevronRight, ClipboardList, Map as MapIcon, Thermometer } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { EpicPlanTimelineBar, InitiativeTimelineBar } from "@/components/timeline/epic-timeline-bar";
import { EpicPlanBarIcon, InitiativePlanBarIcon } from "@/components/timeline/epic-plan-bar";
import { QuarterStatus } from "@/components/timeline/quarter-status";
import { isPostDragClickSuppressed } from "@/components/timeline/drag-context";
import { MonthAnalytics } from "@/components/timeline/month-analytics";
import { MonthTeamCapacityBoard } from "@/components/timeline/month-team-capacity";
import { MonthTeamKanbanBoard } from "@/components/timeline/month-team-kanban";
import { QuarterTeamCapacityBoard } from "@/components/timeline/quarter-team-capacity";
import { SprintAnalytics } from "@/components/timeline/sprint-analytics";
import { SprintCapacityBoard } from "@/components/timeline/sprint-capacity";
import { SprintKanbanBoard } from "@/components/timeline/sprint-kanban";
import { SprintRetrospectiveEditor, type SprintRetrospectiveDoc } from "@/components/timeline/sprint-retrospective";
import { TIMELINE_GANTT_ROWS_CONTAINER_ID } from "@/lib/gantt-lane-from-pointer";
import { type MonthTeamCapacityBoard as MonthTeamCapacityBoardModel } from "@/lib/month-team-capacity";
import { MONTHS, QUARTERS } from "@/lib/timeline";
import {
  MONTH_TEAM_COLUMNS,
  isKnownEpicTeamId,
  type MonthTeamBoardPersisted,
} from "@/lib/month-team-board";
import { EpicItem, InitiativeItem } from "@/lib/types";
import {
  clampYearSprint,
  firstGlobalSprintForMonth,
  globalSprintFromMonthLane,
  monthRangeFromYearSprintRange,
  resolvedInitiativeYearSprintBounds,
} from "@/lib/year-sprint";
import { cn } from "@/lib/utils";

export type InitiativeScheduleRangePatch = {
  startMonth: number;
  endMonth: number;
  startYearSprint: number;
  endYearSprint: number;
};

type GanttLaneRowProps = {
  initiative: InitiativeItem;
  gridStyle: CSSProperties;
  previewColumnStart: number;
  previewSpan: number;
  rz: { initiativeId: string; side: "left" | "right"; deltaSteps: number } | null;
  handleResizePointerDown: (
    initiativeId: string,
    side: "left" | "right",
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  onResizeInitiativeRange?: (initiativeId: string, range: InitiativeScheduleRangePatch) => void;
  onOpenInitiative: (initiativeId: string) => void;
  barElsRef: React.MutableRefObject<Map<string, HTMLDivElement>>;
  /** Sort index among scheduled initiatives (for pointer-based lane drop). */
  ganttLaneSortIndex: number;
  /** Brief emphasis when expanded from the left accordion (scheduled initiatives). */
  emphasize?: boolean;
  /** Bumps when emphasis is re-triggered so the CSS animation restarts. */
  emphasizeTick?: number;
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
  emphasize = false,
  emphasizeTick = 0,
}: GanttLaneRowProps) {
  const resizeEdgeClass =
    "pointer-events-auto absolute inset-y-0.5 z-20 w-2.5 touch-none select-none rounded-md bg-white/0 transition-colors hover:bg-white/30 active:bg-white/40";
  const stories = (initiative.epics ?? []).flatMap((epic) => epic.userStories ?? []);
  const totalStories = stories.length;
  const finishedStories = stories.filter((story) => story.status === "done" || story.status === "approved").length;
  const completionPercent = totalStories > 0 ? Math.round((finishedStories / totalStories) * 100) : 0;

  return (
    <div
      className={cn("relative min-w-0", emphasize ? "z-[25]" : "z-10")}
      data-gantt-lane-index={ganttLaneSortIndex}
      data-gantt-timeline-row={Number.isFinite(initiative.timelineRow) ? initiative.timelineRow : 0}
    >
      <div className="relative grid min-w-0 gap-2" style={gridStyle}>
          <div
            key={emphasize ? `gantt-emphasis-${emphasizeTick}` : undefined}
            ref={(node) => {
              if (node) barElsRef.current.set(initiative.id, node);
              else barElsRef.current.delete(initiative.id);
            }}
            className={cn(
              "relative min-w-0 rounded-lg pt-0.5 pb-2",
              rz ? "z-0 opacity-70" : "z-20",
              emphasize ? "overflow-visible" : "overflow-hidden",
            )}
            style={{ gridColumn: `${previewColumnStart} / span ${previewSpan}`, gridRow: 1 }}
          >
            <InitiativeTimelineBar
              id={initiative.id}
              title={initiative.title}
              icon={initiative.icon}
              color={initiative.color}
              progressPercent={completionPercent}
              progressLabel={
                totalStories > 0 ? `${finishedStories}/${totalStories} done or approved` : "No user stories"
              }
              isResizing={Boolean(rz)}
              emphasizeFlash={emphasize}
              emphasizeTick={emphasizeTick}
              onClick={() => onOpenInitiative(initiative.id)}
            />
            {onResizeInitiativeRange ? (
              <>
                <div
                  role="slider"
                  aria-label="Resize initiative start (sprint step)"
                  title="Drag to change start sprint"
                  className={cn(resizeEdgeClass, "left-0 cursor-ew-resize")}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    handleResizePointerDown(initiative.id, "left", e);
                  }}
                />
                <div
                  role="slider"
                  aria-label="Resize initiative end (sprint step)"
                  title="Drag to change end sprint"
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
  month?: number | null;
  onOpenEpic: (epicId: string) => void;
  onUnscheduleEpic?: (epicId: string) => void;
  ganttLaneSortIndex: number;
  emphasize?: boolean;
  emphasizeTick?: number;
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

function sprintDateWeekdayRangeText(year: number, month: number, lane: 1 | 2): string {
  const lastDay = new Date(year, month, 0).getDate();
  const startDay = lane === 1 ? 1 : 16;
  const endDay = lane === 1 ? 15 : lastDay;
  const start = new Date(year, month - 1, startDay);
  const end = new Date(year, month - 1, endDay);
  const wd = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short" });
  return `${wd(start)} ${formatDayMonthYearShort(start)} - ${wd(end)} ${formatDayMonthYearShort(end)}`;
}

function sprintDaysWithWeekday(year: number, month: number, lane: 1 | 2): Array<{
  key: string;
  weekday: string;
  dayMonth: string;
}> {
  const lastDay = new Date(year, month, 0).getDate();
  const startDay = lane === 1 ? 1 : 16;
  const endDay = lane === 1 ? 15 : lastDay;
  const out: Array<{ key: string; weekday: string; dayMonth: string }> = [];
  for (let day = startDay; day <= endDay; day += 1) {
    const date = new Date(year, month - 1, day);
    const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
    out.push({
      key: date.toISOString(),
      weekday,
      dayMonth: formatDayMonthShort(date),
    });
  }
  return out;
}

function formatDayMonthShort(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Today across 24 year-sprint columns (aligns with full-year Gantt lanes). */
function todayLeftPercentInYearSprints(planYear: number): number | null {
  const t = new Date();
  if (t.getFullYear() !== planYear) return null;
  const m = t.getMonth() + 1;
  const d = t.getDate();
  const lane: 1 | 2 = d <= 15 ? 1 : 2;
  const g = globalSprintFromMonthLane(m, lane);
  return ((g - 0.5) / 24) * 100;
}

/** Today within a quarter’s sprint columns (6 for a standard quarter). */
function todayLeftPercentInQuarterSprints(planYear: number, quarterMonths: readonly number[]): number | null {
  const t = new Date();
  if (t.getFullYear() !== planYear) return null;
  const m = t.getMonth() + 1;
  if (!quarterMonths.includes(m)) return null;
  const d = t.getDate();
  const lane: 1 | 2 = d <= 15 ? 1 : 2;
  const g = globalSprintFromMonthLane(m, lane);
  const qLo = firstGlobalSprintForMonth(quarterMonths[0]);
  const qHi = globalSprintFromMonthLane(quarterMonths[quarterMonths.length - 1], 2);
  if (g < qLo || g > qHi) return null;
  const n = qHi - qLo + 1;
  return ((g - qLo + 0.5) / n) * 100;
}

/** Single-month epic lane (one column). */
function todayLeftPercentInSingleMonth(planYear: number, month: number): number | null {
  const t = new Date();
  if (t.getFullYear() !== planYear || t.getMonth() + 1 !== month) return null;
  const dim = daysInMonth(planYear, month);
  return ((t.getDate() - 0.5) / dim) * 100;
}

/** Full-year / all-quarters roadmap: compact “S” + global sprint number. */
function sprintLabelYearRoadmap(globalSprint: number): string {
  return `S${globalSprint}`;
}

/** Quarter or month drill-in views: full word “Sprint”. */
function sprintLabelQuarterOrMonth(globalSprint: number): string {
  return `Sprint ${globalSprint}`;
}

type TodayBadgePlacement = "above" | "inside";

/** “Today” badge + vertical dashed marker, always aligned (same parent coordinate space). */
function GanttTodayMarker({
  leftPercent,
  showBadge = true,
  badgePlacement = "above",
  /** Bleed top/bottom past the track box so the dash meets the outer padded panel border (parent uses py-3 sm:py-4). */
  bleedToPaddedPanel,
}: {
  leftPercent: number | null;
  showBadge?: boolean;
  badgePlacement?: TodayBadgePlacement;
  bleedToPaddedPanel?: boolean;
}) {
  if (leftPercent == null || Number.isNaN(leftPercent)) return null;
  const x = Math.min(100, Math.max(0, leftPercent));
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 z-0 overflow-visible [isolation:isolate]",
        bleedToPaddedPanel ? "-top-3 -bottom-3 sm:-top-4 sm:-bottom-4" : "inset-y-0",
      )}
      aria-hidden
    >
      {showBadge ? (
        <div
          className={cn(
            "absolute left-0 rounded border border-emerald-200/80 bg-white/95 px-1 py-px text-[10px] font-semibold leading-none text-emerald-800 shadow-sm ring-1 ring-emerald-100/60",
            badgePlacement === "inside" ? "top-1.5" : "-top-5 sm:-top-6",
          )}
          style={{ left: `${x}%`, transform: "translateX(-50%)" }}
        >
          Today
        </div>
      ) : null}

      {/* Downward arrow at line start (same x as dashed line). */}
      <div
        className="absolute top-0 z-[1] h-0 w-0 border-x-[6px] border-x-transparent border-t-[8px] border-t-emerald-500 drop-shadow-[0_0_6px_rgba(16,185,129,0.4)]"
        style={{ left: `${x}%`, transform: "translateX(-50%)" }}
      />
      <div
        className="absolute top-0 bottom-0 w-0 border-l border-dashed border-emerald-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.35)]"
        style={{ left: `${x}%`, transform: "translateX(-50%)" }}
      />
    </div>
  );
}

function EpicGanttLaneRow({
  epic,
  initiative,
  gridStyle,
  month = null,
  onOpenEpic,
  onUnscheduleEpic,
  ganttLaneSortIndex,
  emphasize = false,
  emphasizeTick = 0,
}: EpicGanttLaneRowProps) {
  const stories = epic.userStories ?? [];
  const totalStories = stories.length;
  const finishedStories = stories.filter((story) => story.status === "done" || story.status === "approved").length;
  const completionPercent = totalStories > 0 ? Math.round((finishedStories / totalStories) * 100) : 0;
  const barColor = epic.color?.trim() ? epic.color : initiative.color;
  const sprintGridStyle =
    month != null
      ? ({ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } satisfies CSSProperties)
      : gridStyle;
  let barGridColumn = "1 / span 1";
  if (month != null && epic.planStartMonth != null && epic.planEndMonth != null) {
    const startLane = epic.planSprint === 2 ? 2 : 1;
    const endLane = epic.planEndSprint === 1 ? 1 : 2;
    let monthStartLane = 1;
    let monthEndLane = 2;
    if (month === epic.planStartMonth && month === epic.planEndMonth) {
      monthStartLane = startLane;
      monthEndLane = endLane;
    } else if (month === epic.planStartMonth) {
      monthStartLane = startLane;
      monthEndLane = 2;
    } else if (month === epic.planEndMonth) {
      monthStartLane = 1;
      monthEndLane = endLane;
    }
    const span = Math.max(1, monthEndLane - monthStartLane + 1);
    barGridColumn = `${monthStartLane} / span ${span}`;
  }

  return (
    <div
      className={cn("relative min-w-0", emphasize ? "z-[25]" : "z-10")}
      data-gantt-lane-index={ganttLaneSortIndex}
      data-gantt-timeline-row={Number.isFinite(initiative.timelineRow) ? initiative.timelineRow : 0}
    >
      <p className="mb-1 inline-flex min-w-0 items-center gap-1 truncate text-[11px] font-medium text-slate-500">
        <InitiativePlanBarIcon icon={initiative.icon} className="mr-0 text-[11px] [&_svg]:size-3 [&_svg]:text-blue-600" />
        <span className="truncate">{initiative.title}</span>
      </p>
      <div className="relative grid min-w-0 gap-2" style={sprintGridStyle}>
        <div
          className={cn("relative z-20 min-w-0 pt-0.5 pb-0.5", emphasize && "overflow-visible")}
          style={{ gridColumn: barGridColumn, gridRow: 1 }}
        >
          <EpicPlanTimelineBar
            id={epic.id}
            title={epic.title}
            icon={epic.icon}
            color={barColor}
            progressPercent={completionPercent}
            progressLabel={
              totalStories > 0 ? `${finishedStories}/${totalStories} done or approved` : "No user stories"
            }
            emphasizeFlash={emphasize}
            emphasizeTick={emphasizeTick}
            onUnschedule={onUnscheduleEpic ? () => onUnscheduleEpic(epic.id) : undefined}
            onClick={() => onOpenEpic(epic.id)}
          />
        </div>
      </div>
    </div>
  );
}

function MonthInitiativeGanttLaneRow({
  initiative,
  onOpenInitiative,
  ganttLaneSortIndex,
}: {
  initiative: InitiativeItem;
  onOpenInitiative: (initiativeId: string) => void;
  ganttLaneSortIndex: number;
}) {
  const stories = (initiative.epics ?? []).flatMap((epic) => epic.userStories ?? []);
  const totalStories = stories.length;
  const finishedStories = stories.filter((story) => story.status === "done" || story.status === "approved").length;
  const completionPercent = totalStories > 0 ? Math.round((finishedStories / totalStories) * 100) : 0;

  return (
    <div
      className="relative z-10 min-w-0"
      data-gantt-lane-index={ganttLaneSortIndex}
      data-gantt-timeline-row={Number.isFinite(initiative.timelineRow) ? initiative.timelineRow : 0}
    >
      <div className="relative grid min-w-0 gap-2" style={{ gridTemplateColumns: "repeat(1, minmax(0, 1fr))" }}>
        <div className="relative z-20 min-w-0 pt-0.5 pb-0.5" style={{ gridColumn: "1 / span 1", gridRow: 1 }}>
          <InitiativeTimelineBar
            id={initiative.id}
            title={initiative.title}
            icon={initiative.icon}
            color={initiative.color}
            progressPercent={completionPercent}
            progressLabel={totalStories > 0 ? `${finishedStories}/${totalStories} done or approved` : "No user stories"}
            onClick={() => onOpenInitiative(initiative.id)}
          />
        </div>
      </div>
    </div>
  );
}

export type MonthPlanSurfaceTab =
  | "epic-gantt"
  | "team-queue"
  | "month-capacity"
  | "month-status"
  | "sprint-kanban"
  | "sprint-status"
  | "sprint-capacity"
  | "sprint-retrospective";

type TimelineGridProps = {
  initiatives: InitiativeItem[];
  zoom: number;
  currentYear: number;
  onYearChange?: (year: number) => void | Promise<void>;
  summaryBadges?: {
    totalInitiatives: number;
    scheduledInitiatives: number;
    totalEpics?: number;
    scheduledEpics: number;
    unscheduledEpics: number;
    totalStories: number;
  };
  onSummaryStatusQuickFilterChange?: (value: "Scheduled" | "Unscheduled" | null) => void;
  summaryStatusQuickFilter?: "Scheduled" | "Unscheduled" | null;
  focusedQuarterLabel: string | null;
  focusedMonthExternal?: number | null;
  activeSprintExternal?: number | null;
  activeSprintTabExternal?: "kanban" | "status";
  /** Month drill: team allocation vs sprint tools (controlled from parent for URL sync). */
  monthPlanTab?: MonthPlanSurfaceTab;
  onMonthPlanTabChange?: (tab: MonthPlanSurfaceTab) => void;
  /** Persisted team queues keyed by `year:month` (see monthTeamBoardStorageKey). */
  monthTeamBoardByKey?: Record<string, MonthTeamBoardPersisted>;
  monthTeamCapacityBoard?: { capacities: Record<string, number> };
  monthTeamCapacityByKey?: Record<string, MonthTeamCapacityBoardModel>;
  onMonthTeamCapacityChange?: (teamId: string, days: number) => void;
  /** Quarter view: set per-team quarter total; parent splits across months in the quarter. */
  onQuarterTeamCapacityChange?: (quarterLabel: string, teamId: string, quarterTotalDays: number) => void;
  /** All-quarters view: set per-team year total; parent splits across all months in year. */
  onYearTeamCapacityChange?: (teamId: string, yearTotalDays: number) => void;
  onMonthTeamCapacityEpicRemove?: (epicId: string) => void;
  /** Open story Kanban for a global sprint (tabs do not include a sprint-board tab). */
  onEnterSprintStoryBoard?: (yearSprint: number, teamId: string | null) => void;
  /** Delivery team id when sprint story board was opened from a team lane (breadcrumbs + left epic list). */
  sprintStoryBoardTeamId?: string | null;
  /** Sprint view team filter selector (null = all teams). */
  onSprintStoryBoardTeamChange?: (teamId: string | null) => void;
  /** Sprint capacity buckets state for the active sprint + team filter. */
  sprintCapacityBoard?: { capacities: Record<string, number>; assignments: Record<string, string[]> };
  onSprintCapacityChange?: (member: string, days: number) => void;
  onSprintCapacityStoryEstimateChange?: (storyId: string, estimatedDays: number) => void;
  onSprintCapacityStoryUnschedule?: (storyId: string) => void;
  sprintRetrospective?: (SprintRetrospectiveDoc & { updatedAt: string }) | null;
  onSaveSprintRetrospective?: (doc: SprintRetrospectiveDoc) => void;
  onFocusedQuarterChange: (quarterLabel: string | null) => void;
  onSprintModeChange: (active: boolean, activeMonth: number | null, activeYearSprint: number | null) => void;
  onSprintTabChange?: (tab: "kanban" | "status") => void;
  onOpenEpic: (epicId: string) => void;
  onUnscheduleEpic?: (epicId: string) => void;
  onOpenInitiative: (initiativeId: string) => void;
  onOpenStory?: (storyId: string) => void;
  onResizeInitiativeRange?: (initiativeId: string, range: InitiativeScheduleRangePatch) => void;
  onResizeEpicPlanRange?: (epicId: string, range: InitiativeScheduleRangePatch) => void;
  /** Pulse a scheduled initiative bar on the Gantt (e.g. after expanding it in the left panel). */
  ganttEmphasis?: { initiativeId: string; tick: number } | null;
  /** Pulse an epic bar after it is dropped onto the month plan from the left panel. */
  ganttEpicEmphasis?: { epicId: string; tick: number } | null;
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
  className,
}: {
  month: number;
  children: ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `month:${month}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative isolate flex min-h-0 flex-1 flex-col rounded-xl border border-slate-100/90 transition ring-1",
        isOver
          ? "border-primary/35 bg-primary/10 ring-primary/20"
          : "bg-slate-50/35 ring-slate-100/80",
        className,
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
  onSummaryStatusQuickFilterChange,
  summaryStatusQuickFilter = null,
  focusedQuarterLabel,
  focusedMonthExternal,
  activeSprintExternal,
  activeSprintTabExternal,
  onFocusedQuarterChange,
  onSprintModeChange,
  onSprintTabChange,
  onOpenEpic,
  onUnscheduleEpic,
  onOpenInitiative,
  onOpenStory,
  onResizeInitiativeRange,
  onResizeEpicPlanRange,
  ganttEmphasis = null,
  ganttEpicEmphasis = null,
  monthPlanTab = "epic-gantt",
  onMonthPlanTabChange,
  monthTeamBoardByKey = {},
  monthTeamCapacityBoard = { capacities: {} },
  monthTeamCapacityByKey = {},
  onMonthTeamCapacityChange,
  onQuarterTeamCapacityChange,
  onYearTeamCapacityChange,
  onMonthTeamCapacityEpicRemove,
  onEnterSprintStoryBoard,
  sprintStoryBoardTeamId = null,
  onSprintStoryBoardTeamChange,
  sprintCapacityBoard,
  onSprintCapacityChange,
  onSprintCapacityStoryEstimateChange,
  onSprintCapacityStoryUnschedule,
  sprintRetrospective = null,
  onSaveSprintRetrospective,
}: TimelineGridProps) {
  const ROADMAP_BAR_MODE_STORAGE_KEY = "timeline:roadmap-bar-mode";
  void zoom;
  const [focusedMonth, setFocusedMonth] = useState<number | null>(null);
  const [activeSprint, setActiveSprint] = useState<number | null>(null);
  const [activeSprintTab, setActiveSprintTab] = useState<"kanban" | "status">("kanban");
  const [quarterViewTab, setQuarterViewTab] = useState<"gantt" | "status" | "capacity">("gantt");
  const [roadmapBarMode, setRoadmapBarMode] = useState<"epics" | "initiatives">("epics");
  const [capacityQuarterFilterLabel, setCapacityQuarterFilterLabel] = useState<"all" | "Q1" | "Q2" | "Q3" | "Q4">("all");
  const [capacityTeamFilterId, setCapacityTeamFilterId] = useState<string>("all");
  const [isRailExpanded, setIsRailExpanded] = useState(false);
  const barElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  /** Prevents onSprintModeChange ↔ activeSprintExternal ping-pong (max update depth). */
  const lastSprintModeSyncKeyRef = useRef<string | null>(null);
  const [resizePreview, setResizePreview] = useState<{
    initiativeId: string;
    side: "left" | "right";
    deltaSteps: number;
  } | null>(null);
  const [epicResizePreview, setEpicResizePreview] = useState<{
    epicId: string;
    side: "left" | "right";
    deltaSteps: number;
  } | null>(null);

  const focusedQuarter = useMemo(
    () => QUARTERS.find((quarter) => quarter.label === focusedQuarterLabel) ?? null,
    [focusedQuarterLabel],
  );
  const filteredCapacityQuarter = useMemo(
    () => QUARTERS.find((quarter) => quarter.label === capacityQuarterFilterLabel) ?? null,
    [capacityQuarterFilterLabel],
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
  const summaryBadgesForScope = useMemo(() => {
    if (!summaryBadges) return null;
    if (focusedMonthExternal != null) {
      const monthPlannedRows = initiatives.flatMap((initiative) =>
        (initiative.epics ?? [])
          .filter((epic) => {
            if (epic.planStartMonth == null || epic.planEndMonth == null || epic.planSprint == null) return false;
            return epic.planStartMonth <= focusedMonthExternal && epic.planEndMonth >= focusedMonthExternal;
          })
          .map((epic) => ({ initiative, epic })),
      );
      const scheduledInitiativeIds = new Set(monthPlannedRows.map((row) => row.initiative.id));
      const initiativesInMonth = initiatives.filter((initiative) => scheduledInitiativeIds.has(initiative.id));
      const unscheduledEpics = initiativesInMonth
        .flatMap((initiative) => initiative.epics ?? [])
        .filter((epic) => epic.planSprint == null && epic.planStartMonth == null && epic.planEndMonth == null).length;
      const totalStories = initiativesInMonth
        .flatMap((initiative) => initiative.epics ?? [])
        .reduce((sum, epic) => sum + (epic.userStories?.length ?? 0), 0);
      return {
        totalInitiatives: scheduledInitiativeIds.size,
        scheduledInitiatives: scheduledInitiativeIds.size,
        totalEpics: monthPlannedRows.length + unscheduledEpics,
        scheduledEpics: monthPlannedRows.length,
        unscheduledEpics,
        totalStories,
      };
    }
    if (!focusedQuarter) return summaryBadges;
    const qStart = focusedQuarter.months[0];
    const qEnd = focusedQuarter.months[focusedQuarter.months.length - 1];
    const quarterInitiatives = initiatives.filter((initiative) => {
      if (initiative.status !== "scheduled") return false;
      if (initiative.startMonth == null || initiative.endMonth == null) return false;
      return !(initiative.endMonth < qStart || initiative.startMonth > qEnd);
    });
    const quarterEpics = quarterInitiatives.flatMap((initiative) => initiative.epics ?? []);
    const scheduledEpics = quarterEpics.filter((epic) => {
      if (epic.planStartMonth == null || epic.planEndMonth == null || epic.planSprint == null) return false;
      return !(epic.planEndMonth < qStart || epic.planStartMonth > qEnd);
    });
    const unscheduledEpics = quarterEpics.length - scheduledEpics.length;
    const totalStories = quarterEpics.reduce((sum, epic) => sum + (epic.userStories?.length ?? 0), 0);
    return {
      totalInitiatives: quarterInitiatives.length,
      scheduledInitiatives: quarterInitiatives.length,
      totalEpics: quarterEpics.length,
      scheduledEpics: scheduledEpics.length,
      unscheduledEpics,
      totalStories,
    };
  }, [focusedMonthExternal, focusedQuarter, initiatives, summaryBadges]);
  const quarterRoadmapEpics = useMemo(() => {
    if (!focusedQuarter) return [] as Array<{ epic: EpicItem; initiative: InitiativeItem; startS: number; endS: number }>;
    const qStart = focusedQuarter.months[0];
    const qEnd = focusedQuarter.months[focusedQuarter.months.length - 1];
    const rows: Array<{ epic: EpicItem; initiative: InitiativeItem; startS: number; endS: number }> = [];
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (epic.planStartMonth == null || epic.planEndMonth == null) continue;
        if (epic.planEndMonth < qStart || epic.planStartMonth > qEnd) continue;
        const startS = globalSprintFromMonthLane(epic.planStartMonth, epic.planSprint === 2 ? 2 : 1);
        const endS = globalSprintFromMonthLane(epic.planEndMonth, epic.planEndSprint === 1 ? 1 : 2);
        rows.push({ epic, initiative, startS, endS });
      }
    }
    return rows.sort(
      (a, b) =>
        a.epic.timelineRow - b.epic.timelineRow ||
        a.epic.title.localeCompare(b.epic.title),
    );
  }, [focusedQuarter, initiatives]);
  const yearRoadmapEpics = useMemo(() => {
    const rows: Array<{ epic: EpicItem; initiative: InitiativeItem; startS: number; endS: number }> = [];
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (epic.planStartMonth == null || epic.planEndMonth == null) continue;
        const startS = globalSprintFromMonthLane(epic.planStartMonth, epic.planSprint === 2 ? 2 : 1);
        const endS = globalSprintFromMonthLane(epic.planEndMonth, epic.planEndSprint === 1 ? 1 : 2);
        rows.push({ epic, initiative, startS, endS });
      }
    }
    return rows.sort(
      (a, b) =>
        a.epic.timelineRow - b.epic.timelineRow ||
        a.epic.title.localeCompare(b.epic.title),
    );
  }, [initiatives]);
  const yearRoadmapInitiatives = useMemo(() => {
    const rows: Array<{ initiative: InitiativeItem; startS: number; endS: number }> = [];
    for (const initiative of initiatives) {
      const plannedEpicBounds = (initiative.epics ?? [])
        .filter((epic) => epic.planStartMonth != null && epic.planEndMonth != null)
        .map((epic) => ({
          startS: globalSprintFromMonthLane(epic.planStartMonth!, epic.planSprint === 2 ? 2 : 1),
          endS: globalSprintFromMonthLane(epic.planEndMonth!, epic.planEndSprint === 1 ? 1 : 2),
        }));
      if (plannedEpicBounds.length === 0) continue;
      const startS = Math.min(...plannedEpicBounds.map((b) => b.startS));
      const endS = Math.max(...plannedEpicBounds.map((b) => b.endS));
      rows.push({ initiative, startS, endS });
    }
    return rows.sort(
      (a, b) =>
        a.initiative.timelineRow - b.initiative.timelineRow ||
        a.initiative.title.localeCompare(b.initiative.title),
    );
  }, [initiatives]);
  const quarterRoadmapInitiatives = useMemo(() => {
    if (!focusedQuarter) return [] as Array<{ initiative: InitiativeItem; startS: number; endS: number }>;
    const qStartS = firstGlobalSprintForMonth(focusedQuarter.months[0]);
    const qEndS = globalSprintFromMonthLane(focusedQuarter.months[focusedQuarter.months.length - 1], 2);
    return yearRoadmapInitiatives
      .filter((row) => !(row.endS < qStartS || row.startS > qEndS))
      .map((row) => ({
        initiative: row.initiative,
        startS: Math.max(row.startS, qStartS),
        endS: Math.min(row.endS, qEndS),
      }));
  }, [focusedQuarter, yearRoadmapInitiatives]);
  const yearRoadmapInitiativeRows = useMemo(() => {
    const byRow = new Map<number, Array<{ initiative: InitiativeItem; startS: number; endS: number }>>();
    for (const item of yearRoadmapInitiatives) {
      const row = Number.isFinite(item.initiative.timelineRow) ? item.initiative.timelineRow : 0;
      const bucket = byRow.get(row);
      if (bucket) bucket.push(item);
      else byRow.set(row, [item]);
    }
    return [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([timelineRow, items]) => ({ timelineRow, items }));
  }, [yearRoadmapInitiatives]);
  const quarterRoadmapInitiativeRows = useMemo(() => {
    const byRow = new Map<number, Array<{ initiative: InitiativeItem; startS: number; endS: number }>>();
    for (const item of quarterRoadmapInitiatives) {
      const row = Number.isFinite(item.initiative.timelineRow) ? item.initiative.timelineRow : 0;
      const bucket = byRow.get(row);
      if (bucket) bucket.push(item);
      else byRow.set(row, [item]);
    }
    return [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([timelineRow, items]) => ({ timelineRow, items }));
  }, [quarterRoadmapInitiatives]);
  const quarterRoadmapEpicRows = useMemo(() => {
    const byRow = new Map<number, Array<{ epic: EpicItem; initiative: InitiativeItem; startS: number; endS: number }>>();
    for (const item of quarterRoadmapEpics) {
      const row = Number.isFinite(item.epic.timelineRow) ? item.epic.timelineRow : 0;
      const bucket = byRow.get(row);
      if (bucket) bucket.push(item);
      else byRow.set(row, [item]);
    }
    return [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([timelineRow, items]) => ({ timelineRow, items }));
  }, [quarterRoadmapEpics]);
  const yearRoadmapEpicRows = useMemo(() => {
    const byRow = new Map<number, Array<{ epic: EpicItem; initiative: InitiativeItem; startS: number; endS: number }>>();
    for (const item of yearRoadmapEpics) {
      const row = Number.isFinite(item.epic.timelineRow) ? item.epic.timelineRow : 0;
      const bucket = byRow.get(row);
      if (bucket) bucket.push(item);
      else byRow.set(row, [item]);
    }
    return [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([timelineRow, items]) => ({ timelineRow, items }));
  }, [yearRoadmapEpics]);
  const visibleMonths = focusedQuarter
    ? [...focusedQuarter.months]
    : Array.from({ length: 12 }, (_, index) => index + 1);
  const visibleQuarterHeaders = focusedQuarter ? [focusedQuarter] : QUARTERS;
  const focusedMonthIsVisible = focusedMonth ? visibleMonths.includes(focusedMonth) : false;
  const activeMonth = focusedMonthIsVisible ? focusedMonth : null;

  const handleResizePointerDown = useCallback(
    (initiativeId: string, side: "left" | "right", event: React.PointerEvent<HTMLDivElement>) => {
      if (!onResizeInitiativeRange) return;
      const commitResize = onResizeInitiativeRange;
      const barEl = barElsRef.current.get(initiativeId);
      if (!barEl) return;

      event.preventDefault();
      event.stopPropagation();

      const initiative = initiatives.find((i) => i.id === initiativeId);
      if (!initiative) return;
      const sm0 = initiative.startMonth;
      const em0 = initiative.endMonth;
      if (sm0 == null || em0 == null) return;
      const inv = initiative;

      const sprintBounds = resolvedInitiativeYearSprintBounds(inv);
      if (!sprintBounds || activeMonth != null) return;

      const qLo =
        focusedQuarter != null ? firstGlobalSprintForMonth(focusedQuarter.months[0]) : 1;
      const qHi =
        focusedQuarter != null
          ? globalSprintFromMonthLane(focusedQuarter.months[focusedQuarter.months.length - 1], 2)
          : 24;

      const ss0 = sprintBounds.startYearSprint;
      const es0 = sprintBounds.endYearSprint;
      const visS = Math.max(ss0, qLo);
      const visE = Math.min(es0, qHi);
      const spanSteps = Math.max(visE - visS + 1, 1);

      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      handle.setPointerCapture(pointerId);

      const startX = event.clientX;
      const barWidth = barEl.getBoundingClientRect().width;
      const stepWidthPx = barWidth / spanSteps;

      setResizePreview({ initiativeId, side, deltaSteps: 0 });

      function onPointerMove(e: PointerEvent) {
        if (e.pointerId !== pointerId) return;
        e.preventDefault();
        const deltaPx = e.clientX - startX;
        const snapped = Math.round(deltaPx / stepWidthPx);
        setResizePreview((prev) => {
          if (prev && prev.deltaSteps === snapped) return prev;
          return { initiativeId, side, deltaSteps: snapped };
        });
      }

      function onPointerUp(e: PointerEvent) {
        if (e.pointerId !== pointerId) return;
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", onPointerUp);
        handle.removeEventListener("pointercancel", onPointerUp);

        const deltaPx = e.clientX - startX;
        const deltaSteps = Math.round(deltaPx / stepWidthPx);

        if (deltaSteps !== 0) {
          const ss = ss0;
          const es = es0;
          if (side === "right") {
            const nextEndSprint = Math.min(qHi, Math.max(ss, es + deltaSteps));
            if (nextEndSprint !== es) {
              const { startMonth: sm, endMonth: em } = monthRangeFromYearSprintRange(ss, nextEndSprint);
              commitResize(initiativeId, {
                startMonth: sm,
                endMonth: em,
                startYearSprint: ss,
                endYearSprint: nextEndSprint,
              });
            }
          } else {
            const nextStartSprint = Math.max(qLo, Math.min(es, ss + deltaSteps));
            if (nextStartSprint !== ss) {
              const { startMonth: sm, endMonth: em } = monthRangeFromYearSprintRange(nextStartSprint, es);
              commitResize(initiativeId, {
                startMonth: sm,
                endMonth: em,
                startYearSprint: nextStartSprint,
                endYearSprint: es,
              });
            }
          }
        }

        setResizePreview(null);
      }

      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp);
      handle.addEventListener("pointercancel", onPointerUp);
    },
    [initiatives, onResizeInitiativeRange, focusedQuarter, activeMonth],
  );
  const handleEpicResizePointerDown = useCallback(
    (epicId: string, side: "left" | "right", event: React.PointerEvent<HTMLDivElement>) => {
      if (!onResizeEpicPlanRange) return;
      if (activeMonth != null) return;
      const commitResize = onResizeEpicPlanRange;
      const barEl = barElsRef.current.get(epicId);
      if (!barEl) return;

      const row = initiatives.flatMap((initiative) =>
        (initiative.epics ?? []).map((epic) => ({ initiative, epic })),
      ).find((entry) => entry.epic.id === epicId);
      if (!row) return;
      if (row.epic.planStartMonth == null || row.epic.planEndMonth == null) return;

      const ss0 = globalSprintFromMonthLane(row.epic.planStartMonth, row.epic.planSprint === 2 ? 2 : 1);
      const es0 = globalSprintFromMonthLane(row.epic.planEndMonth, row.epic.planEndSprint === 1 ? 1 : 2);
      const qLo = focusedQuarter != null ? firstGlobalSprintForMonth(focusedQuarter.months[0]) : 1;
      const qHi =
        focusedQuarter != null
          ? globalSprintFromMonthLane(focusedQuarter.months[focusedQuarter.months.length - 1], 2)
          : 24;
      const visS = Math.max(ss0, qLo);
      const visE = Math.min(es0, qHi);
      const spanSteps = Math.max(visE - visS + 1, 1);

      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      handle.setPointerCapture(pointerId);
      const startX = event.clientX;
      const barWidth = barEl.getBoundingClientRect().width;
      const stepWidthPx = barWidth / spanSteps;

      setEpicResizePreview({ epicId, side, deltaSteps: 0 });

      function onPointerMove(e: PointerEvent) {
        if (e.pointerId !== pointerId) return;
        e.preventDefault();
        const deltaPx = e.clientX - startX;
        const snapped = Math.round(deltaPx / stepWidthPx);
        setEpicResizePreview((prev) => {
          if (prev && prev.deltaSteps === snapped) return prev;
          return { epicId, side, deltaSteps: snapped };
        });
      }

      function onPointerUp(e: PointerEvent) {
        if (e.pointerId !== pointerId) return;
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", onPointerUp);
        handle.removeEventListener("pointercancel", onPointerUp);
        const deltaPx = e.clientX - startX;
        const deltaSteps = Math.round(deltaPx / stepWidthPx);
        if (deltaSteps !== 0) {
          if (side === "right") {
            const nextEndSprint = Math.min(qHi, Math.max(ss0, es0 + deltaSteps));
            if (nextEndSprint !== es0) {
              const { startMonth: sm, endMonth: em } = monthRangeFromYearSprintRange(ss0, nextEndSprint);
              commitResize(epicId, {
                startMonth: sm,
                endMonth: em,
                startYearSprint: ss0,
                endYearSprint: nextEndSprint,
              });
            }
          } else {
            const nextStartSprint = Math.max(qLo, Math.min(es0, ss0 + deltaSteps));
            if (nextStartSprint !== ss0) {
              const { startMonth: sm, endMonth: em } = monthRangeFromYearSprintRange(nextStartSprint, es0);
              commitResize(epicId, {
                startMonth: sm,
                endMonth: em,
                startYearSprint: nextStartSprint,
                endYearSprint: es0,
              });
            }
          }
        }
        setEpicResizePreview(null);
      }

      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp);
      handle.addEventListener("pointercancel", onPointerUp);
    },
    [initiatives, onResizeEpicPlanRange, focusedQuarter, activeMonth],
  );

  const monthEpicGanttRows = useMemo(() => {
    if (activeMonth == null) return [];
    const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (!epicPlanOverlapsMonth(epic, activeMonth)) continue;
        rows.push({ epic, initiative });
      }
    }
    return rows.sort((a, b) => {
      const ir = a.epic.timelineRow - b.epic.timelineRow;
      if (ir !== 0) return ir;
      return a.epic.title.localeCompare(b.epic.title);
    });
  }, [initiatives, activeMonth]);
  const monthInitiativeGanttRows = useMemo(() => {
    if (activeMonth == null) return [] as InitiativeItem[];
    const byId = new Map<string, InitiativeItem>();
    for (const { initiative } of monthEpicGanttRows) {
      byId.set(initiative.id, initiative);
    }
    return [...byId.values()].sort((a, b) => a.timelineRow - b.timelineRow || a.title.localeCompare(b.title));
  }, [activeMonth, monthEpicGanttRows]);

  useEffect(() => {
    if (!resizePreview || activeMonth != null) return;
    const target = scheduledInitiatives.find((i) => i.id === resizePreview.initiativeId);
    if (!target) return;
    const bounds = resolvedInitiativeYearSprintBounds(target);
    if (!bounds) return;

    const qLo = focusedQuarter != null ? firstGlobalSprintForMonth(focusedQuarter.months[0]) : 1;
    const qHi =
      focusedQuarter != null
        ? globalSprintFromMonthLane(focusedQuarter.months[focusedQuarter.months.length - 1], 2)
        : 24;

    const ss = bounds.startYearSprint;
    const es = bounds.endYearSprint;
    const nextStart =
      resizePreview.side === "left" ? Math.max(qLo, Math.min(es, ss + resizePreview.deltaSteps)) : ss;
    const nextEnd =
      resizePreview.side === "right" ? Math.min(qHi, Math.max(ss, es + resizePreview.deltaSteps)) : es;
    const previewS = Math.max(nextStart, qLo);
    const previewE = Math.min(nextEnd, qHi);
    const row = Number.isFinite(target.timelineRow) ? target.timelineRow : 0;

    const overlapsSameRow = scheduledInitiatives
      .filter((i) => i.id !== target.id && (Number.isFinite(i.timelineRow) ? i.timelineRow : 0) === row)
      .map((i) => {
        const b = resolvedInitiativeYearSprintBounds(i);
        if (!b) return null;
        const s = Math.max(b.startYearSprint, qLo);
        const e = Math.min(b.endYearSprint, qHi);
        const overlaps = !(e < previewS || s > previewE);
        return { id: i.id, title: i.title, row, range: [s, e] as const, overlaps };
      })
      .filter((x): x is { id: string; title: string; row: number; range: readonly [number, number]; overlaps: boolean } => x != null);

    const overlapIds = overlapsSameRow.filter((x) => x.overlaps).map((x) => x.id);
    const overlapRanges = overlapsSameRow
      .filter((x) => x.overlaps)
      .map((x) => `${x.id}:${x.range[0]}-${x.range[1]}`);
    const candidateRanges = overlapsSameRow.map((x) => `${x.id}:${x.range[0]}-${x.range[1]}:${x.overlaps ? "hit" : "nohit"}`);
    console.log(
      `[gantt-resize] id=${target.id} row=${row} side=${resizePreview.side} delta=${resizePreview.deltaSteps} ` +
        `orig=${ss}-${es} preview=${previewS}-${previewE} q=${qLo}-${qHi} ` +
        `overlapIds=${overlapIds.join(",") || "none"} overlapRanges=${overlapRanges.join(",") || "none"} ` +
        `sameRow=${candidateRanges.join("|") || "none"}`,
    );
  }, [resizePreview, scheduledInitiatives, focusedQuarter, activeMonth]);
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
  /** Initiative rows + quarter headers: 2 sprint columns per month; full-year = 24 sprints. */
  const ganttLaneGridStyle: CSSProperties = {
    gridTemplateColumns: focusedQuarter
      ? `repeat(${visibleMonths.length * 2}, minmax(0, 1fr))`
      : `repeat(24, minmax(0, 1fr))`,
  };

  /** Quarter title row uses 12 month-width columns (each quarter spans 3). */
  const yearQuarterHeaderGridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(12, minmax(0, 1fr))`,
  };

  /** Today line over initiative lanes (sprint resolution). */
  const roadmapLaneTodayLeft = useMemo(() => {
    if (activeMonth != null) return null;
    if (focusedQuarter && quarterViewTab === "status") return null;
    return focusedQuarter
      ? todayLeftPercentInQuarterSprints(currentYear, focusedQuarter.months)
      : todayLeftPercentInYearSprints(currentYear);
  }, [activeMonth, currentYear, focusedQuarter, quarterViewTab]);

  const monthEpicGanttTodayLeft = useMemo(() => {
    if (activeMonth == null) return null;
    if (monthPlanTab !== "epic-gantt") return null;
    return todayLeftPercentInSingleMonth(currentYear, activeMonth);
  }, [activeMonth, currentYear, monthPlanTab]);

  const prevActiveMonthRef = useRef<number | null>(null);
  useEffect(() => {
    if (focusedMonthExternal === undefined) return;
    setFocusedMonth(focusedMonthExternal);
  }, [focusedMonthExternal]);

  useEffect(() => {
    if (activeSprintExternal === undefined) return;
    const next = activeSprintExternal == null ? null : clampYearSprint(activeSprintExternal);
    setActiveSprint((prev) => (prev === next ? prev : next));
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
        /**
         * Sprint entry from month/year sprint chips sets sprint tab in parent.
         * Do not clobber it back to epic-gantt on month transition.
         */
        if (
          monthPlanTab !== "sprint-kanban" &&
          monthPlanTab !== "sprint-status" &&
          monthPlanTab !== "sprint-capacity" &&
          monthPlanTab !== "sprint-retrospective"
        ) {
          onMonthPlanTabChange?.("epic-gantt");
        }
        setActiveSprintTab("kanban");
      }
    }
  }, [activeMonth, monthPlanTab, onMonthPlanTabChange]);

  useEffect(() => {
    if (activeMonth != null && activeSprint == null) {
      /** Parent sets `activeSprintExternal` on year-view sprint clicks; don't clobber before sync runs. */
      if (activeSprintExternal != null) return;
      setActiveSprint(firstGlobalSprintForMonth(activeMonth));
    }
    if (activeSprint == null) {
      setActiveSprintTab("kanban");
    }
  }, [activeMonth, activeSprint, activeSprintExternal]);

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
      if (lastSprintModeSyncKeyRef.current !== "__off__") {
        lastSprintModeSyncKeyRef.current = "__off__";
        onSprintModeChange(false, null, null);
      }
      return;
    }
    const fromParent =
      activeSprintExternal !== undefined && activeSprintExternal != null
        ? clampYearSprint(activeSprintExternal)
        : null;
    const yearSprint = fromParent ?? activeSprint ?? firstGlobalSprintForMonth(activeMonth);
    const key = `${activeMonth}:${yearSprint}`;
    if (lastSprintModeSyncKeyRef.current === key) return;
    lastSprintModeSyncKeyRef.current = key;
    onSprintModeChange(true, activeMonth, yearSprint);
  }, [activeMonth, activeSprint, activeSprintExternal, onSprintModeChange]);

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
    const isSprintSurface =
      monthPlanTab === "sprint-kanban" ||
      monthPlanTab === "sprint-status" ||
      monthPlanTab === "sprint-capacity" ||
      monthPlanTab === "sprint-retrospective";
    if (activeSprint != null && isSprintSurface) {
      breadcrumbItems.push({
        label: `Sprint ${activeSprint}`,
        onClick: () => {
          onMonthPlanTabChange?.("sprint-kanban");
          setActiveSprintTab("kanban");
        },
        currentTone: "sprint",
      });
      if (monthPlanTab === "sprint-capacity") {
        breadcrumbItems.push({
          label: "Capacity",
          onClick: null,
        });
      } else if (monthPlanTab === "sprint-status") {
        breadcrumbItems.push({
          label: "Insights",
          onClick: null,
        });
      } else if (monthPlanTab === "sprint-retrospective") {
        breadcrumbItems.push({
          label: "Retrospective",
          onClick: null,
        });
      }
    } else if (monthPlanTab === "month-status") {
      breadcrumbItems.push({
        label: "Insights",
        onClick: null,
      });
    } else if (monthPlanTab === "month-capacity") {
      breadcrumbItems.push({
        label: "Capacity",
        onClick: null,
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
      onClick: () => {
        setQuarterViewTab("gantt");
        onFocusedQuarterChange(focusedQuarter.label);
      },
    });
    if (quarterViewTab === "status") {
      breadcrumbItems.push({
        label: "Insights",
        onClick: null,
      });
    } else if (quarterViewTab === "capacity") {
      breadcrumbItems.push({
        label: "Capacity",
        onClick: null,
      });
    }
  }

  const hasBreadcrumbs = breadcrumbItems.length > 0;
  const hasContextSideMenu = activeMonth != null || focusedQuarter != null || (!activeMonth && !focusedQuarter);
  const railLabelBaseClass =
    "pointer-events-none overflow-hidden whitespace-nowrap text-[13px] font-semibold transition-all duration-150";

  useEffect(() => {
    console.log("[rail-nav] expanded state changed", {
      isRailExpanded,
      activeMonth,
      focusedQuarterLabel,
      quarterViewTab,
    });
  }, [isRailExpanded, activeMonth, focusedQuarterLabel, quarterViewTab]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ROADMAP_BAR_MODE_STORAGE_KEY);
      if (stored === "epics" || stored === "initiatives") {
        setRoadmapBarMode(stored);
      }
    } catch {
      // no-op: localStorage unavailable
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ROADMAP_BAR_MODE_STORAGE_KEY, roadmapBarMode);
    } catch {
      // no-op: localStorage unavailable
    }
  }, [roadmapBarMode]);
  const showSprintTeamPicker =
    activeMonth != null &&
    (monthPlanTab === "sprint-kanban" ||
      monthPlanTab === "sprint-status" ||
      monthPlanTab === "sprint-capacity" ||
      monthPlanTab === "sprint-retrospective" ||
      monthPlanTab === "month-status");
  const suppressMainVerticalScroll = activeMonth != null && monthPlanTab === "sprint-kanban";

  return (
    <div
      className={cn(
        "h-full min-h-0 w-full overflow-x-hidden rounded-xl bg-card p-5 shadow-lg ring-1 ring-black/5",
        suppressMainVerticalScroll ? "overflow-y-hidden" : "overflow-y-auto",
      )}
    >
      <div
        className={cn(
          "mb-4 flex items-center gap-3",
          hasBreadcrumbs ? "px-0 py-1" : "rounded-lg bg-slate-100 px-0 py-2.5",
          hasBreadcrumbs ? "justify-between" : "justify-start",
        )}
      >
        {hasBreadcrumbs ? (
          <div className="inline-flex items-center gap-1 rounded-xl bg-white/85 px-2 py-1.5 backdrop-blur-sm">
            {breadcrumbItems.map((item, index) => (
              <div key={`${item.label}-${index}`} className="flex items-center gap-1">
                {item.onClick ? (
                  <button
                    type="button"
                    onClick={item.onClick}
                    className="cursor-pointer px-1 py-1 text-[14px] font-semibold tracking-[0.01em] text-slate-700 underline-offset-4 transition hover:text-slate-900 hover:underline"
                  >
                    {item.label}
                  </button>
                ) : (
                  <span
                    aria-current="page"
                    className={cn(
                      "px-1 py-1 text-[14px] font-semibold tracking-[0.01em]",
                      item.currentTone === "sprint"
                        ? "text-indigo-700"
                        : "text-slate-900",
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
        {!activeMonth ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            {!focusedQuarter ? (
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
            ) : (
              <div />
            )}
            {summaryBadgesForScope ? (
              <div className="flex flex-wrap items-center justify-end gap-2 pr-3">
                <button
                  type="button"
                  onClick={() => {
                    setRoadmapBarMode("initiatives");
                    onSummaryStatusQuickFilterChange?.(null);
                  }}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] ring-1 transition",
                    roadmapBarMode === "initiatives"
                      ? "bg-indigo-100 text-indigo-800 ring-indigo-300"
                      : "bg-slate-200 text-slate-800 ring-slate-300 hover:bg-slate-300/80",
                  )}
                >
                  {summaryBadgesForScope.totalInitiatives} Initiatives
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRoadmapBarMode("epics");
                    onSummaryStatusQuickFilterChange?.(null);
                  }}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] ring-1 transition",
                    roadmapBarMode === "epics" && summaryStatusQuickFilter == null
                      ? "bg-amber-100 text-amber-800 ring-amber-200"
                      : "bg-slate-200 text-slate-800 ring-slate-300 hover:bg-slate-300/80",
                  )}
                >
                  {("totalEpics" in summaryBadgesForScope
                    ? summaryBadgesForScope.totalEpics
                    : summaryBadgesForScope.scheduledEpics + summaryBadgesForScope.unscheduledEpics)}{" "}
                  Epics
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSummaryStatusQuickFilterChange?.(
                      summaryStatusQuickFilter === "Unscheduled" ? null : "Unscheduled",
                    )
                  }
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] ring-1 transition",
                    summaryStatusQuickFilter === "Unscheduled"
                      ? "bg-slate-300 text-slate-900 ring-slate-400"
                      : "bg-slate-200 text-slate-800 ring-slate-300 hover:bg-slate-300/80",
                  )}
                >
                  {summaryBadgesForScope.unscheduledEpics} Unscheduled
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRoadmapBarMode("epics");
                    onSummaryStatusQuickFilterChange?.(
                      summaryStatusQuickFilter === "Scheduled" ? null : "Scheduled",
                    );
                  }}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] ring-1 transition",
                    summaryStatusQuickFilter === "Scheduled"
                      ? "bg-amber-100 text-amber-800 ring-amber-300"
                      : "bg-slate-200 text-slate-800 ring-slate-300 hover:bg-slate-300/80",
                  )}
                >
                  {summaryBadgesForScope.scheduledEpics} Scheduled
                </button>
                <div className="rounded-full bg-blue-100 px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] text-blue-800">
                  {summaryBadgesForScope.totalStories} User Stories
                </div>
              </div>
            ) : null}
          </div>
        ) : activeMonth ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2 pr-3">
            {summaryBadgesForScope ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setRoadmapBarMode("initiatives");
                    onSummaryStatusQuickFilterChange?.(null);
                  }}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] ring-1 transition",
                    roadmapBarMode === "initiatives"
                      ? "bg-indigo-100 text-indigo-800 ring-indigo-300"
                      : "bg-slate-200 text-slate-800 ring-slate-300 hover:bg-slate-300/80",
                  )}
                >
                  {summaryBadgesForScope.totalInitiatives} Initiatives
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRoadmapBarMode("epics");
                    onSummaryStatusQuickFilterChange?.(null);
                  }}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] ring-1 transition",
                    roadmapBarMode === "epics" && summaryStatusQuickFilter == null
                      ? "bg-amber-100 text-amber-800 ring-amber-200"
                      : "bg-slate-200 text-slate-800 ring-slate-300 hover:bg-slate-300/80",
                  )}
                >
                  {("totalEpics" in summaryBadgesForScope
                    ? summaryBadgesForScope.totalEpics
                    : summaryBadgesForScope.scheduledEpics + summaryBadgesForScope.unscheduledEpics)}{" "}
                  Epics
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSummaryStatusQuickFilterChange?.(
                      summaryStatusQuickFilter === "Unscheduled" ? null : "Unscheduled",
                    )
                  }
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] ring-1 transition",
                    summaryStatusQuickFilter === "Unscheduled"
                      ? "bg-slate-300 text-slate-900 ring-slate-400"
                      : "bg-slate-200 text-slate-800 ring-slate-300 hover:bg-slate-300/80",
                  )}
                >
                  {summaryBadgesForScope.unscheduledEpics} Unscheduled
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRoadmapBarMode("epics");
                    onSummaryStatusQuickFilterChange?.(
                      summaryStatusQuickFilter === "Scheduled" ? null : "Scheduled",
                    );
                  }}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] ring-1 transition",
                    summaryStatusQuickFilter === "Scheduled"
                      ? "bg-amber-100 text-amber-800 ring-amber-300"
                      : "bg-slate-200 text-slate-800 ring-slate-300 hover:bg-slate-300/80",
                  )}
                >
                  {summaryBadgesForScope.scheduledEpics} Scheduled
                </button>
                <div className="rounded-full bg-blue-100 px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] text-blue-800">
                  {summaryBadgesForScope.totalStories} User Stories
                </div>
              </>
            ) : null}
          </div>
        ) : focusedQuarter ? (
          <div className="flex items-center gap-2" />
        ) : (
          <div className="flex items-center gap-2" />
        )}
      </div>
      {activeMonth ? (
        <div className="relative z-30 h-0">
          <div
            className={cn(
              "absolute left-0 top-0 inline-flex flex-col gap-1 overflow-visible rounded-lg border border-slate-200/80 bg-white/80 p-1 shadow-sm ring-1 ring-slate-100/80 transition-[width] duration-200",
              isRailExpanded ? "w-44" : "w-[3.25rem]",
            )}
            onMouseEnter={() => {
              console.log("[rail-nav] month rail mouseenter", {
                activeMonth,
                monthPlanTab,
                activeSprint,
                previousExpanded: isRailExpanded,
              });
              setIsRailExpanded(true);
            }}
            onMouseLeave={() => {
              console.log("[rail-nav] month rail mouseleave", {
                activeMonth,
                monthPlanTab,
                activeSprint,
                previousExpanded: isRailExpanded,
              });
              setIsRailExpanded(false);
            }}
          >
            {activeSprint != null &&
            (monthPlanTab === "sprint-kanban" ||
              monthPlanTab === "sprint-status" ||
              monthPlanTab === "sprint-capacity" ||
              monthPlanTab === "sprint-retrospective") ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onMonthPlanTabChange?.("sprint-kanban");
                    setActiveSprintTab("kanban");
                  }}
                  title="Sprint board"
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                    monthPlanTab === "sprint-kanban"
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <MapIcon className="size-4" aria-hidden />
                  <span className="sr-only">Sprint board</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Sprint board
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onMonthPlanTabChange?.("sprint-status");
                    setActiveSprintTab("status");
                  }}
                  title="Sprint insights"
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                    monthPlanTab === "sprint-status"
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <BarChart3 className="size-4" aria-hidden />
                  <span className="sr-only">Sprint insights</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Sprint insights
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onMonthPlanTabChange?.("sprint-capacity");
                  }}
                  title="Sprint capacity"
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                    monthPlanTab === "sprint-capacity"
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <Thermometer className="size-4" aria-hidden />
                  <span className="sr-only">Sprint capacity</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Sprint capacity
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onMonthPlanTabChange?.("sprint-retrospective");
                  }}
                  title="Sprint retrospective"
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                    monthPlanTab === "sprint-retrospective"
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <ClipboardList className="size-4" aria-hidden />
                  <span className="sr-only">Sprint retrospective</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Sprint retrospective
                  </span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onMonthPlanTabChange?.("epic-gantt")}
                  title="Epic plan"
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                    monthPlanTab === "epic-gantt"
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <MapIcon className="size-4" aria-hidden />
                  <span className="sr-only">Epic plan</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Epic plan
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onMonthPlanTabChange?.("team-queue")}
                  title="Team queue"
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                    monthPlanTab === "team-queue"
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <BarChart3 className="size-4" aria-hidden />
                  <span className="sr-only">Team queue</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Team queue
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onMonthPlanTabChange?.("month-capacity")}
                  title="Team capacity"
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                    monthPlanTab === "month-capacity"
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <Thermometer className="size-4" aria-hidden />
                  <span className="sr-only">Team capacity</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Team capacity
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onMonthPlanTabChange?.("month-status")}
                  title="Month insights"
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                    monthPlanTab === "month-status"
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <BarChart3 className="size-4" aria-hidden />
                  <span className="sr-only">Month insights</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Month insights
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
      ) : focusedQuarter ? (
        <div className="relative z-30 h-0">
          <div
            className={cn(
              "absolute left-0 top-0 inline-flex flex-col gap-1 overflow-visible rounded-lg border border-slate-200/80 bg-white/80 p-1 shadow-sm ring-1 ring-slate-100/80 transition-[width] duration-200",
              isRailExpanded ? "w-44" : "w-[3.25rem]",
            )}
            onMouseEnter={() => {
              console.log("[rail-nav] quarter rail mouseenter", {
                focusedQuarterLabel,
                quarterViewTab,
                previousExpanded: isRailExpanded,
              });
              setIsRailExpanded(true);
            }}
            onMouseLeave={() => {
              console.log("[rail-nav] quarter rail mouseleave", {
                focusedQuarterLabel,
                quarterViewTab,
                previousExpanded: isRailExpanded,
              });
              setIsRailExpanded(false);
            }}
          >
            <button
              type="button"
              onClick={() => setQuarterViewTab("gantt")}
              title="Gantt"
              className={cn(
                "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                quarterViewTab === "gantt"
                  ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <MapIcon className="size-4" aria-hidden />
              <span className="sr-only">Gantt</span>
              <span
                aria-hidden
                className={cn(
                  railLabelBaseClass,
                  isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                )}
              >
                Gantt
              </span>
            </button>
            <button
              type="button"
              onClick={() => setQuarterViewTab("status")}
              title="Quarter status"
              className={cn(
                "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                quarterViewTab === "status"
                  ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <BarChart3 className="size-4" aria-hidden />
              <span className="sr-only">Quarter status</span>
              <span
                aria-hidden
                className={cn(
                  railLabelBaseClass,
                  isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                )}
              >
                Quarter status
              </span>
            </button>
            <button
              type="button"
              onClick={() => setQuarterViewTab("capacity")}
              title="Quarter capacity"
              className={cn(
                "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                quarterViewTab === "capacity"
                  ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <Thermometer className="size-4" aria-hidden />
              <span className="sr-only">Quarter capacity</span>
              <span
                aria-hidden
                className={cn(
                  railLabelBaseClass,
                  isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                )}
              >
                Quarter capacity
              </span>
            </button>
          </div>
        </div>
      ) : !activeMonth && !focusedQuarter ? (
        <div className="relative z-30 h-0">
          <div
            className={cn(
              "absolute left-0 top-0 inline-flex flex-col gap-1 overflow-visible rounded-lg border border-slate-200/80 bg-white/80 p-1 shadow-sm ring-1 ring-slate-100/80 transition-[width] duration-200",
              isRailExpanded ? "w-44" : "w-[3.25rem]",
            )}
            onMouseEnter={() => setIsRailExpanded(true)}
            onMouseLeave={() => setIsRailExpanded(false)}
          >
            <button
              type="button"
              onClick={() => setQuarterViewTab("gantt")}
              title="Gantt"
              className={cn(
                "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                quarterViewTab === "gantt"
                  ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <MapIcon className="size-4" aria-hidden />
              <span className="sr-only">Gantt</span>
              <span
                aria-hidden
                className={cn(
                  railLabelBaseClass,
                  isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                )}
              >
                Gantt
              </span>
            </button>
            <button
              type="button"
              onClick={() => setQuarterViewTab("status")}
              title="All quarters status"
              className={cn(
                "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                quarterViewTab === "status"
                  ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <BarChart3 className="size-4" aria-hidden />
              <span className="sr-only">All quarters status</span>
              <span
                aria-hidden
                className={cn(
                  railLabelBaseClass,
                  isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                )}
              >
                All quarters status
              </span>
            </button>
            <button
              type="button"
              onClick={() => setQuarterViewTab("capacity")}
              title="All quarters capacity"
              className={cn(
                "group relative inline-flex h-9 w-full items-center justify-start gap-2 overflow-visible rounded-md px-2 transition",
                quarterViewTab === "capacity"
                  ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <Thermometer className="size-4" aria-hidden />
              <span className="sr-only">All quarters capacity</span>
              <span
                aria-hidden
                className={cn(
                  railLabelBaseClass,
                  isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                )}
              >
                All quarters capacity
              </span>
            </button>
          </div>
        </div>
      ) : null}
      {!activeMonth && !focusedQuarter && quarterViewTab === "gantt" ? (
        <div className={cn("mb-4 w-full", hasContextSideMenu && "w-[calc(100%-4rem)] ml-[4rem]")}>
          <div className="grid min-w-0 gap-2" style={yearQuarterHeaderGridStyle}>
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
        </div>
      ) : null}
      {activeMonth ? (
        <div
          className={cn(
            "mb-4 rounded-2xl p-1.5 shadow-lg ring-1",
            hasContextSideMenu && "w-[calc(100%-4rem)] ml-[4rem]",
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
              monthPlanTab === "month-capacity" ||
              monthPlanTab === "sprint-kanban" ||
              monthPlanTab === "sprint-retrospective"
                ? "min-h-[56rem]"
                : "min-h-0",
            )}
          >
            {monthPlanTab === "epic-gantt" && activeMonth != null ? (
              <div className="relative flex min-h-0 flex-1 flex-col gap-4 p-3 sm:p-5">
                <div className="relative z-[1] flex min-h-0 flex-1 flex-col gap-4">
                <div className="grid min-w-0 shrink-0 gap-3" style={epicMonthGridStyle}>
                  <div
                    className={cn(
                      "overflow-hidden rounded-2xl border border-slate-200/55 px-4 pt-4 pb-0 shadow-sm ring-1 ring-black/[0.03]",
                      activeMonthQuarterLabel === "Q1" && "bg-gradient-to-br from-blue-50/95 via-white to-white",
                      activeMonthQuarterLabel === "Q2" && "bg-gradient-to-br from-cyan-50/95 via-white to-white",
                      activeMonthQuarterLabel === "Q3" && "bg-gradient-to-br from-emerald-50/95 via-white to-white",
                      activeMonthQuarterLabel === "Q4" && "bg-gradient-to-br from-violet-50/95 via-white to-white",
                      !activeMonthQuarterLabel && "bg-gradient-to-br from-slate-50/90 via-white to-white",
                    )}
                  >
                    <div className="grid min-w-0 grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        title={`Open ${sprintLabelQuarterOrMonth(globalSprintFromMonthLane(activeMonth, 1))} board (${sprintDateWeekdayRangeText(currentYear, activeMonth, 1)})`}
                        onClick={() => {
                          if (isPostDragClickSuppressed()) return;
                          onEnterSprintStoryBoard?.(globalSprintFromMonthLane(activeMonth, 1), null);
                        }}
                        className="flex w-full min-w-0 flex-col items-center justify-center gap-2 rounded-lg border border-slate-200/80 bg-white px-2 py-2.5 text-center shadow-sm ring-1 ring-black/[0.04] transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99]"
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[13px] font-semibold leading-tight text-slate-800">
                            {sprintLabelQuarterOrMonth(globalSprintFromMonthLane(activeMonth, 1))}
                          </span>
                          <span className="max-w-full px-0.5 text-[12px] font-medium leading-tight text-slate-500">
                            ({sprintDateWeekdayRangeText(currentYear, activeMonth, 1)})
                          </span>
                        </div>
                        <div className="flex w-full min-w-0 gap-1">
                          {sprintDaysWithWeekday(currentYear, activeMonth, 1).map((dayLabel) => (
                            <span
                              key={dayLabel.key}
                              className="flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded bg-white/80 px-0.5 py-1.5 text-center ring-1 ring-slate-200/80"
                            >
                              <span className="w-full truncate text-[11px] font-semibold leading-none text-slate-700">
                                {dayLabel.weekday}
                              </span>
                              <span className="w-full truncate text-[10px] font-medium leading-none text-slate-500 tabular-nums">
                                {dayLabel.dayMonth}
                              </span>
                            </span>
                          ))}
                        </div>
                      </button>
                      <button
                        type="button"
                        title={`Open ${sprintLabelQuarterOrMonth(globalSprintFromMonthLane(activeMonth, 2))} board (${sprintDateWeekdayRangeText(currentYear, activeMonth, 2)})`}
                        onClick={() => {
                          if (isPostDragClickSuppressed()) return;
                          onEnterSprintStoryBoard?.(globalSprintFromMonthLane(activeMonth, 2), null);
                        }}
                        className="flex w-full min-w-0 flex-col items-center justify-center gap-2 rounded-lg border border-slate-200/80 bg-white px-2 py-2.5 text-center shadow-sm ring-1 ring-black/[0.04] transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99]"
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[13px] font-semibold leading-tight text-slate-800">
                            {sprintLabelQuarterOrMonth(globalSprintFromMonthLane(activeMonth, 2))}
                          </span>
                          <span className="max-w-full px-0.5 text-[12px] font-medium leading-tight text-slate-500">
                            ({sprintDateWeekdayRangeText(currentYear, activeMonth, 2)})
                          </span>
                        </div>
                        <div className="flex w-full min-w-0 gap-1">
                          {sprintDaysWithWeekday(currentYear, activeMonth, 2).map((dayLabel) => (
                            <span
                              key={dayLabel.key}
                              className="flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded bg-white/80 px-0.5 py-1.5 text-center ring-1 ring-slate-200/80"
                            >
                              <span className="w-full truncate text-[11px] font-semibold leading-none text-slate-700">
                                {dayLabel.weekday}
                              </span>
                              <span className="w-full truncate text-[10px] font-medium leading-none text-slate-500 tabular-nums">
                                {dayLabel.dayMonth}
                              </span>
                            </span>
                          ))}
                        </div>
                      </button>
                    </div>
                    <MonthDropCell month={activeMonth} />
                  </div>
                </div>
                <MonthEpicDropArea month={activeMonth}>
                  <div
                    className={cn(
                      "flex min-h-0 flex-1 flex-col px-3 pb-3 sm:px-4 sm:pb-4",
                      monthEpicGanttTodayLeft != null && "pt-5 sm:pt-6",
                    )}
                  >
                    <div className="relative flex min-h-0 w-full flex-1 flex-col">
                      <GanttTodayMarker leftPercent={monthEpicGanttTodayLeft} showBadge badgePlacement="above" />
                      <div
                        id={TIMELINE_GANTT_ROWS_CONTAINER_ID}
                        className="relative z-10 min-h-0 flex-1 space-y-2 overflow-y-auto"
                      >
                        {roadmapBarMode === "initiatives" && monthInitiativeGanttRows.length === 0 ? (
                          <div className="rounded-lg bg-slate-50/70 px-4 py-6 text-center text-[12px] text-slate-600">
                            No initiatives are planned in {MONTHS[activeMonth - 1]} yet.
                          </div>
                        ) : roadmapBarMode !== "initiatives" && monthEpicGanttRows.length === 0 ? (
                          <div className="rounded-lg bg-slate-50/70 px-4 py-6 text-center text-[12px] text-slate-600">
                            No epics are planned in {MONTHS[activeMonth - 1]} yet. Drag one from the left panel into the
                            drop area below.
                          </div>
                        ) : roadmapBarMode === "initiatives" ? (
                          monthInitiativeGanttRows.map((initiative, rowIndex) => (
                            <MonthInitiativeGanttLaneRow
                              key={initiative.id}
                              initiative={initiative}
                              onOpenInitiative={onOpenInitiative}
                              ganttLaneSortIndex={rowIndex}
                            />
                          ))
                        ) : (
                          monthEpicGanttRows.map(({ epic, initiative }, rowIndex) => {
                            const isInitiativeEmphasis =
                              ganttEmphasis != null && ganttEmphasis.initiativeId === initiative.id;
                            const isEpicEmphasis =
                              ganttEpicEmphasis != null && ganttEpicEmphasis.epicId === epic.id;
                            const emphasize = isInitiativeEmphasis || isEpicEmphasis;
                            const emphasizeTick = isEpicEmphasis
                              ? ganttEpicEmphasis!.tick
                              : isInitiativeEmphasis
                                ? ganttEmphasis!.tick
                                : 0;
                            return (
                              <EpicGanttLaneRow
                                key={epic.id}
                                epic={epic}
                                initiative={initiative}
                                gridStyle={epicMonthGridStyle}
                                month={activeMonth}
                                onOpenEpic={onOpenEpic}
                                onUnscheduleEpic={onUnscheduleEpic}
                                ganttLaneSortIndex={rowIndex}
                                emphasize={emphasize}
                                emphasizeTick={emphasizeTick}
                              />
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </MonthEpicDropArea>
                </div>
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
            ) : monthPlanTab === "month-capacity" ? (
              <div className="flex-1 p-3 sm:p-5">
                <MonthTeamCapacityBoard
                  initiatives={initiatives}
                  year={currentYear}
                  month={activeMonth}
                  capacityBoard={monthTeamCapacityBoard}
                  onCapacityChange={(teamId, days) => onMonthTeamCapacityChange?.(teamId, days)}
                  onOpenEpic={onOpenEpic}
                  onRemoveEpicFromCapacity={(epicId) => onMonthTeamCapacityEpicRemove?.(epicId)}
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
            ) : monthPlanTab === "sprint-capacity" ? (
              <div className="flex-1 p-3 sm:p-5">
                <SprintCapacityBoard
                  initiatives={initiatives}
                  month={activeMonth}
                  yearSprint={activeSprint ?? firstGlobalSprintForMonth(activeMonth)}
                  selectedTeamId={isKnownEpicTeamId(sprintStoryBoardTeamId) ? sprintStoryBoardTeamId : null}
                  capacityBoard={sprintCapacityBoard ?? { capacities: {}, assignments: {} }}
                  onCapacityChange={(member, days) => onSprintCapacityChange?.(member, days)}
                  onEstimateChange={(storyId, estimatedDays) =>
                    onSprintCapacityStoryEstimateChange?.(storyId, estimatedDays)
                  }
                  onUnscheduleStory={(storyId) => onSprintCapacityStoryUnschedule?.(storyId)}
                  onOpenStory={onOpenStory ?? (() => {})}
                />
              </div>
            ) : monthPlanTab === "sprint-retrospective" ? (
              <div className="flex-1 p-3 sm:p-5">
                <SprintRetrospectiveEditor
                  sprintLabel={`Sprint ${activeSprint ?? firstGlobalSprintForMonth(activeMonth)}`}
                  initialDoc={sprintRetrospective}
                  updatedAt={sprintRetrospective?.updatedAt ?? null}
                  onSave={(doc) => onSaveSprintRetrospective?.(doc)}
                />
              </div>
            ) : monthPlanTab === "month-status" ? (
              <div className="p-3 sm:p-5">
                <MonthAnalytics
                  initiatives={initiatives}
                  month={activeMonth}
                  planYear={currentYear}
                  filterEpicTeamId={isKnownEpicTeamId(sprintStoryBoardTeamId) ? sprintStoryBoardTeamId : null}
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
            <div className={cn("mb-4 w-full space-y-4", hasContextSideMenu && "w-[calc(100%-4rem)] ml-[4rem]")}>
              <div className="relative z-[1] space-y-4">
                <div className="space-y-0.5">
                  <div className="grid min-w-0 gap-2" style={ganttLaneGridStyle}>
                    {visibleMonths.map((month) => (
                      <div
                        key={month}
                        style={{ gridColumn: "span 2" }}
                        className="space-y-2 rounded-2xl border border-slate-200/50 bg-gradient-to-b from-white to-slate-50/40 px-2.5 pt-2.5 pb-0 shadow-sm ring-1 ring-black/[0.03]"
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
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            title={`${sprintLabelQuarterOrMonth(globalSprintFromMonthLane(month, 1))} (${sprintDateWeekdayRangeText(currentYear, month, 1)})`}
                            onClick={() => {
                              if (isPostDragClickSuppressed()) return;
                              setFocusedMonth(month);
                              onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, 1), null);
                            }}
                            className="flex min-h-[3.35rem] flex-col items-center justify-center gap-0.5 rounded-lg border border-slate-200/80 bg-white px-1 py-2 text-center shadow-sm ring-1 ring-black/[0.04] transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99]"
                          >
                            <span className="text-[13px] font-semibold leading-tight text-slate-800">
                              {sprintLabelQuarterOrMonth(globalSprintFromMonthLane(month, 1))}
                            </span>
                            <span className="text-[12px] font-medium leading-tight text-slate-500">
                              ({sprintDateWeekdayRangeText(currentYear, month, 1)})
                            </span>
                          </button>
                          <button
                            type="button"
                            title={`${sprintLabelQuarterOrMonth(globalSprintFromMonthLane(month, 2))} (${sprintDateWeekdayRangeText(currentYear, month, 2)})`}
                            onClick={() => {
                              if (isPostDragClickSuppressed()) return;
                              setFocusedMonth(month);
                              onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, 2), null);
                            }}
                            className="flex min-h-[3.35rem] flex-col items-center justify-center gap-0.5 rounded-lg border border-slate-200/80 bg-white px-1 py-2 text-center shadow-sm ring-1 ring-black/[0.04] transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99]"
                          >
                            <span className="text-[13px] font-semibold leading-tight text-slate-800">
                              {sprintLabelQuarterOrMonth(globalSprintFromMonthLane(month, 2))}
                            </span>
                            <span className="text-[12px] font-medium leading-tight text-slate-500">
                              ({sprintDateWeekdayRangeText(currentYear, month, 2)})
                            </span>
                          </button>
                        </div>
                        <MonthDropCell month={month} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="relative w-full">
                  <GanttTodayMarker leftPercent={roadmapLaneTodayLeft} showBadge badgePlacement="above" />
                  {roadmapBarMode === "initiatives" ? (
                    quarterRoadmapInitiativeRows.length === 0 ? (
                      <p className="relative z-10 rounded-md bg-muted/40 p-3.5 text-[14px] leading-6 text-slate-600">
                        No initiatives with planned epics in this quarter.
                      </p>
                    ) : (
                      <div id={TIMELINE_GANTT_ROWS_CONTAINER_ID} className="relative z-10 space-y-2">
                        {quarterRoadmapInitiativeRows.map((group, idx) => (
                          <div
                            key={`q-init-row-${group.timelineRow}`}
                            className="relative min-w-0 z-10"
                            data-gantt-lane-index={idx}
                            data-gantt-timeline-row={group.timelineRow}
                          >
                            <div className="relative grid min-w-0 gap-2" style={ganttLaneGridStyle}>
                              {group.items.map((row) => {
                                const qLo = firstGlobalSprintForMonth(focusedQuarter.months[0]);
                                const columnStart = Math.max(1, row.startS - qLo + 1);
                                const span = Math.max(row.endS - row.startS + 1, 1);
                                const stories = (row.initiative.epics ?? []).flatMap((e) => e.userStories ?? []);
                                const finishedStories = stories.filter((s) => s.status === "done" || s.status === "approved").length;
                                const completionPercent = stories.length > 0 ? Math.round((finishedStories / stories.length) * 100) : 0;
                                return (
                                  <div
                                    key={`q-init-${row.initiative.id}`}
                                    className="relative min-w-0 rounded-lg pt-0.5 pb-2 z-20"
                                    style={{ gridColumn: `${columnStart} / span ${span}`, gridRow: 1 }}
                                  >
                                    <InitiativeTimelineBar
                                      id={row.initiative.id}
                                      title={row.initiative.title}
                                      icon={row.initiative.icon}
                                      color={row.initiative.color}
                                      progressPercent={completionPercent}
                                      progressLabel={stories.length > 0 ? `${finishedStories}/${stories.length} done or approved` : "No user stories"}
                                      onClick={() => onOpenInitiative(row.initiative.id)}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : quarterRoadmapEpics.length === 0 ? (
                    <p className="relative z-10 rounded-md bg-muted/40 p-3.5 text-[14px] leading-6 text-slate-600">
                      Drag initiatives or epics onto a month column (narrow strip under the month name) or move a scheduled
                      bar along the timeline.
                    </p>
                  ) : (
                    <div id={TIMELINE_GANTT_ROWS_CONTAINER_ID} className="relative z-10 space-y-2">
                      {quarterRoadmapEpicRows.map((group, idx) => (
                        <div
                          key={`q-epic-row-${group.timelineRow}`}
                          className="relative min-w-0 z-10"
                          data-gantt-lane-index={idx}
                          data-gantt-timeline-row={group.timelineRow}
                        >
                          <div className="relative grid min-w-0 gap-2" style={ganttLaneGridStyle}>
                            {group.items.map((row) => {
                              const qLo = firstGlobalSprintForMonth(focusedQuarter.months[0]);
                              const rz = epicResizePreview?.epicId === row.epic.id ? epicResizePreview : null;
                              let previewStart = row.startS;
                              let previewEnd = row.endS;
                              if (rz) {
                                if (rz.side === "right") previewEnd = Math.min(globalSprintFromMonthLane(focusedQuarter.months[focusedQuarter.months.length - 1], 2), Math.max(row.startS, row.endS + rz.deltaSteps));
                                else previewStart = Math.max(qLo, Math.min(row.endS, row.startS + rz.deltaSteps));
                              }
                              const columnStart = Math.max(1, previewStart - qLo + 1);
                              const span = Math.max(previewEnd - previewStart + 1, 1);
                              const stories = row.epic.userStories ?? [];
                              const finishedStories = stories.filter((s) => s.status === "done" || s.status === "approved").length;
                              const completionPercent = stories.length > 0 ? Math.round((finishedStories / stories.length) * 100) : 0;
                              const isEpicEmphasis = ganttEpicEmphasis != null && ganttEpicEmphasis.epicId === row.epic.id;
                              const resizeEdgeClass =
                                "pointer-events-auto absolute inset-y-0.5 z-20 w-2.5 touch-none select-none rounded-md bg-white/0 transition-colors hover:bg-white/30 active:bg-white/40";
                              return (
                                <div
                                  key={`q-epic-${row.epic.id}`}
                                  ref={(node) => {
                                    if (node) barElsRef.current.set(row.epic.id, node);
                                    else barElsRef.current.delete(row.epic.id);
                                  }}
                                  className={cn("relative min-w-0 rounded-lg pt-0.5 pb-2", rz ? "z-0 opacity-70" : "z-20")}
                                  style={{ gridColumn: `${columnStart} / span ${span}`, gridRow: 1 }}
                                >
                                  <EpicPlanTimelineBar
                                    id={row.epic.id}
                                    title={row.epic.title}
                                    icon={row.epic.icon}
                                    color={row.epic.color?.trim() ? row.epic.color : row.initiative.color}
                                    progressPercent={completionPercent}
                                    progressLabel={stories.length > 0 ? `${finishedStories}/${stories.length} done or approved` : "No user stories"}
                                    isResizing={Boolean(rz)}
                                    emphasizeFlash={isEpicEmphasis}
                                    emphasizeTick={isEpicEmphasis ? ganttEpicEmphasis.tick : 0}
                                    onUnschedule={onUnscheduleEpic ? () => onUnscheduleEpic(row.epic.id) : undefined}
                                    onClick={() => onOpenEpic(row.epic.id)}
                                  />
                                  {onResizeEpicPlanRange ? (
                                    <>
                                      <div
                                        role="slider"
                                        aria-label="Resize epic start (sprint step)"
                                        title="Drag to change epic start sprint"
                                        className={cn(resizeEdgeClass, "left-0 cursor-ew-resize")}
                                        onPointerDown={(e) => {
                                          e.stopPropagation();
                                          handleEpicResizePointerDown(row.epic.id, "left", e);
                                        }}
                                      />
                                      <div
                                        role="slider"
                                        aria-label="Resize epic end (sprint step)"
                                        title="Drag to change epic end sprint"
                                        className={cn(resizeEdgeClass, "right-0 cursor-ew-resize")}
                                        onPointerDown={(e) => {
                                          e.stopPropagation();
                                          handleEpicResizePointerDown(row.epic.id, "right", e);
                                        }}
                                      />
                                    </>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : !focusedQuarter && quarterViewTab === "gantt" ? (
            <div className={cn("mb-4 w-full", hasContextSideMenu && "w-[calc(100%-4rem)] ml-[4rem]")}>
              <div className="grid min-w-0 grid-cols-4 gap-2">
              {QUARTERS.map((quarter) => (
                <section
                  key={quarter.label}
                  className={cn("rounded-lg px-2 pt-2 pb-0 ring-1", quarterPanelTone[quarter.label] ?? "bg-slate-50 ring-slate-200")}
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
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            title={sprintLabelYearRoadmap(globalSprintFromMonthLane(month, 1))}
                            onClick={() => {
                              if (isPostDragClickSuppressed()) return;
                              setFocusedMonth(month);
                              onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, 1), null);
                            }}
                            className="flex min-h-[1.625rem] items-center justify-center rounded bg-white/75 px-0.5 text-[11px] font-semibold leading-tight text-slate-600 ring-1 ring-slate-200/80 transition hover:bg-white hover:text-slate-800"
                          >
                            {sprintLabelYearRoadmap(globalSprintFromMonthLane(month, 1))}
                          </button>
                          <button
                            type="button"
                            title={sprintLabelYearRoadmap(globalSprintFromMonthLane(month, 2))}
                            onClick={() => {
                              if (isPostDragClickSuppressed()) return;
                              setFocusedMonth(month);
                              onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, 2), null);
                            }}
                            className="flex min-h-[1.625rem] items-center justify-center rounded bg-white/75 px-0.5 text-[11px] font-semibold leading-tight text-slate-600 ring-1 ring-slate-200/80 transition hover:bg-white hover:text-slate-800"
                          >
                            {sprintLabelYearRoadmap(globalSprintFromMonthLane(month, 2))}
                          </button>
                        </div>
                        <MonthDropCell month={month} />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      <div className={cn("space-y-2", hasContextSideMenu && "w-[calc(100%-4rem)] ml-[4rem]")}>
        {!activeMonth && quarterViewTab === "capacity" ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-white/80 px-3 py-2 shadow-sm ring-1 ring-slate-100/80">
            {!focusedQuarter ? (
              <label className="inline-flex items-center gap-1.5">
                <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Quarter</span>
                <select
                  value={capacityQuarterFilterLabel}
                  onChange={(event) =>
                    setCapacityQuarterFilterLabel(event.target.value as "all" | "Q1" | "Q2" | "Q3" | "Q4")
                  }
                  className="h-8 min-w-[7rem] rounded-md border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-800 outline-none transition hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300/70"
                  aria-label="Filter quarter capacity by quarter"
                >
                  <option value="all">All quarters</option>
                  {QUARTERS.map((quarter) => (
                    <option key={quarter.label} value={quarter.label}>
                      {quarter.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="inline-flex items-center gap-1.5">
              <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Team</span>
              <select
                value={capacityTeamFilterId}
                onChange={(event) => setCapacityTeamFilterId(event.target.value)}
                className="h-8 min-w-[9rem] rounded-md border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-800 outline-none transition hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300/70"
                aria-label="Filter quarter capacity by team"
              >
                <option value="all">All teams</option>
                {MONTH_TEAM_COLUMNS.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {activeMonth ? null : !focusedQuarter && quarterViewTab === "status" ? (
          <QuarterStatus initiatives={initiatives} quarterMonths={MONTHS.map((_, i) => i + 1)} planYear={currentYear} />
        ) : activeMonth ? null : focusedQuarter && quarterViewTab === "status" ? (
          <QuarterStatus initiatives={initiatives} quarterMonths={focusedQuarter.months} planYear={currentYear} />
        ) : activeMonth ? null : !focusedQuarter && quarterViewTab === "capacity" ? (
          <QuarterTeamCapacityBoard
            initiatives={initiatives}
            quarterLabel={filteredCapacityQuarter?.label ?? "All quarters"}
            quarterMonths={filteredCapacityQuarter?.months ?? MONTHS.map((_, i) => i + 1)}
            year={currentYear}
            monthTeamCapacityByKey={monthTeamCapacityByKey}
            onCapacityChange={(teamId, totalDays) => {
              if (filteredCapacityQuarter) {
                onQuarterTeamCapacityChange?.(filteredCapacityQuarter.label, teamId, totalDays);
                return;
              }
              onYearTeamCapacityChange?.(teamId, totalDays);
            }}
            onOpenEpic={onOpenEpic}
            onRemoveEpicFromCapacity={(epicId) => onMonthTeamCapacityEpicRemove?.(epicId)}
            teamFilterId={capacityTeamFilterId === "all" ? null : capacityTeamFilterId}
          />
        ) : activeMonth ? null : focusedQuarter && quarterViewTab === "capacity" ? (
          <QuarterTeamCapacityBoard
            initiatives={initiatives}
            quarterLabel={focusedQuarter.label}
            quarterMonths={focusedQuarter.months}
            year={currentYear}
            monthTeamCapacityByKey={monthTeamCapacityByKey}
            onCapacityChange={(teamId, quarterTotalDays) =>
              onQuarterTeamCapacityChange?.(focusedQuarter.label, teamId, quarterTotalDays)
            }
            onOpenEpic={onOpenEpic}
            onRemoveEpicFromCapacity={(epicId) => onMonthTeamCapacityEpicRemove?.(epicId)}
            teamFilterId={capacityTeamFilterId === "all" ? null : capacityTeamFilterId}
          />
        ) : roadmapBarMode === "initiatives" && yearRoadmapInitiativeRows.length === 0 ? (
          focusedQuarter && quarterViewTab === "gantt" ? null : (
            <p className="rounded-md bg-muted/40 p-3.5 text-[14px] leading-6 text-slate-600">
              No initiatives with planned epics to display on the roadmap.
            </p>
          )
        ) : yearRoadmapEpics.length === 0 && roadmapBarMode === "epics" ? (
          focusedQuarter && quarterViewTab === "gantt" ? null : (
            <p className="rounded-md bg-muted/40 p-3.5 text-[14px] leading-6 text-slate-600">
              Drag initiatives or epics onto a month column (narrow strip under the month name) or move a scheduled bar
              along the timeline.
            </p>
          )
        ) : focusedQuarter && quarterViewTab === "gantt" ? null : roadmapBarMode === "initiatives" ? (
          <div className="relative w-full">
            <GanttTodayMarker leftPercent={roadmapLaneTodayLeft} showBadge badgePlacement="above" />
            <div id={TIMELINE_GANTT_ROWS_CONTAINER_ID} className="relative z-10 space-y-2">
              {yearRoadmapInitiativeRows.map((group, idx) => (
                <div
                  key={`year-init-row-${group.timelineRow}`}
                  className="relative min-w-0 z-10"
                  data-gantt-lane-index={idx}
                  data-gantt-timeline-row={group.timelineRow}
                >
                  <div className="relative grid min-w-0 gap-2" style={ganttLaneGridStyle}>
                    {group.items.map((row) => {
                      const columnStart = Math.max(1, row.startS);
                      const span = Math.max(row.endS - row.startS + 1, 1);
                      const stories = (row.initiative.epics ?? []).flatMap((e) => e.userStories ?? []);
                      const finishedStories = stories.filter((s) => s.status === "done" || s.status === "approved").length;
                      const completionPercent = stories.length > 0 ? Math.round((finishedStories / stories.length) * 100) : 0;
                      return (
                        <div
                          key={`year-init-${row.initiative.id}`}
                          className="relative min-w-0 rounded-lg pt-0.5 pb-2 z-20"
                          style={{ gridColumn: `${columnStart} / span ${span}`, gridRow: 1 }}
                        >
                          <InitiativeTimelineBar
                            id={row.initiative.id}
                            title={row.initiative.title}
                            icon={row.initiative.icon}
                            color={row.initiative.color}
                            progressPercent={completionPercent}
                            progressLabel={stories.length > 0 ? `${finishedStories}/${stories.length} done or approved` : "No user stories"}
                            onClick={() => onOpenInitiative(row.initiative.id)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="relative w-full">
            <GanttTodayMarker leftPercent={roadmapLaneTodayLeft} showBadge badgePlacement="above" />
            <div id={TIMELINE_GANTT_ROWS_CONTAINER_ID} className="relative z-10 space-y-2">
              {yearRoadmapEpicRows.map((group, idx) => (
                <div
                  key={`year-epic-row-${group.timelineRow}`}
                  className="relative min-w-0 z-10"
                  data-gantt-lane-index={idx}
                  data-gantt-timeline-row={group.timelineRow}
                >
                  <div className="relative grid min-w-0 gap-2" style={ganttLaneGridStyle}>
                    {group.items.map((row) => {
                      const rz = epicResizePreview?.epicId === row.epic.id ? epicResizePreview : null;
                      let previewStart = row.startS;
                      let previewEnd = row.endS;
                      if (rz) {
                        if (rz.side === "right") previewEnd = Math.min(24, Math.max(row.startS, row.endS + rz.deltaSteps));
                        else previewStart = Math.max(1, Math.min(row.endS, row.startS + rz.deltaSteps));
                      }
                      const columnStart = Math.max(1, previewStart);
                      const span = Math.max(previewEnd - previewStart + 1, 1);
                      const stories = row.epic.userStories ?? [];
                      const finishedStories = stories.filter((s) => s.status === "done" || s.status === "approved").length;
                      const completionPercent = stories.length > 0 ? Math.round((finishedStories / stories.length) * 100) : 0;
                      const isEpicEmphasis = ganttEpicEmphasis != null && ganttEpicEmphasis.epicId === row.epic.id;
                      const resizeEdgeClass =
                        "pointer-events-auto absolute inset-y-0.5 z-20 w-2.5 touch-none select-none rounded-md bg-white/0 transition-colors hover:bg-white/30 active:bg-white/40";
                      return (
                        <div
                          key={`year-epic-${row.epic.id}`}
                          ref={(node) => {
                            if (node) barElsRef.current.set(row.epic.id, node);
                            else barElsRef.current.delete(row.epic.id);
                          }}
                          className={cn("relative min-w-0 rounded-lg pt-0.5 pb-2", rz ? "z-0 opacity-70" : "z-20")}
                          style={{ gridColumn: `${columnStart} / span ${span}`, gridRow: 1 }}
                        >
                          <EpicPlanTimelineBar
                            id={row.epic.id}
                            title={row.epic.title}
                            icon={row.epic.icon}
                            color={row.epic.color?.trim() ? row.epic.color : row.initiative.color}
                            progressPercent={completionPercent}
                            progressLabel={stories.length > 0 ? `${finishedStories}/${stories.length} done or approved` : "No user stories"}
                            isResizing={Boolean(rz)}
                            emphasizeFlash={isEpicEmphasis}
                            emphasizeTick={isEpicEmphasis ? ganttEpicEmphasis.tick : 0}
                            onUnschedule={onUnscheduleEpic ? () => onUnscheduleEpic(row.epic.id) : undefined}
                            onClick={() => onOpenEpic(row.epic.id)}
                          />
                          {onResizeEpicPlanRange ? (
                            <>
                              <div
                                role="slider"
                                aria-label="Resize epic start (sprint step)"
                                title="Drag to change epic start sprint"
                                className={cn(resizeEdgeClass, "left-0 cursor-ew-resize")}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  handleEpicResizePointerDown(row.epic.id, "left", e);
                                }}
                              />
                              <div
                                role="slider"
                                aria-label="Resize epic end (sprint step)"
                                title="Drag to change epic end sprint"
                                className={cn(resizeEdgeClass, "right-0 cursor-ew-resize")}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  handleEpicResizePointerDown(row.epic.id, "right", e);
                                }}
                              />
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
