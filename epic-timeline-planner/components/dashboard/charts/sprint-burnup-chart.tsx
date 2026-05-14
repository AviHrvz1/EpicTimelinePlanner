"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildSprintAnalytics } from "@/lib/sprint-analytics";
import type { InitiativeItem } from "@/lib/types";

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  team?: string | null;
};

export function SprintBurnupChart({ initiatives, year, quarter, sprint, team }: Props) {
  const month = Math.ceil(sprint / 2);
  const analytics = buildSprintAnalytics(initiatives, month, sprint, "storyCount", year, team ? [team] : null);
  const allDays = analytics.burndown;
  const pastDays = analytics.flowSprintTrendData;

  if (allDays.length === 0) {
    return <p className="flex h-[180px] items-center justify-center text-xs text-slate-400">No data for this sprint</p>;
  }

  // Extend to full sprint x-axis. Future days have null actuals so the line stops at today.
  const pastByLabel = new Map(pastDays.map((d) => [d.labelShort, d]));
  const lastPast = pastDays[pastDays.length - 1];
  const finalScope = lastPast ? lastPast.todo + lastPast.inProgress + lastPast.done + lastPast.approved : 0;
  const data = allDays.map((bd, i) => {
    const past = pastByLabel.get(bd.labelShort);
    const scope = past ? past.todo + past.inProgress + past.done + past.approved : finalScope;
    const completed = past != null ? past.done + past.approved : null;
    const ideal = finalScope > 0 ? Math.round((finalScope * i) / Math.max(allDays.length - 1, 1)) : 0;
    return { labelShort: bd.labelShort, scope, completed, ideal, isToday: bd.isToday };
  });

  const todayPoint = data.find((d) => d.isToday);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="labelShort"
          tick={{ fontSize: 10 }}
          interval={0}
          tickFormatter={(v: string) => v.replace(/\s*\([^)]*\)\s*$/, "")}
        />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        {todayPoint && (
          <ReferenceLine x={todayPoint.labelShort} stroke="#94a3b8" strokeDasharray="4 2"
            label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }} />
        )}
        <Line type="monotone" dataKey="scope" stroke="#e2e8f0" dot={false} name="Scope" />
        <Line type="monotone" dataKey="ideal" stroke="#cbd5e1" dot={false} strokeDasharray="4 2" name="Ideal" />
        <Line type="monotone" dataKey="completed" stroke="#10b981" dot={false} strokeWidth={2} name="Completed" connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
