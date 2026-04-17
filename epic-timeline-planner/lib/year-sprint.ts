import type { EpicItem, UserStoryItem } from "@/lib/types";

/** Two sprints per calendar month → 24 per year. */
export const YEAR_SPRINT_MIN = 1;
export const YEAR_SPRINT_MAX = 24;

export function globalSprintFromMonthLane(month: number, lane: 1 | 2): number {
  return (month - 1) * 2 + lane;
}

export function monthLaneFromGlobalSprint(globalSprint: number): { month: number; lane: 1 | 2 } {
  const month = Math.ceil(globalSprint / 2);
  const lane = (globalSprint % 2 === 0 ? 2 : 1) as 1 | 2;
  return { month, lane };
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
