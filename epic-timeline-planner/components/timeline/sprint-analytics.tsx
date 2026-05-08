"use client";

import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowLeft, ChartNoAxesCombined, ChevronDown, ChevronUp, Layers, PieChart as PieChartIcon, User } from "lucide-react";
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
} from "recharts";

import { buildSprintAnalytics, BurndownMetric } from "@/lib/sprint-analytics";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { type EstimateSource } from "@/lib/epic-estimates";
import { storyMatchesYearSprint } from "@/lib/sprint-plan";
import { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type WorkloadViewMode = "stories" | "sprintLoad";
type SprintWorkloadStatusKey = (typeof WORKLOAD_BAR_SEGMENTS)[number]["key"];
type SprintWorkloadFilterKey = "all" | SprintWorkloadStatusKey;
type SprintCfdKey = (typeof CFD_FLOW_SEGMENTS)[number]["key"];

const STATUS_COLORS: Record<string, string> = {
  Unscheduled: "#94a3b8",
  "To do": "#f59e0b",
  "In progress": "#3b82f6",
  Done: "#10b981",
  Approved: "#8b5cf6",
};

const WORKLOAD_BAR_SEGMENTS = [
  { key: "todo" as const, label: "To do", color: STATUS_COLORS["To do"] },
  { key: "inProgress" as const, label: "In progress", color: STATUS_COLORS["In progress"] },
  { key: "done" as const, label: "Done", color: STATUS_COLORS["Done"] },
  { key: "approved" as const, label: "Approved", color: STATUS_COLORS["Approved"] },
] as const;

/** Cumulative flow diagram stack: first rendered area = bottom (most “done”), last = top (not started). */
const CFD_FLOW_SEGMENTS = [
  { key: "approved" as const, label: "Approved", color: STATUS_COLORS["Approved"] },
  { key: "done" as const, label: "Done", color: STATUS_COLORS["Done"] },
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
  filterEpicTeamId?: string | null;
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
  filterEpicTeamId = null,
  sprintCapacityBoard = null,
  workspaceDirectoryUsers = [],
  onOpenStory,
}: SprintAnalyticsProps) {
  const [metric, setMetric] = useState<BurndownMetric>("daysLeft");
  const [estimateSource, setEstimateSource] = useState<EstimateSource>("stories");
  const [workloadView, setWorkloadView] = useState<WorkloadViewMode>("stories");
  const [workloadStatusFilters, setWorkloadStatusFilters] = useState<SprintWorkloadFilterKey[]>(["all"]);
  const [cfdVisibleKeys, setCfdVisibleKeys] = useState<SprintCfdKey[]>(() => CFD_FLOW_SEGMENTS.map((segment) => segment.key));
  const [statusDrilldownFilter, setStatusDrilldownFilter] = useState<string | null>(null);
  const [workloadDrilldownAssignee, setWorkloadDrilldownAssignee] = useState<string | null>(null);
  const analytics = useMemo(
    () =>
      buildSprintAnalytics(
        initiatives,
        month,
        yearSprint,
        metric,
        planYear,
        filterEpicTeamId,
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
      filterEpicTeamId,
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
    const rows: Array<{
      id: string;
      title: string;
      assignee: string;
      sprint: number | null;
      status: "Unscheduled" | "To do" | "In progress" | "Done" | "Approved";
    }> = [];
    for (const initiative of initiatives) {
      if (initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null) continue;
      if (initiative.endMonth < month || initiative.startMonth > month) continue;
      for (const epic of initiative.epics ?? []) {
        if (filterEpicTeamId && epic.team !== filterEpicTeamId) continue;
        for (const story of epic.userStories ?? []) {
          const isInSprint = story.sprint != null && storyMatchesYearSprint(story, month, yearSprint);
          const isUnscheduled = story.sprint == null;
          if (!isInSprint && !isUnscheduled) continue;
          rows.push({
            id: story.id,
            title: story.title,
            assignee: story.assignee?.trim() || "Unassigned",
            sprint: story.sprint ?? null,
            status:
              story.sprint == null
                ? "Unscheduled"
                : story.status === "todo"
                  ? "To do"
                  : story.status === "inProgress"
                    ? "In progress"
                    : story.status === "done"
                      ? "Done"
                      : "Approved",
          });
        }
      }
    }
    return rows;
  }, [initiatives, month, yearSprint, filterEpicTeamId]);

  const statusDrilldownStories = useMemo(() => {
    if (!statusDrilldownFilter) return [];
    if (statusDrilldownFilter === "All") return sprintStories;
    return sprintStories.filter((story) => story.status === statusDrilldownFilter);
  }, [statusDrilldownFilter, sprintStories]);

  const workloadDrilldownStories = useMemo(() => {
    if (!workloadDrilldownAssignee) return [];
    return sprintStories.filter((story) => story.assignee === workloadDrilldownAssignee);
  }, [workloadDrilldownAssignee, sprintStories]);
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
  const [canScrollStatusUp, setCanScrollStatusUp] = useState(false);
  const [canScrollStatusDown, setCanScrollStatusDown] = useState(false);
  const [canScrollWorkloadUp, setCanScrollWorkloadUp] = useState(false);
  const [canScrollWorkloadDown, setCanScrollWorkloadDown] = useState(false);

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

  const chartLegendColumnClass =
    "max-h-[clamp(14.75rem,30vh,19rem)] space-y-1.5 overflow-y-auto pr-0 md:justify-self-end md:w-[10.5rem]";
  const legendRowClass =
    "flex items-center justify-between rounded-md px-1 py-1 text-left text-[13px] font-medium text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-700";

  return (
    <section className="mb-2 flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-1 lg:h-full">
        <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
            <PieChartIcon className="size-4 text-slate-600" />
            User Stories Status
          </h3>
          {statusDrilldownFilter ? (
            <button
              type="button"
              onClick={() => setStatusDrilldownFilter(null)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              aria-label="Back to chart"
              title="Back to chart"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        {statusDrilldownFilter ? (
          <div className="relative mt-1 rounded-none bg-white/80 p-2">
            <div className="relative">
              <div
                ref={statusDrilldownScrollRef}
                onScroll={() => updateArrowState(statusDrilldownScrollRef, setCanScrollStatusUp, setCanScrollStatusDown)}
                className="h-[clamp(11.5rem,23vh,15.5rem)] overflow-auto rounded-none bg-white pr-5 [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
                  <thead className="sticky top-0 z-10 bg-[#0897d5] text-white backdrop-blur">
                    <tr>
                      <th className="px-2 py-1.5 text-[14px] font-bold">Story ID</th>
                      <th className="px-2 py-1.5 text-[14px] font-bold">Story name</th>
                      <th className="px-2 py-1.5 text-[14px] font-bold">Sprint</th>
                      <th className="px-2 py-1.5 text-[14px] font-bold">Assignee</th>
                      <th className="px-2 py-1.5 text-[14px] font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusDrilldownStories.map((story) => (
                      <tr key={story.id} className="border-t border-[#7cd3f7]/95 text-slate-700 odd:bg-[#d8f2ff] even:bg-white transition hover:bg-[#c5ebff]">
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenStory?.(story.id)}
                            className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                          >
                            {sprintStoryDisplayIds.get(story.id) ?? story.id}
                          </button>
                        </td>
                        <td className="px-2 py-1.5">{story.title}</td>
                        <td className="px-2 py-1.5">{story.sprint == null ? "Unscheduled" : `Sprint ${yearSprint}`}</td>
                        <td className="px-2 py-1.5">{story.assignee}</td>
                        <td className="px-2 py-1.5">
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[12px] font-semibold text-slate-700">
                            {story.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {statusDrilldownStories.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-[13px] text-slate-500">
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
        ) : (
        <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_10.5rem] md:items-stretch">
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
                  onClick={(entry) => setStatusDrilldownFilter(String((entry as { name?: string }).name ?? ""))}
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
        )}
      </article>

      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-2 lg:h-full lg:pl-4">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
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
                Days left
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
        <div className="grid min-h-0 flex-1 gap-3 pl-5 md:grid-cols-[minmax(0,1fr)_10.5rem] md:items-stretch">
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
                      value: metric === "storyCount" ? "Stories" : "Days left",
                      angle: -90,
                      position: "insideLeft",
                      fill: "#64748b",
                      fontSize: 13,
                    }}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
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
                        </AnalyticsTooltipShell>
                      );
                    }}
                  />
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-1">
        <div className="mb-2.5 flex shrink-0 items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
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
            <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setWorkloadView("stories")}
                className={cn(
                  "rounded-md px-2 py-0 text-[13px] font-medium",
                  workloadView === "stories" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
                )}
              >
                Stories
              </button>
              <button
                type="button"
                onClick={() => setWorkloadView("sprintLoad")}
                className={cn(
                  "rounded-md px-2 py-0 text-[13px] font-medium",
                  workloadView === "sprintLoad" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
                )}
              >
                Sprint load
              </button>
            </div>
          )}
        </div>
        {workloadDrilldownAssignee ? (
          <div className="mt-0 rounded-none border border-slate-200/80 bg-white/80 p-2">
            <div className="relative">
              <div
                ref={workloadDrilldownScrollRef}
                onScroll={() => updateArrowState(workloadDrilldownScrollRef, setCanScrollWorkloadUp, setCanScrollWorkloadDown)}
                className="h-[clamp(10.75rem,21.5vh,14rem)] overflow-auto rounded-none bg-white pr-5 shadow-sm ring-1 ring-sky-100/90 [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead className="sticky top-0 bg-[#0897d5] text-white">
                    <tr>
                      <th className="px-2 py-1 text-[14px] font-semibold">Story ID</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Story name</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Sprint</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Assignee</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workloadDrilldownStories.map((story) => (
                      <tr key={story.id} className="border-t border-[#7cd3f7]/95 text-slate-700 odd:bg-[#d8f2ff] even:bg-white transition hover:bg-[#c5ebff]">
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            onClick={() => onOpenStory?.(story.id)}
                            className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                          >
                            {sprintStoryDisplayIds.get(story.id) ?? story.id}
                          </button>
                        </td>
                        <td className="px-2 py-1">{story.title}</td>
                        <td className="px-2 py-1">{story.sprint == null ? "Unscheduled" : `Sprint ${yearSprint}`}</td>
                        <td className="px-2 py-1">{story.assignee}</td>
                        <td className="px-2 py-1">
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[12px] font-semibold text-slate-700">
                            {story.status}
                          </span>
                        </td>
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
        ) : null}
        {!workloadDrilldownAssignee ? <div className={`min-h-0 flex-1 space-y-2.5 ${workloadView === "stories" ? "overflow-hidden" : WORKLOAD_LIST_MAX}`}>
          {(() => {
            const isAllTeams = !filterEpicTeamId;
            const teamMode = isAllTeams && analytics.workloadByTeam.length > 0;
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
                <div className="h-[clamp(14.75rem,30vh,19rem)] w-full">
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
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
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
                    <p className="text-[12px] text-slate-500">No workload found for this sprint.</p>
                  )}
                </div>
              );
            }
            // Sprint Load tab
            const sprintDaysLeft = analytics.workloadSprintCalendarDaysLeft;
            const sprintEnded = sprintDaysLeft === 0;
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
                  initials: row.assignee.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join(""),
                  daysLeft: row.daysLeftTotal,
                  estTotal: row.estimatedTotal,
                  onRowClick: () => setWorkloadDrilldownAssignee(row.assignee),
                }));
            if (loadRows.length === 0) return <p className="text-[12px] text-slate-500">No workload found for this sprint.</p>;
            return (
              <div className="space-y-2">
                {loadRows.map((row) => {
                  const doneDays = Math.max(0, row.estTotal - row.daysLeft);
                  const donePct = row.estTotal > 0 ? Math.round((doneDays / row.estTotal) * 100) : 100;
                  const atRisk = sprintDaysLeft > 0 && row.daysLeft > sprintDaysLeft;
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
                                  title={`${row.daysLeft}d of work left but only ${sprintDaysLeft}d remain in the sprint`}
                                >
                                  <AlertTriangle className="size-2.5 shrink-0" aria-hidden />
                                  {row.daysLeft - sprintDaysLeft}d over
                                </span>
                              )}
                              {sprintEnded && row.daysLeft > 0 && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200/80">
                                  <AlertTriangle className="size-2.5 shrink-0" aria-hidden />
                                  Ended
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
          })()}
        </div> : null}
        <p className="mt-2 shrink-0 text-[12px] text-slate-600">
          {analytics.openStories} open stories, <span className="text-amber-700">{analytics.atRiskStories} at risk</span>
          .
        </p>
      </article>

      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-2 lg:pl-4">
        <h3 className="mb-2.5 ml-[48px] inline-flex shrink-0 items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <Activity className="size-4 text-slate-600" />
          Cumulative Flow
        </h3>
        <div className="grid gap-3 pl-5 md:grid-cols-[minmax(0,1fr)_10.5rem] md:items-stretch">
          <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
            {analytics.flowSprintTrendData.length > 0 ? (
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.flowSprintTrendData} margin={{ top: 4, right: 4, left: 18, bottom: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="labelShort"
                      interval="preserveStartEnd"
                      tick={(props) => {
                        const { x, y, payload, index } = props;
                        const label = typeof payload?.value === "string" ? payload.value : String(payload?.value ?? "");
                        const isToday = Boolean(analytics.flowSprintTrendData[index]?.isToday);
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
                              done?: number;
                              approved?: number;
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
    </section>
  );
}
