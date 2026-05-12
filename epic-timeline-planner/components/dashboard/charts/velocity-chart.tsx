"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { InitiativeItem } from "@/lib/types";

type Props = {
  initiatives: InitiativeItem[];
  quarter: string; // "YYYY-QN"
  team?: string | null;
};

type SprintVelocity = {
  sprint: string;
  completed: number;
  total: number;
};

function buildVelocity(initiatives: InitiativeItem[], year: number, quarter: number, team?: string | null): SprintVelocity[] {
  const quarterMonths: Record<number, number[]> = {
    1: [1, 2, 3],
    2: [4, 5, 6],
    3: [7, 8, 9],
    4: [10, 11, 12],
  };
  const months = quarterMonths[quarter] ?? [];

  const results: SprintVelocity[] = [];
  for (const month of months) {
    for (const sprint of [1, 2]) {
      const label = `M${month}S${sprint}`;
      let completed = 0;
      let total = 0;
      for (const initiative of initiatives) {
        if (initiative.status !== "scheduled") continue;
        if (initiative.startMonth == null || initiative.endMonth == null) continue;
        if (initiative.endMonth < month || initiative.startMonth > month) continue;
        for (const epic of initiative.epics ?? []) {
          if (team && epic.team !== team) continue;
          for (const story of epic.userStories ?? []) {
            if (story.planYear !== year || story.planQuarter !== quarter) continue;
            if (story.sprint !== sprint) continue;
            total += 1;
            if (story.status === "done" || story.status === "approved") completed += 1;
          }
        }
      }
      results.push({ sprint: label, completed, total });
    }
  }
  return results;
}

export function VelocityChart({ initiatives, quarter, team }: Props) {
  const [yearStr, qStr] = quarter.split("-Q");
  const year = parseInt(yearStr ?? "0", 10);
  const q = parseInt(qStr ?? "1", 10);
  const data = buildVelocity(initiatives, year, q, team);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="sprint" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
          formatter={(v, name) => [v, name === "completed" ? "Done" : "Total"]}
        />
        <Bar dataKey="total" fill="#cbd5e1" radius={[3, 3, 0, 0]} name="total" />
        <Bar dataKey="completed" fill="#6366f1" radius={[3, 3, 0, 0]} name="completed" />
      </BarChart>
    </ResponsiveContainer>
  );
}
