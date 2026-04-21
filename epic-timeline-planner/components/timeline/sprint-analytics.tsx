"use client";

import { useMemo, useState } from "react";
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
} from "recharts";

import { buildSprintAnalytics, BurndownMetric } from "@/lib/sprint-analytics";
import { type EstimateSource } from "@/lib/epic-estimates";
import { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type WorkloadViewMode = "stories" | "sprintLoad";

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
  "min-h-40 h-40 w-full md:min-h-40 md:h-[clamp(10.5rem,27dvh,14.5rem)] md:max-h-[clamp(10.5rem,27dvh,14.5rem)]";
/** Keep legend beside pie from growing taller than the pie plot on md+. */
const PIE_LEGEND_CAP = "md:max-h-[clamp(10.5rem,27dvh,14.5rem)] md:overflow-y-auto md:pr-1";
const WORKLOAD_LIST_MAX =
  "max-h-[min(12rem,30dvh)] overflow-y-auto overflow-x-hidden overscroll-contain md:max-h-[clamp(10.5rem,27dvh,14.5rem)]";

type SprintAnalyticsProps = {
  initiatives: InitiativeItem[];
  month: number;
  yearSprint: number;
  planYear: number;
  filterEpicTeamId?: string | null;
};

export function SprintAnalytics({
  initiatives,
  month,
  yearSprint,
  planYear,
  filterEpicTeamId = null,
}: SprintAnalyticsProps) {
  const [metric, setMetric] = useState<BurndownMetric>("daysLeft");
  const [estimateSource, setEstimateSource] = useState<EstimateSource>("auto");
  const [workloadView, setWorkloadView] = useState<WorkloadViewMode>("stories");
  const analytics = useMemo(
    () =>
      buildSprintAnalytics(initiatives, month, yearSprint, metric, planYear, filterEpicTeamId, estimateSource),
    [initiatives, month, yearSprint, metric, planYear, filterEpicTeamId, estimateSource],
  );

  const pieData = analytics.statusPie.filter((x) => x.value > 0);
  const pieTotal = pieData.reduce((sum, item) => sum + item.value, 0);
  const topSlice = pieData[0] ?? null;

  const chartLegendColumnClass = `space-y-1.5 md:max-h-[clamp(10.5rem,27dvh,14.5rem)] md:overflow-y-auto md:pr-0`;
  const legendRowClass =
    "flex items-center gap-1.5 rounded-lg bg-slate-50/80 px-1.5 py-1.5 text-[12px] font-medium text-slate-700";

  return (
    <section className="mb-2 flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <article className="flex min-h-0 min-w-0 flex-col p-1 lg:col-span-1 lg:h-full">
        <h3 className="mb-2 inline-flex shrink-0 items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <PieChartIcon className="size-4 text-slate-600" />
          User stories status
        </h3>
        <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_10.5rem] md:items-stretch">
          <div
            className={`relative rounded-lg bg-gradient-to-br from-slate-50/80 via-white to-slate-50/80 ${SPRINT_CHART_BOX}`}
          >
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
                  labelLine={false}
                  filter="url(#sprintPieShadow)"
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [
                    `${Number(value ?? 0)} (${
                      pieTotal > 0 ? Math.round((Number(value ?? 0) / pieTotal) * 100) : 0
                    }%)`,
                    name,
                  ]}
                />
              </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-white/90 px-4 py-2.5 text-center shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total</p>
                <p className="text-[24px] leading-none font-bold text-slate-900">{pieTotal}</p>
              </div>
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
              aria-label="Burndown and load estimate source"
            >
              <option value="auto">Auto (stories, else original)</option>
              <option value="original">Original estimate</option>
              <option value="stories">Σ Stories only</option>
            </select>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_10.5rem] md:items-stretch">
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
                  <YAxis allowDecimals={metric !== "storyCount"} tick={{ fontSize: 10 }} width={44} />
                  <Tooltip
                    formatter={(value, name) => [
                      metric === "storyCount" && typeof value === "number" ? Math.round(value) : value,
                      name,
                    ]}
                  />
                  <Line type="monotone" dataKey="ideal" stroke="#94a3b8" dot={false} name="Ideal" />
                  <Line type="monotone" dataKey="actual" stroke="#2563eb" strokeWidth={2} name="Actual" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className={chartLegendColumnClass}>
            <div className={legendRowClass}>
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[#94a3b8]" />
              Ideal
            </div>
            <div className={legendRowClass}>
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[#2563eb]" />
              Actual
            </div>
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
              onClick={() => setWorkloadView("sprintLoad")}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[13px] font-medium",
                workloadView === "sprintLoad" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
              )}
            >
              Sprint load
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
                const storyTotal =
                  st.todo + st.inProgress + st.done + st.approved;
                const barWidthPct = Math.max(
                  12,
                  Math.min(100, (storyTotal / analytics.workloadMaxStoryTotal) * 100),
                );
                const ariaPieces = WORKLOAD_BAR_SEGMENTS.filter((s) => st[s.key] > 0)
                  .map((s) => `${s.label} ${st[s.key]}`)
                  .join(", ");
                return (
                  <div key={item.assignee}>
                  <div className="flex items-center gap-2 text-[12px] text-slate-700">
                    <span className="w-16 shrink-0 truncate font-medium">{item.assignee}</span>
                    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200/90 ring-1 ring-slate-200/80">
                      <div
                        className="flex h-full min-w-0 overflow-hidden rounded-full shadow-sm ring-1 ring-slate-300/40"
                        style={{ width: `${barWidthPct}%` }}
                        role="img"
                        aria-label={`${item.assignee}: ${ariaPieces || "no stories"}`}
                      >
                        {WORKLOAD_BAR_SEGMENTS.map(({ key, label, color }) => {
                          const n = st[key];
                          if (n <= 0) return null;
                          return (
                            <div
                              key={key}
                              className="h-full min-w-px"
                              style={{ flexGrow: n, flexBasis: 0, backgroundColor: color }}
                              title={`${label}: ${n}`}
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
              <p className="text-[12px] text-slate-500">No open workload found for this sprint.</p>
            )
          ) : analytics.workloadCapacityByAssignee.length > 0 ? (
            analytics.workloadCapacityByAssignee.map((row) => {
              const sprintD = analytics.workloadSprintCalendarDaysLeft;
              const pct = row.utilizationPct;
              const barW = sprintD > 0 ? Math.min(pct, 100) : row.daysLeftTotal > 0 ? 100 : 0;
              const pctRounded = Math.round(pct);
              const rightMetaLabel = `${row.estimatedTotal}d est · ${row.daysLeftTotal}d left${
                sprintD > 0 ? ` · ${sprintD}d left in sprint` : " · sprint ended"
              }`;
              const overByPct = Math.max(0, pctRounded - 100);
              return (
                <div key={row.assignee}>
                  <div className="mb-0.5 flex items-center gap-2 text-[12px] text-slate-700">
                    <span className="w-16 shrink-0 truncate font-medium">{row.assignee}</span>
                    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full ring-1 ring-slate-200/80">
                      <div
                        className={cn(
                          "h-full rounded-full transition-colors",
                          row.isOverCapacity ? "bg-red-600" : "bg-emerald-500",
                        )}
                        style={{ width: `${barW}%` }}
                        role="presentation"
                      />
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-600">
                      {rightMetaLabel}
                    </span>
                  </div>
                  {sprintD > 0 && pct > 100 ? (
                    <p className="mt-0.5 text-[11px] font-medium tabular-nums text-red-600">
                      Overloaded by {overByPct}%
                    </p>
                  ) : sprintD > 0 && pct <= 100 ? (
                    <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                      {pctRounded}% of sprint time used
                    </p>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="text-[12px] text-slate-500">No open workload found for this sprint.</p>
          )}
        </div>
        <p className="mt-2 shrink-0 text-[12px] text-slate-600">
          {analytics.openStories} open stories, <span className="text-amber-700">{analytics.atRiskStories} at risk</span>
          .
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
                        value: "Unique people",
                        angle: -90,
                        position: "insideLeft",
                        fill: "#64748b",
                        fontSize: 10,
                      }}
                    />
                    <Tooltip
                      formatter={(value, name) => [`${value} unique people`, name]}
                      labelFormatter={(_, payload) => {
                        const row = payload?.[0]?.payload as
                          | {
                              dayInSprint?: number;
                              labelShort?: string;
                              todo?: number;
                              inProgress?: number;
                              done?: number;
                              approved?: number;
                            }
                          | undefined;
                        if (row?.dayInSprint != null && row.labelShort) {
                          const sum =
                            (row.todo ?? 0) + (row.inProgress ?? 0) + (row.done ?? 0) + (row.approved ?? 0);
                          return `Day ${row.dayInSprint} · ${row.labelShort} · stacked total ${sum}`;
                        }
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
              <div className="flex h-full items-center justify-center text-[12px] text-slate-500">No sprint days to chart.</div>
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
