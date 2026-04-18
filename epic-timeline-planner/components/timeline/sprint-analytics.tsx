"use client";

import { useMemo, useState } from "react";
import { Activity, ChartNoAxesCombined, PieChart as PieChartIcon } from "lucide-react";
import {
  Area,
  AreaChart,
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
import { InitiativeItem } from "@/lib/types";

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

type SprintAnalyticsProps = {
  initiatives: InitiativeItem[];
  month: number;
  yearSprint: number;
  planYear: number;
};

export function SprintAnalytics({ initiatives, month, yearSprint, planYear }: SprintAnalyticsProps) {
  const [metric, setMetric] = useState<BurndownMetric>("daysLeft");
  const analytics = useMemo(
    () => buildSprintAnalytics(initiatives, month, yearSprint, metric, planYear),
    [initiatives, month, yearSprint, metric, planYear],
  );

  const pieData = analytics.statusPie.filter((x) => x.value > 0);
  const pieTotal = pieData.reduce((sum, item) => sum + item.value, 0);
  const topSlice = pieData[0] ?? null;
  const renderSpacedLegend = ({
    payload,
  }: {
    payload?: ReadonlyArray<{ color?: string; value?: string }>;
  }) => (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[14px] text-slate-700">
      {(payload ?? []).map((entry) => (
        <span key={`${entry.value}-${entry.color}`} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-[2px]"
            style={{ backgroundColor: entry.color ?? "#94a3b8" }}
          />
          {entry.value}
        </span>
      ))}
    </div>
  );
  return (
    <section className="mb-4 flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <article className="min-w-0 p-1 lg:col-span-1">
        <h3 className="mb-2 inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <PieChartIcon className="size-4 text-slate-600" />
          User stories status
        </h3>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem] md:items-center">
          <div className="relative h-56 rounded-lg bg-gradient-to-br from-slate-50/80 via-white to-slate-50/80">
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
                  innerRadius={56}
                  outerRadius={84}
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
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-white/90 px-4 py-2.5 text-center shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total</p>
                <p className="text-[24px] leading-none font-bold text-slate-900">{pieTotal}</p>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
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

      <article className="min-w-0 p-1 lg:col-span-2">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
            <Activity className="size-4 text-slate-600" />
            Burndown
          </h3>
          <div className="inline-flex rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">
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
        </div>
        <div className="h-56 min-h-56 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%" minHeight={200}>
            <LineChart data={analytics.burndown} margin={{ top: 4, right: 8, left: 0, bottom: 28 }}>
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
                height={40}
              />
              <YAxis allowDecimals={metric !== "storyCount"} tick={{ fontSize: 11 }} width={46} />
              <Tooltip
                formatter={(value, name) => [
                  metric === "storyCount" && typeof value === "number" ? Math.round(value) : value,
                  name,
                ]}
              />
              <Legend content={renderSpacedLegend} />
              <Line type="monotone" dataKey="ideal" stroke="#94a3b8" dot={false} name="Ideal" />
              <Line type="monotone" dataKey="actual" stroke="#2563eb" strokeWidth={2} name="Actual" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </article>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <article className="min-w-0 p-1 lg:col-span-1">
        <h3 className="mb-2 inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <ChartNoAxesCombined className="size-4 text-slate-600" />
          Workload balance
        </h3>
        <div className="mb-3 grid grid-cols-2 gap-x-2 gap-y-1.5 text-[10px] leading-tight text-slate-600 sm:text-[11px]">
          {WORKLOAD_BAR_SEGMENTS.map((s) => (
            <span key={s.key} className="inline-flex min-w-0 items-center gap-1">
              <span className="h-2 w-2 shrink-0 rounded-[2px] ring-1 ring-black/10" style={{ backgroundColor: s.color }} />
              <span className="truncate">{s.label}</span>
            </span>
          ))}
        </div>
        <div className="space-y-2.5">
          {analytics.workloadByAssignee.length > 0 ? (
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
                  <div className="mb-0.5 flex items-center justify-between gap-2 text-[12px] text-slate-700">
                    <span className="truncate font-medium">{item.assignee}</span>
                    <span className="shrink-0 tabular-nums text-slate-600">
                      {item.daysLeftTotal}d left · {item.openCount} open
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200/90 ring-1 ring-slate-200/80">
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
                </div>
              );
            })
          ) : (
            <p className="text-[12px] text-slate-500">No open workload found for this sprint.</p>
          )}
        </div>
        <p className="mt-2 text-[12px] text-slate-600">
          {analytics.openStories} open stories, <span className="text-amber-700">{analytics.atRiskStories} at risk</span>
          .
        </p>
      </article>

      <article className="min-w-0 p-1 lg:col-span-2">
        <h3 className="mb-2 inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <Activity className="size-4 text-slate-600" />
          Cumulative flow
        </h3>
        <div className="h-56 min-h-56 w-full min-w-0 rounded-lg bg-white p-2 ring-1 ring-slate-200/60">
          {analytics.flowSprintTrendData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%" minHeight={200}>
              <AreaChart data={analytics.flowSprintTrendData} margin={{ top: 8, right: 10, left: 4, bottom: 36 }}>
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
                  tickMargin={4}
                  height={44}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  width={36}
                  label={{ value: "Assignees", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }}
                />
                <Tooltip
                  formatter={(value, name) => [`${value} in this band`, name]}
                  labelFormatter={(_, payload) => {
                    const row = payload?.[0]?.payload as
                      | { dayInSprint?: number; labelShort?: string; todo?: number; inProgress?: number; done?: number; approved?: number }
                      | undefined;
                    if (row?.dayInSprint != null && row.labelShort) {
                      const sum =
                        (row.todo ?? 0) + (row.inProgress ?? 0) + (row.done ?? 0) + (row.approved ?? 0);
                      return `Day ${row.dayInSprint} · ${row.labelShort} · stacked total ${sum}`;
                    }
                    return "";
                  }}
                />
                <Legend content={renderSpacedLegend} />
                {CFD_FLOW_SEGMENTS.map(({ key, label, color }) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={label}
                    stackId="cfd"
                    stroke={color}
                    fill={color}
                    fillOpacity={0.88}
                    strokeWidth={1}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-slate-500">No sprint days to chart.</div>
          )}
        </div>
        <p className="mt-2 text-[12px] text-slate-600">
          {analytics.doneLast7d} stories moved to done/approved in the last 7 days.
        </p>
      </article>
      </div>
    </section>
  );
}
