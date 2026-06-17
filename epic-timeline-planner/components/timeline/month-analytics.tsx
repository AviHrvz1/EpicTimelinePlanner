"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Eraser,
  ExternalLink,
  BookOpen,
  Flag,
  Folder,
  Layers,
  TrendingUp,
  User,
  UserRound,
  Users,
  Zap,
  ListTodo,
  PieChart as PieChartIcon,
  PlayCircle,
  Target,
  UserX,
} from "lucide-react";
import { InsightsDrilldownModal } from "@/components/timeline/insights-drilldown-modal";
import { DrilldownFilterDropdown, DrilldownFilterInputText } from "@/components/timeline/insights-drilldown-filters";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceDot,
  ReferenceLine,
} from "recharts";

import { epicForBurndown, type EstimateSource } from "@/lib/epic-estimates";
import { buildQuarterBurndownSeries } from "@/lib/quarter-analytics";
import { buildBurnSeries } from "@/lib/burn-series";
import { EpicItem, InitiativeItem, StoryDailySnapshotItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MONTH_TEAM_COLUMNS, monthTeamLabelForId } from "@/lib/month-team-board";
import { clampYearSprint, epicEarliestQuarter, globalSprintFromMonthLane, monthLaneFromGlobalSprint, quarterOfMonth, sprintStartDate, sprintEndDate } from "@/lib/year-sprint";
import { computeProgress, computeInitiativeProgress, type HealthStatus, type ProgressBasis, type ProgressResult } from "@/lib/progress";
import { computeEpicObservedStart, effectiveEpicStart } from "@/lib/epic-observed-start";
import { computeEpicHealthVerdict } from "@/lib/epic-health";
import { computeStoryHealthVerdict, formatStoryHealthTooltip } from "@/lib/story-health";
import { nowMs as clockNowMs } from "@/lib/clock";
import { projectInitiativesToCloseDate } from "@/lib/story-snapshot-projection";
import { SnapshotHeaderStrip, type SnapshotHeaderStripScope } from "@/components/timeline/snapshot-header-strip";
import { ToggleGroup } from "@/components/timeline/basis-toggle-group";
import { HealthBadge, HealthBadgeWithDetail, HealthBadgeWithTextPopover, formatHealthTooltip } from "@/components/timeline/health-badge";
import { VerdictDistributionChip, type VerdictBuckets } from "@/components/timeline/verdict-distribution-chip";
import { UserAvatar, resolveAssigneeAvatar } from "@/components/ui/user-avatar";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { useTeamImages } from "@/lib/use-team-images";

type BurndownMetric = "daysLeft" | "storyCount";

/** Shift a date by N working days (Mon–Fri only). Used by the forecast
 *  computation: `forecastDate = dueDate + ceil(Δ) working days`.
 *  Positive `days` advance forward (team is behind plan → forecast slips
 *  later); negative `days` step backward (team is ahead → forecast pulls
 *  earlier than the plan due date). `days === 0` returns the input date. */
function addWorkingDays(start: Date, days: number): Date {
  const target = Math.ceil(Math.abs(days));
  if (target === 0) return new Date(start);
  const step = days >= 0 ? 1 : -1;
  const result = new Date(start);
  let moved = 0;
  while (moved < target) {
    result.setDate(result.getDate() + step);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) moved += 1;
  }
  return result;
}
type WorkloadStatusKey = "todo" | "inProgress" | "review" | "done";
type WorkloadFilterKey = "all" | WorkloadStatusKey | "unassigned";

const STATUS_COLORS: Record<string, string> = {
  Unscheduled: "#94a3b8",
  "To do": "#f59e0b",
  "In progress": "#3b82f6",
  "Review / Testing": "#8b5cf6",
  Done: "#10b981",
};

// Labels MUST match the bar dataKey strings used in the chart data (see workload barData below).
// Order defines the on-screen left-to-right bar order: To do → In progress → Review/Testing → Done.
const WORKLOAD_BAR_SEGMENTS = [
  { key: "todo" as const, label: "To do", color: STATUS_COLORS["To do"] },
  { key: "inProgress" as const, label: "In progress", color: STATUS_COLORS["In progress"] },
  { key: "review" as const, label: "Review / Testing", color: STATUS_COLORS["Review / Testing"] },
  { key: "done" as const, label: "Done", color: STATUS_COLORS["Done"] },
] as const;

const CFD_FLOW_SEGMENTS = [
  { key: "done" as const, label: "Done", color: STATUS_COLORS["Done"] },
  { key: "review" as const, label: "Review / Testing", color: STATUS_COLORS["Review / Testing"] },
  { key: "inProgress" as const, label: "In progress", color: STATUS_COLORS["In progress"] },
  { key: "todo" as const, label: "To do", color: STATUS_COLORS["To do"] },
] as const;

/** Small circular progress indicator — mirrors the one on the
 *  RoadmapHealthHero's Team Progress card so the two surfaces read with
 *  the same visual vocabulary. Renders a 28×28 SVG ring with the
 *  rounded percentage at the center; stroke color follows the row's
 *  health tone. */
function CircleProgress({
  percent,
  color,
}: {
  percent: number;
  color: string;
}) {
  // Circular (rx === ry) so the percent ring reads as a true round
  // donut. The math + rotate(-90) trick still works the same way
  // either circle or ellipse — the ellipse-perimeter formula
  // collapses to `2 * π * r` when rx === ry.
  const rx = 14;
  const ry = 14;
  const h = ((rx - ry) ** 2) / ((rx + ry) ** 2);
  const circumference = Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const clamped = Math.max(0, Math.min(100, percent));
  const dashOffset = circumference * (1 - clamped / 100);
  return (
    <svg width={34} height={32} viewBox="0 -2 34 32" aria-hidden>
      <ellipse cx={17} cy={14} rx={rx} ry={ry} fill="none" stroke="#e2e8f0" strokeWidth={2.4} transform="rotate(-90 17 14)" />
      <ellipse
        cx={17}
        cy={14}
        rx={rx}
        ry={ry}
        fill="none"
        stroke={color}
        strokeWidth={2.4}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform="rotate(-90 17 14)"
      />
      <text x={17} y={16} textAnchor="middle" fontSize={8} fontWeight={700} fill="#475569">
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}

function WorkloadXAxisTick({
  x,
  y,
  payload,
  teamMode,
  avatarByFirstName,
  teamImageByLabel,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  teamMode: boolean;
  /** Map keyed by the X-axis label (first name) → uploaded image URL. When
   *  present, the tick swaps the generic UserRound for the photo. Mirrors
   *  the same prop on sprint-analytics' WorkloadXAxisTick. */
  avatarByFirstName?: Map<string, string | null>;
  /** Team-mode equivalent: label → team logo URL. Falls back to the generic
   *  Users glyph when the team has no logo. */
  teamImageByLabel?: Map<string, string | null>;
}) {
  if (x == null || y == null) return null;
  const label = payload?.value ?? "";
  // User photos benefit from being readable (22px); team glyphs/logos
  // overpower the axis at that size, so they get a tighter 16px puck.
  const iconSize = teamMode ? 16 : 22;
  const rowY = y + iconSize / 2 + 3;
  // Left-align the icon + text under the LEFT EDGE of the bar group instead
  // of centering on the category. The category's center is `x`; with 4
  // grouped bars at maxBarSize=14 and barGap=2, the group width is
  // 4*14 + 3*2 = 62 px, so the left edge sits ~31 px left of x. We use a
  // slightly conservative 28 px so the tick still aligns when bars shrink
  // below max in narrow charts.
  const iconX = x - 28;
  const textStartX = iconX + iconSize + 4;
  const photoUrl = teamMode
    ? teamImageByLabel?.get(label) ?? null
    : avatarByFirstName?.get(label) ?? null;
  // Label may contain spaces / dots (e.g. "John S.") which break SVG ID
  // references — sanitize before embedding into the clipPath id/url.
  const safeId = label.replace(/\W+/g, "-");
  const clipId = `workload-month-avatar-clip-${safeId}`;
  return (
    <g>
      {photoUrl ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <circle cx={iconX + iconSize / 2} cy={rowY} r={iconSize / 2} />
            </clipPath>
          </defs>
          <image
            href={photoUrl}
            x={iconX}
            y={rowY - iconSize / 2}
            width={iconSize}
            height={iconSize}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
          />
        </>
      ) : (
        (() => {
          const Icon = teamMode ? Users : UserRound;
          return <Icon x={iconX} y={rowY - iconSize / 2} width={iconSize} height={iconSize} color="#94a3b8" strokeWidth={2} />;
        })()
      )}
      <text x={textStartX} y={rowY + 1} textAnchor="start" fill="#64748b" fontSize={11} dominantBaseline="middle">
        {label}
      </text>
    </g>
  );
}

const SPRINT_CHART_BOX =
  "h-[clamp(12.5rem,27vh,20rem)] min-h-[12.5rem] w-full";
const INSIGHTS_CONTENT_HEIGHT = "h-[clamp(12.5rem,27vh,20rem)] min-h-[12.5rem]";
/** Same height as {@link INSIGHTS_CONTENT_HEIGHT} but won’t flex-grow (pairs Workload + Cumulative Flow). */
const INSIGHTS_CHART_BAND = cn(INSIGHTS_CONTENT_HEIGHT, "shrink-0");
const INSIGHTS_HEADER_ROW = "min-h-9";
/** Card frame for drilldown tables only (charts are unframed). */
const INSIGHTS_CHART_FRAME =
  "rounded-lg border border-slate-200/80 bg-white/90 p-2 ring-1 ring-slate-200/50";
/** Primary + legend columns inside a framed chart (no extra pl-*; frame supplies inset). */
const INSIGHTS_CHART_GRID_GAP = "gap-3";
/** Scrollable main column (plot list / burndown legend body). */
const INSIGHTS_SCROLL_MAIN =
  "h-full min-h-0 space-y-1 overflow-y-auto overflow-x-hidden pr-5 [&::-webkit-scrollbar]:hidden";
/** Scrollable side column (legends, workload filters); same cap and edge as other columns. */
const INSIGHTS_SCROLL_SIDE =
  "max-h-[clamp(12.5rem,27vh,20rem)] min-h-0 space-y-1 overflow-y-auto pr-5 [&::-webkit-scrollbar]:hidden";
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const LINE_PALETTE = ["#2563eb", "#0d9488", "#7c3aed", "#ea580c", "#14b8a6", "#be185d", "#0284c7"];

/** Sortable column keys for the drilldown stories tables (workload / month
 *  load / status pie). All three tables share the same column set so the
 *  sort/filter helpers are shared too. */
type DrilldownSortKey = "id" | "title" | "sprint" | "assignee" | "status";
/** Same idea but for the Epic Progress drilldown — replaces "sprint" with
 *  "initiative" since epics belong to initiatives, not sprints. */
type EpicDrilldownSortKey = "id" | "title" | "initiative" | "assignee" | "status";
interface EpicDrilldownFilter {
  title: string;
  initiative: string | null;
  assignee: string | null;
  status: string | null;
  /** Sprint-burndown / epic health verdict — picks the matching
   *  `HealthStatus` value or `null` for "show all". Same one the
   *  Hero Health Distribution donut + backlog Health column use. */
  health: HealthStatus | null;
}
const EMPTY_EPIC_DRILLDOWN_FILTER: EpicDrilldownFilter = {
  title: "",
  initiative: null,
  assignee: null,
  status: null,
  health: null,
};
const EPIC_STATUS_RANK: Record<string, number> = {
  Unscheduled: 0,
  "To do": 1,
  "In progress": 2,
  Done: 3,
  Approved: 4,
};

/** Filter + sort an epic drilldown list. Shape mirrors `applyDrilldownFilterSort`
 *  but operates on epic rows + an epic-status / initiative-title lookup. */
function applyEpicDrilldownFilterSort<T extends { id: string; title: string; assignee?: string | null }>(
  rows: T[],
  filter: EpicDrilldownFilter,
  sort: { key: EpicDrilldownSortKey; dir: "asc" | "desc" } | null,
  epicDisplayId: (epicId: string) => string,
  initiativeTitle: (epicId: string) => string,
  epicStatusLabel: (epicId: string) => string,
): T[] {
  const titleQ = filter.title.trim().toLowerCase();
  let filtered = rows;
  if (titleQ) filtered = filtered.filter((r) => r.title.toLowerCase().includes(titleQ));
  // Initiative / Assignee use case-insensitive substring — same reason
  // as the story-drilldown helper above (search-as-you-type in the
  // dropdown pushes typed queries straight into the filter).
  const initiativeQ = filter.initiative?.trim().toLowerCase();
  if (initiativeQ) filtered = filtered.filter((r) => initiativeTitle(r.id).toLowerCase().includes(initiativeQ));
  const assigneeQ = filter.assignee?.trim().toLowerCase();
  if (assigneeQ) filtered = filtered.filter((r) => (r.assignee?.trim() || "Unassigned").toLowerCase().includes(assigneeQ));
  // Status is categorical (no search input) — exact match.
  if (filter.status != null) filtered = filtered.filter((r) => epicStatusLabel(r.id) === filter.status);
  if (!sort) return filtered;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    switch (sort.key) {
      case "id":
        return epicDisplayId(a.id).localeCompare(epicDisplayId(b.id), undefined, { numeric: true }) * dir;
      case "title":
        return a.title.localeCompare(b.title) * dir;
      case "initiative":
        return initiativeTitle(a.id).localeCompare(initiativeTitle(b.id)) * dir;
      case "assignee":
        return (a.assignee ?? "").localeCompare(b.assignee ?? "") * dir;
      case "status":
        return ((EPIC_STATUS_RANK[epicStatusLabel(a.id)] ?? 99) - (EPIC_STATUS_RANK[epicStatusLabel(b.id)] ?? 99)) * dir;
      default:
        return 0;
    }
  });
}

/** Per-column filter state for the drilldown tables. Empty/null means
 *  "show all". `title` is a substring match; the others are exact match. */
interface DrilldownFilter {
  title: string;
  sprint: string | null;
  team: string | null;
  assignee: string | null;
  status: string | null;
  /** Sprint-burndown health verdict per story. Same `HealthStatus`
   *  values the rest of the app uses; `null` means "show all". */
  health: HealthStatus | null;
}

/** Cheap "is this drilldown narrowed by any column filter" probe. Used
 *  by the tbody renderers to force-expand every epic accordion when a
 *  filter is on — otherwise the planner picks a story-level value
 *  (e.g. story assignee "Alice"), the matching story group is created,
 *  but the epic header (showing the epic's own assignee) stays
 *  collapsed and visually reads as "no match". */
function isDrilldownFilterActive(f: DrilldownFilter): boolean {
  return (
    f.title.trim().length > 0
    || f.sprint != null
    || f.team != null
    || f.assignee != null
    || f.status != null
    || f.health != null
  );
}

function isEpicDrilldownFilterActive(f: EpicDrilldownFilter): boolean {
  return (
    f.title.trim().length > 0
    || f.initiative != null
    || f.assignee != null
    || f.status != null
    || f.health != null
  );
}

const EMPTY_DRILLDOWN_FILTER: DrilldownFilter = {
  title: "",
  sprint: null,
  team: null,
  assignee: null,
  status: null,
  health: null,
};

/** Shared options + renderer for the Health column filter dropdown
 *  across the drill-down tables. Each option is a (id, label) pair
 *  the existing `DrilldownFilterDropdown` API expects. The "Any"
 *  case is handled by the dropdown itself when value is null. */
const HEALTH_FILTER_OPTIONS: string[] = [
  "done",
  "onTrack",
  "watch",
  "atRisk",
  "overdue",
];
const HEALTH_FILTER_LABELS: Record<string, string> = {
  done: "Done",
  onTrack: "On Track",
  watch: "Watch",
  atRisk: "At Risk",
  overdue: "Overdue",
};
function renderHealthFilterOption(value: string): React.ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 truncate">
      {HEALTH_FILTER_LABELS[value] ?? value}
    </span>
  );
}

/** Order used when sorting by status — todo first, done last — so the
 *  ascending direction reads as "earliest in the workflow first". */
const STORY_STATUS_RANK: Record<string, number> = {
  todo: 0,
  inProgress: 1,
  review: 2,
  done: 3,
};

/**
 * Filter + sort a drilldown stories list by the user's per-column filters
 * and active column sort. When sort is null the rows fall back to their
 * input order (caller's existing sort, e.g. title ASC).
 */
function applyDrilldownFilterSort<T extends { id: string; title: string; sprint: number | null; assignee?: string | null; status: string }>(
  rows: T[],
  filter: DrilldownFilter,
  sort: { key: DrilldownSortKey; dir: "asc" | "desc" } | null,
  storyDisplayId: (storyId: string) => string,
  sprintLabel: (sprint: number | null) => string,
  teamLabel?: (storyId: string) => string,
): T[] {
  const titleQ = filter.title.trim().toLowerCase();
  let filtered = rows;
  if (titleQ) filtered = filtered.filter((r) => r.title.toLowerCase().includes(titleQ));
  // Sprint / Team / Assignee filters use case-insensitive substring
  // match so the dropdown's search box can push typed-but-unpicked
  // queries directly into the table filter. Picking an option from the
  // dropdown sets the exact label, which substring-matches itself.
  const sprintQ = filter.sprint?.trim().toLowerCase();
  if (sprintQ) filtered = filtered.filter((r) => sprintLabel(r.sprint).toLowerCase().includes(sprintQ));
  const teamQ = filter.team?.trim().toLowerCase();
  if (teamQ && teamLabel) filtered = filtered.filter((r) => teamLabel(r.id).toLowerCase().includes(teamQ));
  const assigneeQ = filter.assignee?.trim().toLowerCase();
  if (assigneeQ) filtered = filtered.filter((r) => (r.assignee?.trim() || "Unassigned").toLowerCase().includes(assigneeQ));
  // Status is categorical (no search input) — exact match. The
  // synthetic "unscheduled" key isn't a real story status but a
  // sprint-qualifier; treat it as "rows with no sprint" so the planner
  // can filter unscheduled work from the same dropdown as the other
  // statuses (same surface, one mental model).
  if (filter.status === "unscheduled") filtered = filtered.filter((r) => r.sprint == null);
  else if (filter.status != null) filtered = filtered.filter((r) => r.status === filter.status);
  if (!sort) return filtered;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    switch (sort.key) {
      case "id":
        return storyDisplayId(a.id).localeCompare(storyDisplayId(b.id), undefined, { numeric: true }) * dir;
      case "title":
        return a.title.localeCompare(b.title) * dir;
      case "sprint":
        return ((a.sprint ?? Number.POSITIVE_INFINITY) - (b.sprint ?? Number.POSITIVE_INFINITY)) * dir;
      case "assignee":
        return (a.assignee ?? "").localeCompare(b.assignee ?? "") * dir;
      case "status":
        return ((STORY_STATUS_RANK[a.status] ?? 99) - (STORY_STATUS_RANK[b.status] ?? 99)) * dir;
      default:
        return 0;
    }
  });
}

function isStoryOpen(status: UserStoryItem["status"] | null | undefined) {
  // "Open" = anything that isn't truly shipped. Review-state stories
  // count as open here too — they can still bounce back to in-progress
  // and they haven't crossed the burnup's "completed" line. Mirrors
  // the storyDone helper in burnUpData and the Sprint Load fix
  // (e026fce) so Burndown / Burnup / CFD all share one definition:
  // Completed = status === "done"; Open / Remaining = everything else.
  return status !== "done";
}


/** Per-epic entry inside a team's flagged-epic list. Carries the full
 *  ProgressResult so the popover can show *why* this epic is in its
 *  bucket (delta vs ideal, working days left, etc.). */
type FlaggedEpicEntry = {
  title: string;
  epic: EpicItem;
  result: ProgressResult;
  /** Epic's planned end date — used to print "due X/Y" in the popover. */
  end: Date;
};

/** Format a fractional-days value the same way HealthBadgeWithDetail does. */
function fmtDays(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}${Number.isInteger(abs) ? abs : abs.toFixed(1)}d`;
}

/** Compact "D/M" date label used by the per-epic explainer line. */
function fmtDM(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/**
 * Click-to-open popover for the Team Progress health badge. Shows the
 * team's rolled-up status (worst child epic) and lists which epics drove
 * the verdict (At Risk / Overdue / Watch) with a one-line explanation of
 * *why* each one is in its bucket — remaining work vs. working days left
 * and how far above the ideal pace line it sits. Each epic title is a
 * button that opens the epic dialog via the optional onOpenEpic
 * callback. Closes on click-outside or Escape.
 */
function TeamHealthBadgeWithList({
  status,
  atRiskEpics,
  watchEpics,
  overdueEpics,
  buckets,
  total,
  teamLabel,
  onOpenEpic,
}: {
  status: HealthStatus;
  atRiskEpics: FlaggedEpicEntry[];
  watchEpics: FlaggedEpicEntry[];
  overdueEpics: FlaggedEpicEntry[];
  /** All five verdict counts for this team's in-scope epics. The chip
   *  renders this as a segmented bar — the proportion IS the verdict,
   *  no worst-of-children word. */
  buckets: VerdictBuckets;
  total: number;
  teamLabel: string;
  onOpenEpic?: (epicId: string) => void;
}) {
  const verdict =
    status === "overdue" ? "Overdue"
    : status === "atRisk" ? "At Risk"
    : status === "watch" ? "Watch"
    : status === "done" ? "Done"
    : "On Track";
  const flagged = overdueEpics.length + atRiskEpics.length + watchEpics.length;

  const reasonFor = (entry: FlaggedEpicEntry, kind: "overdue" | "atRisk" | "watch") => {
    const r = entry.result;
    if (kind === "overdue") {
      return `${fmtDays(r.remainingEffort)} still open · due ${fmtDM(entry.end)} (passed)`;
    }
    const delta = r.deltaDays;
    const ahead = delta < 0 ? `-${fmtDays(-delta)}` : `+${fmtDays(delta)}`;
    return `${fmtDays(r.remainingEffort)} left · ${r.daysRemaining}d to ${fmtDM(entry.end)} · ${ahead} vs ideal`;
  };
  const renderList = (
    key: "overdue" | "atRisk" | "watch",
    entries: FlaggedEpicEntry[],
    titleClass: string,
    heading: string,
  ) => {
    // Per-bucket warning glyph + tint — overdue uses an octagon since
    // "past deadline" is a harder failure than "drifting".
    const warnIcon = key === "overdue"
      ? { Icon: AlertOctagon, className: "text-rose-700" }
      : key === "atRisk"
        ? { Icon: AlertTriangle, className: "text-rose-600" }
        : { Icon: AlertTriangle, className: "text-amber-600" };
    const WarnIcon = warnIcon.Icon;
    return entries.length === 0 ? null : (
      <div className="mb-2.5">
        <p className={cn("text-[13px] font-semibold", titleClass)}>{heading} ({entries.length})</p>
        <ul className="mt-1.5 space-y-1.5">
          {entries.map((e) => (
            <li key={e.epic.id} className="leading-snug">
              <button
                type="button"
                onClick={() => { onOpenEpic?.(e.epic.id); }}
                className="inline-flex w-full items-center gap-1.5 text-left text-[13.5px] font-medium text-blue-700 underline-offset-2 hover:underline"
              >
                <Folder className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                <span className="min-w-0 truncate">{e.title}</span>
                <WarnIcon className={cn("size-3.5 shrink-0", warnIcon.className)} aria-hidden />
              </button>
              <p className="truncate text-[12px] tabular-nums text-slate-500">{reasonFor(e, key)}</p>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const popoverBody = (
    <>
      <p className="mb-2 inline-flex w-full items-center justify-between text-[12.5px] font-bold uppercase tracking-wide text-slate-500">
        {/* Lead-in disambiguates the baseline: this verdict measures each
         *  epic's own plan-end vs ideal-burndown delta. Same chip shape
         *  is used by Sprint Load — that header leads with the sprint
         *  label for the same reason. */}
        <span>Epic plan · {teamLabel} · {verdict}</span>
        {flagged > 0 ? <span className="text-[12px] font-semibold normal-case tracking-normal text-slate-400">{flagged} flagged</span> : null}
      </p>
      {renderList("overdue", overdueEpics, "text-rose-900", "Overdue — planned end passed")}
      {renderList("atRisk", atRiskEpics, "text-rose-800", "At Risk — ≥4d above ideal")}
      {renderList("watch", watchEpics, "text-amber-800", "Watch — 1–4d above ideal")}
      {flagged === 0 ? (
        <p className="text-[13px] text-slate-500">No flagged epics — everything is on or ahead of pace.</p>
      ) : null}
      <div className="mt-2 border-t border-slate-100 pt-2.5 text-[12.5px] leading-snug text-slate-500">
        <p className="mb-1"><span className="font-semibold text-slate-600">How we score:</span> at each point in an epic&rsquo;s window we compare its remaining work to the ideal linear burndown — Δ = remaining − ideal.</p>
        <p>≤ 1d → On Track · 1–4d → Watch · ≥ 4d → At Risk · past planned end → Overdue.</p>
      </div>
    </>
  );

  return (
    <VerdictDistributionChip
      buckets={buckets}
      total={total}
      ariaLabel={`${teamLabel} — epic health distribution`}
      popoverBody={popoverBody}
      unitLabel="epic"
      size="xs"
    />
  );
}

/**
 * User-mode mirror of {@link TeamHealthBadgeWithList} for the Team
 * Progress card when the breadcrumb pins a single team. Each row is one
 * user; the chip's segments reflect the proportion of that user's
 * in-scope stories by health, the popover lists flagged stories with
 * click-through to open the story dialog.
 */
function UserHealthBadgeWithList({
  buckets,
  total,
  status,
  atRiskStories,
  watchStories,
  overdueStories,
  assigneeLabel,
  onOpenStory,
}: {
  buckets: VerdictBuckets;
  total: number;
  status: HealthStatus;
  atRiskStories: Array<{ story: UserStoryItem; epic: EpicItem }>;
  watchStories: Array<{ story: UserStoryItem; epic: EpicItem }>;
  overdueStories: Array<{ story: UserStoryItem; epic: EpicItem }>;
  assigneeLabel: string;
  onOpenStory?: (storyId: string) => void;
}) {
  const verdict =
    status === "overdue" ? "Overdue"
    : status === "atRisk" ? "At Risk"
    : status === "watch" ? "Watch"
    : status === "done" ? "Done"
    : "On Track";
  const flagged = overdueStories.length + atRiskStories.length + watchStories.length;

  const renderList = (
    key: "overdue" | "atRisk" | "watch",
    entries: Array<{ story: UserStoryItem; epic: EpicItem }>,
    titleClass: string,
    heading: string,
  ) => {
    const warnIcon = key === "overdue"
      ? { Icon: AlertOctagon, className: "text-rose-700" }
      : key === "atRisk"
        ? { Icon: AlertTriangle, className: "text-rose-600" }
        : { Icon: AlertTriangle, className: "text-amber-600" };
    const WarnIcon = warnIcon.Icon;
    return entries.length === 0 ? null : (
      <div className="mb-2.5">
        <p className={cn("text-[13px] font-semibold", titleClass)}>{heading} ({entries.length})</p>
        <ul className="mt-1.5 space-y-1.5">
          {entries.map(({ story, epic }) => (
            <li key={story.id} className="leading-snug">
              <button
                type="button"
                onClick={() => { onOpenStory?.(story.id); }}
                className="inline-flex w-full items-center gap-1.5 text-left text-[13.5px] font-medium text-blue-700 underline-offset-2 hover:underline"
              >
                <BookOpen className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                <span className="min-w-0 truncate">{story.title}</span>
                <WarnIcon className={cn("size-3.5 shrink-0", warnIcon.className)} aria-hidden />
              </button>
              <p className="truncate text-[12px] text-slate-500">{epic.title}</p>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const popoverBody = (
    <>
      <p className="mb-2 inline-flex w-full items-center justify-between text-[12.5px] font-bold uppercase tracking-wide text-slate-500">
        {/* Lead-in mirrors the team variant — story-level verdict against
         *  each story's own sprint, so the planner knows the chip's
         *  baseline isn't "fits in the period" or "epic plan". */}
        <span>Sprint commit · {assigneeLabel} · {verdict}</span>
        {flagged > 0 ? <span className="text-[12px] font-semibold normal-case tracking-normal text-slate-400">{flagged} flagged</span> : null}
      </p>
      {renderList("overdue", overdueStories, "text-rose-900", "Overdue — sprint closed, not done")}
      {renderList("atRisk", atRiskStories, "text-rose-800", "At Risk — needs more days than sprint has")}
      {renderList("watch", watchStories, "text-amber-800", "Watch — exactly the sprint's days-left")}
      {flagged === 0 ? (
        <p className="text-[13px] text-slate-500">No flagged stories — everything is on or ahead of pace.</p>
      ) : null}
      <div className="mt-2 border-t border-slate-100 pt-2.5 text-[12.5px] leading-snug text-slate-500">
        <p className="mb-1"><span className="font-semibold text-slate-600">How we score:</span> each story&rsquo;s remaining days vs. its sprint&rsquo;s days-left.</p>
        <p>less → On Track · equal → Watch · more → At Risk · sprint closed and not done → Overdue.</p>
      </div>
    </>
  );

  return (
    <VerdictDistributionChip
      buckets={buckets}
      total={total}
      ariaLabel={`${assigneeLabel} — story health distribution`}
      popoverBody={popoverBody}
      unitLabel="story"
      size="xs"
    />
  );
}

/**
 * Body of the User Progress drilldown modal — replaces the table for
 * user-mode rows. Renders one accordion row per epic that has any of
 * the user's in-scope stories; expanding the epic reveals those
 * stories underneath with a tree-style left-rail connector (matches
 * the sprint card's nested-story visual). Clicking a story opens the
 * story dialog; clicking an epic title opens the epic dialog.
 */
function UserEpicAccordionView({
  rowLabel,
  storiesByEpic,
  onOpenEpic,
  onOpenStory,
}: {
  rowLabel: string;
  storiesByEpic: Array<{ epic: EpicItem; stories: UserStoryItem[] }>;
  onOpenEpic?: (epicId: string) => void;
  onOpenStory?: (storyId: string) => void;
}) {
  // All epics start expanded — the planner opened the drilldown to see
  // the stories, so collapsing them by default would force a second
  // click. The chevron still toggles per-epic if they want to compact a
  // long list.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const totalStories = storiesByEpic.reduce((sum, g) => sum + g.stories.length, 0);
  if (storiesByEpic.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-[13px] text-slate-500">
        No in-scope stories for {rowLabel}.
      </div>
    );
  }
  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
      <p className="shrink-0 px-1 pt-1 pb-2 text-[12px] text-slate-500">
        {storiesByEpic.length} epic{storiesByEpic.length === 1 ? "" : "s"} · {totalStories} stor{totalStories === 1 ? "y" : "ies"}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        <ul className="space-y-2">
          {storiesByEpic.map(({ epic, stories }) => {
            const isCollapsed = collapsed.has(epic.id);
            return (
              <li key={epic.id} className="rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(epic.id)) next.delete(epic.id);
                        else next.add(epic.id);
                        return next;
                      });
                    }}
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    aria-expanded={!isCollapsed}
                    aria-label={isCollapsed ? "Expand epic" : "Collapse epic"}
                  >
                    <ChevronRight className={cn("size-4 transition-transform", !isCollapsed && "rotate-90")} aria-hidden />
                  </button>
                  <Folder className="size-3.5 shrink-0 text-sky-500" aria-hidden />
                  <button
                    type="button"
                    onClick={() => onOpenEpic?.(epic.id)}
                    className="min-w-0 flex-1 truncate text-left text-[13.5px] font-semibold text-slate-800 hover:underline"
                  >
                    {epic.title}
                  </button>
                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
                    {stories.length}
                  </span>
                </div>
                {!isCollapsed ? (
                  <ul className="space-y-1.5 px-2 pb-2 pl-7 pt-0.5">
                    {stories.map((story, idx) => {
                      const isLast = idx === stories.length - 1;
                      const statusMeta = (() => {
                        switch (story.status) {
                          case "done": return { label: "Done", className: "bg-emerald-100 text-emerald-800 ring-emerald-300/60" };
                          case "review": return { label: "Review", className: "bg-violet-100 text-violet-800 ring-violet-300/60" };
                          case "inProgress": return { label: "In progress", className: "bg-sky-100 text-sky-800 ring-sky-300/60" };
                          default: return { label: "To do", className: "bg-amber-100 text-amber-800 ring-amber-300/60" };
                        }
                      })();
                      return (
                        <li key={story.id} className="relative pl-5">
                          {/* Tree connector: vertical rail down the left
                           *  edge (stops at the last item's elbow), plus
                           *  a horizontal elbow into each story. Matches
                           *  the SprintEpicCard's nested-story tree visual. */}
                          <span
                            className="absolute left-0 top-0 w-px bg-slate-200"
                            style={{ height: isLast ? "12px" : "100%" }}
                            aria-hidden
                          />
                          <span
                            className="absolute left-0 top-[12px] h-px w-3.5 -translate-y-px bg-slate-200"
                            aria-hidden
                          />
                          <button
                            type="button"
                            onClick={() => onOpenStory?.(story.id)}
                            className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[13px] hover:bg-slate-50"
                          >
                            <BookOpen className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-slate-800">{story.title}</span>
                            <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1", statusMeta.className)}>
                              {statusMeta.label}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Renderer for a Sprint dropdown row — adds a Flag glyph (matches the
 *  rest of the app where sprint = flag) before the label. */
function renderSprintOption(label: string) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Flag className="size-3.5 shrink-0 text-rose-500" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Renderer for a Status dropdown row — adds the colored status pill icon
 *  + the readable label (StoryStatusPill's existing meta). */
function renderStatusOption(key: string) {
  // Same meta lookup StoryStatusPill uses; inlined here so the dropdown
  // option doesn't pull in the full pill chrome (no extra padding).
  // The "unscheduled" key is a synthetic sprint-qualifier — see the
  // `filter.status === "unscheduled"` branch in `applyDrilldownFilterSort`.
  const meta = (() => {
    switch (key) {
      case "done": return { label: "Done", Icon: CheckCircle2, color: "text-emerald-600" };
      case "review": return { label: "Review / Testing", Icon: CheckCheck, color: "text-violet-600" };
      case "inProgress": return { label: "In progress", Icon: PlayCircle, color: "text-blue-600" };
      case "todo": return { label: "To do", Icon: ListTodo, color: "text-amber-600" };
      case "unscheduled": return { label: "Unscheduled", Icon: UserX, color: "text-slate-500" };
      default: return { label: key, Icon: Circle, color: "text-slate-500" };
    }
  })();
  const { Icon } = meta;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className={cn("size-3.5 shrink-0", meta.color)} aria-hidden />
      <span className="truncate text-slate-700">{meta.label}</span>
    </span>
  );
}

/** Renderer for the Epic-variant Status dropdown row — input is the
 *  HUMAN label (e.g. "To do", "Unscheduled") rather than the raw enum
 *  key, because the epic statuses are derived via `deriveEpicStatus()`
 *  and already arrive in display form. Includes the "Unscheduled"
 *  bucket that doesn't exist on the story-status renderer. */
function renderEpicStatusOption(label: string) {
  const meta = (() => {
    switch (label) {
      case "Done": return { Icon: CheckCircle2, color: "text-emerald-600" };
      case "Review / Testing": return { Icon: CheckCheck, color: "text-violet-600" };
      case "In progress": return { Icon: PlayCircle, color: "text-blue-600" };
      case "To do": return { Icon: ListTodo, color: "text-amber-600" };
      case "Unscheduled": return { Icon: UserX, color: "text-slate-500" };
      default: return { Icon: Circle, color: "text-slate-500" };
    }
  })();
  const { Icon } = meta;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className={cn("size-3.5 shrink-0", meta.color)} aria-hidden />
      <span className="truncate text-slate-700">{label}</span>
    </span>
  );
}

/** Clickable column header for the drilldown tables. Click cycles
 *  none → asc → desc → none for that column. Active column shows a small
 *  arrow indicator. */
function DrilldownSortHeader({
  label,
  column,
  sort,
  onSortChange,
  className,
}: {
  label: string;
  column: DrilldownSortKey;
  sort: { key: DrilldownSortKey; dir: "asc" | "desc" } | null;
  onSortChange: (next: { key: DrilldownSortKey; dir: "asc" | "desc" } | null) => void;
  className?: string;
}) {
  const active = sort?.key === column;
  const dir = active ? sort!.dir : null;
  return (
    <button
      type="button"
      onClick={() => {
        if (!active) onSortChange({ key: column, dir: "asc" });
        else if (dir === "asc") onSortChange({ key: column, dir: "desc" });
        else onSortChange(null);
      }}
      className={cn("inline-flex items-center gap-0.5 font-semibold transition-opacity hover:opacity-90", className)}
    >
      <span>{label}</span>
      {dir === "asc" ? (
        <ChevronUp className="size-3" aria-hidden />
      ) : dir === "desc" ? (
        <ChevronDown className="size-3" aria-hidden />
      ) : (
        <span className="inline-block w-3" aria-hidden />
      )}
    </button>
  );
}

function basisDisplayLabel(basis: ProgressBasis, scope: "epic" | "initiative"): string {
  if (basis === "stories") return "Stories Completed (%)";
  if (basis === "days") return "Σ | Child Est (d)";
  return scope === "epic" ? "Epic Est (d)" : "Σ | Epic Est (d)";
}

/** Compact display name: "John S." — first name + last-name initial. Used on
 *  Workload Balance bars (where horizontal room per bar is tight) and Month
 *  Load rows so people sharing a first name can be told apart. Single-word
 *  names render unchanged. */
function compactAssigneeName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? fullName;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const initial = last?.[0]?.toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}

type BurndownTooltipPayload = {
  name?: string | number;
  value?: number | string | readonly (number | string)[] | null | undefined;
  color?: string;
  dataKey?: unknown;
};

function BurndownTargetIcon(props: { cx?: number; cy?: number; color?: string }) {
  const cx = props.cx ?? 0;
  const cy = props.cy ?? 0;
  const color = props.color ?? "#dc2626";
  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill="#ffffff" stroke={color} strokeWidth={1.6} />
      <circle cx={cx} cy={cy} r={1.8} fill={color} />
      <line x1={cx - 7} y1={cy} x2={cx - 5.5} y2={cy} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <line x1={cx + 5.5} y1={cy} x2={cx + 7} y2={cy} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <line x1={cx} y1={cy - 7} x2={cx} y2={cy - 5.5} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <line x1={cx} y1={cy + 5.5} x2={cx} y2={cy + 7} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </g>
  );
}

function AnalyticsTooltipShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white/95 px-2.5 py-2 text-[12px] shadow-lg ring-1 ring-slate-100/70 backdrop-blur-sm">
      <p className="mb-1.5 text-[12px] font-semibold text-slate-800">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function AnalyticsTooltipRow({
  color,
  label,
  value,
}: {
  color?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-slate-600">
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? "#cbd5e1" }} />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-semibold text-slate-800">{value}</span>
    </div>
  );
}

/** Same visual language as Gantt bar + form info hovers (indigo gradient). */
const INSIGHTS_TRUNCATION_PORTAL_TOOLTIP_CLASS =
  "pointer-events-none w-max max-w-[min(22rem,calc(100vw-2rem))] whitespace-normal rounded-lg border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/40 px-2.5 py-1.5 text-left text-[12px] font-medium leading-snug text-slate-700 shadow-md ring-1 ring-indigo-100/70 backdrop-blur-sm";

function useTextTruncationFlag<T extends HTMLElement>(text: string) {
  const ref = useRef<T | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setIsTruncated(el.scrollWidth > el.clientWidth + 1);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [text, measure]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return { ref, isTruncated };
}

function InsightsTruncationTooltipPortal({
  show,
  anchorRef,
  text,
}: {
  show: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  text: string;
}) {
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Keep the tooltip on-screen when the anchor sits near the right edge
    // (e.g. legend rows in the right-side column). The tooltip's
    // max-width matches `INSIGHTS_TRUNCATION_PORTAL_TOOLTIP_CLASS`
    // (`min(22rem, calc(100vw-2rem))` → at most 352px), so clamp the
    // computed `left` so `left + estW` stays inside the viewport.
    const viewportW = typeof window !== "undefined" ? window.innerWidth : 1024;
    const estW = Math.min(352, viewportW - 32);
    let left = r.left;
    if (left + estW > viewportW - 8) left = Math.max(8, viewportW - estW - 8);
    if (left < 8) left = 8;
    setCoords({ top: r.bottom + 6, left });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!show) return;
    updatePosition();
    const onReposition = () => updatePosition();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [show, updatePosition, text]);

  if (!show || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="tooltip"
      style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 9999 }}
      className={INSIGHTS_TRUNCATION_PORTAL_TOOLTIP_CLASS}
    >
      {text}
    </div>,
    document.body,
  );
}

/**
 * Legend row button shared by the Burndown and Burnup chart legends. Wraps
 * a single togglable epic (or the synthetic ideal-line entry) and renders
 * the project's standard portaled hover tooltip with the full epic title
 * — useful when the legend row's `truncate` clips a long name. The portal
 * already clamps to the viewport's right edge so it never gets cut off.
 */
function EpicLegendRowButton({
  label,
  color,
  on,
  isEpic,
  onClick,
  textClass,
  treeRow,
}: {
  label: string;
  /** The chart-line color for this series; used to tint the Folder glyph so
   *  the legend marker visually matches the actual line on the chart. */
  color: string;
  /** Toggle / visibility state — drives glyph opacity (dimmed when off). */
  on: boolean;
  /** Real epic gets the Folder glyph; synthetic ideal-line row skips it. */
  isEpic: boolean;
  onClick: () => void;
  /** Outer button text-color classes (active/inactive variants from caller). */
  textClass: string;
  /** When true, the button draws a small horizontal stub at its left edge so
   *  the row reads as a child of the surrounding vertical-line tree (mirrors
   *  the scope-picker dropdown's tree connector for initiative-scoped lists). */
  treeRow?: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [hover, setHover] = useState(false);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className={cn(
          "mb-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left transition",
          on && "bg-indigo-50 font-semibold",
          treeRow && "relative pl-3 before:absolute before:left-0 before:top-1/2 before:h-px before:w-2.5 before:bg-slate-200",
          textClass,
        )}
      >
        {isEpic ? (
          <Folder
            className="size-3.5 shrink-0"
            style={{ color }}
            strokeWidth={2}
            aria-hidden
          />
        ) : (
          // Non-epic rows (e.g. "Epic ideal to due") keep a small colored
          // square so the marker still reads as a series swatch.
          <span
            className="inline-block size-3 shrink-0 rounded-[3px]"
            style={{ backgroundColor: color }}
            aria-hidden
          />
        )}
        <span className="truncate">{label}</span>
      </button>
      <InsightsTruncationTooltipPortal show={hover} anchorRef={btnRef} text={label} />
    </>
  );
}

function InsightsTruncatedHoverLabel({ text }: { text: string }) {
  const { ref, isTruncated } = useTextTruncationFlag<HTMLSpanElement>(text);
  const [hover, setHover] = useState(false);

  return (
    <>
      <span
        className="block min-w-0 max-w-full"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <span ref={ref} className="block min-w-0 max-w-full truncate">
          {text}
        </span>
      </span>
      <InsightsTruncationTooltipPortal show={hover && isTruncated} anchorRef={ref} text={text} />
    </>
  );
}

function InsightsTruncatedHoverButton({
  label,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & { label: string }) {
  const { ref, isTruncated } = useTextTruncationFlag<HTMLButtonElement>(label);
  const [hover, setHover] = useState(false);

  return (
    <>
      <span
        className="block min-w-0 max-w-full"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <button ref={ref} type="button" className={className} {...props}>
          {label}
        </button>
      </span>
      <InsightsTruncationTooltipPortal show={hover && isTruncated} anchorRef={ref} text={label} />
    </>
  );
}

function formatBurndownValue(
  value: number | string | readonly (number | string)[] | null | undefined,
  metric: BurndownMetric,
) {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (typeof normalized !== "number") return "n/a";
  return metric === "storyCount" ? `${Math.round(normalized)} stories` : `${normalized.toFixed(1)}d`;
}

function BurndownTooltip({
  active,
  payload,
  label,
  metric,
  totalScope,
}: {
  active?: boolean;
  payload?: readonly BurndownTooltipPayload[];
  label?: string | number;
  metric: BurndownMetric;
  /** Aggregate total scope at chart start — used to surface a
   *  "Completed" row alongside Ideal so the tooltip reads
   *  "Total scope · Ideal · Completed" instead of just the raw
   *  remaining values. Pass null when the chart can't infer a
   *  meaningful scope (e.g. per-epic focused view); the tooltip then
   *  falls back to the legacy per-series rows. */
  totalScope?: number | null;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((item) => item.value != null);
  if (rows.length === 0) return null;

  // Aggregate-view tooltip — three rows: Total scope · Ideal · Completed.
  // Triggered when the chart is in "All" mode and the caller supplied a
  // totalScope. We sniff for the `actual` and `ideal` dataKeys in the
  // payload to compute Completed = scope − actual.
  if (totalScope != null && totalScope > 0) {
    const actualRow = rows.find((r) => r.dataKey === "actual");
    const idealRow = rows.find((r) => r.dataKey === "ideal");
    const actualValue =
      actualRow && typeof actualRow.value === "number" ? actualRow.value : null;
    const idealValue =
      idealRow && typeof idealRow.value === "number" ? idealRow.value : null;
    const completedValue =
      actualValue != null ? Math.max(0, totalScope - actualValue) : null;
    return (
      <AnalyticsTooltipShell title={String(label ?? "Burndown")}>
        <AnalyticsTooltipRow
          color="#94a3b8"
          label="Total scope"
          value={formatBurndownValue(totalScope, metric)}
        />
        {idealValue != null ? (
          <AnalyticsTooltipRow
            color={idealRow?.color ?? "#f97316"}
            label="Ideal"
            value={formatBurndownValue(idealValue, metric)}
          />
        ) : null}
        {completedValue != null ? (
          <AnalyticsTooltipRow
            color={actualRow?.color ?? "#2563eb"}
            label="Completed"
            value={formatBurndownValue(completedValue, metric)}
          />
        ) : null}
      </AnalyticsTooltipShell>
    );
  }

  // Legacy per-series tooltip — used when the chart is showing the
  // single-epic focused view or per-epic colored lines.
  return (
    <AnalyticsTooltipShell title={String(label ?? "Burndown")}>
      {rows.map((row) => (
        <AnalyticsTooltipRow
          key={String(row.dataKey ?? row.name)}
          color={row.color}
          label={String(row.name ?? row.dataKey ?? "Series")}
          value={formatBurndownValue(row.value, metric)}
        />
      ))}
    </AnalyticsTooltipShell>
  );
}

function CumulativeFlowTooltip({
  active,
  payload,
  label,
  metric,
}: {
  active?: boolean;
  payload?: readonly BurndownTooltipPayload[];
  label?: string | number;
  metric?: BurndownMetric;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((item) => item.value != null);
  if (rows.length === 0) return null;
  return (
    <AnalyticsTooltipShell title={String(label ?? "Cumulative Flow")}>
      {rows.map((row) => {
        const normalized = Array.isArray(row.value) ? row.value[0] : row.value;
        const valueText = typeof normalized === "number"
          ? metric === "daysLeft" ? `${Math.round(normalized)}d` : `${Math.round(normalized)} stories`
          : "n/a";
        return (
          <AnalyticsTooltipRow
            key={String(row.dataKey ?? row.name)}
            color={row.color}
            label={String(row.name ?? row.dataKey ?? "Series")}
            value={valueText}
          />
        );
      })}
    </AnalyticsTooltipShell>
  );
}

function StatusPieTooltip({
  active,
  payload,
  total,
  title,
}: {
  active?: boolean;
  payload?: readonly BurndownTooltipPayload[];
  total: number;
  title: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload.find((item) => item.value != null);
  if (!row) return null;
  const normalized = Array.isArray(row.value) ? row.value[0] : row.value;
  const value = typeof normalized === "number" ? Math.round(normalized) : Number(normalized ?? 0);
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <AnalyticsTooltipShell title={title}>
      <AnalyticsTooltipRow
        color={row.color}
        label={String(row.name ?? "Status")}
        value={`${value} (${percent}%)`}
      />
    </AnalyticsTooltipShell>
  );
}

type MonthAnalyticsProps = {
  initiatives: InitiativeItem[];
  month: number;
  periodMonths?: number[];
  periodLabel?: string;
  planYear: number;
  filterEpicTeamIds?: string[] | null;
  forceUserMode?: boolean;
  initialSelectedEpicId?: string;
  initialSelectedInitiativeId?: string;
  onOpenEpic?: (epicId: string) => void;
  onOpenInitiative?: (initiativeId: string) => void;
  onOpenStory?: (storyId: string) => void;
  onOpenSprintKanban?: (yearSprint: number, teamId: string | null) => void;
  onScopeChange?: (type: "epic" | "initiative" | null, id: string | null, title: string | null) => void;
  /** Directory for avatar lookup — when set, Workload Balance X-axis ticks
   *  and Month Load row circles render the user's photo instead of initials.
   *  Same shape the sprint-kanban / capacity already accept. */
  workspaceDirectoryUsers?: readonly { name: string; team?: string; image?: string | null }[];
  /** Health-basis toggle from the parent (Roadmap Health popover). Drives
   *  verdict labels / status filters on the Insights scope chips. Chart
   *  curve math stays days-based regardless — only the verdicts honor
   *  the toggle so a user flipping to "Σ Epic Est." doesn't lose the
   *  underlying burndown view. */
  progressBasis?: "days" | "stories" | "epicEst";
  /** Callback to flip the basis from within Insights — when provided, a
   *  3-option segmented control renders in the Insights header (next to
   *  the scope picker) so the user doesn't have to navigate back to the
   *  Roadmap Health popover. State is shared via the parent so popover +
   *  Insights stay in sync via localStorage. Omit on public / static
   *  views to hide the editor. */
  onProgressBasisChange?: (basis: "days" | "stories" | "epicEst") => void;
};

function flowChartDayLabel(dayDate: Date): string {
  const d = dayDate.getDate();
  const m = dayDate.getMonth() + 1;
  const w = WEEKDAY_SHORT[dayDate.getDay()];
  return `${d}/${m}(${w})`;
}

function piePercentLabel({
  cx,
  cy,
  midAngle,
  outerRadius,
  percent,
  name,
}: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  percent?: number;
  name?: string;
}) {
  if (
    cx == null ||
    cy == null ||
    midAngle == null ||
    outerRadius == null ||
    percent == null ||
    percent < 0.04
  ) {
    return null;
  }
  const RAD = Math.PI / 180;
  const r = outerRadius + 18;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  const anchor = x > cx ? "start" : "end";
  return (
    <g>
      <text
        x={x}
        y={y - 9}
        fill="#334155"
        textAnchor={anchor}
        dominantBaseline="central"
        fontSize={14}
        fontWeight={700}
      >
        {`${Math.round(percent * 100)}%`}
      </text>
      <text
        x={x}
        y={y + 10}
        fill="#64748b"
        textAnchor={anchor}
        dominantBaseline="central"
        fontSize={12}
        fontWeight={500}
      >
        {name ?? ""}
      </text>
    </g>
  );
}

function normalizeStoryYearSprint(storySprint: number | null | undefined, month: number): number | null {
  if (storySprint == null) return null;
  if (storySprint === 1 || storySprint === 2) return globalSprintFromMonthLane(month, storySprint);
  return clampYearSprint(storySprint);
}

function storySprintDisplayLabel(storySprint: number | null | undefined, month: number): string {
  const normalized = normalizeStoryYearSprint(storySprint, month);
  if (normalized == null) return "Unscheduled";
  const { lane } = monthLaneFromGlobalSprint(normalized);
  return `Sprint ${lane}`;
}

function statusDrilldownIcon(status: string | null) {
  if (status === "To do") return ListTodo;
  if (status === "In progress") return PlayCircle;
  if (status === "Review / Testing") return CheckCheck;
  if (status === "Done") return CheckCircle2;
  if (status === "Unscheduled") return UserX;
  return Circle;
}

function statusDrilldownDisplayLabel(status: string | null): string {
  if (status === "To do") return "To Do";
  return status ?? "";
}

/**
 * Backlog-style icon + label combo for a workflow status. Mirrors the
 * convention in `components/backlog/backlog-planning-panel.tsx` so the
 * Workload + Month Load drilldown rows read the same as the backlog table.
 */
function StoryStatusPill({ status, sprint }: { status: UserStoryItem["status"]; sprint?: number | null }) {
  // When the optional `sprint` prop is explicitly null, the pill
  // displays as "Unscheduled" — same vocabulary the Status filter
  // dropdown uses for the synthetic Unscheduled option, so a planner
  // who narrows to Unscheduled sees rows that literally read
  // "Unscheduled" in the Status column instead of the underlying
  // workflow status. The actual `status` value still flows through to
  // the tooltip so the underlying state isn't lost. Callers that
  // don't pass `sprint` (epic pills, legacy call-sites) keep the
  // existing workflow-status rendering.
  if (sprint === null) {
    const underlying = (() => {
      switch (status) {
        case "done": return "Done";
        case "review": return "Review / Testing";
        case "inProgress": return "In progress";
        default: return "To do";
      }
    })();
    return (
      <span
        className="inline-flex items-center gap-1.5 font-semibold"
        title={`Unscheduled · ${underlying}`}
      >
        <UserX className="size-3.5 shrink-0 text-slate-500" aria-hidden />
        <span className="truncate text-slate-700">Unscheduled</span>
      </span>
    );
  }
  const meta = (() => {
    switch (status) {
      case "done":
        return { label: "Done", Icon: CheckCircle2, color: "text-emerald-600" };
      case "review":
        return { label: "Review / Testing", Icon: CheckCheck, color: "text-violet-600" };
      case "inProgress":
        return { label: "In progress", Icon: PlayCircle, color: "text-blue-600" };
      default:
        return { label: "To do", Icon: ListTodo, color: "text-amber-600" };
    }
  })();
  const { Icon } = meta;
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold">
      <Icon className={cn("size-3.5 shrink-0", meta.color)} aria-hidden />
      <span className="truncate text-slate-700">{meta.label}</span>
    </span>
  );
}

/**
 * Drilldown assignee cell — small UserAvatar + compact name ("First L.") so
 * rows match the Workload Balance bar labels + Month Load row labels. Hover
 * tooltip keeps the full name. */
function DrilldownAssigneeCell({
  assignee,
  workspaceDirectoryUsers,
}: {
  assignee: string | null | undefined;
  workspaceDirectoryUsers?: readonly { name: string; team?: string; image?: string | null }[];
}) {
  const name = assignee?.trim();
  if (!name) {
    return <InsightsTruncatedHoverLabel text="Unassigned" />;
  }
  const resolved = resolveAssigneeAvatar(name, workspaceDirectoryUsers);
  const compact = compactAssigneeName(name);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={name}>
      <UserAvatar name={resolved.name} image={resolved.image} size={18} className="ring-0" />
      <span className="min-w-0 flex-1 truncate">{compact}</span>
    </span>
  );
}

function deriveEpicStatus(epic: EpicItem): "Unscheduled" | "To do" | "In progress" | "Review / Testing" | "Done" {
  const scheduledStories = (epic.userStories ?? []).filter((story) => story.sprint != null);
  if (scheduledStories.length === 0) return "Unscheduled";
  const allDone = scheduledStories.every((story) => story.status === "done");
  if (allDone) return "Done";
  const allReviewOrDone = scheduledStories.every(
    (story) => story.status === "review" || story.status === "done",
  );
  if (allReviewOrDone) return "Review / Testing";
  const hasInProgress = scheduledStories.some((story) => story.status === "inProgress");
  if (hasInProgress) return "In progress";
  return "To do";
}

/**
 * Period scope is the UNION of:
 *  (a) Plan-window overlap — epic's planned start/end intersects the period.
 *  (b) Delivery overlap — at least one of the epic's stories has a sprint
 *      that lands in one of the period months (regardless of plan window).
 *
 * (b) catches reality drift: a story rolled from sprint 10 (May) to sprint 11
 * (June) keeps belonging to its original May-planned epic, but the work is
 * now happening in June. Without (b), June Insights would silently skip
 * both the story (in workload / pie totals) AND the parent epic (from the
 * epic dropdown / Epic Progress drilldown). Mirrors the same fix in
 * `lib/sprint-analytics.ts` `collectMonthStories`.
 */
function epicHasStoryInPeriodMonths(
  epic: EpicItem,
  monthsSet: Set<number>,
  contextMonth: number,
): boolean {
  for (const story of epic.userStories ?? []) {
    if (story.sprint == null) continue;
    const normalized = normalizeStoryYearSprint(story.sprint, contextMonth);
    if (normalized == null) continue;
    if (monthsSet.has(monthLaneFromGlobalSprint(normalized).month)) return true;
  }
  return false;
}

function collectPeriodStories(
  initiatives: InitiativeItem[],
  months: number[],
  filterEpicTeamIds?: string[] | null,
  filterInitiativeId?: string | null,
): UserStoryItem[] {
  const rows: UserStoryItem[] = [];
  const minMonth = Math.min(...months);
  const maxMonth = Math.max(...months);
  const monthsSet = new Set(months);
  for (const initiative of initiatives) {
    // Note: no `initiative.status === "scheduled"` filter — if a team
    // is sprinting on an epic, it counts as period work regardless of
    // the parent initiative's status. Keeps this collector aligned
    // with the burndown's filter so CFD / drilldown / capacity all
    // count the same population.
    if (filterInitiativeId && initiative.id !== filterInitiativeId) continue;
    for (const epic of initiative.epics ?? []) {
      const startMonth = epic.planStartMonth ?? initiative.startMonth;
      const endMonth = epic.planEndMonth ?? initiative.endMonth;
      const planInScope =
        startMonth != null &&
        endMonth != null &&
        !(endMonth < minMonth || startMonth > maxMonth);
      const contextMonth = startMonth ?? initiative.startMonth ?? minMonth;
      const deliveryInScope = planInScope ? true : epicHasStoryInPeriodMonths(epic, monthsSet, contextMonth);
      if (!planInScope && !deliveryInScope) continue;
      // Per-story team override resolution: a story with its own team
      // override may belong to a different team than its epic, so we
      // filter at the STORY level instead of pre-filtering the whole
      // epic away.
      if (!filterEpicTeamIds?.length) {
        rows.push(...(epic.userStories ?? []));
      } else {
        for (const s of epic.userStories ?? []) {
          if (filterEpicTeamIds.includes((s.team ?? epic.team) ?? "")) rows.push(s);
        }
      }
    }
  }
  return rows;
}

function collectPeriodEpics(
  initiatives: InitiativeItem[],
  months: number[],
  filterEpicTeamIds?: string[] | null,
  filterInitiativeId?: string | null,
) {
  const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
  const minMonth = Math.min(...months);
  const maxMonth = Math.max(...months);
  const monthsSet = new Set(months);
  for (const initiative of initiatives) {
    // Note: no `initiative.status === "scheduled"` filter — if a team
    // is sprinting on an epic, it counts as period work regardless of
    // the parent initiative's status. Keeps this collector aligned
    // with the burndown's filter so CFD / drilldown / capacity all
    // count the same population.
    if (filterInitiativeId && initiative.id !== filterInitiativeId) continue;
    for (const epic of initiative.epics ?? []) {
      if (filterEpicTeamIds?.length && !filterEpicTeamIds.includes(epic.team ?? "")) continue;
      const startMonth = epic.planStartMonth ?? initiative.startMonth;
      const endMonth = epic.planEndMonth ?? initiative.endMonth;
      const planInScope =
        startMonth != null &&
        endMonth != null &&
        !(endMonth < minMonth || startMonth > maxMonth);
      const contextMonth = startMonth ?? initiative.startMonth ?? minMonth;
      const deliveryInScope = planInScope ? true : epicHasStoryInPeriodMonths(epic, monthsSet, contextMonth);
      if (!planInScope && !deliveryInScope) continue;
      rows.push({ epic, initiative });
    }
  }
  return rows.sort((a, b) => a.epic.title.localeCompare(b.epic.title));
}

export function MonthAnalytics({
  initiatives,
  month,
  periodMonths,
  periodLabel,
  planYear,
  filterEpicTeamIds = null,
  forceUserMode = false,
  initialSelectedEpicId,
  initialSelectedInitiativeId,
  onOpenEpic,
  onOpenInitiative,
  onOpenStory,
  onOpenSprintKanban,
  onScopeChange,
  workspaceDirectoryUsers,
  progressBasis = "days",
  onProgressBasisChange,
}: MonthAnalyticsProps) {
  const [estimateSource, setEstimateSource] = useState<EstimateSource>("stories");
  /**
   * Per-chart health/progress basis for the Burndown and Burnup chart cards.
   * Initialized from the popover's global `progressBasis` at mount so that
   * navigating from "View Insights" carries the user's pick into the chart
   * automatically. After that, each chart's toggle is independent — flipping
   * one chart's basis doesn't affect the other or the popover (the popover
   * stays the canonical default for new chart instances).
   */
  const [burndownBasis, setBurndownBasis] = useState<"days" | "stories" | "epicEst">(progressBasis);
  const [burnupBasis, setBurnupBasis] = useState<"days" | "stories" | "epicEst">(progressBasis);
  /**
   * The chart's Y-axis units derive from the basis (no separate metric toggle):
   *   - `epicEst` or `days` → Y-axis in days
   *   - `stories` → Y-axis in story count
   * Keeps the two toggles from drifting into nonsensical combinations
   * (e.g. epicEst with a stories Y-axis).
   */
  const metric: BurndownMetric = burndownBasis === "stories" ? "storyCount" : "daysLeft";
  const burnUpMetric: BurndownMetric = burnupBasis === "stories" ? "storyCount" : "daysLeft";
  /**
   * Close-day projection for past periods: when the period in scope (month,
   * quarter, or year) has fully elapsed, the analytics charts should reflect
   * what was true on the close day rather than evolving with post-close
   * edits and sprint rollovers. We compute the period's last instant and
   * (if it's in the past) re-project every story onto its close-day
   * snapshot. Burndown / CFD read snapshots directly so they're unaffected
   * either way — projection only matters for status pie + workload + other
   * "right now" reads.
   */
  const periodCloseMs = useMemo(() => {
    const lastMonth = (periodMonths != null && periodMonths.length > 0)
      ? periodMonths[periodMonths.length - 1]!
      : month;
    return new Date(planYear, lastMonth, 0, 23, 59, 59, 999).getTime();
  }, [periodMonths, month, planYear]);
  const isPastPeriod = periodCloseMs < clockNowMs();
  const analyticsInitiatives = useMemo(
    () => (isPastPeriod ? projectInitiativesToCloseDate(initiatives, periodCloseMs) : initiatives),
    [isPastPeriod, periodCloseMs, initiatives],
  );
  const [workloadStatusFilters, setWorkloadStatusFilters] = useState<WorkloadFilterKey[]>(["all"]);
  /**
   * Recharts' entry animations on a cold mount run *while* `ResponsiveContainer`
   * is still measuring — bars/lines/pie slices visibly settle, which reads as
   * a janky open. Disable animations on the very first paint and re-enable on
   * subsequent renders (filter changes, drilldowns, etc.).
   */
  const [chartsReady, setChartsReady] = useState(false);
  useEffect(() => {
    setChartsReady(true);
  }, []);
  /**
   * Per-render snapshot cache: each story's snapshots get parsed once into a
   * pre-sorted (ascending ts) array of `{ ts, snap }`. Lookups for
   * "latest snapshot at day D" then become an O(log n) binary search instead
   * of the previous O(n) reverse-linear-scan + per-call `new Date()` parse.
   *
   * At year scope (12 months, ~250 workdays, dozens of stories per epic,
   * 5+ time-series charts each iterating day-by-story) this is the hot path.
   */
  // App-wide team slug → logo URL map; used to paint team logos on chart
  // ticks (Workload Balance in team mode) and elsewhere this component
  // renders teams. Auto-loads once via the shared singleton store.
  const teamImagesBySlug = useTeamImages();

  const storySnapshotCache = useMemo(() => {
    const map = new Map<string, { ts: number; snap: StoryDailySnapshotItem }[]>();
    for (const init of initiatives) {
      for (const epic of init.epics ?? []) {
        for (const story of epic.userStories ?? []) {
          const snaps = story.snapshots ?? [];
          if (snaps.length === 0) continue;
          const parsed = snaps
            .map((s) => ({ ts: new Date(s.snapshotDate).getTime(), snap: s }))
            .sort((a, b) => a.ts - b.ts);
          map.set(story.id, parsed);
        }
      }
    }
    return map;
  }, [initiatives]);
  const latestSnapshotAtDayCached = useCallback(
    (story: UserStoryItem, day: Date) => {
      const arr = storySnapshotCache.get(story.id);
      if (!arr || arr.length === 0) return null;
      const cutoff = day.getTime();
      let lo = 0;
      let hi = arr.length - 1;
      let best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid].ts <= cutoff) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return best === -1 ? null : arr[best].snap;
    },
    [storySnapshotCache],
  );
  const [selectedEpicId, setSelectedEpicId] = useState<string>(initialSelectedEpicId ?? "all");
  const [epicInput, setEpicInput] = useState("");
  const [isEpicDropdownOpen, setIsEpicDropdownOpen] = useState(false);
  /** Status filter for the scope picker dropdown. Empty set = show all
   *  epics; otherwise only epics whose computed health is in the set are
   *  surfaced. Tied to the dropdown — clearing it shows everything again. */
  const [scopeHealthFilter, setScopeHealthFilter] = useState<Set<HealthStatus>>(() => new Set());
  const [showAllEpicSuggestions, setShowAllEpicSuggestions] = useState(false);
  const [burndownVisibleKeys, setBurndownVisibleKeys] = useState<string[]>([]);
  const [burnUpVisibleKeys, setBurnUpVisibleKeys] = useState<string[]>([]);
  const [cfdVisibleKeys, setCfdVisibleKeys] = useState<string[]>([]);
  /** Toggle for the dashed "Unscheduled" overlay line that sits above
   *  the CFD status bands. ON by default so the planner sees the
   *  uncommitted-work count without having to opt in. */
  const [cfdShowUnscheduled, setCfdShowUnscheduled] = useState(true);
  /** "Forecast" toggles per chart. When on, project a straight-line
   *  trend from today's actual point to its zero-crossing (burndown) /
   *  scope-crossing (burnup) using the current burn rate, and extend
   *  the chart's X-axis to include that projected completion day when
   *  it falls past the period end. */
  const [showBurndownForecast, setShowBurndownForecast] = useState(false);
  const [showBurnUpForecast, setShowBurnUpForecast] = useState(false);
  /** Master toggle for the focused-epic plan overlay shared by the
   *  Epic Scope Burndown + Burnup charts. Wraps three annotations as
   *  one switch so the planner can flip the "planned trajectory" on
   *  or off in one click:
   *   · Epic ideal line (orange dashed ramp)
   *   · "Due DD/MM" marker at plan-end
   *   · "Epic scheduled DD/MM" marker + connector at plan-start
   *  Defaults to ON so the chart still tells the same story
   *  out-of-the-box. Replaces the per-marker eye-with-slash hide
   *  affordance that lived on the "Epic scheduled" label. */
  const [showEpicPlanMarkers, setShowEpicPlanMarkers] = useState(true);
  const [statusDrilldownFilter, setStatusDrilldownFilter] = useState<string | null>(null);
  const [workloadDrilldownAssignee, setWorkloadDrilldownAssignee] = useState<string | null>(null);
  const [workloadDrilldownIsTeam, setWorkloadDrilldownIsTeam] = useState(false);
  /** Statuses hidden from the Workload Balance chart + drilldown table when
   *  the user clicks a status pill in the legend. Stored by WORKLOAD_BAR_SEGMENTS
   *  key (todo / inProgress / review / done). */
  const [workloadHiddenStatuses, setWorkloadHiddenStatuses] = useState<Set<string>>(() => new Set());
  /** Per-column filter + sort state for the workload drilldown table. */
  const [workloadDrilldownFilter, setWorkloadDrilldownFilter] = useState<DrilldownFilter>(EMPTY_DRILLDOWN_FILTER);
  const [workloadDrilldownSort, setWorkloadDrilldownSort] = useState<{ key: DrilldownSortKey; dir: "asc" | "desc" } | null>(null);
  /** Same for Month Load drilldown table. */
  const [monthLoadDrilldownFilter, setMonthLoadDrilldownFilter] = useState<DrilldownFilter>(EMPTY_DRILLDOWN_FILTER);
  const [monthLoadDrilldownSort, setMonthLoadDrilldownSort] = useState<{ key: DrilldownSortKey; dir: "asc" | "desc" } | null>(null);
  /** Same for the Status pie drilldown table. (Naming note:
   *  `statusDrilldownFilter` is the pie-slice status the user clicked
   *  (e.g. "To do"), distinct from `statusDrilldownColFilter` which is
   *  the per-column filter inside the drilldown table.) */
  const [statusDrilldownColFilter, setStatusDrilldownColFilter] = useState<DrilldownFilter>(EMPTY_DRILLDOWN_FILTER);
  const [statusDrilldownSort, setStatusDrilldownSort] = useState<{ key: DrilldownSortKey; dir: "asc" | "desc" } | null>(null);
  /** Epic-variant filter + sort for the status drilldown when it's
   *  showing epics (Quarter / Year insights). Columns: id, title,
   *  initiative, assignee, status. */
  const [statusDrilldownEpicFilter, setStatusDrilldownEpicFilter] = useState<EpicDrilldownFilter>(EMPTY_EPIC_DRILLDOWN_FILTER);
  const [statusDrilldownEpicSort, setStatusDrilldownEpicSort] = useState<{ key: EpicDrilldownSortKey; dir: "asc" | "desc" } | null>(null);
  /** User-selected mode for the status pie chart when no specific epic
   *  is pinned. "epics" shows the Epic Progress donut (epic-level
   *  status rollup); "stories" shows the Story status pie (per-story
   *  status counts). When an epic IS pinned, the chart is forced into
   *  "stories" mode since rolling that single epic up makes no sense.
   *  Defaults to "epics" — same as the legacy behaviour. */
  const [statusChartMode, setStatusChartMode] = useState<"epics" | "stories">("epics");
  const [monthLoadDrilldownAssignee, setMonthLoadDrilldownAssignee] = useState<string | null>(null);
  const [monthLoadDrilldownIsTeam, setMonthLoadDrilldownIsTeam] = useState(false);
  /** Per-epic expanded state shared across the Team/User Progress,
   *  Workload Balance, and Epic / Stories Progress drilldown modals.
   *  An epic id appears in the set only when the planner has clicked
   *  its chevron — default is empty so every epic group starts
   *  COLLAPSED. The set is cleared each time a drilldown closes so the
   *  next open starts collapsed too. */
  const [expandedDrilldownEpics, setExpandedDrilldownEpics] = useState<Set<string>>(() => new Set());
  // When the breadcrumb team filter changes (e.g. user switches between
  // "All teams" and a specific team while a drilldown is open), reset any
  // open drilldown — the assignee/team pinned by the previous filter is
  // unlikely to map onto the new story set, which would leave both tables
  // showing zero rows. Resetting forces the user to re-click into a bar
  // against the fresh scope.
  useEffect(() => {
    setWorkloadDrilldownAssignee(null);
    setWorkloadDrilldownIsTeam(false);
    setMonthLoadDrilldownAssignee(null);
    setMonthLoadDrilldownIsTeam(false);
  }, [filterEpicTeamIds]);
  const [selectedInitiativeId, setSelectedInitiativeId] = useState<string>(initialSelectedInitiativeId ?? "all");

  const scopeMonths = useMemo(() => {
    const base = periodMonths != null && periodMonths.length > 0 ? periodMonths : [month];
    return [...new Set(base)].sort((a, b) => a - b);
  }, [periodMonths, month]);
  const scopeStartMonth = scopeMonths[0] ?? month;
  const scopeEndMonth = scopeMonths[scopeMonths.length - 1] ?? month;
  const scopeLabel = periodLabel ?? (scopeMonths.length === 1 ? "Month" : scopeMonths.length === 12 ? "Year" : "Quarter");
  const isMultiPeriodInsights = scopeMonths.length > 1;
  // Keep status pie/drilldown consistent across Month, Quarter, and All Quarters insights.
  const isQuarterInsights = true;
  // Unfiltered epics for the initiative picker list
  const allScopeEpics = useMemo(
    () => collectPeriodEpics(analyticsInitiatives, scopeMonths, filterEpicTeamIds),
    [analyticsInitiatives, scopeMonths, filterEpicTeamIds],
  );
  // Picker-only epic pool. Deliberately ignores `filterEpicTeamIds` so
  // the "Epic / Initiative Scope" dropdown ALWAYS surfaces every epic
  // in the period — picking an epic auto-sets `insightsTeamIds`
  // upstream (see `handleInsightsScopeChange` in timeline-grid), and
  // that team filter was then quietly reducing the picker's own list
  // on re-open ("hidden epic children" bug). Analytics still use the
  // team-filtered `monthEpics` below.
  const pickerEpics = useMemo(
    () => collectPeriodEpics(analyticsInitiatives, scopeMonths, null),
    [analyticsInitiatives, scopeMonths],
  );
  const scopeInitiativeOptions = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ id: string; title: string }> = [];
    for (const { initiative } of pickerEpics) {
      if (!seen.has(initiative.id)) {
        seen.add(initiative.id);
        result.push({ id: initiative.id, title: initiative.title });
      }
    }
    return result;
  }, [pickerEpics]);
  const initiativeFilterId = selectedInitiativeId === "all" ? null : selectedInitiativeId;
  const monthEpics = useMemo(
    () => collectPeriodEpics(analyticsInitiatives, scopeMonths, filterEpicTeamIds, initiativeFilterId),
    [analyticsInitiatives, scopeMonths, filterEpicTeamIds, initiativeFilterId],
  );
  const monthStories = useMemo(
    () => collectPeriodStories(analyticsInitiatives, scopeMonths, filterEpicTeamIds, initiativeFilterId),
    [analyticsInitiatives, scopeMonths, filterEpicTeamIds, initiativeFilterId],
  );
  const epicComboOptions = useMemo(
    () =>
      pickerEpics.map(({ epic, initiative }) => {
        // Resolve display label for the epic's lane (e.g. "Mobile", "Platform").
        // Falls back to the raw team id if it isn't in MONTH_TEAM_COLUMNS, and
        // to null when the epic is unassigned — so the dropdown can show a
        // "Unassigned" hint rather than blank space.
        const teamLabel = epic.team
          ? (MONTH_TEAM_COLUMNS.find((t) => t.id === epic.team)?.label ?? epic.team)
          : null;
        // Health from the epic's planned bounds. Falls back to null when the
        // epic isn't scheduled — we hide the badge in that case rather than
        // making something up.
        let health: HealthStatus | null = null;
        let healthTooltip: string | null = null;
        let healthResult: ProgressResult | null = null;
        // Same shared verdict function the donut + Gantt bar + chart
        // corner all call — guarantees the picker badge can't say
        // "On Track" while the chart says "Watch".
        const v = computeEpicHealthVerdict(epic, planYear, progressBasis);
        if (v != null) {
          health = v.status;
          healthTooltip = formatHealthTooltip(v.result);
          healthResult = v.result;
        }
        return {
          id: epic.id,
          label: epic.title,
          initiativeId: initiative.id,
          initiativeTitle: initiative.title,
          initiativeIcon: initiative.icon && initiative.icon.trim().length > 0 ? initiative.icon : "📁",
          searchText: `${epic.title} ${initiative.title} ${teamLabel ?? ""}`.toLowerCase(),
          teamLabel,
          teamId: epic.team,
          health,
          healthResult,
          healthTooltip,
        };
      }),
    [pickerEpics, planYear, progressBasis],
  );
  const selectedEpicOption = useMemo(
    () => monthEpics.find(({ epic }) => epic.id === selectedEpicId) ?? null,
    [monthEpics, selectedEpicId],
  );
  /**
   * Compact metadata for the selected scope — surfaces as chips next to the
   * "Epic / Initiative Scope" picker so the user can see at a glance what they
   * pinned. Epic scope shows team + assignee + health; initiative scope shows
   * the roll-up health only (team would be an aggregate, deliberately omitted
   * per design — too noisy here, already visible in the dropdown).
   */
  const selectedEpicMeta = useMemo(() => {
    if (!selectedEpicOption) return null;
    return epicComboOptions.find((opt) => opt.id === selectedEpicOption.epic.id) ?? null;
  }, [selectedEpicOption, epicComboOptions]);
  const selectedInitiativeMeta = useMemo(() => {
    if (selectedInitiativeId === "all") return null;
    const epicsForInit = monthEpics
      .filter((row) => row.initiative.id === selectedInitiativeId)
      .map((row) => row.epic);
    if (epicsForInit.length === 0) return null;
    const childStatuses: HealthStatus[] = [];
    const aggregateStories = epicsForInit.flatMap((e) => e.userStories ?? []);
    for (const epic of epicsForInit) {
      const v = computeEpicHealthVerdict(epic, planYear, progressBasis);
      if (v != null) childStatuses.push(v.status);
    }
    // epicEst rollup works even with no child stories.
    if (progressBasis !== "epicEst" && aggregateStories.length === 0) return null;
    const scheduled = epicsForInit.filter((e) => e.planStartMonth != null && e.planEndMonth != null);
    const startMonth = scheduled.length > 0
      ? Math.min(...scheduled.map((e) => e.planStartMonth as number))
      : scopeStartMonth;
    const endMonth = scheduled.length > 0
      ? Math.max(...scheduled.map((e) => e.planEndMonth as number))
      : scopeEndMonth;
    const initStart = sprintStartDate(planYear, globalSprintFromMonthLane(startMonth, 1));
    const initEnd = sprintEndDate(planYear, globalSprintFromMonthLane(endMonth, 2));
    const initiativeOriginalEstSum = epicsForInit.reduce(
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
    return { health: h.status, tooltip: formatHealthTooltip(h), result: h };
  }, [selectedInitiativeId, monthEpics, planYear, scopeStartMonth, scopeEndMonth, progressBasis]);
  /** Subtitle rendered BELOW each chart title (Status / Workload / CFD /
   *  Month Load / Burndown / Burnup) when an epic or initiative is pinned.
   *  Reads as a second line of context, not an inline parens-wrapped
   *  parenthetical — the planner asked for the wider, more legible
   *  treatment. The chart-title sites wrap their `<h3>` + this node in a
   *  `flex-col` container so it lands on its own row beneath the title.
   *  Returns `null` (not `""`) so `{scopeTitleSuffix}` renders nothing
   *  cleanly when no scope is pinned. */
  const scopeTitleSuffix = useMemo<ReactNode>(() => {
    if (selectedEpicOption) {
      const epicId = selectedEpicOption.epic.id;
      return (
        <span className="inline-flex items-center gap-1 text-[12.5px] font-normal text-slate-500">
          <span className="truncate max-w-[24rem]">{selectedEpicOption.epic.title}</span>
          {onOpenEpic ? (
            <button
              type="button"
              onClick={() => onOpenEpic(epicId)}
              title="Open epic"
              aria-label="Open epic"
              className="inline-flex items-center justify-center text-slate-400 hover:text-slate-600"
            >
              <ExternalLink className="size-3.5" />
            </button>
          ) : null}
        </span>
      );
    }
    if (selectedInitiativeId !== "all") {
      const init = scopeInitiativeOptions.find((i) => i.id === selectedInitiativeId);
      if (init) {
        const initId = init.id;
        return (
          <span className="inline-flex items-center gap-1 text-[12.5px] font-normal text-slate-500">
            <Zap className="size-3.5 shrink-0 text-slate-400" aria-hidden />
            <span className="truncate max-w-[24rem]">{init.title}</span>
            {onOpenInitiative ? (
              <button
                type="button"
                onClick={() => onOpenInitiative(initId)}
                title="Open initiative"
                aria-label="Open initiative"
                className="inline-flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <ExternalLink className="size-3.5" />
              </button>
            ) : null}
          </span>
        );
      }
    }
    return null;
  }, [selectedEpicOption, selectedInitiativeId, scopeInitiativeOptions, onOpenEpic, onOpenInitiative]);
  useEffect(() => {
    if (!initialSelectedEpicId) return;
    setSelectedEpicId(initialSelectedEpicId);
    // Search ALL initiatives' epics for the title — not just monthEpics —
    // so we still surface the title when the requested epic is outside the
    // current month/team-filter scope (e.g. the user clicked Insights from
    // an epic panel for an epic that doesn't fall in the active period).
    let title: string | null = null;
    for (const init of initiatives) {
      const found = (init.epics ?? []).find((e) => e.id === initialSelectedEpicId);
      if (found) { title = found.title; break; }
    }
    setEpicInput(title ?? "");
  }, [initialSelectedEpicId, initiatives]);
  useEffect(() => {
    if (!initialSelectedInitiativeId) return;
    setSelectedInitiativeId(initialSelectedInitiativeId);
    const init = scopeInitiativeOptions.find((i) => i.id === initialSelectedInitiativeId);
    if (init) setEpicInput(init.title);
  }, [initialSelectedInitiativeId, scopeInitiativeOptions]);
  // Clear epic selection when the initiative filter changes and the epic is
  // no longer in scope. Skip when the selection matches the externally-
  // requested `initialSelectedEpicId` — otherwise a "View Insights" click
  // from an epic panel briefly shows the title and then this effect wipes
  // it on the next render when monthEpics doesn't include that epic.
  useEffect(() => {
    if (selectedEpicId === "all") return;
    if (initialSelectedEpicId && selectedEpicId === initialSelectedEpicId) return;
    if (!monthEpics.some(({ epic }) => epic.id === selectedEpicId)) {
      setSelectedEpicId("all");
      setEpicInput("");
    }
  }, [monthEpics, selectedEpicId, initialSelectedEpicId]);
  // Only call onScopeChange when the SCOPE itself actually changes — not when
  // `epicComboOptions` / `scopeInitiativeOptions` re-derive (which happens
  // whenever `filterEpicTeamIds` changes upstream). Without this guard,
  // adjusting the breadcrumb team filter would trigger an `onScopeChange(null,
  // null, null)` call, and TimelineGrid's `handleInsightsScopeChange`
  // interprets that as "no scope selected" and resets `insightsTeamIds` back
  // to `[]` — wiping the team filter the user just set.
  const lastScopeRef = useRef<{ type: "epic" | "initiative" | null; id: string | null }>({
    type: null,
    id: null,
  });
  useEffect(() => {
    if (!onScopeChange) return;
    const nextType: "epic" | "initiative" | null =
      selectedEpicId !== "all" ? "epic" : selectedInitiativeId !== "all" ? "initiative" : null;
    const nextId: string | null =
      nextType === "epic" ? selectedEpicId : nextType === "initiative" ? selectedInitiativeId : null;
    if (lastScopeRef.current.type === nextType && lastScopeRef.current.id === nextId) return;
    lastScopeRef.current = { type: nextType, id: nextId };
    if (nextType === "epic") {
      const selected = epicComboOptions.find((opt) => opt.id === nextId);
      onScopeChange("epic", nextId, selected?.label ?? null);
    } else if (nextType === "initiative") {
      const init = scopeInitiativeOptions.find((i) => i.id === nextId);
      onScopeChange("initiative", nextId, init?.title ?? null);
    } else {
      onScopeChange(null, null, null);
    }
  }, [selectedEpicId, selectedInitiativeId, epicComboOptions, scopeInitiativeOptions, onScopeChange]);
  const filteredEpicOptions = useMemo(() => {
    let opts = epicComboOptions;
    const query = showAllEpicSuggestions ? "" : epicInput.trim().toLowerCase();
    if (query) opts = opts.filter((opt) => opt.searchText.includes(query));
    // Health filter — empty set means "show all"; otherwise only surface
    // epics whose computed status is in the set.
    if (scopeHealthFilter.size > 0) {
      opts = opts.filter((opt) => opt.health != null && scopeHealthFilter.has(opt.health));
    }
    return opts;
  }, [epicComboOptions, epicInput, showAllEpicSuggestions, scopeHealthFilter]);
  const filteredEpicGroups = useMemo(() => {
    const groups: Array<{
      initiativeId: string;
      initiativeTitle: string;
      initiativeIcon: string;
      epics: typeof filteredEpicOptions;
      health: HealthStatus | null;
      healthTooltip: string | null;
    }> = [];
    const byInitiative = new Map<string, number>();
    filteredEpicOptions.forEach((opt) => {
      const idx = byInitiative.get(opt.initiativeId);
      if (idx == null) {
        byInitiative.set(opt.initiativeId, groups.length);
        groups.push({
          initiativeId: opt.initiativeId,
          initiativeTitle: opt.initiativeTitle,
          initiativeIcon: opt.initiativeIcon,
          epics: [opt],
          health: null,
          healthTooltip: null,
        });
      } else {
        groups[idx]!.epics.push(opt);
      }
    });
    // For each initiative group: a rollup health from the matching
    // InitiativeItem. We resolve the initiative via `monthEpics` since the
    // filtered options only carry the id.
    for (const group of groups) {
      // Find the matching initiative row in monthEpics. Use the FIRST epic's
      // initiative as the source — they all share the same one by construction.
      const initRow = monthEpics.find((row) => row.initiative.id === group.initiativeId);
      if (!initRow) continue;
      const initiative = initRow.initiative;
      const epicsForInit = monthEpics.filter((row) => row.initiative.id === group.initiativeId).map((row) => row.epic);
      const childStatuses: HealthStatus[] = [];
      const aggregateStories = epicsForInit.flatMap((epic) => epic.userStories ?? []);
      for (const epic of epicsForInit) {
        const v = computeEpicHealthVerdict(epic, planYear, progressBasis);
        if (v != null) childStatuses.push(v.status);
      }
      // The initiative's own bar bounds — use the union of its epics, mirroring
      // how the year-Gantt rolls up. Fall back to the period bounds when the
      // initiative has no scheduled epics so we still get a meaningful date.
      const scheduledEpics = epicsForInit.filter((e) => e.planStartMonth != null && e.planEndMonth != null);
      const periodStartMonth = scopeStartMonth;
      const periodEndMonth = scopeEndMonth;
      const initStartMonth = scheduledEpics.length > 0
        ? Math.min(...scheduledEpics.map((e) => e.planStartMonth as number))
        : periodStartMonth;
      const initEndMonth = scheduledEpics.length > 0
        ? Math.max(...scheduledEpics.map((e) => e.planEndMonth as number))
        : periodEndMonth;
      const initStart = sprintStartDate(planYear, globalSprintFromMonthLane(initStartMonth, 1));
      const initEnd = sprintEndDate(planYear, globalSprintFromMonthLane(initEndMonth, 2));
      const initiativeOriginalEstSum = epicsForInit.reduce(
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
      if (progressBasis === "epicEst" || aggregateStories.length > 0) {
        group.health = initHealth.status;
        group.healthTooltip = `${initiative.title} · ${formatHealthTooltip(initHealth)}`;
      }
    }
    return groups;
  }, [filteredEpicOptions, monthEpics, planYear, scopeStartMonth, scopeEndMonth, progressBasis]);
  const selectedWorkloadStatuses = useMemo<WorkloadStatusKey[]>(
    () =>
      workloadStatusFilters.includes("all")
        ? ["todo", "inProgress", "review", "done"]
        : (workloadStatusFilters.filter((v) => v !== "unassigned") as WorkloadStatusKey[]),
    [workloadStatusFilters],
  );
  const selectedShowUnassigned = useMemo(
    () => workloadStatusFilters.includes("all") || workloadStatusFilters.includes("unassigned"),
    [workloadStatusFilters],
  );
  const toggleWorkloadStatusFilter = (value: WorkloadFilterKey) => {
    setWorkloadStatusFilters((prev) => {
      if (value === "all") return ["all"];
      const base = prev.filter((v) => v !== "all") as WorkloadFilterKey[];
      if (base.includes(value)) {
        const next = base.filter((v) => v !== value);
        return next.length > 0 ? next : ["all"];
      }
      return [...base, value];
    });
  };
  useEffect(() => {
    if (selectedEpicId !== "all") {
      const selected = epicComboOptions.find((opt) => opt.id === selectedEpicId);
      if (!selected) {
        // Sticky View-Insights deep link: if the requested epic is the
        // externally-injected `initialSelectedEpicId`, don't clear — fall
        // back to a flat search across ALL initiatives for the title so
        // the picker still shows it even when filters exclude the epic.
        if (initialSelectedEpicId && selectedEpicId === initialSelectedEpicId) {
          let title: string | null = null;
          for (const init of initiatives) {
            const found = (init.epics ?? []).find((e) => e.id === selectedEpicId);
            if (found) { title = found.title; break; }
          }
          setEpicInput(title ?? "");
          return;
        }
        setSelectedEpicId("all");
        setEpicInput("");
      } else {
        setEpicInput(selected.label);
      }
      return;
    }
    if (selectedInitiativeId !== "all") {
      const init = scopeInitiativeOptions.find((i) => i.id === selectedInitiativeId);
      setEpicInput(init?.title ?? "");
      return;
    }
    setEpicInput("");
  }, [selectedEpicId, selectedInitiativeId, epicComboOptions, scopeInitiativeOptions, initialSelectedEpicId, initiatives]);

  const analytics = useMemo(() => {
    const scopeStories =
      selectedEpicOption != null ? (selectedEpicOption.epic.userStories ?? []) : monthStories;
    // When an epic is focused in a multi-period view (Portfolio /
    // all-quarters insights), the "Stories Progress" donut represents
    // the WHOLE epic's work, so unscheduled stories must count — they
    // belong to the epic regardless of which sprint they slot into.
    // Otherwise the donut understates the to-do bucket and disagrees
    // with the Epic Scope Burndown's Total scope value. The
    // `sprint != null` filter still applies in single-quarter / sprint
    // scope, where unscheduled stories aren't part of the period.
    const scheduledStories = selectedEpicOption != null && isMultiPeriodInsights
      ? scopeStories
      : scopeStories.filter((story) => story.sprint != null);
    // Donut "Stories Progress" always counts the full scope — unscheduled
    // stories belong to the epic regardless of sprint assignment and need
    // to land in their current status bucket so the donut reconciles with
    // the Epic Scope Burnup. Workload-by-assignee + month burndown still
    // use `scheduledStories` (their unscheduled-inclusion follows the
    // earliest-quarter pinning rule handled by `collectWorkloadStories`).
    const donutStories = scopeStories;
    // Month burndown/flow scope: stories that are open at month start.
    const openAtMonthStartStories = scheduledStories.filter(
      (story) => story.status === "todo" || story.status === "inProgress",
    );
    const openStories = openAtMonthStartStories;
    const completedStories = scheduledStories.filter(
      (story) => story.status === "review" || story.status === "done",
    );

    const statusCounts = {
      todo: donutStories.filter((story) => story.status === "todo").length,
      inProgress: donutStories.filter((story) => story.status === "inProgress").length,
      review: donutStories.filter((story) => story.status === "review").length,
      done: donutStories.filter((story) => story.status === "done").length,
    };
    // The "Unscheduled" bucket was a workspace-wide
    // `story.sprint == null` tally that doesn't belong on a
    // per-sprint donut — it polluted the Sprint Insights donut
    // with stories that were never part of the picked sprint. The
    // four real status buckets are the only honest categories.
    const statusPie = [
      { name: "To do", value: statusCounts.todo },
      { name: "In progress", value: statusCounts.inProgress },
      { name: "Review / Testing", value: statusCounts.review },
      { name: "Done", value: statusCounts.done },
    ];

    const periodStartDate = new Date(planYear, scopeStartMonth - 1, 1);
    const periodEndDate = new Date(planYear, scopeEndMonth, 0);
    const totalDays =
      Math.floor((periodEndDate.getTime() - periodStartDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const dayDates = Array.from({ length: totalDays }, (_, idx) => {
      const day = new Date(periodStartDate);
      day.setDate(periodStartDate.getDate() + idx);
      return day;
    });
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const monthStart = periodStartDate.getTime();
    const monthEnd = periodEndDate.getTime();
    let today1Based = 1;
    if (startToday >= monthEnd) today1Based = totalDays;
    else if (startToday > monthStart) {
      today1Based = Math.min(totalDays, Math.max(1, Math.floor((startToday - monthStart) / 86400000) + 1));
    }

    const startValue =
      metric === "daysLeft"
        ? openAtMonthStartStories.reduce((sum, s) => sum + (s.estimatedDays ?? s.daysLeft ?? 1), 0)
        : openAtMonthStartStories.length;
    const actualRemaining =
      metric === "daysLeft"
        ? openAtMonthStartStories.reduce((sum, s) => sum + Math.max(0, s.daysLeft ?? 0), 0)
        : openAtMonthStartStories.length;
    const roundBurndown = (n: number) => (metric === "storyCount" ? Math.round(n) : Number(n.toFixed(1)));
    const burndown = dayDates.map((cal, idx) => {
      const dayIdx = idx + 1;
      const ideal = startValue * (1 - idx / Math.max(totalDays - 1, 1));
      const actual =
        dayIdx <= today1Based
          ? startValue - (startValue - actualRemaining) * ((dayIdx - 1) / Math.max(today1Based - 1, 1))
          : null;
      return {
        labelShort: flowChartDayLabel(cal),
        ideal: roundBurndown(ideal),
        actual: actual == null ? null : roundBurndown(actual),
        isToday: new Date(cal.getFullYear(), cal.getMonth(), cal.getDate()).getTime() === startToday,
      };
    });

    // Workload Balance / User Progress reaches across the "scheduled
    // only" filter to surface unscheduled-but-assigned work — but only
    // in quarter / all-quarters scope, and pinned to the EARLIEST
    // quarter the parent epic touches so each unscheduled story is
    // counted exactly once across the year (no double-counting in
    // Q2+Q3 for a multi-quarter epic). The sprint / single-month view
    // stays kanban-only — the truth-table rule we settled with the
    // user. When a single epic is focused, `scheduledStories` already
    // equals `scopeStories` (unfiltered) in multi-period views, so the
    // augmentation only kicks in for the un-focused workspace view.
    const workloadStories = (() => {
      if (!isMultiPeriodInsights || selectedEpicOption != null) return scheduledStories;
      const targetQuarter = scopeMonths.length === 3
        ? quarterOfMonth(scopeStartMonth)
        : null;
      const extra: UserStoryItem[] = [];
      for (const { epic } of monthEpics) {
        if (targetQuarter != null) {
          const earliest = epicEarliestQuarter(epic, scopeStartMonth);
          if (earliest !== targetQuarter) continue;
        }
        for (const story of epic.userStories ?? []) {
          if (story.sprint != null) continue;
          // Mirror `collectPeriodStories`'s team filter so unscheduled
          // stories assigned to filtered-out teams don't sneak in.
          if (filterEpicTeamIds?.length) {
            const team = story.team ?? epic.team ?? "";
            if (!filterEpicTeamIds.includes(team)) continue;
          }
          extra.push(story);
        }
      }
      return extra.length > 0 ? scheduledStories.concat(extra) : scheduledStories;
    })();
    const byAssignee = new Map<
      string,
      {
        openCount: number;
        daysLeftTotal: number;
        estimatedTotal: number;
        storiesByStatus: { todo: number; inProgress: number; review: number; done: number };
      }
    >();
    for (const story of workloadStories) {
      const assignee = story.assignee?.trim() || "Unassigned";
      const row =
        byAssignee.get(assignee) ?? {
          openCount: 0,
          daysLeftTotal: 0,
          estimatedTotal: 0,
          storiesByStatus: { todo: 0, inProgress: 0, review: 0, done: 0 },
        };
      if (story.status === "todo") row.storiesByStatus.todo += 1;
      else if (story.status === "inProgress") row.storiesByStatus.inProgress += 1;
      else if (story.status === "review") row.storiesByStatus.review += 1;
      else if (story.status === "done") row.storiesByStatus.done += 1;
      row.estimatedTotal += Math.max(0, story.estimatedDays ?? story.daysLeft ?? 0);
      if (story.status === "todo" || story.status === "inProgress") {
        row.openCount += 1;
        row.daysLeftTotal += Math.max(0, story.daysLeft ?? 0);
      }
      byAssignee.set(assignee, row);
    }
    const workloadByAssignee = [...byAssignee.entries()]
      .map(([assignee, v]) => {
        const selectedStoryCount = selectedWorkloadStatuses.reduce((sum, key) => sum + v.storiesByStatus[key], 0);
        return { assignee, ...v, selectedStoryCount };
      })
      .filter((v) => v.selectedStoryCount > 0 || (selectedShowUnassigned && v.assignee === "Unassigned"))
      .sort(
        (a, b) =>
          b.selectedStoryCount - a.selectedStoryCount ||
          b.daysLeftTotal - a.daysLeftTotal ||
          a.assignee.localeCompare(b.assignee),
      );
    const workloadMaxStoryTotal = Math.max(
      1,
      ...workloadByAssignee.map(
        (item) => item.selectedStoryCount,
      ),
    );
    const monthDaysLeft = Math.max(0, totalDays - (today1Based - 1));
    const workloadCapacityByAssignee = workloadByAssignee
      .map((row) => {
        const utilizationPct =
          monthDaysLeft > 0 ? (row.daysLeftTotal / monthDaysLeft) * 100 : row.daysLeftTotal > 0 ? 999 : 0;
        return {
          assignee: row.assignee,
          estimatedTotal: row.estimatedTotal,
          daysLeftTotal: row.daysLeftTotal,
          utilizationPct,
          isOverCapacity: monthDaysLeft > 0 ? row.daysLeftTotal > monthDaysLeft : row.daysLeftTotal > 0,
        };
      })
      .sort((a, b) => b.utilizationPct - a.utilizationPct || b.daysLeftTotal - a.daysLeftTotal);

    const total = openAtMonthStartStories.length;
    const doneFinal = Math.min(total, completedStories.filter((s) => s.status === "review").length);
    const approvedFinal = Math.min(Math.max(0, total - doneFinal), completedStories.filter((s) => s.status === "done").length);
    const inProgressBaseNow = openAtMonthStartStories.filter((s) => s.status === "inProgress").length;
    const isCurrentMonth =
      new Date().getFullYear() === planYear && new Date().getMonth() + 1 === month;
    const flowSprintTrendData = dayDates.map((dayDate, dayIndex) => {
      const dayInMonth = dayIndex + 1;
      const elapsedDays = isCurrentMonth ? today1Based : totalDays;
      const progress = dayInMonth <= elapsedDays ? (dayInMonth - 1) / Math.max(elapsedDays - 1, 1) : null;
      const done = progress == null ? null : Math.round(approvedFinal * progress);
      const review = progress == null ? null : Math.round(doneFinal * progress);
      const inProgressBase = progress == null ? null : Math.round(inProgressBaseNow * (1 - progress * 0.55));
      const doneSafe = review ?? 0;
      const approvedSafe = done ?? 0;
      const inProgressSafe = inProgressBase == null ? 0 : Math.min(Math.max(0, total - approvedSafe - doneSafe), inProgressBase);
      const todoSafe = Math.max(0, total - approvedSafe - doneSafe - inProgressSafe);
      return {
        dayInMonth,
        labelShort: flowChartDayLabel(dayDate),
        isToday: new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate()).getTime() === startToday,
        todo: progress == null ? null : todoSafe,
        inProgress: progress == null ? null : inProgressSafe,
        review: progress == null ? null : doneSafe,
        done: progress == null ? null : approvedSafe,
      };
    });

    // Team-level aggregation — when 0 or 2+ teams selected (not exactly 1)
    const showTeamMode = !filterEpicTeamIds?.length || filterEpicTeamIds.length !== 1;
    type TeamRow = { teamId: string | null; teamLabel: string; storiesByStatus: { todo: number; inProgress: number; review: number; done: number }; daysLeftTotal: number; estimatedTotal: number };
    let workloadByTeam: TeamRow[] = [];
    if (showTeamMode) {
      const byTeam = new Map<string, TeamRow>();
      // Mirror `collectPeriodStories` / `scopedStories` — only count
      // stories from EPICS that themselves overlap the scope months,
      // not just from initiatives that do. Otherwise the chart shows
      // a team bar (its parent initiative spans the period) while
      // the drilldown returns 0 (the team's epics don't), producing
      // dead-end clicks.
      const minMonth = Math.min(...scopeMonths);
      const maxMonth = Math.max(...scopeMonths);
      for (const initiative of initiatives) {
        // No initiative-status filter — see collectPeriodEpics for
        // rationale. Still skip initiatives with no plan dates since
        // the workload aggregation uses them as fallback for epics
        // with missing dates.
        if (initiative.startMonth == null || initiative.endMonth == null) continue;
        for (const epic of initiative.epics ?? []) {
          const teamId = epic.team ?? null;
          if (filterEpicTeamIds?.length && !filterEpicTeamIds.includes(teamId ?? "")) continue;
          const epicStart = epic.planStartMonth ?? initiative.startMonth;
          const epicEnd = epic.planEndMonth ?? initiative.endMonth;
          if (epicStart == null || epicEnd == null) continue;
          if (epicEnd < minMonth || epicStart > maxMonth) continue;
          const teamKey = teamId ?? "__unassigned__";
          const teamLabel = MONTH_TEAM_COLUMNS.find((t) => t.id === teamId)?.label ?? "Unassigned";
          for (const story of epic.userStories ?? []) {
            if (story.sprint == null) continue;
            const row = byTeam.get(teamKey) ?? { teamId, teamLabel, storiesByStatus: { todo: 0, inProgress: 0, review: 0, done: 0 }, daysLeftTotal: 0, estimatedTotal: 0 };
            if (story.status === "todo") row.storiesByStatus.todo += 1;
            else if (story.status === "inProgress") row.storiesByStatus.inProgress += 1;
            else if (story.status === "review") row.storiesByStatus.review += 1;
            else if (story.status === "done") row.storiesByStatus.done += 1;
            row.estimatedTotal += Math.max(0, story.estimatedDays ?? story.daysLeft ?? 0);
            if (story.status === "todo" || story.status === "inProgress") {
              row.daysLeftTotal += Math.max(0, story.daysLeft ?? 0);
            }
            byTeam.set(teamKey, row);
          }
        }
      }
      workloadByTeam = [...byTeam.values()].sort((a, b) => a.teamLabel.localeCompare(b.teamLabel));
    }

    return {
      statusPie,
      burndown,
      workloadByAssignee,
      workloadByTeam,
      workloadMaxStoryTotal,
      flowSprintTrendData,
      openStories: openStories.length,
      atRiskStories: openStories.filter((story) => (story.daysLeft ?? 0) < 0).length,
      workloadCapacityByAssignee,
      monthDaysLeft,
    };
  }, [
    initiatives,
    month,
    scopeStartMonth,
    scopeEndMonth,
    planYear,
    filterEpicTeamIds,
    metric,
    selectedEpicOption,
    selectedWorkloadStatuses,
    selectedShowUnassigned,
    monthStories,
  ]);

  const pieLegendItems = useMemo(() => analytics.statusPie.filter((x) => x.value > 0), [analytics.statusPie]);
  const scopedEpics = useMemo(
    () => (selectedEpicOption != null ? [selectedEpicOption.epic] : monthEpics.map((row) => row.epic)),
    [selectedEpicOption, monthEpics],
  );
  const epicStatusById = useMemo(() => {
    const out = new Map<string, string>();
    for (const epic of scopedEpics) out.set(epic.id, deriveEpicStatus(epic));
    return out;
  }, [scopedEpics]);
  const epicStatusPie = useMemo(() => {
    const counts = { unscheduled: 0, todo: 0, inProgress: 0, review: 0, done: 0 };
    for (const status of epicStatusById.values()) {
      if (status === "Unscheduled") counts.unscheduled += 1;
      else if (status === "To do") counts.todo += 1;
      else if (status === "In progress") counts.inProgress += 1;
      else if (status === "Review / Testing") counts.review += 1;
      else if (status === "Done") counts.done += 1;
    }
    return [
      { name: "Unscheduled", value: counts.unscheduled },
      { name: "To do", value: counts.todo },
      { name: "In progress", value: counts.inProgress },
      { name: "Review / Testing", value: counts.review },
      { name: "Done", value: counts.done },
    ];
  }, [epicStatusById]);
  // Show epics in the status pie when (a) we're on a quarter-style
  // insights view AND (b) no specific epic is pinned (rolling up a
  // single epic into its own status is meaningless) AND (c) the user
  // hasn't toggled the chart into "stories" mode via the header
  // switch. The switch is the new affordance — letting planners flip
  // between epic-level + story-level status drilldowns without
  // changing the picked scope.
  const statusChartShowsEpics = isQuarterInsights && selectedEpicOption == null && statusChartMode === "epics";
  const statusChartToggleAvailable = isQuarterInsights && selectedEpicOption == null;
  const pieData = statusChartShowsEpics ? epicStatusPie.filter((x) => x.value > 0) : pieLegendItems;
  const pieTotal = pieData.reduce((sum, item) => sum + item.value, 0);
  const scopedStories = useMemo(
    () => (selectedEpicOption != null ? (selectedEpicOption.epic.userStories ?? []) : monthStories),
    [selectedEpicOption, monthStories],
  );
  // Hoisted ABOVE the drilldown story memos so those memos can reference
  // it for their search/sort key lookups without hitting a TDZ error.
  const scopedStoryDisplayIds = useMemo(() => {
    const rows = initiatives
      .flatMap((initiative) => initiative.epics ?? [])
      .flatMap((epic) => epic.userStories ?? [])
      .sort((a, b) => {
      const aTs = new Date(a.createdAt).getTime();
      const bTs = new Date(b.createdAt).getTime();
      if (aTs !== bTs) return aTs - bTs;
      return a.title.localeCompare(b.title);
    });
    const map = new Map<string, string>();
    rows.forEach((story, idx) => {
      map.set(story.id, `US-${String(idx + 1).padStart(2, "0")}`);
    });
    return map;
  }, [initiatives]);
  // Also hoisted (used by the epic-variant of the status drilldown).
  const scopedEpicDisplayIdsHoisted = useMemo(() => {
    const rows = initiatives
      .flatMap((initiative) => initiative.epics ?? [])
      .sort((a, b) => {
        const aTs = new Date(a.createdAt).getTime();
        const bTs = new Date(b.createdAt).getTime();
        if (aTs !== bTs) return aTs - bTs;
        return a.title.localeCompare(b.title);
      });
    const map = new Map<string, string>();
    rows.forEach((epic, idx) => {
      map.set(epic.id, `EPIC-${String(idx + 1).padStart(2, "0")}`);
    });
    return map;
  }, [initiatives]);
  const initiativeTitleByEpicIdHoisted = useMemo(() => {
    const map = new Map<string, string>();
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        map.set(epic.id, initiative.title);
      }
    }
    return map;
  }, [initiatives]);
  /**
   * Raw pool holds the FULL story scope; the clicked slice / center pre-fills
   * the column filter instead of pre-cutting the data, so the user can clear
   * the Status filter to see every story without closing the modal.
   */
  const statusDrilldownStoriesRaw = useMemo(
    () => (statusDrilldownFilter == null ? [] : scopedStories),
    [statusDrilldownFilter, scopedStories],
  );
  const statusDrilldownStories = useMemo(
    () => applyDrilldownFilterSort(
      statusDrilldownStoriesRaw,
      statusDrilldownColFilter,
      statusDrilldownSort,
      (id) => scopedStoryDisplayIds.get(id) ?? id.slice(0, 8),
      (sprint) => storySprintDisplayLabel(sprint, scopeStartMonth),
    ),
    [statusDrilldownStoriesRaw, statusDrilldownColFilter, statusDrilldownSort, scopedStoryDisplayIds, scopeStartMonth],
  );
  const statusDrilldownEpicsRaw = useMemo(
    () => (!statusChartShowsEpics || statusDrilldownFilter == null ? [] : scopedEpics),
    [statusChartShowsEpics, statusDrilldownFilter, scopedEpics],
  );
  const statusDrilldownEpics = useMemo(
    () => applyEpicDrilldownFilterSort(
      statusDrilldownEpicsRaw,
      statusDrilldownEpicFilter,
      statusDrilldownEpicSort,
      (id) => scopedEpicDisplayIdsHoisted.get(id) ?? id.slice(0, 8),
      (id) => initiativeTitleByEpicIdHoisted.get(id) ?? "—",
      (id) => epicStatusById.get(id) ?? "To do",
    ),
    [statusDrilldownEpicsRaw, statusDrilldownEpicFilter, statusDrilldownEpicSort, scopedEpicDisplayIdsHoisted, initiativeTitleByEpicIdHoisted, epicStatusById],
  );
  const statusDrilldownRowCount = statusChartShowsEpics ? statusDrilldownEpics.length : statusDrilldownStories.length;
  const tableTargetRows = 6;
  const statusDrilldownEmptyRows = Math.max(0, tableTargetRows - statusDrilldownRowCount);
  // Native scrollbar handles all of this now; the up/down arrow
  // chrome that used to manage `canScroll*` state + scroll-by helpers
  // here was deleted along with its render block.

  // Title swaps with statusChartShowsEpics (which is now driven by the
  // user toggle when available). When the toggle is OFF (e.g. an epic
  // is pinned), the chart always shows user-story progress and the
  // title reads accordingly — same legacy wording.
  const statusPanelTitle = statusChartShowsEpics ? "Epic Progress" : "Stories Progress";
  // scopedStoryDisplayIds was moved above the drilldown story memos to avoid
  // a TDZ error — keep the original definition site untouched aside from this
  // pointer comment so anyone scrolling here knows where to find it.
  const scopedEpicDisplayIds = useMemo(() => {
    const rows = initiatives
      .flatMap((initiative) => initiative.epics ?? [])
      .sort((a, b) => {
      const aTs = new Date(a.createdAt).getTime();
      const bTs = new Date(b.createdAt).getTime();
      if (aTs !== bTs) return aTs - bTs;
      return a.title.localeCompare(b.title);
    });
    const map = new Map<string, string>();
    rows.forEach((epic, idx) => {
      map.set(epic.id, `EPIC-${String(idx + 1).padStart(2, "0")}`);
    });
    return map;
  }, [initiatives]);
  const epicTeamByStoryId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        for (const story of epic.userStories ?? []) {
          // Per-story override wins; null falls back to epic team.
          // Name kept as `epicTeamByStoryId` for stability, but the
          // resolved value is the story's EFFECTIVE team now.
          map.set(story.id, story.team ?? epic.team ?? null);
        }
      }
    }
    return map;
  }, [initiatives]);
  // Unscheduled stories that qualify for the current quarter/year view
  // under the earliest-quarter pinning rule (Phase 4b). Drives both
  // the Workload Balance and the Team/User Progress drilldown tables so
  // each story shows up under exactly the same view its chart bar lit.
  // Quarter view  → include where `epicEarliestQuarter === thisQuarter`.
  // Year view     → include all unscheduled (no quarter restriction).
  // Sprint / month → empty set (kanban-only, no unscheduled bleed-through).
  // Focused-epic in multi-period → consumers use `scopedStories` directly
  // (already the whole epic, scheduled + unscheduled).
  const quarterPinnedUnscheduledStories = useMemo<UserStoryItem[]>(() => {
    if (!isMultiPeriodInsights || selectedEpicOption != null) return [];
    const targetQuarter = scopeMonths.length === 3
      ? quarterOfMonth(scopeStartMonth)
      : null;
    const out: UserStoryItem[] = [];
    for (const { epic } of monthEpics) {
      if (targetQuarter != null) {
        const earliest = epicEarliestQuarter(epic, scopeStartMonth);
        if (earliest !== targetQuarter) continue;
      }
      for (const story of epic.userStories ?? []) {
        if (story.sprint != null) continue;
        if (filterEpicTeamIds?.length) {
          const team = story.team ?? epic.team ?? "";
          if (!filterEpicTeamIds.includes(team)) continue;
        }
        out.push(story);
      }
    }
    return out;
  }, [isMultiPeriodInsights, selectedEpicOption, scopeMonths.length, scopeStartMonth, monthEpics, filterEpicTeamIds]);
  const workloadDrilldownStoriesRaw = useMemo(() => {
    if (workloadDrilldownAssignee == null) return [];
    // Focused-epic multi-period: `scopedStories` already covers the whole
    // epic (scheduled + unscheduled), so the drilldown shouldn't drop
    // the unscheduled rows — they're real load for this epic.
    if (isMultiPeriodInsights && selectedEpicOption != null) {
      return scopedStories.slice().sort((a, b) => a.title.localeCompare(b.title));
    }
    const scheduled = scopedStories.filter((story) => story.sprint != null);
    const combined = isMultiPeriodInsights
      ? scheduled.concat(quarterPinnedUnscheduledStories)
      : scheduled;
    return combined.sort((a, b) => a.title.localeCompare(b.title));
  }, [workloadDrilldownAssignee, scopedStories, isMultiPeriodInsights, selectedEpicOption, quarterPinnedUnscheduledStories]);
  const workloadDrilldownStories = useMemo(
    () => applyDrilldownFilterSort(
      workloadDrilldownStoriesRaw,
      workloadDrilldownFilter,
      workloadDrilldownSort,
      (id) => scopedStoryDisplayIds.get(id) ?? id.slice(0, 8),
      (sprint) => storySprintDisplayLabel(sprint, scopeStartMonth),
      (id) => {
        const teamId = epicTeamByStoryId.get(id) ?? "";
        return monthTeamLabelForId(teamId) ?? (teamId || "—");
      },
    ),
    [workloadDrilldownStoriesRaw, workloadDrilldownFilter, workloadDrilldownSort, scopedStoryDisplayIds, scopeStartMonth, epicTeamByStoryId],
  );
  const workloadDrilldownEmptyRows = Math.max(0, tableTargetRows - workloadDrilldownStories.length);
  const monthLoadDrilldownStoriesRaw = useMemo(() => {
    if (monthLoadDrilldownAssignee == null) return [];
    if (isMultiPeriodInsights && selectedEpicOption != null) {
      return scopedStories.slice().sort((a, b) => a.title.localeCompare(b.title));
    }
    const scheduled = scopedStories.filter((story) => story.sprint != null);
    const combined = isMultiPeriodInsights
      ? scheduled.concat(quarterPinnedUnscheduledStories)
      : scheduled;
    return combined.sort((a, b) => a.title.localeCompare(b.title));
  }, [monthLoadDrilldownAssignee, scopedStories, isMultiPeriodInsights, selectedEpicOption, quarterPinnedUnscheduledStories]);
  const monthLoadDrilldownStories = useMemo(
    () => applyDrilldownFilterSort(
      monthLoadDrilldownStoriesRaw,
      monthLoadDrilldownFilter,
      monthLoadDrilldownSort,
      (id) => scopedStoryDisplayIds.get(id) ?? id.slice(0, 8),
      (sprint) => storySprintDisplayLabel(sprint, scopeStartMonth),
      (id) => {
        const teamId = epicTeamByStoryId.get(id) ?? "";
        return monthTeamLabelForId(teamId) ?? (teamId || "—");
      },
    ),
    [monthLoadDrilldownStoriesRaw, monthLoadDrilldownFilter, monthLoadDrilldownSort, scopedStoryDisplayIds, scopeStartMonth, epicTeamByStoryId],
  );
  const monthLoadDrilldownEmptyRows = Math.max(0, tableTargetRows - monthLoadDrilldownStories.length);

  /**
   * Team health rollup for the Team Progress chart. For each in-scope team:
   *  1. Compute per-epic health via `computeProgress` (uses each epic's own
   *     planned start/end — period-agnostic, matches the Roadmap Health
   *     popover and chart badges).
   *  2. Pick the worst child status (overdue > atRisk > watch > onTrack/review).
   *  3. Capture the at-risk + watch epic titles so the popover can list them.
   */
  const teamHealthByTeamKey = useMemo(() => {
    const map = new Map<string, {
      status: HealthStatus;
      atRiskEpics: FlaggedEpicEntry[];
      watchEpics: FlaggedEpicEntry[];
      overdueEpics: FlaggedEpicEntry[];
      /** Per-verdict tally across ALL of the team's in-scope epics —
       *  drives `VerdictDistributionChip`'s segments. The `*Epics`
       *  arrays above only carry flagged buckets (used by the click-
       *  through popover); the `buckets` map carries the count for
       *  every verdict including On Track / Done so the chip can
       *  render the full proportional bar. */
      buckets: Record<HealthStatus, number>;
      total: number;
    }>();
    const STATUS_RANK_LOCAL: Record<HealthStatus, number> = {
      done: 0,
      onTrack: 0,
      watch: 1,
      atRisk: 2,
      overdue: 3,
    };
    for (const { epic } of monthEpics) {
      const teamKey = epic.team ?? "__unassigned__";
      const v = computeEpicHealthVerdict(epic, planYear, progressBasis);
      if (v == null) continue;
      const h = v.result;
      // Skip epics that have no measurable work in the current basis (else
      // every unestimated epic in epicEst mode would dominate the rollup).
      if (progressBasis !== "epicEst" && (epic.userStories ?? []).length === 0) continue;
      const entry = map.get(teamKey) ?? {
        status: "onTrack" as HealthStatus,
        atRiskEpics: [],
        watchEpics: [],
        overdueEpics: [],
        buckets: { done: 0, onTrack: 0, watch: 0, atRisk: 0, overdue: 0 } as Record<HealthStatus, number>,
        total: 0,
      };
      const flagged: FlaggedEpicEntry = { title: epic.title, epic, result: h, end: v.end };
      if (h.status === "atRisk") entry.atRiskEpics.push(flagged);
      else if (h.status === "watch") entry.watchEpics.push(flagged);
      else if (h.status === "overdue") entry.overdueEpics.push(flagged);
      entry.buckets[h.status] += 1;
      entry.total += 1;
      if (STATUS_RANK_LOCAL[h.status] > STATUS_RANK_LOCAL[entry.status]) entry.status = h.status;
      map.set(teamKey, entry);
    }
    return map;
  }, [monthEpics, planYear, progressBasis]);

  /** Per-assignee verdict tally — mirror of `teamHealthByTeamKey` for
   *  user-mode rows on Team Progress. Iterates every in-scope story,
   *  computes its story-level health verdict via the canonical
   *  `computeStoryHealthVerdict`, and tallies by assignee. The chip on
   *  each user row reads this for its segmented bar; the popover lists
   *  flagged stories with click-through. */
  type FlaggedStoryListEntry = { story: UserStoryItem; epic: EpicItem };
  const userVerdictBucketsByAssignee = useMemo(() => {
    const map = new Map<string, {
      buckets: Record<HealthStatus, number>;
      total: number;
      status: HealthStatus;
      atRiskStories: FlaggedStoryListEntry[];
      watchStories: FlaggedStoryListEntry[];
      overdueStories: FlaggedStoryListEntry[];
    }>();
    const STATUS_RANK_LOCAL: Record<HealthStatus, number> = {
      done: 0,
      onTrack: 0,
      watch: 1,
      atRisk: 2,
      overdue: 3,
    };
    for (const { epic } of monthEpics) {
      for (const story of epic.userStories ?? []) {
        const assignee = story.assignee?.trim();
        if (!assignee) continue;
        const v = computeStoryHealthVerdict(story, epic, planYear);
        if (v == null) continue;
        const entry = map.get(assignee) ?? {
          buckets: { done: 0, onTrack: 0, watch: 0, atRisk: 0, overdue: 0 } as Record<HealthStatus, number>,
          total: 0,
          status: "onTrack" as HealthStatus,
          atRiskStories: [],
          watchStories: [],
          overdueStories: [],
        };
        entry.buckets[v.status] += 1;
        entry.total += 1;
        if (v.status === "atRisk") entry.atRiskStories.push({ story, epic });
        else if (v.status === "watch") entry.watchStories.push({ story, epic });
        else if (v.status === "overdue") entry.overdueStories.push({ story, epic });
        if (STATUS_RANK_LOCAL[v.status] > STATUS_RANK_LOCAL[entry.status]) entry.status = v.status;
        map.set(assignee, entry);
      }
    }
    return map;
  }, [monthEpics, planYear]);

  const teamByAssigneeFallback = useMemo(() => {
    const counts = new Map<string, Map<string, number>>();
    for (const story of scopedStories) {
      const assignee = story.assignee?.trim();
      if (!assignee) continue;
      const team = epicTeamByStoryId.get(story.id);
      if (!team) continue;
      const byTeam = counts.get(assignee) ?? new Map<string, number>();
      byTeam.set(team, (byTeam.get(team) ?? 0) + 1);
      counts.set(assignee, byTeam);
    }
    const out = new Map<string, string | null>();
    for (const [assignee, byTeam] of counts.entries()) {
      let winner: string | null = null;
      let best = -1;
      for (const [team, n] of byTeam.entries()) {
        if (n > best) {
          best = n;
          winner = team;
        }
      }
      out.set(assignee, winner);
    }
    return out;
  }, [scopedStories, epicTeamByStoryId]);
  const resolveStoryTeamForSprintNav = (story: UserStoryItem): string | null => {
    const byStory = epicTeamByStoryId.get(story.id);
    if (byStory) return byStory;
    const assignee = story.assignee?.trim();
    if (!assignee) return null;
    return teamByAssigneeFallback.get(assignee) ?? null;
  };
  const openStatusDrilldown = (statusName: string) => {
    if (!statusName) return;
    setStatusDrilldownFilter(statusName);
    // Pre-fill the Status column filter for the clicked slice. "All" opens
    // the table with no pre-cut so the planner sees every story.
    const colPrefill = statusName === "All" ? null : statusName;
    // Story rows store the raw status KEY (`todo` / `inProgress` /
    // `review` / `done`) — `applyDrilldownFilterSort` filters by exact
    // string match against `r.status`, AND the dropdown's renderer
    // (`renderStatusOption`) only paints an icon for those four keys.
    // So setting the column filter to a display label (e.g.
    // `"Review / Testing"`) silently broke BOTH: empty table + raw text
    // without icon in the chip. Epic rows, on the other hand, store
    // labels directly via `deriveEpicStatus`, so the epic filter still
    // uses the slice's display name as-is.
    const storyStatusKey = (() => {
      if (colPrefill == null) return null;
      switch (colPrefill) {
        case "To do": return "todo";
        case "In progress": return "inProgress";
        case "Review / Testing": return "review";
        case "Done": return "done";
        default: return colPrefill;
      }
    })();
    setStatusDrilldownColFilter({ ...EMPTY_DRILLDOWN_FILTER, status: storyStatusKey });
    setStatusDrilldownEpicFilter({ ...EMPTY_EPIC_DRILLDOWN_FILTER, status: colPrefill });
  };
  const clearStatusDrilldown = () => { setStatusDrilldownFilter(null); setExpandedDrilldownEpics(new Set()); };
  /**
   * Epics in scope for the burndown / burnup charts. An epic counts as
   * "in this period" when EITHER of these is true:
   *
   *   1. Its plan window overlaps the period (planned-Q2 work).
   *   2. It has active stories whose sprint falls inside the period
   *      (delivery-in-Q2 work — captures epics that slipped from a
   *      prior quarter and are still being worked on now).
   *
   * Rule 2 is critical: a Q1-planned epic that the team didn't finish
   * by Mar 31 IS Q2 work in practice, and the burndown should plot it.
   * Without rule 2 the chart understates how much work is actually
   * underway in the current quarter.
   *
   * Single-epic focus bypasses the filter — the user picked that
   * epic explicitly. */
  const burndownScopedEpics = useMemo<EpicItem[]>(() => {
    if (selectedEpicOption != null) return [selectedEpicOption.epic];
    if (scopeMonths.length === 0) return monthEpics.map((row) => row.epic);
    const startMonth = Math.min(...scopeMonths);
    const endMonth = Math.max(...scopeMonths);
    const monthsSet = new Set(scopeMonths);
    return monthEpics
      .map((row) => row.epic)
      .filter((epic) => {
        // Rule 1: plan window overlaps the period.
        const planInScope =
          epic.planStartMonth != null &&
          epic.planEndMonth != null &&
          epic.planStartMonth <= endMonth &&
          epic.planEndMonth >= startMonth;
        if (planInScope) return true;
        // Rule 2: stories in this period's sprints — covers slipping
        // epics whose plan dates are outside the period but whose
        // engineers are still working in-period.
        const contextMonth = epic.planStartMonth ?? startMonth;
        return epicHasStoryInPeriodMonths(epic, monthsSet, contextMonth);
      });
  }, [monthEpics, selectedEpicOption, scopeMonths]);

  const monthBurndownEpics = useMemo(() => {
    return burndownScopedEpics.map((epic) => ({
      ...epicForBurndown(
        {
          ...epic,
          // Burndown scope includes open stories at month start, including unscheduled stories.
          userStories: (epic.userStories ?? []).filter(
            (s) => s.status === "todo" || s.status === "inProgress",
          ),
        },
        // When "Original Estimation" is selected but original estimate is missing,
        // fall back to story estimates instead of collapsing the line to zero.
        estimateSource === "original" && (epic.originalEstimateDays ?? 0) <= 0 ? "stories" : estimateSource,
      ),
    }));
  }, [burndownScopedEpics, estimateSource]);

  // ------------------------------------------------------------------
  // Burndown — `lib/burn-series.ts` is the new single source of truth.
  // The 8-step chained-useMemo pipeline that lived here previously
  // reinvented the per-basis "completed" math inline (separately from
  // `lib/progress.ts`) and produced a hybrid scope × story-fraction
  // number that disagreed with both the verdict and the drilldown — see
  // `lib/burn-series.ts` header. The single `buildBurnSeries` call below
  // and the adapter that flattens its output to legacy Recharts field
  // names replace ~600 lines of derived state with one round trip
  // through the lib that powers the verdict.
  // ------------------------------------------------------------------
  const burnDownPeriodStart = useMemo(
    () => new Date(planYear, scopeStartMonth - 1, 1),
    [planYear, scopeStartMonth],
  );
  const burnDownPeriodEnd = useMemo(
    () => new Date(planYear, scopeEndMonth, 0),
    [planYear, scopeEndMonth],
  );
  /** Apply the same epic narrow the OLD burndown chain used:
   *    - Single epic pinned via scope picker → that epic only.
   *    - Initiative pinned → that initiative's child epics.
   *    - Legend has a non-empty `visibleKeys` (subset) → that subset.
   *    - Otherwise → all in-scope epics.
   *  Without this the aggregate line + verdict would always reflect ALL
   *  in-scope epics regardless of the planner's legend pick. */
  const burnDownEpicsForSeries = useMemo<EpicItem[]>(() => {
    if (selectedEpicOption) return [selectedEpicOption.epic];
    if (selectedInitiativeId !== "all") {
      return burndownScopedEpics.filter((epic) => {
        const init = monthEpics.find((row) => row.epic.id === epic.id)?.initiative;
        return init?.id === selectedInitiativeId;
      });
    }
    // `"__all__"` is the sentinel key the aggregate legend chip carries
    // — it means "no narrowing," NOT an epic id, so when it appears
    // alone we pass all in-scope epics through. Treating it as an id
    // would filter to zero epics and leave the chart empty (the bug
    // this branch defends against).
    const realVisible = burndownVisibleKeys.filter((k) => k !== "__all__");
    if (realVisible.length > 0) {
      return burndownScopedEpics.filter((e) => realVisible.includes(e.id));
    }
    return burndownScopedEpics;
  }, [selectedEpicOption, selectedInitiativeId, monthEpics, burndownScopedEpics, burndownVisibleKeys]);
  /** Base series — always computed against the planned `periodEnd`.
   *  Used for the forecast-rate derivation below + as the chart source
   *  when forecast is off. */
  const burnDownBaseSeries = useMemo(
    () => buildBurnSeries({
      epics: burnDownEpicsForSeries,
      basis: burndownBasis,
      periodStart: burnDownPeriodStart,
      periodEnd: burnDownPeriodEnd,
    }),
    [burnDownEpicsForSeries, burndownBasis, burnDownPeriodStart, burnDownPeriodEnd],
  );
  /** Latest plan due date across the in-scope epics — `dueDate +
   *  Δ working days` is anchored to this. Mirrors `burnUpDueDate`
   *  but driven by the burndown's scope filter. */
  const burnDownDueDate = useMemo<Date | null>(() => {
    let latestMs = -Infinity;
    let latestDate: Date | null = null;
    for (const epic of burnDownEpicsForSeries) {
      if (epic.planEndMonth == null) continue;
      const year = epic.planYear ?? burnDownPeriodEnd.getFullYear();
      const month = epic.planEndMonth;
      const day = epic.planEndDay ?? (epic.planEndSprint === 1
        ? 15
        : new Date(year, month, 0).getDate());
      const t = new Date(year, month - 1, day).getTime();
      if (t > latestMs) { latestMs = t; latestDate = new Date(year, month - 1, day); }
    }
    return latestDate;
  }, [burnDownEpicsForSeries, burnDownPeriodEnd]);
  /** Δ-based forecast: take the planned due date and shift it later by
   *  `ceil(Δ)` working days. Same input that drives the verdict chip on
   *  this card, so chip and chart always tell the same story:
   *
   *    - Δ ≤ 1 (onTrack)       → forecast ≈ plan due date
   *    - 1 < Δ < 4 (watch)     → forecast = due + 1–3 working days
   *    - Δ ≥ 4 (atRisk)        → forecast = due + Δ working days (late)
   *    - status === done       → no forecast (already finished)
   *    - status === overdue    → still produces a (past) forecast so
   *                              the planner can read "would have
   *                              completed N days late had we kept pace"
   *
   *  Why this is "if the team holds today's gap" — Δ is a snapshot of
   *  `remainingEffort − idealRemaining` at today. The forecast assumes
   *  that gap stays flat going forward (team continues at the plan's
   *  pace, just `Δ` working days behind). It does NOT extrapolate
   *  acceleration or deceleration. As Δ shrinks day-to-day, the
   *  forecast date pulls in toward the plan due date automatically. */
  const burnDownForecastDate = useMemo<Date | null>(() => {
    const head = burnDownBaseSeries.headline;
    if (!head || head.status === "done") return null;
    const due = burnDownDueDate ?? burnDownPeriodEnd;
    return addWorkingDays(due, head.deltaDays);
  }, [burnDownBaseSeries.headline, burnDownDueDate, burnDownPeriodEnd]);
  /** Period end the chart's data covers. Extended past the plan due date
   *  when forecast is on AND the projected completion is past the plan
   *  end — so the X-axis stretches to include the forecast endpoint. */
  const burnDownEffectivePeriodEnd = useMemo(() => {
    if (!showBurndownForecast || !burnDownForecastDate) return burnDownPeriodEnd;
    return burnDownForecastDate.getTime() > burnDownPeriodEnd.getTime()
      ? burnDownForecastDate
      : burnDownPeriodEnd;
  }, [showBurndownForecast, burnDownForecastDate, burnDownPeriodEnd]);
  const burnDownSeries = useMemo(
    () => {
      // Cache hit when the effective period matches the plan period —
      // avoids rebuilding the per-day series on every render when the
      // forecast either is off or fits inside the plan window.
      if (burnDownEffectivePeriodEnd.getTime() === burnDownPeriodEnd.getTime()) {
        return burnDownBaseSeries;
      }
      return buildBurnSeries({
        epics: burnDownEpicsForSeries,
        basis: burndownBasis,
        periodStart: burnDownPeriodStart,
        periodEnd: burnDownEffectivePeriodEnd,
      });
    },
    [burnDownBaseSeries, burnDownEffectivePeriodEnd, burnDownPeriodEnd, burnDownEpicsForSeries, burndownBasis, burnDownPeriodStart],
  );
  /** Recharts-compatible flat rows. Adds back the legacy field names the
   *  burndown JSX already consumes (`actual`, `ideal`, `isCalendarToday`,
   *  and per-epic `[epicId]: daysLeft`) so the chart JSX requires zero
   *  changes — only the data source flips. The explicit return type
   *  preserves `axisLabel`/`dayLabel`/`isCalendarToday` so downstream
   *  TypeScript narrows correctly. */
  const monthBurndownTruncated = useMemo(() => {
    // Forecast injection (when the toggle is on). The forecast line is
    // a STRAIGHT segment from today's actual point down to (forecast
    // date, 0). We populate the `forecast` field at exactly two row
    // indices and rely on Recharts `<Line connectNulls>` to draw the
    // straight line between them.
    let todayIdx = -1;
    let forecastIdx = -1;
    let todayDaysLeft: number | null = null;
    if (showBurndownForecast && burnDownForecastDate) {
      todayIdx = burnDownSeries.perDay.findIndex((r) => r.isToday);
      if (todayIdx >= 0) {
        todayDaysLeft = burnDownSeries.perDay[todayIdx].daysLeft;
        const targetMs = burnDownForecastDate.getTime();
        // Closest day-row to the forecast date — the series carries one
        // row per calendar day, so closest = exact when the forecast
        // falls inside the period (which is why we extend it above).
        let bestDelta = Number.POSITIVE_INFINITY;
        for (let i = 0; i < burnDownSeries.perDay.length; i++) {
          const delta = Math.abs(burnDownSeries.perDay[i].date.getTime() - targetMs);
          if (delta < bestDelta) { bestDelta = delta; forecastIdx = i; }
        }
      }
    }
    return burnDownSeries.perDay.map((row, idx) => {
      const flat: {
        dayLabel: string;
        axisLabel: string;
        monthLabel: string;
        isCalendarToday: boolean;
        actual: number | null;
        ideal: number | null;
        forecast: number | null;
        [k: string]: unknown;
      } = {
        ...row,
        isCalendarToday: row.isToday,
        actual: row.daysLeft,
        ideal: row.idealDaysLeft,
        forecast: idx === todayIdx
          ? todayDaysLeft
          : idx === forecastIdx
            ? 0
            : null,
      };
      for (const [epicId, v] of Object.entries(row.perEpic)) {
        flat[epicId] = v?.daysLeft ?? null;
      }
      return flat;
    });
  }, [burnDownSeries.perDay, showBurndownForecast, burnDownForecastDate]);

  /** Aggregate scope at period-start across every in-scope epic (per the
   *  active basis). Used as the burndown tooltip's "total scope" label.
   *  Restored verbatim from the pre-rewrite chain — it's a small derivation
   *  that the burndown JSX still consumes directly. */
  const burndownAggregateStartTotal = useMemo<number | null>(() => {
    if (burndownScopedEpics.length === 0) return null;
    let total = 0;
    for (const epic of burndownScopedEpics) {
      const allStories = epic.userStories ?? [];
      const storyDaysSum = allStories.reduce((sum, s) => sum + (s.estimatedDays ?? s.daysLeft ?? 1), 0);
      const epicScope =
        metric === "storyCount"
          ? allStories.length
          : burndownBasis === "epicEst"
            ? (epic.originalEstimateDays ?? storyDaysSum)
            : storyDaysSum;
      total += epicScope;
    }
    return total > 0 ? Number(total.toFixed(1)) : null;
  }, [burndownScopedEpics, metric, burndownBasis]);
  /** The single epic the chart is currently focused on (when the user
   *  pinned one or narrowed the legend to one). Drives the focused-epic
   *  ideal line + "Done ✓" + Δ-pill rendering. */
  const burndownFocusedEpicOption = useMemo(() => {
    if (selectedEpicOption) return selectedEpicOption;
    if (burndownVisibleKeys.length !== 1) return null;
    return monthEpics.find((row) => row.epic.id === burndownVisibleKeys[0]) ?? null;
  }, [selectedEpicOption, burndownVisibleKeys, monthEpics]);
  /** "Scope promise" horizontal reference line for the burndown — only
   *  shown when basis is Epic Est on a days axis. */
  const scopePromiseDays = useMemo<number | null>(() => {
    if (burndownBasis !== "epicEst") return null;
    if (metric !== "daysLeft") return null;
    if (burndownFocusedEpicOption) {
      const v = burndownFocusedEpicOption.epic.originalEstimateDays;
      return v != null && v > 0 ? v : null;
    }
    const sum = monthBurndownEpics.reduce(
      (acc, epic) => acc + (epic.originalEstimateDays ?? 0),
      0,
    );
    return sum > 0 ? sum : null;
  }, [burndownBasis, metric, burndownFocusedEpicOption, monthBurndownEpics]);
  /** Resolved due date for the focused epic — drives the due-date marker
   *  and the focused-epic ideal line's right edge. */
  const selectedEpicDueDate = useMemo(() => {
    if (!burndownFocusedEpicOption) return null;
    const dueSprint = burndownFocusedEpicOption.epic.planEndSprint;
    const dueMonth = burndownFocusedEpicOption.epic.planEndMonth ?? scopeEndMonth;
    const dueYear = burndownFocusedEpicOption.epic.planYear ?? planYear;
    const dueDay = dueSprint === 1 ? 15 : new Date(dueYear, dueMonth, 0).getDate();
    return new Date(dueYear, dueMonth - 1, dueDay);
  }, [burndownFocusedEpicOption, scopeEndMonth, planYear]);
  /** Resolved plan-start date for the focused epic — drives the "Epic
   *  scheduled" marker at the ideal line's left edge. Mirror of
   *  `selectedEpicDueDate` for the start side. Uses the same convention
   *  as `epicPlanStartDate` in lib/burn-series.ts: explicit
   *  `planStartDay` wins, else sprint 2 → day 16, else day 1. */
  const selectedEpicPlanStartDate = useMemo(() => {
    if (!burndownFocusedEpicOption) return null;
    const epic = burndownFocusedEpicOption.epic;
    const startMonth = epic.planStartMonth ?? scopeStartMonth;
    const startYear = epic.planYear ?? planYear;
    const startDay = epic.planStartDay ?? (epic.planSprint === 2 ? 16 : 1);
    return new Date(startYear, startMonth - 1, startDay);
  }, [burndownFocusedEpicOption, scopeStartMonth, planYear]);

  /** True when the focused epic's actual line hits 0 anywhere in the
   *  rendered window — drives the "Done ✓" marker on the due date.
   *  Reads directly off `burnDownSeries.perDay` so the "done" check uses
   *  the same per-epic daysLeft the chart line plots. */
  const isFocusedBurndownDone = useMemo(() => {
    if (!burndownFocusedEpicOption) return false;
    const epicId = burndownFocusedEpicOption.epic.id;
    for (const row of burnDownSeries.perDay) {
      const v = row.perEpic[epicId];
      if (v != null && v.daysLeft === 0) return true;
    }
    return false;
  }, [burndownFocusedEpicOption, burnDownSeries.perDay]);
  /** Adds a per-row `epicIdeal` field for the focused epic so the JSX's
   *  `<Line dataKey="epicIdeal">` keeps rendering. Sources from
   *  `burnDownSeries.perDay[i].perEpic[focusedId].idealDaysLeft` — which
   *  the lib already computed correctly (linear ramp inside the epic's
   *  plan window, null outside). Massive simplification: ~60 lines of
   *  inline ramp math become a single passthrough that mirrors what the
   *  aggregate ideal line uses. */
  const monthBurndownWithDueTarget = useMemo(() => {
    if (!burndownFocusedEpicOption || selectedEpicDueDate == null) return monthBurndownTruncated;
    const focusedId = burndownFocusedEpicOption.epic.id;
    return monthBurndownTruncated.map((row, idx) => {
      const epicIdeal = burnDownSeries.perDay[idx]?.perEpic[focusedId]?.idealDaysLeft ?? null;
      // Ideal is a theoretical target line — keep it smooth (don't
      // snap to integers). Matches the convention Jira / Atlassian use:
      // a straight diagonal from total scope at plan-start down to
      // zero at the due date, not a stair-step. The actual blue line
      // stays on integers (it's observed work, can't be fractional).
      return {
        ...row,
        epicIdeal: epicIdeal == null ? null : Number(Math.max(0, epicIdeal).toFixed(1)),
      };
    });
  }, [monthBurndownTruncated, burnDownSeries.perDay, burndownFocusedEpicOption, selectedEpicDueDate]);
  /** Verdict displayed alongside the burndown chart. Sourced directly from
   *  `buildBurnSeries`'s headline — the SAME function call that drives the
   *  chart line, so the chip and the line are guaranteed to agree. The
   *  prior implementation (a separate `useMemo` that called
   *  `computeProgress` again with a slightly different filter) is gone. */
  const burndownHealth = burnDownSeries.headline
    ? {
        status: burnDownSeries.headline.status,
        result: burnDownSeries.headline.result,
        tooltip: undefined as string | undefined,
      }
    : null;
  /** Marker at the ideal line's left edge (epic plan-start). Anchors a
   *  "Epic scheduled DD/MM" label above the chart with a thin vertical
   *  connector dropping down to the ideal line's start point — explains
   *  WHY the orange line takes off from a specific day instead of from
   *  the chart's left edge. */
  const selectedEpicScheduledMarker = useMemo(() => {
    if (!selectedEpicPlanStartDate || !burndownFocusedEpicOption) return null;
    if (monthBurndownWithDueTarget.length === 0) return null;
    const monthStart = new Date(planYear, scopeStartMonth - 1, 1);
    const msPerDay = 24 * 60 * 60 * 1000;
    const startDayIndex = Math.floor((selectedEpicPlanStartDate.getTime() - monthStart.getTime()) / msPerDay) + 1;
    if (startDayIndex < 1 || startDayIndex > monthBurndownWithDueTarget.length) return null;
    const rowIndex = startDayIndex - 1;
    const point = monthBurndownWithDueTarget[rowIndex] as
      | (Record<string, number | string | boolean | null | undefined> & { axisLabel?: string })
      | undefined;
    if (!point?.axisLabel) return null;
    const y = point.epicIdeal;
    return {
      axisLabel: String(point.axisLabel),
      y: typeof y === "number" ? y : 0,
      label: `Epic scheduled ${selectedEpicPlanStartDate.getDate()}/${selectedEpicPlanStartDate.getMonth() + 1}`,
    };
  }, [selectedEpicPlanStartDate, burndownFocusedEpicOption, monthBurndownWithDueTarget, planYear, scopeStartMonth]);
  const selectedEpicDueMarker = useMemo(() => {
    if (!selectedEpicDueDate || !burndownFocusedEpicOption) return null;
    if (monthBurndownWithDueTarget.length === 0) return null;
    const monthStart = new Date(planYear, scopeStartMonth - 1, 1);
    const msPerDay = 24 * 60 * 60 * 1000;
    const dueDayIndex = Math.floor((selectedEpicDueDate.getTime() - monthStart.getTime()) / msPerDay) + 1;
    // Hide the marker when the due date falls OUTSIDE the visible
    // quarter window. The chart's X-axis is now strictly pinned to
    // [quarter-start, quarter-end] (no more extension for past-due
    // epics), so a "Due 31/7" label landing on the 30/6 right edge
    // would be misleading. The ideal line itself stays flat-at-zero
    // past quarter end inside the visible window.
    if (dueDayIndex < 1 || dueDayIndex > monthBurndownWithDueTarget.length) return null;
    const rowIndex = dueDayIndex - 1;
    const point = monthBurndownWithDueTarget[rowIndex] as
      | (Record<string, number | string | boolean | null | undefined> & { axisLabel?: string })
      | undefined;
    if (!point?.axisLabel) return null;
    const y = point.epicIdeal;
    return {
      axisLabel: String(point.axisLabel),
      y: typeof y === "number" ? y : 0,
      label: `Epic due ${selectedEpicDueDate.getDate()}/${selectedEpicDueDate.getMonth() + 1}`,
    };
  }, [selectedEpicDueDate, burndownFocusedEpicOption, monthBurndownWithDueTarget, planYear, month, scopeStartMonth]);
  const monthEndMarker = useMemo(() => {
    if (!burndownFocusedEpicOption) return null;
    const monthEndLabel = flowChartDayLabel(new Date(planYear, scopeEndMonth, 0));
    const monthEndPoint = monthBurndownWithDueTarget.find((row) => {
      return String(row.dayLabel ?? row.axisLabel ?? "") === monthEndLabel;
    }) as
      | (Record<string, number | string | boolean | null | undefined> & { axisLabel?: string; dayLabel?: string })
      | undefined;
    if (!monthEndPoint?.axisLabel) return null;
    const y = monthEndPoint.epicIdeal;
    return {
      axisLabel: String(monthEndPoint.axisLabel),
      y: typeof y === "number" ? y : 0,
      label: `${scopeLabel} end (${monthEndLabel})`,
    };
  }, [burndownFocusedEpicOption, monthBurndownWithDueTarget, planYear, month, scopeEndMonth, scopeLabel]);
  const burndownAxisTicks = useMemo(() => {
    const labels = monthBurndownWithDueTarget
      .map((row) => String(row.axisLabel ?? ""))
      .filter((label) => label.length > 0);
    if (labels.length <= 10) return labels;
    const step = Math.max(1, Math.ceil(labels.length / 10));
    const ticks: string[] = [];
    for (let i = 0; i < labels.length; i += step) ticks.push(labels[i]);
    const last = labels[labels.length - 1];
    if (ticks[ticks.length - 1] !== last) ticks.push(last);
    return ticks;
  }, [monthBurndownWithDueTarget]);
  const burndownLegendItems = useMemo(() => {
    if (selectedEpicOption) {
      // When the focused epic's plan ended BEFORE the current quarter
      // starts, the ideal line is suppressed (no honest plan in this Q).
      // Swap the legend label so the missing line is self-explanatory
      // instead of looking like a render bug.
      const monthStart = new Date(planYear, scopeStartMonth - 1, 1);
      const dueMs = selectedEpicDueDate?.getTime() ?? Number.POSITIVE_INFINITY;
      const isFullyOverdue = dueMs < monthStart.getTime();
      return [
        { key: selectedEpicOption.epic.id, label: selectedEpicOption.epic.title, color: LINE_PALETTE[0] },
        {
          key: "epicIdeal",
          label: isFullyOverdue ? "Past plan — needs rescheduling" : "Epic ideal to due",
          color: isFullyOverdue ? "#94a3b8" : "#f97316",
        },
      ];
    }
    // No epic pinned. When an initiative is pinned via the scope picker,
    // collapse the legend to one "All <initiative> epics" chip; when
    // truly "all" scope, one "All epics" chip. The per-epic chip list
    // (10 chips when there are 10 epics) was visual noise — the planner
    // narrows via the Epic / Initiative Scope picker above, not the
    // legend, so the legend only needs to label the aggregate view.
    if (selectedInitiativeId !== "all") {
      const init = scopeInitiativeOptions.find((i) => i.id === selectedInitiativeId);
      return [{
        key: "__all__",
        label: init ? `All ${init.title} epics` : "All epics",
        color: "#64748b",
      }];
    }
    return [{
      key: "__all__",
      label: "All epics",
      color: "#64748b",
    }];
  }, [selectedEpicOption, selectedInitiativeId, scopeInitiativeOptions, selectedEpicDueDate, planYear, scopeStartMonth]);
  useEffect(() => {
    setBurndownVisibleKeys((prev) => {
      const available = new Set(burndownLegendItems.map((item) => item.key));
      const retained = prev.filter((k) => available.has(k));
      if (retained.length > 0) return retained;
      return burndownLegendItems.map((item) => item.key);
    });
  }, [burndownLegendItems]);
  const toggleBurndownKey = (key: string) => {
    setBurndownVisibleKeys((prev) => {
      const allKeys = burndownLegendItems.map((item) => item.key);
      // Legend click focuses a single epic/series instead of toggling it off.
      if (prev.length === 1 && prev[0] === key) return allKeys;
      return [key];
    });
  };
  const showAllBurndownKeys = () => setBurndownVisibleKeys(burndownLegendItems.map((item) => item.key));
  const allBurndownKeysSelected =
    burndownLegendItems.length > 0 && burndownLegendItems.every((item) => burndownVisibleKeys.includes(item.key));
  const burndownLegendScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollBurndownUp, setCanScrollBurndownUp] = useState(false);
  const [canScrollBurndownDown, setCanScrollBurndownDown] = useState(false);
  const updateBurndownArrowState = () => {
    const node = burndownLegendScrollRef.current;
    if (!node) {
      setCanScrollBurndownUp(false);
      setCanScrollBurndownDown(false);
      return;
    }
    const epsilon = 2;
    setCanScrollBurndownUp(node.scrollTop > epsilon);
    setCanScrollBurndownDown(node.scrollTop + node.clientHeight < node.scrollHeight - epsilon);
  };
  const scrollBurndownLegendBy = (delta: number) => {
    burndownLegendScrollRef.current?.scrollBy({ top: delta, behavior: "smooth" });
  };
  useEffect(() => {
    updateBurndownArrowState();
  }, [burndownLegendItems, selectedEpicOption]);
  const flowFromSnapshots = useMemo(() => {
    const sourceStories = selectedEpicOption != null
      ? (selectedEpicOption.epic.userStories ?? [])
      : monthEpics.flatMap((row) => row.epic.userStories ?? []);
    const hasSnapshots = sourceStories.some((story) => (story.snapshots?.length ?? 0) > 0);
    if (!hasSnapshots) return null;

    const periodStartDate = new Date(planYear, scopeStartMonth - 1, 1, 23, 59, 59, 999);
    const periodEndDate = new Date(planYear, scopeEndMonth, 0, 23, 59, 59, 999);
    const totalDays =
      Math.floor((periodEndDate.getTime() - periodStartDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const dayDates = Array.from({ length: totalDays }, (_, idx) => {
      const day = new Date(periodStartDate);
      day.setDate(periodStartDate.getDate() + idx);
      return day;
    });
    // Track ALL scheduled stories, not just those that were open at
    // period start. The previous `isStoryOpen` filter dropped any
    // story that was already review at Jan 1 (or that fell back to its
    // current "review" status because no early snapshot exists) — so
    // CFD's Done stack was always 0 even when Workload Balance was
    // counting 7 Done stories. By tracking every story, the per-day
    // loop now plots stories that were always review as a flat Done
    // band, matching the Workload Balance current-state view.
    // CFD always covers the whole epic / scope — unscheduled stories
    // land in their current status bucket like everything else, and a
    // separate dashed overlay line (computed below) surfaces the count
    // of "still unscheduled AND not yet Done" stories so the gap between
    // that line and the band stack reads as "uncommitted work to plan."
    const storiesToTrack = sourceStories;
    const now = new Date();
    const periodStartMs3 = new Date(planYear, scopeStartMonth - 1, 1).getTime();
    const nowDayMs3 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const rawElapsed3 = Math.round((nowDayMs3 - periodStartMs3) / 86400000) + 1;
    const elapsedDays = Math.max(0, Math.min(totalDays, rawElapsed3));

    return dayDates.map((dayDate, index) => {
      const dayInMonth = index + 1;
      if (dayInMonth > elapsedDays) {
        return {
          dayInMonth,
          labelShort: flowChartDayLabel(dayDate),
          isToday: false,
          todo: null,
          inProgress: null,
          review: null,
          done: null,
          unscheduledNotDone: null,
        };
      }
      // Cutoff for the snapshot bisection = start of NEXT day local.
      // Snapshots are sometimes stored at UTC midnight or UTC 21:00,
      // which in a UTC+3 timezone are 03:00 / 00:00 of the NEXT local
      // day — they would land just past a local end-of-day cutoff and
      // get excluded by 1 ms. Pushing the cutoff to start-of-next-day
      // captures both timestamp patterns.
      const cutoff = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate() + 1, 0, 0, 0, 0);
      // Detect whether this iteration is the chart's "today" day —
      // when true, trust story.status as the authoritative current
      // state. Snapshot reconstruction can lag if the most recent
      // status change isn't (yet) reflected in the snapshot stream
      // (e.g. demo's force pass updates story.status without writing
      // a matching snapshot). For past days, snapshots remain
      // authoritative since story.status reflects only NOW.
      const dayStartMs = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate()).getTime();
      const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const isTodayCell = dayStartMs === todayStartMs;
      let todo = 0;
      let inProgress = 0;
      let review = 0;
      let done = 0;
      let unscheduledNotDone = 0;
      for (const story of storiesToTrack) {
        const snapshot = latestSnapshotAtDayCached(story, cutoff);
        const status = isTodayCell
          ? story.status
          : (snapshot?.status ?? story.status);
        if (status === "todo") todo += 1;
        else if (status === "inProgress") inProgress += 1;
        else if (status === "review") review += 1;
        else if (status === "done") done += 1;
        // "Unscheduled" is a scope-qualifier, not a status. Done
        // unscheduled stories aren't counted here — Done is Done. The
        // overlay tracks committed-but-still-unscheduled work waiting to
        // be slotted into a sprint. Sprint comes from the per-day
        // snapshot when available so the line reflects historic
        // scheduling state, not just the live one.
        const sprintAtDay = isTodayCell
          ? story.sprint
          : (snapshot?.sprint ?? story.sprint);
        if (sprintAtDay == null && status !== "done") unscheduledNotDone += 1;
      }
      const dayStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate()).getTime();
      const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      return {
        dayInMonth,
        labelShort: flowChartDayLabel(dayDate),
        isToday: dayStart === nowStart,
        todo,
        inProgress,
        review,
        done,
        unscheduledNotDone,
      };
    });
  }, [selectedEpicOption, monthEpics, planYear, month, scopeStartMonth, scopeEndMonth]);
  const flowResolved = flowFromSnapshots ?? analytics.flowSprintTrendData;

  // CFD is fundamentally a story-status-flow chart; the days-based axis
  // never made much sense (the stack-by-status interpretation is in story
  // counts). Locked to "storyCount" — no per-chart toggle. Cast retains
  // the broader `BurndownMetric` shape so other consumers' equality
  // checks (`cfdMetric === "daysLeft"`) still typecheck and compile to
  // dead branches at runtime.
  const cfdMetric = "storyCount" as BurndownMetric;

  const flowDaysData = useMemo(() => {
    const sourceStories = selectedEpicOption != null
      ? (selectedEpicOption.epic.userStories ?? [])
      : monthEpics.flatMap((row) => row.epic.userStories ?? []);
    const scheduledStories = sourceStories.filter((s) => s.sprint != null);

    const periodStartDate = new Date(planYear, scopeStartMonth - 1, 1, 23, 59, 59, 999);
    const periodEndDate = new Date(planYear, scopeEndMonth, 0, 23, 59, 59, 999);
    const totalDays = Math.floor((periodEndDate.getTime() - periodStartDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const dayDates = Array.from({ length: totalDays }, (_, idx) => {
      const day = new Date(periodStartDate);
      day.setDate(periodStartDate.getDate() + idx);
      return day;
    });
    const now = new Date();
    const isCurrentPeriod = now.getFullYear() === planYear && now.getMonth() + 1 >= scopeStartMonth && now.getMonth() + 1 <= scopeEndMonth;
    const elapsedDays = isCurrentPeriod ? Math.max(1, Math.min(totalDays, Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(planYear, scopeStartMonth - 1, 1).getTime()) / (24 * 60 * 60 * 1000)) + 1)) : totalDays;
    const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const hasSnapshots = scheduledStories.some((s) => (s.snapshots?.length ?? 0) > 0);

    return dayDates.map((dayDate, index) => {
      const dayInMonth = index + 1;
      const dayStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate()).getTime();
      if (dayInMonth > elapsedDays) {
        return { dayInMonth, labelShort: flowChartDayLabel(dayDate), isToday: false, todo: null, inProgress: null, review: null, done: null };
      }
      let todo = 0; let inProgress = 0; let review = 0; let done = 0;
      for (const story of scheduledStories) {
        const days = Math.max(0, story.estimatedDays ?? story.daysLeft ?? 0);
        if (days === 0) continue;
        let status: string = story.status;
        if (hasSnapshots) {
          const snap = latestSnapshotAtDayCached(story, dayDate);
          status = snap?.status ?? story.status;
        } else {
          const progress = (dayInMonth - 1) / Math.max(elapsedDays - 1, 1);
          const finalStatus = story.status;
          if (finalStatus === "done") status = progress > 0.75 ? "done" : progress > 0.5 ? "review" : progress > 0.25 ? "inProgress" : "todo";
          else if (finalStatus === "review") status = progress > 0.6 ? "review" : progress > 0.3 ? "inProgress" : "todo";
          else if (finalStatus === "inProgress") status = progress > 0.4 ? "inProgress" : "todo";
          else status = "todo";
        }
        if (status === "todo") todo += days;
        else if (status === "inProgress") inProgress += days;
        else if (status === "review") review += days;
        else if (status === "done") done += days;
      }
      return { dayInMonth, labelShort: flowChartDayLabel(dayDate), isToday: dayStart === nowStart,
        todo: Number(todo.toFixed(1)), inProgress: Number(inProgress.toFixed(1)), review: Number(review.toFixed(1)), done: Number(done.toFixed(1)) };
    });
  }, [selectedEpicOption, monthEpics, planYear, month, scopeStartMonth, scopeEndMonth]);

  const cfdDataResolvedRaw = cfdMetric === "daysLeft" ? flowDaysData : flowResolved;
  // After the chart has fully drained — every story moved to review/done
  // and stays that way — null the status counts so the area chart stops
  // drawing. Without this the CFD shows a wide flat band of green/violet
  // for the rest of the period, adding no information. labelShort + isToday
  // stay so X-axis ticks + the Today line still render.
  const cfdDataResolved = useMemo(() => {
    const rows = cfdDataResolvedRaw as Array<Record<string, unknown>>;
    let doneAtIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const todo = typeof r.todo === "number" ? r.todo : 0;
      const inProgress = typeof r.inProgress === "number" ? r.inProgress : 0;
      const review = typeof r.review === "number" ? r.review : 0;
      const done = typeof r.done === "number" ? r.done : 0;
      // "Done" = no open work AND at least one story has reached the right
      // side of the stack. The second check avoids treating a future-only
      // window (all zeros across the board) as "review".
      if (todo === 0 && inProgress === 0 && (review > 0 || done > 0)) {
        doneAtIdx = i;
        break;
      }
    }
    if (doneAtIdx < 0) return cfdDataResolvedRaw;
    return rows.map((row, i) => {
      if (i <= doneAtIdx) return row;
      const blanked: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        const v = row[key];
        blanked[key] = typeof v === "number" ? null : v;
      }
      return blanked;
    }) as typeof cfdDataResolvedRaw;
  }, [cfdDataResolvedRaw]);

  const cfdAxisTicks = useMemo(() => {
    const labels = cfdDataResolved
      .map((row) => String((row as { labelShort?: string }).labelShort ?? ""))
      .filter((l) => l.length > 0);
    if (labels.length <= 10) return labels;
    const step = Math.max(1, Math.ceil(labels.length / 10));
    const ticks: string[] = [];
    for (let i = 0; i < labels.length; i += step) ticks.push(labels[i]);
    const last = labels[labels.length - 1];
    if (ticks[ticks.length - 1] !== last) ticks.push(last);
    return ticks;
  }, [cfdDataResolved]);

  useEffect(() => {
    setCfdVisibleKeys((prev) => {
      const allKeys = CFD_FLOW_SEGMENTS.map((seg) => seg.key);
      const retained = prev.filter((k) => allKeys.includes(k));
      if (retained.length > 0) return retained;
      return allKeys;
    });
  }, []);
  const toggleCfdKey = (key: (typeof CFD_FLOW_SEGMENTS)[number]["key"]) => {
    setCfdVisibleKeys((prev) => {
      if (prev.includes(key)) {
        const next = prev.filter((k) => k !== key);
        return next.length > 0 ? next : prev;
      }
      return [...prev, key];
    });
  };
  const showAllCfdKeys = () => setCfdVisibleKeys(CFD_FLOW_SEGMENTS.map((seg) => seg.key));
  const allCfdKeysSelected =
    CFD_FLOW_SEGMENTS.length > 0 && CFD_FLOW_SEGMENTS.every((seg) => cfdVisibleKeys.includes(seg.key));

  // ------------------------------------------------------------------
  // Burnup — same `lib/burn-series.ts` powers both charts. The 470-line
  // inline `useMemo` previously here reinvented the basis math against
  // the chart's data shape instead of calling `lib/progress.ts`, which
  // is the root cause of the bug class this rewrite eliminates. The
  // burndown's `burnDownSeries` already carries the full per-day series
  // — burnup just renders the SAME data with `completed` driving the
  // blue line instead of `daysLeft`.
  // ------------------------------------------------------------------
  /** Same legend-aware narrow as the burndown but using `burnUpVisibleKeys`. */
  const burnUpEpicsForSeries = useMemo<EpicItem[]>(() => {
    if (selectedEpicOption) return [selectedEpicOption.epic];
    if (selectedInitiativeId !== "all") {
      return burndownScopedEpics.filter((epic) => {
        const init = monthEpics.find((row) => row.epic.id === epic.id)?.initiative;
        return init?.id === selectedInitiativeId;
      });
    }
    // Same `"__all__"` sentinel handling as the burndown side — see the
    // comment in `burnDownEpicsForSeries`.
    const realVisible = burnUpVisibleKeys.filter((k) => k !== "__all__");
    if (realVisible.length > 0) {
      return burndownScopedEpics.filter((e) => realVisible.includes(e.id));
    }
    return burndownScopedEpics;
  }, [selectedEpicOption, selectedInitiativeId, monthEpics, burndownScopedEpics, burnUpVisibleKeys]);
  /** Burnup forecast — mirror of the burndown's. Rate = today's
   *  `completed` / elapsed calendar days. Projects the date the actual
   *  line reaches `scope`. Null when no work, no scope, or no data.
   *
   *  Perf: when the burnup's args match the burndown's (same epic list,
   *  same basis, same period), reuse the burndown's series instead of
   *  recomputing. `buildBurnSeries` is pure — same inputs ⇒ same output —
   *  and in the aggregate-all view (no legend narrowing, shared basis
   *  picker) the two charts always have identical inputs. Halves the
   *  per-day projection work in the slowest case. */
  const burnUpBaseSeries = useMemo(
    () => {
      const sameEpics = burnUpEpicsForSeries.length === burnDownEpicsForSeries.length
        && burnUpEpicsForSeries.every((e, i) => e.id === burnDownEpicsForSeries[i]?.id);
      if (sameEpics && burnupBasis === burndownBasis) {
        return burnDownBaseSeries;
      }
      return buildBurnSeries({
        epics: burnUpEpicsForSeries,
        basis: burnupBasis,
        periodStart: burnDownPeriodStart,
        periodEnd: burnDownPeriodEnd,
      });
    },
    [burnUpEpicsForSeries, burnupBasis, burnDownPeriodStart, burnDownPeriodEnd, burnDownEpicsForSeries, burndownBasis, burnDownBaseSeries],
  );
  /** Burnup mirror — same Δ-based formula. Due date derived inline so
   *  this useMemo doesn't depend on `burnUpDueDate` (declared later in
   *  the file). The burnup chart's blue line crosses `scope` at the
   *  same calendar date the burndown's blue line crosses `0`, by
   *  symmetry, so the formula matches exactly. */
  const burnUpForecastDate = useMemo<Date | null>(() => {
    const head = burnUpBaseSeries.headline;
    if (!head || head.status === "done") return null;
    const epicsToCheck = selectedEpicOption != null
      ? [selectedEpicOption.epic]
      : monthEpics.map((r) => r.epic).filter(
          (e) => burnUpVisibleKeys.length === 0 || burnUpVisibleKeys.includes(e.id),
        );
    let latestMs = -Infinity;
    let latestDate: Date | null = null;
    for (const epic of epicsToCheck) {
      if (epic.planEndMonth == null) continue;
      const year = epic.planYear ?? burnDownPeriodEnd.getFullYear();
      const month = epic.planEndMonth;
      const day = epic.planEndDay ?? (epic.planEndSprint === 1
        ? 15
        : new Date(year, month, 0).getDate());
      const d = new Date(year, month - 1, day);
      if (d.getTime() > latestMs) { latestMs = d.getTime(); latestDate = d; }
    }
    const due = latestDate ?? burnDownPeriodEnd;
    return addWorkingDays(due, head.deltaDays);
  }, [burnUpBaseSeries.headline, selectedEpicOption, monthEpics, burnUpVisibleKeys, burnDownPeriodEnd]);
  const burnUpEffectivePeriodEnd = useMemo(() => {
    if (!showBurnUpForecast || !burnUpForecastDate) return burnDownPeriodEnd;
    return burnUpForecastDate.getTime() > burnDownPeriodEnd.getTime()
      ? burnUpForecastDate
      : burnDownPeriodEnd;
  }, [showBurnUpForecast, burnUpForecastDate, burnDownPeriodEnd]);
  const burnUpSeries = useMemo(
    () => {
      if (burnUpEffectivePeriodEnd.getTime() === burnDownPeriodEnd.getTime()) {
        return burnUpBaseSeries;
      }
      // Forecast-extended path: same dedupe trick — if the burndown's
      // extended series happens to share the same args (same epics, same
      // basis, same extended periodEnd), reuse it.
      const sameEpics = burnUpEpicsForSeries.length === burnDownEpicsForSeries.length
        && burnUpEpicsForSeries.every((e, i) => e.id === burnDownEpicsForSeries[i]?.id);
      if (
        sameEpics
        && burnupBasis === burndownBasis
        && burnUpEffectivePeriodEnd.getTime() === burnDownEffectivePeriodEnd.getTime()
      ) {
        return burnDownSeries;
      }
      return buildBurnSeries({
        epics: burnUpEpicsForSeries,
        basis: burnupBasis,
        periodStart: burnDownPeriodStart,
        periodEnd: burnUpEffectivePeriodEnd,
      });
    },
    [burnUpBaseSeries, burnUpEffectivePeriodEnd, burnDownPeriodEnd, burnUpEpicsForSeries, burnupBasis, burnDownPeriodStart, burnDownEpicsForSeries, burndownBasis, burnDownEffectivePeriodEnd, burnDownSeries],
  );
  /** Burnup adapter — flattens the canonical BurnPoint shape into the
   *  legacy field names the burnup `<LineChart>` consumes (`labelShort`,
   *  `scope`, `completed`, `ideal`, per-epic `[epicId]: completed`).
   *  Truncates per-epic + scope/completed/ideal numerics AFTER the
   *  aggregate `completed` reaches `scope` so the lines stop drawing —
   *  same UX behavior as the old `burnUpDataTruncated`. */
  const burnUpData = useMemo(() => {
    // Forecast injection — burnup mirror of the burndown's. The line
    // goes from (today, completed) UP to (forecast date, scope).
    let todayIdx = -1;
    let forecastIdx = -1;
    let todayCompleted: number | null = null;
    let forecastScope: number | null = null;
    if (showBurnUpForecast && burnUpForecastDate) {
      todayIdx = burnUpSeries.perDay.findIndex((r) => r.isToday);
      if (todayIdx >= 0) {
        todayCompleted = burnUpSeries.perDay[todayIdx].completed;
        forecastScope = burnUpSeries.perDay[todayIdx].scope;
        const targetMs = burnUpForecastDate.getTime();
        let bestDelta = Number.POSITIVE_INFINITY;
        for (let i = 0; i < burnUpSeries.perDay.length; i++) {
          const delta = Math.abs(burnUpSeries.perDay[i].date.getTime() - targetMs);
          if (delta < bestDelta) { bestDelta = delta; forecastIdx = i; }
        }
      }
    }
    return burnUpSeries.perDay.map((row, idx) => {
      const flat: Record<string, unknown> = {
        ...row,
        labelShort: row.dayLabel,
        ideal: row.idealCompleted,
        forecast: idx === todayIdx
          ? todayCompleted
          : idx === forecastIdx
            ? forecastScope
            : null,
      };
      for (const [epicId, v] of Object.entries(row.perEpic)) {
        flat[epicId] = v?.completed ?? null;
      }
      return flat as { labelShort: string; isToday: boolean; completed: number | null; scope: number; ideal: number | null; forecast: number | null; [k: string]: unknown };
    });
  }, [burnUpSeries.perDay, showBurnUpForecast, burnUpForecastDate]);

  /** Verdict shown alongside the burnup chart. Identical pattern to
   *  `burndownHealth`: sourced directly from `buildBurnSeries`'s
   *  headline so the chip can't drift from the chart line. */
  const burnupHealth = burnUpSeries.headline
    ? {
        status: burnUpSeries.headline.status,
        result: burnUpSeries.headline.result,
        tooltip: undefined as string | undefined,
      }
    : null;

  // --- Burn Up chart (epic scope) ---
  // `burnUpMetric` is derived from `burnupBasis` near the top of the
  // component (Y-axis follows basis: stories basis → storyCount,
  // otherwise daysLeft). No separate metric toggle exists anymore.
  const burnUpDueDate = useMemo(() => {
    // Respect the legend filter: if the user has narrowed the burnup to a
    // single epic via the legend (or scope picker), use THAT epic's due
    // date. Otherwise fall back to the latest among all month epics.
    const epicsToCheck = selectedEpicOption != null
      ? [selectedEpicOption.epic]
      : monthEpics
          .map((r) => r.epic)
          .filter((e) => burnUpVisibleKeys.length === 0 || burnUpVisibleKeys.includes(e.id));
    if (epicsToCheck.length === 0) return null;
    let latestMs = -Infinity;
    let latestDate: Date | null = null;
    for (const epic of epicsToCheck) {
      const dueMonth = epic.planEndMonth ?? scopeEndMonth;
      const dueYear = epic.planYear ?? planYear;
      const dueSprint = epic.planEndSprint;
      const dueDay = dueSprint === 1 ? 15 : new Date(dueYear, dueMonth, 0).getDate();
      const d = new Date(dueYear, dueMonth - 1, dueDay);
      if (d.getTime() > latestMs) { latestMs = d.getTime(); latestDate = d; }
    }
    return latestDate;
  }, [selectedEpicOption, monthEpics, burnUpVisibleKeys, scopeEndMonth, planYear]);


  /** Short date label used in tooltip text (e.g. "Due 31/12"). */
  const burnUpDueDateLabel = useMemo(() => {
    if (!burnUpDueDate) return null;
    return `${burnUpDueDate.getDate()}/${burnUpDueDate.getMonth() + 1}`;
  }, [burnUpDueDate]);

  /** Full tick label (matches `flowChartDayLabel` format) — required for
   *  `ReferenceDot x={...}` to land on the correct X-axis position.
   *  Returns null when the due date falls OUTSIDE the chart's [scopeStart,
   *  scopeEnd] window, because Recharts can't position the marker on a
   *  non-existent tick and falls back to x=0 (renders the bullseye on the
   *  far-left edge of the chart). When the marker is null, the consumer
   *  conditionals skip rendering it entirely. */
  const burnUpDueDateTickLabel = useMemo(() => {
    if (!burnUpDueDate) return null;
    const periodStart = new Date(planYear, scopeStartMonth - 1, 1);
    const periodEnd = new Date(planYear, scopeEndMonth, 0);
    const t = burnUpDueDate.getTime();
    if (t < periodStart.getTime() || t > periodEnd.getTime()) return null;
    return flowChartDayLabel(burnUpDueDate);
  }, [burnUpDueDate, planYear, scopeStartMonth, scopeEndMonth]);
  /** Burnup mirror of `selectedEpicScheduledMarker`: tick label + Y
   *  value (always 0 — ideal starts at zero on burnup) for the focused
   *  epic's plan-start point. Anchors the "Epic scheduled" annotation
   *  on the burnup chart at the same date the burndown variant points
   *  to. Returns null when the date falls outside the visible window
   *  so the label isn't pinned to a misleading edge. */
  const burnUpScheduledMarker = useMemo(() => {
    if (!selectedEpicPlanStartDate || !burndownFocusedEpicOption) return null;
    const periodStart = new Date(planYear, scopeStartMonth - 1, 1);
    const periodEnd = new Date(planYear, scopeEndMonth, 0);
    const t = selectedEpicPlanStartDate.getTime();
    if (t < periodStart.getTime() || t > periodEnd.getTime()) return null;
    return {
      axisLabel: flowChartDayLabel(selectedEpicPlanStartDate),
      label: `Epic scheduled ${selectedEpicPlanStartDate.getDate()}/${selectedEpicPlanStartDate.getMonth() + 1}`,
    };
  }, [selectedEpicPlanStartDate, burndownFocusedEpicOption, planYear, scopeStartMonth, scopeEndMonth]);

  const burnUpLegendScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollBurnUpUp, setCanScrollBurnUpUp] = useState(false);
  const [canScrollBurnUpDown, setCanScrollBurnUpDown] = useState(false);
  const updateBurnUpLegendArrowState = () => {
    const node = burnUpLegendScrollRef.current;
    if (!node) { setCanScrollBurnUpUp(false); setCanScrollBurnUpDown(false); return; }
    const epsilon = 2;
    setCanScrollBurnUpUp(node.scrollTop > epsilon);
    setCanScrollBurnUpDown(node.scrollTop + node.clientHeight < node.scrollHeight - epsilon);
  };
  const scrollBurnUpLegendBy = (delta: number) => burnUpLegendScrollRef.current?.scrollBy({ top: delta, behavior: "smooth" });

  const burnUpAxisTicks = useMemo(() => {
    const labels = burnUpData.map((r) => r.labelShort).filter((l) => l.length > 0);
    if (labels.length <= 10) return labels;
    const step = Math.max(1, Math.ceil(labels.length / 10));
    const out: string[] = [];
    for (let i = 0; i < labels.length; i += step) out.push(labels[i]);
    const last = labels[labels.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
  }, [burnUpData]);

  // Final scope across the window — scope is now per-day (steps up when
  // stories are added), so the static markers anchored at the due-date
  // (red target + green ✓) need the END-of-period value, not day-0's.
  const burnUpScopeTotal = useMemo(() => {
    if (burnUpData.length === 0) return 0;
    let max = 0;
    for (const row of burnUpData) {
      if (typeof row?.scope === "number" && row.scope > max) max = row.scope;
    }
    return max;
  }, [burnUpData]);

  const burnUpCompletedNow = useMemo(() => {
    for (let i = burnUpData.length - 1; i >= 0; i--) {
      const v = burnUpData[i]?.completed;
      if (v != null) return v;
    }
    return 0;
  }, [burnUpData]);
  /** Truncate the `completed` line after it first reaches the scope total —
   *  same reasoning as the burndown's review-truncation: a flat line at scope
   *  adds no information. Also surface whether the scope was reached at all
   *  so the chart can paint a "Done ✓" marker on the due date. Compares
   *  against THAT day's scope so a late scope bump doesn't make a row that
   *  was "at scope" yesterday look like it's still review today. */
  const burnUpDoneAtIdx = useMemo(() => {
    for (let i = 0; i < burnUpData.length; i++) {
      const row = burnUpData[i];
      if (!row) continue;
      const v = row.completed;
      const s = row.scope;
      if (typeof v === "number" && typeof s === "number" && s > 0 && v >= s) return i;
    }
    return -1;
  }, [burnUpData]);
  /** Truncate per-row numerics past the row where the aggregate
   *  completed reaches scope — UX parity with the prior version of this
   *  pipeline. Recharts already handles `null` data points cleanly, so
   *  the labelShort + isToday string fields stay intact for the X-axis
   *  and Today marker. */
  const burnUpDataTruncated = useMemo(() => {
    if (burnUpDoneAtIdx < 0) return burnUpData;
    return burnUpData.map((row, i) => {
      if (i <= burnUpDoneAtIdx) return row;
      const blanked: Record<string, number | string | boolean | null> = {};
      for (const key of Object.keys(row)) {
        const v = (row as Record<string, unknown>)[key];
        blanked[key] = typeof v === "number" ? null : (v as string | boolean | null);
      }
      return blanked as typeof row;
    });
  }, [burnUpData, burnUpDoneAtIdx]);
  const isBurnUpDone = burnUpDoneAtIdx >= 0;
  // (Previously: `burnUpCompletedStroke` resolved a single aggregate line
  //  color. Replaced by per-epic <Line> rendering on the chart, each one
  //  colored from LINE_PALETTE matching its legend row, so this memo is no
  //  longer needed.)

  const burnUpEpicRows = useMemo(() => {
    // Same plan-overlap filter as the burndown so the two charts list
    // the same epic set across their legends + aggregates.
    const epicsInScope = burndownScopedEpics;
    return epicsInScope.map((epic, idx) => {
      const stories = (epic.userStories ?? []).filter((s) => s.sprint != null);
      // Same definition as burnUpData.storyDone — review-state stories
      // are NOT counted as completed since they can still bounce back.
      const completed = stories.filter((s) => s.status === "done").length;
      const remaining = stories.length - completed;
      const daysLeft = stories
        .filter((s) => s.status === "todo" || s.status === "inProgress")
        .reduce((sum, s) => sum + Math.max(0, s.daysLeft ?? 0), 0);
      return {
        id: epic.id,
        title: epic.title,
        color: LINE_PALETTE[idx % LINE_PALETTE.length],
        totalStories: stories.length,
        completed,
        remaining,
        daysLeft: Number(daysLeft.toFixed(1)),
        status: deriveEpicStatus(epic),
      };
    });
  }, [selectedEpicOption, monthEpics]);

  /** Legend chip list for the burnup. Collapsed to a single "All epics"
   *  / "All <initiative> epics" / focused-epic chip in non-subset modes.
   *  Per-epic line rendering on the chart still reads `burnUpEpicRows`
   *  directly (the full list); only the chip ROW is collapsed. */
  const burnUpLegendItems = useMemo(() => {
    if (selectedEpicOption) {
      return [{
        id: selectedEpicOption.epic.id,
        title: selectedEpicOption.epic.title,
        color: LINE_PALETTE[0],
      }];
    }
    if (selectedInitiativeId !== "all") {
      const init = scopeInitiativeOptions.find((i) => i.id === selectedInitiativeId);
      return [{
        id: "__all__",
        title: init ? `All ${init.title} epics` : "All epics",
        color: "#64748b",
      }];
    }
    return [{
      id: "__all__",
      title: "All epics",
      color: "#64748b",
    }];
  }, [selectedEpicOption, selectedInitiativeId, scopeInitiativeOptions]);

  useEffect(() => {
    setBurnUpVisibleKeys((prev) => {
      const available = new Set(burnUpEpicRows.map((r) => r.id));
      const retained = prev.filter((k) => available.has(k));
      if (retained.length > 0) return retained;
      return burnUpEpicRows.map((r) => r.id);
    });
  }, [burnUpEpicRows]);

  const toggleBurnUpKey = (key: string) => {
    setBurnUpVisibleKeys((prev) => {
      const allKeys = burnUpEpicRows.map((r) => r.id);
      if (prev.length === 1 && prev[0] === key) return allKeys;
      return [key];
    });
  };
  const showAllBurnUpKeys = () => setBurnUpVisibleKeys(burnUpEpicRows.map((r) => r.id));
  const allBurnUpKeysSelected =
    burnUpEpicRows.length > 0 && burnUpEpicRows.every((r) => burnUpVisibleKeys.includes(r.id));
  // True when the chart is focused on exactly one epic (either via the
  // scope picker or via the legend filter). Drives whether shared
  // scope/ideal/due/review markers render — they only make sense when one
  // due date applies. When `selectedEpicOption` is set, burnUpEpicRows
  // also collapses to that one epic, so `allBurnUpKeysSelected` becomes
  // true — we use this stronger signal instead to keep the markers visible.
  const burnUpSingleEpicVisible =
    selectedEpicOption != null ||
    (burnUpEpicRows.length === 1 && burnUpVisibleKeys.includes(burnUpEpicRows[0]!.id)) ||
    (burnUpEpicRows.length > 1 && burnUpVisibleKeys.length === 1);

  /**
   * Title suffix for "Epic Scope Burndown" — a legend narrowed to one
   * epic WINS (so clicking a single epic in the legend retitles the
   * chart to that epic even when the scope picker is on \"All\" or on
   * an initiative). Otherwise fall back to `scopeTitleSuffix` (the
   * Epic/Initiative Scope picker selection).
   */
  const burndownTitleSuffix = useMemo<ReactNode>(() => {
    if (burndownVisibleKeys.length === 1) {
      const key = burndownVisibleKeys[0]!;
      // Skip the "single-visible-key" treatment when the lone key is the
      // aggregate sentinel — there's no single epic to label or link to.
      if (key !== "epicIdeal" && key !== "__all__") {
        const item = burndownLegendItems.find((i) => i.key === key);
        if (item) {
          return (
            <span className="inline-flex items-center gap-1 text-[12.5px] font-normal text-slate-500">
              <span className="truncate max-w-[24rem]">{item.label}</span>
              {onOpenEpic ? (
                <button
                  type="button"
                  onClick={() => onOpenEpic(key)}
                  title="Open epic"
                  aria-label="Open epic"
                  className="inline-flex items-center justify-center text-slate-400 hover:text-slate-600"
                >
                  <ExternalLink className="size-3.5" />
                </button>
              ) : null}
            </span>
          );
        }
      }
    }
    if (scopeTitleSuffix) return scopeTitleSuffix;
    return null;
  }, [scopeTitleSuffix, burndownVisibleKeys, burndownLegendItems, onOpenEpic]);

  /** Same shape as `burndownTitleSuffix`, against the Burnup legend.
   *  Single-epic legend pick WINS over the scope picker. */
  const burnUpTitleSuffix = useMemo<ReactNode>(() => {
    if (burnUpVisibleKeys.length === 1) {
      const row = burnUpEpicRows.find((r) => r.id === burnUpVisibleKeys[0]);
      if (row) {
        const rowId = row.id;
        return (
          <span className="inline-flex items-center gap-1 text-[12.5px] font-normal text-slate-500">
            <span className="truncate max-w-[24rem]">{row.title}</span>
            {onOpenEpic ? (
              <button
                type="button"
                onClick={() => onOpenEpic(rowId)}
                title="Open epic"
                aria-label="Open epic"
                className="inline-flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <ExternalLink className="size-3.5" />
              </button>
            ) : null}
          </span>
        );
      }
    }
    if (scopeTitleSuffix) return scopeTitleSuffix;
    return null;
  }, [scopeTitleSuffix, burnUpVisibleKeys, burnUpEpicRows, onOpenEpic]);

  const workloadStoriesScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollWorkloadUp, setCanScrollWorkloadUp] = useState(false);
  const [canScrollWorkloadDown, setCanScrollWorkloadDown] = useState(false);
  const updateWorkloadArrowState = () => {
    const node = workloadStoriesScrollRef.current;
    if (!node) {
      setCanScrollWorkloadUp(false);
      setCanScrollWorkloadDown(false);
      return;
    }
    const epsilon = 2;
    setCanScrollWorkloadUp(node.scrollTop > epsilon);
    setCanScrollWorkloadDown(node.scrollTop + node.clientHeight < node.scrollHeight - epsilon);
  };
  const scrollWorkloadStoriesBy = (delta: number) => {
    workloadStoriesScrollRef.current?.scrollBy({ top: delta, behavior: "smooth" });
  };
  // Workload / Month-Load drilldown arrow-state helpers + scroll refs
  // were removed — native scrollbar replaces the chevron chrome.

  const monthLoadScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollMonthLoadUp, setCanScrollMonthLoadUp] = useState(false);
  const [canScrollMonthLoadDown, setCanScrollMonthLoadDown] = useState(false);
  const updateMonthLoadArrowState = () => {
    const node = monthLoadScrollRef.current;
    if (!node) {
      setCanScrollMonthLoadUp(false);
      setCanScrollMonthLoadDown(false);
      return;
    }
    const epsilon = 2;
    setCanScrollMonthLoadUp(node.scrollTop > epsilon);
    setCanScrollMonthLoadDown(node.scrollTop + node.clientHeight < node.scrollHeight - epsilon);
  };
  const scrollMonthLoadBy = (delta: number) => {
    monthLoadScrollRef.current?.scrollBy({ top: delta, behavior: "smooth" });
  };
  useEffect(() => {
    updateWorkloadArrowState();
  }, [analytics.workloadByAssignee.length, workloadStatusFilters]);
  useEffect(() => {
    updateMonthLoadArrowState();
  }, [analytics.workloadCapacityByAssignee.length, analytics.monthDaysLeft]);
  /** Auto-expand epic accordion groups whose children match the active
   *  column filter — fires once per filter change (every keystroke
   *  counts as a "change", which is what the planner asked for: "if I
   *  type anything new in the filter it can open the accordion"). The
   *  pure-state `isCollapsed` check in each tbody then honors any
   *  manual chevron-click between filter changes, so the planner can
   *  collapse an uninteresting epic and have that stick until they
   *  type more. When the filter clears, every epic collapses back to
   *  the browse default. */
  useEffect(() => {
    if (monthLoadDrilldownAssignee == null) return;
    if (!isDrilldownFilterActive(monthLoadDrilldownFilter)) {
      setExpandedDrilldownEpics(new Set());
      return;
    }
    const storyIdSet = new Set(monthLoadDrilldownStories.map((s) => s.id));
    const matching = new Set<string>();
    for (const { epic } of monthEpics) {
      if ((epic.userStories ?? []).some((s) => storyIdSet.has(s.id))) matching.add(epic.id);
    }
    setExpandedDrilldownEpics(matching);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthLoadDrilldownFilter, monthLoadDrilldownAssignee]);
  useEffect(() => {
    if (workloadDrilldownAssignee == null) return;
    if (!isDrilldownFilterActive(workloadDrilldownFilter)) {
      setExpandedDrilldownEpics(new Set());
      return;
    }
    const storyIdSet = new Set(workloadDrilldownStories.map((s) => s.id));
    const matching = new Set<string>();
    for (const { epic } of monthEpics) {
      if ((epic.userStories ?? []).some((s) => storyIdSet.has(s.id))) matching.add(epic.id);
    }
    setExpandedDrilldownEpics(matching);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workloadDrilldownFilter, workloadDrilldownAssignee]);
  useEffect(() => {
    if (statusDrilldownFilter == null) return;
    if (statusChartShowsEpics) {
      // Epics variant: each row IS an epic. "Expanded" means the epic
      // shows its child stories. Pre-expand every epic in the filtered
      // list so child rows are visible under each.
      if (!isEpicDrilldownFilterActive(statusDrilldownEpicFilter)) {
        setExpandedDrilldownEpics(new Set());
        return;
      }
      setExpandedDrilldownEpics(new Set(statusDrilldownEpics.map((e) => e.id)));
      return;
    }
    if (!isDrilldownFilterActive(statusDrilldownColFilter)) {
      setExpandedDrilldownEpics(new Set());
      return;
    }
    const storyIdSet = new Set(statusDrilldownStories.map((s) => s.id));
    const matching = new Set<string>();
    for (const { epic } of monthEpics) {
      if ((epic.userStories ?? []).some((s) => storyIdSet.has(s.id))) matching.add(epic.id);
    }
    setExpandedDrilldownEpics(matching);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusDrilldownColFilter, statusDrilldownEpicFilter, statusDrilldownFilter, statusChartShowsEpics]);

  const legendRowClass =
    "flex items-center gap-1.5 rounded-lg bg-slate-50/80 px-1.5 py-1.5 text-[13px] font-medium text-slate-700";
  /** Project-standard pastel scrollbar — matches the initiative-list
   *  panel + roadmap-health-hero scrollers so the drilldown tables
   *  scroll the same way as the rest of the planner. Replaces the
   *  hidden-scrollbar + up/down arrow chrome that used to live here. */
  const sharedDrilldownScrollAreaClass =
    "h-full min-h-0 w-full min-w-0 overflow-y-auto overflow-x-hidden bg-white pr-2 [scrollbar-color:theme(colors.indigo.100)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gradient-to-b [&::-webkit-scrollbar-thumb]:from-sky-100 [&::-webkit-scrollbar-thumb]:via-indigo-100 [&::-webkit-scrollbar-thumb]:to-violet-100 hover:[&::-webkit-scrollbar-thumb]:from-sky-200 hover:[&::-webkit-scrollbar-thumb]:via-indigo-200 hover:[&::-webkit-scrollbar-thumb]:to-violet-200";
  /** Matches backlog / users directory soft zebra (#f4f7fc / white) */
  const drilldownTableRowZebra =
    "border-t border-[#7cd3f7]/95 text-slate-700 odd:bg-[#f4f7fc] even:bg-white transition hover:bg-[#c5ebff]";
  const drilldownTableEmptyRowZebra =
    "border-t border-[#7cd3f7]/60 text-slate-400 odd:bg-[#f4f7fc]/55 even:bg-white";
  const drilldownTableClass = "w-full table-fixed border-collapse text-left text-[13px]";
  // Each `<col>` here matches one `<th>` in the corresponding table
  // header. When adding a column, ADD a matching col here AND the
  // header AND the body cell AND (when filterable) the filter-row cell.
  // The trailing two columns (Est days / Est days left) are the
  // narrow right-edge slots; the Health column sits just before them.
  const drilldownColgroup = (
    <colgroup>
      <col className="w-[4%]" />
      <col className="w-[11%]" />
      <col className="w-[26%]" />
      <col className="w-[14%]" />
      <col className="w-[16%]" />
      <col className="w-[12%]" />
      <col className="w-[8.5%]" />
      <col className="w-[8.5%]" />
    </colgroup>
  );
  /** Same as `drilldownColgroup` plus a Health column slot. Used by
   *  the Status drill-down's story variant; will be reused once the
   *  other modals (Workload, Month Load) grow their Health column too. */
  const drilldownColgroupWithHealth = (
    <colgroup>
      <col className="w-[4%]" />
      <col className="w-[10%]" />
      <col className="w-[22%]" />
      <col className="w-[12%]" />
      <col className="w-[14%]" />
      <col className="w-[10%]" />
      <col className="w-[12%]" />
      <col className="w-[8%]" />
      <col className="w-[8%]" />
    </colgroup>
  );
  const drilldownColgroupWithTeam = (
    <colgroup>
      <col className="w-[4%]" />
      <col className="w-[10%]" />
      <col className="w-[21%]" />
      <col className="w-[11%]" />
      <col className="w-[11%]" />
      <col className="w-[10%]" />
      <col className="w-[16%]" />
      <col className="w-[8.5%]" />
      <col className="w-[8.5%]" />
    </colgroup>
  );
  const drilldownColgroupWithTeamAndHealth = (
    <colgroup>
      <col className="w-[4%]" />
      <col className="w-[9%]" />
      <col className="w-[14%]" />
      <col className="w-[10%]" />
      <col className="w-[13%]" />
      <col className="w-[9%]" />
      <col className="w-[12%]" />
      <col className="w-[10%]" />
      <col className="w-[9%]" />
      <col className="w-[10%]" />
    </colgroup>
  );
  const drilldownColgroupEpic = (
    <colgroup>
      <col className="w-[4%]" />
      <col className="w-[11%]" />
      <col className="w-[30%]" />
      <col className="w-[13%]" />
      <col className="w-[14%]" />
      <col className="w-[11%]" />
      <col className="w-[8.5%]" />
      <col className="w-[8.5%]" />
    </colgroup>
  );
  // Snapshot strip framing for charts surface — when the scope period has
  // ended, tell the user the charts are read from end-of-period snapshots,
  // not live state. Scope determined by scopeMonths length: 1 = month,
  // 3 = quarter, 12 = year.
  const snapshotStripScope: SnapshotHeaderStripScope =
    scopeMonths.length >= 12 ? "year" : scopeMonths.length >= 2 ? "quarter" : "month";
  const snapshotPeriodLabel = scopeLabel === "Year"
    ? `${planYear}`
    : scopeLabel === "Quarter"
      ? `${periodLabel ?? "Quarter"} ${planYear}`
      : `${new Date(planYear, scopeStartMonth - 1).toLocaleString(undefined, { month: "short" })} ${planYear}`;
  const snapshotCloseDateLabel = new Date(periodCloseMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return (
    <section
      // `pl-1 pt-1` (was `p-4` all-around) tightens TWO insets:
      // - Left: gap between the context rail's right edge and the
      //   "Epic / Initiative Scope" banner (was 16px; rail is 36px now,
      //   gap read as wasted space).
      // - Top: gap between the Map/Activity rail icons and the scope
      //   banner top (was 16px; planner wanted them aligned, since the
      //   rail is positioned `absolute top-0` of its sibling wrapper).
      // Bottom + right padding unchanged so the dot-grid backplate
      // still frames the charts beneath.
      className="mb-2 flex flex-col gap-3.5 rounded-xl pb-4 pt-1 pl-1 pr-4"
      style={{
        backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      {isPastPeriod ? (
        <SnapshotHeaderStrip
          scope={snapshotStripScope}
          periodLabel={snapshotPeriodLabel}
          closeDateLabel={snapshotCloseDateLabel}
          rolledCount={0}
          nextPeriodLabel="next period"
          framing="charts"
        />
      ) : null}
      <div className="-mt-1 rounded-xl bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 px-4 py-2 shadow-[inset_0_2px_5px_rgba(15,23,42,0.16),inset_0_-1px_0_rgba(255,255,255,0.55)]">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-slate-700" htmlFor="month-insights-epic-filter">
            <ChartNoAxesCombined className="size-4 text-slate-500" aria-hidden />
            Epic / Initiative Scope
          </label>
          <div className="relative min-w-0 max-w-[44rem] flex-1 basis-[20rem]">
            {/* Selected-scope glyph — Zap for initiative, Folder for epic.
             *  Hidden when scope is "All"; sits inside the input so the
             *  selected value reads "[icon] Epic Name". */}
            {selectedEpicOption ? (
              <Folder className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" aria-hidden />
            ) : selectedInitiativeId !== "all" ? (
              <Zap className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-blue-500" aria-hidden />
            ) : null}
            <input
              id="month-insights-epic-filter"
              value={epicInput}
              autoComplete="off"
              onFocus={() => {
                setIsEpicDropdownOpen(true);
                setShowAllEpicSuggestions(true);
              }}
              onClick={() => {
                setIsEpicDropdownOpen(true);
                setShowAllEpicSuggestions(true);
              }}
              onBlur={() =>
                window.setTimeout(() => {
                  setIsEpicDropdownOpen(false);
                  setShowAllEpicSuggestions(false);
                }, 100)
              }
              onChange={(e) => {
                const v = e.target.value;
                setEpicInput(v);
                setIsEpicDropdownOpen(true);
                setShowAllEpicSuggestions(false);
                if (!v.trim()) {
                  setSelectedEpicId("all");
                  setSelectedInitiativeId("all");
                  return;
                }
                const exact = epicComboOptions.find((opt) => opt.label === v);
                if (exact) setSelectedEpicId(exact.id);
              }}
              placeholder="All Epics & Initiatives"
              className={cn(
                "h-10 w-full rounded-md border border-slate-200 bg-white pr-2 text-[13px] font-semibold text-slate-700",
                selectedEpicOption || selectedInitiativeId !== "all" ? "pl-7" : "pl-2",
              )}
              aria-label="Filter insights by epic or initiative"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSelectedEpicId("all");
                setSelectedInitiativeId("all");
                setEpicInput("");
                setIsEpicDropdownOpen(true);
                setShowAllEpicSuggestions(true);
              }}
              className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Clear scope filter"
              title="Clear filter (show all)"
            >
              <Eraser className="size-3.5" aria-hidden />
            </button>
            {isEpicDropdownOpen ? (
              <div
                // z-50 keeps the dropdown above the Progress pie's
                // center button (z-20). Without this the donut's
                // "Σ Epics 18" label bleeds through the dropdown
                // panel when both overlap.
                className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-72 overflow-auto rounded-xl bg-white p-1.5 shadow-xl"
                onMouseLeave={() => {
                  setIsEpicDropdownOpen(false);
                  setShowAllEpicSuggestions(false);
                }}
              >
                {/* Status filter chips — toggle to narrow the dropdown to
                 *  epics whose computed health matches the selected set.
                 *  Empty selection = show all. Clear button removes all
                 *  status filters with one click. */}
                <div
                  className="sticky top-0 z-10 -mt-1.5 mb-1 flex flex-wrap items-center gap-2 border-b border-slate-100 bg-white/95 px-1 pb-1 pt-1.5"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Status</span>
                  {(["done", "onTrack", "watch", "atRisk", "overdue"] as HealthStatus[]).map((status) => {
                    const meta = (() => {
                      switch (status) {
                        case "done": return { label: "Done", chip: "bg-emerald-500 text-white ring-emerald-600/60" };
                        case "onTrack": return { label: "On Track", chip: "bg-emerald-100 text-emerald-800 ring-emerald-300/60" };
                        case "watch": return { label: "Watch", chip: "bg-amber-100 text-amber-800 ring-amber-300/60" };
                        case "atRisk": return { label: "At Risk", chip: "bg-rose-100 text-rose-800 ring-rose-300/60" };
                        case "overdue": return { label: "Overdue", chip: "bg-rose-200 text-rose-900 ring-rose-400/70" };
                      }
                    })();
                    const active = scopeHealthFilter.has(status);
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => {
                          setScopeHealthFilter((prev) => {
                            const next = new Set(prev);
                            if (next.has(status)) next.delete(status);
                            else next.add(status);
                            return next;
                          });
                        }}
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 transition",
                          active ? meta.chip : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50",
                        )}
                      >
                        {meta.label}
                      </button>
                    );
                  })}
                  {scopeHealthFilter.size > 0 ? (
                    <button
                      type="button"
                      onClick={() => setScopeHealthFilter(new Set())}
                      className="ml-auto text-[10.5px] font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                {filteredEpicGroups.length > 0 ? (
                  filteredEpicGroups.map((group) => (
                    <div key={group.initiativeId} className="mb-1 rounded-lg border border-slate-100 bg-slate-50/60 p-1">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedInitiativeId(group.initiativeId);
                          setSelectedEpicId("all");
                          setEpicInput(group.initiativeTitle);
                          setIsEpicDropdownOpen(false);
                          setShowAllEpicSuggestions(false);
                        }}
                        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700"
                      >
                        <Zap className="size-3.5 shrink-0 text-blue-500" aria-hidden />
                        <span className="truncate">{group.initiativeTitle}</span>
                        {group.health ? (
                          <span className="ml-auto inline-flex shrink-0 normal-case tracking-normal">
                            <HealthBadge status={group.health} tooltip={group.healthTooltip ?? undefined} />
                          </span>
                        ) : null}
                      </button>
                      {/* Tree-connector for the epics under this initiative.
                       *  A vertical line on the left + a small horizontal
                       *  stub before each Folder glyph reads as a typical
                       *  file-tree, matching how the backlog renders
                       *  nested rows. */}
                      {group.epics.length > 0 ? (
                        <div className="relative ml-3 border-l border-slate-200 pl-1">
                          {group.epics.map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setSelectedEpicId(opt.id);
                                setEpicInput(opt.label);
                                setIsEpicDropdownOpen(false);
                                setShowAllEpicSuggestions(false);
                              }}
                              className="relative flex w-full items-center gap-1.5 rounded-md py-1.5 pl-3 pr-2 text-left text-[13px] text-slate-700 transition before:absolute before:left-0 before:top-1/2 before:h-px before:w-2.5 before:bg-slate-200 hover:bg-slate-100"
                            >
                              <Folder className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                              <span className="truncate">{opt.label}</span>
                              {opt.teamLabel ? (
                                <span className="ml-auto inline-flex items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-600 ring-1 ring-slate-200">
                                  <TeamAvatar slug={opt.teamId} sizePx={10} fallback={<Users className="size-2.5 shrink-0 opacity-70" aria-hidden />} />
                                  {opt.teamLabel}
                                </span>
                              ) : null}
                              {opt.health ? (
                                <span className={cn("inline-flex shrink-0", !opt.teamLabel && "ml-auto")}>
                                  <HealthBadge status={opt.health} tooltip={opt.healthTooltip ?? undefined} />
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="px-2 py-1.5 text-[12px] text-slate-500">No matching epics</p>
                )}
              </div>
            ) : null}
          </div>
          {selectedEpicOption ? (
            <button
              type="button"
              onClick={() => onOpenEpic?.(selectedEpicOption.epic.id)}
              className="h-9 shrink-0 rounded-md px-2.5 text-[13px] font-semibold text-blue-700 underline-offset-2 transition hover:bg-blue-50 hover:underline"
            >
              Epic Details
            </button>
          ) : null}
          {/* Shared "Health calculation" basis picker — was a per-chart
           *  ToggleGroup on each of Epic Burndown + Epic Scope Burnup,
           *  collapsed into one source of truth that writes BOTH states
           *  so the two charts always carry the same basis. Pushed to the
           *  far right via `ml-auto` when there's room; on narrower
           *  viewports the parent's `flex-wrap` drops it onto a new line
           *  inside the same banner. `basis-[18rem]` is the comfortable
           *  width for all three labels on one row, but the picker can
           *  shrink below that when space is tight (no `min-w` lock). */}
          <div className="ml-auto shrink-0 basis-[18rem]">
            <ToggleGroup
              label=""
              options={
                selectedEpicOption != null
                  ? [
                      // Epic Est removed from the health UI; capacity-
                      // planning still reads `epic.originalEstimateDays`
                      // through other surfaces.
                      { value: "days", label: "Σ | Child Est (d)", icon: BookOpen },
                      { value: "stories", label: "Stories Completed (%)", icon: CheckCircle2 },
                    ]
                  : [
                      { value: "days", label: "Σ | Child Est (d)", icon: BookOpen },
                      { value: "stories", label: "Stories Completed (%)", icon: CheckCircle2 },
                    ]
              }
              value={burndownBasis}
              onChange={(v) => {
                const next = v as "days" | "stories" | "epicEst";
                setBurndownBasis(next);
                setBurnupBasis(next);
              }}
            />
          </div>
          {/* Selected-scope chips — pinned right. Epic shows team + assignee.
              Health verdict moved onto each chart's own header so the badge
              matches that chart's basis selection (the two charts can carry
              different bases via their per-chart toggles). */}
          {selectedEpicOption && selectedEpicMeta ? (
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-3">
              {selectedEpicMeta.teamLabel ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-200 shadow-sm">
                  <TeamAvatar slug={selectedEpicOption.epic.team} sizePx={16} fallback={<Users className="size-4 shrink-0 opacity-70" aria-hidden />} />
                  {selectedEpicMeta.teamLabel}
                </span>
              ) : null}
              {selectedEpicOption.epic.assignee ? (() => {
                const assignee = selectedEpicOption.epic.assignee!;
                const resolved = resolveAssigneeAvatar(assignee, workspaceDirectoryUsers);
                return (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-white py-1 pl-1 pr-2.5 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-200 shadow-sm">
                    {resolved.image ? (
                      <UserAvatar name={resolved.name} image={resolved.image} size={22} className="ring-0" />
                    ) : (
                      <User className="ml-0.5 size-4 shrink-0 opacity-70" aria-hidden />
                    )}
                    <span>{assignee}</span>
                  </span>
                );
              })() : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
      <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-1 lg:h-full">
        <div className={cn("mb-2 flex shrink-0 items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
          <div className="flex min-w-0 flex-col">
          <h3
            className={cn(
              "inline-flex items-center gap-1.5 font-semibold text-slate-800",
              isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
            )}
          >
            <PieChartIcon className="size-4 text-slate-600" />
            {statusPanelTitle}
          </h3>
          {scopeTitleSuffix ? (
            <div className="mt-0.5">{scopeTitleSuffix}</div>
          ) : null}
          </div>
          {/* Mode switch — only shown when no specific epic is pinned
           *  (otherwise the chart always rolls up to user stories). Two
           *  small pill buttons that flip the donut between epic-level
           *  status and story-level status, and rewire the
           *  slice-click → drilldown table to match. */}
          {statusChartToggleAvailable ? (
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-[11.5px] font-medium shadow-sm">
              <button
                type="button"
                onClick={() => setStatusChartMode("epics")}
                className={cn(
                  "rounded px-2 py-0.5 transition",
                  statusChartMode === "epics"
                    ? "bg-slate-100 text-slate-800"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
                )}
                title="Show epic-level status rollup"
              >
                Epics
              </button>
              <button
                type="button"
                onClick={() => setStatusChartMode("stories")}
                className={cn(
                  "rounded px-2 py-0.5 transition",
                  statusChartMode === "stories"
                    ? "bg-slate-100 text-slate-800"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
                )}
                title="Show user-story status pie"
              >
                Stories
              </button>
            </div>
          ) : null}
        </div>
        {statusDrilldownFilter ? (() => {
          const uniqueSprints = statusChartShowsEpics ? [] : Array.from(new Set(statusDrilldownStoriesRaw.map((s) => storySprintDisplayLabel(s.sprint, scopeStartMonth)))).filter(Boolean).sort();
          const uniqueAssignees = statusChartShowsEpics ? [] : Array.from(new Set(statusDrilldownStoriesRaw.map((s) => s.assignee?.trim() || "Unassigned"))).filter(Boolean).sort();
          const uniqueStatuses: string[] = statusChartShowsEpics
            ? []
            : (() => {
                const base = Array.from(new Set(statusDrilldownStoriesRaw.map((s) => s.status as string))).sort();
                const hasUnscheduled = statusDrilldownStoriesRaw.some((s) => s.sprint == null);
                return hasUnscheduled ? base.concat("unscheduled") : base;
              })();
          // Epic-variant unique sets — populated only when the table is
          // showing epics (statusChartShowsEpics = true).
          const uniqueEpicAssignees = !statusChartShowsEpics ? [] : Array.from(new Set(statusDrilldownEpicsRaw.map((e) => e.assignee?.trim() || "Unassigned"))).filter(Boolean).sort();
          const uniqueEpicStatuses = !statusChartShowsEpics ? [] : Array.from(new Set(statusDrilldownEpicsRaw.map((e) => epicStatusById.get(e.id) ?? "To do"))).sort();
          return (
          <InsightsDrilldownModal
            title={`${statusPanelTitle} · ${statusDrilldownFilter}`}
            icon={<PieChartIcon className="size-4 text-slate-600" aria-hidden />}
            subtitle={(() => {
              const count = statusChartShowsEpics ? statusDrilldownEpics.length : statusDrilldownStories.length;
              const noun = statusChartShowsEpics ? "epic" : "user stor";
              const plural = statusChartShowsEpics ? "epics" : "user stories";
              const itemLabel = count === 1 ? (statusChartShowsEpics ? "epic" : "user story") : plural;
              const countLabel = `${count} ${itemLabel} presented`;
              return scopeTitleSuffix ? `${scopeTitleSuffix} · ${countLabel}` : countLabel;
            })()}
            onClose={clearStatusDrilldown}
          >
          <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
            <div className="relative flex-1 min-h-0 min-w-0">
              <div
                className={sharedDrilldownScrollAreaClass}
                style={{ scrollbarWidth: "thin" }}
              >
              <table className={drilldownTableClass}>
                {statusChartShowsEpics ? drilldownColgroupEpic : drilldownColgroupWithHealth}
                <thead className="sticky top-0 z-10 overflow-hidden rounded-t-md border-b border-[#19abeb]/70 bg-[#0897d5] text-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                  {statusChartShowsEpics ? (
                    <>
                    <tr>
                      <th className="min-w-0 px-2 py-1 text-right text-[14px]">#</th>
                      <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                        <DrilldownSortHeader label="Epic ID" column={"id" as DrilldownSortKey} sort={statusDrilldownEpicSort as { key: DrilldownSortKey; dir: "asc" | "desc" } | null} onSortChange={(next) => setStatusDrilldownEpicSort(next as { key: EpicDrilldownSortKey; dir: "asc" | "desc" } | null)} />
                      </th>
                      <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                        <DrilldownSortHeader label="Epic name" column={"title" as DrilldownSortKey} sort={statusDrilldownEpicSort as { key: DrilldownSortKey; dir: "asc" | "desc" } | null} onSortChange={(next) => setStatusDrilldownEpicSort(next as { key: EpicDrilldownSortKey; dir: "asc" | "desc" } | null)} />
                      </th>
                      <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                        <DrilldownSortHeader label="Assignee" column={"assignee" as DrilldownSortKey} sort={statusDrilldownEpicSort as { key: DrilldownSortKey; dir: "asc" | "desc" } | null} onSortChange={(next) => setStatusDrilldownEpicSort(next as { key: EpicDrilldownSortKey; dir: "asc" | "desc" } | null)} />
                      </th>
                      <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                        <DrilldownSortHeader label="Status" column={"status" as DrilldownSortKey} sort={statusDrilldownEpicSort as { key: DrilldownSortKey; dir: "asc" | "desc" } | null} onSortChange={(next) => setStatusDrilldownEpicSort(next as { key: EpicDrilldownSortKey; dir: "asc" | "desc" } | null)} />
                      </th>
                      <th className="min-w-0 px-2 py-1 text-[14px] text-left">Health</th>
                      <th className="min-w-0 px-2 py-1 text-right text-[14px]">Est days</th>
                      <th className="min-w-0 px-2 py-1 text-right text-[14px]">Est days left</th>
                    </tr>
                    <tr className="bg-white/95">
                      <th className="min-w-0 px-1 py-0.5" />
                      <th className="min-w-0 px-1 py-0.5" />
                      <th className="min-w-0 px-1 py-0.5">
                        <DrilldownFilterInputText value={statusDrilldownEpicFilter.title} onChange={(v) => setStatusDrilldownEpicFilter((p) => ({ ...p, title: v }))} ariaLabel="Filter epic progress by epic name" />
                      </th>
                      <th className="min-w-0 px-1 py-0.5">
                        <DrilldownFilterDropdown
                          value={statusDrilldownEpicFilter.assignee}
                          options={uniqueEpicAssignees}
                          renderOption={(name) => {
                            const resolved = resolveAssigneeAvatar(name, workspaceDirectoryUsers);
                            return (
                              <span className="inline-flex items-center gap-1.5">
                                <UserAvatar name={resolved.name} image={resolved.image} size={16} className="ring-0" />
                                <span className="truncate">{name}</span>
                              </span>
                            );
                          }}
                          onChange={(v) => setStatusDrilldownEpicFilter((p) => ({ ...p, assignee: v }))}
                          ariaLabel="Filter epic progress by assignee"
                        />
                      </th>
                      <th className="min-w-0 px-1 py-0.5">
                        <DrilldownFilterDropdown
                          value={statusDrilldownEpicFilter.status}
                          options={uniqueEpicStatuses}
                          renderOption={renderEpicStatusOption}
                          onChange={(v) => setStatusDrilldownEpicFilter((p) => ({ ...p, status: v }))}
                          ariaLabel="Filter epic progress by status"
                        />
                      </th>
                      <th className="min-w-0 px-1 py-0.5">
                        <DrilldownFilterDropdown
                          value={statusDrilldownEpicFilter.health}
                          options={HEALTH_FILTER_OPTIONS}
                          renderOption={renderHealthFilterOption}
                          onChange={(v) => setStatusDrilldownEpicFilter((p) => ({ ...p, health: v as HealthStatus | null }))}
                          ariaLabel="Filter epic progress by health"
                        />
                      </th>
                      {/* Σ totals: sum the est days + remaining across each
                       *  epic's child stories so the planner sees the
                       *  drilldown's collective effort. */}
                      <th className="min-w-0 px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                        Σ <span className="text-slate-300">|</span> {statusDrilldownEpics.reduce((sum, epic) => sum + (epic.userStories ?? []).reduce((a, s) => a + (s.estimatedDays ?? 0), 0), 0)}
                      </th>
                      <th className="min-w-0 px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                        Σ <span className="text-slate-300">|</span> {statusDrilldownEpics.reduce((sum, epic) => sum + (epic.userStories ?? []).reduce((a, s) => a + (s.daysLeft ?? 0), 0), 0)}
                      </th>
                    </tr>
                    </>
                  ) : (
                    <>
                    <tr>
                      <th className="min-w-0 px-2 py-1 text-right text-[14px]">#</th>
                      <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                        <DrilldownSortHeader label="Story ID" column="id" sort={statusDrilldownSort} onSortChange={setStatusDrilldownSort} />
                      </th>
                      <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                        <DrilldownSortHeader label="Story name" column="title" sort={statusDrilldownSort} onSortChange={setStatusDrilldownSort} />
                      </th>
                      <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                        <DrilldownSortHeader label="Sprint" column="sprint" sort={statusDrilldownSort} onSortChange={setStatusDrilldownSort} />
                      </th>
                      <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                        <DrilldownSortHeader label="Assignee" column="assignee" sort={statusDrilldownSort} onSortChange={setStatusDrilldownSort} />
                      </th>
                      <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                        <DrilldownSortHeader label="Status" column="status" sort={statusDrilldownSort} onSortChange={setStatusDrilldownSort} />
                      </th>
                      <th className="min-w-0 px-2 py-1 text-[14px] text-left">Health</th>
                      <th className="min-w-0 px-2 py-1 text-right text-[14px]">Est days</th>
                      <th className="min-w-0 px-2 py-1 text-right text-[14px]">Est days left</th>
                    </tr>
                    <tr className="bg-white/95">
                      <th className="min-w-0 px-1 py-0.5" />
                      <th className="min-w-0 px-1 py-0.5" />
                      <th className="min-w-0 px-1 py-0.5">
                        <DrilldownFilterInputText value={statusDrilldownColFilter.title} onChange={(v) => setStatusDrilldownColFilter((p) => ({ ...p, title: v }))} ariaLabel="Filter status drilldown by story name" />
                      </th>
                      <th className="min-w-0 px-1 py-0.5">
                        <DrilldownFilterDropdown value={statusDrilldownColFilter.sprint} options={uniqueSprints} renderOption={renderSprintOption} onChange={(v) => setStatusDrilldownColFilter((p) => ({ ...p, sprint: v }))} ariaLabel="Filter status drilldown by sprint" />
                      </th>
                      <th className="min-w-0 px-1 py-0.5">
                        <DrilldownFilterDropdown
                          value={statusDrilldownColFilter.assignee}
                          options={uniqueAssignees}
                          renderOption={(name) => {
                            const resolved = resolveAssigneeAvatar(name, workspaceDirectoryUsers);
                            return (
                              <span className="inline-flex items-center gap-1.5">
                                <UserAvatar name={resolved.name} image={resolved.image} size={16} className="ring-0" />
                                <span className="truncate">{name}</span>
                              </span>
                            );
                          }}
                          onChange={(v) => setStatusDrilldownColFilter((p) => ({ ...p, assignee: v }))}
                          ariaLabel="Filter status drilldown by assignee"
                        />
                      </th>
                      <th className="min-w-0 px-1 py-0.5">
                        <DrilldownFilterDropdown value={statusDrilldownColFilter.status} options={uniqueStatuses} renderOption={renderStatusOption} onChange={(v) => setStatusDrilldownColFilter((p) => ({ ...p, status: v }))} ariaLabel="Filter status drilldown by status" />
                      </th>
                      <th className="min-w-0 px-1 py-0.5">
                        <DrilldownFilterDropdown
                          value={statusDrilldownColFilter.health}
                          options={HEALTH_FILTER_OPTIONS}
                          renderOption={renderHealthFilterOption}
                          onChange={(v) => setStatusDrilldownColFilter((p) => ({ ...p, health: v as HealthStatus | null }))}
                          ariaLabel="Filter status drilldown by health"
                        />
                      </th>
                      {/* Σ totals over the currently visible (filtered) rows. */}
                      <th className="min-w-0 px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                        Σ <span className="text-slate-300">|</span> {statusDrilldownStories.reduce((sum, s) => sum + (s.estimatedDays ?? 0), 0)}
                      </th>
                      <th className="min-w-0 px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                        Σ <span className="text-slate-300">|</span> {statusDrilldownStories.reduce((sum, s) => sum + (s.daysLeft ?? 0), 0)}
                      </th>
                    </tr>
                    </>
                  )}
                </thead>
                <tbody>
                  {statusChartShowsEpics
                    ? (() => {
                        // Epic-variant: each epic row becomes an
                        // accordion header (chevron in the `#` cell);
                        // expanding it reveals the epic's child stories
                        // with a tree connector. Same 8 columns map to
                        // the story rows (sprint + team dropped — they
                        // don't have epic-level analogues here).
                        const rendered: ReactNode[] = [];
                        statusDrilldownEpics.forEach((epic, idx) => {
                          const epicStatusLabel = epicStatusById.get(epic.id) ?? "To do";
                          const epicStatusKey =
                            epicStatusLabel === "Done" ? "done"
                            : epicStatusLabel === "Review / Testing" ? "review"
                            : epicStatusLabel === "In progress" ? "inProgress"
                            : epicStatusLabel === "To do" ? "todo"
                            : null;
                          const isCollapsed = !expandedDrilldownEpics.has(epic.id);
                          const stories = epic.userStories ?? [];
                          const epicEstSum = stories.reduce((a, s) => a + (s.estimatedDays ?? 0), 0);
                          const epicLeftSum = stories.reduce((a, s) => a + (s.daysLeft ?? 0), 0);
                          rendered.push(
                            <tr key={epic.id} className={drilldownTableRowZebra}>
                              <td className="min-w-0 px-2 py-0.5 text-right tabular-nums text-slate-500">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedDrilldownEpics((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(epic.id)) next.delete(epic.id);
                                      else next.add(epic.id);
                                      return next;
                                    });
                                  }}
                                  className="inline-flex items-center gap-1"
                                  aria-label={isCollapsed ? "Expand epic stories" : "Collapse epic stories"}
                                >
                                  <ChevronRight
                                    className={cn("size-3.5 shrink-0 text-slate-500 transition-transform", !isCollapsed && "rotate-90")}
                                    aria-hidden
                                  />
                                  <span>{idx + 1}</span>
                                </button>
                              </td>
                              <td className="min-w-0 px-2 py-0.5">
                                <span className="inline-flex min-w-0 items-center gap-1.5">
                                  <Folder className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                                  <InsightsTruncatedHoverButton
                                    label={scopedEpicDisplayIds.get(epic.id) ?? epic.id.slice(0, 8)}
                                    onClick={() => onOpenEpic?.(epic.id)}
                                    className="block min-w-0 max-w-full truncate text-left font-semibold text-blue-700 underline-offset-2 hover:underline"
                                  />
                                </span>
                              </td>
                              <td className="min-w-0 px-2 py-0.5">
                                <span className="inline-flex min-w-0 items-center gap-1.5">
                                  <Folder className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                                  <InsightsTruncatedHoverLabel text={epic.title} />
                                </span>
                              </td>
                              <td className="min-w-0 px-2 py-0.5">
                                <DrilldownAssigneeCell assignee={epic.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                              </td>
                              <td className="min-w-0 px-2 py-0.5">
                                {epicStatusKey ? (
                                  <StoryStatusPill status={epicStatusKey} />
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 font-semibold">
                                    <Circle className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                                    <span className="truncate text-slate-700">{epicStatusLabel}</span>
                                  </span>
                                )}
                              </td>
                              <td className="min-w-0 px-2 py-0.5">
                                {(() => {
                                  const v = computeEpicHealthVerdict(epic, planYear, progressBasis);
                                  if (!v) return <span className="text-slate-300">—</span>;
                                  const tip = formatHealthTooltip(v.result);
                                  return <HealthBadgeWithTextPopover size="xs" status={v.status} tooltip={tip} />;
                                })()}
                              </td>
                              <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">
                                {epicEstSum || "—"}
                              </td>
                              <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">
                                {epicLeftSum || "—"}
                              </td>
                            </tr>
                          );
                          if (isCollapsed || stories.length === 0) return;
                          stories.forEach((story, storyIdx) => {
                            const isLast = storyIdx === stories.length - 1;
                            rendered.push(
                              <tr key={`${epic.id}-${story.id}`} className="bg-white">
                                <td className="relative min-w-0 px-2 py-0.5 pl-6 text-right tabular-nums text-slate-500">
                                  <span
                                    className="absolute left-3 top-0 w-px bg-indigo-300"
                                    style={{ height: isLast ? "50%" : "100%" }}
                                    aria-hidden
                                  />
                                  <span className="absolute left-3 top-1/2 h-px w-3 -translate-y-px bg-indigo-300" aria-hidden />
                                  <span className="text-slate-400">·</span>
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  <span className="inline-flex min-w-0 items-center gap-1.5">
                                    <UserStoryIcon className="size-3.5" />
                                    <InsightsTruncatedHoverButton
                                      label={scopedStoryDisplayIds.get(story.id) ?? story.id.slice(0, 8)}
                                      onClick={() => onOpenStory?.(story.id)}
                                      className="block min-w-0 max-w-full truncate text-left font-semibold text-blue-700 underline-offset-2 hover:underline"
                                    />
                                  </span>
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  <InsightsTruncatedHoverLabel text={story.title} />
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  <DrilldownAssigneeCell assignee={story.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  <StoryStatusPill status={story.status} sprint={story.sprint} />
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  {(() => {
                                    const v = computeStoryHealthVerdict(story, epic, planYear);
                                    if (!v) return <span className="text-slate-300">—</span>;
                                    const tip = formatStoryHealthTooltip(story, epic, planYear, v.status);
                                    return <HealthBadgeWithTextPopover size="xs" status={v.status} tooltip={tip} />;
                                  })()}
                                </td>
                                <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.estimatedDays ?? "—"}</td>
                                <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.daysLeft ?? "—"}</td>
                              </tr>
                            );
                          });
                        });
                        return rendered;
                      })()
                    : (() => {
                        // Stories-variant: group filtered stories by
                        // parent epic, render each epic as a header row
                        // with chevron, children with tree connector.
                        // Mirrors the Team Progress / Workload Balance
                        // drilldowns.
                        const storyEpic = new Map<string, EpicItem>();
                        for (const { epic } of monthEpics) {
                          for (const s of epic.userStories ?? []) storyEpic.set(s.id, epic);
                        }
                        type Group = { epic: EpicItem; stories: typeof statusDrilldownStories };
                        const groupsMap = new Map<string, Group>();
                        for (const story of statusDrilldownStories) {
                          const epic = storyEpic.get(story.id);
                          if (!epic) continue;
                          const g = groupsMap.get(epic.id);
                          if (g) g.stories.push(story);
                          else groupsMap.set(epic.id, { epic, stories: [story] });
                        }
                        const groups = Array.from(groupsMap.values()).sort(
                          (a, b) => a.epic.title.localeCompare(b.epic.title),
                        );
                        let rowIdx = 0;
                        const rendered: ReactNode[] = [];
                        for (const { epic, stories } of groups) {
                          const isCollapsed = !expandedDrilldownEpics.has(epic.id);
                          const epicEstSum = stories.reduce((s, st) => s + (st.estimatedDays ?? 0), 0);
                          const epicLeftSum = stories.reduce((s, st) => s + (st.daysLeft ?? 0), 0);
                          {
                            const epicStatusLabel = epicStatusById.get(epic.id) ?? "To do";
                            const epicStatusKey =
                              epicStatusLabel === "Done" ? "done"
                              : epicStatusLabel === "Review / Testing" ? "review"
                              : epicStatusLabel === "In progress" ? "inProgress"
                              : epicStatusLabel === "To do" ? "todo"
                              : null;
                            rendered.push(
                              <tr key={`epic-${epic.id}`} className="bg-indigo-50/70 ring-1 ring-inset ring-indigo-100/80">
                                <td colSpan={4} className="px-2 py-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedDrilldownEpics((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(epic.id)) next.delete(epic.id);
                                        else next.add(epic.id);
                                        return next;
                                      });
                                    }}
                                    className="inline-flex w-full min-w-0 items-center gap-1.5 text-left"
                                  >
                                    <ChevronRight
                                      className={cn("size-4 shrink-0 text-slate-500 transition-transform", !isCollapsed && "rotate-90")}
                                      aria-hidden
                                    />
                                    <Folder className="size-3.5 shrink-0 text-sky-500" aria-hidden />
                                    <span className="min-w-0 truncate text-[13.5px] font-semibold text-slate-800">{epic.title}</span>
                                    <span className="ml-1 shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600 ring-1 ring-slate-200">
                                      {stories.length}
                                    </span>
                                  </button>
                                </td>
                                <td className="bg-indigo-50/70 px-2 py-1.5">
                                  <DrilldownAssigneeCell assignee={epic.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                                </td>
                                <td className="bg-indigo-50/70 px-2 py-1.5">
                                  {epicStatusKey ? (
                                    <StoryStatusPill status={epicStatusKey} />
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700">
                                      <Circle className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                                      <span className="truncate">{epicStatusLabel}</span>
                                    </span>
                                  )}
                                </td>
                                <td className="bg-indigo-50/70 px-2 py-1.5">
                                  {(() => {
                                    const v = computeEpicHealthVerdict(epic, planYear, progressBasis);
                                    if (!v) return <span className="text-slate-300">—</span>;
                                    const tip = formatHealthTooltip(v.result);
                                    return <HealthBadgeWithTextPopover size="xs" status={v.status} tooltip={tip} />;
                                  })()}
                                </td>
                                <td className="bg-indigo-50/70 px-2 py-1.5 text-right text-[12px] font-semibold tabular-nums text-slate-700">{epicEstSum}</td>
                                <td className="bg-indigo-50/70 px-2 py-1.5 text-right text-[12px] font-semibold tabular-nums text-slate-700">{epicLeftSum}</td>
                              </tr>
                            );
                          }
                          if (isCollapsed) continue;
                          stories.forEach((story, storyIdx) => {
                            rowIdx += 1;
                            const isLast = storyIdx === stories.length - 1;
                            rendered.push(
                              <tr key={story.id} className={drilldownTableRowZebra}>
                                <td className="relative min-w-0 px-2 py-0.5 pl-6 text-right tabular-nums text-slate-500">
                                  <span
                                    className="absolute left-3 top-0 w-px bg-indigo-300"
                                    style={{ height: isLast ? "50%" : "100%" }}
                                    aria-hidden
                                  />
                                  <span className="absolute left-3 top-1/2 h-px w-3 -translate-y-px bg-indigo-300" aria-hidden />
                                  {rowIdx}
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  <InsightsTruncatedHoverButton
                                    label={scopedStoryDisplayIds.get(story.id) ?? story.id.slice(0, 8)}
                                    onClick={() => onOpenStory?.(story.id)}
                                    className="block w-full max-w-full truncate text-left font-semibold text-blue-700 underline-offset-2 hover:underline"
                                  />
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  <InsightsTruncatedHoverLabel text={story.title} />
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  <span className="inline-flex min-w-0 items-center gap-1.5">
                                    <Flag className="size-3.5 shrink-0 text-rose-500" aria-hidden />
                                    {normalizeStoryYearSprint(story.sprint, scopeStartMonth) != null ? (
                                      <InsightsTruncatedHoverButton
                                        label={storySprintDisplayLabel(story.sprint, scopeStartMonth)}
                                        onClick={() => {
                                          const targetYearSprint = normalizeStoryYearSprint(story.sprint, scopeStartMonth);
                                          if (targetYearSprint == null) return;
                                          onOpenSprintKanban?.(targetYearSprint, resolveStoryTeamForSprintNav(story));
                                        }}
                                        className="block w-full max-w-full truncate text-left font-semibold text-blue-700 underline-offset-2 hover:underline"
                                      />
                                    ) : (
                                      <InsightsTruncatedHoverLabel text="Unscheduled" />
                                    )}
                                  </span>
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  <DrilldownAssigneeCell assignee={story.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  <StoryStatusPill status={story.status} sprint={story.sprint} />
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  {(() => {
                                    const v = computeStoryHealthVerdict(story, epic, planYear);
                                    if (!v) return <span className="text-slate-300">—</span>;
                                    const tip = formatStoryHealthTooltip(story, epic, planYear, v.status);
                                    return <HealthBadgeWithTextPopover size="xs" status={v.status} tooltip={tip} />;
                                  })()}
                                </td>
                                <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.estimatedDays ?? "—"}</td>
                                <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.daysLeft ?? "—"}</td>
                              </tr>
                            );
                          });
                        }
                        return rendered;
                      })()}
                  {statusDrilldownEmptyRows > 0
                    ? Array.from({ length: statusDrilldownEmptyRows }).map((_, index) => (
                        <tr key={`status-empty-${index}`} className={drilldownTableEmptyRowZebra}>
                          <td colSpan={statusChartShowsEpics ? 8 : 9} className="px-3 py-0.5 text-[13px]">
                            {"\u00A0"}
                          </td>
                        </tr>
                      ))
                    : null}
                </tbody>
              </table>
              </div>
            </div>
          </div>
          </InsightsDrilldownModal>
          );
        })() : null}
        <div
          className={cn(
            // Legend column 12.5 -> 14.5rem so "Review / Testing 35 (19%)"
            // fits on one line instead of wrapping to "Review /\nTesting".
            // Same total card width — the donut takes 2rem less. The
            // donut still has more than enough room at the chart's
            // typical aspect ratio.
            "grid flex-1 lg:grid-cols-[minmax(0,1fr)_14.5rem] lg:items-stretch",
            INSIGHTS_CHART_GRID_GAP,
            INSIGHTS_CONTENT_HEIGHT,
            // Pie panel needs a touch more vertical room than the shared
            // `INSIGHTS_CONTENT_HEIGHT` provides, or the top "% / label"
            // pair (e.g. "29% / To do") clips at the panel's upper edge.
            "min-h-[14rem] lg:h-[clamp(14rem,30vh,22rem)]",
          )}
        >
            <div
              className={`relative rounded-lg ${SPRINT_CHART_BOX}`}
            >
              {/* Chart container intentionally has NO `z-index` (was z-10
               *  before). Setting a z-index here created a stacking
               *  context that trapped the Recharts tooltip wrapper INSIDE
               *  the chart's subtree, so the center button (z-10) painted
               *  over the tooltip even though `wrapperStyle.zIndex` was
               *  40. Without a stacking context on this wrapper, the
               *  tooltip's z-40 bubbles up to the parent and correctly
               *  paints above the center button (z-10). The center
               *  button still wins click-capture vs the SVG because the
               *  button's container is positioned later in DOM order
               *  AND has a z-index ≥ 10. */}
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <defs>
                    <filter id="monthPieShadow">
                      <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#0f172a" floodOpacity="0.18" />
                    </filter>
                  </defs>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="38%"
                    outerRadius="68%"
                    paddingAngle={3}
                    cornerRadius={8}
                    stroke="#ffffff"
                    strokeWidth={2}
                    label={piePercentLabel}
                    labelLine={false}
                    filter="url(#monthPieShadow)"
                    isAnimationActive={false}
                    onClick={(entry) => openStatusDrilldown(String((entry as { name?: string }).name ?? ""))}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={(props) => (
                      <StatusPieTooltip
                        {...props}
                        total={pieTotal}
                        title={statusPanelTitle}
                      />
                    )}
                    wrapperStyle={{ zIndex: 40 }}
                  />
                </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Center "Σ Epics" / "Σ Stories" button — needs to capture
               *  clicks above the SVG (which otherwise intercepts them).
               *  z-10 is enough now that the chart container above no
               *  longer creates a stacking context; the tooltip's z-40
               *  paints above this button. */}
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => openStatusDrilldown("All")}
                  title={statusChartShowsEpics ? "See all epics in this scope" : "See all user stories in this scope"}
                  className="pointer-events-auto flex flex-col items-center rounded-full px-3 py-1 leading-none transition hover:bg-slate-50/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {statusChartShowsEpics ? "Σ Epics" : "Σ Stories"}
                  </p>
                  <p className="text-[18px] leading-none font-bold text-slate-900">{pieTotal}</p>
                </button>
              </div>
            </div>
            <div className={INSIGHTS_SCROLL_SIDE}>
              <button
                type="button"
                onClick={() => openStatusDrilldown("All")}
                className={cn(
                  "mb-0.5 w-full rounded-md px-1 py-1 text-left font-medium text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                  isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="size-3.5" aria-hidden />
                  All
                </span>
              </button>
              {pieData.map((slice) => {
                const pct = pieTotal > 0 ? Math.round((slice.value / pieTotal) * 100) : 0;
                return (
                  <button
                    key={slice.name}
                    type="button"
                    onClick={() => openStatusDrilldown(slice.name)}
                    className={cn(
                      "mb-0.5 flex w-full items-center justify-between gap-1.5 rounded-md px-1 py-1 text-left text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-700",
                      isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 font-normal">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[slice.name] ?? "#94a3b8" }}
                      />
                      {slice.name}
                    </span>
                    <span className={cn("font-semibold text-slate-500", isMultiPeriodInsights ? "text-[14px]" : "text-[13px]")}>
                      {slice.value} <span className="text-slate-500">({pct}%)</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
      </article>

      <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-1 lg:h-full">
        <div className={cn("mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
          <div className="ml-[35px] flex min-w-0 flex-col">
          <h3
            className={cn(
              "inline-flex items-center gap-1.5 font-semibold text-slate-800",
              isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
            )}
          >
            <Activity className="size-4 text-slate-600" />
            Epic Scope Burndown
            {burndownHealth ? (() => {
              // Build a scope label that matches what the chart actually
              // plots: a single focused epic (via scope picker OR legend
              // toggled down to one) wins, then the initiative title if
              // pinned, then "Visible N / Total" so partial legend
              // toggles read accurately.
              const focused = burndownFocusedEpicOption;
              const selectedInit = selectedInitiativeId !== "all"
                ? monthEpics.find((r) => r.initiative.id === selectedInitiativeId)?.initiative ?? null
                : null;
              const visibleEpicCount = monthBurndownEpics.filter((epic) => burndownVisibleKeys.length === 0 || burndownVisibleKeys.includes(epic.id)).length;
              const scopeLabel = focused
                ? `${focused.epic.title} (epic)`
                : selectedInit
                  ? `${selectedInit.title} (initiative)`
                  : visibleEpicCount < monthBurndownEpics.length
                    ? `${visibleEpicCount} of ${monthBurndownEpics.length} epics visible`
                    : `All ${monthBurndownEpics.length} epics in scope`;
              return (
                <HealthBadgeWithDetail
                  status={burndownHealth.status}
                  result={burndownHealth.result}
                  basis={burndownBasis}
                  basisLabel={basisDisplayLabel(burndownBasis, focused ? "epic" : selectedInit ? "initiative" : "initiative")}
                  scopeLabel={scopeLabel}
                  chartKind="burndown"
                  className="ml-1"
                  badgeClassName="py-0 text-[11.5px]"
                />
              );
            })() : null}
          </h3>
          {burndownTitleSuffix ? (
            <div className="mt-0.5">{burndownTitleSuffix}</div>
          ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Plan toggle — one switch that flips the focused-epic plan
             *  overlay (ideal line + "Due DD/MM" marker + "Epic scheduled"
             *  start marker) on or off. Defaults to ON so the chart still
             *  tells the same story out-of-the-box. Replaces the per-marker
             *  eye-with-slash hide affordance. Shared with the Burnup chart
             *  so the two read consistently. */}
            <button
              type="button"
              onClick={() => setShowEpicPlanMarkers((v) => !v)}
              title={showEpicPlanMarkers ? "Hide epic plan overlay (ideal, due, scheduled)" : "Show epic plan overlay (ideal, due, scheduled)"}
              aria-pressed={showEpicPlanMarkers}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition",
                showEpicPlanMarkers
                  ? "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <Target className="size-3.5" aria-hidden />
              Plan
            </button>
            {/* Forecast toggle — projects a straight-line trend from
             *  today's actual point to a zero-crossing date using the
             *  current burn rate. When the projected date is past the
             *  plan end, the chart's X-axis extends to include it. */}
            <button
              type="button"
              onClick={() => setShowBurndownForecast((v) => !v)}
              title={
                burnDownForecastDate
                  ? showBurndownForecast
                    ? `Hide forecast (current pace → ${burnDownForecastDate.getDate()}/${burnDownForecastDate.getMonth() + 1})`
                    : `Show forecast (current pace → ${burnDownForecastDate.getDate()}/${burnDownForecastDate.getMonth() + 1})`
                  : "Forecast unavailable (no burn yet)"
              }
              aria-pressed={showBurndownForecast}
              disabled={!burnDownForecastDate}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition",
                "disabled:cursor-not-allowed disabled:opacity-50",
                showBurndownForecast
                  ? "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <TrendingUp className="size-3.5" aria-hidden />
              Forecast
              {showBurndownForecast && burnDownForecastDate ? (
                <span className="ml-1 tabular-nums text-violet-600/90">
                  {burnDownForecastDate.getDate()}/{burnDownForecastDate.getMonth() + 1}
                </span>
              ) : null}
            </button>
          </div>
        </div>
        <div
          className={cn(
            // Burndown chart (full-width). Legend column removed per
            // planner request — the Insights "Epic / Initiative Scope"
            // picker above already drives which epics are visible, so a
            // redundant on-chart legend just consumed real estate.
            "grid min-h-0 flex-1 md:grid-cols-1 md:items-stretch",
            INSIGHTS_CHART_GRID_GAP,
            INSIGHTS_CONTENT_HEIGHT,
          )}
        >
          <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
            {monthBurndownEpics.length > 0 ? (
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthBurndownWithDueTarget} margin={{ top: 38, right: 24, left: 18, bottom: 18 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="axisLabel"
                      interval={0}
                      ticks={burndownAxisTicks}
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      angle={-28}
                      textAnchor="end"
                      height={44}
                    />
                    <YAxis
                      allowDecimals={metric !== "storyCount"}
                      tick={{ fontSize: 10 }}
                      width={44}
                      label={{
                        value: metric === "storyCount" ? "Stories" : "Days left",
                        angle: -90,
                        position: "insideLeft",
                        fill: "#64748b",
                        fontSize: 13,
                      }}
                      padding={{ bottom: 4 }}
                    />
                    <Tooltip
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.dayLabel ?? ""}
                      content={(props) => (
                        <BurndownTooltip
                          {...props}
                          metric={metric}
                          totalScope={allBurndownKeysSelected ? burndownAggregateStartTotal : null}
                        />
                      )}
                      cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3", strokeOpacity: 0.5 }}
                    />
                    {(() => {
                      const todayRow = monthBurndownWithDueTarget.find((d) => d.isCalendarToday);
                      return todayRow?.axisLabel ? (
                        <ReferenceLine
                          x={String(todayRow.axisLabel)}
                          stroke="#94a3b8"
                          strokeDasharray="4 2"
                          label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
                        />
                      ) : null;
                    })()}
                    {/* Scope-promise reference line. Renders horizontal
                     *  at the chosen epic-level estimate so the user can
                     *  see whether the actual burn-down is on track
                     *  against the promise they made. Gated on epicEst
                     *  basis + days-axis (story-count axis is in stories,
                     *  not days — the line would be meaningless there). */}
                    {scopePromiseDays != null ? (
                      <ReferenceLine
                        y={scopePromiseDays}
                        stroke="#0ea5e9"
                        strokeDasharray="2 4"
                        label={{
                          value: `Scope promise · ${scopePromiseDays}d`,
                          position: "insideTopRight",
                          fontSize: 10,
                          fill: "#0369a1",
                        }}
                      />
                    ) : null}
                    {burndownFocusedEpicOption && burndownVisibleKeys.includes(burndownFocusedEpicOption.epic.id) ? (() => {
                      // Use the focused epic's NATURAL palette index (its
                      // position in `monthBurndownEpics`) so the line color
                      // matches its legend dot. Previously this always used
                      // `LINE_PALETTE[0]`, which mismatched whenever the
                      // user focused an epic via legend click without
                      // changing the scope picker (legend dot stayed on
                      // palette[its-index] but the line painted palette[0]).
                      const naturalIdx = monthBurndownEpics.findIndex(
                        (e) => e.id === burndownFocusedEpicOption.epic.id,
                      );
                      const palette = LINE_PALETTE[(naturalIdx >= 0 ? naturalIdx : 0) % LINE_PALETTE.length];
                      return (
                        <Line
                          type="monotone"
                          dataKey={burndownFocusedEpicOption.epic.id}
                          stroke={palette}
                          strokeWidth={2}
                          dot={false}
                          name={burndownFocusedEpicOption.epic.title}
                          isAnimationActive={false}
                        />
                      );
                    })() : allBurndownKeysSelected ? (
                      // "All" view → render ONE aggregate line (sum of
                      // all epics' remaining work) plus the aggregate
                      // ideal, instead of N per-epic colored lines.
                      // Mirrors the Portfolio Burndown hero card so the
                      // two surfaces speak the same visual language.
                      <>
                        <Line
                          key="__aggregate__actual"
                          type="monotone"
                          dataKey="actual"
                          stroke="#2563eb"
                          strokeWidth={2.5}
                          dot={false}
                          name="Aggregate remaining"
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                        <Line
                          key="__aggregate__ideal"
                          type="monotone"
                          dataKey="ideal"
                          stroke="#f97316"
                          strokeDasharray="5 4"
                          strokeWidth={1.5}
                          dot={false}
                          name="Aggregate ideal"
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      </>
                    ) : monthBurndownEpics.map((epic, idx) =>
                      burndownVisibleKeys.includes(epic.id) ? (
                      <Line
                        key={epic.id}
                        type="monotone"
                        dataKey={epic.id}
                        stroke={LINE_PALETTE[idx % LINE_PALETTE.length]}
                        strokeWidth={2}
                        dot={false}
                        name={epic.title}
                        isAnimationActive={false}
                      />
                      ) : null,
                    )}
                    {burndownFocusedEpicOption && showEpicPlanMarkers ? (
                      <Line
                        type="monotone"
                        dataKey="epicIdeal"
                        stroke="#f97316"
                        strokeWidth={1.8}
                        strokeDasharray="5 4"
                        dot={false}
                        name="Epic ideal to due"
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ) : null}
                    {showBurndownForecast && burnDownForecastDate ? (
                      // Forecast line: connects today's actual to (forecast
                      // date, 0). `connectNulls` is true so Recharts draws
                      // the straight line between the two non-null points.
                      <Line
                        type="linear"
                        dataKey="forecast"
                        stroke="#7c3aed"
                        strokeWidth={2}
                        strokeDasharray="3 3"
                        dot={{ r: 3, fill: "#7c3aed", strokeWidth: 0 }}
                        name={`Forecast → ${burnDownForecastDate.getDate()}/${burnDownForecastDate.getMonth() + 1}`}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ) : null}
                    {burndownFocusedEpicOption && monthEndMarker ? (
                      <ReferenceDot
                        x={monthEndMarker.axisLabel}
                        y={Math.max(monthEndMarker.y + (metric === "storyCount" ? 0.35 : 0.25), metric === "storyCount" ? 1 : 0.8)}
                        r={4}
                        isFront
                        ifOverflow="visible"
                        fill="#2563eb"
                        stroke="#ffffff"
                        strokeWidth={1.5}
                      />
                    ) : null}
                    {burndownFocusedEpicOption && selectedEpicDueMarker && showEpicPlanMarkers ? (
                      <ReferenceDot
                        x={selectedEpicDueMarker.axisLabel}
                        y={Math.max(selectedEpicDueMarker.y + (metric === "storyCount" ? 0.35 : 0.25), metric === "storyCount" ? 1 : 0.8)}
                        r={0}
                        isFront
                        ifOverflow="visible"
                        shape={(shapeProps: { cx?: number; cy?: number }) => (
                          <BurndownTargetIcon cx={shapeProps.cx} cy={(shapeProps.cy ?? 0) + 4} color="#dc2626" />
                        )}
                        label={{
                          value: `Due ${selectedEpicDueDate ? `${selectedEpicDueDate.getDate()}/${selectedEpicDueDate.getMonth() + 1}` : ""}`,
                          position: "top",
                          fill: "#b91c1c",
                          fontSize: 11,
                          angle: 0,
                        }}
                      />
                    ) : null}
                    {/* "Epic scheduled DD/MM" marker — anchored to the
                     *  ideal line's left edge so the planner sees WHY
                     *  the orange ramp starts where it does. Custom
                     *  shape draws a thin connector going up from the
                     *  ideal line's start point into the chart's top
                     *  margin where the label sits — keeps the label
                     *  above the chart body instead of overlapping the
                     *  data lines. */}
                    {burndownFocusedEpicOption && selectedEpicScheduledMarker && showEpicPlanMarkers ? (
                      <ReferenceDot
                        x={selectedEpicScheduledMarker.axisLabel}
                        y={selectedEpicScheduledMarker.y}
                        r={0}
                        isFront
                        ifOverflow="visible"
                        shape={(shapeProps: { cx?: number; cy?: number }) => {
                          const cx = shapeProps.cx ?? 0;
                          const cy = shapeProps.cy ?? 0;
                          // The LineChart's `top: 38` margin gives us
                          // ~30px of breathing room above the plot. We
                          // place the label inside that margin so it
                          // doesn't sit on top of the data lines.
                          const labelY = 12;
                          const connectorTop = labelY + 6;
                          const arrowTipY = cy - 3;
                          return (
                            <g>
                              <line
                                x1={cx}
                                y1={connectorTop}
                                x2={cx}
                                y2={arrowTipY - 4}
                                stroke="#f97316"
                                strokeWidth={1.2}
                                strokeDasharray="3 2"
                              />
                              {/* Arrowhead — small triangle pointing
                               *  down to the plan-start date on the
                               *  ideal line. */}
                              <polygon
                                points={`${cx - 3.5},${arrowTipY - 4} ${cx + 3.5},${arrowTipY - 4} ${cx},${arrowTipY + 1}`}
                                fill="#f97316"
                              />
                              <text
                                x={cx}
                                y={labelY}
                                textAnchor="middle"
                                fill="#c2410c"
                                fontSize={11}
                                fontWeight={600}
                              >
                                {selectedEpicScheduledMarker.label}
                              </text>
                            </g>
                          );
                        }}
                      />
                    ) : null}
                    {/* Δ annotation at today — same affordance as the
                     *  burnup chart and as slides 3–7 of the Health
                     *  Explainer. Renders only on the focused epic and
                     *  only when the burndown verdict is Watch or At
                     *  Risk. The pill sits at the midpoint between
                     *  actual and the focused epic's ideal at today,
                     *  visually annotating the gap. */}
                    {burndownFocusedEpicOption && burndownHealth
                      && (burndownHealth.status === "watch" || burndownHealth.status === "atRisk")
                      ? (() => {
                        const todayRow = monthBurndownWithDueTarget.find(
                          (r) => (r as { isCalendarToday?: boolean }).isCalendarToday,
                        ) as (Record<string, number | string | boolean | null | undefined> & { axisLabel?: string }) | undefined;
                        if (!todayRow || !todayRow.axisLabel) return null;
                        const focusedEpicKey = burndownFocusedEpicOption.epic.id;
                        const actualAtToday = typeof todayRow[focusedEpicKey] === "number"
                          ? (todayRow[focusedEpicKey] as number)
                          : typeof todayRow.actual === "number" ? (todayRow.actual as number) : null;
                        const idealAtToday = typeof todayRow.epicIdeal === "number"
                          ? (todayRow.epicIdeal as number)
                          : typeof todayRow.ideal === "number" ? (todayRow.ideal as number) : null;
                        if (actualAtToday == null || idealAtToday == null) return null;
                        const midY = (actualAtToday + idealAtToday) / 2;
                        const delta = burndownHealth.result.deltaDays;
                        const deltaText = `Δ = ${delta >= 0 ? "+" : ""}${metric === "storyCount" ? Math.round(delta) : delta.toFixed(1)}`;
                        const accent = burndownHealth.status === "atRisk" ? "#dc2626" : "#d97706";
                        return (
                          <ReferenceDot
                            x={todayRow.axisLabel}
                            y={midY}
                            r={0}
                            isFront
                            ifOverflow="visible"
                            shape={(shapeProps: { cx?: number; cy?: number }) => {
                              const cx = shapeProps.cx ?? 0;
                              const cy = shapeProps.cy ?? 0;
                              return (
                                <g>
                                  <rect x={cx + 6} y={cy - 9} width={64} height={18} rx={9} fill="white" stroke={accent} strokeWidth={1.4} />
                                  <text x={cx + 38} y={cy + 4} textAnchor="middle" fill={accent} fontSize={11} fontWeight={700}>
                                    {deltaText}
                                  </text>
                                </g>
                              );
                            }}
                          />
                        );
                      })()
                      : null}
                    {/* Done ✓ — sits ABOVE the due-date target (and above
                     *  the "Due X/Y" label) when the focused epic's burndown
                     *  has reached 0. Visual stacking top-to-bottom:
                     *  "Done" text → green ✓ circle → "Due X/Y" label →
                     *  red bullseye target. The label uses an offset large
                     *  enough to clear the shape-drawn circle (which is at
                     *  cy - 32 visually, not at the dot's anchor cy). */}
                    {burndownFocusedEpicOption && selectedEpicDueMarker && isFocusedBurndownDone ? (
                      <ReferenceDot
                        x={selectedEpicDueMarker.axisLabel}
                        y={Math.max(selectedEpicDueMarker.y + (metric === "storyCount" ? 0.35 : 0.25), metric === "storyCount" ? 1 : 0.8)}
                        r={0}
                        isFront
                        ifOverflow="visible"
                        shape={(shapeProps: { cx?: number; cy?: number }) => {
                          const cx = shapeProps.cx ?? 0;
                          const cy = (shapeProps.cy ?? 0) - 32;
                          return (
                            <g>
                              <circle cx={cx} cy={cy} r={8} fill="#10b981" stroke="#ffffff" strokeWidth={1.5} />
                              <path d={`M ${cx - 3.5} ${cy} L ${cx - 0.8} ${cy + 2.6} L ${cx + 3.8} ${cy - 2.6}`} stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                            </g>
                          );
                        }}
                        label={{
                          value: "Done",
                          position: "top",
                          fill: "#047857",
                          fontSize: 10,
                          // offset measured from the dot's anchor y; the
                          // visual shape is at cy - 32, so we need to clear
                          // it by another ~12px (circle r=8 + gap).
                          offset: 44,
                        }}
                      />
                    ) : null}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-500">
                No epics found for this team in the selected month.
              </div>
            )}
          </div>
        </div>
        {/* Burndown legend — horizontal chip row beneath the chart.
         *  Mirrors the CFD legend layout (relocated from the prior
         *  24rem right-column form). "All" toggles every series on;
         *  per-epic chips toggle visibility individually. */}
        <div
          className={cn(
            "mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-1",
            isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
          )}
        >
          {/* "All" toggle hides in aggregate mode where the legend is a
           *  single "All epics" chip — clicking either would do the same
           *  thing, so showing both reads as redundant chrome. */}
          {burndownLegendItems.length > 1 ? (
            <button
              type="button"
              onClick={showAllBurndownKeys}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium transition",
                allBurndownKeysSelected
                  ? "text-slate-900 hover:bg-slate-200/70"
                  : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-800",
              )}
            >
              <Layers className="size-3.5" aria-hidden />
              All
            </button>
          ) : null}
          {burndownLegendItems.map((item) => {
            const on = burndownVisibleKeys.includes(item.key);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleBurndownKey(item.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition",
                  on ? "text-slate-900 hover:bg-slate-200/70" : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-700",
                )}
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] ring-1 ring-black/10"
                  style={{ backgroundColor: item.color, opacity: on ? 1 : 0.35 }}
                />
                <span className="max-w-[14rem] truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </article>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-1">
        <div className={cn("flex shrink-0 items-center justify-between gap-2", INSIGHTS_HEADER_ROW, isMultiPeriodInsights ? "mb-3" : "mb-2")}>
          <div className="flex min-w-0 flex-col">
          <h3
            className={cn(
              "inline-flex items-center gap-1.5 font-semibold text-slate-800",
              isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
            )}
          >
            <ChartNoAxesCombined className="size-4 text-slate-600" />
            Workload Balance
          </h3>
          {scopeTitleSuffix ? (
            <div className="mt-0.5">{scopeTitleSuffix}</div>
          ) : null}
          </div>
        </div>
        {workloadDrilldownAssignee ? (() => {
          // Unique values for the per-column dropdowns. Computed from the
          // RAW (unfiltered) rows so removing a filter restores all options.
          const uniqueSprints = Array.from(new Set(workloadDrilldownStoriesRaw.map((s) => storySprintDisplayLabel(s.sprint, scopeStartMonth)))).filter(Boolean).sort();
          const uniqueAssignees = Array.from(new Set(workloadDrilldownStoriesRaw.map((s) => s.assignee?.trim() || "Unassigned"))).filter(Boolean).sort();
          // Append a synthetic "unscheduled" entry whenever any row is
          // missing a sprint — see `applyDrilldownFilterSort` for the
          // matching filter-side branch.
          const uniqueStatuses: string[] = (() => {
            const base = Array.from(new Set(workloadDrilldownStoriesRaw.map((s) => s.status as string))).sort();
            const hasUnscheduled = workloadDrilldownStoriesRaw.some((s) => s.sprint == null);
            return hasUnscheduled ? base.concat("unscheduled") : base;
          })();
          return (
          <InsightsDrilldownModal
            title={`Workload Balance · ${workloadDrilldownAssignee}`}
            icon={<ChartNoAxesCombined className="size-4 text-slate-600" aria-hidden />}
            subtitle={(() => {
              const count = workloadDrilldownStories.length;
              const countLabel = `${count} user stor${count === 1 ? "y" : "ies"} presented`;
              return scopeTitleSuffix ? `${scopeTitleSuffix} · ${countLabel}` : countLabel;
            })()}
            onClose={() => { setWorkloadDrilldownAssignee(null); setWorkloadDrilldownIsTeam(false); setExpandedDrilldownEpics(new Set()); }}
          >
          <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
            <div className="relative flex-1 min-h-0 min-w-0">
            <div
              className={sharedDrilldownScrollAreaClass}
              style={{ scrollbarWidth: "thin" }}
            >
              <table className={drilldownTableClass}>
                {drilldownColgroupWithTeamAndHealth}
                <thead className="sticky top-0 z-10 overflow-hidden rounded-t-md border-b border-[#19abeb]/70 bg-[#0897d5] text-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                  <tr>
                    <th className="min-w-0 px-2 py-1 text-right text-[14px]">#</th>
                    <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                      <DrilldownSortHeader label="Story ID" column="id" sort={workloadDrilldownSort} onSortChange={setWorkloadDrilldownSort} />
                    </th>
                    <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                      <DrilldownSortHeader label="Story name" column="title" sort={workloadDrilldownSort} onSortChange={setWorkloadDrilldownSort} />
                    </th>
                    <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                      <DrilldownSortHeader label="Sprint" column="sprint" sort={workloadDrilldownSort} onSortChange={setWorkloadDrilldownSort} />
                    </th>
                    <th className="min-w-0 px-2 py-1 text-[14px] text-left">Team</th>
                    <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                      <DrilldownSortHeader label="Assignee" column="assignee" sort={workloadDrilldownSort} onSortChange={setWorkloadDrilldownSort} />
                    </th>
                    <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                      <DrilldownSortHeader label="Status" column="status" sort={workloadDrilldownSort} onSortChange={setWorkloadDrilldownSort} />
                    </th>
                    <th className="min-w-0 px-2 py-1 text-[14px] text-left">Health</th>
                    <th className="min-w-0 px-2 py-1 text-right text-[14px]">Est days</th>
                    <th className="min-w-0 px-2 py-1 text-right text-[14px]">Est days left</th>
                  </tr>
                  {/* Per-column filter row — Title is a substring text input;
                   *  Sprint / Assignee / Status are dropdowns of unique
                   *  values from the raw (pre-filter) rows. */}
                  <tr className="bg-white/95">
                    <th className="min-w-0 px-1 py-0.5" />
                    <th className="min-w-0 px-1 py-0.5" />
                    <th className="min-w-0 px-1 py-0.5">
                      <DrilldownFilterInputText
                        value={workloadDrilldownFilter.title}
                        onChange={(v) => setWorkloadDrilldownFilter((p) => ({ ...p, title: v }))}
                        ariaLabel="Filter workload by story name"
                      />
                    </th>
                    <th className="min-w-0 px-1 py-0.5">
                      <DrilldownFilterDropdown
                        value={workloadDrilldownFilter.sprint}
                        options={uniqueSprints}
                        renderOption={renderSprintOption}
                        onChange={(v) => setWorkloadDrilldownFilter((p) => ({ ...p, sprint: v }))}
                        ariaLabel="Filter workload by sprint"
                      />
                    </th>
                    <th className="min-w-0 px-1 py-0.5">
                      <DrilldownFilterDropdown
                        value={workloadDrilldownFilter.team}
                        options={Array.from(new Set(workloadDrilldownStoriesRaw.map((s) => {
                          const teamId = epicTeamByStoryId.get(s.id) ?? "";
                          return monthTeamLabelForId(teamId) ?? (teamId || "—");
                        }))).filter(Boolean).sort()}
                        renderOption={(v) => {
                          const slug = MONTH_TEAM_COLUMNS.find((t) => t.label === v)?.id ?? null;
                          return (
                            <span className="inline-flex items-center gap-1.5">
                              <TeamAvatar slug={slug} sizePx={16} fallback={<Users className="size-3.5 text-slate-400" aria-hidden />} />
                              <span className="truncate">{v}</span>
                            </span>
                          );
                        }}
                        onChange={(v) => setWorkloadDrilldownFilter((p) => ({ ...p, team: v }))}
                        ariaLabel="Filter workload by team"
                      />
                    </th>
                    <th className="min-w-0 px-1 py-0.5">
                      <DrilldownFilterDropdown
                        value={workloadDrilldownFilter.assignee}
                        options={uniqueAssignees}
                        renderOption={(name) => {
                          const resolved = resolveAssigneeAvatar(name, workspaceDirectoryUsers);
                          return (
                            <span className="inline-flex items-center gap-1.5">
                              <UserAvatar name={resolved.name} image={resolved.image} size={16} className="ring-0" />
                              <span className="truncate">{name}</span>
                            </span>
                          );
                        }}
                        onChange={(v) => setWorkloadDrilldownFilter((p) => ({ ...p, assignee: v }))}
                        ariaLabel="Filter workload by assignee"
                      />
                    </th>
                    <th className="min-w-0 px-1 py-0.5">
                      <DrilldownFilterDropdown
                        value={workloadDrilldownFilter.status}
                        options={uniqueStatuses}
                        renderOption={renderStatusOption}
                        onChange={(v) => setWorkloadDrilldownFilter((p) => ({ ...p, status: v }))}
                        ariaLabel="Filter workload by status"
                      />
                    </th>
                    <th className="min-w-0 px-1 py-0.5">
                      <DrilldownFilterDropdown
                        value={workloadDrilldownFilter.health}
                        options={HEALTH_FILTER_OPTIONS}
                        renderOption={renderHealthFilterOption}
                        onChange={(v) => setWorkloadDrilldownFilter((p) => ({ ...p, health: v as HealthStatus | null }))}
                        ariaLabel="Filter workload by health"
                      />
                    </th>
                    {/* Σ totals over the currently visible (filtered) rows. */}
                    <th className="min-w-0 px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                      Σ <span className="text-slate-300">|</span> {workloadDrilldownStories.reduce((sum, s) => sum + (s.estimatedDays ?? 0), 0)}
                    </th>
                    <th className="min-w-0 px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                      Σ <span className="text-slate-300">|</span> {workloadDrilldownStories.reduce((sum, s) => sum + (s.daysLeft ?? 0), 0)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Group filtered stories by parent epic — each epic
                    // becomes a collapsible header row, child stories
                    // render with a tree connector in the `#` cell.
                    // Mirrors the Team Progress drilldown pattern.
                    const storyEpic = new Map<string, EpicItem>();
                    for (const { epic } of monthEpics) {
                      for (const s of epic.userStories ?? []) storyEpic.set(s.id, epic);
                    }
                    type Group = { epic: EpicItem; stories: typeof workloadDrilldownStories };
                    const groupsMap = new Map<string, Group>();
                    for (const story of workloadDrilldownStories) {
                      const epic = storyEpic.get(story.id);
                      if (!epic) continue;
                      const g = groupsMap.get(epic.id);
                      if (g) g.stories.push(story);
                      else groupsMap.set(epic.id, { epic, stories: [story] });
                    }
                    const groups = Array.from(groupsMap.values()).sort(
                      (a, b) => a.epic.title.localeCompare(b.epic.title),
                    );
                    let rowIdx = 0;
                    const rendered: ReactNode[] = [];
                    for (const { epic, stories } of groups) {
                      const isCollapsed = !expandedDrilldownEpics.has(epic.id);
                      const epicEstSum = stories.reduce((s, st) => s + (st.estimatedDays ?? 0), 0);
                      const epicLeftSum = stories.reduce((s, st) => s + (st.daysLeft ?? 0), 0);
                      {
                        const epicTeamSlug = epic.team ?? null;
                        const epicTeamLabel = monthTeamLabelForId(epicTeamSlug ?? "") ?? (epicTeamSlug || "—");
                        const epicStatusLabel = epicStatusById.get(epic.id) ?? "To do";
                        const epicStatusKey =
                          epicStatusLabel === "Done" ? "done"
                          : epicStatusLabel === "Review / Testing" ? "review"
                          : epicStatusLabel === "In progress" ? "inProgress"
                          : epicStatusLabel === "To do" ? "todo"
                          : null;
                        rendered.push(
                          <tr key={`epic-${epic.id}`} className="bg-indigo-50/70 ring-1 ring-inset ring-indigo-100/80">
                            <td colSpan={4} className="px-2 py-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedDrilldownEpics((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(epic.id)) next.delete(epic.id);
                                    else next.add(epic.id);
                                    return next;
                                  });
                                }}
                                className="inline-flex w-full min-w-0 items-center gap-1.5 text-left"
                              >
                                <ChevronRight
                                  className={cn("size-4 shrink-0 text-slate-500 transition-transform", !isCollapsed && "rotate-90")}
                                  aria-hidden
                                />
                                <Folder className="size-3.5 shrink-0 text-sky-500" aria-hidden />
                                <span className="min-w-0 truncate text-[13.5px] font-semibold text-slate-800">{epic.title}</span>
                                <span className="ml-1 shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600 ring-1 ring-slate-200">
                                  {stories.length}
                                </span>
                              </button>
                            </td>
                            <td className="bg-indigo-50/70 px-2 py-1.5">
                              <span className="inline-flex min-w-0 items-center gap-1.5">
                                <TeamAvatar slug={epicTeamSlug} sizePx={16} fallback={<Users className="size-3.5 text-slate-400" aria-hidden />} />
                                <span className="truncate text-[12.5px] text-slate-700">{epicTeamLabel}</span>
                              </span>
                            </td>
                            <td className="bg-indigo-50/70 px-2 py-1.5">
                              <DrilldownAssigneeCell assignee={epic.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                            </td>
                            <td className="bg-indigo-50/70 px-2 py-1.5">
                              {epicStatusKey ? (
                                <StoryStatusPill status={epicStatusKey} />
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700">
                                  <Circle className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                                  <span className="truncate">{epicStatusLabel}</span>
                                </span>
                              )}
                            </td>
                            <td className="bg-indigo-50/70 px-2 py-1.5">
                              {(() => {
                                const v = computeEpicHealthVerdict(epic, planYear, progressBasis);
                                if (!v) return <span className="text-slate-300">—</span>;
                                const tip = formatHealthTooltip(v.result);
                                return <HealthBadgeWithTextPopover size="xs" status={v.status} tooltip={tip} />;
                              })()}
                            </td>
                            <td className="bg-indigo-50/70 px-2 py-1.5 text-right text-[12px] font-semibold tabular-nums text-slate-700">{epicEstSum}</td>
                            <td className="bg-indigo-50/70 px-2 py-1.5 text-right text-[12px] font-semibold tabular-nums text-slate-700">{epicLeftSum}</td>
                          </tr>
                        );
                      }
                      if (isCollapsed) continue;
                      stories.forEach((story, storyIdx) => {
                        rowIdx += 1;
                        const isLast = storyIdx === stories.length - 1;
                        const storyTeamId = epicTeamByStoryId.get(story.id) ?? "";
                        const storyTeamLabel = monthTeamLabelForId(storyTeamId) ?? (storyTeamId || "—");
                        rendered.push(
                          <tr key={story.id} className={drilldownTableRowZebra}>
                            <td className="relative min-w-0 px-2 py-0.5 pl-6 text-right tabular-nums text-slate-500">
                              <span
                                className="absolute left-3 top-0 w-px bg-indigo-300"
                                style={{ height: isLast ? "50%" : "100%" }}
                                aria-hidden
                              />
                              <span className="absolute left-3 top-1/2 h-px w-3 -translate-y-px bg-indigo-300" aria-hidden />
                              {rowIdx}
                            </td>
                            <td className="min-w-0 px-2 py-0.5">
                              <span className="inline-flex min-w-0 items-center gap-1.5">
                                <UserStoryIcon className="size-3.5" />
                                <InsightsTruncatedHoverButton
                                  label={scopedStoryDisplayIds.get(story.id) ?? story.id.slice(0, 8)}
                                  onClick={() => onOpenStory?.(story.id)}
                                  className="block min-w-0 max-w-full truncate text-left font-semibold text-blue-700 underline-offset-2 hover:underline"
                                />
                              </span>
                            </td>
                            <td className="min-w-0 px-2 py-0.5">
                              <InsightsTruncatedHoverLabel text={story.title} />
                            </td>
                            <td className="min-w-0 px-2 py-0.5">
                              <span className="inline-flex min-w-0 items-center gap-1.5">
                                <Flag className="size-3.5 shrink-0 text-rose-500" aria-hidden />
                                {normalizeStoryYearSprint(story.sprint, scopeStartMonth) != null ? (
                                  <InsightsTruncatedHoverButton
                                    label={storySprintDisplayLabel(story.sprint, scopeStartMonth)}
                                    onClick={() => {
                                      const targetYearSprint = normalizeStoryYearSprint(story.sprint, scopeStartMonth);
                                      if (targetYearSprint == null) return;
                                      onOpenSprintKanban?.(targetYearSprint, resolveStoryTeamForSprintNav(story));
                                    }}
                                    className="block w-full max-w-full truncate text-left font-semibold text-blue-700 underline-offset-2 hover:underline"
                                  />
                                ) : (
                                  <InsightsTruncatedHoverLabel text="Unscheduled" />
                                )}
                              </span>
                            </td>
                            <td className="min-w-0 px-2 py-0.5">
                              <span className="inline-flex min-w-0 items-center gap-1.5">
                                <TeamAvatar slug={storyTeamId || null} sizePx={16} fallback={<Users className="size-3.5 text-slate-400" aria-hidden />} />
                                <InsightsTruncatedHoverLabel text={storyTeamLabel} />
                              </span>
                            </td>
                            <td className="min-w-0 px-2 py-0.5">
                              <DrilldownAssigneeCell assignee={story.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                            </td>
                            <td className="min-w-0 px-2 py-0.5">
                              <StoryStatusPill status={story.status} sprint={story.sprint} />
                            </td>
                            <td className="min-w-0 px-2 py-0.5">
                              {(() => {
                                const v = computeStoryHealthVerdict(story, epic, planYear);
                                if (!v) return <span className="text-slate-300">—</span>;
                                const tip = formatStoryHealthTooltip(story, epic, planYear, v.status);
                                return <HealthBadgeWithTextPopover size="xs" status={v.status} tooltip={tip} />;
                              })()}
                            </td>
                            <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.estimatedDays ?? "—"}</td>
                            <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.daysLeft ?? "—"}</td>
                          </tr>
                        );
                      });
                    }
                    if (rendered.length === 0) {
                      rendered.push(
                        <tr key="workload-empty">
                          <td colSpan={10} className="px-3 py-6 text-center text-[13px] text-slate-400">
                            No in-scope stories match the current filters.
                          </td>
                        </tr>
                      );
                    }
                    if (workloadDrilldownEmptyRows > 0) {
                      for (let i = 0; i < workloadDrilldownEmptyRows; i++) {
                        rendered.push(
                          <tr key={`workload-empty-${i}`} className={drilldownTableEmptyRowZebra}>
                            <td colSpan={10} className="px-3 py-0.5 text-[13px]">{" "}</td>
                          </tr>
                        );
                      }
                    }
                    return rendered;
                  })()}
                </tbody>
              </table>
            </div>
            </div>
          </div>
          </InsightsDrilldownModal>
          );
        })() : null}
        {(() => {
          const teamMode = !forceUserMode && (!filterEpicTeamIds?.length || filterEpicTeamIds.length !== 1) && analytics.workloadByTeam.length > 0;
          // When an epic or initiative is pinned via the scope picker,
          // the underlying scopedStories pool only contains stories
          // from that pinned scope — so clicking on a team that the
          // pinned scope doesn't touch would yield an empty drilldown.
          // Filter the team bars to only the teams that actually own
          // work in the current scope so users can't dead-end click.
          const pinnedTeamSlugs = selectedEpicOption
            ? new Set([selectedEpicOption.epic.team ?? "__unassigned__"])
            : selectedInitiativeId !== "all"
              ? new Set(monthEpics.filter((row) => row.initiative.id === selectedInitiativeId).map((row) => row.epic.team ?? "__unassigned__"))
              : null;
          const teamsInScope = pinnedTeamSlugs
            ? analytics.workloadByTeam.filter((t) => pinnedTeamSlugs.has(t.teamId ?? "__unassigned__"))
            : analytics.workloadByTeam;
          // Statuses hidden via the legend show 0 in the chart bars.
          const statusVal = (s: typeof WORKLOAD_BAR_SEGMENTS[number], n: number) =>
            workloadHiddenStatuses.has(s.key) ? 0 : n;
          const barData = teamMode
            ? teamsInScope.map((t) => ({
                name: t.teamLabel,
                fullName: t.teamLabel,
                "To do": statusVal(WORKLOAD_BAR_SEGMENTS[0], t.storiesByStatus.todo),
                "In progress": statusVal(WORKLOAD_BAR_SEGMENTS[1], t.storiesByStatus.inProgress),
                "Review / Testing": statusVal(WORKLOAD_BAR_SEGMENTS[2], t.storiesByStatus.review),
                "Done": statusVal(WORKLOAD_BAR_SEGMENTS[3], t.storiesByStatus.done),
              }))
            : analytics.workloadByAssignee.map((item) => ({
                name: compactAssigneeName(item.assignee),
                fullName: item.assignee,
                "To do": statusVal(WORKLOAD_BAR_SEGMENTS[0], item.storiesByStatus.todo),
                "In progress": statusVal(WORKLOAD_BAR_SEGMENTS[1], item.storiesByStatus.inProgress),
                "Review / Testing": statusVal(WORKLOAD_BAR_SEGMENTS[2], item.storiesByStatus.review),
                "Done": statusVal(WORKLOAD_BAR_SEGMENTS[3], item.storiesByStatus.done),
              }));
          // Pre-resolve avatar URLs keyed by the X-axis label ("First L.") so
          // the custom tick can paint a photo per bar without each tick re-
          // walking the directory. Team mode uses the parallel
          // `teamImageByLabel` (label → team logo) instead.
          const avatarByFirstName = new Map<string, string | null>();
          const teamImageByLabel = new Map<string, string | null>();
          if (!teamMode) {
            for (const item of analytics.workloadByAssignee) {
              const label = compactAssigneeName(item.assignee);
              if (!label || avatarByFirstName.has(label)) continue;
              avatarByFirstName.set(
                label,
                resolveAssigneeAvatar(item.assignee, workspaceDirectoryUsers).image,
              );
            }
          } else {
            for (const t of analytics.workloadByTeam) {
              if (!t.teamLabel || teamImageByLabel.has(t.teamLabel)) continue;
              teamImageByLabel.set(t.teamLabel, t.teamId ? teamImagesBySlug.get(t.teamId) ?? null : null);
            }
          }
          return (
            <div className={cn("min-h-0", INSIGHTS_CHART_BAND)}>
              {barData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={barData}
                    barCategoryGap="15%"
                    barGap={2}
                    margin={{ top: 4, right: 4, bottom: 0, left: 8 }}
                    style={{ cursor: "pointer" }}
                    onClick={(data) => {
                      const label = data?.activeLabel as string | undefined;
                      if (!label) return;
                      if (teamMode) {
                        const match = analytics.workloadByTeam.find((t) => t.teamLabel === label);
                        if (match) {
                          setWorkloadDrilldownIsTeam(true);
                          setWorkloadDrilldownAssignee(match.teamId ?? "");
                          setWorkloadDrilldownFilter({ ...EMPTY_DRILLDOWN_FILTER, team: match.teamLabel ?? null });
                        }
                      } else {
                        const match = analytics.workloadByAssignee.find((r) => compactAssigneeName(r.assignee) === label);
                        if (match) {
                          setWorkloadDrilldownIsTeam(false);
                          setWorkloadDrilldownAssignee(match.assignee);
                          setWorkloadDrilldownFilter({ ...EMPTY_DRILLDOWN_FILTER, assignee: match.assignee });
                        }
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <XAxis dataKey="name" tick={(props: any) => <WorkloadXAxisTick {...props} teamMode={teamMode} avatarByFirstName={avatarByFirstName} teamImageByLabel={teamImageByLabel} />} height={34} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} allowDecimals={false} width={44} label={{ value: "Stories", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 13 }} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0", padding: "6px 10px" }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={((value: number, name: string) => [value, name]) as any}
                      labelFormatter={(label, payload) => (payload?.[0] as { payload?: { fullName?: string } } | undefined)?.payload?.fullName ?? label}
                    />
                    <Legend
                      wrapperStyle={{ paddingTop: 6 }}
                      // We render our own legend from WORKLOAD_BAR_SEGMENTS so the order is fixed
                      // (To do → In progress → Done → Approved) and the items get proper gaps.
                      // Each pill is clickable: clicking toggles whether that
                      // status's bars + drilldown-table rows are shown.
                      content={() => (
                        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1.5 text-[13px]">
                          {WORKLOAD_BAR_SEGMENTS.map((s) => {
                            const hidden = workloadHiddenStatuses.has(s.key);
                            return (
                              <button
                                key={s.key}
                                type="button"
                                onClick={(e) => {
                                  // Stop the click from bubbling to the
                                  // BarChart's onClick (which would otherwise
                                  // attempt to open a drilldown). Legend
                                  // clicks should ONLY toggle the bar
                                  // visibility, never trigger a drilldown.
                                  e.stopPropagation();
                                  setWorkloadHiddenStatuses((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(s.key)) next.delete(s.key);
                                    else next.add(s.key);
                                    return next;
                                  });
                                }}
                                title={hidden ? `Show ${s.label}` : `Hide ${s.label}`}
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition hover:bg-slate-100",
                                  hidden && "opacity-40",
                                )}
                              >
                                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                                <span className={cn("font-medium text-slate-700", hidden && "line-through")}>{s.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    />
                    {WORKLOAD_BAR_SEGMENTS.map((s) => (
                      <Bar key={s.key} dataKey={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={14}
                        minPointSize={2}
                        isAnimationActive={false}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        label={{ position: "top", fontSize: 10, fill: "#64748b", formatter: ((v: number) => String(v ?? 0)) as any }}
                        style={{ cursor: "pointer" }}
                        onClick={teamMode
                          ? ((data: { fullName?: string; name?: string }) => { const lbl = data?.fullName ?? data?.name; if (!lbl) return; const match = analytics.workloadByTeam.find((t) => t.teamLabel === lbl); if (match) { setWorkloadDrilldownIsTeam(true); setWorkloadDrilldownAssignee(match.teamId ?? ""); setWorkloadDrilldownFilter({ ...EMPTY_DRILLDOWN_FILTER, team: match.teamLabel ?? null }); } }) as any  // eslint-disable-line @typescript-eslint/no-explicit-any
                          : ((data: { fullName?: string }) => { if (data?.fullName) { setWorkloadDrilldownIsTeam(false); setWorkloadDrilldownAssignee(data.fullName); setWorkloadDrilldownFilter({ ...EMPTY_DRILLDOWN_FILTER, assignee: data.fullName }); } }) as any}  // eslint-disable-line @typescript-eslint/no-explicit-any
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-[12px] text-slate-500">No open workload found for this month.</p>
              )}
            </div>
          );
        })()}
        <p className="mt-2 shrink-0 text-[12px] text-slate-600">
          {analytics.openStories} open stories.
        </p>
      </article>

      <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-1 lg:h-full">
        <div className={cn("mb-2 flex shrink-0 items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
          <div className="ml-[35px] flex min-w-0 flex-col">
          <h3
            className={cn(
              "inline-flex items-center gap-1.5 font-semibold text-slate-800",
              isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
            )}
          >
            <Activity className="size-4 text-slate-600" />
            Cumulative Flow
          </h3>
          {scopeTitleSuffix ? (
            <div className="mt-0.5">{scopeTitleSuffix}</div>
          ) : null}
          </div>
        </div>
        <div
          className={cn(
            // CFD is full-width now — Burndown + Burnup dropped their
            // right-side legends, so there's no longer a matching
            // 24rem column to align to. The CFD legend was relocated
            // to a horizontal row beneath the chart (see below).
            "grid md:grid-cols-1 md:items-stretch",
            INSIGHTS_CHART_GRID_GAP,
            INSIGHTS_CHART_BAND,
          )}
        >
          <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
            {cfdDataResolved.length > 0 ? (
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  {/* Margins match the Burndown + Burnup charts (right 24,
                   *  left 18) so all three Q-insights charts share the
                   *  same plot rectangle width — the X-axis labels and
                   *  today line then land at the same horizontal pixels
                   *  across all three. Top/bottom margins stay tight
                   *  for the AreaChart since it has no chip strip. */}
                  <AreaChart data={cfdDataResolved} margin={{ top: 2, right: 24, left: 18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="labelShort"
                      interval={0}
                      ticks={cfdAxisTicks}
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      angle={-28}
                      textAnchor="end"
                      height={44}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      width={44}
                      label={{ value: cfdMetric === "daysLeft" ? "Days" : "Stories", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 13 }}
                    />
                    <Tooltip
                      labelFormatter={(_, payload) => {
                        const row = payload?.[0]?.payload as { dayInMonth?: number; labelShort?: string } | undefined;
                        if (row?.dayInMonth != null && row.labelShort) return `Day ${row.dayInMonth} · ${row.labelShort}`;
                        return "";
                      }}
                      content={(props) => <CumulativeFlowTooltip {...props} metric={cfdMetric} />}
                      cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3", strokeOpacity: 0.5 }}
                    />
                    {(() => {
                      const todayRow = cfdDataResolved.find((d) => d.isToday);
                      return todayRow?.labelShort ? (
                        <ReferenceLine
                          x={String(todayRow.labelShort)}
                          stroke="#94a3b8"
                          strokeDasharray="4 2"
                          label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
                        />
                      ) : null;
                    })()}
                    {CFD_FLOW_SEGMENTS.map(({ key, label, color }) =>
                      cfdVisibleKeys.includes(key) ? (
                      <Area
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={label}
                        stackId="cfd"
                        stroke={color}
                        fill={color}
                        fillOpacity={0.38}
                        strokeOpacity={1}
                        strokeWidth={1.5}
                        isAnimationActive={false}
                        // Click any colored band to open the same
                        // drilldown table the "Stories Progress" donut
                        // opens, pre-filtered to that band's status.
                        style={{ cursor: "pointer" }}
                        onClick={() => openStatusDrilldown(label)}
                      />
                      ) : null,
                    )}
                    {/* Unscheduled overlay — count of stories in the
                     *  focused scope that are still without a sprint
                     *  AND not yet Done. Dashed slate line on top of the
                     *  status bands; the gap between this line and the
                     *  Done band's top reads as "uncommitted work to
                     *  plan." Done-unscheduled is treated as just Done
                     *  (qualifier moot) so it doesn't double-count. */}
                    {cfdShowUnscheduled ? (
                      <Line
                        type="monotone"
                        dataKey="unscheduledNotDone"
                        name="Unscheduled"
                        stroke="#64748b"
                        strokeWidth={1.6}
                        strokeDasharray="5 4"
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ) : null}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-slate-500">No month days to chart.</div>
            )}
          </div>
        </div>
        {/* CFD legend — horizontal row beneath the chart. Was a 24rem
         *  right column; relocated per planner request so the chart can
         *  use the full width and the legend reads as a familiar
         *  Recharts-style chip row. Wraps on narrow viewports. */}
        <div
          className={cn(
            "mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-1",
            isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
          )}
        >
          <button
            type="button"
            onClick={showAllCfdKeys}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium transition",
              allCfdKeysSelected
                ? "text-slate-900 hover:bg-slate-200/70"
                : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-800",
            )}
          >
            <Layers className="size-3.5" aria-hidden />
            All
          </button>
          {[...CFD_FLOW_SEGMENTS].reverse().map(({ key, label, color }) => {
            const on = cfdVisibleKeys.includes(key);
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggleCfdKey(key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition",
                  on ? "text-slate-900 hover:bg-slate-200/70" : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-700",
                )}
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] ring-1 ring-black/10"
                  style={{ backgroundColor: color, opacity: on ? 1 : 0.35 }}
                />
                {label}
              </button>
            );
          })}
          {/* Unscheduled overlay chip — separate from the status bands
           *  because it isn't a status; the swatch mimics the dashed
           *  line style so the chip and line visually correspond. */}
          <button
            type="button"
            onClick={() => setCfdShowUnscheduled((v) => !v)}
            title={cfdShowUnscheduled ? "Hide the unscheduled-not-done overlay" : "Show the unscheduled-not-done overlay"}
            aria-pressed={cfdShowUnscheduled}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition",
              cfdShowUnscheduled ? "text-slate-900 hover:bg-slate-200/70" : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-700",
            )}
          >
            <span
              aria-hidden
              className="inline-flex h-2.5 w-3.5 shrink-0 items-center justify-center"
              style={{ opacity: cfdShowUnscheduled ? 1 : 0.35 }}
            >
              <svg width="14" height="2" viewBox="0 0 14 2" fill="none">
                <line x1="0" y1="1" x2="14" y2="1" stroke="#64748b" strokeWidth="1.6" strokeDasharray="3 2" />
              </svg>
            </span>
            Unscheduled
          </button>
        </div>
      </article>
      </div>

      {/* Row 3: Month Load (left) + Burn Up chart (right).
       *  Render whenever there's burnup data OR a scope (epic/initiative) is
       *  pinned — pinned scope must always show both charts even if the epic
       *  has no scheduled stories to chart. */}
      {(burnUpData.length > 0 || selectedEpicOption != null || selectedInitiativeId !== "all") && (
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          {/* Month Load — left column, below Workload Balance */}
          {(() => {
            const teamMode = !forceUserMode && (!filterEpicTeamIds?.length || filterEpicTeamIds.length !== 1) && analytics.workloadByTeam.length > 0;
            // Match Workload Balance — when an epic / initiative is
            // pinned, hide team rows whose work isn't in the pinned
            // scope (otherwise clicking them produces an empty
            // drilldown because scopedStories is narrowed to the pin).
            const pinnedTeamSlugs = selectedEpicOption
              ? new Set([selectedEpicOption.epic.team ?? "__unassigned__"])
              : selectedInitiativeId !== "all"
                ? new Set(monthEpics.filter((row) => row.initiative.id === selectedInitiativeId).map((row) => row.epic.team ?? "__unassigned__"))
                : null;
            const teamsInScope = pinnedTeamSlugs
              ? analytics.workloadByTeam.filter((t) => pinnedTeamSlugs.has(t.teamId ?? "__unassigned__"))
              : analytics.workloadByTeam;
            const monthDaysLeft = analytics.monthDaysLeft;
            // Auto-sync the User / Team Progress unit with the global
            // burndown basis toggle. When the planner picks
            // "Stories Completed (%)", the rows count OPEN stories
            // (todo + inProgress) vs TOTAL stories instead of
            // days-left vs estimated-days — same lens the burndown /
            // burnup pair are already using.
            const useStoriesBasis = burndownBasis === "stories";
            const loadUnitSuffix = useStoriesBasis ? "" : "d";
            const loadUnitWord = useStoriesBasis ? "stories" : "days";
            const loadRows = teamMode
              ? teamsInScope.map((t) => ({
                  key: t.teamLabel,
                  label: t.teamLabel,
                  initials: t.teamLabel.slice(0, 2).toUpperCase(),
                  image: null as string | null,
                  teamSlug: t.teamId ?? null,
                  daysLeft: useStoriesBasis
                    ? t.storiesByStatus.todo + t.storiesByStatus.inProgress
                    : t.daysLeftTotal,
                  estTotal: useStoriesBasis
                    ? t.storiesByStatus.todo
                      + t.storiesByStatus.inProgress
                      + t.storiesByStatus.review
                      + t.storiesByStatus.done
                    : t.estimatedTotal,
                  onRowClick: () => {
                    setMonthLoadDrilldownIsTeam(true);
                    setMonthLoadDrilldownAssignee(t.teamId ?? "");
                    setMonthLoadDrilldownFilter({ ...EMPTY_DRILLDOWN_FILTER, team: t.teamLabel });
                  },
                }))
              : analytics.workloadByAssignee.map((row) => ({
                  key: row.assignee,
                  label: compactAssigneeName(row.assignee),
                  initials: row.assignee.split(/\s+/).slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join(""),
                  // Resolve avatar URL up-front so the per-row circle can
                  // render the photo instead of initials when available.
                  image: resolveAssigneeAvatar(row.assignee, workspaceDirectoryUsers).image,
                  teamSlug: null as string | null,
                  daysLeft: useStoriesBasis
                    ? row.storiesByStatus.todo + row.storiesByStatus.inProgress
                    : row.daysLeftTotal,
                  estTotal: useStoriesBasis
                    ? row.storiesByStatus.todo
                      + row.storiesByStatus.inProgress
                      + row.storiesByStatus.review
                      + row.storiesByStatus.done
                    : row.estimatedTotal,
                  onRowClick: () => {
                    setMonthLoadDrilldownIsTeam(false);
                    setMonthLoadDrilldownAssignee(row.assignee);
                    setMonthLoadDrilldownFilter({ ...EMPTY_DRILLDOWN_FILTER, assignee: row.assignee });
                  },
                }));
            // Sort by completion % descending: rows with the most work
            // already done bubble to the top, laggards sink to the
            // bottom. Empty estTotal counts as 100% so a team with
            // nothing planned isn't ranked above one that's mid-burn.
            loadRows.sort((a, b) => {
              const pctA = a.estTotal > 0 ? (a.estTotal - a.daysLeft) / a.estTotal : 1;
              const pctB = b.estTotal > 0 ? (b.estTotal - b.daysLeft) / b.estTotal : 1;
              return pctB - pctA;
            });
            if (loadRows.length === 0 && !monthLoadDrilldownAssignee) return <div className="hidden lg:block lg:col-span-1" />;
            return (
              <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-1">
                <div className={cn("mb-2 flex shrink-0 items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
                  <div className="flex min-w-0 flex-col">
                  <h3 className={cn("inline-flex items-center gap-1.5 font-semibold text-slate-800", isMultiPeriodInsights ? "text-[16px]" : "text-[15px]")}>
                    <Users className="size-4 text-slate-600" />
                    {/* Title tracks the chart's mode: teams when nothing /
                     *  multiple teams are filtered (rows = team bars);
                     *  users when a single team is pinned (rows = user
                     *  bars). The "(this month)" suffix is dropped in
                     *  multi-period insights views since the period label
                     *  doesn't fit. */}
                    {teamMode ? "Team Progress" : "User Progress"}
                    {isMultiPeriodInsights ? "" : (
                      <span className="ml-1 inline-block translate-y-[2px] text-[11px] font-normal text-slate-400">(this month)</span>
                    )}
                  </h3>
                  {scopeTitleSuffix ? (
                    <div className="mt-0.5">{scopeTitleSuffix}</div>
                  ) : null}
                  </div>
                </div>
                {monthLoadDrilldownAssignee ? (() => {
                  const uniqueSprints = Array.from(new Set(monthLoadDrilldownStoriesRaw.map((s) => storySprintDisplayLabel(s.sprint, scopeStartMonth)))).filter(Boolean).sort();
                  const uniqueAssignees = Array.from(new Set(monthLoadDrilldownStoriesRaw.map((s) => s.assignee?.trim() || "Unassigned"))).filter(Boolean).sort();
                  const uniqueStatuses: string[] = (() => {
                    const base = Array.from(new Set(monthLoadDrilldownStoriesRaw.map((s) => s.status as string))).sort();
                    const hasUnscheduled = monthLoadDrilldownStoriesRaw.some((s) => s.sprint == null);
                    return hasUnscheduled ? base.concat("unscheduled") : base;
                  })();
                  return (
                  <InsightsDrilldownModal
                    title={`${teamMode ? "Team Progress" : "User Progress"} · ${monthLoadDrilldownAssignee}`}
                    icon={<Users className="size-4 text-slate-600" aria-hidden />}
                    subtitle={(() => {
                      const count = monthLoadDrilldownStories.length;
                      const countLabel = `${count} user stor${count === 1 ? "y" : "ies"} presented`;
                      return scopeTitleSuffix ? `${scopeTitleSuffix} · ${countLabel}` : countLabel;
                    })()}
                    onClose={() => { setMonthLoadDrilldownAssignee(null); setMonthLoadDrilldownIsTeam(false); setExpandedDrilldownEpics(new Set()); }}
                  >
                  <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
                    <div className="relative flex-1 min-h-0 min-w-0">
                      <div
                        className={sharedDrilldownScrollAreaClass}
                        style={{ scrollbarWidth: "thin" }}
                      >
                        <table className={drilldownTableClass}>
                          {drilldownColgroupWithTeamAndHealth}
                          <thead className="sticky top-0 z-10 overflow-hidden rounded-t-md border-b border-[#19abeb]/70 bg-[#0897d5] text-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                            <tr>
                              <th className="min-w-0 px-2 py-1 text-right text-[14px]">#</th>
                              <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                                <DrilldownSortHeader label="Story ID" column="id" sort={monthLoadDrilldownSort} onSortChange={setMonthLoadDrilldownSort} />
                              </th>
                              <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                                <DrilldownSortHeader label="Story name" column="title" sort={monthLoadDrilldownSort} onSortChange={setMonthLoadDrilldownSort} />
                              </th>
                              <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                                <DrilldownSortHeader label="Sprint" column="sprint" sort={monthLoadDrilldownSort} onSortChange={setMonthLoadDrilldownSort} />
                              </th>
                              <th className="min-w-0 px-2 py-1 text-[14px] text-left">Team</th>
                              <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                                <DrilldownSortHeader label="Assignee" column="assignee" sort={monthLoadDrilldownSort} onSortChange={setMonthLoadDrilldownSort} />
                              </th>
                              <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                                <DrilldownSortHeader label="Status" column="status" sort={monthLoadDrilldownSort} onSortChange={setMonthLoadDrilldownSort} />
                              </th>
                              <th className="min-w-0 px-2 py-1 text-[14px] text-left">Health</th>
                              <th className="min-w-0 px-2 py-1 text-right text-[14px]">Est days</th>
                              <th className="min-w-0 px-2 py-1 text-right text-[14px]">Est days left</th>
                            </tr>
                            <tr className="bg-white/95">
                              <th className="min-w-0 px-1 py-0.5" />
                              <th className="min-w-0 px-1 py-0.5" />
                              <th className="min-w-0 px-1 py-0.5">
                                <DrilldownFilterInputText value={monthLoadDrilldownFilter.title} onChange={(v) => setMonthLoadDrilldownFilter((p) => ({ ...p, title: v }))} ariaLabel="Filter month load by story name" />
                              </th>
                              <th className="min-w-0 px-1 py-0.5">
                                <DrilldownFilterDropdown value={monthLoadDrilldownFilter.sprint} options={uniqueSprints} renderOption={renderSprintOption} onChange={(v) => setMonthLoadDrilldownFilter((p) => ({ ...p, sprint: v }))} ariaLabel="Filter month load by sprint" />
                              </th>
                              <th className="min-w-0 px-1 py-0.5">
                                <DrilldownFilterDropdown
                                  value={monthLoadDrilldownFilter.team}
                                  options={Array.from(new Set(monthLoadDrilldownStoriesRaw.map((s) => {
                                    const teamId = epicTeamByStoryId.get(s.id) ?? "";
                                    return monthTeamLabelForId(teamId) ?? (teamId || "—");
                                  }))).filter(Boolean).sort()}
                                  renderOption={(v) => {
                                    const slug = MONTH_TEAM_COLUMNS.find((t) => t.label === v)?.id ?? null;
                                    return (
                                      <span className="inline-flex items-center gap-1.5">
                                        <TeamAvatar slug={slug} sizePx={16} fallback={<Users className="size-3.5 text-slate-400" aria-hidden />} />
                                        <span className="truncate">{v}</span>
                                      </span>
                                    );
                                  }}
                                  onChange={(v) => setMonthLoadDrilldownFilter((p) => ({ ...p, team: v }))}
                                  ariaLabel="Filter month load by team"
                                />
                              </th>
                              <th className="min-w-0 px-1 py-0.5">
                                <DrilldownFilterDropdown
                                  value={monthLoadDrilldownFilter.assignee}
                                  options={uniqueAssignees}
                                  renderOption={(name) => {
                                    const resolved = resolveAssigneeAvatar(name, workspaceDirectoryUsers);
                                    return (
                                      <span className="inline-flex items-center gap-1.5">
                                        <UserAvatar name={resolved.name} image={resolved.image} size={16} className="ring-0" />
                                        <span className="truncate">{name}</span>
                                      </span>
                                    );
                                  }}
                                  onChange={(v) => setMonthLoadDrilldownFilter((p) => ({ ...p, assignee: v }))}
                                  ariaLabel="Filter month load by assignee"
                                />
                              </th>
                              <th className="min-w-0 px-1 py-0.5">
                                <DrilldownFilterDropdown value={monthLoadDrilldownFilter.status} options={uniqueStatuses} renderOption={renderStatusOption} onChange={(v) => setMonthLoadDrilldownFilter((p) => ({ ...p, status: v }))} ariaLabel="Filter month load by status" />
                              </th>
                              <th className="min-w-0 px-1 py-0.5">
                                <DrilldownFilterDropdown
                                  value={monthLoadDrilldownFilter.health}
                                  options={HEALTH_FILTER_OPTIONS}
                                  renderOption={renderHealthFilterOption}
                                  onChange={(v) => setMonthLoadDrilldownFilter((p) => ({ ...p, health: v as HealthStatus | null }))}
                                  ariaLabel="Filter month load by health"
                                />
                              </th>
                              {/* Σ totals over the currently visible (filtered) rows. */}
                              <th className="min-w-0 px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                                Σ <span className="text-slate-300">|</span> {monthLoadDrilldownStories.reduce((sum, s) => sum + (s.estimatedDays ?? 0), 0)}
                              </th>
                              <th className="min-w-0 px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                                Σ <span className="text-slate-300">|</span> {monthLoadDrilldownStories.reduce((sum, s) => sum + (s.daysLeft ?? 0), 0)}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              // Group the filtered stories by parent epic, then
                              // render each epic as a parent header row (full-
                              // width, with chevron) followed by its child
                              // story rows when expanded. Each story row carries
                              // a tree connector in its `#` cell (vertical line
                              // + horizontal elbow), mirroring the Estimate
                              // Coverage table pattern at
                              // `timeline-grid.tsx:4932-4939`.
                              const storyById = new Map(monthLoadDrilldownStories.map((s) => [s.id, s] as const));
                              type Group = { epic: EpicItem; stories: typeof monthLoadDrilldownStories };
                              const groups: Group[] = [];
                              for (const { epic } of monthEpics) {
                                const matching = (epic.userStories ?? [])
                                  .filter((s) => storyById.has(s.id))
                                  .map((s) => storyById.get(s.id)!);
                                if (matching.length > 0) groups.push({ epic, stories: matching });
                              }
                              groups.sort((a, b) => a.epic.title.localeCompare(b.epic.title));
                              let rowIdx = 0;
                              const rendered: ReactNode[] = [];
                              for (const { epic, stories } of groups) {
                                const isCollapsed = !expandedDrilldownEpics.has(epic.id);
                                const epicEstSum = stories.reduce((s, st) => s + (st.estimatedDays ?? 0), 0);
                                const epicLeftSum = stories.reduce((s, st) => s + (st.daysLeft ?? 0), 0);
                                {
                                  const epicTeamSlug = epic.team ?? null;
                                  const epicTeamLabel = monthTeamLabelForId(epicTeamSlug ?? "") ?? (epicTeamSlug || "—");
                                  const epicStatusLabel = epicStatusById.get(epic.id) ?? "To do";
                                  const epicStatusKey =
                                    epicStatusLabel === "Done" ? "done"
                                    : epicStatusLabel === "Review / Testing" ? "review"
                                    : epicStatusLabel === "In progress" ? "inProgress"
                                    : epicStatusLabel === "To do" ? "todo"
                                    : null;
                                  rendered.push(
                                    <tr key={`epic-${epic.id}`} className="bg-indigo-50/70 ring-1 ring-inset ring-indigo-100/80">
                                      <td colSpan={4} className="px-2 py-1.5">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setExpandedDrilldownEpics((prev) => {
                                              const next = new Set(prev);
                                              if (next.has(epic.id)) next.delete(epic.id);
                                              else next.add(epic.id);
                                              return next;
                                            });
                                          }}
                                          className="inline-flex w-full min-w-0 items-center gap-1.5 text-left"
                                        >
                                          <ChevronRight
                                            className={cn("size-4 shrink-0 text-slate-500 transition-transform", !isCollapsed && "rotate-90")}
                                            aria-hidden
                                          />
                                          <Folder className="size-3.5 shrink-0 text-sky-500" aria-hidden />
                                          <span className="min-w-0 truncate text-[13.5px] font-semibold text-slate-800">{epic.title}</span>
                                          <span className="ml-1 shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600 ring-1 ring-slate-200">
                                            {stories.length}
                                          </span>
                                        </button>
                                      </td>
                                      <td className="bg-indigo-50/70 px-2 py-1.5">
                                        <span className="inline-flex min-w-0 items-center gap-1.5">
                                          <TeamAvatar slug={epicTeamSlug} sizePx={16} fallback={<Users className="size-3.5 text-slate-400" aria-hidden />} />
                                          <span className="truncate text-[12.5px] text-slate-700">{epicTeamLabel}</span>
                                        </span>
                                      </td>
                                      <td className="bg-indigo-50/70 px-2 py-1.5">
                                        <DrilldownAssigneeCell assignee={epic.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                                      </td>
                                      <td className="bg-indigo-50/70 px-2 py-1.5">
                                        {epicStatusKey ? (
                                          <StoryStatusPill status={epicStatusKey} />
                                        ) : (
                                          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700">
                                            <Circle className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                                            <span className="truncate">{epicStatusLabel}</span>
                                          </span>
                                        )}
                                      </td>
                                      <td className="bg-indigo-50/70 px-2 py-1.5">
                                        {(() => {
                                          const v = computeEpicHealthVerdict(epic, planYear, progressBasis);
                                          if (!v) return <span className="text-slate-300">—</span>;
                                          const tip = formatHealthTooltip(v.result);
                                          return <HealthBadgeWithTextPopover size="xs" status={v.status} tooltip={tip} />;
                                        })()}
                                      </td>
                                      <td className="bg-indigo-50/70 px-2 py-1.5 text-right text-[12px] font-semibold tabular-nums text-slate-700">{epicEstSum}</td>
                                      <td className="bg-indigo-50/70 px-2 py-1.5 text-right text-[12px] font-semibold tabular-nums text-slate-700">{epicLeftSum}</td>
                                    </tr>
                                  );
                                }
                                if (isCollapsed) continue;
                                stories.forEach((story, storyIdx) => {
                                  rowIdx += 1;
                                  const isLast = storyIdx === stories.length - 1;
                                  const storyTeamId = epicTeamByStoryId.get(story.id) ?? "";
                                  const storyTeamLabel = monthTeamLabelForId(storyTeamId) ?? (storyTeamId || "—");
                                  rendered.push(
                                    <tr key={story.id} className={drilldownTableRowZebra}>
                                      <td className="relative min-w-0 px-2 py-0.5 pl-6 text-right tabular-nums text-slate-500">
                                        {/* Tree connector — vertical rail down
                                         *  the left edge (stops at the elbow
                                         *  for the last story in the group)
                                         *  plus a horizontal elbow into the
                                         *  cell. Same visual the Estimate
                                         *  Coverage table uses. */}
                                        <span
                                          className="absolute left-3 top-0 w-px bg-indigo-300"
                                          style={{ height: isLast ? "50%" : "100%" }}
                                          aria-hidden
                                        />
                                        <span className="absolute left-3 top-1/2 h-px w-3 -translate-y-px bg-indigo-300" aria-hidden />
                                        {rowIdx}
                                      </td>
                                      <td className="min-w-0 px-2 py-0.5">
                                        <span className="inline-flex min-w-0 items-center gap-1.5">
                                          <UserStoryIcon className="size-3.5" />
                                          <InsightsTruncatedHoverButton label={scopedStoryDisplayIds.get(story.id) ?? story.id.slice(0, 8)} onClick={() => onOpenStory?.(story.id)} className="block min-w-0 max-w-full truncate text-left font-semibold text-blue-700 underline-offset-2 hover:underline" />
                                        </span>
                                      </td>
                                      <td className="min-w-0 px-2 py-0.5"><InsightsTruncatedHoverLabel text={story.title} /></td>
                                      <td className="min-w-0 px-2 py-0.5">
                                        <span className="inline-flex min-w-0 items-center gap-1.5">
                                          <Flag className="size-3.5 shrink-0 text-rose-500" aria-hidden />
                                          {normalizeStoryYearSprint(story.sprint, scopeStartMonth) != null ? (
                                            <InsightsTruncatedHoverButton label={storySprintDisplayLabel(story.sprint, scopeStartMonth)} onClick={() => { const t = normalizeStoryYearSprint(story.sprint, scopeStartMonth); if (t) onOpenSprintKanban?.(t, resolveStoryTeamForSprintNav(story)); }} className="block w-full max-w-full truncate text-left font-semibold text-blue-700 underline-offset-2 hover:underline" />
                                          ) : (
                                            <InsightsTruncatedHoverLabel text="Unscheduled" />
                                          )}
                                        </span>
                                      </td>
                                      <td className="min-w-0 px-2 py-0.5">
                                        <InsightsTruncatedHoverLabel text={storyTeamLabel} />
                                      </td>
                                      <td className="min-w-0 px-2 py-0.5">
                                        <DrilldownAssigneeCell assignee={story.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                                      </td>
                                      <td className="min-w-0 px-2 py-0.5">
                                        <StoryStatusPill status={story.status} sprint={story.sprint} />
                                      </td>
                                      <td className="min-w-0 px-2 py-0.5">
                                        {(() => {
                                          const v = computeStoryHealthVerdict(story, epic, planYear);
                                          if (!v) return <span className="text-slate-300">—</span>;
                                          const tip = formatStoryHealthTooltip(story, epic, planYear, v.status);
                                          return <HealthBadgeWithTextPopover size="xs" status={v.status} tooltip={tip} />;
                                        })()}
                                      </td>
                                      <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.estimatedDays ?? "—"}</td>
                                      <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.daysLeft ?? "—"}</td>
                                    </tr>
                                  );
                                });
                              }
                              if (rendered.length === 0) {
                                rendered.push(
                                  <tr key="ml-empty">
                                    <td colSpan={10} className="px-3 py-6 text-center text-[13px] text-slate-400">
                                      No in-scope stories match the current filters.
                                    </td>
                                  </tr>
                                );
                              }
                              if (monthLoadDrilldownEmptyRows > 0) {
                                for (let i = 0; i < monthLoadDrilldownEmptyRows; i++) {
                                  rendered.push(
                                    <tr key={`ml-empty-${i}`} className={drilldownTableEmptyRowZebra}>
                                      <td colSpan={10} className="px-3 py-0.5 text-[13px]">{" "}</td>
                                    </tr>
                                  );
                                }
                              }
                              return rendered;
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                  </InsightsDrilldownModal>
                  );
                })() : null}
                <div className={cn("relative", INSIGHTS_CHART_BAND)}>
                  <div
                    ref={monthLoadScrollRef}
                    onScroll={updateMonthLoadArrowState}
                    className="h-full space-y-1 overflow-y-auto overflow-x-hidden pr-5 [&::-webkit-scrollbar]:hidden"
                    style={{ scrollbarWidth: "none" }}
                  >
                  {loadRows.map((row, rowIdx) => {
                    const doneDays = Math.max(0, row.estTotal - row.daysLeft);
                    const donePct = row.estTotal > 0 ? Math.round((doneDays / row.estTotal) * 100) : 100;
                    const allDone = row.daysLeft === 0 && row.estTotal > 0;
                    // Team-level health from the per-epic rollup. Only set
                    // for teams (rows generated from analytics.workloadByTeam).
                    const teamHealth = row.teamSlug ? teamHealthByTeamKey.get(row.teamSlug) : undefined;
                    // User-level health from the per-story rollup. Set
                    // when the row is in user mode (no `teamSlug`) and
                    // the assignee has any in-scope verdicted stories.
                    const userHealth = !row.teamSlug ? userVerdictBucketsByAssignee.get(row.key) : undefined;
                    // Row-level verdict — applies the same days-vs-days
                    // rule the sprint-story verdict uses, treating the
                    // row's total daysLeft as the "story" and the
                    // month's remaining calendar days as the sprint
                    // window. Used by every row (user OR team) to
                    // drive the badge next to the name and the
                    // circle's stroke color. Null when the row has no
                    // estimated work (donut + badge skip).
                    const rowVerdict: HealthStatus | null = row.estTotal <= 0
                      ? null
                      : allDone
                        ? "done"
                        : monthDaysLeft <= 0
                          ? "overdue"
                          : row.daysLeft > monthDaysLeft
                            ? "atRisk"
                            : row.daysLeft === monthDaysLeft
                              ? "watch"
                              : "onTrack";
                    // Avatar ring / bar tint still uses the team-level
                    // health when present, so team rows keep a soft
                    // amber/emerald accent — much subtler than the
                    // previous full-row verdict tint. The row's verdict
                    // information now lives entirely in the
                    // `VerdictDistributionChip`.
                    const atRisk = teamHealth
                      ? (teamHealth.status === "atRisk" || teamHealth.status === "overdue")
                      : (rowVerdict === "atRisk" || rowVerdict === "overdue");
                    const watch = teamHealth?.status === "watch" || rowVerdict === "watch";
                    return (
                      <button
                        key={row.key}
                        type="button"
                        onClick={row.onRowClick}
                        className="w-full rounded-lg bg-white px-2 py-1.5 text-left transition-colors hover:bg-slate-50/60"
                      >
                        <div className="flex items-center gap-2">
                          {row.teamSlug ? (
                            <TeamAvatar
                              slug={row.teamSlug}
                              sizePx={24}
                              rounded="rounded-full"
                              className={cn(
                                "ring-1",
                                atRisk
                                  ? "ring-amber-200/80"
                                  : allDone
                                    ? "ring-emerald-200/80"
                                    : "ring-violet-200/80",
                              )}
                              fallback={
                                <span
                                  className={cn(
                                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-1",
                                    atRisk
                                      ? "bg-amber-100 text-amber-800 ring-amber-200/80"
                                      : allDone
                                        ? "bg-emerald-100 text-emerald-700 ring-emerald-200/80"
                                        : "bg-violet-100 text-violet-700 ring-violet-200/80",
                                  )}
                                >
                                  {row.initials || <Users className="size-3" />}
                                </span>
                              }
                            />
                          ) : row.image ? (
                            <UserAvatar
                              name={row.label}
                              image={row.image}
                              size={24}
                              className={cn(
                                "ring-1",
                                atRisk
                                  ? "ring-amber-200/80"
                                  : allDone
                                    ? "ring-emerald-200/80"
                                    : "ring-violet-200/80",
                              )}
                            />
                          ) : (
                            <span
                              className={cn(
                                "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-1",
                                atRisk
                                  ? "bg-amber-100 text-amber-800 ring-amber-200/80"
                                  : allDone
                                    ? "bg-emerald-100 text-emerald-700 ring-emerald-200/80"
                                    : "bg-violet-100 text-violet-700 ring-violet-200/80",
                              )}
                            >
                              {row.initials || <User className="size-3" />}
                            </span>
                          )}
                          {(() => {
                            // Row tones are now neutral — the
                            // `VerdictDistributionChip` is the ONLY
                            // surface that carries verdict info, so the
                            // progress bar fill, clock-chip background,
                            // and circle stroke all stay color-calm.
                            // Previously they all keyed off `rowVerdict`
                            // (worst-of-children), which tinted the
                            // entire row red for a team with one slipping
                            // epic — misleading when 90% of the work was
                            // healthy. The distribution chip surfaces the
                            // proportional truth instead.
                            const tone = {
                              bar: "bg-indigo-400",
                              pct: "text-indigo-600",
                              chip: "bg-slate-50 text-slate-700 ring-slate-200/70",
                              stroke: "#6366f1",
                            };
                            return (
                              <>
                                <div className="min-w-0 flex-1">
                                  {/* Name + (HealthBadge + days chip)
                                   *  on the same horizontal line. Chips
                                   *  push right via `ml-auto` on the
                                   *  cluster so they sit close to the
                                   *  edge of the flex-1 (just inside
                                   *  the donut). Progress bar is the
                                   *  next row below, full width. */}
                                  <div className="flex items-center gap-2">
                                    <span className="truncate text-[12.5px] font-semibold text-slate-800">{row.label}</span>
                                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                      {/* Verdict distribution chip was
                                       *  here briefly — removed at the
                                       *  user's request. Row click is
                                       *  the click target now (Month
                                       *  Load drilldown in team mode,
                                       *  epic-accordion popover in
                                       *  user mode). */}
                                      {(() => {
                                        // Done-vs-left presentation —
                                        // the prior "Xd / Yd left"
                                        // pattern forced subtraction
                                        // and broke down when scope
                                        // crept (e.g. "6d / 5d left"
                                        // read as an error). Now each
                                        // state has its own shape so
                                        // the reader doesn't infer:
                                        //  · Done    → "Done ✓ · 5d"
                                        //  · Untouched → "5d to do" /
                                        //               "2 stories to do"
                                        //  · Over capacity → "5d est ·
                                        //               6d to do" + ⚠
                                        //  · Mid-burn → "3d done · 2d
                                        //               left" with the
                                        //               done segment
                                        //               tinted emerald.
                                        const unit = loadUnitSuffix;
                                        const noun = useStoriesBasis ? "stories" : "days";
                                        const allDone = row.daysLeft === 0 && row.estTotal > 0;
                                        const untouched = doneDays === 0 && row.daysLeft > 0;
                                        const overCapacity = row.daysLeft > row.estTotal && row.estTotal > 0;
                                        const formatVal = (n: number) => `${n}${unit}`;
                                        const titleText = useStoriesBasis
                                          ? `${row.estTotal} ${noun} total · ${doneDays} completed · ${row.daysLeft} open`
                                          : `${row.estTotal}${unit} estimated total · ${doneDays}${unit} in review · ${row.daysLeft}${unit} left`;
                                        const chipBase = cn(
                                          "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1",
                                          tone.chip,
                                        );
                                        if (allDone) {
                                          return (
                                            <span className={chipBase} title={titleText}>
                                              <CheckCircle2 className="size-2.5 text-emerald-600" strokeWidth={2.5} aria-hidden />
                                              <span className="text-emerald-700">Done</span>
                                              <span className="opacity-50">·</span>
                                              <span>{formatVal(row.estTotal)}{useStoriesBasis ? ` ${noun}` : ""}</span>
                                            </span>
                                          );
                                        }
                                        if (overCapacity) {
                                          return (
                                            <span className={chipBase} title={titleText}>
                                              <Clock className="size-2.5" strokeWidth={2.2} aria-hidden />
                                              <span>{formatVal(row.estTotal)} est</span>
                                              <span className="opacity-50">·</span>
                                              <span className="text-rose-700">{formatVal(row.daysLeft)} to do</span>
                                            </span>
                                          );
                                        }
                                        if (untouched) {
                                          return (
                                            <span className={chipBase} title={titleText}>
                                              <Clock className="size-2.5" strokeWidth={2.2} aria-hidden />
                                              <span>{formatVal(row.daysLeft)}{useStoriesBasis ? ` ${noun}` : ""} to do</span>
                                            </span>
                                          );
                                        }
                                        // Mid-burn: two segments,
                                        // green done + neutral left.
                                        return (
                                          <span className={chipBase} title={titleText}>
                                            <CheckCircle2 className="size-2.5 text-emerald-600" strokeWidth={2.5} aria-hidden />
                                            <span className="text-emerald-700">{formatVal(doneDays)} done</span>
                                            <span className="opacity-50">·</span>
                                            <span>{formatVal(row.daysLeft)}{useStoriesBasis ? ` ${noun}` : ""} left</span>
                                          </span>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                  <div className="mt-1 relative h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/50">
                                    <div
                                      className={cn("absolute inset-y-0 left-0 rounded-full transition-all", tone.bar)}
                                      style={{ width: `${donePct}%` }}
                                    />
                                  </div>
                                </div>
                                <CircleProgress percent={donePct} color={tone.stroke} />
                              </>
                            );
                          })()}
                        </div>
                      </button>
                    );
                  })}
                  </div>
                  <button
                    type="button"
                    onClick={() => scrollMonthLoadBy(-96)}
                    className={cn(
                      "absolute right-0 top-0 inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                      canScrollMonthLoadUp && "bg-slate-200/70 text-slate-800",
                    )}
                    aria-label="Scroll up month load"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollMonthLoadBy(96)}
                    className={cn(
                      "absolute bottom-0 right-0 inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                      canScrollMonthLoadDown && "bg-slate-200/70 text-slate-800",
                    )}
                    aria-label="Scroll down month load"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </div>
                <p className="mt-2 shrink-0 text-[12px] text-slate-600">
                  {analytics.openStories} open stories.
                </p>
              </div>
            );
          })()}

          {/* Burn Up chart + right-side epic legend */}
          <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-1 lg:h-full">
            <div className={cn("mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
              <div className="ml-[35px] flex min-w-0 flex-col">
              <h3
                className={cn(
                  "inline-flex items-center gap-1.5 font-semibold text-slate-800",
                  isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
                )}
              >
                <TrendingUp className="size-4 text-slate-600" />
                Epic Scope Burnup
                {burnupHealth ? (() => {
                  // Same scope-resolution rule as burndown: focused epic
                  // wins (scope picker OR legend filtered to 1), then
                  // initiative title, then a count-aware fallback.
                  const focusedBurnupRow = selectedEpicOption
                    ? selectedEpicOption
                    : burnUpVisibleKeys.length === 1
                      ? monthEpics.find((row) => row.epic.id === burnUpVisibleKeys[0]) ?? null
                      : null;
                  const selectedInit = selectedInitiativeId !== "all"
                    ? monthEpics.find((r) => r.initiative.id === selectedInitiativeId)?.initiative ?? null
                    : null;
                  const totalEpics = monthEpics.length;
                  const visibleEpicCount = burnUpVisibleKeys.length === 0
                    ? totalEpics
                    : monthEpics.filter((r) => burnUpVisibleKeys.includes(r.epic.id)).length;
                  const scopeLabel = focusedBurnupRow
                    ? `${focusedBurnupRow.epic.title} (epic)`
                    : selectedInit
                      ? `${selectedInit.title} (initiative)`
                      : visibleEpicCount < totalEpics
                        ? `${visibleEpicCount} of ${totalEpics} epics visible`
                        : `All ${totalEpics} epics in scope`;
                  return (
                    <HealthBadgeWithDetail
                      status={burnupHealth.status}
                      result={burnupHealth.result}
                      basis={burnupBasis}
                      basisLabel={basisDisplayLabel(burnupBasis, focusedBurnupRow ? "epic" : "initiative")}
                      scopeLabel={scopeLabel}
                      chartKind="burnup"
                      className="ml-1"
                      badgeClassName="py-0 text-[11.5px]"
                    />
                  );
                })() : null}
              </h3>
              {burnUpTitleSuffix ? (
                <div className="mt-0.5">{burnUpTitleSuffix}</div>
              ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {/* Plan toggle — shared `showEpicPlanMarkers` state with
                 *  the Burndown chart. Flips the focused-epic plan
                 *  overlay (ideal line + "Due DD/MM" marker + "Epic
                 *  scheduled" start marker) on or off in one click. */}
                <button
                  type="button"
                  onClick={() => setShowEpicPlanMarkers((v) => !v)}
                  title={showEpicPlanMarkers ? "Hide epic plan overlay (ideal, due, scheduled)" : "Show epic plan overlay (ideal, due, scheduled)"}
                  aria-pressed={showEpicPlanMarkers}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition",
                    showEpicPlanMarkers
                      ? "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  <Target className="size-3.5" aria-hidden />
                  Plan
                </button>
                {/* Forecast toggle — same shape as burndown's, projects a
                 *  straight-line trend from today's `completed` value up to
                 *  the projected `scope` crossing using the current burn
                 *  rate. Extends the X-axis when the projected date is
                 *  past the plan end. */}
                <button
                  type="button"
                  onClick={() => setShowBurnUpForecast((v) => !v)}
                  title={
                    burnUpForecastDate
                      ? showBurnUpForecast
                        ? `Hide forecast (current pace → ${burnUpForecastDate.getDate()}/${burnUpForecastDate.getMonth() + 1})`
                        : `Show forecast (current pace → ${burnUpForecastDate.getDate()}/${burnUpForecastDate.getMonth() + 1})`
                      : "Forecast unavailable (no burn yet)"
                  }
                  aria-pressed={showBurnUpForecast}
                  disabled={!burnUpForecastDate}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    showBurnUpForecast
                      ? "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  <TrendingUp className="size-3.5" aria-hidden />
                  Forecast
                  {showBurnUpForecast && burnUpForecastDate ? (
                    <span className="ml-1 tabular-nums text-violet-600/90">
                      {burnUpForecastDate.getDate()}/{burnUpForecastDate.getMonth() + 1}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
            <div
              className={cn(
                // Burnup chart (full-width). Legend column removed per
                // planner request — the Insights "Epic / Initiative
                // Scope" picker above is the canonical filter surface.
                "grid min-h-0 flex-1 md:grid-cols-1 md:items-stretch",
                INSIGHTS_CHART_GRID_GAP,
                INSIGHTS_CONTENT_HEIGHT,
              )}
            >
              {/* Chart */}
              <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
                {burnUpData.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-500">
                    No scheduled stories for the selected scope.
                  </div>
                ) : (
                <div className="absolute inset-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={burnUpDataTruncated} margin={{ top: 38, right: 24, left: 18, bottom: 32 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="labelShort"
                        interval={0}
                        ticks={burnUpAxisTicks}
                        tick={(props) => {
                          const { x, y, payload, index } = props;
                          const label = String(payload?.value ?? "");
                          const isToday = Boolean(burnUpData[index]?.isToday);
                          return (
                            <text x={x} y={y} dy={8} textAnchor="end" transform={`rotate(-28,${x},${y})`}
                              fill={isToday ? "#0f172a" : "#64748b"} fontSize={isToday ? 13 : 11} fontWeight={isToday ? 700 : 400}
                            >
                              {label}
                            </text>
                          );
                        }}
                        height={44}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 10 }}
                        width={44}
                        label={{ value: burnUpMetric === "daysLeft" ? "Days completed" : "Stories", angle: -90, position: "insideLeft", offset: 12, dy: 50, fill: "#64748b", fontSize: 13 }}
                        domain={[0, (dataMax: number) => Math.ceil(Math.max(dataMax, burnUpSingleEpicVisible ? burnUpScopeTotal : 0) * 1.22)]}
                        padding={{ bottom: 4 }}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const row = payload[0]?.payload as { isToday?: boolean } | undefined;
                          const title = String(label ?? "Epic Scope Burnup") + (row?.isToday ? " · Today" : "");
                          return (
                            <AnalyticsTooltipShell title={title}>
                              {payload.map((item, idx) => (
                                <AnalyticsTooltipRow
                                  key={`${String(item.name)}-${idx}`}
                                  color={item.color as string}
                                  label={String(item.name ?? "")}
                                  value={burnUpMetric === "daysLeft" ? `${Number(item.value ?? 0)}d` : `${Number(item.value ?? 0)} stories`}
                                />
                              ))}
                            </AnalyticsTooltipShell>
                          );
                        }}
                        cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3", strokeOpacity: 0.5 }}
                      />
                      {(() => {
                        const todayRow = burnUpData.find((d) => d.isToday);
                        return todayRow?.labelShort ? (
                          <ReferenceLine
                            x={todayRow.labelShort}
                            stroke="#94a3b8"
                            strokeDasharray="4 2"
                            label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
                          />
                        ) : null;
                      })()}
                      {/* Total-scope reference + aggregate ideal/completed —
                       *  shown either when narrowed to a single epic OR when
                       *  ALL epics are visible (the "All" view). The
                       *  aggregate completed line is what most planners
                       *  want to read on the All view, mirroring the
                       *  Portfolio Burndown hero card.
                       *  In the in-between case (a hand-picked subset of
                       *  epics), the per-epic colored lines below still
                       *  render so users can compare specific epics. */}
                      {burnUpSingleEpicVisible || allBurnUpKeysSelected ? (
                        <>
                          <Line type="monotone" dataKey="scope" name="Total scope" stroke="#94a3b8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                          {showEpicPlanMarkers ? (
                            <Line type="monotone" dataKey="ideal" name={burnUpDueDateLabel ? `Ideal (due ${burnUpDueDateLabel})` : "Ideal"} stroke="#f97316" strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls={false} isAnimationActive={false} />
                          ) : null}
                          <Line type="monotone" dataKey="completed" name="Completed" stroke="#0ea5e9" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
                        </>
                      ) : null}
                      {showBurnUpForecast && burnUpForecastDate ? (
                        // Forecast line: from today's completed up to
                        // (forecast date, scope). Straight extrapolation
                        // at the current burn rate.
                        <Line
                          type="linear"
                          dataKey="forecast"
                          stroke="#7c3aed"
                          strokeWidth={2}
                          strokeDasharray="3 3"
                          dot={{ r: 3, fill: "#7c3aed", strokeWidth: 0 }}
                          name={`Forecast → ${burnUpForecastDate.getDate()}/${burnUpForecastDate.getMonth() + 1}`}
                          connectNulls
                          isAnimationActive={false}
                        />
                      ) : null}
                      {/* Per-epic completed lines — rendered only when a
                       *  HAND-PICKED SUBSET of epics is visible (not single,
                       *  not all). In single + all modes the aggregate
                       *  lines above carry the chart on their own. */}
                      {!burnUpSingleEpicVisible && !allBurnUpKeysSelected ? burnUpEpicRows.map((row, rowIdx) =>
                        burnUpVisibleKeys.includes(row.id) ? (
                          <Line
                            key={row.id}
                            type="monotone"
                            dataKey={row.id}
                            name={row.title}
                            stroke={LINE_PALETTE[rowIdx % LINE_PALETTE.length]}
                            strokeWidth={2}
                            dot={false}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        ) : null,
                      ) : null}
                      {/* Δ annotation at today — only shown when the
                       *  burnup verdict is Watch or At Risk. Mirrors the
                       *  "Δ = +N" callout on slides 3–7 of the Health
                       *  Explainer: the value is `remainingEffort −
                       *  idealRemaining`, so positive = behind ideal.
                       *  Anchored at today's X position, vertically
                       *  centered between the completed and ideal values
                       *  so the bracket reads as "this is the gap." Hidden
                       *  in All-view (each epic has its own delta), Done
                       *  (no gap to flag), Overdue (different annotation),
                       *  and On Track (no risk to surface). */}
                      {burnUpSingleEpicVisible && burnupHealth
                        && (burnupHealth.status === "watch" || burnupHealth.status === "atRisk")
                        ? (() => {
                          const todayRow = burnUpDataTruncated.find((r) => r.isToday);
                          if (!todayRow) return null;
                          const completedAtToday = typeof todayRow.completed === "number" ? todayRow.completed : null;
                          const idealAtToday = typeof todayRow.ideal === "number" ? todayRow.ideal : null;
                          if (completedAtToday == null || idealAtToday == null) return null;
                          const midY = (completedAtToday + idealAtToday) / 2;
                          // deltaDays from computeProgress is signed:
                          // positive = behind ideal. Burnup units follow
                          // the active basis: stories → integer count;
                          // days/epicEst → days. We just respect whatever
                          // unit the chart is currently drawing.
                          const delta = burnupHealth.result.deltaDays;
                          const deltaText = `Δ = ${delta >= 0 ? "+" : ""}${burnUpMetric === "storyCount" ? Math.round(delta) : delta.toFixed(1)}`;
                          const accent = burnupHealth.status === "atRisk" ? "#dc2626" : "#d97706";
                          return (
                            <ReferenceDot
                              x={String(todayRow.labelShort ?? "")}
                              y={midY}
                              r={0}
                              isFront
                              ifOverflow="visible"
                              shape={(shapeProps: { cx?: number; cy?: number }) => {
                                const cx = shapeProps.cx ?? 0;
                                const cy = shapeProps.cy ?? 0;
                                return (
                                  <g>
                                    {/* Pill */}
                                    <rect x={cx + 6} y={cy - 9} width={64} height={18} rx={9} fill="white" stroke={accent} strokeWidth={1.4} />
                                    <text x={cx + 38} y={cy + 4} textAnchor="middle" fill={accent} fontSize={11} fontWeight={700}>
                                      {deltaText}
                                    </text>
                                  </g>
                                );
                              }}
                            />
                          );
                        })()
                        : null}
                      {/* "Epic scheduled DD/MM" marker — mirror of the
                       *  burndown variant, anchored at the burnup's
                       *  plan-start point where the ideal line begins
                       *  (y=0). Label sits in the chart's BOTTOM
                       *  margin (below the X-axis tick labels) with
                       *  the arrow pointing UP to the start — flipped
                       *  vs the burndown because the ideal line on
                       *  the burnup begins at the BOTTOM of the plot,
                       *  not the top. The LineChart's `bottom: 36`
                       *  margin reserves room for it. */}
                      {burnUpSingleEpicVisible && burnUpScheduledMarker && showEpicPlanMarkers ? (
                        <ReferenceDot
                          x={burnUpScheduledMarker.axisLabel}
                          y={0}
                          r={0}
                          isFront
                          ifOverflow="visible"
                          shape={(shapeProps: { cx?: number; cy?: number }) => {
                            const cx = shapeProps.cx ?? 0;
                            const cy = shapeProps.cy ?? 0;
                            // Place label BELOW the X-axis tick labels.
                            // `cy + 56` lands just past the bottom of
                            // the X-axis labels — uses overflow:visible
                            // to render past the SVG bottom, so the
                            // chart's bottom margin can stay tight
                            // (chart doesn't get pushed up away from
                            // the legend below).
                            const labelY = cy + 60;
                            const connectorBottom = labelY - 8;
                            const arrowBaseY = cy + 7;
                            const arrowTipY = cy + 2;
                            return (
                              <g>
                                <line
                                  x1={cx}
                                  y1={arrowBaseY}
                                  x2={cx}
                                  y2={connectorBottom}
                                  stroke="#f97316"
                                  strokeWidth={1.2}
                                  strokeDasharray="3 2"
                                />
                                <polygon
                                  points={`${cx - 3.5},${arrowBaseY} ${cx + 3.5},${arrowBaseY} ${cx},${arrowTipY}`}
                                  fill="#f97316"
                                />
                                <text
                                  x={cx}
                                  y={labelY}
                                  textAnchor="middle"
                                  fill="#c2410c"
                                  fontSize={11}
                                  fontWeight={600}
                                >
                                  {burnUpScheduledMarker.label}
                                </text>
                              </g>
                            );
                          }}
                        />
                      ) : null}
                      {/* Due target marker — same red BurndownTargetIcon
                       *  the burndown chart uses, anchored at the burnup's
                       *  due-date label so the two charts read symmetric.
                       *  Sits at the scope total (top of the burnup line);
                       *  the Done ✓ above stacks neatly on top. */}
                      {burnUpSingleEpicVisible && burnUpDueDateTickLabel && showEpicPlanMarkers ? (
                        <ReferenceDot
                          x={burnUpDueDateTickLabel}
                          y={burnUpScopeTotal}
                          r={0}
                          isFront
                          ifOverflow="visible"
                          shape={(shapeProps: { cx?: number; cy?: number }) => (
                            <BurndownTargetIcon cx={shapeProps.cx} cy={shapeProps.cy ?? 0} color="#dc2626" />
                          )}
                          label={{
                            value: `Due ${burnUpDueDateLabel}`,
                            position: "top",
                            fill: "#b91c1c",
                            fontSize: 11,
                            angle: 0,
                            offset: 8,
                          }}
                        />
                      ) : null}
                      {/* Done ✓ — anchored at the burnup due-date label
                       *  position when the completed line has reached scope.
                       *  Sits BELOW the red due-date target so the visual
                       *  stack reads top-to-bottom:
                       *  "Due X/Y" label → red bullseye → green ✓ → "Done".
                       *  Skipped on the story-count axis (no scope line to
                       *  reach), when the due-date label isn't known, and
                       *  in All view (each epic has its own due date). */}
                      {burnUpSingleEpicVisible && isBurnUpDone && burnUpDueDateTickLabel ? (
                        <ReferenceDot
                          x={burnUpDueDateTickLabel}
                          y={burnUpScopeTotal}
                          r={0}
                          isFront
                          ifOverflow="visible"
                          shape={(shapeProps: { cx?: number; cy?: number }) => {
                            const cx = shapeProps.cx ?? 0;
                            const cy = (shapeProps.cy ?? 0) + 18;
                            return (
                              <g>
                                <circle cx={cx} cy={cy} r={8} fill="#10b981" stroke="#ffffff" strokeWidth={1.5} />
                                <path d={`M ${cx - 3.5} ${cy} L ${cx - 0.8} ${cy + 2.6} L ${cx + 3.8} ${cy - 2.6}`} stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                              </g>
                            );
                          }}
                          label={{
                            value: "Done",
                            position: "bottom",
                            fill: "#047857",
                            fontSize: 10,
                            // Shape is drawn at cy + 18 visually — push label
                            // another ~12px below so it clears the circle.
                            offset: 32,
                          }}
                        />
                      ) : null}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                )}
              </div>

            </div>
            {/* Burnup legend — horizontal chip row beneath the chart,
             *  same shape as the burndown + CFD legends. */}
            <div
              className={cn(
                "mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-1",
                isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
              )}
            >
              {/* "All" toggle hides in aggregate mode — see burndown
               *  comment. */}
              {burnUpLegendItems.length > 1 ? (
                <button
                  type="button"
                  onClick={showAllBurnUpKeys}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium transition",
                    allBurnUpKeysSelected
                      ? "text-slate-900 hover:bg-slate-200/70"
                      : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-800",
                  )}
                >
                  <Layers className="size-3.5" aria-hidden />
                  All
                </button>
              ) : null}
              {burnUpLegendItems.map((row) => {
                const isAggregate = row.id === "__all__";
                const on = isAggregate
                  ? allBurnUpKeysSelected
                  : burnUpVisibleKeys.includes(row.id);
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => isAggregate
                      ? showAllBurnUpKeys()
                      : toggleBurnUpKey(row.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition",
                      on ? "text-slate-900 hover:bg-slate-200/70" : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-700",
                    )}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] ring-1 ring-black/10"
                      style={{ backgroundColor: row.color, opacity: on ? 1 : 0.35 }}
                    />
                    <span className="max-w-[14rem] truncate">{row.title}</span>
                  </button>
                );
              })}
            </div>
          </article>

        </div>
      )}
    </section>
  );
}

/**
 * Placeholder rendered for one frame before the full {@link MonthAnalytics}
 * tree mounts (see `DeferredMount` in timeline-grid). Matches the three-row
 * panel grid so the layout doesn't shift when the real charts swap in.
 */
export function MonthAnalyticsSkeleton() {
  const card = "rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3";
  const band = "h-[clamp(12.5rem,27vh,20rem)] min-h-[12.5rem]";
  const pieBand = "min-h-[14rem] lg:h-[clamp(14rem,30vh,22rem)]";
  const shimmer = "animate-pulse bg-slate-100";
  return (
    <section className="p-3 sm:p-5" aria-busy="true" aria-live="polite">
      <div className="mb-4 flex items-center gap-2">
        <div className={cn("h-6 w-40 rounded-md", shimmer)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
        <div className={cn(card, "lg:col-span-1 lg:h-full")}>
          <div className={cn("mb-2 h-5 w-32 rounded", shimmer)} />
          <div className={cn(pieBand, "flex items-center justify-center")}>
            <div className={cn("size-36 rounded-full", shimmer)} />
          </div>
        </div>
        <div className={cn(card, "lg:col-span-1 lg:h-full")}>
          <div className={cn("mb-2 h-5 w-44 rounded", shimmer)} />
          <div className={cn(band, "rounded-md", shimmer)} />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <div className={cn(card, "lg:col-span-1")}>
          <div className={cn("mb-2 h-5 w-36 rounded", shimmer)} />
          <div className={cn(band, "rounded-md", shimmer)} />
        </div>
        <div className={cn(card, "lg:col-span-1")}>
          <div className={cn("mb-2 h-5 w-40 rounded", shimmer)} />
          <div className={cn(band, "rounded-md", shimmer)} />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <div className={cn(card, "lg:col-span-1")}>
          <div className={cn("mb-2 h-5 w-32 rounded", shimmer)} />
          <div className={cn(band, "rounded-md", shimmer)} />
        </div>
        <div className={cn(card, "lg:col-span-1")}>
          <div className={cn("mb-2 h-5 w-36 rounded", shimmer)} />
          <div className={cn(band, "rounded-md", shimmer)} />
        </div>
      </div>
    </section>
  );
}
