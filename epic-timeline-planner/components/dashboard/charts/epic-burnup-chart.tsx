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
import { computeProgress } from "@/lib/progress";
import { computeEpicHealthVerdict } from "@/lib/epic-health";
import { HealthBadge, formatHealthTooltip } from "@/components/timeline/health-badge";

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
  /** When set to "epicEst", renders a horizontal "scope promise" reference line at the epic's
   *  `originalEstimateDays` so the burnup can be read against the epic-level estimate the
   *  team committed to. Other modes ("days" / "stories" / undefined) skip the line. */
  progressBasis?: "days" | "stories" | "epicEst";
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

function storyScopeValue(story: UserStoryItem, metric: "daysLeft" | "storyCount"): number {
  if (metric === "storyCount") return 1;
  return Math.max(0, story.estimatedDays ?? story.daysLeft ?? 1);
}

function storyOpenRemainingAtDay(
  story: UserStoryItem,
  metric: "daysLeft" | "storyCount",
  snapshot: StoryDailySnapshotItem | null,
): number {
  const status = snapshot?.status ?? story.status;
  if (status !== "todo" && status !== "inProgress") return 0;
  if (metric === "storyCount") return 1;
  const daysLeft = snapshot?.daysLeft ?? snapshot?.estimatedDays ?? story.daysLeft ?? story.estimatedDays ?? 1;
  return Math.max(0, daysLeft);
}

export function EpicBurnupChart({ initiatives, year, sprint, team, epicId, metric = "storyCount", progressBasis = "days" }: Props) {
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
  const storyDayTotalScope = stories.reduce((sum, story) => sum + storyScopeValue(story, metric), 0);
  // Total scope follows the basis (mirrors EpicBurndownChart):
  //   - epicEst → epic.originalEstimateDays (falls back to story sum)
  //   - days / stories → story-sum behavior (today's default)
  const totalScope: number =
    metric === "storyCount"
      ? storyDayTotalScope
      : progressBasis === "epicEst"
        ? (epic.originalEstimateDays != null && epic.originalEstimateDays > 0
            ? epic.originalEstimateDays
            : storyDayTotalScope)
        : storyDayTotalScope;

  const today = startOfDay(new Date());
  const startMs = startDate.getTime();
  const dueMs = dueDate.getTime();
  const todayMs = today.getTime();
  const totalDays = Math.max(1, Math.round((dueMs - startMs) / 86400000) + 1);

  // In `epicEst` mode totalScope = epicEst but openRemaining is in story-day
  // units — without scaling the subtraction underflows to zero. Scale by
  // (epicEst / openStoryDaysAtStart) so completed sits on the epic-est axis
  // and mirrors the burndown's scaled actual.
  const storyDayStartTotal = stories.reduce((sum, story) => {
    const snap = latestSnapshotAtDay(story, startDate);
    const status = snap?.status ?? story.status;
    if (status !== "todo" && status !== "inProgress") return sum;
    if (metric === "storyCount") return sum + 1;
    const daysLeft = snap?.daysLeft ?? snap?.estimatedDays ?? story.estimatedDays ?? story.daysLeft ?? 1;
    return sum + Math.max(0, daysLeft);
  }, 0);
  const useEpicEstScale =
    progressBasis === "epicEst"
    && metric === "daysLeft"
    && (epic.originalEstimateDays ?? 0) > 0
    && storyDayStartTotal > 0;
  const openScale = useEpicEstScale ? (epic.originalEstimateDays as number) / storyDayStartTotal : 1;

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
      // Burnup mirrors burndown: completed = totalScope − open work
      // remaining at this day. Story-day reductions on in-progress
      // stories count as completion, so the two charts always agree.
      let openRemaining = 0;
      for (const story of stories) {
        const snap = latestSnapshotAtDay(story, day);
        openRemaining += storyOpenRemainingAtDay(story, metric, snap);
      }
      const value = Math.max(0, totalScope - openRemaining * openScale);
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

  // Basis-aware health verdict overlay — same shared verdict function
  // every other surface calls.
  const healthInfo = (() => {
    const v = computeEpicHealthVerdict(epic, year, progressBasis);
    if (v == null) return null;
    const hasData = progressBasis === "stories"
      ? stories.length > 0
      : v.result.totalEffort > 0;
    if (!hasData) return null;
    return { status: v.status, tooltip: formatHealthTooltip(v.result) };
  })();

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
    <div className="relative h-full w-full">
      {healthInfo ? (
        <div className="pointer-events-none absolute right-2 top-1 z-10">
          <HealthBadge status={healthInfo.status} tooltip={healthInfo.tooltip} />
        </div>
      ) : null}
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
        {/* Scope-promise reference line — when the user has chosen
         *  Σ Epic Est. basis, draw the epic's `originalEstimateDays`
         *  as the cumulative target the burnup should reach. Skipped
         *  on the story-count axis (units don't match) and when no
         *  epic estimate exists. */}
        {progressBasis === "epicEst" && metric === "daysLeft" && epic.originalEstimateDays != null && epic.originalEstimateDays > 0 ? (
          <ReferenceLine
            y={epic.originalEstimateDays}
            stroke="#0ea5e9"
            strokeDasharray="2 4"
            label={{ value: `Scope promise · ${epic.originalEstimateDays}d`, position: "insideTopRight", fontSize: 10, fill: "#0369a1" }}
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
    </div>
  );
}
