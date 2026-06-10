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
 *   - the sprint window resolves to zero calendar days (shouldn't
 *     happen but guards a div-by-zero in the burndown math);
 *   - the sprint is still OPEN and the story has no estimate (no ideal
 *     burndown to compare against — verdict would degenerate to "On Track"
 *     which is misleading). When the sprint is CLOSED and the story
 *     isn't done, this fall-through lets `sprintStoryVerdict` mark it
 *     `overdue` regardless of estimate.
 *
 * Promoted from the backlog panel's inline `computeStoryHealthForBacklog`
 * so the Hero's Work Progress / Health Distribution donuts at Story
 * scope can use it without pulling the entire ~12k-line backlog panel
 * into their build graph.
 */
import { resolveStoryYearSprint, monthLaneFromGlobalSprint, sprintStartDate, sprintEndDate } from "@/lib/year-sprint";
import { sprintCalendarDaysRemaining, sprintDayDates } from "@/lib/sprint-analytics";
import { sprintStoryVerdict, type SprintLoadStoryProjection } from "@/components/timeline/sprint-analytics";
import type { EpicItem, UserStoryItem } from "@/lib/types";
import type { HealthStatus } from "@/lib/progress";

const STATUS_LABELS: Record<HealthStatus, string> = {
  done: "Done",
  onTrack: "On Track",
  watch: "Watch",
  atRisk: "At Risk",
  overdue: "Overdue",
};

const fmtDate = (d: Date): string => {
  const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MONTH_ABBREV[d.getMonth()]} ${d.getDate()}`;
};

/**
 * Multi-line tooltip explaining WHY a story landed on a particular
 * verdict. Mirrors the math in {@link computeStoryHealthVerdict} and
 * the rule set in `sprintStoryVerdict` — lines stitched together with
 * `\n` so the native `title` tooltip renders them stacked.
 *
 * Format:
 *
 *    <Verdict>
 *    Sprint: <Mon DD> – <Mon DD>  (Xd left of Yd total)
 *    Story: Zd remaining · status=<status>
 *    <one-line reason>
 *
 * Returns null when the story has no resolvable sprint window — there's
 * nothing meaningful to explain there. Callers should skip the tooltip
 * (or fall back to the bare status label).
 */
export function formatStoryHealthTooltip(
  story: UserStoryItem,
  parentEpic: EpicItem,
  planYear: number,
  verdict: HealthStatus,
): string | null {
  const contextMonth = parentEpic.planStartMonth ?? 1;
  const globalSprint = resolveStoryYearSprint(story, contextMonth);
  if (globalSprint == null) return null;
  const { month } = monthLaneFromGlobalSprint(globalSprint);
  const total = sprintDayDates(planYear, month, globalSprint).length;
  if (total <= 0) return null;
  const sprintLeft = sprintCalendarDaysRemaining(planYear, month, globalSprint);
  const storyLeft = Math.max(0, story.daysLeft ?? story.estimatedDays ?? 0);
  const sprintStart = sprintStartDate(planYear, globalSprint);
  const sprintEnd = sprintEndDate(planYear, globalSprint);
  const lines: string[] = [
    STATUS_LABELS[verdict],
    `Sprint ${globalSprint}: ${fmtDate(sprintStart)} – ${fmtDate(sprintEnd)} (${sprintLeft}d left of ${total}d total)`,
    `Story: ${storyLeft}d remaining · status=${story.status}`,
  ];
  let reason: string;
  if (story.status === "done") {
    reason = "Status is Done — verdict pinned regardless of time math.";
  } else if (sprintLeft <= 0) {
    reason = `Sprint window has passed and the story isn't Done — overdue.`;
  } else if (storyLeft > sprintLeft) {
    reason = `Needs ${storyLeft}d but only ${sprintLeft}d left — short by ${storyLeft - sprintLeft}d.`;
  } else if (storyLeft === sprintLeft) {
    reason = `Needs exactly ${sprintLeft}d and the sprint has ${sprintLeft}d — no slack.`;
  } else {
    reason = `Needs ${storyLeft}d and sprint has ${sprintLeft}d left — ${sprintLeft - storyLeft}d of slack.`;
  }
  lines.push(reason);
  return lines.join("\n");
}

/**
 * Same shape as {@link formatStoryHealthTooltip} but generic over any
 * "bundle that has total days-left vs a time-box's days-left" — used
 * for user/team row verdicts where we don't have a single story to
 * trace. Pass the bundle's totals and the time-box bounds.
 */
export function formatBundleHealthTooltip(args: {
  verdict: HealthStatus;
  bundleLabel: string;
  bundleDaysLeft: number;
  windowLabel: string;
  windowDaysLeft: number;
  windowDaysTotal: number;
  windowStart?: Date;
  windowEnd?: Date;
}): string {
  const { verdict, bundleLabel, bundleDaysLeft, windowLabel, windowDaysLeft, windowDaysTotal, windowStart, windowEnd } = args;
  const lines: string[] = [STATUS_LABELS[verdict]];
  if (windowStart && windowEnd) {
    lines.push(`${windowLabel}: ${fmtDate(windowStart)} – ${fmtDate(windowEnd)} (${windowDaysLeft}d left of ${windowDaysTotal}d total)`);
  } else {
    lines.push(`${windowLabel}: ${windowDaysLeft}d left of ${windowDaysTotal}d total`);
  }
  lines.push(`${bundleLabel}: ${bundleDaysLeft}d remaining`);
  let reason: string;
  if (verdict === "done") {
    reason = "All assigned work is finished.";
  } else if (windowDaysLeft <= 0) {
    reason = `${windowLabel} ended with ${bundleDaysLeft}d still remaining — overdue.`;
  } else if (bundleDaysLeft > windowDaysLeft) {
    reason = `Needs ${bundleDaysLeft}d but ${windowLabel} only has ${windowDaysLeft}d left — short by ${bundleDaysLeft - windowDaysLeft}d.`;
  } else if (bundleDaysLeft === windowDaysLeft) {
    reason = `Needs exactly ${windowDaysLeft}d and ${windowLabel} has ${windowDaysLeft}d — no slack.`;
  } else {
    reason = `Needs ${bundleDaysLeft}d and ${windowLabel} has ${windowDaysLeft}d left — ${windowDaysLeft - bundleDaysLeft}d of slack.`;
  }
  lines.push(reason);
  return lines.join("\n");
}

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
  const { month } = monthLaneFromGlobalSprint(globalSprint);
  const total = sprintDayDates(planYear, month, globalSprint).length;
  if (total <= 0) return null;
  const left = sprintCalendarDaysRemaining(planYear, month, globalSprint);
  // Sprint-closed semantics: any non-done story in a closed sprint is
  // overdue regardless of estimate. Skip the "no estimate → null" bail
  // below in that case so `sprintStoryVerdict` can stamp it overdue.
  // Stories actually in the `done` status are handled by
  // `sprintStoryVerdict` directly (it returns `done` first thing).
  const isClosed = left <= 0;
  if (!isClosed) {
    const est = Math.max(0, story.estimatedDays ?? story.daysLeft ?? 0);
    if (est <= 0) return null;
  }
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
