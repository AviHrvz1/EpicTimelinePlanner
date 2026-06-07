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
import { computeProgress, type HealthStatus, type ProgressBasis, type ProgressResult } from "@/lib/progress";
import { effectiveEpicStart } from "@/lib/epic-observed-start";
import { sprintStartDate, sprintEndDate, globalSprintFromMonthLane } from "@/lib/year-sprint";
import type { EpicItem } from "@/lib/types";

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
