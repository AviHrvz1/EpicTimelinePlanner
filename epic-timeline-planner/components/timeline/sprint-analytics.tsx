"use client";

import { useMemo, useState } from "react";
import { Activity, ChartNoAxesCombined, PieChart as PieChartIcon } from "lucide-react";
import {
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
  sprintLane: 1 | 2;
};

export function SprintAnalytics({ initiatives, month, sprintLane }: SprintAnalyticsProps) {
  const [metric, setMetric] = useState<BurndownMetric>("daysLeft");
  const analytics = useMemo(
    () => buildSprintAnalytics(initiatives, month, sprintLane, metric),
    [initiatives, month, sprintLane, metric],
  );

  const pieData = analytics.statusPie.filter((x) => x.value > 0);
  const assigneeChartData = analytics.assigneeBars;
  const renderSpacedLegend = ({
    payload,
  }: {
    payload?: ReadonlyArray<{ color?: string; value?: string }>;
  }) => (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-slate-700">
      {(payload ?? []).map((entry) => (
        <span key={`${entry.value}-${entry.color}`} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ backgroundColor: entry.color ?? "#94a3b8" }}
          />
          {entry.value}
        </span>
      ))}
    </div>
  );
  const renderAssigneeLegend = ({
    payload,
  }: {
    payload?: ReadonlyArray<{ color?: string; value?: string }>;
  }) => renderSpacedLegend({ payload });

  return (
    <section className="mb-4 grid gap-3 lg:grid-cols-3">
      <article className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <h3 className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
          <PieChartIcon className="size-3.5 text-slate-600" />
          User stories status
        </h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={78} label>
                {pieData.map((entry) => (
                  <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "#94a3b8"} />
                ))}
              </Pie>
              <Tooltip />
              <Legend content={renderSpacedLegend} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="rounded-xl bg-white p-3 ring-1 ring-slate-200 lg:col-span-2">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
            <Activity className="size-3.5 text-slate-600" />
            Burndown
          </h3>
          <div className="inline-flex rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => setMetric("daysLeft")}
              className={`rounded-md px-2 py-1 text-[11px] ${
                metric === "daysLeft" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600"
              }`}
            >
              Days left
            </button>
            <button
              type="button"
              onClick={() => setMetric("storyCount")}
              className={`rounded-md px-2 py-1 text-[11px] ${
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
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Legend content={renderSpacedLegend} />
              <Line type="monotone" dataKey="ideal" stroke="#94a3b8" dot={false} name="Ideal" />
              <Line type="monotone" dataKey="actual" stroke="#2563eb" strokeWidth={2} name="Actual" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="rounded-xl bg-white p-3 ring-1 ring-slate-200 lg:col-span-3">
        <h3 className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
          <ChartNoAxesCombined className="size-3.5 text-slate-600" />
          Assignee progress
        </h3>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={assigneeChartData}
              margin={{ top: 8, right: 20, left: 12, bottom: 12 }}
              barCategoryGap="42%"
              barGap={3}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="assignee" type="category" interval={0} tickMargin={12} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend content={renderAssigneeLegend} />
              <Bar dataKey="todo" stackId="progress" fill="#f59e0b" name="To do" maxBarSize={36} />
              <Bar dataKey="inProgress" stackId="progress" fill="#3b82f6" name="In progress" maxBarSize={36} />
              <Bar dataKey="done" stackId="progress" fill="#10b981" name="Done" maxBarSize={36} />
              <Bar dataKey="approved" stackId="progress" fill="#8b5cf6" name="Approved" maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
    </section>
  );
}
