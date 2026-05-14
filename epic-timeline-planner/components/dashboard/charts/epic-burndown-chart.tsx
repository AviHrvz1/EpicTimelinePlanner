"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { InitiativeItem, EpicItem, UserStoryItem, StoryDailySnapshotItem } from "@/lib/types";

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  team?: string | null;
  /** Restrict the burndown to a single epic. */
  epicId?: string | null;
  /** Metric: "daysLeft" sums remaining estimated days, "storyCount" counts open stories. Default daysLeft (matches insights). */
  metric?: "daysLeft" | "storyCount";
};

function findEpic(initiatives: InitiativeItem[], epicId: string | null | undefined):
  | { epic: EpicItem; initiative: InitiativeItem }
  | null {
  if (!epicId) return null;
  for (const initiative of initiatives) {
    const epic = (initiative.epics ?? []).find((e) => e.id === epicId);
    if (epic) return { epic, initiative };
  }
  return null;
}

function isStoryOpen(status: UserStoryItem["status"] | null | undefined): boolean {
  return status === "todo" || status === "inProgress";
}

function latestSnapshotAtDay(story: UserStoryItem, day: Date): StoryDailySnapshotItem | null {
  const snapshots = story.snapshots ?? [];
  if (snapshots.length === 0) return null;
  const cutoff = day.getTime();
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const snap = snapshots[i];
    if (!snap) continue;
    const ts = new Date(snap.snapshotDate).getTime();
    if (Number.isFinite(ts) && ts <= cutoff) return snap;
  }
  return null;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function shortLabel(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function sprintBounds(year: number, month: number, lane: 1 | 2): { start: Date; end: Date } {
  if (lane === 1) {
    return { start: new Date(year, month - 1, 1), end: new Date(year, month - 1, 15, 23, 59, 59, 999) };
  }
  const lastDay = new Date(year, month, 0).getDate();
  return { start: new Date(year, month - 1, 16), end: new Date(year, month - 1, lastDay, 23, 59, 59, 999) };
}

function epicStoryOpenValue(
  story: UserStoryItem,
  metric: "daysLeft" | "storyCount",
  snapshot: StoryDailySnapshotItem | null,
): number {
  const status = snapshot?.status ?? story.status;
  if (!isStoryOpen(status)) return 0;
  if (metric === "storyCount") return 1;
  const daysLeft = snapshot?.daysLeft ?? snapshot?.estimatedDays ?? story.daysLeft ?? story.estimatedDays ?? 1;
  return Math.max(0, daysLeft);
}

export function EpicBurndownChart({ initiatives, year, sprint, team, epicId, metric = "daysLeft" }: Props) {
  const meta = findEpic(initiatives, epicId);
  if (epicId && !meta) {
    return (
      <p className="flex h-full min-h-[180px] items-center justify-center text-xs text-slate-400">
        Selected epic not found
      </p>
    );
  }
  if (!meta) {
    return (
      <p className="flex h-full min-h-[180px] items-center justify-center text-xs text-slate-400">
        Pick an epic to render its burndown
      </p>
    );
  }
  const { epic } = meta;

  if (team && epic.team !== team) {
    return (
      <p className="flex h-full min-h-[180px] items-center justify-center text-xs text-slate-400">
        Epic is not in the {team} team scope
      </p>
    );
  }

  // Resolve start/due dates from the epic's plan.
  const startMonth = epic.planStartMonth ?? Math.ceil(sprint / 2);
  const startLane: 1 | 2 = epic.planSprint === 2 ? 2 : 1;
  const endMonth = epic.planEndMonth ?? startMonth;
  const endLane: 1 | 2 = epic.planEndSprint === 1 ? 1 : 2;
  const startBounds = sprintBounds(year, startMonth, startLane);
  const endBounds = sprintBounds(year, endMonth, endLane);
  const startDate = startOfDay(epic.planStartDay ? new Date(year, startMonth - 1, epic.planStartDay) : startBounds.start);
  const dueDate = startOfDay(epic.planEndDay ? new Date(year, endMonth - 1, epic.planEndDay) : endBounds.end);
  if (dueDate < startDate) {
    return (
      <p className="flex h-full min-h-[180px] items-center justify-center text-xs text-slate-400">
        Epic due date is before its start date
      </p>
    );
  }

  // Initial total at the start date — sum of estimated days (or story count) across stories that were open at start.
  // Use latest snapshot ≤ start, fall back to current story state when no snapshots exist.
  const stories = epic.userStories ?? [];
  const startTotal = stories.reduce((sum, story) => {
    const snap = latestSnapshotAtDay(story, startDate);
    const status = snap?.status ?? story.status;
    if (!isStoryOpen(status)) return sum;
    if (metric === "storyCount") return sum + 1;
    const daysLeft = snap?.daysLeft ?? snap?.estimatedDays ?? story.estimatedDays ?? story.daysLeft ?? 1;
    return sum + Math.max(0, daysLeft);
  }, 0);

  const today = startOfDay(new Date());
  const startMs = startDate.getTime();
  const dueMs = dueDate.getTime();
  const todayMs = today.getTime();
  const totalDays = Math.max(1, Math.round((dueMs - startMs) / 86400000) + 1);

  type Row = {
    label: string;
    actual: number | null;
    ideal: number | null;
  };
  const rows: Row[] = [];
  for (let i = 0; i < totalDays; i++) {
    const day = startOfDay(new Date(startMs + i * 86400000));
    const dayMs = day.getTime();
    const isFuture = dayMs > todayMs;
    let actualForDay: number | null = null;
    if (!isFuture) {
      let value = 0;
      for (const story of stories) {
        const snap = latestSnapshotAtDay(story, day);
        value += epicStoryOpenValue(story, metric, snap);
      }
      actualForDay = metric === "storyCount" ? Math.round(value) : Number(value.toFixed(1));
    }
    const idealRaw = totalDays <= 1 ? 0 : startTotal * (1 - i / (totalDays - 1));
    const ideal = metric === "storyCount" ? Math.max(0, Math.round(idealRaw)) : Number(Math.max(0, idealRaw).toFixed(1));
    rows.push({ label: shortLabel(day), actual: actualForDay, ideal });
  }

  const dueLabel = shortLabel(dueDate);
  const todayLabel = todayMs >= startMs && todayMs <= dueMs ? shortLabel(today) : null;
  const dueRow = rows[rows.length - 1];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 16, right: 32, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis
          tick={{ fontSize: 10 }}
          allowDecimals={metric === "daysLeft"}
          label={{ value: metric === "daysLeft" ? "Days left" : "Stories", angle: -90, position: "insideLeft", offset: 12, style: { fontSize: 10, fill: "#64748b" } }}
          domain={[0, Math.max(1, Math.ceil(startTotal))]}
        />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
        {todayLabel ? (
          <ReferenceLine
            x={todayLabel}
            stroke="#94a3b8"
            strokeDasharray="4 2"
            label={{ value: "Today", position: "insideTop", fontSize: 10, fill: "#64748b" }}
          />
        ) : null}
        <Line
          type="monotone"
          dataKey="actual"
          stroke="#2563eb"
          dot={false}
          strokeWidth={2}
          name="Actual"
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="ideal"
          stroke="#f97316"
          strokeDasharray="6 4"
          dot={false}
          strokeWidth={1.5}
          name="Epic ideal to due"
        />
        {/* Target marker at the due date — matches the insights "Due X/Y" annotation. */}
        {dueRow ? (
          <ReferenceDot
            x={dueLabel}
            y={dueRow.ideal ?? 0}
            r={5}
            fill="#fff"
            stroke="#dc2626"
            strokeWidth={2}
            label={{ value: `Due ${dueLabel}`, position: "top", fontSize: 10, fill: "#dc2626" }}
          />
        ) : null}
      </LineChart>
    </ResponsiveContainer>
  );
}
