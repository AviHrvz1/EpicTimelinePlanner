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
  ideal?: number | null;
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

  // Map each month → its first 1-indexed day position inside the
  // quarterDays horizon (used to translate per-epic
  // planStartMonth+sprint into a dayIdx for the ideal-line ramp).
  const monthToFirstDayIdx = new Map<number, number>();
  {
    let cum = 0;
    for (const m of quarterMonths) {
      monthToFirstDayIdx.set(m, cum + 1);
      cum += MONTH_DAY_COUNTS[m] ?? 30;
    }
  }
  const clampToHorizon = (n: number) => Math.max(1, Math.min(horizon, n));

  // Period start in ms for converting an observed-start Date back into
  // a horizon dayIdx. Anchored at the first day of the first quarter
  // month exactly like the existing quarterDays computation.
  const periodStartMs = new Date(planYear, quarterMonths[0] - 1, 1).getTime();
  /** First day the epic's snapshots show real movement — earliest
   *  snapshot where any story's daysLeft fell below estimatedDays OR
   *  status advanced past todo / inProgress. Returns null when nothing
   *  has moved yet (callers fall back to the planned start). */
  const epicObservedDayIdx = (epic: EpicItem): number | null => {
    const stories = epic.userStories ?? [];
    let earliestMs = Infinity;
    for (const story of stories) {
      const baseline = story.estimatedDays ?? 0;
      const snaps = story.snapshots ?? [];
      if (snaps.length === 0) continue;
      const sorted = [...snaps].sort((a, b) =>
        new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime());
      for (const snap of sorted) {
        const advancedStatus = snap.status === "review" || snap.status === "done";
        const snapDaysLeft = snap.daysLeft ?? snap.estimatedDays ?? baseline;
        const burntSomething = baseline > 0 && snapDaysLeft < baseline;
        if (advancedStatus || burntSomething) {
          const ts = new Date(snap.snapshotDate).getTime();
          if (Number.isFinite(ts) && ts < earliestMs) earliestMs = ts;
          break;
        }
      }
    }
    if (!Number.isFinite(earliestMs)) return null;
    return Math.floor((earliestMs - periodStartMs) / 86400000) + 1;
  };

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
    // Resolve the epic's own window inside the quarter. The ideal ramp
    // anchors to the EFFECTIVE start — observed when it's earlier than
    // the planned start, planned otherwise. So an epic the team began
    // ahead of schedule gets its ramp aligned with the blue line's
    // first movement, not the empty calendar weeks before.
    const startMonth = epic.planStartMonth ?? quarterMonths[0];
    const startSprint = epic.planSprint === 2 ? 2 : 1;
    const endMonth = epic.planEndMonth ?? quarterMonths[quarterMonths.length - 1];
    const endSprint = epic.planEndSprint === 1 ? 1 : 2;
    const startDayOfMonth = startSprint === 2 ? 16 : 1;
    const endDayOfMonth = endSprint === 1 ? 15 : (MONTH_DAY_COUNTS[endMonth] ?? 30);
    const startBase = monthToFirstDayIdx.get(startMonth);
    const endBase = monthToFirstDayIdx.get(endMonth);
    const plannedStartDayIdx = startBase != null ? clampToHorizon(startBase + startDayOfMonth - 1) : 1;
    const observedDayIdx = epicObservedDayIdx(epic);
    const startDayIdx = observedDayIdx != null && observedDayIdx < plannedStartDayIdx
      ? Math.max(1, observedDayIdx)
      : plannedStartDayIdx;
    const dueDayIdx = endBase != null ? clampToHorizon(endBase + endDayOfMonth - 1) : horizon;
    return { key: epic.id, start, actualRemaining, startDayIdx, dueDayIdx };
  });

  /** Aggregate window = earliest start … latest due across the series.
   *  Used by the aggregate ideal line so it stays flat at startTotal
   *  before any epic begins and reaches 0 only once the last epic is
   *  due. */
  const aggStartDayIdx = series.length === 0
    ? 1
    : series.reduce((min, s) => Math.min(min, s.startDayIdx), series[0].startDayIdx);
  const aggDueDayIdx = series.length === 0
    ? horizon
    : series.reduce((max, s) => Math.max(max, s.dueDayIdx), series[0].dueDayIdx);

  /** Burndown ideal — returns null outside the epic's window so the
   *  rendered line is a single clean linear segment inside [startIdx,
   *  dueIdx]. Recharts skips null points when `connectNulls={false}`,
   *  so no flat tails appear outside the plan. */
  const idealFor = (dayIdx: number, startVal: number, startIdx: number, dueIdx: number): number | null => {
    if (startVal <= 0) return null;
    if (dayIdx < startIdx || dayIdx > dueIdx) return null;
    const span = Math.max(1, dueIdx - startIdx);
    return startVal * (1 - (dayIdx - startIdx) / span);
  };

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
    const idealRaw = idealFor(dayIdx, startTotal, aggStartDayIdx, aggDueDayIdx);
    const inPast = todayCalendarDay > 0 && dayIdx <= todayCalendarDay;
    const actualRaw = inPast
      ? startTotal - (startTotal - remainingTotal) * ((dayIdx - 1) / Math.max(todayCalendarDay - 1, 1))
      : null;
    row.ideal = idealRaw == null
      ? null
      : metric === "storyCount" ? Math.round(idealRaw) : Number(idealRaw.toFixed(1));
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
