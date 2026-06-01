"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildSprintAnalytics } from "@/lib/sprint-analytics";
import type { InitiativeItem } from "@/lib/types";

const SEGMENTS = [
  { key: "todo" as const,       label: "To do",            color: "#f59e0b" },
  { key: "inProgress" as const, label: "In progress",      color: "#3b82f6" },
  { key: "review" as const,     label: "Review / Testing", color: "#8b5cf6" },
  { key: "done" as const,       label: "Done",             color: "#10b981" },
];

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  team?: string | null;
  metric?: "daysLeft" | "storyCount";
};

export function WorkloadBalanceChart({ initiatives, year, quarter, sprint, team, metric = "storyCount" }: Props) {
  const month = Math.ceil(sprint / 2);
  const analytics = buildSprintAnalytics(initiatives, month, sprint, metric, year, team ? [team] : null);

  const teamMode = !team;
  const useDays = metric === "daysLeft";
  const barData = teamMode
    ? analytics.workloadByTeam.map((t) => {
        const buckets = useDays ? t.daysByStatus : t.storiesByStatus;
        return {
          name: t.teamLabel,
          "To do": useDays ? Number(buckets.todo.toFixed(1)) : buckets.todo,
          "In progress": useDays ? Number(buckets.inProgress.toFixed(1)) : buckets.inProgress,
          "Review / Testing": useDays ? Number(buckets.review.toFixed(1)) : buckets.review,
          "Done": useDays ? Number(buckets.done.toFixed(1)) : buckets.done,
        };
      })
    : analytics.workloadByAssignee.map((r) => {
        const buckets = useDays ? r.daysByStatus : r.storiesByStatus;
        return {
          name: r.assignee.split(/\s+/)[0] ?? r.assignee,
          "To do": useDays ? Number(buckets.todo.toFixed(1)) : buckets.todo,
          "In progress": useDays ? Number(buckets.inProgress.toFixed(1)) : buckets.inProgress,
          "Review / Testing": useDays ? Number(buckets.review.toFixed(1)) : buckets.review,
          "Done": useDays ? Number(buckets.done.toFixed(1)) : buckets.done,
        };
      });

  if (barData.length === 0) {
    return <p className="flex h-[180px] items-center justify-center text-xs text-slate-400">No workload data for this sprint</p>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={barData} barCategoryGap="20%" margin={{ top: 16, right: 4, left: 16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={useDays}
          width={44}
          label={{ value: useDays ? "Days" : "Stories", angle: -90, position: "insideLeft", offset: 0, style: { fontSize: 11, fill: "#475569", fontWeight: 600 } }}
        />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        <Legend
          wrapperStyle={{ paddingTop: 6 }}
          // We render our own legend from SEGMENTS so the order is fixed
          // (To do → In progress → Done → Approved) and the items get proper gaps.
          content={() => (
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 pt-1.5 text-[11px]">
              {SEGMENTS.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="font-medium text-slate-700">{s.label}</span>
                </span>
              ))}
            </div>
          )}
        />
        {SEGMENTS.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.label}
            fill={s.color}
            radius={[3, 3, 0, 0]}
            maxBarSize={12}
            minPointSize={2}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label={{ position: "top", fontSize: 10, fill: "#64748b", formatter: ((v: number) => String(v ?? 0)) as any }}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
