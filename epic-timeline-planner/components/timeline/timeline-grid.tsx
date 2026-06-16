"use client";

import { useDndContext, useDroppable } from "@dnd-kit/core";
import {
  Activity,
  AlertTriangle,
  ArrowRightCircle,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  ClipboardList,
  FileDown,
  FileText,
  FileWarning,
  Filter,
  Flag,
  Funnel,
  Folder,
  HeartPulse,
  Inbox,
  Info,
  KanbanSquare,
  Lock,
  Pencil,
  Send,
  Map as MapIcon,
  MapPin,
  SquarePen,
  PieChart,
  Plus,
  Search,
  Thermometer,
  Trash2,
  User,
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
import { createPortal } from "react-dom";

import { EpicPlanTimelineBar, InitiativeTimelineBar, OverdueSlipDecoration, buildGanttBarDateRange } from "@/components/timeline/epic-timeline-bar";
import { RoadmapSelector } from "@/components/timeline/roadmap-selector";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { UserAvatar, resolveAssigneeAvatar } from "@/components/ui/user-avatar";
import { HealthBadge, formatHealthTooltip } from "@/components/timeline/health-badge";
import { RoadmapHealthPopover, type ProgressBasis } from "@/components/timeline/roadmap-health-popover";
import { computeInitiativeProgress, computeProgress, type HealthStatus } from "@/lib/progress";
import { effectiveEpicStart } from "@/lib/epic-observed-start";
import { computeEpicHealthVerdict, computeInitiativeHealthVerdict } from "@/lib/epic-health";
import { rollupWorkflowStatus } from "@/lib/workflow-rollup";
import { isPostDragClickSuppressed } from "@/components/timeline/drag-context";
import { MonthAnalytics, MonthAnalyticsSkeleton } from "@/components/timeline/month-analytics";
import { CapacityPlanTeamCombobox } from "@/components/timeline/capacity-plan-team-combobox";
import { MonthTeamCapacityBoard } from "@/components/timeline/month-team-capacity";
import { QuarterTeamCapacityBoard } from "@/components/timeline/quarter-team-capacity";
import { SprintAnalytics } from "@/components/timeline/sprint-analytics";
import { SprintCapacityBoard } from "@/components/timeline/sprint-capacity";
import { SprintEndCountdown } from "@/components/timeline/sprint-end-countdown";
import { PeriodEndCountdown } from "@/components/timeline/period-end-countdown";
import { SprintKanbanBoard } from "@/components/timeline/sprint-kanban";
import { SprintRetrospectiveEditor, SprintRetrospectiveChartRow, type SprintRetrospectiveDoc } from "@/components/timeline/sprint-retrospective";
import { QuarterYearProgressIcon } from "@/components/ui/quarter-year-progress-icon";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { computeSprintKanbanSummaryStats, collectStoriesForSprintBoard, collectEpicsForSprintKanban, storyMatchesYearSprint } from "@/lib/sprint-plan";
import { buildSprintAnalytics } from "@/lib/sprint-analytics";
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
import { exportYearGanttToPrintableWindow } from "@/lib/year-gantt-pdf";
import {
  epicDeliveryTeamAssignmentChip,
  MONTH_TEAM_COLUMNS,
  MONTH_TEAM_IDS,
  isKnownEpicTeamId,
  monthTeamBoardStorageKey,
  monthTeamLabelForId,
  type MonthTeamBoardPersisted,
} from "@/lib/month-team-board";
import { EpicItem, InitiativeItem, type UserStoryItem, type RoadmapItem } from "@/lib/types";
import {
  capacityPlanTeamCatalogFromDirectory,
  normalizeWorkspaceUserTeam,
  teamLabelForWorkspaceUser,
} from "@/lib/workspace-users";
import {
  clampYearSprint,
  currentWorkYearSprintForPlan,
  firstGlobalSprintForMonth,
  globalSprintFromMonthLane,
  monthLaneFromGlobalSprint,
  monthRangeFromYearSprintRange,
  resolvedInitiativeYearSprintBounds,
  resolveStoryYearSprint,
  sprintEndDate,
  sprintStartDate,
  yearSprintContainingInstant,
  YEAR_SPRINT_MAX,
} from "@/lib/year-sprint";
import { nowMs as clockNowMs } from "@/lib/clock";
import { collectMovableStoriesForSprint } from "@/lib/sprint-close-move";
import { collectStoriesRolledIntoSprint, collectStoriesRolledOutOfSprint } from "@/lib/story-rollover-history";
import { RolledInStoriesModal } from "@/components/timeline/rolled-in-stories-modal";
import { cn } from "@/lib/utils";

export type InitiativeScheduleRangePatch = {
  startMonth: number;
  endMonth: number;
  startYearSprint: number;
  endYearSprint: number;
};

/**
 * Opens the insights view (Epic Scope Burnup etc.) in a new tab, scoped to a
 * specific epic or initiative. Used by the chart-icon button on Gantt bars
 * and by the chart button in both the epic and initiative dialogs.
 *
 * Passes the raw UUID via `epicId` / `initiativeId` — the server route also
 * accepts a display ID like `EPIC-01` but UUIDs sidestep any display-ID
 * ordering drift between client and server.
 */
function openInsightsTab(kind: "epic" | "initiative", id: string) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (kind === "epic") params.set("epicId", id);
  else params.set("initiativeId", id);
  // Carry over a handful of context params so the insights page can pick up
  // the same period / sprint context the user was viewing.
  const cur = new URLSearchParams(window.location.search);
  for (const key of ["month", "planTab", "sprint"] as const) {
    const v = cur.get(key);
    if (v) params.set(key, v);
  }
  params.set("sprintView", "epic-insights");
  window.open(`/epic-insights?${params.toString()}`, "_blank");
}

/**
 * Defer-mount heavy subtrees (e.g. the Insights panel) with a crossfade so the
 * user sees a sized skeleton instantly and then a smooth fade into the real
 * tree once it has laid out — no skeleton → content "pop".
 *
 * Phases:
 *  1. `placeholder` — only the skeleton is mounted; click feels instant.
 *  2. `settling`    — children mount underneath (opacity 0) so React commits
 *     the heavy tree off-screen while the skeleton is still painted on top.
 *  3. `ready`       — fade out the skeleton + fade in the children together.
 *  4. `review`        — skeleton unmounts after the fade completes.
 *
 * The two stacked rAFs in step 2 → 3 give charts a paint to measure with
 * `ResponsiveContainer` before the fade-in starts. Without that buffer, the
 * fade would also be revealing the chart-settling jank we're trying to hide.
 */
const DEFERRED_MOUNT_FADE_MS = 160;
function DeferredMount({
  placeholder,
  children,
}: {
  placeholder: ReactNode;
  children: ReactNode;
}) {
  type Phase = "placeholder" | "settling" | "ready" | "done";
  const [phase, setPhase] = useState<Phase>("placeholder");

  useEffect(() => {
    if (phase !== "placeholder") return;
    const id = requestAnimationFrame(() => setPhase("settling"));
    return () => cancelAnimationFrame(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "settling") return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPhase("ready"));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "ready") return;
    const t = window.setTimeout(() => setPhase("done"), DEFERRED_MOUNT_FADE_MS + 20);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === "placeholder") return <>{placeholder}</>;
  if (phase === "done") return <>{children}</>;

  const fadeIn = phase === "ready";
  return (
    <div className="relative">
      {/* Real content — stays mounted from `settling` on; fades up to 1 in `ready`. */}
      <div
        className="transition-opacity ease-out"
        style={{
          opacity: fadeIn ? 1 : 0,
          transitionDuration: `${DEFERRED_MOUNT_FADE_MS}ms`,
        }}
      >
        {children}
      </div>
      {/* Skeleton — overlayed on top, fades to 0 in `ready`, then unmounts in `review`. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity ease-out",
          fadeIn && "pointer-events-none",
        )}
        style={{
          opacity: fadeIn ? 0 : 1,
          transitionDuration: `${DEFERRED_MOUNT_FADE_MS}ms`,
        }}
      >
        {placeholder}
      </div>
    </div>
  );
}

/** Vertical sprint columns + subtle month pairs (2 sprints) for roadmap Gantt lanes. */
function GanttLaneSprintBackdrop({
  columnCount,
  className,
}: {
  columnCount: number;
  className?: string;
  /** Accepted for back-compat — the day-subdivision vertical guides used
   *  to be drawn here, but the month view no longer renders them. */
  daySubdivisions?: readonly number[];
}) {
  if (columnCount <= 0) return null;
  return (
    <div
      className={cn("pointer-events-none absolute inset-0 z-0 flex w-full gap-2", className)}
      aria-hidden
    >
      {Array.from({ length: columnCount }, (_, i) => (
        <div
          key={i}
          className="relative min-h-full min-w-0 flex-1"
        />
      ))}
    </div>
  );
}

/** Faint horizontal rules in the roadmap lane "tail" (empty space below the last row). */
function StripedGanttHorizontalGuides() {
  return null;
}

/** Scrollable roadmap lane: each row should include GanttLaneSprintBackdrop with the same column count. */
function StripedGanttLaneScrollArea({
  id,
  columnCount,
  rowGapClass,
  // Default min-height keeps the lane at least one viewport tall (minus
  // the calendar chrome above) so the panel always feels "page-sized";
  // content can grow taller, in which case the scroll-container below
  // gives it an internal vertical scrollbar.
  minHeightStyle = { minHeight: "max(100%, calc(100dvh - 26rem))" },
  noScrollbar = false,
  children,
}: {
  id?: string;
  columnCount: number;
  rowGapClass: string;
  /** Override when the surrounding chrome differs (e.g. month sprint header). */
  minHeightStyle?: CSSProperties;
  noScrollbar?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className={cn(
        // Internal vertical scroll — the Gantt panel above caps at the
        // body row height; rows beyond that scroll inside this element.
        // Blue scrollbar styling matches the rest of the app's blue
        // scrollbar accent.
        // `overscroll-auto` lets the wheel scroll chain up once this
        // inner lane hits its top/bottom boundary.
        "relative z-10 flex min-h-0 basis-0 flex-1 flex-col overflow-y-auto overscroll-auto",
        // Force a visible scrollbar (macOS auto-hide otherwise leaves
        // it invisible until the user starts scrolling). `scrollbar-
        // width: thin` keeps Firefox happy; the webkit rules give
        // Chrome/Safari an always-visible blue thumb.
        "[scrollbar-width:thin] [scrollbar-color:#3b82f6_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-blue-500 hover:[&::-webkit-scrollbar-thumb]:bg-blue-600",
        noScrollbar && "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
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
/** Matches `pl-[2.75rem]` / `ml-[2.75rem]` when the context rail is shown so scroll width fits the sprint grid. */
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

/** Full-year / all-quarters Gantt: vertical "today" line with triangles at top and bottom. `leftPercent` accepts a CSS string (e.g. a gap-aware calc) so the marker lands inside the right column instead of falling in the inter-column gutter. */
function YearRoadmapTodayLine({ leftPercent }: { leftPercent: string | null }) {
  if (leftPercent == null) return null;
  return (
    // z-30 keeps the marker above the lanes (which sit at z-10) when
    // it's rendered as a sibling of the scroll container.
    // `-bottom-3` bleeds the wrapper 12px past the panel's content box
    // so the bottom arrow lands flush with the panel's visual bottom
    // edge instead of stopping inside the trailing padding.
    <div
      className="pointer-events-none absolute top-0 -bottom-[12px] z-[60] overflow-visible"
      style={{ left: leftPercent }}
      aria-hidden
    >
      {/* down-pointing triangle at top */}
      <div
        className="absolute h-[10px] w-[12px] -translate-x-1/2 bg-emerald-500"
        style={{ left: 0, top: 0, clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
      />
      {/* vertical line — starts right under the down triangle */}
      <div
        className="absolute w-px -translate-x-1/2 bg-emerald-500/85"
        style={{ left: 0, top: 8, bottom: 0 }}
      />
      {/* up-pointing triangle at bottom */}
      <div
        className="absolute h-[10px] w-[12px] -translate-x-1/2 bg-emerald-500"
        style={{ left: 0, bottom: 0, clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)" }}
      />
    </div>
  );
}

/** All-quarters roadmap with no rows: striped lane plus a centered empty message. */
function YearRoadmapEmptyStripedLane({
  currentYear,
  roadmapLaneTodayLeft,
  columnCount,
  variant,
  isDragging,
}: {
  currentYear: number;
  roadmapLaneTodayLeft: string | null;
  columnCount: number;
  variant: "initiatives" | "epics";
  isDragging?: boolean;
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
          minHeightStyle={{ flex: "1 1 0", minHeight: 0 }}
        >
          <div className="h-0 shrink-0 overflow-hidden" aria-hidden />
        </StripedGanttLaneScrollArea>
        {/* Empty-state grid overlay — paints column dividers using the SAME
            styling as the populated-state GanttLaneSprintBackdrop so the
            grid reads consistently whether or not epics are scheduled.
            Pointer-events-none so it doesn't block the popup above. */}
        <div
          className="pointer-events-none absolute inset-0 z-[5] flex w-full gap-2 pl-2 pr-1 pb-3 sm:pb-4"
          aria-hidden
        >
          {Array.from({ length: columnCount }, (_, i) => (
            <div
              key={i}
              className={cn(
                "min-w-0 flex-1",
                i < columnCount - 1 && "border-r border-slate-100/60",
              )}
            />
          ))}
        </div>
        <div className={cn(
          "pointer-events-none absolute inset-x-3 top-16 z-[21] flex justify-center transition-opacity duration-200",
          isDragging ? "opacity-0" : "opacity-100",
        )}>
          <div
            className="flex max-w-2xl items-center gap-6 rounded-3xl border border-slate-200/70 bg-gradient-to-br from-white via-white to-indigo-50/30 px-8 py-6 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.20),0_4px_10px_-4px_rgba(15,23,42,0.10)] ring-1 ring-slate-100/80"
            aria-hidden
          >
            {/* Illustrated icon pair — calendar with a flag, dashed path,
                map pin. Mirrors the empty-state mockup. */}
            <div className="relative shrink-0">
              <div className="flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 via-indigo-100 to-violet-100 ring-1 ring-indigo-200/60 shadow-sm">
                <CalendarDays className="size-9 text-indigo-500" strokeWidth={1.75} aria-hidden />
                <Flag
                  className="absolute left-7 top-9 size-4 text-indigo-600 drop-shadow-sm"
                  strokeWidth={2.25}
                  fill="currentColor"
                  aria-hidden
                />
              </div>
              {/* Dashed connector + map-pin destination */}
              <svg
                className="pointer-events-none absolute -bottom-2 -right-7 h-12 w-16 text-indigo-300"
                viewBox="0 0 64 48"
                fill="none"
                aria-hidden
              >
                <path
                  d="M2 26 C 16 38, 36 36, 52 24"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="3 4"
                  strokeLinecap="round"
                />
                <circle cx="2" cy="26" r="2.5" fill="currentColor" />
              </svg>
              <MapPin
                className="absolute -right-6 -top-1 size-7 text-violet-500 drop-shadow-md"
                strokeWidth={1.75}
                fill="currentColor"
                fillOpacity={0.25}
                aria-hidden
              />
            </div>
            {/* Copy */}
            <div className="min-w-0">
              {variant === "initiatives" ? (
                <>
                  <p className="text-[20px] font-extrabold leading-tight tracking-tight text-slate-900">
                    No initiatives scheduled for {currentYear}
                  </p>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-slate-500">
                    Add epics from your initiative list to build out the roadmap timeline.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[20px] font-extrabold leading-tight tracking-tight text-slate-900">
                    No epics on the {currentYear} roadmap yet
                  </p>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-slate-500">
                    Drag an epic from the initiative list onto the timeline to get started.
                  </p>
                </>
              )}
            </div>
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
  const finishedStories = stories.filter((story) => story.status === "review" || story.status === "done").length;
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
              "relative min-w-0 rounded-lg pt-2 pb-2",
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
                totalStories > 0 ? `${finishedStories}/${totalStories} review or done` : "No user stories"
              }
              isResizing={Boolean(rz)}
              emphasizeFlash={emphasize}
              emphasizeTick={emphasizeTick}
              showProgress={showProgress}
              onClick={() => onOpenInitiative(initiative.id)}
              onInsightsClick={() => (onOpenInsights ?? openInsightsTab)("initiative", initiative.id)}
              tooltipDateRange={buildGanttBarDateRange(
                initiative.year,
                initiative.startMonth,
                null,
                initiative.year,
                initiative.endMonth ?? initiative.startMonth,
                null,
              )}
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

/** Epic is scheduled on the Gantt (matches "Scheduled" quick-filter semantics). */
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
  teamAssignmentChip?: { label: string; className: string; slug: string | null } | null;
  /** Work-based health verdict for the epic — feeds the health badge below
   *  the bar. Passed in pre-computed so all views share one progress lib. */
  healthStatus?: HealthStatus | null;
  healthTooltip?: string;
  /** Effort-based progress percent to show on the bar's chip. Defaults to
   *  null which makes the bar fall back to the story-count formula. */
  effortProgressPercent?: number | null;
  /** Forwarded to the bar — dims it when the cross-mode highlight filter
   *  is active and this epic isn't in the highlighted set. */
  dimmed?: boolean;
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

/**
 * How far through `globalSprint`'s [start, end] window today's instant sits, in [0, 1].
 *
 * Quantized to the start of the local calendar day so SSR + the subsequent client hydration produce the same
 * value within a 24h window. Sub-second variations between `new Date()` calls would otherwise emit slightly
 * different CSS `calc(...)` strings and trip React's hydration mismatch detector.
 */
function dayFractionWithinSprint(planYear: number, globalSprint: number, now: Date): number {
  const s = sprintStartDate(planYear, globalSprint).getTime();
  const e = sprintEndDate(planYear, globalSprint).getTime();
  if (e <= s) return 0;
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = Math.max(s, Math.min(e, dayStart));
  return (t - s) / (e - s);
}

/**
 * Roll the epic's child story statuses up into the same enum
 * (`todo|inProgress|review|done`) the epic dialog displays. Matches
 * `derivedEpicStatus` in epic-form-dialog so the Gantt bar pill, the
 * dialog header, and the left-panel epic card all read the same status.
 * Returns null when the epic has zero stories.
 */
function deriveEpicStatusKey(epic: EpicItem): UserStoryItem["status"] | null {
  const stories = epic.userStories ?? [];
  if (stories.length === 0) return null;
  const counts = { todo: 0, inProgress: 0, review: 0, done: 0 };
  for (const s of stories) {
    if (s.status === "todo" || s.status === "inProgress" || s.status === "review" || s.status === "done") {
      counts[s.status] += 1;
    }
  }
  // Roll-up priority (most active state wins, then "done" once nothing
  // is in flight). This is what the Work Progress donut's filter chip
  // uses, so picking "Done" surfaces every epic whose work is finished
  // (all stories done OR a mix of done + review with at least one done
  // — i.e. shipped + still being signed off), "Review / Testing"
  // surfaces epics fully sitting in QA, and "In Progress" surfaces any
  // epic with active work.
  if (counts.inProgress > 0) return "inProgress";
  if (counts.done === stories.length) return "done";
  if (counts.done > 0 && counts.todo === 0) return "done";
  if (counts.review === stories.length) return "review";
  if (counts.review > 0 && counts.todo === 0) return "review";
  if (counts.done > 0 || counts.review > 0) return "inProgress";
  return "todo";
}

/**
 * Initiative-level workflow rollup — flattens stories across every
 * child epic and folds via the canonical `rollupWorkflowStatus`
 * helper. Matches the Hero's Work Progress donut at initiative scope,
 * which calls the same helper with the same all-stories flatten.
 * Returns null only when the initiative has zero stories anywhere.
 */
function deriveInitiativeStatusKey(initiative: InitiativeItem): UserStoryItem["status"] | null {
  return rollupWorkflowStatus((initiative.epics ?? []).flatMap((e) => e.userStories ?? []));
}

/**
 * Bar's TRUE planned end as a wall-clock timestamp — respects
 * `planEndDay` (day-precision) when present, otherwise falls back to
 * the sprint's last day. Single source of truth for "is past plan"
 * across the gantt: the overdue badge, the ghost extension, and
 * everything else should agree with what the planner SEES on screen.
 *
 * Without the day-precision read, an epic stretched so its bar
 * visually ends on the 8th of a month (via `planEndDay = 8`) would
 * still be flagged "overdue" only after the whole sprint ends on the
 * 15th — and the ghost would render in the next sprint even though
 * the bar's right edge sits past today.
 */
function epicPlannedEndMs(epic: EpicItem, planYear: number): number | null {
  if (epic.planEndMonth == null) return null;
  const endLane: 1 | 2 = epic.planEndSprint === 1 ? 1 : 2;
  const sprintFirstDay = endLane === 1 ? 1 : 16;
  const sprintLastDay =
    endLane === 1 ? 15 : new Date(planYear, epic.planEndMonth, 0).getDate();
  const rawEndDay = epic.planEndDay;
  const endDay =
    rawEndDay != null && rawEndDay >= sprintFirstDay && rawEndDay <= sprintLastDay
      ? rawEndDay
      : sprintLastDay;
  return new Date(planYear, epic.planEndMonth - 1, endDay, 23, 59, 59, 999).getTime();
}

/**
 * True when an epic's plan window has passed AND the rolled-up status
 * isn't `done`. Drives the inline `Overdue` indicator on the Gantt epic
 * bars so a roadmap row reads as late even when child stories' days have
 * all burned down but the epic is still sitting in Review awaiting close.
 */
function epicIsOverdueByPlan(epic: EpicItem, planYear: number): boolean {
  const status = deriveEpicStatusKey(epic);
  if (status === "done" || status == null) return false;
  const planEndMs = epicPlannedEndMs(epic, planYear);
  if (planEndMs == null) return false;
  return clockNowMs() > planEndMs;
}

/**
 * Latest year-sprint that contains an OPEN story of this epic AND is
 * strictly AFTER the epic's planned end sprint. This is the new
 * source-of-truth for the ghost's right edge in `extend` mode:
 * the ghost says "work is scheduled in this sprint past the plan,"
 * and it ends where that scheduled work ends — not at an abstract
 * `today + Σ daysLeft` projection.
 *
 * Returns `null` when no story is sprinted past the plan — in that
 * case the bar still gets its severity border + slip icon, but no
 * stripe extension (nothing concrete to point at).
 */
function epicLatestLateSprint(
  epic: EpicItem,
  planEndGlobalSprint: number,
): number | null {
  const contextMonth = epic.planStartMonth ?? 1;
  let latest = -Infinity;
  const openStorySprints: number[] = [];
  for (const story of epic.userStories ?? []) {
    if (story.status === "done") continue;
    const s = resolveStoryYearSprint(story, contextMonth);
    if (s == null) continue;
    openStorySprints.push(s);
    if (s <= planEndGlobalSprint) continue;
    if (s > latest) latest = s;
  }
  return latest === -Infinity ? null : latest;
}

/**
 * Computes the days-past-plan + projected-real-end metadata for an epic
 * whose `planEnd` is in the past. Returns null when the epic isn't
 * overdue (plan still in the future, no plan, or already done). Used
 * by the overdue banner + the Gantt's slip-icon / ghost-extension
 * visuals — single source of truth so all surfaces agree on the math.
 *
 *  - `daysPastPlan`        — calendar days between `planEnd` and `today`
 *  - `projectedDaysLeft`   — sum of `daysLeft` across all OPEN stories
 *                            (status !== "done"). 0 when nothing is open.
 *  - `projectedEndMs`      — today + projectedDaysLeft (in ms). When 0
 *                            open work remains, equals today.
 */
function epicOverdueMeta(
  epic: EpicItem,
  planYear: number,
): { daysPastPlan: number; projectedDaysLeft: number; projectedEndMs: number; planEndMs: number } | null {
  if (!epicIsOverdueByPlan(epic, planYear)) return null;
  // Single source of truth for "planned end" — respects `planEndDay`
  // so the days-past-plan math matches the bar's visible right edge.
  const planEndMs = epicPlannedEndMs(epic, planYear);
  if (planEndMs == null) return null;
  const nowMs = clockNowMs();
  const daysPastPlan = Math.max(0, Math.floor((nowMs - planEndMs) / 86400000));
  const openStories = (epic.userStories ?? []).filter((s) => s.status !== "done");
  const projectedDaysLeft = openStories.reduce((sum, s) => sum + Math.max(0, s.daysLeft ?? 0), 0);
  const projectedEndMs = nowMs + projectedDaysLeft * 86400000;
  return { daysPastPlan, projectedDaysLeft, projectedEndMs, planEndMs };
}

/**
 * Effective right edge of an epic in year-sprint space, INCLUDING the
 * ghost extension drawn past its planned end when the epic is overdue.
 * Used by the row-packer to detect ghost-on-bar collisions inside the
 * same row — non-overdue epics fall through to their normal `endS`.
 *
 * Ghost-only rows ALREADY have `endS` = last in-quarter sprint with
 * open work (see `epicQuarterFootprint`) — that IS the visible right
 * edge, so we skip the projected-end extension to keep the collision
 * range honest. Without this, an epic whose Q2 footprint is just S7
 * (one sprint) but whose `projectedDaysLeft` math points at S20 would
 * displace every neighbour from S8 onward — visually a long, invisible
 * collision zone.
 */
function epicVirtualEndS(
  epic: EpicItem,
  planYear: number,
  planEndS: number,
  isGhostOnly: boolean = false,
): number {
  if (isGhostOnly) return planEndS;
  const meta = epicOverdueMeta(epic, planYear);
  if (!meta || meta.projectedDaysLeft <= 0) return planEndS;
  const projectedSprint = yearSprintContainingInstant(planYear, meta.projectedEndMs);
  if (projectedSprint == null) return YEAR_SPRINT_MAX;
  return Math.max(planEndS, projectedSprint);
}

/**
 * Sprint range + open daysLeft of an epic's stories that are scheduled
 * inside `[qLo, qHi]` (the visible quarter). Returns `null` when NO
 * open story of the epic is sprinted into the quarter — that's the
 * "gate" that prevents a ghost-only row from showing for an overdue
 * epic whose stories are still parked in a prior quarter (or
 * unsprinted). Matches the burndown's Rule 2 (delivery-in-period) so
 * the gantt and insights agree on what counts as Q-work.
 *
 * - `firstSprint` / `lastSprint`: contiguous range used as the ghost's
 *   visible left / right edges (clamped by the caller to qLo / qHi).
 * - `inQDaysLeft`: sum of `daysLeft` across in-quarter OPEN stories —
 *   feeds the slip-icon tooltip so the projection number matches what
 *   the ghost visually represents (not the epic's full open work).
 */
function epicQuarterFootprint(
  epic: EpicItem,
  qLo: number,
  qHi: number,
): { firstSprint: number; lastSprint: number; inQDaysLeft: number } | null {
  const contextMonth = epic.planStartMonth ?? 1;
  let firstSprint: number | null = null;
  let lastSprint: number | null = null;
  let inQDaysLeft = 0;
  for (const story of epic.userStories ?? []) {
    if (story.status === "done") continue;
    const s = resolveStoryYearSprint(story, contextMonth);
    if (s == null) continue;
    if (s < qLo || s > qHi) continue;
    if (firstSprint == null || s < firstSprint) firstSprint = s;
    if (lastSprint == null || s > lastSprint) lastSprint = s;
    inQDaysLeft += Math.max(0, story.daysLeft ?? 0);
  }
  if (firstSprint == null || lastSprint == null) return null;
  return { firstSprint, lastSprint, inQDaysLeft };
}

/**
 * Greedy first-fit row layout. Epics are tried in their stored
 * `timelineRow` order; if the row is already occupied by an overlapping
 * range (counting ghost extensions via `virtualEndS`), the epic is
 * bumped to the next free row. This mirrors the visual effect the
 * planner sees when dragging an epic onto a row that's already taken —
 * but it's PURELY VIRTUAL (no API call, no `timelineRow` write). Drag
 * the overdue epic past today (or close its open stories) and the
 * displaced epic snaps back to its original row.
 *
 * Preserving the original `timelineRow` as the starting point is what
 * keeps the manual layout intact when nothing is overdue (then
 * `virtualEndS === endS` for every epic, no collisions, layout is a
 * pure pass-through).
 */
function repackEpicRowsWithGhostCollisions<
  T extends { epic: EpicItem; startS: number; endS: number; ghostOnly?: boolean },
>(
  items: T[],
  planYear: number,
): Array<{ timelineRow: number; items: (T & { virtualEndS: number })[] }> {
  const sorted = [...items]
    .map((item) => ({ ...item, virtualEndS: epicVirtualEndS(item.epic, planYear, item.endS, item.ghostOnly === true) }))
    .sort((a, b) => {
      const r = (Number.isFinite(a.epic.timelineRow) ? a.epic.timelineRow : 0) -
        (Number.isFinite(b.epic.timelineRow) ? b.epic.timelineRow : 0);
      if (r !== 0) return r;
      return a.startS - b.startS;
    });
  const placed = new Map<number, Array<T & { virtualEndS: number }>>();
  for (const item of sorted) {
    let row = Number.isFinite(item.epic.timelineRow) ? item.epic.timelineRow : 0;
    while (true) {
      const existing = placed.get(row);
      const collides = existing
        ? existing.some((e) => !(e.virtualEndS < item.startS || e.startS > item.virtualEndS))
        : false;
      if (!collides) {
        if (existing) existing.push(item);
        else placed.set(row, [item]);
        break;
      }
      row += 1;
    }
  }
  return [...placed.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timelineRow, rowItems]) => ({ timelineRow, items: rowItems }));
}

/**
 * CSS `left` for a marker inside a `flex` (or `grid`) row of `columnCount` equal columns separated by `gapPx` gaps
 * (matches the Gantt layout's `gap-2` = 8px). `columnIndex` is 0-based; `withinColumnFraction` is in [0, 1].
 *
 * `outerPaddingLeftPx` / `outerPaddingRightPx` let the calc account for parent padding when the marker is rendered
 * at a level above the grid (e.g. the all-quarters panel uses `pl-2 pr-1`). Set both to 0 when the marker is already
 * inside an inset wrapper that matches the grid width.
 *
 * The form `(100% - totalInset) * factor / N + (idxGap + leftPad)` avoids nested parens for the multiplicand,
 * which a few Safari versions parsed inconsistently.
 */
function gapAwareColumnLeftCss(
  columnIndex: number,
  withinColumnFraction: number,
  columnCount: number,
  gapPx = 8,
  outerPaddingLeftPx = 0,
  outerPaddingRightPx = 0,
): string {
  const factor = columnIndex + withinColumnFraction;
  const totalGapPx = (columnCount - 1) * gapPx;
  const totalInsetPx = totalGapPx + outerPaddingLeftPx + outerPaddingRightPx;
  const idxGapPx = columnIndex * gapPx;
  const leftOffsetPx = idxGapPx + outerPaddingLeftPx;
  return `calc((100% - ${totalInsetPx}px) * ${factor} / ${columnCount} + ${leftOffsetPx}px)`;
}

/** Today across 24 year-sprint columns (aligns with full-year Gantt lanes). Day-within-sprint fraction so the marker moves daily.
 *
 * The marker is rendered at the outer lanes panel level (pl-2 pr-1 padding) so the down-arrow triangle can sit
 * in the panel's `pt-5` reservation strip above the grid. The 8px / 4px padding values are subtracted from the
 * calc's available width so the bar still aligns with the grid columns inside.
 */
function todayLeftCssInYearSprints(planYear: number): string | null {
  const t = new Date();
  if (t.getFullYear() !== planYear) return null;
  const m = t.getMonth() + 1;
  const d = t.getDate();
  const lane: 1 | 2 = d <= 15 ? 1 : 2;
  const g = globalSprintFromMonthLane(m, lane);
  const frac = dayFractionWithinSprint(planYear, g, t);
  return gapAwareColumnLeftCss(g - 1, frac, 24, 8, 8, 4);
}

/** Today within a quarter's sprint columns (6 for a standard quarter). */
function todayLeftCssInQuarterSprints(planYear: number, quarterMonths: readonly number[]): string | null {
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
  const frac = dayFractionWithinSprint(planYear, g, t);
  return gapAwareColumnLeftCss(g - qLo, frac, n);
}

/** Single-month epic lane: 2 sprint columns (lane 1 = days 1-15, lane 2 = days 16-end). */
function todayLeftCssInSingleMonth(planYear: number, month: number): string | null {
  const t = new Date();
  if (t.getFullYear() !== planYear || t.getMonth() + 1 !== month) return null;
  const d = t.getDate();
  const lane: 1 | 2 = d <= 15 ? 1 : 2;
  const columnIndex = lane - 1;
  const start = lane === 1 ? 1 : 16;
  const end = lane === 1 ? 15 : daysInMonth(planYear, month);
  const span = end - start + 1;
  const fraction = span > 0 ? (d - start + 0.5) / span : 0.5;
  return gapAwareColumnLeftCss(columnIndex, fraction, 2);
}

/** Full-year / all-quarters roadmap: compact "S" + global sprint number. */
function sprintLabelYearRoadmap(globalSprint: number): string {
  return `S${globalSprint}`;
}

/** Quarter or month drill-in views: full word "Sprint". */
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
  if (!t) return "—";
  // Compact "First L." form for narrow cells. Keeps full first name
  // (most distinctive) and the last-name initial as a disambiguator.
  // Single-word names stay as-is. The dropdown still ranks/searches
  // against the FULL name via `label`; only `displayLabel` uses this
  // short form, so typing "Brown" still surfaces "Perry B.".
  const parts = t.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`;
}

/**
 * Compute health for a single epic. Returns null when the epic isn't
 * scheduled or has no stories — caller should skip the badge in that case.
 * Shared by the Gantt search dropdown so each suggestion shows its current
 * health at a glance, same status the bar would have on the Gantt.
 */
function ganttSearchEpicHealth(
  epic: EpicItem,
  planYear: number,
  basis: ProgressBasis,
): { status: HealthStatus; tooltip: string } | null {
  if (epic.planStartMonth == null || epic.planEndMonth == null) return null;
  // epicEst mode: keep a verdict even when the epic has no stories yet —
  // that's the whole point of the toggle. Other modes still need at least
  // one story for the rollup to mean anything.
  const v = computeEpicHealthVerdict(epic, planYear, basis);
  if (v == null) return null;
  return { status: v.status, tooltip: formatHealthTooltip(v.result) };
}

/** Same as {@link ganttSearchEpicHealth} but for initiatives — defers
 *  to {@link computeInitiativeHealthVerdict} (the shared
 *  worst-of-children rollup) so the Gantt search filter, dashboard
 *  donut, and backlog Health column all agree about which initiative
 *  is at risk. */
function ganttSearchInitiativeHealth(
  init: InitiativeItem,
  planYear: number,
  basis: ProgressBasis,
): { status: HealthStatus; tooltip: string } | null {
  const v = computeInitiativeHealthVerdict(init, planYear, basis);
  if (v == null) return null;
  return { status: v.status, tooltip: formatHealthTooltip(v.result) };
}

type TodayBadgePlacement = "above" | "inside";

/** "Today" badge + vertical dashed marker, always aligned (same parent coordinate space). */
function GanttTodayMarker({
  leftPercent,
  leftCss,
  showBadge = true,
  badgePlacement = "above",
  prioritizeLabel = false,
  showArrow = true,
  showLine = true,
  /** Bleed top/bottom past the track box so the dash meets the outer padded panel border (parent uses py-3 sm:py-4). */
  bleedToPaddedPanel,
}: {
  leftPercent?: number | null;
  /** Pre-built CSS `left` value (e.g. a calc that subtracts the column gap). Takes priority over leftPercent for the arrow/line. */
  leftCss?: string | null;
  showBadge?: boolean;
  badgePlacement?: TodayBadgePlacement;
  prioritizeLabel?: boolean;
  showArrow?: boolean;
  showLine?: boolean;
  bleedToPaddedPanel?: boolean;
}) {
  const hasNumeric = leftPercent != null && !Number.isNaN(leftPercent);
  const cssLeft = leftCss ?? (hasNumeric ? `${Math.min(100, Math.max(0, leftPercent as number))}%` : null);
  if (cssLeft == null) return null;
  // x is only used for the SVG-rendered badge, which needs a number in viewBox units. Falls back to 0 when only leftCss is provided.
  const x = hasNumeric ? Math.min(100, Math.max(0, leftPercent as number)) : 0;
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
            style={{ left: cssLeft, transform: "translateX(-100%) translateX(-6px)" }}
          >
            Today
          </div>
        ) : null}
        <div
          className="absolute top-0 bottom-0 w-4 -translate-x-1/2 overflow-visible"
          style={{ left: cssLeft }}
        >
          {showLine ? (
            <div className="absolute left-1/2 bottom-0 top-[14px] w-px -translate-x-1/2 bg-emerald-500/95" />
          ) : null}
          {showArrow ? (
            <div className="absolute bottom-1 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[6px] border-x-transparent border-t-[8px] border-t-emerald-500" />
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
        prioritizeLabel ? "z-30" : "z-10",
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
            left: cssLeft,
            top: `${arrowTopY}%`,
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
          }}
        />
      ) : null}
      {showLine ? (
        <div
          className="absolute w-px -translate-x-1/2 bg-emerald-500/85"
          style={{ left: cssLeft, top: `calc(${arrowTopY}% + 10px)`, bottom: "0px" }}
        />
      ) : null}
      {showArrow ? (
        <div
          className="absolute h-[10px] w-[12px] -translate-x-1/2 bg-emerald-500"
          style={{
            left: cssLeft,
            bottom: 0,
            clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
          }}
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
  teamAssignmentChip = null,
  healthStatus = null,
  healthTooltip,
  effortProgressPercent = null,
  dimmed = false,
}: EpicGanttLaneRowProps) {
  const stories = epic.userStories ?? [];
  const totalStories = stories.length;
  const finishedStories = stories.filter((story) => story.status === "review" || story.status === "done").length;
  const storyCountPercent = totalStories > 0 ? Math.round((finishedStories / totalStories) * 100) : 0;
  const completionPercent = effortProgressPercent ?? storyCountPercent;
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
              healthTooltip ?? (totalStories > 0 ? `${finishedStories}/${totalStories} review or done` : "No user stories")
            }
            emphasizeFlash={emphasize}
            emphasizeTick={emphasizeTick}
            showProgress={showProgress}
            healthStatus={healthStatus}
            healthTooltip={healthTooltip}
            epicStatus={deriveEpicStatusKey(epic)}
            isOverdue={planYear != null && epicIsOverdueByPlan(epic, planYear)}
            daysPastPlan={planYear != null ? (epicOverdueMeta(epic, planYear)?.daysPastPlan ?? 0) : 0}
            onUnschedule={onUnscheduleEpic ? () => onUnscheduleEpic(epic.id) : undefined}
            onClick={() => onOpenEpic(epic.id)}
            onInsightsClick={() => (onOpenInsights ?? openInsightsTab)("epic", epic.id)}
            teamAssignmentChip={teamAssignmentChip}
            tooltipDateRange={buildGanttBarDateRange(
              epic.planYear,
              epic.planStartMonth,
              epic.planStartDay,
              epic.planYear,
              epic.planEndMonth ?? epic.planStartMonth,
              epic.planEndDay,
            )}
            dimmed={dimmed}
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
          className={cn("relative z-20 min-w-0 pt-2.5 pb-2.5", emphasize && "overflow-visible")}
          style={{ gridColumn: "1 / span 1", gridRow: 1 }}
        >
          <EpicPlanTimelineBar
            id={epic.id}
            title={epic.title}
            icon={epic.icon}
            color={barColor}
            progressPercent={completionPercent}
            progressLabel={
              healthTooltip ?? (totalStories > 0 ? `${finishedStories}/${totalStories} review or done` : "No user stories")
            }
            emphasizeFlash={emphasize}
            emphasizeTick={emphasizeTick}
            showProgress={showProgress}
            healthStatus={healthStatus}
            healthTooltip={healthTooltip}
            epicStatus={deriveEpicStatusKey(epic)}
            isOverdue={planYear != null && epicIsOverdueByPlan(epic, planYear)}
            daysPastPlan={planYear != null ? (epicOverdueMeta(epic, planYear)?.daysPastPlan ?? 0) : 0}
            onUnschedule={onUnscheduleEpic ? () => onUnscheduleEpic(epic.id) : undefined}
            onClick={() => onOpenEpic(epic.id)}
            onInsightsClick={() => (onOpenInsights ?? openInsightsTab)("epic", epic.id)}
            teamAssignmentChip={teamAssignmentChip}
            tooltipDateRange={buildGanttBarDateRange(
              epic.planYear,
              epic.planStartMonth,
              epic.planStartDay,
              epic.planYear,
              epic.planEndMonth ?? epic.planStartMonth,
              epic.planEndDay,
            )}
            dimmed={dimmed}
          />
        </div>
      </div>
    );

  return (
    <div
      className={cn("relative min-w-0 py-2.5", emphasize ? "z-[25]" : "z-10")}
      data-gantt-lane-index={ganttLaneSortIndex}
      data-gantt-timeline-row={Number.isFinite(initiative.timelineRow) ? initiative.timelineRow : 0}
    >
      {month != null ? (
        <>
          {/* gap-0 overrides gap-2 so the sprint halves each occupy exactly 50% — aligns with absolute % bar positions.
           *  Day-level vertical guides are rendered inside each sprint
           *  half: sprint 1 = days 1-15, sprint 2 = days 16-DIM. */}
          <GanttLaneSprintBackdrop
            columnCount={2}
            className="gap-0"
            daySubdivisions={
              planYear != null
                ? [15, Math.max(1, daysInMonth(planYear, month) - 15)]
                : undefined
            }
          />
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
  healthStatus = null,
  healthTooltip,
  effortProgressPercent = null,
  teamAssignmentChip = null,
  planYear,
  month,
}: {
  initiative: InitiativeItem;
  onOpenInitiative: (initiativeId: string) => void;
  ganttLaneSortIndex: number;
  showProgress?: boolean;
  healthStatus?: HealthStatus | null;
  healthTooltip?: string;
  effortProgressPercent?: number | null;
  teamAssignmentChip?: { label: string; className: string; slug: string | null } | null;
  /** When set, the row's backdrop also renders day-level vertical
   *  guides matching the active month's sprint-1 / sprint-2 splits. */
  planYear?: number;
  month?: number;
}) {
  const stories = (initiative.epics ?? []).flatMap((epic) => epic.userStories ?? []);
  const totalStories = stories.length;
  const finishedStories = stories.filter((story) => story.status === "review" || story.status === "done").length;
  const storyCountPercent = totalStories > 0 ? Math.round((finishedStories / totalStories) * 100) : 0;
  const completionPercent = effortProgressPercent ?? storyCountPercent;

  return (
    <div
      className="relative z-10 min-w-0 py-2.5"
      data-gantt-lane-index={ganttLaneSortIndex}
      data-gantt-timeline-row={Number.isFinite(initiative.timelineRow) ? initiative.timelineRow : 0}
    >
      <GanttLaneSprintBackdrop
        columnCount={2}
        daySubdivisions={
          planYear != null && month != null
            ? [15, Math.max(1, daysInMonth(planYear, month) - 15)]
            : undefined
        }
      />
      <div className="relative z-[1] grid min-w-0 gap-2" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div className="relative z-20 min-w-0 pt-2.5 pb-2.5" style={{ gridColumn: "1 / span 2", gridRow: 1 }}>
          <InitiativeTimelineBar
            id={initiative.id}
            title={initiative.title}
            icon={initiative.icon}
            color={initiative.color}
            progressPercent={completionPercent}
            progressLabel={healthTooltip ?? (totalStories > 0 ? `${finishedStories}/${totalStories} review or done` : "No user stories")}
            showProgress={showProgress}
            healthStatus={healthStatus}
            healthTooltip={healthTooltip}
            teamAssignmentChip={teamAssignmentChip}
            onClick={() => onOpenInitiative(initiative.id)}
            onInsightsClick={() => (onOpenInsights ?? openInsightsTab)("initiative", initiative.id)}
            tooltipDateRange={buildGanttBarDateRange(
              initiative.year,
              initiative.startMonth,
              null,
              initiative.year,
              initiative.endMonth ?? initiative.startMonth,
              null,
            )}
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
  /** Generic per-field epic patch for inline-edit surfaces (e.g. the
   *  Epic Estimation Coverage panel's "Estimated epics" table where the
   *  planner can edit title, initiativeId, planSprint, team, assignee,
   *  originalEstimateDays in place). Parent owns the fetch + refresh. */
  onPatchEpic?: (
    epicId: string,
    patch: Partial<{
      title: string;
      initiativeId: string;
      planSprint: number | null;
      team: string | null;
      assignee: string | null;
      originalEstimateDays: number | null;
    }>,
  ) => Promise<void>;
  /** Generic per-field user-story patch for inline-edit surfaces (the
   *  story rows inside an epic's accordion in the Epic Estimation
   *  Coverage table, and the Stories-without-description table). Team
   *  is intentionally omitted — stories inherit team from their parent
   *  epic. `epicId` re-parents the story to a different epic (used by
   *  the Parent epic autocomplete on the Stories-without-description
   *  table). Parent owns the fetch + refresh. */
  onPatchStory?: (
    storyId: string,
    patch: Partial<{
      title: string;
      sprint: number | null;
      assignee: string | null;
      estimatedDays: number | null;
      epicId: string;
    }>,
  ) => Promise<void>;
  /** Month plan team board queues (year:month keys) for capacity ordering and queue→team sync. */
  monthTeamBoardByKey?: Record<string, MonthTeamBoardPersisted>;
  /** Open story Kanban for a global sprint (tabs do not include a sprint-board tab). */
  onEnterSprintStoryBoard?: (yearSprint: number, teamId: string | null) => void;
  /** Opens the manual `SprintMoveModal` for moving unfinished work to the
   *  next sprint at sprint close. The parent owns the modal state. */
  onRequestSprintMove?: (yearSprint: number) => void;
  /** True when the active sprint is `YEAR_SPRINT_MAX` AND the roadmap has
   *  no next year — switches the move button into the year-end continuation
   *  prompt mode. */
  isYearBoundaryBlocked?: boolean;
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
  sprintRetrospectiveByTeam?: Record<string, SprintRetrospectiveDoc & { updatedAt: string }>;
  onSaveSprintRetrospective?: (doc: SprintRetrospectiveDoc, teamId?: string) => void;
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
  /** Move an initiative back to the backlog — wired to the X chip on
   *  initiative bars (mirrors the unschedule X on epic bars). The handler
   *  should confirm with the user before clearing the schedule. */
  onUnscheduleInitiative?: (initiativeId: string) => void;
  /** Delete an initiative from the database (used elsewhere — left list,
   *  delete dialog). Kept distinct from the X-chip "unschedule" action. */
  onDeleteInitiative?: (initiativeId: string) => void;
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
  /** Pulse all Gantt-scheduled epic bars when the "Scheduled" summary filter is turned on. */
  ganttScheduledFilterEmphasis?: { tick: number } | null;
  /** Pulse all sprint-kanban user story cards for an expanded epic accordion. */
  sprintEpicAccordionEmphasis?: { epicId: string; tick: number } | null;
  /** Pulse Kanban cards for stories on the active sprint when "Scheduled" filter is turned on (sprint board). */
  sprintKanbanScheduledStoriesEmphasis?: { tick: number } | null;
  /** Toggled by the Roadmap header "Progress" chip; shows Gantt bar progress rows and left-panel story progress. */
  showRoadmapProgress: boolean;
  onShowRoadmapProgressChange: (next: boolean) => void;
  /** Shared progress-basis state with InitiativeListPanel — lifted to the
   * parent so both panels show identical % values. */
  progressBasis: ProgressBasis;
  onProgressBasisChange: (next: ProgressBasis) => void;
  /**
   * Optional CONTROLLED health filter. When provided, the popover, Gantt,
   * and InitiativeListPanel all read/write the same Set of pinned health
   * statuses. When omitted, TimelineGrid keeps the filter internal and
   * only the popover / Gantt see it. Lift this state when you want the
   * middle panel to filter alongside the roadmap health view.
   */
  healthFilterExternal?: Set<HealthStatus>;
  onHealthFilterChange?: (next: Set<HealthStatus>) => void;
  /**
   * Execution-status filter mirrored from the middle panel — Empty Set
   * means "no filter active." When non-empty, the Gantt drops any bar
   * whose derived epic status isn't in the Set. Independent from
   * `healthFilterExternal`; the planner can have one or the other (the
   * dropdown enforces mutual exclusion in the panel).
   */
  ganttStatusFilterExternal?: Set<"backlogEpic" | "todo" | "inProgress" | "review" | "done">;
  /**
   * Quarter filter mirrored from the panel. When non-empty, the Gantt
   * drops epics whose plan-start quarter isn't in the Set. Lets the
   * planner pick `Q2` in the dropdown and have the Gantt fall to just
   * Q2-starting work.
   */
  ganttQuarterFilterExternal?: Set<"Q1" | "Q2" | "Q3" | "Q4">;
  /**
   * Team filter mirrored from the panel. When non-empty, the Gantt drops
   * bars whose epic.team isn't in the Set. Picking `Mobile` in the panel
   * causes only Mobile-owned epics to render on the Gantt.
   */
  ganttTeamFilterExternal?: Set<string>;
  /** Mirror of `ganttTeamFilterExternal` going the other way — fires
   *  whenever the planner changes the breadcrumb team picker so the
   *  parent can keep its shared `ganttTeamFilter` Set in lockstep. The
   *  Hero's Team Progress card highlight + Initiatives panel team
   *  filter all read off the same parent Set, so without this they'd
   *  go stale the moment the planner picked a team via the breadcrumb. */
  onGanttTeamFilterChange?: (next: Set<string>) => void;
  /**
   * Cross-mode "highlight these epic IDs" filter — set by the Portfolio
   * Burndown's contributor popover when the planner picks laggards (or
   * "Highlight on Roadmap"). Unlike the other filter sets above which
   * DROP non-matching bars, this one keeps every bar visible but DIMS
   * the non-matching ones so the planner can still see the surrounding
   * plan context. `highlightLabel` drives a small banner above the
   * Gantt; `onClearHighlight` wires the banner's clear button.
   * All three are inert (defaults) when no chart has emitted a
   * selection.
   */
  highlightedEpicIds?: ReadonlySet<string> | null;
  highlightLabel?: string | null;
  onClearHighlight?: () => void;
  /** Controlled mirror of the Gantt's team-chip overlay. When provided,
   *  the parent decides; when omitted, TimelineGrid keeps the state
   *  internal (so the toolbar toggle still works in standalone uses). */
  showGanttTeamChipsExternal?: boolean;
  onShowGanttTeamChipsChange?: (next: boolean) => void;
  /** Same external-state mirror pattern for the sprint-chip row in the
   *  calendar header. Parent (the hero stat block) can drive it from
   *  outside; default falls back to TimelineGrid's internal state. */
  showYearSprintChipsExternal?: boolean;
  onShowYearSprintChipsChange?: (next: boolean) => void;
  /** Same external-state mirror for the bar-mode toggle (initiatives vs
   *  epics). When provided the parent owns the state; when omitted the
   *  toolbar's "Initiatives / Epics" pill still works standalone. */
  roadmapBarModeExternal?: "epics" | "initiatives";
  onRoadmapBarModeChange?: (next: "epics" | "initiatives") => void;
  /** Imperative "open the Epic Estimate Coverage panel" command from the
   *  parent (the dashboard hero donut). TimelineGrid watches the key —
   *  whenever it bumps, openEstEpicsPanel(tab) fires. Null = idle. */
  openEstPanelCmd?: {
    tab: "estimated" | "partiallyEstimated" | "unestimated" | "epicsNoDesc" | "storiesNoDesc";
    key: number;
  } | null;
  /** Tracks which filter the planner most recently activated (team / health
   *  / status). Year-roadmap bars use this to render exactly one label per
   *  bar — the latest pick wins, instead of falling back to a static
   *  priority order. Null = planner hasn't picked anything → status pill
   *  is the default. */
  lastPickedLabelLane?: "team" | "health" | "status" | null;
  /** Pre-selected epic in the insights scope picker (from URL on first load). */
  initialInsightsScopeEpicId?: string | null;
  /** Pre-selected initiative in the insights scope picker (from URL on first load). */
  initialInsightsScopeInitId?: string | null;
  /** Fired when the user selects an epic or initiative in any insights scope picker. */
  onInsightsScopeChange?: (epicId: string | null, initId: string | null) => void;
  /** Switch the current view to the insights surface, scoped to the given
   * epic or initiative. Called when the user clicks the % chip on a Gantt bar.
   * If omitted, the bar falls back to opening /epic-insights in a new tab. */
  onOpenInsights?: (kind: "epic" | "initiative", id: string) => void;
  /** Roadmap management props */
  roadmaps?: RoadmapItem[];
  selectedRoadmapId?: string;
  selectedRoadmap?: RoadmapItem | null;
  onSelectRoadmap?: (id: string, year?: number) => void;
  onCreateRoadmap?: (name: string, years: number[]) => Promise<void>;
  onRenameRoadmap?: (id: string, name: string) => Promise<void>;
  onAddYearToRoadmap?: (id: string, year: number) => Promise<void>;
  onRemoveYearFromRoadmap?: (id: string, year: number) => Promise<{ error?: string }>;
  onGetRoadmapCounts?: (id: string) => Promise<{ initiativeCount: number; epicCount: number; storyCount: number; snapshotCount: number } | null>;
  onDeleteRoadmap?: (id: string) => Promise<void>;
  /** When provided, summary chips are portalled into this element instead of rendered in the header. */
  summaryBarPortalElement?: HTMLElement | null;
  /** When true, chips are never rendered inline in the header (use with summaryBarPortalElement to avoid flash-of-inline-chips on mount). */
  suppressInlineChips?: boolean;
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

/** Day-level drop indicator for the month Gantt header. Aligns with each day column. */
function DayDropCell({ month, day }: { month: number; day: number }) {
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({ id: `epic-plan-day:${month}:${day}` });
  const isEpicDragActive = active ? isEpicPlanDraggableId(String(active.id)) : false;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-w-0 flex-1 basis-0 shrink-0 rounded-sm transition-all",
        isEpicDragActive ? "h-px bg-slate-300/80" : "h-0 bg-transparent opacity-0",
        isOver && "h-1 bg-blue-500/90",
      )}
      aria-hidden
    />
  );
}

/** Sprint-level drop indicator strip for the all-quarters Gantt header. Uses epic-plan: IDs so
 *  onDragEnd resolves month+lane directly without cursor-X math. */
function SprintDropCell({ month, lane }: { month: number; lane: 1 | 2 }) {
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({ id: `epic-plan:${month}:${lane}` });
  const isEpicDragActive = active ? isEpicPlanDraggableId(String(active.id)) : false;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "w-full shrink-0 rounded-lg transition-all",
        isEpicDragActive ? "h-px bg-slate-300/80" : "h-0 bg-transparent opacity-0",
        isOver && "h-1 bg-blue-500/90",
      )}
      aria-hidden
    />
  );
}

type EstimateCoveragePanelTab =
  | "unestimated"
  | "estimated"
  | "partiallyEstimated"
  | "epicsNoDesc"
  | "storiesNoDesc"
  | "unscheduledStories";

/** Per-column filter popover for the Estimate Coverage tables.
 *  Renders a small funnel icon next to a column header; clicking it
 *  opens a popover with a search input and a checkbox list of all
 *  distinct values in that column. Multi-select; selecting nothing
 *  clears the filter for that column. */
type CoverageFilterOption = { value: string; icon?: ReactNode };
function CoverageColumnFilter({
  filterKey,
  label,
  options,
  selected,
  onChange,
  openKey,
  setOpenKey,
  query,
  onQueryChange,
}: {
  filterKey: string;
  label: string;
  options: ReadonlyArray<CoverageFilterOption>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  openKey: string | null;
  setOpenKey: (next: string | null) => void;
  query: string;
  onQueryChange: (next: string) => void;
}) {
  const open = openKey === filterKey;
  const containerRef = useRef<HTMLSpanElement | null>(null);
  // Bounding rect of the column header (`<th>`) used to position the
  // portaled popover. Tracked in state so a scroll or resize re-renders
  // with up-to-date coords.
  const [popoverRect, setPopoverRect] = useState<{ left: number; top: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPopoverRect(null);
      return;
    }
    function update() {
      const span = containerRef.current;
      if (!span) return;
      // Walk up to the closest <th> for the column-left anchor.
      let anchor: HTMLElement | null = span;
      while (anchor && anchor.tagName !== "TH") anchor = anchor.parentElement;
      const target = anchor ?? span;
      const r = target.getBoundingClientRect();
      setPopoverRect({ left: r.left, top: r.bottom + 4, width: 320 });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (containerRef.current.contains(target)) return;
      // The portaled popover lives outside containerRef; recognize
      // clicks inside it via its data attribute.
      const popoverEl = (target as HTMLElement).closest?.(`[data-coverage-filter-popover="${filterKey}"]`);
      if (popoverEl) return;
      setOpenKey(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenKey(null);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpenKey, filterKey]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.value.toLowerCase().includes(q));
  }, [options, query]);
  return (
    // No `relative` here — the popover anchors to the parent <th>
    // (which carries `relative` via `estimatePanelHeadCellClass`),
    // so it opens at the column's left edge rather than under the
    // funnel button on the column's right.
    <span ref={containerRef} className="inline-flex shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpenKey(open ? null : filterKey);
        }}
        title={`Filter ${label}`}
        aria-label={`Filter ${label}`}
        aria-expanded={open}
        className={cn(
          // Filter icon colors are visible on the coverage tables'
          // white-background column header row.
          "inline-flex size-5 items-center justify-center rounded transition",
          selected.size > 0
            ? "bg-amber-100 text-amber-700 ring-1 ring-amber-300 hover:bg-amber-200"
            : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
        )}
      >
        <Funnel className="size-3" strokeWidth={2.2} aria-hidden />
      </button>
      {open && popoverRect && typeof document !== "undefined" ? createPortal(
        <div
          // Portaled to <body> so the popup escapes the table wrapper's
          // `overflow-x-auto` clipping. Fixed-position against the
          // viewport using the column header's bounding rect.
          ref={(node) => {
            // Keep popover ref tracking inside containerRef for
            // outside-click detection — set the rendered element as a
            // child of the same ref-managed region by re-using the
            // container ref's contains() check via a data attribute.
            if (node) node.setAttribute("data-coverage-filter-popover", filterKey);
          }}
          data-coverage-filter-popover={filterKey}
          style={{ position: "fixed", left: popoverRect.left, top: popoverRect.top, width: popoverRect.width }}
          className="z-[1000] rounded-lg border border-slate-200 bg-white p-2 shadow-xl ring-1 ring-black/5"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={`Search ${label}…`}
            autoFocus
            className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1 text-[13px] text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200/70"
          />
          {(selected.size > 0 || query.length > 0) ? (
            <button
              type="button"
              onClick={() => {
                onChange(new Set());
                onQueryChange("");
              }}
              className="mb-1.5 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-100"
            >
              Clear filter{selected.size > 0 ? ` (${selected.size})` : ""}
            </button>
          ) : null}
          <div className="max-h-64 space-y-0.5 overflow-y-auto pr-0.5">
            {filtered.length === 0 ? (
              <p className="px-1 py-0.5 text-[12px] text-slate-500">No matches</p>
            ) : (
              filtered.map((opt) => {
                const v = opt.value;
                const checked = selected.has(v);
                return (
                  <label
                    key={v || "__empty__"}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] text-slate-800 hover:bg-slate-100"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = new Set(selected);
                        if (checked) next.delete(v);
                        else next.add(v);
                        onChange(next);
                      }}
                      className="size-3.5 shrink-0"
                    />
                    {opt.icon ? <span className="inline-flex shrink-0 items-center">{opt.icon}</span> : null}
                    <span className="min-w-0 truncate">{v || "(empty)"}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </span>
  );
}

/** Option shape for the icon-augmented autocomplete dropdown rendered
 *  below an inline-edit input in the Epic Estimation Coverage table.
 *  `displayLabel` (optional) is what the row actually renders; `label`
 *  is what ranking/search matches against. Lets us show a compact
 *  "First L." form in the assignee dropdown while still matching
 *  typed last names against the full name. */
type CoverageEditOption = { value: string; label: string; displayLabel?: string; icon: ReactNode };

/** Rank tiers used by the dropdown. Tier 0–2 are "matches" and render
 *  fully opaque; tier 3 entries are non-matches that still render
 *  (slightly dimmed) so the planner never has to clear the input just
 *  to pick a different option. */
function rankCoverageOption(label: string, draftLower: string): 0 | 1 | 2 | 3 {
  if (!draftLower) return 1;
  const lower = label.toLowerCase();
  if (lower === draftLower) return 0;
  if (lower.startsWith(draftLower)) return 1;
  if (lower.includes(draftLower)) return 2;
  return 3;
}

// Lower bound so even the narrowest trigger (sprint cell ~30px) still
// gets a readable popup. The popup uses `w-max` inside, so longer
// labels (team / initiative) drive the actual rendered width up to
// COVERAGE_DROPDOWN_MAX_WIDTH. 140px comfortably fits "Sprint 24"
// without leaving empty whitespace on shorter lists.
const COVERAGE_DROPDOWN_MIN_WIDTH = 140;
const COVERAGE_DROPDOWN_MAX_WIDTH = 360;

/** Inline-edit input + ✓ / ✗ controls with a portal-rendered
 *  autocomplete dropdown. The dropdown portals to `document.body` and
 *  uses fixed positioning so it escapes the Epic Estimation Coverage
 *  popover's stacking / overflow context (which sits at z-[60]). The
 *  dropdown sits at z-[9800] so it floats above the panel. Position is
 *  recomputed on scroll/resize while the editor is open.
 *
 *  Filtering model: the parent passes the FULL option list; this
 *  component ranks options by typed text (exact → startsWith →
 *  includes → others) but always renders every option, so the planner
 *  never has to delete their text to browse the rest of the catalog.
 *  Non-matches render slightly dimmed.
 *
 *  Keyboard: ArrowUp / ArrowDown move the highlight; Enter commits the
 *  highlighted option (or the typed text when nothing is highlighted);
 *  Escape cancels. Mouse hover also moves the highlight. */
function CoverageEditInput({
  draft,
  saving,
  type,
  placeholder,
  allOptions,
  onDraftChange,
  onSubmit,
  onCancel,
}: {
  draft: string;
  saving: boolean;
  type: "text" | "number";
  placeholder?: string;
  allOptions: CoverageEditOption[] | null;
  onDraftChange: (next: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; minWidth: number } | null>(null);
  const [highlightIdx, setHighlightIdx] = useState<number>(0);

  const rankedOptions = useMemo(() => {
    if (!allOptions || allOptions.length === 0) return [] as Array<CoverageEditOption & { rank: 0 | 1 | 2 | 3 }>;
    const draftLower = draft.trim().toLowerCase();
    // Stable-sort by rank ascending, breaking ties by the caller's
    // original index. Avoids alphabetic re-ordering of caller lists
    // that already have a meaningful order — e.g. sprint numbers
    // 1,2,…,24 (alphabetic would shuffle them to 1,10,11,…,2,20,…).
    return allOptions
      .map((opt, originalIdx) => ({ ...opt, rank: rankCoverageOption(opt.label, draftLower), originalIdx }))
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.originalIdx - b.originalIdx;
      });
  }, [allOptions, draft]);

  const showMenu = rankedOptions.length > 0;

  // Snap highlight back to the first option whenever the ordering shifts
  // (typing typically promotes a new top match). Without this the user's
  // arrow-key highlight could land on an unexpected row after typing.
  useEffect(() => {
    setHighlightIdx(0);
  }, [draft, rankedOptions.length]);

  useLayoutEffect(() => {
    if (!showMenu) {
      setMenuPos(null);
      return;
    }
    const recompute = () => {
      const el = inputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const minWidth = Math.max(rect.width, COVERAGE_DROPDOWN_MIN_WIDTH);
      // Clamp left so the dropdown doesn't overflow the right viewport
      // edge when the trigger is near it.
      const left = Math.min(rect.left, window.innerWidth - minWidth - 8);
      setMenuPos({ left: Math.max(8, left), top: rect.bottom + 4, minWidth });
    };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [showMenu]);

  // Scroll the highlighted row into view as arrows move past the
  // visible window. Bookkeeping-only — the list owns its own scroller.
  useEffect(() => {
    if (!listRef.current) return;
    const node = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlightIdx}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  function commit(value: string) {
    onSubmit(value);
  }

  return (
    <span className="relative flex w-full min-w-0 items-center gap-1">
      <input
        ref={inputRef}
        type={type}
        value={draft}
        placeholder={placeholder}
        autoFocus
        disabled={saving}
        min={type === "number" ? 0 : undefined}
        max={type === "number" ? 5000 : undefined}
        step={type === "number" ? 1 : undefined}
        onChange={(event) => onDraftChange(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && showMenu) {
            event.preventDefault();
            setHighlightIdx((i) => Math.min(rankedOptions.length - 1, i + 1));
            return;
          }
          if (event.key === "ArrowUp" && showMenu) {
            event.preventDefault();
            setHighlightIdx((i) => Math.max(0, i - 1));
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            // If the dropdown is open AND the user has actually
            // highlighted a row (or there's an unambiguous top-match),
            // commit the highlighted option's value; otherwise fall
            // back to whatever they typed.
            if (showMenu && rankedOptions[highlightIdx]) {
              commit(rankedOptions[highlightIdx].value);
            } else {
              commit(draft);
            }
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className="h-6 w-full min-w-0 flex-1 rounded border border-sky-300 bg-white px-1.5 text-[13px] text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200/70"
      />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          commit(draft);
        }}
        disabled={saving}
        aria-label="Save"
        title="Save"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-emerald-100 text-emerald-700 transition-colors hover:bg-emerald-200 disabled:opacity-50"
      >
        <Check className="size-3.5" strokeWidth={2.6} aria-hidden />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onCancel();
        }}
        disabled={saving}
        aria-label="Cancel"
        title="Cancel"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-rose-100 text-rose-700 transition-colors hover:bg-rose-200 disabled:opacity-50"
      >
        <X className="size-3.5" strokeWidth={2.6} aria-hidden />
      </button>
      {showMenu && menuPos && typeof document !== "undefined"
        ? createPortal(
            <ul
              ref={listRef}
              role="listbox"
              style={{
                position: "fixed",
                left: menuPos.left,
                top: menuPos.top,
                minWidth: menuPos.minWidth,
                maxWidth: COVERAGE_DROPDOWN_MAX_WIDTH,
                zIndex: 9800,
              }}
              className="max-h-72 w-max overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/[0.04]"
              onClick={(event) => event.stopPropagation()}
            >
              {rankedOptions.map((opt, idx) => {
                const isHighlighted = idx === highlightIdx;
                const isDim = opt.rank === 3;
                return (
                  <li key={`${opt.value || opt.label}-${idx}`} role="option" aria-selected={isHighlighted}>
                    <button
                      type="button"
                      data-idx={idx}
                      // Tooltip shows the FULL name (label), even when
                      // the row renders a compact displayLabel ("Perry B.").
                      title={opt.label}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      // Pick-on-mousedown so the row commits before the
                      // input's own blur fires and tears down the popup.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        commit(opt.value);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-2 py-1 text-left text-[13px] transition-colors",
                        isHighlighted ? "bg-sky-50 text-slate-900" : "text-slate-800",
                        isDim && !isHighlighted && "opacity-55",
                      )}
                    >
                      <span className="inline-flex size-[18px] shrink-0 items-center justify-center">
                        {opt.icon}
                      </span>
                      <span className="min-w-0 truncate">{opt.displayLabel ?? opt.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
    </span>
  );
}

/** Project-standard hover/focus tooltip for "what is this?" affordances
 *  inside surfaces that have `overflow-hidden` parents (the Coverage
 *  section header is one such surface — its panel-tinted rounded corners
 *  rely on overflow-hidden). The tooltip portals to `document.body` and
 *  positions itself with `fixed` so no ancestor stacking context or
 *  overflow rule can clip it. Visual style matches the existing
 *  HOVER_TOOLTIP_CLASS used by backlog row chips: indigo-on-white card,
 *  shadow-md, rounded-lg, 12px slate-700 body, max-w 22rem. */
function InfoTooltip({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const recompute = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Anchor the tooltip's right edge to the icon's right edge —
      // when the icon is near the right of the viewport, the popup
      // extends LEFT instead of overflowing off-screen.
      setPos({ left: rect.right, top: rect.bottom + 6 });
    };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [open]);

  // Esc closes the tooltip — keyboard accessibility parity with the
  // mouse-leave / blur teardown.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          // Toggle on click so touch users can pin the tooltip open
          // without a mouse-leave hiding it.
          event.preventDefault();
          setOpen((v) => !v);
        }}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white focus-visible:bg-white/15 focus-visible:text-white focus-visible:outline-none"
      >
        <Info className="size-3.5" strokeWidth={2.2} aria-hidden />
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              // Anchor the popup's right edge to the icon, then nudge
              // it ~24px further right so a small slice of the card
              // sits past the icon — visually disambiguates the tip
              // from the title text on its left.
              style={{
                position: "fixed",
                left: pos.left,
                top: pos.top,
                transform: "translateX(calc(-100% + 24px))",
                zIndex: 9999,
              }}
              className="pointer-events-none w-max max-w-[22rem] whitespace-normal rounded-lg border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/40 px-3 py-2 text-[12px] font-medium leading-snug text-slate-700 shadow-md ring-1 ring-indigo-100/70 backdrop-blur-sm tracking-normal normal-case"
            >
              {children}
            </span>,
            document.body,
          )
        : null}
    </>
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
  quarterViewTabExternal,
  onQuarterViewTabChange,
  onFocusedQuarterChange,
  onYearRoadmapNavigate,
  onQuarterGanttFromMonthBreadcrumb,
  onSprintModeChange,
  onSprintTabChange,
  onOpenEpic: _onOpenEpicProp,
  onUnscheduleEpic,
  onDeleteInitiative,
  onUnscheduleInitiative,
  onOpenInitiative: _onOpenInitiativeProp,
  onOpenStory: _onOpenStoryProp,
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
  onPatchEpic,
  onPatchStory,
  monthTeamBoardByKey = {},
  onEnterSprintStoryBoard,
  onRequestSprintMove,
  isYearBoundaryBlocked = false,
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
  sprintRetrospectiveByTeam = {},
  onSaveSprintRetrospective,
  showRoadmapProgress,
  onShowRoadmapProgressChange,
  progressBasis,
  onProgressBasisChange,
  healthFilterExternal,
  onHealthFilterChange,
  ganttStatusFilterExternal,
  ganttQuarterFilterExternal,
  ganttTeamFilterExternal,
  onGanttTeamFilterChange,
  showGanttTeamChipsExternal,
  onShowGanttTeamChipsChange,
  showYearSprintChipsExternal,
  onShowYearSprintChipsChange,
  roadmapBarModeExternal,
  onRoadmapBarModeChange,
  openEstPanelCmd = null,
  lastPickedLabelLane = null,
  initialInsightsScopeEpicId,
  initialInsightsScopeInitId,
  onInsightsScopeChange,
  onOpenInsights,
  onMonthEpicDayRangeChange,
  roadmaps = [],
  selectedRoadmapId,
  selectedRoadmap = null,
  onSelectRoadmap,
  onCreateRoadmap,
  onRenameRoadmap,
  onAddYearToRoadmap,
  onRemoveYearFromRoadmap,
  onGetRoadmapCounts,
  onDeleteRoadmap,
  summaryBarPortalElement,
  suppressInlineChips,
  highlightedEpicIds = null,
  highlightLabel = null,
  onClearHighlight,
}: TimelineGridProps) {
  const { active: dndActive } = useDndContext();
  const isAnyDragActive = dndActive != null;
  const ROADMAP_BAR_MODE_STORAGE_KEY = "timeline:roadmap-bar-mode";
  void zoom;

  // Cross-mode "highlight these epics" filter: when set (Portfolio Burndown
  // emits it through the planner), the Gantt keeps every bar visible but
  // fades anything not in the set. The banner below the toolbar gives the
  // planner a one-click exit. When inactive (null/empty), every consumer
  // below short-circuits and the Gantt renders normally.
  const isHighlightActive =
    highlightedEpicIds != null && highlightedEpicIds.size > 0;
  const [focusedMonth, setFocusedMonth] = useState<number | null>(null);
  const [activeSprint, setActiveSprint] = useState<number | null>(null);
  const [activeSprintTab, setActiveSprintTab] = useState<"kanban" | "status">("kanban");
  const [quarterViewTabState, setQuarterViewTabState] = useState<QuarterSurfaceTab>("gantt");
  const quarterViewTab = quarterViewTabExternal ?? quarterViewTabState;
  const setQuarterViewTab = useCallback((tab: QuarterSurfaceTab) => {
    if (onQuarterViewTabChange) onQuarterViewTabChange(tab);
    else setQuarterViewTabState(tab);
  }, [onQuarterViewTabChange]);
  const [roadmapBarModeInternal, setRoadmapBarModeInternal] = useState<"epics" | "initiatives">("epics");
  const roadmapBarMode = roadmapBarModeExternal ?? roadmapBarModeInternal;
  const setRoadmapBarMode = useCallback(
    (next: "epics" | "initiatives" | ((prev: "epics" | "initiatives") => "epics" | "initiatives")) => {
      const resolved = typeof next === "function" ? next(roadmapBarMode) : next;
      if (onRoadmapBarModeChange) onRoadmapBarModeChange(resolved);
      else setRoadmapBarModeInternal(resolved);
    },
    [onRoadmapBarModeChange, roadmapBarMode],
  );
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
  const [showYearSprintChipsInternal, setShowYearSprintChipsInternal] = useState(false);
  const showYearSprintChips = showYearSprintChipsExternal ?? showYearSprintChipsInternal;
  const setShowYearSprintChips = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(showYearSprintChips) : next;
      if (onShowYearSprintChipsChange) onShowYearSprintChipsChange(resolved);
      else setShowYearSprintChipsInternal(resolved);
    },
    [onShowYearSprintChipsChange, showYearSprintChips],
  );
  const [showGanttTeamChipsInternal, setShowGanttTeamChipsInternal] = useState(false);
  /** Optionally controlled by the parent (lifted state). When the prop
   *  is omitted, the toolbar toggle drives the internal state. */
  const showGanttTeamChips = showGanttTeamChipsExternal ?? showGanttTeamChipsInternal;
  const setShowGanttTeamChips = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(showGanttTeamChips) : next;
      if (onShowGanttTeamChipsChange) onShowGanttTeamChipsChange(resolved);
      else setShowGanttTeamChipsInternal(resolved);
    },
    [onShowGanttTeamChipsChange, showGanttTeamChips],
  );
  /** Health-summary popover anchored to the toolbar's Progress button. */
  const [healthPopoverOpen, setHealthPopoverOpen] = useState(false);

  /**
   * Wrappers around the three "open dialog" callbacks. The dialogs live in the
   * parent (epic-planner-app.tsx) and render as modals over this surface.
   * The health popover is intentionally LEFT OPEN behind the dialogs so the
   * planner can switch between an epic's detail and the overall health view
   * without losing context — closing the dialog drops the planner back onto
   * the popover, ready for the next click.
   *
   * Uses `useCallback` so prop identity is stable (matters for `useMemo` /
   * `React.memo` consumers downstream like `GanttLaneRow`).
   */
  const closeHealthPopover = useCallback(() => {
    setHealthPopoverOpen(false);
    onShowRoadmapProgressChange(false);
  }, [onShowRoadmapProgressChange]);
  const onOpenEpic = useCallback(
    (epicId: string) => {
      _onOpenEpicProp(epicId);
    },
    [_onOpenEpicProp],
  );
  const onOpenInitiative = useCallback(
    (initiativeId: string) => {
      _onOpenInitiativeProp(initiativeId);
    },
    [_onOpenInitiativeProp],
  );
  // `onOpenStory` is optional on the prop type, and several downstream UI
  // branches check its presence to disable cursors / hover states. Preserve
  // that signal by leaving the wrapper undefined when the prop is.
  const onOpenStory = useMemo<((storyId: string) => void) | undefined>(() => {
    if (!_onOpenStoryProp) return undefined;
    return (storyId: string) => {
      closeHealthPopover();
      _onOpenStoryProp(storyId);
    };
  }, [_onOpenStoryProp, closeHealthPopover]);
  /** Multi-select set of pinned statuses; bars not in the set get dimmed.
   * Empty set = no filter active (all bars visible at full opacity).
   * Optionally controlled by parent (`healthFilterExternal` / `onHealthFilterChange`)
   * so the InitiativeListPanel can share the same filter state. */
  const [healthFilterInternal, setHealthFilterInternal] = useState<Set<HealthStatus>>(() => new Set());
  const healthFilter = healthFilterExternal ?? healthFilterInternal;
  const setHealthFilter = useCallback(
    (next: Set<HealthStatus>) => {
      if (onHealthFilterChange) onHealthFilterChange(next);
      else setHealthFilterInternal(next);
    },
    [onHealthFilterChange],
  );
  const progressBtnRef = useRef<HTMLButtonElement | null>(null);
  /** When true, year or quarter roadmap Gantt uses fixed sprint column width (column threshold via ResizeObserver). */
  const [yearRoadmapHScroll, setYearRoadmapHScroll] = useState(false);
  /** When true, right panel is narrower than {@link RIGHT_PANEL_MIN_CONTENT_PX} — outer horizontal scroll for full chrome + body. */
  const [rightPanelHScroll, setRightPanelHScroll] = useState(false);
  /** Measures available width under the timeline card; drives right-panel + roadmap horizontal scroll. */
  const yearRoadmapMeasureRef = useRef<HTMLDivElement | null>(null);
  const [sprintKanbanViewMode, setSprintKanbanViewMode] = useState<"stories" | "epics">("stories");
  /** Toolbar toggle: when on, the sprint kanban filters to ONLY stories
   *  whose rollover history says they carried over from a prior sprint.
   *  Off by default (planner sees the full board). */
  const [sprintKanbanCarriedOverOnly, setSprintKanbanCarriedOverOnly] = useState(false);
  /** Sprint Kanban: toggle progress bars on story / epic cards. Off by
   *  default so cards stay compact — user opts in via the "Progress" chip
   *  in the sprint-board toolbar. */
  const [sprintKanbanShowProgress, setSprintKanbanShowProgress] = useState(false);
  /** Sprint Kanban only — toggles the health verdict chip on each
   *  story / epic card. Same `HealthBadge` the hero's Health
   *  Distribution donut + backlog Health column use. Defaults to off
   *  so cards stay compact when health isn't the focus. */
  const [sprintKanbanShowHealth, setSprintKanbanShowHealth] = useState(false);
  /** Sprint Kanban only — toggles a team chip on each story card so
   *  the delivery team is visible at a glance. Off by default since
   *  the per-column team filter chips already convey team identity
   *  for the most common workflows. */
  const [sprintKanbanShowTeams, setSprintKanbanShowTeams] = useState(false);
  const [sprintKanbanSearch, setSprintKanbanSearch] = useState("");
  const [sprintKanbanSearchOpen, setSprintKanbanSearchOpen] = useState(false);
  const sprintKanbanSearchRef = useRef<HTMLDivElement>(null);
  const sprintKanbanSearchCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [estEpicsPanelOpen, setEstEpicsPanelOpen] = useState(false);
  /** Drives slide-in/out (mirror of epic insights panel: translate + duration-300). */
  const [estEpicsPanelEntered, setEstEpicsPanelEntered] = useState(false);
  const skipEstEpicsPanelEnterRef = useRef(false);
  const estEpicsPanelCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [estEpicsPanelWidthPx, setEstEpicsPanelWidthPx] = useState(1240);
  const [estEpicsPanelPosition, setEstEpicsPanelPosition] = useState({ right: 0, top: 0 });
  const [expandedEstimateEpicIds, setExpandedEstimateEpicIds] = useState<Set<string>>(new Set());
  const [estimateCoveragePanelTab, setEstimateCoveragePanelTab] = useState<EstimateCoveragePanelTab>("unestimated");
  // Per-tab per-column filter selections. Key shape: `${tab}.${col}`.
  // Empty set = no filter (all values pass). Non-empty = row's value
  // for that column must be in the set.
  const [coverageColumnFilters, setCoverageColumnFilters] = useState<Record<string, Set<string>>>({});
  const setCoverageColumnFilter = useCallback(
    (tab: string, col: string, next: Set<string>) => {
      setCoverageColumnFilters((prev) => ({ ...prev, [`${tab}.${col}`]: next }));
    },
    [],
  );
  const getCoverageColumnFilter = useCallback(
    (tab: string, col: string): Set<string> =>
      coverageColumnFilters[`${tab}.${col}`] ?? new Set<string>(),
    [coverageColumnFilters],
  );
  // Per-tab per-column live search query — applies as a substring
  // filter on the underlying rows as the user types, AND on the
  // popover's option list. Separate from `coverageColumnFilters`
  // (checkbox-selected values), and both apply together (AND).
  const [coverageColumnQueries, setCoverageColumnQueries] = useState<Record<string, string>>({});
  const setCoverageColumnQuery = useCallback((tab: string, col: string, next: string) => {
    setCoverageColumnQueries((prev) => ({ ...prev, [`${tab}.${col}`]: next }));
  }, []);
  const getCoverageColumnQuery = useCallback(
    (tab: string, col: string): string => coverageColumnQueries[`${tab}.${col}`] ?? "",
    [coverageColumnQueries],
  );
  // Tracks which column header popover is open (only one at a time).
  const [openCoverageFilterKey, setOpenCoverageFilterKey] = useState<string | null>(null);
  /** Inline-edit state for the Epic Estimation Coverage "Estimated epics"
   *  table. Only one cell can be in edit mode at a time. `column` is the
   *  field key (`title` / `initiativeId` / `planSprint` / `team` /
   *  `assignee` / `originalEstimateDays`). `draft` is the in-progress
   *  edit value held locally until the planner confirms with the check
   *  button (or Enter) or cancels with X (or Escape). */
  type EpicCoverageEditCell = {
    epicId: string;
    column:
      | "title"
      | "initiativeId"
      | "planSprint"
      | "team"
      | "assignee"
      | "originalEstimateDays";
    draft: string;
    // When the edit was triggered from a story row in the Stories-
    // without-description table, multiple rows may share the same
    // parent epic. Without this tag, *every* such row matches
    // `epicId + column` and renders the editor in parallel — causing
    // a stack of duplicate popups. The triggering row writes its own
    // storyId here and the conditional in that table gates on it so
    // only the originating row renders the editor.
    triggerStoryId?: string;
  };
  const [estimateEditCell, setEstimateEditCell] = useState<EpicCoverageEditCell | null>(null);
  const [estimateSavingCell, setEstimateSavingCell] = useState<string | null>(null);
  /** Inline-edit state for story rows inside the Epic Estimation
   *  Coverage accordion. Parallel to `estimateEditCell` but keyed by
   *  story. Team is intentionally not editable — stories inherit team
   *  from their parent epic. */
  type StoryCoverageEditCell = {
    storyId: string;
    column: "title" | "sprint" | "assignee" | "estimatedDays" | "epicId";
    draft: string;
  };
  const [storyEditCell, setStoryEditCell] = useState<StoryCoverageEditCell | null>(null);
  const [storySavingCell, setStorySavingCell] = useState<string | null>(null);
  /** True when any column on `tab` has a checkbox selection or a
   *  typed query — used to show / enable the per-tab "Clear filters"
   *  button at the panel header. */
  const tabHasActiveFilters = useCallback(
    (tab: string): boolean => {
      const prefix = `${tab}.`;
      for (const [key, val] of Object.entries(coverageColumnFilters)) {
        if (key.startsWith(prefix) && val.size > 0) return true;
      }
      for (const [key, val] of Object.entries(coverageColumnQueries)) {
        if (key.startsWith(prefix) && val.length > 0) return true;
      }
      return false;
    },
    [coverageColumnFilters, coverageColumnQueries],
  );
  /** Reset every column filter (checkbox + query) for the given tab. */
  const clearTabFilters = useCallback((tab: string) => {
    const prefix = `${tab}.`;
    setCoverageColumnFilters((prev) => {
      const next: typeof prev = {};
      for (const [key, val] of Object.entries(prev)) {
        if (!key.startsWith(prefix)) next[key] = val;
      }
      return next;
    });
    setCoverageColumnQueries((prev) => {
      const next: typeof prev = {};
      for (const [key, val] of Object.entries(prev)) {
        if (!key.startsWith(prefix)) next[key] = val;
      }
      return next;
    });
  }, []);
  const prevEstPanelOpenRef = useRef(false);
  const prevEstScopeKeyRef = useRef<string | null>(null);
  const capacityTeamFilterRef = useRef<HTMLDivElement | null>(null);
  const [isSprintTeamMenuOpen, setIsSprintTeamMenuOpen] = useState(false);
  const [sprintTeamSearch, setSprintTeamSearch] = useState("");
  /** Yearsprint number whose "Rolled-in" audit modal is open, or null. */
  const [rolledInModalSprint, setRolledInModalSprint] = useState<number | null>(null);
  /** Yearsprint number whose "Rolled-out" audit modal is open, or null. */
  const [rolledOutModalSprint, setRolledOutModalSprint] = useState<number | null>(null);
  const sprintTeamSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [sprintFilterTeamIds, setSprintFilterTeamIds] = useState<string[]>(() => {
    const t = sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId);
    return t ? [t] : [];
  });
  /** Collapsed-team set for the multi-team retrospective accordion. A team is open when NOT in this set. */
  const [retroCollapsedTeams, setRetroCollapsedTeams] = useState<Set<string>>(new Set());
  const toggleRetroTeam = (teamId: string) => {
    setRetroCollapsedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };
  const [insightsTeamIds, setInsightsTeamIds] = useState<string[]>([]);
  /**
   * Sync the breadcrumb-area Teams filter with the Epic / Initiative Scope
   * dropdown: picking an epic narrows to that epic's delivery team; picking
   * an initiative (or clearing the scope) shows all teams. Fires for manual
   * dropdown selection AND for scope set externally (e.g. clicking the %
   * chip on a Gantt bar updates initialInsightsScopeEpicId, which
   * MonthAnalytics syncs into selectedEpicId, which triggers onScopeChange).
   */
  const handleInsightsScopeChange = useCallback(
    (type: "epic" | "initiative" | null, id: string | null) => {
      onInsightsScopeChange?.(type === "epic" ? id : null, type === "initiative" ? id : null);
      let next: string[] = [];
      if (type === "epic" && id) {
        const epic = initiatives.flatMap((i) => i.epics ?? []).find((e) => e.id === id);
        const team = epic?.team?.trim() ?? null;
        if (team) next = [team];
      }
      // Functional update — bails out (returns prev) when content matches, so
      // the array reference stays stable across renders. Without this,
      // [team] !== [team] would trigger an effect loop in MonthAnalytics,
      // which calls onScopeChange every render when onScopeChange's ref
      // changes (inline arrow at the callsite).
      setInsightsTeamIds((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next,
      );
    },
    [initiatives, onInsightsScopeChange],
  );
  const [isInsightsTeamMenuOpen, setIsInsightsTeamMenuOpen] = useState(false);
  const [insightsTeamSearch, setInsightsTeamSearch] = useState("");
  const insightsTeamMenuRef = useRef<HTMLDivElement | null>(null);
  const insightsTeamSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [ganttTeamIds, setGanttTeamIdsRaw] = useState<string[]>([]);
  const setGanttTeamIds = useCallback<typeof setGanttTeamIdsRaw>((updater) => {
    setGanttTeamIdsRaw((prev) => {
      const next = typeof updater === "function" ? (updater as (p: string[]) => string[])(prev) : updater;
      console.log("[team-filter] setGanttTeamIds", {
        from: prev,
        to: next,
        caller: new Error().stack?.split("\n").slice(2, 5).join(" | "),
      });
      return next;
    });
  }, []);
  const [isGanttTeamMenuOpen, setIsGanttTeamMenuOpen] = useState(false);
  const [ganttTeamSearch, setGanttTeamSearch] = useState("");
  const ganttTeamMenuRef = useRef<HTMLDivElement | null>(null);
  const ganttTeamSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [ganttSearchQuery, setGanttSearchQuery] = useState("");
  const [ganttSearchOpen, setGanttSearchOpen] = useState(false);
  const [ganttSearchFilter, setGanttSearchFilter] = useState<{ type: "initiative" | "epic"; id: string; label: string } | null>(null);
  const ganttSearchRef = useRef<HTMLDivElement | null>(null);
  const ganttSearchInputRef = useRef<HTMLInputElement | null>(null);
  // Q4 panel in the all-quarters Gantt header strip — its width + left position drive the Gantt search box.
  const [quarter4PanelMetrics, setQuarter4PanelMetrics] = useState<{ width: number; left: number } | null>(null);
  const quarter4PanelMetricsRef = useRef<{ width: number; left: number } | null>(null);
  const quarter4NodeRef = useRef<HTMLElement | null>(null);
  /** Debounce: during the left-rail slide the Q4 panel resizes ~20 times in 320ms — each ResizeObserver hit otherwise
   *  re-renders the whole timeline-grid (4 quarters × all rows). First measurement commits sync so the search aligns
   *  on first paint; later ones land 150ms after the resize stream stops. */
  const quarter4MetricsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureQuarter4 = useCallback(() => {
    const node = quarter4NodeRef.current;
    const searchEl = ganttSearchRef.current;
    if (!node || !searchEl) return;
    const rect = node.getBoundingClientRect();
    const parent = searchEl.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const width = Math.round(rect.width);
    const left = Math.max(0, Math.round(rect.left - parentRect.left));
    if (width <= 0) return;
    const next = { width, left };
    if (quarter4PanelMetricsRef.current === null) {
      quarter4PanelMetricsRef.current = next;
      setQuarter4PanelMetrics(next);
      return;
    }
    quarter4PanelMetricsRef.current = next;
    if (quarter4MetricsTimerRef.current) clearTimeout(quarter4MetricsTimerRef.current);
    quarter4MetricsTimerRef.current = setTimeout(() => {
      quarter4MetricsTimerRef.current = null;
      const latest = quarter4PanelMetricsRef.current;
      if (latest) {
        setQuarter4PanelMetrics(latest);
      }
    }, 150);
  }, []);
  useEffect(() => () => {
    if (quarter4MetricsTimerRef.current) clearTimeout(quarter4MetricsTimerRef.current);
  }, []);
  const quarter4ResizeObserverRef = useRef<ResizeObserver | null>(null);
  if (typeof window !== "undefined" && !quarter4ResizeObserverRef.current) {
    quarter4ResizeObserverRef.current = new ResizeObserver(() => { measureQuarter4(); });
  }
  // Re-measure on window resize too (the search and Q4 don't share a parent so a resize on either side matters).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => measureQuarter4();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measureQuarter4]);
  const setQuarter4PanelRef = useCallback((node: HTMLElement | null) => {
    quarter4NodeRef.current = node;
    const ro = quarter4ResizeObserverRef.current;
    if (!ro) return;
    ro.disconnect();
    if (node) {
      ro.observe(node);
      measureQuarter4();
    } else {
      quarter4PanelMetricsRef.current = null;
      if (quarter4MetricsTimerRef.current) {
        clearTimeout(quarter4MetricsTimerRef.current);
        quarter4MetricsTimerRef.current = null;
      }
      setQuarter4PanelMetrics(null);
    }
  }, [measureQuarter4]);

  // Last-month panel in the single-quarter Gantt — same idea as Q4, but for the quarter view: search aligns with
  // the rightmost month panel (e.g. June for Q2, December for Q4) and the export icon sits inside that panel's tail.
  const [lastMonthPanelMetrics, setLastMonthPanelMetrics] = useState<{ width: number; left: number } | null>(null);
  const lastMonthPanelMetricsRef = useRef<{ width: number; left: number } | null>(null);
  const lastMonthNodeRef = useRef<HTMLElement | null>(null);
  const lastMonthMetricsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureLastMonthPanel = useCallback(() => {
    const node = lastMonthNodeRef.current;
    const searchEl = ganttSearchRef.current;
    if (!node || !searchEl) return;
    const rect = node.getBoundingClientRect();
    const parent = searchEl.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const width = Math.round(rect.width);
    const left = Math.max(0, Math.round(rect.left - parentRect.left));
    if (width <= 0) return;
    const next = { width, left };
    if (lastMonthPanelMetricsRef.current === null) {
      lastMonthPanelMetricsRef.current = next;
      setLastMonthPanelMetrics(next);
      return;
    }
    lastMonthPanelMetricsRef.current = next;
    if (lastMonthMetricsTimerRef.current) clearTimeout(lastMonthMetricsTimerRef.current);
    lastMonthMetricsTimerRef.current = setTimeout(() => {
      lastMonthMetricsTimerRef.current = null;
      const latest = lastMonthPanelMetricsRef.current;
      if (latest) {
        setLastMonthPanelMetrics(latest);
      }
    }, 150);
  }, []);
  useEffect(() => () => {
    if (lastMonthMetricsTimerRef.current) clearTimeout(lastMonthMetricsTimerRef.current);
  }, []);
  const lastMonthResizeObserverRef = useRef<ResizeObserver | null>(null);
  if (typeof window !== "undefined" && !lastMonthResizeObserverRef.current) {
    lastMonthResizeObserverRef.current = new ResizeObserver(() => { measureLastMonthPanel(); });
  }
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => measureLastMonthPanel();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measureLastMonthPanel]);
  const setLastMonthPanelRef = useCallback((node: HTMLElement | null) => {
    lastMonthNodeRef.current = node;
    const ro = lastMonthResizeObserverRef.current;
    if (!ro) return;
    ro.disconnect();
    if (node) {
      ro.observe(node);
      measureLastMonthPanel();
    } else {
      lastMonthPanelMetricsRef.current = null;
      if (lastMonthMetricsTimerRef.current) {
        clearTimeout(lastMonthMetricsTimerRef.current);
        lastMonthMetricsTimerRef.current = null;
      }
      setLastMonthPanelMetrics(null);
    }
  }, [measureLastMonthPanel]);
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
    // Default panel width grew alongside the wider Epic + Initiative
    // columns. Hard minimum bumped from 720 → 840 so the table never
    // squishes those two columns past readable width; viewport ratio
    // 0.56 → 0.64 so the panel takes a larger share of the screen on
    // wider monitors where the extra room is most useful.
    const defaultWidth = Math.max(840, Math.min(window.innerWidth - 16, Math.round(window.innerWidth * 0.64)));
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

  const openEstEpicsPanel = useCallback((initialTab?: EstimateCoveragePanelTab) => {
    if (estEpicsPanelCloseTimerRef.current) {
      clearTimeout(estEpicsPanelCloseTimerRef.current);
      estEpicsPanelCloseTimerRef.current = null;
    }
    skipEstEpicsPanelEnterRef.current = false;
    if (initialTab) setEstimateCoveragePanelTab(initialTab);
    if (estEpicsPanelOpen) {
      setEstEpicsPanelEntered(true);
      return;
    }
    setEstEpicsPanelOpen(true);
  }, [estEpicsPanelOpen]);

  // Imperative open command from the dashboard hero donut. Fires whenever
  // the parent bumps the key; tab tells us which sub-view to land on.
  const openEstPanelCmdKey = openEstPanelCmd?.key;
  useEffect(() => {
    if (!openEstPanelCmd) return;
    openEstEpicsPanel(openEstPanelCmd.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEstPanelCmdKey]);

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
    // Match the Gantt's "this initiative has at least one epic landing in
    // the quarter" rule rather than gating on the initiative's own status +
    // top-level dates. The chip should agree with the bar count the user
    // sees on the timeline.
    const quarterInitiatives = initiatives.filter((initiative) =>
      (initiative.epics ?? []).some(
        (epic) =>
          epic.planStartMonth != null &&
          epic.planEndMonth != null &&
          !(epic.planEndMonth < qStart || epic.planStartMonth > qEnd),
      ),
    );
    const allEpicsInQuarter = quarterInitiatives.flatMap((initiative) => initiative.epics ?? []).filter(
      (epic) =>
        epic.planStartMonth != null &&
        epic.planEndMonth != null &&
        !(epic.planEndMonth < qStart || epic.planStartMonth > qEnd),
    );
    const scheduledEpics = allEpicsInQuarter.filter((epic) => epic.planSprint != null);
    const unscheduledEpics = allEpicsInQuarter.length - scheduledEpics.length;
    const totalStories = allEpicsInQuarter.reduce((sum, epic) => sum + (epic.userStories?.length ?? 0), 0);
    return {
      totalInitiatives: quarterInitiatives.length,
      scheduledInitiatives: quarterInitiatives.length,
      totalEpics: allEpicsInQuarter.length,
      scheduledEpics: scheduledEpics.length,
      unscheduledEpics,
      totalStories,
    };
  }, [focusedMonthExternal, focusedQuarter, initiatives, summaryBadges]);
  const quarterRoadmapEpics = useMemo(() => {
    if (!focusedQuarter) return [] as Array<{ epic: EpicItem; initiative: InitiativeItem; startS: number; endS: number; ghostOnly: boolean; ghostInQDaysLeft?: number }>;
    const qStart = focusedQuarter.months[0];
    const qEnd = focusedQuarter.months[focusedQuarter.months.length - 1];
    const qStartS = firstGlobalSprintForMonth(qStart);
    const qHiS = globalSprintFromMonthLane(focusedQuarter.months[focusedQuarter.months.length - 1], 2);
    const rows: Array<{ epic: EpicItem; initiative: InitiativeItem; startS: number; endS: number; ghostOnly: boolean; ghostInQDaysLeft?: number }> = [];
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (epic.planStartMonth == null || epic.planEndMonth == null) continue;
        const planInScope = !(epic.planEndMonth < qStart || epic.planStartMonth > qEnd);
        const startS = globalSprintFromMonthLane(epic.planStartMonth, epic.planSprint === 2 ? 2 : 1);
        const endS = globalSprintFromMonthLane(epic.planEndMonth, epic.planEndSprint === 1 ? 1 : 2);
        if (planInScope) {
          rows.push({ epic, initiative, startS, endS, ghostOnly: false });
          continue;
        }
        // Plan is OUTSIDE the focused quarter. Only surface a ghost-only
        // row when ALL of these hold:
        //   1. Plan-end is before the quarter starts (slipped Q1 epic).
        //   2. Epic is still overdue (not formally done).
        //   3. AT LEAST ONE of its open stories is sprinted INTO this
        //      quarter — the Rule 2 gate. Without this, an "abstractly
        //      overdue" epic whose stories never moved out of Q1 would
        //      show a phantom ghost in Q2 even though no engineer is
        //      scheduled to work on it here.
        if (epic.planEndMonth < qStart) {
          if (!epicIsOverdueByPlan(epic, currentYear)) continue;
          const footprint = epicQuarterFootprint(epic, qStartS, qHiS);
          if (footprint == null) continue;
          rows.push({
            epic,
            initiative,
            // Ghost spans the in-quarter sprint footprint exactly —
            // first sprint with an open story → last sprint with an
            // open story. This is the visible right edge that
            // `epicVirtualEndS(isGhostOnly=true)` returns verbatim.
            startS: footprint.firstSprint,
            endS: footprint.lastSprint,
            ghostOnly: true,
            ghostInQDaysLeft: footprint.inQDaysLeft,
          });
        }
      }
    }
    return rows.sort(
      (a, b) =>
        a.epic.timelineRow - b.epic.timelineRow ||
        a.epic.title.localeCompare(b.epic.title),
    );
  }, [focusedQuarter, initiatives, currentYear]);
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
    // First-fit pass — overdue epics carry a virtual right-edge that
    // includes their ghost extension, so any neighbour whose plan
    // range falls inside that ghost is bumped to the next row. Same
    // visual effect as the drag-and-drop "make space" behaviour,
    // computed client-side without persisting anything.
    return repackEpicRowsWithGhostCollisions(quarterRoadmapEpics, currentYear);
  }, [quarterRoadmapEpics, currentYear]);
  const filteredQuarterRoadmapEpicRows = useMemo(() => {
    if (!ganttTeamIds.length) return quarterRoadmapEpicRows;
    return quarterRoadmapEpicRows
      .map((group) => ({ ...group, items: group.items.filter((row) => row.epic.team && ganttTeamIds.includes(row.epic.team)) }))
      .filter((group) => group.items.length > 0);
  }, [quarterRoadmapEpicRows, ganttTeamIds]);
  const yearRoadmapEpicRows = useMemo(() => {
    return repackEpicRowsWithGhostCollisions(yearRoadmapEpics, currentYear);
  }, [yearRoadmapEpics, currentYear]);
  const filteredYearRoadmapEpicRows = useMemo(() => {
    if (!ganttTeamIds.length) return yearRoadmapEpicRows;
    return yearRoadmapEpicRows
      .map((group) => ({ ...group, items: group.items.filter((row) => row.epic.team && ganttTeamIds.includes(row.epic.team)) }))
      .filter((group) => group.items.length > 0);
  }, [yearRoadmapEpicRows, ganttTeamIds]);

  // ─── Gantt search filter (autocomplete by name + scope) ──────────────────────
  // Defined later, after `activeMonth` is computed — see below.

  const ganttSearchEpicIds = useMemo((): Set<string> | null => {
    if (!ganttSearchFilter && !ganttSearchQuery.trim()) return null;
    if (ganttSearchFilter) {
      if (ganttSearchFilter.type === "epic") return new Set([ganttSearchFilter.id]);
      const ids = new Set<string>();
      for (const { epic, initiative } of yearRoadmapEpics) {
        if (initiative.id === ganttSearchFilter.id) ids.add(epic.id);
      }
      return ids;
    }
    const q = ganttSearchQuery.trim().toLowerCase();
    const ids = new Set<string>();
    for (const { epic } of yearRoadmapEpics) { if (epic.title.toLowerCase().includes(q)) ids.add(epic.id); }
    return ids;
  }, [ganttSearchFilter, ganttSearchQuery, yearRoadmapEpics]);

  const ganttSearchInitiativeIds = useMemo((): Set<string> | null => {
    if (!ganttSearchFilter && !ganttSearchQuery.trim()) return null;
    if (ganttSearchFilter?.type === "initiative") return new Set([ganttSearchFilter.id]);
    if (ganttSearchFilter?.type === "epic") return null;
    const q = ganttSearchQuery.trim().toLowerCase();
    const ids = new Set<string>();
    for (const { initiative } of yearRoadmapInitiatives) { if (initiative.title.toLowerCase().includes(q)) ids.add(initiative.id); }
    return ids;
  }, [ganttSearchFilter, ganttSearchQuery, yearRoadmapInitiatives]);

  const ganttSearchAppliedYearEpicRows = useMemo(() => {
    if (!ganttSearchEpicIds) return filteredYearRoadmapEpicRows;
    return filteredYearRoadmapEpicRows.map(g => ({ ...g, items: g.items.filter(i => ganttSearchEpicIds!.has(i.epic.id)) })).filter(g => g.items.length > 0);
  }, [filteredYearRoadmapEpicRows, ganttSearchEpicIds]);

  const ganttSearchAppliedQuarterEpicRows = useMemo(() => {
    if (!ganttSearchEpicIds) return filteredQuarterRoadmapEpicRows;
    return filteredQuarterRoadmapEpicRows.map(g => ({ ...g, items: g.items.filter(i => ganttSearchEpicIds!.has(i.epic.id)) })).filter(g => g.items.length > 0);
  }, [filteredQuarterRoadmapEpicRows, ganttSearchEpicIds]);

  const ganttSearchAppliedYearInitiativeRows = useMemo(() => {
    if (!ganttSearchInitiativeIds) return yearRoadmapInitiativeRows;
    return yearRoadmapInitiativeRows.map(g => ({ ...g, items: g.items.filter(i => ganttSearchInitiativeIds!.has(i.initiative.id)) })).filter(g => g.items.length > 0);
  }, [yearRoadmapInitiativeRows, ganttSearchInitiativeIds]);

  const ganttSearchAppliedQuarterInitiativeRows = useMemo(() => {
    if (!ganttSearchInitiativeIds) return quarterRoadmapInitiativeRows;
    return quarterRoadmapInitiativeRows.map(g => ({ ...g, items: g.items.filter(i => ganttSearchInitiativeIds!.has(i.initiative.id)) })).filter(g => g.items.length > 0);
  }, [quarterRoadmapInitiativeRows, ganttSearchInitiativeIds]);

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
  /** Search field is Gantt-only: shown on year/quarter Gantt and on the month Epic-Gantt tab; hidden on Kanban, Capacity, Insights, Retro, Status. */
  const showGanttSearch =
    isFullYearGanttLayout ||
    isQuarterGanttLayout ||
    (activeMonth != null && monthPlanTab === "epic-gantt");

  /**
   * Gantt-search autocomplete — scoped to the user's current view AND the
   * breadcrumb team filter, so we don't suggest epics the user can't see on
   * the chart underneath. Year view → year rows; quarter view → epics whose
   * plan window overlaps the focused quarter; month view → epics overlapping
   * the active month. Initiative suggestions follow the same rule by
   * checking whether *any* child epic is in scope. Each row also carries the
   * list of quarter labels it spans, surfaced as a chip in the dropdown so
   * you can tell at a glance where a match sits in the year.
   */
  const ganttSearchResults = useMemo(() => {
    const q = ganttSearchQuery.trim().toLowerCase();
    const monthOk = (epic: EpicItem): boolean => {
      if (activeMonth == null) return true;
      if (epic.planStartMonth == null || epic.planEndMonth == null) return false;
      return epic.planStartMonth <= activeMonth && epic.planEndMonth >= activeMonth;
    };
    const quarterOk = (epic: EpicItem): boolean => {
      if (!focusedQuarter) return true;
      if (epic.planStartMonth == null || epic.planEndMonth == null) return false;
      const qs = focusedQuarter.months[0]!;
      const qe = focusedQuarter.months[focusedQuarter.months.length - 1]!;
      return epic.planEndMonth >= qs && epic.planStartMonth <= qe;
    };
    const teamOk = (epic: EpicItem): boolean => {
      if (ganttTeamIds.length === 0) return true;
      return Boolean(epic.team) && ganttTeamIds.includes(epic.team as string);
    };
    const epicInScope = (epic: EpicItem): boolean => monthOk(epic) && quarterOk(epic) && teamOk(epic);

    // Quarter labels an epic touches, in calendar order (e.g. ["Q2", "Q3"]).
    // Used for the chip in the dropdown row — empty when the epic is
    // unscheduled or its plan months don't map to any QUARTERS entry.
    const quartersForEpic = (epic: EpicItem): string[] => {
      if (epic.planStartMonth == null || epic.planEndMonth == null) return [];
      const labels: string[] = [];
      for (const q of QUARTERS) {
        const qs = q.months[0]!;
        const qe = q.months[q.months.length - 1]!;
        if (epic.planEndMonth >= qs && epic.planStartMonth <= qe) labels.push(q.label);
      }
      return labels;
    };
    // Union of quarter labels across the initiative's in-scope epics.
    const quartersForInit = (init: InitiativeItem): string[] => {
      const set = new Set<string>();
      for (const epic of init.epics ?? []) {
        if (!epicInScope(epic)) continue;
        for (const lbl of quartersForEpic(epic)) set.add(lbl);
      }
      return [...set].sort();
    };

    const scopedEpics = yearRoadmapEpics.filter((r) => epicInScope(r.epic));
    const scopedInits = yearRoadmapInitiatives.filter((r) =>
      (r.initiative.epics ?? []).some(epicInScope),
    );

    if (roadmapBarMode === "initiatives") {
      return {
        initiatives: scopedInits
          .filter((i) => !q || i.initiative.title.toLowerCase().includes(q))
          .slice(0, 8)
          .map((i) => ({ initiative: i.initiative, quarterLabels: quartersForInit(i.initiative) })),
        epics: [] as Array<{ epic: EpicItem; quarterLabels: string[] }>,
      };
    }
    return {
      initiatives: scopedInits
        .filter((i) => !q || i.initiative.title.toLowerCase().includes(q))
        .slice(0, 5)
        .map((i) => ({ initiative: i.initiative, quarterLabels: quartersForInit(i.initiative) })),
      epics: scopedEpics
        .filter((i) => !q || i.epic.title.toLowerCase().includes(q))
        .slice(0, 8)
        .map((i) => ({ epic: i.epic, quarterLabels: quartersForEpic(i.epic) })),
    };
  }, [
    ganttSearchQuery,
    roadmapBarMode,
    yearRoadmapInitiatives,
    yearRoadmapEpics,
    activeMonth,
    focusedQuarter,
    ganttTeamIds,
  ]);

  /**
   * Auto-close the health popover when the user navigates away from any Gantt
   * surface (insights / capacity / sprint kanban / sprint retro / etc.).
   * Scope-changing navigations like drilling into a single quarter or month
   * are deliberately NOT in this list — the popover should follow the scope
   * and just update its counts. Dialog opens (epic / story / initiative) are
   * handled separately via the wrapped onOpen* callbacks above.
   */
  useEffect(() => {
    if (!healthPopoverOpen) return;
    const onGanttSurface =
      (activeMonth == null && quarterViewTab === "gantt") ||
      (activeMonth != null && monthPlanTab === "epic-gantt");
    if (!onGanttSurface) {
      setHealthPopoverOpen(false);
      onShowRoadmapProgressChange(false);
    }
  }, [healthPopoverOpen, activeMonth, quarterViewTab, monthPlanTab, onShowRoadmapProgressChange]);
  const scopedEpicsForEstimatePanel = useMemo(() => {
    /**
     * Sprint-aware scope: when on any sprint surface (kanban / status / capacity / retro),
     * scope by team-filtered epics across all initiatives (mirrors
     * `computeSprintKanbanSummaryStats` so the popup matches the chip counts
     * exactly). On non-sprint surfaces, fall back to the month / quarter / year
     * scope that uses scheduled initiatives overlapping the focus window.
     */
    const onSprintSurface =
      monthPlanTab === "sprint-kanban" ||
      monthPlanTab === "sprint-status" ||
      monthPlanTab === "sprint-capacity" ||
      monthPlanTab === "sprint-retrospective";
    const sprintFromExternal =
      activeSprintExternal !== undefined && activeSprintExternal != null
        ? clampYearSprint(activeSprintExternal)
        : null;
    const sprintFromState = activeSprint != null ? clampYearSprint(activeSprint) : null;
    const candidateSprint =
      sprintFromExternal ??
      sprintFromState ??
      (activeMonth != null ? firstGlobalSprintForMonth(activeMonth) : null);
    const sprintCtxMonth =
      activeMonth != null
        ? activeMonth
        : candidateSprint != null
          ? monthLaneFromGlobalSprint(candidateSprint).month
          : null;
    const sprintCtx =
      onSprintSurface && candidateSprint != null && sprintCtxMonth != null
        ? {
            month: sprintCtxMonth,
            yearSprint: candidateSprint,
            teamIds: sprintFilterTeamIds.length ? sprintFilterTeamIds : null,
          }
        : null;

    let scopedRows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    if (sprintCtx) {
      const teamIds = sprintCtx.teamIds;
      scopedRows = initiatives.flatMap((initiative) =>
        (initiative.epics ?? [])
          .filter((epic) => !teamIds || teamIds.includes(epic.team ?? ""))
          .map((epic) => ({ epic, initiative })),
      );
    } else if (activeMonth) {
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
    // 3-tier estimation buckets:
    //   • "estimated"          — epic has originalEstimateDays AND every
    //                             child story is sized (or there are no
    //                             child stories yet).
    //   • "partiallyEstimated" — epic has originalEstimateDays but at
    //                             least one child story is missing
    //                             estimatedDays. The epic is "sized" at
    //                             the rollup level but the decomposition
    //                             isn't complete.
    //   • "unestimated"        — epic has no originalEstimateDays at all.
    //
    // Edge case: a story with estimatedDays of exactly 0 counts as
    // missing — planners type a positive number to mark "sized".
    const estimated = scopedRows.filter((row) => {
      if (Number(row.epic.originalEstimateDays ?? 0) <= 0) return false;
      const stories = row.epic.userStories ?? [];
      return stories.length === 0 || stories.every((s) => Number(s.estimatedDays ?? 0) > 0);
    });
    const partiallyEstimated = scopedRows.filter((row) => {
      if (Number(row.epic.originalEstimateDays ?? 0) <= 0) return false;
      const stories = row.epic.userStories ?? [];
      return stories.length > 0 && stories.some((s) => Number(s.estimatedDays ?? 0) <= 0);
    });
    const unestimated = scopedRows.filter((row) => Number(row.epic.originalEstimateDays ?? 0) <= 0);
    const unscheduledStories: Array<{ story: UserStoryItem; epic: EpicItem; initiative: InitiativeItem }> = [];
    if (sprintCtx) {
      for (const row of scopedRows) {
        for (const story of row.epic.userStories ?? []) {
          if (!storyMatchesYearSprint(story, sprintCtx.month, sprintCtx.yearSprint)) {
            unscheduledStories.push({ story, epic: row.epic, initiative: row.initiative });
          }
        }
      }
    }
    return { all: scopedRows, estimated, partiallyEstimated, unestimated, unscheduledStories, sprintCtx };
  }, [
    activeMonth,
    focusedQuarter,
    initiatives,
    monthPlanTab,
    activeSprint,
    activeSprintExternal,
    sprintFilterTeamIds,
  ]);
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
  // Top-toolbar summary chips. Now styled to match the BACKLOG WORKSPACE's
  // top-panel filter buttons (h-[34px], rounded-lg, slate border) and to
  // rotate between the two color treatments the backlog actually uses:
  //
  //   A) The "filter button" look — white background, slate-300 border,
  //      slate-700 text, hover lifts slate-400 border + slate-50 bg.
  //   B) The "Group By" look — indigo→violet pastel gradient, slate border,
  //      indigo-700 text, hover deepens to indigo/violet-100.
  //
  // Alternating these two styles across the chips gives the row visual rhythm
  // while sticking strictly to the backlog's palette. Selected (ON) chips use
  // a deeper fill + inset shadow so they read as pressed.
  // Match the reference image: PILL-SHAPED chips (rounded-full), pale indigo
  // fill, semibold indigo text, hairline indigo ring. Selected state flips to
  // a pale yellow/amber fill (same shape, same text color) so the active chip
  // pops without changing geometry.
  const summaryChipShared =
    "inline-flex h-[28px] max-w-full shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold leading-none tracking-tight outline-none transition focus:outline-none focus:ring-2";

  // IDLE — pale indigo pill (the look of "19 Initiatives" / "Sign in" chips
  // in the reference).
  // Chip background mirrors the breadcrumb panel's sky → indigo → violet
  // pastel gradient so the top toolbar reads as one continuous palette.
  const chipIdle = `${summaryChipShared} bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 text-indigo-900 ring-1 ring-indigo-200/80 hover:from-sky-200/80 hover:via-indigo-200/80 hover:to-violet-200/80 focus:ring-indigo-300`;
  // ON — pale amber pill (the highlighted "9 Epics" chip in the reference).
  const chipOn = `${summaryChipShared} bg-amber-100 text-amber-900 ring-1 ring-amber-200 shadow-[inset_0_2px_4px_rgba(15,23,42,0.10)] focus:ring-amber-300`;

  // All chips share the same idle/on look — the reference shows one consistent
  // pale-indigo palette with the selected chip flipped to amber, not a rotated
  // rainbow of hues.
  const summaryChipBaseClass = summaryChipShared;
  const summaryChipInitiativesIdleClass = chipIdle;
  const summaryChipInitiativesOnClass = chipOn;
  const summaryChipEpicsIdleClass = chipIdle;
  const summaryChipEpicsOnClass = chipOn;
  const summaryChipStoriesClass = chipIdle;
  const summaryChipStoriesStaticClass = summaryChipStoriesClass;
  const summaryChipEstimatedClass = chipIdle;
  const summaryChipSprintsIdleClass = chipIdle;
  const summaryChipSprintsOnClass = chipOn;
  const summaryChipProgressIdleClass = chipIdle;
  const summaryChipProgressOnClass = chipOn;
  const summaryChipTeamsIdleClass = chipIdle;
  const summaryChipTeamsOnClass = chipOn;
  const summaryChipUnscheduledClass = chipIdle;
  const summaryChipProgressCircleClass = "size-3 shrink-0 sm:size-3.5";

  const estimatePanelScopeLabel = scopedEpicsForEstimatePanel.sprintCtx
    ? `${MONTHS[scopedEpicsForEstimatePanel.sprintCtx.month - 1]} · Sprint ${scopedEpicsForEstimatePanel.sprintCtx.yearSprint}`
    : activeMonth
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

  /**
   * Snap the panel tab off the sprint-only "unscheduledStories" tab when the
   * user navigates off the sprint surface (e.g. closes Sprint Kanban). Avoids
   * an empty section if the panel is still open.
   */
  useEffect(() => {
    if (
      estimateCoveragePanelTab === "unscheduledStories" &&
      scopedEpicsForEstimatePanel.sprintCtx == null
    ) {
      setEstimateCoveragePanelTab("unestimated");
    }
  }, [estimateCoveragePanelTab, scopedEpicsForEstimatePanel.sprintCtx]);

  const estimatePanelTableClass =
    "w-full table-fixed border-collapse text-[15px] text-slate-950";
  const estimatePanelHeadCellClass =
    // `relative` makes each <th> the positioning context for its
    // CoverageColumnFilter popover, so it opens aligned to the
    // column's left edge.
    "relative px-3 py-2.5 text-left text-[13px] font-semibold uppercase tracking-wide text-slate-600";
  const estimatePanelBodyRowClass =
    "group transition hover:bg-[#c5ebff]";
  const estimatePanelCellClass = "px-3 py-3 overflow-hidden align-middle";
  const toggleEstimateEpicExpanded = (epicId: string) =>
    setExpandedEstimateEpicIds((prev) => {
      const next = new Set(prev);
      if (next.has(epicId)) next.delete(epicId);
      else next.add(epicId);
      return next;
    });

  const collapseEstimatePanelRows = useCallback(
    (variant: "estimated" | "partiallyEstimated" | "unestimated") => {
      const ids =
        variant === "unestimated"
          ? scopedEpicsForEstimatePanel.unestimated.map((r) => r.epic.id)
          : variant === "partiallyEstimated"
            ? scopedEpicsForEstimatePanel.partiallyEstimated.map((r) => r.epic.id)
            : scopedEpicsForEstimatePanel.estimated.map((r) => r.epic.id);
      setExpandedEstimateEpicIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    },
    [
      scopedEpicsForEstimatePanel.estimated,
      scopedEpicsForEstimatePanel.partiallyEstimated,
      scopedEpicsForEstimatePanel.unestimated,
    ],
  );

  const expandEstimatePanelRows = useCallback(
    (variant: "estimated" | "partiallyEstimated" | "unestimated") => {
      const ids =
        variant === "unestimated"
          ? scopedEpicsForEstimatePanel.unestimated.map((r) => r.epic.id)
          : variant === "partiallyEstimated"
            ? scopedEpicsForEstimatePanel.partiallyEstimated.map((r) => r.epic.id)
            : scopedEpicsForEstimatePanel.estimated.map((r) => r.epic.id);
      setExpandedEstimateEpicIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
    },
    [
      scopedEpicsForEstimatePanel.estimated,
      scopedEpicsForEstimatePanel.partiallyEstimated,
      scopedEpicsForEstimatePanel.unestimated,
    ],
  );

  // Extract a column's display value for an epic-coverage row.
  function getEpicCoverageColValue(
    row: { epic: EpicItem; initiative: InitiativeItem },
    col: string,
  ): string {
    switch (col) {
      case "epic": return row.epic.title || "";
      case "initiative": return row.initiative.title || "";
      case "sprint": return estimatePanelEpicSprintLabel(row.epic) || "";
      case "team": return row.epic.team || "";
      case "assignee": return row.epic.assignee || "";
      default: return "";
    }
  }
  function getStoryCoverageColValue(
    row: { story: UserStoryItem; epic: EpicItem; initiative: InitiativeItem },
    col: string,
  ): string {
    switch (col) {
      case "story": return row.story.title || "";
      case "sprint": return row.story.sprint != null ? `Sprint ${row.story.sprint}` : "";
      case "team": return row.story.team || row.epic.team || "";
      case "assignee": return row.story.assignee || "";
      case "epic": return row.epic.title || "";
      default: return "";
    }
  }
  function distinctSorted(values: string[]): string[] {
    return Array.from(new Set(values)).filter((v) => v.length > 0).sort((a, b) => a.localeCompare(b));
  }

  // ---------------------------------------------------------------
  // Story-level inline-edit helpers shared by every coverage table
  // that surfaces user stories (the accordion in renderEstimatePanelTable
  // and the flat list in renderStoriesWithoutDescriptionTable). All four
  // helpers close over component-level state (storyEditCell, setStoryEditCell,
  // etc.), so they work identically in every caller without threading
  // props. canEditStory is wired off `onPatchStory`; pass nothing and the
  // pencil simply doesn't render.
  // ---------------------------------------------------------------
  const canEditStorySharedRef = Boolean(onPatchStory);

  /** Compact lock affordance shown on hover for read-only cells (Σ
   *  Child Est, inherited Team). Lives at component scope so both the
   *  main coverage table and the Stories-without-description table can
   *  use it. Relies on the cell having `group/cell` so the hover
   *  reveal works. */
  function LockHint({ tip }: { tip: string }) {
    return (
      <span
        aria-label={tip}
        title={tip}
        className="inline-flex size-4 items-center justify-center rounded text-slate-400 opacity-0 transition-opacity group-hover/cell:opacity-60"
      >
        <Lock className="size-3" strokeWidth={2.2} aria-hidden />
      </span>
    );
  }

  async function commitStoryEdit(storyId: string, column: StoryCoverageEditCell["column"], draft: string) {
    if (!onPatchStory) return;
    const trimmed = draft.trim();
    setStorySavingCell(`${storyId}.${column}`);
    try {
      let patch:
        | Partial<{
            title: string;
            sprint: number | null;
            assignee: string | null;
            estimatedDays: number | null;
            epicId: string;
          }>
        | null = null;
      switch (column) {
        case "title": {
          if (!trimmed) return; // empty title silently rejected
          patch = { title: trimmed };
          break;
        }
        case "epicId": {
          // Autocomplete shows epic titles; resolve to UUID via the
          // initiatives tree. Case-insensitive exact match. If no
          // match, silently reject — the planner can pick from the
          // dropdown.
          const lower = trimmed.toLowerCase();
          let matchId: string | null = null;
          outer: for (const initiative of initiatives) {
            for (const epic of initiative.epics ?? []) {
              if (epic.title.toLowerCase() === lower) {
                matchId = epic.id;
                break outer;
              }
            }
          }
          if (!matchId) return;
          patch = { epicId: matchId };
          break;
        }
        case "sprint": {
          if (!trimmed) {
            patch = { sprint: null };
            break;
          }
          const n = Number(trimmed.replace(/^sprint\s*/i, ""));
          if (!Number.isFinite(n) || n < 1 || n > YEAR_SPRINT_MAX) return;
          patch = { sprint: Math.round(n) };
          break;
        }
        case "assignee":
          patch = { assignee: trimmed || null };
          break;
        case "estimatedDays": {
          if (!trimmed) {
            patch = { estimatedDays: null };
            break;
          }
          const n = Number(trimmed);
          if (!Number.isFinite(n) || n < 0 || n > 5000) return;
          patch = { estimatedDays: Math.round(n) };
          break;
        }
      }
      if (patch) {
        await onPatchStory(storyId, patch);
      }
    } finally {
      setStorySavingCell(null);
      setStoryEditCell(null);
    }
  }

  function EditStoryPencil({ storyId, column, initialDraft }: { storyId: string; column: StoryCoverageEditCell["column"]; initialDraft: string }) {
    if (!canEditStorySharedRef) return null;
    return (
      <button
        type="button"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          setStoryEditCell({ storyId, column, draft: initialDraft });
        }}
        aria-label="Edit cell"
        title="Edit"
        className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 transition-opacity group-hover/cell:opacity-100 hover:bg-slate-200/70 hover:text-slate-700"
      >
        <SquarePen className="size-3.5" strokeWidth={2.2} aria-hidden />
      </button>
    );
  }

  function isStoryEditing(storyId: string, column: StoryCoverageEditCell["column"]) {
    return Boolean(
      storyEditCell &&
        storyEditCell.storyId === storyId &&
        storyEditCell.column === column,
    );
  }

  function EditStoryFieldControls({
    storyId,
    column,
    type,
    placeholder,
    iconOptions,
  }: {
    storyId: string;
    column: StoryCoverageEditCell["column"];
    type: "text" | "number";
    placeholder?: string;
    iconOptions?: CoverageEditOption[];
  }) {
    if (!storyEditCell || storyEditCell.storyId !== storyId || storyEditCell.column !== column) {
      return null;
    }
    const saving = storySavingCell === `${storyId}.${column}`;
    return (
      <CoverageEditInput
        draft={storyEditCell.draft}
        saving={saving}
        type={type}
        placeholder={placeholder}
        allOptions={iconOptions ?? null}
        onDraftChange={(next) => setStoryEditCell({ ...storyEditCell, draft: next })}
        onSubmit={(value) => void commitStoryEdit(storyId, column, value)}
        onCancel={() => setStoryEditCell(null)}
      />
    );
  }

  function renderEstimatePanelTable(
    rows: Array<{ epic: EpicItem; initiative: InitiativeItem }>,
    variant: "estimated" | "partiallyEstimated" | "unestimated" | "epicsNoDesc",
  ) {
    // Every variant of this table now shows Est days + Σ Child Est —
    // the planner can compare top-line epic estimate against rolled-up
    // story estimates everywhere, and edit either inline. Kept as a
    // constant (rather than removed) so the conditional cells below
    // can still gate on it cheaply if we ever want to bring back a
    // narrow-mode variant.
    const showEstimatedColumns = true;
    // Apply per-column filters before render.
    const cols: readonly string[] = ["epic", "initiative", "sprint", "team", "assignee"];
    const displayRows = rows.filter((row) => {
      for (const col of cols) {
        const v = getEpicCoverageColValue(row, col);
        const sel = getCoverageColumnFilter(variant, col);
        if (sel.size > 0 && !sel.has(v)) return false;
        const q = getCoverageColumnQuery(variant, col).trim().toLowerCase();
        if (q && !v.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    const emptyRowCount = Math.max(0, 6 - displayRows.length);
    const colCount = showEstimatedColumns ? 7 : 6;
    // Sprint dropdown options — ordered starting from the current
    // sprint of the active plan year, then forward to the end of the
    // year, then wrapping back to early sprints. So the planner sees
    // "useful soon" sprints at the top instead of always scrolling
    // past Sprint 1–N.
    const currentSprintForYear = currentWorkYearSprintForPlan(currentYear) ?? 1;
    const sprintIconOptions: EditOption[] = (() => {
      const order = [
        ...Array.from({ length: YEAR_SPRINT_MAX - currentSprintForYear + 1 }, (_, i) => currentSprintForYear + i),
        ...Array.from({ length: currentSprintForYear - 1 }, (_, i) => i + 1),
      ];
      return order.map((n) => ({
        value: String(n),
        label: `Sprint ${n}`,
        icon: <Flag className="size-3.5 text-rose-500" strokeWidth={2.1} aria-hidden />,
      }));
    })();
    // Build per-column options with icons (epics get a folder icon,
    // initiatives a zap icon, sprint a flag, team an avatar, assignee
    // an avatar).
    function epicOpts(): CoverageFilterOption[] {
      return distinctSorted(rows.map((r) => getEpicCoverageColValue(r, "epic"))).map((v) => ({
        value: v,
        icon: <Folder className="size-3.5 text-sky-500" strokeWidth={2} aria-hidden />,
      }));
    }
    function initiativeOpts(): CoverageFilterOption[] {
      return distinctSorted(rows.map((r) => getEpicCoverageColValue(r, "initiative"))).map((v) => ({
        value: v,
        icon: <Zap className="size-3.5 text-sky-500" strokeWidth={2} aria-hidden />,
      }));
    }
    function sprintOpts(): CoverageFilterOption[] {
      return distinctSorted(rows.map((r) => getEpicCoverageColValue(r, "sprint"))).map((v) => ({
        value: v,
        icon: <Flag className="size-3.5 text-rose-500" strokeWidth={2.1} aria-hidden />,
      }));
    }
    function teamOpts(): CoverageFilterOption[] {
      return distinctSorted(rows.map((r) => getEpicCoverageColValue(r, "team"))).map((v) => ({
        value: v,
        icon: (
          <TeamAvatar
            slug={v || null}
            sizePx={16}
            fallback={<Users className="size-3.5 text-slate-400" aria-hidden />}
          />
        ),
      }));
    }
    function assigneeOpts(): CoverageFilterOption[] {
      return distinctSorted(rows.map((r) => getEpicCoverageColValue(r, "assignee"))).map((v) => {
        const resolved = resolveAssigneeAvatar(v, workspaceDirectoryUsers);
        return {
          value: v,
          icon: <UserAvatar name={resolved.name} image={resolved.image} size={18} className="ring-0" />,
        };
      });
    }
    const optionsForCol: Record<string, CoverageFilterOption[]> = {
      epic: epicOpts(),
      initiative: initiativeOpts(),
      sprint: sprintOpts(),
      team: teamOpts(),
      assignee: assigneeOpts(),
    };
    function filterIcon(col: string, label: string) {
      return (
        <CoverageColumnFilter
          filterKey={`${variant}.${col}`}
          label={label}
          options={optionsForCol[col] ?? []}
          selected={getCoverageColumnFilter(variant, col)}
          onChange={(next) => setCoverageColumnFilter(variant, col, next)}
          openKey={openCoverageFilterKey}
          setOpenKey={setOpenCoverageFilterKey}
          query={getCoverageColumnQuery(variant, col)}
          onQueryChange={(next) => setCoverageColumnQuery(variant, col, next)}
        />
      );
    }

    // -----------------------------------------------------------------
    // Inline-edit helpers — only active on the "estimated" variant when
    // the parent wired `onPatchEpic`. Each editable cell follows the
    // same flow: hover shows a Pencil icon on the right, click switches
    // to an input + X / ✓ confirm pair. Σ Child Est and Est Mix render
    // a Lock icon on hover instead to signal they're read-only.
    // -----------------------------------------------------------------
    // Inline editing is available in every coverage tab — planners
    // most often want to fix the missing data right where they spot
    // it (e.g. typing in an estimate from the Unestimated tab, or
    // assigning a team from the Epics-without-description tab).
    const canEdit = Boolean(onPatchEpic);
    /** Set of initiative titles → ids for resolving the autocomplete draft on save. */
    const initiativeOptions = canEdit
      ? initiatives.map((init) => ({ id: init.id, title: init.title }))
      : [];
    /** Known team slugs from MONTH_TEAM_COLUMNS plus any custom team slugs
     *  already attached to scoped epics. */
    const teamOptionSlugs = canEdit
      ? Array.from(
          new Set(
            ["", ...MONTH_TEAM_COLUMNS.map((c) => c.id), ...rows.map((r) => r.epic.team ?? "")].filter(
              (s, i, arr) => arr.indexOf(s) === i,
            ),
          ),
        )
      : [];
    /** Assignee suggestions: workspace directory names + any names already
     *  assigned to scoped epics, deduped. */
    const assigneeNameOptions = canEdit
      ? Array.from(
          new Set([
            ...(workspaceDirectoryUsers ?? []).map((u) => u.name),
            ...rows.map((r) => r.epic.assignee ?? "").filter(Boolean),
          ]),
        )
      : [];

    /** Commit an edit. Resolves the draft into an API patch shape and
     *  delegates to onPatchEpic. */
    async function commitEdit(epicId: string, column: EpicCoverageEditCell["column"], draft: string) {
      if (!onPatchEpic) return;
      const trimmed = draft.trim();
      setEstimateSavingCell(`${epicId}.${column}`);
      try {
        let patch:
          | Partial<{
              title: string;
              initiativeId: string;
              planSprint: number | null;
              team: string | null;
              assignee: string | null;
              originalEstimateDays: number | null;
            }>
          | null = null;
        switch (column) {
          case "title":
            if (!trimmed) return; // empty title silently rejected
            patch = { title: trimmed };
            break;
          case "initiativeId": {
            // The autocomplete shows initiative titles, but the API needs
            // the id. Match case-insensitively on the title; if no match,
            // silently reject (planner can pick from the suggestions).
            const lower = trimmed.toLowerCase();
            const match = initiativeOptions.find((opt) => opt.title.toLowerCase() === lower);
            if (!match) return;
            patch = { initiativeId: match.id };
            break;
          }
          case "planSprint": {
            if (!trimmed) {
              patch = { planSprint: null };
              break;
            }
            const n = Number(trimmed.replace(/^sprint\s*/i, ""));
            if (!Number.isFinite(n) || n < 1 || n > 24) return;
            patch = { planSprint: Math.round(n) };
            break;
          }
          case "team":
            patch = { team: trimmed || null };
            break;
          case "assignee":
            patch = { assignee: trimmed || null };
            break;
          case "originalEstimateDays": {
            if (!trimmed) {
              patch = { originalEstimateDays: null };
              break;
            }
            const n = Number(trimmed);
            if (!Number.isFinite(n) || n < 0 || n > 5000) return;
            patch = { originalEstimateDays: Math.round(n) };
            break;
          }
        }
        if (patch) {
          await onPatchEpic(epicId, patch);
        }
      } finally {
        setEstimateSavingCell(null);
        setEstimateEditCell(null);
      }
    }

    /** Inline pencil button that opens edit mode for a given cell. */
    function EditPencil({ epicId, column, initialDraft }: { epicId: string; column: EpicCoverageEditCell["column"]; initialDraft: string }) {
      if (!canEdit) return null;
      return (
        <button
          type="button"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            setEstimateEditCell({ epicId, column, draft: initialDraft });
          }}
          aria-label="Edit cell"
          title="Edit"
          // SquarePen matches the backlog's inline-edit affordance so the
          // planner gets a consistent edit glyph across surfaces.
          className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 transition-opacity group-hover/cell:opacity-100 hover:bg-slate-200/70 hover:text-slate-700"
        >
          <SquarePen className="size-3.5" strokeWidth={2.2} aria-hidden />
        </button>
      );
    }


    /** Option shape consumed by the icon-augmented autocomplete dropdown.
     *  `value` is what gets persisted to the field (slug / id / name /
     *  sprint number-string); `label` is what's shown in the row alongside
     *  the icon. */
    type EditOption = { value: string; label: string; icon: React.ReactNode };

    /** Input + ✓ / ✗ controls used inside an editing cell. When
     *  `iconOptions` is provided, a small popup renders below the input
     *  with filtered suggestions, each prefixed by an icon (team avatar,
     *  user avatar, initiative Zap, sprint Flag). Native datalist can't
     *  show icons next to options, so we render our own.
     *  Saves on Enter, cancels on Escape. */
    function EditFieldControls({
      epicId,
      column,
      type,
      placeholder,
      iconOptions,
    }: {
      epicId: string;
      column: EpicCoverageEditCell["column"];
      type: "text" | "number";
      placeholder?: string;
      iconOptions?: EditOption[];
    }) {
      if (!estimateEditCell || estimateEditCell.epicId !== epicId || estimateEditCell.column !== column) {
        return null;
      }
      const saving = estimateSavingCell === `${epicId}.${column}`;
      return (
        <CoverageEditInput
          draft={estimateEditCell.draft}
          saving={saving}
          type={type}
          placeholder={placeholder}
          allOptions={iconOptions ?? null}
          onDraftChange={(next) => setEstimateEditCell({ ...estimateEditCell, draft: next })}
          onSubmit={(value) => void commitEdit(epicId, column, value)}
          onCancel={() => setEstimateEditCell(null)}
        />
      );
    }

    function isEditing(epicId: string, column: EpicCoverageEditCell["column"]) {
      return Boolean(
        estimateEditCell &&
          estimateEditCell.epicId === epicId &&
          estimateEditCell.column === column,
      );
    }

    // Story-level edit helpers (canEditStory pencil, commitStoryEdit,
    // isStoryEditing, EditStoryFieldControls) live at the component
    // level so this table and renderStoriesWithoutDescriptionTable can
    // share them. Reference them directly — no local re-declaration.
    const canEditStory = canEditStorySharedRef;

    return (
      <table className={estimatePanelTableClass}>
        <thead>
          <tr>
            <th className={cn(estimatePanelHeadCellClass, "w-[28%] min-w-0")}>
              <span className="inline-flex w-full items-center justify-between gap-1">
                <span className="truncate">Epic</span>
                {filterIcon("epic", "Epic")}
              </span>
            </th>
            <th className={cn(estimatePanelHeadCellClass, "w-[22%] min-w-0")}>
              <span className="inline-flex w-full items-center justify-between gap-1">
                <span className="truncate">Initiative</span>
                {filterIcon("initiative", "Initiative")}
              </span>
            </th>
            <th className={cn(estimatePanelHeadCellClass, "w-[6rem]")}>
              <span className="inline-flex w-full items-center justify-between gap-1">
                <span className="truncate">Sprint</span>
                {filterIcon("sprint", "Sprint")}
              </span>
            </th>
            <th className={cn(estimatePanelHeadCellClass, "w-[10rem]")}>
              <span className="inline-flex w-full items-center justify-between gap-1">
                <span className="truncate">Team</span>
                {filterIcon("team", "Team")}
              </span>
            </th>
            <th className={cn(estimatePanelHeadCellClass, "w-[10rem]")}>
              <span className="inline-flex w-full items-center justify-between gap-1">
                <span className="truncate">Assignee</span>
                {filterIcon("assignee", "Assignee")}
              </span>
            </th>
            <th className={cn(estimatePanelHeadCellClass, "w-[6.5rem] text-center")}>
              Epic Est
            </th>
            {showEstimatedColumns ? (
              <th className={cn(estimatePanelHeadCellClass, "w-[6.5rem] whitespace-nowrap text-center")}>
                <span className="inline-flex items-center justify-center gap-1.5">
                  <span className="text-slate-400">Σ</span>
                  <span className="text-slate-300">|</span>
                  <span>Child Est</span>
                </span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, rowIndex) => {
            const isExpanded = expandedEstimateEpicIds.has(row.epic.id);
            const stories = row.epic.userStories ?? [];
            const childEstimateSum = stories.reduce((sum, story) => sum + Math.max(0, Number(story.estimatedDays ?? 0)), 0);

            return (
              <Fragment key={row.epic.id}>
                <tr
                  className={cn(
                    estimatePanelBodyRowClass,
                    rowIndex % 2 === 0 ? "bg-[#d8f2ff]" : "bg-white",
                  )}
                >
                  <td className={cn(estimatePanelCellClass, "group/cell")}>
                    {isEditing(row.epic.id, "title") ? (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Folder className="size-3.5 shrink-0 text-sky-500" strokeWidth={2} aria-hidden />
                        <EditFieldControls epicId={row.epic.id} column="title" type="text" />
                      </div>
                    ) : (
                      <div className="flex min-w-0 items-center gap-1.5">
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
                          onClick={() => onOpenEpic(row.epic.id)}
                          title={row.epic.title}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-[13px] font-semibold text-slate-900 hover:bg-white/70 hover:text-blue-950"
                        >
                          <Folder className="size-3.5 shrink-0 text-sky-500" strokeWidth={2} aria-hidden />
                          <span className="block min-w-0 flex-1 truncate">{row.epic.title}</span>
                        </button>
                        <EditPencil epicId={row.epic.id} column="title" initialDraft={row.epic.title} />
                      </div>
                    )}
                  </td>
                  <td className={cn(estimatePanelCellClass, "group/cell text-left text-slate-600")}>
                    {isEditing(row.epic.id, "initiativeId") ? (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Zap className="size-3.5 shrink-0 text-sky-500" strokeWidth={2} aria-hidden />
                        <EditFieldControls
                          epicId={row.epic.id}
                          column="initiativeId"
                          type="text"
                          placeholder="Pick initiative…"
                          iconOptions={initiativeOptions.map((opt) => ({
                            value: opt.title,
                            label: opt.title,
                            icon: (
                              <Zap className="size-3.5 text-sky-500" strokeWidth={2} aria-hidden />
                            ),
                          }))}
                        />
                      </div>
                    ) : (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenInitiative(row.initiative.id)}
                          title={row.initiative.title}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-[13px] font-medium text-slate-950 hover:bg-white/70 hover:text-blue-950"
                        >
                          <Zap className="size-3.5 shrink-0 text-sky-500" strokeWidth={2} aria-hidden />
                          <span className="block min-w-0 flex-1 truncate">{row.initiative.title}</span>
                        </button>
                        <EditPencil epicId={row.epic.id} column="initiativeId" initialDraft={row.initiative.title} />
                      </div>
                    )}
                  </td>
                  <td className={cn(estimatePanelCellClass, "text-[13px] text-slate-400")}>
                    {/* Epics do not have a sprint — sprint lives on user stories. */}
                    —
                  </td>
                  <td className={cn(estimatePanelCellClass, "group/cell text-[14px] text-slate-950")}>
                    {isEditing(row.epic.id, "team") ? (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <TeamAvatar
                          slug={null}
                          sizePx={16}
                          fallback={<Users className="size-3.5 shrink-0 text-slate-400" aria-hidden />}
                        />
                        <EditFieldControls
                          epicId={row.epic.id}
                          column="team"
                          type="text"
                          placeholder="Team slug…"
                          iconOptions={teamOptionSlugs
                            .filter(Boolean)
                            .map((slug) => ({
                              value: slug,
                              label: estimatePanelTeamLabel(slug),
                              icon: (
                                <TeamAvatar
                                  slug={slug}
                                  sizePx={16}
                                  fallback={<Users className="size-3.5 text-slate-400" aria-hidden />}
                                />
                              ),
                            }))}
                        />
                      </div>
                    ) : (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <TeamAvatar
                            slug={row.epic.team ?? null}
                            sizePx={16}
                            fallback={<Users className="size-3.5 shrink-0 text-slate-400" aria-hidden />}
                          />
                          <span className="truncate">{estimatePanelTeamLabel(row.epic.team)}</span>
                        </span>
                        <EditPencil
                          epicId={row.epic.id}
                          column="team"
                          initialDraft={row.epic.team ?? ""}
                        />
                      </div>
                    )}
                  </td>
                  <td className={cn(estimatePanelCellClass, "group/cell text-[14px] text-slate-950")}>
                    {isEditing(row.epic.id, "assignee") ? (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <UserAvatar name="" image={null} size={18} className="ring-0" />
                        <EditFieldControls
                          epicId={row.epic.id}
                          column="assignee"
                          type="text"
                          placeholder="Assignee…"
                          iconOptions={assigneeNameOptions.map((name) => {
                            const resolved = resolveAssigneeAvatar(name, workspaceDirectoryUsers);
                            return {
                              value: name,
                              label: name,
                              // Compact "First L." in the dropdown row; full
                              // name still drives search ranking + tooltip.
                              displayLabel: estimatePanelAssigneeLabel(name),
                              icon: (
                                <UserAvatar
                                  name={resolved.name}
                                  image={resolved.image}
                                  size={18}
                                  className="ring-0"
                                />
                              ),
                            };
                          })}
                        />
                      </div>
                    ) : (
                      (() => {
                        const resolved = resolveAssigneeAvatar(row.epic.assignee, workspaceDirectoryUsers);
                        return (
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="flex min-w-0 flex-1 items-center gap-1.5">
                              <UserAvatar name={resolved.name} image={resolved.image} size={18} className="ring-0" />
                              <span className="truncate">{estimatePanelAssigneeLabel(row.epic.assignee)}</span>
                            </span>
                            <EditPencil
                              epicId={row.epic.id}
                              column="assignee"
                              initialDraft={row.epic.assignee ?? ""}
                            />
                          </div>
                        );
                      })()
                    )}
                  </td>
                  <td className={cn(estimatePanelCellClass, "group/cell relative text-center text-[14px] font-semibold tabular-nums text-slate-950")}>
                    {isEditing(row.epic.id, "originalEstimateDays") ? (
                      <div className="flex min-w-0 items-center gap-1">
                        <EditFieldControls epicId={row.epic.id} column="originalEstimateDays" type="number" />
                      </div>
                    ) : (
                      <>
                        <span className="block text-center">
                          {Math.max(0, Number(row.epic.originalEstimateDays ?? 0))}d
                        </span>
                        <span className="absolute right-1 top-1/2 -translate-y-1/2">
                          <EditPencil
                            epicId={row.epic.id}
                            column="originalEstimateDays"
                            initialDraft={row.epic.originalEstimateDays != null ? String(row.epic.originalEstimateDays) : ""}
                          />
                        </span>
                      </>
                    )}
                  </td>
                  {showEstimatedColumns ? (
                    <td className={cn(estimatePanelCellClass, "group/cell relative text-center text-[14px] font-semibold tabular-nums text-slate-950")}>
                      <span className="inline-flex w-full items-center justify-center gap-1.5">
                        <span className="font-normal text-slate-400">Σ</span>
                        <span className="font-normal text-slate-300">|</span>
                        <span>{childEstimateSum}d</span>
                      </span>
                      <span className="absolute right-1 top-1/2 -translate-y-1/2">
                        <LockHint tip="Σ Child Est is auto-computed from child story estimates" />
                      </span>
                    </td>
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
                          onClick={() => onOpenStory?.(story.id)}
                        >
                          <td className={cn(estimatePanelCellClass, "relative pl-14")}>
                            {/* vertical tree line — stops at midpoint for last story */}
                            <span
                              className="absolute left-8 top-0 w-px bg-indigo-300"
                              style={{ height: isLast ? "50%" : "100%" }}
                            />
                            {/* horizontal branch */}
                            <span className="absolute left-8 top-1/2 h-px w-3.5 -translate-y-px bg-indigo-300" />
                            <span className="flex min-w-0 items-center gap-1.5">
                              <UserStoryIcon className="size-3.5 shrink-0 text-slate-400" />
                              <span className="truncate text-[14px] font-medium text-slate-950">{story.title}</span>
                            </span>
                          </td>
                          <td className={cn(estimatePanelCellClass, "text-[13px] text-slate-400")}>—</td>
                          <td className={cn(estimatePanelCellClass, "group/cell text-[14px] text-slate-600")}>
                            {isStoryEditing(story.id, "sprint") ? (
                              <div className="flex min-w-0 items-center gap-1.5">
                                <Flag className="size-3.5 shrink-0 text-rose-500" strokeWidth={2.1} aria-hidden />
                                <EditStoryFieldControls
                                  storyId={story.id}
                                  column="sprint"
                                  type="text"
                                  placeholder={`1–${YEAR_SPRINT_MAX}`}
                                  iconOptions={sprintIconOptions}
                                />
                              </div>
                            ) : (
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                  <Flag className="size-3.5 shrink-0 text-rose-500" strokeWidth={2.1} aria-hidden />
                                  <span className="truncate">{estimatePanelStorySprintLabel(story)}</span>
                                </span>
                                <EditStoryPencil
                                  storyId={story.id}
                                  column="sprint"
                                  initialDraft={story.sprint != null ? String(story.sprint) : ""}
                                />
                              </div>
                            )}
                          </td>
                          <td className={cn(estimatePanelCellClass, "group/cell text-[14px] text-slate-600")}>
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                <TeamAvatar
                                  slug={row.epic.team ?? null}
                                  sizePx={16}
                                  fallback={<Users className="size-3.5 shrink-0 text-slate-400" aria-hidden />}
                                />
                                <span className="truncate">{estimatePanelTeamLabel(row.epic.team)}</span>
                              </span>
                              {canEditStory ? <LockHint tip="Team is inherited from the parent epic" /> : null}
                            </div>
                          </td>
                          <td className={cn(estimatePanelCellClass, "group/cell text-[14px] text-slate-600")}>
                            {isStoryEditing(story.id, "assignee") ? (
                              <div className="flex min-w-0 items-center gap-1.5">
                                <UserAvatar name="" image={null} size={18} className="ring-0" />
                                <EditStoryFieldControls
                                  storyId={story.id}
                                  column="assignee"
                                  type="text"
                                  placeholder="Assignee…"
                                  iconOptions={assigneeNameOptions.map((name) => {
                                    const resolved = resolveAssigneeAvatar(name, workspaceDirectoryUsers);
                                    return {
                                      value: name,
                                      label: name,
                                      displayLabel: estimatePanelAssigneeLabel(name),
                                      icon: (
                                        <UserAvatar
                                          name={resolved.name}
                                          image={resolved.image}
                                          size={18}
                                          className="ring-0"
                                        />
                                      ),
                                    };
                                  })}
                                />
                              </div>
                            ) : (
                              (() => {
                                const resolved = resolveAssigneeAvatar(story.assignee, workspaceDirectoryUsers);
                                return (
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                      <UserAvatar name={resolved.name} image={resolved.image} size={18} className="ring-0" />
                                      <span className="truncate">{estimatePanelAssigneeLabel(story.assignee)}</span>
                                    </span>
                                    <EditStoryPencil
                                      storyId={story.id}
                                      column="assignee"
                                      initialDraft={story.assignee ?? ""}
                                    />
                                  </div>
                                );
                              })()
                            )}
                          </td>
                          <td className={cn(estimatePanelCellClass, "group/cell relative text-center text-[13px] font-semibold tabular-nums text-slate-950")}>
                            {isStoryEditing(story.id, "estimatedDays") ? (
                              <div className="flex min-w-0 items-center gap-1">
                                <EditStoryFieldControls storyId={story.id} column="estimatedDays" type="number" />
                              </div>
                            ) : (
                              <>
                                <span className="block text-center">
                                  {Math.max(0, Number(story.estimatedDays ?? 0))}d
                                </span>
                                <span className="absolute right-1 top-1/2 -translate-y-1/2">
                                  <EditStoryPencil
                                    storyId={story.id}
                                    column="estimatedDays"
                                    initialDraft={story.estimatedDays != null ? String(story.estimatedDays) : ""}
                                  />
                                </span>
                              </>
                            )}
                          </td>
                          {showEstimatedColumns ? (
                            <td className={cn(estimatePanelCellClass, "text-center text-[13px] text-slate-400")}>—</td>
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
                <td className={cn(estimatePanelCellClass, "text-center text-slate-300")}>-</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }


  function renderStoriesWithoutDescriptionTable(
    rows: Array<{ story: UserStoryItem; epic: EpicItem; initiative: InitiativeItem }>,
    emptyMessage = "No user stories without a description in this scope.",
  ) {
    // Use the SAME head style as the other coverage tables so titles
    // read at the same size everywhere.
    const narrowHead = estimatePanelHeadCellClass;
    const tab = "storiesNoDesc";
    const cols: readonly string[] = ["story", "sprint", "team", "assignee", "epic"];
    const displayRows = rows.filter((row) => {
      for (const col of cols) {
        const v = getStoryCoverageColValue(row, col);
        const sel = getCoverageColumnFilter(tab, col);
        if (sel.size > 0 && !sel.has(v)) return false;
        const q = getCoverageColumnQuery(tab, col).trim().toLowerCase();
        if (q && !v.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    const optionsForCol: Record<string, CoverageFilterOption[]> = {
      story: distinctSorted(rows.map((r) => getStoryCoverageColValue(r, "story"))).map((v) => ({
        value: v,
        icon: <UserStoryIcon className="size-3.5 text-slate-500" aria-hidden />,
      })),
      sprint: distinctSorted(rows.map((r) => getStoryCoverageColValue(r, "sprint"))).map((v) => ({
        value: v,
        icon: <Flag className="size-3.5 text-rose-500" strokeWidth={2.1} aria-hidden />,
      })),
      team: distinctSorted(rows.map((r) => getStoryCoverageColValue(r, "team"))).map((v) => ({
        value: v,
        icon: (
          <TeamAvatar
            slug={v || null}
            sizePx={16}
            fallback={<Users className="size-3.5 text-slate-400" aria-hidden />}
          />
        ),
      })),
      assignee: distinctSorted(rows.map((r) => getStoryCoverageColValue(r, "assignee"))).map((v) => {
        const resolved = resolveAssigneeAvatar(v, workspaceDirectoryUsers);
        return {
          value: v,
          icon: <UserAvatar name={resolved.name} image={resolved.image} size={18} className="ring-0" />,
        };
      }),
      epic: distinctSorted(rows.map((r) => getStoryCoverageColValue(r, "epic"))).map((v) => ({
        value: v,
        icon: <Folder className="size-3.5 text-sky-500" strokeWidth={2} aria-hidden />,
      })),
    };
    function filterIcon(col: string, label: string) {
      return (
        <CoverageColumnFilter
          filterKey={`${tab}.${col}`}
          label={label}
          options={optionsForCol[col] ?? []}
          selected={getCoverageColumnFilter(tab, col)}
          onChange={(next) => setCoverageColumnFilter(tab, col, next)}
          openKey={openCoverageFilterKey}
          setOpenKey={setOpenCoverageFilterKey}
          query={getCoverageColumnQuery(tab, col)}
          onQueryChange={(next) => setCoverageColumnQuery(tab, col, next)}
        />
      );
    }
    // Sprint dropdown options for storiesNoDesc rows — same order
    // logic as the main coverage table (current sprint first, then
    // forward to year end, then wrap to early sprints).
    const currentSprintForYear = currentWorkYearSprintForPlan(currentYear) ?? 1;
    const sprintIconOptions: CoverageEditOption[] = (() => {
      const order = [
        ...Array.from({ length: YEAR_SPRINT_MAX - currentSprintForYear + 1 }, (_, i) => currentSprintForYear + i),
        ...Array.from({ length: currentSprintForYear - 1 }, (_, i) => i + 1),
      ];
      return order.map((n) => ({
        value: String(n),
        label: `Sprint ${n}`,
        icon: <Flag className="size-3.5 text-rose-500" strokeWidth={2.1} aria-hidden />,
      }));
    })();
    // Assignee options = workspace directory + any names already on
    // these rows, deduped. Mirrors the renderEstimatePanelTable list.
    const assigneeNameOptions = canEditStorySharedRef
      ? Array.from(
          new Set([
            ...(workspaceDirectoryUsers ?? []).map((u) => u.name),
            ...rows.map((r) => r.story.assignee ?? "").filter(Boolean),
          ]),
        )
      : [];
    // Team edit on a story row writes to the PARENT epic (a story
    // doesn't own a `team` field — it's inherited). Available only
    // when the parent supplies onPatchEpic. Option list mirrors the
    // main coverage table: MONTH_TEAM_COLUMNS slugs + any custom team
    // slugs already used by epics in this scope.
    const canEditEpicTeam = Boolean(onPatchEpic);
    const teamOptionSlugsForStoryRow = canEditEpicTeam
      ? Array.from(
          new Set(
            ["", ...MONTH_TEAM_COLUMNS.map((c) => c.id), ...rows.map((r) => r.epic.team ?? "")].filter(
              (s, i, arr) => arr.indexOf(s) === i,
            ),
          ),
        )
      : [];
    // Parent-epic autocomplete options. Each option carries the epic
    // title (for matching) plus a Folder icon and a "title · parent
    // initiative" displayLabel so duplicates can be told apart.
    const epicReassignOptions: CoverageEditOption[] = initiatives.flatMap((init) =>
      (init.epics ?? []).map((epic) => ({
        value: epic.title,
        label: epic.title,
        displayLabel: `${epic.title} · ${init.title}`,
        icon: <Folder className="size-3.5 text-sky-500" strokeWidth={2} aria-hidden />,
      })),
    );
    return (
      <table className={estimatePanelTableClass}>
        <thead>
          <tr>
            {/* Order: User story · Parent epic · Sprint · Team · Assignee.
              * User story is the focus of this view so it gets the most
              * horizontal space; Parent epic sits right next to it as
              * the breadcrumb context. */}
            <th className={cn(narrowHead, "w-[28%] min-w-0")}>
              <span className="inline-flex w-full items-center justify-between gap-1">
                <span className="truncate">User story</span>
                {filterIcon("story", "User story")}
              </span>
            </th>
            <th className={cn(narrowHead, "min-w-0")}>
              <span className="inline-flex w-full items-center justify-between gap-1">
                <span className="truncate">Parent epic</span>
                {filterIcon("epic", "Parent epic")}
              </span>
            </th>
            <th className={cn(narrowHead, "w-[8rem]")}>
              <span className="inline-flex w-full items-center justify-between gap-1">
                <span className="truncate">Sprint</span>
                {filterIcon("sprint", "Sprint")}
              </span>
            </th>
            <th className={cn(narrowHead, "w-[10rem]")}>
              <span className="inline-flex w-full items-center justify-between gap-1">
                <span className="truncate">Team</span>
                {filterIcon("team", "Team")}
              </span>
            </th>
            <th className={cn(narrowHead, "w-[10rem]")}>
              <span className="inline-flex w-full items-center justify-between gap-1">
                <span className="truncate">Assignee</span>
                {filterIcon("assignee", "Assignee")}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {displayRows.length === 0 ? (
            <tr>
              <td className={cn(estimatePanelCellClass, "text-[12px] text-slate-500")} colSpan={5}>
                {rows.length === 0 ? emptyMessage : "No matches for the current filters."}
              </td>
            </tr>
          ) : (
            displayRows.map((row, rowIndex) => (
              <tr
                key={row.story.id}
                className={cn(
                  estimatePanelBodyRowClass,
                  rowIndex % 2 === 0 ? "bg-[#d8f2ff]" : "bg-white",
                )}
              >
                <td className={cn(estimatePanelCellClass, "group/cell")}>
                  {isStoryEditing(row.story.id, "title") ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <UserStoryIcon className="size-3.5 shrink-0 text-slate-500" />
                      <EditStoryFieldControls
                        storyId={row.story.id}
                        column="title"
                        type="text"
                        placeholder="Story title…"
                      />
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenStory?.(row.story.id)}
                        disabled={!onOpenStory}
                        title={row.story.title}
                        className={cn(
                          "inline-flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[13px] font-semibold text-slate-900 hover:bg-white/70 hover:text-blue-950",
                          !onOpenStory && "cursor-default opacity-60 hover:bg-transparent hover:text-slate-900",
                        )}
                      >
                        <UserStoryIcon className="size-3.5 shrink-0 text-slate-500" />
                        <span className="truncate">{row.story.title}</span>
                      </button>
                      <EditStoryPencil
                        storyId={row.story.id}
                        column="title"
                        initialDraft={row.story.title}
                      />
                    </div>
                  )}
                </td>
                <td className={cn(estimatePanelCellClass, "group/cell text-left text-slate-600")}>
                  {isStoryEditing(row.story.id, "epicId") ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Folder className="size-3.5 shrink-0 text-sky-500" strokeWidth={2} aria-hidden />
                      <EditStoryFieldControls
                        storyId={row.story.id}
                        column="epicId"
                        type="text"
                        placeholder="Pick parent epic…"
                        iconOptions={epicReassignOptions}
                      />
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenEpic(row.epic.id)}
                        title={row.epic.title}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-[13px] font-medium text-slate-950 hover:bg-white/70 hover:text-blue-950"
                      >
                        <Folder className="size-3.5 shrink-0 text-sky-500" strokeWidth={2} aria-hidden />
                        <span className="truncate">{row.epic.title}</span>
                      </button>
                      <EditStoryPencil
                        storyId={row.story.id}
                        column="epicId"
                        initialDraft={row.epic.title}
                      />
                    </div>
                  )}
                </td>
                <td className={cn(estimatePanelCellClass, "group/cell text-[14px] text-slate-950")}>
                  {isStoryEditing(row.story.id, "sprint") ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Flag className="size-3.5 shrink-0 text-rose-500" strokeWidth={2.1} aria-hidden />
                      <EditStoryFieldControls
                        storyId={row.story.id}
                        column="sprint"
                        type="text"
                        placeholder={`1–${YEAR_SPRINT_MAX}`}
                        iconOptions={sprintIconOptions}
                      />
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <Flag className="size-3.5 shrink-0 text-rose-500" strokeWidth={2.1} aria-hidden />
                        <span className="truncate">{estimatePanelStorySprintLabel(row.story)}</span>
                      </span>
                      <EditStoryPencil
                        storyId={row.story.id}
                        column="sprint"
                        initialDraft={row.story.sprint != null ? String(row.story.sprint) : ""}
                      />
                    </div>
                  )}
                </td>
                <td className={cn(estimatePanelCellClass, "group/cell text-[14px] text-slate-950")}>
                  {estimateEditCell
                    && estimateEditCell.epicId === row.epic.id
                    && estimateEditCell.column === "team"
                    && estimateEditCell.triggerStoryId === row.story.id ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <TeamAvatar
                        slug={null}
                        sizePx={16}
                        fallback={<Users className="size-3.5 shrink-0 text-slate-400" aria-hidden />}
                      />
                      <CoverageEditInput
                        draft={estimateEditCell.draft}
                        saving={estimateSavingCell === `${row.epic.id}.team`}
                        type="text"
                        placeholder="Team slug…"
                        allOptions={teamOptionSlugsForStoryRow
                          .filter(Boolean)
                          .map((slug) => ({
                            value: slug,
                            label: estimatePanelTeamLabel(slug),
                            icon: (
                              <TeamAvatar
                                slug={slug}
                                sizePx={16}
                                fallback={<Users className="size-3.5 text-slate-400" aria-hidden />}
                              />
                            ),
                          }))}
                        onDraftChange={(next) => setEstimateEditCell({ ...estimateEditCell, draft: next })}
                        onSubmit={async (value) => {
                          if (!onPatchEpic) return;
                          const trimmed = value.trim();
                          setEstimateSavingCell(`${row.epic.id}.team`);
                          try {
                            await onPatchEpic(row.epic.id, { team: trimmed || null });
                          } finally {
                            setEstimateSavingCell(null);
                            setEstimateEditCell(null);
                          }
                        }}
                        onCancel={() => setEstimateEditCell(null)}
                      />
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <TeamAvatar
                          slug={row.epic.team ?? null}
                          sizePx={16}
                          fallback={<Users className="size-3.5 shrink-0 text-slate-400" aria-hidden />}
                        />
                        <span className="truncate">{estimatePanelTeamLabel(row.epic.team)}</span>
                      </span>
                      {canEditEpicTeam ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            setEstimateEditCell({
                              epicId: row.epic.id,
                              column: "team",
                              draft: row.epic.team ?? "",
                              triggerStoryId: row.story.id,
                            });
                          }}
                          aria-label="Edit team (updates parent epic)"
                          title="Edit team — applies to the parent epic"
                          className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 transition-opacity group-hover/cell:opacity-100 hover:bg-slate-200/70 hover:text-slate-700"
                        >
                          <SquarePen className="size-3.5" strokeWidth={2.2} aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  )}
                </td>
                <td className={cn(estimatePanelCellClass, "group/cell text-[14px] text-slate-950")}>
                  {isStoryEditing(row.story.id, "assignee") ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <UserAvatar name="" image={null} size={18} className="ring-0" />
                      <EditStoryFieldControls
                        storyId={row.story.id}
                        column="assignee"
                        type="text"
                        placeholder="Assignee…"
                        iconOptions={assigneeNameOptions.map((name) => {
                          const resolved = resolveAssigneeAvatar(name, workspaceDirectoryUsers);
                          return {
                            value: name,
                            label: name,
                            displayLabel: estimatePanelAssigneeLabel(name),
                            icon: (
                              <UserAvatar
                                name={resolved.name}
                                image={resolved.image}
                                size={18}
                                className="ring-0"
                              />
                            ),
                          };
                        })}
                      />
                    </div>
                  ) : (
                    (() => {
                      const resolved = resolveAssigneeAvatar(row.story.assignee, workspaceDirectoryUsers);
                      return (
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <UserAvatar name={resolved.name} image={resolved.image} size={18} className="ring-0" />
                            <span className="truncate">{estimatePanelAssigneeLabel(row.story.assignee)}</span>
                          </span>
                          <EditStoryPencil
                            storyId={row.story.id}
                            column="assignee"
                            initialDraft={row.story.assignee ?? ""}
                          />
                        </div>
                      );
                    })()
                  )}
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

  useEffect(() => { setSprintKanbanViewMode("stories"); }, [resolvedActiveYearSprint, activeMonth]);

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

  // Closed-sprint Move + Jump chips live in the breadcrumb row immediately
  // after the "Left" countdown chip. Same alice-blue rounded-full ring style
  // as `SprintEndCountdown` so the three reads as one chip cluster.
  const sprintCloseActionChipsJsx = useMemo(() => {
    if (!showSprintEndCountdown) return null;
    const ys = activeYearSprintForMonthDrill;
    if (ys == null) return null;
    const sprintClosed = sprintEndDate(currentYear, ys).getTime() <= clockNowMs();
    const monthForCount = sprintBoardContextMonth ?? activeMonth ?? 1;
    const teamFilter = sprintFilterTeamIds.length ? sprintFilterTeamIds : null;
    const movableCount = sprintClosed
      ? collectMovableStoriesForSprint(initiatives, monthForCount, ys, teamFilter).length
      : 0;
    const atYearCap = ys >= YEAR_SPRINT_MAX;
    const moveLabel = isYearBoundaryBlocked
      ? `Add ${currentYear + 1} and continue`
      : atYearCap
        ? `Move leftovers S${ys} → S1 next year`
        : `Move leftovers S${ys} → S${ys + 1}`;
    const moveDisabled = movableCount === 0 && !isYearBoundaryBlocked && !atYearCap;
    const workTargetSprint = currentWorkYearSprintForPlan(currentYear);
    const showJump =
      workTargetSprint != null && workTargetSprint !== ys && Boolean(onEnterSprintStoryBoard);
    /** Rolled-in audit count for the CURRENT sprint view — surfaced as a
     *  small chip that opens the audit modal so the planner can see what
     *  carried over from the prior sprint(s). Gated to the destination
     *  side: only the still-open / current sprint shows it. Closed source
     *  sprints have a Move chip and shouldn't double-up with a Rolled-in
     *  pill that would describe history from BEFORE the planner acted —
     *  the user wants the chip to appear strictly AFTER they roll
     *  leftovers, on the destination sprint where the carryover lands. */
    const rolledInCount = sprintClosed
      ? 0
      : collectStoriesRolledIntoSprint(initiatives, ys).length;
    /** Rolled-out count — surfaced only on CLOSED source sprints so the
     *  planner can audit what left this sprint after the Move action.
     *  Open sprints get the destination-side `rolledInCount` instead. */
    const rolledOutCount = sprintClosed
      ? collectStoriesRolledOutOfSprint(initiatives, ys).length
      : 0;
    return (
      <>
        {sprintClosed && onRequestSprintMove ? (
          <button
            type="button"
            disabled={moveDisabled}
            onClick={() => onRequestSprintMove(ys)}
            title={moveDisabled ? "Nothing unfinished to move" : moveLabel}
            className={cn(
              "inline-flex h-7 max-w-full shrink-0 items-center gap-1 rounded-full bg-[aliceblue] px-2.5 text-[11px] font-semibold leading-none tracking-[0.02em] text-slate-800 ring-1 ring-sky-200 transition sm:gap-1.5 sm:px-3 sm:text-[12px]",
              moveDisabled
                ? "cursor-not-allowed text-slate-400 ring-slate-200"
                : "cursor-pointer hover:bg-sky-100 hover:ring-sky-300",
            )}
          >
            <ArrowRightCircle className="size-3 shrink-0 text-slate-700 sm:size-3.5" strokeWidth={2.25} aria-hidden />
            <span className="truncate">{moveLabel}</span>
          </button>
        ) : null}
        {rolledOutCount > 0 ? (
          <button
            type="button"
            onClick={() => setRolledOutModalSprint(ys)}
            title={`See what rolled out of Sprint ${ys}`}
            className="inline-flex h-7 max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-full bg-[aliceblue] px-2.5 text-[11px] font-semibold leading-none tracking-[0.02em] text-slate-800 ring-1 ring-sky-200 transition hover:bg-sky-100 hover:ring-sky-300 sm:gap-1.5 sm:px-3 sm:text-[12px]"
          >
            <Send className="size-3 shrink-0 text-indigo-500 sm:size-3.5" strokeWidth={2.25} aria-hidden />
            <span className="text-slate-500">Rolled out</span>
            <span className="truncate">{rolledOutCount}</span>
          </button>
        ) : null}
        {rolledInCount > 0 ? (
          <button
            type="button"
            onClick={() => setSprintKanbanCarriedOverOnly((v) => !v)}
            aria-pressed={sprintKanbanCarriedOverOnly}
            title={
              sprintKanbanCarriedOverOnly
                ? "Show all stories"
                : `Filter kanban to ${rolledInCount} carried-over stor${rolledInCount === 1 ? "y" : "ies"}`
            }
            className={cn(
              "inline-flex h-7 max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold leading-none tracking-[0.02em] transition sm:gap-1.5 sm:px-3 sm:text-[12px]",
              sprintKanbanCarriedOverOnly
                ? "bg-sky-100 text-sky-950 ring-1 ring-sky-300 shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)]"
                : "bg-[aliceblue] text-slate-800 ring-1 ring-sky-200 hover:bg-sky-100 hover:ring-sky-300",
            )}
          >
            <Filter
              className={cn(
                "size-3 shrink-0 sm:size-3.5",
                sprintKanbanCarriedOverOnly ? "text-sky-700" : "text-indigo-500",
              )}
              strokeWidth={2.25}
              aria-hidden
            />
            <span className={cn(sprintKanbanCarriedOverOnly ? "text-sky-900" : "text-slate-500")}>
              Carried over
            </span>
            <span className="truncate">{rolledInCount}</span>
          </button>
        ) : null}
        {showJump && workTargetSprint != null ? (
          <button
            type="button"
            onClick={() =>
              onEnterSprintStoryBoard?.(workTargetSprint, sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId))
            }
            title={`Jump to current sprint (Sprint ${workTargetSprint})`}
            className="inline-flex h-7 max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-full bg-[aliceblue] px-2.5 text-[11px] font-semibold leading-none tracking-[0.02em] text-slate-800 ring-1 ring-sky-200 transition hover:bg-sky-100 hover:ring-sky-300 sm:gap-1.5 sm:px-3 sm:text-[12px]"
          >
            <Flag className="size-3 shrink-0 text-rose-500 sm:size-3.5" strokeWidth={2.25} aria-hidden />
            <span className="text-slate-500">Jump</span>
            <span className="truncate">S{workTargetSprint}</span>
          </button>
        ) : null}
      </>
    );
  }, [
    showSprintEndCountdown,
    activeYearSprintForMonthDrill,
    currentYear,
    sprintBoardContextMonth,
    activeMonth,
    sprintFilterTeamIds,
    initiatives,
    isYearBoundaryBlocked,
    onRequestSprintMove,
    onEnterSprintStoryBoard,
    sprintStoryBoardTeamId,
  ]);

  // Period scope detection for the non-sprint countdown chip. Only month gets a chip;
  // single-quarter and year (all-quarters) intentionally show no chip — those scopes are
  // already telegraphed by the Gantt header.
  const periodCountdownScope: "month" | null = (() => {
    if (showSprintEndCountdown) return null;
    if (activeMonth != null) return "month";
    return null;
  })();
  const periodCountdownIndex: number | null = periodCountdownScope === "month" ? activeMonth ?? null : null;

  const sprintKanbanSuggestions = useMemo(() => {
    const q = sprintKanbanSearch.trim().toLowerCase();
    if (!q || monthPlanTab !== "sprint-kanban" || resolvedActiveYearSprint == null || sprintBoardContextMonth == null) return [];
    const teamFilter = sprintFilterTeamIds.length ? sprintFilterTeamIds : null;
    const seen = new Set<string>();
    const results: { label: string; kind: "story" | "epic" | "initiative" }[] = [];
    if (sprintKanbanViewMode === "epics") {
      const rows = collectEpicsForSprintKanban(initiatives, sprintBoardContextMonth, resolvedActiveYearSprint, teamFilter);
      for (const row of rows) {
        if (row.epic.title.toLowerCase().includes(q) && !seen.has(row.epic.title)) {
          seen.add(row.epic.title);
          results.push({ label: row.epic.title, kind: "epic" });
        }
        if (row.initiative.title.toLowerCase().includes(q) && !seen.has(row.initiative.title)) {
          seen.add(row.initiative.title);
          results.push({ label: row.initiative.title, kind: "initiative" });
        }
      }
    } else {
      const rows = collectStoriesForSprintBoard(initiatives, sprintBoardContextMonth, resolvedActiveYearSprint, teamFilter);
      for (const row of rows) {
        if (row.story.title.toLowerCase().includes(q) && !seen.has(row.story.title)) {
          seen.add(row.story.title);
          results.push({ label: row.story.title, kind: "story" });
        }
        if (row.epic.title.toLowerCase().includes(q) && !seen.has(row.epic.title)) {
          seen.add(row.epic.title);
          results.push({ label: row.epic.title, kind: "epic" });
        }
      }
    }
    return results.slice(0, 12);
  }, [sprintKanbanSearch, monthPlanTab, resolvedActiveYearSprint, sprintBoardContextMonth, sprintFilterTeamIds, sprintKanbanViewMode, initiatives]);

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

      console.log("[epic-resize] start", { epicId, side, ss0, es0, qLo, qHi, spanSteps, stepWidthPx, barWidth });
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
        console.log("[epic-resize] pointerUp", { epicId, side, deltaPx, deltaSteps, ss0, es0, qLo, qHi });
        if (deltaSteps !== 0) {
          if (side === "right") {
            const nextEndSprint = Math.min(qHi, Math.max(ss0, es0 + deltaSteps));
            console.log("[epic-resize] commit right", { nextEndSprint, changed: nextEndSprint !== es0 });
            if (nextEndSprint !== es0) {
              const { startMonth: sm, endMonth: em } = monthRangeFromYearSprintRange(ss0, nextEndSprint);
              console.log("[epic-resize] calling commitResize right", { epicId, sm, em, ss0, nextEndSprint });
              commitResize(epicId, {
                startMonth: sm,
                endMonth: em,
                startYearSprint: ss0,
                endYearSprint: nextEndSprint,
              });
            }
          } else {
            const nextStartSprint = Math.max(qLo, Math.min(es0, ss0 + deltaSteps));
            console.log("[epic-resize] commit left", { nextStartSprint, changed: nextStartSprint !== ss0 });
            if (nextStartSprint !== ss0) {
              const { startMonth: sm, endMonth: em } = monthRangeFromYearSprintRange(nextStartSprint, es0);
              console.log("[epic-resize] calling commitResize left", { epicId, sm, em, nextStartSprint, es0 });
              commitResize(epicId, {
                startMonth: sm,
                endMonth: em,
                startYearSprint: nextStartSprint,
                endYearSprint: es0,
              });
            }
          }
        } else {
          console.log("[epic-resize] no-op: deltaSteps === 0");
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
  const filteredMonthEpicGanttRows = useMemo(() => {
    if (!ganttTeamIds.length) return monthEpicGanttRows;
    return monthEpicGanttRows.filter(({ epic }) => epic.team && ganttTeamIds.includes(epic.team));
  }, [monthEpicGanttRows, ganttTeamIds]);
  const monthInitiativeGanttRows = useMemo(() => {
    if (activeMonth == null) return [] as InitiativeItem[];
    const byId = new Map<string, InitiativeItem>();
    for (const { initiative } of monthEpicGanttRows) {
      byId.set(initiative.id, initiative);
    }
    return [...byId.values()].sort((a, b) => a.timelineRow - b.timelineRow || a.title.localeCompare(b.title));
  }, [activeMonth, monthEpicGanttRows]);

  const ganttSearchAppliedMonthEpicRows = useMemo(() => {
    if (!ganttSearchEpicIds) return filteredMonthEpicGanttRows;
    return filteredMonthEpicGanttRows.filter(r => ganttSearchEpicIds.has(r.epic.id));
  }, [filteredMonthEpicGanttRows, ganttSearchEpicIds]);

  const ganttSearchAppliedMonthInitiativeRows = useMemo(() => {
    if (!ganttSearchInitiativeIds) return monthInitiativeGanttRows;
    return monthInitiativeGanttRows.filter(i => ganttSearchInitiativeIds.has(i.id));
  }, [monthInitiativeGanttRows, ganttSearchInitiativeIds]);

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
        "border-blue-200 bg-gradient-to-r from-blue-50 to-sky-50 text-blue-950 shadow-sm hover:from-blue-100 hover:to-sky-100",
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
        "border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 text-violet-950 shadow-sm hover:from-violet-100 hover:to-fuchsia-100",
    },
  };
  const monthToneByQuarter: Record<string, string> = {
    Q1: "border-blue-200 bg-blue-50 text-blue-950 hover:bg-blue-100",
    Q2: "border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100",
    Q3: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    Q4: "border-violet-200 bg-violet-50 text-violet-950 hover:bg-violet-100",
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
    /** First measurement commits sync so initial scroll-state is correct;
     *  subsequent ones (e.g. during the rail-slide width change) coalesce
     *  150ms after the resize stream stops, avoiding per-frame setState. */
    let initialApplied = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
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
    const scheduleApply = () => {
      if (!initialApplied) {
        initialApplied = true;
        apply();
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        apply();
      }, 150);
    };
    scheduleApply();
    const ro = new ResizeObserver(() => scheduleApply());
    ro.observe(el);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      ro.disconnect();
    };
  }, [portfolioRoadmapGanttHScrollMeasure]);

  /** Today line over initiative lanes (sprint resolution). */
  const roadmapLaneTodayLeft = useMemo(() => {
    if (activeMonth != null) return null;
    if (focusedQuarter && quarterViewTab !== "gantt") return null;
    return focusedQuarter
      ? todayLeftCssInQuarterSprints(currentYear, focusedQuarter.months)
      : todayLeftCssInYearSprints(currentYear);
  }, [activeMonth, currentYear, focusedQuarter, quarterViewTab]);

  const monthEpicGanttTodayLeft = useMemo(() => {
    if (activeMonth == null) return null;
    if (monthPlanTab !== "epic-gantt") return null;
    return todayLeftCssInSingleMonth(currentYear, activeMonth);
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
    /**
     * Prop→state sync window: when the parent just changed `focusedMonthExternal`
     * (e.g. via openSprintStoryBoard's Jump to S11), the local `focusedMonth` state
     * has not yet been re-synced by the effect at line 4592. `activeMonth` is still
     * stale. Writing it back to the parent via onSprintModeChange would regress the
     * parent's intent (S11 → S10) and trigger a max-update-depth ping-pong. Wait
     * for the next render when local state has caught up.
     */
    if (focusedMonthExternal != null && focusedMonthExternal !== activeMonth) return;
    if (
      activeSprintExternal !== undefined &&
      activeSprintExternal != null &&
      activeSprint != null &&
      clampYearSprint(activeSprintExternal) !== activeSprint
    ) {
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
    // Month breadcrumb stays as a non-clickable label — month drill-down
    // is parked. Drop the `onClick` to disable; restore it (with the
    // setActiveSprint + epic-gantt switch) to bring drill-down back.
    breadcrumbItems.push({
      label: MONTHS[activeMonth - 1],
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
  const planRailTabActiveClass = "bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-950 ring-1 ring-indigo-200/80";

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

  // Per-bar health for the currently-visible roadmap view. Switches its
  // source rows based on whether a quarter is focused, so the popover's
  // counts always reflect what the user is actually looking at.
  const ganttHealthData = useMemo(() => {
    const counts: Record<HealthStatus, number> = { done: 0, onTrack: 0, watch: 0, atRisk: 0, overdue: 0 };
    const statusByBarId = new Map<string, HealthStatus>();
    // Items list parallel to `statusByBarId` so the popover can render an
    // autocomplete of "what's currently in scope on the Gantt" without
    // re-walking the data. Only includes bars where we could compute health
    // — items without estimated work / stories aren't useful insight targets.
    const items: Array<{ id: string; title: string; kind: "epic" | "initiative"; status: HealthStatus }> = [];
    let totalBars = 0;
    let unestimatedStoryCount = 0;
    const isInitiativeView = roadmapBarMode === "initiatives";
    // Month view is special — its rows are flat lists, not grouped by
    // timeline row. Handle it inline below.
    //
    // For totalBars we count every bar the user sees on the Gantt — even
    // bars without estimated work — so the popover's total matches the bar
    // count. Status counts only include bars where we could compute health.
    if (activeMonth != null) {
      if (isInitiativeView) {
        for (const initiative of ganttSearchAppliedMonthInitiativeRows) {
          totalBars += 1;
          const childStatuses: HealthStatus[] = [];
          const aggregateStories = (initiative.epics ?? []).flatMap((e) => e.userStories ?? []);
          for (const epic of initiative.epics ?? []) {
            const v = computeEpicHealthVerdict(epic, currentYear, progressBasis);
            if (v != null) childStatuses.push(v.status);
          }
          const initStart = sprintStartDate(currentYear, globalSprintFromMonthLane(activeMonth, 1));
          const initEnd = sprintEndDate(currentYear, globalSprintFromMonthLane(activeMonth, 2));
          const initiativeOriginalEstSum = (initiative.epics ?? []).reduce(
            (sum, e) => sum + (e.originalEstimateDays ?? 0),
            0,
          );
          const h = computeInitiativeProgress({
            stories: aggregateStories,
            childStatuses,
            start: initStart,
            end: initEnd,
            basis: progressBasis,
            epicOriginalEstimateDays: initiativeOriginalEstSum > 0 ? initiativeOriginalEstSum : null,
          });
          const hasData = progressBasis === "stories" ? aggregateStories.length > 0 : h.totalEffort > 0;
          if (hasData) {
            counts[h.status] += 1;
            statusByBarId.set(initiative.id, h.status);
            items.push({ id: initiative.id, title: initiative.title, kind: "initiative", status: h.status });
          }
          unestimatedStoryCount += h.unestimatedCount;
        }
      } else {
        for (const { epic } of ganttSearchAppliedMonthEpicRows) {
          totalBars += 1;
          const v = computeEpicHealthVerdict(epic, currentYear, progressBasis);
          if (v == null) continue;
          const start = v.start;
          const end = v.end;
          const epicStories = epic.userStories ?? [];
          const h = computeProgress({
            stories: epicStories,
            start,
            end,
            basis: progressBasis,
            epicOriginalEstimateDays: epic.originalEstimateDays ?? null,
          });
          const hasData = progressBasis === "stories" ? epicStories.length > 0 : h.totalEffort > 0;
          if (hasData) {
            counts[h.status] += 1;
            statusByBarId.set(epic.id, h.status);
            items.push({ id: epic.id, title: epic.title, kind: "epic", status: h.status });
          }
          unestimatedStoryCount += h.unestimatedCount;
        }
      }
      return { counts, statusByBarId, items, totalBars, unestimatedStoryCount };
    }
    const activeInitiativeRows = focusedQuarter
      ? ganttSearchAppliedQuarterInitiativeRows
      : ganttSearchAppliedYearInitiativeRows;
    const activeEpicRows = focusedQuarter
      ? ganttSearchAppliedQuarterEpicRows
      : ganttSearchAppliedYearEpicRows;
    if (isInitiativeView) {
      for (const group of activeInitiativeRows) {
        for (const row of group.items) {
          totalBars += 1;
          // Route through the shared helper so the Gantt's initiative
          // verdict matches the Hero's Health Distribution donut at
          // initiative scope. The previous inline math used
          // `epic.planEndSprint` (a 1|2 lane within a month) as if it
          // were a global sprint number, collapsing every child end
          // date into early January and stamping every initiative as
          // overdue — which then made a "On Track" health filter
          // match zero bars.
          const v = computeInitiativeHealthVerdict(row.initiative, currentYear, progressBasis);
          if (v != null) {
            counts[v.status] += 1;
            statusByBarId.set(row.initiative.id, v.status);
            items.push({ id: row.initiative.id, title: row.initiative.title, kind: "initiative", status: v.status });
            unestimatedStoryCount += v.result.unestimatedCount;
          }
        }
      }
    } else {
      for (const group of activeEpicRows) {
        for (const row of group.items) {
          totalBars += 1;
          const epicStories = row.epic.userStories ?? [];
          const v = computeEpicHealthVerdict(row.epic, currentYear, progressBasis);
          const h = v != null ? v.result : computeProgress({
            stories: epicStories,
            start: sprintStartDate(currentYear, row.startS),
            end: sprintEndDate(currentYear, row.endS),
            basis: progressBasis,
            epicOriginalEstimateDays: row.epic.originalEstimateDays ?? null,
          });
          const hasData = progressBasis === "stories" ? epicStories.length > 0 : h.totalEffort > 0;
          if (hasData) {
            counts[h.status] += 1;
            statusByBarId.set(row.epic.id, h.status);
            items.push({ id: row.epic.id, title: row.epic.title, kind: "epic", status: h.status });
          }
          unestimatedStoryCount += h.unestimatedCount;
        }
      }
    }
    // `totalBars` was previously "every visible bar regardless of whether
    // we could compute health" — which made the popover footer / All chip /
    // header stay frozen at the same number even when switching basis caused
    // bars to drop out of (or into) the scored set. Reporting `items.length`
    // here keeps every popover number basis-consistent: when basis changes,
    // counts + items + totalBars all shift together.
    return { counts, statusByBarId, items, totalBars: items.length, totalBarsAllVisible: totalBars, unestimatedStoryCount };
  }, [
    roadmapBarMode,
    focusedQuarter,
    activeMonth,
    ganttSearchAppliedYearInitiativeRows,
    ganttSearchAppliedYearEpicRows,
    ganttSearchAppliedQuarterInitiativeRows,
    ganttSearchAppliedQuarterEpicRows,
    ganttSearchAppliedMonthEpicRows,
    ganttSearchAppliedMonthInitiativeRows,
    currentYear,
    progressBasis,
  ]);

  /**
   * Lifted from the middle panel — same Set drives the panel's epic list
   * filter, so when the planner picks `In Progress` in the unified Statuses
   * dropdown the Gantt also drops non-matching bars (and the initiative
   * grouping rolls up: an initiative is kept only when at least one of its
   * epics' derived status matches the filter).
   */
  const ganttStatusFilter = ganttStatusFilterExternal ?? null;
  const epicMatchesGanttStatusFilter = useCallback(
    (epic: EpicItem): boolean => {
      if (!ganttStatusFilter || ganttStatusFilter.size === 0) return true;
      // "backlogEpic" is a virtual status driven by epic placement —
      // an epic with no Gantt position (planStartMonth == null) is in
      // the backlog regardless of story state. Match it here so the
      // side panel surfaces those epics. The Gantt naturally empties
      // when this is the only filter, because backlog epics have no
      // bars to draw — no special-casing needed downstream.
      if (ganttStatusFilter.has("backlogEpic") && epic.planStartMonth == null) {
        return true;
      }
      // Real-status match: roll-up the epic's status (one verdict per
      // epic) so clicking a single Work Progress slice doesn't return
      // every epic that happens to contain one story in that bucket.
      const s = deriveEpicStatusKey(epic);
      return s != null && ganttStatusFilter.has(s);
    },
    [ganttStatusFilter],
  );
  const initiativeMatchesGanttStatusFilter = useCallback(
    (initiative: InitiativeItem): boolean => {
      if (!ganttStatusFilter || ganttStatusFilter.size === 0) return true;
      // `backlogEpic` is a planning-status slice (epic without a plan
      // window), not a workflow rollup. Keep the legacy any-epic logic
      // for that specific slice — there's no initiative-level analog.
      if (ganttStatusFilter.has("backlogEpic")) {
        const epics = initiative.epics ?? [];
        if (epics.some((e) => e.planStartMonth == null)) return true;
      }
      // Roll the initiative's stories up to a single workflow verdict
      // (same recipe as the Hero's Work Progress donut at initiative
      // scope) so picking "In progress" returns the same set the donut
      // surfaces — not every initiative that happens to contain one
      // in-progress epic.
      const rolled = deriveInitiativeStatusKey(initiative);
      return rolled != null && ganttStatusFilter.has(rolled);
    },
    [ganttStatusFilter],
  );
  /**
   * Quarter filter — "show this epic if its plan-start quarter is in the
   * picked Set." When the planner picks `Q2`, the Gantt drops epics that
   * started earlier and merely span into Q2 (e.g. a Q1→Q2 epic). Matches
   * the panel's own quarter cut.
   */
  const ganttQuarterFilter = ganttQuarterFilterExternal ?? null;
  const quarterFromMonthInline = (m: number): "Q1" | "Q2" | "Q3" | "Q4" => {
    if (m <= 3) return "Q1";
    if (m <= 6) return "Q2";
    if (m <= 9) return "Q3";
    return "Q4";
  };
  const epicMatchesGanttQuarterFilter = useCallback(
    (epic: EpicItem): boolean => {
      if (!ganttQuarterFilter || ganttQuarterFilter.size === 0) return true;
      if (epic.planStartMonth == null) return false;
      return ganttQuarterFilter.has(quarterFromMonthInline(epic.planStartMonth));
    },
    [ganttQuarterFilter],
  );
  const initiativeMatchesGanttQuarterFilter = useCallback(
    (initiative: InitiativeItem): boolean => {
      if (!ganttQuarterFilter || ganttQuarterFilter.size === 0) return true;
      return (initiative.epics ?? []).some((epic) => epicMatchesGanttQuarterFilter(epic));
    },
    [ganttQuarterFilter, epicMatchesGanttQuarterFilter],
  );
  /** Team filter — show an epic only when its `epic.team` is in the
   *  selected Set. An initiative passes if any of its epics passes. */
  const ganttTeamFilter = ganttTeamFilterExternal ?? null;
  const epicMatchesGanttTeamFilter = useCallback(
    (epic: EpicItem): boolean => {
      if (!ganttTeamFilter || ganttTeamFilter.size === 0) return true;
      return epic.team != null && ganttTeamFilter.has(epic.team);
    },
    [ganttTeamFilter],
  );
  const initiativeMatchesGanttTeamFilter = useCallback(
    (initiative: InitiativeItem): boolean => {
      if (!ganttTeamFilter || ganttTeamFilter.size === 0) return true;
      return (initiative.epics ?? []).some((epic) => epicMatchesGanttTeamFilter(epic));
    },
    [ganttTeamFilter, epicMatchesGanttTeamFilter],
  );

  // Year-roadmap rows after the active health filter is applied. Mirrors the
  // search-filter pattern: items whose status isn't in the filter set get
  // dropped, and any row that ends up empty is dropped too. When the filter
  // set is empty we return the input rows untouched. The execution-status
  // filter (from the middle panel) is chained AFTER the health filter — the
  // two are mutually exclusive at the dropdown layer, so in practice only
  // one of them filters at a time.
  const ganttHealthFilteredYearInitiativeRows = useMemo(() => {
    let rows = ganttSearchAppliedYearInitiativeRows;
    if (healthFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => {
            const s = ganttHealthData.statusByBarId.get(i.initiative.id);
            return s != null && healthFilter.has(s);
          }),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (ganttStatusFilter && ganttStatusFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => initiativeMatchesGanttStatusFilter(i.initiative)),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (ganttQuarterFilter && ganttQuarterFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => initiativeMatchesGanttQuarterFilter(i.initiative)),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (ganttTeamFilter && ganttTeamFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => initiativeMatchesGanttTeamFilter(i.initiative)),
        }))
        .filter((g) => g.items.length > 0);
    }
    return rows;
  }, [ganttSearchAppliedYearInitiativeRows, ganttHealthData.statusByBarId, healthFilter, ganttStatusFilter, initiativeMatchesGanttStatusFilter, ganttQuarterFilter, initiativeMatchesGanttQuarterFilter, ganttTeamFilter, initiativeMatchesGanttTeamFilter]);

  const ganttHealthFilteredYearEpicRows = useMemo(() => {
    let rows = ganttSearchAppliedYearEpicRows;
    if (healthFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => {
            const s = ganttHealthData.statusByBarId.get(i.epic.id);
            return s != null && healthFilter.has(s);
          }),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (ganttStatusFilter && ganttStatusFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => epicMatchesGanttStatusFilter(i.epic)),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (ganttQuarterFilter && ganttQuarterFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => epicMatchesGanttQuarterFilter(i.epic)),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (ganttTeamFilter && ganttTeamFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => epicMatchesGanttTeamFilter(i.epic)),
        }))
        .filter((g) => g.items.length > 0);
    }
    return rows;
  }, [ganttSearchAppliedYearEpicRows, ganttHealthData.statusByBarId, healthFilter, ganttStatusFilter, epicMatchesGanttStatusFilter, ganttQuarterFilter, epicMatchesGanttQuarterFilter, ganttTeamFilter, epicMatchesGanttTeamFilter]);

  // Mirror of the above for the focused-quarter view so the popover's
  // filter chips also hide non-matching bars when a single quarter is
  // selected.
  const ganttHealthFilteredQuarterInitiativeRows = useMemo(() => {
    let rows = ganttSearchAppliedQuarterInitiativeRows;
    if (healthFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => {
            const s = ganttHealthData.statusByBarId.get(i.initiative.id);
            return s != null && healthFilter.has(s);
          }),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (ganttStatusFilter && ganttStatusFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => initiativeMatchesGanttStatusFilter(i.initiative)),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (ganttQuarterFilter && ganttQuarterFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => initiativeMatchesGanttQuarterFilter(i.initiative)),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (ganttTeamFilter && ganttTeamFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => initiativeMatchesGanttTeamFilter(i.initiative)),
        }))
        .filter((g) => g.items.length > 0);
    }
    return rows;
  }, [ganttSearchAppliedQuarterInitiativeRows, ganttHealthData.statusByBarId, healthFilter, ganttStatusFilter, initiativeMatchesGanttStatusFilter, ganttQuarterFilter, initiativeMatchesGanttQuarterFilter, ganttTeamFilter, initiativeMatchesGanttTeamFilter]);

  const ganttHealthFilteredQuarterEpicRows = useMemo(() => {
    let rows = ganttSearchAppliedQuarterEpicRows;
    if (healthFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => {
            const s = ganttHealthData.statusByBarId.get(i.epic.id);
            return s != null && healthFilter.has(s);
          }),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (ganttStatusFilter && ganttStatusFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => epicMatchesGanttStatusFilter(i.epic)),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (ganttQuarterFilter && ganttQuarterFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => epicMatchesGanttQuarterFilter(i.epic)),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (ganttTeamFilter && ganttTeamFilter.size > 0) {
      rows = rows
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => epicMatchesGanttTeamFilter(i.epic)),
        }))
        .filter((g) => g.items.length > 0);
    }
    return rows;
  }, [ganttSearchAppliedQuarterEpicRows, ganttHealthData.statusByBarId, healthFilter, ganttStatusFilter, epicMatchesGanttStatusFilter, ganttQuarterFilter, epicMatchesGanttQuarterFilter, ganttTeamFilter, epicMatchesGanttTeamFilter]);

  // Month view is flat (not grouped by timeline row), so the filter just
  // drops items whose status isn't in the active set.
  const ganttHealthFilteredMonthEpicRows = useMemo(() => {
    let rows = ganttSearchAppliedMonthEpicRows;
    if (healthFilter.size > 0) {
      rows = rows.filter(({ epic }) => {
        const s = ganttHealthData.statusByBarId.get(epic.id);
        return s != null && healthFilter.has(s);
      });
    }
    if (ganttStatusFilter && ganttStatusFilter.size > 0) {
      rows = rows.filter(({ epic }) => epicMatchesGanttStatusFilter(epic));
    }
    if (ganttQuarterFilter && ganttQuarterFilter.size > 0) {
      rows = rows.filter(({ epic }) => epicMatchesGanttQuarterFilter(epic));
    }
    if (ganttTeamFilter && ganttTeamFilter.size > 0) {
      rows = rows.filter(({ epic }) => epicMatchesGanttTeamFilter(epic));
    }
    return rows;
  }, [ganttSearchAppliedMonthEpicRows, ganttHealthData.statusByBarId, healthFilter, ganttStatusFilter, epicMatchesGanttStatusFilter, ganttQuarterFilter, epicMatchesGanttQuarterFilter, ganttTeamFilter, epicMatchesGanttTeamFilter]);

  const ganttHealthFilteredMonthInitiativeRows = useMemo(() => {
    let rows = ganttSearchAppliedMonthInitiativeRows;
    if (healthFilter.size > 0) {
      rows = rows.filter((initiative) => {
        const s = ganttHealthData.statusByBarId.get(initiative.id);
        return s != null && healthFilter.has(s);
      });
    }
    if (ganttStatusFilter && ganttStatusFilter.size > 0) {
      rows = rows.filter((initiative) => initiativeMatchesGanttStatusFilter(initiative));
    }
    if (ganttQuarterFilter && ganttQuarterFilter.size > 0) {
      rows = rows.filter((initiative) => initiativeMatchesGanttQuarterFilter(initiative));
    }
    if (ganttTeamFilter && ganttTeamFilter.size > 0) {
      rows = rows.filter((initiative) => initiativeMatchesGanttTeamFilter(initiative));
    }
    return rows;
  }, [ganttSearchAppliedMonthInitiativeRows, ganttHealthData.statusByBarId, healthFilter, ganttStatusFilter, initiativeMatchesGanttStatusFilter, ganttQuarterFilter, initiativeMatchesGanttQuarterFilter, ganttTeamFilter, initiativeMatchesGanttTeamFilter]);

  // Clear the active health filter whenever the view mode swaps so a filter
  // pinned in "epics" view doesn't silently survive into "initiatives" view
  // (different bar set → could leave the user with an empty roadmap).
  useEffect(() => {
    setHealthFilter(new Set());
  }, [roadmapBarMode]);
  const showSprintTeamPicker =
    activeMonth != null &&
    (monthPlanTab === "sprint-kanban" ||
      monthPlanTab === "sprint-status" ||
      monthPlanTab === "sprint-retrospective" ||
      monthPlanTab === "month-status");
  const showInsightsTeamPicker = activeMonth == null && quarterViewTab === "insights";
  const showGanttTeamPicker =
    (activeMonth != null && monthPlanTab === "epic-gantt") ||
    (activeMonth == null && quarterViewTab === "gantt");
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
        icon: (
          <TeamAvatar
            slug={value}
            sizePx={14}
            fallback={<span className="inline-block size-2.5 shrink-0 rounded-full bg-slate-400" aria-hidden />}
          />
        ),
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
          <TeamAvatar
            slug={team.id}
            sizePx={14}
            fallback={
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
            }
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
        icon: (
          <TeamAvatar
            slug={st}
            sizePx={14}
            fallback={<span className="inline-block size-2.5 shrink-0 rounded-full bg-slate-400" aria-hidden />}
          />
        ),
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
  const ganttTeamLabel = ganttTeamIds.length === 0
    ? "All Teams"
    : ganttTeamIds.map((id) => sprintTeamOptions.find((o) => o.value === id)?.label ?? id).join(", ");
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
  // Sprint-level health verdict used by the right-side breadcrumb chip on the
  // Sprint Insights surface. Same burndown formula as Sprint Load rows: gap =
  // remaining − ideal; ≤1d → On Track · 1–4d → Watch · ≥4d → At Risk · sprint
  // ended with work left → Overdue · 0d → Done. Reads aggregate workload
  // numbers from `buildSprintAnalytics` so it's consistent with the chart's
  // own view (incl. the active team filter). Returns null off-surface so the
  // chip is hidden everywhere else.
  const sprintInsightsHealth = useMemo<{
    status: "done" | "overdue" | "atRisk" | "watch" | "onTrack";
    estTotal: number;
    daysLeft: number;
    sprintDaysLeft: number;
    sprintDaysTotal: number;
  } | null>(() => {
    if (monthPlanTab !== "sprint-status") return null;
    const month = sprintBoardContextMonth ?? activeMonth ?? null;
    const yearSprintLocal = resolvedActiveYearSprint ?? null;
    if (month == null || yearSprintLocal == null) return null;
    const analytics = buildSprintAnalytics(
      initiatives,
      month,
      yearSprintLocal,
      "daysLeft",
      currentYear,
      sprintFilterTeamIds.length ? sprintFilterTeamIds : null,
    );
    const estTotal = analytics.workloadByAssignee.reduce((s, r) => s + r.estimatedTotal, 0);
    const daysLeft = analytics.workloadByAssignee.reduce((s, r) => s + r.daysLeftTotal, 0);
    const sprintDaysLeft = analytics.workloadSprintCalendarDaysLeft;
    const sprintDaysTotal = analytics.workloadSprintCalendarDaysTotal;
    const status: "done" | "overdue" | "atRisk" | "watch" | "onTrack" = (() => {
      if (estTotal <= 0 || sprintDaysTotal <= 0) return "onTrack";
      if (daysLeft <= 0) return "done";
      if (sprintDaysLeft <= 0) return "overdue";
      const elapsed = Math.min(1, Math.max(0, (sprintDaysTotal - sprintDaysLeft) / sprintDaysTotal));
      const ideal = estTotal * (1 - elapsed);
      const gap = daysLeft - ideal;
      if (gap >= 4) return "atRisk";
      if (gap >= 1) return "watch";
      return "onTrack";
    })();
    return { status, estTotal, daysLeft, sprintDaysLeft, sprintDaysTotal };
  }, [monthPlanTab, activeMonth, sprintBoardContextMonth, resolvedActiveYearSprint, initiatives, currentYear, sprintFilterTeamIds]);
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
    console.log("[team-filter] reset from sprintStoryBoardTeamId prop", {
      sprintStoryBoardTeamId,
      resolved: t,
      becomes: t ? [t] : [],
    });
    setSprintFilterTeamIds(t ? [t] : []);
  }, [sprintStoryBoardTeamId]);
  // Cross-surface team-filter sync. The Gantt views (all-quarters /
  // single-quarter / month) and the Sprint surfaces (kanban, capacity,
  // retro, insights) each maintain their own team-filter state. Mirror
  // them so picking a team on any surface immediately applies to every
  // other surface. Equality check on both effects prevents a render loop.
  useEffect(() => {
    setSprintFilterTeamIds((prev) => {
      if (
        prev.length === ganttTeamIds.length &&
        prev.every((id, i) => id === ganttTeamIds[i])
      ) {
        return prev;
      }
      console.log("[team-filter] sync gantt → sprint", { from: prev, to: ganttTeamIds });
      return [...ganttTeamIds];
    });
  }, [ganttTeamIds]);
  useEffect(() => {
    setGanttTeamIds((prev) => {
      if (
        prev.length === sprintFilterTeamIds.length &&
        prev.every((id, i) => id === sprintFilterTeamIds[i])
      ) {
        return prev;
      }
      console.log("[team-filter] sync sprint → gantt", { from: prev, to: sprintFilterTeamIds });
      return [...sprintFilterTeamIds];
    });
  }, [sprintFilterTeamIds]);
  // External-filter sync. When the parent writes `ganttTeamFilterExternal`
  // (e.g. the planner clicks a row on the hero's Team Progress card),
  // mirror it into the Gantt's local `ganttTeamIds` so the breadcrumb
  // "Team All Teams" dropdown reflects the selection and the
  // bar-row-level filtering paths that read `ganttTeamIds` (year/month/
  // quarter epic rows; see `ganttTeamIds.includes` sites above) stay
  // consistent with the external Set the cross-mode filter uses.
  useEffect(() => {
    if (!ganttTeamFilterExternal) return;
    const incoming = Array.from(ganttTeamFilterExternal);
    setGanttTeamIds((prev) => {
      if (prev.length === incoming.length && prev.every((id, i) => id === incoming[i])) {
        return prev;
      }
      return incoming;
    });
  }, [ganttTeamFilterExternal, setGanttTeamIds]);
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
  useEffect(() => {
    if (!isGanttTeamMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!ganttTeamMenuRef.current?.contains(event.target as Node)) setIsGanttTeamMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsGanttTeamMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isGanttTeamMenuOpen]);
  useEffect(() => {
    if (isGanttTeamMenuOpen) {
      setGanttTeamSearch("");
      setTimeout(() => ganttTeamSearchInputRef.current?.focus(), 0);
    }
  }, [isGanttTeamMenuOpen]);
  useEffect(() => {
    if (!showGanttTeamPicker) setIsGanttTeamMenuOpen(false);
  }, [showGanttTeamPicker]);

  const fullYearRoadmapGanttTracks = (
        roadmapBarMode === "initiatives" && ganttSearchAppliedYearInitiativeRows.length === 0 ? (
          focusedQuarter && quarterViewTab === "gantt" ? null : !focusedQuarter ? (
            <YearRoadmapEmptyStripedLane
              currentYear={currentYear}
              roadmapLaneTodayLeft={roadmapLaneTodayLeft}
              columnCount={ganttLaneColumnCount}
              variant="initiatives"
              isDragging={isAnyDragActive}
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
              isDragging={isAnyDragActive}
            />
          ) : (
            <p className="bg-gradient-to-r from-slate-100 via-slate-50 to-white p-3.5 text-[14px] leading-6 text-slate-950">
              Create an initiative, then drag its epics onto the timeline. You can also stretch or shorten a scheduled bar
              by dragging its ends to match your start and due dates.
            </p>
          )
        ) : focusedQuarter && quarterViewTab === "gantt" ? null : roadmapBarMode === "initiatives" ? (
          <div
            className={cn(
              // `min-h-fit` (instead of `min-h-0`) lets this flex item
              // grow with its bar content. Without it, `flex-1 min-h-0`
              // would clamp the box to the flex-allocated height, leaving
              // the absolutely-positioned today line (which uses
              // `inset-y-0` of this box) shorter than the visible bars
              // when content overflows the viewport.
              "relative isolate flex min-h-fit min-w-0 flex-1 flex-col bg-white pl-0 pr-0 pb-1 sm:pl-0 sm:pr-0 sm:pb-1",
              // Unified-scroll: `overflow-x-clip` (not -hidden) so the browser
// does NOT coerce `overflow-y: visible` to `auto`, which would
// resurrect an internal vertical scrollbar on the Gantt panel.
!yearRoadmapHScroll && "overflow-x-clip",
              roadmapLaneTodayLeft != null && "pt-5 sm:pt-6",
            )}
          >
            <YearRoadmapTodayLine leftPercent={roadmapLaneTodayLeft} />
            <div
              className={cn(
                "relative flex min-h-fit w-full flex-1 flex-col",
                // Unified-scroll: `overflow-x-clip` (not -hidden) so the browser
// does NOT coerce `overflow-y: visible` to `auto`, which would
// resurrect an internal vertical scrollbar on the Gantt panel.
!yearRoadmapHScroll && "overflow-x-clip",
              )}
            >
              <div
                id={TIMELINE_GANTT_ROWS_CONTAINER_ID}
                className={cn(
                  // Unified-scroll: vertical scroll bubbles up to the
                  // page scroller (main element).
                  "relative z-10 min-h-fit flex-1 space-y-0.5 overflow-y-visible",
                  // Unified-scroll: `overflow-x-clip` (not -hidden) so the browser
// does NOT coerce `overflow-y: visible` to `auto`, which would
// resurrect an internal vertical scrollbar on the Gantt panel.
!yearRoadmapHScroll && "overflow-x-clip",
                )}
              >
              <GanttLaneSprintBackdrop columnCount={ganttLaneColumnCount} />
              <StripedGanttHorizontalGuides />
              {ganttHealthFilteredYearInitiativeRows.map((group, idx) => (
                <div
                  key={`year-init-row-${group.timelineRow}`}
                  className={cn(
                    "relative min-w-0 z-10 py-1.5",
                    // Zebra striping: every odd-index row gets a soft slate
                    // tint so adjacent lanes read as distinct. Translucent so
                    // the today line + sprint backdrop still show through.
                    idx % 2 === 1 && "bg-slate-100/55",
                    "border-b border-slate-200/50",
                  )}
                  data-gantt-lane-index={idx}
                  data-gantt-timeline-row={group.timelineRow}
                >
                  <GanttLaneSprintBackdrop columnCount={ganttLaneColumnCount} />
                  <div className="relative z-[1] grid min-w-0 gap-2" style={ganttLaneGridStyle}>
                    {group.items.map((row) => {
                      const columnStart = Math.max(1, row.startS);
                      const span = Math.max(row.endS - row.startS + 1, 1);
                      const initiativeEnd = sprintEndDate(currentYear, row.endS);
                      const initiativeStart = sprintStartDate(currentYear, row.startS);
                      // Use the shared verdict helper for each child so
                      // the initiative bar's rolled-up status matches
                      // every other surface's per-epic verdict.
                      const childStatuses = (row.initiative.epics ?? [])
                        .map((epic) => computeEpicHealthVerdict(epic, currentYear, progressBasis)?.status)
                        .filter((s): s is HealthStatus => s != null);
                      const aggregateStories = (row.initiative.epics ?? []).flatMap((e) => e.userStories ?? []);
                      const initiativeOriginalEstSum = (row.initiative.epics ?? []).reduce(
                        (sum, e) => sum + (e.originalEstimateDays ?? 0),
                        0,
                      );
                      const initHealth = computeInitiativeProgress({
                        stories: aggregateStories,
                        childStatuses,
                        start: initiativeStart,
                        end: initiativeEnd,
                        basis: progressBasis,
                        epicOriginalEstimateDays: initiativeOriginalEstSum > 0 ? initiativeOriginalEstSum : null,
                      });
                      const initiativeTooltip = formatHealthTooltip(initHealth);
                      const initHasData =
                        progressBasis === "stories" ? aggregateStories.length > 0 : initHealth.totalEffort > 0;
                      return (
                        <div
                          key={`year-init-${row.initiative.id}`}
                          className="relative min-w-0 rounded-lg pt-2 pb-2 z-20"
                          style={{ gridColumn: `${columnStart} / span ${span}`, gridRow: 1 }}
                        >
                          <InitiativeTimelineBar
                            id={row.initiative.id}
                            title={row.initiative.title}
                            icon={row.initiative.icon}
                            color={row.initiative.color}
                            progressPercent={initHealth.progressPercent}
                            progressLabel={initiativeTooltip}
                            showProgress={showRoadmapProgress || healthFilter.size > 0}
                            // Year view: last-picked lane wins so the bar carries
                            // exactly one label. Status wins when the planner
                            // clicked a Work Progress slice; health is the
                            // default otherwise (initiatives previously had no
                            // execution-status pill — now they roll up the
                            // child stories' workflow status, same recipe as
                            // the Work Progress donut at initiative scope).
                            workflowStatus={
                              showRoadmapProgress && lastPickedLabelLane === "status"
                                ? deriveInitiativeStatusKey(row.initiative)
                                : null
                            }
                            healthStatus={
                              showRoadmapProgress &&
                              initHasData &&
                              lastPickedLabelLane !== "team" &&
                              lastPickedLabelLane !== "status"
                                ? initHealth.status
                                : null
                            }
                            healthTooltip={initiativeTooltip}
                            teamAssignmentChip={
                              showGanttTeamChips &&
                              row.initiative.team &&
                              lastPickedLabelLane === "team"
                                ? epicDeliveryTeamAssignmentChip(row.initiative.team)
                                : null
                            }
                            onClick={() => onOpenInitiative(row.initiative.id)}
                            onDelete={onUnscheduleInitiative ? () => onUnscheduleInitiative(row.initiative.id) : undefined}
                            onInsightsClick={() => (onOpenInsights ?? openInsightsTab)("initiative", row.initiative.id)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {/* Unified-scroll: phantom padding rows removed — the lane
               *  now ends at the last initiative row and the page
               *  scrollbar drives further vertical movement. */}
              </div>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              // `min-h-fit` so the today line (absolute `inset-y-0` of
              // this box) extends with the bar content instead of being
              // clipped to the flex allocation — see the initiatives
              // branch above for the same rationale.
              "relative isolate flex min-h-fit min-w-0 flex-1 flex-col bg-white pl-0 pr-0 pb-1 sm:pl-0 sm:pr-0 sm:pb-1",
              // Unified-scroll: `overflow-x-clip` (not -hidden) so the browser
// does NOT coerce `overflow-y: visible` to `auto`, which would
// resurrect an internal vertical scrollbar on the Gantt panel.
!yearRoadmapHScroll && "overflow-x-clip",
              roadmapLaneTodayLeft != null && "pt-5 sm:pt-6",
            )}
          >
            <YearRoadmapTodayLine leftPercent={roadmapLaneTodayLeft} />
            <div
              className={cn(
                "relative flex min-h-fit w-full flex-1 flex-col",
                // Unified-scroll: `overflow-x-clip` (not -hidden) so the browser
// does NOT coerce `overflow-y: visible` to `auto`, which would
// resurrect an internal vertical scrollbar on the Gantt panel.
!yearRoadmapHScroll && "overflow-x-clip",
              )}
            >
              <div
                id={TIMELINE_GANTT_ROWS_CONTAINER_ID}
                className={cn(
                  // Unified-scroll: vertical scroll bubbles up to the
                  // page scroller (main element).
                  "relative z-10 min-h-fit flex-1 space-y-0.5 overflow-y-visible",
                  // Unified-scroll: `overflow-x-clip` (not -hidden) so the browser
// does NOT coerce `overflow-y: visible` to `auto`, which would
// resurrect an internal vertical scrollbar on the Gantt panel.
!yearRoadmapHScroll && "overflow-x-clip",
                )}
              >
              <GanttLaneSprintBackdrop columnCount={ganttLaneColumnCount} />
              <StripedGanttHorizontalGuides />
              {ganttHealthFilteredYearEpicRows.map((group, idx) => (
                <div
                  key={`year-epic-row-${group.timelineRow}`}
                  className={cn(
                    "relative min-w-0 z-10 py-1.5",
                    // Zebra striping (matches initiative-mode rows above).
                    idx % 2 === 1 && "bg-slate-100/55",
                    "border-b border-slate-200/50",
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
                      const epicStoriesForHealth = row.epic.userStories ?? [];
                      // Use the shared verdict helper when NOT in an
                      // active resize drag — that's the only state that
                      // wants the preview window's verdict instead of
                      // the stored window's. During a drag, compute
                      // inline against the previewed sprints so the
                      // badge updates in real time.
                      const epicHealth = rz != null
                        ? computeProgress({
                            stories: epicStoriesForHealth,
                            start: sprintStartDate(currentYear, previewStart),
                            end: sprintEndDate(currentYear, previewEnd),
                            basis: progressBasis,
                            epicOriginalEstimateDays: row.epic.originalEstimateDays ?? null,
                          })
                        : (computeEpicHealthVerdict(row.epic, currentYear, progressBasis)?.result
                          ?? computeProgress({
                            stories: epicStoriesForHealth,
                            start: sprintStartDate(currentYear, previewStart),
                            end: sprintEndDate(currentYear, previewEnd),
                            basis: progressBasis,
                            epicOriginalEstimateDays: row.epic.originalEstimateDays ?? null,
                          }));
                      const epicHealthTooltip = formatHealthTooltip(epicHealth);
                      const epicHasData =
                        progressBasis === "stories" ? epicStoriesForHealth.length > 0 : epicHealth.totalEffort > 0;
                      /**
                       * Preview-aware overdue: during a resize drag, the
                       * stored `planEndMonth` hasn't been patched yet; the
                       * live state lives in `previewEnd`. Recompute against
                       * the previewed end-of-sprint so the bar's Overdue
                       * pill flips off in real-time as the planner extends
                       * the epic past today.
                       */
                      const epicLiveStatus = deriveEpicStatusKey(row.epic);
                      const isOverdueLive =
                        epicLiveStatus !== "done" &&
                        epicLiveStatus !== null &&
                        clockNowMs() > sprintEndDate(currentYear, previewEnd).getTime();
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
                          className={cn("relative min-w-0 rounded-lg pt-2 pb-2", rz ? "z-0 opacity-70" : "z-20")}
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
                              progressPercent={epicHealth.progressPercent}
                              progressLabel={epicHealthTooltip}
                              isResizing={Boolean(rz)}
                              emphasizeFlash={emphasizeFlash}
                              emphasizeTick={emphasizeTick}
                              showProgress={showRoadmapProgress || healthFilter.size > 0}
                              // Year (all-quarters) view: AT MOST ONE label per
                              // bar — narrow widths can't carry both a team chip
                              // and a status/health pill without crowding. Last
                              // lane the planner activated wins, so clicking
                              // Health after Team flips the bars from team
                              // chips to health pills (and vice versa).
                              healthStatus={
                                lastPickedLabelLane === "health" &&
                                (showRoadmapProgress || healthFilter.size > 0) &&
                                epicHasData
                                  ? epicHealth.status
                                  : null
                              }
                              healthTooltip={epicHealthTooltip}
                              epicStatus={
                                showRoadmapProgress &&
                                lastPickedLabelLane !== "team" &&
                                lastPickedLabelLane !== "health"
                                  ? epicLiveStatus
                                  : null
                              }
                              // Overdue is a HEALTH-VERDICT signal — it lives next
                              // to On Track / At Risk / Watch in the popover taxonomy.
                              // Hiding it from the status-pill mode keeps the two
                              // filter lanes visually independent (regular status
                              // shows execution; health verdict shows scheduling
                              // risk). The Overdue pill still appears via HealthBadge
                              // when `healthFilter.size > 0` and the epic is overdue.
                              isOverdue={false}
                              // Pass `daysPastPlan` to the bar so the
                              // amber/red border fires even in the
                              // year-roadmap (where the Overdue pill is
                              // suppressed). Border is a separate signal
                              // from the badge — peripheral vs focal.
                              daysPastPlan={epicOverdueMeta(row.epic, currentYear)?.daysPastPlan ?? 0}
                              onUnschedule={onUnscheduleEpic ? () => onUnscheduleEpic(row.epic.id) : undefined}
                              onClick={() => onOpenEpic(row.epic.id)}
                              onInsightsClick={() => (onOpenInsights ?? openInsightsTab)("epic", row.epic.id)}
                              teamAssignmentChip={
                                showGanttTeamChips &&
                                row.epic.team &&
                                lastPickedLabelLane === "team"
                                  ? epicDeliveryTeamAssignmentChip(row.epic.team)
                                  : null
                              }
                              dimmed={isHighlightActive && !highlightedEpicIds!.has(row.epic.id)}
                            />
                            {(() => {
                              // Overdue decorations — drawn AS A LAYER over
                              // the plan bar (no positional change to the
                              // bar itself). Skipped during a resize drag
                              // because the live preview is rewriting the
                              // bar's window — the moment the planner drags
                              // past today, the slip should vanish.
                              if (rz != null) return null;
                              const meta = epicOverdueMeta(row.epic, currentYear);
                              if (meta == null) return null;
                              // Ghost length follows the LATEST OPEN-STORY
                              // SPRINT past the epic's planEnd, not an
                              // abstract `today + Σ daysLeft` projection.
                              // If no story is sprinted past the plan,
                              // the bar still gets its severity border +
                              // slip icon, but no stripe.
                              const planStartMs = sprintStartDate(currentYear, previewStart).getTime();
                              const planEndMs = epicPlannedEndMs(row.epic, currentYear)
                                ?? sprintEndDate(currentYear, previewEnd).getTime();
                              const barPlanDays = Math.max(1, (planEndMs - planStartMs) / 86400000);
                              const planEndGS = globalSprintFromMonthLane(
                                row.epic.planEndMonth ?? 1,
                                row.epic.planEndSprint === 1 ? 1 : 2,
                              );
                              const latestLateSprint = epicLatestLateSprint(row.epic, planEndGS);
                              let ghostPct = 0;
                              if (latestLateSprint != null) {
                                const ghostEndMs = sprintEndDate(currentYear, latestLateSprint).getTime();
                                const ghostExtraDays = Math.max(0, (ghostEndMs - planEndMs) / 86400000);
                                ghostPct = (ghostExtraDays / barPlanDays) * 100;
                              }
                              const severity: "amber" | "red" = meta.daysPastPlan > 7 ? "red" : "amber";
                              return (
                                <OverdueSlipDecoration
                                  severity={severity}
                                  ghostPct={ghostPct}
                                  daysPastPlan={meta.daysPastPlan}
                                  projectedDaysLeft={meta.projectedDaysLeft}
                                  compact
                                />
                              );
                            })()}
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
              {/* Unified-scroll: phantom padding rows removed — the lane
               *  now ends at the last epic row and the page scrollbar
               *  drives further vertical movement. */}
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

  const summaryYearChipsJsx = summaryBadgesForScope ? (
    <>
      {/* Roadmap chip parked — the roadmap picker is reachable from
        * the dashboard hero subtitle. Remove the `false && ` to bring
        * it back into this toolbar. */}
      {false && onYearChange ? (
        <RoadmapSelector
          roadmaps={roadmaps}
          selectedRoadmap={selectedRoadmap}
          year={currentYear}
          onYearChange={onYearChange ?? (() => {})}
          onSelectRoadmap={onSelectRoadmap}
          onCreateRoadmap={onCreateRoadmap}
          onRenameRoadmap={onRenameRoadmap}
          onAddYearToRoadmap={onAddYearToRoadmap}
          onRemoveYearFromRoadmap={onRemoveYearFromRoadmap}
          onGetRoadmapCounts={onGetRoadmapCounts}
          onDeleteRoadmap={onDeleteRoadmap}
        />
      ) : null}
      <button
        ref={progressBtnRef}
        type="button"
        aria-pressed={showRoadmapProgress}
        onClick={() => {
          if (!showRoadmapProgress) onShowRoadmapProgressChange(true);
          setHealthPopoverOpen((prev) => (showRoadmapProgress ? !prev : true));
        }}
        className={cn(showRoadmapProgress ? summaryChipProgressOnClass : summaryChipProgressIdleClass)}
      >
        <Activity className="size-3 shrink-0 sm:size-3.5" aria-hidden />
        Health
      </button>
      {/* Initiatives ↔ Epics: segmented toggle pill — keeps the chip pill
          shape and palette, with the active half flipped to the amber "on"
          treatment used elsewhere in the toolbar. */}
      <div
        role="group"
        aria-label="Roadmap bar mode"
        data-roadmap-health-keepopen
        className="inline-flex h-[28px] shrink-0 items-center rounded-full bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 p-[2px] ring-1 ring-indigo-200/80"
      >
        <button
          type="button"
          aria-pressed={roadmapBarMode === "initiatives"}
          onClick={() => { setRoadmapBarMode("initiatives"); onSummaryStatusQuickFilterChange?.(null); }}
          className={cn(
            "inline-flex h-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold leading-none tracking-tight transition focus:outline-none focus:ring-2 focus:ring-amber-300",
            roadmapBarMode === "initiatives"
              ? "bg-amber-100 text-amber-900 ring-1 ring-amber-200 shadow-[inset_0_2px_4px_rgba(15,23,42,0.10)]"
              : "text-indigo-900 hover:bg-white/40",
          )}
        >
          <Zap className="size-3 shrink-0 sm:size-3.5" strokeWidth={1.5} aria-hidden />
          <span className="truncate">{summaryBadgesForScope.totalInitiatives}</span>
          <span className="hidden xl:inline">Initiatives</span>
          <span className="xl:hidden">Inits</span>
        </button>
        <button
          type="button"
          aria-pressed={roadmapBarMode === "epics" && summaryStatusQuickFilter == null}
          onClick={() => { setRoadmapBarMode("epics"); onSummaryStatusQuickFilterChange?.(null); }}
          className={cn(
            "inline-flex h-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold leading-none tracking-tight transition focus:outline-none focus:ring-2 focus:ring-amber-300",
            roadmapBarMode === "epics" && summaryStatusQuickFilter == null
              ? "bg-amber-100 text-amber-900 ring-1 ring-amber-200 shadow-[inset_0_2px_4px_rgba(15,23,42,0.10)]"
              : "text-indigo-900 hover:bg-white/40",
          )}
        >
          <Folder className="size-3 shrink-0 sm:size-3.5" strokeWidth={1.5} aria-hidden />
          {("totalEpics" in summaryBadgesForScope ? summaryBadgesForScope.totalEpics : summaryBadgesForScope.scheduledEpics + summaryBadgesForScope.unscheduledEpics)}{" "}Epics
        </button>
      </div>
      <div className={summaryChipStoriesStaticClass}>
        {/* Stroke-based FileText icon — strokeWidth 1.25 + opacity-70 keeps
            it noticeably lighter than the neighbouring chip icons. */}
        <FileText className="size-3 shrink-0 sm:size-3.5 opacity-70" strokeWidth={1.25} aria-hidden />
        <span className="truncate">{summaryBadgesForScope.totalStories}</span>
        <span>Stories</span>
      </div>
      {showGanttTeamPicker ? (
        <button
          type="button"
          data-roadmap-health-keepopen
          aria-pressed={showGanttTeamChips}
          onClick={() => setShowGanttTeamChips((prev) => !prev)}
          className={cn(showGanttTeamChips ? summaryChipTeamsOnClass : summaryChipTeamsIdleClass)}
        >
          <Users className="size-3 shrink-0 sm:size-3.5" aria-hidden />
          Teams
        </button>
      ) : null}
      <RoadmapHealthPopover
        open={healthPopoverOpen}
        anchorRef={progressBtnRef}
        counts={ganttHealthData.counts}
        totalBars={ganttHealthData.totalBars}
        unestimatedStoryCount={ganttHealthData.unestimatedStoryCount}
        items={ganttHealthData.items}
        filter={healthFilter}
        onFilterChange={setHealthFilter}
        onClose={() => {
          // Closing the popover dismisses the entire health overlay — also
          // turns off the bar-level progress + health labels so the toolbar
          // chip reads as unpressed and the Gantt returns to its plain view.
          setHealthPopoverOpen(false);
          onShowRoadmapProgressChange(false);
        }}
        unitLabel={roadmapBarMode === "initiatives" ? "initiative" : "epic"}
        barMode={roadmapBarMode}
        onBarModeChange={(mode) => { setRoadmapBarMode(mode); onSummaryStatusQuickFilterChange?.(null); }}
        progressBasis={progressBasis}
        onProgressBasisChange={onProgressBasisChange}
        onOpenInsights={(kind, id) => {
          // Route through the parent's insights handler when available —
          // it pre-scopes the Insights tab to the picked initiative/epic
          // and switches surface in one call. Falls back to plain tab
          // switch if no parent handler is wired (legacy callsite).
          if (onOpenInsights) onOpenInsights(kind, id);
          else setQuarterViewTab("insights");
        }}
      />
      <button type="button" onClick={() => openEstEpicsPanel()} className={summaryChipEstimatedClass}>
        {/* Donut chart visualizing Epic Estimated %. Track was slate-200
            (#e2e8f0) which is nearly identical to the chip's indigo-100
            background — the donut looked white/invisible. Bumped the track
            to indigo-400 for clear contrast against the pale-indigo chip
            while staying in the chip's palette. Progress arc keeps the
            project's rose accent. */}
        <svg viewBox="0 0 16 16" className={summaryChipProgressCircleClass} aria-hidden>
          <circle cx="8" cy="8" r="6" fill="none" stroke="#818cf8" strokeWidth="2" />
          <circle
            cx="8" cy="8" r="6" fill="none"
            stroke="#e11d48" strokeWidth="2" strokeLinecap="round"
            transform="rotate(-90 8 8)"
            strokeDasharray={`${2 * Math.PI * 6}`}
            strokeDashoffset={`${(2 * Math.PI * 6) * (1 - estimatedEpicsPercentClamped / 100)}`}
          />
        </svg>
        <span className="truncate">{estimatedEpicsPercentForScope}%</span>
        <span>Epic Est.</span>
      </button>
      {!activeMonth && !focusedQuarter && quarterViewTab === "gantt" ? (
        <button
          type="button"
          data-roadmap-health-keepopen
          onClick={() => setShowYearSprintChips((prev) => !prev)}
          className={cn(summaryChipBaseClass, showYearSprintChips ? summaryChipSprintsOnClass : summaryChipSprintsIdleClass)}
        >
          <Flag className="size-3 shrink-0 sm:size-3.5" aria-hidden />
          <span className="hidden xl:inline">Sprints</span>
          <span className="xl:hidden">Spr</span>
        </button>
      ) : null}
    </>
  ) : null;

  const summarySprintChipsJsx = sprintKanbanSummaryStats ? (
    <>
      {/* Roadmap chip parked in sprint views too — the roadmap picker
        * is reachable from the dashboard hero subtitle. Remove the
        * `false && ` to bring it back. */}
      {false && onYearChange ? (
        <RoadmapSelector
          roadmaps={roadmaps}
          selectedRoadmap={selectedRoadmap}
          year={currentYear}
          onYearChange={onYearChange ?? (() => {})}
          onSelectRoadmap={onSelectRoadmap}
          onCreateRoadmap={onCreateRoadmap}
          onRenameRoadmap={onRenameRoadmap}
          onAddYearToRoadmap={onAddYearToRoadmap}
          onRemoveYearFromRoadmap={onRemoveYearFromRoadmap}
          onGetRoadmapCounts={onGetRoadmapCounts}
          onDeleteRoadmap={onDeleteRoadmap}
        />
      ) : null}
      <button
        type="button"
        onClick={() => setSprintKanbanShowProgress((v) => !v)}
        aria-pressed={sprintKanbanShowProgress}
        title={sprintKanbanShowProgress ? "Hide progress bars" : "Show progress bars on cards"}
        className={cn(
          summaryChipBaseClass,
          sprintKanbanShowProgress
            ? "bg-gradient-to-br from-emerald-100 via-emerald-200 to-emerald-200 text-emerald-950 ring-1 ring-emerald-300/75 shadow-sm"
            : "bg-gradient-to-br from-emerald-50 via-emerald-100 to-emerald-100 text-emerald-950 ring-1 ring-emerald-200/75 hover:from-emerald-100 hover:via-emerald-200 hover:to-emerald-200",
        )}
      >
        <Activity className="size-3 shrink-0" strokeWidth={2.2} aria-hidden />
        Progress
      </button>
      <button
        type="button"
        onClick={() => setSprintKanbanShowHealth((v) => !v)}
        aria-pressed={sprintKanbanShowHealth}
        title={sprintKanbanShowHealth ? "Hide health chips on cards" : "Show health chips on cards"}
        className={cn(
          summaryChipBaseClass,
          sprintKanbanShowHealth
            ? "bg-gradient-to-br from-rose-100 via-rose-200 to-rose-200 text-rose-950 ring-1 ring-rose-300/75 shadow-sm"
            : "bg-gradient-to-br from-rose-50 via-rose-100 to-rose-100 text-rose-950 ring-1 ring-rose-200/75 hover:from-rose-100 hover:via-rose-200 hover:to-rose-200",
        )}
      >
        <HeartPulse className="size-3 shrink-0" strokeWidth={2.2} aria-hidden />
        Health
      </button>
      <button
        type="button"
        onClick={() => setSprintKanbanShowTeams((v) => !v)}
        aria-pressed={sprintKanbanShowTeams}
        title={sprintKanbanShowTeams ? "Hide team chips on cards" : "Show team chips on cards"}
        className={cn(
          summaryChipBaseClass,
          sprintKanbanShowTeams
            ? "bg-gradient-to-br from-sky-100 via-sky-200 to-sky-200 text-sky-950 ring-1 ring-sky-300/75 shadow-sm"
            : "bg-gradient-to-br from-sky-50 via-sky-100 to-sky-100 text-sky-950 ring-1 ring-sky-200/75 hover:from-sky-100 hover:via-sky-200 hover:to-sky-200",
        )}
      >
        <Users className="size-3 shrink-0" strokeWidth={2.2} aria-hidden />
        Teams
      </button>
      {/* Carried-over toolbar chip — only renders when the current sprint
       *  actually has stories that rolled over from a prior sprint. Clicking
       *  opens the audit modal listing exactly which stories carried over. */}
      {resolvedActiveYearSprint != null && (() => {
        const carriedOverCount = collectStoriesRolledIntoSprint(initiatives, resolvedActiveYearSprint).length;
        if (carriedOverCount === 0) return null;
        return (
          <button
            type="button"
            onClick={() => setRolledInModalSprint(resolvedActiveYearSprint)}
            title={`See what carried over into Sprint ${resolvedActiveYearSprint}`}
            className={cn(
              summaryChipBaseClass,
              "bg-gradient-to-br from-indigo-50 via-indigo-100 to-indigo-100 text-indigo-950 ring-1 ring-indigo-200/75 hover:from-indigo-100 hover:via-indigo-200 hover:to-indigo-200",
            )}
          >
            <Inbox className="size-3 shrink-0" strokeWidth={2.2} aria-hidden />
            <span>Carried over</span>
            <span className="rounded-sm bg-white/60 px-1 text-[10px] font-bold tabular-nums ring-1 ring-indigo-300/40">
              {carriedOverCount}
            </span>
          </button>
        );
      })()}
      <button
        type="button"
        onClick={() => {
          setSprintKanbanViewMode((m) => m === "epics" ? "stories" : "epics");
          setRoadmapBarMode("epics");
          onSummaryStatusQuickFilterChange?.(null);
        }}
        className={cn(
          summaryChipBaseClass,
          sprintKanbanViewMode === "epics" ? summaryChipEpicsOnClass : summaryChipEpicsIdleClass,
        )}
      >
        {sprintKanbanSummaryStats.epicCount} Epics
      </button>
      <button
        type="button"
        onClick={() => setSprintKanbanViewMode("stories")}
        className={cn(
          summaryChipBaseClass,
          sprintKanbanViewMode === "stories"
            ? summaryChipStoriesClass + " ring-1 ring-blue-300"
            : summaryChipStoriesClass,
        )}
      >
        <span className="truncate">{sprintKanbanSummaryStats.storyScheduledOnKanban}</span>
        <span className="hidden sm:inline">User Stories</span>
        <span className="sm:hidden">Stories</span>
      </button>
      {/* "Epic Estimated" + "User Stories Unscheduled" summary chips
       *  removed per planner request — both surfaced workspace-wide
       *  numbers next to per-sprint chips, which read as misleading.
       *  The epic-estimate coverage popover is still reachable from
       *  the dashboard hero's "Needs Attention" card. */}
    </>
  ) : null;

  // PDF export icon reserves ~32px + 4px gap at the right side of the panel-aligned search bar.
  const PDF_EXPORT_RESERVATION_PX = 36;
  const showGanttPdfExport = isFullYearGanttLayout || isQuarterGanttLayout;
  // Search/export anchor: Q4 panel in the all-quarters view, last-month panel in the single-quarter view.
  const searchAlignMetrics = isQuarterGanttLayout ? lastMonthPanelMetrics : quarter4PanelMetrics;
  const searchInputWidthPx = searchAlignMetrics
    ? Math.max(80, searchAlignMetrics.width - (showGanttPdfExport ? PDF_EXPORT_RESERVATION_PX : 0))
    : null;
  const ganttSearchJsx = (
    <div
      ref={ganttSearchRef}
      className={cn(
        "relative mr-1 flex shrink-0 items-center gap-1 transition-[margin] duration-200",
        !searchAlignMetrics && "ml-2",
      )}
      style={searchAlignMetrics ? { marginLeft: `${searchAlignMetrics.left}px` } : undefined}
      onBlur={(e) => { if (!ganttSearchRef.current?.contains(e.relatedTarget as Node)) setGanttSearchOpen(false); }}
    >
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2 z-10 size-3.5 text-slate-400" aria-hidden />
        <input
          ref={ganttSearchInputRef}
          type="text"
          value={ganttSearchQuery}
          onChange={(e) => { setGanttSearchQuery(e.target.value); setGanttSearchFilter(null); setGanttSearchOpen(true); }}
          onFocus={() => setGanttSearchOpen(true)}
          placeholder={roadmapBarMode === "initiatives" ? "Search initiatives…" : "Search epics…"}
          style={searchInputWidthPx != null ? { width: `${searchInputWidthPx}px` } : undefined}
          className={cn(
            "h-8 rounded-lg border border-slate-300 bg-white/80 pl-7 pr-6 text-[13.5px] text-slate-950 placeholder:text-slate-400 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 transition-[width] duration-200 shadow-[inset_0_2px_4px_-1px_rgba(15,23,42,0.12),inset_0_-1px_2px_-1px_rgba(15,23,42,0.06)]",
            !searchAlignMetrics && "w-[30rem] focus:w-[36rem]",
          )}
        />
        {(ganttSearchQuery || ganttSearchFilter) ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setGanttSearchQuery(""); setGanttSearchFilter(null); setGanttSearchOpen(false); }}
            className="absolute right-1.5 z-10 text-slate-400 hover:text-slate-600"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      {showGanttPdfExport ? (
        <button
          type="button"
          onClick={() => {
            const teamLabelMap = new Map(sprintTeamOptions.map((o) => [o.value, o.label]));
            exportYearGanttToPrintableWindow({
              initiatives,
              currentYear,
              // Match the on-screen Roadmap chip choice (Initiatives vs Epics bars) so the PDF mirrors what the user sees.
              roadmapBarMode,
              // Mirror the on-screen Roadmap progress chip — when off, the PDF stays clean (no progress overlay, no % meta).
              showProgress: showRoadmapProgress,
              // Carry the Gantt's team filter through so the PDF scopes to the same epics and labels them in the header.
              teamIds: ganttTeamIds,
              teamLabels: ganttTeamIds.map((id) => teamLabelMap.get(id) ?? id),
              // If the user has picked an initiative or epic via the Gantt search, scope the PDF to that pick.
              searchFilter: ganttSearchFilter,
              // When viewing a single quarter, scope the PDF to that quarter's 3 months (title, columns, eligible rows).
              focusedQuarter: isQuarterGanttLayout && focusedQuarter
                ? { label: focusedQuarter.label, months: [...focusedQuarter.months] }
                : null,
            });
          }}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-indigo-50/60 text-slate-500 transition-colors hover:border-indigo-300 hover:from-white hover:to-indigo-50 hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          aria-label="Export Gantt to PDF"
          title="Export Gantt to PDF (opens a presentation-ready view)"
        >
          <FileDown className="size-3.5" aria-hidden />
        </button>
      ) : null}
      {ganttSearchOpen && (ganttSearchResults.initiatives.length > 0 || ganttSearchResults.epics.length > 0) ? (
        /* Anchored to the RIGHT edge of the search field so the 34rem
         * panel grows leftward from there instead of off the right edge
         * of the viewport. This matters most in the All-Quarters view,
         * where the search sits far right and was being clipped. */
        <div className="absolute right-0 top-[calc(100%+4px)] z-[130] w-[34rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {ganttSearchResults.initiatives.length > 0 ? (
            <div>
              <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                {roadmapBarMode === "initiatives" ? "Initiatives" : "Show all epics from"}
              </p>
              {ganttSearchResults.initiatives.map(({ initiative: init, quarterLabels }) => {
                const health = ganttSearchInitiativeHealth(init, currentYear, progressBasis);
                return (
                  <button
                    key={init.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setGanttSearchFilter({ type: "initiative", id: init.id, label: init.title }); setGanttSearchQuery(init.title); setGanttSearchOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-950 hover:bg-slate-50"
                  >
                    <Zap className="size-3.5 shrink-0 text-violet-400" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{init.title}</span>
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1">
                      {quarterLabels.length > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200/80">
                          {quarterLabels.join(" · ")}
                        </span>
                      ) : null}
                      {health ? (
                        <HealthBadge status={health.status} tooltip={health.tooltip} />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {ganttSearchResults.epics.length > 0 ? (
            <div className={cn(ganttSearchResults.initiatives.length > 0 ? "border-t border-slate-100" : "")}>
              <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Epics</p>
              {ganttSearchResults.epics.map(({ epic, quarterLabels }) => {
                const health = ganttSearchEpicHealth(epic, currentYear, progressBasis);
                return (
                  <button
                    key={epic.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setGanttSearchFilter({ type: "epic", id: epic.id, label: epic.title }); setGanttSearchQuery(epic.title); setGanttSearchOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-950 hover:bg-slate-50"
                  >
                    <Folder className="size-3.5 shrink-0 text-indigo-400" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{epic.title}</span>
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1">
                      {quarterLabels.length > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200/80">
                          {quarterLabels.join(" · ")}
                        </span>
                      ) : null}
                      {health ? (
                        <HealthBadge status={health.status} tooltip={health.tooltip} />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  /** Slim chips-only row rendered ABOVE the breadcrumb header so the
   *  Health / Initiatives↔Epics / Teams / Sprints / Epic Est. controls
   *  sit on their own line instead of cramped beside the breadcrumb
   *  trail.
   *
   *  Sprint Kanban view always shows its toolbar regardless of the
   *  hero's open/closed state — the kanban depends on these controls
   *  (Health, viewMode toggles, Progress) for everyday navigation, so
   *  the "hide chips while the hero is open" rule that applies to the
   *  Gantt isn't a good fit here. The portal exception stays — if
   *  another surface is hosting the chip row, this one stays empty. */
  const isOnSprintKanbanSurface = sprintKanbanSummaryStats != null;
  const chipsToolbarRow = ((suppressInlineChips && !isOnSprintKanbanSurface) || summaryBarPortalElement)
    ? null
    : (
        <div className="-mt-2 mb-1 flex w-full min-w-0 shrink-0 flex-wrap items-center justify-end gap-5 bg-white px-5 py-1.5">
          {sprintKanbanSummaryStats ? summarySprintChipsJsx : summaryYearChipsJsx}
        </div>
      );

  const timelineHeaderRow = (
      <div
        className={cn(
          // Breadcrumb row spans full panel width. The panel root no
          // longer has horizontal padding, so the bar naturally
          // reaches both edges without negative-margin gymnastics.
          // Content padding (`pl-5 pr-4`) is on the bar itself.
          "relative z-30 mt-2 mb-5 w-full flex min-w-0 shrink-0 items-center gap-2 overflow-visible rounded-none border-y border-indigo-200 bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 py-2 pl-5 pr-4 shadow-[inset_8px_0_10px_-4px_rgba(165,180,252,0.18),inset_-8px_0_10px_-4px_rgba(165,180,252,0.18)] ring-0",
          useRoadmapGanttChipTrack && "min-w-0",
        )}
      >
        {hasBreadcrumbs ? (
          <div
            className={cn(
              "relative z-30 inline-flex shrink-0 items-center gap-1 py-0.5 pl-1.5 pr-1 outline-none",
              useRoadmapGanttChipTrack && !suppressInlineChips &&
                "pointer-events-auto absolute top-1/2 left-0 z-20 max-w-[min(55vw,20rem)] -translate-y-1/2 rounded-none border-0 bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 pr-1 shadow-none ring-0",
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
                    className="cursor-pointer whitespace-nowrap px-1 py-0.5 text-[15px] font-medium leading-snug tracking-[0.01em] text-slate-950 underline-offset-4 transition-colors hover:text-indigo-600 hover:underline"
                  >
                    {item.label}
                  </button>
                ) : (
                  <span
                    aria-current="page"
                    className={cn(
                      "whitespace-nowrap px-1 py-0.5 text-[15px] font-medium leading-snug tracking-[0.01em]",
                      item.currentTone === "sprint"
                        ? "text-indigo-700"
                        : "text-slate-800",
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
                <label className="group/teamlabel inline-flex items-center gap-2 rounded-md border-0 bg-transparent py-0.5 pl-1.5 pr-1 shadow-none">
                  <span className="text-[15px] font-medium leading-snug tracking-[0.01em] text-slate-950 transition-colors group-hover/teamlabel:text-indigo-600">Team</span>
                  <div className="group/trigger relative z-40" ref={sprintTeamMenuRef}>
                    <button
                      type="button"
                      onClick={() => setIsSprintTeamMenuOpen((prev) => !prev)}
                      className="inline-flex h-7 min-w-[8.75rem] items-center justify-between gap-1.5 rounded-md border border-slate-200 bg-white/70 px-1.5 text-[15px] font-medium leading-snug tracking-[0.01em] text-slate-800 outline-none transition hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300/70"
                      aria-label="Filter sprint views by team"
                      aria-expanded={isSprintTeamMenuOpen}
                    >
                      <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
                        {sprintFilterTeamIds.length === 0 ? (
                          <span className="inline-flex w-full items-center justify-between gap-1">
                            <Users className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                            <span className="truncate">All Teams</span>
                          </span>
                        ) : (
                          sprintFilterTeamIds.map((id) => {
                            const label = sprintTeamOptions.find((o) => o.value === id)?.label ?? id;
                            return (
                              <span
                                key={id}
                                className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0 text-[13px] font-medium text-slate-700 ring-1 ring-slate-200"
                              >
                                <TeamAvatar slug={id} sizePx={14} fallback={<Users className="size-3 shrink-0 opacity-70" aria-hidden />} />
                                <span className="truncate">{label}</span>
                              </span>
                            );
                          })
                        )}
                      </span>
                      <ChevronDown className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                    </button>
                    {sprintFilterTeamIds.length > 0 ? (
                      <button
                        type="button"
                        aria-label="Clear team filter"
                        title="Clear team filter"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setSprintFilterTeamIds([]); onSprintStoryBoardTeamChange?.(null); }}
                        className="pointer-events-none absolute inset-y-0 right-0 hidden items-center justify-center rounded-r-md px-1.5 text-slate-400 group-hover/trigger:pointer-events-auto group-hover/trigger:flex hover:text-rose-500"
                      >
                        <X className="size-3.5" />
                      </button>
                    ) : null}
                    {isSprintTeamMenuOpen ? (
                      <div className="absolute left-0 top-[calc(100%+0.3rem)] z-[120] w-full min-w-[11rem] rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                        <div className="px-1 pb-1">
                          <input
                            ref={sprintTeamSearchInputRef}
                            type="text"
                            value={sprintTeamSearch}
                            onChange={(e) => setSprintTeamSearch(e.target.value)}
                            placeholder="Search teams…"
                            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[13px] text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300/70"
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
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-slate-950 hover:bg-slate-100",
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
            {showGanttTeamPicker ? (
              <>
                <ChevronRight className="size-4 text-slate-400" aria-hidden />
                <label className="inline-flex items-center gap-2 rounded-md border-0 bg-transparent py-0.5 pl-1.5 pr-1 shadow-none">
                  <span className="text-[15px] font-medium leading-snug tracking-[0.01em] text-slate-950">Team</span>
                  <div className="group/trigger relative z-40" ref={ganttTeamMenuRef}>
                    <button
                      type="button"
                      onClick={() => setIsGanttTeamMenuOpen((prev) => !prev)}
                      className="inline-flex h-7 min-w-[8.75rem] items-center justify-between gap-1.5 rounded-md border border-slate-200 bg-white/70 px-1.5 text-[15px] font-medium leading-snug tracking-[0.01em] text-slate-800 outline-none transition hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300/70"
                      aria-label="Filter Gantt by team"
                      aria-expanded={isGanttTeamMenuOpen}
                    >
                      {/* Avatar + label live in their own inner flex so
                       *  the button's `justify-between` only pushes the
                       *  chevron to the right edge — without this, the
                       *  avatar got pinned to the far left and a fat
                       *  visual gap opened between the avatar and the
                       *  team name. Multi-select falls back to plain
                       *  text; stacking three avatars at 28px height
                       *  would be unreadable. */}
                      <span className="inline-flex min-w-0 items-center gap-[5px]">
                        {ganttTeamIds.length === 1 ? (
                          <TeamAvatar slug={ganttTeamIds[0]} sizePx={16} className="shrink-0" />
                        ) : null}
                        <span className="truncate">{ganttTeamLabel}</span>
                      </span>
                      <ChevronDown className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                    </button>
                    {ganttTeamIds.length > 0 ? (
                      <button
                        type="button"
                        aria-label="Clear team filter"
                        title="Clear team filter"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setGanttTeamIds([]); onGanttTeamFilterChange?.(new Set()); }}
                        className="pointer-events-none absolute inset-y-0 right-0 hidden items-center justify-center rounded-r-md px-1.5 text-slate-400 group-hover/trigger:pointer-events-auto group-hover/trigger:flex hover:text-rose-500"
                      >
                        <X className="size-3.5" />
                      </button>
                    ) : null}
                    {isGanttTeamMenuOpen ? (
                      <div className="absolute left-0 top-[calc(100%+0.3rem)] z-[120] w-full min-w-[11rem] rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                        <div className="px-1 pb-1">
                          <input
                            ref={ganttTeamSearchInputRef}
                            type="text"
                            value={ganttTeamSearch}
                            onChange={(e) => setGanttTeamSearch(e.target.value)}
                            placeholder="Search teams…"
                            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[13px] text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300/70"
                          />
                        </div>
                        {sprintTeamOptions.filter((o) => o.label.toLowerCase().includes(ganttTeamSearch.toLowerCase())).map((option) => {
                          const isAll = option.value === "all";
                          const checked = isAll ? ganttTeamIds.length === 0 : ganttTeamIds.includes(option.value);
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                console.log("[team-filter] gantt option clicked", {
                                  optionValue: option.value,
                                  optionLabel: option.label,
                                  isAll,
                                  wasChecked: checked,
                                  ganttTeamIdsBefore: ganttTeamIds,
                                  sprintFilterTeamIdsBefore: sprintFilterTeamIds,
                                  sprintStoryBoardTeamId,
                                  showGanttTeamPicker,
                                  showInsightsTeamPicker,
                                });
                                if (isAll) {
                                  setGanttTeamIds([]);
                                  onGanttTeamFilterChange?.(new Set());
                                } else {
                                  setGanttTeamIds((prev) => {
                                    const next = prev.includes(option.value)
                                      ? prev.filter((id) => id !== option.value)
                                      : [...prev, option.value];
                                    onGanttTeamFilterChange?.(new Set(next));
                                    return next;
                                  });
                                }
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-slate-950 hover:bg-slate-100",
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
                <label className="inline-flex items-center gap-2 rounded-md border-0 bg-transparent py-0.5 pl-1.5 pr-1 shadow-none">
                  <span className="text-[15px] font-medium leading-snug tracking-[0.01em] text-slate-950">Team</span>
                  <div className="group/trigger relative z-40" ref={insightsTeamMenuRef}>
                    <button
                      type="button"
                      onClick={() => setIsInsightsTeamMenuOpen((prev) => !prev)}
                      className="inline-flex h-7 min-w-[8.75rem] items-center justify-between gap-1.5 rounded-md border border-slate-200 bg-white/70 px-1.5 text-[13px] font-medium text-slate-800 outline-none transition hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300/70"
                      aria-label="Filter insights by team"
                      aria-expanded={isInsightsTeamMenuOpen}
                    >
                      <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
                        {insightsTeamIds.length === 0 ? (
                          <span className="inline-flex w-full items-center justify-between gap-1">
                            <Users className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                            <span className="truncate">All Teams</span>
                          </span>
                        ) : (
                          insightsTeamIds.map((id) => {
                            const label = sprintTeamOptions.find((o) => o.value === id)?.label ?? id;
                            return (
                              <span
                                key={id}
                                className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0 text-[13px] font-medium text-slate-700 ring-1 ring-slate-200"
                              >
                                <TeamAvatar slug={id} sizePx={14} fallback={<Users className="size-3 shrink-0 opacity-70" aria-hidden />} />
                                <span className="truncate">{label}</span>
                              </span>
                            );
                          })
                        )}
                      </span>
                      <ChevronDown className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                    </button>
                    {insightsTeamIds.length > 0 ? (
                      <button
                        type="button"
                        aria-label="Clear team filter"
                        title="Clear team filter"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setInsightsTeamIds([]); }}
                        className="pointer-events-none absolute inset-y-0 right-0 hidden items-center justify-center rounded-r-md px-1.5 text-slate-400 group-hover/trigger:pointer-events-auto group-hover/trigger:flex hover:text-rose-500"
                      >
                        <X className="size-3.5" />
                      </button>
                    ) : null}
                    {isInsightsTeamMenuOpen ? (
                      <div className="absolute left-0 top-[calc(100%+0.3rem)] z-[120] w-full min-w-[11rem] rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                        <div className="px-1 pb-1">
                          <input
                            ref={insightsTeamSearchInputRef}
                            type="text"
                            value={insightsTeamSearch}
                            onChange={(e) => setInsightsTeamSearch(e.target.value)}
                            placeholder="Search teams…"
                            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[13px] text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300/70"
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
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-slate-950 hover:bg-slate-100",
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
          useRoadmapGanttChipTrack && !suppressInlineChips ? (
            <div
              className="grid min-w-0 w-full max-w-full gap-2"
              style={ganttLaneGridStyle}
            >
              <div
                className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-3 sm:gap-4 md:gap-5"
                style={{ gridColumn: "1 / -1" }}
              >
                {/* Skip the inline chips when the parent has provided a
                    portal target — `summaryYearChipsJsx` is already being
                    rendered into `summaryBarPortalElement` below
                    (createPortal at the bottom of the component). Without
                    this guard the chips show twice: once here on the
                    Roadmap chip-track row and once up in the global top
                    bar. */}
                {/* chipsToolbarRow above renders these now — suppress here. */}
                {null}
                {showGanttSearch ? ganttSearchJsx : null}
                {periodCountdownScope ? (
                  <PeriodEndCountdown scope={periodCountdownScope} planYear={currentYear} index={periodCountdownIndex} />
                ) : null}
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "flex min-w-0 flex-wrap items-center justify-end gap-3 sm:gap-4 md:gap-5",
                hasBreadcrumbs ? "flex-1" : "w-full",
              )}
            >
              {/* chipsToolbarRow above renders these now — suppress here. */}
              {showGanttSearch ? ganttSearchJsx : null}
              {periodCountdownScope ? (
                <PeriodEndCountdown scope={periodCountdownScope} planYear={currentYear} index={periodCountdownIndex} />
              ) : null}
            </div>
          )
        ) : activeMonth ? (
          <div
            className={cn(
              "flex min-w-0 flex-wrap items-center justify-end gap-2 pr-2 sm:gap-2.5 md:gap-3",
              hasBreadcrumbs ? "flex-1" : "w-full",
            )}
          >
              {/* Sprint chip + status badge — rendered as siblings (no
               *  wrapping span) so they pick up the parent flex's gap and
               *  read as one continuous chip cluster with the Sprint-over /
               *  Move / Jump pills, not as a separate pair. */}
              {monthPlanTab === "sprint-status" && resolvedActiveYearSprint != null && sprintInsightsHealth ? (
                <button
                  type="button"
                  onClick={() => {
                    onMonthPlanTabChange?.("sprint-kanban");
                    setActiveSprintTab("kanban");
                  }}
                  title={`Open Sprint ${resolvedActiveYearSprint} Kanban`}
                  className="inline-flex h-7 max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-full bg-[aliceblue] px-2.5 text-[11px] font-semibold leading-none tracking-[0.02em] text-slate-800 ring-1 ring-sky-200 transition hover:bg-sky-100 hover:ring-sky-300 sm:gap-1.5 sm:px-3 sm:text-[12px]"
                >
                  <KanbanSquare className="size-3 shrink-0 text-indigo-500 sm:size-3.5" strokeWidth={2.25} aria-hidden />
                  <span className="truncate">S{resolvedActiveYearSprint} Board</span>
                </button>
              ) : null}
              {monthPlanTab === "sprint-status" && resolvedActiveYearSprint != null && sprintInsightsHealth ? (
                <HealthBadge
                  status={sprintInsightsHealth.status}
                  size="chip"
                  tooltip={`Sprint health · ${sprintInsightsHealth.daysLeft}d left / ${sprintInsightsHealth.estTotal}d est · ${sprintInsightsHealth.sprintDaysLeft}/${sprintInsightsHealth.sprintDaysTotal}d remaining in sprint`}
                />
              ) : null}
              {sprintKanbanSummaryStats ? (
                <>
                  {/* chipsToolbarRow above renders these now — suppress here. */}
                  {null}
                  {showSprintEndCountdown && activeYearSprintForMonthDrill != null ? (
                    <>
                      <SprintEndCountdown planYear={currentYear} yearSprint={activeYearSprintForMonthDrill} />
                      {sprintCloseActionChipsJsx}
                    </>
                  ) : periodCountdownScope ? (
                    <PeriodEndCountdown scope={periodCountdownScope} planYear={currentYear} index={periodCountdownIndex} />
                  ) : null}
                  {/* Search lands at the far right of the breadcrumb row,
                   *  after the Left / Move / Rolled in / Jump chip cluster,
                   *  so the planner can focus their attention from
                   *  navigation chips on the left → action chips on the
                   *  right → the search input as the final affordance. */}
                  <div
                    ref={sprintKanbanSearchRef}
                    className="relative flex items-center"
                    onMouseEnter={() => {
                      if (sprintKanbanSearchCloseTimer.current) clearTimeout(sprintKanbanSearchCloseTimer.current);
                    }}
                    onMouseLeave={() => {
                      sprintKanbanSearchCloseTimer.current = setTimeout(() => setSprintKanbanSearchOpen(false), 120);
                    }}
                    onBlur={(e) => {
                      if (!sprintKanbanSearchRef.current?.contains(e.relatedTarget as Node)) setSprintKanbanSearchOpen(false);
                    }}
                  >
                    <div className="group relative w-[18rem] max-w-full min-w-[14rem]">
                    <Search className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                    <input
                      type="text"
                      name="sprint-kanban-search"
                      value={sprintKanbanSearch}
                      onChange={(e) => { setSprintKanbanSearch(e.target.value); setSprintKanbanSearchOpen(true); }}
                      onFocus={() => sprintKanbanSearch && setSprintKanbanSearchOpen(true)}
                      onKeyDown={(e) => { if (e.key === "Escape") { setSprintKanbanSearch(""); setSprintKanbanSearchOpen(false); } }}
                      placeholder={sprintKanbanViewMode === "epics" ? "Search epics…" : "Search stories…"}
                      className="block h-7 w-full rounded-lg border border-slate-300 bg-white pl-7 pr-6 text-[12px] text-slate-800 placeholder:text-slate-400 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400/40 shadow-[inset_0_2px_4px_-1px_rgba(15,23,42,0.12),inset_0_-1px_2px_-1px_rgba(15,23,42,0.06)]"
                      aria-label="Search"
                      autoComplete="off"
                    />
                    {sprintKanbanSearch ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => { e.preventDefault(); setSprintKanbanSearch(""); setSprintKanbanSearchOpen(false); }}
                        className="absolute right-1.5 top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:text-slate-600 group-hover:opacity-100 group-focus-within:opacity-100"
                        aria-label="Clear search"
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                    </div>
                    {sprintKanbanSearchOpen && sprintKanbanSuggestions.length > 0 ? (
                      <div className="absolute right-0 top-full z-50 w-72 pt-1">
                        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
                            {sprintKanbanSuggestions.map((s, i) => (
                              <li key={`${s.kind}-${i}`} role="option">
                                <button
                                  type="button"
                                  tabIndex={0}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    setSprintKanbanSearch(s.label);
                                    setSprintKanbanSearchOpen(false);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-slate-50"
                                >
                                  {s.kind === "story" ? (
                                    <UserStoryIcon className="size-3.5 shrink-0 text-sky-500" />
                                  ) : s.kind === "epic" ? (
                                    <Folder className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                                  ) : (
                                    <Zap className="size-3.5 shrink-0 text-blue-500" aria-hidden />
                                  )}
                                  <span className="min-w-0 truncate text-slate-800">{s.label}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  {/* chipsToolbarRow above renders these now — suppress here. */}
                {null}
                  {/* Sprint-capacity / sprint-status / sprint-retrospective views still get the sprint clock in the breadcrumb area, even when sprintKanbanSummaryStats is null (kanban-only). */}
                  {showSprintEndCountdown && activeYearSprintForMonthDrill != null ? (
                    <>
                      <SprintEndCountdown planYear={currentYear} yearSprint={activeYearSprintForMonthDrill} />
                      {sprintCloseActionChipsJsx}
                    </>
                  ) : null}
                </>
              )}
              {showGanttSearch ? ganttSearchJsx : null}
          </div>
        ) : focusedQuarter ? (
          <div className="flex items-center gap-2">
            {showGanttSearch ? ganttSearchJsx : null}
            {periodCountdownScope ? (
              <PeriodEndCountdown scope={periodCountdownScope} planYear={currentYear} index={periodCountdownIndex} />
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {showGanttSearch ? ganttSearchJsx : null}
            {periodCountdownScope ? (
              <PeriodEndCountdown scope={periodCountdownScope} planYear={currentYear} index={periodCountdownIndex} />
            ) : null}
          </div>
        )}
      </div>
  );

  // All-quarters calendar header (Quarter banners + Month labels +
  // Sprint chips). Extracted as a JSX variable so it can be rendered
  // at the outer scroll container's direct child level inside a
  // `sticky top-0` wrapper — same DOM level as the all-quarters rail.
  // Sticky needs to live where the scroll container is the nearest
  // ancestor with no intermediate `overflow` wrapper blocking
  // resolution, which the original deep-nested location (inside the
  // hscroll wrapper) couldn't satisfy.
  const allQuartersCalendarHeaderJsx = isFullYearGanttLayout ? (() => {
    const realNow = new Date(clockNowMs());
    const todayMonth =
      realNow.getFullYear() === currentYear ? realNow.getMonth() + 1 : null;
    const quarterBg: Record<string, { idle: string; focused: string }> = {
      Q1: { idle: "bg-sky-50 hover:bg-sky-100", focused: "bg-sky-100 hover:bg-sky-200/70" },
      Q2: { idle: "bg-emerald-50 hover:bg-emerald-100", focused: "bg-emerald-100 hover:bg-emerald-200/70" },
      Q3: { idle: "bg-amber-50 hover:bg-amber-100", focused: "bg-amber-100 hover:bg-amber-200/70" },
      Q4: { idle: "bg-violet-50 hover:bg-violet-100", focused: "bg-violet-100 hover:bg-violet-200/70" },
    };
    return (
      <div className="relative z-[1] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_4px_18px_-6px_rgba(15,23,42,0.10),0_2px_6px_-3px_rgba(15,23,42,0.06)]">
        <div className="grid min-w-0" style={yearQuarterHeaderGridStyle}>
          {QUARTERS.map((quarter, qIdx) => {
            const isFocused = focusedQuarterLabel === quarter.label;
            const qBg = quarterBg[quarter.label];
            return (
              <button
                key={quarter.label}
                ref={quarter.label === "Q4" ? setQuarter4PanelRef : undefined}
                type="button"
                onClick={() => {
                  setFocusedMonth(null);
                  onFocusedQuarterChange(focusedQuarterLabel === quarter.label ? null : quarter.label);
                }}
                className={cn(
                  "relative flex w-full min-w-0 items-center justify-center gap-1.5 overflow-hidden py-3 text-center transition",
                  qIdx < QUARTERS.length - 1 && "border-r border-slate-200/80",
                  isFocused ? qBg.focused : qBg.idle,
                )}
                style={{ gridColumn: `span ${quarter.months.length} / span ${quarter.months.length}` }}
              >
                <BarChart3 className="size-[15px] text-indigo-700" strokeWidth={2.2} aria-hidden />
                <span className="text-[14px] font-semibold tracking-tight text-slate-800">
                  Quarter {quarter.label.slice(1)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative grid min-w-0 border-t border-slate-200/80" style={yearQuarterHeaderGridStyle}>
          {QUARTERS.flatMap((quarter) => {
            return quarter.months.map((month, mIdxInQ, allMonthsInQ) => {
              const isLastMonthOverall = quarter.label === "Q4" && mIdxInQ === allMonthsInQ.length - 1;
              return (
                <button
                  type="button"
                  key={`month-${month}`}
                  onClick={() => onFocusedQuarterChange(quarter.label)}
                  title={`Focus ${quarter.label}`}
                  className={cn(
                    "relative flex w-full min-w-0 cursor-pointer items-center justify-center px-1.5 py-3.5 text-center text-[12.5px] font-semibold tracking-tight text-slate-700 transition hover:bg-slate-50 hover:text-indigo-700 focus:outline-none focus-visible:bg-slate-50 focus-visible:text-indigo-700",
                    !isLastMonthOverall && "border-r border-slate-200/60",
                  )}
                >
                  {MONTHS[month - 1]}
                </button>
              );
            });
          })}
          {!showYearSprintChips && roadmapLaneTodayLeft != null && todayMonth != null ? (
            <div
              className="pointer-events-none absolute inset-y-0 z-10 flex items-center"
              style={{ left: roadmapLaneTodayLeft, transform: "translate(-50%, 10px)" }}
            >
              <button
                type="button"
                title="Jump to today's sprint kanban"
                onClick={() => {
                  const todaySprint = currentWorkYearSprintForPlan(currentYear);
                  if (todaySprint == null) return;
                  setFocusedMonth(todayMonth);
                  onEnterSprintStoryBoard?.(todaySprint, null);
                }}
                className="pointer-events-auto inline-flex items-center justify-center rounded bg-emerald-50/35 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-200/70 transition hover:bg-emerald-100 hover:shadow"
              >
                Today
              </button>
            </div>
          ) : null}
        </div>
        {showYearSprintChips ? (
          <div className="relative grid min-w-0 border-t border-slate-200/80 bg-white" style={yearQuarterHeaderGridStyle}>
            {QUARTERS.flatMap((quarter) => {
              return quarter.months.map((month) => {
                return (
                  <div
                    key={`sprint-month-${month}`}
                    className="grid grid-cols-2"
                  >
                    {([1, 2] as const).map((lane) => {
                      return (
                        <SprintPlanDropButton
                          key={`s-${month}-${lane}`}
                          month={month}
                          lane={lane}
                          title={sprintLabelYearRoadmap(globalSprintFromMonthLane(month, lane))}
                          onClick={() => {
                            if (isPostDragClickSuppressed()) return;
                            setFocusedMonth(month);
                            onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, lane), null);
                          }}
                          className="flex w-full items-center justify-center border-l-2 border-slate-200/60 px-1 py-1 text-center transition hover:-translate-y-px"
                        >
                          <span className="text-[11px] font-semibold leading-none tabular-nums tracking-tight text-slate-700">
                            S{globalSprintFromMonthLane(month, lane)}
                          </span>
                        </SprintPlanDropButton>
                      );
                    })}
                  </div>
                );
              });
            })}
            {roadmapLaneTodayLeft != null && todayMonth != null ? (
              <div
                className="pointer-events-none absolute inset-y-0 z-10 flex items-center"
                style={{ left: roadmapLaneTodayLeft, transform: "translate(-50%, -2px)" }}
              >
                <button
                  type="button"
                  title="Jump to today's sprint kanban"
                  onClick={() => {
                    const todaySprint = currentWorkYearSprintForPlan(currentYear);
                    if (todaySprint == null) return;
                    setFocusedMonth(todayMonth);
                    onEnterSprintStoryBoard?.(todaySprint, null);
                  }}
                  className="pointer-events-auto inline-flex items-center justify-center rounded bg-emerald-50/35 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-200/70 transition hover:bg-emerald-100 hover:shadow"
                >
                  Today
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  })() : null;

  // Single-quarter calendar header (Q title banner + Month labels +
  // Sprint cards). Same hoisting strategy as the all-quarters header
  // so CSS sticky can pin it to the outer scroller alongside the rail.
  const singleQuarterCalendarHeaderJsx = isQuarterGanttLayout && focusedQuarter ? (() => {
    const realNow = new Date(clockNowMs());
    const todayMonth =
      realNow.getFullYear() === currentYear ? realNow.getMonth() + 1 : null;
    const fq = focusedQuarter;
    const sprintBgTints: string[] = [
      "bg-sky-50",
      "bg-violet-50",
      "bg-emerald-50",
      "bg-amber-50",
      "bg-rose-50",
      "bg-indigo-50",
    ];
    return (
      <div className="relative z-[1] overflow-hidden rounded-md border border-slate-200 bg-white shadow-[0_4px_18px_-6px_rgba(15,23,42,0.10),0_2px_6px_-3px_rgba(15,23,42,0.06)]">
        <button
          type="button"
          onClick={() => {
            setFocusedMonth(null);
            onFocusedQuarterChange(null);
          }}
          className="relative flex w-full min-w-0 items-center justify-center gap-1.5 overflow-hidden bg-gradient-to-r from-blue-50/80 via-indigo-50/70 to-blue-50/80 py-2 text-center transition hover:from-blue-100/80 hover:via-indigo-100/70 hover:to-blue-100/80"
        >
          <BarChart3 className="size-[16px] text-indigo-700" strokeWidth={2.2} aria-hidden />
          <span className="text-[16px] font-semibold tracking-tight text-slate-800">
            Quarter {fq.label.slice(1)}
          </span>
        </button>
        <div
          className="relative grid min-w-0 border-t border-slate-200/80"
          style={{ gridTemplateColumns: `repeat(${visibleMonths.length}, minmax(0, 1fr))` }}
        >
          {visibleMonths.map((month, mIdx) => {
            const isLastMonthOverall = mIdx === visibleMonths.length - 1;
            return (
              <div
                key={`q-month-${month}`}
                ref={mIdx === visibleMonths.length - 1 ? setLastMonthPanelRef : undefined}
                className={cn(
                  "relative flex w-full min-w-0 items-center justify-center px-1.5 py-1.5 text-center text-[15px] font-semibold tracking-tight text-slate-800",
                  !isLastMonthOverall && "border-r border-slate-200/60",
                )}
              >
                {FULL_MONTHS[month - 1]}
              </div>
            );
          })}
        </div>
        <div
          className="relative grid min-w-0 gap-3 border-t border-slate-200/80 bg-white px-3 pb-3 pt-2"
          style={{ gridTemplateColumns: `repeat(${visibleMonths.length}, minmax(0, 1fr))` }}
        >
          {visibleMonths.map((month, mIdx) => {
            return (
              <div
                key={`q-sprint-month-${month}`}
                className="grid grid-cols-2 gap-3"
              >
                {([1, 2] as const).map((lane) => {
                  const lastDay = new Date(currentYear, month, 0).getDate();
                  const startDay = lane === 1 ? 1 : 16;
                  const endDay = lane === 1 ? 15 : lastDay;
                  const sprintPosInQuarter = mIdx * 2 + (lane - 1);
                  const sprintBg = sprintBgTints[sprintPosInQuarter % sprintBgTints.length];
                  return (
                    <SprintPlanDropButton
                      key={`q-s-${month}-${lane}`}
                      month={month}
                      lane={lane}
                      title={`${sprintLabelQuarterOrMonth(globalSprintFromMonthLane(month, lane))} (${sprintDateWeekdayRangeText(currentYear, month, lane)})`}
                      onClick={() => {
                        if (isPostDragClickSuppressed()) return;
                        setFocusedMonth(month);
                        onEnterSprintStoryBoard?.(globalSprintFromMonthLane(month, lane), null);
                      }}
                      className={cn(
                        "flex w-full flex-col items-center justify-center gap-0 rounded-md px-3 py-0 text-center ring-1 ring-slate-200/60 transition hover:-translate-y-px hover:shadow-[0_6px_14px_-6px_rgba(15,23,42,0.18)]",
                        sprintBg,
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5 leading-none">
                        <span
                          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100"
                          aria-hidden
                        >
                          <Flag className="size-[11px] text-slate-600" strokeWidth={2.2} />
                        </span>
                        <span className="text-[13.5px] font-semibold tracking-tight text-slate-700">
                          Sprint {globalSprintFromMonthLane(month, lane)}
                        </span>
                      </span>
                      <span className="text-[11px] font-medium leading-none tabular-nums text-slate-500">
                        {startDay}–{endDay} {MONTHS[month - 1]}
                      </span>
                    </SprintPlanDropButton>
                  );
                })}
              </div>
            );
          })}
          {roadmapLaneTodayLeft != null && todayMonth != null && visibleMonths.includes(todayMonth) ? (
            <div
              className="pointer-events-none absolute inset-y-0 z-10 flex items-center"
              style={{ left: roadmapLaneTodayLeft, transform: "translate(-50%, 14px)" }}
            >
              <button
                type="button"
                title="Jump to today's sprint kanban"
                onClick={() => {
                  const todaySprint = currentWorkYearSprintForPlan(currentYear);
                  if (todaySprint == null) return;
                  setFocusedMonth(todayMonth);
                  onEnterSprintStoryBoard?.(todaySprint, null);
                }}
                className="pointer-events-auto inline-flex items-center justify-center rounded bg-emerald-50/35 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-200/70 transition hover:bg-emerald-100 hover:shadow"
              >
                Today
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  })() : null;

  const planningSurface = (
      <div
        key={isInsightsSurfaceRender ? `insights-${activeMonth ?? "year"}-${focusedQuarterLabel ?? "all"}` : "planning-surface"}
        ref={timelineContentScrollRef}
        className={cn(
          // Explicit-height internal scroll. `max-height: calc(100dvh
          // - 18rem)` gives the planning surface a hard ceiling
          // independent of the surrounding flex chain — content past
          // that scrolls inside this element with a visible blue
          // scrollbar. Replaces the old flex-1 + `planning-surface-
          // scroll` (which hid the bar).
          // `overscroll-y-auto` lets the wheel scroll chain up to the
          // page once this inner area hits its top/bottom boundary.
          // `pl-2 pr-4` is on this surface (moved off the panel root
          // so the breadcrumb row can span full panel width). Left
          // padding dropped from `pl-5` → `pl-2` so the now-narrower
          // 36px rail sits closer to the panel edge — the old 20px
          // pre-rail gap read as wasted space.
          "flex min-h-0 flex-1 flex-col max-h-[calc(100dvh-18rem)] overflow-y-auto overscroll-y-contain pl-2 pr-4",
          // Pastel scrollbar matching the initiative panel's rail.
          "[scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:theme(colors.indigo.100)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gradient-to-b [&::-webkit-scrollbar-thumb]:from-sky-100 [&::-webkit-scrollbar-thumb]:via-indigo-100 [&::-webkit-scrollbar-thumb]:to-violet-100 hover:[&::-webkit-scrollbar-thumb]:from-sky-200 hover:[&::-webkit-scrollbar-thumb]:via-indigo-200 hover:[&::-webkit-scrollbar-thumb]:to-violet-200",
          showCapacityPlanningScrollbar && "min-w-0",
        )}
        data-gantt-scroll=""
      >
      {activeMonth ? (
        <div className="relative z-30 h-0">
          {/* Sprint mode renders 4 rail buttons (Board / Insights / Capacity
              / Retro), the default mode renders 2 (Epic Plan / Insights),
              so size the wrapper accordingly. */}
          <div
            className={cn(
              "absolute left-0 top-0 inline-flex flex-col justify-between gap-1 overflow-visible rounded-xl border border-slate-200/90 bg-white p-0.5 ring-1 ring-black/5 transition-[width,height] duration-200",
              isRailExpanded ? "w-56" : "w-[2.25rem]",
              activeSprint != null && (monthPlanTab === "sprint-kanban" || monthPlanTab === "sprint-status" || monthPlanTab === "sprint-capacity" || monthPlanTab === "sprint-retrospective")
                ? "h-[180px]"
                // Default month rail: 2 buttons now (Epic Plan + Insights).
                // Was 108px when Team Capacity was the middle tab — kept a
                // small breathing-room gap below the buttons.
                : "h-[84px]",
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
                    "group relative inline-flex h-9 w-full items-center overflow-visible transition",
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
                      isRailExpanded ? "max-w-[13rem] opacity-100" : "max-w-0 opacity-0",
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
                    "group relative inline-flex h-9 w-full items-center overflow-visible transition",
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
                      isRailExpanded ? "max-w-[13rem] opacity-100" : "max-w-0 opacity-0",
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
                  title="Capacity Planning"
                  onMouseEnter={() => setIsRailExpanded(true)}
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center overflow-visible transition",
              isRailExpanded ? "justify-start gap-2 px-2" : "justify-center px-0",
                    monthPlanTab === "sprint-capacity"
                      ? planRailTabActiveClass
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <Thermometer className="size-4" aria-hidden />
                  <span className="sr-only">Capacity Planning</span>
                  <span
                    aria-hidden
                    className={cn(
                      railLabelBaseClass,
                      isRailExpanded ? "max-w-[13rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Capacity Planning
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
                    "group relative inline-flex h-9 w-full items-center overflow-visible transition",
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
                      isRailExpanded ? "max-w-[13rem] opacity-100" : "max-w-0 opacity-0",
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
                    "group relative inline-flex h-9 w-full items-center overflow-visible transition",
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
                      isRailExpanded ? "max-w-[13rem] opacity-100" : "max-w-0 opacity-0",
                    )}
                  >
                    Epic Plan
                  </span>
                </button>
                {/* Month-view "Team Capacity" tab is parked — sprint and
                  * quarter planning cover team-capacity needs. Wrapped in a
                  * `false &&` so the code stays compiled and can be flipped
                  * back on by changing this guard. */}
                {false && (
                  <button
                    type="button"
                    onClick={() => onMonthPlanTabChange?.("month-capacity")}
                    title="Team Capacity"
                    onMouseEnter={() => setIsRailExpanded(true)}
                    className={cn(
                      "group relative inline-flex h-9 w-full items-center overflow-visible transition",
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
                        isRailExpanded ? "max-w-[13rem] opacity-100" : "max-w-0 opacity-0",
                      )}
                    >
                      Team Capacity
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onMonthPlanTabChange?.("month-status")}
                  title={monthInsightsLabel}
                  onMouseEnter={() => setIsRailExpanded(true)}
                  className={cn(
                    "group relative inline-flex h-9 w-full items-center overflow-visible transition",
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
                      isRailExpanded ? "max-w-[13rem] opacity-100" : "max-w-0 opacity-0",
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
        <div className="sticky top-0 z-40 h-0">
          <div
            className={cn(
              // Single-quarter rail height matches the Q + 3 months + 6
              // sprints panel above. Nudged a touch up.
              "absolute left-[-5px] top-0 inline-flex h-[131px] flex-col justify-between gap-1 overflow-visible rounded-lg rounded-r-none border border-r-0 border-slate-200/90 bg-white p-0.5 shadow-[-1px_0_0_rgba(0,0,0,0.05),0_-1px_0_rgba(0,0,0,0.05),0_1px_0_rgba(0,0,0,0.05),4px_0_8px_-2px_rgba(15,23,42,0.12)] transition-[width] duration-200",
              isRailExpanded ? "w-56" : "w-[38px]",
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
                "group relative inline-flex h-10 w-full items-center overflow-visible transition",
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
                  isRailExpanded ? "max-w-[13rem] opacity-100" : "max-w-0 opacity-0",
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
                "group relative inline-flex h-9 w-full items-center overflow-visible transition",
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
                  isRailExpanded ? "max-w-[13rem] opacity-100" : "max-w-0 opacity-0",
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
                "group relative inline-flex h-9 w-full items-center overflow-visible transition",
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
                  isRailExpanded ? "max-w-[13rem] opacity-100" : "max-w-0 opacity-0",
                )}
              >
                {quarterCapacityNode}
              </span>
            </button>
          </div>
        </div>
      ) : !activeMonth && !focusedQuarter ? (
        <div className="sticky top-0 z-40 h-0">
          <div
            className={cn(
              // Rail height tracks the Quarter + Months banner above (no
              // fixed pixel lock). 2 × h-10 buttons + p-0.5 + gap-1 lands
              // around the same height as Q+months without sprints.
              "absolute left-[-5px] top-0 inline-flex flex-col gap-1 overflow-visible rounded-lg rounded-r-none border border-r-0 border-slate-200/90 bg-white p-0.5 shadow-[-1px_0_0_rgba(0,0,0,0.05),0_-1px_0_rgba(0,0,0,0.05),0_1px_0_rgba(0,0,0,0.05),4px_0_8px_-2px_rgba(15,23,42,0.12)] transition-[width] duration-200",
              isRailExpanded ? "w-56" : "w-[2.75rem]",
            )}
            onMouseLeave={() => setIsRailExpanded(false)}
          >
            <button
              type="button"
              onClick={() => setQuarterViewTab("gantt")}
              title="Gantt"
              onMouseEnter={() => setIsRailExpanded(true)}
              className={cn(
                "group relative inline-flex h-[42px] w-full items-center overflow-visible transition",
              isRailExpanded ? "justify-start gap-2.5 px-2.5" : "justify-center px-0",
                quarterViewTab === "gantt"
                  ? planRailTabActiveClass
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <MapIcon className="size-5" aria-hidden />
              <span className="sr-only">Gantt</span>
              <span
                aria-hidden
                className={cn(
                  railLabelBaseClass,
                  isRailExpanded ? "max-w-[13rem] opacity-100" : "max-w-0 opacity-0",
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
                "group relative inline-flex h-[42px] w-full items-center overflow-visible transition",
              isRailExpanded ? "justify-start gap-2.5 px-2.5" : "justify-center px-0",
                quarterViewTab === "insights"
                  ? planRailTabActiveClass
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <Activity className="size-5" aria-hidden />
              <span className="sr-only">Portfolio Insights</span>
              <span
                aria-hidden
                className={cn(
                  railLabelBaseClass,
                  isRailExpanded ? "max-w-[13rem] opacity-100" : "max-w-0 opacity-0",
                )}
              >
                Portfolio Insights
              </span>
            </button>
          </div>
        </div>
      ) : null}
      {/* Sticky all-quarters calendar header — hoisted out of the
       *  hscroll wrapper so CSS `position: sticky` can resolve to the
       *  outer scroll container (same anchor the rail uses). Lives at
       *  the rail's level so both pin to the top together. `pl-11`
       *  clears the rail strip so Jan / Q1 aren't covered by the
       *  menu icons. */}
      {allQuartersCalendarHeaderJsx ? (
        <div className="sticky top-0 z-30 pl-11">
          {allQuartersCalendarHeaderJsx}
        </div>
      ) : null}
      {/* Sticky single-quarter calendar header — same hoist strategy
       *  as the all-quarters variant. Pins alongside the focused-
       *  quarter rail while the gantt body scrolls. `pl-10` pushes
       *  the header's content past the rail strip so the leftmost
       *  sprint card isn't covered by the menu icons. */}
      {singleQuarterCalendarHeaderJsx ? (
        <div className="sticky top-0 z-30 pl-10">
          {singleQuarterCalendarHeaderJsx}
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
            monthPlanTab === "sprint-kanban" && "flex w-full min-w-0 flex-col min-h-min pl-[2.75rem]",
            hasContextSideMenu && monthPlanTab !== "sprint-kanban" && "w-[calc(100%-2.75rem)] ml-[2.75rem]",
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
                      ? "min-h-[72rem]"
                      : "min-h-0",
                  ),
            )}
          >
            {monthPlanTab === "epic-gantt" && activeMonth != null ? (
              <div className="relative flex min-h-0 flex-1 flex-col px-0 pb-3 pt-0.5 sm:px-0 sm:pb-5 sm:pt-1">
                <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
                <div className="grid min-w-0 shrink-0" style={epicMonthGridStyle}>
                  <div className="col-span-2 mb-0">
                    {/* Calendar-style sprint header — single rounded card with
                        the two sprints as connected cells (shared border-r)
                        matching the all-quarters / single-quarter calendar
                        aesthetic. Sprint 1 → sky tint, Sprint 2 → indigo. */}
                    <div className="relative z-[1] overflow-hidden rounded-md border border-slate-200 bg-white shadow-[0_4px_6px_-2px_rgba(15,23,42,0.08),0_2px_4px_-2px_rgba(15,23,42,0.05)]">
                    <div className="grid min-w-0 grid-cols-2">
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
                        className="flex w-full min-w-0 flex-col items-center justify-center gap-0.5 border-r border-slate-200 bg-sky-50 px-2 py-1.5 text-center transition hover:bg-sky-200/70"
                      >
                        <div className="flex flex-col items-center gap-0 pb-0.5">
                          <span className="inline-flex items-center gap-1 text-[13px] font-semibold leading-tight text-sky-900">
                            <Flag className="size-3 shrink-0 opacity-70" aria-hidden />
                            {sprintLabelQuarterOrMonth(globalSprintFromMonthLane(activeMonth, 1))}
                          </span>
                          <span className="mt-0 max-w-full px-0.5 text-[11px] font-medium leading-tight text-slate-500">
                            ({sprintDateWeekdayRangeText(currentYear, activeMonth, 1)})
                          </span>
                        </div>
                        <div className="mt-3 flex w-full min-w-0">
                          {sprintDaysWithWeekday(currentYear, activeMonth, 1).map((dayLabel) => (
                            <span
                              key={dayLabel.key}
                              className="flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 border-l border-slate-200/80 bg-white/80 px-0.5 py-1.5 text-center first:border-l-0"
                            >
                              <span className="w-full truncate text-[12px] font-semibold leading-none text-slate-950">
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
                        className="flex w-full min-w-0 flex-col items-center justify-center gap-0.5 bg-indigo-50 px-2 py-1.5 text-center transition hover:bg-indigo-200/70"
                      >
                        <div className="flex flex-col items-center gap-0 pb-0.5">
                          <span className="inline-flex items-center gap-1 text-[13px] font-semibold leading-tight text-indigo-900">
                            <Flag className="size-3 shrink-0 opacity-70" aria-hidden />
                            {sprintLabelQuarterOrMonth(globalSprintFromMonthLane(activeMonth, 2))}
                          </span>
                          <span className="mt-0 max-w-full px-0.5 text-[11px] font-medium leading-tight text-slate-500">
                            ({sprintDateWeekdayRangeText(currentYear, activeMonth, 2)})
                          </span>
                        </div>
                        <div className="mt-3 flex w-full min-w-0">
                          {sprintDaysWithWeekday(currentYear, activeMonth, 2).map((dayLabel) => (
                            <span
                              key={dayLabel.key}
                              className="flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 border-l border-slate-200/80 bg-white/80 px-0.5 py-1.5 text-center first:border-l-0"
                            >
                              <span className="w-full truncate text-[12px] font-semibold leading-none text-slate-950">
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
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex w-full min-w-0">
                        {sprintDaysWithWeekday(currentYear, activeMonth, 1).map((_, i) => (
                          <DayDropCell key={i + 1} month={activeMonth} day={i + 1} />
                        ))}
                      </div>
                      <div className="flex w-full min-w-0">
                        {sprintDaysWithWeekday(currentYear, activeMonth, 2).map((_, i) => (
                          <DayDropCell key={i + 16} month={activeMonth} day={i + 16} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <MonthEpicDropArea month={activeMonth}>
                  <div className={cn("relative flex min-h-0 flex-1 flex-col px-0 pb-3 sm:px-0 sm:pb-4", monthEpicGanttTodayLeft != null && "pt-5 sm:pt-6")}>
                    {monthEpicGanttTodayLeft != null && (
                      <div className="pointer-events-none absolute inset-x-0 overflow-visible" style={{ top: "1px", height: "calc(100svh - 18rem)" }}>
                        <GanttTodayMarker
                          leftCss={monthEpicGanttTodayLeft}
                          showBadge={false}
                          badgePlacement="above"
                        />
                      </div>
                    )}
                    <div className="relative flex min-h-0 w-full basis-0 flex-1 flex-col overflow-hidden">
                      {roadmapBarMode === "initiatives" && ganttSearchAppliedMonthInitiativeRows.length === 0 ? (
                        <p className="sr-only">
                          No initiatives are planned in {MONTHS[activeMonth - 1]} yet. Plan epics from the initiative list
                          to fill this month.
                        </p>
                      ) : roadmapBarMode !== "initiatives" && ganttSearchAppliedMonthEpicRows.length === 0 ? (
                        <p className="sr-only">
                          No epics are planned in {MONTHS[activeMonth - 1]} yet. Drag an epic from the initiative list onto
                          this month.
                        </p>
                      ) : null}
                      <StripedGanttLaneScrollArea
                        id={TIMELINE_GANTT_ROWS_CONTAINER_ID}
                        columnCount={2}
                        rowGapClass="space-y-2"
                        noScrollbar
                      >
                        {roadmapBarMode === "initiatives" && ganttSearchAppliedMonthInitiativeRows.length === 0 ? (
                          <div className="h-0 shrink-0 overflow-hidden" aria-hidden />
                        ) : roadmapBarMode !== "initiatives" && ganttSearchAppliedMonthEpicRows.length === 0 ? (
                          <div className="h-0 shrink-0 overflow-hidden" aria-hidden />
                        ) : roadmapBarMode === "initiatives" ? (
                          ganttHealthFilteredMonthInitiativeRows.map((initiative, rowIndex) => {
                            // Compute initiative-level health using epics'
                            // own date bounds so the verdict is consistent
                            // with the all-quarters / single-quarter views.
                            const childStatuses: HealthStatus[] = [];
                            const aggregateStories = (initiative.epics ?? []).flatMap((e) => e.userStories ?? []);
                            for (const epic of initiative.epics ?? []) {
                              const v = computeEpicHealthVerdict(epic, currentYear, progressBasis);
                              if (v == null) continue;
                              childStatuses.push(v.status);
                            }
                            const initStart = sprintStartDate(currentYear, globalSprintFromMonthLane(activeMonth, 1));
                            const initEnd = sprintEndDate(currentYear, globalSprintFromMonthLane(activeMonth, 2));
                            const initiativeOriginalEstSum = (initiative.epics ?? []).reduce(
                              (sum, e) => sum + (e.originalEstimateDays ?? 0),
                              0,
                            );
                            const initHealth = computeInitiativeProgress({
                              stories: aggregateStories,
                              childStatuses,
                              start: initStart,
                              end: initEnd,
                              basis: progressBasis,
                              epicOriginalEstimateDays: initiativeOriginalEstSum > 0 ? initiativeOriginalEstSum : null,
                            });
                            const initTooltip = formatHealthTooltip(initHealth);
                            const initHasData = progressBasis === "stories" ? aggregateStories.length > 0 : initHealth.totalEffort > 0;
                            return (
                              <div
                                key={initiative.id}
                                className={cn(
                                  "border-b border-slate-200/50",
                                  // Zebra striping — matches the year and
                                  // single-quarter Gantt views.
                                  rowIndex % 2 === 1 && "bg-slate-100/55",
                                )}
                              >
                                <MonthInitiativeGanttLaneRow
                                  initiative={initiative}
                                  onOpenInitiative={onOpenInitiative}
                                  ganttLaneSortIndex={rowIndex}
                                  showProgress={showRoadmapProgress}
                                  healthStatus={showRoadmapProgress && initHasData ? initHealth.status : null}
                                  healthTooltip={initTooltip}
                                  effortProgressPercent={initHealth.progressPercent}
                                  teamAssignmentChip={showGanttTeamChips && initiative.team ? epicDeliveryTeamAssignmentChip(initiative.team) : null}
                                  planYear={currentYear}
                                  month={activeMonth}
                                />
                              </div>
                            );
                          })
                        ) : (
                          ganttHealthFilteredMonthEpicRows.map(({ epic, initiative }, rowIndex) => {
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
                            // Same health calc as year + quarter views so the
                            // popover counts and the bar's badge stay in sync.
                            // Shared verdict — uses each epic's own
                            // window (observed-or-planned) for consistency
                            // with every other surface that paints a
                            // verdict for this same epic.
                            const vM = computeEpicHealthVerdict(epic, currentYear, progressBasis);
                            const epicStoriesM = epic.userStories ?? [];
                            const epicHealthM = vM != null ? vM.result : computeProgress({
                              stories: epicStoriesM,
                              start: sprintStartDate(currentYear, globalSprintFromMonthLane(activeMonth, 1)),
                              end: sprintEndDate(currentYear, globalSprintFromMonthLane(activeMonth, 2)),
                              basis: progressBasis,
                              epicOriginalEstimateDays: epic.originalEstimateDays ?? null,
                            });
                            const epicStart = vM != null ? vM.start : sprintStartDate(currentYear, globalSprintFromMonthLane(activeMonth, 1));
                            const epicEnd = vM != null ? vM.end : sprintEndDate(currentYear, globalSprintFromMonthLane(activeMonth, 2));
                            const epicTooltipM = formatHealthTooltip(epicHealthM);
                            const epicHasDataM = progressBasis === "stories" ? epicStoriesM.length > 0 : epicHealthM.totalEffort > 0;
                            return (
                              <div
                                key={epic.id}
                                className={cn(
                                  "border-b border-slate-200/50",
                                  // Zebra striping — matches the other Gantt views.
                                  rowIndex % 2 === 1 && "bg-slate-100/55",
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
                                  healthStatus={showRoadmapProgress && epicHasDataM ? epicHealthM.status : null}
                                  healthTooltip={epicTooltipM}
                                  effortProgressPercent={epicHealthM.progressPercent}
                                  ganttLaneSortIndex={rowIndex}
                                  emphasize={emphasize}
                                  emphasizeTick={emphasizeTick}
                                  showProgress={showRoadmapProgress}
                                  teamAssignmentChip={showGanttTeamChips ? epicDeliveryTeamAssignmentChip(epic.team) : null}
                                  dimmed={isHighlightActive && !highlightedEpicIds!.has(epic.id)}
                                />
                              </div>
                            );
                          })
                        )}
                        {/* Unified-scroll: phantom padding rows removed —
                         *  the month-view lane now ends at the last real
                         *  row and the page scrollbar drives further
                         *  vertical movement. */}
                      </StripedGanttLaneScrollArea>
                      {(roadmapBarMode === "initiatives" && ganttSearchAppliedMonthInitiativeRows.length === 0) ||
                      (roadmapBarMode !== "initiatives" && ganttSearchAppliedMonthEpicRows.length === 0) ? (
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
                  progressBasis={progressBasis}
                  showHealthBadges={sprintKanbanShowHealth}
                  showTeamBadges={sprintKanbanShowTeams}
                  filterEpicTeamIds={sprintFilterTeamIds.length ? sprintFilterTeamIds : null}
                  workspaceDirectoryUsers={workspaceDirectoryUsers}
                  epicAccordionEmphasis={sprintEpicAccordionEmphasis}
                  scheduledStoriesEmphasis={sprintKanbanScheduledStoriesEmphasis}
                  viewMode={sprintKanbanViewMode}
                  showProgress={sprintKanbanShowProgress}
                  carriedOverOnly={sprintKanbanCarriedOverOnly}
                  searchQuery={sprintKanbanSearch}
                  sprintToolbarEnd={null}
                  onUnscheduleStory={(storyId) => onSprintCapacityStoryUnschedule?.(storyId)}
                  onRequestUnscheduleStory={onRequestSprintKanbanStoryUnschedule}
                  onOpenStory={onOpenStory ?? (() => {})}
                  onOpenEpic={onOpenEpic}
                  onPatchStory={onSprintKanbanStoryPatch}
                />
              </div>
            ) : monthPlanTab === "sprint-capacity" ? (
              <div className="p-3 sm:p-5">
                <SprintCapacityBoard
                  initiatives={initiatives}
                  month={sprintBoardContextMonth ?? activeMonth ?? 1}
                  yearSprint={resolvedActiveYearSprint ?? 1}
                  planYear={currentYear}
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
                    <div className="group/trigger relative inline-flex w-full min-w-[12rem] align-middle" ref={sprintTeamMenuRef}>
                      <button
                        type="button"
                        onClick={() => setIsSprintTeamMenuOpen((prev) => !prev)}
                        className="inline-flex h-7 w-full min-w-[9.25rem] items-center justify-between gap-2 overflow-hidden rounded-md border border-slate-200 bg-white px-2 text-[12px] font-medium text-slate-800 outline-none transition hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300/70"
                        aria-label="Filter sprint capacity by team"
                        aria-expanded={isSprintTeamMenuOpen}
                      >
                        <span
                          className="inline-flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:h-0"
                          style={{ scrollbarWidth: "none" }}
                        >
                          {sprintFilterTeamIds.length === 0 ? (
                            <span className="inline-flex w-full items-center justify-between gap-1">
                              <Users className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                              <span className="truncate">All Teams</span>
                            </span>
                          ) : (
                            sprintFilterTeamIds.map((id) => {
                              const label = sprintTeamOptions.find((o) => o.value === id)?.label ?? id;
                              return (
                                <span
                                  key={id}
                                  className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-100 px-1.5 py-0 text-[12px] font-medium text-slate-700 ring-1 ring-slate-200"
                                >
                                  <TeamAvatar slug={id} sizePx={14} fallback={<Users className="size-3 shrink-0 opacity-70" aria-hidden />} />
                                  <span className="truncate">{label}</span>
                                </span>
                              );
                            })
                          )}
                        </span>
                        <ChevronDown className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                      </button>
                      {sprintFilterTeamIds.length > 0 ? (
                        <button
                          type="button"
                          aria-label="Clear team filter"
                          title="Clear team filter"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); setSprintFilterTeamIds([]); onSprintStoryBoardTeamChange?.(null); }}
                          className="pointer-events-none absolute inset-y-0 right-0 hidden items-center justify-center rounded-r-md px-1.5 text-slate-400 group-hover/trigger:pointer-events-auto group-hover/trigger:flex hover:text-rose-500"
                        >
                          <X className="size-3.5" />
                        </button>
                      ) : null}
                      {isSprintTeamMenuOpen ? (
                        <div className="absolute left-0 top-[calc(100%+0.3rem)] z-[120] w-full min-w-[11rem] rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                          <div className="px-1 pb-1">
                            <input
                              ref={sprintTeamSearchInputRef}
                              type="text"
                              value={sprintTeamSearch}
                              onChange={(e) => setSprintTeamSearch(e.target.value)}
                              placeholder="Search teams…"
                              className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[13px] text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300/70"
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
                                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-slate-950 hover:bg-slate-100",
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
              (() => {
                // Pick which teams to render: explicit filter wins, otherwise every team from the menu (minus the "all" pseudo-option).
                const retroTeamIds = sprintFilterTeamIds.length > 0
                  ? sprintFilterTeamIds
                  : sprintTeamOptions.filter((o) => o.value !== "all").map((o) => o.value);
                const yearSprint = resolvedActiveYearSprint ?? activeSprint ?? firstGlobalSprintForMonth(activeMonth ?? 1);
                const sprintLabel = `Sprint ${yearSprint}`;
                // Single-team mode: render the editor directly without accordion chrome.
                if (retroTeamIds.length === 1) {
                  const teamId = retroTeamIds[0];
                  const teamLabel = sprintTeamOptions.find((o) => o.value === teamId)?.label ?? teamId;
                  const teamDoc = sprintRetrospectiveByTeam[teamId] ?? null;
                  return (
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                      <SprintRetrospectiveEditor
                        sprintLabel={sprintLabel}
                        teamName={teamLabel}
                        teamId={teamId}
                        workspaceDirectoryUsers={workspaceDirectoryUsers}
                        initialDoc={teamDoc}
                        updatedAt={teamDoc?.updatedAt ?? null}
                        onSave={(doc) => onSaveSprintRetrospective?.(doc, teamId)}
                        initiatives={initiatives}
                        planYear={currentYear}
                        yearSprint={yearSprint}
                        onOpenStory={onOpenStory}
                      />
                    </div>
                  );
                }
                // Multi-team: accordion list. Each team is collapsible; first one open by default.
                // When NO team filter is active ("All Teams"), render a
                // workspace-wide aggregate chart row at the top so the
                // planner can see Sprint X's totals across every team
                // (matches the kanban's All-Teams view). The aggregate
                // intentionally omits per-team retrospective text notes
                // (those only exist per team in the data model).
                const isAllTeams = sprintFilterTeamIds.length === 0;
                return (
                  <div className="flex min-h-0 flex-1 flex-col divide-y divide-slate-200/70 overflow-y-auto">
                    {isAllTeams && initiatives && currentYear != null ? (
                      <section className="bg-white/70 pb-2">
                        <header className="flex items-center gap-2 px-5 py-3 sm:px-7">
                          <span className="text-[15px] font-semibold text-slate-800">All Teams</span>
                          <span className="text-[12px] font-medium text-slate-400">· {sprintLabel}</span>
                          <span className="ml-auto text-[11px] text-slate-400">Workspace-wide aggregate</span>
                        </header>
                        <SprintRetrospectiveChartRow
                          initiatives={initiatives}
                          planYear={currentYear}
                          yearSprint={yearSprint}
                          team={null}
                        />
                      </section>
                    ) : null}
                    {retroTeamIds.map((teamId) => {
                      const teamOpt = sprintTeamOptions.find((o) => o.value === teamId);
                      const teamLabel = teamOpt?.label ?? teamId;
                      const teamDoc = sprintRetrospectiveByTeam[teamId] ?? null;
                      const isOpen = !retroCollapsedTeams.has(teamId);
                      const updatedAtText = teamDoc?.updatedAt ? new Date(teamDoc.updatedAt).toLocaleString() : null;
                      return (
                        <div key={teamId} className="min-w-0 shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleRetroTeam(teamId)}
                            className="flex w-full items-center gap-2 bg-white/70 px-5 py-3 text-left transition-colors hover:bg-slate-50 sm:px-7"
                            aria-expanded={isOpen}
                          >
                            {isOpen ? (
                              <ChevronDown className="size-4 shrink-0 text-slate-500" />
                            ) : (
                              <ChevronRight className="size-4 shrink-0 text-slate-500" />
                            )}
                            {teamOpt?.icon}
                            <span className="text-[15px] font-semibold text-slate-800">{teamLabel}</span>
                            <span className="text-[12px] font-medium text-slate-400">· {sprintLabel}</span>
                            <span className="ml-auto text-[11px] text-slate-400">
                              {updatedAtText ? `Last saved ${updatedAtText}` : "Not saved yet"}
                            </span>
                          </button>
                          {isOpen ? (
                            <SprintRetrospectiveEditor
                              sprintLabel={sprintLabel}
                              teamName={teamLabel}
                              teamId={teamId}
                              workspaceDirectoryUsers={workspaceDirectoryUsers}
                              initialDoc={teamDoc}
                              updatedAt={teamDoc?.updatedAt ?? null}
                              onSave={(doc) => onSaveSprintRetrospective?.(doc, teamId)}
                              initiatives={initiatives}
                              planYear={currentYear}
                              yearSprint={yearSprint}
                              onOpenStory={onOpenStory}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            ) : monthPlanTab === "month-status" ? (
              <DeferredMount placeholder={<MonthAnalyticsSkeleton />}>
                <div className="pt-0 pb-3 pl-1 pr-3 sm:pb-5 sm:pr-5">
                  <MonthAnalytics
                    initiatives={initiatives}
                    month={activeMonth}
                    planYear={currentYear}
                    filterEpicTeamIds={sprintFilterTeamIds.length ? sprintFilterTeamIds : null}
                    onOpenEpic={onOpenEpic}
                    onOpenInitiative={onOpenInitiative}
                    onOpenStory={onOpenStory ?? (() => {})}
                    onOpenSprintKanban={(yearSprint, teamId) =>
                      onEnterSprintStoryBoard?.(yearSprint, sprintStoryBoardEpicTeamFilter(teamId))
                    }
                    initialSelectedEpicId={initialInsightsScopeEpicId ?? undefined}
                    initialSelectedInitiativeId={initialInsightsScopeInitId ?? undefined}
                    onScopeChange={handleInsightsScopeChange}
                    workspaceDirectoryUsers={workspaceDirectoryUsers}
                    progressBasis={progressBasis}
                    onProgressBasisChange={onProgressBasisChange}
                  />
                </div>
              </DeferredMount>
            ) : (
              <div className="pt-0 pb-3 pl-1 pr-1 sm:pb-5 sm:pr-1">
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
                hasContextSideMenu && "w-[calc(100%-2.75rem)] ml-[2.75rem]",
              )}
            >
              <div
                className={cn(
                  "min-h-0 min-w-0 flex-1",
                  !panelHScroll &&
                    yearRoadmapHScroll &&
                    // Horizontal scroll only; vertical clips so the
                    // inner scroll container (StripedGanttLaneScrollArea)
                    // gets a definite height to overflow against.
                    "overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]",
                )}
              >
                <div
                  className={cn(
                    "flex min-h-0 min-w-0 flex-1 flex-col",
                    yearRoadmapHScroll && "w-max min-w-full",
                  )}
                  style={
                    yearRoadmapHScroll
                      ? { minWidth: portfolioRoadmapHScrollContentMinWidthPx }
                      : undefined
                  }
                >
                  {/* Invisible per-sprint drop targets — 6 cols matching the bar grid. */}
                  <div className="relative z-[1] grid min-w-0 gap-2" style={ganttLaneGridStyle}>
                    {visibleMonths.flatMap((month) =>
                      ([1, 2] as const).map((lane) => (
                        <SprintDropCell key={`q-d-${month}-${lane}`} month={month} lane={lane} />
                      )),
                    )}
                  </div>
                <div
                  className={cn(
                    "relative isolate flex min-h-0 flex-1 flex-col bg-slate-50/35 px-0 pb-3 sm:px-0 sm:pb-4",
                    "min-h-[calc(100vh-19rem)]",
                    roadmapLaneTodayLeft != null && "pt-5 sm:pt-6",
                  )}
                >
                  <GanttTodayMarker
                    leftCss={roadmapLaneTodayLeft}
                    showBadge={false}
                    badgePlacement="above"
                  />
                  <div
                    className="relative flex min-h-0 w-full basis-0 flex-1 flex-col"
                  >
                  {roadmapBarMode === "initiatives" ? (
                    ganttSearchAppliedQuarterInitiativeRows.length === 0 ? (
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
                        {ganttHealthFilteredQuarterInitiativeRows.map((group, idx) => (
                          <div
                            key={`q-init-row-${group.timelineRow}`}
                            className={cn(
                              "relative min-w-0 z-10 py-2.5",
                              // Zebra striping — same pattern as the
                              // all-quarters Gantt so single-quarter
                              // and year views read consistently.
                              idx % 2 === 1 && "bg-slate-100/55",
                              "border-b border-slate-200/50",
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
                                const initiativeStart = sprintStartDate(currentYear, row.startS);
                                const initiativeEnd = sprintEndDate(currentYear, row.endS);
                                // Shared verdict helper → quarter-view
                                // initiative rollups speak the same
                                // language as everything else.
                                const childStatuses = (row.initiative.epics ?? [])
                                  .map((epic) => computeEpicHealthVerdict(epic, currentYear, progressBasis)?.status)
                                  .filter((s): s is HealthStatus => s != null);
                                const aggregateStories = (row.initiative.epics ?? []).flatMap((e) => e.userStories ?? []);
                                const initiativeOriginalEstSum = (row.initiative.epics ?? []).reduce(
                                  (sum, e) => sum + (e.originalEstimateDays ?? 0),
                                  0,
                                );
                                const initHealth = computeInitiativeProgress({
                                  stories: aggregateStories,
                                  childStatuses,
                                  start: initiativeStart,
                                  end: initiativeEnd,
                                  basis: progressBasis,
                                  epicOriginalEstimateDays: initiativeOriginalEstSum > 0 ? initiativeOriginalEstSum : null,
                                });
                                const initiativeTooltip = formatHealthTooltip(initHealth);
                                const initHasData =
                                  progressBasis === "stories" ? aggregateStories.length > 0 : initHealth.totalEffort > 0;
                                return (
                                  <div
                                    key={`q-init-${row.initiative.id}`}
                                    className="relative min-w-0 rounded-lg pt-2 pb-2 z-20"
                                    style={{ gridColumn: `${columnStart} / span ${span}`, gridRow: 1 }}
                                  >
                                    <InitiativeTimelineBar
                                      id={row.initiative.id}
                                      title={row.initiative.title}
                                      icon={row.initiative.icon}
                                      color={row.initiative.color}
                                      progressPercent={initHealth.progressPercent}
                                      progressLabel={initiativeTooltip}
                                      showProgress={showRoadmapProgress}
                                      workflowStatus={
                                        showRoadmapProgress && lastPickedLabelLane === "status"
                                          ? deriveInitiativeStatusKey(row.initiative)
                                          : null
                                      }
                                      healthStatus={
                                        showRoadmapProgress &&
                                        initHasData &&
                                        lastPickedLabelLane !== "team" &&
                                        lastPickedLabelLane !== "status"
                                          ? initHealth.status
                                          : null
                                      }
                                      healthTooltip={initiativeTooltip}
                                      teamAssignmentChip={showGanttTeamChips && row.initiative.team ? epicDeliveryTeamAssignmentChip(row.initiative.team) : null}
                                      onClick={() => onOpenInitiative(row.initiative.id)}
                                      onDelete={onUnscheduleInitiative ? () => onUnscheduleInitiative(row.initiative.id) : undefined}
                                      onInsightsClick={() => (onOpenInsights ?? openInsightsTab)("initiative", row.initiative.id)}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                        {/* Unified-scroll: phantom quarter-initiative
                         *  padding rows removed. */}
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
                      {ganttHealthFilteredQuarterEpicRows.map((group, idx) => (
                        <div
                          key={`q-epic-row-${group.timelineRow}`}
                          className={cn(
                            "relative min-w-0 z-10 py-2.5",
                            // Zebra striping — matches the other Gantt views.
                            idx % 2 === 1 && "bg-slate-100/55",
                            "border-b border-slate-200/50",
                          )}
                          data-gantt-lane-index={idx}
                          data-gantt-timeline-row={group.timelineRow}
                        >
                          <GanttLaneSprintBackdrop columnCount={ganttLaneColumnCount} />
                          <div className="relative z-[1] grid min-w-0 gap-2" style={ganttLaneGridStyle}>
                            {group.items.map((row) => {
                              const qLo = firstGlobalSprintForMonth(focusedQuarter.months[0]);
                              const qHi = globalSprintFromMonthLane(focusedQuarter.months[focusedQuarter.months.length - 1], 2);
                              const isGhostOnlyRow = row.ghostOnly === true;
                              const rz = !isGhostOnlyRow && epicResizePreview?.epicId === row.epic.id ? epicResizePreview : null;
                              let previewStart = row.startS;
                              let previewEnd = row.endS;
                              if (isGhostOnlyRow) {
                                // Ghost-only row: span = sprint
                                // footprint of in-quarter OPEN stories.
                                // Already baked into row.startS / row.endS
                                // by the `quarterRoadmapEpics` memo via
                                // `epicQuarterFootprint`. previewStart/End
                                // just mirror that — no resize logic
                                // applies, no projected-end clamping
                                // needed.
                                previewStart = row.startS;
                                previewEnd = row.endS;
                              } else if (rz) {
                                if (rz.side === "right") previewEnd = Math.min(qHi, Math.max(row.startS, row.endS + rz.deltaSteps));
                                else previewStart = Math.max(qLo, Math.min(row.endS, row.startS + rz.deltaSteps));
                              }
                              // Clamp to the visible Q window so the
                              // cell only spans the VISIBLE portion of
                              // the plan. Without this, an epic whose
                              // plan starts BEFORE the focused Q (e.g.
                              // S6 → S9 viewed in Q2: qLo=7) computes
                              // span = 9-6+1 = 4 and the cell extends
                              // one column PAST where the plan ends —
                              // pushing the bar's right edge into the
                              // wrong sprint and inflating the ghost
                              // width (the ghost would visually end
                              // sprint-units further right than the
                              // late-story rule intends).
                              const visStartS = Math.max(previewStart, qLo);
                              const visEndS = Math.min(previewEnd, qHi);
                              const columnStart = Math.max(1, visStartS - qLo + 1);
                              const span = Math.max(visEndS - visStartS + 1, 1);
                              const epicStoriesQ = row.epic.userStories ?? [];
                              // Resize drag → use previewed window;
                              // normal render → shared verdict helper.
                              const epicHealthQ = rz != null
                                ? computeProgress({
                                    stories: epicStoriesQ,
                                    start: sprintStartDate(currentYear, previewStart),
                                    end: sprintEndDate(currentYear, previewEnd),
                                    basis: progressBasis,
                                    epicOriginalEstimateDays: row.epic.originalEstimateDays ?? null,
                                  })
                                : (computeEpicHealthVerdict(row.epic, currentYear, progressBasis)?.result
                                  ?? computeProgress({
                                    stories: epicStoriesQ,
                                    start: sprintStartDate(currentYear, previewStart),
                                    end: sprintEndDate(currentYear, previewEnd),
                                    basis: progressBasis,
                                    epicOriginalEstimateDays: row.epic.originalEstimateDays ?? null,
                                  }));
                              const epicHealthTooltipQ = formatHealthTooltip(epicHealthQ);
                              const epicHasDataQ =
                                progressBasis === "stories" ? epicStoriesQ.length > 0 : epicHealthQ.totalEffort > 0;
                              const epicLiveStatusQ = deriveEpicStatusKey(row.epic);
                              /** Preview-aware overdue — see year-roadmap branch. */
                              const isOverdueLiveQ =
                                epicLiveStatusQ !== "done" &&
                                epicLiveStatusQ !== null &&
                                clockNowMs() > sprintEndDate(currentYear, previewEnd).getTime();
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
                              const qDayAbs = isGhostOnlyRow ? null : quarterBarAbsoluteDayPct(row.epic, row.startS, span, currentYear);
                              const qInset = (isGhostOnlyRow || qDayAbs) ? null : epicBarDayInsetPct(row.epic, row.startS, row.endS, span, currentYear);
                              return (
                                <div
                                  key={`q-epic-${row.epic.id}`}
                                  ref={(node) => {
                                    if (node) barElsRef.current.set(row.epic.id, node);
                                    else barElsRef.current.delete(row.epic.id);
                                  }}
                                  className={cn("relative min-w-0 rounded-lg pt-2 pb-2", rz ? "z-0 opacity-70" : "z-20")}
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
                                    {isGhostOnlyRow ? (() => {
                                      // Ghost-only row: slipped epic whose
                                      // plan ended in a prior quarter but
                                      // whose work is still in flight here.
                                      // Render a clickable cell-wide ghost
                                      // with the epic title floated on
                                      // top + the slip icon at the right
                                      // edge. Clicking opens the epic
                                      // editor so the planner can extend
                                      // planEnd into this quarter.
                                      const meta = epicOverdueMeta(row.epic, currentYear);
                                      if (meta == null) return null;
                                      const severity: "amber" | "red" = meta.daysPastPlan > 7 ? "red" : "amber";
                                      // Tooltip's "projected to ship" line
                                      // must reflect only the IN-Q open
                                      // work (sum of daysLeft across the
                                      // stories that put this epic in the
                                      // visible footprint), not the
                                      // epic's full open backlog —
                                      // otherwise the number contradicts
                                      // the visible ghost width.
                                      const inQDaysLeft = row.ghostInQDaysLeft ?? meta.projectedDaysLeft;
                                      return (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => onOpenEpic(row.epic.id)}
                                            aria-label={`Open ${row.epic.title} (slipped from prior quarter)`}
                                            className="pointer-events-auto absolute z-[1] cursor-pointer rounded-sm"
                                            style={{ left: 0, top: 0, right: 0, height: 28 }}
                                          />
                                          <OverdueSlipDecoration
                                            severity={severity}
                                            ghostPct={0}
                                            daysPastPlan={meta.daysPastPlan}
                                            projectedDaysLeft={inQDaysLeft}
                                            compact
                                            fillMode="fill"
                                            label={row.epic.title}
                                          />
                                        </>
                                      );
                                    })() : (
                                      <>
                                        <EpicPlanTimelineBar
                                          id={row.epic.id}
                                          title={row.epic.title}
                                          icon={row.epic.icon}
                                          color={row.epic.color?.trim() ? row.epic.color : row.initiative.color}
                                          progressPercent={epicHealthQ.progressPercent}
                                          progressLabel={epicHealthTooltipQ}
                                          isResizing={Boolean(rz)}
                                          emphasizeFlash={emphasizeFlash}
                                          emphasizeTick={emphasizeTick}
                                          showProgress={showRoadmapProgress || healthFilter.size > 0}
                                          healthStatus={(showRoadmapProgress || healthFilter.size > 0) && epicHasDataQ && healthFilter.size > 0 ? epicHealthQ.status : null}
                                          healthTooltip={epicHealthTooltipQ}
                                          epicStatus={showRoadmapProgress && healthFilter.size === 0 ? epicLiveStatusQ : null}
                                          // See year-roadmap branch — Overdue lives in the health-
                                          // verdict pill exclusively, never alongside the status pill.
                                          isOverdue={false}
                                          // Border severity — same source of
                                          // truth as the banner.
                                          daysPastPlan={epicOverdueMeta(row.epic, currentYear)?.daysPastPlan ?? 0}
                                          onUnschedule={onUnscheduleEpic ? () => onUnscheduleEpic(row.epic.id) : undefined}
                                          onClick={() => onOpenEpic(row.epic.id)}
                                          onInsightsClick={() => (onOpenInsights ?? openInsightsTab)("epic", row.epic.id)}
                                          teamAssignmentChip={showGanttTeamChips ? epicDeliveryTeamAssignmentChip(row.epic.team) : null}
                                          dimmed={isHighlightActive && !highlightedEpicIds!.has(row.epic.id)}
                                        />
                                        {(() => {
                                          // Mirror of the year-roadmap branch above — same late-sprint rule.
                                          // The bar wrapper VISUALLY spans the visible Q
                                          // window (visStartS..visEndS), NOT the full
                                          // plan window. ghostPct is a percentage of the
                                          // wrapper's pixel width, so the math has to
                                          // use the same visual basis — otherwise the
                                          // ghost overshoots its sprint target (and the
                                          // slip icon ends up past `overflow-x-clip`).
                                          if (rz != null) return null;
                                          const meta = epicOverdueMeta(row.epic, currentYear);
                                          if (meta == null) return null;
                                          const wrapperStartMs = sprintStartDate(currentYear, visStartS).getTime();
                                          const wrapperEndMs = sprintEndDate(currentYear, visEndS).getTime();
                                          const wrapperVisualDays = Math.max(1, (wrapperEndMs - wrapperStartMs) / 86400000);
                                          const planEndGS = globalSprintFromMonthLane(
                                            row.epic.planEndMonth ?? 1,
                                            row.epic.planEndSprint === 1 ? 1 : 2,
                                          );
                                          const latestLateSprint = epicLatestLateSprint(row.epic, planEndGS);
                                          let ghostPct = 0;
                                          if (latestLateSprint != null) {
                                            const ghostEndMs = sprintEndDate(currentYear, latestLateSprint).getTime();
                                            const ghostExtraDays = Math.max(0, (ghostEndMs - wrapperEndMs) / 86400000);
                                            ghostPct = (ghostExtraDays / wrapperVisualDays) * 100;
                                          }
                                          const severity: "amber" | "red" = meta.daysPastPlan > 7 ? "red" : "amber";
                                          return (
                                            <OverdueSlipDecoration
                                              severity={severity}
                                              ghostPct={ghostPct}
                                              daysPastPlan={meta.daysPastPlan}
                                              projectedDaysLeft={meta.projectedDaysLeft}
                                            />
                                          );
                                        })()}
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
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {/* Unified-scroll: phantom quarter-epic padding
                       *  rows removed. */}
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
            // Unified-scroll: clip horizontally without forcing an inner
            // vertical scrollbar.
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip",
          hasContextSideMenu && "w-[calc(100%-2.75rem)] ml-[2.75rem]",
        )}
      >
        {activeMonth ? null : !focusedQuarter && quarterViewTab === "insights" ? (
          <DeferredMount placeholder={<MonthAnalyticsSkeleton />}>
            <MonthAnalytics
              initiatives={initiatives}
              month={1}
              periodMonths={MONTHS.map((_, i) => i + 1)}
              periodLabel="Year"
              planYear={currentYear}
              filterEpicTeamIds={insightsTeamIds.length ? insightsTeamIds : null}
              onOpenEpic={onOpenEpic}
              onOpenInitiative={onOpenInitiative}
              onOpenStory={onOpenStory ?? (() => {})}
              onOpenSprintKanban={(yearSprint, teamId) =>
                onEnterSprintStoryBoard?.(yearSprint, isKnownEpicTeamId(teamId) ? teamId : null)
              }
              initialSelectedEpicId={initialInsightsScopeEpicId ?? undefined}
              initialSelectedInitiativeId={initialInsightsScopeInitId ?? undefined}
              onScopeChange={handleInsightsScopeChange}
              workspaceDirectoryUsers={workspaceDirectoryUsers}
              progressBasis={progressBasis}
              onProgressBasisChange={onProgressBasisChange}
            />
          </DeferredMount>
        ) : activeMonth ? null : focusedQuarter && quarterViewTab === "insights" ? (
          <DeferredMount placeholder={<MonthAnalyticsSkeleton />}>
            <MonthAnalytics
              initiatives={initiatives}
              month={focusedQuarter.months[0]}
              periodMonths={[...focusedQuarter.months]}
              periodLabel={focusedQuarter.label}
              planYear={currentYear}
              filterEpicTeamIds={insightsTeamIds.length ? insightsTeamIds : null}
              onOpenEpic={onOpenEpic}
              onOpenInitiative={onOpenInitiative}
              onOpenStory={onOpenStory ?? (() => {})}
              onOpenSprintKanban={(yearSprint, teamId) =>
                onEnterSprintStoryBoard?.(yearSprint, isKnownEpicTeamId(teamId) ? teamId : null)
              }
              initialSelectedEpicId={initialInsightsScopeEpicId ?? undefined}
              initialSelectedInitiativeId={initialInsightsScopeInitId ?? undefined}
              onScopeChange={handleInsightsScopeChange}
              workspaceDirectoryUsers={workspaceDirectoryUsers}
              progressBasis={progressBasis}
              onProgressBasisChange={onProgressBasisChange}
            />
          </DeferredMount>
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
                "flex min-h-0 min-w-0 flex-1 flex-col",
                !panelHScroll &&
                  yearRoadmapHScroll &&
                  "overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]",
              )}
            >
              <div
                className={cn("flex min-h-0 min-w-0 flex-1 flex-col", yearRoadmapHScroll && "w-max")}
                style={
                  yearRoadmapHScroll
                    ? { minWidth: portfolioRoadmapHScrollContentMinWidthPx }
                    : undefined
                }
              >
                {/* Calendar-style header — connected table grid. Cells share
                    single-pixel borders, no gaps, no per-quarter tints. Q
                    cells span 3 months each; Today cell highlighted in
                    emerald with a ▼ pointer touching the today line below.
                    Rows 3 and 4 (sprints + drop targets) stay outside this
                    wrapper so they can keep gap-2 alignment with the bar
                    grid. */}
                <div
                  className={cn(
                    "relative",
                    yearRoadmapHScroll ? "w-max max-w-full" : "w-full",
                  )}
                >
                  {/* Row 4: invisible per-sprint drop targets — 24 cols matching the bar grid. */}
                  <div className="relative z-[1] grid min-w-0 gap-2 px-0.5" style={ganttLaneGridStyle}>
                    {QUARTERS.flatMap((quarter) =>
                      quarter.months.flatMap((month) =>
                        ([1, 2] as const).map((lane) => (
                          <SprintDropCell key={`d-${month}-${lane}`} month={month} lane={lane} />
                        ))
                      )
                    )}
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
    <div className="relative flex h-full min-h-0 min-w-0 w-full flex-col overflow-x-clip overflow-y-hidden rounded-xl border border-indigo-200 bg-card py-5 shadow-lg ring-1 ring-black/5">
      {/* Cross-mode highlight banner — appears when a dashboard widget
       *  (currently Portfolio Burndown's contributor popover) has set a
       *  highlight on the Roadmap. The banner names the filter (e.g.
       *  "3 epics behind plan") so the planner knows WHY the surrounding
       *  bars look faded, and the Clear button is the always-available
       *  way out. Inert when nothing has emitted a highlight — the slot
       *  collapses to zero height. */}
      {isHighlightActive && highlightLabel ? (
        <div className="mx-4 mb-2 mt-[-0.5rem] flex shrink-0 items-center justify-between gap-3 rounded-md border border-amber-200/80 bg-amber-50/85 px-3 py-1.5 text-[12px] font-medium text-amber-800 shadow-sm">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden>⚠</span>
            <span>Showing <span className="font-semibold tabular-nums">{highlightLabel}</span> — other epics dimmed</span>
          </span>
          {onClearHighlight ? (
            <button
              type="button"
              onClick={onClearHighlight}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900"
            >
              <span aria-hidden>×</span>
              <span>Clear</span>
            </button>
          ) : null}
        </div>
      ) : null}
      <div ref={yearRoadmapMeasureRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {panelHScroll ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]">
            <div
              className="flex min-h-0 min-w-0 w-max min-w-full flex-1 flex-col"
              style={panelScrollMinWidthPx != null ? { minWidth: panelScrollMinWidthPx } : undefined}
            >
              <div className="shrink-0 min-w-0">
                {chipsToolbarRow}
                {timelineHeaderRow}
              </div>
              {planningSurface}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0">
              {chipsToolbarRow}
              {timelineHeaderRow}
            </div>
            {planningSurface}
          </div>
        )}
      </div>
      {estEpicsPanelOpen ? (
        <div className="pointer-events-none fixed inset-0 z-[60]">
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
                      show: true,
                    },
                    {
                      id: "partiallyEstimated" as const,
                      label: "Partially estimated",
                      count: scopedEpicsForEstimatePanel.partiallyEstimated.length,
                      show: true,
                    },
                    {
                      id: "estimated" as const,
                      label: "Estimated epics",
                      count: scopedEpicsForEstimatePanel.estimated.length,
                      show: true,
                    },
                    {
                      id: "unscheduledStories" as const,
                      label: "Unscheduled stories",
                      count: scopedEpicsForEstimatePanel.unscheduledStories.length,
                      show: scopedEpicsForEstimatePanel.sprintCtx != null,
                    },
                    {
                      id: "epicsNoDesc" as const,
                      label: "Epics · no description",
                      count: scopedEpicsWithoutDescription.length,
                      show: true,
                    },
                    {
                      id: "storiesNoDesc" as const,
                      label: "Stories · no description",
                      count: scopedStoriesWithoutDescription.length,
                      show: true,
                    },
                  ] as const
                ).filter((tab) => tab.show).map((tab) => {
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
                      {tabHasActiveFilters("unestimated") ? (
                        <button
                          type="button"
                          onClick={() => clearTabFilters("unestimated")}
                          title="Clear all column filters"
                          className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-white/15 px-2 text-[11px] font-medium uppercase tracking-wide text-white ring-1 ring-white/30 transition hover:bg-white/25"
                        >
                          <X className="size-3.5" strokeWidth={2.2} aria-hidden />
                          Clear filters
                        </button>
                      ) : null}
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
                      {tabHasActiveFilters("estimated") ? (
                        <button
                          type="button"
                          onClick={() => clearTabFilters("estimated")}
                          title="Clear all column filters"
                          className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-white/15 px-2 text-[11px] font-medium uppercase tracking-wide text-white ring-1 ring-white/30 transition hover:bg-white/25"
                        >
                          <X className="size-3.5" strokeWidth={2.2} aria-hidden />
                          Clear filters
                        </button>
                      ) : null}
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
                ) : estimateCoveragePanelTab === "partiallyEstimated" ? (
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex shrink-0 items-center justify-between gap-2 bg-[#0897d5] px-3 py-2.5">
                      <p className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-white">
                        <BarChart3 className="size-4 shrink-0 text-white/90" strokeWidth={2.2} />
                        <span className="truncate">Partially estimated</span>
                        <InfoTooltip ariaLabel="What does 'Partially estimated' mean?">
                          <span className="block font-semibold text-slate-900">Epic has a top-line estimate, but at least one child story is still unsized.</span>
                          <span className="mt-1 block">Σ Child Est won&apos;t match Est days until every story is sized. Expand the epic row and fill in the 0d stories. The row then moves to Estimated.</span>
                        </InfoTooltip>
                      </p>
                      {tabHasActiveFilters("partiallyEstimated") ? (
                        <button
                          type="button"
                          onClick={() => clearTabFilters("partiallyEstimated")}
                          title="Clear all column filters"
                          className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-white/15 px-2 text-[11px] font-medium uppercase tracking-wide text-white ring-1 ring-white/30 transition hover:bg-white/25"
                        >
                          <X className="size-3.5" strokeWidth={2.2} aria-hidden />
                          Clear filters
                        </button>
                      ) : null}
                      <span
                        className="inline-flex h-6 shrink-0 items-center gap-0.5 px-0.5"
                        role="group"
                        aria-label="Partially estimated epics expand and collapse"
                      >
                        <button
                          type="button"
                          onClick={() => collapseEstimatePanelRows("partiallyEstimated")}
                          title="Collapse all rows"
                          aria-label="Collapse all partially-estimated epic rows"
                          className="inline-flex h-5 w-5 items-center justify-center text-white/90 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          <ChevronsUp className="size-3.5" strokeWidth={2.2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => expandEstimatePanelRows("partiallyEstimated")}
                          title="Expand all rows"
                          aria-label="Expand all partially-estimated epic rows"
                          className="inline-flex h-5 w-5 items-center justify-center text-white/90 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          <ChevronsDown className="size-3.5" strokeWidth={2.2} />
                        </button>
                      </span>
                    </div>
                    <div className="overflow-x-auto bg-white">
                      {renderEstimatePanelTable(scopedEpicsForEstimatePanel.partiallyEstimated, "partiallyEstimated")}
                    </div>
                  </section>
                ) : estimateCoveragePanelTab === "unscheduledStories" ? (
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex shrink-0 items-center gap-2 bg-[#0897d5] px-3 py-2.5">
                      <p className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-white">
                        <Inbox className="size-4 shrink-0 text-white/90" strokeWidth={2.2} />
                        <span className="truncate">
                          {scopedEpicsForEstimatePanel.sprintCtx
                            ? `Stories not on Sprint ${scopedEpicsForEstimatePanel.sprintCtx.yearSprint}`
                            : "Unscheduled stories"}
                        </span>
                      </p>
                    </div>
                    <div className="overflow-x-auto bg-white">
                      {renderStoriesWithoutDescriptionTable(
                        scopedEpicsForEstimatePanel.unscheduledStories,
                        scopedEpicsForEstimatePanel.sprintCtx
                          ? `Every team-filtered story is already on Sprint ${scopedEpicsForEstimatePanel.sprintCtx.yearSprint}.`
                          : "No unscheduled stories in this scope.",
                      )}
                    </div>
                  </section>
                ) : estimateCoveragePanelTab === "epicsNoDesc" ? (
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex shrink-0 items-center justify-between gap-2 bg-[#0897d5] px-3 py-2.5">
                      <p className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-white">
                        <FileWarning className="size-4 shrink-0 text-white/90" strokeWidth={2.2} />
                        <span className="truncate">Epics without description</span>
                      </p>
                      {tabHasActiveFilters("epicsNoDesc") ? (
                        <button
                          type="button"
                          onClick={() => clearTabFilters("epicsNoDesc")}
                          title="Clear all column filters"
                          className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-white/15 px-2 text-[11px] font-medium uppercase tracking-wide text-white ring-1 ring-white/30 transition hover:bg-white/25"
                        >
                          <X className="size-3.5" strokeWidth={2.2} aria-hidden />
                          Clear filters
                        </button>
                      ) : null}
                    </div>
                    <div className="overflow-x-auto bg-white">
                      {renderEstimatePanelTable(scopedEpicsWithoutDescription, "epicsNoDesc")}
                    </div>
                  </section>
                ) : (
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex shrink-0 items-center justify-between gap-2 bg-[#0897d5] px-3 py-2.5">
                      <p className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-white">
                        <FileWarning className="size-4 shrink-0 text-white/90" strokeWidth={2.2} />
                        <span className="truncate">User stories without description</span>
                      </p>
                      {tabHasActiveFilters("storiesNoDesc") ? (
                        <button
                          type="button"
                          onClick={() => clearTabFilters("storiesNoDesc")}
                          title="Clear all column filters"
                          className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-white/15 px-2 text-[11px] font-medium uppercase tracking-wide text-white ring-1 ring-white/30 transition hover:bg-white/25"
                        >
                          <X className="size-3.5" strokeWidth={2.2} aria-hidden />
                          Clear filters
                        </button>
                      ) : null}
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
      {summaryBarPortalElement ? createPortal(
        sprintKanbanSummaryStats ? summarySprintChipsJsx : summaryYearChipsJsx,
        summaryBarPortalElement
      ) : null}
      {rolledInModalSprint != null ? (
        <RolledInStoriesModal
          yearSprint={rolledInModalSprint}
          direction="in"
          rows={collectStoriesRolledIntoSprint(initiatives, rolledInModalSprint)}
          onClose={() => setRolledInModalSprint(null)}
          onOpenStory={onOpenStory}
        />
      ) : null}
      {rolledOutModalSprint != null ? (
        <RolledInStoriesModal
          yearSprint={rolledOutModalSprint}
          direction="out"
          rows={collectStoriesRolledOutOfSprint(initiatives, rolledOutModalSprint)}
          onClose={() => setRolledOutModalSprint(null)}
          onOpenStory={onOpenStory}
        />
      ) : null}
    </div>
  );
}
