"use client";

import { Area, AreaChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { buildSprintAnalytics } from "@/lib/sprint-analytics";
import { InitiativeItem } from "@/lib/types";

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  team?: string | null;
};

export function CfdChart({ initiatives, year, quarter, sprint, team }: Props) {
  const month = Math.ceil(sprint / 2);
  const analytics = buildSprintAnalytics(initiatives, month, sprint, "daysLeft", year, team ? [team] : null);

  // Extend flow data to cover the full sprint (same x-axis range as burndown).
  // Past days carry real values; future days get null so areas stop at today.
  const pastByLabel = new Map(analytics.flowSprintTrendData.map((d) => [d.labelShort, d]));
  const data = analytics.burndown.map((bd) => {
    const past = pastByLabel.get(bd.labelShort);
    return past ?? {
      labelShort: bd.labelShort,
      isToday: bd.isToday,
      todo: null,
      inProgress: null,
      done: null,
      approved: null,
    };
  });

  const todayLabel = data.find((d) => d.isToday)?.labelShort;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="labelShort"
          tick={{ fontSize: 10 }}
          interval={0}
          tickFormatter={(v: string) => v.replace(/\s*\([^)]*\)\s*$/, "")}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          allowDecimals={false}
          label={{
            value: "User stories",
            angle: -90,
            position: "insideLeft",
            style: { fontSize: 11, fill: "#64748b", fontWeight: 600 },
            offset: 14,
          }}
        />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        <Legend wrapperStyle={{ fontSize: 13, paddingTop: 4 }} iconSize={12} />
        {todayLabel && (
          <ReferenceLine
            x={todayLabel}
            stroke="#94a3b8"
            strokeDasharray="4 2"
            label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
          />
        )}
        <Area type="monotone" dataKey="todo" stackId="1" stroke="#94a3b8" fill="#f1f5f9" name="To do" connectNulls={false} />
        <Area type="monotone" dataKey="inProgress" stackId="1" stroke="#f59e0b" fill="#fef3c7" name="In progress" connectNulls={false} />
        <Area type="monotone" dataKey="done" stackId="1" stroke="#10b981" fill="#d1fae5" name="Done" connectNulls={false} />
        <Area type="monotone" dataKey="approved" stackId="1" stroke="#6366f1" fill="#e0e7ff" name="Approved" connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
