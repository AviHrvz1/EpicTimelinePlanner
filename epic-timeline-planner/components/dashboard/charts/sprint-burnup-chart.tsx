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
  const days = analytics.flowSprintTrendData;

  if (days.length === 0) {
    return <p className="flex h-[180px] items-center justify-center text-xs text-slate-400">No data for this sprint</p>;
  }

  const finalScope = days[days.length - 1]!.todo + days[days.length - 1]!.inProgress + days[days.length - 1]!.done + days[days.length - 1]!.approved;
  const data = days.map((d, i) => ({
    labelShort: d.labelShort,
    scope: d.todo + d.inProgress + d.done + d.approved,
    completed: d.done + d.approved,
    ideal: finalScope > 0 ? Math.round((finalScope * i) / Math.max(days.length - 1, 1)) : 0,
    isToday: d.isToday,
  }));

  const todayPoint = data.find((d) => d.isToday);

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="labelShort" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
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
