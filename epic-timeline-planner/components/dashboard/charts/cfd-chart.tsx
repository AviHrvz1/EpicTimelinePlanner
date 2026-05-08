"use client";

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
  const data = analytics.flowSprintTrendData;

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="labelShort" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area type="monotone" dataKey="todo" stackId="1" stroke="#94a3b8" fill="#f1f5f9" name="To do" />
        <Area type="monotone" dataKey="inProgress" stackId="1" stroke="#f59e0b" fill="#fef3c7" name="In progress" />
        <Area type="monotone" dataKey="done" stackId="1" stroke="#10b981" fill="#d1fae5" name="Done" />
        <Area type="monotone" dataKey="approved" stackId="1" stroke="#6366f1" fill="#e0e7ff" name="Approved" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
