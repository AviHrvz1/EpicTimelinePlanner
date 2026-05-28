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
  AlertTriangle,
  ArrowLeft,
  CheckCheck,
  CheckCircle2,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronUp,
  Circle,
  Eraser,
  Folder,
  Layers,
  ExternalLink,
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
import { MONTH_TEAM_COLUMNS } from "@/lib/month-team-board";
import { clampYearSprint, globalSprintFromMonthLane, monthLaneFromGlobalSprint, sprintStartDate, sprintEndDate } from "@/lib/year-sprint";
import { computeProgress, computeInitiativeProgress, type HealthStatus, type ProgressBasis, type ProgressResult } from "@/lib/progress";
import { ToggleGroup } from "@/components/timeline/basis-toggle-group";
import { HealthBadge, HealthBadgeWithDetail, formatHealthTooltip } from "@/components/timeline/health-badge";
import { UserAvatar, resolveAssigneeAvatar } from "@/components/ui/user-avatar";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { useTeamImages } from "@/lib/use-team-images";

type BurndownMetric = "daysLeft" | "storyCount";
type WorkloadStatusKey = "todo" | "inProgress" | "done" | "approved";
type WorkloadFilterKey = "all" | WorkloadStatusKey | "unassigned";

const STATUS_COLORS: Record<string, string> = {
  Unscheduled: "#94a3b8",
  "To do": "#f59e0b",
  "In progress": "#3b82f6",
  Done: "#10b981",
  Approved: "#8b5cf6",
};

// Labels MUST match the bar dataKey strings used in the chart data (see workload barData below).
// Order also defines the on-screen left-to-right bar order: To do → In progress → Done → Approved.
const WORKLOAD_BAR_SEGMENTS = [
  { key: "todo" as const, label: "To do", color: STATUS_COLORS["To do"] },
  { key: "inProgress" as const, label: "In progress", color: STATUS_COLORS["In progress"] },
  { key: "done" as const, label: "Done", color: STATUS_COLORS["Done"] },
  { key: "approved" as const, label: "Approved", color: STATUS_COLORS["Approved"] },
] as const;

const CFD_FLOW_SEGMENTS = [
  { key: "approved" as const, label: "Approved", color: STATUS_COLORS["Approved"] },
  { key: "done" as const, label: "Done", color: STATUS_COLORS["Done"] },
  { key: "inProgress" as const, label: "In progress", color: STATUS_COLORS["In progress"] },
  { key: "todo" as const, label: "To do", color: STATUS_COLORS["To do"] },
] as const;

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
  // Bumped tick row + icon so uploaded photos read as proper avatars (was 16px,
  // visually too small next to the text label). 22px matches the scope-panel
  // user chip's avatar so the bar-chart axis reads as a row of "people".
  const iconSize = 22;
  const rowY = y + iconSize / 2 + 3;
  const estTextWidth = Math.min(label.length * 5.5, 70);
  const totalWidth = iconSize + 4 + estTextWidth;
  const iconX = x - totalWidth / 2;
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

function isStoryOpen(status: UserStoryItem["status"] | null | undefined) {
  return status === "todo" || status === "inProgress";
}

function basisDisplayLabel(basis: ProgressBasis, scope: "epic" | "initiative"): string {
  if (basis === "stories") return "% Stories Completed";
  if (basis === "days") return "Σ Story Days Est.";
  return scope === "epic" ? "Epic Days Est." : "Σ Epic Days Est.";
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
  if (status === "Done") return CheckCheck;
  if (status === "Approved") return CheckCircle2;
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
      case "approved":
        return { label: "Approved", Icon: CheckCircle2, color: "text-violet-600" };
      case "done":
        return { label: "Done", Icon: CheckCheck, color: "text-emerald-600" };
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

function deriveEpicStatus(epic: EpicItem): "Unscheduled" | "To do" | "In progress" | "Done" | "Approved" {
  const scheduledStories = (epic.userStories ?? []).filter((story) => story.sprint != null);
  if (scheduledStories.length === 0) return "Unscheduled";
  const allApproved = scheduledStories.every((story) => story.status === "approved");
  if (allApproved) return "Approved";
  const allDoneOrApproved = scheduledStories.every(
    (story) => story.status === "done" || story.status === "approved",
  );
  if (allDoneOrApproved) return "Done";
  const hasInProgress = scheduledStories.some((story) => story.status === "inProgress");
  if (hasInProgress) return "In progress";
  return "To do";
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
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled") continue;
    if (filterInitiativeId && initiative.id !== filterInitiativeId) continue;
    for (const epic of initiative.epics ?? []) {
      if (filterEpicTeamIds?.length && !filterEpicTeamIds.includes(epic.team ?? "")) continue;
      const startMonth = epic.planStartMonth ?? initiative.startMonth;
      const endMonth = epic.planEndMonth ?? initiative.endMonth;
      if (startMonth == null || endMonth == null) continue;
      if (endMonth < minMonth || startMonth > maxMonth) continue;
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
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled") continue;
    if (filterInitiativeId && initiative.id !== filterInitiativeId) continue;
    for (const epic of initiative.epics ?? []) {
      if (filterEpicTeamIds?.length && !filterEpicTeamIds.includes(epic.team ?? "")) continue;
      const startMonth = epic.planStartMonth ?? initiative.startMonth;
      const endMonth = epic.planEndMonth ?? initiative.endMonth;
      if (startMonth == null || endMonth == null) continue;
      if (endMonth < minMonth || startMonth > maxMonth) continue;
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
  const [showAllEpicSuggestions, setShowAllEpicSuggestions] = useState(false);
  const [burndownVisibleKeys, setBurndownVisibleKeys] = useState<string[]>([]);
  const [burnUpVisibleKeys, setBurnUpVisibleKeys] = useState<string[]>([]);
  const [cfdVisibleKeys, setCfdVisibleKeys] = useState<string[]>([]);
  const [statusDrilldownFilter, setStatusDrilldownFilter] = useState<string | null>(null);
  const [workloadDrilldownAssignee, setWorkloadDrilldownAssignee] = useState<string | null>(null);
  const [workloadDrilldownIsTeam, setWorkloadDrilldownIsTeam] = useState(false);
  const [monthLoadDrilldownAssignee, setMonthLoadDrilldownAssignee] = useState<string | null>(null);
  const [monthLoadDrilldownIsTeam, setMonthLoadDrilldownIsTeam] = useState(false);
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
    () => collectPeriodEpics(initiatives, scopeMonths, filterEpicTeamIds),
    [initiatives, scopeMonths, filterEpicTeamIds],
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
    () => collectPeriodEpics(initiatives, scopeMonths, filterEpicTeamIds, initiativeFilterId),
    [initiatives, scopeMonths, filterEpicTeamIds, initiativeFilterId],
  );
  const monthStories = useMemo(
    () => collectPeriodStories(initiatives, scopeMonths, filterEpicTeamIds, initiativeFilterId),
    [initiatives, scopeMonths, filterEpicTeamIds, initiativeFilterId],
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
        if (epic.planStartMonth != null && epic.planEndMonth != null) {
          const start = sprintStartDate(
            planYear,
            globalSprintFromMonthLane(epic.planStartMonth, epic.planSprint === 2 ? 2 : 1),
          );
          const end = sprintEndDate(
            planYear,
            globalSprintFromMonthLane(epic.planEndMonth, epic.planEndSprint === 1 ? 1 : 2),
          );
          const h = computeProgress({
            stories: epic.userStories ?? [],
            start,
            end,
            basis: progressBasis,
            epicOriginalEstimateDays: epic.originalEstimateDays ?? null,
          });
          // epicEst mode produces a verdict even without stories — that's
          // the point. Other modes still need at least one story.
          if (progressBasis === "epicEst" || (epic.userStories ?? []).length > 0) {
            health = h.status;
            healthTooltip = formatHealthTooltip(h);
            healthResult = h;
          }
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
      if (epic.planStartMonth == null || epic.planEndMonth == null) continue;
      const start = sprintStartDate(
        planYear,
        globalSprintFromMonthLane(epic.planStartMonth, epic.planSprint === 2 ? 2 : 1),
      );
      const end = sprintEndDate(
        planYear,
        globalSprintFromMonthLane(epic.planEndMonth, epic.planEndSprint === 1 ? 1 : 2),
      );
      childStatuses.push(
        computeProgress({
          stories: epic.userStories ?? [],
          start,
          end,
          basis: progressBasis,
          epicOriginalEstimateDays: epic.originalEstimateDays ?? null,
        }).status,
      );
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
    if (selectedEpicOption) {
      const epicId = selectedEpicOption.epic.id;
      return (
        <>
          {" ("}
          <Folder className="mr-0.5 inline-block size-3.5 shrink-0 align-[-2px] text-blue-500" aria-hidden />
          <span>{selectedEpicOption.epic.title}</span>
          {onOpenEpic ? (
            <button
              type="button"
              onClick={() => onOpenEpic(epicId)}
              title="Open epic"
              aria-label="Open epic"
              className="ml-1 inline-flex items-center justify-center text-indigo-500 hover:text-indigo-700"
            >
              <ExternalLink className="size-3.5" />
            </button>
          ) : null}
          {")"}
        </>
      );
    }
    if (selectedInitiativeId !== "all") {
      const init = scopeInitiativeOptions.find((i) => i.id === selectedInitiativeId);
      if (init) {
        const initId = init.id;
        return (
          <>
            {" ("}
            <Zap className="mr-0.5 inline-block size-3.5 shrink-0 align-[-2px] text-blue-500" aria-hidden />
            <span>{init.title}</span>
            {onOpenInitiative ? (
              <button
                type="button"
                onClick={() => onOpenInitiative(initId)}
                title="Open initiative"
                aria-label="Open initiative"
                className="ml-1 inline-flex items-center justify-center text-indigo-500 hover:text-indigo-700"
              >
                <ExternalLink className="size-3.5" />
              </button>
            ) : null}
            {")"}
          </>
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
    if (showAllEpicSuggestions) return epicComboOptions;
    const query = epicInput.trim().toLowerCase();
    if (!query) return epicComboOptions;
    return epicComboOptions.filter((opt) => opt.searchText.includes(query));
  }, [epicComboOptions, epicInput, showAllEpicSuggestions]);
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
        if (epic.planStartMonth == null || epic.planEndMonth == null) continue;
        const start = sprintStartDate(
          planYear,
          globalSprintFromMonthLane(epic.planStartMonth, epic.planSprint === 2 ? 2 : 1),
        );
        const end = sprintEndDate(
          planYear,
          globalSprintFromMonthLane(epic.planEndMonth, epic.planEndSprint === 1 ? 1 : 2),
        );
        childStatuses.push(
          computeProgress({
            stories: epic.userStories ?? [],
            start,
            end,
            basis: progressBasis,
            epicOriginalEstimateDays: epic.originalEstimateDays ?? null,
          }).status,
        );
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
        ? ["todo", "inProgress", "done", "approved"]
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
      (story) => story.status === "done" || story.status === "approved",
    );

    const statusCounts = {
      unscheduled: scopeStories.filter((story) => story.sprint == null).length,
      todo: scheduledStories.filter((story) => story.status === "todo").length,
      inProgress: scheduledStories.filter((story) => story.status === "inProgress").length,
      done: scheduledStories.filter((story) => story.status === "done").length,
      approved: scheduledStories.filter((story) => story.status === "approved").length,
    };
    const statusPie = [
      { name: "Unscheduled", value: statusCounts.unscheduled },
      { name: "To do", value: statusCounts.todo },
      { name: "In progress", value: statusCounts.inProgress },
      { name: "Done", value: statusCounts.done },
      { name: "Approved", value: statusCounts.approved },
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
        storiesByStatus: { todo: number; inProgress: number; done: number; approved: number };
      }
    >();
    for (const story of scheduledStories) {
      const assignee = story.assignee?.trim() || "Unassigned";
      const row =
        byAssignee.get(assignee) ?? {
          openCount: 0,
          daysLeftTotal: 0,
          estimatedTotal: 0,
          storiesByStatus: { todo: 0, inProgress: 0, done: 0, approved: 0 },
        };
      if (story.status === "todo") row.storiesByStatus.todo += 1;
      else if (story.status === "inProgress") row.storiesByStatus.inProgress += 1;
      else if (story.status === "done") row.storiesByStatus.done += 1;
      else if (story.status === "approved") row.storiesByStatus.approved += 1;
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
    const doneFinal = Math.min(total, completedStories.filter((s) => s.status === "done").length);
    const approvedFinal = Math.min(Math.max(0, total - doneFinal), completedStories.filter((s) => s.status === "approved").length);
    const inProgressBaseNow = openAtMonthStartStories.filter((s) => s.status === "inProgress").length;
    const isCurrentMonth =
      new Date().getFullYear() === planYear && new Date().getMonth() + 1 === month;
    const flowSprintTrendData = dayDates.map((dayDate, dayIndex) => {
      const dayInMonth = dayIndex + 1;
      const elapsedDays = isCurrentMonth ? today1Based : totalDays;
      const progress = dayInMonth <= elapsedDays ? (dayInMonth - 1) / Math.max(elapsedDays - 1, 1) : null;
      const approved = progress == null ? null : Math.round(approvedFinal * progress);
      const done = progress == null ? null : Math.round(doneFinal * progress);
      const inProgressBase = progress == null ? null : Math.round(inProgressBaseNow * (1 - progress * 0.55));
      const doneSafe = done ?? 0;
      const approvedSafe = approved ?? 0;
      const inProgressSafe = inProgressBase == null ? 0 : Math.min(Math.max(0, total - approvedSafe - doneSafe), inProgressBase);
      const todoSafe = Math.max(0, total - approvedSafe - doneSafe - inProgressSafe);
      return {
        dayInMonth,
        labelShort: flowChartDayLabel(dayDate),
        isToday: new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate()).getTime() === startToday,
        todo: progress == null ? null : todoSafe,
        inProgress: progress == null ? null : inProgressSafe,
        done: progress == null ? null : doneSafe,
        approved: progress == null ? null : approvedSafe,
      };
    });

    // Team-level aggregation — when 0 or 2+ teams selected (not exactly 1)
    const showTeamMode = !filterEpicTeamIds?.length || filterEpicTeamIds.length !== 1;
    type TeamRow = { teamId: string | null; teamLabel: string; storiesByStatus: { todo: number; inProgress: number; done: number; approved: number }; daysLeftTotal: number; estimatedTotal: number };
    let workloadByTeam: TeamRow[] = [];
    if (showTeamMode) {
      const byTeam = new Map<string, TeamRow>();
      for (const initiative of initiatives) {
        if (initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null) continue;
        const overlaps = scopeMonths.some((m) => initiative.startMonth! <= m && initiative.endMonth! >= m);
        if (!overlaps) continue;
        for (const epic of initiative.epics ?? []) {
          const teamId = epic.team ?? null;
          if (filterEpicTeamIds?.length && !filterEpicTeamIds.includes(teamId ?? "")) continue;
          const teamKey = teamId ?? "__unassigned__";
          const teamLabel = MONTH_TEAM_COLUMNS.find((t) => t.id === teamId)?.label ?? "Unassigned";
          for (const story of epic.userStories ?? []) {
            if (story.sprint == null) continue;
            const row = byTeam.get(teamKey) ?? { teamId, teamLabel, storiesByStatus: { todo: 0, inProgress: 0, done: 0, approved: 0 }, daysLeftTotal: 0, estimatedTotal: 0 };
            if (story.status === "todo") row.storiesByStatus.todo += 1;
            else if (story.status === "inProgress") row.storiesByStatus.inProgress += 1;
            else if (story.status === "done") row.storiesByStatus.done += 1;
            else if (story.status === "approved") row.storiesByStatus.approved += 1;
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
    const counts = { unscheduled: 0, todo: 0, inProgress: 0, done: 0, approved: 0 };
    for (const status of epicStatusById.values()) {
      if (status === "Unscheduled") counts.unscheduled += 1;
      else if (status === "To do") counts.todo += 1;
      else if (status === "In progress") counts.inProgress += 1;
      else if (status === "Done") counts.done += 1;
      else if (status === "Approved") counts.approved += 1;
    }
    return [
      { name: "Unscheduled", value: counts.unscheduled },
      { name: "To do", value: counts.todo },
      { name: "In progress", value: counts.inProgress },
      { name: "Done", value: counts.done },
      { name: "Approved", value: counts.approved },
    ];
  }, [epicStatusById]);
  const statusChartShowsEpics = isQuarterInsights && selectedEpicOption == null;
  const pieData = statusChartShowsEpics ? epicStatusPie.filter((x) => x.value > 0) : pieLegendItems;
  const pieTotal = pieData.reduce((sum, item) => sum + item.value, 0);
  const scopedStories = useMemo(
    () => (selectedEpicOption != null ? (selectedEpicOption.epic.userStories ?? []) : monthStories),
    [selectedEpicOption, monthStories],
  );
  const statusDrilldownStories = useMemo(() => {
    if (statusDrilldownFilter == null) return [];
    if (statusDrilldownFilter === "All") return scopedStories;
    return scopedStories.filter((story) => {
      if (statusDrilldownFilter === "Unscheduled") return story.sprint == null;
      if (statusDrilldownFilter === "To do") return story.sprint != null && story.status === "todo";
      if (statusDrilldownFilter === "In progress") return story.sprint != null && story.status === "inProgress";
      if (statusDrilldownFilter === "Done") return story.sprint != null && story.status === "done";
      if (statusDrilldownFilter === "Approved") return story.sprint != null && story.status === "approved";
      return false;
    });
  }, [statusDrilldownFilter, scopedStories]);
  const statusDrilldownEpics = useMemo(() => {
    if (!statusChartShowsEpics || statusDrilldownFilter == null) return [];
    if (statusDrilldownFilter === "All") return scopedEpics;
    return scopedEpics.filter((epic) => epicStatusById.get(epic.id) === statusDrilldownFilter);
  }, [statusChartShowsEpics, statusDrilldownFilter, scopedEpics, epicStatusById]);
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
  const initiativeTitleByEpicId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of monthEpics) map.set(row.epic.id, row.initiative.title);
    return map;
  }, [monthEpics]);
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
  const workloadDrilldownStories = useMemo(() => {
    if (workloadDrilldownAssignee == null) return [];
    return scopedStories
      .filter((story) => story.sprint != null)
      .filter((story) =>
        workloadDrilldownIsTeam
          ? (epicTeamByStoryId.get(story.id) ?? "") === workloadDrilldownAssignee
          : (story.assignee?.trim() || "Unassigned") === workloadDrilldownAssignee,
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [workloadDrilldownAssignee, workloadDrilldownIsTeam, scopedStories, epicTeamByStoryId]);
  const workloadDrilldownEmptyRows = Math.max(0, tableTargetRows - workloadDrilldownStories.length);
  const monthLoadDrilldownStories = useMemo(() => {
    if (monthLoadDrilldownAssignee == null) return [];
    return scopedStories
      .filter((story) => story.sprint != null)
      .filter((story) =>
        monthLoadDrilldownIsTeam
          ? (epicTeamByStoryId.get(story.id) ?? "") === monthLoadDrilldownAssignee
          : (story.assignee?.trim() || "Unassigned") === monthLoadDrilldownAssignee,
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [monthLoadDrilldownAssignee, monthLoadDrilldownIsTeam, scopedStories, epicTeamByStoryId]);
  const monthLoadDrilldownEmptyRows = Math.max(0, tableTargetRows - monthLoadDrilldownStories.length);
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
    const epicsInScope = selectedEpicOption != null
      ? [selectedEpicOption.epic]
      : selectedInitiativeId !== "all"
        ? monthEpics.filter((row) => row.initiative.id === selectedInitiativeId).map((row) => row.epic)
        : monthBurndownEpics;
    if (epicsInScope.length === 0) return null;
    const aggregateStories = epicsInScope.flatMap((epic) => epic.userStories ?? []);
    if (burndownBasis !== "epicEst" && aggregateStories.length === 0) return null;
    const periodStartDate = new Date(planYear, scopeStartMonth - 1, 1);
    const periodEndDate = new Date(planYear, scopeEndMonth, 0);
    const epicOriginalEstSum = epicsInScope.reduce(
      (sum, e) => sum + (e.originalEstimateDays ?? 0),
      0,
    );
    if (epicsInScope.length === 1) {
      const h = computeProgress({
        stories: epicsInScope[0].userStories ?? [],
        start: periodStartDate,
        end: periodEndDate,
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
      const h = computeProgress({
        stories: epic.userStories ?? [],
        start: periodStartDate,
        end: periodEndDate,
        basis: burndownBasis,
        epicOriginalEstimateDays: epic.originalEstimateDays ?? null,
      });
      return h.status;
    });
    const h = computeInitiativeProgress({
      stories: aggregateStories,
      childStatuses,
      start: periodStartDate,
      end: periodEndDate,
      basis: burndownBasis,
      epicOriginalEstimateDays: epicOriginalEstSum > 0 ? epicOriginalEstSum : null,
    });
    const hasData = burndownBasis === "stories"
      ? aggregateStories.length > 0
      : h.totalEffort > 0;
    if (!hasData) return null;
    return { status: h.status, tooltip: formatHealthTooltip(h), result: h };
  }, [burndownBasis, selectedEpicOption, selectedInitiativeId, monthEpics, monthBurndownEpics, planYear, scopeStartMonth, scopeEndMonth]);
  const selectedEpicDueDate = useMemo(() => {
    if (!burndownFocusedEpicOption) return null;
    const dueSprint = burndownFocusedEpicOption.epic.planEndSprint;
    const dueMonth = burndownFocusedEpicOption.epic.planEndMonth ?? scopeEndMonth;
    const dueYear = burndownFocusedEpicOption.epic.planYear ?? planYear;
    const dueDay = dueSprint === 1 ? 15 : new Date(dueYear, dueMonth, 0).getDate();
    return new Date(dueYear, dueMonth - 1, dueDay);
  }, [burndownFocusedEpicOption, scopeEndMonth, planYear]);
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
    const withIdeal = monthBurndownTruncated.map((row, idx) => {
      const dayIdx = idx + 1;
      if (dayIdx > targetDayIndex) {
        return { ...row, epicIdeal: null };
      }
      let epicIdealRaw: number;
      if (targetDayIndex <= 1) epicIdealRaw = 0;
      else epicIdealRaw = startValue * (1 - (dayIdx - 1) / (targetDayIndex - 1));
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
      let epicIdealRaw: number;
      if (targetDayIndex <= 1) epicIdealRaw = 0;
      else epicIdealRaw = startValue * (1 - (dayIdx - 1) / (targetDayIndex - 1));
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
  }, [monthBurndownTruncated, burndownFocusedEpicOption, selectedEpicDueDate, metric, burndownBasis, planYear, month, scopeStartMonth]);
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
    if (selectedEpicDueMarker && !ticks.includes(selectedEpicDueMarker.axisLabel)) {
      ticks.push(selectedEpicDueMarker.axisLabel);
      ticks.sort((a, b) => labels.indexOf(a) - labels.indexOf(b));
    }
    return ticks;
  }, [monthBurndownWithDueTarget, selectedEpicDueMarker]);
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
    const monthStartDay = dayDates[0];
    const storiesOpenAtStart = sourceStories.filter((story) => {
      const snapshot = latestSnapshotAtDayCached(story, monthStartDay);
      const status = snapshot?.status ?? story.status;
      return isStoryOpen(status);
    });
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
          done: null,
          approved: null,
        };
      }
      let todo = 0;
      let inProgress = 0;
      let done = 0;
      let approved = 0;
      for (const story of storiesOpenAtStart) {
        const snapshot = latestSnapshotAtDayCached(story, dayDate);
        const status = snapshot?.status ?? story.status;
        if (status === "todo") todo += 1;
        else if (status === "inProgress") inProgress += 1;
        else if (status === "done") done += 1;
        else if (status === "approved") approved += 1;
      }
      const dayStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate()).getTime();
      const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      return {
        dayInMonth,
        labelShort: flowChartDayLabel(dayDate),
        isToday: dayStart === nowStart,
        todo,
        inProgress,
        done,
        approved,
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
        return { dayInMonth, labelShort: flowChartDayLabel(dayDate), isToday: false, todo: null, inProgress: null, done: null, approved: null };
      }
      let todo = 0; let inProgress = 0; let done = 0; let approved = 0;
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
          if (finalStatus === "approved") status = progress > 0.75 ? "approved" : progress > 0.5 ? "done" : progress > 0.25 ? "inProgress" : "todo";
          else if (finalStatus === "done") status = progress > 0.6 ? "done" : progress > 0.3 ? "inProgress" : "todo";
          else if (finalStatus === "inProgress") status = progress > 0.4 ? "inProgress" : "todo";
          else status = "todo";
        }
        if (status === "todo") todo += days;
        else if (status === "inProgress") inProgress += days;
        else if (status === "done") done += days;
        else if (status === "approved") approved += days;
      }
      return { dayInMonth, labelShort: flowChartDayLabel(dayDate), isToday: dayStart === nowStart,
        todo: Number(todo.toFixed(1)), inProgress: Number(inProgress.toFixed(1)), done: Number(done.toFixed(1)), approved: Number(approved.toFixed(1)) };
    });
  }, [selectedEpicOption, monthEpics, planYear, month, scopeStartMonth, scopeEndMonth]);

  const cfdDataResolved = cfdMetric === "daysLeft" ? flowDaysData : flowResolved;

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
    const epicOriginalEstSum = epicsInScope.reduce(
      (sum, e) => sum + (e.originalEstimateDays ?? 0),
      0,
    );
    if (epicsInScope.length === 1) {
      const h = computeProgress({
        stories: epicsInScope[0].userStories ?? [],
        start: periodStartDate,
        end: periodEndDate,
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
      const h = computeProgress({
        stories: epic.userStories ?? [],
        start: periodStartDate,
        end: periodEndDate,
        basis: burnupBasis,
        epicOriginalEstimateDays: epic.originalEstimateDays ?? null,
      });
      return h.status;
    });
    const h = computeInitiativeProgress({
      stories: aggregateStories,
      childStatuses,
      start: periodStartDate,
      end: periodEndDate,
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

  const burnUpData = useMemo(() => {
    const epicsInScope = selectedEpicOption != null
      ? [selectedEpicOption.epic]
      : monthEpics.map((r) => r.epic).filter((e) => burnUpVisibleKeys.length === 0 || burnUpVisibleKeys.includes(e.id));
    const allStories = epicsInScope.flatMap((e) => (e.userStories ?? []).filter((s) => s.sprint != null));
    const isDays = burnUpMetric === "daysLeft";
    const useEpicEst = isDays && burnupBasis === "epicEst";

    const storyValue = (s: (typeof allStories)[number]) =>
      isDays ? Math.max(0, s.estimatedDays ?? s.daysLeft ?? 0) : 1;
    const storyDone = (status: string) => status === "done" || status === "approved";

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
      return {
        id: e.id,
        epicEst: e.originalEstimateDays ?? 0,
        stories,
        hasSnap,
        totalStoryValue,
        currentCompleted: Math.max(0, totalStoryValue - currentOpen),
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
    const periodEndDate = new Date(planYear, scopeEndMonth, 0);
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

    return Array.from({ length: totalDays }, (_, idx): { labelShort: string; isToday: boolean; completed: number | null; scope: number; ideal: number | null; [epicKey: string]: number | string | boolean | null } => {
      const dayIdx = idx + 1;
      const dayDate = new Date(periodStartDate);
      dayDate.setDate(dayDate.getDate() + idx);
      const dayStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate());
      const isToday = dayStart.getTime() === todayStart.getTime();

      let completed: number | null = null;
      // Per-epic completed values — one entry per epic in scope so that the
      // legend's "All" toggle can render every epic's line. Each epic uses
      // snapshot reconstruction when it has snapshot history, and a linear
      // ramp (0 → currentCompleted across elapsedDays) when it doesn't.
      const perEpic: Record<string, number | null> = {};
      for (const m of epicMeta) perEpic[m.id] = null;
      if (dayIdx <= elapsedDays) {
        // Burnup mirrors burndown: completed = scope − open work remaining.
        // We compute per-epic completed inside the same pass, then sum for
        // the aggregate `completed`.
        let openRemainingScaledAgg = 0;
        const rampRatio = elapsedDays <= 1 ? 1 : (dayIdx - 1) / Math.max(elapsedDays - 1, 1);
        const isFinalDay = dayIdx === elapsedDays;
        for (const m of epicMeta) {
          let epicScope: number;
          let epicScaledOpen: number;
          if (m.hasSnap) {
            let epicOpenStoryDays = 0;
            let epicTotalStoryValue = 0;
            for (const story of m.stories) {
              epicTotalStoryValue += storyValue(story);
              const snap = latestSnapshotAtDayCached(story, dayDate);
              const status = snap?.status ?? story.status;
              if (status !== "todo" && status !== "inProgress") continue;
              if (isDays) {
                const daysLeft = snap?.daysLeft ?? snap?.estimatedDays ?? story.daysLeft ?? story.estimatedDays ?? 1;
                epicOpenStoryDays += Math.max(0, daysLeft);
              } else {
                epicOpenStoryDays += 1;
              }
            }
            if (useEpicEst && m.epicEst > 0) {
              epicScope = m.epicEst;
              // Scale open story-days into epicEst units using the epic's
              // TOTAL story value (constant across time), not the current
              // open story-days. The previous formula used
              // `startOpenStoryDays` which excluded stories that are
              // currently done — but historically those stories WERE open,
              // so `epicOpenStoryDays` could exceed `startOpenStoryDays`,
              // making the ratio > 1 and clamping every per-epic line to 0.
              if (epicTotalStoryValue > 0) {
                const openRatio = Math.min(1, Math.max(0, epicOpenStoryDays / epicTotalStoryValue));
                epicScaledOpen = m.epicEst * openRatio;
              } else {
                epicScaledOpen = m.epicEst;
              }
            } else {
              epicScope = epicTotalStoryValue;
              epicScaledOpen = epicOpenStoryDays;
            }
          } else {
            // No snapshot history for this epic → linear ramp from 0 →
            // currentCompleted. Without this fallback the snapshot path
            // would freeze every story at its CURRENT status across the
            // whole timeline, leaving epics with no completed stories
            // showing as flat 0.
            const mCompletedRamped = isFinalDay ? m.currentCompleted : m.currentCompleted * rampRatio;
            if (useEpicEst && m.epicEst > 0) {
              epicScope = m.epicEst;
              if (m.totalStoryValue > 0) {
                epicScaledOpen = m.epicEst * (1 - mCompletedRamped / m.totalStoryValue);
              } else {
                epicScaledOpen = m.epicEst;
              }
            } else {
              epicScope = m.totalStoryValue;
              epicScaledOpen = Math.max(0, m.totalStoryValue - mCompletedRamped);
            }
          }
          const epicCompleted = Math.max(0, epicScope - epicScaledOpen);
          perEpic[m.id] = round(epicCompleted);
          openRemainingScaledAgg += epicScaledOpen;
        }
        completed = round(Math.max(0, totalScope - openRemainingScaledAgg));
      }

      let ideal: number | null = null;
      if (totalScope > 0 && dayIdx <= dueDayIndex) {
        const raw = dueDayIndex <= 1 ? totalScope : totalScope * (dayIdx - 1) / (dueDayIndex - 1);
        ideal = round(Math.max(0, Math.min(totalScope, raw)));
      }

      return { labelShort: flowChartDayLabel(dayDate), isToday, completed, scope: round(totalScope), ideal, ...perEpic };
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
    const baseTicks =
      labels.length <= 10
        ? labels.slice()
        : (() => {
            const step = Math.max(1, Math.ceil(labels.length / 10));
            const out: string[] = [];
            for (let i = 0; i < labels.length; i += step) out.push(labels[i]);
            const last = labels[labels.length - 1];
            if (out[out.length - 1] !== last) out.push(last);
            return out;
          })();
    // Mirror the burndown axis logic: inject the due-date tick if it isn't
    // already in the set so the `ReferenceDot x={dueTickLabel}` marker can
    // actually position. Without this the Due target silently vanishes on
    // epics whose deadline falls between two of the auto-spaced ticks.
    if (burnUpDueDateTickLabel && !baseTicks.includes(burnUpDueDateTickLabel)) {
      baseTicks.push(burnUpDueDateTickLabel);
    }
    return baseTicks;
  }, [burnUpData, burnUpDueDateTickLabel]);

  const burnUpScopeTotal = burnUpData.length > 0 ? burnUpData[0]?.scope ?? 0 : 0;

  const burnUpCompletedNow = useMemo(() => {
    for (let i = burnUpData.length - 1; i >= 0; i--) {
      const v = burnUpData[i]?.completed;
      if (v != null) return v;
    }
    return 0;
  }, [burnUpData]);
  /** Truncate the `completed` line after it first reaches the scope total —
   *  same reasoning as the burndown's done-truncation: a flat line at scope
   *  adds no information. Also surface whether the scope was reached at all
   *  so the chart can paint a "Done ✓" marker on the due date. */
  const burnUpDoneAtIdx = useMemo(() => {
    if (burnUpScopeTotal <= 0) return -1;
    for (let i = 0; i < burnUpData.length; i++) {
      const v = burnUpData[i]?.completed;
      if (typeof v === "number" && v >= burnUpScopeTotal) return i;
    }
    return -1;
  }, [burnUpData, burnUpScopeTotal]);
  const burnUpDataTruncated = useMemo(() => {
    if (burnUpDoneAtIdx < 0) return burnUpData;
    return burnUpData.map((row, i) => (i > burnUpDoneAtIdx ? { ...row, completed: null } : row));
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
      const completed = stories.filter((s) => s.status === "done" || s.status === "approved").length;
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
  // scope/ideal/due/done markers render — they only make sense when one
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
            <>
              {" ("}
              <Folder className="mr-0.5 inline-block size-3.5 shrink-0 align-[-2px] text-blue-500" aria-hidden />
              <span>{item.label}</span>
              {onOpenEpic ? (
                <button
                  type="button"
                  onClick={() => onOpenEpic(key)}
                  title="Open epic"
                  aria-label="Open epic"
                  className="ml-1 inline-flex items-center justify-center text-indigo-500 hover:text-indigo-700"
                >
                  <ExternalLink className="size-3.5" />
                </button>
              ) : null}
              {")"}
            </>
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
          <>
            {" ("}
            <Folder className="mr-0.5 inline-block size-3.5 shrink-0 align-[-2px] text-blue-500" aria-hidden />
            <span>{row.title}</span>
            {onOpenEpic ? (
              <button
                type="button"
                onClick={() => onOpenEpic(rowId)}
                title="Open epic"
                aria-label="Open epic"
                className="ml-1 inline-flex items-center justify-center text-indigo-500 hover:text-indigo-700"
              >
                <ExternalLink className="size-3.5" />
              </button>
            ) : null}
            {")"}
          </>
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
      <col className="w-[12%]" />
      <col className="w-[30%]" />
      <col className="w-[26%]" />
      <col className="w-[17%]" />
      <col className="w-[15%]" />
    </colgroup>
  );
  const sharedDrilldownArrowClass =
    "absolute -right-[2px] inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800";

  return (
    <section
      className="mb-2 flex flex-col gap-3.5 rounded-xl p-4"
      style={{
        backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="-mt-1 rounded-xl bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 px-4 py-4 shadow-[inset_0_2px_5px_rgba(15,23,42,0.16),inset_0_-1px_0_rgba(255,255,255,0.55)]">
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
                "h-9 w-full rounded-md border border-slate-200 bg-white pr-2 text-[13px] font-semibold text-slate-700",
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
              className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Clear scope filter"
              title="Clear filter (show all)"
            >
              <Eraser className="size-3.5" aria-hidden />
            </button>
            {isEpicDropdownOpen ? (
              <div
                className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-56 overflow-auto rounded-xl bg-white p-1.5 shadow-xl"
                onMouseLeave={() => {
                  setIsEpicDropdownOpen(false);
                  setShowAllEpicSuggestions(false);
                }}
              >
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
          {statusDrilldownFilter ? (
            <button
              type="button"
              onClick={clearStatusDrilldown}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              aria-label="Back to chart"
              title="Back to chart"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        {statusDrilldownFilter ? (
          <div className={cn("mt-0 flex-1 min-h-0 w-full min-w-0 overflow-hidden", INSIGHTS_CHART_FRAME)}>
            <div className="relative h-full min-h-0 min-w-0">
              <div
                ref={statusDrilldownScrollRef}
                onScroll={updateStatusDrilldownArrowState}
                className={sharedDrilldownScrollAreaClass}
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
              <table className={drilldownTableClass}>
                {drilldownColgroup}
                <thead className="sticky top-0 z-10 overflow-hidden rounded-t-md border-b border-[#19abeb]/70 bg-[#0897d5] text-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                  {statusChartShowsEpics ? (
                    <tr>
                      <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Epic ID</th>
                      <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Epic name</th>
                      <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Initiative</th>
                      <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Assignee</th>
                      <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Status</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Story ID</th>
                      <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Story name</th>
                      <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Sprint</th>
                      <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Assignee</th>
                      <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Status</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {statusChartShowsEpics
                    ? statusDrilldownEpics.map((epic) => {
                        const epicStatusLabel = epicStatusById.get(epic.id) ?? "To do";
                        return (
                        <tr key={epic.id} className={drilldownTableRowZebra}>
                          <td className="min-w-0 px-2 py-0.5">
                            <InsightsTruncatedHoverButton
                              label={scopedEpicDisplayIds.get(epic.id) ?? epic.id.slice(0, 8)}
                              onClick={() => onOpenEpic?.(epic.id)}
                              className="block w-full max-w-full truncate text-left font-semibold text-blue-700 underline-offset-2 hover:underline"
                            />
                          </td>
                          <td className="min-w-0 px-2 py-0.5">
                            <InsightsTruncatedHoverLabel text={epic.title} />
                          </td>
                          <td className="min-w-0 px-2 py-0.5">
                            <InsightsTruncatedHoverLabel text={initiativeTitleByEpicId.get(epic.id) ?? "—"} />
                          </td>
                          <td className="min-w-0 px-2 py-0.5">
                            <InsightsTruncatedHoverLabel text={epic.assignee?.trim() || "Unassigned"} />
                          </td>
                          <td className="min-w-0 px-2 py-0.5">
                            <InsightsTruncatedHoverLabel text={epicStatusLabel} />
                          </td>
                        </tr>
                        );
                      })
                    : statusDrilldownStories.map((story) => {
                        const storyStatusLabel =
                          story.sprint == null
                            ? "Unscheduled"
                            : story.status === "todo"
                              ? "To do"
                              : story.status === "inProgress"
                                ? "In progress"
                                : story.status === "done"
                                  ? "Done"
                                  : "Approved";
                        return (
                        <tr key={story.id} className={drilldownTableRowZebra}>
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
                          </td>
                          <td className="min-w-0 px-2 py-0.5">
                            <InsightsTruncatedHoverLabel text={story.assignee?.trim() || "Unassigned"} />
                          </td>
                          <td className="min-w-0 px-2 py-0.5">
                            <InsightsTruncatedHoverLabel text={storyStatusLabel} />
                          </td>
                        </tr>
                        );
                      })}
                  {statusDrilldownEmptyRows > 0
                    ? Array.from({ length: statusDrilldownEmptyRows }).map((_, index) => (
                        <tr key={`status-empty-${index}`} className={drilldownTableEmptyRowZebra}>
                          <td colSpan={5} className="px-3 py-0.5 text-[13px]">
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
        ) : (
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
              <div className="pointer-events-none absolute inset-0 z-[1]">
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {statusChartShowsEpics ? "Σ Epics" : "Σ Stories"}
                  </p>
                  <p className="text-[18px] leading-none font-bold text-slate-900">{pieTotal}</p>
                </div>
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
        )}
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
            {burndownHealth ? (
              <HealthBadgeWithDetail
                status={burndownHealth.status}
                result={burndownHealth.result}
                basis={burndownBasis}
                basisLabel={basisDisplayLabel(burndownBasis, selectedEpicOption ? "epic" : "initiative")}
                scopeLabel={selectedEpicOption
                  ? `${selectedEpicOption.epic.title} (epic)`
                  : selectedInitiativeId !== "all"
                    ? "Selected initiative"
                    : "All epics in scope"}
                chartKind="burndown"
              />
            ) : null}
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
                        { value: "epicEst", label: "Epic Days Est.", icon: Folder },
                        { value: "days", label: "Σ Story Days Est.", icon: StickyNote },
                        { value: "stories", label: "% Stories Completed", icon: CheckCircle2 },
                      ]
                    : [
                        { value: "epicEst", label: "Σ Epic Days Est.", icon: Folder },
                        { value: "days", label: "Σ Story Days Est.", icon: StickyNote },
                        { value: "stories", label: "% Stories Completed", icon: CheckCircle2 },
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
            // Burndown chart + legend split. Legend column widened so epic
            // titles read in full (the previous 12.5rem column truncated
            // most names); the plot area shrinks slightly to compensate.
            "grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_16rem] md:items-stretch",
            INSIGHTS_CHART_GRID_GAP,
            INSIGHTS_CONTENT_HEIGHT,
          )}
        >
          <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
            {monthBurndownEpics.length > 0 ? (
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthBurndownWithDueTarget} margin={{ top: 38, right: 60, left: 18, bottom: 18 }}>
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
                      allBurndownKeysSelected
                        ? "text-slate-900 hover:bg-slate-200/70"
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
                return (
                  <EpicLegendRowButton
                    key={item.key}
                    label={item.label}
                    color={item.color}
                    on={on}
                    isEpic={isEpic}
                    onClick={() => toggleBurndownKey(item.key)}
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
                <p className="text-[12px] text-slate-500">
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
          {workloadDrilldownAssignee ? (
            <button
              type="button"
              onClick={() => { setWorkloadDrilldownAssignee(null); setWorkloadDrilldownIsTeam(false); }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              aria-label="Back to workload chart"
              title="Back to workload chart"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        {workloadDrilldownAssignee ? (
          <div className={cn("mt-0 flex-1 min-h-0 w-full min-w-0 overflow-hidden", INSIGHTS_CHART_FRAME)}>
            <div className="relative h-full min-h-0 min-w-0">
            <div
              ref={workloadDrilldownScrollRef}
              onScroll={updateWorkloadDrilldownArrowState}
              className={sharedDrilldownScrollAreaClass}
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <table className={drilldownTableClass}>
                {drilldownColgroup}
                <thead className="sticky top-0 z-10 overflow-hidden rounded-t-md border-b border-[#19abeb]/70 bg-[#0897d5] text-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                  <tr>
                    <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Story ID</th>
                    <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Story name</th>
                    <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Sprint</th>
                    <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Assignee</th>
                    <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {workloadDrilldownStories.map((story) => (
                    <tr key={story.id} className={drilldownTableRowZebra}>
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
                      </td>
                      <td className="min-w-0 px-2 py-0.5">
                        <DrilldownAssigneeCell assignee={story.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                      </td>
                      <td className="min-w-0 px-2 py-0.5">
                        <StoryStatusPill status={story.status} />
                      </td>
                    </tr>
                  ))}
                  {workloadDrilldownEmptyRows > 0
                    ? Array.from({ length: workloadDrilldownEmptyRows }).map((_, index) => (
                        <tr key={`workload-empty-${index}`} className={drilldownTableEmptyRowZebra}>
                          <td colSpan={5} className="px-3 py-0.5 text-[13px]">
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
        ) : null}
        {!workloadDrilldownAssignee ? (() => {
          const teamMode = !forceUserMode && (!filterEpicTeamIds?.length || filterEpicTeamIds.length !== 1) && analytics.workloadByTeam.length > 0;
          const barData = teamMode
            ? analytics.workloadByTeam.map((t) => ({
                name: t.teamLabel,
                fullName: t.teamLabel,
                "To do": t.storiesByStatus.todo,
                "In progress": t.storiesByStatus.inProgress,
                "Done": t.storiesByStatus.done,
                "Approved": t.storiesByStatus.approved,
              }))
            : analytics.workloadByAssignee.map((item) => ({
                name: compactAssigneeName(item.assignee),
                fullName: item.assignee,
                "To do": item.storiesByStatus.todo,
                "In progress": item.storiesByStatus.inProgress,
                "Done": item.storiesByStatus.done,
                "Approved": item.storiesByStatus.approved,
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
                        if (match) { setWorkloadDrilldownIsTeam(true); setWorkloadDrilldownAssignee(match.teamId ?? ""); }
                      } else {
                        const match = analytics.workloadByAssignee.find((r) => compactAssigneeName(r.assignee) === label);
                        if (match) { setWorkloadDrilldownIsTeam(false); setWorkloadDrilldownAssignee(match.assignee); }
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
                      content={() => (
                        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 pt-1.5 text-[13px]">
                          {WORKLOAD_BAR_SEGMENTS.map((s) => (
                            <span key={s.key} className="inline-flex items-center gap-1.5">
                              <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                              <span className="font-medium text-slate-700">{s.label}</span>
                            </span>
                          ))}
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
                          ? ((data: { fullName?: string; name?: string }) => { const lbl = data?.fullName ?? data?.name; if (!lbl) return; const match = analytics.workloadByTeam.find((t) => t.teamLabel === lbl); if (match) { setWorkloadDrilldownIsTeam(true); setWorkloadDrilldownAssignee(match.teamId ?? ""); } }) as any  // eslint-disable-line @typescript-eslint/no-explicit-any
                          : ((data: { fullName?: string }) => { if (data?.fullName) { setWorkloadDrilldownIsTeam(false); setWorkloadDrilldownAssignee(data.fullName); } }) as any}  // eslint-disable-line @typescript-eslint/no-explicit-any
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-[12px] text-slate-500">No open workload found for this month.</p>
              )}
            </div>
          );
        })() : null}
        <p className="mt-2 shrink-0 text-[12px] text-slate-600">
          {analytics.openStories} open stories, <span className="text-amber-700">{analytics.atRiskStories} at risk</span>.
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
        </div>
        <div
          className={cn(
            "grid md:grid-cols-[minmax(0,1fr)_12.5rem] md:items-stretch",
            INSIGHTS_CHART_GRID_GAP,
            INSIGHTS_CHART_BAND,
          )}
        >
          <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
            {cfdDataResolved.length > 0 ? (
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cfdDataResolved} margin={{ top: 2, right: 26, left: 18, bottom: 0 }}>
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
            const monthDaysLeft = analytics.monthDaysLeft;
            const loadRows = teamMode
              ? analytics.workloadByTeam.map((t) => ({
                  key: t.teamLabel,
                  label: t.teamLabel,
                  initials: t.teamLabel.slice(0, 2).toUpperCase(),
                  image: null as string | null,
                  teamSlug: t.teamId ?? null,
                  daysLeft: t.daysLeftTotal,
                  estTotal: t.estimatedTotal,
                  onRowClick: () => { setMonthLoadDrilldownIsTeam(true); setMonthLoadDrilldownAssignee(t.teamId ?? ""); },
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
                  onRowClick: () => { setMonthLoadDrilldownIsTeam(false); setMonthLoadDrilldownAssignee(row.assignee); },
                }));
            if (loadRows.length === 0 && !monthLoadDrilldownAssignee) return <div className="hidden lg:block lg:col-span-1" />;
            return (
              <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-1">
                <div className={cn("mb-2 flex shrink-0 items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
                  <h3 className={cn("inline-flex items-center gap-1.5 font-semibold text-slate-800", isMultiPeriodInsights ? "text-[16px]" : "text-[15px]")}>
                    <Users className="size-4 text-slate-600" />
                    Month Load{scopeTitleSuffix}
                  </h3>
                  {monthLoadDrilldownAssignee && (
                    <button
                      type="button"
                      onClick={() => { setMonthLoadDrilldownAssignee(null); setMonthLoadDrilldownIsTeam(false); }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      aria-label="Back to month load"
                      title="Back to month load"
                    >
                      <ArrowLeft className="size-3.5" aria-hidden />
                    </button>
                  )}
                </div>
                {monthLoadDrilldownAssignee ? (
                  <div className={cn("mt-0 flex-1 min-h-0 w-full min-w-0 overflow-hidden", INSIGHTS_CHART_FRAME)}>
                    <div className="relative h-full min-h-0 min-w-0">
                      <div
                        ref={monthLoadDrilldownScrollRef}
                        onScroll={updateMonthLoadDrilldownArrowState}
                        className={sharedDrilldownScrollAreaClass}
                        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                      >
                        <table className={drilldownTableClass}>
                          {drilldownColgroup}
                          <thead className="sticky top-0 z-10 overflow-hidden rounded-t-md border-b border-[#19abeb]/70 bg-[#0897d5] text-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                            <tr>
                              <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Story ID</th>
                              <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Story name</th>
                              <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Sprint</th>
                              <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Assignee</th>
                              <th className="min-w-0 px-2 py-1 text-[14px] font-semibold">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthLoadDrilldownStories.map((story) => (
                              <tr key={story.id} className={drilldownTableRowZebra}>
                                <td className="min-w-0 px-2 py-0.5">
                                  <span className="inline-flex min-w-0 items-center gap-1.5">
                                    <UserStoryIcon className="size-3.5" />
                                    <InsightsTruncatedHoverButton label={scopedStoryDisplayIds.get(story.id) ?? story.id.slice(0, 8)} onClick={() => onOpenStory?.(story.id)} className="block min-w-0 max-w-full truncate text-left font-semibold text-blue-700 underline-offset-2 hover:underline" />
                                  </span>
                                </td>
                                <td className="min-w-0 px-2 py-0.5"><InsightsTruncatedHoverLabel text={story.title} /></td>
                                <td className="min-w-0 px-2 py-0.5">
                                  {normalizeStoryYearSprint(story.sprint, scopeStartMonth) != null ? (
                                    <InsightsTruncatedHoverButton label={storySprintDisplayLabel(story.sprint, scopeStartMonth)} onClick={() => { const t = normalizeStoryYearSprint(story.sprint, scopeStartMonth); if (t) onOpenSprintKanban?.(t, resolveStoryTeamForSprintNav(story)); }} className="block w-full max-w-full truncate text-left font-semibold text-blue-700 underline-offset-2 hover:underline" />
                                  ) : (
                                    <InsightsTruncatedHoverLabel text="Unscheduled" />
                                  )}
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  <DrilldownAssigneeCell assignee={story.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                                </td>
                                <td className="min-w-0 px-2 py-0.5">
                                  <StoryStatusPill status={story.status} />
                                </td>
                              </tr>
                            ))}
                            {monthLoadDrilldownEmptyRows > 0 && Array.from({ length: monthLoadDrilldownEmptyRows }).map((_, i) => (
                              <tr key={`ml-empty-${i}`} className={drilldownTableEmptyRowZebra}>
                                <td colSpan={5} className="px-3 py-0.5 text-[13px]">{" "}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button type="button" onClick={() => scrollMonthLoadDrilldownBy(-96)} className={cn(sharedDrilldownArrowClass, "top-0", canScrollMonthLoadDrilldownUp && "bg-slate-200/70 text-slate-800")} aria-label="Scroll up"><ChevronUp className="size-3.5" /></button>
                      <button type="button" onClick={() => scrollMonthLoadDrilldownBy(96)} className={cn(sharedDrilldownArrowClass, "bottom-0", canScrollMonthLoadDrilldownDown && "bg-slate-200/70 text-slate-800")} aria-label="Scroll down"><ChevronDown className="size-3.5" /></button>
                    </div>
                  </div>
                ) : (
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
                    const atRisk = monthDaysLeft > 0 && row.daysLeft > monthDaysLeft;
                    const overByDays = atRisk ? row.daysLeft - monthDaysLeft : 0;
                    const allDone = row.daysLeft === 0 && row.estTotal > 0;
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
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-[12.5px] font-semibold text-slate-800">{row.label}</span>
                              <div className="flex shrink-0 items-center gap-3">
                                {atRisk && (
                                  <span
                                    className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200/80"
                                    title={`${row.daysLeft}d of work left but only ${monthDaysLeft}d remain in the period — ${overByDays}d over capacity`}
                                  >
                                    <AlertTriangle className="size-2.5 shrink-0" aria-hidden />
                                    +{overByDays}d over
                                  </span>
                                )}
                                <span className="text-[11.5px] tabular-nums text-slate-600">
                                  <span className="font-semibold text-slate-800">{doneDays}d</span>
                                  <span className="ml-0.5 text-slate-400">est done</span>
                                  <span className="mx-1 text-slate-300">·</span>
                                  <span className={cn("font-semibold", atRisk ? "text-amber-700" : "text-slate-800")}>{row.daysLeft}d</span>
                                  <span className="ml-0.5 text-slate-400">est left</span>
                                </span>
                              </div>
                            </div>
                            <div className="mt-1 relative h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/50">
                              <div
                                className={cn(
                                  "absolute inset-y-0 left-0 rounded-full transition-all",
                                  atRisk ? "bg-amber-400" : allDone ? "bg-emerald-400" : "bg-indigo-400",
                                )}
                                style={{ width: `${donePct}%` }}
                              />
                            </div>
                          </div>
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
                )}
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
                {burnupHealth ? (
                  <HealthBadgeWithDetail
                    status={burnupHealth.status}
                    result={burnupHealth.result}
                    basis={burnupBasis}
                    basisLabel={basisDisplayLabel(burnupBasis, selectedEpicOption ? "epic" : "initiative")}
                    scopeLabel={selectedEpicOption
                      ? `${selectedEpicOption.epic.title} (epic)`
                      : selectedInitiativeId !== "all"
                        ? "Selected initiative"
                        : "All epics in scope"}
                    chartKind="burnup"
                  />
                ) : null}
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
                            { value: "epicEst", label: "Epic Days Est.", icon: Folder },
                            { value: "days", label: "Σ Story Days Est.", icon: StickyNote },
                            { value: "stories", label: "% Stories Completed", icon: CheckCircle2 },
                          ]
                        : [
                            { value: "epicEst", label: "Σ Epic Days Est.", icon: Folder },
                            { value: "days", label: "Σ Story Days Est.", icon: StickyNote },
                            { value: "stories", label: "% Stories Completed", icon: CheckCircle2 },
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
                // Burnup chart + legend split — matches the widened burndown
                // column (16rem) so the two charts stay symmetric and epic
                // titles fit without truncation.
                "grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_16rem] md:items-stretch",
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
                    <LineChart data={burnUpDataTruncated} margin={{ top: 38, right: 60, left: 18, bottom: 0 }}>
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
                          allBurnUpKeysSelected ? "text-slate-900" : "text-slate-400",
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
                    return (
                      <EpicLegendRowButton
                        key={row.id}
                        label={row.title}
                        color={on ? row.color : "#cbd5e1"}
                        on={on}
                        isEpic
                        onClick={() => toggleBurnUpKey(row.id)}
                        textClass={cn(
                          "hover:bg-slate-200/70",
                          isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
                          on ? "text-slate-900" : "text-slate-400",
                        )}
                      />
                    );
                  })}
                  </div>
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
