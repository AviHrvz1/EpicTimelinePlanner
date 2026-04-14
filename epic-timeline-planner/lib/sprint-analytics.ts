import { InitiativeItem, UserStoryItem } from "@/lib/types";

export type BurndownMetric = "daysLeft" | "storyCount";

export type SprintAnalyticsData = {
  statusPie: Array<{ name: string; value: number }>;
  burndown: Array<{ day: string; ideal: number; actual: number | null }>;
  assigneeBars: Array<{
    assignee: string;
    todo: number;
    inProgress: number;
    done: number;
    approved: number;
    total: number;
  }>;
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

function buildStatusPie(stories: UserStoryItem[], sprintLane: 1 | 2): Array<{ name: string; value: number }> {
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
    if (story.sprint !== sprintLane) continue;
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

function buildBurndown(stories: UserStoryItem[], sprintLane: 1 | 2, metric: BurndownMetric) {
  const sprintStories = stories.filter((story) => story.sprint === sprintLane);
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

  return Array.from({ length: horizon }, (_, idx) => {
    const dayIdx = idx + 1;
    const ideal = startValue * (1 - idx / (horizon - 1));
    const actual =
      dayIdx <= today
        ? startValue - (startValue - actualRemaining) * ((dayIdx - 1) / Math.max(today - 1, 1))
        : null;
    return {
      day: `D${dayIdx}`,
      ideal: Number(ideal.toFixed(1)),
      actual: actual == null ? null : Number(actual.toFixed(1)),
    };
  });
}

function buildAssigneeBars(stories: UserStoryItem[], sprintLane: 1 | 2) {
  const sprintStories = stories.filter((story) => story.sprint === sprintLane);
  const byAssignee = new Map<
    string,
    { todo: number; inProgress: number; done: number; approved: number; total: number }
  >();
  for (const story of sprintStories) {
    const assignee = story.assignee?.trim() || "Unassigned";
    const row = byAssignee.get(assignee) ?? { todo: 0, inProgress: 0, done: 0, approved: 0, total: 0 };
    row.total += 1;
    if (story.status === "inProgress") row.inProgress += 1;
    else if (story.status === "done") row.done += 1;
    else if (story.status === "approved") row.approved += 1;
    else row.todo += 1;
    byAssignee.set(assignee, row);
  }
  return [...byAssignee.entries()]
    .map(([assignee, v]) => ({
      assignee,
      todo: v.todo,
      inProgress: v.inProgress,
      done: v.done,
      approved: v.approved,
      total: v.total,
    }))
    .sort((a, b) => b.total - a.total || a.assignee.localeCompare(b.assignee));
}

export function buildSprintAnalytics(
  initiatives: InitiativeItem[],
  month: number,
  sprintLane: 1 | 2,
  metric: BurndownMetric,
): SprintAnalyticsData {
  const stories = collectMonthStories(initiatives, month);
  return {
    statusPie: buildStatusPie(stories, sprintLane),
    burndown: buildBurndown(stories, sprintLane, metric),
    assigneeBars: buildAssigneeBars(stories, sprintLane),
    totalStories: stories.filter((story) => story.sprint === sprintLane).length,
  };
}
