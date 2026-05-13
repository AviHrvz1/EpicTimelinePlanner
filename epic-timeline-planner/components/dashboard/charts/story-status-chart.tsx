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

type LabelArgs = {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
  value?: number;
};

function PieSlicePercentLabel(props: LabelArgs) {
  const cx = props.cx ?? 0;
  const cy = props.cy ?? 0;
  const midAngle = props.midAngle ?? 0;
  const innerR = props.innerRadius ?? 0;
  const outerR = props.outerRadius ?? 0;
  const pct = (props.percent ?? 0) * 100;
  if (pct < 4) return null; // hide labels on very thin slices
  const RAD = Math.PI / 180;
  const r = innerR + (outerR - innerR) * 0.55;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      className="fill-white"
      style={{ fontSize: 12, fontWeight: 700, paintOrder: "stroke", stroke: "rgba(15,23,42,0.25)", strokeWidth: 0.6 }}
    >
      {`${Math.round(pct)}%`}
    </text>
  );
}

export function StoryStatusChart({ initiatives, year, quarter, sprint, team }: Props) {
  const month = Math.ceil(sprint / 2);
  const analytics = buildSprintAnalytics(initiatives, month, sprint, "storyCount", year, team ? [team] : null);
  const data = analytics.statusPie.filter((x) => x.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  if (data.length === 0) {
    return <p className="flex h-full min-h-[180px] items-center justify-center text-xs text-slate-400">No stories for this sprint</p>;
  }

  return (
    <div className="flex h-full min-h-0 items-center gap-4">
      <div className="relative h-full min-h-[180px] w-[60%] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              <filter id="storyStatusPieShadow">
                <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#0f172a" floodOpacity="0.18" />
              </filter>
            </defs>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="38%"
              outerRadius="68%"
              paddingAngle={3}
              cornerRadius={8}
              stroke="#ffffff"
              strokeWidth={2}
              label={PieSlicePercentLabel}
              labelLine={false}
              filter="url(#storyStatusPieShadow)"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "#94a3b8"} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0];
                const raw = Number(row?.value ?? 0);
                const pct = total > 0 ? Math.round((raw / total) * 100) : 0;
                const name = String(row?.name ?? "Status");
                return (
                  <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] shadow-md">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[name] ?? "#94a3b8" }}
                      />
                      <span className="font-semibold text-slate-800">{name}</span>
                    </div>
                    <div className="mt-0.5 text-slate-600">
                      {raw} <span className="text-slate-400">({pct}%)</span>
                    </div>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-1.5">
        {data.map((slice) => {
          const pct = total > 0 ? Math.round((slice.value / total) * 100) : 0;
          return (
            <div
              key={slice.name}
              className="flex items-center justify-between gap-2 rounded-md bg-slate-50/80 px-2 py-1.5"
            >
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[slice.name] ?? "#94a3b8" }}
                />
                {slice.name}
              </span>
              <span className="text-[13px] font-semibold tabular-nums text-slate-900">
                {slice.value} <span className="font-normal text-slate-500">({pct}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
