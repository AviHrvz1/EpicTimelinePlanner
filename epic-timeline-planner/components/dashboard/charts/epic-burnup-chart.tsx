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
  /** Restrict the burnup to a single epic. */
  epicId?: string | null;
  /** Metric: "daysLeft" sums completed estimated days, "storyCount" counts completed stories. */
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

function isStoryDone(status: UserStoryItem["status"] | null | undefined): boolean {
  return status === "done" || status === "approved";
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

function storyScopeValue(story: UserStoryItem, metric: "daysLeft" | "storyCount"): number {
  if (metric === "storyCount") return 1;
  return Math.max(0, story.estimatedDays ?? story.daysLeft ?? 1);
}

function storyCompletedValueAtDay(
  story: UserStoryItem,
  metric: "daysLeft" | "storyCount",
  snapshot: StoryDailySnapshotItem | null,
): number {
  const status = snapshot?.status ?? story.status;
  if (!isStoryDone(status)) return 0;
  if (metric === "storyCount") return 1;
  return Math.max(0, story.estimatedDays ?? story.daysLeft ?? 1);
}

export function EpicBurnupChart({ initiatives, year, sprint, team, epicId, metric = "storyCount" }: Props) {
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
        Pick an epic to render its burnup
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

  const stories = epic.userStories ?? [];
  const totalScope = stories.reduce((sum, story) => sum + storyScopeValue(story, metric), 0);

  const today = startOfDay(new Date());
  const startMs = startDate.getTime();
  const dueMs = dueDate.getTime();
  const todayMs = today.getTime();
  const totalDays = Math.max(1, Math.round((dueMs - startMs) / 86400000) + 1);

  type Row = {
    label: string;
    scope: number;
    completed: number | null;
    ideal: number | null;
  };
  const rows: Row[] = [];
  for (let i = 0; i < totalDays; i++) {
    const day = startOfDay(new Date(startMs + i * 86400000));
    const dayMs = day.getTime();
    const isFuture = dayMs > todayMs;
    let completedForDay: number | null = null;
    if (!isFuture) {
      let value = 0;
      for (const story of stories) {
        const snap = latestSnapshotAtDay(story, day);
        value += storyCompletedValueAtDay(story, metric, snap);
      }
      completedForDay = metric === "storyCount" ? Math.round(value) : Number(value.toFixed(1));
    }
    const idealRaw = totalDays <= 1 ? totalScope : (totalScope * i) / (totalDays - 1);
    const ideal = metric === "storyCount" ? Math.round(idealRaw) : Number(idealRaw.toFixed(1));
    rows.push({
      label: shortLabel(day),
      scope: metric === "storyCount" ? Math.round(totalScope) : Number(totalScope.toFixed(1)),
      completed: completedForDay,
      ideal,
    });
  }

  const dueLabel = shortLabel(dueDate);
  const todayLabel = todayMs >= startMs && todayMs <= dueMs ? shortLabel(today) : null;
  const dueRow = rows[rows.length - 1];

  // Evenly-spaced ticks so long plan ranges don't show uneven gaps.
  const xAxisTicks: string[] = (() => {
    const labels = rows.map((r) => r.label);
    if (labels.length <= 10) return labels;
    const targetCount = 10;
    const step = (labels.length - 1) / (targetCount - 1);
    const picked = Array.from({ length: targetCount }, (_, i) => labels[Math.round(i * step)]);
    return Array.from(new Set(picked));
  })();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 28, right: 56, left: 16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} ticks={xAxisTicks} />
        <YAxis
          tick={{ fontSize: 10 }}
          width={44}
          allowDecimals={metric === "daysLeft"}
          label={{ value: metric === "daysLeft" ? "Days completed" : "Stories", angle: -90, position: "insideLeft", offset: 0, style: { fontSize: 11, fill: "#475569", fontWeight: 600 } }}
          domain={[0, Math.max(1, Math.ceil(totalScope * 1.18))]}
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
        <Line type="monotone" dataKey="scope" stroke="#94a3b8" strokeWidth={1.5} dot={false} name="Total scope" />
        <Line type="monotone" dataKey="ideal" stroke="#f97316" strokeDasharray="6 4" dot={false} strokeWidth={1.5} name="Epic ideal to due" />
        <Line type="monotone" dataKey="completed" stroke="#10b981" dot={false} strokeWidth={2} name="Completed" connectNulls={false} />
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
