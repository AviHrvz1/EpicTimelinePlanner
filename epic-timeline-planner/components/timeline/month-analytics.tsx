"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ChartNoAxesCombined, PieChart as PieChartIcon } from "lucide-react";
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
  ReferenceLine,
} from "recharts";

import { epicForBurndown, type EstimateSource } from "@/lib/epic-estimates";
import { buildQuarterBurndownSeries } from "@/lib/quarter-analytics";
import { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type BurndownMetric = "daysLeft" | "storyCount";
type WorkloadViewMode = "stories" | "monthLoad";

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

const CFD_FLOW_SEGMENTS = [
  { key: "approved" as const, label: "Approved", color: STATUS_COLORS["Approved"] },
  { key: "done" as const, label: "Done", color: STATUS_COLORS["Done"] },
  { key: "inProgress" as const, label: "In progress", color: STATUS_COLORS["In progress"] },
  { key: "todo" as const, label: "To do", color: STATUS_COLORS["To do"] },
] as const;

const SPRINT_CHART_BOX =
  "min-h-40 h-40 w-full md:min-h-40 md:h-[clamp(10.5rem,27dvh,14.5rem)] md:max-h-[clamp(10.5rem,27dvh,14.5rem)]";
const PIE_LEGEND_CAP = "md:max-h-[clamp(10.5rem,27dvh,14.5rem)] md:overflow-y-auto md:pr-1";
const WORKLOAD_LIST_MAX =
  "max-h-[min(12rem,30dvh)] overflow-y-auto overflow-x-hidden overscroll-contain md:max-h-[clamp(10.5rem,27dvh,14.5rem)]";
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const LINE_PALETTE = ["#2563eb", "#0d9488", "#7c3aed", "#ea580c", "#14b8a6", "#be185d", "#0284c7"];

type MonthAnalyticsProps = {
  initiatives: InitiativeItem[];
  month: number;
  planYear: number;
  filterEpicTeamId?: string | null;
};

function flowChartDayLabel(dayDate: Date): string {
  const d = dayDate.getDate();
  const m = dayDate.getMonth() + 1;
  const w = WEEKDAY_SHORT[dayDate.getDay()];
  return `${d}/${m}(${w})`;
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

export function MonthAnalytics({ initiatives, month, planYear, filterEpicTeamId = null }: MonthAnalyticsProps) {
  const [metric, setMetric] = useState<BurndownMetric>("daysLeft");
  const [estimateSource, setEstimateSource] = useState<EstimateSource>("auto");
  const [workloadView, setWorkloadView] = useState<WorkloadViewMode>("stories");
  const [selectedEpicId, setSelectedEpicId] = useState<string>("all");
  const [epicInput, setEpicInput] = useState("");

  const monthEpics = useMemo(
    () => collectMonthEpics(initiatives, month, filterEpicTeamId),
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
    const monthStories = collectMonthStories(initiatives, month, filterEpicTeamId);
    const scopeStories =
      selectedEpicOption != null ? (selectedEpicOption.epic.userStories ?? []) : monthStories;
    const scheduledStories = scopeStories.filter((story) => story.sprint != null);
    const openStories = scheduledStories.filter((story) => story.status === "todo" || story.status === "inProgress");

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
        ? scheduledStories.reduce((sum, s) => sum + (s.estimatedDays ?? s.daysLeft ?? 1), 0)
        : scheduledStories.length;
    const actualRemaining =
      metric === "daysLeft"
        ? scheduledStories.reduce((sum, s) => sum + Math.max(0, s.daysLeft ?? 0), 0)
        : scheduledStories.filter((s) => s.status !== "done" && s.status !== "approved").length;
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
      .filter(([, v]) => v.openCount > 0)
      .map(([assignee, v]) => ({ assignee, ...v }))
      .sort((a, b) => b.daysLeftTotal - a.daysLeftTotal || b.openCount - a.openCount || a.assignee.localeCompare(b.assignee));
    const workloadMaxStoryTotal = Math.max(
      1,
      ...workloadByAssignee.map(
        (item) =>
          item.storiesByStatus.todo +
          item.storiesByStatus.inProgress +
          item.storiesByStatus.done +
          item.storiesByStatus.approved,
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

    const total = scheduledStories.length;
    const flowSprintTrendData = dayDates.map((dayDate, dayIndex) => {
      const dayInMonth = dayIndex + 1;
      const progress = dayInMonth <= today1Based ? (dayInMonth - 1) / Math.max(today1Based - 1, 1) : 1;
      const approved = Math.round(statusCounts.approved * progress);
      const done = Math.round(statusCounts.done * progress);
      const inProgressBase = Math.round(statusCounts.inProgress * Math.min(1, progress * 1.1));
      const inProgress = Math.min(Math.max(0, total - approved - done), inProgressBase);
      const todo = Math.max(0, total - approved - done - inProgress);
      return {
        dayInMonth,
        labelShort: flowChartDayLabel(dayDate),
        isToday: new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate()).getTime() === startToday,
        todo,
        inProgress,
        done,
        approved,
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
  }, [initiatives, month, planYear, filterEpicTeamId, metric, selectedEpicOption]);

  const pieData = analytics.statusPie.filter((x) => x.value > 0);
  const pieTotal = pieData.reduce((sum, item) => sum + item.value, 0);
  const topSlice = pieData[0] ?? null;
  const monthBurndownEpics = useMemo(() => {
    const source = selectedEpicOption != null ? [selectedEpicOption.epic] : monthEpics.map((row) => row.epic);
    return source.map((epic) => epicForBurndown(epic, estimateSource));
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
  const selectedEpicDueDate = useMemo(() => {
    if (!selectedEpicOption) return null;
    const dueMonth = selectedEpicOption.epic.planEndMonth ?? month;
    const dueYear = selectedEpicOption.epic.planYear ?? planYear;
    const dueDay = new Date(dueYear, dueMonth, 0).getDate();
    return new Date(dueYear, dueMonth - 1, dueDay);
  }, [selectedEpicOption, month, planYear]);
  const monthBurndownWithDueTarget = useMemo(() => {
    if (!selectedEpicOption || selectedEpicDueDate == null) return monthBurndown;
    const totalDays = monthBurndown.length;
    if (totalDays === 0) return monthBurndown;
    const startValue =
      metric === "daysLeft"
        ? (selectedEpicOption.epic.userStories ?? []).reduce((sum, s) => sum + (s.estimatedDays ?? s.daysLeft ?? 1), 0)
        : (selectedEpicOption.epic.userStories ?? []).length;
    const monthStart = new Date(planYear, month - 1, 1);
    const msPerDay = 24 * 60 * 60 * 1000;
    const dueDayIndex = Math.floor((selectedEpicDueDate.getTime() - monthStart.getTime()) / msPerDay) + 1;
    return monthBurndown.map((row, idx) => {
      const dayIdx = idx + 1;
      let epicIdealRaw: number;
      if (dueDayIndex <= 1) epicIdealRaw = 0;
      else epicIdealRaw = startValue * (1 - (dayIdx - 1) / (dueDayIndex - 1));
      const epicIdeal = metric === "storyCount"
        ? Math.max(0, Math.round(epicIdealRaw))
        : Number(Math.max(0, epicIdealRaw).toFixed(1));
      return { ...row, epicIdeal };
    });
  }, [monthBurndown, selectedEpicOption, selectedEpicDueDate, metric, planYear, month]);
  const selectedEpicDueAxisLabel = useMemo(() => {
    if (!selectedEpicDueDate) return null;
    if (selectedEpicDueDate.getFullYear() !== planYear || selectedEpicDueDate.getMonth() + 1 !== month) return null;
    const day = selectedEpicDueDate.getDate();
    const point = monthBurndown.find((row) => {
      const label = String(row.dayLabel ?? "");
      return label.startsWith(`${day}/${month} `);
    });
    return point?.axisLabel ?? null;
  }, [selectedEpicDueDate, planYear, month, monthBurndown]);

  const chartLegendColumnClass = `space-y-1.5 md:max-h-[clamp(10.5rem,27dvh,14.5rem)] md:overflow-y-auto md:pr-0`;
  const legendRowClass =
    "flex items-center gap-1.5 rounded-lg bg-slate-50/80 px-1.5 py-1.5 text-[12px] font-medium text-slate-700";
  const epicScopeLabel =
    selectedEpicOption != null ? `${selectedEpicOption.epic.title} (${selectedEpicOption.initiative.title})` : "All epics";

  return (
    <section className="mb-2 flex flex-col gap-4">
      <div className="rounded-lg border border-slate-200/80 bg-white/80 px-3 py-2.5 shadow-sm ring-1 ring-slate-100/80">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[12px] font-semibold text-slate-700" htmlFor="month-insights-epic-filter">
            Epic scope (applies to all charts)
          </label>
          <input
            id="month-insights-epic-filter"
            list="month-insights-epic-options"
            value={epicInput}
            onChange={(e) => {
              const v = e.target.value;
              setEpicInput(v);
              if (!v.trim()) {
                setSelectedEpicId("all");
                return;
              }
              const exact = epicComboOptions.find((opt) => opt.label === v);
              if (exact) setSelectedEpicId(exact.id);
            }}
            placeholder="Type epic name to filter all charts (leave empty for all epics)"
            className="h-9 min-w-[22rem] flex-1 rounded-md border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-700"
            aria-label="Filter month insights by epic across all charts"
          />
          <datalist id="month-insights-epic-options">
            {epicComboOptions.map((opt) => (
              <option key={opt.id} value={opt.label} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => {
              setSelectedEpicId("all");
              setEpicInput("");
            }}
            className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            All epics
          </button>
          <span className="text-[12px] text-slate-500">Current: {epicScopeLabel}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-1 lg:h-full">
        <h3 className="mb-2 inline-flex shrink-0 items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <PieChartIcon className="size-4 text-slate-600" />
          User stories status{selectedEpicOption ? ` (${selectedEpicOption.epic.title})` : ""}
        </h3>
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
                  cy="50%"
                  innerRadius="38%"
                  outerRadius="68%"
                  paddingAngle={3}
                  cornerRadius={8}
                  stroke="#ffffff"
                  strokeWidth={2}
                  labelLine={false}
                  filter="url(#monthPieShadow)"
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [
                    `${Number(value ?? 0)} (${pieTotal > 0 ? Math.round((Number(value ?? 0) / pieTotal) * 100) : 0}%)`,
                    name,
                  ]}
                />
              </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className={`space-y-1.5 ${PIE_LEGEND_CAP}`}>
            {pieData.map((slice) => {
              const pct = pieTotal > 0 ? Math.round((slice.value / pieTotal) * 100) : 0;
              return (
                <div key={slice.name} className="flex items-center justify-between rounded-lg bg-slate-50/80 px-2 py-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-700">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[slice.name] ?? "#94a3b8" }}
                    />
                    {slice.name}
                  </span>
                  <span className="text-[12px] font-semibold text-slate-900">
                    {slice.value} <span className="text-slate-500">({pct}%)</span>
                  </span>
                </div>
              );
            })}
            {topSlice ? (
              <p className="pt-0.5 text-[11px] text-slate-600">
                Largest: <span className="font-semibold text-slate-800">{topSlice.name}</span>
              </p>
            ) : null}
          </div>
        </div>
      </article>

      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-2 lg:h-full">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
            <Activity className="size-4 text-slate-600" />
            Burndown
          </h3>
          <div className="flex items-center gap-2">
            <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setMetric("daysLeft")}
                className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium ${
                  metric === "daysLeft" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600"
                }`}
              >
                Days left
              </button>
              <button
                type="button"
                onClick={() => setMetric("storyCount")}
                className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium ${
                  metric === "storyCount" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600"
                }`}
              >
                Stories
              </button>
            </div>
            <select
              value={estimateSource}
              onChange={(e) => setEstimateSource(e.target.value as EstimateSource)}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-700"
              aria-label="Burndown estimate source"
            >
              <option value="auto">Auto (stories, else original)</option>
              <option value="original">Original estimate</option>
              <option value="stories">Σ Stories only</option>
            </select>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_10.5rem] md:items-stretch">
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
                    <YAxis allowDecimals={metric !== "storyCount"} tick={{ fontSize: 10 }} width={44} />
                    <Tooltip
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.dayLabel ?? ""}
                      formatter={(value, name) => [
                        metric === "storyCount" && typeof value === "number" ? Math.round(value) : value,
                        name,
                      ]}
                    />
                    <Line type="monotone" dataKey="ideal" stroke="#94a3b8" dot={false} name="Ideal" />
                    {selectedEpicOption ? (
                      <Line
                        type="monotone"
                        dataKey={selectedEpicOption.epic.id}
                        stroke={LINE_PALETTE[0]}
                        strokeWidth={2}
                        dot={false}
                        name={selectedEpicOption.epic.title}
                      />
                    ) : monthBurndownEpics.map((epic, idx) => (
                      <Line
                        key={epic.id}
                        type="monotone"
                        dataKey={epic.id}
                        stroke={LINE_PALETTE[idx % LINE_PALETTE.length]}
                        strokeWidth={2}
                        dot={false}
                        name={epic.title}
                      />
                    ))}
                    {selectedEpicOption ? (
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
                    {selectedEpicOption && selectedEpicDueAxisLabel ? (
                      <ReferenceLine
                        x={selectedEpicDueAxisLabel}
                        stroke="#ef4444"
                        strokeDasharray="3 3"
                        label={{ value: "Epic due", position: "insideTopRight", fill: "#b91c1c", fontSize: 11 }}
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
          <div className={chartLegendColumnClass}>
            <div className={legendRowClass}>
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[#94a3b8]" />
              Ideal
            </div>
            {(selectedEpicOption ? [selectedEpicOption.epic] : monthBurndownEpics.slice(0, 6)).map((epic, idx) => (
              <div key={epic.id} className={legendRowClass}>
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: LINE_PALETTE[idx % LINE_PALETTE.length] }}
                />
                <span className="truncate">{epic.title}</span>
              </div>
            ))}
            {selectedEpicOption ? (
              <>
                <div className={legendRowClass}>
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-orange-500" />
                  Epic ideal to due
                </div>
                <p className="text-[11px] text-slate-500">
                  Due: {selectedEpicDueDate ? selectedEpicDueDate.toLocaleDateString() : "N/A"}
                </p>
              </>
            ) : monthBurndownEpics.length > 6 ? (
              <p className="text-[11px] text-slate-500">+{monthBurndownEpics.length - 6} more epics</p>
            ) : null}
          </div>
        </div>
      </article>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-1">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
            <ChartNoAxesCombined className="size-4 text-slate-600" />
            Workload balance
          </h3>
          <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => setWorkloadView("stories")}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[13px] font-medium",
                workloadView === "stories" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
              )}
            >
              Stories
            </button>
            <button
              type="button"
              onClick={() => setWorkloadView("monthLoad")}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[13px] font-medium",
                workloadView === "monthLoad" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
              )}
            >
              Month load
            </button>
          </div>
        </div>
        {workloadView === "stories" ? (
          <div className="mb-2 flex shrink-0 flex-nowrap items-center gap-3 overflow-x-auto text-[10px] leading-tight whitespace-nowrap text-slate-600 sm:text-[11px]">
            {WORKLOAD_BAR_SEGMENTS.map((s) => (
              <span key={s.key} className="inline-flex min-w-0 items-center gap-1">
                <span className="h-2 w-2 shrink-0 rounded-[2px] ring-1 ring-black/10" style={{ backgroundColor: s.color }} />
                <span className="truncate">{s.label}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div className={`min-h-0 flex-1 space-y-2.5 ${WORKLOAD_LIST_MAX}`}>
          {workloadView === "stories" ? (
            analytics.workloadByAssignee.length > 0 ? (
              analytics.workloadByAssignee.map((item) => {
                const { storiesByStatus: st } = item;
                const storyTotal = st.todo + st.inProgress + st.done + st.approved;
                const barWidthPct = Math.max(12, Math.min(100, (storyTotal / analytics.workloadMaxStoryTotal) * 100));
                return (
                  <div key={item.assignee}>
                  <div className="flex items-center gap-2 text-[12px] text-slate-700">
                    <span className="w-16 shrink-0 truncate font-medium">{item.assignee}</span>
                    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200/90 ring-1 ring-slate-200/80">
                      <div
                        className="flex h-full min-w-0 overflow-hidden rounded-full shadow-sm ring-1 ring-slate-300/40"
                        style={{ width: `${barWidthPct}%` }}
                      >
                        {WORKLOAD_BAR_SEGMENTS.map(({ key, color }) => {
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
                      {item.daysLeftTotal}d left · {item.openCount} open
                    </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-[12px] text-slate-500">No open workload found for this month.</p>
            )
          ) : analytics.workloadCapacityByAssignee.length > 0 ? (
            analytics.workloadCapacityByAssignee.map((row) => {
              const pct = row.utilizationPct;
              const barW = analytics.monthDaysLeft > 0 ? Math.min(pct, 100) : row.daysLeftTotal > 0 ? 100 : 0;
              const pctRounded = Math.round(pct);
              return (
                <div key={row.assignee}>
                  <div className="mb-0.5 flex items-center gap-2 text-[12px] text-slate-700">
                    <span className="w-16 shrink-0 truncate font-medium">{row.assignee}</span>
                    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full ring-1 ring-slate-200/80">
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
        <p className="mt-2 shrink-0 text-[12px] text-slate-600">
          {analytics.openStories} open stories, <span className="text-amber-700">{analytics.atRiskStories} at risk</span>.
        </p>
      </article>

      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-2">
        <h3 className="mb-2 inline-flex shrink-0 items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <Activity className="size-4 text-slate-600" />
          Cumulative flow
        </h3>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10.5rem] md:items-stretch">
          <div className={`relative min-w-0 ${SPRINT_CHART_BOX}`}>
            {analytics.flowSprintTrendData.length > 0 ? (
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.flowSprintTrendData} margin={{ top: 4, right: 4, left: 18, bottom: 28 }}>
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
                      label={{ value: "Stories", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }}
                    />
                    <Tooltip
                      formatter={(value, name) => [`${value} stories`, name]}
                      labelFormatter={(_, payload) => {
                        const row = payload?.[0]?.payload as { dayInMonth?: number; labelShort?: string } | undefined;
                        if (row?.dayInMonth != null && row.labelShort) return `Day ${row.dayInMonth} · ${row.labelShort}`;
                        return "";
                      }}
                    />
                    {CFD_FLOW_SEGMENTS.map(({ key, label, color }) => (
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
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-slate-500">No month days to chart.</div>
            )}
          </div>
          <div className={chartLegendColumnClass}>
            {[...CFD_FLOW_SEGMENTS].reverse().map(({ label, color }) => (
              <div key={label} className={legendRowClass}>
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] ring-1 ring-black/10"
                  style={{ backgroundColor: color }}
                />
                {label}
              </div>
            ))}
          </div>
        </div>
      </article>
      </div>
    </section>
  );
}
