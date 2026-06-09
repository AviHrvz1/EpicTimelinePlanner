/**
 * Single source of truth for a user story's health verdict — the
 * sibling of {@link computeEpicHealthVerdict} / {@link computeInitiativeHealthVerdict}
 * but operating one level lower (per-story, not per-epic).
 *
 * Mechanism: resolve the story's global sprint, derive the sprint's
 * calendar window, then run the same sprint-burndown verdict the Sprint
 * Load badge uses. Returns null when:
 *   - the story has no resolvable sprint (genuinely unscheduled — there's
 *     no time-box to compare progress against);
 *   - the story has no estimate (no ideal burndown to compare days-left
 *     against — `sprintStoryVerdict` would degenerate to "On Track");
 *   - the sprint window resolves to zero calendar days (shouldn't
 *     happen but guards a div-by-zero in the burndown math).
 *
 * Promoted from the backlog panel's inline `computeStoryHealthForBacklog`
 * so the Hero's Work Progress / Health Distribution donuts at Story
 * scope can use it without pulling the entire ~12k-line backlog panel
 * into their build graph.
 */
import { resolveStoryYearSprint, monthLaneFromGlobalSprint } from "@/lib/year-sprint";
import { sprintCalendarDaysRemaining, sprintDayDates } from "@/lib/sprint-analytics";
import { sprintStoryVerdict, type SprintLoadStoryProjection } from "@/components/timeline/sprint-analytics";
import type { EpicItem, UserStoryItem } from "@/lib/types";
import type { HealthStatus } from "@/lib/progress";

export function computeStoryHealthVerdict(
  story: UserStoryItem,
  parentEpic: EpicItem,
  planYear: number,
): { status: HealthStatus } | null {
  // `resolveStoryYearSprint` falls back to the epic's plan window
  // when the story has no explicit sprint — pass the epic's start
  // month as the context anchor.
  const contextMonth = parentEpic.planStartMonth ?? 1;
  const globalSprint = resolveStoryYearSprint(story, contextMonth);
  if (globalSprint == null) return null;
  const est = Math.max(0, story.estimatedDays ?? story.daysLeft ?? 0);
  if (est <= 0) return null;
  const { month } = monthLaneFromGlobalSprint(globalSprint);
  const total = sprintDayDates(planYear, month, globalSprint).length;
  if (total <= 0) return null;
  const left = sprintCalendarDaysRemaining(planYear, month, globalSprint);
  const projection: SprintLoadStoryProjection = {
    id: story.id,
    title: story.title,
    estimatedDays: story.estimatedDays,
    daysLeft: story.daysLeft,
    statusKey: story.status,
  };
  const { status } = sprintStoryVerdict(projection, left, total);
  return { status };
}
