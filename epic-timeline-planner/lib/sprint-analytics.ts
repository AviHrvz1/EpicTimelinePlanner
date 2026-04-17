import { storyMatchesYearSprint } from "@/lib/sprint-plan";
import { InitiativeItem, UserStoryItem } from "@/lib/types";

export type BurndownMetric = "daysLeft" | "storyCount";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type SprintAnalyticsData = {
  statusPie: Array<{ name: string; value: number }>;
  burndown: Array<{ day: string; ideal: number; actual: number | null; isToday: boolean }>;
  workloadByAssignee: Array<{
    assignee: string;
    openCount: number;
    daysLeftTotal: number;
  }>;
  workloadMaxDays: number;
  flowSparkline: string;
  doneLast7d: number;
  openStories: number;
  atRiskStories: number;
  totalStories: number;
};

function collectMonthStories(initiatives: InitiativeItem[], month: number): UserStoryItem[] {
  const rows: UserStoryItem[] = [];
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null) continue;
    if (initiative.endMonth < month || initiative.startMonth > month) continue;
    for (const epic of initiative.epics ?? []) {
      rows.push(...(epic.userStories ?? []));
    }
  }
  return rows;
}

function buildStatusPie(stories: UserStoryItem[], month: number, yearSprint: number): Array<{ name: string; value: number }> {
  const counts = {
    unscheduled: 0,
    todo: 0,
    inProgress: 0,
    done: 0,
    approved: 0,
  };

  for (const story of stories) {
    if (story.sprint == null) {
      counts.unscheduled += 1;
      continue;
    }
    if (!storyMatchesYearSprint(story, month, yearSprint)) continue;
    if (story.status === "todo") counts.todo += 1;
    else if (story.status === "inProgress") counts.inProgress += 1;
    else if (story.status === "done") counts.done += 1;
    else if (story.status === "approved") counts.approved += 1;
  }

  return [
    { name: "Unscheduled", value: counts.unscheduled },
    { name: "To do", value: counts.todo },
    { name: "In progress", value: counts.inProgress },
    { name: "Done", value: counts.done },
    { name: "Approved", value: counts.approved },
  ];
}

function buildBurndown(stories: UserStoryItem[], month: number, yearSprint: number, metric: BurndownMetric) {
  const sprintStories = stories.filter((story) => storyMatchesYearSprint(story, month, yearSprint));
  const horizon = 10;

  let startValue = 0;
  let actualRemaining = 0;
  if (metric === "daysLeft") {
    startValue = sprintStories.reduce((sum, s) => sum + (s.estimatedDays ?? s.daysLeft ?? 1), 0);
    actualRemaining = sprintStories.reduce((sum, s) => sum + (s.daysLeft ?? 0), 0);
  } else {
    startValue = sprintStories.length;
    actualRemaining = sprintStories.filter((s) => s.status !== "done" && s.status !== "approved").length;
  }

  const progress = startValue > 0 ? Math.max(0, Math.min(1, 1 - actualRemaining / startValue)) : 0;
  const today = Math.max(1, Math.min(horizon, Math.round(progress * horizon)));

  const anchorToday = new Date();
  anchorToday.setHours(0, 0, 0, 0);

  const roundBurndown = (n: number) => (metric === "storyCount" ? Math.round(n) : Number(n.toFixed(1)));

  return Array.from({ length: horizon }, (_, idx) => {
    const dayIdx = idx + 1;
    const ideal = startValue * (1 - idx / (horizon - 1));
    const actual =
      dayIdx <= today
        ? startValue - (startValue - actualRemaining) * ((dayIdx - 1) / Math.max(today - 1, 1))
        : null;
    const cal = new Date(anchorToday);
    cal.setDate(anchorToday.getDate() - (horizon - 1 - idx));
    const weekday = WEEKDAY_NAMES[cal.getDay()];
    return {
      day: weekday,
      ideal: roundBurndown(ideal),
      actual: actual == null ? null : roundBurndown(actual),
      isToday: idx === horizon - 1,
    };
  });
}

function buildWorkloadByAssignee(stories: UserStoryItem[], month: number, yearSprint: number) {
  const sprintStories = stories.filter((story) => storyMatchesYearSprint(story, month, yearSprint));
  const openStories = sprintStories.filter(
    (story) => story.status === "todo" || story.status === "inProgress",
  );
  const byAssignee = new Map<string, { openCount: number; daysLeftTotal: number }>();
  for (const story of openStories) {
    const assignee = story.assignee?.trim() || "Unassigned";
    const row = byAssignee.get(assignee) ?? { openCount: 0, daysLeftTotal: 0 };
    row.openCount += 1;
    row.daysLeftTotal += Math.max(0, story.daysLeft ?? 0);
    byAssignee.set(assignee, row);
  }
  const workload = [...byAssignee.entries()]
    .map(([assignee, v]) => ({
      assignee,
      openCount: v.openCount,
      daysLeftTotal: v.daysLeftTotal,
    }))
    .sort((a, b) => b.daysLeftTotal - a.daysLeftTotal || b.openCount - a.openCount || a.assignee.localeCompare(b.assignee));
  const workloadMaxDays = Math.max(1, ...workload.map((item) => item.daysLeftTotal));
  const atRiskStories = openStories.filter(
    (story) => story.status === "inProgress" && (story.daysLeft ?? 0) < 0,
  ).length;
  return {
    workloadByAssignee: workload,
    workloadMaxDays,
    openStories: openStories.length,
    atRiskStories,
  };
}

function buildFlowTrend(stories: UserStoryItem[], month: number, yearSprint: number) {
  const sprintStories = stories.filter((story) => storyMatchesYearSprint(story, month, yearSprint));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const points = Array.from({ length: 30 }, (_, index) => {
    const pointDate = new Date(today);
    pointDate.setDate(today.getDate() - (29 - index));
    const cumulativeDone = sprintStories.filter((story) => {
      if (!(story.status === "done" || story.status === "approved")) return false;
      const updatedAt = new Date(story.updatedAt);
      updatedAt.setHours(0, 0, 0, 0);
      return updatedAt.getTime() <= pointDate.getTime();
    }).length;
    return { cumulativeDone };
  });
  const maxDone = Math.max(1, ...points.map((point) => point.cumulativeDone));
  const flowSparkline = points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
      const y = 100 - (point.cumulativeDone / maxDone) * 100;
      return `${x},${y}`;
    })
    .join(" ");
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const doneLast7d = sprintStories.filter((story) => {
    if (!(story.status === "done" || story.status === "approved")) return false;
    const updatedAt = new Date(story.updatedAt);
    return updatedAt.getTime() >= sevenDaysAgo.getTime();
  }).length;
  return { flowSparkline, doneLast7d };
}

export function buildSprintAnalytics(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
  metric: BurndownMetric,
): SprintAnalyticsData {
  const stories = collectMonthStories(initiatives, month);
  const workload = buildWorkloadByAssignee(stories, month, yearSprint);
  const flow = buildFlowTrend(stories, month, yearSprint);
  return {
    statusPie: buildStatusPie(stories, month, yearSprint),
    burndown: buildBurndown(stories, month, yearSprint, metric),
    ...workload,
    ...flow,
    totalStories: stories.filter((story) => storyMatchesYearSprint(story, month, yearSprint)).length,
  };
}
