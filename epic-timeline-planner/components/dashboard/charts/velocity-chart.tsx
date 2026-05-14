"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { InitiativeItem } from "@/lib/types";
import { globalSprintFromMonthLane, resolveStoryYearSprint } from "@/lib/year-sprint";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
    for (const lane of [1, 2] as const) {
      const targetYearSprint = globalSprintFromMonthLane(month, lane);
      const label = `${MONTH_NAMES[month - 1] ?? `M${month}`} · S${targetYearSprint}`;
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
            // Stories may store sprint as a legacy lane (1/2) or as a year-sprint (3-24).
            if (resolveStoryYearSprint(story, month) !== targetYearSprint) continue;
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
      <BarChart data={data} margin={{ top: 16, right: 8, left: 16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="sprint" tick={{ fontSize: 11 }} />
        <YAxis
          tick={{ fontSize: 11 }}
          width={44}
          allowDecimals={false}
          label={{ value: "Stories", angle: -90, position: "insideLeft", offset: 0, style: { fontSize: 11, fill: "#475569", fontWeight: 600 } }}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
          formatter={(v, name) => [v, name === "completed" ? "Done" : "Total"]}
        />
        <Bar
          dataKey="total"
          fill="#cbd5e1"
          radius={[3, 3, 0, 0]}
          name="total"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          label={{ position: "top", fontSize: 10, fill: "#64748b", formatter: ((v: number) => v > 0 ? v : "") as any }}
        />
        <Bar
          dataKey="completed"
          fill="#6366f1"
          radius={[3, 3, 0, 0]}
          name="completed"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          label={{ position: "top", fontSize: 10, fill: "#4338ca", fontWeight: 600, formatter: ((v: number) => v > 0 ? v : "") as any }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
