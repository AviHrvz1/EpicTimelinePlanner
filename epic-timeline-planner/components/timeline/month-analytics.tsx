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
  Calendar,
  CheckCheck,
  CheckCircle2,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Eraser,
  ExternalLink,
  Flag,
  Folder,
  Layers,
  StickyNote,
  TrendingUp,
  User,
  UserRound,
  Users,
  Zap,
  ListTodo,
  PieChart as PieChartIcon,
  PlayCircle,
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
import { EpicItem, InitiativeItem, StoryDailySnapshotItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MONTH_TEAM_COLUMNS, monthTeamLabelForId } from "@/lib/month-team-board";
import { clampYearSprint, globalSprintFromMonthLane, monthLaneFromGlobalSprint, sprintStartDate, sprintEndDate } from "@/lib/year-sprint";
import { computeProgress, computeInitiativeProgress, type HealthStatus, type ProgressBasis, type ProgressResult } from "@/lib/progress";
import { computeEpicObservedStart, effectiveEpicStart } from "@/lib/epic-observed-start";
import { computeEpicHealthVerdict } from "@/lib/epic-health";
import { nowMs as clockNowMs } from "@/lib/clock";
import { projectInitiativesToCloseDate } from "@/lib/story-snapshot-projection";
import { SnapshotHeaderStrip, type SnapshotHeaderStripScope } from "@/components/timeline/snapshot-header-strip";
import { ToggleGroup } from "@/components/timeline/basis-toggle-group";
import { HealthBadge, HealthBadgeWithDetail, formatHealthTooltip } from "@/components/timeline/health-badge";
import { UserAvatar, resolveAssigneeAvatar } from "@/components/ui/user-avatar";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { useTeamImages } from "@/lib/use-team-images";

type BurndownMetric = "daysLeft" | "storyCount";
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
  const radius = 11;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const dashOffset = circumference * (1 - clamped / 100);
  return (
    <svg width={28} height={28} viewBox="0 0 28 28" aria-hidden>
      <circle cx={14} cy={14} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={2.4} />
      <circle
        cx={14}
        cy={14}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={2.4}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform="rotate(-90 14 14)"
      />
      <text x={14} y={16} textAnchor="middle" fontSize={8} fontWeight={700} fill="#475569">
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
}
const EMPTY_EPIC_DRILLDOWN_FILTER: EpicDrilldownFilter = {
  title: "",
  initiative: null,
  assignee: null,
  status: null,
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
  if (filter.initiative != null) filtered = filtered.filter((r) => initiativeTitle(r.id) === filter.initiative);
  if (filter.assignee != null) filtered = filtered.filter((r) => (r.assignee?.trim() || "Unassigned") === filter.assignee);
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
}

const EMPTY_DRILLDOWN_FILTER: DrilldownFilter = {
  title: "",
  sprint: null,
  team: null,
  assignee: null,
  status: null,
};

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
  if (filter.sprint != null) filtered = filtered.filter((r) => sprintLabel(r.sprint) === filter.sprint);
  if (filter.team != null && teamLabel) filtered = filtered.filter((r) => teamLabel(r.id) === filter.team);
  if (filter.assignee != null) filtered = filtered.filter((r) => (r.assignee?.trim() || "Unassigned") === filter.assignee);
  if (filter.status != null) filtered = filtered.filter((r) => r.status === filter.status);
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
  return status === "todo" || status === "inProgress";
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
  teamLabel,
  onOpenEpic,
}: {
  status: HealthStatus;
  atRiskEpics: FlaggedEpicEntry[];
  watchEpics: FlaggedEpicEntry[];
  overdueEpics: FlaggedEpicEntry[];
  teamLabel: string;
  onOpenEpic?: (epicId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Portal-positioned popover: anchored to the badge but rendered to
  // document.body so it escapes any `overflow:hidden` ancestor (the
  // Team Progress rows scroll inside a clipped container, which is
  // why z-index alone couldn't lift the panel out). Opens ABOVE the
  // badge by default — the Team Progress list often sits near the
  // bottom of a card and a downward-opening popover would clip.
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const popW = 384; // matches w-96
      const right = Math.min(window.innerWidth - 8, r.right);
      const left = Math.max(8, right - popW);
      // Anchor by the popover's bottom edge: it stays 6px ABOVE the
      // badge's top edge regardless of the popover's own height (which
      // varies with how many epics are flagged).
      const bottom = Math.max(8, window.innerHeight - r.top + 6);
      setPos({ left, bottom });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (wrapRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const verdict =
    status === "overdue" ? "Overdue"
    : status === "atRisk" ? "At Risk"
    : status === "watch" ? "Watch"
    : status === "done" ? "Done"
    : "On Track";
  const tipLines: string[] = [`${teamLabel} — ${verdict}`, "Click for details."];
  const flagged = overdueEpics.length + atRiskEpics.length + watchEpics.length;

  // The badge sits inside the row's <button>, so nesting another <button>
  // (HealthBadge with onClick) would be invalid HTML and browsers split
  // it inconsistently — that's why "nothing happens" on click. Render
  // HealthBadge as a plain span (no onClick) and put the toggle on this
  // wrapper span, stopping propagation so the row's onClick (which opens
  // the drilldown) doesn't also fire.
  return (
    <span
      ref={wrapRef}
      className="relative inline-flex cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setOpen((v) => !v);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }
      }}
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      {/* "xs" size — the Team Progress rows on the insights page are
          dense (team name + est/review/left numerics + progress bar),
          so the verdict badge drops to text-[10px] / px-1.5 / py-px
          to sit alongside without dominating the row. */}
      <HealthBadge size="xs" status={status} tooltip={tipLines.join("\n")} />
      {open && pos && typeof document !== "undefined" ? createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`${teamLabel} — ${verdict} details`}
          style={{ position: "fixed", left: pos.left, bottom: pos.bottom, zIndex: 1000 }}
          className="w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3.5 text-left text-slate-800 shadow-xl"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <p className="mb-2 inline-flex w-full items-center justify-between text-[12.5px] font-bold uppercase tracking-wide text-slate-500">
            <span>{teamLabel} · {verdict}</span>
            {flagged > 0 ? <span className="text-[12px] font-semibold normal-case tracking-normal text-slate-400">{flagged} flagged</span> : null}
          </p>
          {/** One-line reason for a flagged epic. The verdict is set by
           *  `deltaDays = remaining − ideal` where ideal interpolates
           *  linearly from total-effort at the epic's planned start to 0
           *  at its planned end. We surface the same numbers so the user
           *  can sanity-check the verdict against the chart. */}
          {(() => {
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
              // Per-bucket warning glyph + tint — overdue uses an octagon
              // since "past deadline" is a harder failure than "drifting".
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
                          onClick={() => { onOpenEpic?.(e.epic.id); setOpen(false); }}
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
            return (
              <>
                {renderList("overdue", overdueEpics, "text-rose-900", "Overdue — planned end passed")}
                {renderList("atRisk", atRiskEpics, "text-rose-800", "At Risk — ≥4d above ideal")}
                {renderList("watch", watchEpics, "text-amber-800", "Watch — 1–4d above ideal")}
              </>
            );
          })()}
          {flagged === 0 ? (
            <p className="text-[13px] text-slate-500">No flagged epics — everything is on or ahead of pace.</p>
          ) : null}
          <div className="mt-2 border-t border-slate-100 pt-2.5 text-[12.5px] leading-snug text-slate-500">
            <p className="mb-1"><span className="font-semibold text-slate-600">How we score:</span> at each point in an epic's window we compare its remaining work to the ideal linear burndown — Δ = remaining − ideal.</p>
            <p>≤ 1d → On Track · 1–4d → Watch · ≥ 4d → At Risk · past planned end → Overdue.</p>
          </div>
        </div>,
        document.body,
      ) : null}
    </span>
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
  const meta = (() => {
    switch (key) {
      case "done": return { label: "Done", Icon: CheckCircle2, color: "text-emerald-600" };
      case "review": return { label: "Review / Testing", Icon: CheckCheck, color: "text-violet-600" };
      case "inProgress": return { label: "In progress", Icon: PlayCircle, color: "text-blue-600" };
      case "todo": return { label: "To do", Icon: ListTodo, color: "text-amber-600" };
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
}: {
  active?: boolean;
  payload?: readonly BurndownTooltipPayload[];
  label?: string | number;
  metric: BurndownMetric;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((item) => item.value != null);
  if (rows.length === 0) return null;
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
function StoryStatusPill({ status }: { status: UserStoryItem["status"] }) {
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
    if (initiative.status !== "scheduled") continue;
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
      rows.push(...(epic.userStories ?? []));
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
    if (initiative.status !== "scheduled") continue;
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
  const [monthLoadDrilldownAssignee, setMonthLoadDrilldownAssignee] = useState<string | null>(null);
  const [monthLoadDrilldownIsTeam, setMonthLoadDrilldownIsTeam] = useState(false);
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
  const scopeInitiativeOptions = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ id: string; title: string }> = [];
    for (const { initiative } of allScopeEpics) {
      if (!seen.has(initiative.id)) {
        seen.add(initiative.id);
        result.push({ id: initiative.id, title: initiative.title });
      }
    }
    return result;
  }, [allScopeEpics]);
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
      monthEpics.map(({ epic, initiative }) => {
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
    [monthEpics, planYear, progressBasis],
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
  /** Suffix appended to every chart title so they read e.g. "Status (📁 Epic
   *  Title ↗)" or "Status (⚡ Initiative Title ↗)" when a scope is pinned.
   *  Epic scope gets a Folder glyph (slate-500) prefix; initiative scope gets
   *  a Zap glyph (blue-500). The trailing ExternalLink pill opens the scoped
   *  epic / initiative dialog. Empty when the scope is "all". */
  const scopeTitleSuffix = useMemo<ReactNode>(() => {
    // Comment-style suffix appended to chart titles when an epic /
    // initiative is pinned. Smaller font, gray throughout (icons +
    // brackets included) so it reads as supporting context, not a
    // second heading. The ExternalLink stays clickable but inherits
    // the same gray with a darker hover.
    if (selectedEpicOption) {
      const epicId = selectedEpicOption.epic.id;
      return (
        <span className="ml-1 inline-flex translate-y-[2px] items-center gap-1 text-[13px] font-normal text-slate-400">
          <span>(</span>
          <span className="text-slate-500">{selectedEpicOption.epic.title}</span>
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
          <span>)</span>
        </span>
      );
    }
    if (selectedInitiativeId !== "all") {
      const init = scopeInitiativeOptions.find((i) => i.id === selectedInitiativeId);
      if (init) {
        const initId = init.id;
        return (
          <span className="ml-1 inline-flex translate-y-[2px] items-center gap-1 text-[13px] font-normal text-slate-400">
            <span>(</span>
            <span className="inline-flex items-center gap-1">
              <Zap className="size-3.5 shrink-0 text-slate-400" aria-hidden />
              <span className="text-slate-500">{init.title}</span>
            </span>
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
            <span>)</span>
          </span>
        );
      }
    }
    return "";
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
    const scheduledStories = scopeStories.filter((story) => story.sprint != null);
    // Month burndown/flow scope: stories that are open at month start.
    const openAtMonthStartStories = scheduledStories.filter(
      (story) => story.status === "todo" || story.status === "inProgress",
    );
    const openStories = openAtMonthStartStories;
    const completedStories = scheduledStories.filter(
      (story) => story.status === "review" || story.status === "done",
    );

    const statusCounts = {
      unscheduled: scopeStories.filter((story) => story.sprint == null).length,
      todo: scheduledStories.filter((story) => story.status === "todo").length,
      inProgress: scheduledStories.filter((story) => story.status === "inProgress").length,
      review: scheduledStories.filter((story) => story.status === "review").length,
      done: scheduledStories.filter((story) => story.status === "done").length,
    };
    const statusPie = [
      { name: "Unscheduled", value: statusCounts.unscheduled },
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

    const byAssignee = new Map<
      string,
      {
        openCount: number;
        daysLeftTotal: number;
        estimatedTotal: number;
        storiesByStatus: { todo: number; inProgress: number; review: number; done: number };
      }
    >();
    for (const story of scheduledStories) {
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
        if (initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null) continue;
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
  const statusChartShowsEpics = isQuarterInsights && selectedEpicOption == null;
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
  const statusDrilldownScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollStatusDrilldownUp, setCanScrollStatusDrilldownUp] = useState(false);
  const [canScrollStatusDrilldownDown, setCanScrollStatusDrilldownDown] = useState(false);
  const updateStatusDrilldownArrowState = () => {
    const node = statusDrilldownScrollRef.current;
    if (!node) {
      setCanScrollStatusDrilldownUp(false);
      setCanScrollStatusDrilldownDown(false);
      return;
    }
    const epsilon = 2;
    setCanScrollStatusDrilldownUp(node.scrollTop > epsilon);
    setCanScrollStatusDrilldownDown(node.scrollTop + node.clientHeight < node.scrollHeight - epsilon);
  };
  const scrollStatusDrilldownBy = (delta: number) => {
    statusDrilldownScrollRef.current?.scrollBy({ top: delta, behavior: "smooth" });
  };
  useEffect(() => {
    if (!statusDrilldownFilter) {
      setCanScrollStatusDrilldownUp(false);
      setCanScrollStatusDrilldownDown(false);
      return;
    }
    updateStatusDrilldownArrowState();
  }, [statusDrilldownFilter, statusDrilldownRowCount, statusChartShowsEpics]);
  const statusPanelTitle = statusChartShowsEpics ? "Epic Progress" : "User Story Progress";
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
          map.set(story.id, epic.team ?? null);
        }
      }
    }
    return map;
  }, [initiatives]);
  const workloadDrilldownStoriesRaw = useMemo(() => {
    if (workloadDrilldownAssignee == null) return [];
    return scopedStories
      .filter((story) => story.sprint != null)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [workloadDrilldownAssignee, scopedStories]);
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
    return scopedStories
      .filter((story) => story.sprint != null)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [monthLoadDrilldownAssignee, scopedStories]);
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
      };
      const flagged: FlaggedEpicEntry = { title: epic.title, epic, result: h, end: v.end };
      if (h.status === "atRisk") entry.atRiskEpics.push(flagged);
      else if (h.status === "watch") entry.watchEpics.push(flagged);
      else if (h.status === "overdue") entry.overdueEpics.push(flagged);
      if (STATUS_RANK_LOCAL[h.status] > STATUS_RANK_LOCAL[entry.status]) entry.status = h.status;
      map.set(teamKey, entry);
    }
    return map;
  }, [monthEpics, planYear, progressBasis]);

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
    setStatusDrilldownColFilter({ ...EMPTY_DRILLDOWN_FILTER, status: colPrefill });
    setStatusDrilldownEpicFilter({ ...EMPTY_EPIC_DRILLDOWN_FILTER, status: colPrefill });
  };
  const clearStatusDrilldown = () => setStatusDrilldownFilter(null);
  const monthBurndownEpics = useMemo(() => {
    const source = selectedEpicOption != null ? [selectedEpicOption.epic] : monthEpics.map((row) => row.epic);
    return source.map((epic) => ({
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
  }, [monthEpics, selectedEpicOption, estimateSource]);

  const monthBurndown = useMemo(
    () =>
      buildQuarterBurndownSeries(
        monthBurndownEpics,
        "individual",
        metric,
        scopeMonths,
        planYear,
      ),
    [monthBurndownEpics, metric, scopeMonths, planYear],
  );
  const monthBurndownFilledToToday = useMemo(() => {
    const horizon = monthBurndown.length;
    if (horizon === 0) return monthBurndown;
    const now = new Date();
    const periodStartMs = new Date(planYear, scopeStartMonth - 1, 1).getTime();
    const nowDayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    // Math.round (not floor) to survive DST hour shifts — see burnup notes.
    const rawElapsed = Math.round((nowDayMs - periodStartMs) / 86400000) + 1;
    const elapsedDays = Math.max(0, Math.min(horizon, rawElapsed));
    const seriesKeys = monthBurndownEpics.map((epic) => epic.id);
    const nextRows = monthBurndown.map((row) => ({ ...row })) as Array<
      (typeof monthBurndown)[number] & Record<string, number | string | boolean | null | undefined>
    >;
    for (const key of seriesKeys) {
      let lastSeen: number | null = null;
      for (let i = 0; i < nextRows.length; i += 1) {
        const dayIdx = i + 1;
        const current = nextRows[i][key];
        if (typeof current === "number") {
          lastSeen = current;
          continue;
        }
        if (dayIdx <= elapsedDays && lastSeen != null) {
          nextRows[i][key] = lastSeen;
        }
      }
      for (let i = elapsedDays; i < nextRows.length; i += 1) {
        if (i + 1 > elapsedDays) nextRows[i][key] = null;
      }
    }
    return nextRows;
  }, [monthBurndown, monthBurndownEpics, planYear, month, scopeStartMonth]);
  const monthBurndownFromSnapshots = useMemo(() => {
    if (monthBurndown.length === 0) return null;
    const sourceEpics = selectedEpicOption != null ? [selectedEpicOption.epic] : monthEpics.map((row) => row.epic);
    const hasSnapshots = sourceEpics.some((epic) => (epic.userStories ?? []).some((story) => (story.snapshots?.length ?? 0) > 0));
    if (!hasSnapshots) return null;

    const now = new Date();
    const periodStartMs2 = new Date(planYear, scopeStartMonth - 1, 1).getTime();
    const nowDayMs2 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const rawElapsed2 = Math.round((nowDayMs2 - periodStartMs2) / 86400000) + 1;
    const elapsedDays = Math.max(0, Math.min(monthBurndown.length, rawElapsed2));
    const rows = monthBurndown.map((row) => ({ ...row })) as Array<Record<string, number | string | boolean | null | undefined>>;

    for (let i = 0; i < rows.length; i += 1) {
      const dayIdx = i + 1;
      const day = new Date(planYear, scopeStartMonth - 1, 1, 23, 59, 59, 999);
      day.setDate(day.getDate() + (dayIdx - 1));
      let dayTotal = 0;
      for (const epic of sourceEpics) {
        const epicStories = epic.userStories ?? [];
        let epicValue = 0;
        for (const story of epicStories) {
          const snapshot = latestSnapshotAtDayCached(story, day);
          const status = snapshot?.status ?? story.status;
          if (!isStoryOpen(status)) continue;
          if (metric === "storyCount") {
            epicValue += 1;
          } else {
            const daysLeft = snapshot?.daysLeft ?? snapshot?.estimatedDays ?? story.daysLeft ?? story.estimatedDays ?? 1;
            epicValue += Math.max(0, daysLeft);
          }
        }
        rows[i][epic.id] = dayIdx <= elapsedDays ? (metric === "storyCount" ? Math.round(epicValue) : Number(epicValue.toFixed(1))) : null;
        dayTotal += epicValue;
      }
      rows[i].actual = dayIdx <= elapsedDays ? (metric === "storyCount" ? Math.round(dayTotal) : Number(dayTotal.toFixed(1))) : null;
    }
    return rows as typeof monthBurndownFilledToToday;
  }, [monthBurndown, monthBurndownFilledToToday, selectedEpicOption, monthEpics, planYear, month, metric, scopeStartMonth]);
  const monthBurndownResolvedRaw = monthBurndownFromSnapshots ?? monthBurndownFilledToToday;
  /**
   * In `epicEst` basis the chart's ideal line + scope-promise reference are in
   * epic-estimate units, but the per-epic columns + aggregate `actual` are in
   * story-day units (typically 2-3× the epic estimate). Without rescaling, the
   * actual line floats above the chart and the burnup's mirror calculation
   * underflows to zero. Scale per-epic by `epicEst / startingOpenStoryDays`
   * so every series sits on the same axis. No-op for `days` / `stories`.
   */
  const monthBurndownResolved = useMemo(() => {
    if (burndownBasis !== "epicEst" || metric === "storyCount") return monthBurndownResolvedRaw;
    if (monthBurndownResolvedRaw.length === 0) return monthBurndownResolvedRaw;
    const epicMeta = monthBurndownEpics.map((epic) => {
      let startTotal = 0;
      for (const row of monthBurndownResolvedRaw) {
        const v = row[epic.id];
        if (typeof v === "number") { startTotal = v; break; }
      }
      return { id: epic.id, startTotal, epicEst: epic.originalEstimateDays ?? 0 };
    });
    const epicEstSumAll = epicMeta.reduce((acc, m) => acc + m.epicEst, 0);
    if (epicEstSumAll <= 0) return monthBurndownResolvedRaw;
    return monthBurndownResolvedRaw.map((row) => {
      const next: Record<string, number | string | boolean | null | undefined> = { ...row };
      let aggregate = 0;
      let anyValue = false;
      for (const { id, startTotal, epicEst } of epicMeta) {
        const current = row[id];
        if (typeof current !== "number") continue;
        anyValue = true;
        let scaled = current;
        if (startTotal > 0 && epicEst > 0) {
          scaled = (current / startTotal) * epicEst;
        } else if (epicEst > 0) {
          scaled = Math.min(current, epicEst);
        }
        next[id] = Number(scaled.toFixed(1));
        aggregate += scaled;
      }
      if (anyValue) next.actual = Number(aggregate.toFixed(1));
      return next;
    }) as typeof monthBurndownResolvedRaw;
  }, [monthBurndownResolvedRaw, burndownBasis, metric, monthBurndownEpics]);
  const burndownFocusedEpicOption = useMemo(() => {
    if (selectedEpicOption) return selectedEpicOption;
    if (burndownVisibleKeys.length !== 1) return null;
    return monthEpics.find((row) => row.epic.id === burndownVisibleKeys[0]) ?? null;
  }, [selectedEpicOption, burndownVisibleKeys, monthEpics]);
  /**
   * "Scope promise" horizontal reference line value for the burndown.
   * Only computed when the user has picked the epic-estimate basis;
   * lets the burndown chart show the epic-level estimate as a target
   * the curve is being measured against.
   *
   *   - Epic pinned: that epic's `originalEstimateDays`.
   *   - Initiative pinned: sum of `originalEstimateDays` across the
   *     initiative's child epics that are in this view.
   *   - "All" / aggregate: sum across every epic in the burndown's scope.
   *
   * Returns `null` when the line shouldn't render (wrong basis, no
   * estimate, or chart on the story-count Y axis where the units don't
   * match).
   */
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

  /**
   * Health verdict shown next to the burndown chart title. Uses the
   * chart's own basis (not the popover's global) so flipping the
   * chart-level toggle updates the badge alongside the curves. Scope:
   *   - Epic focused (selectedEpicOption) → that epic's verdict
   *   - Initiative focused (selectedInitiativeId !== "all") → rolled-up
   *     verdict across the initiative's child epics
   *   - "All" → aggregate verdict across the visible burndown epics
   */
  const burndownHealth = useMemo(() => {
    // Health must describe what the chart visually shows — if the legend
    // (or scope picker) has narrowed to one epic, the popover speaks for
    // THAT epic, not the full in-scope aggregate. Otherwise respect any
    // partial legend toggle so e.g. "7 of 10 epics visible" doesn't tally
    // numbers from epics that aren't being plotted.
    const epicsInScope = burndownFocusedEpicOption != null
      ? [burndownFocusedEpicOption.epic]
      : selectedInitiativeId !== "all"
        ? monthEpics.filter((row) => row.initiative.id === selectedInitiativeId).map((row) => row.epic)
        : monthBurndownEpics.filter((epic) => burndownVisibleKeys.length === 0 || burndownVisibleKeys.includes(epic.id));
    if (epicsInScope.length === 0) return null;
    const aggregateStories = epicsInScope.flatMap((epic) => epic.userStories ?? []);
    if (burndownBasis !== "epicEst" && aggregateStories.length === 0) return null;
    const periodStartDate = new Date(planYear, scopeStartMonth - 1, 1);
    const periodEndDate = new Date(planYear, scopeEndMonth, 0);
    // Each epic's verdict must use ITS OWN planned start/end window — the
    // chart's ideal line for a focused single epic is anchored to the
    // epic's due date, not the scope period. Using period bounds instead
    // makes a 31/5-due epic look "mildly behind" in late May even when
    // the chart shows it cliff-diving — because the period extends out
    // to year-end, inflating "working days left". Fall back to the
    // period bounds only when the epic has no plan dates.
    // Resolve each epic's window using the OBSERVED start when child
    // story snapshots show work began earlier than the planned start.
    // Falls back to the planned start if no movement has been recorded.
    // This keeps the verdict aligned with what the chart's ideal line
    // actually draws — both anchor to the team's real timeline, not a
    // calendar window the team may have started early on.
    const epicBounds = (epic: EpicItem): { start: Date; end: Date } => {
      const epicYear = epic.planYear ?? planYear;
      const plannedStart = epic.planStartMonth != null
        ? sprintStartDate(epicYear, globalSprintFromMonthLane(epic.planStartMonth, epic.planSprint === 2 ? 2 : 1))
        : periodStartDate;
      const end = epic.planEndMonth != null
        ? sprintEndDate(epicYear, globalSprintFromMonthLane(epic.planEndMonth, epic.planEndSprint === 1 ? 1 : 2))
        : periodEndDate;
      const observed = computeEpicObservedStart(epic);
      const start = observed != null && observed < plannedStart ? observed : plannedStart;
      return { start, end };
    };
    const epicOriginalEstSum = epicsInScope.reduce(
      (sum, e) => sum + (e.originalEstimateDays ?? 0),
      0,
    );
    if (epicsInScope.length === 1) {
      const bounds = epicBounds(epicsInScope[0]);
      const h = computeProgress({
        stories: epicsInScope[0].userStories ?? [],
        start: bounds.start,
        end: bounds.end,
        basis: burndownBasis,
        epicOriginalEstimateDays: epicsInScope[0].originalEstimateDays ?? null,
      });
      const hasData = burndownBasis === "stories"
        ? aggregateStories.length > 0
        : h.totalEffort > 0;
      if (!hasData) return null;
      return { status: h.status, tooltip: formatHealthTooltip(h), result: h };
    }
    const childStatuses: HealthStatus[] = epicsInScope.map((epic) => {
      const bounds = epicBounds(epic);
      const h = computeProgress({
        stories: epic.userStories ?? [],
        start: bounds.start,
        end: bounds.end,
        basis: burndownBasis,
        epicOriginalEstimateDays: epic.originalEstimateDays ?? null,
      });
      return h.status;
    });
    // Aggregate window = span of all child epics' (observed-or-planned)
    // bounds — same rule as the per-epic verdict above. Earliest start,
    // latest end.
    const childBoundsList = epicsInScope.map(epicBounds);
    const aggStart = childBoundsList.reduce((min, b) => b.start < min ? b.start : min, childBoundsList[0].start);
    const aggEnd = childBoundsList.reduce((max, b) => b.end > max ? b.end : max, childBoundsList[0].end);
    const h = computeInitiativeProgress({
      stories: aggregateStories,
      childStatuses,
      start: aggStart,
      end: aggEnd,
      basis: burndownBasis,
      epicOriginalEstimateDays: epicOriginalEstSum > 0 ? epicOriginalEstSum : null,
    });
    const hasData = burndownBasis === "stories"
      ? aggregateStories.length > 0
      : h.totalEffort > 0;
    if (!hasData) return null;
    return { status: h.status, tooltip: formatHealthTooltip(h), result: h };
  }, [burndownBasis, burndownFocusedEpicOption, selectedInitiativeId, monthEpics, monthBurndownEpics, burndownVisibleKeys, planYear, scopeStartMonth, scopeEndMonth]);
  const selectedEpicDueDate = useMemo(() => {
    if (!burndownFocusedEpicOption) return null;
    const dueSprint = burndownFocusedEpicOption.epic.planEndSprint;
    const dueMonth = burndownFocusedEpicOption.epic.planEndMonth ?? scopeEndMonth;
    const dueYear = burndownFocusedEpicOption.epic.planYear ?? planYear;
    const dueDay = dueSprint === 1 ? 15 : new Date(dueYear, dueMonth, 0).getDate();
    return new Date(dueYear, dueMonth - 1, dueDay);
  }, [burndownFocusedEpicOption, scopeEndMonth, planYear]);
  /** Symmetric to `selectedEpicDueDate` — the focused epic's effective
   *  start. Prefers the OBSERVED start (first day a story moved per
   *  snapshots) when it's earlier than the planned start, so the chart's
   *  ideal line aligns with where the blue actual line begins. Falls
   *  back to the planned start when no work has been recorded yet. */
  const selectedEpicStartDate = useMemo(() => {
    if (!burndownFocusedEpicOption) return null;
    const epic = burndownFocusedEpicOption.epic;
    const startSprint = epic.planSprint;
    const startMonth = epic.planStartMonth ?? scopeStartMonth;
    const startYear = epic.planYear ?? planYear;
    const startDay = startSprint === 2 ? 16 : 1;
    const plannedStart = new Date(startYear, startMonth - 1, startDay);
    const observed = computeEpicObservedStart(epic);
    return observed != null && observed < plannedStart ? observed : plannedStart;
  }, [burndownFocusedEpicOption, scopeStartMonth, planYear]);
  /**
   * Truncate each burndown series after the first day it reaches 0 — once
   * an epic is fully burned down (or the aggregate hits 0) there's nothing
   * more to plot, and the flat-line tail just adds visual noise. We swap
   * subsequent values to `null` per series so the line ends cleanly and
   * the chart shows a "Done ✓" marker on the due date instead.
   */
  const monthBurndownDoneByKey = useMemo(() => {
    const m = new Map<string, number>();
    if (monthBurndownResolved.length === 0) return m;
    const keys: string[] = ["actual", ...monthBurndownEpics.map((e) => e.id)];
    for (const key of keys) {
      for (let i = 0; i < monthBurndownResolved.length; i++) {
        const v = monthBurndownResolved[i]?.[key];
        if (typeof v === "number" && v === 0) {
          m.set(key, i);
          break;
        }
      }
    }
    return m;
  }, [monthBurndownResolved, monthBurndownEpics]);
  const monthBurndownTruncated = useMemo(() => {
    if (monthBurndownDoneByKey.size === 0) return monthBurndownResolved;
    return monthBurndownResolved.map((row, i) => {
      let next: Record<string, unknown> | null = null;
      for (const [key, doneIdx] of monthBurndownDoneByKey) {
        if (i > doneIdx) {
          if (next == null) next = { ...row };
          next[key] = null;
        }
      }
      return (next ?? row) as (typeof monthBurndownResolved)[number];
    }) as typeof monthBurndownResolved;
  }, [monthBurndownResolved, monthBurndownDoneByKey]);
  /** True when the focused epic's actual line hits 0 anywhere in the
   *  rendered window — drives the "Done ✓" marker on the due date. */
  const isFocusedBurndownDone = useMemo(() => {
    if (!burndownFocusedEpicOption) return false;
    return monthBurndownDoneByKey.has(burndownFocusedEpicOption.epic.id);
  }, [burndownFocusedEpicOption, monthBurndownDoneByKey]);
  const monthBurndownWithDueTarget = useMemo(() => {
    if (!burndownFocusedEpicOption || selectedEpicDueDate == null) return monthBurndownTruncated;
    const totalDays = monthBurndownTruncated.length;
    if (totalDays === 0) return monthBurndownTruncated;
    // Ideal line's starting value follows the basis so the chart matches
    // what the user picked in the toggle:
    //   - epicEst → epic.originalEstimateDays (linear burn against the epic
    //     promise; falls back to story sum when no epic estimate exists)
    //   - days → Σ child story estimated days (story burndown ideal)
    //   - stories → total story count (story-count burndown ideal)
    const stories = burndownFocusedEpicOption.epic.userStories ?? [];
    const storyDaysSum = stories.reduce((sum, s) => sum + (s.estimatedDays ?? s.daysLeft ?? 1), 0);
    const startValue =
      metric === "storyCount"
        ? stories.length
        : burndownBasis === "epicEst"
          ? (burndownFocusedEpicOption.epic.originalEstimateDays ?? storyDaysSum)
          : storyDaysSum;
    const monthStart = new Date(planYear, scopeStartMonth - 1, 1);
    const msPerDay = 24 * 60 * 60 * 1000;
    const dueDayIndex = Math.floor((selectedEpicDueDate.getTime() - monthStart.getTime()) / msPerDay) + 1;
    const targetDayIndex = Math.max(1, dueDayIndex);
    // Epic ideal stays flat at `startValue` until the epic actually
    // begins (selectedEpicStartDate), then ramps down to 0 by the due
    // day. Without this clamp the ramp spans the whole period — a
    // quarter-wide chart visually shows "we've been burning since Jan 1"
    // for an epic that only starts in July.
    const startDayIndex = selectedEpicStartDate != null
      ? Math.max(1, Math.floor((selectedEpicStartDate.getTime() - monthStart.getTime()) / msPerDay) + 1)
      : 1;
    const epicSpan = Math.max(1, targetDayIndex - startDayIndex);
    const withIdeal = monthBurndownTruncated.map((row, idx) => {
      const dayIdx = idx + 1;
      // Same approach as the burnup: only draw the ideal between the
      // epic's start and due. Outside that window we emit `null` so
      // Recharts (with connectNulls=false on the epicIdeal Line) skips
      // those segments — producing a single clean linear diagonal
      // instead of a long flat plateau plus a ramp.
      if (dayIdx > targetDayIndex || dayIdx < startDayIndex) {
        return { ...row, epicIdeal: null };
      }
      let epicIdealRaw: number;
      if (targetDayIndex <= 1) epicIdealRaw = 0;
      else epicIdealRaw = startValue * (1 - (dayIdx - startDayIndex) / epicSpan);
      const epicIdeal = metric === "storyCount"
        ? Math.max(0, Math.round(epicIdealRaw))
        : Number(Math.max(0, epicIdealRaw).toFixed(1));
      return { ...row, epicIdeal };
    });
    if (targetDayIndex <= totalDays) return withIdeal;
    const extended = [...withIdeal] as Array<Record<string, number | string | boolean | null | undefined>>;
    for (let dayIdx = totalDays + 1; dayIdx <= targetDayIndex; dayIdx += 1) {
      const dayDate = new Date(monthStart);
      dayDate.setDate(dayIdx);
      // Skip the pre-start tail in the EXTENDED region too — same
      // option-A rule: ideal is null outside the epic's window.
      if (dayIdx < startDayIndex) continue;
      let epicIdealRaw: number;
      if (targetDayIndex <= 1) epicIdealRaw = 0;
      else epicIdealRaw = startValue * (1 - (dayIdx - startDayIndex) / epicSpan);
      const epicIdeal =
        metric === "storyCount"
          ? Math.max(0, Math.round(epicIdealRaw))
          : Number(Math.max(0, epicIdealRaw).toFixed(1));
      const axisLabel = flowChartDayLabel(dayDate);
      extended.push({
        axisLabel,
        dayLabel: axisLabel,
        isToday: false,
        [burndownFocusedEpicOption.epic.id]: null,
        epicIdeal,
      });
    }
    return extended as typeof monthBurndownResolved;
  }, [monthBurndownTruncated, burndownFocusedEpicOption, selectedEpicDueDate, selectedEpicStartDate, metric, burndownBasis, planYear, month, scopeStartMonth]);
  const selectedEpicDueMarker = useMemo(() => {
    if (!selectedEpicDueDate || !burndownFocusedEpicOption) return null;
    if (monthBurndownWithDueTarget.length === 0) return null;
    const monthStart = new Date(planYear, scopeStartMonth - 1, 1);
    const msPerDay = 24 * 60 * 60 * 1000;
    const dueDayIndex = Math.floor((selectedEpicDueDate.getTime() - monthStart.getTime()) / msPerDay) + 1;
    const rowIndex = Math.max(0, Math.min(monthBurndownWithDueTarget.length - 1, dueDayIndex - 1));
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
      return [
        { key: selectedEpicOption.epic.id, label: selectedEpicOption.epic.title, color: LINE_PALETTE[0] },
        { key: "epicIdeal", label: "Epic ideal to due", color: "#f97316" },
      ];
    }
    return [
      ...monthBurndownEpics.map((epic, idx) => ({
        key: epic.id,
        label: epic.title,
        color: LINE_PALETTE[idx % LINE_PALETTE.length],
      })),
    ];
  }, [selectedEpicOption, monthBurndownEpics]);
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
    const storiesToTrack = sourceStories.filter((story) => story.sprint != null);
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
      for (const story of storiesToTrack) {
        const snapshot = latestSnapshotAtDayCached(story, cutoff);
        const status = isTodayCell
          ? story.status
          : (snapshot?.status ?? story.status);
        if (status === "todo") todo += 1;
        else if (status === "inProgress") inProgress += 1;
        else if (status === "review") review += 1;
        else if (status === "done") done += 1;
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

  /** Same shape as `burndownHealth`, scoped to the burnup chart's basis. */
  const burnupHealth = useMemo(() => {
    const epicsInScope = selectedEpicOption != null
      ? [selectedEpicOption.epic]
      : selectedInitiativeId !== "all"
        ? monthEpics.filter((row) => row.initiative.id === selectedInitiativeId).map((row) => row.epic)
        : monthEpics.map((r) => r.epic).filter((e) => burnUpVisibleKeys.length === 0 || burnUpVisibleKeys.includes(e.id));
    if (epicsInScope.length === 0) return null;
    const aggregateStories = epicsInScope.flatMap((epic) => epic.userStories ?? []);
    if (burnupBasis !== "epicEst" && aggregateStories.length === 0) return null;
    const periodStartDate = new Date(planYear, scopeStartMonth - 1, 1);
    const periodEndDate = new Date(planYear, scopeEndMonth, 0);
    // Same anchor rule as burndownHealth — verdict reads off each epic's
    // own planned window, not the scope period.
    // Same observed-start rule as burndownHealth — use the team's
    // actual start when it's earlier than the planned start.
    const epicBounds = (epic: EpicItem): { start: Date; end: Date } => {
      const epicYear = epic.planYear ?? planYear;
      const plannedStart = epic.planStartMonth != null
        ? sprintStartDate(epicYear, globalSprintFromMonthLane(epic.planStartMonth, epic.planSprint === 2 ? 2 : 1))
        : periodStartDate;
      const end = epic.planEndMonth != null
        ? sprintEndDate(epicYear, globalSprintFromMonthLane(epic.planEndMonth, epic.planEndSprint === 1 ? 1 : 2))
        : periodEndDate;
      const observed = computeEpicObservedStart(epic);
      const start = observed != null && observed < plannedStart ? observed : plannedStart;
      return { start, end };
    };
    const epicOriginalEstSum = epicsInScope.reduce(
      (sum, e) => sum + (e.originalEstimateDays ?? 0),
      0,
    );
    if (epicsInScope.length === 1) {
      const bounds = epicBounds(epicsInScope[0]);
      const h = computeProgress({
        stories: epicsInScope[0].userStories ?? [],
        start: bounds.start,
        end: bounds.end,
        basis: burnupBasis,
        epicOriginalEstimateDays: epicsInScope[0].originalEstimateDays ?? null,
      });
      const hasData = burnupBasis === "stories"
        ? aggregateStories.length > 0
        : h.totalEffort > 0;
      if (!hasData) return null;
      return { status: h.status, tooltip: formatHealthTooltip(h), result: h };
    }
    const childStatuses: HealthStatus[] = epicsInScope.map((epic) => {
      const bounds = epicBounds(epic);
      const h = computeProgress({
        stories: epic.userStories ?? [],
        start: bounds.start,
        end: bounds.end,
        basis: burnupBasis,
        epicOriginalEstimateDays: epic.originalEstimateDays ?? null,
      });
      return h.status;
    });
    const childBoundsList = epicsInScope.map(epicBounds);
    const aggStart = childBoundsList.reduce((min, b) => b.start < min ? b.start : min, childBoundsList[0].start);
    const aggEnd = childBoundsList.reduce((max, b) => b.end > max ? b.end : max, childBoundsList[0].end);
    const h = computeInitiativeProgress({
      stories: aggregateStories,
      childStatuses,
      start: aggStart,
      end: aggEnd,
      basis: burnupBasis,
      epicOriginalEstimateDays: epicOriginalEstSum > 0 ? epicOriginalEstSum : null,
    });
    const hasData = burnupBasis === "stories"
      ? aggregateStories.length > 0
      : h.totalEffort > 0;
    if (!hasData) return null;
    return { status: h.status, tooltip: formatHealthTooltip(h), result: h };
  }, [burnupBasis, selectedEpicOption, selectedInitiativeId, monthEpics, burnUpVisibleKeys, planYear, scopeStartMonth, scopeEndMonth]);

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

  /** Earliest start across the in-scope epics. The ideal line should not
   *  start ramping until the epic actually begins — before that, no work
   *  is expected so the ideal stays at 0 (burnup) / totalScope (burndown).
   *  Without this, the ideal line slope spans the entire insights period
   *  (e.g. Jan→Dec) instead of just the epic's window (e.g. July 1→31),
   *  making any partial pre-start progress look like a deficit and any
   *  in-window progress look like it's flatly above the ideal. */
  const burnUpStartDate = useMemo(() => {
    const epicsToCheck = selectedEpicOption != null
      ? [selectedEpicOption.epic]
      : monthEpics
          .map((r) => r.epic)
          .filter((e) => burnUpVisibleKeys.length === 0 || burnUpVisibleKeys.includes(e.id));
    if (epicsToCheck.length === 0) return null;
    // Earliest EFFECTIVE start across visible epics. Each epic's
    // effective start is min(observed, planned). Pre-start work pulls
    // the ramp anchor backwards so the ideal aligns with where the
    // blue actual line first moved.
    let earliestMs = Infinity;
    let earliestDate: Date | null = null;
    for (const epic of epicsToCheck) {
      const startMonth = epic.planStartMonth ?? scopeStartMonth;
      const startYear = epic.planYear ?? planYear;
      const startSprint = epic.planSprint;
      const startDay = startSprint === 2 ? 16 : 1;
      const plannedStart = new Date(startYear, startMonth - 1, startDay);
      const observed = computeEpicObservedStart(epic);
      const effective = observed != null && observed < plannedStart ? observed : plannedStart;
      if (effective.getTime() < earliestMs) {
        earliestMs = effective.getTime();
        earliestDate = effective;
      }
    }
    return earliestDate;
  }, [selectedEpicOption, monthEpics, burnUpVisibleKeys, scopeStartMonth, planYear]);

  const burnUpData = useMemo(() => {
    const epicsInScope = selectedEpicOption != null
      ? [selectedEpicOption.epic]
      : monthEpics.map((r) => r.epic).filter((e) => burnUpVisibleKeys.length === 0 || burnUpVisibleKeys.includes(e.id));
    const allStories = epicsInScope.flatMap((e) => (e.userStories ?? []).filter((s) => s.sprint != null));
    const isDays = burnUpMetric === "daysLeft";
    const useEpicEst = isDays && burnupBasis === "epicEst";

    const storyValue = (s: (typeof allStories)[number]) =>
      isDays ? Math.max(0, s.estimatedDays ?? s.daysLeft ?? 0) : 1;
    const storyDone = (status: string) => status === "review" || status === "done";

    // Per-epic baseline (story-day sum of open stories at start) so we can
    // scale openRemaining into epic-est units in `epicEst` basis. Without
    // this, the burnup uses totalScope = epicEst but openRemaining stays in
    // story-day units — the chart then underflows to zero.
    //
    // We also pre-compute per-epic snapshot coverage + current totals so the
    // per-day loop can fall back to a linear ramp for epics that have no
    // snapshot history (otherwise their lines render flat at 0 when "All"
    // is selected, because `latestSnapshotAtDayCached` returns null and the
    // calculation freezes every story at its current `todo`/`inProgress`
    // status across every historical day).
    const epicMeta = epicsInScope.map((e) => {
      const stories = (e.userStories ?? []).filter((s) => s.sprint != null);
      const hasSnap = stories.some((s) => (s.snapshots?.length ?? 0) > 0);
      const totalStoryValue = stories.reduce((sum, s) => sum + storyValue(s), 0);
      const currentOpen = stories.reduce((sum, s) => {
        if (storyDone(s.status)) return sum;
        if (isDays) return sum + Math.max(0, s.daysLeft ?? s.estimatedDays ?? 0);
        return sum + 1;
      }, 0);
      // For each story, resolve the timestamp of its FIRST known snapshot.
      // We treat that moment as when the story became "real" in the
      // reconstruction window — before that, the story is assumed to be
      // todo with its full estimate (since story.createdAt in demo /
      // bulk-seeded data is effectively `now()` and can't be trusted for
      // back-in-time scope). Stories with no snapshots at all default to
      // 0 (always present), preserving the pre-snapshot fallback path.
      const firstSnapMsByStory = new Map<string, number>(
        stories.map((s) => {
          const snaps = s.snapshots ?? [];
          let earliest = Number.POSITIVE_INFINITY;
          for (const sn of snaps) {
            const t = new Date(sn.snapshotDate).getTime();
            if (Number.isFinite(t) && t < earliest) earliest = t;
          }
          return [s.id, Number.isFinite(earliest) ? earliest : 0];
        }),
      );
      return {
        id: e.id,
        epicEst: e.originalEstimateDays ?? 0,
        stories,
        hasSnap,
        totalStoryValue,
        currentCompleted: Math.max(0, totalStoryValue - currentOpen),
        firstSnapMsByStory,
      };
    });

    // Total scope follows the basis (same rule as the burndown ideal):
    //   - epicEst → Σ originalEstimateDays across in-scope epics (falls
    //     back to the story-day sum when no epic has an estimate set)
    //   - days → Σ child story estimated days (today's behavior)
    //   - stories → total story count
    const storyDaySum = allStories.reduce((sum, s) => sum + storyValue(s), 0);
    const epicEstSum = epicsInScope.reduce((sum, e) => sum + (e.originalEstimateDays ?? 0), 0);
    const totalScope =
      useEpicEst && epicEstSum > 0
        ? epicEstSum
        : storyDaySum;
    if (totalScope === 0) return [] as Array<{ labelShort: string; isToday: boolean; completed: number | null; scope: number; ideal: number | null }>;

    const round = (n: number) => isDays ? Number(n.toFixed(1)) : Math.round(n);

    const periodStartDate = new Date(planYear, scopeStartMonth - 1, 1);
    const quarterEndDate = new Date(planYear, scopeEndMonth, 0);
    // Extend the chart's right edge past quarter-end when the visible
    // epic(s) have a due date beyond it. When the due falls inside the
    // quarter the chart stops at quarter-end as before — preserves
    // visual symmetry across cards. Only stretches when necessary.
    const periodEndDate = burnUpDueDate != null && burnUpDueDate.getTime() > quarterEndDate.getTime()
      ? burnUpDueDate
      : quarterEndDate;
    // Use Math.round (not Math.floor) for ms→day so a DST hour shift can't
    // truncate a day. With Math.floor, going from a no-DST date to a DST
    // date subtracts one hour, dropping the floor by 1 → today gets treated
    // as "past elapsed range" → every per-epic line goes null from day 2 on
    // and Recharts paints flat 0.
    const msToDays = (ms: number) => Math.round(ms / (24 * 60 * 60 * 1000));
    const totalDays = msToDays(periodEndDate.getTime() - periodStartDate.getTime()) + 1;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const afterPeriod = todayStart.getTime() > periodEndDate.getTime();
    const beforePeriod = todayStart.getTime() < periodStartDate.getTime();
    const elapsedDays = afterPeriod
      ? totalDays
      : beforePeriod
        ? 0
        : Math.max(1, Math.min(totalDays, msToDays(todayStart.getTime() - periodStartDate.getTime()) + 1));

    const dueDate = burnUpDueDate;
    const dueDayIndex = dueDate != null
      ? Math.max(1, msToDays(dueDate.getTime() - periodStartDate.getTime()) + 1)
      : totalDays;
    // The ideal ramp should start at the epic's own start, not at the
    // insights period start. burnUpStartDate is the earliest start
    // across in-scope epics; if it's after periodStart we clamp the
    // ideal to 0 before that day (no work expected pre-start).
    const startDate = burnUpStartDate;
    const startDayIndex = startDate != null
      ? Math.max(1, msToDays(startDate.getTime() - periodStartDate.getTime()) + 1)
      : 1;

    return Array.from({ length: totalDays }, (_, idx): { labelShort: string; isToday: boolean; completed: number | null; scope: number; ideal: number | null; [epicKey: string]: number | string | boolean | null } => {
      const dayIdx = idx + 1;
      const dayDate = new Date(periodStartDate);
      dayDate.setDate(dayDate.getDate() + idx);
      const dayStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate());
      const isToday = dayStart.getTime() === todayStart.getTime();

      let completed: number | null = null;
      // End-of-day (23:59:59.999 local) — used as both the firstSnap
      // cutoff AND the snapshot-bisection cutoff, matching the burndown's
      // `monthBurndownFromSnapshots` which queries snapshots with an
      // end-of-day Date. Without this, a snapshot stored at e.g.
      // `2026-05-28T00:00:00.000Z` (which is local 03:00 on 28/5 in
      // UTC+3) would be excluded as "tomorrow's snapshot" because local
      // midnight cuts off before it — that was the exact reason the
      // burnup wasn't dropping on 28/5 when the burndown spiked up.
      const dayEnd = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 23, 59, 59, 999);
      const dayEndMs = dayEnd.getTime();
      // Per-epic completed values — one entry per epic in scope so that the
      // legend's "All" toggle can render every epic's line. Each epic uses
      // snapshot reconstruction when it has snapshot history, and a linear
      // ramp (0 → currentCompleted across elapsedDays) when it doesn't.
      const perEpic: Record<string, number | null> = {};
      for (const m of epicMeta) perEpic[m.id] = null;
      // Per-day scope aggregate — a story enters scope the day its first
      // snapshot was recorded (the moment it became "real" in the chart's
      // historical view). Before that, it contributes nothing to either
      // scope or open work, so completed = scope − open is preserved AND
      // the scope line correctly steps up when stories were attached
      // mid-period. Stories with no snapshots at all are always in scope
      // (firstSnapMs = 0).
      let dayScopeAgg = 0;
      if (dayIdx <= elapsedDays) {
        // Burnup mirrors burndown: completed = scope − open work remaining.
        // We compute per-epic completed inside the same pass, then sum for
        // the aggregate `completed`.
        let openRemainingScaledAgg = 0;
        const rampRatio = elapsedDays <= 1 ? 1 : (dayIdx - 1) / Math.max(elapsedDays - 1, 1);
        const isFinalDay = dayIdx === elapsedDays;
        for (const m of epicMeta) {
          // Stories that have appeared in the snapshot record by this day.
          // No-snapshot stories (firstSnap = 0) are always present.
          const dayStories = m.stories.filter((s) => (m.firstSnapMsByStory.get(s.id) ?? 0) <= dayEndMs);
          const dayTotalStoryValue = dayStories.reduce((sum, s) => sum + storyValue(s), 0);
          let epicScope: number;
          let epicScaledOpen: number;
          if (m.hasSnap) {
            let epicOpenStoryDays = 0;
            let epicTotalStoryValue = 0;
            for (const story of dayStories) {
              epicTotalStoryValue += storyValue(story);
              const snap = latestSnapshotAtDayCached(story, dayEnd);
              // Before the story's first snapshot the only sane assumption
              // is that it was "open with full estimate" — the burndown's
              // line wouldn't drop on that day either. Falling back to
              // story.status (which is the CURRENT state) here was the
              // original bug: a now-review story leaked back to "review on
              // day 1" and the completed line ran above scope.
              const status = snap?.status ?? "todo";
              if (status !== "todo" && status !== "inProgress") continue;
              if (isDays) {
                const daysLeft = snap?.daysLeft ?? snap?.estimatedDays ?? story.estimatedDays ?? story.daysLeft ?? 1;
                epicOpenStoryDays += Math.max(0, daysLeft);
              } else {
                epicOpenStoryDays += 1;
              }
            }
            if (useEpicEst && m.epicEst > 0) {
              // epicEst basis: scope is the epic's own promise — but
              // only once the epic has any visible story-record. Before
              // that, scope is 0 (matching the burndown's empty state).
              epicScope = epicTotalStoryValue > 0 ? m.epicEst : 0;
              if (epicTotalStoryValue > 0) {
                const openRatio = Math.min(1, Math.max(0, epicOpenStoryDays / epicTotalStoryValue));
                epicScaledOpen = m.epicEst * openRatio;
              } else {
                epicScaledOpen = 0;
              }
            } else {
              epicScope = epicTotalStoryValue;
              epicScaledOpen = epicOpenStoryDays;
            }
          } else {
            // No snapshot history → linear ramp from 0 → currentCompleted
            // across the elapsed window.
            const mCompletedRamped = isFinalDay ? m.currentCompleted : m.currentCompleted * rampRatio;
            if (useEpicEst && m.epicEst > 0) {
              epicScope = m.epicEst;
              if (dayTotalStoryValue > 0) {
                epicScaledOpen = m.epicEst * (1 - mCompletedRamped / dayTotalStoryValue);
              } else {
                epicScaledOpen = m.epicEst;
              }
            } else {
              epicScope = dayTotalStoryValue;
              epicScaledOpen = Math.max(0, dayTotalStoryValue - mCompletedRamped);
            }
          }
          const epicCompleted = Math.max(0, epicScope - epicScaledOpen);
          perEpic[m.id] = round(epicCompleted);
          openRemainingScaledAgg += epicScaledOpen;
          dayScopeAgg += epicScope;
        }
        completed = round(Math.max(0, dayScopeAgg - openRemainingScaledAgg));
      } else {
        // Future day — scope falls back to "stories existing now" so the
        // post-today projection doesn't collapse.
        dayScopeAgg = totalScope;
      }

      const scopeForRow = round(dayScopeAgg);
      let ideal: number | null = null;
      // Draw the ideal ramp ONLY inside the epic's actual window so it
      // reads as a single clean linear segment. Days outside the window
      // get `null` — Recharts honors `connectNulls={false}` on the ideal
      // Line and simply doesn't paint those segments. This avoids the
      // L-shape ("flat at 0 for months, then ramp") that arises when
      // the chart's X axis is much longer than the epic's plan.
      if (totalScope > 0 && dayIdx >= startDayIndex && dayIdx <= dueDayIndex) {
        const span = Math.max(1, dueDayIndex - startDayIndex);
        const progressInWindow = dayIdx - startDayIndex;
        const raw = totalScope * (progressInWindow / span);
        ideal = round(Math.max(0, Math.min(totalScope, raw)));
      }

      return { labelShort: flowChartDayLabel(dayDate), isToday, completed, scope: scopeForRow, ideal, ...perEpic };
    });
  }, [selectedEpicOption, monthEpics, burnUpVisibleKeys, planYear, scopeStartMonth, scopeEndMonth, burnUpDueDate, burnUpMetric, burnupBasis]);

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
  const burnUpDataTruncated = useMemo(() => {
    if (burnUpDoneAtIdx < 0) return burnUpData;
    // After the chart reaches scope, null EVERY numeric field (completed,
    // scope, ideal, every per-epic key) so the scope / ideal / completed /
    // per-epic lines all stop drawing. The labelShort + isToday string
    // fields stay so the X-axis ticks + Today reference line still render.
    return burnUpData.map((row, i) => {
      if (i <= burnUpDoneAtIdx) return row;
      const blanked: Record<string, number | string | boolean | null> = {};
      for (const key of Object.keys(row)) {
        const v = (row as Record<string, unknown>)[key];
        blanked[key] = typeof v === "number" ? null : (v as string | boolean | null);
      }
      return blanked;
    });
  }, [burnUpData, burnUpDoneAtIdx]);
  const isBurnUpDone = burnUpDoneAtIdx >= 0;
  // (Previously: `burnUpCompletedStroke` resolved a single aggregate line
  //  color. Replaced by per-epic <Line> rendering on the chart, each one
  //  colored from LINE_PALETTE matching its legend row, so this memo is no
  //  longer needed.)

  const burnUpEpicRows = useMemo(() => {
    const epicsInScope = selectedEpicOption != null ? [selectedEpicOption.epic] : monthEpics.map((r) => r.epic);
    return epicsInScope.map((epic, idx) => {
      const stories = (epic.userStories ?? []).filter((s) => s.sprint != null);
      const completed = stories.filter((s) => s.status === "review" || s.status === "done").length;
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
      if (key !== "epicIdeal") {
        const item = burndownLegendItems.find((i) => i.key === key);
        if (item) {
          return (
            <span className="ml-1 inline-flex translate-y-[2px] items-center gap-1 text-[13px] font-normal text-slate-400">
              <span>(</span>
              <span className="text-slate-500">{item.label}</span>
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
              <span>)</span>
            </span>
          );
        }
      }
    }
    if (scopeTitleSuffix) return scopeTitleSuffix;
    return "";
  }, [scopeTitleSuffix, burndownVisibleKeys, burndownLegendItems, onOpenEpic]);

  /** Same shape as `burndownTitleSuffix`, against the Burnup legend.
   *  Single-epic legend pick WINS over the scope picker. */
  const burnUpTitleSuffix = useMemo<ReactNode>(() => {
    if (burnUpVisibleKeys.length === 1) {
      const row = burnUpEpicRows.find((r) => r.id === burnUpVisibleKeys[0]);
      if (row) {
        const rowId = row.id;
        return (
          <span className="ml-1 inline-flex translate-y-[2px] items-center gap-1 text-[13px] font-normal text-slate-400">
            <span>(</span>
            <span className="text-slate-500">{row.title}</span>
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
            <span>)</span>
          </span>
        );
      }
    }
    if (scopeTitleSuffix) return scopeTitleSuffix;
    return "";
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
  const workloadDrilldownScrollRef = useRef<HTMLDivElement | null>(null);
  const monthLoadDrilldownScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollWorkloadDrilldownUp, setCanScrollWorkloadDrilldownUp] = useState(false);
  const [canScrollWorkloadDrilldownDown, setCanScrollWorkloadDrilldownDown] = useState(false);
  const [canScrollMonthLoadDrilldownUp, setCanScrollMonthLoadDrilldownUp] = useState(false);
  const [canScrollMonthLoadDrilldownDown, setCanScrollMonthLoadDrilldownDown] = useState(false);
  const updateWorkloadDrilldownArrowState = () => {
    const node = workloadDrilldownScrollRef.current;
    if (!node) {
      setCanScrollWorkloadDrilldownUp(false);
      setCanScrollWorkloadDrilldownDown(false);
      return;
    }
    const epsilon = 2;
    setCanScrollWorkloadDrilldownUp(node.scrollTop > epsilon);
    setCanScrollWorkloadDrilldownDown(node.scrollTop + node.clientHeight < node.scrollHeight - epsilon);
  };
  const scrollWorkloadDrilldownBy = (delta: number) => {
    workloadDrilldownScrollRef.current?.scrollBy({ top: delta, behavior: "smooth" });
  };
  const updateMonthLoadDrilldownArrowState = () => {
    const node = monthLoadDrilldownScrollRef.current;
    if (!node) { setCanScrollMonthLoadDrilldownUp(false); setCanScrollMonthLoadDrilldownDown(false); return; }
    const epsilon = 2;
    setCanScrollMonthLoadDrilldownUp(node.scrollTop > epsilon);
    setCanScrollMonthLoadDrilldownDown(node.scrollTop + node.clientHeight < node.scrollHeight - epsilon);
  };
  const scrollMonthLoadDrilldownBy = (delta: number) => {
    monthLoadDrilldownScrollRef.current?.scrollBy({ top: delta, behavior: "smooth" });
  };
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
  useEffect(() => {
    if (!workloadDrilldownAssignee) {
      setCanScrollWorkloadDrilldownUp(false);
      setCanScrollWorkloadDrilldownDown(false);
      return;
    }
    updateWorkloadDrilldownArrowState();
  }, [workloadDrilldownAssignee, workloadDrilldownStories.length]);
  useEffect(() => {
    if (!monthLoadDrilldownAssignee) { setCanScrollMonthLoadDrilldownUp(false); setCanScrollMonthLoadDrilldownDown(false); return; }
    updateMonthLoadDrilldownArrowState();
  }, [monthLoadDrilldownAssignee, monthLoadDrilldownStories.length]);

  const legendRowClass =
    "flex items-center gap-1.5 rounded-lg bg-slate-50/80 px-1.5 py-1.5 text-[13px] font-medium text-slate-700";
  const sharedDrilldownScrollAreaClass =
    "h-full min-h-0 w-full min-w-0 overflow-y-auto overflow-x-hidden bg-white pr-5 [&::-webkit-scrollbar]:hidden";
  /** Matches backlog / users directory soft zebra (#f4f7fc / white) */
  const drilldownTableRowZebra =
    "border-t border-[#7cd3f7]/95 text-slate-700 odd:bg-[#f4f7fc] even:bg-white transition hover:bg-[#c5ebff]";
  const drilldownTableEmptyRowZebra =
    "border-t border-[#7cd3f7]/60 text-slate-400 odd:bg-[#f4f7fc]/55 even:bg-white";
  const drilldownTableClass = "w-full table-fixed border-collapse text-left text-[13px]";
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
  const drilldownColgroupEpic = (
    <colgroup>
      <col className="w-[4%]" />
      <col className="w-[11%]" />
      <col className="w-[36%]" />
      <col className="w-[14%]" />
      <col className="w-[16%]" />
      <col className="w-[9.5%]" />
      <col className="w-[9.5%]" />
    </colgroup>
  );
  const sharedDrilldownArrowClass =
    "absolute -right-[2px] inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800";

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
      className="mb-2 flex flex-col gap-3.5 rounded-xl p-4"
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
          <div className="relative min-w-[28rem] flex-1 max-w-[44rem]">
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
                className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-72 overflow-auto rounded-xl bg-white p-1.5 shadow-xl"
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-1 lg:h-full">
        <div className={cn("mb-2 flex shrink-0 items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
          <h3
            className={cn(
              "inline-flex items-center gap-1.5 font-semibold text-slate-800",
              isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
            )}
          >
            <PieChartIcon className="size-4 text-slate-600" />
            {statusPanelTitle}{scopeTitleSuffix}
          </h3>
        </div>
        {statusDrilldownFilter ? (() => {
          const uniqueSprints = statusChartShowsEpics ? [] : Array.from(new Set(statusDrilldownStoriesRaw.map((s) => storySprintDisplayLabel(s.sprint, scopeStartMonth)))).filter(Boolean).sort();
          const uniqueAssignees = statusChartShowsEpics ? [] : Array.from(new Set(statusDrilldownStoriesRaw.map((s) => s.assignee?.trim() || "Unassigned"))).filter(Boolean).sort();
          const uniqueStatuses = statusChartShowsEpics ? [] : Array.from(new Set(statusDrilldownStoriesRaw.map((s) => s.status))).sort();
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
                ref={statusDrilldownScrollRef}
                onScroll={updateStatusDrilldownArrowState}
                className={sharedDrilldownScrollAreaClass}
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
              <table className={drilldownTableClass}>
                {statusChartShowsEpics ? drilldownColgroupEpic : drilldownColgroup}
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
                          renderOption={(label) => (
                            <span className="inline-flex items-center gap-1.5 truncate">{label}</span>
                          )}
                          onChange={(v) => setStatusDrilldownEpicFilter((p) => ({ ...p, status: v }))}
                          ariaLabel="Filter epic progress by status"
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
                    ? statusDrilldownEpics.map((epic, idx) => {
                        const epicStatusLabel = epicStatusById.get(epic.id) ?? "To do";
                        // Map the epic-status label back to a story-status
                        // key so we can reuse StoryStatusPill's colored icon
                        // language. Epics introduce one extra "Unscheduled"
                        // bucket that has no story-side analogue — render
                        // a neutral Circle for it.
                        const epicStatusKey =
                          epicStatusLabel === "Done" ? "done"
                          : epicStatusLabel === "Review / Testing" ? "review"
                          : epicStatusLabel === "In progress" ? "inProgress"
                          : epicStatusLabel === "To do" ? "todo"
                          : null;
                        return (
                        <tr key={epic.id} className={drilldownTableRowZebra}>
                          <td className="min-w-0 px-2 py-0.5 text-right tabular-nums text-slate-500">{idx + 1}</td>
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
                          <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">
                            {(epic.userStories ?? []).reduce((a, s) => a + (s.estimatedDays ?? 0), 0) || "—"}
                          </td>
                          <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">
                            {(epic.userStories ?? []).reduce((a, s) => a + (s.daysLeft ?? 0), 0) || "—"}
                          </td>
                        </tr>
                        );
                      })
                    : statusDrilldownStories.map((story, idx) => (
                        <tr key={story.id} className={drilldownTableRowZebra}>
                          <td className="min-w-0 px-2 py-0.5 text-right tabular-nums text-slate-500">{idx + 1}</td>
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
                          {/* Match the workload + month-load drilldowns:
                           *  avatar + "First L." for the assignee, and the
                           *  colored StoryStatusPill for the status. */}
                          <td className="min-w-0 px-2 py-0.5">
                            <DrilldownAssigneeCell assignee={story.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                          </td>
                          <td className="min-w-0 px-2 py-0.5">
                            <StoryStatusPill status={story.status} />
                          </td>
                          <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.estimatedDays ?? "\u2014"}</td>
                          <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.daysLeft ?? "\u2014"}</td>
                        </tr>
                      ))}
                  {statusDrilldownEmptyRows > 0
                    ? Array.from({ length: statusDrilldownEmptyRows }).map((_, index) => (
                        <tr key={`status-empty-${index}`} className={drilldownTableEmptyRowZebra}>
                          <td colSpan={statusChartShowsEpics ? 7 : 8} className="px-3 py-0.5 text-[13px]">
                            {"\u00A0"}
                          </td>
                        </tr>
                      ))
                    : null}
                </tbody>
              </table>
              </div>
              <button
                type="button"
                onClick={() => scrollStatusDrilldownBy(-96)}
                className={cn(
                  sharedDrilldownArrowClass,
                  "top-0",
                  canScrollStatusDrilldownUp && "bg-slate-200/70 text-slate-800",
                )}
                aria-label="Scroll up status drilldown table"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => scrollStatusDrilldownBy(96)}
                className={cn(
                  sharedDrilldownArrowClass,
                  "bottom-0",
                  canScrollStatusDrilldownDown && "bg-slate-200/70 text-slate-800",
                )}
                aria-label="Scroll down status drilldown table"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
          </div>
          </InsightsDrilldownModal>
          );
        })() : null}
        <div
          className={cn(
            "grid flex-1 lg:grid-cols-[minmax(0,1fr)_12.5rem] lg:items-stretch",
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
              <div className="absolute inset-0 z-10">
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
              <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
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

      <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-2 lg:h-full">
        <div className={cn("mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
          <h3
            className={cn(
              "ml-[35px] inline-flex items-center gap-1.5 font-semibold text-slate-800",
              isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
            )}
          >
            <Activity className="size-4 text-slate-600" />
            Epic Scope Burndown{burndownTitleSuffix}
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
          <div className="flex flex-wrap items-center gap-2">
            {/* Per-chart basis toggle. Initialized from the popover's
             *  global basis at mount; flipping it doesn't affect other
             *  charts or the popover. Labels adapt to the currently-
             *  pinned scope so the wording matches the popover (Epic
             *  Days Est. with no Σ when an epic is pinned). */}
            <div className="min-w-[18rem]">
              <ToggleGroup
                label=""
                options={
                  selectedEpicOption != null
                    ? [
                        { value: "epicEst", label: "Epic Est (d)", icon: Folder },
                        { value: "days", label: "Σ | Child Est (d)", icon: StickyNote },
                        { value: "stories", label: "Stories Completed (%)", icon: CheckCircle2 },
                      ]
                    : [
                        { value: "epicEst", label: "Σ | Epic Est (d)", icon: Folder },
                        { value: "days", label: "Σ | Child Est (d)", icon: StickyNote },
                        { value: "stories", label: "Stories Completed (%)", icon: CheckCircle2 },
                      ]
                }
                value={burndownBasis}
                onChange={(v) => setBurndownBasis(v as "days" | "stories" | "epicEst")}
              />
            </div>
          </div>
        </div>
        <div
          className={cn(
            // Burndown chart + legend split. Legend column sized so epic
            // titles read most of the way through before truncating
            // (hover gives the full title via tooltip).
            "grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_24rem] md:items-stretch",
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
                      content={(props) => <BurndownTooltip {...props} metric={metric} />}
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
                    })() : monthBurndownEpics.map((epic, idx) =>
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
                    {burndownFocusedEpicOption ? (
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
                    {burndownFocusedEpicOption && selectedEpicDueMarker ? (
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
          <div className={`relative ${INSIGHTS_CONTENT_HEIGHT}`}>
            <div
              ref={burndownLegendScrollRef}
              onScroll={updateBurndownArrowState}
              className={INSIGHTS_SCROLL_MAIN}
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {(() => {
                // When the user has scoped Insights to a single initiative,
                // the "All" button reads as that initiative — its title +
                // Zap icon — and the child epics below sit under a tree
                // connector. Otherwise it's the generic "All" with Layers.
                const initiativeScope = selectedInitiativeId !== "all"
                  ? scopeInitiativeOptions.find((i) => i.id === selectedInitiativeId) ?? null
                  : null;
                return (
                  <button
                    type="button"
                    onClick={showAllBurndownKeys}
                    className={cn(
                      "mb-1 w-full rounded-md px-1 py-1 text-left font-medium transition",
                      isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
                      // When the legend is in "show all" state, the highlight
                      // belongs HERE (on the All / Initiative row) — not on
                      // every epic below. The epic rows render flat in that
                      // state so the user can clearly see which item drives
                      // the chart scope.
                      allBurndownKeysSelected
                        ? "bg-indigo-50 font-semibold text-slate-900 hover:bg-slate-200/70"
                        : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-800",
                    )}
                  >
                    <span className="inline-flex w-full items-center gap-1.5">
                      {initiativeScope ? (
                        <Zap className="size-3.5 shrink-0 text-blue-500" aria-hidden />
                      ) : (
                        <Layers className="size-3.5 shrink-0" aria-hidden />
                      )}
                      <span className="min-w-0 truncate">
                        {initiativeScope?.title ?? "All"}
                      </span>
                    </span>
                  </button>
                );
              })()}
              {/* Tree connector under the initiative row: when scoped to one,
               *  child epics sit beneath a vertical line + horizontal stub
               *  so the legend reads like a file tree. */}
              <div className={cn(selectedInitiativeId !== "all" && "relative ml-3 border-l border-slate-200 pl-1")}>
              {burndownLegendItems.map((item) => {
                const on = burndownVisibleKeys.includes(item.key);
                // "epicIdeal" is the synthetic ideal-line series, not a real
                // epic — skip the folder glyph for it. Every other legend row
                // is a real epic and gets the canonical Folder icon to read
                // as "this row = one epic".
                const isEpic = item.key !== "epicIdeal";
                // Suppress the indigo highlight when the chart is in
                // "show all" mode — the All-row carries the highlight then.
                // Per-epic highlight only kicks in when the user has narrowed
                // to a specific subset.
                const showHighlight = on && !allBurndownKeysSelected;
                return (
                  <EpicLegendRowButton
                    key={item.key}
                    label={item.label}
                    color={item.color}
                    on={showHighlight}
                    isEpic={isEpic}
                    onClick={() => toggleBurndownKey(item.key)}
                    treeRow={selectedInitiativeId !== "all" && isEpic}
                    textClass={cn(
                      isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
                      on
                        ? "text-slate-900 hover:bg-slate-200/70"
                        : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-700",
                    )}
                  />
                );
              })}
              </div>
              {burndownFocusedEpicOption ? (
                <p className="mt-1 pl-0 text-[12px] text-slate-500">
                  Due: {selectedEpicDueDate ? selectedEpicDueDate.toLocaleDateString() : "N/A"}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => scrollBurndownLegendBy(-96)}
              className={cn(
                "absolute right-0 top-0 inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                canScrollBurndownUp && "bg-slate-200/70 text-slate-800",
              )}
              aria-label="Scroll up burndown legend"
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => scrollBurndownLegendBy(96)}
              className={cn(
                "absolute bottom-0 right-0 inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                canScrollBurndownDown && "bg-slate-200/70 text-slate-800",
              )}
              aria-label="Scroll down burndown legend"
            >
              <ChevronDown className="size-3.5" />
            </button>
          </div>
        </div>
      </article>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
      <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-1">
        <div className={cn("flex shrink-0 items-center justify-between gap-2", INSIGHTS_HEADER_ROW, isMultiPeriodInsights ? "mb-3" : "mb-2")}>
          <h3
            className={cn(
              "inline-flex items-center gap-1.5 font-semibold text-slate-800",
              isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
            )}
          >
            <ChartNoAxesCombined className="size-4 text-slate-600" />
            Workload Balance{scopeTitleSuffix}
          </h3>
        </div>
        {workloadDrilldownAssignee ? (() => {
          // Unique values for the per-column dropdowns. Computed from the
          // RAW (unfiltered) rows so removing a filter restores all options.
          const uniqueSprints = Array.from(new Set(workloadDrilldownStoriesRaw.map((s) => storySprintDisplayLabel(s.sprint, scopeStartMonth)))).filter(Boolean).sort();
          const uniqueAssignees = Array.from(new Set(workloadDrilldownStoriesRaw.map((s) => s.assignee?.trim() || "Unassigned"))).filter(Boolean).sort();
          const uniqueStatuses = Array.from(new Set(workloadDrilldownStoriesRaw.map((s) => s.status))).sort();
          return (
          <InsightsDrilldownModal
            title={`Workload Balance · ${workloadDrilldownAssignee}`}
            icon={<ChartNoAxesCombined className="size-4 text-slate-600" aria-hidden />}
            subtitle={(() => {
              const count = workloadDrilldownStories.length;
              const countLabel = `${count} user stor${count === 1 ? "y" : "ies"} presented`;
              return scopeTitleSuffix ? `${scopeTitleSuffix} · ${countLabel}` : countLabel;
            })()}
            onClose={() => { setWorkloadDrilldownAssignee(null); setWorkloadDrilldownIsTeam(false); }}
          >
          <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
            <div className="relative flex-1 min-h-0 min-w-0">
            <div
              ref={workloadDrilldownScrollRef}
              onScroll={updateWorkloadDrilldownArrowState}
              className={sharedDrilldownScrollAreaClass}
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <table className={drilldownTableClass}>
                {drilldownColgroupWithTeam}
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
                        renderOption={(v) => <span className="truncate">{v}</span>}
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
                  {workloadDrilldownStories.map((story, idx) => {
                    const storyTeamId = epicTeamByStoryId.get(story.id) ?? "";
                    const storyTeamLabel = monthTeamLabelForId(storyTeamId) ?? (storyTeamId || "—");
                    return (
                    <tr key={story.id} className={drilldownTableRowZebra}>
                      <td className="min-w-0 px-2 py-0.5 text-right tabular-nums text-slate-500">{idx + 1}</td>
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
                        <InsightsTruncatedHoverLabel text={storyTeamLabel} />
                      </td>
                      <td className="min-w-0 px-2 py-0.5">
                        <DrilldownAssigneeCell assignee={story.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                      </td>
                      <td className="min-w-0 px-2 py-0.5">
                        <StoryStatusPill status={story.status} />
                      </td>
                      <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.estimatedDays ?? "\u2014"}</td>
                      <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.daysLeft ?? "\u2014"}</td>
                    </tr>
                    );
                  })}
                  {workloadDrilldownEmptyRows > 0
                    ? Array.from({ length: workloadDrilldownEmptyRows }).map((_, index) => (
                        <tr key={`workload-empty-${index}`} className={drilldownTableEmptyRowZebra}>
                          <td colSpan={9} className="px-3 py-0.5 text-[13px]">
                            {"\u00A0"}
                          </td>
                        </tr>
                      ))
                    : null}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => scrollWorkloadDrilldownBy(-96)}
              className={cn(
                sharedDrilldownArrowClass,
                "top-0",
                canScrollWorkloadDrilldownUp && "bg-slate-200/70 text-slate-800",
              )}
              aria-label="Scroll up workload stories table"
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => scrollWorkloadDrilldownBy(96)}
              className={cn(
                sharedDrilldownArrowClass,
                "bottom-0",
                canScrollWorkloadDrilldownDown && "bg-slate-200/70 text-slate-800",
              )}
              aria-label="Scroll down workload stories table"
            >
              <ChevronDown className="size-3.5" />
            </button>
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

      <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-2 lg:h-full">
        <div className={cn("mb-2 flex shrink-0 items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
          <h3
            className={cn(
              "ml-[35px] inline-flex items-center gap-1.5 font-semibold text-slate-800",
              isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
            )}
          >
            <Activity className="size-4 text-slate-600" />
            Cumulative Flow{scopeTitleSuffix}
          </h3>
          {/* Diagnostic Copy button — captures the CFD's source story
           *  state + a representative day-sample so the empty/mismatched
           *  chart can be reproduced. Click → JSON to clipboard. */}
          <button
            type="button"
            onClick={async () => {
              const sourceStories = selectedEpicOption != null
                ? (selectedEpicOption.epic.userStories ?? [])
                : monthEpics.flatMap((row) => row.epic.userStories ?? []);
              const scheduled = sourceStories.filter((s) => s.sprint != null);
              const lastResolved = cfdDataResolved.findIndex((r) => (r as Record<string, unknown>).todo === null);
              const lastIdx = lastResolved === -1 ? cfdDataResolved.length - 1 : lastResolved - 1;
              const dump = {
                capturedAt: new Date().toISOString(),
                surface: "Cumulative Flow",
                scope: {
                  selectedEpicId,
                  selectedInitiativeId,
                  epicTitle: selectedEpicOption?.epic.title ?? null,
                },
                stories: {
                  sourceCount: sourceStories.length,
                  scheduledCount: scheduled.length,
                  withSnapshotsCount: sourceStories.filter((s) => (s.snapshots?.length ?? 0) > 0).length,
                  currentStatusBreakdown: scheduled.reduce<Record<string, number>>((acc, s) => {
                    acc[s.status] = (acc[s.status] ?? 0) + 1;
                    return acc;
                  }, {}),
                  sample: scheduled.slice(0, 5).map((s) => {
                    // Reproduce the CFD's actual lookup for "today" so we
                    // can see what status the bisection IS returning vs
                    // what story.status currently is.
                    const now = new Date();
                    const todayCutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
                    const snapToday = latestSnapshotAtDayCached(s, todayCutoff);
                    return {
                      id: s.id,
                      title: s.title,
                      sprint: s.sprint,
                      status: s.status,
                      snapshotCount: s.snapshots?.length ?? 0,
                      firstSnap: s.snapshots?.[0]?.snapshotDate ?? null,
                      lastSnap: s.snapshots?.[s.snapshots.length - 1]?.snapshotDate ?? null,
                      todayCutoffISO: todayCutoff.toISOString(),
                      snapResolvedAtToday: snapToday
                        ? { snapshotDate: snapToday.snapshotDate, status: snapToday.status, daysLeft: snapToday.daysLeft }
                        : null,
                    };
                  }),
                },
                chart: {
                  cfdMetric,
                  flowFromSnapshotsUsed: flowFromSnapshots != null,
                  dataPointCount: cfdDataResolved.length,
                  firstRow: cfdDataResolved[0] ?? null,
                  lastResolvedRow: lastIdx >= 0 ? cfdDataResolved[lastIdx] : null,
                  visibleKeys: cfdVisibleKeys,
                },
                context: {
                  planYear, scopeStartMonth, scopeEndMonth, progressBasis,
                  filterEpicTeamIds: filterEpicTeamIds ?? null,
                  forceUserMode: forceUserMode ?? false,
                  monthEpicsCount: monthEpics.length,
                },
                url: typeof window !== "undefined" ? window.location.href : null,
              };
              try {
                await navigator.clipboard.writeText(JSON.stringify(dump, null, 2));
                alert("CFD diagnostics copied to clipboard.");
              } catch {
                alert("Copy failed — open devtools to see the dump.");
                console.log(dump);
              }
            }}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
            title="Copy CFD diagnostic state"
          >
            Copy ⚙
          </button>
        </div>
        <div
          className={cn(
            "grid md:grid-cols-[minmax(0,1fr)_10rem] md:items-stretch",
            INSIGHTS_CHART_GRID_GAP,
            INSIGHTS_CHART_BAND,
          )}
        >
          <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
            {cfdDataResolved.length > 0 ? (
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cfdDataResolved} margin={{ top: 2, right: 12, left: 18, bottom: 0 }}>
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
                      />
                      ) : null,
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-slate-500">No month days to chart.</div>
            )}
          </div>
          <div className={INSIGHTS_SCROLL_SIDE}>
            <button
              type="button"
              onClick={showAllCfdKeys}
              className={cn(
                "mb-1 w-full rounded-md px-1 py-1 text-left font-medium transition",
                isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
                allCfdKeysSelected
                  ? "text-slate-900 hover:bg-slate-200/70"
                  : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-800",
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <Layers className="size-3.5" aria-hidden />
                All
              </span>
            </button>
            {[...CFD_FLOW_SEGMENTS].reverse().map(({ key, label, color }) => {
              const on = cfdVisibleKeys.includes(key);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleCfdKey(key)}
                  className={cn(
                    "mb-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left transition",
                    isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
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
          </div>
        </div>
      </article>
      </div>

      {/* Row 3: Month Load (left) + Burn Up chart (right).
       *  Render whenever there's burnup data OR a scope (epic/initiative) is
       *  pinned — pinned scope must always show both charts even if the epic
       *  has no scheduled stories to chart. */}
      {(burnUpData.length > 0 || selectedEpicOption != null || selectedInitiativeId !== "all") && (
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
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
            const loadRows = teamMode
              ? teamsInScope.map((t) => ({
                  key: t.teamLabel,
                  label: t.teamLabel,
                  initials: t.teamLabel.slice(0, 2).toUpperCase(),
                  image: null as string | null,
                  teamSlug: t.teamId ?? null,
                  daysLeft: t.daysLeftTotal,
                  estTotal: t.estimatedTotal,
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
                  daysLeft: row.daysLeftTotal,
                  estTotal: row.estimatedTotal,
                  onRowClick: () => {
                    setMonthLoadDrilldownIsTeam(false);
                    setMonthLoadDrilldownAssignee(row.assignee);
                    setMonthLoadDrilldownFilter({ ...EMPTY_DRILLDOWN_FILTER, assignee: row.assignee });
                  },
                }));
            if (loadRows.length === 0 && !monthLoadDrilldownAssignee) return <div className="hidden lg:block lg:col-span-1" />;
            return (
              <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-1">
                <div className={cn("mb-2 flex shrink-0 items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
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
                    {scopeTitleSuffix}
                  </h3>
                </div>
                {monthLoadDrilldownAssignee ? (() => {
                  const uniqueSprints = Array.from(new Set(monthLoadDrilldownStoriesRaw.map((s) => storySprintDisplayLabel(s.sprint, scopeStartMonth)))).filter(Boolean).sort();
                  const uniqueAssignees = Array.from(new Set(monthLoadDrilldownStoriesRaw.map((s) => s.assignee?.trim() || "Unassigned"))).filter(Boolean).sort();
                  const uniqueStatuses = Array.from(new Set(monthLoadDrilldownStoriesRaw.map((s) => s.status))).sort();
                  return (
                  <InsightsDrilldownModal
                    title={`${teamMode ? "Team Progress" : "User Progress"} · ${monthLoadDrilldownAssignee}`}
                    icon={<Users className="size-4 text-slate-600" aria-hidden />}
                    subtitle={(() => {
                      const count = monthLoadDrilldownStories.length;
                      const countLabel = `${count} user stor${count === 1 ? "y" : "ies"} presented`;
                      return scopeTitleSuffix ? `${scopeTitleSuffix} · ${countLabel}` : countLabel;
                    })()}
                    onClose={() => { setMonthLoadDrilldownAssignee(null); setMonthLoadDrilldownIsTeam(false); }}
                  >
                  <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
                    <div className="relative flex-1 min-h-0 min-w-0">
                      <div
                        ref={monthLoadDrilldownScrollRef}
                        onScroll={updateMonthLoadDrilldownArrowState}
                        className={sharedDrilldownScrollAreaClass}
                        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                      >
                        <table className={drilldownTableClass}>
                          {drilldownColgroupWithTeam}
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
                                  renderOption={(v) => <span className="truncate">{v}</span>}
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
                            {monthLoadDrilldownStories.map((story, idx) => {
                              const storyTeamId = epicTeamByStoryId.get(story.id) ?? "";
                              const storyTeamLabel = monthTeamLabelForId(storyTeamId) ?? (storyTeamId || "—");
                              return (
                              <tr key={story.id} className={drilldownTableRowZebra}>
                                <td className="min-w-0 px-2 py-0.5 text-right tabular-nums text-slate-500">{idx + 1}</td>
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
                                  <StoryStatusPill status={story.status} />
                                </td>
                                <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.estimatedDays ?? "—"}</td>
                                <td className="min-w-0 px-2 py-0.5 text-right tabular-nums">{story.daysLeft ?? "—"}</td>
                              </tr>
                              );
                            })}
                            {monthLoadDrilldownEmptyRows > 0 && Array.from({ length: monthLoadDrilldownEmptyRows }).map((_, i) => (
                              <tr key={`ml-empty-${i}`} className={drilldownTableEmptyRowZebra}>
                                <td colSpan={9} className="px-3 py-0.5 text-[13px]">{" "}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button type="button" onClick={() => scrollMonthLoadDrilldownBy(-96)} className={cn(sharedDrilldownArrowClass, "top-0", canScrollMonthLoadDrilldownUp && "bg-slate-200/70 text-slate-800")} aria-label="Scroll up"><ChevronUp className="size-3.5" /></button>
                      <button type="button" onClick={() => scrollMonthLoadDrilldownBy(96)} className={cn(sharedDrilldownArrowClass, "bottom-0", canScrollMonthLoadDrilldownDown && "bg-slate-200/70 text-slate-800")} aria-label="Scroll down"><ChevronDown className="size-3.5" /></button>
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
                  {loadRows.map((row) => {
                    const doneDays = Math.max(0, row.estTotal - row.daysLeft);
                    const donePct = row.estTotal > 0 ? Math.round((doneDays / row.estTotal) * 100) : 100;
                    const allDone = row.daysLeft === 0 && row.estTotal > 0;
                    // Team-level health from the per-epic rollup. Only set
                    // for teams (rows generated from analytics.workloadByTeam).
                    // User-mode rows don't get a health pill since the
                    // computation is per-EPIC, not per-assignee.
                    const teamHealth = row.teamSlug ? teamHealthByTeamKey.get(row.teamSlug) : undefined;
                    // Visual hint for the avatar ring and bar color falls
                    // back to the old "all review" / default tone when no
                    // team health is available (user rows).
                    const atRisk = teamHealth ? (teamHealth.status === "atRisk" || teamHealth.status === "overdue") : false;
                    const watch = teamHealth?.status === "watch";
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
                            // Tone object drives the bar fill, the clock-
                            // chip color, and the circle stroke so a row's
                            // health verdict reads consistently across the
                            // three visuals. Matches the hero Team
                            // Progress card.
                            const tone = atRisk
                              ? { bar: "bg-amber-400", chip: "bg-amber-50 text-amber-700 ring-amber-200/70", pct: "text-amber-700", stroke: "#f59e0b" }
                              : allDone
                                ? { bar: "bg-emerald-400", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200/70", pct: "text-emerald-700", stroke: "#10b981" }
                                : watch
                                  ? { bar: "bg-amber-300", chip: "bg-amber-50 text-amber-700 ring-amber-200/70", pct: "text-amber-700", stroke: "#f59e0b" }
                                  : { bar: "bg-indigo-400", chip: "bg-indigo-50 text-indigo-700 ring-indigo-200/70", pct: "text-indigo-600", stroke: "#6366f1" };
                            return (
                              <>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="truncate text-[12.5px] font-semibold text-slate-800">{row.label}</span>
                                    <span className={cn("shrink-0 text-[10.5px] font-semibold tabular-nums", tone.pct)}>{donePct}%</span>
                                    {teamHealth ? (
                                      <span className="ml-1 inline-flex shrink-0 items-center">
                                        <TeamHealthBadgeWithList
                                          status={teamHealth.status}
                                          atRiskEpics={teamHealth.atRiskEpics}
                                          watchEpics={teamHealth.watchEpics}
                                          overdueEpics={teamHealth.overdueEpics}
                                          teamLabel={row.label}
                                          onOpenEpic={onOpenEpic}
                                        />
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-1 relative h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/50">
                                    <div
                                      className={cn("absolute inset-y-0 left-0 rounded-full transition-all", tone.bar)}
                                      style={{ width: `${donePct}%` }}
                                    />
                                  </div>
                                </div>
                                {/* Calendar chip — total estimate, neutral
                                 *  slate; matches the hero card. */}
                                <span
                                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600 ring-1 ring-slate-200/70"
                                  title={`${row.estTotal}d estimated total · ${doneDays}d in review`}
                                >
                                  <Calendar className="size-2.5" strokeWidth={2.2} aria-hidden />
                                  {row.estTotal}d
                                </span>
                                {/* Clock chip — days left, tinted by tone. */}
                                <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1", tone.chip)}>
                                  <Clock className="size-2.5" strokeWidth={2.2} aria-hidden />
                                  {row.daysLeft}d left
                                </span>
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
          <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-2 lg:h-full">
            <div className={cn("mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
              <h3
                className={cn(
                  "ml-[35px] inline-flex items-center gap-1.5 font-semibold text-slate-800",
                  isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
                )}
              >
                <TrendingUp className="size-4 text-slate-600" />
                Epic Scope Burnup{burnUpTitleSuffix}
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
              <div className="flex flex-wrap items-center gap-2">
                {/* Per-chart basis toggle — same shape as the burndown
                 *  card. Initialized from the popover's global basis at
                 *  mount; independent thereafter. */}
                <div className="min-w-[18rem]">
                  <ToggleGroup
                    label=""
                    options={
                      selectedEpicOption != null
                        ? [
                            { value: "epicEst", label: "Epic Est (d)", icon: Folder },
                            { value: "days", label: "Σ | Child Est (d)", icon: StickyNote },
                            { value: "stories", label: "Stories Completed (%)", icon: CheckCircle2 },
                          ]
                        : [
                            { value: "epicEst", label: "Σ | Epic Est (d)", icon: Folder },
                            { value: "days", label: "Σ | Child Est (d)", icon: StickyNote },
                            { value: "stories", label: "Stories Completed (%)", icon: CheckCircle2 },
                          ]
                    }
                    value={burnupBasis}
                    onChange={(v) => setBurnupBasis(v as "days" | "stories" | "epicEst")}
                  />
                </div>
              </div>
            </div>
            <div
              className={cn(
                // Burnup chart + legend split — matches the burndown column
                // so the two charts stay symmetric. 13rem is tight enough to
                // pull the legend close to the chart; truncated titles get
                // their full text via the hover tooltip.
                "grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_24rem] md:items-stretch",
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
                    <LineChart data={burnUpDataTruncated} margin={{ top: 38, right: 24, left: 18, bottom: 0 }}>
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
                       *  only shown when narrowed below "All" since each epic
                       *  carries its own due date, so a single shared scope/
                       *  ideal is meaningless in the All view (mirrors the
                       *  burndown chart's All-view behavior). */}
                      {burnUpSingleEpicVisible ? (
                        <>
                          <Line type="monotone" dataKey="scope" name="Total scope" stroke="#94a3b8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                          <Line type="monotone" dataKey="ideal" name={burnUpDueDateLabel ? `Ideal (due ${burnUpDueDateLabel})` : "Ideal"} stroke="#f97316" strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls={false} isAnimationActive={false} />
                          <Line type="monotone" dataKey="completed" name="Completed" stroke="#0ea5e9" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
                        </>
                      ) : null}
                      {/* Per-epic completed lines — one per visible epic,
                       *  colored with the same palette as the legend marker.
                       *  Always rendered when in scope (in All view they
                       *  carry the chart on their own, since the Y-axis
                       *  auto-scales to their max without the scope line
                       *  forcing it). */}
                      {burnUpEpicRows.map((row, rowIdx) =>
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
                      )}
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
                      {/* Due target marker — same red BurndownTargetIcon
                       *  the burndown chart uses, anchored at the burnup's
                       *  due-date label so the two charts read symmetric.
                       *  Sits at the scope total (top of the burnup line);
                       *  the Done ✓ above stacks neatly on top. */}
                      {burnUpSingleEpicVisible && burnUpDueDateTickLabel ? (
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

              {/* Right-side legend — identical structure to burndown legend */}
              <div className={`relative ${INSIGHTS_CONTENT_HEIGHT}`}>
                <div
                  ref={burnUpLegendScrollRef}
                  onScroll={updateBurnUpLegendArrowState}
                  className={INSIGHTS_SCROLL_MAIN}
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {(() => {
                    // Same "All" / initiative-scoped header pattern as the
                    // burndown legend (see comment there).
                    const initiativeScope = selectedInitiativeId !== "all"
                      ? scopeInitiativeOptions.find((i) => i.id === selectedInitiativeId) ?? null
                      : null;
                    return (
                      <button
                        type="button"
                        onClick={showAllBurnUpKeys}
                        className={cn(
                          "mb-1 w-full rounded-md px-1 py-1 text-left font-medium transition hover:bg-slate-200/70",
                          isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
                          // Highlight the All/Initiative row (not the epic
                          // rows below) when all keys are visible — matches
                          // the burndown legend behavior.
                          allBurnUpKeysSelected
                            ? "bg-indigo-50 font-semibold text-slate-900"
                            : "text-slate-400",
                        )}
                      >
                        <span className="inline-flex w-full items-center gap-1.5">
                          {initiativeScope ? (
                            <Zap className="size-3.5 shrink-0 text-blue-500" aria-hidden />
                          ) : (
                            <Layers className="size-3.5 shrink-0" aria-hidden />
                          )}
                          <span className="min-w-0 truncate">
                            {initiativeScope?.title ?? "All"}
                          </span>
                        </span>
                      </button>
                    );
                  })()}
                  {/* Epic rows — wrapped in a tree-connector container when
                   *  scoped to a single initiative. */}
                  <div className={cn(selectedInitiativeId !== "all" && "relative ml-3 border-l border-slate-200 pl-1")}>
                  {burnUpEpicRows.map((row) => {
                    const on = burnUpVisibleKeys.includes(row.id);
                    // Suppress the indigo highlight when all are visible —
                    // the All-row carries the highlight in that state.
                    const showHighlight = on && !allBurnUpKeysSelected;
                    return (
                      <EpicLegendRowButton
                        key={row.id}
                        label={row.title}
                        // Always pass the row's natural color — don't fade the
                        // glyph to slate-300 when off (matches burndown).
                        color={row.color}
                        on={showHighlight}
                        isEpic
                        onClick={() => toggleBurnUpKey(row.id)}
                        treeRow={selectedInitiativeId !== "all"}
                        textClass={cn(
                          "hover:bg-slate-200/70",
                          isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
                          on ? "text-slate-900" : "text-slate-500",
                        )}
                      />
                    );
                  })}
                  </div>
                  {/* Mirror the burndown's "Due:" footer — shown when the
                   *  burnup is focused on a single epic (scope picker or
                   *  legend narrowed to one). */}
                  {burnUpSingleEpicVisible && burnUpDueDate ? (
                    <p className="mt-1 pl-0 text-[12px] text-slate-500">
                      Due: {burnUpDueDate.toLocaleDateString()}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => scrollBurnUpLegendBy(-96)}
                  className={cn(
                    "absolute right-0 top-0 inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                    canScrollBurnUpUp && "bg-slate-200/70 text-slate-800",
                  )}
                  aria-label="Scroll up burn up legend"
                >
                  <ChevronUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollBurnUpLegendBy(96)}
                  className={cn(
                    "absolute bottom-0 right-0 inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                    canScrollBurnUpDown && "bg-slate-200/70 text-slate-800",
                  )}
                  aria-label="Scroll down burn up legend"
                >
                  <ChevronDown className="size-3.5" />
                </button>
              </div>
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
        <div className={cn(card, "lg:col-span-1 lg:h-full")}>
          <div className={cn("mb-2 h-5 w-32 rounded", shimmer)} />
          <div className={cn(pieBand, "flex items-center justify-center")}>
            <div className={cn("size-36 rounded-full", shimmer)} />
          </div>
        </div>
        <div className={cn(card, "lg:col-span-2 lg:h-full")}>
          <div className={cn("mb-2 h-5 w-44 rounded", shimmer)} />
          <div className={cn(band, "rounded-md", shimmer)} />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <div className={cn(card, "lg:col-span-1")}>
          <div className={cn("mb-2 h-5 w-36 rounded", shimmer)} />
          <div className={cn(band, "rounded-md", shimmer)} />
        </div>
        <div className={cn(card, "lg:col-span-2")}>
          <div className={cn("mb-2 h-5 w-40 rounded", shimmer)} />
          <div className={cn(band, "rounded-md", shimmer)} />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <div className={cn(card, "lg:col-span-1")}>
          <div className={cn("mb-2 h-5 w-32 rounded", shimmer)} />
          <div className={cn(band, "rounded-md", shimmer)} />
        </div>
        <div className={cn(card, "lg:col-span-2")}>
          <div className={cn("mb-2 h-5 w-36 rounded", shimmer)} />
          <div className={cn(band, "rounded-md", shimmer)} />
        </div>
      </div>
    </section>
  );
}
