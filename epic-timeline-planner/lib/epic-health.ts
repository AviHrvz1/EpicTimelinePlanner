/**
 * Single source of truth for an epic's health verdict.
 *
 * Every surface that paints a verdict — the dashboard's Health
 * Distribution donut, the year-Roadmap Gantt bar badges, the insights
 * Epic/Initiative scope picker, the Epic Scope Burnup / Burndown
 * corner badges, the initiative list panel, the verdict pills on
 * focused-epic popovers — must call THIS function. Anywhere else
 * computing the verdict by hand is a bug: each ad-hoc copy invariably
 * drifts (different skip rules, different start date, different
 * basis-data check) and the user ends up seeing the same epic in
 * "On Track" on one surface and "Watch" on another.
 *
 * What this function enforces (consistently across every surface):
 *   1. The epic must have BOTH planStartMonth AND planEndMonth set —
 *      otherwise no verdict (returns null).
 *   2. There must be measurable work in the chosen basis. Without
 *      this, surfaces like the dashboard donut would silently count
 *      empty epics as "On Track" (computeProgress returns a verdict
 *      even with totalEffort=0, because deltaDays defaults to
 *      negative), while every other surface — Gantt, scope picker,
 *      chart corner — has its own hasData guard and skips them.
 *      Rules:
 *        • stories basis: needs ≥ 1 story
 *        • days basis: needs ≥ 1 story (computeProgress derives
 *          totalEffort from story estimatedDays)
 *        • epicEst basis: needs either originalEstimateDays > 0 OR
 *          ≥ 1 story with estimatedDays (computeProgress falls back
 *          to the story-day sum when the epic has no estimate)
 *   3. The start passed to computeProgress is the EFFECTIVE start:
 *      observed when the team began ahead of plan (any story snapshot
 *      shows real movement before planStartMonth), planned otherwise.
 *      Keeps the verdict aligned with the chart's ideal line.
 *
 * Returns null when no meaningful verdict can be produced. Callers
 * should treat null as "skip this epic" — don't count it in
 * distributions, don't paint a badge.
 */
import { computeInitiativeProgress, computeProgress, type HealthStatus, type ProgressBasis, type ProgressResult } from "@/lib/progress";
import { effectiveEpicStart } from "@/lib/epic-observed-start";
import { sprintStartDate, sprintEndDate, globalSprintFromMonthLane } from "@/lib/year-sprint";
import type { EpicItem, InitiativeItem } from "@/lib/types";

export function computeEpicHealthVerdict(
  epic: EpicItem,
  planYear: number,
  basis: ProgressBasis,
): { status: HealthStatus; result: ProgressResult; start: Date; end: Date } | null {
  // (1) Must have both planned dates.
  if (epic.planStartMonth == null || epic.planEndMonth == null) return null;
  const stories = epic.userStories ?? [];
  // (2a) stories / days bases both need at least one story.
  if (basis !== "epicEst" && stories.length === 0) return null;
  const epicYear = epic.planYear ?? planYear;
  const plannedStart = sprintStartDate(
    epicYear,
    globalSprintFromMonthLane(epic.planStartMonth, epic.planSprint === 2 ? 2 : 1),
  );
  // (3) Effective start — observed-or-planned.
  const start = effectiveEpicStart(epic, plannedStart);
  const end = sprintEndDate(
    epicYear,
    globalSprintFromMonthLane(epic.planEndMonth, epic.planEndSprint === 1 ? 1 : 2),
  );
  const result = computeProgress({
    stories,
    start,
    end,
    basis,
    epicOriginalEstimateDays: epic.originalEstimateDays ?? null,
  });
  // (2b) Final data-validity guard, applied AFTER computeProgress so
  // we use the exact `totalEffort` math each surface used to gate on.
  // For stories basis the story count guarded us above; here we cover
  // days / epicEst where the verdict math could otherwise produce a
  // degenerate "On Track" (deltaDays = -daysRemaining < 1) for epics
  // with no measurable work.
  const hasData = basis === "stories" ? stories.length > 0 : result.totalEffort > 0;
  if (!hasData) return null;
  return { status: result.status, result, start, end };
}

/**
 * Single source of truth for an initiative's health verdict — the
 * sibling of {@link computeEpicHealthVerdict} for the next level up
 * the tree.
 *
 * Aggregation rule (matches every surface that paints an initiative
 * pill today: year-Roadmap Gantt bars, dashboard donut, Burnup /
 * Burndown corner badges, Insights scope picker, initiative list
 * panel):
 *   1. Flatten every child epic's stories into one pool and run the
 *      effort-weighted burndown — that gives a `flat.status`.
 *   2. Override `flat.status` with the WORST of itself and every
 *      child epic's verdict (`done`/`onTrack` < `watch` < `atRisk` <
 *      `overdue`). One at-risk epic is enough to make the whole
 *      initiative at risk — same rule the planner sees on the Gantt.
 *
 * Returns null when no meaningful verdict can be produced:
 *   - The initiative has zero child epics.
 *   - `stories` / `days` bases need at least one story; `epicEst`
 *     basis can produce a verdict from epic-level estimates alone, so
 *     we don't bail there even when there are zero stories.
 *
 * Callers should treat null as "skip — paint a dash."
 */
export function computeInitiativeHealthVerdict(
  init: InitiativeItem,
  planYear: number,
  basis: ProgressBasis,
): { status: HealthStatus; result: ProgressResult } | null {
  const epics = init.epics ?? [];
  if (epics.length === 0) return null;
  const aggregateStories = epics.flatMap((e) => e.userStories ?? []);
  // Same rule as `ganttSearchInitiativeHealth`: stories / days bases
  // need real stories; epicEst can stand on epic-level estimates.
  if (basis !== "epicEst" && aggregateStories.length === 0) return null;
  const childStatuses: HealthStatus[] = [];
  for (const epic of epics) {
    const v = computeEpicHealthVerdict(epic, planYear, basis);
    if (v != null) childStatuses.push(v.status);
  }
  // Union bounds across scheduled child epics; fall back to the full
  // planning year when no child has dates (rare — newly-created
  // initiative with empty epics).
  const scheduled = epics.filter((e) => e.planStartMonth != null && e.planEndMonth != null);
  const startMonth = scheduled.length > 0
    ? Math.min(...scheduled.map((e) => e.planStartMonth as number))
    : 1;
  const endMonth = scheduled.length > 0
    ? Math.max(...scheduled.map((e) => e.planEndMonth as number))
    : 12;
  const initStart = sprintStartDate(planYear, globalSprintFromMonthLane(startMonth, 1));
  const initEnd = sprintEndDate(planYear, globalSprintFromMonthLane(endMonth, 2));
  const initiativeOriginalEstSum = epics.reduce(
    (sum, e) => sum + (e.originalEstimateDays ?? 0),
    0,
  );
  const result = computeInitiativeProgress({
    stories: aggregateStories,
    childStatuses,
    start: initStart,
    end: initEnd,
    basis,
    epicOriginalEstimateDays: initiativeOriginalEstSum > 0 ? initiativeOriginalEstSum : null,
  });
  // Final data-validity guard (mirrors `computeEpicHealthVerdict`):
  // without measurable effort, the verdict math would collapse to a
  // degenerate "On Track" — return null instead.
  const hasData = basis === "stories"
    ? aggregateStories.length > 0
    : result.totalEffort > 0;
  if (!hasData) return null;
  return { status: result.status, result };
}
