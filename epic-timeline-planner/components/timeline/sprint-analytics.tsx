"use client";

import { useMemo, useState } from "react";
import { Activity, ChartNoAxesCombined, PieChart as PieChartIcon } from "lucide-react";
import {
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

type SprintAnalyticsProps = {
  initiatives: InitiativeItem[];
  month: number;
  yearSprint: number;
};

export function SprintAnalytics({ initiatives, month, yearSprint }: SprintAnalyticsProps) {
  const [metric, setMetric] = useState<BurndownMetric>("daysLeft");
  const analytics = useMemo(
    () => buildSprintAnalytics(initiatives, month, yearSprint, metric),
    [initiatives, month, yearSprint, metric],
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
    <section className="mb-4 grid gap-6 lg:grid-cols-3">
      <article className="p-1">
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

      <article className="p-1 lg:col-span-2">
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
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={analytics.burndown}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="day"
                tick={(props) => {
                  const { x, y, payload, index } = props;
                  const label = typeof payload?.value === "string" ? payload.value : String(payload?.value ?? "");
                  const bold = Boolean(analytics.burndown[index]?.isToday);
                  return (
                    <text
                      x={x}
                      y={y}
                      dy={12}
                      textAnchor="middle"
                      fill="#334155"
                      fontSize={11}
                      fontWeight={bold ? 700 : 400}
                    >
                      {label}
                    </text>
                  );
                }}
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

      <article className="p-1 lg:col-span-1">
        <h3 className="mb-2 inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <Activity className="size-4 text-slate-600" />
          Flow trend (30d)
        </h3>
        <div className="rounded-lg bg-slate-50/70 p-2">
          <svg viewBox="0 0 100 100" className="h-28 w-full" preserveAspectRatio="none" aria-hidden>
            <polyline
              fill="none"
              stroke="rgb(59 130 246)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={analytics.flowSparkline}
            />
          </svg>
        </div>
        <p className="mt-2 text-[12px] text-slate-600">
          {analytics.doneLast7d} stories moved to done/approved in the last 7 days.
        </p>
      </article>

      <article className="p-1 lg:col-span-2">
        <h3 className="mb-2 inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <ChartNoAxesCombined className="size-4 text-slate-600" />
          Workload balance
        </h3>
        <div className="space-y-2">
          {analytics.workloadByAssignee.length > 0 ? (
            analytics.workloadByAssignee.map((item) => (
              <div key={item.assignee}>
                <div className="mb-0.5 flex items-center justify-between text-[12px] text-slate-700">
                  <span className="truncate pr-2">{item.assignee}</span>
                  <span>
                    {item.daysLeftTotal}d left · {item.openCount} open
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-cyan-500"
                    style={{ width: `${Math.max(10, (item.daysLeftTotal / analytics.workloadMaxDays) * 100)}%` }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="text-[12px] text-slate-500">No open workload found for this sprint.</p>
          )}
        </div>
        <p className="mt-2 text-[12px] text-slate-600">
          {analytics.openStories} open stories, <span className="text-amber-700">{analytics.atRiskStories} at risk</span>
          .
        </p>
      </article>
    </section>
  );
}
