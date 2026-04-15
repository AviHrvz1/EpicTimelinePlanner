import { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";

export type QuarterEpicRow = {
  epic: EpicItem;
  initiative: InitiativeItem;
};

export type QuarterBurndownPoint = {
  day: string;
  [key: string]: string | number | null;
};

export type QuarterBurndownMetric = "daysLeft" | "storyCount";

function overlapRange(start: number, end: number, qStart: number, qEnd: number): boolean {
  return !(end < qStart || start > qEnd);
}

export function collectQuarterEpics(
  initiatives: InitiativeItem[],
  quarterMonths: readonly number[],
): QuarterEpicRow[] {
  const qStart = quarterMonths[0];
  const qEnd = quarterMonths[quarterMonths.length - 1];
  const rows: QuarterEpicRow[] = [];
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled") continue;
    if (initiative.startMonth == null || initiative.endMonth == null) continue;
    if (!overlapRange(initiative.startMonth, initiative.endMonth, qStart, qEnd)) continue;
    for (const epic of initiative.epics ?? []) {
      const epicHasPlan =
        epic.planStartMonth != null &&
        epic.planEndMonth != null &&
        overlapRange(epic.planStartMonth, epic.planEndMonth, qStart, qEnd);
      // Keep visible quarter initiatives useful: include explicitly planned epics
      // and epics without a specific month plan yet.
      if (epicHasPlan || (epic.planStartMonth == null && epic.planEndMonth == null)) {
        rows.push({ epic, initiative });
      }
    }
  }
  return rows.sort((a, b) => {
    const byInit = a.initiative.title.localeCompare(b.initiative.title);
    if (byInit !== 0) return byInit;
    return a.epic.title.localeCompare(b.epic.title);
  });
}

export function buildQuarterStatusPie(stories: UserStoryItem[]): Array<{ name: string; value: number }> {
  const counts = { todo: 0, inProgress: 0, done: 0, approved: 0 };
  for (const story of stories) {
    if (story.status === "inProgress") counts.inProgress += 1;
    else if (story.status === "done") counts.done += 1;
    else if (story.status === "approved") counts.approved += 1;
    else counts.todo += 1;
  }
  return [
    { name: "To do", value: counts.todo },
    { name: "In progress", value: counts.inProgress },
    { name: "Done", value: counts.done },
    { name: "Approved", value: counts.approved },
  ];
}

export function buildQuarterBurndownSeries(
  selectedEpics: EpicItem[],
  mode: "aggregate" | "individual",
  metric: QuarterBurndownMetric,
  horizon = 12,
): QuarterBurndownPoint[] {
  const series = selectedEpics.map((epic) => {
    const stories = epic.userStories ?? [];
    const start =
      metric === "daysLeft"
        ? stories.reduce((sum, s) => sum + (s.estimatedDays ?? s.daysLeft ?? 1), 0)
        : stories.length;
    const actualRemaining =
      metric === "daysLeft"
        ? stories.reduce((sum, s) => sum + (s.daysLeft ?? 0), 0)
        : stories.filter((s) => s.status !== "done" && s.status !== "approved").length;
    const progress = start > 0 ? Math.max(0, Math.min(1, 1 - actualRemaining / start)) : 0;
    const today = Math.max(1, Math.min(horizon, Math.round(progress * horizon)));
    return { key: epic.id, start, actualRemaining, today };
  });

  return Array.from({ length: horizon }, (_, idx) => {
    const dayIdx = idx + 1;
    const row: QuarterBurndownPoint = { day: `D${dayIdx}` };
    const startTotal = series.reduce((sum, s) => sum + s.start, 0);
    const remainingTotal = series.reduce((sum, s) => sum + s.actualRemaining, 0);
    const progressTotal = startTotal > 0 ? Math.max(0, Math.min(1, 1 - remainingTotal / startTotal)) : 0;
    const todayTotal = Math.max(1, Math.min(horizon, Math.round(progressTotal * horizon)));
    row.ideal = Number((startTotal * (1 - idx / (horizon - 1))).toFixed(1));
    row.actual =
      dayIdx <= todayTotal
        ? Number((startTotal - (startTotal - remainingTotal) * ((dayIdx - 1) / Math.max(todayTotal - 1, 1))).toFixed(1))
        : null;
    if (mode === "aggregate") {
      return row;
    }
    for (const s of series) {
      const value =
        dayIdx <= s.today
          ? s.start - (s.start - s.actualRemaining) * ((dayIdx - 1) / Math.max(s.today - 1, 1))
          : null;
      row[s.key] = value == null ? null : Number(value.toFixed(1));
    }
    return row;
  });
}
