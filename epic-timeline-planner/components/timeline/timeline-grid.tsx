"use client";

import { useDndContext, useDroppable } from "@dnd-kit/core";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  ClipboardList,
  FileWarning,
  Flag,
  Folder,
  Map as MapIcon,
  PieChart,
  Thermometer,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { EpicPlanTimelineBar, InitiativeTimelineBar } from "@/components/timeline/epic-timeline-bar";
import { isPostDragClickSuppressed } from "@/components/timeline/drag-context";
import { MonthAnalytics } from "@/components/timeline/month-analytics";
import { CapacityPlanTeamCombobox } from "@/components/timeline/capacity-plan-team-combobox";
import { MonthTeamCapacityBoard } from "@/components/timeline/month-team-capacity";
import { QuarterTeamCapacityBoard } from "@/components/timeline/quarter-team-capacity";
import { SprintAnalytics } from "@/components/timeline/sprint-analytics";
import { SprintCapacityBoard } from "@/components/timeline/sprint-capacity";
import { SprintEndCountdown } from "@/components/timeline/sprint-end-countdown";
import { SprintKanbanBoard } from "@/components/timeline/sprint-kanban";
import { SprintRetrospectiveEditor, type SprintRetrospectiveDoc } from "@/components/timeline/sprint-retrospective";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { computeSprintKanbanSummaryStats } from "@/lib/sprint-plan";
import { sprintStoryBoardEpicTeamFilter, type SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { TIMELINE_GANTT_ROWS_CONTAINER_ID } from "@/lib/gantt-lane-from-pointer";
import {
  CAPACITY_LOAD_BASIS_STORAGE_KEY,
  parseCapacityLoadBasis,
  type CapacityLoadBasis,
} from "@/lib/capacity-load-basis";
import { isEpicPlanDraggableId } from "@/lib/epic-dnd-ids";
import { type MonthTeamCapacityBoard as MonthTeamCapacityBoardModel } from "@/lib/month-team-capacity";
import { ALL_QUARTERS_TEAM_CAPACITY_LABEL, ALL_YEAR_PLAN_MONTHS, MONTHS, QUARTERS } from "@/lib/timeline";
import {
  MONTH_TEAM_COLUMNS,
  MONTH_TEAM_IDS,
  isKnownEpicTeamId,
  monthTeamBoardStorageKey,
  monthTeamLabelForId,
  type MonthTeamBoardPersisted,
} from "@/lib/month-team-board";
import { EpicItem, InitiativeItem, type UserStoryItem } from "@/lib/types";
import {
  capacityPlanTeamCatalogFromDirectory,
  normalizeWorkspaceUserTeam,
  teamLabelForWorkspaceUser,
} from "@/lib/workspace-users";
import {
  clampYearSprint,
  firstGlobalSprintForMonth,
  globalSprintFromMonthLane,
  monthLaneFromGlobalSprint,
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

/** Vertical sprint columns + subtle month pairs (2 sprints) for roadmap Gantt lanes. */
function GanttLaneSprintBackdrop({ columnCount, className }: { columnCount: number; className?: string }) {
  if (columnCount <= 0) return null;
  return (
    <div
      className={cn("pointer-events-none absolute inset-0 z-0 flex w-full gap-2", className)}
      aria-hidden
    >
      {Array.from({ length: columnCount }, (_, i) => (
        <div
          key={i}
          className={cn(
            "min-h-full min-w-0 flex-1 border-r border-slate-200/45 last:border-r-0",
            Math.floor(i / 2) % 2 === 0 ? "bg-slate-50/40" : "bg-white/55",
            (i + 1) % 2 === 0 && i < columnCount - 1 && "border-slate-300/40",
          )}
        />
      ))}
    </div>
  );
}

/** Faint horizontal rules in the roadmap lane “tail” (empty space below the last row). */
function StripedGanttHorizontalGuides() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[1]"
      aria-hidden
      style={{
        backgroundImage:
          "repeating-linear-gradient(to bottom, transparent 0, transparent calc(2.75rem - 1px), rgba(203, 213, 225, 0.42) calc(2.75rem - 1px), rgba(203, 213, 225, 0.42) 2.75rem)",
      }}
    />
  );
}

/** Scrollable roadmap lane: each row should include GanttLaneSprintBackdrop with the same column count. */
function StripedGanttLaneScrollArea({
  id,
  columnCount,
  rowGapClass,
  minHeightStyle = { minHeight: "max(100%, calc(100dvh - 26rem))" },
  children,
}: {
  id?: string;
  columnCount: number;
  rowGapClass: string;
  /** Override when the surrounding chrome differs (e.g. month sprint header). */
  minHeightStyle?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className="relative z-10 flex min-h-0 basis-0 flex-1 flex-col overflow-y-auto overscroll-contain"
    >
      <div className="relative isolate flex w-full flex-shrink-0 flex-col" style={minHeightStyle}>
        <div className={cn("relative z-[2] shrink-0", rowGapClass)}>{children}</div>
        {columnCount > 0 ? (
          <div className="relative z-0 min-h-0 flex-1 basis-0">
            <GanttLaneSprintBackdrop columnCount={columnCount} />
            <StripedGanttHorizontalGuides />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Portfolio roadmap Gantt (all-quarters year + drilled-in quarter): same measured-width rule as
 * {@link RIGHT_PANEL_MIN_CONTENT_PX} — fluid layout at/above that band; below it, horizontal scroll + fixed
 * sprint columns. Short horizons (≤ {@link ROADMAP_SHORT_HORIZON_MAX_COLUMNS} sprints) derive sprint width
 * from {@link ROADMAP_SHORT_HORIZON_MIN_CONTAINER_PX}. Hysteresis: {@link YEAR_ROADMAP_H_SCROLL_HYSTERESIS_PX}.
 * Sprint track `gap-2` matches {@link YEAR_ROADMAP_GANTT_GAP_PX}.
 */
const YEAR_ROADMAP_GANTT_GAP_PX = 8;
const YEAR_ROADMAP_MIN_SPRINT_PX = 36;
const ROADMAP_SHORT_HORIZON_MAX_COLUMNS = 8;
/** Target total width (sprints + gaps) for derived per-sprint px when column count ≤ 8; kept in sync with {@link RIGHT_PANEL_MIN_CONTENT_PX}. */
const ROADMAP_SHORT_HORIZON_MIN_CONTAINER_PX = 1000;
const YEAR_ROADMAP_H_SCROLL_HYSTERESIS_PX = 48;

/**
 * Measured {@link yearRoadmapMeasureRef} width: at or above this (plus hysteresis when leaving narrow mode)
 * the right panel stays fluid; below, outer horizontal scroll appears and portfolio Gantt stops shrinking lanes.
 */
const RIGHT_PANEL_MIN_CONTENT_PX = 1000;
/** Matches `pl-[4rem]` / `ml-[4rem]` when the context rail is shown so scroll width fits the sprint grid. */
const ROADMAP_PORTFOLIO_CONTEXT_RAIL_INSET_PX = 64;

function getRoadmapHScrollMinSprintPx(columnCount: number): number {
  if (columnCount <= 0) return YEAR_ROADMAP_MIN_SPRINT_PX;
  if (columnCount > ROADMAP_SHORT_HORIZON_MAX_COLUMNS) return YEAR_ROADMAP_MIN_SPRINT_PX;
  const gaps = Math.max(0, columnCount - 1) * YEAR_ROADMAP_GANTT_GAP_PX;
  const raw = (ROADMAP_SHORT_HORIZON_MIN_CONTAINER_PX - gaps) / columnCount;
  return Math.max(YEAR_ROADMAP_MIN_SPRINT_PX, raw);
}

function yearRoadmapGanttMinWidthPx(columnCount: number, minSprintPx: number = YEAR_ROADMAP_MIN_SPRINT_PX): number {
  if (columnCount <= 0) return 0;
  return columnCount * minSprintPx + Math.max(0, columnCount - 1) * YEAR_ROADMAP_GANTT_GAP_PX;
}

/** Full-year / all-quarters Gantt: vertical “today” line with a down-pointing triangle at the top. */
function YearRoadmapTodayLine({ leftPercent }: { leftPercent: number | null }) {
  if (leftPercent == null || Number.isNaN(leftPercent)) return null;
  const x = Math.min(100, Math.max(0, leftPercent));
  return (
    <>
      <div
        className="pointer-events-none absolute inset-y-0 z-[5] w-px -translate-x-1/2 bg-emerald-500/95"
        style={{ left: `${x}%` }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-0 z-[6] h-0 w-0 -translate-x-1/2 border-x-[6px] border-x-transparent border-t-[8px] border-t-emerald-500"
        style={{ left: `${x}%` }}
        aria-hidden
      />
    </>
  );
}

/** All-quarters roadmap with no rows: striped lane plus a centered empty message. */
function YearRoadmapEmptyStripedLane({
  currentYear,
  roadmapLaneTodayLeft,
  columnCount,
  variant,
}: {
  currentYear: number;
  roadmapLaneTodayLeft: number | null;
  columnCount: number;
  variant: "initiatives" | "epics";
}) {
  const srText =
    variant === "initiatives"
      ? `No initiatives with planned epics on the ${currentYear} roadmap. Plan epics from the initiative list when you are ready.`
      : `No epics on the ${currentYear} roadmap yet. Drag an epic from the initiative list onto the timeline.`;

  return (
    <div
      className={cn(
        "relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden rounded-xl bg-slate-50/35 pl-2 pr-1 pb-3 ring-1 ring-slate-100/80 sm:pl-2 sm:pr-1 sm:pb-4",
        roadmapLaneTodayLeft != null && "pt-5 sm:pt-6",
      )}
    >
      <YearRoadmapTodayLine leftPercent={roadmapLaneTodayLeft} />
      <div className="relative flex min-h-0 w-full basis-0 flex-1 flex-col overflow-hidden">
        <p className="sr-only">{srText}</p>
        <StripedGanttLaneScrollArea
          id={TIMELINE_GANTT_ROWS_CONTAINER_ID}
          columnCount={columnCount}
          rowGapClass="space-y-1.5"
          minHeightStyle={{ minHeight: "max(100%, calc(100dvh - 28rem))" }}
        >
          <div className="h-0 shrink-0 overflow-hidden" aria-hidden />
        </StripedGanttLaneScrollArea>
        <div className="pointer-events-none absolute inset-0 z-[20] flex justify-center px-4 pt-[clamp(1.5rem,11vh,7rem)] sm:px-6 sm:pt-[clamp(2rem,14vh,9rem)]">
          <div className="max-w-md text-center text-pretty sm:max-w-lg" aria-hidden>
            {variant === "initiatives" ? (
              <>
                <p className="text-base font-semibold leading-snug text-slate-800 sm:text-lg">
                  No initiatives on the {currentYear} roadmap yet
                </p>
                <p className="mt-2 text-sm font-normal leading-relaxed text-slate-600 sm:text-base">
                  Plan epics from the initiative list to fill the timeline.
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold leading-snug text-slate-800 sm:text-xl">
                  No epics on the {currentYear} roadmap yet
                </p>
                <p className="mt-2 text-sm font-normal leading-relaxed text-slate-600 sm:text-base">
                  Drag an epic from the initiative list onto the timeline.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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
  showProgress?: boolean;
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
  showProgress = true,
}: GanttLaneRowProps) {
  const resizeEdgeClass =
    "pointer-events-auto absolute inset-y-0.5 z-20 w-2.5 touch-none select-none rounded-md bg-white/0 transition-colors hover:bg-white/30 active:bg-white/40";
  const stories = (initiative.epics ?? []).flatMap((epic) => epic.userStories ?? []);
  const totalStories = stories.length;
  const finishedStories = stories.filter((story) => story.status === "done" || story.status === "approved").length;
  const completionPercent = totalStories > 0 ? Math.round((finishedStories / totalStories) * 100) : 0;

  return (
    <div
      className={cn("relative min-w-0 hover:z-[9999]", emphasize ? "z-[25]" : "z-10")}
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
              showProgress={showProgress}
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

/** Epic is scheduled on the Gantt (matches “Scheduled” quick-filter semantics). */
function epicIsScheduledOnGantt(epic: EpicItem): boolean {
  return epic.planSprint != null && epic.planStartMonth != null && epic.planEndMonth != null;
}

type EpicGanttLaneRowProps = {
  epic: EpicItem;
  initiative: InitiativeItem;
  gridStyle: CSSProperties;
  month?: number | null;
  planYear?: number | null;
  onOpenEpic: (epicId: string) => void;
  onUnscheduleEpic?: (epicId: string) => void;
  onDayRangeChange?: (epicId: string, startDay: number, endDay: number) => void;
  ganttLaneSortIndex: number;
  emphasize?: boolean;
  emphasizeTick?: number;
  showProgress?: boolean;
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

function estimatePanelEpicSprintLabel(epic: EpicItem): string {
  if (epic.planStartMonth == null || epic.planSprint == null) return "—";
  const g = globalSprintFromMonthLane(epic.planStartMonth, epic.planSprint === 2 ? 2 : 1);
  return sprintLabelQuarterOrMonth(g);
}

function estimatePanelStorySprintLabel(story: UserStoryItem): string {
  return story.sprint == null ? "—" : sprintLabelQuarterOrMonth(story.sprint);
}

function estimatePanelTeamLabel(teamId: string | null | undefined): string {
  const label = monthTeamLabelForId(teamId);
  if (label) return label;
  const raw = teamId?.trim();
  return raw || "—";
}

function estimatePanelAssigneeLabel(value: string | null | undefined): string {
  const t = (value ?? "").trim();
  return t || "—";
}

type TodayBadgePlacement = "above" | "inside";

/** “Today” badge + vertical dashed marker, always aligned (same parent coordinate space). */
function GanttTodayMarker({
  leftPercent,
  showBadge = true,
  badgePlacement = "above",
  prioritizeLabel = false,
  showArrow = true,
  showLine = true,
  /** Bleed top/bottom past the track box so the dash meets the outer padded panel border (parent uses py-3 sm:py-4). */
  bleedToPaddedPanel,
}: {
  leftPercent: number | null;
  showBadge?: boolean;
  badgePlacement?: TodayBadgePlacement;
  prioritizeLabel?: boolean;
  showArrow?: boolean;
  showLine?: boolean;
  bleedToPaddedPanel?: boolean;
}) {
  if (leftPercent == null || Number.isNaN(leftPercent)) return null;
  const x = Math.min(100, Math.max(0, leftPercent));
  const prioritizedAbove = prioritizeLabel && badgePlacement === "above";
  if (prioritizedAbove) {
    return (
      <div
        className="pointer-events-none absolute inset-x-0 inset-y-0 z-[3000] overflow-visible [isolation:isolate]"
        aria-hidden
      >
        {showBadge ? (
          <div
            className="absolute top-[2px] px-0 py-0 text-[10px] font-semibold leading-none text-emerald-800 [writing-mode:vertical-rl]"
            style={{ left: `${x}%`, transform: "translateX(-100%) translateX(-6px)" }}
          >
            Today
          </div>
        ) : null}
        <div
          className="absolute top-0 bottom-0 w-4 -translate-x-1/2 overflow-visible"
          style={{ left: `${x}%` }}
        >
          {showLine ? (
            <div className="absolute left-1/2 top-[88px] bottom-0 w-px -translate-x-1/2 bg-emerald-500/95" />
          ) : null}
          {showArrow ? (
            <div className="absolute top-[81px] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[6px] border-x-transparent border-t-[8px] border-t-emerald-500" />
          ) : null}
        </div>
      </div>
    );
  }
  const badgeRectY = badgePlacement === "inside" ? 2 : prioritizedAbove ? -1.4 : -6;
  const badgeTextY = badgePlacement === "inside" ? 6 : prioritizedAbove ? 2.6 : -2;
  const arrowTopY = prioritizedAbove ? 5 : 0;
  const arrowTipY = arrowTopY + 6;
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 overflow-visible [isolation:isolate]",
        prioritizeLabel ? "z-30" : "z-0",
        bleedToPaddedPanel ? "-top-12 -bottom-3 sm:-top-13 sm:-bottom-4" : "inset-y-0",
      )}
      aria-hidden
    >
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {showBadge ? (
          <g>
            <rect
              x={x - 4.5}
              y={badgeRectY}
              width={9}
              height={6}
              rx={1.2}
              fill="#ffffff"
              stroke="#86efac"
              strokeWidth={0.35}
            />
            <text
              x={x}
              y={badgeTextY}
              textAnchor="middle"
              fontSize="3"
              fontWeight="700"
              fill="#065f46"
            >
              Today
            </text>
          </g>
        ) : null}
      </svg>
      {showArrow ? (
        <div
          className="absolute h-[10px] w-[12px] -translate-x-1/2 bg-emerald-500"
          style={{
            left: `${x}%`,
            top: `${arrowTopY}%`,
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
          }}
        />
      ) : null}
      {showLine ? (
        <div
          className="absolute bottom-0 w-px -translate-x-1/2 bg-emerald-500/85"
          style={{ left: `${x}%`, top: `calc(${arrowTopY}% + 10px)` }}
        />
      ) : null}
    </div>
  );
}

/**
 * For the single-quarter gantt: when a bar occupies exactly one sprint column and has day
 * precision set, return absolute left/right % values so the bar can be absolutely positioned
 * inside its cell. Returns null when there are no day offsets or the epic spans multiple sprints.
 */
function quarterBarAbsoluteDayPct(
  epic: EpicItem,
  startS: number,
  span: number,
  planYear: number,
): { left: string; right: string } | null {
  if (span !== 1) return null;
  if (epic.planStartDay == null && epic.planEndDay == null) return null;
  const lane = (((startS - 1) % 2) + 1) as 1 | 2;
  const month = epic.planStartMonth;
  if (!month) return null;
  const dim = daysInMonth(planYear, month);
  const sprintFirst = lane === 1 ? 1 : 16;
  const sprintLast = lane === 1 ? 15 : dim;
  const days = sprintLast - sprintFirst + 1;
  const rawStart = epic.planStartDay;
  const rawEnd = epic.planEndDay;
  const startDay =
    rawStart != null && rawStart >= sprintFirst && rawStart <= sprintLast ? rawStart : sprintFirst;
  const endDay =
    rawEnd != null && rawEnd >= sprintFirst && rawEnd <= sprintLast ? rawEnd : sprintLast;
  const leftPct = Math.max(0, ((startDay - sprintFirst) / days) * 100);
  const rightPct = Math.max(0, ((sprintLast - endDay) / days) * 100);
  return {
    left: `${leftPct.toFixed(2)}%`,
    right: `${rightPct.toFixed(2)}%`,
  };
}

/**
 * Compute paddingLeft/paddingRight (as % strings) for year/quarter Gantt bar wrappers
 * so that day-precision start/end day fields shift the bar slightly within its sprint column.
 * Percentages are relative to the full gridColumn span width.
 */
function epicBarDayInsetPct(
  epic: EpicItem,
  startS: number,
  endS: number,
  span: number,
  planYear: number,
): { left: string; right: string } {
  const startLane = ((startS - 1) % 2) + 1 as 1 | 2;
  const endLane = ((endS - 1) % 2) + 1 as 1 | 2;
  const startMonth = epic.planStartMonth;
  const endMonth = epic.planEndMonth;
  if (!startMonth || !endMonth) return { left: "", right: "" };

  const startSprintFirst = startLane === 1 ? 1 : 16;
  const startSprintLast = startLane === 1 ? 15 : daysInMonth(planYear, startMonth);
  const daysStart = startSprintLast - startSprintFirst + 1;
  const rawStart = epic.planStartDay;
  const actualStart =
    rawStart != null && rawStart >= startSprintFirst && rawStart <= startSprintLast
      ? rawStart
      : startSprintFirst;
  const leftPct = (Math.max(0, actualStart - startSprintFirst) / daysStart / span) * 100;

  const endSprintFirst = endLane === 1 ? 1 : 16;
  const endSprintLast = endLane === 1 ? 15 : daysInMonth(planYear, endMonth);
  const daysEnd = endSprintLast - endSprintFirst + 1;
  const rawEnd = epic.planEndDay;
  const actualEnd =
    rawEnd != null && rawEnd >= endSprintFirst && rawEnd <= endSprintLast ? rawEnd : endSprintLast;
  const rightPct = (Math.max(0, endSprintLast - actualEnd) / daysEnd / span) * 100;

  return {
    left: leftPct > 0.1 ? `${leftPct.toFixed(2)}%` : "",
    right: rightPct > 0.1 ? `${rightPct.toFixed(2)}%` : "",
  };
}

/**
 * Map a day (1-based) to a left-edge % of the month container.
 * The container is split into two equal 50% halves: sprint 1 (days 1–15) and sprint 2 (days 16–dim).
 * This keeps day 16 always at exactly 50% regardless of how many days the month has.
 */
function dayToLeftPct(day: number, dim: number): number {
  const s2days = dim - 15;
  if (day <= 15) return ((day - 1) / 15) * 50;
  return 50 + ((day - 16) / s2days) * 50;
}

/** Right edge % of a day (= left edge of the next day, or 100% at month end). */
function dayToRightPct(day: number, dim: number): number {
  const s2days = dim - 15;
  if (day <= 15) return (day / 15) * 50;
  return 50 + ((day - 15) / s2days) * 50;
}

/**
 * Invert dayToLeftPct: given a % position, return the nearest start-day.
 * Used when dragging the left handle.
 */
function pctToStartDay(pct: number, dim: number): number {
  const s2days = dim - 15;
  if (pct <= 50) return Math.max(1, Math.min(15, Math.floor((pct / 50) * 15) + 1));
  return Math.max(16, Math.min(dim, Math.floor(((pct - 50) / 50) * s2days) + 16));
}

/**
 * Invert dayToRightPct: given a % position, return the nearest end-day.
 * Used when dragging the right handle.
 */
function pctToEndDay(pct: number, dim: number): number {
  const s2days = dim - 15;
  if (pct <= 50) return Math.max(1, Math.min(15, Math.round((pct / 50) * 15)));
  return Math.max(15, Math.min(dim, Math.floor(((pct - 50) / 50) * s2days) + 15));
}

/** Compute left% and width% for a month bar with day precision. */
function monthBarDayPercents(
  epic: EpicItem,
  month: number,
  planYear: number,
): { leftPct: number; widthPct: number } {
  const dim = daysInMonth(planYear, month);
  const startMonth = epic.planStartMonth ?? month;
  const endMonth = epic.planEndMonth ?? month;

  // Determine start day within this month
  let startDay: number;
  if (month > startMonth) {
    startDay = 1;
  } else if (epic.planStartDay != null) {
    startDay = Math.max(1, Math.min(epic.planStartDay, dim));
  } else {
    startDay = epic.planSprint === 2 ? 16 : 1;
  }

  // Determine end day within this month
  let endDay: number;
  if (month < endMonth) {
    endDay = dim;
  } else if (epic.planEndDay != null) {
    endDay = Math.max(1, Math.min(epic.planEndDay, dim));
  } else {
    endDay = epic.planEndSprint === 1 ? 15 : dim;
  }

  if (endDay < startDay) endDay = startDay;

  const leftPct = dayToLeftPct(startDay, dim);
  const widthPct = Math.max(dayToRightPct(endDay, dim) - leftPct, 50 / 15);
  return { leftPct, widthPct };
}

function EpicGanttLaneRow({
  epic,
  initiative,
  gridStyle,
  month = null,
  planYear,
  onOpenEpic,
  onUnscheduleEpic,
  onDayRangeChange,
  ganttLaneSortIndex,
  emphasize = false,
  emphasizeTick = 0,
  showProgress = true,
}: EpicGanttLaneRowProps) {
  const stories = epic.userStories ?? [];
  const totalStories = stories.length;
  const finishedStories = stories.filter((story) => story.status === "done" || story.status === "approved").length;
  const completionPercent = totalStories > 0 ? Math.round((finishedStories / totalStories) * 100) : 0;
  const barColor = epic.color?.trim() ? epic.color : initiative.color;

  // Drag-resize state for month view
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    side: "left" | "right";
    startX: number;
    origStartDay: number;
    origEndDay: number;
    dim: number;
  } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ leftPct: number; widthPct: number } | null>(null);

  const isMonthView = month != null && epic.planStartMonth != null && epic.planEndMonth != null;

  // Derive bar position
  const barPos =
    isMonthView && planYear != null
      ? monthBarDayPercents(epic, month!, planYear)
      : null;

  const effectivePos = dragOffset ?? barPos;

  const computeDays = useCallback(
    (drag: NonNullable<typeof dragRef.current>, clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const pct = rect
        ? Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
        : 50;
      let newStartDay = drag.origStartDay;
      let newEndDay = drag.origEndDay;
      if (drag.side === "left") {
        newStartDay = Math.min(pctToStartDay(pct, drag.dim), drag.origEndDay);
      } else {
        newEndDay = Math.max(drag.origStartDay, pctToEndDay(pct, drag.dim));
      }
      return { newStartDay, newEndDay };
    },
    [],
  );

  const startPointerDown = useCallback(
    (side: "left" | "right") => (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isMonthView || planYear == null || !onDayRangeChange) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const dim = daysInMonth(planYear, month!);
      const startMonth = epic.planStartMonth ?? month!;
      const endMonth = epic.planEndMonth ?? month!;
      const origStartDay =
        month! > startMonth ? 1 : (epic.planStartDay ?? (epic.planSprint === 2 ? 16 : 1));
      const origEndDay =
        month! < endMonth ? dim : (epic.planEndDay ?? (epic.planEndSprint === 1 ? 15 : dim));
      dragRef.current = { side, startX: e.clientX, origStartDay, origEndDay, dim };
    },
    [isMonthView, planYear, month, epic, onDayRangeChange],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const { newStartDay, newEndDay } = computeDays(drag, e.clientX);
      const leftPct = dayToLeftPct(newStartDay, drag.dim);
      const rightPct = dayToRightPct(newEndDay, drag.dim);
      const widthPct = Math.max(rightPct - leftPct, 50 / 15);
      setDragOffset({ leftPct, widthPct });
    },
    [computeDays],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || !onDayRangeChange) return;
      dragRef.current = null;
      const { newStartDay, newEndDay } = computeDays(drag, e.clientX);
      setDragOffset(null);
      const startMonth = epic.planStartMonth ?? month!;
      const endMonth = epic.planEndMonth ?? month!;
      const canResizeStart = month! <= startMonth;
      const canResizeEnd = month! >= endMonth;
      if (drag.side === "left" && canResizeStart) {
        onDayRangeChange(epic.id, newStartDay, drag.origEndDay);
      } else if (drag.side === "right" && canResizeEnd) {
        onDayRangeChange(epic.id, drag.origStartDay, newEndDay);
      }
    },
    [computeDays, month, epic, onDayRangeChange],
  );

  const laneBody =
    isMonthView && effectivePos != null ? (
      // Month view: absolute positioning with day precision
      <div ref={containerRef} className="relative min-w-0" style={{ height: "2.5rem" }}>
        <div
          className={cn("absolute top-0.5 bottom-0.5 overflow-visible")}
          style={{ left: `${effectivePos.leftPct}%`, width: `${effectivePos.widthPct}%` }}
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
            showProgress={showProgress}
            onUnschedule={onUnscheduleEpic ? () => onUnscheduleEpic(epic.id) : undefined}
            onClick={() => onOpenEpic(epic.id)}
          />
          {/* Left resize handle */}
          {onDayRangeChange && (epic.planStartMonth == null || month! <= epic.planStartMonth) ? (
            <div
              className="pointer-events-auto absolute inset-y-0.5 z-30 w-2.5 touch-none select-none rounded-md bg-white/0 transition-colors hover:bg-white/30 active:bg-white/40 left-0 cursor-ew-resize"
              onPointerDown={startPointerDown("left")}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
          {/* Right resize handle */}
          {onDayRangeChange && (epic.planEndMonth == null || month! >= epic.planEndMonth) ? (
            <div
              className="pointer-events-auto absolute inset-y-0.5 z-30 w-2.5 touch-none select-none rounded-md bg-white/0 transition-colors hover:bg-white/30 active:bg-white/40 right-0 cursor-ew-resize"
              onPointerDown={startPointerDown("right")}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
        </div>
      </div>
    ) : (
      // Year / quarter view: original grid layout
      <div className="relative grid min-w-0 gap-2" style={gridStyle}>
        <div
          className={cn("relative z-20 min-w-0 pt-0.5 pb-0.5", emphasize && "overflow-visible")}
          style={{ gridColumn: "1 / span 1", gridRow: 1 }}
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
            showProgress={showProgress}
            onUnschedule={onUnscheduleEpic ? () => onUnscheduleEpic(epic.id) : undefined}
            onClick={() => onOpenEpic(epic.id)}
          />
        </div>
      </div>
    );

  return (
    <div
      className={cn("relative min-w-0 py-0.5", emphasize ? "z-[25]" : "z-10")}
      data-gantt-lane-index={ganttLaneSortIndex}
      data-gantt-timeline-row={Number.isFinite(initiative.timelineRow) ? initiative.timelineRow : 0}
    >
      {month != null ? (
        <>
          {/* gap-0 overrides gap-2 so the sprint halves each occupy exactly 50% — aligns with absolute % bar positions */}
          <GanttLaneSprintBackdrop columnCount={2} className="gap-0" />
          <div className="relative z-[1]">{laneBody}</div>
        </>
      ) : (
        laneBody
      )}
    </div>
  );
}

function MonthInitiativeGanttLaneRow({
  initiative,
  onOpenInitiative,
  ganttLaneSortIndex,
  showProgress = true,
}: {
  initiative: InitiativeItem;
  onOpenInitiative: (initiativeId: string) => void;
  ganttLaneSortIndex: number;
  showProgress?: boolean;
}) {
  const stories = (initiative.epics ?? []).flatMap((epic) => epic.userStories ?? []);
  const totalStories = stories.length;
  const finishedStories = stories.filter((story) => story.status === "done" || story.status === "approved").length;
  const completionPercent = totalStories > 0 ? Math.round((finishedStories / totalStories) * 100) : 0;

  return (
    <div
      className="relative z-10 min-w-0 py-0.5"
      data-gantt-lane-index={ganttLaneSortIndex}
      data-gantt-timeline-row={Number.isFinite(initiative.timelineRow) ? initiative.timelineRow : 0}
    >
      <GanttLaneSprintBackdrop columnCount={2} />
      <div className="relative z-[1] grid min-w-0 gap-2" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div className="relative z-20 min-w-0 pt-0.5 pb-0.5" style={{ gridColumn: "1 / span 2", gridRow: 1 }}>
          <InitiativeTimelineBar
            id={initiative.id}
            title={initiative.title}
            icon={initiative.icon}
            color={initiative.color}
            progressPercent={completionPercent}
            progressLabel={totalStories > 0 ? `${finishedStories}/${totalStories} done or approved` : "No user stories"}
            showProgress={showProgress}
            onClick={() => onOpenInitiative(initiative.id)}
          />
        </div>
      </div>
    </div>
  );
}

export type MonthPlanSurfaceTab =
  | "epic-gantt"
  | "month-capacity"
  | "month-status"
  | "sprint-kanban"
  | "sprint-status"
  | "sprint-capacity"
  | "sprint-retrospective";

export type QuarterSurfaceTab = "gantt" | "capacity" | "insights";

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
  quarterViewTabExternal?: QuarterSurfaceTab;
  onQuarterViewTabChange?: (tab: QuarterSurfaceTab) => void;
  /** Month drill: team allocation vs sprint tools (controlled from parent for URL sync). */
  monthPlanTab?: MonthPlanSurfaceTab;
  onMonthPlanTabChange?: (tab: MonthPlanSurfaceTab) => void;
  monthTeamCapacityBoard?: { capacities: Record<string, number> };
  monthTeamCapacityByKey?: Record<string, MonthTeamCapacityBoardModel>;
  onMonthTeamCapacityChange?: (teamId: string, days: number) => void;
  /** Quarter view: set per-team quarter total; parent splits across months in the quarter. */
  onQuarterTeamCapacityChange?: (quarterLabel: string, teamId: string, quarterTotalDays: number) => void;
  /** All-quarters view: set per-team year total; parent splits across all months in year. */
  onYearTeamCapacityChange?: (teamId: string, yearTotalDays: number) => void;
  onMonthTeamCapacityEpicRemove?: (epicId: string) => void;
  onCapacityEpicOriginalEstimateChange?: (epicId: string, estimatedDays: number) => void;
  /** Month plan team board queues (year:month keys) for capacity ordering and queue→team sync. */
  monthTeamBoardByKey?: Record<string, MonthTeamBoardPersisted>;
  /** Open story Kanban for a global sprint (tabs do not include a sprint-board tab). */
  onEnterSprintStoryBoard?: (yearSprint: number, teamId: string | null) => void;
  /** Delivery team id when sprint story board was opened from a team lane (breadcrumbs + left epic list). */
  sprintStoryBoardTeamId?: string | null;
  /** Sprint view team filter selector (null = all teams). */
  onSprintStoryBoardTeamChange?: (teamId: string | null) => void;
  /** Sprint capacity buckets state for the active sprint + team filter. */
  sprintCapacityBoard?: {
    capacities: Record<string, number>;
    assignments: Record<string, string[]>;
    columnOrder?: string[];
  };
  /** When false, sprint capacity person columns cannot be reordered by drag (e.g. closed sprint). */
  sprintCapacityColumnReorderEnabled?: boolean;
  onSprintCapacityChange?: (member: string, days: number) => void;
  onSprintCapacityStoryEstimateChange?: (storyId: string, estimatedDays: number) => void;
  onSprintCapacityStoryDaysLeftChange?: (storyId: string, daysLeft: number) => void;
  /** Capacity board X: clear assignee only (story stays on sprint). */
  onSprintCapacityStoryClearAssignee?: (storyId: string) => void;
  onSprintCapacityStoryUnschedule?: (storyId: string) => void;
  onRequestSprintKanbanStoryUnschedule?: (storyId: string, storyTitle: string) => void;
  /** Sprint Kanban: inline edits for assignee / estimate / days left. */
  onSprintKanbanStoryPatch?: (
    storyId: string,
    patch: { assignee?: string | null; estimatedDays?: number; daysLeft?: number },
  ) => void;
  /** Users directory — merged into sprint Kanban / capacity / insights assignee rosters by team. */
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  sprintRetrospective?: (SprintRetrospectiveDoc & { updatedAt: string }) | null;
  onSaveSprintRetrospective?: (doc: SprintRetrospectiveDoc) => void;
  onFocusedQuarterChange: (quarterLabel: string | null) => void;
  /**
   * When the user clicks the year breadcrumb (back to year / all-quarters scope), clear month + sprint
   * drill-in in the parent so URL and the middle panel (initiatives vs epics) stay in sync with the grid.
   */
  onYearRoadmapNavigate?: () => void;
  /**
   * Month breadcrumb → quarter chip: focus the quarter and clear month/sprint drill-in in the parent so the
   * middle panel returns to Initiatives (quarter Gantt is not month-scoped).
   */
  onQuarterGanttFromMonthBreadcrumb?: (quarterLabel: string) => void;
  onSprintModeChange: (active: boolean, activeMonth: number | null, activeYearSprint: number | null) => void;
  onSprintTabChange?: (tab: "kanban" | "status") => void;
  onOpenEpic: (epicId: string) => void;
  onUnscheduleEpic?: (epicId: string) => void;
  onOpenInitiative: (initiativeId: string) => void;
  onOpenStory?: (storyId: string) => void;
  onResizeInitiativeRange?: (initiativeId: string, range: InitiativeScheduleRangePatch) => void;
  onResizeEpicPlanRange?: (epicId: string, range: InitiativeScheduleRangePatch) => void;
  /** Month plan: fired when user drags a resize handle to set day-precision start/end. */
  onMonthEpicDayRangeChange?: (epicId: string, startDay: number, endDay: number) => void;
  /** Pulse a scheduled initiative bar on the Gantt (e.g. after expanding it in the left panel). */
  ganttEmphasis?: { initiativeId: string; tick: number } | null;
  /** Pulse an epic bar after it is dropped onto the month plan from the left panel. */
  ganttEpicEmphasis?: { epicId: string; tick: number } | null;
  /** Pulse all Gantt-scheduled epic bars when the “Scheduled” summary filter is turned on. */
  ganttScheduledFilterEmphasis?: { tick: number } | null;
  /** Pulse all sprint-kanban user story cards for an expanded epic accordion. */
  sprintEpicAccordionEmphasis?: { epicId: string; tick: number } | null;
  /** Pulse Kanban cards for stories on the active sprint when “Scheduled” filter is turned on (sprint board). */
  sprintKanbanScheduledStoriesEmphasis?: { tick: number } | null;
  /** Toggled by the Roadmap header “Progress” chip; shows Gantt bar progress rows and left-panel story progress. */
  showRoadmapProgress: boolean;
  onShowRoadmapProgressChange: (next: boolean) => void;
  /** Pre-selected epic in the insights scope picker (from URL on first load). */
  initialInsightsScopeEpicId?: string | null;
  /** Pre-selected initiative in the insights scope picker (from URL on first load). */
  initialInsightsScopeInitId?: string | null;
  /** Fired when the user selects an epic or initiative in any insights scope picker. */
  onInsightsScopeChange?: (epicId: string | null, initId: string | null) => void;
};

const QUARTER_PROGRESS_STEPS: Record<string, number> = {
  Q1: 1,
  Q2: 2,
  Q3: 3,
  Q4: 4,
};

const QUARTER_ORDINAL_LABELS = {
  Q1: <>1<sup className="text-[0.6em] font-semibold">st</sup> Quarter</>,
  Q2: <>2<sup className="text-[0.6em] font-semibold">nd</sup> Quarter</>,
  Q3: <>3<sup className="text-[0.6em] font-semibold">rd</sup> Quarter</>,
  Q4: <>4<sup className="text-[0.6em] font-semibold">th</sup> Quarter</>,
};
const FULL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

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

/** Year control: soft sky tint + dark type (calmer than saturated gradient). */
function RoadmapYearSelect({
  year,
  onYearChange,
}: {
  year: number;
  onYearChange: (nextYear: number) => void | Promise<void>;
}) {
  return (
    <label className="inline-flex h-7 shrink-0 items-stretch overflow-hidden rounded-full border-0 bg-gradient-to-br from-sky-50 via-blue-100 to-blue-100 text-slate-800 shadow-none ring-1 ring-blue-200/75 outline-none select-none transition-colors hover:from-sky-100 hover:via-blue-200 hover:to-blue-200 focus-within:ring-2 focus-within:ring-blue-400/30 focus-within:ring-offset-0">
      <span className="flex shrink-0 items-center gap-1 border-r border-blue-200/80 px-1.5 pt-0.5 text-[10px] font-semibold tracking-[0.05em] uppercase text-blue-950 sm:px-2 sm:text-[11px]">
        <MapIcon className="size-3 shrink-0 sm:size-3.5" aria-hidden />
        Roadmap
      </span>
      <div className="relative flex items-center">
        <select
          value={year}
          onChange={(event) => {
            const nextYear = Number(event.target.value);
            if (nextYear === year) return;
            void Promise.resolve(onYearChange(nextYear));
          }}
          className="h-7 min-w-[4.25rem] cursor-pointer appearance-none bg-transparent py-0 pl-2 pr-6 text-center font-sans text-[11px] font-semibold tabular-nums leading-none text-blue-950 outline-none focus:shadow-none focus:ring-0 focus:ring-offset-0 sm:min-w-[4.75rem] sm:pl-2.5 sm:pr-7 sm:text-[12px]"
          aria-label="Roadmap year"
        >
          <option value={2024}>2024</option>
          <option value={2025}>2025</option>
          <option value={2026}>2026</option>
          <option value={2027}>2027</option>
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 text-blue-600/80 sm:right-1.5"
          aria-hidden
        />
      </div>
    </label>
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
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({ id: `month:${month}` });
  const isProminent = variant === "prominent";
  const isEpicDragActive = active ? isEpicPlanDraggableId(String(active.id)) : false;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "w-full shrink-0 rounded-lg transition-all",
        isProminent
          ? "mt-2 flex min-h-11 items-center justify-center border border-dashed border-slate-200/90 bg-slate-50/50 px-3 text-center"
          : isEpicDragActive
            ? "h-px bg-slate-300/80"
            : "h-0 bg-transparent opacity-0",
        isOver
          ? isProminent
            ? "border-primary/35 bg-primary/10 ring-2 ring-primary/15"
            : "h-1 bg-blue-500/90"
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
        "relative isolate flex min-h-0 flex-1 flex-col rounded-xl transition ring-1",
        isOver
          ? "bg-primary/10 ring-primary/20"
          : "bg-slate-50/35 ring-slate-100/80",
        className,
      )}
    >
      {children}
    </div>
  );
}

function SprintPlanDropButton({
  month,
  lane,
  title,
  onClick,
  className,
  children,
}: {
  month: number;
  lane: 1 | 2;
  title: string;
  onClick: () => void;
  className: string;
  children: ReactNode;
}) {
  const dropId = `epic-plan:${month}:${lane}`;
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  return (
    <button
      ref={setNodeRef}
      type="button"
      title={title}
      onClick={onClick}
      className={cn(className, isOver && "ring-2 ring-primary/40 bg-primary/10")}
    >
      {children}
    </button>
  );
}

type EstimateCoveragePanelTab = "unestimated" | "estimated" | "epicsNoDesc" | "storiesNoDesc";

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
  quarterViewTabExternal,
  onQuarterViewTabChange,
  onFocusedQuarterChange,
  onYearRoadmapNavigate,
  onQuarterGanttFromMonthBreadcrumb,
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
  ganttScheduledFilterEmphasis = null,
  sprintEpicAccordionEmphasis = null,
  sprintKanbanScheduledStoriesEmphasis = null,
  monthPlanTab = "epic-gantt",
  onMonthPlanTabChange,
  monthTeamCapacityBoard = { capacities: {} },
  monthTeamCapacityByKey = {},
  onMonthTeamCapacityChange,
  onQuarterTeamCapacityChange,
  onYearTeamCapacityChange,
  onMonthTeamCapacityEpicRemove,
  onCapacityEpicOriginalEstimateChange,
  monthTeamBoardByKey = {},
  onEnterSprintStoryBoard,
  sprintStoryBoardTeamId = null,
  onSprintStoryBoardTeamChange,
  sprintCapacityBoard,
  sprintCapacityColumnReorderEnabled = true,
  onSprintCapacityChange,
  onSprintCapacityStoryEstimateChange,
  onSprintCapacityStoryDaysLeftChange,
  onSprintCapacityStoryClearAssignee,
  onSprintCapacityStoryUnschedule,
  onRequestSprintKanbanStoryUnschedule,
  onSprintKanbanStoryPatch,
  workspaceDirectoryUsers = [],
  sprintRetrospective = null,
  onSaveSprintRetrospective,
  showRoadmapProgress,
  onShowRoadmapProgressChange,
  initialInsightsScopeEpicId,
  initialInsightsScopeInitId,
  onInsightsScopeChange,
  onMonthEpicDayRangeChange,
}: TimelineGridProps) {
  const ROADMAP_BAR_MODE_STORAGE_KEY = "timeline:roadmap-bar-mode";
  void zoom;
  const [focusedMonth, setFocusedMonth] = useState<number | null>(null);
  const [activeSprint, setActiveSprint] = useState<number | null>(null);
  const [activeSprintTab, setActiveSprintTab] = useState<"kanban" | "status">("kanban");
  const [quarterViewTabState, setQuarterViewTabState] = useState<QuarterSurfaceTab>("gantt");
  const quarterViewTab = quarterViewTabExternal ?? quarterViewTabState;
  const setQuarterViewTab = useCallback((tab: QuarterSurfaceTab) => {
    if (onQuarterViewTabChange) onQuarterViewTabChange(tab);
    else setQuarterViewTabState(tab);
  }, [onQuarterViewTabChange]);
  const [roadmapBarMode, setRoadmapBarMode] = useState<"epics" | "initiatives">("epics");
  const [capacityQuarterFilterLabel, setCapacityQuarterFilterLabel] = useState<"all" | "Q1" | "Q2" | "Q3" | "Q4">("all");
  const [capacityTeamFilterIds, setCapacityTeamFilterIds] = useState<string[]>([]);
  const [capacityTeamSearch, setCapacityTeamSearch] = useState("");
  const [capacityTeamMenuOpen, setCapacityTeamMenuOpen] = useState(false);
  const [capacityLoadBasis, setCapacityLoadBasis] = useState<CapacityLoadBasis>("originalEstimate");
  const skipCapacityLoadBasisPersist = useRef(true);
  useEffect(() => {
    setCapacityLoadBasis(parseCapacityLoadBasis(window.localStorage.getItem(CAPACITY_LOAD_BASIS_STORAGE_KEY)));
  }, []);
  useEffect(() => {
    if (skipCapacityLoadBasisPersist.current) {
      skipCapacityLoadBasisPersist.current = false;
      return;
    }
    try {
      window.localStorage.setItem(CAPACITY_LOAD_BASIS_STORAGE_KEY, capacityLoadBasis);
    } catch {
      /* ignore quota / private mode */
    }
  }, [capacityLoadBasis]);
  const [showYearSprintChips, setShowYearSprintChips] = useState(false);
  /** When true, year or quarter roadmap Gantt uses fixed sprint column width (column threshold via ResizeObserver). */
  const [yearRoadmapHScroll, setYearRoadmapHScroll] = useState(false);
  /** When true, right panel is narrower than {@link RIGHT_PANEL_MIN_CONTENT_PX} — outer horizontal scroll for full chrome + body. */
  const [rightPanelHScroll, setRightPanelHScroll] = useState(false);
  /** Measures available width under the timeline card; drives right-panel + roadmap horizontal scroll. */
  const yearRoadmapMeasureRef = useRef<HTMLDivElement | null>(null);
  const [estEpicsPanelOpen, setEstEpicsPanelOpen] = useState(false);
  /** Drives slide-in/out (mirror of epic insights panel: translate + duration-300). */
  const [estEpicsPanelEntered, setEstEpicsPanelEntered] = useState(false);
  const skipEstEpicsPanelEnterRef = useRef(false);
  const estEpicsPanelCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [estEpicsPanelWidthPx, setEstEpicsPanelWidthPx] = useState(1080);
  const [estEpicsPanelPosition, setEstEpicsPanelPosition] = useState({ right: 0, top: 0 });
  const [expandedEstimateEpicIds, setExpandedEstimateEpicIds] = useState<Set<string>>(new Set());
  const [estimateCoveragePanelTab, setEstimateCoveragePanelTab] = useState<EstimateCoveragePanelTab>("unestimated");
  const prevEstPanelOpenRef = useRef(false);
  const prevEstScopeKeyRef = useRef<string | null>(null);
  const capacityTeamFilterRef = useRef<HTMLDivElement | null>(null);
  const [isSprintTeamMenuOpen, setIsSprintTeamMenuOpen] = useState(false);
  const [sprintTeamSearch, setSprintTeamSearch] = useState("");
  const sprintTeamSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [sprintFilterTeamIds, setSprintFilterTeamIds] = useState<string[]>(() => {
    const t = sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId);
    return t ? [t] : [];
  });
  const [insightsTeamIds, setInsightsTeamIds] = useState<string[]>([]);
  const [isInsightsTeamMenuOpen, setIsInsightsTeamMenuOpen] = useState(false);
  const [insightsTeamSearch, setInsightsTeamSearch] = useState("");
  const insightsTeamMenuRef = useRef<HTMLDivElement | null>(null);
  const insightsTeamSearchInputRef = useRef<HTMLInputElement | null>(null);
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
  const sprintTeamMenuRef = useRef<HTMLDivElement | null>(null);
  const timelineContentScrollRef = useRef<HTMLDivElement | null>(null);

  const focusedQuarter = useMemo(
    () => QUARTERS.find((quarter) => quarter.label === focusedQuarterLabel) ?? null,
    [focusedQuarterLabel],
  );
  const filteredCapacityQuarter = useMemo(
    () => QUARTERS.find((quarter) => quarter.label === capacityQuarterFilterLabel) ?? null,
    [capacityQuarterFilterLabel],
  );
  useEffect(() => {
    const allowed = new Set(capacityPlanTeamCatalogFromDirectory(workspaceDirectoryUsers).map((t) => t.id));
    setCapacityTeamFilterIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [workspaceDirectoryUsers]);

  useEffect(() => {
    function onDocMouseDown(event: MouseEvent) {
      if (!capacityTeamFilterRef.current) return;
      if (capacityTeamFilterRef.current.contains(event.target as Node)) return;
      setCapacityTeamMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);
  const beginEstimateCoverageResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = estEpicsPanelWidthPx;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      const nextWidth = startWidth - delta;
      const minWidth = Math.max(720, Math.round(window.innerWidth * 0.4));
      const maxWidth = Math.max(minWidth, window.innerWidth - 12);
      setEstEpicsPanelWidthPx(Math.max(minWidth, Math.min(maxWidth, nextWidth)));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [estEpicsPanelWidthPx]);
  const beginEstimateCoverageResizeRight = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = estEpicsPanelWidthPx;
    const startRight = estEpicsPanelPosition.right;
    const startLeft = window.innerWidth - startRight - startWidth;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      const nextWidth = startWidth + delta;
      const minWidth = Math.max(720, Math.round(window.innerWidth * 0.4));
      const maxWidth = Math.max(minWidth, window.innerWidth - startLeft);
      const boundedWidth = Math.max(minWidth, Math.min(maxWidth, nextWidth));
      const nextRight = Math.max(0, window.innerWidth - startLeft - boundedWidth);
      setEstEpicsPanelWidthPx(boundedWidth);
      setEstEpicsPanelPosition((prev) => ({ ...prev, right: nextRight }));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [estEpicsPanelPosition.right, estEpicsPanelWidthPx]);
  const beginEstimateCoverageDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRight = estEpicsPanelPosition.right;
    const startTop = estEpicsPanelPosition.top;

    function onPointerMove(moveEvent: PointerEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const maxRight = Math.max(0, window.innerWidth - estEpicsPanelWidthPx);
      const maxTop = Math.max(0, window.innerHeight - 180);
      setEstEpicsPanelPosition({
        right: Math.max(0, Math.min(maxRight, startRight - dx)),
        top: Math.max(0, Math.min(maxTop, startTop + dy)),
      });
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [estEpicsPanelPosition.right, estEpicsPanelPosition.top, estEpicsPanelWidthPx]);
  useEffect(() => {
    if (!estEpicsPanelOpen) return;
    const defaultWidth = Math.max(720, Math.min(window.innerWidth - 16, Math.round(window.innerWidth * 0.56)));
    setEstEpicsPanelWidthPx(defaultWidth);
    setEstEpicsPanelPosition({ right: 0, top: 0 });
  }, [estEpicsPanelOpen]);

  const closeEstEpicsPanel = useCallback(() => {
    skipEstEpicsPanelEnterRef.current = true;
    setEstEpicsPanelEntered(false);
    if (estEpicsPanelCloseTimerRef.current) clearTimeout(estEpicsPanelCloseTimerRef.current);
    estEpicsPanelCloseTimerRef.current = setTimeout(() => {
      estEpicsPanelCloseTimerRef.current = null;
      setEstEpicsPanelOpen(false);
      skipEstEpicsPanelEnterRef.current = false;
    }, 300);
  }, []);

  const openEstEpicsPanel = useCallback(() => {
    if (estEpicsPanelCloseTimerRef.current) {
      clearTimeout(estEpicsPanelCloseTimerRef.current);
      estEpicsPanelCloseTimerRef.current = null;
    }
    skipEstEpicsPanelEnterRef.current = false;
    if (estEpicsPanelOpen) {
      setEstEpicsPanelEntered(true);
      return;
    }
    setEstEpicsPanelOpen(true);
  }, [estEpicsPanelOpen]);

  useLayoutEffect(() => {
    if (!estEpicsPanelOpen) {
      setEstEpicsPanelEntered(false);
      return;
    }
    skipEstEpicsPanelEnterRef.current = false;
    setEstEpicsPanelEntered(false);
    let alive = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (alive && !skipEstEpicsPanelEnterRef.current) setEstEpicsPanelEntered(true);
      });
    });
    return () => {
      alive = false;
    };
  }, [estEpicsPanelOpen]);

  useEffect(() => {
    return () => {
      if (estEpicsPanelCloseTimerRef.current) clearTimeout(estEpicsPanelCloseTimerRef.current);
    };
  }, []);

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
  const isFullYearGanttLayout =
    activeMonth == null && focusedQuarter == null && quarterViewTab === "gantt";
  const isQuarterGanttLayout =
    activeMonth == null && focusedQuarter != null && quarterViewTab === "gantt";
  const portfolioRoadmapGanttHScrollMeasure = isFullYearGanttLayout || isQuarterGanttLayout;
  const scopedEpicsForEstimatePanel = useMemo(() => {
    let scopedRows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    if (activeMonth) {
      scopedRows = initiatives
        .filter((initiative) => {
          if (initiative.status !== "scheduled") return false;
          if (initiative.startMonth == null || initiative.endMonth == null) return false;
          return initiative.startMonth <= activeMonth && initiative.endMonth >= activeMonth;
        })
        .flatMap((initiative) => (initiative.epics ?? []).map((epic) => ({ epic, initiative })));
    } else if (focusedQuarter) {
      const qStart = focusedQuarter.months[0];
      const qEnd = focusedQuarter.months[focusedQuarter.months.length - 1];
      scopedRows = initiatives
        .filter((initiative) => {
          if (initiative.status !== "scheduled") return false;
          if (initiative.startMonth == null || initiative.endMonth == null) return false;
          return initiative.startMonth <= qEnd && initiative.endMonth >= qStart;
        })
        .flatMap((initiative) => (initiative.epics ?? []).map((epic) => ({ epic, initiative })));
    } else {
      scopedRows = initiatives.flatMap((initiative) => (initiative.epics ?? []).map((epic) => ({ epic, initiative })));
    }
    const estimated = scopedRows.filter((row) => Number(row.epic.originalEstimateDays ?? 0) > 0);
    const unestimated = scopedRows.filter((row) => Number(row.epic.originalEstimateDays ?? 0) <= 0);
    return { all: scopedRows, estimated, unestimated };
  }, [activeMonth, focusedQuarter, initiatives]);
  const scopedEpicsWithoutDescription = useMemo(
    () => scopedEpicsForEstimatePanel.all.filter((row) => !String(row.epic.description ?? "").trim()),
    [scopedEpicsForEstimatePanel.all],
  );
  const scopedStoriesWithoutDescription = useMemo(() => {
    const rows: Array<{ story: UserStoryItem; epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const row of scopedEpicsForEstimatePanel.all) {
      for (const story of row.epic.userStories ?? []) {
        if (!String(story.description ?? "").trim()) {
          rows.push({ story, epic: row.epic, initiative: row.initiative });
        }
      }
    }
    return rows;
  }, [scopedEpicsForEstimatePanel.all]);
  const estimatedEpicsPercentForScope = useMemo(() => {
    if (scopedEpicsForEstimatePanel.all.length === 0) return 0;
    return Math.round((scopedEpicsForEstimatePanel.estimated.length / scopedEpicsForEstimatePanel.all.length) * 100);
  }, [scopedEpicsForEstimatePanel]);
  const estimatedEpicsPercentClamped = Math.max(0, Math.min(100, estimatedEpicsPercentForScope));
  const summaryChipBaseClass =
    "inline-flex h-7 max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-semibold leading-none tracking-wide ring-1 transition sm:gap-1.5 sm:px-2.5 sm:text-[12px] lg:px-3";
  const summaryChipInitiativesIdleClass = `${summaryChipBaseClass} border-0 bg-violet-100 text-violet-800 ring-violet-300/80 hover:bg-violet-200/80 hover:text-violet-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40`;
  const summaryChipInitiativesOnClass = `${summaryChipBaseClass} border-0 bg-violet-200 text-violet-900 ring-violet-400/70 shadow-sm hover:bg-violet-300/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50`;
  const summaryChipEpicsIdleClass = `${summaryChipBaseClass} border-0 bg-orange-100 text-orange-800 ring-orange-300/80 hover:bg-orange-200/80 hover:text-orange-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/40`;
  const summaryChipEpicsOnClass = `${summaryChipBaseClass} border-0 bg-orange-200 text-orange-900 ring-orange-400/70 shadow-sm hover:bg-orange-300/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50`;
  const summaryChipSprintsIdleClass = `${summaryChipBaseClass} border-0 bg-indigo-100 text-indigo-800 ring-indigo-300/80 hover:bg-indigo-200/80 hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/40`;
  const summaryChipSprintsOnClass = `${summaryChipBaseClass} border-0 bg-indigo-200 text-indigo-900 ring-indigo-400/70 shadow-sm hover:bg-indigo-300/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50`;
  const summaryChipProgressIdleClass = `${summaryChipBaseClass} border-0 bg-green-100 text-green-800 ring-green-300/80 hover:bg-green-200/80 hover:text-green-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400/40`;
  const summaryChipProgressOnClass = `${summaryChipBaseClass} border-0 bg-green-200 text-green-900 ring-green-400/70 shadow-sm hover:bg-green-300/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400/50`;
  const summaryChipEstimatedClass = `${summaryChipBaseClass} border-0 bg-sky-100 text-sky-800 ring-sky-300/80 hover:bg-sky-200/80 hover:text-sky-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40`;
  const summaryChipStoriesClass = `${summaryChipBaseClass} border-0 bg-blue-100 text-blue-800 ring-blue-300/80 hover:bg-blue-200/80 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40`;
  const summaryChipStoriesStaticClass = summaryChipStoriesClass;
  const summaryChipUnscheduledClass = `${summaryChipBaseClass} border-0 bg-orange-100 text-orange-800 ring-orange-300/80`;
  const summaryChipProgressCircleClass = "size-3 shrink-0 sm:size-3.5";

  const estimatePanelScopeLabel = activeMonth
    ? `${MONTHS[activeMonth - 1]}`
    : focusedQuarter
      ? focusedQuarter.label
      : "All Quarters";

  useEffect(() => {
    const justOpened = estEpicsPanelOpen && !prevEstPanelOpenRef.current;
    const scopeChangedWhileOpen =
      estEpicsPanelOpen && estimatePanelScopeLabel !== prevEstScopeKeyRef.current;
    if (justOpened || scopeChangedWhileOpen) {
      setExpandedEstimateEpicIds(new Set());
    }
    prevEstPanelOpenRef.current = estEpicsPanelOpen;
    prevEstScopeKeyRef.current = estimatePanelScopeLabel;
  }, [estEpicsPanelOpen, estimatePanelScopeLabel, scopedEpicsForEstimatePanel.all]);

  const estimatePanelTableClass =
    "w-full table-fixed border-collapse text-[15px] text-slate-700";
  const estimatePanelHeadCellClass =
    "px-3 py-2.5 text-left text-[13px] font-semibold uppercase tracking-wide text-slate-600";
  const estimatePanelBodyRowClass =
    "group transition hover:bg-[#c5ebff]";
  const estimatePanelCellClass = "px-3 py-3";
  const toggleEstimateEpicExpanded = (epicId: string) =>
    setExpandedEstimateEpicIds((prev) => {
      const next = new Set(prev);
      if (next.has(epicId)) next.delete(epicId);
      else next.add(epicId);
      return next;
    });

  const collapseEstimatePanelRows = useCallback(
    (variant: "estimated" | "unestimated") => {
      const ids =
        variant === "unestimated"
          ? scopedEpicsForEstimatePanel.unestimated.map((r) => r.epic.id)
          : scopedEpicsForEstimatePanel.estimated.map((r) => r.epic.id);
      setExpandedEstimateEpicIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    },
    [scopedEpicsForEstimatePanel.estimated, scopedEpicsForEstimatePanel.unestimated],
  );

  const expandEstimatePanelRows = useCallback(
    (variant: "estimated" | "unestimated") => {
      const ids =
        variant === "unestimated"
          ? scopedEpicsForEstimatePanel.unestimated.map((r) => r.epic.id)
          : scopedEpicsForEstimatePanel.estimated.map((r) => r.epic.id);
      setExpandedEstimateEpicIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
    },
    [scopedEpicsForEstimatePanel.estimated, scopedEpicsForEstimatePanel.unestimated],
  );

  function renderEstimatePanelTable(
    rows: Array<{ epic: EpicItem; initiative: InitiativeItem }>,
    variant: "estimated" | "unestimated",
  ) {
    const showEstimatedColumns = variant === "estimated";
    const displayRows = rows;
    const emptyRowCount = Math.max(0, 6 - displayRows.length);
    const colCount = showEstimatedColumns ? 8 : 6;
    return (
      <table className={estimatePanelTableClass}>
        <thead>
          <tr>
            <th className={cn(estimatePanelHeadCellClass, "w-[20%] min-w-0")}>Epic</th>
            <th className={cn(estimatePanelHeadCellClass, "w-[16%] min-w-0")}>Initiative</th>
            <th className={cn(estimatePanelHeadCellClass, "w-[9%]")}>Sprint</th>
            <th className={cn(estimatePanelHeadCellClass, "w-[9%]")}>Team</th>
            <th className={cn(estimatePanelHeadCellClass, "w-[10%]")}>Assignee</th>
            <th className={cn(estimatePanelHeadCellClass, "w-[5.5rem] text-center")}>
              {showEstimatedColumns ? "Est days" : "Target Est"}
            </th>
            {showEstimatedColumns ? (
              <>
                <th className={cn(estimatePanelHeadCellClass, "w-[5.5rem] text-center")}>Σ Child Est</th>
                <th className={cn(estimatePanelHeadCellClass, "w-[6.5rem] text-center")}>Est Mix</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, rowIndex) => {
            const isExpanded = expandedEstimateEpicIds.has(row.epic.id);
            const stories = row.epic.userStories ?? [];
            const estimatedStories = stories.filter((story) => Number(story.estimatedDays ?? 0) > 0).length;
            const storyEstimatedPct = stories.length > 0 ? (estimatedStories / stories.length) * 100 : 0;
            const storyUnestimatedPct = Math.max(0, 100 - storyEstimatedPct);
            const childEstimateSum = stories.reduce((sum, story) => sum + Math.max(0, Number(story.estimatedDays ?? 0)), 0);

            return (
              <Fragment key={row.epic.id}>
                <tr
                  className={cn(
                    estimatePanelBodyRowClass,
                    rowIndex % 2 === 0 ? "bg-[#d8f2ff]" : "bg-white",
                  )}
                >
                  <td className={estimatePanelCellClass}>
                    <div className="inline-flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleEstimateEpicExpanded(row.epic.id)}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                        aria-label={isExpanded ? "Collapse user stories" : "Expand user stories"}
                      >
                        {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          closeEstEpicsPanel();
                          onOpenEpic(row.epic.id);
                        }}
                        className="inline-flex min-w-0 max-w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[13px] font-semibold text-slate-900 hover:bg-white/70 hover:text-blue-700"
                      >
                        <span className="truncate">{row.epic.title}</span>
                      </button>
                    </div>
                  </td>
                  <td className={cn(estimatePanelCellClass, "text-slate-600")}>
                    <button
                      type="button"
                      onClick={() => {
                        closeEstEpicsPanel();
                        onOpenInitiative(row.initiative.id);
                      }}
                      className="inline-flex max-w-full min-w-0 items-center rounded px-1 py-0.5 text-left text-[13px] font-medium text-slate-700 hover:bg-white/70 hover:text-blue-700"
                    >
                      <span className="truncate">{row.initiative.title}</span>
                    </button>
                  </td>
                  <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-700")}>
                    {estimatePanelEpicSprintLabel(row.epic)}
                  </td>
                  <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-700")}>
                    {estimatePanelTeamLabel(row.epic.team)}
                  </td>
                  <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-700")}>
                    {estimatePanelAssigneeLabel(row.epic.assignee)}
                  </td>
                  <td className={cn(estimatePanelCellClass, "text-center text-[14px] font-semibold tabular-nums text-slate-700")}>
                    {Math.max(0, Number(row.epic.originalEstimateDays ?? 0))}d
                  </td>
                  {showEstimatedColumns ? (
                    <>
                      <td className={cn(estimatePanelCellClass, "text-center text-[14px] font-semibold tabular-nums text-slate-700")}>
                        {childEstimateSum}d
                      </td>
                      <td className={cn(estimatePanelCellClass, "text-center")}>
                        <div className="inline-flex items-center gap-1.5">
                          <svg viewBox="0 0 24 24" className="size-6" aria-label="Estimated vs unestimated stories">
                            <circle cx="12" cy="12" r="10" fill="#e2e8f0" />
                            <path
                              d={`M 12 12 L 12 2 A 10 10 0 ${storyEstimatedPct > 50 ? 1 : 0} 1 ${12 + 10 * Math.sin((2 * Math.PI * storyEstimatedPct) / 100)} ${12 - 10 * Math.cos((2 * Math.PI * storyEstimatedPct) / 100)} Z`}
                              fill="#22c55e"
                            />
                            <circle cx="12" cy="12" r="5.2" fill="#ffffff" />
                          </svg>
                          <span className="text-[13px] font-semibold tabular-nums text-slate-600">
                            {Math.round(storyEstimatedPct)}% / {Math.round(storyUnestimatedPct)}%
                          </span>
                        </div>
                      </td>
                    </>
                  ) : null}
                </tr>
                {isExpanded ? (
                  stories.length === 0 ? (
                    <tr className="bg-slate-50">
                      <td colSpan={colCount} className="py-2 pl-14 pr-3 text-[13px] text-slate-400">
                        No user stories yet.
                      </td>
                    </tr>
                  ) : (
                    stories.map((story, storyIdx) => {
                      const isLast = storyIdx === stories.length - 1;
                      return (
                        <tr
                          key={story.id}
                          className={cn(
                            storyIdx % 2 === 0 ? "bg-[#d8f2ff]/50 transition" : "bg-white transition",
                            onOpenStory ? "cursor-pointer hover:bg-blue-50" : "cursor-default",
                            storyIdx === 0 && "border-t border-slate-200",
                            isLast && "border-b-2 border-slate-200",
                          )}
                          onClick={() => {
                            if (!onOpenStory) return;
                            closeEstEpicsPanel();
                            onOpenStory(story.id);
                          }}
                        >
                          <td className={cn(estimatePanelCellClass, "relative pl-14")}>
                            {/* vertical tree line — stops at midpoint for last story */}
                            <span
                              className="absolute left-8 top-0 w-px bg-indigo-300"
                              style={{ height: isLast ? "50%" : "100%" }}
                            />
                            {/* horizontal branch */}
                            <span className="absolute left-8 top-1/2 h-px w-3.5 -translate-y-px bg-indigo-300" />
                            <span className="inline-flex min-w-0 items-center gap-1.5">
                              <UserStoryIcon className="size-3.5 shrink-0 text-slate-400" />
                              <span className="truncate text-[14px] font-medium text-slate-700">{story.title}</span>
                            </span>
                          </td>
                          <td className={cn(estimatePanelCellClass, "text-[13px] text-slate-400")}>—</td>
                          <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-600")}>
                            {estimatePanelStorySprintLabel(story)}
                          </td>
                          <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-600")}>
                            {estimatePanelTeamLabel(row.epic.team)}
                          </td>
                          <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-600")}>
                            {estimatePanelAssigneeLabel(story.assignee)}
                          </td>
                          <td className={cn(estimatePanelCellClass, "text-center text-[13px] font-semibold tabular-nums text-slate-700")}>
                            {Math.max(0, Number(story.estimatedDays ?? 0))}d
                          </td>
                          {showEstimatedColumns ? (
                            <>
                              <td className={cn(estimatePanelCellClass, "text-center text-[13px] text-slate-400")}>—</td>
                              <td className={cn(estimatePanelCellClass, "text-center text-[13px] text-slate-400")}>—</td>
                            </>
                          ) : null}
                        </tr>
                      );
                    })
                  )
                ) : null}
              </Fragment>
            );
          })}
          {Array.from({ length: emptyRowCount }, (_, idx) => (
            <tr
              key={`empty-${variant}-${idx}`}
              className={cn(
                (displayRows.length + idx) % 2 === 0 ? "bg-[#d8f2ff]/70" : "bg-white/80",
              )}
            >
              <td className={cn(estimatePanelCellClass, "text-slate-300")}>-</td>
              <td className={cn(estimatePanelCellClass, "text-slate-300")}>-</td>
              <td className={cn(estimatePanelCellClass, "text-slate-300")}>-</td>
              <td className={cn(estimatePanelCellClass, "text-slate-300")}>-</td>
              <td className={cn(estimatePanelCellClass, "text-slate-300")}>-</td>
              <td className={cn(estimatePanelCellClass, "text-center text-slate-300")}>-</td>
              {showEstimatedColumns ? (
                <>
                  <td className={cn(estimatePanelCellClass, "text-center text-slate-300")}>-</td>
                  <td className={cn(estimatePanelCellClass, "text-center text-slate-300")}>-</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderEpicsWithoutDescriptionTable(rows: Array<{ epic: EpicItem; initiative: InitiativeItem }>) {
    const colCount = 5;
    return (
      <table className={estimatePanelTableClass}>
        <thead>
          <tr>
            <th className={cn(estimatePanelHeadCellClass, "w-[28%] min-w-0")}>Epic</th>
            <th className={cn(estimatePanelHeadCellClass, "w-[12%]")}>Sprint</th>
            <th className={cn(estimatePanelHeadCellClass, "w-[11%]")}>Team</th>
            <th className={cn(estimatePanelHeadCellClass, "w-[12%]")}>Assignee</th>
            <th className={cn(estimatePanelHeadCellClass, "min-w-0")}>Parent initiative</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-500")} colSpan={colCount}>
                All epics in this scope have a description.
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => {
              const isExpanded = expandedEstimateEpicIds.has(row.epic.id);
              const stories = row.epic.userStories ?? [];
              return (
                <Fragment key={row.epic.id}>
                  <tr
                    className={cn(
                      estimatePanelBodyRowClass,
                      rowIndex % 2 === 0 ? "bg-[#d8f2ff]" : "bg-white",
                    )}
                  >
                    <td className={estimatePanelCellClass}>
                      <div className="inline-flex min-w-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleEstimateEpicExpanded(row.epic.id)}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                          aria-label={isExpanded ? "Collapse user stories" : "Expand user stories"}
                        >
                          {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => { closeEstEpicsPanel(); onOpenEpic(row.epic.id); }}
                          className="inline-flex min-w-0 max-w-full rounded px-1 py-0.5 text-left text-[14px] font-semibold text-slate-900 hover:bg-white/70 hover:text-blue-700"
                        >
                          <span className="truncate">{row.epic.title}</span>
                        </button>
                      </div>
                    </td>
                    <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-700")}>
                      {estimatePanelEpicSprintLabel(row.epic)}
                    </td>
                    <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-700")}>
                      {estimatePanelTeamLabel(row.epic.team)}
                    </td>
                    <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-700")}>
                      {estimatePanelAssigneeLabel(row.epic.assignee)}
                    </td>
                    <td className={cn(estimatePanelCellClass, "text-slate-600")}>
                      <button
                        type="button"
                        onClick={() => { closeEstEpicsPanel(); onOpenInitiative(row.initiative.id); }}
                        className="inline-flex max-w-full min-w-0 rounded px-1 py-0.5 text-left text-[14px] font-medium text-slate-700 hover:bg-white/70 hover:text-blue-700"
                      >
                        <span className="truncate">{row.initiative.title}</span>
                      </button>
                    </td>
                  </tr>
                  {isExpanded ? (
                    stories.length === 0 ? (
                      <tr className="bg-slate-50">
                        <td colSpan={colCount} className="py-2 pl-14 pr-3 text-[13px] text-slate-400">
                          No user stories yet.
                        </td>
                      </tr>
                    ) : (
                      stories.map((story, storyIdx) => {
                        const isLast = storyIdx === stories.length - 1;
                        return (
                          <tr
                            key={story.id}
                            className={cn(
                              storyIdx % 2 === 0 ? "bg-[#d8f2ff]/50 transition" : "bg-white transition",
                              onOpenStory ? "cursor-pointer hover:bg-blue-50" : "cursor-default",
                              storyIdx === 0 && "border-t border-slate-200",
                              isLast && "border-b-2 border-slate-200",
                            )}
                            onClick={() => { if (!onOpenStory) return; closeEstEpicsPanel(); onOpenStory(story.id); }}
                          >
                            <td className={cn(estimatePanelCellClass, "relative pl-14")}>
                              <span className="absolute left-8 top-0 w-px bg-indigo-300" style={{ height: isLast ? "50%" : "100%" }} />
                              <span className="absolute left-8 top-1/2 h-px w-3.5 -translate-y-px bg-indigo-300" />
                              <span className="inline-flex min-w-0 items-center gap-1.5">
                                <UserStoryIcon className="size-3.5 shrink-0 text-slate-400" />
                                <span className="truncate text-[14px] font-medium text-slate-700">{story.title}</span>
                              </span>
                            </td>
                            <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-600")}>
                              {estimatePanelStorySprintLabel(story)}
                            </td>
                            <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-600")}>
                              {estimatePanelTeamLabel(row.epic.team)}
                            </td>
                            <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-600")}>
                              {estimatePanelAssigneeLabel(story.assignee)}
                            </td>
                            <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-400")}>—</td>
                          </tr>
                        );
                      })
                    )
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    );
  }

  function renderStoriesWithoutDescriptionTable(
    rows: Array<{ story: UserStoryItem; epic: EpicItem; initiative: InitiativeItem }>,
  ) {
    const narrowHead = cn(estimatePanelHeadCellClass, "text-[10px]");
    return (
      <table className={estimatePanelTableClass}>
        <thead>
          <tr>
            <th className={cn(narrowHead, "w-[28%] min-w-0")}>User story</th>
            <th className={cn(narrowHead, "w-[12%]")}>Sprint</th>
            <th className={cn(narrowHead, "w-[11%]")}>Team</th>
            <th className={cn(narrowHead, "w-[12%]")}>Assignee</th>
            <th className={cn(narrowHead, "min-w-0")}>Parent epic</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className={cn(estimatePanelCellClass, "text-[12px] text-slate-500")} colSpan={5}>
                No user stories without a description in this scope.
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr
                key={row.story.id}
                className={cn(
                  estimatePanelBodyRowClass,
                  rowIndex % 2 === 0 ? "bg-[#d8f2ff]" : "bg-white",
                )}
              >
                <td className={estimatePanelCellClass}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!onOpenStory) return;
                      closeEstEpicsPanel();
                      onOpenStory(row.story.id);
                    }}
                    disabled={!onOpenStory}
                    className={cn(
                      "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[13px] font-semibold text-slate-900 hover:bg-white/70 hover:text-blue-700",
                      !onOpenStory && "cursor-default opacity-60 hover:bg-transparent hover:text-slate-900",
                    )}
                  >
                    <UserStoryIcon className="size-3.5 shrink-0 text-slate-500" />
                    <span className="truncate">{row.story.title}</span>
                  </button>
                </td>
                <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-700")}>
                  {estimatePanelStorySprintLabel(row.story)}
                </td>
                <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-700")}>
                  {estimatePanelTeamLabel(row.epic.team)}
                </td>
                <td className={cn(estimatePanelCellClass, "text-[14px] text-slate-700")}>
                  {estimatePanelAssigneeLabel(row.story.assignee)}
                </td>
                <td className={cn(estimatePanelCellClass, "text-slate-600")}>
                  <button
                    type="button"
                    onClick={() => {
                      closeEstEpicsPanel();
                      onOpenEpic(row.epic.id);
                    }}
                    className="inline-flex max-w-full min-w-0 rounded px-1 py-0.5 text-left text-[13px] font-medium text-slate-700 hover:bg-white/70 hover:text-blue-700"
                  >
                    <span className="truncate">{row.epic.title}</span>
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    );
  }

  /** Global sprint for the open sprint surface (parent-controlled and/or internal), even when quarter strip hides `activeMonth`. */
  const resolvedActiveYearSprint = useMemo(() => {
    const fromParent =
      activeSprintExternal !== undefined && activeSprintExternal != null
        ? clampYearSprint(activeSprintExternal)
        : null;
    if (fromParent != null) return fromParent;
    if (activeSprint != null) return clampYearSprint(activeSprint);
    if (activeMonth != null) return firstGlobalSprintForMonth(activeMonth);
    return null;
  }, [activeMonth, activeSprint, activeSprintExternal]);

  /**
   * Calendar month used to resolve legacy story.sprint 1|2 and initiative month overlap for sprint Kanban/capacity.
   * When the focused month is outside the visible quarter, `activeMonth` is null but the sprint still maps to a month.
   */
  const sprintBoardContextMonth = useMemo(() => {
    if (activeMonth != null) return activeMonth;
    if (resolvedActiveYearSprint == null) return null;
    return monthLaneFromGlobalSprint(resolvedActiveYearSprint).month;
  }, [activeMonth, resolvedActiveYearSprint]);

  const activeYearSprintForMonthDrill = resolvedActiveYearSprint;

  const sprintKanbanSummaryStats = useMemo(() => {
    if (monthPlanTab !== "sprint-kanban" || resolvedActiveYearSprint == null) return null;
    const m = sprintBoardContextMonth;
    if (m == null) return null;
    return computeSprintKanbanSummaryStats(initiatives, m, resolvedActiveYearSprint, sprintFilterTeamIds.length ? sprintFilterTeamIds : null);
  }, [monthPlanTab, initiatives, resolvedActiveYearSprint, sprintBoardContextMonth, sprintFilterTeamIds]);

  const showSprintEndCountdown =
    activeMonth != null &&
    (monthPlanTab === "sprint-kanban" ||
      monthPlanTab === "sprint-status" ||
      monthPlanTab === "sprint-capacity" ||
      monthPlanTab === "sprint-retrospective");

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
  /** Two sprint columns for month epic/initiative lanes (matches the pair of sprint headers). */
  const epicMonthGridStyle = useMemo((): CSSProperties => ({ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }), []);

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
    Q1: "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100",
    Q2: "border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100",
    Q3: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    Q4: "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100",
  };
  const quarterPanelTone: Record<string, string> = {
    Q1: "bg-blue-50/45 ring-blue-100",
    Q2: "bg-cyan-50/45 ring-cyan-100",
    Q3: "bg-emerald-50/45 ring-emerald-100",
    Q4: "bg-violet-50/45 ring-violet-100",
  };
  /** Initiative rows + quarter headers: 2 sprint columns per month; full-year = 24 sprints. */
  const ganttLaneColumnCount = focusedQuarter ? visibleMonths.length * 2 : 24;
  const portfolioRoadmapHScrollContentMinWidthPx = useMemo(
    () => yearRoadmapGanttMinWidthPx(ganttLaneColumnCount, getRoadmapHScrollMinSprintPx(ganttLaneColumnCount)),
    [ganttLaneColumnCount],
  );
  const ganttLaneGridStyle: CSSProperties = useMemo(() => {
    if (!yearRoadmapHScroll) {
      return { gridTemplateColumns: `repeat(${ganttLaneColumnCount}, minmax(0, 1fr))` };
    }
    const sp = getRoadmapHScrollMinSprintPx(ganttLaneColumnCount);
    return {
      gridTemplateColumns: `repeat(${ganttLaneColumnCount}, minmax(${sp}px, ${sp}px))`,
    };
  }, [ganttLaneColumnCount, yearRoadmapHScroll]);

  /** Quarter title row uses 12 month-width columns (each quarter spans 3). */
  const yearQuarterHeaderGridStyle: CSSProperties = useMemo(() => {
    if (!yearRoadmapHScroll) {
      return { gridTemplateColumns: `repeat(12, minmax(0, 1fr))` };
    }
    const sp = getRoadmapHScrollMinSprintPx(ganttLaneColumnCount);
    const monthPx = 2 * sp + YEAR_ROADMAP_GANTT_GAP_PX;
    return { gridTemplateColumns: `repeat(12, minmax(${monthPx}px, ${monthPx}px))` };
  }, [yearRoadmapHScroll, ganttLaneColumnCount]);

  /**
   * Full-year month tiles must share the same per-month width and 8px gutters as {@link yearQuarterHeaderGridStyle}
   * and the sprint lanes; the old `grid-cols-4` + `gap-1.5` layout drifted (especially after horizontal scroll).
   */
  const yearFullYearMonthStripGridStyle: CSSProperties | undefined = useMemo(() => {
    if (!yearRoadmapHScroll) return undefined;
    const sp = getRoadmapHScrollMinSprintPx(ganttLaneColumnCount);
    const monthPx = 2 * sp + YEAR_ROADMAP_GANTT_GAP_PX;
    const quarterBandPx = 3 * monthPx + 2 * YEAR_ROADMAP_GANTT_GAP_PX;
    return { gridTemplateColumns: `repeat(4, ${quarterBandPx}px)` };
  }, [yearRoadmapHScroll, ganttLaneColumnCount]);

  const yearFullYearMonthInnerGridStyle: CSSProperties | undefined = useMemo(() => {
    if (!yearRoadmapHScroll) return undefined;
    const sp = getRoadmapHScrollMinSprintPx(ganttLaneColumnCount);
    const monthPx = 2 * sp + YEAR_ROADMAP_GANTT_GAP_PX;
    return { gridTemplateColumns: `repeat(3, minmax(${monthPx}px, ${monthPx}px))` };
  }, [yearRoadmapHScroll, ganttLaneColumnCount]);

  useLayoutEffect(() => {
    const el = yearRoadmapMeasureRef.current;
    if (!el) return;
    const hyst = YEAR_ROADMAP_H_SCROLL_HYSTERESIS_PX;
    const apply = () => {
      const raw = el.clientWidth;
      const nextFromThreshold = (prev: boolean) => {
        if (raw <= 0) return false;
        if (!prev && raw < RIGHT_PANEL_MIN_CONTENT_PX) return true;
        if (prev && raw >= RIGHT_PANEL_MIN_CONTENT_PX + hyst) return false;
        return prev;
      };
      setRightPanelHScroll(nextFromThreshold);
      if (!portfolioRoadmapGanttHScrollMeasure) {
        setYearRoadmapHScroll(false);
        return;
      }
      setYearRoadmapHScroll(nextFromThreshold);
    };
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => ro.disconnect();
  }, [portfolioRoadmapGanttHScrollMeasure]);

  /** Today line over initiative lanes (sprint resolution). */
  const roadmapLaneTodayLeft = useMemo(() => {
    if (activeMonth != null) return null;
    if (focusedQuarter && quarterViewTab !== "gantt") return null;
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
    const isInsightsSurface =
      (activeMonth != null && (monthPlanTab === "month-status" || monthPlanTab === "sprint-status")) ||
      (activeMonth == null && quarterViewTab === "insights");
    if (!isInsightsSurface) return;
    const resetScrollToTop = () => {
      timelineContentScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "auto" });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    };
    resetScrollToTop();
    const raf = requestAnimationFrame(resetScrollToTop);
    return () => cancelAnimationFrame(raf);
  }, [activeMonth, monthPlanTab, quarterViewTab, focusedQuarterLabel]);

  useEffect(() => {
    /**
     * Keep parent URL/state aligned with grid `activeMonth` even when month + sprint are controlled
     * (`focusedMonthExternal` / `activeSprintExternal` are always passed from EpicPlannerApp).
     * Without syncing here, the user can enter month view locally while `activeTimelineMonth` stays null
     * and the middle panel remains on Initiatives.
     */
    if (activeMonth == null) {
      /**
       * Parent can set `focusedMonthExternal` to a month outside the visible quarter before the quarter
       * focus updates in the same tick. Tearing down sprint mode here caused onSprintModeChange(false) ↔
       * parent navigation loops (max update depth).
       */
      if (focusedMonthExternal != null) return;
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
  }, [activeMonth, activeSprint, activeSprintExternal, focusedMonthExternal, onSprintModeChange]);

  const breadcrumbItems: Array<{
    label: string;
    onClick: (() => void) | null;
    /** Softer pill for sprint views (avoids heavy black current-page chip). */
    currentTone?: "default" | "sprint";
  }> = [];

  const yearCrumbOnClick = () => {
    setQuarterViewTab("gantt");
    setActiveSprint(null);
    setFocusedMonth(null);
    onFocusedQuarterChange(null);
    onYearRoadmapNavigate?.();
  };

  if (activeMonth) {
    const quarterForMonth = QUARTERS.find((q) => q.months.some((m) => m === activeMonth)) ?? null;
    breadcrumbItems.push({
      label: String(currentYear),
      onClick: yearCrumbOnClick,
    });
    if (quarterForMonth) {
      breadcrumbItems.push({
        label: quarterForMonth.label,
        onClick: () => {
          setQuarterViewTab("gantt");
          setActiveSprint(null);
          setFocusedMonth(null);
          if (onQuarterGanttFromMonthBreadcrumb) {
            onQuarterGanttFromMonthBreadcrumb(quarterForMonth.label);
          } else {
            onFocusedQuarterChange(quarterForMonth.label);
          }
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
      label: String(currentYear),
      onClick: yearCrumbOnClick,
    });
    breadcrumbItems.push({
      label: focusedQuarter.label,
      onClick: () => {
        setQuarterViewTab("gantt");
        onFocusedQuarterChange(focusedQuarter.label);
      },
    });
    if (quarterViewTab === "insights") {
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
  } else {
    breadcrumbItems.push({
      label: String(currentYear),
      onClick: yearCrumbOnClick,
    });
    if (quarterViewTab === "insights") {
      breadcrumbItems.push({
        label: "Portfolio Insights",
        onClick: null,
      });
    } else if (quarterViewTab === "capacity") {
      breadcrumbItems.push({
        label: "Portfolio Capacity",
        onClick: null,
      });
    } else {
      breadcrumbItems.push({
        label: "Portfolio Gantt",
        onClick: null,
      });
    }
  }

  const hasBreadcrumbs = breadcrumbItems.length > 0;
  const hasContextSideMenu = activeMonth != null || focusedQuarter != null || (!activeMonth && !focusedQuarter);
  const isInsightsSurfaceRender =
    (activeMonth != null && (monthPlanTab === "month-status" || monthPlanTab === "sprint-status")) ||
    (activeMonth == null && quarterViewTab === "insights");
  const surfaceTransitionKey = useMemo(
    () =>
      [
        activeMonth ?? "year",
        focusedQuarterLabel ?? "all",
        quarterViewTab,
        monthPlanTab,
        activeSprint ?? "none",
        activeSprintTab,
      ].join(":"),
    [activeMonth, focusedQuarterLabel, quarterViewTab, monthPlanTab, activeSprint, activeSprintTab],
  );
  const railLabelBaseClass =
    "pointer-events-none overflow-hidden whitespace-nowrap text-[14px] font-semibold tracking-[0.01em] transition-all duration-150";
  /** Month / quarter plan rail only (between center and right panel). Flat indigo — not shared with roadmap summary chips. */
  const planRailTabActiveClass = "bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 ring-1 ring-indigo-200/80";

  const runSurfaceTransition = useCallback(() => {
    const el = timelineContentScrollRef.current;
    if (!el) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { opacity: 0.0, transform: "translateX(22px)" },
        { opacity: 1.0, transform: "translateX(0px)" },
      ],
      { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, []);

  useEffect(() => {
    runSurfaceTransition();
  }, [runSurfaceTransition, surfaceTransitionKey]);

  useEffect(() => {
    console.log("[rail-nav] expanded state changed", {
      isRailExpanded,
      activeMonth,
      focusedQuarterLabel,
      quarterViewTab,
    });
  }, [isRailExpanded, activeMonth, focusedQuarterLabel, quarterViewTab]);

  useEffect(() => {
    if (!isInsightsSurfaceRender) return;
    setIsRailExpanded(false);
  }, [isInsightsSurfaceRender]);

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
      monthPlanTab === "sprint-retrospective" ||
      monthPlanTab === "month-status");
  const showInsightsTeamPicker = activeMonth == null && quarterViewTab === "insights";
  const selectedSprintTeamId = sprintStoryBoardTeamId ?? "all";
  const sprintTeamOptions = useMemo(() => {
    const customIds = new Map<string, string>();
    for (const u of workspaceDirectoryUsers) {
      const id = normalizeWorkspaceUserTeam(u.team);
      if (!id || MONTH_TEAM_IDS.includes(id)) continue;
      if (!customIds.has(id)) customIds.set(id, teamLabelForWorkspaceUser(id));
    }
    const customOpts = [...customIds.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }))
      .map(([value, label]) => ({
        value,
        label,
        icon: <span className="inline-block size-2.5 shrink-0 rounded-full bg-slate-400" aria-hidden />,
      }));
    const base = [
      {
        value: "all",
        label: "All Teams",
        icon: <Users className="size-3.5 text-slate-500" aria-hidden />,
      },
      ...MONTH_TEAM_COLUMNS.map((team) => ({
        value: team.id,
        label: team.label,
        icon: (
          <span
            className={cn(
              "inline-block size-2.5 rounded-full",
              team.id === "platform" && "bg-sky-500",
              team.id === "experience" && "bg-violet-500",
              team.id === "data" && "bg-amber-500",
              team.id === "mobile" && "bg-emerald-500",
              team.id === "growth" && "bg-rose-500",
            )}
            aria-hidden
          />
        ),
      })),
      ...customOpts,
    ];
    const st = sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId);
    if (st && !base.some((o) => o.value === st)) {
      base.push({
        value: st,
        label: teamLabelForWorkspaceUser(st),
        icon: <span className="inline-block size-2.5 shrink-0 rounded-full bg-slate-400" aria-hidden />,
      });
    }
    return base;
  }, [workspaceDirectoryUsers, sprintStoryBoardTeamId]);
  const selectedSprintTeamOption =
    sprintTeamOptions.find((option) => option.value === selectedSprintTeamId) ?? sprintTeamOptions[0];
  const sprintFilterTeamLabel = sprintFilterTeamIds.length === 0
    ? "All Teams"
    : sprintFilterTeamIds.map((id) => sprintTeamOptions.find((o) => o.value === id)?.label ?? id).join(", ");
  const insightsTeamLabel = insightsTeamIds.length === 0
    ? "All Teams"
    : insightsTeamIds.map((id) => sprintTeamOptions.find((o) => o.value === id)?.label ?? id).join(", ");
  const focusedQuarterDisplayName = useMemo(() => {
    if (!focusedQuarter) return "Quarter";
    const ordinals: Record<string, string> = { Q1: "1st Quarter", Q2: "2nd Quarter", Q3: "3rd Quarter", Q4: "4th Quarter" };
    return ordinals[focusedQuarter.label] ?? focusedQuarter.label;
  }, [focusedQuarter]);
  const monthInsightsLabel =
    activeMonth != null ? `${FULL_MONTHS[activeMonth - 1]}-Insights` : "Month-Insights";
  const quarterInsightsLabel = focusedQuarter ? `${focusedQuarterDisplayName} Insights` : "Quarter Insights";
  const quarterCapacityLabel = focusedQuarter ? `${focusedQuarterDisplayName} Capacity` : "Quarter Capacity";
  const quarterInsightsNode = focusedQuarter
    ? <>{QUARTER_ORDINAL_LABELS[focusedQuarter.label] ?? focusedQuarterDisplayName} Insights</>
    : <>Quarter Insights</>;
  const quarterCapacityNode = focusedQuarter
    ? <>{QUARTER_ORDINAL_LABELS[focusedQuarter.label] ?? focusedQuarterDisplayName} Capacity</>
    : <>Quarter Capacity</>;
  const sprintInsightsLabel = (() => {
    const sprintNumber = activeSprint ?? activeYearSprintForMonthDrill;
    return sprintNumber != null ? `Sprint ${sprintNumber} Insights` : "Sprint Insights";
  })();
  useEffect(() => {
    if (!isSprintTeamMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!sprintTeamMenuRef.current?.contains(event.target as Node)) {
        setIsSprintTeamMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsSprintTeamMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isSprintTeamMenuOpen]);

  useEffect(() => {
    if (!showSprintTeamPicker) setIsSprintTeamMenuOpen(false);
  }, [showSprintTeamPicker]);
  useEffect(() => {
    const t = sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId);
    setSprintFilterTeamIds(t ? [t] : []);
  }, [sprintStoryBoardTeamId]);
  useEffect(() => {
    if (isSprintTeamMenuOpen) {
      setSprintTeamSearch("");
      setTimeout(() => sprintTeamSearchInputRef.current?.focus(), 0);
    }
  }, [isSprintTeamMenuOpen]);
  useEffect(() => {
    if (!isInsightsTeamMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!insightsTeamMenuRef.current?.contains(event.target as Node)) setIsInsightsTeamMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsInsightsTeamMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isInsightsTeamMenuOpen]);
  useEffect(() => {
    if (isInsightsTeamMenuOpen) {
      setInsightsTeamSearch("");
      setTimeout(() => insightsTeamSearchInputRef.current?.focus(), 0);
    }
  }, [isInsightsTeamMenuOpen]);

  const fullYearRoadmapGanttTracks = (
        roadmapBarMode === "initiatives" && yearRoadmapInitiativeRows.length === 0 ? (
          focusedQuarter && quarterViewTab === "gantt" ? null : !focusedQuarter ? (
            <YearRoadmapEmptyStripedLane
              currentYear={currentYear}
              roadmapLaneTodayLeft={roadmapLaneTodayLeft}
              columnCount={ganttLaneColumnCount}
              variant="initiatives"
            />
          ) : (
            <p className="rounded-md bg-muted/40 p-3.5 text-[14px] leading-6 text-slate-600">
              No initiatives with planned epics to display on the roadmap.
            </p>
          )
        ) : yearRoadmapEpics.length === 0 && roadmapBarMode === "epics" ? (
          focusedQuarter && quarterViewTab === "gantt" ? null : !focusedQuarter ? (
            <YearRoadmapEmptyStripedLane
              currentYear={currentYear}
              roadmapLaneTodayLeft={roadmapLaneTodayLeft}
              columnCount={ganttLaneColumnCount}
              variant="epics"
            />
          ) : (
            <p className="bg-gradient-to-r from-slate-100 via-slate-50 to-white p-3.5 text-[14px] leading-6 text-slate-700">
              Create an initiative, then drag its epics onto the timeline. You can also stretch or shorten a scheduled bar
              by dragging its ends to match your start and due dates.
            </p>
          )
        ) : focusedQuarter && quarterViewTab === "gantt" ? null : roadmapBarMode === "initiatives" ? (
          <div
            className={cn(
              "relative isolate flex min-h-0 min-w-0 flex-1 flex-col rounded-xl bg-slate-50/35 pl-2 pr-1 pb-3 ring-1 ring-slate-100/80 sm:pl-2 sm:pr-1 sm:pb-4",
              !yearRoadmapHScroll && "overflow-x-hidden",
              roadmapLaneTodayLeft != null && "pt-5 sm:pt-6",
            )}
          >
            <YearRoadmapTodayLine leftPercent={roadmapLaneTodayLeft} />
            <div
              className={cn(
                "relative flex min-h-0 w-full flex-1 flex-col",
                !yearRoadmapHScroll && "overflow-x-hidden",
              )}
            >
              <div
                id={TIMELINE_GANTT_ROWS_CONTAINER_ID}
                className={cn(
                  "relative z-10 min-h-0 flex-1 space-y-1.5 overflow-y-auto [&::-webkit-scrollbar]:hidden",
                  !yearRoadmapHScroll && "overflow-x-hidden",
                )}
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
              {yearRoadmapInitiativeRows.map((group, idx) => (
                <div
                  key={`year-init-row-${group.timelineRow}`}
                  className={cn(
                    "relative min-w-0 z-10 py-0.5",
                    idx < yearRoadmapInitiativeRows.length - 1 && "border-b border-slate-200/50",
                  )}
                  data-gantt-lane-index={idx}
                  data-gantt-timeline-row={group.timelineRow}
                >
                  <GanttLaneSprintBackdrop columnCount={ganttLaneColumnCount} />
                  <div className="relative z-[1] grid min-w-0 gap-2" style={ganttLaneGridStyle}>
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
                            showProgress={showRoadmapProgress}
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
          </div>
        ) : (
          <div
            className={cn(
              "relative isolate flex min-h-0 min-w-0 flex-1 flex-col rounded-xl bg-slate-50/35 pl-2 pr-1 pb-3 ring-1 ring-slate-100/80 sm:pl-2 sm:pr-1 sm:pb-4",
              !yearRoadmapHScroll && "overflow-x-hidden",
              roadmapLaneTodayLeft != null && "pt-5 sm:pt-6",
            )}
          >
            <YearRoadmapTodayLine leftPercent={roadmapLaneTodayLeft} />
            <div
              className={cn(
                "relative flex min-h-0 w-full flex-1 flex-col",
                !yearRoadmapHScroll && "overflow-x-hidden",
              )}
            >
              <div
                id={TIMELINE_GANTT_ROWS_CONTAINER_ID}
                className={cn(
                  "relative z-10 min-h-0 flex-1 space-y-2 overflow-y-auto [&::-webkit-scrollbar]:hidden",
                  !yearRoadmapHScroll && "overflow-x-hidden",
                )}
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
              {yearRoadmapEpicRows.map((group, idx) => (
                <div
                  key={`year-epic-row-${group.timelineRow}`}
                  className={cn(
                    "relative min-w-0 z-10 py-0.5",
                    idx < yearRoadmapEpicRows.length - 1 && "border-b border-slate-200/50",
                  )}
                  data-gantt-lane-index={idx}
                  data-gantt-timeline-row={group.timelineRow}
                >
                  <GanttLaneSprintBackdrop columnCount={ganttLaneColumnCount} />
                  <div className="relative z-[1] grid min-w-0 gap-2" style={ganttLaneGridStyle}>
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
                      const isInitiativeEmphasis =
                        ganttEmphasis != null && ganttEmphasis.initiativeId === row.initiative.id;
                      const isEpicEmphasis = ganttEpicEmphasis != null && ganttEpicEmphasis.epicId === row.epic.id;
                      const isScheduledFilterEmphasis =
                        ganttScheduledFilterEmphasis != null && epicIsScheduledOnGantt(row.epic);
                      const emphasizeFlash =
                        isInitiativeEmphasis || isEpicEmphasis || isScheduledFilterEmphasis;
                      const emphasizeTick = isEpicEmphasis
                        ? ganttEpicEmphasis!.tick
                        : isInitiativeEmphasis
                          ? ganttEmphasis!.tick
                          : isScheduledFilterEmphasis
                            ? ganttScheduledFilterEmphasis!.tick
                            : 0;
                      const resizeEdgeClass =
                        "pointer-events-auto absolute inset-y-0.5 z-20 w-2.5 touch-none select-none rounded-md bg-white/0 transition-colors hover:bg-white/30 active:bg-white/40";
                      const yearInset = epicBarDayInsetPct(row.epic, row.startS, row.endS, span, currentYear);
                      return (
                        <div
                          key={`year-epic-${row.epic.id}`}
                          ref={(node) => {
                            if (node) barElsRef.current.set(row.epic.id, node);
                            else barElsRef.current.delete(row.epic.id);
                          }}
                          className={cn("relative min-w-0 rounded-lg pt-0.5 pb-1", rz ? "z-0 opacity-70" : "z-20")}
                          style={{ gridColumn: `${columnStart} / span ${span}`, gridRow: 1 }}
                        >
                          <div
                            className="relative"
                            style={{ marginLeft: yearInset?.left || undefined, marginRight: yearInset?.right || undefined }}
                          >
                            <EpicPlanTimelineBar
                              id={row.epic.id}
                              title={row.epic.title}
                              icon={row.epic.icon}
                              compact
                              color={row.epic.color?.trim() ? row.epic.color : row.initiative.color}
                              progressPercent={completionPercent}
                              progressLabel={stories.length > 0 ? `${finishedStories}/${stories.length} done or approved` : "No user stories"}
                              isResizing={Boolean(rz)}
                              emphasizeFlash={emphasizeFlash}
                              emphasizeTick={emphasizeTick}
                              showProgress={showRoadmapProgress}
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
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              </div>
            </div>
          </div>
        )
  );

  const ganttNeedsFixedColumns = portfolioRoadmapGanttHScrollMeasure && yearRoadmapHScroll;
  const panelHScroll = rightPanelHScroll || ganttNeedsFixedColumns;
  /** Avoid oversizing scroll vs grid: when the roadmap uses fixed sprint px, size scroll to the grid + rail inset. */
  const panelScrollMinWidthPx = panelHScroll
    ? ganttNeedsFixedColumns
      ? portfolioRoadmapHScrollContentMinWidthPx +
        (hasContextSideMenu ? ROADMAP_PORTFOLIO_CONTEXT_RAIL_INSET_PX : 0)
      : rightPanelHScroll
        ? RIGHT_PANEL_MIN_CONTENT_PX
        : undefined
    : undefined;

  /** Capacity boards stack many columns; keep native scrollbars on this surface (`.planning-surface-scroll` hides them). */
  const showCapacityPlanningScrollbar =
    (activeMonth != null && (monthPlanTab === "month-capacity" || monthPlanTab === "sprint-capacity")) ||
    (activeMonth == null && quarterViewTab === "capacity");

  /** Chips share the same sprint column grid as Gantt lanes so they shrink and scroll with the timeline. */
  const useRoadmapGanttChipTrack =
    !activeMonth && quarterViewTab === "gantt" && (isFullYearGanttLayout || isQuarterGanttLayout);

  const timelineHeaderRow = (
      <div
        className={cn(
          "relative z-30 mb-4 flex w-full min-w-0 shrink-0 items-center gap-2 overflow-visible rounded-lg border-0 bg-gradient-to-r from-slate-50 via-indigo-50/60 to-violet-50/50 py-2.5 shadow-none ring-0",
          useRoadmapGanttChipTrack && "min-w-0",
        )}
      >
        {hasBreadcrumbs ? (
          <div
            className={cn(
              "relative z-30 inline-flex shrink-0 items-center gap-1 rounded-lg border-0 bg-gradient-to-r from-slate-50 via-indigo-50/60 to-violet-50/50 py-0.5 pl-1.5 pr-1 shadow-none ring-0 outline-none",
              useRoadmapGanttChipTrack &&
                "pointer-events-auto absolute top-1/2 left-0 z-20 max-w-[min(55vw,20rem)] -translate-y-1/2 pr-1",
            )}
          >
            {breadcrumbItems.map((item, index) => (
              <div key={`${item.label}-${index}`} className="flex shrink-0 items-center gap-1">
                {item.onClick ? (
                  <button
                    type="button"
                    onClick={() => {
                      runSurfaceTransition();
                      item.onClick?.();
                    }}
                    className="cursor-pointer whitespace-nowrap px-1 py-0.5 text-[16px] font-semibold leading-snug tracking-[0.01em] text-slate-700 underline-offset-4 transition hover:text-slate-900 hover:underline"
                  >
                    {item.label}
                  </button>
                ) : (
                  <span
                    aria-current="page"
                    className={cn(
                      "whitespace-nowrap px-1 py-0.5 text-[16px] font-semibold leading-snug tracking-[0.01em]",
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
                <label className="inline-flex items-center gap-1 rounded-md border-0 bg-white/90 py-0.5 pl-1.5 pr-1 shadow-none">
                  <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Team</span>
                  <div className="relative z-40" ref={sprintTeamMenuRef}>
                    <button
                      type="button"
                      onClick={() => setIsSprintTeamMenuOpen((prev) => !prev)}
                      className="inline-flex h-6 min-w-[8.75rem] items-center justify-between gap-1.5 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-semibold text-slate-800 outline-none transition hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300/70"
                      aria-label="Filter sprint views by team"
                      aria-expanded={isSprintTeamMenuOpen}
                    >
                      <span className="truncate">{sprintFilterTeamLabel}</span>
                      <ChevronDown className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                    </button>
                    {isSprintTeamMenuOpen ? (
                      <div className="absolute left-0 top-[calc(100%+0.3rem)] z-[120] w-full min-w-[11rem] rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                        <div className="px-1 pb-1">
                          <input
                            ref={sprintTeamSearchInputRef}
                            type="text"
                            value={sprintTeamSearch}
                            onChange={(e) => setSprintTeamSearch(e.target.value)}
                            placeholder="Search teams…"
                            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300/70"
                          />
                        </div>
                        {sprintTeamOptions.filter((o) => o.label.toLowerCase().includes(sprintTeamSearch.toLowerCase())).map((option) => {
                          const isAll = option.value === "all";
                          const checked = isAll ? sprintFilterTeamIds.length === 0 : sprintFilterTeamIds.includes(option.value);
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                if (isAll) {
                                  setSprintFilterTeamIds([]);
                                  onSprintStoryBoardTeamChange?.(null);
                                } else {
                                  setSprintFilterTeamIds((prev) => {
                                    const next = prev.includes(option.value) ? prev.filter((id) => id !== option.value) : [...prev, option.value];
                                    if (next.length === 1) onSprintStoryBoardTeamChange?.(next[0]);
                                    else if (next.length === 0) onSprintStoryBoardTeamChange?.(null);
                                    // 2+ teams: don't call onSprintStoryBoardTeamChange to avoid resetting sprintFilterTeamIds via useEffect
                                    return next;
                                  });
                                }
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-slate-700 hover:bg-slate-100",
                                checked && !isAll && "bg-slate-50",
                              )}
                            >
                              <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border", checked ? "border-slate-700 bg-slate-700" : "border-slate-300 bg-white")}>
                                {checked ? <Check className="size-2.5 text-white" /> : null}
                              </span>
                              {option.icon}
                              <span>{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </label>
              </>
            ) : null}
            {showInsightsTeamPicker ? (
              <>
                <ChevronRight className="size-4 text-slate-400" aria-hidden />
                <label className="inline-flex items-center gap-1 rounded-md border-0 bg-white/90 py-0.5 pl-1.5 pr-1 shadow-none">
                  <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Team</span>
                  <div className="relative z-40" ref={insightsTeamMenuRef}>
                    <button
                      type="button"
                      onClick={() => setIsInsightsTeamMenuOpen((prev) => !prev)}
                      className="inline-flex h-6 min-w-[8.75rem] items-center justify-between gap-1.5 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-semibold text-slate-800 outline-none transition hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300/70"
                      aria-label="Filter insights by team"
                      aria-expanded={isInsightsTeamMenuOpen}
                    >
                      <span className="truncate">{insightsTeamLabel}</span>
                      <ChevronDown className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                    </button>
                    {isInsightsTeamMenuOpen ? (
                      <div className="absolute left-0 top-[calc(100%+0.3rem)] z-[120] w-full min-w-[11rem] rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                        <div className="px-1 pb-1">
                          <input
                            ref={insightsTeamSearchInputRef}
                            type="text"
                            value={insightsTeamSearch}
                            onChange={(e) => setInsightsTeamSearch(e.target.value)}
                            placeholder="Search teams…"
                            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300/70"
                          />
                        </div>
                        {sprintTeamOptions.filter((o) => o.label.toLowerCase().includes(insightsTeamSearch.toLowerCase())).map((option) => {
                          const isAll = option.value === "all";
                          const checked = isAll ? insightsTeamIds.length === 0 : insightsTeamIds.includes(option.value);
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                if (isAll) {
                                  setInsightsTeamIds([]);
                                } else {
                                  setInsightsTeamIds((prev) =>
                                    prev.includes(option.value) ? prev.filter((id) => id !== option.value) : [...prev, option.value]
                                  );
                                }
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-slate-700 hover:bg-slate-100",
                                checked && !isAll && "bg-slate-50",
                              )}
                            >
                              <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border", checked ? "border-slate-700 bg-slate-700" : "border-slate-300 bg-white")}>
                                {checked ? <Check className="size-2.5 text-white" /> : null}
                              </span>
                              {option.icon}
                              <span>{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </label>
              </>
            ) : null}
          </div>
        ) : null}
        {!activeMonth ? (
          useRoadmapGanttChipTrack ? (
            <div
              className="grid min-w-0 w-full max-w-full gap-2"
              style={ganttLaneGridStyle}
            >
              <div
                className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1 sm:gap-1.5 md:gap-2"
                style={{ gridColumn: "1 / -1" }}
              >
                {summaryBadgesForScope ? (
                  <>
                    {onYearChange ? (
                      <RoadmapYearSelect year={currentYear} onYearChange={onYearChange} />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setRoadmapBarMode("initiatives");
                        onSummaryStatusQuickFilterChange?.(null);
                      }}
                      className={cn(
                        summaryChipBaseClass,
                        roadmapBarMode === "initiatives"
                          ? summaryChipInitiativesOnClass
                          : summaryChipInitiativesIdleClass,
                      )}
                    >
                      <Zap className="size-3 shrink-0 sm:size-3.5" aria-hidden />
                      <span className="truncate">{summaryBadgesForScope.totalInitiatives}</span>
                      <span className="hidden xl:inline">Initiatives</span>
                      <span className="xl:hidden">Inits</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRoadmapBarMode("epics");
                        onSummaryStatusQuickFilterChange?.(null);
                      }}
                      className={cn(
                        summaryChipBaseClass,
                        roadmapBarMode === "epics" && summaryStatusQuickFilter == null
                          ? summaryChipEpicsOnClass
                          : summaryChipEpicsIdleClass,
                      )}
                    >
                      <Folder className="size-3 shrink-0 sm:size-3.5" aria-hidden />
                      {("totalEpics" in summaryBadgesForScope
                        ? summaryBadgesForScope.totalEpics
                        : summaryBadgesForScope.scheduledEpics + summaryBadgesForScope.unscheduledEpics)}{" "}
                      Epics
                    </button>
                    <div className={summaryChipStoriesStaticClass}>
                      <UserStoryIcon className="size-3 shrink-0 sm:size-3.5" aria-hidden />
                      <span className="truncate">{summaryBadgesForScope.totalStories}</span>
                      <span className="hidden xl:inline">User Stories</span>
                      <span className="xl:hidden">Stories</span>
                    </div>
                    <button type="button" onClick={() => openEstEpicsPanel()} className={summaryChipEstimatedClass}>
                      <svg viewBox="0 0 16 16" className={summaryChipProgressCircleClass} aria-hidden>
                        <circle cx="8" cy="8" r="6" fill="none" stroke="#cbd5e1" strokeWidth="2.5" />
                        <circle
                          cx="8"
                          cy="8"
                          r="6"
                          fill="none"
                          stroke="#9f1239"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          transform="rotate(-90 8 8)"
                          strokeDasharray={`${2 * Math.PI * 6}`}
                          strokeDashoffset={`${(2 * Math.PI * 6) * (1 - estimatedEpicsPercentClamped / 100)}`}
                        />
                      </svg>
                      <span className="truncate">{estimatedEpicsPercentForScope}%</span>
                      <span className="hidden xl:inline">Epic Estimated</span>
                      <span className="xl:hidden">Estimated</span>
                    </button>
                    {!activeMonth && !focusedQuarter && quarterViewTab === "gantt" ? (
                      <button
                        type="button"
                        onClick={() => setShowYearSprintChips((prev) => !prev)}
                        className={cn(
                          summaryChipBaseClass,
                          showYearSprintChips ? summaryChipSprintsOnClass : summaryChipSprintsIdleClass,
                        )}
                      >
                        <CalendarDays className="size-3 shrink-0 sm:size-3.5" aria-hidden />
                        <span className="hidden xl:inline">Sprints</span>
                        <span className="xl:hidden">Spr</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-pressed={showRoadmapProgress}
                      onClick={() => onShowRoadmapProgressChange(!showRoadmapProgress)}
                      className={cn(showRoadmapProgress ? summaryChipProgressOnClass : summaryChipProgressIdleClass)}
                    >
                      <Activity className="size-3 shrink-0 sm:size-3.5" aria-hidden />
                      Progress
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "flex min-w-0 flex-wrap items-center justify-end gap-1 sm:gap-1.5 md:gap-2",
                hasBreadcrumbs ? "flex-1" : "w-full",
              )}
            >
              {summaryBadgesForScope ? (
                <>
                  {onYearChange ? (
                    <RoadmapYearSelect year={currentYear} onYearChange={onYearChange} />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setRoadmapBarMode("initiatives");
                      onSummaryStatusQuickFilterChange?.(null);
                    }}
                    className={cn(
                      summaryChipBaseClass,
                      roadmapBarMode === "initiatives"
                        ? summaryChipInitiativesOnClass
                        : summaryChipInitiativesIdleClass,
                    )}
                  >
                    <Zap className="size-3 shrink-0 sm:size-3.5" aria-hidden />
                    <span className="truncate">{summaryBadgesForScope.totalInitiatives}</span>
                    <span className="hidden xl:inline">Initiatives</span>
                    <span className="xl:hidden">Inits</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRoadmapBarMode("epics");
                      onSummaryStatusQuickFilterChange?.(null);
                    }}
                    className={cn(
                      summaryChipBaseClass,
                      roadmapBarMode === "epics" && summaryStatusQuickFilter == null
                        ? summaryChipEpicsOnClass
                        : summaryChipEpicsIdleClass,
                    )}
                  >
                    <Folder className="size-3 shrink-0 sm:size-3.5" aria-hidden />
                    {("totalEpics" in summaryBadgesForScope
                      ? summaryBadgesForScope.totalEpics
                      : summaryBadgesForScope.scheduledEpics + summaryBadgesForScope.unscheduledEpics)}{" "}
                    Epics
                  </button>
                  <div className={summaryChipStoriesStaticClass}>
                    <UserStoryIcon className="size-3 shrink-0 sm:size-3.5" aria-hidden />
                    <span className="truncate">{summaryBadgesForScope.totalStories}</span>
                    <span className="hidden xl:inline">User Stories</span>
                    <span className="xl:hidden">Stories</span>
                  </div>
                  <button type="button" onClick={() => openEstEpicsPanel()} className={summaryChipEstimatedClass}>
                    <svg viewBox="0 0 16 16" className={summaryChipProgressCircleClass} aria-hidden>
                      <circle cx="8" cy="8" r="6" fill="none" stroke="#cbd5e1" strokeWidth="2.5" />
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        fill="none"
                        stroke="#9f1239"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        transform="rotate(-90 8 8)"
                        strokeDasharray={`${2 * Math.PI * 6}`}
                        strokeDashoffset={`${(2 * Math.PI * 6) * (1 - estimatedEpicsPercentClamped / 100)}`}
                      />
                    </svg>
                    <span className="truncate">{estimatedEpicsPercentForScope}%</span>
                    <span className="hidden xl:inline">Epic Estimated</span>
                    <span className="xl:hidden">Estimated</span>
                  </button>
                  {!activeMonth && !focusedQuarter && quarterViewTab === "gantt" ? (
                    <button
                      type="button"
                      onClick={() => setShowYearSprintChips((prev) => !prev)}
                      className={cn(
                        summaryChipBaseClass,
                        showYearSprintChips ? summaryChipSprintsOnClass : summaryChipSprintsIdleClass,
                      )}
                    >
                      <CalendarDays className="size-3 shrink-0 sm:size-3.5" aria-hidden />
                      <span className="hidden xl:inline">Sprints</span>
                      <span className="xl:hidden">Spr</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-pressed={showRoadmapProgress}
                    onClick={() => onShowRoadmapProgressChange(!showRoadmapProgress)}
                    className={cn(showRoadmapProgress ? summaryChipProgressOnClass : summaryChipProgressIdleClass)}
                  >
                    <Activity className="size-3 shrink-0 sm:size-3.5" aria-hidden />
                    Progress
                  </button>
                </>
              ) : null}
            </div>
          )
        ) : activeMonth ? (
          <div
            className={cn(
              "flex min-w-0 flex-wrap items-center justify-end gap-1 pr-2 sm:gap-3 md:gap-2",
              hasBreadcrumbs ? "flex-1" : "w-full",
            )}
          >
              {sprintKanbanSummaryStats ? (
                <>
                  {onYearChange ? (
                    <RoadmapYearSelect year={currentYear} onYearChange={onYearChange} />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setRoadmapBarMode("epics");
                      onSummaryStatusQuickFilterChange?.(null);
                    }}
                    className={cn(
                      summaryChipBaseClass,
                      roadmapBarMode === "epics" && summaryStatusQuickFilter == null
                        ? summaryChipEpicsOnClass
                        : summaryChipEpicsIdleClass,
                    )}
                  >
                    {sprintKanbanSummaryStats.epicCount} Epics
                  </button>
                  <div className={summaryChipUnscheduledClass}>
                    <span className="truncate">{sprintKanbanSummaryStats.storyUnscheduled}</span>
                    <span className="hidden sm:inline">User Stories Unscheduled</span>
                    <span className="sm:hidden">US Unsch.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEstEpicsPanel()}
                    className={summaryChipEstimatedClass}
                  >
                    <svg viewBox="0 0 16 16" className={summaryChipProgressCircleClass} aria-hidden>
                      <circle cx="8" cy="8" r="6" fill="none" stroke="#cbd5e1" strokeWidth="2.5" />
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        fill="none"
                        stroke="#9f1239"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        transform="rotate(-90 8 8)"
                        strokeDasharray={`${2 * Math.PI * 6}`}
                        strokeDashoffset={`${(2 * Math.PI * 6) * (1 - estimatedEpicsPercentClamped / 100)}`}
                      />
                    </svg>
                    <span className="truncate">{estimatedEpicsPercentForScope}%</span>
                    <span className="hidden sm:inline">Epic Estimated</span>
                    <span className="sm:hidden">Estimated</span>
                  </button>
                  <div className={summaryChipStoriesClass}>
                    <span className="truncate">{sprintKanbanSummaryStats.storyTotal}</span>
                    <span className="hidden sm:inline">User Stories</span>
                    <span className="sm:hidden">Stories</span>
                  </div>
                  {showSprintEndCountdown &&
                  activeYearSprintForMonthDrill != null ? (
                    <SprintEndCountdown planYear={currentYear} yearSprint={activeYearSprintForMonthDrill} />
                  ) : null}
                </>
              ) : summaryBadgesForScope ? (
                <>
                  {onYearChange ? (
                    <RoadmapYearSelect year={currentYear} onYearChange={onYearChange} />
                  ) : null}
                  <button
                    type="button"
                    aria-pressed={showRoadmapProgress}
                    onClick={() => onShowRoadmapProgressChange(!showRoadmapProgress)}
                    className={cn(showRoadmapProgress ? summaryChipProgressOnClass : summaryChipProgressIdleClass)}
                  >
                    Progress
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRoadmapBarMode("initiatives");
                      onSummaryStatusQuickFilterChange?.(null);
                    }}
                    className={cn(
                      summaryChipBaseClass,
                      roadmapBarMode === "initiatives"
                        ? summaryChipInitiativesOnClass
                        : summaryChipInitiativesIdleClass,
                    )}
                  >
                    <span className="truncate">{summaryBadgesForScope.totalInitiatives}</span>
                    <span className="hidden sm:inline">Initiatives</span>
                    <span className="sm:hidden">Inits</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRoadmapBarMode("epics");
                      onSummaryStatusQuickFilterChange?.(null);
                    }}
                    className={cn(
                      summaryChipBaseClass,
                      roadmapBarMode === "epics" && summaryStatusQuickFilter == null
                        ? summaryChipEpicsOnClass
                        : summaryChipEpicsIdleClass,
                    )}
                  >
                    {("totalEpics" in summaryBadgesForScope
                      ? summaryBadgesForScope.totalEpics
                      : summaryBadgesForScope.scheduledEpics + summaryBadgesForScope.unscheduledEpics)}{" "}
                    Epics
                  </button>
                  <button
                    type="button"
                    onClick={() => openEstEpicsPanel()}
                    className={summaryChipEstimatedClass}
                  >
                    <svg viewBox="0 0 16 16" className={summaryChipProgressCircleClass} aria-hidden>
                      <circle cx="8" cy="8" r="6" fill="none" stroke="#cbd5e1" strokeWidth="2.5" />
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        fill="none"
                        stroke="#9f1239"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        transform="rotate(-90 8 8)"
                        strokeDasharray={`${2 * Math.PI * 6}`}
                        strokeDashoffset={`${(2 * Math.PI * 6) * (1 - estimatedEpicsPercentClamped / 100)}`}
                      />
                    </svg>
                    <span className="truncate">{estimatedEpicsPercentForScope}%</span>
                    <span className="hidden sm:inline">Epic Estimated</span>
                    <span className="sm:hidden">Estimated</span>
                  </button>
                  <div className={summaryChipStoriesStaticClass}>
                    <span className="truncate">{summaryBadgesForScope.totalStories}</span>
                    <span className="hidden sm:inline">User Stories</span>
                    <span className="sm:hidden">Stories</span>
                  </div>
                  {showSprintEndCountdown &&
                  activeYearSprintForMonthDrill != null &&
                  monthPlanTab !== "sprint-kanban" ? (
                    <SprintEndCountdown planYear={currentYear} yearSprint={activeYearSprintForMonthDrill} />
                  ) : null}
                </>
              ) : null}
          </div>
        ) : focusedQuarter ? (
          <div className="flex items-center gap-2" />
        ) : (
          <div className="flex items-center gap-2" />
        )}
      </div>
  );

  const planningSurface = (
      <div
        key={isInsightsSurfaceRender ? `insights-${activeMonth ?? "year"}-${focusedQuarterLabel ?? "all"}` : "planning-surface"}
        ref={timelineContentScrollRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain",
          showCapacityPlanningScrollbar
            ? "min-w-0 [scrollbar-gutter:stable] [scrollbar-width:thin]"
            : "planning-surface-scroll",
        )}
      >
      {activeMonth ? (
        <div className="relative z-30 h-0">
          <div
            className={cn(
              "absolute left-0 top-0 inline-flex flex-col gap-1 overflow-visible rounded-xl border border-slate-200/90 bg-white p-1 ring-1 ring-black/5 transition-[width] duration-200",
              isRailExpanded ? "w-44" : "w-[3.25rem]",
            )}
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
                  title="Sprint Board"
                  onMouseEnter={() => setIsRailExpanded(true)}
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center overflow-visible rounded-md transition",
              isRailExpanded ? "justify-start gap-2 px-2" : "justify-center px-0",
                    monthPlanTab === "sprint-kanban"
                      ? planRailTabActiveClass
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <MapIcon className="size-4" aria-hidden />
                  <span className="sr-only">Sprint Board</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Sprint Board
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onMonthPlanTabChange?.("sprint-status");
                    setActiveSprintTab("status");
                  }}
                  title={sprintInsightsLabel}
                  onMouseEnter={() => setIsRailExpanded(true)}
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center overflow-visible rounded-md transition",
              isRailExpanded ? "justify-start gap-2 px-2" : "justify-center px-0",
                    monthPlanTab === "sprint-status"
                      ? planRailTabActiveClass
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <BarChart3 className="size-4" aria-hidden />
                  <span className="sr-only">{sprintInsightsLabel}</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    {sprintInsightsLabel}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onMonthPlanTabChange?.("sprint-capacity");
                  }}
                  title="Sprint Capacity"
                  onMouseEnter={() => setIsRailExpanded(true)}
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center overflow-visible rounded-md transition",
              isRailExpanded ? "justify-start gap-2 px-2" : "justify-center px-0",
                    monthPlanTab === "sprint-capacity"
                      ? planRailTabActiveClass
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <Thermometer className="size-4" aria-hidden />
                  <span className="sr-only">Sprint Capacity</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Sprint Capacity
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onMonthPlanTabChange?.("sprint-retrospective");
                  }}
                  title="Sprint Retrospective"
                  onMouseEnter={() => setIsRailExpanded(true)}
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center overflow-visible rounded-md transition",
              isRailExpanded ? "justify-start gap-2 px-2" : "justify-center px-0",
                    monthPlanTab === "sprint-retrospective"
                      ? planRailTabActiveClass
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <ClipboardList className="size-4" aria-hidden />
                  <span className="sr-only">Sprint Retrospective</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Sprint Retrospective
                  </span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onMonthPlanTabChange?.("epic-gantt")}
                  title="Epic Plan"
                  onMouseEnter={() => setIsRailExpanded(true)}
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center overflow-visible rounded-md transition",
              isRailExpanded ? "justify-start gap-2 px-2" : "justify-center px-0",
                    monthPlanTab === "epic-gantt"
                      ? planRailTabActiveClass
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <MapIcon className="size-4" aria-hidden />
                  <span className="sr-only">Epic Plan</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Epic Plan
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onMonthPlanTabChange?.("month-capacity")}
                  title="Team Capacity"
                  onMouseEnter={() => setIsRailExpanded(true)}
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center overflow-visible rounded-md transition",
              isRailExpanded ? "justify-start gap-2 px-2" : "justify-center px-0",
                    monthPlanTab === "month-capacity"
                      ? planRailTabActiveClass
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <Thermometer className="size-4" aria-hidden />
                  <span className="sr-only">Team Capacity</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Team Capacity
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onMonthPlanTabChange?.("month-status")}
                  title={monthInsightsLabel}
                  onMouseEnter={() => setIsRailExpanded(true)}
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center overflow-visible rounded-md transition",
              isRailExpanded ? "justify-start gap-2 px-2" : "justify-center px-0",
                    monthPlanTab === "month-status"
                      ? planRailTabActiveClass
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <BarChart3 className="size-4" aria-hidden />
                  <span className="sr-only">{monthInsightsLabel}</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    {monthInsightsLabel}
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
              "absolute left-0 top-0 inline-flex flex-col gap-1 overflow-visible rounded-xl border border-slate-200/90 bg-white p-1 ring-1 ring-black/5 transition-[width] duration-200",
              isRailExpanded ? "w-44" : "w-[3.25rem]",
            )}
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
              onMouseEnter={() => setIsRailExpanded(true)}
              className={cn(
                "group relative inline-flex h-10 w-full items-center overflow-visible rounded-lg transition",
              isRailExpanded ? "justify-start gap-2.5 px-2.5" : "justify-center px-0",
                quarterViewTab === "gantt"
                  ? planRailTabActiveClass
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
              onClick={() => setQuarterViewTab("insights")}
              title={quarterInsightsLabel}
              onMouseEnter={() => setIsRailExpanded(true)}
              className={cn(
                "group relative inline-flex h-9 w-full items-center overflow-visible rounded-md transition",
              isRailExpanded ? "justify-start gap-2 px-2" : "justify-center px-0",
                quarterViewTab === "insights"
                  ? planRailTabActiveClass
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <Activity className="size-4" aria-hidden />
              <span className="sr-only">{quarterInsightsLabel}</span>
              <span
                aria-hidden
                className={cn(
                  railLabelBaseClass,
                  isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                )}
              >
                {quarterInsightsNode}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setQuarterViewTab("capacity")}
              title={quarterCapacityLabel}
              onMouseEnter={() => setIsRailExpanded(true)}
              className={cn(
                "group relative inline-flex h-9 w-full items-center overflow-visible rounded-md transition",
              isRailExpanded ? "justify-start gap-2 px-2" : "justify-center px-0",
                quarterViewTab === "capacity"
                  ? planRailTabActiveClass
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <Thermometer className="size-4" aria-hidden />
              <span className="sr-only">{quarterCapacityLabel}</span>
              <span
                aria-hidden
                className={cn(
                  railLabelBaseClass,
                  isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                )}
              >
                {quarterCapacityNode}
              </span>
            </button>
          </div>
        </div>
      ) : !activeMonth && !focusedQuarter ? (
        <div className="relative z-30 h-0">
          <div
            className={cn(
              "absolute left-0 top-0 inline-flex flex-col gap-1 overflow-visible rounded-xl border border-slate-200/90 bg-white p-1 ring-1 ring-black/5 transition-[width] duration-200",
              isRailExpanded ? "w-44" : "w-[3.25rem]",
            )}
            onMouseLeave={() => setIsRailExpanded(false)}
          >
            <button
              type="button"
              onClick={() => setQuarterViewTab("gantt")}
              title="Gantt"
              onMouseEnter={() => setIsRailExpanded(true)}
              className={cn(
                "group relative inline-flex h-10 w-full items-center overflow-visible rounded-lg transition",
              isRailExpanded ? "justify-start gap-2.5 px-2.5" : "justify-center px-0",
                quarterViewTab === "gantt"
                  ? planRailTabActiveClass
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <MapIcon className="size-[18px]" aria-hidden />
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
              onClick={() => setQuarterViewTab("insights")}
              title="Portfolio Insights"
              onMouseEnter={() => setIsRailExpanded(true)}
              className={cn(
                "group relative inline-flex h-10 w-full items-center overflow-visible rounded-lg transition",
              isRailExpanded ? "justify-start gap-2.5 px-2.5" : "justify-center px-0",
                quarterViewTab === "insights"
                  ? planRailTabActiveClass
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <Activity className="size-[18px]" aria-hidden />
              <span className="sr-only">Portfolio Insights</span>
              <span
                aria-hidden
                className={cn(
                  railLabelBaseClass,
                  isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                )}
              >
                Portfolio Insights
              </span>
            </button>
            <button
              type="button"
              onClick={() => setQuarterViewTab("capacity")}
              title="Portfolio Capacity"
              onMouseEnter={() => setIsRailExpanded(true)}
              className={cn(
                "group relative inline-flex h-10 w-full items-center overflow-visible rounded-lg transition",
              isRailExpanded ? "justify-start gap-2.5 px-2.5" : "justify-center px-0",
                quarterViewTab === "capacity"
                  ? planRailTabActiveClass
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <Thermometer className="size-[18px]" aria-hidden />
              <span className="sr-only">Portfolio Capacity</span>
              <span
                aria-hidden
                className={cn(
                  railLabelBaseClass,
                  isRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
                )}
              >
                Portfolio Capacity
              </span>
            </button>
          </div>
        </div>
      ) : null}
      {activeMonth ? (
        <div
          className={cn(
            "mb-4",
            monthPlanTab !== "sprint-kanban" &&
              monthPlanTab !== "epic-gantt" &&
              monthPlanTab !== "sprint-retrospective" &&
              monthPlanTab !== "month-capacity" &&
              monthPlanTab !== "sprint-capacity" &&
              monthPlanTab !== "month-status" &&
              monthPlanTab !== "sprint-status" &&
              "rounded-2xl p-1.5 shadow-lg ring-1",
            monthPlanTab === "sprint-kanban" && "flex w-full min-w-0 flex-col min-h-min pl-[4rem]",
            hasContextSideMenu && monthPlanTab !== "sprint-kanban" && "w-[calc(100%-4rem)] ml-[4rem]",
    monthPlanTab !== "sprint-kanban" &&
    monthPlanTab !== "sprint-retrospective" &&
    monthPlanTab !== "month-capacity" &&
    monthPlanTab !== "sprint-capacity" &&
    monthPlanTab !== "epic-gantt" &&
    monthPlanTab !== "month-status" &&
    monthPlanTab !== "sprint-status" &&
    activeMonthQuarterLabel &&
    quarterPanelTone[activeMonthQuarterLabel]
      ? quarterPanelTone[activeMonthQuarterLabel]
      : monthPlanTab === "sprint-kanban"
        ? "bg-white ring-slate-200/90"
        : monthPlanTab === "sprint-retrospective" ||
            monthPlanTab === "month-capacity" ||
            monthPlanTab === "sprint-capacity" ||
            monthPlanTab === "epic-gantt" ||
            monthPlanTab === "month-status" ||
            monthPlanTab === "sprint-status"
          ? "bg-transparent ring-0"
          : "bg-slate-100/70 ring-slate-200/90",
          )}
        >
          <div
            className={cn(
              "flex flex-col",
              monthPlanTab !== "sprint-kanban" &&
                monthPlanTab !== "epic-gantt" &&
                monthPlanTab !== "sprint-retrospective" &&
                monthPlanTab !== "month-capacity" &&
                monthPlanTab !== "sprint-capacity" &&
                monthPlanTab !== "month-status" &&
                monthPlanTab !== "sprint-status" &&
                "rounded-xl border border-white/70 bg-white/95 shadow-inner ring-1 ring-slate-200/45 backdrop-blur-sm",
              monthPlanTab === "sprint-kanban"
                ? "min-h-min overflow-visible"
                : cn(
                    "overflow-hidden",
                    monthPlanTab === "epic-gantt" || monthPlanTab === "sprint-retrospective"
                      ? "min-h-[56rem]"
                      : "min-h-0",
                  ),
            )}
          >
            {monthPlanTab === "epic-gantt" && activeMonth != null ? (
              <div className="relative flex min-h-0 flex-1 flex-col gap-4 p-3 sm:p-5">
                <div className="relative z-[1] flex min-h-0 flex-1 flex-col gap-4">
                <div className="grid min-w-0 shrink-0 gap-3" style={epicMonthGridStyle}>
                  <div className="col-span-2 mb-2">
                    <div className="grid min-w-0 grid-cols-2 gap-3">
                      <button
                        type="button"
                        title={`Open ${sprintLabelQuarterOrMonth(globalSprintFromMonthLane(activeMonth, 1))} board (${sprintDateWeekdayRangeText(currentYear, activeMonth, 1)})`}
                        onClick={() => {
                          if (isPostDragClickSuppressed()) return;
                          const targetSprint = globalSprintFromMonthLane(activeMonth, 1);
                          setActiveSprint(targetSprint);
                          setActiveSprintTab("kanban");
                          onMonthPlanTabChange?.("sprint-kanban");
                          onEnterSprintStoryBoard?.(targetSprint, null);
                        }}
                        className="flex w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-sky-50 to-blue-50 px-2 py-2 text-center ring-1 ring-sky-200/60 transition hover:-translate-y-px hover:from-sky-100 hover:to-blue-100 active:scale-[0.99]"
                      >
                        <div className="flex flex-col items-center gap-0.5 pb-1">
                          <span className="inline-flex items-center gap-1 text-[15px] font-semibold leading-tight text-slate-800">
                            <Flag className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                            {sprintLabelQuarterOrMonth(globalSprintFromMonthLane(activeMonth, 1))}
                          </span>
                          <span className="mt-0.5 max-w-full px-0.5 text-[13px] font-medium leading-tight text-slate-500">
                            ({sprintDateWeekdayRangeText(currentYear, activeMonth, 1)})
                          </span>
                        </div>
                        <div className="mt-1 flex w-full min-w-0 gap-1">
                          {sprintDaysWithWeekday(currentYear, activeMonth, 1).map((dayLabel) => (
                            <span
                              key={dayLabel.key}
                              className="flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded bg-white/80 px-0.5 py-1.5 text-center ring-1 ring-slate-200/80"
                            >
                              <span className="w-full truncate text-[12px] font-semibold leading-none text-slate-700">
                                {dayLabel.weekday}
                              </span>
                              <span className="w-full truncate text-[11px] font-medium leading-none text-slate-500 tabular-nums">
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
                          const targetSprint = globalSprintFromMonthLane(activeMonth, 2);
                          setActiveSprint(targetSprint);
                          setActiveSprintTab("kanban");
                          onMonthPlanTabChange?.("sprint-kanban");
                          onEnterSprintStoryBoard?.(targetSprint, null);
                        }}
                        className="flex w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-violet-50 to-indigo-50 px-2 py-2 text-center ring-1 ring-indigo-200/60 transition hover:-translate-y-px hover:from-violet-100 hover:to-indigo-100 active:scale-[0.99]"
                      >
                        <div className="flex flex-col items-center gap-0.5 pb-1">
                          <span className="inline-flex items-center gap-1 text-[15px] font-semibold leading-tight text-slate-800">
                            <Flag className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                            {sprintLabelQuarterOrMonth(globalSprintFromMonthLane(activeMonth, 2))}
                          </span>
                          <span className="mt-0.5 max-w-full px-0.5 text-[13px] font-medium leading-tight text-slate-500">
                            ({sprintDateWeekdayRangeText(currentYear, activeMonth, 2)})
                          </span>
                        </div>
                        <div className="mt-1 flex w-full min-w-0 gap-1">
                          {sprintDaysWithWeekday(currentYear, activeMonth, 2).map((dayLabel) => (
                            <span
                              key={dayLabel.key}
                              className="flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded bg-white/80 px-0.5 py-1.5 text-center ring-1 ring-slate-200/80"
                            >
                              <span className="w-full truncate text-[12px] font-semibold leading-none text-slate-700">
                                {dayLabel.weekday}
                              </span>
                              <span className="w-full truncate text-[11px] font-medium leading-none text-slate-500 tabular-nums">
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
                    <div className="relative flex min-h-0 w-full basis-0 flex-1 flex-col overflow-hidden">
                      <YearRoadmapTodayLine leftPercent={monthEpicGanttTodayLeft} />
                      {roadmapBarMode === "initiatives" && monthInitiativeGanttRows.length === 0 ? (
                        <p className="sr-only">
                          No initiatives are planned in {MONTHS[activeMonth - 1]} yet. Plan epics from the initiative list
                          to fill this month.
                        </p>
                      ) : roadmapBarMode !== "initiatives" && monthEpicGanttRows.length === 0 ? (
                        <p className="sr-only">
                          No epics are planned in {MONTHS[activeMonth - 1]} yet. Drag an epic from the initiative list onto
                          this month.
                        </p>
                      ) : null}
                      <StripedGanttLaneScrollArea
                        id={TIMELINE_GANTT_ROWS_CONTAINER_ID}
                        columnCount={2}
                        rowGapClass="space-y-2"
                        minHeightStyle={{ minHeight: "max(100%, calc(100dvh - 34rem))" }}
                      >
                        {roadmapBarMode === "initiatives" && monthInitiativeGanttRows.length === 0 ? (
                          <div className="h-0 shrink-0 overflow-hidden" aria-hidden />
                        ) : roadmapBarMode !== "initiatives" && monthEpicGanttRows.length === 0 ? (
                          <div className="h-0 shrink-0 overflow-hidden" aria-hidden />
                        ) : roadmapBarMode === "initiatives" ? (
                          monthInitiativeGanttRows.map((initiative, rowIndex) => (
                            <div
                              key={initiative.id}
                              className={cn(
                                rowIndex < monthInitiativeGanttRows.length - 1 && "border-b border-slate-200/50",
                              )}
                            >
                              <MonthInitiativeGanttLaneRow
                                initiative={initiative}
                                onOpenInitiative={onOpenInitiative}
                                ganttLaneSortIndex={rowIndex}
                                showProgress={showRoadmapProgress}
                              />
                            </div>
                          ))
                        ) : (
                          monthEpicGanttRows.map(({ epic, initiative }, rowIndex) => {
                            const isInitiativeEmphasis =
                              ganttEmphasis != null && ganttEmphasis.initiativeId === initiative.id;
                            const isEpicEmphasis =
                              ganttEpicEmphasis != null && ganttEpicEmphasis.epicId === epic.id;
                            const isScheduledFilterEmphasis =
                              ganttScheduledFilterEmphasis != null && epicIsScheduledOnGantt(epic);
                            const emphasize =
                              isInitiativeEmphasis || isEpicEmphasis || isScheduledFilterEmphasis;
                            const emphasizeTick = isEpicEmphasis
                              ? ganttEpicEmphasis!.tick
                              : isInitiativeEmphasis
                                ? ganttEmphasis!.tick
                                : isScheduledFilterEmphasis
                                  ? ganttScheduledFilterEmphasis!.tick
                                  : 0;
                            return (
                              <div
                                key={epic.id}
                                className={cn(
                                  rowIndex < monthEpicGanttRows.length - 1 && "border-b border-slate-200/50",
                                )}
                              >
                                <EpicGanttLaneRow
                                  epic={epic}
                                  initiative={initiative}
                                  gridStyle={epicMonthGridStyle}
                                  month={activeMonth}
                                  planYear={currentYear}
                                  onOpenEpic={onOpenEpic}
                                  onUnscheduleEpic={onUnscheduleEpic}
                                  onDayRangeChange={onMonthEpicDayRangeChange}
                                  ganttLaneSortIndex={rowIndex}
                                  emphasize={emphasize}
                                  emphasizeTick={emphasizeTick}
                                  showProgress={showRoadmapProgress}
                                />
                              </div>
                            );
                          })
                        )}
                      </StripedGanttLaneScrollArea>
                      {(roadmapBarMode === "initiatives" && monthInitiativeGanttRows.length === 0) ||
                      (roadmapBarMode !== "initiatives" && monthEpicGanttRows.length === 0) ? (
                        <div className="pointer-events-none absolute inset-0 z-[20] flex justify-center px-4 pt-[clamp(1.5rem,11vh,7rem)] sm:px-6 sm:pt-[clamp(2rem,14vh,9rem)]">
                          <div className="max-w-md text-center text-pretty sm:max-w-lg" aria-hidden>
                            {roadmapBarMode === "initiatives" ? (
                              <>
                                <p className="text-base font-semibold leading-snug text-slate-800 sm:text-lg">
                                  No initiatives in {MONTHS[activeMonth - 1]} yet
                                </p>
                                <p className="mt-2 text-sm font-normal leading-relaxed text-slate-600 sm:text-base">
                                  Plan epics from the initiative list to fill this month.
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="text-lg font-semibold leading-snug text-slate-800 sm:text-xl">
                                  No epics in {MONTHS[activeMonth - 1]} yet
                                </p>
                                <p className="mt-2 text-sm font-normal leading-relaxed text-slate-600 sm:text-base">
                                  Drag an epic from the initiative list onto this month.
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </MonthEpicDropArea>
                </div>
              </div>
            ) : monthPlanTab === "month-capacity" ? (
              <div className="p-3 sm:p-5">
                <MonthTeamCapacityBoard
                  initiatives={initiatives}
                  year={currentYear}
                  month={activeMonth}
                  capacityBoard={monthTeamCapacityBoard}
                  monthTeamBoardPersisted={
                    monthTeamBoardByKey[monthTeamBoardStorageKey(currentYear, activeMonth)] ?? null
                  }
                  onCapacityChange={(teamId, days) => onMonthTeamCapacityChange?.(teamId, days)}
                  onOpenEpic={onOpenEpic}
                  onRemoveEpicFromCapacity={(epicId) => onMonthTeamCapacityEpicRemove?.(epicId)}
                  onEpicOriginalEstimateChange={(epicId, estimatedDays) =>
                    onCapacityEpicOriginalEstimateChange?.(epicId, estimatedDays)
                  }
                  loadBasis="originalEstimate"
                  teamFilterIds={capacityTeamFilterIds}
                  teamSelectorSlot={
                    <CapacityPlanTeamCombobox
                      directoryUsers={workspaceDirectoryUsers}
                      selectedIds={capacityTeamFilterIds}
                      onSelectedIdsChange={setCapacityTeamFilterIds}
                      search={capacityTeamSearch}
                      onSearchChange={setCapacityTeamSearch}
                      menuOpen={capacityTeamMenuOpen}
                      onMenuOpenChange={setCapacityTeamMenuOpen}
                      comboboxRef={capacityTeamFilterRef}
                      ariaLabel="Filter month capacity by team (teams from user directory)"
                    />
                  }
                />
              </div>
            ) : monthPlanTab === "sprint-kanban" ? (
              <div className="flex w-full min-h-min flex-col">
                <SprintKanbanBoard
                  initiatives={initiatives}
                  planYear={currentYear}
                  month={sprintBoardContextMonth ?? activeMonth ?? 1}
                  yearSprint={resolvedActiveYearSprint ?? 1}
                  filterEpicTeamIds={sprintFilterTeamIds.length ? sprintFilterTeamIds : null}
                  workspaceDirectoryUsers={workspaceDirectoryUsers}
                  epicAccordionEmphasis={sprintEpicAccordionEmphasis}
                  scheduledStoriesEmphasis={sprintKanbanScheduledStoriesEmphasis}
                  sprintToolbarEnd={
                    showSprintEndCountdown && activeYearSprintForMonthDrill != null && monthPlanTab !== "sprint-kanban" ? (
                      <SprintEndCountdown planYear={currentYear} yearSprint={activeYearSprintForMonthDrill} />
                    ) : null
                  }
                  onUnscheduleStory={(storyId) => onSprintCapacityStoryUnschedule?.(storyId)}
                  onRequestUnscheduleStory={onRequestSprintKanbanStoryUnschedule}
                  onOpenStory={onOpenStory ?? (() => {})}
                  onPatchStory={onSprintKanbanStoryPatch}
                  onGoToOpenSprint={(ys) =>
                    onEnterSprintStoryBoard?.(ys, sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId))
                  }
                />
              </div>
            ) : monthPlanTab === "sprint-capacity" ? (
              <div className="p-3 sm:p-5">
                <SprintCapacityBoard
                  initiatives={initiatives}
                  month={sprintBoardContextMonth ?? activeMonth ?? 1}
                  yearSprint={resolvedActiveYearSprint ?? 1}
                  selectedTeamId={sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId)}
                  workspaceDirectoryUsers={workspaceDirectoryUsers}
                  capacityBoard={sprintCapacityBoard ?? { capacities: {}, assignments: {} }}
                  columnReorderEnabled={sprintCapacityColumnReorderEnabled}
                  onCapacityChange={(member, days) => onSprintCapacityChange?.(member, days)}
                  onEstimateChange={(storyId, estimatedDays) =>
                    onSprintCapacityStoryEstimateChange?.(storyId, estimatedDays)
                  }
                  onDaysLeftChange={(storyId, daysLeft) =>
                    onSprintCapacityStoryDaysLeftChange?.(storyId, daysLeft)
                  }
                  onUnscheduleStory={(storyId) =>
                    onSprintCapacityStoryClearAssignee
                      ? onSprintCapacityStoryClearAssignee(storyId)
                      : onSprintCapacityStoryUnschedule?.(storyId)
                  }
                  onOpenStory={onOpenStory ?? (() => {})}
                  teamSelectorSlot={
                    <div className="relative inline-flex min-w-[12rem] max-w-[20rem] align-middle" ref={sprintTeamMenuRef}>
                      <button
                        type="button"
                        onClick={() => setIsSprintTeamMenuOpen((prev) => !prev)}
                        className="inline-flex h-7 min-w-[9.25rem] items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-800 outline-none transition hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300/70"
                        aria-label="Filter sprint capacity by team"
                        aria-expanded={isSprintTeamMenuOpen}
                      >
                        <span className="truncate">{sprintFilterTeamLabel}</span>
                        <ChevronDown className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                      </button>
                      {isSprintTeamMenuOpen ? (
                        <div className="absolute left-0 top-[calc(100%+0.3rem)] z-[120] w-full min-w-[11rem] rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                          <div className="px-1 pb-1">
                            <input
                              ref={sprintTeamSearchInputRef}
                              type="text"
                              value={sprintTeamSearch}
                              onChange={(e) => setSprintTeamSearch(e.target.value)}
                              placeholder="Search teams…"
                              className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300/70"
                            />
                          </div>
                          {sprintTeamOptions.filter((o) => o.label.toLowerCase().includes(sprintTeamSearch.toLowerCase())).map((option) => {
                            const isAll = option.value === "all";
                            const checked = isAll ? sprintFilterTeamIds.length === 0 : sprintFilterTeamIds.includes(option.value);
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                  if (isAll) {
                                    setSprintFilterTeamIds([]);
                                    onSprintStoryBoardTeamChange?.(null);
                                  } else {
                                    setSprintFilterTeamIds((prev) => {
                                      const next = prev.includes(option.value) ? prev.filter((id) => id !== option.value) : [...prev, option.value];
                                      if (next.length === 1) onSprintStoryBoardTeamChange?.(next[0]);
                                      else if (next.length === 0) onSprintStoryBoardTeamChange?.(null);
                                      // 2+ teams: don't call onSprintStoryBoardTeamChange to avoid resetting sprintFilterTeamIds via useEffect
                                      return next;
                                    });
                                  }
                                }}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-slate-700 hover:bg-slate-100",
                                  checked && !isAll && "bg-slate-50",
                                )}
                              >
                                <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border", checked ? "border-slate-700 bg-slate-700" : "border-slate-300 bg-white")}>
                                  {checked ? <Check className="size-2.5 text-white" /> : null}
                                </span>
                                {option.icon}
                                <span>{option.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  }
                />
              </div>
            ) : monthPlanTab === "sprint-retrospective" ? (
              <div className="flex min-h-0 flex-1 flex-col py-3 pr-3 pl-2 sm:py-5 sm:pr-5 sm:pl-3">
                <SprintRetrospectiveEditor
                  sprintLabel={`Sprint ${resolvedActiveYearSprint ?? activeSprint ?? firstGlobalSprintForMonth(activeMonth ?? 1)}`}
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
                  filterEpicTeamIds={sprintFilterTeamIds.length ? sprintFilterTeamIds : null}
                  onOpenEpic={onOpenEpic}
                  onOpenStory={onOpenStory ?? (() => {})}
                  onOpenSprintKanban={(yearSprint, teamId) =>
                    onEnterSprintStoryBoard?.(yearSprint, sprintStoryBoardEpicTeamFilter(teamId))
                  }
                  initialSelectedEpicId={initialInsightsScopeEpicId ?? undefined}
                  initialSelectedInitiativeId={initialInsightsScopeInitId ?? undefined}
                  onScopeChange={(type, id) => onInsightsScopeChange?.(type === "epic" ? id : null, type === "initiative" ? id : null)}
                />
              </div>
            ) : (
              <div className="p-3 sm:p-5">
                <SprintAnalytics
                  initiatives={initiatives}
                  month={sprintBoardContextMonth ?? activeMonth ?? 1}
                  yearSprint={resolvedActiveYearSprint ?? 1}
                  planYear={currentYear}
                  filterEpicTeamIds={sprintFilterTeamIds.length ? sprintFilterTeamIds : null}
                  sprintCapacityBoard={sprintCapacityBoard}
                  workspaceDirectoryUsers={workspaceDirectoryUsers}
                  onOpenStory={onOpenStory ?? (() => {})}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {focusedQuarter && quarterViewTab === "gantt" ? (
            <div
              className={cn(
                "mb-4 flex min-h-0 min-w-0 flex-1 w-full flex-col",
                hasContextSideMenu && "w-[calc(100%-4rem)] ml-[4rem]",
              )}
            >
              <div
                className={cn(
                  "min-h-0 min-w-0 flex-1",
                  !panelHScroll &&
                    yearRoadmapHScroll &&
                    "overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]",
                )}
              >
                <div
                  className={cn(
                    "flex min-h-0 min-w-0 flex-1 flex-col gap-4",
                    yearRoadmapHScroll && "w-max min-w-full",
                  )}
                  style={
                    yearRoadmapHScroll
                      ? { minWidth: portfolioRoadmapHScrollContentMinWidthPx }
                      : undefined
                  }
                >
                  <div
                    className={cn(
                      "relative shrink-0 rounded-t-xl bg-slate-50/30 ring-1 ring-slate-200/40",
                      !yearRoadmapHScroll && "overflow-hidden",
                    )}
                  >
                    <div className="relative grid min-w-0 gap-2 p-0.5" style={ganttLaneGridStyle}>
                    {visibleMonths.map((month) => (
                      <div
                        key={month}
                        style={{ gridColumn: "span 2" }}
                        className="space-y-1.5 rounded-2xl border border-slate-200/50 bg-gradient-to-b from-white to-slate-50/40 px-2 pt-1.5 pb-0 shadow-sm ring-1 ring-black/[0.03]"
                      >
                        <button
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-center text-sm font-bold tracking-tight shadow-sm ring-1 ring-black/[0.04] transition sm:gap-1.5 sm:rounded-xl sm:py-1.5 sm:text-[15px]",
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
                          <span>{FULL_MONTHS[month - 1]}</span>
                        </button>
                        <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:mt-3 sm:gap-2">
                          <button
                            type="button"
                            title={`${sprintLabelQuarterOrMonth(globalSprintFromMonthLane(month, 1))} (${sprintDateWeekdayRangeText(currentYear, month, 1)})`}
                            onClick={() => {
                              if (isPostDragClickSuppressed()) return;
                              setFocusedMonth(month);
                              onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, 1), null);
                            }}
                            className="flex flex-col items-center justify-center gap-1 rounded-lg bg-gradient-to-br from-sky-50 to-blue-50 px-1 py-1 text-center text-[11px] shadow-sm ring-1 ring-sky-200/60 transition hover:-translate-y-px hover:from-sky-100 hover:to-blue-100 hover:shadow-md active:scale-[0.99] sm:rounded-xl sm:px-1.5 sm:text-[13px]"
                          >
                            <span className="font-semibold leading-tight text-slate-800">
                              {sprintLabelQuarterOrMonth(globalSprintFromMonthLane(month, 1))}
                            </span>
                            <span className="text-[10px] font-medium leading-snug text-slate-500 sm:text-[12px]">
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
                            className="flex flex-col items-center justify-center gap-1 rounded-lg bg-gradient-to-br from-violet-50 to-indigo-50 px-1 py-1 text-center text-[11px] shadow-sm ring-1 ring-indigo-200/60 transition hover:-translate-y-px hover:from-violet-100 hover:to-indigo-100 hover:shadow-md active:scale-[0.99] sm:rounded-xl sm:px-1.5 sm:text-[13px]"
                          >
                            <span className="font-semibold leading-tight text-slate-800">
                              {sprintLabelQuarterOrMonth(globalSprintFromMonthLane(month, 2))}
                            </span>
                            <span className="text-[10px] font-medium leading-snug text-slate-500 sm:text-[12px]">
                              ({sprintDateWeekdayRangeText(currentYear, month, 2)})
                            </span>
                          </button>
                        </div>
                        <MonthDropCell month={month} />
                      </div>
                    ))}
                  </div>
                </div>
                <div
                  className={cn(
                    "relative isolate flex min-h-0 flex-1 flex-col rounded-xl bg-slate-50/35 px-3 pb-3 ring-1 ring-slate-100/80 sm:px-4 sm:pb-4",
                    "min-h-[calc(100vh-19rem)]",
                    roadmapLaneTodayLeft != null && "pt-5 sm:pt-6",
                  )}
                >
                  <GanttTodayMarker
                    leftPercent={roadmapLaneTodayLeft}
                    showBadge={false}
                    badgePlacement="above"
                  />
                  <div
                    className={cn(
                      "relative flex min-h-0 w-full basis-0 flex-1 flex-col",
                      !yearRoadmapHScroll && "overflow-hidden",
                    )}
                  >
                  {roadmapBarMode === "initiatives" ? (
                    quarterRoadmapInitiativeRows.length === 0 ? (
                      <>
                        <p className="sr-only">
                          No initiatives with planned epics in {focusedQuarter.label} yet. Plan epics from the initiative
                          list to fill this quarter.
                        </p>
                        <StripedGanttLaneScrollArea
                          id={TIMELINE_GANTT_ROWS_CONTAINER_ID}
                          columnCount={ganttLaneColumnCount}
                          rowGapClass="space-y-2"
                        >
                          <div className="h-0 shrink-0 overflow-hidden" aria-hidden />
                        </StripedGanttLaneScrollArea>
                        <div className="pointer-events-none absolute inset-0 z-[20] flex justify-center px-4 pt-[clamp(1.5rem,11vh,7rem)] sm:px-6 sm:pt-[clamp(2rem,14vh,9rem)]">
                          <div className="max-w-md text-center text-pretty sm:max-w-lg" aria-hidden>
                            <p className="text-base font-semibold leading-snug text-slate-800 sm:text-lg">
                              No initiatives in {focusedQuarter.label} yet
                            </p>
                            <p className="mt-2 text-sm font-normal leading-relaxed text-slate-600 sm:text-base">
                              Plan epics from the initiative list to fill this quarter.
                            </p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <StripedGanttLaneScrollArea
                        id={TIMELINE_GANTT_ROWS_CONTAINER_ID}
                        columnCount={ganttLaneColumnCount}
                        rowGapClass="space-y-2"
                      >
                        {quarterRoadmapInitiativeRows.map((group, idx) => (
                          <div
                            key={`q-init-row-${group.timelineRow}`}
                            className={cn(
                              "relative min-w-0 z-10 py-0.5",
                              idx < quarterRoadmapInitiativeRows.length - 1 && "border-b border-slate-200/50",
                            )}
                            data-gantt-lane-index={idx}
                            data-gantt-timeline-row={group.timelineRow}
                          >
                            <GanttLaneSprintBackdrop columnCount={ganttLaneColumnCount} />
                            <div className="relative z-[1] grid min-w-0 gap-2" style={ganttLaneGridStyle}>
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
                                      showProgress={showRoadmapProgress}
                                      onClick={() => onOpenInitiative(row.initiative.id)}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </StripedGanttLaneScrollArea>
                    )
                  ) : quarterRoadmapEpics.length === 0 ? (
                    <>
                      <p className="sr-only">
                        No epics are planned in {focusedQuarter.label} yet. Drag an epic from the initiative list onto
                        this quarter.
                      </p>
                      <StripedGanttLaneScrollArea
                        id={TIMELINE_GANTT_ROWS_CONTAINER_ID}
                        columnCount={ganttLaneColumnCount}
                        rowGapClass="space-y-0.5"
                      >
                        <div className="h-0 shrink-0 overflow-hidden" aria-hidden />
                      </StripedGanttLaneScrollArea>
                      <div className="pointer-events-none absolute inset-0 z-[20] flex justify-center px-4 pt-[clamp(1.5rem,11vh,7rem)] sm:px-6 sm:pt-[clamp(2rem,14vh,9rem)]">
                        <div className="max-w-md text-center text-pretty sm:max-w-lg" aria-hidden>
                          <p className="text-lg font-semibold leading-snug text-slate-800 sm:text-xl">
                            No epics in {focusedQuarter.label} yet
                          </p>
                          <p className="mt-2 text-sm font-normal leading-relaxed text-slate-600 sm:text-base">
                            Drag an epic from the initiative list onto this quarter.
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <StripedGanttLaneScrollArea
                      id={TIMELINE_GANTT_ROWS_CONTAINER_ID}
                      columnCount={ganttLaneColumnCount}
                      rowGapClass="space-y-0.5"
                    >
                      {quarterRoadmapEpicRows.map((group, idx) => (
                        <div
                          key={`q-epic-row-${group.timelineRow}`}
                          className={cn(
                            "relative min-w-0 z-10 py-0.5",
                            idx < quarterRoadmapEpicRows.length - 1 && "border-b border-slate-200/50",
                          )}
                          data-gantt-lane-index={idx}
                          data-gantt-timeline-row={group.timelineRow}
                        >
                          <GanttLaneSprintBackdrop columnCount={ganttLaneColumnCount} />
                          <div className="relative z-[1] grid min-w-0 gap-2" style={ganttLaneGridStyle}>
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
                              const isInitiativeEmphasis =
                                ganttEmphasis != null && ganttEmphasis.initiativeId === row.initiative.id;
                              const isEpicEmphasis = ganttEpicEmphasis != null && ganttEpicEmphasis.epicId === row.epic.id;
                              const isScheduledFilterEmphasis =
                                ganttScheduledFilterEmphasis != null && epicIsScheduledOnGantt(row.epic);
                              const emphasizeFlash =
                                isInitiativeEmphasis || isEpicEmphasis || isScheduledFilterEmphasis;
                              const emphasizeTick = isEpicEmphasis
                                ? ganttEpicEmphasis!.tick
                                : isInitiativeEmphasis
                                  ? ganttEmphasis!.tick
                                  : isScheduledFilterEmphasis
                                    ? ganttScheduledFilterEmphasis!.tick
                                    : 0;
                              const resizeEdgeClass =
                                "pointer-events-auto absolute inset-y-0.5 z-20 w-2.5 touch-none select-none rounded-md bg-white/0 transition-colors hover:bg-white/30 active:bg-white/40";
                              const qDayAbs = quarterBarAbsoluteDayPct(row.epic, row.startS, span, currentYear);
                              const qInset = qDayAbs ? null : epicBarDayInsetPct(row.epic, row.startS, row.endS, span, currentYear);
                              return (
                                <div
                                  key={`q-epic-${row.epic.id}`}
                                  ref={(node) => {
                                    if (node) barElsRef.current.set(row.epic.id, node);
                                    else barElsRef.current.delete(row.epic.id);
                                  }}
                                  className={cn("relative min-w-0 rounded-lg pt-0.5 pb-0", rz ? "z-0 opacity-70" : "z-20")}
                                  style={{ gridColumn: `${columnStart} / span ${span}`, gridRow: 1, minHeight: qDayAbs ? "2.5rem" : undefined }}
                                >
                                  {/* day-precision: absolute positioning for single-sprint bars, margin inset for multi-sprint.
                                      Handles live INSIDE this inner wrapper so they track the visual bar edges. */}
                                  <div
                                    className={qDayAbs ? "absolute top-0.5 bottom-0.5" : "relative"}
                                    style={
                                      qDayAbs
                                        ? { left: qDayAbs.left, right: qDayAbs.right }
                                        : { marginLeft: qInset?.left || undefined, marginRight: qInset?.right || undefined }
                                    }
                                  >
                                    <EpicPlanTimelineBar
                                      id={row.epic.id}
                                      title={row.epic.title}
                                      icon={row.epic.icon}
                                      color={row.epic.color?.trim() ? row.epic.color : row.initiative.color}
                                      progressPercent={completionPercent}
                                      progressLabel={stories.length > 0 ? `${finishedStories}/${stories.length} done or approved` : "No user stories"}
                                      isResizing={Boolean(rz)}
                                      emphasizeFlash={emphasizeFlash}
                                      emphasizeTick={emphasizeTick}
                                      showProgress={showRoadmapProgress}
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
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </StripedGanttLaneScrollArea>
                  )}
                  </div>
                </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      <div
        className={cn(
          "space-y-2",
          activeMonth == null &&
            quarterViewTab === "gantt" &&
            isFullYearGanttLayout &&
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden",
          hasContextSideMenu && "w-[calc(100%-4rem)] ml-[4rem]",
        )}
      >
        {activeMonth ? null : !focusedQuarter && quarterViewTab === "insights" ? (
          <MonthAnalytics
            initiatives={initiatives}
            month={1}
            periodMonths={MONTHS.map((_, i) => i + 1)}
            periodLabel="Year"
            planYear={currentYear}
            filterEpicTeamIds={insightsTeamIds.length ? insightsTeamIds : null}
            onOpenEpic={onOpenEpic}
            onOpenStory={onOpenStory ?? (() => {})}
            onOpenSprintKanban={(yearSprint, teamId) =>
              onEnterSprintStoryBoard?.(yearSprint, isKnownEpicTeamId(teamId) ? teamId : null)
            }
            initialSelectedEpicId={initialInsightsScopeEpicId ?? undefined}
            initialSelectedInitiativeId={initialInsightsScopeInitId ?? undefined}
            onScopeChange={(type, id) => onInsightsScopeChange?.(type === "epic" ? id : null, type === "initiative" ? id : null)}
          />
        ) : activeMonth ? null : focusedQuarter && quarterViewTab === "insights" ? (
          <MonthAnalytics
            initiatives={initiatives}
            month={focusedQuarter.months[0]}
            periodMonths={[...focusedQuarter.months]}
            periodLabel={focusedQuarter.label}
            planYear={currentYear}
            filterEpicTeamIds={insightsTeamIds.length ? insightsTeamIds : null}
            onOpenEpic={onOpenEpic}
            onOpenStory={onOpenStory ?? (() => {})}
            onOpenSprintKanban={(yearSprint, teamId) =>
              onEnterSprintStoryBoard?.(yearSprint, isKnownEpicTeamId(teamId) ? teamId : null)
            }
            initialSelectedEpicId={initialInsightsScopeEpicId ?? undefined}
            initialSelectedInitiativeId={initialInsightsScopeInitId ?? undefined}
            onScopeChange={(type, id) => onInsightsScopeChange?.(type === "epic" ? id : null, type === "initiative" ? id : null)}
          />
        ) : activeMonth ? null : !focusedQuarter && quarterViewTab === "capacity" ? (
          <QuarterTeamCapacityBoard
            initiatives={initiatives}
            quarterLabel={filteredCapacityQuarter?.label ?? ALL_QUARTERS_TEAM_CAPACITY_LABEL}
            quarterMonths={filteredCapacityQuarter?.months ?? ALL_YEAR_PLAN_MONTHS}
            year={currentYear}
            monthTeamCapacityByKey={monthTeamCapacityByKey}
            monthTeamBoardByKey={monthTeamBoardByKey}
            onCapacityChange={(teamId, totalDays) => {
              if (filteredCapacityQuarter) {
                onQuarterTeamCapacityChange?.(filteredCapacityQuarter.label, teamId, totalDays);
                return;
              }
              onYearTeamCapacityChange?.(teamId, totalDays);
            }}
            onOpenEpic={onOpenEpic}
            onRemoveEpicFromCapacity={(epicId) => onMonthTeamCapacityEpicRemove?.(epicId)}
            onEpicOriginalEstimateChange={(epicId, estimatedDays) =>
              onCapacityEpicOriginalEstimateChange?.(epicId, estimatedDays)
            }
            loadBasis="originalEstimate"
            teamFilterIds={capacityTeamFilterIds}
            teamSelectorSlot={
              <CapacityPlanTeamCombobox
                directoryUsers={workspaceDirectoryUsers}
                selectedIds={capacityTeamFilterIds}
                onSelectedIdsChange={setCapacityTeamFilterIds}
                search={capacityTeamSearch}
                onSearchChange={setCapacityTeamSearch}
                menuOpen={capacityTeamMenuOpen}
                onMenuOpenChange={setCapacityTeamMenuOpen}
                comboboxRef={capacityTeamFilterRef}
                ariaLabel="Filter year capacity by team (teams from user directory)"
              />
            }
          />
        ) : activeMonth ? null : focusedQuarter && quarterViewTab === "capacity" ? (
          <QuarterTeamCapacityBoard
            initiatives={initiatives}
            quarterLabel={focusedQuarter.label}
            quarterMonths={focusedQuarter.months}
            year={currentYear}
            monthTeamCapacityByKey={monthTeamCapacityByKey}
            monthTeamBoardByKey={monthTeamBoardByKey}
            onCapacityChange={(teamId, quarterTotalDays) =>
              onQuarterTeamCapacityChange?.(focusedQuarter.label, teamId, quarterTotalDays)
            }
            onOpenEpic={onOpenEpic}
            onRemoveEpicFromCapacity={(epicId) => onMonthTeamCapacityEpicRemove?.(epicId)}
            onEpicOriginalEstimateChange={(epicId, estimatedDays) =>
              onCapacityEpicOriginalEstimateChange?.(epicId, estimatedDays)
            }
            loadBasis="originalEstimate"
            teamFilterIds={capacityTeamFilterIds}
            teamSelectorSlot={
              <CapacityPlanTeamCombobox
                directoryUsers={workspaceDirectoryUsers}
                selectedIds={capacityTeamFilterIds}
                onSelectedIdsChange={setCapacityTeamFilterIds}
                search={capacityTeamSearch}
                onSearchChange={setCapacityTeamSearch}
                menuOpen={capacityTeamMenuOpen}
                onMenuOpenChange={setCapacityTeamMenuOpen}
                comboboxRef={capacityTeamFilterRef}
                ariaLabel="Filter quarter capacity by team (teams from user directory)"
              />
            }
          />
        ) : isFullYearGanttLayout ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              className={cn(
                "min-h-0 min-w-0 flex-1",
                !panelHScroll &&
                  yearRoadmapHScroll &&
                  "overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]",
              )}
            >
              <div
                className={cn("flex min-h-0 min-w-0 flex-col gap-2", yearRoadmapHScroll && "w-max")}
                style={
                  yearRoadmapHScroll
                    ? { minWidth: portfolioRoadmapHScrollContentMinWidthPx }
                    : undefined
                }
              >
                <div
                  className={cn(
                    "relative",
                    yearRoadmapHScroll ? "w-max max-w-full" : "w-full",
                    !yearRoadmapHScroll && "overflow-hidden",
                  )}
                >
                  <div className="relative z-[1] grid min-w-0 gap-2" style={yearQuarterHeaderGridStyle}>
                    {visibleQuarterHeaders.map((quarter) => (
                      <button
                        key={quarter.label}
                        type="button"
                        onClick={() => {
                          setFocusedMonth(null);
                          onFocusedQuarterChange(focusedQuarterLabel === quarter.label ? null : quarter.label);
                        }}
                        className={cn(
                          "flex w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-white/80 px-3 py-2.5 text-center text-[15px] font-semibold tracking-[0.02em] shadow-sm ring-1 ring-slate-200/30 transition duration-200",
                          focusedQuarterLabel === quarter.label
                            ? quarterTone[quarter.label]?.active ?? "border-primary/30 bg-primary/10 text-primary"
                            : quarterTone[quarter.label]?.idle ?? "border-border/40 bg-muted text-muted-foreground",
                        )}
                        style={{ gridColumn: `span ${quarter.months.length} / span ${quarter.months.length}` }}
                      >
                        <QuarterYearProgressIcon quarterLabel={quarter.label} />
                        <span>{focusedQuarter ? quarter.label : (QUARTER_ORDINAL_LABELS[quarter.label] ?? quarter.label)}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  className={cn(
                    "relative mb-0",
                    yearRoadmapHScroll ? "w-max max-w-full" : "w-full",
                    !yearRoadmapHScroll && "overflow-hidden",
                  )}
                >
                  <GanttTodayMarker
                    leftPercent={roadmapLaneTodayLeft}
                    showBadge={false}
                    badgePlacement="above"
                    prioritizeLabel
                    showLine={false}
                  />
                  <div
                    className={cn("grid min-w-0 gap-2", !yearRoadmapHScroll && "grid-cols-4")}
                    style={yearFullYearMonthStripGridStyle}
                  >
                    {QUARTERS.map((quarter) => (
                      <section
                        key={quarter.label}
                        className={cn(
                          "space-y-1 rounded-2xl border border-slate-200/50 bg-gradient-to-b from-white to-slate-50/40 pt-1.5 pb-0.5 shadow-sm ring-1 ring-black/[0.03]",
                          yearRoadmapHScroll ? "px-0" : "px-2.5",
                          quarterPanelTone[quarter.label] ?? "bg-slate-50/60 ring-slate-200",
                        )}
                      >
                        <div
                          className={cn("grid", !yearRoadmapHScroll && "grid-cols-3 gap-1.5", yearRoadmapHScroll && "gap-2")}
                          style={yearFullYearMonthInnerGridStyle}
                        >
                          {quarter.months.map((month) => (
                            <div key={month} className="space-y-1.5">
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center justify-center gap-1.5 rounded-xl border py-1.5 text-center text-[15px] font-bold tracking-tight ring-1 ring-black/[0.04] transition hover:-translate-y-px",
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
                              {showYearSprintChips ? (
                                <div className="grid grid-cols-2 gap-1.5">
                                  <SprintPlanDropButton
                                    month={month}
                                    lane={1}
                                    title={sprintLabelYearRoadmap(globalSprintFromMonthLane(month, 1))}
                                    onClick={() => {
                                      if (isPostDragClickSuppressed()) return;
                                      setFocusedMonth(month);
                                      onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, 1), null);
                                    }}
                                    className="flex h-5 items-center justify-center rounded-lg border border-white/70 bg-white/65 px-0.5 py-0 text-center ring-1 ring-slate-200/55 backdrop-blur-[1.5px] transition hover:-translate-y-px hover:bg-white/85 active:scale-[0.99]"
                                  >
                                    <span className="inline-flex items-baseline gap-[1px] leading-none text-slate-800">
                                      <span className="text-[11px] font-medium">S</span>
                                      <span className="text-[10px] font-medium tabular-nums">
                                        {globalSprintFromMonthLane(month, 1)}
                                      </span>
                                    </span>
                                  </SprintPlanDropButton>
                                  <SprintPlanDropButton
                                    month={month}
                                    lane={2}
                                    title={sprintLabelYearRoadmap(globalSprintFromMonthLane(month, 2))}
                                    onClick={() => {
                                      if (isPostDragClickSuppressed()) return;
                                      setFocusedMonth(month);
                                      onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, 2), null);
                                    }}
                                    className="flex h-5 items-center justify-center rounded-lg border border-white/70 bg-white/65 px-0.5 py-0 text-center ring-1 ring-slate-200/55 backdrop-blur-[1.5px] transition hover:-translate-y-px hover:bg-white/85 active:scale-[0.99]"
                                  >
                                    <span className="inline-flex items-baseline gap-[1px] leading-none text-slate-800">
                                      <span className="text-[11px] font-medium">S</span>
                                      <span className="text-[10px] font-medium tabular-nums">
                                        {globalSprintFromMonthLane(month, 2)}
                                      </span>
                                    </span>
                                  </SprintPlanDropButton>
                                </div>
                              ) : null}
                              <MonthDropCell month={month} />
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
                {fullYearRoadmapGanttTracks}
              </div>
            </div>
          </div>
        ) : (
          fullYearRoadmapGanttTracks
        )}
      </div>
      </div>
  );

  return (
    <div className="relative flex h-full min-h-0 min-w-0 w-full flex-col overflow-x-hidden overflow-y-hidden rounded-xl bg-card py-5 pl-5 pr-4 shadow-lg ring-1 ring-black/5">
      <div ref={yearRoadmapMeasureRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {panelHScroll ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]">
            <div
              className="flex min-h-0 min-w-0 w-max min-w-full flex-1 flex-col"
              style={panelScrollMinWidthPx != null ? { minWidth: panelScrollMinWidthPx } : undefined}
            >
              <div className={cn("shrink-0 min-w-0", hasContextSideMenu && "pl-[4rem]")}>
                {timelineHeaderRow}
              </div>
              {planningSurface}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0">{timelineHeaderRow}</div>
            {planningSurface}
          </div>
        )}
      </div>
      {estEpicsPanelOpen ? (
        <div className="pointer-events-none fixed inset-0 z-[140]">
          <div
            className="pointer-events-auto absolute inset-0 bg-transparent"
            onClick={() => closeEstEpicsPanel()}
          />
          <aside
            className={cn(
              "fixed flex min-h-0 flex-col border-l border-slate-200 bg-white p-4 pb-6 shadow-[0_8px_30px_-8px_rgba(15,23,42,0.12)] transition-transform duration-300 ease-out",
              estEpicsPanelEntered ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{
              width: `${estEpicsPanelWidthPx}px`,
              maxWidth: "99vw",
              right: `${estEpicsPanelPosition.right}px`,
              top: `${estEpicsPanelPosition.top}px`,
              height: "100vh",
              transform: estEpicsPanelEntered ? "translateX(0)" : "translateX(100%)",
            }}
          >
            <div
              className="absolute inset-y-0 left-0 z-20 w-2.5 cursor-col-resize bg-transparent hover:bg-slate-200/90"
              onPointerDown={beginEstimateCoverageResize}
              aria-label="Resize epic estimation coverage panel"
              role="separator"
            />
            <div
              className="absolute inset-y-0 right-0 z-20 w-2.5 cursor-col-resize bg-transparent hover:bg-slate-200/90"
              onPointerDown={beginEstimateCoverageResizeRight}
              aria-label="Resize epic estimation coverage panel from right"
              role="separator"
            />
            <div
              className="mb-4 flex shrink-0 cursor-move items-center justify-between pb-1"
              onPointerDown={beginEstimateCoverageDrag}
            >
              <div className="flex items-start gap-2.5">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-fuchsia-100 text-fuchsia-700 ring-1 ring-fuchsia-200 sm:h-9 sm:w-9">
                  <PieChart className="size-4 sm:size-[1.125rem]" />
                </span>
                <div>
                  <h3 className="text-[22px] font-bold leading-tight text-slate-900 sm:text-2xl">
                    Epic Estimation Coverage
                  </h3>
                  <p className="mt-1 text-[14px] text-slate-500">
                    Scope: {estimatePanelScopeLabel} · {estimatedEpicsPercentForScope}% estimated
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => closeEstEpicsPanel()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
                aria-label="Close estimated epics panel"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <nav
                className="mb-4 flex shrink-0 flex-wrap gap-1.5 overflow-x-auto"
                aria-label="Estimation coverage tables"
              >
                {(
                  [
                    {
                      id: "unestimated" as const,
                      label: "Unestimated epics",
                      count: scopedEpicsForEstimatePanel.unestimated.length,
                    },
                    {
                      id: "estimated" as const,
                      label: "Estimated epics",
                      count: scopedEpicsForEstimatePanel.estimated.length,
                    },
                    {
                      id: "epicsNoDesc" as const,
                      label: "Epics · no description",
                      count: scopedEpicsWithoutDescription.length,
                    },
                    {
                      id: "storiesNoDesc" as const,
                      label: "Stories · no description",
                      count: scopedStoriesWithoutDescription.length,
                    },
                  ] as const
                ).map((tab) => {
                  const active = estimateCoveragePanelTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setEstimateCoveragePanelTab(tab.id)}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors",
                        active
                          ? "bg-fuchsia-100 text-fuchsia-900 ring-1 ring-fuchsia-300/80"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900",
                      )}
                    >
                      <span className="whitespace-nowrap">{tab.label}</span>
                      <span
                        className={cn(
                          "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[12px] tabular-nums font-bold",
                          active ? "bg-fuchsia-200 text-fuchsia-800" : "bg-slate-200 text-slate-500",
                        )}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </nav>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                {estimateCoveragePanelTab === "unestimated" ? (
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex shrink-0 items-center justify-between gap-2 bg-[#0897d5] px-3 py-2.5">
                      <p className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-white">
                        <ClipboardList className="size-4 shrink-0 text-white/90" strokeWidth={2.2} />
                        <span className="truncate">Unestimated epics</span>
                      </p>
                      <span
                        className="inline-flex h-6 shrink-0 items-center gap-0.5 px-0.5"
                        role="group"
                        aria-label="Unestimated epics expand and collapse"
                      >
                        <button
                          type="button"
                          onClick={() => collapseEstimatePanelRows("unestimated")}
                          title="Collapse all rows"
                          aria-label="Collapse all unestimated epic rows"
                          className="inline-flex h-5 w-5 items-center justify-center text-white/90 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          <ChevronsUp className="size-3.5" strokeWidth={2.2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => expandEstimatePanelRows("unestimated")}
                          title="Expand all rows"
                          aria-label="Expand all unestimated epic rows"
                          className="inline-flex h-5 w-5 items-center justify-center text-white/90 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          <ChevronsDown className="size-3.5" strokeWidth={2.2} />
                        </button>
                      </span>
                    </div>
                    <div className="overflow-x-auto bg-white">
                      {renderEstimatePanelTable(scopedEpicsForEstimatePanel.unestimated, "unestimated")}
                    </div>
                  </section>
                ) : estimateCoveragePanelTab === "estimated" ? (
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex shrink-0 items-center justify-between gap-2 bg-[#0897d5] px-3 py-2.5">
                      <p className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-white">
                        <BarChart3 className="size-4 shrink-0 text-white/90" strokeWidth={2.2} />
                        <span className="truncate">Estimated epics</span>
                      </p>
                      <span
                        className="inline-flex h-6 shrink-0 items-center gap-0.5 px-0.5"
                        role="group"
                        aria-label="Estimated epics expand and collapse"
                      >
                        <button
                          type="button"
                          onClick={() => collapseEstimatePanelRows("estimated")}
                          title="Collapse all rows"
                          aria-label="Collapse all estimated epic rows"
                          className="inline-flex h-5 w-5 items-center justify-center text-white/90 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          <ChevronsUp className="size-3.5" strokeWidth={2.2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => expandEstimatePanelRows("estimated")}
                          title="Expand all rows"
                          aria-label="Expand all estimated epic rows"
                          className="inline-flex h-5 w-5 items-center justify-center text-white/90 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          <ChevronsDown className="size-3.5" strokeWidth={2.2} />
                        </button>
                      </span>
                    </div>
                    <div className="overflow-x-auto bg-white">
                      {renderEstimatePanelTable(scopedEpicsForEstimatePanel.estimated, "estimated")}
                    </div>
                  </section>
                ) : estimateCoveragePanelTab === "epicsNoDesc" ? (
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex shrink-0 items-center gap-2 bg-[#0897d5] px-3 py-2.5">
                      <p className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-white">
                        <FileWarning className="size-4 shrink-0 text-white/90" strokeWidth={2.2} />
                        <span className="truncate">Epics without description</span>
                      </p>
                    </div>
                    <div className="overflow-x-auto bg-white">
                      {renderEpicsWithoutDescriptionTable(scopedEpicsWithoutDescription)}
                    </div>
                  </section>
                ) : (
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex shrink-0 items-center gap-2 bg-[#0897d5] px-3 py-2.5">
                      <p className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-white">
                        <FileWarning className="size-4 shrink-0 text-white/90" strokeWidth={2.2} />
                        <span className="truncate">User stories without description</span>
                      </p>
                    </div>
                    <div className="overflow-x-auto bg-white">
                      {renderStoriesWithoutDescriptionTable(scopedStoriesWithoutDescription)}
                    </div>
                  </section>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
