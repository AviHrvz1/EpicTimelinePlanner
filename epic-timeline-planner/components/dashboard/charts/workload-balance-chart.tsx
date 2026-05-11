"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildSprintAnalytics } from "@/lib/sprint-analytics";
import type { InitiativeItem } from "@/lib/types";

const SEGMENTS = [
  { key: "todo" as const,       label: "To do",       color: "#f59e0b" },
  { key: "inProgress" as const, label: "In progress", color: "#3b82f6" },
  { key: "done" as const,       label: "Done",        color: "#10b981" },
  { key: "approved" as const,   label: "Approved",    color: "#8b5cf6" },
];

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  team?: string | null;
};

export function WorkloadBalanceChart({ initiatives, year, quarter, sprint, team }: Props) {
  const month = Math.ceil(sprint / 2);
  const analytics = buildSprintAnalytics(initiatives, month, sprint, "storyCount", year, team ? [team] : null);

  const teamMode = !team;
  const barData = teamMode
    ? analytics.workloadByTeam.map((t) => ({
        name: t.teamLabel,
        "To do": t.storiesByStatus.todo,
        "In progress": t.storiesByStatus.inProgress,
        "Done": t.storiesByStatus.done,
        "Approved": t.storiesByStatus.approved,
      }))
    : analytics.workloadByAssignee.map((r) => ({
        name: r.assignee.split(/\s+/)[0] ?? r.assignee,
        "To do": r.storiesByStatus.todo,
        "In progress": r.storiesByStatus.inProgress,
        "Done": r.storiesByStatus.done,
        "Approved": r.storiesByStatus.approved,
      }));

  if (barData.length === 0) {
    return <p className="flex h-[180px] items-center justify-center text-xs text-slate-400">No workload data for this sprint</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={barData} barCategoryGap="20%" margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        {SEGMENTS.map((s) => (
          <Bar key={s.key} dataKey={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={12} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
