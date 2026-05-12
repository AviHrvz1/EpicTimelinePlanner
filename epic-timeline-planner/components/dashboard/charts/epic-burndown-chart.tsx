"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { buildSprintAnalytics, type BurndownMetric } from "@/lib/sprint-analytics";
import { InitiativeItem } from "@/lib/types";

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  metric?: BurndownMetric | null;
  team?: string | null;
};

export function EpicBurndownChart({ initiatives, year, quarter, sprint, metric, team }: Props) {
  const month = Math.ceil(sprint / 2);
  const analytics = buildSprintAnalytics(initiatives, month, sprint, metric ?? "storyCount", year, team ? [team] : null);
  const data = analytics.burndown;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="labelShort" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        {data.findIndex((d) => d.isToday) >= 0 && (
          <ReferenceLine
            x={data.find((d) => d.isToday)?.labelShort}
            stroke="#94a3b8"
            strokeDasharray="4 2"
            label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
          />
        )}
        <Line type="monotone" dataKey="ideal" stroke="#fcd34d" dot={false} strokeDasharray="4 2" name="Ideal" />
        <Line type="monotone" dataKey="actual" stroke="#f59e0b" dot={false} strokeWidth={2} name="Actual" connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
