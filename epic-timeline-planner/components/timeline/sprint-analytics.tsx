"use client";

import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertOctagon, AlertTriangle, CalendarDays, ChartNoAxesCombined, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock, Folder, Layers, ListTodo, PieChart as PieChartIcon, PlayCircle, User, UserRound, Users } from "lucide-react";
import { createPortal } from "react-dom";
import { HealthBadge } from "@/components/timeline/health-badge";
import { InsightsDrilldownModal } from "@/components/timeline/insights-drilldown-modal";
import { DrilldownFilterDropdown, DrilldownFilterInputText } from "@/components/timeline/insights-drilldown-filters";
import type { HealthStatus } from "@/lib/progress";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { useTeamImages } from "@/lib/use-team-images";
import { SprintTimelinePopup } from "@/components/timeline/sprint-end-countdown";
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
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { buildSprintAnalytics, BurndownMetric } from "@/lib/sprint-analytics";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { UserAvatar, resolveAssigneeAvatar } from "@/components/ui/user-avatar";
import { type EstimateSource } from "@/lib/epic-estimates";
import { collectMonthScopeEpicsForSprintPanel, storyMatchesYearSprint } from "@/lib/sprint-plan";
import { monthTeamLabelForId } from "@/lib/month-team-board";
import { projectInitiativesToCloseDate } from "@/lib/story-snapshot-projection";
import { sprintEndDate } from "@/lib/year-sprint";
import { nowMs as clockNowMs } from "@/lib/clock";
import { InitiativeItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type SprintWorkloadStatusKey = (typeof WORKLOAD_BAR_SEGMENTS)[number]["key"];
type SprintWorkloadFilterKey = "all" | SprintWorkloadStatusKey;
type SprintCfdKey = (typeof CFD_FLOW_SEGMENTS)[number]["key"];

const STATUS_COLORS: Record<string, string> = {
  Unscheduled: "#94a3b8",
  "To do": "#f59e0b",
  "In progress": "#3b82f6",
  "Review / Testing": "#8b5cf6",
  Done: "#10b981",
};

const WORKLOAD_BAR_SEGMENTS = [
  { key: "todo" as const, label: "To do", color: STATUS_COLORS["To do"] },
  { key: "inProgress" as const, label: "In progress", color: STATUS_COLORS["In progress"] },
  { key: "review" as const, label: "Review / Testing", color: STATUS_COLORS["Review / Testing"] },
  { key: "done" as const, label: "Done", color: STATUS_COLORS["Done"] },
] as const;

/**
 * Backlog-style icon + label for a workflow status. Mirrors the same pill
 * the backlog table uses so drilldown rows read consistently. Accepts both
 * the enum form ("todo" / "inProgress" / ...) and the display labels
 * ("To do" / "In progress" / ...) used by sprint-analytics' display rows.
 */
type StoryStatusPillValue =
  | UserStoryItem["status"]
  | "To do"
  | "In progress"
  | "Review / Testing"
  | "Done"
  | "Unscheduled";

/** Small circular progress indicator — same SVG ring used on the
 *  RoadmapHealthHero + month-analytics Team Progress rows so the three
 *  surfaces read with one visual vocabulary. */
function CircleProgress({
  percent,
  color,
}: {
  percent: number;
  color: string;
}) {
  // Slightly elliptical so 3-digit "100%" fits without clipping.
  // The ellipse is DEFINED vertically (rx 11, ry 14) and rotated
  // -90° — so the displayed shape ends up wide (visible 14 × 11)
  // AND the stroke's natural start point (right of the unrotated
  // ellipse) lands at the TOP of the rotated shape. If we defined
  // it horizontal and rotated, the rotation would swap axes back
  // to vertical and the fill would look misplaced.
  //
  // Arc length uses the Ramanujan ellipse-circumference
  // approximation since closed-form doesn't exist.
  const rx = 11;
  const ry = 14;
  const h = ((rx - ry) ** 2) / ((rx + ry) ** 2);
  const circumference = Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const clamped = Math.max(0, Math.min(100, percent));
  const dashOffset = circumference * (1 - clamped / 100);
  return (
    <svg width={34} height={28} viewBox="0 0 34 28" aria-hidden>
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

function StoryStatusPill({ status }: { status: StoryStatusPillValue }) {
  const meta = (() => {
    switch (status) {
      case "done":
      case "Done":
        return { label: "Done", Icon: CheckCircle2, color: "text-emerald-600" };
      case "review":
      case "Review / Testing":
        return { label: "Review / Testing", Icon: CheckCheck, color: "text-violet-600" };
      case "inProgress":
      case "In progress":
        return { label: "In progress", Icon: PlayCircle, color: "text-blue-600" };
      case "Unscheduled":
        return { label: "Unscheduled", Icon: ListTodo, color: "text-slate-400" };
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
 * Burndown-based health verdict for a single Sprint Load row (user OR team).
 * Same vocabulary + thresholds as Month Team Progress so the two surfaces
 * read identically: Done · Overdue · At Risk (≥4d above ideal) · Watch (1–4d
 * above ideal) · On Track (otherwise).
 *
 * "Ideal" interpolates linearly from `estTotal` at sprint start to `0` at
 * sprint end, so `idealLeft = estTotal × (1 − elapsed)`. `gap = daysLeft −
 * idealLeft`; positive means the row is behind the ideal pace line.
 */
function sprintBurndownVerdict({
  daysLeft,
  estTotal,
  sprintDaysLeft,
  sprintDaysTotal,
}: {
  daysLeft: number;
  estTotal: number;
  sprintDaysLeft: number;
  sprintDaysTotal: number;
}): { status: HealthStatus; gap: number; idealLeft: number } {
  if (estTotal <= 0 || sprintDaysTotal <= 0) {
    return { status: "onTrack", gap: 0, idealLeft: 0 };
  }
  if (daysLeft <= 0) return { status: "done", gap: 0, idealLeft: 0 };
  if (sprintDaysLeft <= 0) return { status: "overdue", gap: daysLeft, idealLeft: 0 };
  const elapsed = Math.min(1, Math.max(0, (sprintDaysTotal - sprintDaysLeft) / sprintDaysTotal));
  const idealLeft = estTotal * (1 - elapsed);
  const gap = daysLeft - idealLeft;
  if (gap >= 4) return { status: "atRisk", gap, idealLeft };
  if (gap >= 1) return { status: "watch", gap, idealLeft };
  return { status: "onTrack", gap, idealLeft };
}

/** Lean shape consumed by `sprintStoryVerdict` / `SprintLoadHealthBadge` —
 *  matches what the local `sprintStories` projection carries. */
export type SprintLoadStoryProjection = {
  id: string;
  title: string;
  estimatedDays: number | null;
  daysLeft: number | null;
  statusKey: UserStoryItem["status"] | null;
};

/** Per-story version of `sprintBurndownVerdict` — buckets a single story's
 *  remaining work against an ideal sprint burndown so we can list flagged
 *  stories in the Sprint Load badge popover. Stories that are review or have
 *  no estimate are reported as `onTrack` so the popover skips them. */
export function sprintStoryVerdict(
  story: SprintLoadStoryProjection,
  sprintDaysLeft: number,
  sprintDaysTotal: number,
): { status: HealthStatus; gap: number } {
  const est = Math.max(0, story.estimatedDays ?? story.daysLeft ?? 0);
  const left = Math.max(0, story.daysLeft ?? est);
  if (left <= 0 || story.statusKey === "review" || story.statusKey === "done") {
    return { status: "done", gap: 0 };
  }
  if (est <= 0 || sprintDaysTotal <= 0) return { status: "onTrack", gap: 0 };
  if (sprintDaysLeft <= 0) return { status: "overdue", gap: left };
  const elapsed = Math.min(1, Math.max(0, (sprintDaysTotal - sprintDaysLeft) / sprintDaysTotal));
  const ideal = est * (1 - elapsed);
  const gap = left - ideal;
  if (gap >= 4) return { status: "atRisk", gap };
  if (gap >= 1) return { status: "watch", gap };
  return { status: "onTrack", gap };
}

type FlaggedStoryEntry = {
  story: SprintLoadStoryProjection;
  gap: number;
};

/**
 * Sprint Load health badge — sibling of `TeamHealthBadgeWithList` (used by
 * Month Team Progress), but the popover lists *stories* (sprint-scoped)
 * instead of epics. Clicking a flagged story title opens the story dialog.
 * Click-outside / Escape closes. Portaled to escape overflow:hidden ancestors
 * exactly like the month variant.
 */
function SprintLoadHealthBadge({
  status,
  rowLabel,
  atRiskStories,
  watchStories,
  overdueStories,
  sprintLabel,
  onOpenStory,
}: {
  status: HealthStatus;
  rowLabel: string;
  atRiskStories: FlaggedStoryEntry[];
  watchStories: FlaggedStoryEntry[];
  overdueStories: FlaggedStoryEntry[];
  sprintLabel?: string;
  onOpenStory?: (storyId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
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
      const popW = 384;
      const right = Math.min(window.innerWidth - 8, r.right);
      const left = Math.max(8, right - popW);
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
  const tipLines: string[] = [`${rowLabel} — ${verdict}`, "Click for details."];
  const flagged = overdueStories.length + atRiskStories.length + watchStories.length;

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
      <HealthBadge status={status} size="xs" tooltip={tipLines.join("\n")} />
      {open && pos && typeof document !== "undefined" ? createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`${rowLabel} — ${verdict} details`}
          style={{ position: "fixed", left: pos.left, bottom: pos.bottom, zIndex: 1000 }}
          className="w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3.5 text-left text-slate-800 shadow-xl"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <p className="mb-2 inline-flex w-full items-center justify-between text-[12.5px] font-bold uppercase tracking-wide text-slate-500">
            <span>{rowLabel} · {verdict}{sprintLabel ? ` · ${sprintLabel}` : ""}</span>
            {flagged > 0 ? <span className="text-[12px] font-semibold normal-case tracking-normal text-slate-400">{flagged} flagged</span> : null}
          </p>
          {(() => {
            const fmtGap = (g: number) => `${g >= 0 ? "+" : "−"}${(Math.round(Math.abs(g) * 10) / 10).toFixed(1)}d`;
            const reasonFor = (entry: FlaggedStoryEntry, kind: "overdue" | "atRisk" | "watch") => {
              const left = Math.max(0, entry.story.daysLeft ?? entry.story.estimatedDays ?? 0);
              if (kind === "overdue") return `${left}d still open · sprint ended`;
              return `${left}d left · ${fmtGap(entry.gap)} vs ideal`;
            };
            const renderList = (
              kind: "overdue" | "atRisk" | "watch",
              entries: FlaggedStoryEntry[],
              titleClass: string,
              heading: string,
            ) => {
              const warnIcon = kind === "overdue"
                ? { Icon: AlertOctagon, className: "text-rose-700" }
                : kind === "atRisk"
                  ? { Icon: AlertTriangle, className: "text-rose-600" }
                  : { Icon: AlertTriangle, className: "text-amber-600" };
              const WarnIcon = warnIcon.Icon;
              return entries.length === 0 ? null : (
                <div className="mb-2.5">
                  <p className={cn("text-[13px] font-semibold", titleClass)}>{heading} ({entries.length})</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {entries.map((e) => (
                      <li key={e.story.id} className="leading-snug">
                        <button
                          type="button"
                          onClick={() => { onOpenStory?.(e.story.id); setOpen(false); }}
                          className="inline-flex w-full items-center gap-1.5 text-left text-[13.5px] font-medium text-blue-700 underline-offset-2 hover:underline"
                        >
                          <UserStoryIcon className="size-3.5 shrink-0 text-sky-500" aria-hidden />
                          <span className="min-w-0 truncate">{e.story.title}</span>
                          <WarnIcon className={cn("size-3.5 shrink-0", warnIcon.className)} aria-hidden />
                        </button>
                        <p className="truncate text-[12px] tabular-nums text-slate-500">{reasonFor(e, kind)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            };
            return (
              <>
                {renderList("overdue", overdueStories, "text-rose-900", "Overdue — sprint ended")}
                {renderList("atRisk", atRiskStories, "text-rose-800", "At Risk — ≥4d above ideal")}
                {renderList("watch", watchStories, "text-amber-800", "Watch — 1–4d above ideal")}
              </>
            );
          })()}
          {flagged === 0 ? (
            <p className="text-[13px] text-slate-500">No flagged stories — everything is on or ahead of pace.</p>
          ) : null}
          <div className="mt-2 border-t border-slate-100 pt-2.5 text-[12.5px] leading-snug text-slate-500">
            <p className="mb-1"><span className="font-semibold text-slate-600">How we score:</span> at each point in the sprint we compare each story&apos;s remaining work to its ideal linear burndown — Δ = remaining − ideal.</p>
            <p>≤ 1d → On Track · 1–4d → Watch · ≥ 4d → At Risk · sprint ended with work left → Overdue.</p>
          </div>
        </div>,
        document.body,
      ) : null}
    </span>
  );
}

/** Compact display name: "John S." — matches the Workload Balance + Sprint Load
 *  bar labels so drilldown rows read the same as the chart they came from. */
function compactAssigneeName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? fullName;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const initial = last?.[0]?.toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}

/** Avatar + compact name ("First L.") for an assignee column. Hover shows the full name. */
function DrilldownAssigneeCell({
  assignee,
  workspaceDirectoryUsers,
}: {
  assignee: string | null | undefined;
  workspaceDirectoryUsers?: readonly { name: string; team?: string; image?: string | null }[];
}) {
  const name = assignee?.trim();
  if (!name) return <span className="text-slate-500">Unassigned</span>;
  const resolved = resolveAssigneeAvatar(name, workspaceDirectoryUsers);
  const compact = compactAssigneeName(name);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={name}>
      <UserAvatar name={resolved.name} image={resolved.image} size={18} className="ring-0" />
      <span className="truncate">{compact}</span>
    </span>
  );
}

/** Cumulative flow diagram stack: first rendered area = bottom (most "done"), last = top (not started). */
const CFD_FLOW_SEGMENTS = [
  { key: "done" as const, label: "Done", color: STATUS_COLORS["Done"] },
  { key: "review" as const, label: "Review / Testing", color: STATUS_COLORS["Review / Testing"] },
  { key: "inProgress" as const, label: "In progress", color: STATUS_COLORS["In progress"] },
  { key: "todo" as const, label: "To do", color: STATUS_COLORS["To do"] },
] as const;

/**
 * Compact plot height so two rows of charts fit without excess scrolling (uses dynamic viewport height).
 * Matches pie, burndown, cumulative flow, and caps workload list beside pie.
 */
const SPRINT_CHART_BOX =
  "h-[clamp(14.75rem,30vh,19rem)] min-h-[14.75rem] w-full bg-white/85";
/** Same dimensions as {@link SPRINT_CHART_BOX} without border/ring (User Stories Status pie only). */
const SPRINT_STATUS_PIE_BOX =
  "h-[clamp(14.75rem,30vh,19rem)] min-h-[14.75rem] w-full bg-white/85";
/** Keep legend beside pie from growing taller than the pie plot on md+. */
const PIE_LEGEND_CAP = "max-h-[clamp(14.75rem,30vh,19rem)] overflow-y-auto pr-1";
const WORKLOAD_LIST_MAX =
  "max-h-[clamp(11.5rem,21vh,15.5rem)] overflow-y-auto overflow-x-hidden overscroll-contain";

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
  /** Map keyed by the X-axis label (first name) → uploaded image URL.
   *  When present, the tick swaps the generic UserRound for the photo. */
  avatarByFirstName?: Map<string, string | null>;
  /** Team-mode parallel: team label → team logo URL. Falls back to Users
   *  glyph when the team has no logo. */
  teamImageByLabel?: Map<string, string | null>;
}) {
  if (x == null || y == null) return null;
  const label = payload?.value ?? "";
  const rowY = y + 11;
  // Bigger icon so uploaded photos read as actual avatars rather than dots;
  // text width math + horizontal centering follow.
  const iconSize = 16;
  const estTextWidth = Math.min(label.length * 5.5, 70);
  const totalWidth = iconSize + 4 + estTextWidth;
  const iconX = x - totalWidth / 2;
  const textStartX = iconX + iconSize + 4;
  // Person rows: user's photo when available, else UserRound.
  // Team rows: team logo when available, else Users glyph.
  const photoUrl = teamMode
    ? teamImageByLabel?.get(label) ?? null
    : avatarByFirstName?.get(label) ?? null;
  const safeId = label.replace(/\W+/g, "-");
  return (
    <g>
      {photoUrl ? (
        <>
          {/* Recharts SVG context — circular clip-path so the photo reads as
           *  an avatar instead of a square. Unique clipId per tick so several
           *  ticks in the same chart don't share clipping. */}
          <defs>
            <clipPath id={`workload-avatar-clip-${safeId}`}>
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
            clipPath={`url(#workload-avatar-clip-${safeId})`}
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
  color: string;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className="inline-flex items-center gap-1.5 text-slate-600">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
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

type SprintAnalyticsProps = {
  initiatives: InitiativeItem[];
  month: number;
  yearSprint: number;
  planYear: number;
  filterEpicTeamIds?: string[] | null;
  /** When provided, Sprint load matches Sprint capacity board caps and bucket assignments. */
  sprintCapacityBoard?: { capacities: Record<string, number>; assignments: Record<string, string[]> } | null;
  /** Users directory rows — merged into assignee rosters for the active team filter. */
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  onOpenStory?: (storyId: string) => void;
};

export function SprintAnalytics({
  initiatives,
  month,
  yearSprint,
  planYear,
  filterEpicTeamIds = null,
  sprintCapacityBoard = null,
  workspaceDirectoryUsers = [],
  onOpenStory,
}: SprintAnalyticsProps) {
  // App-wide team slug → logo URL map; used to paint team logos on
  // workload-chart ticks and other team renders in this component.
  const teamImagesBySlug = useTeamImages();
  const [metric, setMetric] = useState<BurndownMetric>("daysLeft");
  const [estimateSource, setEstimateSource] = useState<EstimateSource>("stories");
  const [workloadStatusFilters, setWorkloadStatusFilters] = useState<SprintWorkloadFilterKey[]>(["all"]);
  const [cfdVisibleKeys, setCfdVisibleKeys] = useState<SprintCfdKey[]>(() => CFD_FLOW_SEGMENTS.map((segment) => segment.key));
  const [statusDrilldownFilter, setStatusDrilldownFilter] = useState<string | null>(null);
  const [workloadDrilldownAssignee, setWorkloadDrilldownAssignee] = useState<string | null>(null);
  const [workloadDrilldownIsTeam, setWorkloadDrilldownIsTeam] = useState(false);
  const [sprintLoadDrilldownAssignee, setSprintLoadDrilldownAssignee] = useState<string | null>(null);
  const [sprintLoadDrilldownIsTeam, setSprintLoadDrilldownIsTeam] = useState(false);
  // Per-column filter state for the three drilldown modal tables. The text
  // input filters by substring (title); the dropdowns filter by exact match
  // on the visible label of the column. Cleared when the underlying drilldown
  // changes so re-opening starts fresh.
  type SprintDrilldownColFilter = { title: string; team: string | null; sprint: string | null; assignee: string | null; status: string | null };
  const EMPTY_SPRINT_DRILLDOWN_FILTER: SprintDrilldownColFilter = { title: "", team: null, sprint: null, assignee: null, status: null };
  const [statusDrilldownColFilter, setStatusDrilldownColFilter] = useState<SprintDrilldownColFilter>(EMPTY_SPRINT_DRILLDOWN_FILTER);
  const [workloadDrilldownColFilter, setWorkloadDrilldownColFilter] = useState<SprintDrilldownColFilter>(EMPTY_SPRINT_DRILLDOWN_FILTER);
  const [sprintLoadDrilldownColFilter, setSprintLoadDrilldownColFilter] = useState<SprintDrilldownColFilter>(EMPTY_SPRINT_DRILLDOWN_FILTER);
  /**
   * Per-drilldown column filters are set explicitly by each click handler
   * (slice → status pre-fill, bar → assignee/team pre-fill). The earlier
   * auto-reset to EMPTY on every drilldown change would wipe the pre-fills
   * before the table rendered. Closing the modal preserves the user's
   * column filter state for the next open; the next click overwrites it.
   */
  const [sprintTimelinePopupOpen, setSprintTimelinePopupOpen] = useState(false);
  const analytics = useMemo(
    () =>
      buildSprintAnalytics(
        initiatives,
        month,
        yearSprint,
        metric,
        planYear,
        filterEpicTeamIds,
        estimateSource,
        sprintCapacityBoard,
        workspaceDirectoryUsers,
      ),
    [
      initiatives,
      month,
      yearSprint,
      metric,
      planYear,
      filterEpicTeamIds,
      estimateSource,
      sprintCapacityBoard,
      workspaceDirectoryUsers,
    ],
  );

  const pieData = analytics.statusPie.filter((x) => x.value > 0);
  const pieTotal = pieData.reduce((sum, item) => sum + item.value, 0);
  const selectedWorkloadStatuses = useMemo<SprintWorkloadStatusKey[]>(
    () =>
      workloadStatusFilters.includes("all")
        ? WORKLOAD_BAR_SEGMENTS.map((segment) => segment.key)
        : (workloadStatusFilters.filter((v) => v !== "all") as SprintWorkloadStatusKey[]),
    [workloadStatusFilters],
  );
  const toggleWorkloadStatusFilter = (value: SprintWorkloadFilterKey) => {
    setWorkloadStatusFilters((prev) => {
      if (value === "all") return ["all"];
      if (prev.includes("all")) return [value];
      if (prev.includes(value)) {
        const next = prev.filter((v) => v !== value);
        return next.length > 0 ? next : ["all"];
      }
      return [...prev, value];
    });
  };
  const visibleWorkloadByAssignee = useMemo(
    () =>
      analytics.workloadByAssignee
        .map((item) => ({
          ...item,
          selectedStoryCount: selectedWorkloadStatuses.reduce((sum, key) => sum + item.storiesByStatus[key], 0),
        }))
        .filter((item) => item.selectedStoryCount > 0),
    [analytics.workloadByAssignee, selectedWorkloadStatuses],
  );
  // Extend burn-up and CFD to the full sprint x-axis; future days get null for actual values.
  const cfdExtendedData = useMemo(() => {
    const pastByLabel = new Map(analytics.flowSprintTrendData.map((d) => [d.labelShort, d]));
    return analytics.burndown.map((bd) => {
      const past = pastByLabel.get(bd.labelShort);
      return past ?? { labelShort: bd.labelShort, isToday: bd.isToday, dayInSprint: null, todo: null, inProgress: null, review: null, done: null };
    });
  }, [analytics.burndown, analytics.flowSprintTrendData]);

  const burnUpData = useMemo(() => {
    const allDays = analytics.burndown;
    if (allDays.length === 0) return [];

    if (metric === "daysLeft") {
      // Days mode: scope is total estimated days for the sprint (constant); completed = scope − burndown.actual remaining.
      const totalEst =
        analytics.workloadByTeam.reduce((sum, t) => sum + t.estimatedTotal, 0) ||
        analytics.workloadByAssignee.reduce((sum, r) => sum + r.estimatedTotal, 0);
      return allDays.map((bd, idx) => {
        const remaining = bd.actual;
        const completed = remaining == null ? null : Math.max(0, Math.round(totalEst - remaining));
        const ideal = totalEst > 0 ? Math.round((totalEst * idx) / Math.max(allDays.length - 1, 1)) : 0;
        return { labelShort: bd.labelShort, scope: Math.round(totalEst), completed, ideal, isToday: bd.isToday };
      });
    }

    // Stories mode (default): scope/completed from the daily status flow trend.
    const pastByLabel = new Map(analytics.flowSprintTrendData.map((d) => [d.labelShort, d]));
    const lastPast = analytics.flowSprintTrendData[analytics.flowSprintTrendData.length - 1];
    const finalScope = lastPast ? lastPast.todo + lastPast.inProgress + lastPast.review + lastPast.done : 0;
    return allDays.map((bd, idx) => {
      const past = pastByLabel.get(bd.labelShort);
      const scope = past ? past.todo + past.inProgress + past.review + past.done : finalScope;
      const completed = past != null ? past.review + past.done : null;
      const ideal = finalScope > 0 ? Math.round((finalScope * idx) / Math.max(allDays.length - 1, 1)) : 0;
      return { labelShort: bd.labelShort, scope, completed, ideal, isToday: bd.isToday };
    });
  }, [analytics.burndown, analytics.flowSprintTrendData, analytics.workloadByTeam, analytics.workloadByAssignee, metric]);

  const allCfdKeysSelected = cfdVisibleKeys.length === CFD_FLOW_SEGMENTS.length;
  const showAllCfdKeys = () => setCfdVisibleKeys(CFD_FLOW_SEGMENTS.map((segment) => segment.key));
  const toggleCfdKey = (key: SprintCfdKey) => {
    setCfdVisibleKeys((prev) => {
      const has = prev.includes(key);
      if (!has) return [...prev, key];
      if (prev.length === 1) return prev;
      return prev.filter((k) => k !== key);
    });
  };

  const sprintStories = useMemo(() => {
    /**
     * Drilldown sources for the Workload Balance / Sprint Load / Status pie
     * row tables — read LIVE initiatives so they MATCH what the charts and
     * the kanban show. The earlier projection-on-close path showed moved
     * stories as if they were still in this sprint, which made the
     * Workload drilldown contradict the LIVE pie (e.g. pie says 100% Done
     * but drilldown shows To Do / Review rows that were actually moved to
     * the next sprint).
     *
     * Scope: iterate every team-filtered epic across all initiatives (no
     * epic-month-plan filter) so we don't drop sprint-10 stories whose
     * parent epic is planned outside May — same fix as `collectMonthStories`
     * in lib/sprint-analytics.ts.
     */
    const teamMemberNames = new Set<string>();
    if (filterEpicTeamIds?.length && workspaceDirectoryUsers) {
      const filterLower = new Set(filterEpicTeamIds.map((t) => t.toLowerCase()));
      for (const u of workspaceDirectoryUsers) {
        const team = (u.team ?? "").trim().toLowerCase();
        const name = (u.name ?? "").trim().toLowerCase();
        if (team && name && filterLower.has(team)) teamMemberNames.add(name);
      }
    }
    const rows: Array<{
      id: string;
      title: string;
      assignee: string;
      team: string;
      sprint: number | null;
      status: "Unscheduled" | "To do" | "In progress" | "Review / Testing" | "Done";
      /** Raw enum (`todo|inProgress|review|done`) preserved alongside the display label so
       *  burndown-style verdict helpers don't have to reverse-map the friendly string. */
      statusKey: UserStoryItem["status"] | null;
      estimatedDays: number | null;
      daysLeft: number | null;
    }> = [];
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
      const epicTeamInFilter =
        !filterEpicTeamIds?.length || filterEpicTeamIds.includes(epic.team ?? "");
      for (const story of epic.userStories ?? []) {
        const isInSprint = story.sprint != null && storyMatchesYearSprint(story, month, yearSprint);
        const isUnscheduled = story.sprint == null;
        if (!isInSprint && !isUnscheduled) continue;
        if (!epicTeamInFilter) {
          if (teamMemberNames.size === 0) continue;
          const a = (story.assignee ?? "").trim().toLowerCase();
          if (!a || !teamMemberNames.has(a)) continue;
        }
        rows.push({
          id: story.id,
          title: story.title,
          assignee: story.assignee?.trim() || "Unassigned",
          team: epic.team ?? "",
          sprint: story.sprint ?? null,
          status:
            story.sprint == null
              ? "Unscheduled"
              : story.status === "todo"
                ? "To do"
                : story.status === "inProgress"
                  ? "In progress"
                  : story.status === "review"
                    ? "Review / Testing"
                    : "Done",
          statusKey: story.sprint == null ? null : story.status,
          estimatedDays: story.estimatedDays ?? null,
          daysLeft: story.daysLeft ?? null,
        });
      }
      }
    }
    return rows;
  }, [initiatives, month, yearSprint, planYear, filterEpicTeamIds, workspaceDirectoryUsers]);

  // Pre-column-filter pools. The "Raw" rows drive the unique-value pickers in
  // each column header so removing a filter restores all options; the final
  // `*Stories` memos below apply `*ColFilter` on top of these.
  // The pie click emits the friendly slice name (e.g. "Review / Testing")
  // but the projection's `story.status` carries the SAME friendly label;
  // the underlying enum lives on `statusKey`. The earlier comparison was
  // `story.status === friendlyLabel` which should have matched — but pie
  // tooltips and chart labels were drifting between the two name spaces
  // after the enum rename, so go through `statusKey` explicitly to make
  // the filter robust to either label set.
  /**
   * Drilldown raw pools now hold the FULL sprint scope; the slice / bar
   * that was clicked pre-populates the column filter instead of pre-cutting
   * the data. Lets the planner clear the pre-set filter to see everything,
   * and keeps the per-column option dropdowns honest (otherwise the dropdowns
   * would only ever show the one pre-cut value).
   */
  const statusDrilldownStoriesRaw = useMemo(
    () => (statusDrilldownFilter ? sprintStories : []),
    [statusDrilldownFilter, sprintStories],
  );

  const workloadDrilldownStoriesRaw = useMemo(
    () => (workloadDrilldownAssignee ? sprintStories : []),
    [workloadDrilldownAssignee, sprintStories],
  );

  function applyDrilldownColFilter(
    rows: typeof sprintStories,
    f: SprintDrilldownColFilter,
    yearSprintCtx: number,
  ): typeof sprintStories {
    return rows.filter((s) => {
      if (f.title && !s.title.toLowerCase().includes(f.title.toLowerCase())) return false;
      if (f.team != null) {
        const label = monthTeamLabelForId(s.team) ?? (s.team || "—");
        if (label !== f.team) return false;
      }
      if (f.sprint != null) {
        const label = s.sprint == null ? "Unscheduled" : `Sprint ${yearSprintCtx}`;
        if (label !== f.sprint) return false;
      }
      if (f.assignee != null) {
        const label = s.assignee?.trim() || "Unassigned";
        if (label !== f.assignee) return false;
      }
      if (f.status != null && s.status !== f.status) return false;
      return true;
    });
  }

  const statusDrilldownStories = useMemo(
    () => applyDrilldownColFilter(statusDrilldownStoriesRaw, statusDrilldownColFilter, yearSprint),
    [statusDrilldownStoriesRaw, statusDrilldownColFilter, yearSprint],
  );
  const workloadDrilldownStories = useMemo(
    () => applyDrilldownColFilter(workloadDrilldownStoriesRaw, workloadDrilldownColFilter, yearSprint),
    [workloadDrilldownStoriesRaw, workloadDrilldownColFilter, yearSprint],
  );
  const sprintStoryDisplayIds = useMemo(() => {
    const allStories = initiatives
      .flatMap((initiative) => initiative.epics ?? [])
      .flatMap((epic) => epic.userStories ?? [])
      .sort((a, b) => {
        const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (t !== 0) return t;
        return a.title.localeCompare(b.title);
      });
    const map = new Map<string, string>();
    allStories.forEach((story, index) => {
      map.set(story.id, `US-${String(index + 1).padStart(2, "0")}`);
    });
    return map;
  }, [initiatives]);

  const statusDrilldownScrollRef = useRef<HTMLDivElement | null>(null);
  const workloadDrilldownScrollRef = useRef<HTMLDivElement | null>(null);
  const sprintLoadScrollRef = useRef<HTMLDivElement | null>(null);
  const sprintLoadDrilldownScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollStatusUp, setCanScrollStatusUp] = useState(false);
  const [canScrollStatusDown, setCanScrollStatusDown] = useState(false);
  const [canScrollWorkloadUp, setCanScrollWorkloadUp] = useState(false);
  const [canScrollWorkloadDown, setCanScrollWorkloadDown] = useState(false);
  const [canScrollSprintLoadUp, setCanScrollSprintLoadUp] = useState(false);
  const [canScrollSprintLoadDown, setCanScrollSprintLoadDown] = useState(false);
  const [canScrollSprintLoadDrilldownUp, setCanScrollSprintLoadDrilldownUp] = useState(false);
  const [canScrollSprintLoadDrilldownDown, setCanScrollSprintLoadDrilldownDown] = useState(false);

  const updateArrowState = (
    ref: RefObject<HTMLDivElement | null>,
    setUp: (v: boolean) => void,
    setDown: (v: boolean) => void,
  ) => {
    const node = ref.current;
    if (!node) {
      setUp(false);
      setDown(false);
      return;
    }
    const epsilon = 2;
    setUp(node.scrollTop > epsilon);
    setDown(node.scrollTop + node.clientHeight < node.scrollHeight - epsilon);
  };
  useEffect(() => {
    updateArrowState(statusDrilldownScrollRef, setCanScrollStatusUp, setCanScrollStatusDown);
  }, [statusDrilldownStories.length, statusDrilldownFilter]);
  useEffect(() => {
    updateArrowState(workloadDrilldownScrollRef, setCanScrollWorkloadUp, setCanScrollWorkloadDown);
  }, [workloadDrilldownStories.length, workloadDrilldownAssignee]);

  const sprintLoadDrilldownStoriesRaw = useMemo(
    () => (sprintLoadDrilldownAssignee ? sprintStories : []),
    [sprintLoadDrilldownAssignee, sprintStories],
  );
  const sprintLoadDrilldownStories = useMemo(
    () => applyDrilldownColFilter(sprintLoadDrilldownStoriesRaw, sprintLoadDrilldownColFilter, yearSprint),
    [sprintLoadDrilldownStoriesRaw, sprintLoadDrilldownColFilter, yearSprint],
  );

  useEffect(() => {
    updateArrowState(sprintLoadScrollRef, setCanScrollSprintLoadUp, setCanScrollSprintLoadDown);
  }, [analytics.workloadByAssignee.length, analytics.workloadByTeam.length]);
  useEffect(() => {
    updateArrowState(sprintLoadDrilldownScrollRef, setCanScrollSprintLoadDrilldownUp, setCanScrollSprintLoadDrilldownDown);
  }, [sprintLoadDrilldownStories.length, sprintLoadDrilldownAssignee]);

  const chartLegendColumnClass =
    "max-h-[clamp(14.75rem,30vh,19rem)] space-y-1.5 overflow-y-auto pr-0 md:justify-self-end md:w-[12.5rem]";
  const legendRowClass =
    "flex items-center justify-between rounded-md px-1 py-1 text-left text-[13px] font-medium text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-700";

  return (
    <section
      className="mb-2 flex flex-col gap-4 rounded-xl p-4"
      style={{
        backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-1 lg:h-full">
        <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
            <PieChartIcon className="size-4 text-slate-600" />
            User Stories Status
          </h3>
        </div>
        {statusDrilldownFilter ? (
          <InsightsDrilldownModal
            title={`User Stories Status · ${statusDrilldownFilter}`}
            subtitle={`${statusDrilldownStories.length} user stor${statusDrilldownStories.length === 1 ? "y" : "ies"} presented`}
            icon={<PieChartIcon className="size-4 text-slate-600" aria-hidden />}
            onClose={() => setStatusDrilldownFilter(null)}
          >
          <div className="relative h-full min-h-0 bg-white/80">
            <div className="relative h-full min-h-0">
              <div
                ref={statusDrilldownScrollRef}
                onScroll={() => updateArrowState(statusDrilldownScrollRef, setCanScrollStatusUp, setCanScrollStatusDown)}
                className="h-full overflow-auto rounded-none bg-white pr-5 [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
                  <thead className="sticky top-0 z-10 bg-[#0897d5] text-white backdrop-blur">
                    <tr>
                      <th className="w-10 px-2 py-1.5 text-right text-[14px] font-bold">#</th>
                      <th className="px-2 py-1.5 text-[14px] font-bold">Story ID</th>
                      <th className="px-2 py-1.5 text-[14px] font-bold">Story name</th>
                      <th className="px-2 py-1.5 text-[14px] font-bold">Sprint</th>
                      <th className="px-2 py-1.5 text-[14px] font-bold">Assignee</th>
                      <th className="px-2 py-1.5 text-[14px] font-bold">Status</th>
                      <th className="px-2 py-1.5 text-right text-[14px] font-bold">Est days</th>
                      <th className="px-2 py-1.5 text-right text-[14px] font-bold">Est days left</th>
                    </tr>
                    <tr className="bg-white/95">
                      <th className="px-1 py-0.5" />
                      <th className="px-1 py-0.5" />
                      <th className="px-1 py-0.5">
                        <DrilldownFilterInputText
                          value={statusDrilldownColFilter.title}
                          onChange={(v) => setStatusDrilldownColFilter((p) => ({ ...p, title: v }))}
                          ariaLabel="Filter status drilldown by story name"
                        />
                      </th>
                      <th className="px-1 py-0.5">
                        <DrilldownFilterDropdown
                          value={statusDrilldownColFilter.sprint}
                          options={Array.from(new Set(statusDrilldownStoriesRaw.map((s) => s.sprint == null ? "Unscheduled" : `Sprint ${yearSprint}`))).sort()}
                          renderOption={(v) => <span className="truncate">{v}</span>}
                          onChange={(v) => setStatusDrilldownColFilter((p) => ({ ...p, sprint: v }))}
                          ariaLabel="Filter status drilldown by sprint"
                        />
                      </th>
                      <th className="px-1 py-0.5">
                        <DrilldownFilterDropdown
                          value={statusDrilldownColFilter.assignee}
                          options={Array.from(new Set(statusDrilldownStoriesRaw.map((s) => s.assignee?.trim() || "Unassigned"))).filter(Boolean).sort()}
                          renderOption={(v) => <span className="truncate">{v}</span>}
                          onChange={(v) => setStatusDrilldownColFilter((p) => ({ ...p, assignee: v }))}
                          ariaLabel="Filter status drilldown by assignee"
                        />
                      </th>
                      <th className="px-1 py-0.5">
                        <DrilldownFilterDropdown
                          value={statusDrilldownColFilter.status}
                          options={Array.from(new Set(statusDrilldownStoriesRaw.map((s) => s.status))).sort()}
                          renderOption={(v) => <span className="truncate">{v}</span>}
                          onChange={(v) => setStatusDrilldownColFilter((p) => ({ ...p, status: v }))}
                          ariaLabel="Filter status drilldown by status"
                        />
                      </th>
                      {/* Σ totals over the currently visible (filtered) rows
                       *  so the user always sees how much est-days work the
                       *  drilldown represents, even after filtering by name /
                       *  status / assignee. */}
                      <th className="px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                        Σ <span className="text-slate-300">|</span> {statusDrilldownStories.reduce((sum, s) => sum + (s.estimatedDays ?? 0), 0)}
                      </th>
                      <th className="px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                        Σ <span className="text-slate-300">|</span> {statusDrilldownStories.reduce((sum, s) => sum + (s.daysLeft ?? 0), 0)}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusDrilldownStories.map((story, idx) => (
                      <tr key={story.id} className="border-t border-[#7cd3f7]/95 text-slate-700 odd:bg-[#d8f2ff] even:bg-white transition hover:bg-[#c5ebff]">
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{idx + 1}</td>
                        <td className="px-2 py-1.5">
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <UserStoryIcon className="size-3.5" />
                            <button
                              type="button"
                              onClick={() => onOpenStory?.(story.id)}
                              className="truncate font-semibold text-blue-700 underline-offset-2 hover:underline"
                            >
                              {sprintStoryDisplayIds.get(story.id) ?? story.id}
                            </button>
                          </span>
                        </td>
                        <td className="px-2 py-1.5">{story.title}</td>
                        <td className="px-2 py-1.5">{story.sprint == null ? "Unscheduled" : `Sprint ${yearSprint}`}</td>
                        <td className="px-2 py-1.5">
                          <DrilldownAssigneeCell assignee={story.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                        </td>
                        <td className="px-2 py-1.5">
                          <StoryStatusPill status={story.status} />
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{story.estimatedDays ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{story.daysLeft ?? "—"}</td>
                      </tr>
                    ))}
                    {statusDrilldownStories.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-[13px] text-slate-500">
                          No stories in this status.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => statusDrilldownScrollRef.current?.scrollBy({ top: -96, behavior: "smooth" })}
                className={cn(
                  "absolute -right-[2px] top-0 inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                  canScrollStatusUp && "bg-slate-200/70 text-slate-800",
                )}
                aria-label="Scroll up status stories"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => statusDrilldownScrollRef.current?.scrollBy({ top: 96, behavior: "smooth" })}
                className={cn(
                  "absolute bottom-0 -right-[2px] inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                  canScrollStatusDown && "bg-slate-200/70 text-slate-800",
                )}
                aria-label="Scroll down status stories"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
          </div>
          </InsightsDrilldownModal>
        ) : null}
        <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_12.5rem] md:items-stretch">
          <div className={`relative ${SPRINT_STATUS_PIE_BOX}`}>
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <defs>
                  <filter id="sprintPieShadow">
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
                  filter="url(#sprintPieShadow)"
                  onClick={(entry) => {
                    const name = String((entry as { name?: string }).name ?? "");
                    setStatusDrilldownFilter(name);
                    // Pre-populate the Status column filter to the clicked
                    // slice so the table opens narrowed but the user can
                    // clear it to see every status.
                    setStatusDrilldownColFilter({ ...EMPTY_SPRINT_DRILLDOWN_FILTER, status: name });
                  }}
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const row = payload[0];
                    const raw = Number(row?.value ?? 0);
                    const pct = pieTotal > 0 ? Math.round((raw / pieTotal) * 100) : 0;
                    return (
                      <AnalyticsTooltipShell title={String(label ?? "User Stories Status")}>
                        <AnalyticsTooltipRow
                          color={(row?.color as string) ?? "#94a3b8"}
                          label={String(row?.name ?? "Status")}
                          value={`${raw} (${pct}%)`}
                        />
                      </AnalyticsTooltipShell>
                    );
                  }}
                />
              </PieChart>
              </ResponsiveContainer>
            </div>
            {pieTotal > 0 ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => {
                    // Center click opens the drilldown with NO pre-filter —
                    // shows every sprint story regardless of status.
                    setStatusDrilldownFilter("All");
                    setStatusDrilldownColFilter(EMPTY_SPRINT_DRILLDOWN_FILTER);
                  }}
                  title="See all stories in this sprint"
                  className="pointer-events-auto flex flex-col items-center rounded-full px-3 py-1 leading-none transition hover:bg-slate-50/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                >
                  <span className="text-[28px] font-bold tabular-nums text-slate-900">{pieTotal}</span>
                  <span className="mt-1 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">
                    {pieTotal === 1 ? "story" : "stories"}
                  </span>
                </button>
              </div>
            ) : null}
          </div>
          <div className={`space-y-1.5 ${PIE_LEGEND_CAP}`}>
            {pieData.map((slice) => {
              const pct = pieTotal > 0 ? Math.round((slice.value / pieTotal) * 100) : 0;
              return (
                <div
                  key={slice.name}
                  className="flex items-center justify-between rounded-lg bg-slate-50/80 px-2 py-1.5"
                >
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[slice.name] ?? "#94a3b8" }}
                    />
                    {slice.name}
                  </span>
                  <span className="text-[13px] font-semibold text-slate-900">
                    {slice.value} <span className="text-slate-500">({pct}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </article>

      <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-2 lg:h-full lg:pl-4">
        <div className="mb-5 flex shrink-0 items-center justify-between gap-2">
          <h3 className="ml-[48px] inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
            <Activity className="size-4 text-slate-600" />
            Burndown
          </h3>
          <div className="flex items-center gap-2">
            <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setMetric("daysLeft")}
                className={`rounded-md px-2 py-0 text-[13px] font-medium ${
                  metric === "daysLeft" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600"
                }`}
              >
                Est Days Left
              </button>
              <button
                type="button"
                onClick={() => setMetric("storyCount")}
                className={`rounded-md px-2 py-0 text-[13px] font-medium ${
                  metric === "storyCount" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600"
                }`}
              >
                Stories
              </button>
            </div>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 pl-5 md:grid-cols-[minmax(0,1fr)_12.5rem] md:items-stretch">
          <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics.burndown} margin={{ top: 2, right: 4, left: 18, bottom: 22 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="labelShort"
                    interval="preserveStartEnd"
                    tick={(props) => {
                      const { x, y, payload, index } = props;
                      const label = typeof payload?.value === "string" ? payload.value : String(payload?.value ?? "");
                      const isToday = Boolean(analytics.burndown[index]?.isToday);
                      return (
                        <text
                          x={x}
                          y={y}
                          dy={8}
                          textAnchor="end"
                          transform={`rotate(-28,${x},${y})`}
                          fill={isToday ? "#0f172a" : "#64748b"}
                          fontSize={isToday ? 13 : 11}
                          fontWeight={isToday ? 700 : 400}
                        >
                          {label}
                        </text>
                      );
                    }}
                    height={34}
                  />
                  <YAxis
                    allowDecimals={metric !== "storyCount"}
                    tick={{ fontSize: 10 }}
                    width={44}
                    label={{
                      value: metric === "storyCount" ? "Stories" : "Est Days Left",
                      angle: -90,
                      position: "insideLeft",
                      fill: "#64748b",
                      fontSize: 13,
                    }}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const point = payload[0]?.payload as {
                        actualStories?: number | null;
                        actualDaysLeft?: number | null;
                        totalStories?: number;
                        totalDaysLeft?: number;
                      } | undefined;
                      return (
                        <AnalyticsTooltipShell title={String(label ?? "Burndown")}>
                          {payload.map((row, idx) => (
                            <AnalyticsTooltipRow
                              key={`${String(row.name)}-${idx}`}
                              color={(row.color as string) ?? "#94a3b8"}
                              label={String(row.name ?? "")}
                              value={
                                metric === "storyCount" && typeof row.value === "number"
                                  ? Math.round(row.value)
                                  : String(row.value ?? "")
                              }
                            />
                          ))}
                          {/* Cross-metric breakdown so the hover always reads
                           *  "what's left to complete" in BOTH stories and
                           *  est-days, no matter which series is plotted. */}
                          {point && point.actualStories != null && point.totalStories != null ? (
                            <div className="mt-1.5 border-t border-slate-200/70 pt-1.5 text-[11px] text-slate-500">
                              <div className="flex items-center justify-between gap-2">
                                <span>Stories left</span>
                                <span className="font-semibold tabular-nums text-slate-700">
                                  {point.actualStories} <span className="text-slate-400">/ {point.totalStories}</span>
                                </span>
                              </div>
                              {point.actualDaysLeft != null && point.totalDaysLeft != null ? (
                                <div className="mt-0.5 flex items-center justify-between gap-2">
                                  <span>Est days left</span>
                                  <span className="font-semibold tabular-nums text-slate-700">
                                    {point.actualDaysLeft} <span className="text-slate-400">/ {point.totalDaysLeft}</span>
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </AnalyticsTooltipShell>
                      );
                    }}
                  />
                  {analytics.burndown.find((d) => d.isToday) && (
                    <ReferenceLine
                      x={analytics.burndown.find((d) => d.isToday)?.labelShort}
                      stroke="#94a3b8"
                      strokeDasharray="4 2"
                      label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
                    />
                  )}
                  <Line type="monotone" dataKey="ideal" stroke="#94a3b8" dot={false} name="Ideal" />
                  <Line type="monotone" dataKey="actual" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls={false} name="Actual" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className={chartLegendColumnClass}>
            <div className={legendRowClass}>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[#94a3b8]" />
                <span>Ideal</span>
              </span>
            </div>
            <div className={legendRowClass}>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[#2563eb]" />
                <span>Actual</span>
              </span>
            </div>
          </div>
        </div>
      </article>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-1 lg:h-full">
        <div className="mb-2.5 flex shrink-0 items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
            <ChartNoAxesCombined className="size-4 text-slate-600" />
            Workload Balance
          </h3>
        </div>
        {workloadDrilldownAssignee ? (
          <InsightsDrilldownModal
            title={`Workload Balance · ${workloadDrilldownAssignee}`}
            subtitle={`${workloadDrilldownStories.length} user stor${workloadDrilldownStories.length === 1 ? "y" : "ies"} presented`}
            icon={<ChartNoAxesCombined className="size-4 text-slate-600" aria-hidden />}
            onClose={() => { setWorkloadDrilldownAssignee(null); setWorkloadDrilldownIsTeam(false); }}
          >
          <div className="h-full bg-white/80">
            <div className="relative h-full min-h-0">
              <div
                ref={workloadDrilldownScrollRef}
                onScroll={() => updateArrowState(workloadDrilldownScrollRef, setCanScrollWorkloadUp, setCanScrollWorkloadDown)}
                className="h-full overflow-auto rounded-none bg-white pr-5 shadow-sm ring-1 ring-sky-100/90 [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead className="sticky top-0 bg-[#0897d5] text-white">
                    <tr>
                      <th className="w-10 px-2 py-1 text-right text-[14px] font-semibold">#</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Story ID</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Story name</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Team</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Sprint</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Assignee</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Status</th>
                      <th className="px-2 py-1 text-right text-[14px] font-semibold">Est days</th>
                      <th className="px-2 py-1 text-right text-[14px] font-semibold">Est days left</th>
                    </tr>
                    <tr className="bg-white/95">
                      <th className="px-1 py-0.5" />
                      <th className="px-1 py-0.5" />
                      <th className="px-1 py-0.5">
                        <DrilldownFilterInputText
                          value={workloadDrilldownColFilter.title}
                          onChange={(v) => setWorkloadDrilldownColFilter((p) => ({ ...p, title: v }))}
                          ariaLabel="Filter workload by story name"
                        />
                      </th>
                      <th className="px-1 py-0.5">
                        <DrilldownFilterDropdown
                          value={workloadDrilldownColFilter.team}
                          options={Array.from(new Set(workloadDrilldownStoriesRaw.map((s) => monthTeamLabelForId(s.team) ?? (s.team || "—")))).sort()}
                          renderOption={(v) => <span className="truncate">{v}</span>}
                          onChange={(v) => setWorkloadDrilldownColFilter((p) => ({ ...p, team: v }))}
                          ariaLabel="Filter workload by team"
                        />
                      </th>
                      <th className="px-1 py-0.5">
                        <DrilldownFilterDropdown
                          value={workloadDrilldownColFilter.sprint}
                          options={Array.from(new Set(workloadDrilldownStoriesRaw.map((s) => s.sprint == null ? "Unscheduled" : `Sprint ${yearSprint}`))).sort()}
                          renderOption={(v) => <span className="truncate">{v}</span>}
                          onChange={(v) => setWorkloadDrilldownColFilter((p) => ({ ...p, sprint: v }))}
                          ariaLabel="Filter workload by sprint"
                        />
                      </th>
                      <th className="px-1 py-0.5">
                        <DrilldownFilterDropdown
                          value={workloadDrilldownColFilter.assignee}
                          options={Array.from(new Set(workloadDrilldownStoriesRaw.map((s) => s.assignee?.trim() || "Unassigned"))).filter(Boolean).sort()}
                          renderOption={(v) => <span className="truncate">{v}</span>}
                          onChange={(v) => setWorkloadDrilldownColFilter((p) => ({ ...p, assignee: v }))}
                          ariaLabel="Filter workload by assignee"
                        />
                      </th>
                      <th className="px-1 py-0.5">
                        <DrilldownFilterDropdown
                          value={workloadDrilldownColFilter.status}
                          options={Array.from(new Set(workloadDrilldownStoriesRaw.map((s) => s.status))).sort()}
                          renderOption={(v) => <span className="truncate">{v}</span>}
                          onChange={(v) => setWorkloadDrilldownColFilter((p) => ({ ...p, status: v }))}
                          ariaLabel="Filter workload by status"
                        />
                      </th>
                      {/* Σ totals over the currently visible (filtered) rows. */}
                      <th className="px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                        Σ <span className="text-slate-300">|</span> {workloadDrilldownStories.reduce((sum, s) => sum + (s.estimatedDays ?? 0), 0)}
                      </th>
                      <th className="px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                        Σ <span className="text-slate-300">|</span> {workloadDrilldownStories.reduce((sum, s) => sum + (s.daysLeft ?? 0), 0)}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {workloadDrilldownStories.map((story, idx) => (
                      <tr key={story.id} className="border-t border-[#7cd3f7]/95 text-slate-700 odd:bg-[#d8f2ff] even:bg-white transition hover:bg-[#c5ebff]">
                        <td className="px-2 py-1 text-right tabular-nums text-slate-500">{idx + 1}</td>
                        <td className="px-2 py-1">
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <UserStoryIcon className="size-3.5" />
                            <button
                              type="button"
                              onClick={() => onOpenStory?.(story.id)}
                              className="truncate font-semibold text-blue-700 underline-offset-2 hover:underline"
                            >
                              {sprintStoryDisplayIds.get(story.id) ?? story.id}
                            </button>
                          </span>
                        </td>
                        <td className="px-2 py-1">{story.title}</td>
                        <td className="px-2 py-1">{monthTeamLabelForId(story.team) ?? (story.team || "—")}</td>
                        <td className="px-2 py-1">{story.sprint == null ? "Unscheduled" : `Sprint ${yearSprint}`}</td>
                        <td className="px-2 py-1">
                          <DrilldownAssigneeCell assignee={story.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                        </td>
                        <td className="px-2 py-1">
                          <StoryStatusPill status={story.status} />
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{story.estimatedDays ?? "—"}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{story.daysLeft ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => workloadDrilldownScrollRef.current?.scrollBy({ top: -96, behavior: "smooth" })}
                className={cn(
                  "absolute -right-[2px] top-0 inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                  canScrollWorkloadUp && "bg-slate-200/70 text-slate-800",
                )}
                aria-label="Scroll up workload stories table"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => workloadDrilldownScrollRef.current?.scrollBy({ top: 96, behavior: "smooth" })}
                className={cn(
                  "absolute bottom-0 -right-[2px] inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                  canScrollWorkloadDown && "bg-slate-200/70 text-slate-800",
                )}
                aria-label="Scroll down workload stories table"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
          </div>
          </InsightsDrilldownModal>
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden">
            {(() => {
              const teamMode = !filterEpicTeamIds?.length || filterEpicTeamIds.length !== 1;
              const barData = teamMode
                ? analytics.workloadByTeam.map((t) => ({
                    name: t.teamLabel,
                    fullName: t.teamLabel,
                    "To do": t.storiesByStatus.todo,
                    "In progress": t.storiesByStatus.inProgress,
                    "Review / Testing": t.storiesByStatus.review,
                    "Done": t.storiesByStatus.done,
                  }))
                : analytics.workloadByAssignee.map((item) => ({
                    name: item.assignee.split(/\s+/)[0],
                    fullName: item.assignee,
                    "To do": item.storiesByStatus.todo,
                    "In progress": item.storiesByStatus.inProgress,
                    "Review / Testing": item.storiesByStatus.review,
                    "Done": item.storiesByStatus.done,
                  }));
              // Pre-resolve avatar URLs keyed by the X-axis label (first name)
              // so the custom tick can paint a photo per bar without each tick
              // re-walking the directory. Team mode → empty map (no avatars).
              const avatarByFirstName = new Map<string, string | null>();
              const teamImageByLabel = new Map<string, string | null>();
              if (!teamMode) {
                for (const item of analytics.workloadByAssignee) {
                  const first = item.assignee.split(/\s+/)[0];
                  if (!first || avatarByFirstName.has(first)) continue;
                  avatarByFirstName.set(
                    first,
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
                <div className="h-[clamp(14.75rem,30vh,19rem)] w-full">
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
                              setWorkloadDrilldownColFilter({
                                ...EMPTY_SPRINT_DRILLDOWN_FILTER,
                                team: match.teamLabel ?? null,
                              });
                            }
                          } else {
                            const match = analytics.workloadByAssignee.find((r) => r.assignee.split(/\s+/)[0] === label);
                            if (match) {
                              setWorkloadDrilldownIsTeam(false);
                              setWorkloadDrilldownAssignee(match.assignee);
                              setWorkloadDrilldownColFilter({
                                ...EMPTY_SPRINT_DRILLDOWN_FILTER,
                                assignee: match.assignee,
                              });
                            }
                          }
                        }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        <XAxis dataKey="name" tick={(props: any) => <WorkloadXAxisTick {...props} teamMode={teamMode} avatarByFirstName={avatarByFirstName} teamImageByLabel={teamImageByLabel} />} height={26} axisLine={false} tickLine={false} />
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
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            label={{ position: "top", fontSize: 10, fill: "#64748b", formatter: ((v: number) => String(v ?? 0)) as any }}
                            style={{ cursor: "pointer" }}
                            onClick={teamMode
                              ? ((data: { fullName?: string; name?: string }) => { const lbl = data?.fullName ?? data?.name; if (!lbl) return; const match = analytics.workloadByTeam.find((t) => t.teamLabel === lbl); if (match) { setWorkloadDrilldownIsTeam(true); setWorkloadDrilldownAssignee(match.teamId ?? ""); setWorkloadDrilldownColFilter({ ...EMPTY_SPRINT_DRILLDOWN_FILTER, team: match.teamLabel ?? null }); } }) as any  // eslint-disable-line @typescript-eslint/no-explicit-any
                              : ((data: { fullName?: string }) => { if (data?.fullName) { setWorkloadDrilldownIsTeam(false); setWorkloadDrilldownAssignee(data.fullName); setWorkloadDrilldownColFilter({ ...EMPTY_SPRINT_DRILLDOWN_FILTER, assignee: data.fullName }); } }) as any}  // eslint-disable-line @typescript-eslint/no-explicit-any
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-[12px] text-slate-500">No workload found for this sprint.</p>
                  )}
                </div>
              );
            })()}
        </div>
      </article>

      <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-2 lg:h-full lg:pl-4">
        <h3 className="mb-2.5 ml-[48px] inline-flex shrink-0 items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <Activity className="size-4 text-slate-600" />
          Cumulative Flow
        </h3>
        <div className="grid gap-3 pl-5 md:grid-cols-[minmax(0,1fr)_12.5rem] md:items-stretch">
          <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
            {analytics.flowSprintTrendData.length > 0 ? (
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cfdExtendedData} margin={{ top: 4, right: 4, left: 18, bottom: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="labelShort"
                      interval="preserveStartEnd"
                      tick={(props) => {
                        const { x, y, payload, index } = props;
                        const label = typeof payload?.value === "string" ? payload.value : String(payload?.value ?? "");
                        const isToday = Boolean(cfdExtendedData[index]?.isToday);
                        return (
                          <text
                            x={x}
                            y={y}
                            dy={8}
                            textAnchor="end"
                            transform={`rotate(-28,${x},${y})`}
                            fill={isToday ? "#0f172a" : "#475569"}
                            fontSize={isToday ? 13 : 11}
                            fontWeight={isToday ? 700 : 500}
                          >
                            {label}
                          </text>
                        );
                      }}
                      tickMargin={2}
                      height={36}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      width={40}
                      label={{
                        value: "Stories",
                        angle: -90,
                        position: "insideLeft",
                        fill: "#64748b",
                        fontSize: 13,
                      }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const row = payload[0]?.payload as
                          | {
                              dayInSprint?: number;
                              labelShort?: string;
                              todo?: number;
                              inProgress?: number;
                              review?: number;
                              done?: number;
                            }
                          | undefined;
                        const title =
                          row?.dayInSprint != null && row.labelShort
                            ? `Day ${row.dayInSprint} · ${row.labelShort}`
                            : "Cumulative Flow";
                        return (
                          <AnalyticsTooltipShell title={title}>
                            {payload.map((item, idx) => (
                              <AnalyticsTooltipRow
                                key={`${String(item.name)}-${idx}`}
                                color={(item.color as string) ?? "#94a3b8"}
                                label={String(item.name ?? "")}
                                value={`${Number(item.value ?? 0)} stories`}
                              />
                            ))}
                          </AnalyticsTooltipShell>
                        );
                      }}
                    />
                    {cfdExtendedData.find((d) => d.isToday) && (
                      <ReferenceLine
                        x={cfdExtendedData.find((d) => d.isToday)?.labelShort}
                        stroke="#94a3b8"
                        strokeDasharray="4 2"
                        label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
                      />
                    )}
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
                          connectNulls={false}
                        />
                      ) : null,
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-slate-500">No sprint days to chart.</div>
            )}
          </div>
          <div className={chartLegendColumnClass}>
            <button
              type="button"
              onClick={showAllCfdKeys}
              className={cn(
                "mb-1 w-full rounded-md px-1 py-1 text-left text-[13px] font-medium transition",
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
                    "mb-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[13px] font-medium transition",
                    on ? "text-slate-900 hover:bg-slate-200/70" : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-700",
                  )}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] ring-1 ring-black/10"
                    style={{ backgroundColor: color, opacity: on ? 1 : 0.35 }}
                  />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </article>
      </div>

      {burnUpData.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:items-stretch">
          {/* Sprint Load — left col (2/5 of the row, gives the per-assignee bars room to breathe) */}
          {(() => {
            const teamMode = !filterEpicTeamIds?.length || filterEpicTeamIds.length !== 1;
            const sprintDaysLeft = analytics.workloadSprintCalendarDaysLeft;
            const sprintEnded = sprintDaysLeft === 0;
            // In stories mode, swap "days left/est days" for "open / total stories" so the bar reflects story progress.
            const loadRows = teamMode
              ? analytics.workloadByTeam.map((t) => {
                  const totalStories = t.storiesByStatus.todo + t.storiesByStatus.inProgress + t.storiesByStatus.review + t.storiesByStatus.done;
                  // In stories mode, "done" is the count of stories
                  // strictly in `done` status — Review/Testing stories
                  // count as NOT done, so the chip number matches what
                  // the planner sees in the per-row drilldown table.
                  // (In days-left mode the upstream daysLeftTotal
                  // already excludes work-time from review stories.)
                  const notDoneStories = totalStories - t.storiesByStatus.done;
                  return {
                    key: t.teamLabel,
                    label: t.teamLabel,
                    initials: t.teamLabel.slice(0, 2).toUpperCase(),
                    image: null as string | null,
                    daysLeft: metric === "storyCount" ? notDoneStories : t.daysLeftTotal,
                    estTotal: metric === "storyCount" ? totalStories : t.estimatedTotal,
                    isTeam: true,
                    matchKey: (t.teamId ?? "") as string,
                    onRowClick: () => {
                      setSprintLoadDrilldownIsTeam(true);
                      setSprintLoadDrilldownAssignee(t.teamId ?? "");
                      setSprintLoadDrilldownColFilter({ ...EMPTY_SPRINT_DRILLDOWN_FILTER, team: t.teamLabel });
                    },
                  };
                })
              : analytics.workloadByAssignee.map((row) => {
                  const totalStories = row.storiesByStatus.todo + row.storiesByStatus.inProgress + row.storiesByStatus.review + row.storiesByStatus.done;
                  const notDoneStories = totalStories - row.storiesByStatus.done;
                  // Resolve the photo from the workspace directory so the row
                  // circle shows the user's avatar instead of initials when
                  // available — falls back gracefully when there's no match.
                  const resolved = resolveAssigneeAvatar(row.assignee, workspaceDirectoryUsers);
                  return {
                    key: row.assignee,
                    label: row.assignee,
                    initials: row.assignee.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join(""),
                    image: resolved.image,
                    daysLeft: metric === "storyCount" ? notDoneStories : row.daysLeftTotal,
                    estTotal: metric === "storyCount" ? totalStories : row.estimatedTotal,
                    isTeam: false,
                    matchKey: row.assignee,
                    onRowClick: () => {
                      setSprintLoadDrilldownIsTeam(false);
                      setSprintLoadDrilldownAssignee(row.assignee);
                      setSprintLoadDrilldownColFilter({ ...EMPTY_SPRINT_DRILLDOWN_FILTER, assignee: row.assignee });
                    },
                  };
                });
            const sprintDaysTotal = analytics.workloadSprintCalendarDaysTotal;
            const loadUnit = metric === "storyCount" ? "" : "d";
            // Sort by completion % descending so the best-performing
            // teams / users bubble to the top and laggards sink. Rows
            // with no estTotal collapse to 100% (nothing to track) so
            // they don't outrank teams that are mid-burn.
            loadRows.sort((a, b) => {
              const pctA = a.estTotal > 0 ? (a.estTotal - a.daysLeft) / a.estTotal : 1;
              const pctB = b.estTotal > 0 ? (b.estTotal - b.daysLeft) / b.estTotal : 1;
              return pctB - pctA;
            });
            if (loadRows.length === 0 && !sprintLoadDrilldownAssignee) return <div className="hidden lg:block lg:col-span-2" />;
            return (
              <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-2 lg:h-full">
                <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                  <h3 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
                    <Users className="size-4 text-slate-600" />
                    Sprint Load
                  </h3>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200">
                      <button
                        type="button"
                        onClick={() => setMetric("daysLeft")}
                        className={`rounded-md px-2 py-0 text-[12px] font-medium ${metric === "daysLeft" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600"}`}
                      >
                        Est Days Left
                      </button>
                      <button
                        type="button"
                        onClick={() => setMetric("storyCount")}
                        className={`rounded-md px-2 py-0 text-[12px] font-medium ${metric === "storyCount" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600"}`}
                      >
                        Stories
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSprintTimelinePopupOpen(true)}
                  title="View sprint timeline"
                  className={cn(
                    "group/sprint-end mb-1.5 inline-flex w-fit shrink-0 cursor-pointer items-center gap-1.5 px-1 py-1 text-left text-[12px] font-semibold transition-colors",
                    sprintEnded
                      ? "text-rose-700 hover:text-rose-900"
                      : sprintDaysLeft <= 2
                        ? "text-amber-800 hover:text-amber-900"
                        : "text-slate-600 hover:text-indigo-700",
                  )}
                >
                  <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                  <span className="underline decoration-dotted underline-offset-[3px] decoration-current/40 group-hover/sprint-end:decoration-current">
                    {sprintEnded ? "Sprint has ended" : `Sprint ends in ${sprintDaysLeft} ${sprintDaysLeft === 1 ? "Day" : "Days"}`}
                  </span>
                  <ChevronRight className="size-3 shrink-0 opacity-50 transition-all group-hover/sprint-end:translate-x-0.5 group-hover/sprint-end:opacity-100" aria-hidden />
                </button>
                {sprintTimelinePopupOpen && (
                  <SprintTimelinePopup planYear={planYear} yearSprint={yearSprint} onClose={() => setSprintTimelinePopupOpen(false)} />
                )}
                {sprintLoadDrilldownAssignee ? (
                  <InsightsDrilldownModal
                    title={`Sprint Load · ${sprintLoadDrilldownAssignee}`}
                    subtitle={`${sprintLoadDrilldownStories.length} user stor${sprintLoadDrilldownStories.length === 1 ? "y" : "ies"} presented`}
                    icon={<Users className="size-4 text-slate-600" aria-hidden />}
                    onClose={() => { setSprintLoadDrilldownAssignee(null); setSprintLoadDrilldownIsTeam(false); }}
                  >
                  <div className="h-full bg-white/80">
                    <div className="relative h-full min-h-0">
                      <div
                        ref={sprintLoadDrilldownScrollRef}
                        onScroll={() => updateArrowState(sprintLoadDrilldownScrollRef, setCanScrollSprintLoadDrilldownUp, setCanScrollSprintLoadDrilldownDown)}
                        className="h-full overflow-auto rounded-none bg-white pr-5 shadow-sm ring-1 ring-sky-100/90 [&::-webkit-scrollbar]:hidden"
                        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                      >
                        <table className="w-full border-collapse text-left text-[13px]">
                          <thead className="sticky top-0 bg-[#0897d5] text-white">
                            <tr>
                              <th className="w-10 px-2 py-1 text-right text-[14px] font-semibold">#</th>
                              <th className="px-2 py-1 text-[14px] font-semibold">Story ID</th>
                              {/* Story name gets the bulk of the breathing room
                               *  so long titles don't get truncated at the
                               *  expense of all-narrow metric columns. */}
                              <th className="w-[36%] min-w-[18rem] px-2 py-1 text-[14px] font-semibold">Story name</th>
                              <th className="px-2 py-1 text-[14px] font-semibold">Team</th>
                              <th className="px-2 py-1 text-[14px] font-semibold">Sprint</th>
                              <th className="px-2 py-1 text-[14px] font-semibold">Assignee</th>
                              <th className="px-2 py-1 text-[14px] font-semibold">Status</th>
                              <th className="px-2 py-1 text-right text-[14px] font-semibold">Est days</th>
                              <th className="px-2 py-1 text-right text-[14px] font-semibold">Est days left</th>
                            </tr>
                            <tr className="bg-white/95">
                              <th className="px-1 py-0.5" />
                              <th className="px-1 py-0.5" />
                              <th className="px-1 py-0.5">
                                <DrilldownFilterInputText
                                  value={sprintLoadDrilldownColFilter.title}
                                  onChange={(v) => setSprintLoadDrilldownColFilter((p) => ({ ...p, title: v }))}
                                  ariaLabel="Filter sprint load by story name"
                                />
                              </th>
                              <th className="px-1 py-0.5">
                                <DrilldownFilterDropdown
                                  value={sprintLoadDrilldownColFilter.team}
                                  options={Array.from(new Set(sprintLoadDrilldownStoriesRaw.map((s) => monthTeamLabelForId(s.team) ?? (s.team || "—")))).sort()}
                                  renderOption={(v) => <span className="truncate">{v}</span>}
                                  onChange={(v) => setSprintLoadDrilldownColFilter((p) => ({ ...p, team: v }))}
                                  ariaLabel="Filter sprint load by team"
                                />
                              </th>
                              <th className="px-1 py-0.5">
                                <DrilldownFilterDropdown
                                  value={sprintLoadDrilldownColFilter.sprint}
                                  options={Array.from(new Set(sprintLoadDrilldownStoriesRaw.map((s) => s.sprint == null ? "Unscheduled" : `Sprint ${yearSprint}`))).sort()}
                                  renderOption={(v) => <span className="truncate">{v}</span>}
                                  onChange={(v) => setSprintLoadDrilldownColFilter((p) => ({ ...p, sprint: v }))}
                                  ariaLabel="Filter sprint load by sprint"
                                />
                              </th>
                              <th className="px-1 py-0.5">
                                <DrilldownFilterDropdown
                                  value={sprintLoadDrilldownColFilter.assignee}
                                  options={Array.from(new Set(sprintLoadDrilldownStoriesRaw.map((s) => s.assignee?.trim() || "Unassigned"))).filter(Boolean).sort()}
                                  renderOption={(v) => <span className="truncate">{v}</span>}
                                  onChange={(v) => setSprintLoadDrilldownColFilter((p) => ({ ...p, assignee: v }))}
                                  ariaLabel="Filter sprint load by assignee"
                                />
                              </th>
                              <th className="px-1 py-0.5">
                                <DrilldownFilterDropdown
                                  value={sprintLoadDrilldownColFilter.status}
                                  options={Array.from(new Set(sprintLoadDrilldownStoriesRaw.map((s) => s.status))).sort()}
                                  renderOption={(v) => <span className="truncate">{v}</span>}
                                  onChange={(v) => setSprintLoadDrilldownColFilter((p) => ({ ...p, status: v }))}
                                  ariaLabel="Filter sprint load by status"
                                />
                              </th>
                              {/* Σ totals over the currently visible (filtered) rows. */}
                              <th className="px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                                Σ <span className="text-slate-300">|</span> {sprintLoadDrilldownStories.reduce((sum, s) => sum + (s.estimatedDays ?? 0), 0)}
                              </th>
                              <th className="px-2 py-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                                Σ <span className="text-slate-300">|</span> {sprintLoadDrilldownStories.reduce((sum, s) => sum + (s.daysLeft ?? 0), 0)}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {sprintLoadDrilldownStories.map((story, idx) => (
                              <tr key={story.id} className="border-t border-[#7cd3f7]/95 text-slate-700 odd:bg-[#d8f2ff] even:bg-white transition hover:bg-[#c5ebff]">
                                <td className="px-2 py-1 text-right tabular-nums text-slate-500">{idx + 1}</td>
                                <td className="px-2 py-1">
                                  <span className="inline-flex min-w-0 items-center gap-1.5">
                                    <UserStoryIcon className="size-3.5" />
                                    <button type="button" onClick={() => onOpenStory?.(story.id)} className="truncate font-semibold text-blue-700 underline-offset-2 hover:underline">
                                      {sprintStoryDisplayIds.get(story.id) ?? story.id}
                                    </button>
                                  </span>
                                </td>
                                <td className="px-2 py-1">{story.title}</td>
                                <td className="px-2 py-1">{monthTeamLabelForId(story.team) ?? (story.team || "—")}</td>
                                <td className="px-2 py-1">{story.sprint == null ? "Unscheduled" : `Sprint ${yearSprint}`}</td>
                                <td className="px-2 py-1">
                                  <DrilldownAssigneeCell assignee={story.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                                </td>
                                <td className="px-2 py-1">
                                  <StoryStatusPill status={story.status} />
                                </td>
                                <td className="px-2 py-1 text-right tabular-nums">{story.estimatedDays ?? "—"}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{story.daysLeft ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button type="button" onClick={() => sprintLoadDrilldownScrollRef.current?.scrollBy({ top: -96, behavior: "smooth" })} className={cn("absolute -right-[2px] top-0 inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800", canScrollSprintLoadDrilldownUp && "bg-slate-200/70 text-slate-800")} aria-label="Scroll up"><ChevronUp className="size-3.5" /></button>
                      <button type="button" onClick={() => sprintLoadDrilldownScrollRef.current?.scrollBy({ top: 96, behavior: "smooth" })} className={cn("absolute bottom-0 -right-[2px] inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800", canScrollSprintLoadDrilldownDown && "bg-slate-200/70 text-slate-800")} aria-label="Scroll down"><ChevronDown className="size-3.5" /></button>
                    </div>
                  </div>
                  </InsightsDrilldownModal>
                ) : null}
                <div className="relative">
                    <div
                      ref={sprintLoadScrollRef}
                      onScroll={() => updateArrowState(sprintLoadScrollRef, setCanScrollSprintLoadUp, setCanScrollSprintLoadDown)}
                      className="h-[clamp(14.75rem,30vh,19rem)] min-h-[14.75rem] overflow-y-auto overflow-x-hidden overscroll-contain space-y-1 pr-5 pb-4"
                    >
                      {loadRows.map((row, rowIdx) => {
                        const doneDays = Math.max(0, row.estTotal - row.daysLeft);
                        const donePct = row.estTotal > 0 ? Math.round((doneDays / row.estTotal) * 100) : 100;
                        // Burndown-based verdict shared with Month Team Progress so
                        // both surfaces speak the same vocabulary (Done · Overdue ·
                        // At Risk · Watch · On Track). Used in BOTH metric modes —
                        // in storyCount mode the "ideal" is a linear burndown of
                        // stories over sprint days, which gives a meaningful
                        // health verdict for the badge even though the threshold
                        // constants (1d / 4d) read as "stories" instead.
                        const verdict = sprintBurndownVerdict({
                          daysLeft: row.daysLeft,
                          estTotal: row.estTotal,
                          sprintDaysLeft,
                          sprintDaysTotal,
                        });
                        const atRisk = verdict.status === "atRisk" || verdict.status === "overdue";
                        const watch = verdict.status === "watch";
                        const allDone = verdict.status === "done";
                        // Stories owned by this row that are flagged behind
                        // their per-story ideal pace — drives the popover lists.
                        const rowStories = metric === "daysLeft"
                          ? (row.isTeam
                              ? sprintStories.filter((s) => s.team === row.matchKey)
                              : sprintStories.filter((s) => (s.assignee?.trim() || "Unassigned") === row.matchKey))
                          : [];
                        const overdueStories: FlaggedStoryEntry[] = [];
                        const atRiskStories: FlaggedStoryEntry[] = [];
                        const watchStories: FlaggedStoryEntry[] = [];
                        if (metric === "daysLeft") {
                          for (const s of rowStories) {
                            const v = sprintStoryVerdict(s, sprintDaysLeft, sprintDaysTotal);
                            if (v.status === "overdue") overdueStories.push({ story: s, gap: v.gap });
                            else if (v.status === "atRisk") atRiskStories.push({ story: s, gap: v.gap });
                            else if (v.status === "watch") watchStories.push({ story: s, gap: v.gap });
                          }
                          const byGap = (a: FlaggedStoryEntry, b: FlaggedStoryEntry) => b.gap - a.gap;
                          overdueStories.sort(byGap);
                          atRiskStories.sort(byGap);
                          watchStories.sort(byGap);
                        }
                        return (
                          <button
                            key={row.key}
                            type="button"
                            onClick={row.onRowClick}
                            className={cn(
                              "w-full rounded-lg bg-white px-2 py-1.5 text-left transition-colors hover:bg-slate-50/60",
                              (atRisk || watch) && "hover:bg-amber-50/40",
                            )}
                          >
                            <div className="flex items-center gap-2">
                              {row.image ? (
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
                                // Per-row palette: chip + circle stroke
                                // cycle through 6 colors keyed by row
                                // index so the rows read as visually
                                // distinct. Bar fill + % text keep the
                                // health-aware tone (amber/emerald/
                                // indigo) so the verdict signal stays.
                                // Mirrors the same treatment on the
                                // RoadmapHealthHero + month-analytics
                                // Team Progress rows.
                                const TEAM_PALETTE = [
                                  { chip: "bg-amber-50 ring-amber-200/70", icon: "text-amber-500", stroke: "#f59e0b" },
                                  { chip: "bg-emerald-50 ring-emerald-200/70", icon: "text-emerald-500", stroke: "#10b981" },
                                  { chip: "bg-violet-50 ring-violet-200/70", icon: "text-violet-500", stroke: "#8b5cf6" },
                                  { chip: "bg-rose-50 ring-rose-200/70", icon: "text-rose-500", stroke: "#f43f5e" },
                                  { chip: "bg-sky-50 ring-sky-200/70", icon: "text-sky-500", stroke: "#0ea5e9" },
                                  { chip: "bg-fuchsia-50 ring-fuchsia-200/70", icon: "text-fuchsia-500", stroke: "#d946ef" },
                                ];
                                const teamColor = TEAM_PALETTE[rowIdx % TEAM_PALETTE.length]!;
                                const bar = atRisk ? "bg-amber-400" : allDone ? "bg-emerald-400" : watch ? "bg-amber-300" : "bg-indigo-400";
                                const pctClass = atRisk || watch ? "text-amber-700" : allDone ? "text-emerald-700" : "text-indigo-600";
                                return (
                                  <>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-baseline gap-1.5">
                                        <span className="truncate text-[12.5px] font-semibold text-slate-800">{row.label}</span>
                                        <span className={cn("shrink-0 text-[10.5px] font-semibold tabular-nums", pctClass)}>{donePct}%</span>
                                      </div>
                                      <div className="mt-1 relative h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/50">
                                        <div className={cn("absolute inset-y-0 left-0 rounded-full transition-all", bar)} style={{ width: `${donePct}%` }} />
                                      </div>
                                    </div>
                                    {/* Health badge — sits between bar
                                     *  and chip, the bar's natural
                                     *  outcome (same as Team Progress).
                                     *  Always rendered, in both metric
                                     *  modes — the badge popover lists
                                     *  flagged stories only in daysLeft
                                     *  mode (storyCount mode passes
                                     *  empty arrays), but the badge
                                     *  itself + tone always reflects the
                                     *  row's verdict. */}
                                    <span className="inline-flex shrink-0 items-center">
                                      <SprintLoadHealthBadge
                                        status={verdict.status}
                                        rowLabel={row.label}
                                        atRiskStories={atRiskStories}
                                        watchStories={watchStories}
                                        overdueStories={overdueStories}
                                        sprintLabel={sprintEnded ? "Sprint ended" : `${sprintDaysLeft}d left`}
                                        onOpenStory={onOpenStory}
                                      />
                                    </span>
                                    {/* Three-segment chip preserving all
                                     *  three numbers inline. Label of
                                     *  the first segment swaps with
                                     *  the metric — "est" in days
                                     *  mode (where the number is an
                                     *  estimated-days total) and
                                     *  "total" in stories mode (where
                                     *  the number is a plain story
                                     *  count and "est" reads wrong). */}
                                    <span
                                      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1 text-slate-700", teamColor.chip)}
                                      title={`${row.estTotal}${loadUnit} ${loadUnit === "d" ? "estimated" : "total"} · ${doneDays}${loadUnit} done · ${row.daysLeft}${loadUnit} left`}
                                    >
                                      <Clock className={cn("size-2.5", teamColor.icon)} strokeWidth={2.2} aria-hidden />
                                      <span>{row.estTotal}{loadUnit}</span>
                                      <span className="text-slate-400">{loadUnit === "d" ? "est" : "total"}</span>
                                      <span className="text-slate-300">·</span>
                                      <span>{doneDays}{loadUnit}</span>
                                      <span className="text-slate-400">done</span>
                                      <span className="text-slate-300">·</span>
                                      <span>{row.daysLeft}{loadUnit}</span>
                                      <span className="text-slate-400">left</span>
                                    </span>
                                    <CircleProgress percent={donePct} color={teamColor.stroke} />
                                  </>
                                );
                              })()}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <button type="button" onClick={() => sprintLoadScrollRef.current?.scrollBy({ top: -96, behavior: "smooth" })} className={cn("absolute -right-[2px] top-0 inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800", canScrollSprintLoadUp && "bg-slate-200/70 text-slate-800")} aria-label="Scroll up sprint load"><ChevronUp className="size-3.5" /></button>
                    <button type="button" onClick={() => sprintLoadScrollRef.current?.scrollBy({ top: 96, behavior: "smooth" })} className={cn("absolute bottom-0 -right-[2px] inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800", canScrollSprintLoadDown && "bg-slate-200/70 text-slate-800")} aria-label="Scroll down sprint load"><ChevronDown className="size-3.5" /></button>
                  </div>
              </article>
            );
          })()}

          {/* Burn Up — right col (3/5 of the row) */}
          <article className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 p-3 lg:col-span-3 lg:h-full lg:pl-4">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <h3 className="ml-[48px] inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
                <Activity className="size-4 text-slate-600" />
                Sprint Burnup
              </h3>
              <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200">
                <button
                  type="button"
                  onClick={() => setMetric("daysLeft")}
                  className={`rounded-md px-2 py-0 text-[13px] font-medium ${metric === "daysLeft" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600"}`}
                >
                  Est Days Left
                </button>
                <button
                  type="button"
                  onClick={() => setMetric("storyCount")}
                  className={`rounded-md px-2 py-0 text-[13px] font-medium ${metric === "storyCount" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600"}`}
                >
                  Stories
                </button>
              </div>
            </div>
            <div className="grid gap-3 pl-5 md:grid-cols-[minmax(0,1fr)_12.5rem] md:items-stretch">
              <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
                <div className="absolute inset-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={burnUpData} margin={{ top: 2, right: 4, left: 18, bottom: 22 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="labelShort"
                        interval="preserveStartEnd"
                        tick={(props) => {
                          const { x, y, payload } = props;
                          const label = typeof payload?.value === "string" ? payload.value : String(payload?.value ?? "");
                          return (
                            <text x={x} y={y} dy={8} textAnchor="end" transform={`rotate(-28,${x},${y})`} fill="#64748b" fontSize={11}>
                              {label}
                            </text>
                          );
                        }}
                        height={34}
                      />
                      <YAxis
                        allowDecimals={metric === "daysLeft"}
                        tick={{ fontSize: 10 }}
                        width={44}
                        label={{ value: metric === "daysLeft" ? "Est Days Left" : "Stories", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 13 }}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          return (
                            <AnalyticsTooltipShell title={String(label ?? "Burn Up")}>
                              {payload.map((row, idx) => (
                                <AnalyticsTooltipRow
                                  key={`${String(row.name)}-${idx}`}
                                  color={(row.color as string) ?? "#94a3b8"}
                                  label={String(row.name ?? "")}
                                  value={typeof row.value === "number" ? Math.round(row.value) : String(row.value ?? "")}
                                />
                              ))}
                            </AnalyticsTooltipShell>
                          );
                        }}
                      />
                      {burnUpData.find((d) => d.isToday) && (
                        <ReferenceLine
                          x={burnUpData.find((d) => d.isToday)?.labelShort}
                          stroke="#94a3b8"
                          strokeDasharray="4 2"
                          label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
                        />
                      )}
                      <Line type="monotone" dataKey="ideal" stroke="#94a3b8" dot={false} strokeDasharray="4 3" name="Ideal" />
                      <Line type="monotone" dataKey="scope" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Scope" />
                      <Line type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={2} dot={false} connectNulls={false} name="Completed" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className={chartLegendColumnClass}>
                <div className={legendRowClass}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[#94a3b8]" />
                    <span>Ideal</span>
                  </span>
                </div>
                <div className={legendRowClass}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[#f59e0b]" />
                    <span>Scope</span>
                  </span>
                </div>
                <div className={legendRowClass}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[#10b981]" />
                    <span>Completed</span>
                  </span>
                </div>
              </div>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
