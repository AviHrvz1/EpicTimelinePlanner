"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Folder } from "lucide-react";

import type { InitiativeItem } from "@/lib/types";
import { resolveStoryYearSprint } from "@/lib/year-sprint";
import { cn } from "@/lib/utils";

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  /** "sprint" = stories in the current year-sprint; "quarter" = stories whose year-sprint is in the picked quarter. */
  scope: "sprint" | "quarter";
  /** Single team filter. */
  team?: string | null;
  /** Multi-team filter — non-empty array takes priority. */
  teams?: string[] | null;
};

// Palette cycles for slices when initiative has no explicit color.
const PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#14b8a6", "#0ea5e9", "#f43f5e",
  "#a855f7", "#22c55e", "#f97316", "#3b82f6",
];

type Slice = { id: string; name: string; value: number; color: string };

type LabelArgs = {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  percent?: number;
};

/** Outside-the-slice percentage label. Hides labels on slices smaller than 4% to avoid overlap. */
function SlicePercentLabel(props: LabelArgs) {
  const { cx, cy, midAngle, outerRadius, percent } = props;
  if (cx == null || cy == null || midAngle == null || outerRadius == null || percent == null) return null;
  if (percent < 0.04) return null;
  const RAD = Math.PI / 180;
  const r = outerRadius + 10;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  const anchor = x > cx ? "start" : "end";
  return (
    <text x={x} y={y} fill="#334155" textAnchor={anchor} dominantBaseline="central" fontSize={11} fontWeight={700}>
      {`${Math.round(percent * 100)}%`}
    </text>
  );
}

export function TeamFocusMixCard({ initiatives, year, quarter, sprint, scope, team, teams }: Props) {
  const teamsFilter = (teams && teams.length > 0) ? new Set(teams) : (team ? new Set([team]) : null);
  const monthRange: [number, number] = scope === "quarter"
    ? [(quarter - 1) * 3 + 1, quarter * 3]
    : [Math.ceil(sprint / 2), Math.ceil(sprint / 2)];

  const slices: Slice[] = [];
  const byInit = new Map<string, Slice>();
  initiatives.forEach((initiative, idx) => {
    // No initiative-status filter — keep the population consistent
    // with the other chart aggregations across the app.
    if (initiative.startMonth == null || initiative.endMonth == null) return;
    // Initiative must overlap the picked window.
    if (initiative.endMonth < monthRange[0] || initiative.startMonth > monthRange[1]) return;

    let sum = 0;
    for (const epic of initiative.epics ?? []) {
      if (teamsFilter && !teamsFilter.has(epic.team ?? "")) continue;
      const epicMonth = epic.planStartMonth ?? initiative.startMonth;
      for (const story of epic.userStories ?? []) {
        const storyYS = resolveStoryYearSprint(story, epicMonth);
        if (storyYS == null) continue;
        if (story.planYear !== year) continue;
        // Period filter
        if (scope === "sprint") {
          if (storyYS !== sprint) continue;
        } else {
          // quarter scope — story's year-sprint must fall in the quarter's sprint range
          const qStartYS = (quarter - 1) * 6 + 1;
          const qEndYS = quarter * 6;
          if (storyYS < qStartYS || storyYS > qEndYS) continue;
        }
        const days = Math.max(0, story.estimatedDays ?? story.daysLeft ?? 0);
        sum += days;
      }
    }
    if (sum > 0) {
      const color = initiative.color || PALETTE[idx % PALETTE.length];
      byInit.set(initiative.id, { id: initiative.id, name: initiative.title, value: Number(sum.toFixed(1)), color: color || PALETTE[0] });
    }
  });
  byInit.forEach((s) => slices.push(s));
  slices.sort((a, b) => b.value - a.value);
  const total = slices.reduce((acc, s) => acc + s.value, 0);

  if (slices.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 text-center text-slate-400">
        <Folder className="size-7 opacity-30" aria-hidden />
        <p className="text-[12.5px] font-medium">
          No initiatives with effort in this {scope === "sprint" ? "sprint" : "quarter"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* Donut */}
      <div className="relative h-full min-h-[160px] min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="42%"
              outerRadius="68%"
              paddingAngle={2}
              cornerRadius={4}
              stroke="#ffffff"
              strokeWidth={2}
              label={SlicePercentLabel}
              labelLine={false}
            >
              {slices.map((s) => (
                <Cell key={s.id} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0];
                const raw = Number(row?.value ?? 0);
                const pct = total > 0 ? Math.round((raw / total) * 100) : 0;
                return (
                  <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] shadow-md">
                    <div className="flex items-center gap-2">
                      <span className="inline-block size-2 rounded-full" style={{ backgroundColor: (row?.color as string) ?? "#94a3b8" }} />
                      <span className="font-semibold text-slate-800">{String(row?.name ?? "")}</span>
                    </div>
                    <div className="mt-0.5 text-slate-600">
                      <span className="font-semibold text-slate-800">{raw}d</span>{" "}
                      <span className="text-slate-400">({pct}%)</span>
                    </div>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center total */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[18px] font-bold leading-none tabular-nums text-slate-800">{Math.round(total)}d</span>
          <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total effort</span>
        </div>
      </div>

      {/* Legend list */}
      <div className="flex min-w-[40%] flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {slices.slice(0, 8).map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <div key={s.id} className={cn("flex items-center justify-between gap-2 rounded-md bg-slate-50/80 px-2 py-1 text-[12px]")}>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="truncate font-medium text-slate-700">{s.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                <span className="font-semibold text-slate-800">{s.value}d</span>
                <span className="ml-1 text-slate-400">({pct}%)</span>
              </span>
            </div>
          );
        })}
        {slices.length > 8 && (
          <p className="px-1 pt-0.5 text-[11px] text-slate-500">… and {slices.length - 8} more</p>
        )}
      </div>
    </div>
  );
}
