"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronUp,
  Folder,
  Layers,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
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

const SPRINT_CHART_BOX = "h-[15rem] min-h-[15rem] max-h-[15rem] w-full";
const PIE_LEGEND_CAP = "max-h-[15rem] overflow-y-auto pr-1";
const WORKLOAD_LIST_MAX = "max-h-[13rem] overflow-y-auto overflow-x-hidden overscroll-contain";
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
    <div className="min-w-[12rem] rounded-xl border border-white/50 bg-slate-900/55 px-3 py-2 text-[12px] text-slate-100 shadow-xl backdrop-blur-md">
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-200/95">{String(label ?? "Burndown")}</p>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={String(row.dataKey ?? row.name)} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 truncate text-slate-100/95">
              <span
                className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/30"
                style={{ backgroundColor: row.color ?? "#cbd5e1" }}
              />
              <span className="truncate">{String(row.name ?? row.dataKey ?? "Series")}</span>
            </span>
            <span className="shrink-0 tabular-nums font-semibold text-white">
              {formatBurndownValue(row.value, metric)}
            </span>
          </div>
        ))}
      </div>
    </div>
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
    <div className="min-w-[12rem] rounded-xl border border-white/50 bg-slate-900/55 px-3 py-2 text-[12px] text-slate-100 shadow-xl backdrop-blur-md">
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-200/95">{String(label ?? "Cumulative flow")}</p>
      <div className="space-y-1.5">
        {rows.map((row) => {
          const normalized = Array.isArray(row.value) ? row.value[0] : row.value;
          const valueText = typeof normalized === "number" ? `${Math.round(normalized)} stories` : "n/a";
          return (
            <div key={String(row.dataKey ?? row.name)} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 truncate text-slate-100/95">
                <span
                  className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/30"
                  style={{ backgroundColor: row.color ?? "#cbd5e1" }}
                />
                <span className="truncate">{String(row.name ?? row.dataKey ?? "Series")}</span>
              </span>
              <span className="shrink-0 tabular-nums font-semibold text-white">{valueText}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPieTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: readonly BurndownTooltipPayload[];
  total: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload.find((item) => item.value != null);
  if (!row) return null;
  const normalized = Array.isArray(row.value) ? row.value[0] : row.value;
  const value = typeof normalized === "number" ? Math.round(normalized) : Number(normalized ?? 0);
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="min-w-[12rem] rounded-xl border border-white/50 bg-slate-900/55 px-3 py-2 text-[12px] text-slate-100 shadow-xl backdrop-blur-md">
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-200/95">User stories status</p>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 truncate text-slate-100/95">
          <span
            className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/30"
            style={{ backgroundColor: row.color ?? "#cbd5e1" }}
          />
          <span className="truncate">{String(row.name ?? "Status")}</span>
        </span>
        <span className="shrink-0 tabular-nums font-semibold text-white">
          {value} ({percent}%)
        </span>
      </div>
    </div>
  );
}

type MonthAnalyticsProps = {
  initiatives: InitiativeItem[];
  month: number;
  planYear: number;
  filterEpicTeamId?: string | null;
  onOpenEpic?: (epicId: string) => void;
  onOpenStory?: (storyId: string) => void;
  onOpenSprintKanban?: (yearSprint: number, teamId: string | null) => void;
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
      fontSize={10}
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

function collectMonthStories(
  initiatives: InitiativeItem[],
  month: number,
  filterEpicTeamId?: string | null,
): UserStoryItem[] {
  const rows: UserStoryItem[] = [];
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null) continue;
    if (initiative.endMonth < month || initiative.startMonth > month) continue;
    for (const epic of initiative.epics ?? []) {
      if (filterEpicTeamId && epic.team !== filterEpicTeamId) continue;
      rows.push(...(epic.userStories ?? []));
    }
  }
  return rows;
}

function collectMonthEpics(
  initiatives: InitiativeItem[],
  month: number,
  filterEpicTeamId?: string | null,
) {
  const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null) continue;
    if (initiative.endMonth < month || initiative.startMonth > month) continue;
    for (const epic of initiative.epics ?? []) {
      if (filterEpicTeamId && epic.team !== filterEpicTeamId) continue;
      if (epic.planStartMonth != null && epic.planEndMonth != null && (epic.planEndMonth < month || epic.planStartMonth > month)) {
        continue;
      }
      rows.push({ epic, initiative });
    }
  }
  return rows.sort((a, b) => a.epic.title.localeCompare(b.epic.title));
}

export function MonthAnalytics({
  initiatives,
  month,
  planYear,
  filterEpicTeamId = null,
  onOpenEpic,
  onOpenStory,
  onOpenSprintKanban,
}: MonthAnalyticsProps) {
  const [metric, setMetric] = useState<BurndownMetric>("daysLeft");
  const [estimateSource, setEstimateSource] = useState<EstimateSource>("stories");
  const [workloadView, setWorkloadView] = useState<WorkloadViewMode>("stories");
  const [workloadStatusFilters, setWorkloadStatusFilters] = useState<WorkloadFilterKey[]>(["all"]);
  const [selectedEpicId, setSelectedEpicId] = useState<string>("all");
  const [epicInput, setEpicInput] = useState("");
  const [isEpicDropdownOpen, setIsEpicDropdownOpen] = useState(false);
  const [showAllEpicSuggestions, setShowAllEpicSuggestions] = useState(false);
  const [burndownVisibleKeys, setBurndownVisibleKeys] = useState<string[]>([]);
  const [cfdVisibleKeys, setCfdVisibleKeys] = useState<string[]>([]);
  const [statusDrilldownFilter, setStatusDrilldownFilter] = useState<string | null>(null);

  const monthEpics = useMemo(
    () => collectMonthEpics(initiatives, month, filterEpicTeamId),
    [initiatives, month, filterEpicTeamId],
  );
  const monthStories = useMemo(
    () => collectMonthStories(initiatives, month, filterEpicTeamId),
    [initiatives, month, filterEpicTeamId],
  );
  const epicComboOptions = useMemo(
    () =>
      monthEpics.map(({ epic, initiative }) => ({
        id: epic.id,
        label: `${epic.title} (${initiative.title})`,
      })),
    [monthEpics],
  );
  const selectedEpicOption = useMemo(
    () => monthEpics.find(({ epic }) => epic.id === selectedEpicId) ?? null,
    [monthEpics, selectedEpicId],
  );
  const filteredEpicOptions = useMemo(() => {
    if (showAllEpicSuggestions) return epicComboOptions;
    const query = epicInput.trim().toLowerCase();
    if (!query) return epicComboOptions;
    return epicComboOptions.filter((opt) => opt.label.toLowerCase().includes(query));
  }, [epicComboOptions, epicInput, showAllEpicSuggestions]);
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
    if (selectedEpicId === "all") {
      setEpicInput("");
      return;
    }
    const selected = epicComboOptions.find((opt) => opt.id === selectedEpicId);
    if (!selected) {
      setSelectedEpicId("all");
      setEpicInput("");
      return;
    }
    setEpicInput(selected.label);
  }, [selectedEpicId, epicComboOptions]);

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

    const totalDays = new Date(planYear, month, 0).getDate();
    const dayDates = Array.from({ length: totalDays }, (_, idx) => new Date(planYear, month - 1, idx + 1));
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const monthStart = new Date(planYear, month - 1, 1).getTime();
    const monthEnd = new Date(planYear, month - 1, totalDays).getTime();
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
      if (story.status === "todo" || story.status === "inProgress") {
        row.openCount += 1;
        row.daysLeftTotal += Math.max(0, story.daysLeft ?? 0);
        row.estimatedTotal += Math.max(0, story.estimatedDays ?? story.daysLeft ?? 0);
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

    return {
      statusPie,
      burndown,
      workloadByAssignee,
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
    planYear,
    filterEpicTeamId,
    metric,
    selectedEpicOption,
    selectedWorkloadStatuses,
    selectedShowUnassigned,
  ]);

  const pieLegendItems = useMemo(() => analytics.statusPie.filter((x) => x.value > 0), [analytics.statusPie]);
  const pieData = pieLegendItems;
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
  const scopedStoryDisplayIds = useMemo(() => {
    const rows = [...scopedStories].sort((a, b) => {
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
  }, [scopedStories]);
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
        [month],
        planYear,
      ),
    [monthBurndownEpics, metric, month, planYear],
  );
  const monthBurndownFilledToToday = useMemo(() => {
    const horizon = monthBurndown.length;
    if (horizon === 0) return monthBurndown;
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === planYear && now.getMonth() + 1 === month;
    const elapsedDays = isCurrentMonth ? Math.max(1, Math.min(horizon, now.getDate())) : horizon;
    const seriesKeys = ["actual", ...monthBurndownEpics.map((epic) => epic.id)];
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
      const day = new Date(planYear, month - 1, dayIdx, 23, 59, 59, 999);
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
  }, [monthBurndown, monthBurndownFilledToToday, selectedEpicOption, monthEpics, planYear, month, metric]);
  const monthBurndownResolved = monthBurndownFromSnapshots ?? monthBurndownFilledToToday;
  const selectedEpicDueDate = useMemo(() => {
    if (!selectedEpicOption) return null;
    const dueMonth = selectedEpicOption.epic.planEndMonth ?? month;
    const dueYear = selectedEpicOption.epic.planYear ?? planYear;
    const dueDay = new Date(dueYear, dueMonth, 0).getDate();
    return new Date(dueYear, dueMonth - 1, dueDay);
  }, [selectedEpicOption, month, planYear]);
  const monthBurndownWithDueTarget = useMemo(() => {
    if (!selectedEpicOption || selectedEpicDueDate == null) return monthBurndownResolved;
    const totalDays = monthBurndownResolved.length;
    if (totalDays === 0) return monthBurndownResolved;
    const startValue =
      metric === "daysLeft"
        ? (selectedEpicOption.epic.userStories ?? []).reduce((sum, s) => sum + (s.estimatedDays ?? s.daysLeft ?? 1), 0)
        : (selectedEpicOption.epic.userStories ?? []).length;
    const monthStart = new Date(planYear, month - 1, 1);
    const msPerDay = 24 * 60 * 60 * 1000;
    const dueDayIndex = Math.floor((selectedEpicDueDate.getTime() - monthStart.getTime()) / msPerDay) + 1;
    return monthBurndownResolved.map((row, idx) => {
      const dayIdx = idx + 1;
      let epicIdealRaw: number;
      if (dueDayIndex <= 1) epicIdealRaw = 0;
      else epicIdealRaw = startValue * (1 - (dayIdx - 1) / (dueDayIndex - 1));
      const epicIdeal = metric === "storyCount"
        ? Math.max(0, Math.round(epicIdealRaw))
        : Number(Math.max(0, epicIdealRaw).toFixed(1));
      return { ...row, epicIdeal };
    });
  }, [monthBurndownResolved, selectedEpicOption, selectedEpicDueDate, metric, planYear, month]);
  const selectedEpicDueMarker = useMemo(() => {
    if (!selectedEpicDueDate || !selectedEpicOption) return null;
    const inCurrentMonth =
      selectedEpicDueDate.getFullYear() === planYear && selectedEpicDueDate.getMonth() + 1 === month;
    if (!inCurrentMonth) {
      const last = monthBurndownWithDueTarget[monthBurndownWithDueTarget.length - 1] as
        | (Record<string, number | string | boolean | null | undefined> & { axisLabel?: string })
        | undefined;
      if (!last?.axisLabel) return null;
      const lastIdeal = last.epicIdeal;
      return {
        axisLabel: String(last.axisLabel),
        y: typeof lastIdeal === "number" ? lastIdeal : 0,
        label: `Epic due ${selectedEpicDueDate.toLocaleDateString()}`,
      };
    }
    const day = selectedEpicDueDate.getDate();
    const point = monthBurndownWithDueTarget.find((row) => {
      const label = String(row.dayLabel ?? "");
      return label.startsWith(`${day}/${month} `);
    }) as (Record<string, number | string | boolean | null | undefined> & { axisLabel?: string }) | undefined;
    if (!point?.axisLabel) return null;
    const y = point.epicIdeal;
    return {
      axisLabel: String(point.axisLabel),
      y: typeof y === "number" ? y : 0,
      label: "Epic due",
    };
  }, [selectedEpicDueDate, selectedEpicOption, planYear, month, monthBurndownWithDueTarget]);
  const monthEndMarker = useMemo(() => {
    if (!selectedEpicOption) return null;
    const last = monthBurndownWithDueTarget[monthBurndownWithDueTarget.length - 1] as
      | (Record<string, number | string | boolean | null | undefined> & { axisLabel?: string; dayLabel?: string })
      | undefined;
    if (!last?.axisLabel) return null;
    const y = last.epicIdeal;
    return {
      axisLabel: String(last.axisLabel),
      y: typeof y === "number" ? y : 0,
      label: `Month end (${String(last.dayLabel ?? "")})`,
    };
  }, [selectedEpicOption, monthBurndownWithDueTarget]);
  const burndownLegendItems = useMemo(() => {
    if (selectedEpicOption) {
      return [
        { key: selectedEpicOption.epic.id, label: selectedEpicOption.epic.title, color: LINE_PALETTE[0] },
        { key: "epicIdeal", label: "Epic ideal to due", color: "#f97316" },
      ];
    }
    return [
      { key: "actual", label: "Actual", color: "#94a3b8" },
      ...monthBurndownEpics.slice(0, 6).map((epic, idx) => ({
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
      if (prev.includes(key)) {
        const next = prev.filter((k) => k !== key);
        return next.length > 0 ? next : prev;
      }
      return [...prev, key];
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

    const totalDays = new Date(planYear, month, 0).getDate();
    const dayDates = Array.from({ length: totalDays }, (_, idx) => new Date(planYear, month - 1, idx + 1, 23, 59, 59, 999));
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
  }, [selectedEpicOption, monthEpics, planYear, month]);
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
  useEffect(() => {
    if (workloadView !== "stories") {
      setCanScrollWorkloadUp(false);
      setCanScrollWorkloadDown(false);
      return;
    }
    updateWorkloadArrowState();
  }, [workloadView, analytics.workloadByAssignee.length, workloadStatusFilters]);

  const chartLegendColumnClass = "max-h-[15rem] space-y-1.5 overflow-y-auto pr-0";
  const legendRowClass =
    "flex items-center gap-1.5 rounded-lg bg-slate-50/80 px-1.5 py-1.5 text-[12px] font-medium text-slate-700";

  return (
    <section className="mb-2 flex flex-col gap-3.5">
      <div className="-mt-1 rounded-xl bg-slate-100/70 px-2 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-slate-700" htmlFor="month-insights-epic-filter">
            <Folder className="size-4 text-slate-500" aria-hidden />
            Epic Scope
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
                  return;
                }
                const exact = epicComboOptions.find((opt) => opt.label === v);
                if (exact) setSelectedEpicId(exact.id);
              }}
              placeholder="Select a specific epic to filter all charts"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] font-semibold text-slate-700"
              aria-label="Filter month insights by epic across all charts"
            />
            {isEpicDropdownOpen ? (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-56 overflow-auto rounded-xl bg-white p-1.5 shadow-xl">
                {filteredEpicOptions.length > 0 ? (
                  filteredEpicOptions.map((opt) => (
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
        <h3 className="mb-2 inline-flex shrink-0 items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <PieChartIcon className="size-4 text-slate-600" />
          User stories status{selectedEpicOption ? ` (${selectedEpicOption.epic.title})` : ""}
        </h3>
        {statusDrilldownFilter ? (
          <div className="mt-2 rounded-lg border border-slate-200/80 bg-white/80 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[12px] font-semibold text-slate-700">
                Stories in <span className="text-slate-900">{statusDrilldownFilter}</span> ({statusDrilldownStories.length})
              </p>
              <button
                type="button"
                onClick={clearStatusDrilldown}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                aria-label="Back to chart"
                title="Back to chart"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
              </button>
            </div>
            <div className="max-h-[11rem] overflow-auto">
              <table className="w-full border-collapse text-left text-[12px]">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-1 font-semibold">Story ID</th>
                    <th className="px-2 py-1 font-semibold">Story name</th>
                    <th className="px-2 py-1 font-semibold">Sprint</th>
                    <th className="px-2 py-1 font-semibold">Assignee</th>
                    <th className="px-2 py-1 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {statusDrilldownStories.map((story) => (
                    <tr key={story.id} className="border-t border-slate-100 text-slate-700">
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          onClick={() => onOpenStory?.(story.id)}
                          className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                        >
                          {scopedStoryDisplayIds.get(story.id) ?? story.id.slice(0, 8)}
                        </button>
                      </td>
                      <td className="px-2 py-1">{story.title}</td>
                      <td className="px-2 py-1">
                        {normalizeStoryYearSprint(story.sprint, month) != null ? (
                          <button
                            type="button"
                            onClick={() => {
                              const targetYearSprint = normalizeStoryYearSprint(story.sprint, month);
                              if (targetYearSprint == null) return;
                              onOpenSprintKanban?.(targetYearSprint, resolveStoryTeamForSprintNav(story));
                            }}
                            className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                          >
                            {storySprintDisplayLabel(story.sprint, month)}
                          </button>
                        ) : (
                          "Unscheduled"
                        )}
                      </td>
                      <td className="px-2 py-1">{story.assignee?.trim() || "Unassigned"}</td>
                      <td className="px-2 py-1">
                        {story.sprint == null
                          ? "Unscheduled"
                          : story.status === "todo"
                            ? "To do"
                            : story.status === "inProgress"
                              ? "In progress"
                              : story.status === "done"
                                ? "Done"
                                : "Approved"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_10.5rem] md:items-stretch">
            <div
              className={`relative rounded-lg bg-gradient-to-br from-slate-50/80 via-white to-slate-50/80 ${SPRINT_CHART_BOX}`}
            >
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
                  <Tooltip content={(props) => <StatusPieTooltip {...props} total={pieTotal} />} />
                </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-1/2 top-[43%] -translate-x-1/2 -translate-y-1/2 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Σ Stories</p>
                  <p className="text-[18px] leading-none font-bold text-slate-900">{pieTotal}</p>
                </div>
              </div>
            </div>
            <div className={`space-y-0.5 ${PIE_LEGEND_CAP}`}>
              <button
                type="button"
                onClick={() => openStatusDrilldown("All")}
                className="mb-0.5 w-full rounded-md px-1 py-1 text-left text-[12px] font-semibold text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="size-3.5" aria-hidden />
                  All
                </span>
              </button>
              {pieLegendItems.map((slice) => {
                const pct = pieTotal > 0 ? Math.round((slice.value / pieTotal) * 100) : 0;
                return (
                  <button
                    key={slice.name}
                    type="button"
                    onClick={() => openStatusDrilldown(slice.name)}
                    className="mb-0.5 flex w-full items-center justify-between gap-1.5 rounded-md px-1 py-1 text-left text-[12px] text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-700"
                  >
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[slice.name] ?? "#94a3b8" }}
                      />
                      {slice.name}
                    </span>
                    <span className="text-[12px] font-semibold text-slate-500">
                      {slice.value} <span className="text-slate-500">({pct}%)</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </article>

      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-2 lg:h-full lg:pl-4">
        <div className="mb-6 flex shrink-0 items-center justify-between gap-2">
          <h3 className="ml-[48px] inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
            <Activity className="size-4 text-slate-600" />
            Burndown
          </h3>
          <div className="flex items-center gap-2">
            <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setMetric("daysLeft")}
                className={`rounded-md px-2 py-0 text-[12px] font-medium ${
                  metric === "daysLeft" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600"
                }`}
              >
                Days left
              </button>
              <button
                type="button"
                onClick={() => setMetric("storyCount")}
                className={`rounded-md px-2 py-0 text-[12px] font-medium ${
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
                  "rounded-md px-2 py-0 text-[12px] font-medium",
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
                  "rounded-md px-2 py-0 text-[12px] font-medium",
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
        <div className="grid min-h-0 flex-1 gap-3 pl-5 md:grid-cols-[minmax(0,1fr)_10.5rem] md:items-stretch">
          <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
            {monthBurndownEpics.length > 0 ? (
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthBurndownWithDueTarget} margin={{ top: 2, right: 4, left: 18, bottom: 22 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="axisLabel"
                      interval="preserveStartEnd"
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      angle={-28}
                      textAnchor="end"
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
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.dayLabel ?? ""}
                      content={(props) => <BurndownTooltip {...props} metric={metric} />}
                      cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3", strokeOpacity: 0.5 }}
                    />
                    {!selectedEpicOption && burndownVisibleKeys.includes("actual") ? (
                      <Line type="monotone" dataKey="actual" stroke="#94a3b8" strokeWidth={2} dot={false} name="Actual" />
                    ) : null}
                    {selectedEpicOption && burndownVisibleKeys.includes(selectedEpicOption.epic.id) ? (
                      <Line
                        type="monotone"
                        dataKey={selectedEpicOption.epic.id}
                        stroke={LINE_PALETTE[0]}
                        strokeWidth={2}
                        dot={false}
                        name={selectedEpicOption.epic.title}
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
                    {selectedEpicOption && burndownVisibleKeys.includes("epicIdeal") ? (
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
                    {selectedEpicOption && monthEndMarker ? (
                      <ReferenceDot
                        x={monthEndMarker.axisLabel}
                        y={monthEndMarker.y}
                        r={4}
                        fill="#2563eb"
                        stroke="#ffffff"
                        strokeWidth={1.5}
                        label={{ value: monthEndMarker.label, position: "top", fill: "#1e3a8a", fontSize: 11 }}
                      />
                    ) : null}
                    {selectedEpicOption && selectedEpicDueMarker ? (
                      <ReferenceDot
                        x={selectedEpicDueMarker.axisLabel}
                        y={selectedEpicDueMarker.y}
                        r={4}
                        fill="#ef4444"
                        stroke="#ffffff"
                        strokeWidth={1.5}
                        label={{ value: selectedEpicDueMarker.label, position: "top", fill: "#b91c1c", fontSize: 11 }}
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
          <div className="relative max-h-[12rem]">
            <div
              ref={burndownLegendScrollRef}
              onScroll={updateBurndownArrowState}
              className="max-h-[12rem] space-y-1 overflow-y-auto pr-5 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <button
                type="button"
                onClick={showAllBurndownKeys}
                className={cn(
                  "mb-1 w-full rounded-md px-1 py-1 text-left text-[12px] font-semibold transition",
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
                      "mb-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12px] transition",
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
              {selectedEpicOption ? (
                <p className="text-[11px] text-slate-500">
                  Due: {selectedEpicDueDate ? selectedEpicDueDate.toLocaleDateString() : "N/A"}
                </p>
              ) : monthBurndownEpics.length > 6 ? (
                <p className="text-[11px] text-slate-500">+{monthBurndownEpics.length - 6} more epics</p>
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-1 lg:h-full">
        <div className="mb-5 flex shrink-0 items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
            <ChartNoAxesCombined className="size-4 text-slate-600" />
            Workload Balance
          </h3>
          <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => setWorkloadView("stories")}
              className={cn(
                "rounded-md px-2 py-0 text-[12px] font-medium",
                workloadView === "stories" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
              )}
            >
              Stories
            </button>
            <button
              type="button"
              onClick={() => setWorkloadView("monthLoad")}
              className={cn(
                "rounded-md px-2 py-0 text-[12px] font-medium",
                workloadView === "monthLoad" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
              )}
            >
              Month Load
            </button>
          </div>
        </div>
        {workloadView === "stories" ? (
          <div className="relative min-h-0 max-h-[13rem] flex-1">
            <div className="grid min-h-0 max-h-[13rem] gap-2 md:grid-cols-[minmax(0,1fr)_6.25rem] md:items-stretch">
            <div
              ref={workloadStoriesScrollRef}
              onScroll={updateWorkloadArrowState}
              className="min-h-0 max-h-[13rem] space-y-2.5 overflow-y-auto overflow-x-hidden pr-5 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {analytics.workloadByAssignee.length > 0 ? (
                analytics.workloadByAssignee.map((item) => {
                const { storiesByStatus: st } = item;
                const storyTotal = item.selectedStoryCount;
                const barWidthPct = Math.max(12, Math.min(100, (storyTotal / analytics.workloadMaxStoryTotal) * 100));
                return (
                  <div key={item.assignee}>
                  <div className="flex items-center gap-2 text-[12px] text-slate-700">
                    <span className="w-16 shrink-0 truncate font-medium">{item.assignee}</span>
                    <div className="h-2.5 min-w-0 flex-1 max-w-[15.5rem] overflow-hidden rounded-full bg-slate-200/90 ring-1 ring-slate-200/80">
                      <div
                        className="flex h-full min-w-0 overflow-hidden rounded-full shadow-sm ring-1 ring-slate-300/40"
                        style={{ width: `${barWidthPct}%` }}
                      >
                        {WORKLOAD_BAR_SEGMENTS.map(({ key, color }) => {
                          if (!selectedWorkloadStatuses.includes(key)) return null;
                          const n = st[key];
                          if (n <= 0) return null;
                          return (
                            <div
                              key={key}
                              className="h-full min-w-px"
                              style={{ flexGrow: n, flexBasis: 0, backgroundColor: color }}
                            />
                          );
                        })}
                      </div>
                    </div>
                    <span className="shrink-0 tabular-nums text-slate-600">
                      {item.selectedStoryCount} stories
                    </span>
                    </div>
                  </div>
                );
                })
              ) : (
                <p className="text-[12px] text-slate-500">No open workload found for this month.</p>
              )}
            </div>
            <div className="space-y-1.5 pr-0.5">
              <button
                type="button"
                onClick={() => toggleWorkloadStatusFilter("all")}
                className={cn(
                  "mb-1 w-full rounded-md px-1 py-1 text-left text-[12px] font-semibold transition",
                  workloadStatusFilters.includes("all")
                    ? "text-slate-900 hover:bg-slate-200/70"
                    : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-800",
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="size-3.5" aria-hidden />
                  All
                </span>
              </button>
              {WORKLOAD_BAR_SEGMENTS.map((s) => {
                const on = workloadStatusFilters.includes("all") || workloadStatusFilters.includes(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => toggleWorkloadStatusFilter(s.key)}
                    className={cn(
                      "mb-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12px] transition",
                      on ? "text-slate-900 hover:bg-slate-200/70" : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-700",
                    )}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color, opacity: on ? 1 : 0.35 }}
                    />
                    <span className="font-medium">{s.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => toggleWorkloadStatusFilter("unassigned")}
                className={cn(
                  "mb-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12px] transition",
                  selectedShowUnassigned ? "text-slate-900 hover:bg-slate-200/70" : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-700",
                )}
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS.Unscheduled, opacity: selectedShowUnassigned ? 1 : 0.35 }}
                />
                <span className="font-medium">Unassigned</span>
              </button>
            </div>
            </div>
            <button
              type="button"
              onClick={() => scrollWorkloadStoriesBy(-96)}
              className={cn(
                "absolute right-0 top-0 inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                canScrollWorkloadUp && "bg-slate-200/70 text-slate-800",
              )}
              aria-label="Scroll up workload list"
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => scrollWorkloadStoriesBy(96)}
              className={cn(
                "absolute bottom-0 right-0 inline-flex items-center justify-center rounded-md p-1 text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800",
                canScrollWorkloadDown && "bg-slate-200/70 text-slate-800",
              )}
              aria-label="Scroll down workload list"
            >
              <ChevronDown className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className={`min-h-0 flex-1 space-y-2.5 ${WORKLOAD_LIST_MAX}`}>
            {analytics.workloadCapacityByAssignee.length > 0 ? (
              analytics.workloadCapacityByAssignee.map((row) => {
              const pct = row.utilizationPct;
              const barW = analytics.monthDaysLeft > 0 ? Math.min(pct, 100) : row.daysLeftTotal > 0 ? 100 : 0;
              const pctRounded = Math.round(pct);
              return (
                <div key={row.assignee}>
                  <div className="mb-0.5 flex items-center gap-2 text-[12px] text-slate-700">
                    <span className="w-16 shrink-0 truncate font-medium">{row.assignee}</span>
                    <div className="h-2.5 min-w-0 flex-1 max-w-[15.5rem] overflow-hidden rounded-full ring-1 ring-slate-200/80">
                      <div
                        className={cn("h-full rounded-full transition-colors", row.isOverCapacity ? "bg-red-600" : "bg-emerald-500")}
                        style={{ width: `${barW}%` }}
                        role="presentation"
                      />
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-600">
                      {row.estimatedTotal}d est · {row.daysLeftTotal}d left
                    </span>
                  </div>
                  <p className={cn("mt-0.5 text-[11px] tabular-nums", row.isOverCapacity ? "text-red-600" : "text-slate-500")}>
                    {analytics.monthDaysLeft > 0 ? `${pctRounded}% of remaining month capacity` : "Month ended"}
                  </p>
                </div>
              );
              })
            ) : (
              <p className="text-[12px] text-slate-500">No open workload found for this month.</p>
            )}
          </div>
        )}
        <p className="mt-2 shrink-0 text-[12px] text-slate-600">
          {analytics.openStories} open stories, <span className="text-amber-700">{analytics.atRiskStories} at risk</span>.
        </p>
      </article>

      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-2 lg:h-full lg:pl-4">
        <h3 className="mb-2 ml-[48px] inline-flex shrink-0 items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <Activity className="size-4 text-slate-600" />
          Cumulative flow
        </h3>
        <div className="grid min-h-0 flex-1 gap-3 pl-5 md:grid-cols-[minmax(0,1fr)_10.5rem] md:items-stretch">
          <div className="relative min-h-[15rem] min-w-0 md:h-full">
            {flowResolved.length > 0 ? (
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={flowResolved} margin={{ top: 4, right: 4, left: 18, bottom: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="labelShort"
                      interval="preserveStartEnd"
                      tick={{ fontSize: 11, fill: "#475569" }}
                      angle={-28}
                      textAnchor="end"
                      tickMargin={2}
                      height={36}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      width={40}
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
          <div className={chartLegendColumnClass}>
            <button
              type="button"
              onClick={showAllCfdKeys}
              className={cn(
                "mb-1 w-full rounded-md px-1 py-1 text-left text-[12px] font-semibold transition",
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
                    "mb-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12px] transition",
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
