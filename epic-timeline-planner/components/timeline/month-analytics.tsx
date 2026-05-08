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
import { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MONTH_TEAM_COLUMNS } from "@/lib/month-team-board";
import { clampYearSprint, globalSprintFromMonthLane, monthLaneFromGlobalSprint } from "@/lib/year-sprint";

type BurndownMetric = "daysLeft" | "storyCount";
type WorkloadViewMode = "stories" | "monthLoad";
type WorkloadStatusKey = "todo" | "inProgress" | "done" | "approved";
type WorkloadFilterKey = "all" | WorkloadStatusKey | "unassigned";

const STATUS_COLORS: Record<string, string> = {
  Unscheduled: "#94a3b8",
  "To do": "#f59e0b",
  "In progress": "#3b82f6",
  Done: "#10b981",
  Approved: "#8b5cf6",
};

const WORKLOAD_BAR_SEGMENTS = [
  { key: "todo" as const, label: "To Do", color: STATUS_COLORS["To do"] },
  { key: "inProgress" as const, label: "In Progress", color: STATUS_COLORS["In progress"] },
  { key: "done" as const, label: "Done", color: STATUS_COLORS["Done"] },
  { key: "approved" as const, label: "Approved", color: STATUS_COLORS["Approved"] },
] as const;

const CFD_FLOW_SEGMENTS = [
  { key: "approved" as const, label: "Approved", color: STATUS_COLORS["Approved"] },
  { key: "done" as const, label: "Done", color: STATUS_COLORS["Done"] },
  { key: "inProgress" as const, label: "In progress", color: STATUS_COLORS["In progress"] },
  { key: "todo" as const, label: "To do", color: STATUS_COLORS["To do"] },
] as const;

function WorkloadXAxisTick({ x, y, payload, teamMode }: { x?: number; y?: number; payload?: { value: string }; teamMode: boolean }) {
  if (x == null || y == null) return null;
  const label = payload?.value ?? "";
  const rowY = y + 10;
  const iconSize = 12;
  const estTextWidth = Math.min(label.length * 5.5, 70);
  const totalWidth = iconSize + 3 + estTextWidth;
  const iconX = x - totalWidth / 2;
  const textStartX = iconX + iconSize + 3;
  const Icon = teamMode ? Users : UserRound;
  return (
    <g>
      <Icon x={iconX} y={rowY - iconSize / 2} width={iconSize} height={iconSize} color="#94a3b8" strokeWidth={2} />
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

function latestSnapshotAtDay(story: UserStoryItem, day: Date) {
  const snapshots = story.snapshots ?? [];
  if (snapshots.length === 0) return null;
  const cutoff = day.getTime();
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const ts = new Date(snapshots[i].snapshotDate).getTime();
    if (ts <= cutoff) return snapshots[i];
  }
  return null;
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
    setCoords({ top: r.bottom + 6, left: r.left });
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
}: {
  active?: boolean;
  payload?: readonly BurndownTooltipPayload[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((item) => item.value != null);
  if (rows.length === 0) return null;
  return (
    <AnalyticsTooltipShell title={String(label ?? "Cumulative Flow")}>
      {rows.map((row) => {
        const normalized = Array.isArray(row.value) ? row.value[0] : row.value;
        const valueText = typeof normalized === "number" ? `${Math.round(normalized)} stories` : "n/a";
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
  initialSelectedEpicId?: string;
  initialSelectedInitiativeId?: string;
  onOpenEpic?: (epicId: string) => void;
  onOpenStory?: (storyId: string) => void;
  onOpenSprintKanban?: (yearSprint: number, teamId: string | null) => void;
  onScopeChange?: (type: "epic" | "initiative" | null, id: string | null, title: string | null) => void;
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
}: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  percent?: number;
}) {
  if (
    cx == null ||
    cy == null ||
    midAngle == null ||
    outerRadius == null ||
    percent == null ||
    percent <= 0
  ) {
    return null;
  }
  const RAD = Math.PI / 180;
  const r = outerRadius + 6;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  return (
    <text
      x={x}
      y={y}
      fill="#475569"
      fontSize={12}
      fontWeight={600}
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
    >
      {`${Math.round(percent * 100)}%`}
    </text>
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
  initialSelectedEpicId,
  initialSelectedInitiativeId,
  onOpenEpic,
  onOpenStory,
  onOpenSprintKanban,
  onScopeChange,
}: MonthAnalyticsProps) {
  const [metric, setMetric] = useState<BurndownMetric>("daysLeft");
  const [estimateSource, setEstimateSource] = useState<EstimateSource>("stories");
  const [workloadView, setWorkloadView] = useState<WorkloadViewMode>("stories");
  const [workloadStatusFilters, setWorkloadStatusFilters] = useState<WorkloadFilterKey[]>(["all"]);
  const [selectedEpicId, setSelectedEpicId] = useState<string>(initialSelectedEpicId ?? "all");
  const [epicInput, setEpicInput] = useState("");
  const [isEpicDropdownOpen, setIsEpicDropdownOpen] = useState(false);
  const [showAllEpicSuggestions, setShowAllEpicSuggestions] = useState(false);
  const [burndownVisibleKeys, setBurndownVisibleKeys] = useState<string[]>([]);
  const [cfdVisibleKeys, setCfdVisibleKeys] = useState<string[]>([]);
  const [statusDrilldownFilter, setStatusDrilldownFilter] = useState<string | null>(null);
  const [workloadDrilldownAssignee, setWorkloadDrilldownAssignee] = useState<string | null>(null);
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
      monthEpics.map(({ epic, initiative }) => ({
        id: epic.id,
        label: epic.title,
        initiativeId: initiative.id,
        initiativeTitle: initiative.title,
        initiativeIcon: initiative.icon && initiative.icon.trim().length > 0 ? initiative.icon : "📁",
        searchText: `${epic.title} ${initiative.title}`.toLowerCase(),
      })),
    [monthEpics],
  );
  const selectedEpicOption = useMemo(
    () => monthEpics.find(({ epic }) => epic.id === selectedEpicId) ?? null,
    [monthEpics, selectedEpicId],
  );
  useEffect(() => {
    if (!initialSelectedEpicId) return;
    setSelectedEpicId(initialSelectedEpicId);
    const selected = monthEpics.find(({ epic }) => epic.id === initialSelectedEpicId);
    setEpicInput(selected ? selected.epic.title : "");
  }, [initialSelectedEpicId, monthEpics]);
  useEffect(() => {
    if (!initialSelectedInitiativeId) return;
    setSelectedInitiativeId(initialSelectedInitiativeId);
    const init = scopeInitiativeOptions.find((i) => i.id === initialSelectedInitiativeId);
    if (init) setEpicInput(init.title);
  }, [initialSelectedInitiativeId, scopeInitiativeOptions]);
  // Clear epic selection when the initiative filter changes and the epic is no longer in scope
  useEffect(() => {
    if (selectedEpicId === "all") return;
    if (!monthEpics.some(({ epic }) => epic.id === selectedEpicId)) {
      setSelectedEpicId("all");
      setEpicInput("");
    }
  }, [monthEpics, selectedEpicId]);
  useEffect(() => {
    if (!onScopeChange) return;
    if (selectedEpicId !== "all") {
      const selected = epicComboOptions.find((opt) => opt.id === selectedEpicId);
      onScopeChange("epic", selectedEpicId, selected?.label ?? null);
    } else if (selectedInitiativeId !== "all") {
      const init = scopeInitiativeOptions.find((i) => i.id === selectedInitiativeId);
      onScopeChange("initiative", selectedInitiativeId, init?.title ?? null);
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
        });
      } else {
        groups[idx]!.epics.push(opt);
      }
    });
    return groups;
  }, [filteredEpicOptions]);
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
  }, [selectedEpicId, selectedInitiativeId, epicComboOptions, scopeInitiativeOptions]);

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
      today1Based = Math.min(totalDays, Math.max(1, new Date(startToday).getDate()));
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
  const workloadDrilldownStories = useMemo(() => {
    if (workloadDrilldownAssignee == null) return [];
    return scopedStories
      .filter((story) => story.sprint != null)
      .filter((story) => (story.assignee?.trim() || "Unassigned") === workloadDrilldownAssignee)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [workloadDrilldownAssignee, scopedStories]);
  const workloadDrilldownEmptyRows = Math.max(0, tableTargetRows - workloadDrilldownStories.length);
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
    const isCurrentMonth = now.getFullYear() === planYear && now.getMonth() + 1 === month;
    const elapsedDays = isCurrentMonth ? Math.max(1, Math.min(horizon, now.getDate())) : horizon;
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
  }, [monthBurndown, monthBurndownEpics, planYear, month]);
  const monthBurndownFromSnapshots = useMemo(() => {
    if (monthBurndown.length === 0) return null;
    const sourceEpics = selectedEpicOption != null ? [selectedEpicOption.epic] : monthEpics.map((row) => row.epic);
    const hasSnapshots = sourceEpics.some((epic) => (epic.userStories ?? []).some((story) => (story.snapshots?.length ?? 0) > 0));
    if (!hasSnapshots) return null;

    const now = new Date();
    const isCurrentMonth = now.getFullYear() === planYear && now.getMonth() + 1 === month;
    const elapsedDays = isCurrentMonth ? Math.max(1, Math.min(monthBurndown.length, now.getDate())) : monthBurndown.length;
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
          const snapshot = latestSnapshotAtDay(story, day);
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
  const monthBurndownResolved = monthBurndownFromSnapshots ?? monthBurndownFilledToToday;
  const burndownFocusedEpicOption = useMemo(() => {
    if (selectedEpicOption) return selectedEpicOption;
    if (burndownVisibleKeys.length !== 1) return null;
    return monthEpics.find((row) => row.epic.id === burndownVisibleKeys[0]) ?? null;
  }, [selectedEpicOption, burndownVisibleKeys, monthEpics]);
  const selectedEpicDueDate = useMemo(() => {
    if (!burndownFocusedEpicOption) return null;
    const dueSprint = burndownFocusedEpicOption.epic.planEndSprint;
    const dueMonth = burndownFocusedEpicOption.epic.planEndMonth ?? scopeEndMonth;
    const dueYear = burndownFocusedEpicOption.epic.planYear ?? planYear;
    const dueDay = dueSprint === 1 ? 15 : new Date(dueYear, dueMonth, 0).getDate();
    return new Date(dueYear, dueMonth - 1, dueDay);
  }, [burndownFocusedEpicOption, scopeEndMonth, planYear]);
  const monthBurndownWithDueTarget = useMemo(() => {
    if (!burndownFocusedEpicOption || selectedEpicDueDate == null) return monthBurndownResolved;
    const totalDays = monthBurndownResolved.length;
    if (totalDays === 0) return monthBurndownResolved;
    const startValue =
      metric === "daysLeft"
        ? (burndownFocusedEpicOption.epic.userStories ?? []).reduce((sum, s) => sum + (s.estimatedDays ?? s.daysLeft ?? 1), 0)
        : (burndownFocusedEpicOption.epic.userStories ?? []).length;
    const monthStart = new Date(planYear, scopeStartMonth - 1, 1);
    const msPerDay = 24 * 60 * 60 * 1000;
    const dueDayIndex = Math.floor((selectedEpicDueDate.getTime() - monthStart.getTime()) / msPerDay) + 1;
    const targetDayIndex = Math.max(1, dueDayIndex);
    const withIdeal = monthBurndownResolved.map((row, idx) => {
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
  }, [monthBurndownResolved, burndownFocusedEpicOption, selectedEpicDueDate, metric, planYear, month, scopeStartMonth]);
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
      const snapshot = latestSnapshotAtDay(story, monthStartDay);
      const status = snapshot?.status ?? story.status;
      return isStoryOpen(status);
    });
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === planYear && now.getMonth() + 1 === month;
    const elapsedDays = isCurrentMonth ? Math.max(1, Math.min(totalDays, now.getDate())) : totalDays;

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
        const snapshot = latestSnapshotAtDay(story, dayDate);
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
  const [canScrollWorkloadDrilldownUp, setCanScrollWorkloadDrilldownUp] = useState(false);
  const [canScrollWorkloadDrilldownDown, setCanScrollWorkloadDrilldownDown] = useState(false);
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
    if (workloadView !== "stories") {
      setCanScrollWorkloadUp(false);
      setCanScrollWorkloadDown(false);
      return;
    }
    updateWorkloadArrowState();
  }, [workloadView, analytics.workloadByAssignee.length, workloadStatusFilters]);
  useEffect(() => {
    if (workloadView !== "monthLoad") {
      setCanScrollMonthLoadUp(false);
      setCanScrollMonthLoadDown(false);
      return;
    }
    updateMonthLoadArrowState();
  }, [workloadView, analytics.workloadCapacityByAssignee.length, analytics.monthDaysLeft]);
  useEffect(() => {
    if (!workloadDrilldownAssignee) {
      setCanScrollWorkloadDrilldownUp(false);
      setCanScrollWorkloadDrilldownDown(false);
      return;
    }
    updateWorkloadDrilldownArrowState();
  }, [workloadDrilldownAssignee, workloadDrilldownStories.length]);

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
    <section className="mb-2 flex flex-col gap-3.5">
      <div className="-mt-1 rounded-xl bg-slate-100/70 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-slate-700" htmlFor="month-insights-epic-filter">
            <ChartNoAxesCombined className="size-4 text-slate-500" aria-hidden />
            Epic / Initiative Scope
          </label>
          <div className="relative min-w-[22rem] flex-1 max-w-[34rem]">
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
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] font-semibold text-slate-700"
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
                        {group.initiativeTitle}
                      </button>
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
                          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] text-slate-700 transition hover:bg-slate-100"
                        >
                          <Folder className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                          {opt.label}
                        </button>
                      ))}
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
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-1 lg:h-full">
        <div className={cn("mb-2 flex shrink-0 items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
          <h3
            className={cn(
              "inline-flex items-center gap-1.5 font-semibold text-slate-800",
              isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
            )}
          >
            <PieChartIcon className="size-4 text-slate-600" />
            {statusPanelTitle}
            {selectedEpicOption ? ` (${selectedEpicOption.epic.title})` : ""}
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
          <div className={cn("mt-0 w-full min-w-0 overflow-hidden", INSIGHTS_CONTENT_HEIGHT, INSIGHTS_CHART_FRAME)}>
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
                    cy="43%"
                    innerRadius="38%"
                    outerRadius="68%"
                    paddingAngle={3}
                    cornerRadius={8}
                    stroke="#ffffff"
                    strokeWidth={2}
                    label={piePercentLabel}
                    labelLine={false}
                    filter="url(#monthPieShadow)"
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
                <div className="absolute left-1/2 top-[43%] -translate-x-1/2 -translate-y-1/2 text-center">
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

      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-2 lg:h-full">
        <div className={cn("mb-2 flex shrink-0 items-center justify-between gap-2", INSIGHTS_HEADER_ROW)}>
          <h3
            className={cn(
              "ml-[35px] inline-flex items-center gap-1.5 font-semibold text-slate-800",
              isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
            )}
          >
            <Activity className="size-4 text-slate-600" />
            Burndown
          </h3>
          <div className="flex items-center gap-2">
            <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setMetric("daysLeft")}
                className={`rounded-md px-3 py-1 text-[13px] font-medium ${
                  metric === "daysLeft" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600"
                }`}
              >
                Days left
              </button>
              <button
                type="button"
                onClick={() => setMetric("storyCount")}
                className={`rounded-md px-3 py-1 text-[13px] font-medium ${
                  metric === "storyCount" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600"
                }`}
              >
                Stories
              </button>
            </div>
            <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setEstimateSource("stories")}
                className={cn(
                  "rounded-md px-3 py-1 text-[13px] font-medium",
                  estimateSource === "stories"
                    ? "bg-white text-slate-900 ring-1 ring-slate-300"
                    : "text-slate-600",
                )}
              >
                Σ Stories
              </button>
              <button
                type="button"
                onClick={() => setEstimateSource("original")}
                className={cn(
                  "rounded-md px-3 py-1 text-[13px] font-medium",
                  estimateSource === "original"
                    ? "bg-white text-slate-900 ring-1 ring-slate-300"
                    : "text-slate-600",
                )}
              >
                Original Estimation
              </button>
            </div>
          </div>
        </div>
        <div
          className={cn(
            "grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_12.5rem] md:items-stretch",
            INSIGHTS_CHART_GRID_GAP,
            INSIGHTS_CONTENT_HEIGHT,
          )}
        >
          <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
            {monthBurndownEpics.length > 0 ? (
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthBurndownWithDueTarget} margin={{ top: 2, right: 26, left: 18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="axisLabel"
                      interval={0}
                      ticks={burndownAxisTicks}
                      tickFormatter={(value) => String(value ?? "")}
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
                    />
                    <Tooltip
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.dayLabel ?? ""}
                      content={(props) => <BurndownTooltip {...props} metric={metric} />}
                      cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3", strokeOpacity: 0.5 }}
                    />
                    {burndownFocusedEpicOption && burndownVisibleKeys.includes(burndownFocusedEpicOption.epic.id) ? (
                      <Line
                        type="monotone"
                        dataKey={burndownFocusedEpicOption.epic.id}
                        stroke={LINE_PALETTE[0]}
                        strokeWidth={2}
                        dot={false}
                        name={burndownFocusedEpicOption.epic.title}
                      />
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
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="size-3.5" aria-hidden />
                  All
                </span>
              </button>
              {burndownLegendItems.map((item) => {
                const on = burndownVisibleKeys.includes(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleBurndownKey(item.key)}
                    className={cn(
                      "mb-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left transition",
                      isMultiPeriodInsights ? "text-[14px]" : "text-[13px]",
                      on
                        ? "text-slate-900 hover:bg-slate-200/70"
                        : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-700",
                    )}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color, opacity: on ? 1 : 0.35 }}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
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
      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-1">
        <div className={cn("flex shrink-0 items-center justify-between gap-2", INSIGHTS_HEADER_ROW, isMultiPeriodInsights ? "mb-3" : "mb-2")}>
          <h3
            className={cn(
              "inline-flex items-center gap-1.5 font-semibold text-slate-800",
              isMultiPeriodInsights ? "text-[16px]" : "text-[15px]",
            )}
          >
            <ChartNoAxesCombined className="size-4 text-slate-600" />
            Workload Balance
          </h3>
          {workloadDrilldownAssignee ? (
            <button
              type="button"
              onClick={() => setWorkloadDrilldownAssignee(null)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              aria-label="Back to workload chart"
              title="Back to workload chart"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
            </button>
          ) : (
            <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setWorkloadView("stories")}
                className={cn(
                  "rounded-md px-3 py-1 text-[13px] font-medium",
                  workloadView === "stories" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
                )}
              >
                Stories
              </button>
              <button
                type="button"
                onClick={() => setWorkloadView("monthLoad")}
                className={cn(
                  "rounded-md px-3 py-1 text-[13px] font-medium",
                  workloadView === "monthLoad" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
                )}
              >
                Month Load
              </button>
            </div>
          )}
        </div>
        {workloadDrilldownAssignee ? (
          <div className={cn("mt-0 w-full min-w-0 overflow-hidden", INSIGHTS_CONTENT_HEIGHT, INSIGHTS_CHART_FRAME)}>
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
                  {workloadDrilldownStories.map((story) => {
                    const workloadStatusLabel =
                      story.status === "todo"
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
                        <InsightsTruncatedHoverLabel text={workloadStatusLabel} />
                      </td>
                    </tr>
                    );
                  })}
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
          const teamMode = (!filterEpicTeamIds?.length || filterEpicTeamIds.length !== 1) && analytics.workloadByTeam.length > 0;
          if (workloadView === "stories") {
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
                  name: item.assignee.split(/\s+/)[0],
                  fullName: item.assignee,
                  "To do": item.storiesByStatus.todo,
                  "In progress": item.storiesByStatus.inProgress,
                  "Done": item.storiesByStatus.done,
                  "Approved": item.storiesByStatus.approved,
                }));
            return (
              <div className={cn("min-h-0", INSIGHTS_CHART_BAND)}>
                {barData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={barData}
                      barCategoryGap="15%"
                      barGap={2}
                      margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                      style={{ cursor: teamMode ? "default" : "pointer" }}
                      onClick={teamMode ? undefined : (data) => {
                        const label = data?.activeLabel as string | undefined;
                        if (!label) return;
                        const match = analytics.workloadByAssignee.find((r) => r.assignee.split(/\s+/)[0] === label);
                        if (match) setWorkloadDrilldownAssignee(match.assignee);
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      <XAxis dataKey="name" tick={(props: any) => <WorkloadXAxisTick {...props} teamMode={teamMode} />} height={26} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0", padding: "6px 10px" }}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={((value: number, name: string) => [value, name]) as any}
                        labelFormatter={(label, payload) => (payload?.[0] as { payload?: { fullName?: string } } | undefined)?.payload?.fullName ?? label}
                      />
                      <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 13, paddingTop: 6 }} />
                      {WORKLOAD_BAR_SEGMENTS.map((s) => (
                        <Bar key={s.key} dataKey={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={14}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          label={{ position: "top", fontSize: 10, fill: "#64748b", formatter: ((v: number) => v > 0 ? v : "") as any }}
                          style={{ cursor: teamMode ? "default" : "pointer" }}
                          onClick={teamMode ? undefined : ((data: { fullName?: string }) => { if (data?.fullName) setWorkloadDrilldownAssignee(data.fullName); }) as any}  // eslint-disable-line @typescript-eslint/no-explicit-any
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-[12px] text-slate-500">No open workload found for this month.</p>
                )}
              </div>
            );
          }
          // Month Load tab
          const monthDaysLeft = analytics.monthDaysLeft;
          const loadRows = teamMode
            ? analytics.workloadByTeam.map((t) => ({
                key: t.teamLabel,
                label: t.teamLabel,
                initials: t.teamLabel.slice(0, 2).toUpperCase(),
                daysLeft: t.daysLeftTotal,
                estTotal: t.estimatedTotal,
                onRowClick: undefined as (() => void) | undefined,
              }))
            : analytics.workloadByAssignee.map((row) => ({
                key: row.assignee,
                label: row.assignee,
                initials: row.assignee.split(/\s+/).slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join(""),
                daysLeft: row.daysLeftTotal,
                estTotal: row.estimatedTotal,
                onRowClick: () => setWorkloadDrilldownAssignee(row.assignee),
              }));
          if (loadRows.length === 0) return <p className="text-[12px] text-slate-500">No workload found for this month.</p>;
          return (
            <div className={cn("overflow-y-auto overflow-x-hidden space-y-2 [&::-webkit-scrollbar]:hidden", INSIGHTS_CHART_BAND)} style={{ scrollbarWidth: "none" }}>
              {loadRows.map((row) => {
                const doneDays = Math.max(0, row.estTotal - row.daysLeft);
                const donePct = row.estTotal > 0 ? Math.round((doneDays / row.estTotal) * 100) : 100;
                const atRisk = monthDaysLeft > 0 && row.daysLeft > monthDaysLeft;
                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={row.onRowClick}
                    className={cn("w-full rounded-lg bg-white px-2.5 py-1.5 text-left transition", row.onRowClick ? "hover:bg-slate-50" : "cursor-default")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">
                        {row.initials || <User className="size-3" />}
                      </span>
                      <div className="w-3/4 min-w-0">
                        <div className="flex items-center justify-between gap-1.5 mb-1">
                          <span className="truncate text-[12px] font-semibold text-slate-800">{row.label}</span>
                          <div className="flex shrink-0 items-center gap-1">
                            {atRisk && (
                              <span
                                className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200/80"
                                title={`${row.daysLeft}d of work left but only ${monthDaysLeft}d remain in the month`}
                              >
                                <AlertTriangle className="size-2.5 shrink-0" aria-hidden />
                                {row.daysLeft - monthDaysLeft}d over
                              </span>
                            )}
                            <span className="text-[11px] tabular-nums text-slate-500">{row.daysLeft}d left · {row.estTotal}d est</span>
                          </div>
                        </div>
                        <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/60">
                          <div
                            className={cn(
                              "absolute inset-y-0 left-0 rounded-full transition-all",
                              atRisk ? "bg-amber-400" : row.daysLeft === 0 ? "bg-emerald-400" : "bg-indigo-400",
                            )}
                            style={{ width: `${donePct}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-slate-700">
                            {donePct}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })() : null}
        <p className="mt-2 shrink-0 text-[12px] text-slate-600">
          {analytics.openStories} open stories, <span className="text-amber-700">{analytics.atRiskStories} at risk</span>.
        </p>
      </article>

      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-2 lg:h-full">
        <h3
          className={cn(
            "ml-[35px] inline-flex min-h-9 shrink-0 items-center gap-1.5 font-semibold text-slate-800",
            isMultiPeriodInsights ? "mb-3 text-[16px]" : "mb-2 text-[15px]",
          )}
        >
          <Activity className="size-4 text-slate-600" />
          Cumulative Flow
        </h3>
        <div
          className={cn(
            "grid md:grid-cols-[minmax(0,1fr)_12.5rem] md:items-stretch",
            INSIGHTS_CHART_GRID_GAP,
            INSIGHTS_CHART_BAND,
          )}
        >
          <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
            {flowResolved.length > 0 ? (
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={flowResolved} margin={{ top: 2, right: 26, left: 18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="labelShort"
                      interval="preserveStartEnd"
                      tick={{ fontSize: 11, fill: "#475569" }}
                      angle={-28}
                      textAnchor="end"
                      tickMargin={2}
                      height={44}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      width={44}
                      label={{ value: "Stories", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 13 }}
                    />
                    <Tooltip
                      labelFormatter={(_, payload) => {
                        const row = payload?.[0]?.payload as { dayInMonth?: number; labelShort?: string } | undefined;
                        if (row?.dayInMonth != null && row.labelShort) return `Day ${row.dayInMonth} · ${row.labelShort}`;
                        return "";
                      }}
                      content={(props) => <CumulativeFlowTooltip {...props} />}
                      cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3", strokeOpacity: 0.5 }}
                    />
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
    </section>
  );
}
