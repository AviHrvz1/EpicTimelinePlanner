"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { InitiativeItem, StoryDailySnapshotItem, UserStoryItem } from "@/lib/types";
import { clampYearSprint, monthLaneFromGlobalSprint, resolveStoryYearSprint, sprintEndDate, sprintStartDate } from "@/lib/year-sprint";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  /** Inclusive year-sprint index (1-24) range. */
  startYearSprint: number;
  endYearSprint: number;
  team?: string | null;
};

type SprintVelocity = {
  sprint: string;
  yearSprint: number;
  committed: number;
  completed: number;
};

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function isStoryDone(status: UserStoryItem["status"] | null | undefined): boolean {
  return status === "review" || status === "done";
}

/** Latest snapshot whose date is ≤ cutoff. Returns null if none exist before cutoff. */
function latestSnapshotAtDay(story: UserStoryItem, cutoff: Date): StoryDailySnapshotItem | null {
  const snapshots = story.snapshots ?? [];
  if (snapshots.length === 0) return null;
  const cutoffMs = cutoff.getTime();
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const snap = snapshots[i];
    if (!snap) continue;
    const ts = new Date(snap.snapshotDate).getTime();
    if (Number.isFinite(ts) && ts <= cutoffMs) return snap;
  }
  return null;
}

/** Story status as-of `day` — from snapshots when available, else story.status as a best-effort fallback. */
function storyStatusAt(story: UserStoryItem, day: Date): UserStoryItem["status"] | null {
  const snap = latestSnapshotAtDay(story, day);
  return snap?.status ?? story.status ?? null;
}

function buildVelocity(
  initiatives: InitiativeItem[],
  year: number,
  startYearSprint: number,
  endYearSprint: number,
  team?: string | null,
): SprintVelocity[] {
  const lo = Math.min(startYearSprint, endYearSprint);
  const hi = Math.max(startYearSprint, endYearSprint);
  const today = startOfDay(new Date());
  const todayMs = today.getTime();

  const results: SprintVelocity[] = [];
  for (let ys = lo; ys <= hi; ys++) {
    const { month } = monthLaneFromGlobalSprint(ys);
    const sprintStart = startOfDay(sprintStartDate(year, ys));
    const sprintEnd = startOfDay(sprintEndDate(year, ys));
    // For finished sprints, evaluate "completed" at sprint end. For active/future sprints, evaluate at today.
    const completedCutoff = sprintEnd.getTime() <= todayMs ? sprintEnd : today;
    const sprintStarted = sprintStart.getTime() <= todayMs;
    const label = `${MONTH_NAMES[month - 1] ?? `M${month}`} · S${ys}`;
    let committed = 0;
    let completed = 0;
    for (const initiative of initiatives) {
      // No initiative-status filter — consistent with the rest of the
      // chart-aggregation paths in the app.
      if (initiative.startMonth == null || initiative.endMonth == null) continue;
      if (initiative.endMonth < month || initiative.startMonth > month) continue;
      for (const epic of initiative.epics ?? []) {
        if (team && epic.team !== team) continue;
        for (const story of epic.userStories ?? []) {
          if (story.planYear !== year) continue;
          // Stories may store sprint as a legacy lane (1/2) or as a year-sprint (3-24).
          if (resolveStoryYearSprint(story, month) !== ys) continue;

          // Committed = story was in scope at the first day of the sprint.
          const hasSnapshots = (story.snapshots?.length ?? 0) > 0;
          let isCommitted: boolean;
          if (!sprintStarted) {
            isCommitted = true;
          } else if (hasSnapshots) {
            isCommitted = latestSnapshotAtDay(story, sprintStart) != null;
          } else {
            isCommitted = true; // no snapshots — best-effort: count current scope
          }
          if (isCommitted) committed += 1;

          // Completed at sprint end (or today for the active sprint).
          const status = storyStatusAt(story, completedCutoff);
          if (isStoryDone(status)) completed += 1;
        }
      }
    }
    results.push({ sprint: label, yearSprint: ys, committed, completed });
  }
  return results;
}

export function VelocityChart({ initiatives, year, startYearSprint, endYearSprint, team }: Props) {
  const start = clampYearSprint(startYearSprint);
  const end = clampYearSprint(endYearSprint);
  const data = buildVelocity(initiatives, year, start, end, team);

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
          formatter={(v, name) => [v, name === "completed" ? "Completed" : "Committed"]}
        />
        <Bar
          dataKey="committed"
          fill="#cbd5e1"
          radius={[3, 3, 0, 0]}
          name="committed"
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
