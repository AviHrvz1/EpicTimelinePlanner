"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { buildSprintAnalytics } from "@/lib/sprint-analytics";
import type { InitiativeItem } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  "To do": "#f59e0b",
  "In progress": "#3b82f6",
  "Done": "#10b981",
  "Approved": "#8b5cf6",
};

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  team?: string | null;
};

export function StoryStatusChart({ initiatives, year, quarter, sprint, team }: Props) {
  const month = Math.ceil(sprint / 2);
  const analytics = buildSprintAnalytics(initiatives, month, sprint, "storyCount", year, team ? [team] : null);
  const data = analytics.statusPie.filter((x) => x.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  if (data.length === 0) {
    return <p className="flex h-[180px] items-center justify-center text-xs text-slate-400">No stories for this sprint</p>;
  }

  return (
    <div className="flex h-full items-center gap-3">
      <ResponsiveContainer width="60%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="35%" outerRadius="65%" paddingAngle={3} cornerRadius={5} stroke="#fff" strokeWidth={2}>
            {data.map((entry) => <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "#94a3b8"} />)}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-1 flex-col gap-1.5 py-2">
        {data.map((slice) => (
          <div key={slice.name} className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[slice.name] ?? "#94a3b8" }} />
              {slice.name}
            </span>
            <span className="font-semibold text-slate-800 tabular-nums">{slice.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
