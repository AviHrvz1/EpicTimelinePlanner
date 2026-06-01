import type { EpicItem, UserStoryItem } from "@/lib/types";
import { now as clockNow, nowMs as clockNowMs } from "@/lib/clock";

/** Two sprints per calendar month → 24 per year. */
export const YEAR_SPRINT_MIN = 1;
export const YEAR_SPRINT_MAX = 24;

export function globalSprintFromMonthLane(month: number, lane: 1 | 2): number {
  return (month - 1) * 2 + lane;
}

/** Local calendar sprint index for "today" (lane 1: days 1-15, lane 2: 16-end). */
export function currentCalendarYearSprint(nowOverride?: Date): number {
  const n = nowOverride ?? clockNow();
  const month = n.getMonth() + 1;
  const lane: 1 | 2 = n.getDate() <= 15 ? 1 : 2;
  return globalSprintFromMonthLane(month, lane);
}

export function monthLaneFromGlobalSprint(globalSprint: number): { month: number; lane: 1 | 2 } {
  const month = Math.ceil(globalSprint / 2);
  const lane = (globalSprint % 2 === 0 ? 2 : 1) as 1 | 2;
  return { month, lane };
}

/**
 * Last instant of a calendar sprint window in local time (lane 1: 1–15, lane 2: 16–end of month).
 */
export function sprintEndDate(planYear: number, globalSprint: number): Date {
  const g = clampYearSprint(globalSprint);
  const { month, lane } = monthLaneFromGlobalSprint(g);
  if (lane === 1) {
    return new Date(planYear, month - 1, 15, 23, 59, 59, 999);
  }
  const lastDay = new Date(planYear, month, 0).getDate();
  return new Date(planYear, month - 1, lastDay, 23, 59, 59, 999);
}

/** First local instant of a sprint window (lane 1: day 1; lane 2: day 16). */
export function sprintStartDate(planYear: number, globalSprint: number): Date {
  const g = clampYearSprint(globalSprint);
  const { month, lane } = monthLaneFromGlobalSprint(g);
  if (lane === 1) {
    return new Date(planYear, month - 1, 1, 0, 0, 0, 0);
  }
  return new Date(planYear, month - 1, 16, 0, 0, 0, 0);
}

/** Global sprint in `planYear` whose [start,end] window contains `instantMs` in local time. */
export function yearSprintContainingInstant(planYear: number, instantMs?: number): number | null {
  const ms = instantMs ?? clockNowMs();
  for (let n = YEAR_SPRINT_MIN; n <= YEAR_SPRINT_MAX; n++) {
    const a = sprintStartDate(planYear, n).getTime();
    const b = sprintEndDate(planYear, n).getTime();
    if (ms >= a && ms <= b) return n;
  }
  return null;
}

/** First global sprint in `planYear` whose end is still in the future; `null` if all 24 are past. */
export function firstOpenYearSprint(planYear: number, nowMsOverride?: number): number | null {
  const ms = nowMsOverride ?? clockNowMs();
  for (let n = YEAR_SPRINT_MIN; n <= YEAR_SPRINT_MAX; n++) {
    if (sprintEndDate(planYear, n).getTime() > ms) return n;
  }
  return null;
}

/**
 * Sprint that “contains” wall-clock time in `planYear` (today’s calendar sprint), otherwise the first
 * sprint whose window has not ended yet. Matches how users expect “current sprint” while viewing the roadmap year.
 */
export function currentWorkYearSprintForPlan(planYear: number, instantMs?: number): number | null {
  const ms = instantMs ?? clockNowMs();
  const n = new Date(ms);
  if (n.getFullYear() === planYear) {
    return currentCalendarYearSprint(n);
  }
  const inside = yearSprintContainingInstant(planYear, ms);
  if (inside != null) return inside;
  return firstOpenYearSprint(planYear, ms);
}

export function firstGlobalSprintForMonth(month: number): number {
  return globalSprintFromMonthLane(month, 1);
}

export function isYearSprintValue(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= YEAR_SPRINT_MIN && n <= YEAR_SPRINT_MAX;
}

/**
 * Story.sprint: either a year sprint 1–24, or legacy 1–2 meaning lane within `contextMonth`.
 */
export function resolveStoryYearSprint(story: UserStoryItem, contextMonth: number): number | null {
  if (story.sprint == null) return null;
  if (story.sprint >= 3) return story.sprint;
  if (story.sprint !== 1 && story.sprint !== 2) return story.sprint;
  return globalSprintFromMonthLane(contextMonth, story.sprint as 1 | 2);
}

/**
 * Epic.planSprint: year sprint or legacy lane with plan month.
 */
export function resolveEpicPlanYearSprint(epic: EpicItem): number | null {
  if (epic.planSprint == null || epic.planStartMonth == null) return null;
  if (epic.planSprint >= 3) return epic.planSprint;
  if (epic.planSprint !== 1 && epic.planSprint !== 2) return epic.planSprint;
  return globalSprintFromMonthLane(epic.planStartMonth, epic.planSprint as 1 | 2);
}

export function clampYearSprint(n: number): number {
  return Math.min(YEAR_SPRINT_MAX, Math.max(YEAR_SPRINT_MIN, Math.round(n)));
}

/** Full-month envelope: first sprint of start month through second sprint of end month. */
export function yearSprintRangeFromMonthRange(startMonth: number, endMonth: number): {
  startYearSprint: number;
  endYearSprint: number;
} {
  return {
    startYearSprint: firstGlobalSprintForMonth(startMonth),
    endYearSprint: globalSprintFromMonthLane(endMonth, 2),
  };
}

export function monthRangeFromYearSprintRange(
  startYearSprint: number,
  endYearSprint: number,
): { startMonth: number; endMonth: number } {
  const a = clampYearSprint(startYearSprint);
  const b = clampYearSprint(endYearSprint);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return {
    startMonth: monthLaneFromGlobalSprint(lo).month,
    endMonth: monthLaneFromGlobalSprint(hi).month,
  };
}

/** Sprint bounds for Gantt; falls back to full-month span when sprint fields are unset. */
export function resolvedInitiativeYearSprintBounds(initiative: {
  startMonth: number | null;
  endMonth: number | null;
  startYearSprint?: number | null;
  endYearSprint?: number | null;
}): { startYearSprint: number; endYearSprint: number } | null {
  if (initiative.startMonth == null || initiative.endMonth == null) return null;
  const sm = initiative.startMonth;
  const em = initiative.endMonth;
  const startYS = initiative.startYearSprint ?? firstGlobalSprintForMonth(sm);
  const endYS = initiative.endYearSprint ?? globalSprintFromMonthLane(em, 2);
  const a = clampYearSprint(startYS);
  const b = clampYearSprint(endYS);
  if (a <= b) return { startYearSprint: a, endYearSprint: b };
  return { startYearSprint: b, endYearSprint: a };
}
