import { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";
import { now as clockNow } from "@/lib/clock";

export type QuarterEpicRow = {
  epic: EpicItem;
  initiative: InitiativeItem;
};

export type QuarterBurndownPoint = {
  dayLabel: string;
  axisLabel: string;
  monthLabel: string;
  isCalendarToday: boolean;
  ideal?: number;
  actual?: number | null;
  [key: string]: string | number | boolean | null | undefined;
};

export type QuarterBurndownMetric = "daysLeft" | "storyCount";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTH_DAY_COUNTS: Record<number, number> = {
  1: 31,
  2: 28,
  3: 31,
  4: 30,
  5: 31,
  6: 30,
  7: 31,
  8: 31,
  9: 30,
  10: 31,
  11: 30,
  12: 31,
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function startOfLocalDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function overlapRange(start: number, end: number, qStart: number, qEnd: number): boolean {
  return !(end < qStart || start > qEnd);
}

export function collectQuarterEpics(
  initiatives: InitiativeItem[],
  quarterMonths: readonly number[],
): QuarterEpicRow[] {
  const qStart = quarterMonths[0];
  const qEnd = quarterMonths[quarterMonths.length - 1];
  const byEpicId = new Map<string, QuarterEpicRow>();
  for (const initiative of initiatives) {
    const epics = initiative.epics ?? [];
    const initiativeSpansQuarter =
      initiative.status === "scheduled" &&
      initiative.startMonth != null &&
      initiative.endMonth != null &&
      overlapRange(initiative.startMonth, initiative.endMonth, qStart, qEnd);
    const initiativeHasPlannedEpicInQuarter = epics.some(
      (e) =>
        e.planStartMonth != null &&
        e.planEndMonth != null &&
        overlapRange(e.planStartMonth, e.planEndMonth, qStart, qEnd),
    );
    for (const epic of epics) {
      const epicHasPlan =
        epic.planStartMonth != null &&
        epic.planEndMonth != null &&
        overlapRange(epic.planStartMonth, epic.planEndMonth, qStart, qEnd);
      const isUnscheduled =
        epic.planSprint == null && epic.planStartMonth == null && epic.planEndMonth == null;
      const includeUnscheduled = isUnscheduled && (initiativeSpansQuarter || initiativeHasPlannedEpicInQuarter);
      if (!epicHasPlan && !includeUnscheduled) continue;
      byEpicId.set(epic.id, { epic, initiative });
    }
  }
  return [...byEpicId.values()].sort((a, b) => {
    const byInit = a.initiative.title.localeCompare(b.initiative.title);
    if (byInit !== 0) return byInit;
    return a.epic.title.localeCompare(b.epic.title);
  });
}

export function buildQuarterStatusPie(stories: UserStoryItem[]): Array<{ name: string; value: number }> {
  const counts = { todo: 0, inProgress: 0, review: 0, done: 0 };
  for (const story of stories) {
    if (story.status === "inProgress") counts.inProgress += 1;
    else if (story.status === "review") counts.review += 1;
    else if (story.status === "done") counts.done += 1;
    else counts.todo += 1;
  }
  return [
    { name: "To do", value: counts.todo },
    { name: "In progress", value: counts.inProgress },
    { name: "Review / Testing", value: counts.review },
    { name: "Done", value: counts.done },
  ];
}

export function buildQuarterBurndownSeries(
  selectedEpics: EpicItem[],
  mode: "aggregate" | "individual",
  metric: QuarterBurndownMetric,
  quarterMonths: readonly number[],
  planYear: number,
): QuarterBurndownPoint[] {
  const todayMs = startOfLocalDay(clockNow());
  const quarterDays = quarterMonths.flatMap((month) => {
    const total = MONTH_DAY_COUNTS[month] ?? 30;
    return Array.from({ length: total }, (_, idx) => {
      const day = idx + 1;
      const monthShort = MONTH_SHORT[month - 1] ?? `M${month}`;
      const cal = new Date(planYear, month - 1, day);
      const weekdayShort = WEEKDAY_SHORT[cal.getDay()];
      const isCalendarToday = startOfLocalDay(cal) === todayMs;
      const dateDayLabel = `${day}/${month} (${weekdayShort})`;
      return {
        dayLabel: dateDayLabel,
        axisLabel: dateDayLabel,
        monthLabel: monthShort,
        isCalendarToday,
      };
    });
  });
  const horizon = Math.max(quarterDays.length, 1);

  // Use the actual calendar position of today in the period, not a progress-derived position.
  const todayCalendarDay = (() => {
    const idx = quarterDays.findIndex((d) => d.isCalendarToday);
    if (idx >= 0) return idx + 1;
    // Today is after the period ends → show all days
    if (todayMs > startOfLocalDay(new Date(planYear, quarterMonths[quarterMonths.length - 1] - 1,
        MONTH_DAY_COUNTS[quarterMonths[quarterMonths.length - 1]] ?? 31))) return horizon;
    // Today is before the period starts → show nothing
    return 0;
  })();

  const series = selectedEpics.map((epic) => {
    const stories = epic.userStories ?? [];
    const start =
      metric === "daysLeft"
        ? stories.reduce((sum, s) => sum + (s.estimatedDays ?? s.daysLeft ?? 1), 0)
        : stories.length;
    const actualRemaining =
      metric === "daysLeft"
        ? stories.reduce((sum, s) => sum + (s.daysLeft ?? 0), 0)
        : stories.filter((s) => s.status !== "done").length;
    return { key: epic.id, start, actualRemaining };
  });

  return Array.from({ length: horizon }, (_, idx) => {
    const dayIdx = idx + 1;
    const dayInfo = quarterDays[idx] ?? {
      dayLabel: `Day ${dayIdx}`,
      axisLabel: String(dayIdx),
      monthLabel: "",
      isCalendarToday: false,
    };
    const row: QuarterBurndownPoint = {
      dayLabel: dayInfo.dayLabel,
      axisLabel: dayInfo.axisLabel,
      monthLabel: dayInfo.monthLabel,
      isCalendarToday: dayInfo.isCalendarToday,
    };
    const startTotal = series.reduce((sum, s) => sum + s.start, 0);
    const remainingTotal = series.reduce((sum, s) => sum + s.actualRemaining, 0);
    const idealRaw = startTotal * (1 - idx / Math.max(horizon - 1, 1));
    const inPast = todayCalendarDay > 0 && dayIdx <= todayCalendarDay;
    const actualRaw = inPast
      ? startTotal - (startTotal - remainingTotal) * ((dayIdx - 1) / Math.max(todayCalendarDay - 1, 1))
      : null;
    row.ideal = metric === "storyCount" ? Math.round(idealRaw) : Number(idealRaw.toFixed(1));
    row.actual =
      actualRaw == null ? null : metric === "storyCount" ? Math.round(actualRaw) : Number(actualRaw.toFixed(1));
    if (mode === "aggregate") {
      return row;
    }
    for (const s of series) {
      const value = inPast
        ? s.start - (s.start - s.actualRemaining) * ((dayIdx - 1) / Math.max(todayCalendarDay - 1, 1))
        : null;
      row[s.key] =
        value == null ? null : metric === "storyCount" ? Math.round(value) : Number(value.toFixed(1));
    }
    return row;
  });
}
