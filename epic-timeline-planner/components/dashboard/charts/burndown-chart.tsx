"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { buildSprintAnalytics, type BurndownMetric } from "@/lib/sprint-analytics";
import { buildSprintRetrospective } from "@/lib/sprint-retrospective";
import { InitiativeItem } from "@/lib/types";

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  metric?: BurndownMetric | null;
  team?: string | null;
  /** Retrospective mode — see StoryStatusChart for the same flag. */
  retrospective?: boolean;
};

export function BurndownChart({ initiatives, year, quarter, sprint, metric, team, retrospective }: Props) {
  const month = Math.ceil(sprint / 2);
  const analytics = retrospective
    ? buildSprintRetrospective({
        initiatives,
        month,
        yearSprint: sprint,
        metric: metric ?? "daysLeft",
        planYear: year,
        filterEpicTeamIds: team ? [team] : null,
      })
    : buildSprintAnalytics(initiatives, month, sprint, metric ?? "daysLeft", year, team ? [team] : null);
  const data = analytics.burndown;

  const yLabel = (metric ?? "daysLeft") === "storyCount" ? "Stories" : "Days left";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: 16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="labelShort"
          tick={{ fontSize: 10 }}
          interval={0}
          tickFormatter={(v: string) => v.replace(/\s*\([^)]*\)\s*$/, "")}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          width={44}
          allowDecimals={false}
          label={{ value: yLabel, angle: -90, position: "insideLeft", offset: 0, style: { fontSize: 11, fill: "#475569", fontWeight: 600 } }}
        />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        {data.findIndex((d) => d.isToday) >= 0 && (
          <ReferenceLine
            x={data.find((d) => d.isToday)?.labelShort}
            stroke="#94a3b8"
            strokeDasharray="4 2"
            label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
          />
        )}
        <Line type="monotone" dataKey="ideal" stroke="#cbd5e1" dot={false} strokeDasharray="4 2" name="Ideal" />
        <Line type="monotone" dataKey="actual" stroke="#6366f1" dot={false} strokeWidth={2} name="Actual" connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
