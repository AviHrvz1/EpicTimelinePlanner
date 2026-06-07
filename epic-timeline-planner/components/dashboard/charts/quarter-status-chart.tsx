"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { buildQuarterStatusPie } from "@/lib/quarter-analytics";
import { InitiativeItem } from "@/lib/types";

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  team?: string | null;
};

const QUARTER_MONTHS: Record<number, number[]> = { 1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12] };
const STATUS_COLORS = ["#94a3b8", "#f59e0b", "#10b981", "#6366f1"];

function collectQuarterStories(initiatives: InitiativeItem[], year: number, quarter: number, team?: string | null) {
  const months = QUARTER_MONTHS[quarter] ?? [];
  const stories = [];
  for (const initiative of initiatives) {
    // Drop initiative-status filter so chart aggregations across the
    // app count the same Q work population. See insights burndown
    // alignment for rationale.
    if (initiative.startMonth == null || initiative.endMonth == null) continue;
    const qStart = months[0] ?? 1;
    const qEnd = months[months.length - 1] ?? 12;
    if (initiative.endMonth < qStart || initiative.startMonth > qEnd) continue;
    for (const epic of initiative.epics ?? []) {
      if (team && epic.team !== team) continue;
      for (const story of epic.userStories ?? []) {
        if (story.planYear !== year || story.planQuarter !== quarter) continue;
        stories.push(story);
      }
    }
  }
  return stories;
}

export function QuarterStatusChart({ initiatives, year, quarter, team }: Props) {
  const stories = collectQuarterStories(initiatives, year, quarter, team ?? null);
  const data = buildQuarterStatusPie(stories).filter((d) => d.value > 0);

  if (data.length === 0) {
    return (
      <div className="flex h-[140px] items-center justify-center text-sm text-slate-400">
        No stories in Q{quarter} {year}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} innerRadius={28}>
          {data.map((_, i) => (
            <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
