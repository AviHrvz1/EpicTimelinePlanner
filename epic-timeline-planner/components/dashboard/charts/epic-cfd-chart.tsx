"use client";

import { Area, AreaChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { EpicItem, InitiativeItem, StoryDailySnapshotItem, UserStoryItem } from "@/lib/types";

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  team?: string | null;
  epicId?: string | null;
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

export function EpicCfdChart({ initiatives, year, sprint, team, epicId }: Props) {
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
        Pick an epic to render its cumulative flow
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
  const today = startOfDay(new Date());
  const startMs = startDate.getTime();
  const dueMs = dueDate.getTime();
  const todayMs = today.getTime();
  const totalDays = Math.max(1, Math.round((dueMs - startMs) / 86400000) + 1);

  type Row = {
    label: string;
    todo: number | null;
    inProgress: number | null;
    review: number | null;
    done: number | null;
    isToday: boolean;
  };
  const rows: Row[] = [];
  for (let i = 0; i < totalDays; i++) {
    const day = startOfDay(new Date(startMs + i * 86400000));
    const dayMs = day.getTime();
    const isFuture = dayMs > todayMs;
    if (isFuture) {
      rows.push({ label: shortLabel(day), todo: null, inProgress: null, review: null, done: null, isToday: false });
      continue;
    }
    let todo = 0;
    let inProgress = 0;
    let review = 0;
    let done = 0;
    for (const story of stories) {
      const snap = latestSnapshotAtDay(story, day);
      const status = snap?.status ?? story.status;
      if (status === "todo") todo += 1;
      else if (status === "inProgress") inProgress += 1;
      else if (status === "review") review += 1;
      else if (status === "done") done += 1;
    }
    rows.push({ label: shortLabel(day), todo, inProgress, review, done, isToday: dayMs === todayMs });
  }

  const todayLabel = rows.find((r) => r.isToday)?.label;

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
      <AreaChart data={rows} margin={{ top: 8, right: 24, left: 16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} ticks={xAxisTicks} />
        <YAxis
          tick={{ fontSize: 10 }}
          width={44}
          allowDecimals={false}
          label={{ value: "Stories", angle: -90, position: "insideLeft", offset: 0, style: { fontSize: 11, fill: "#475569", fontWeight: 600 } }}
        />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {todayLabel && (
          <ReferenceLine
            x={todayLabel}
            stroke="#94a3b8"
            strokeDasharray="4 2"
            label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
          />
        )}
        <Area type="monotone" dataKey="todo" stackId="1" stroke="#94a3b8" fill="#f1f5f9" name="To do" connectNulls={false} />
        <Area type="monotone" dataKey="inProgress" stackId="1" stroke="#f59e0b" fill="#fef3c7" name="In progress" connectNulls={false} />
        <Area type="monotone" dataKey="review" stackId="1" stroke="#8b5cf6" fill="#ede9fe" name="Review / Testing" connectNulls={false} />
        <Area type="monotone" dataKey="done" stackId="1" stroke="#10b981" fill="#d1fae5" name="Done" connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
