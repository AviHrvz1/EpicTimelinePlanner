"use client";

import { useMemo, useState } from "react";
import { Activity, PieChart as PieChartIcon } from "lucide-react";
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  buildQuarterBurndownSeries,
  buildQuarterStatusPie,
  collectQuarterEpics,
  type QuarterBurndownMetric,
} from "@/lib/quarter-analytics";
import { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  "To do": "#f59e0b",
  "In progress": "#3b82f6",
  Done: "#10b981",
  Approved: "#8b5cf6",
};

const LINE_PALETTE = ["#2563eb", "#0d9488", "#7c3aed", "#ea580c", "#14b8a6", "#be185d", "#0284c7"];

type QuarterStatusProps = {
  initiatives: InitiativeItem[];
  quarterMonths: readonly number[];
};

export function QuarterStatus({ initiatives, quarterMonths }: QuarterStatusProps) {
  const epicRows = useMemo(() => collectQuarterEpics(initiatives, quarterMonths), [initiatives, quarterMonths]);
  const [aggregateMode, setAggregateMode] = useState(true);
  const [metric, setMetric] = useState<QuarterBurndownMetric>("daysLeft");
  const [selectedEpicIds, setSelectedEpicIds] = useState<string[]>([]);

  const selectedRows = useMemo(() => {
    if (aggregateMode || selectedEpicIds.length === 0) return epicRows;
    const idSet = new Set(selectedEpicIds);
    return epicRows.filter(({ epic }) => idSet.has(epic.id));
  }, [epicRows, aggregateMode, selectedEpicIds]);

  const selectedStories = selectedRows.flatMap(({ epic }) => epic.userStories ?? []);
  const pieData = buildQuarterStatusPie(selectedStories).filter((x) => x.value > 0);
  const pieTotal = pieData.reduce((sum, item) => sum + item.value, 0);
  const topSlice = pieData[0] ?? null;
  const burndownData = buildQuarterBurndownSeries(
    selectedRows.map((r) => r.epic),
    aggregateMode ? "aggregate" : "individual",
    metric,
    quarterMonths,
  );

  const legendMap = new Map(epicRows.map(({ epic }) => [epic.id, epic.title]));

  return (
    <section className="space-y-3">
      <article className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-slate-800">Quarter status filter</h3>
          <div className="inline-flex rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => setAggregateMode(true)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[13px] font-medium",
                aggregateMode ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
              )}
            >
              All epics (aggregate)
            </button>
            <button
              type="button"
              onClick={() => setAggregateMode(false)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[13px] font-medium",
                !aggregateMode ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
              )}
            >
              Select epics
            </button>
          </div>
        </div>
        {!aggregateMode ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {epicRows.map(({ epic, initiative }) => {
              const selected = selectedEpicIds.includes(epic.id);
              return (
                <button
                  key={epic.id}
                  type="button"
                  onClick={() =>
                    setSelectedEpicIds((prev) =>
                      prev.includes(epic.id) ? prev.filter((id) => id !== epic.id) : [...prev, epic.id],
                    )
                  }
                  className={cn(
                    "rounded-md px-2 py-1 text-[12px] font-medium ring-1 transition",
                    selected
                      ? "bg-blue-100 text-blue-900 ring-blue-300"
                      : "bg-slate-50 text-slate-700 ring-slate-200 hover:bg-slate-100",
                  )}
                  title={initiative.title}
                >
                  {epic.icon} {epic.title}
                </button>
              );
            })}
          </div>
        ) : null}
      </article>

      <article className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
            <Activity className="size-4 text-slate-600" />
            Burndown
          </h3>
          <div className="inline-flex rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => setMetric("daysLeft")}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[13px] font-medium",
                metric === "daysLeft" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
              )}
            >
              Days left
            </button>
            <button
              type="button"
              onClick={() => setMetric("storyCount")}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[13px] font-medium",
                metric === "storyCount" ? "bg-white text-slate-900 ring-1 ring-slate-300" : "text-slate-600",
              )}
            >
              Stories
            </button>
          </div>
        </div>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={burndownData} margin={{ top: 8, right: 20, left: 8, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="axisLabel" interval={0} minTickGap={10} tick={{ fontSize: 11 }} />
              <YAxis
                allowDecimals={metric !== "storyCount"}
                tick={{ fontSize: 11 }}
                width={46}
                label={{
                  value: metric === "daysLeft" ? "Days" : "Stories",
                  angle: -90,
                  position: "insideLeft",
                  offset: 2,
                  style: { fill: "#64748b", fontSize: 11 },
                }}
              />
              <Tooltip labelFormatter={(label, payload) => payload?.[0]?.payload?.dayLabel ?? String(label)} />
              <Legend />
              <Line type="monotone" dataKey="ideal" stroke="#94a3b8" dot={false} name="Ideal" />
              {aggregateMode ? (
                <Line type="monotone" dataKey="actual" stroke="#2563eb" strokeWidth={2} name="Actual" />
              ) : (
                selectedRows.map(({ epic }, idx) => (
                  <Line
                    key={epic.id}
                    type="monotone"
                    dataKey={epic.id}
                    stroke={LINE_PALETTE[idx % LINE_PALETTE.length]}
                    strokeWidth={2}
                    dot={false}
                    name={epic.title}
                  />
                ))
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <h3 className="mb-2 inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
          <PieChartIcon className="size-4 text-slate-600" />
          User stories status
        </h3>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem] md:items-center">
          <div className="relative h-60 rounded-xl bg-gradient-to-br from-slate-50 via-white to-slate-100 ring-1 ring-slate-200/80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <defs>
                  <filter id="pieShadow">
                    <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#0f172a" floodOpacity="0.18" />
                  </filter>
                </defs>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={64}
                  outerRadius={92}
                  paddingAngle={3}
                  cornerRadius={8}
                  stroke="#ffffff"
                  strokeWidth={2}
                  labelLine={false}
                  filter="url(#pieShadow)"
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
              <div className="rounded-full bg-white/90 px-5 py-3 text-center shadow-sm ring-1 ring-slate-200">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total stories</p>
                <p className="text-[28px] leading-none font-bold text-slate-900">{pieTotal}</p>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {pieData.map((slice) => {
              const pct = pieTotal > 0 ? Math.round((slice.value / pieTotal) * 100) : 0;
              return (
                <div
                  key={slice.name}
                  className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200"
                >
                  <span className="inline-flex items-center gap-2 text-[13px] font-medium text-slate-700">
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
            {topSlice ? (
              <p className="pt-1 text-[12px] text-slate-600">
                Largest share: <span className="font-semibold text-slate-800">{topSlice.name}</span>
              </p>
            ) : (
              <p className="pt-1 text-[12px] text-slate-600">No stories in the selected scope.</p>
            )}
          </div>
        </div>
        {!aggregateMode && selectedRows.length > 0 ? (
          <p className="mt-2 text-[12px] text-slate-600">
            Selected epics: {selectedRows.map(({ epic }) => legendMap.get(epic.id) ?? epic.title).join(", ")}
          </p>
        ) : null}
      </article>
    </section>
  );
}
