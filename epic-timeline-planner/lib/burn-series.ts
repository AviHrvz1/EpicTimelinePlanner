/**
 * Per-day burn-up / burn-down series builder, anchored to `lib/progress.ts`.
 *
 * Why this exists
 * ----------------
 * Before this module, `components/timeline/month-analytics.tsx` carried two
 * parallel chart-data pipelines (an 8-step `useMemo` chain for burndown and
 * one ~470-line `useMemo` for burnup). Each one reinvented the per-basis
 * scope / completed / days-left math inline rather than calling the canonical
 * formula in `lib/progress.ts`. That reinvention introduced a "basis leak":
 * Epic Est scope (e.g. 81 days from `epic.originalEstimateDays`) was being
 * combined with a Σ Child Est completion *ratio* (e.g. 0.697 from
 * `storiesOpen / storiesTotal`) to yield a hybrid completed number
 * (0.697 × 81 ≈ 56.5) that did not correspond to anything else in the app.
 * Meanwhile the verdict chip on the same card was computed via
 * `lib/progress.ts` and disagreed with the chart's own line.
 *
 * This module fixes the architectural fault: both charts read a single
 * per-day series. The basis the planner picks drives `scope`, `completed`
 * and `daysLeft` consistently end-to-end via the SAME formulas
 * `computeProgress` uses for the verdict. `scope === completed + daysLeft`
 * is true by construction; the bug class is structurally impossible.
 *
 * Output shape
 * ------------
 * - `perDay`: one point per calendar day inside [periodStart, periodEnd].
 *   Both the burndown and the burnup render off the same series — burndown
 *   reads `daysLeft` + `idealDaysLeft`, burnup reads `completed` +
 *   `idealCompleted`. `perEpic` mirrors the same fields keyed by epic id so
 *   the legend's per-epic visibility filter has data to read from.
 * - `headline`: today's snapshot + the same `deltaDays` the verdict uses,
 *   plus the verdict itself (status + ProgressResult) computed by
 *   `computeProgress` / `computeInitiativeProgress` directly. The chart and
 *   the chip are now wired to the SAME function call.
 */

import type { EpicItem } from "@/lib/types";
import {
  computeInitiativeProgress,
  computeProgress,
  HEALTH_AT_RISK_DELTA,
  HEALTH_ON_TRACK_DELTA,
  type HealthStatus,
  type ProgressBasis,
  type ProgressResult,
} from "@/lib/progress";
import { now as clockNow } from "@/lib/clock";
import { computeEpicObservedStart } from "@/lib/epic-observed-start";
import { projectStoryToCloseDate } from "@/lib/story-snapshot-projection";

// Re-export the verdict thresholds so callers don't need to import them
// from a different module than the series itself.
export { HEALTH_ON_TRACK_DELTA, HEALTH_AT_RISK_DELTA };

/** One epic's contribution to a single calendar day. Actuals (`scope`,
 *  `completed`, `daysLeft`) are `null` for FUTURE days — the team hasn't
 *  hit those calendar dates yet, so projecting story state past today
 *  would be a guess. Ideal values (`idealDaysLeft`, `idealCompleted`)
 *  stay populated past today so the orange dashed plan line keeps
 *  drawing all the way to the epic's due date.
 *
 *  Recharts plays well with `null` data points: `<Line connectNulls={false}>`
 *  ends the line cleanly at the last non-null point, which is exactly the
 *  "stop the actual line at today" behavior we want. */
export type EpicDayValues = {
  scope: number | null;
  completed: number | null;
  daysLeft: number | null;
  idealDaysLeft: number | null;
  idealCompleted: number | null;
};

/** A single calendar day's row for the chart. The same point shape feeds
 *  both burndown (`daysLeft` + `idealDaysLeft`) and burnup (`completed` +
 *  `idealCompleted`); the burndown line is the burnup's mirror inside the
 *  same scope, so the two charts cannot disagree. */
export type BurnPoint = {
  /** Compact `"d/m(Day)"` string used by Recharts for X-axis tick
   *  labels — matches the format `buildQuarterBurndownSeries` already
   *  emits so the existing tick rendering keeps working. */
  dayLabel: string;
  axisLabel: string;
  monthLabel: string;
  date: Date;
  isToday: boolean;
  /** Aggregated across all in-scope epics. Actuals are `null` for FUTURE
   *  days (chart's blue line terminates at today); ideal extends past
   *  today to the plan's due date. */
  scope: number | null;
  completed: number | null;
  daysLeft: number | null;
  idealDaysLeft: number | null;
  idealCompleted: number | null;
  /** Per-epic columns keyed by `epic.id`. The legend's visibility-key
   *  filter uses these to isolate or hide individual epics without
   *  rebuilding the series. */
  perEpic: Record<string, EpicDayValues | null>;
};

export type BurnSeries = {
  perDay: BurnPoint[];
  headline: {
    scope: number;
    completed: number;
    daysLeft: number;
    /** The same linear ideal value at today's calendar day. */
    idealDaysLeft: number;
    /** `daysLeft − idealDaysLeft`. Matches `ProgressResult.deltaDays`. */
    deltaDays: number;
    /** Verdict computed by `computeProgress` / `computeInitiativeProgress` —
     *  the SAME call the rest of the app uses. */
    status: HealthStatus;
    /** Full progress result so callers can build the existing tooltip /
     *  popover surfaces (`formatHealthTooltip`, the explainer
     *  illustration, etc.) without recomputing. */
    result: ProgressResult;
  } | null;
};

export type BuildBurnSeriesArgs = {
  /** In-scope epics for this chart. Caller is responsible for the
   *  legend-visibility narrow / scope-picker focus, etc. */
  epics: EpicItem[];
  basis: ProgressBasis;
  /** First calendar day of the chart's X-axis (inclusive). */
  periodStart: Date;
  /** Last calendar day of the chart's X-axis (inclusive). */
  periodEnd: Date;
  /** Override for "today" — defaults to `clockNow()`. */
  now?: Date;
};

// ----------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function startOfLocalDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function endOfLocalDayMs(d: Date): number {
  return new Date(
    d.getFullYear(), d.getMonth(), d.getDate(),
    23, 59, 59, 999,
  ).getTime();
}

/** Math.round (not Math.floor) so a DST hour shift can't truncate a day.
 *  The current month-analytics.tsx has the exact same comment around the
 *  burnup's `msToDays` helper (line 3675) — copy the fix forward. */
function msToDays(ms: number): number {
  return Math.round(ms / MS_PER_DAY);
}

function dayLabelFor(date: Date): string {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const weekday = WEEKDAY_SHORT[date.getDay()];
  return `${day}/${month}(${weekday})`;
}

function monthShortFor(date: Date): string {
  return MONTH_SHORT[date.getMonth()] ?? `M${date.getMonth() + 1}`;
}

/** Compute the calendar Date for the start (or end) of an epic's plan
 *  window. Uses `planStartMonth + planSprint` (sprint 1 = day 1, sprint 2
 *  = day 16) when the explicit `planStartDay` field isn't set — matches
 *  the convention `buildQuarterBurndownSeries` already uses. */
function epicPlanStartDate(epic: EpicItem, fallbackYear: number): Date | null {
  if (epic.planStartMonth == null) return null;
  const year = epic.planYear ?? fallbackYear;
  const month = epic.planStartMonth;
  const day = epic.planStartDay ?? (epic.planSprint === 2 ? 16 : 1);
  return new Date(year, month - 1, day);
}

function epicPlanEndDate(epic: EpicItem, fallbackYear: number): Date | null {
  if (epic.planEndMonth == null) return null;
  const year = epic.planYear ?? fallbackYear;
  const month = epic.planEndMonth;
  // Last day of the month when sprint 2 ends (default), 15th when
  // sprint 1 ends.
  const explicit = epic.planEndDay;
  const day = explicit != null
    ? explicit
    : epic.planEndSprint === 1
      ? 15
      : new Date(year, month, 0).getDate();
  return new Date(year, month - 1, day);
}

/** Read scope + remainingEffort from `computeProgress` for a single
 *  epic + projected-stories list under the chosen basis. This is THE
 *  point of single-source-of-truth: the chart line and the verdict both
 *  funnel through here. */
function basisValuesForEpic(
  epic: EpicItem,
  projectedStories: EpicItem["userStories"],
  basis: ProgressBasis,
  planStart: Date,
  planEnd: Date,
  now: Date,
): { scope: number; completed: number; daysLeft: number } {
  const r = computeProgress({
    stories: projectedStories.map((s) => ({
      estimatedDays: s.estimatedDays,
      daysLeft: s.daysLeft,
      status: s.status,
    })),
    start: planStart,
    end: planEnd,
    now,
    basis,
    epicOriginalEstimateDays: epic.originalEstimateDays ?? null,
  });
  // `r.totalEffort` is the basis-scoped scope:
  //   - basis="days"     → Σ story.estimatedDays
  //   - basis="stories"  → not used (we override below)
  //   - basis="epicEst"  → epic.originalEstimateDays
  // `r.remainingEffort` is the basis-scoped days-left (computed inside
  // `computeProgress` via the SAME `epicEst − storyDaysBurned` formula
  // that fixes the basis-leak bug).
  if (basis === "stories") {
    const total = projectedStories.length;
    const done = projectedStories.filter((s) => s.status === "done").length;
    return { scope: total, completed: done, daysLeft: total - done };
  }
  const scope = r.totalEffort;
  const daysLeft = Math.max(0, Math.min(scope, r.remainingEffort));
  const completed = Math.max(0, scope - daysLeft);
  return { scope, completed, daysLeft };
}

/** Linear burndown ideal — the same ramp `buildQuarterBurndownSeries`'s
 *  `idealFor` helper draws. Returns null outside the plan window so
 *  Recharts can skip those points with `connectNulls={false}`. */
function idealDaysLeftFor(
  dayIdx: number,
  scope: number,
  startIdx: number,
  endIdx: number,
): number | null {
  if (scope <= 0) return null;
  if (dayIdx < startIdx || dayIdx > endIdx) return null;
  const span = Math.max(1, endIdx - startIdx);
  return scope * (1 - (dayIdx - startIdx) / span);
}

// ----------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------

export function buildBurnSeries(args: BuildBurnSeriesArgs): BurnSeries {
  const now = args.now ?? clockNow();
  const todayMs = startOfLocalDayMs(now);
  const periodStartMs = startOfLocalDayMs(args.periodStart);
  const periodEndMs = startOfLocalDayMs(args.periodEnd);
  const totalDays = Math.max(1, msToDays(periodEndMs - periodStartMs) + 1);

  // Pre-compute each epic's plan window + observed start in horizon
  // day-coordinates (1-indexed, matching `buildQuarterBurndownSeries`).
  // Observed-start wins when it's earlier than planned (mirrors today's
  // burndown / burnup behavior — see `computeEpicObservedStart` header).
  const epicMeta = args.epics.map((epic) => {
    const fallbackYear = epic.planYear
      ?? args.periodStart.getFullYear();
    const plannedStart = epicPlanStartDate(epic, fallbackYear)
      ?? args.periodStart;
    const plannedEnd = epicPlanEndDate(epic, fallbackYear)
      ?? args.periodEnd;
    const observed = computeEpicObservedStart(epic);
    const effectiveStart = observed != null && observed < plannedStart
      ? observed
      : plannedStart;
    // Horizon day indices, 1-based.
    const planStartDayIdx = msToDays(
      startOfLocalDayMs(effectiveStart) - periodStartMs,
    ) + 1;
    const planEndDayIdx = msToDays(
      startOfLocalDayMs(plannedEnd) - periodStartMs,
    ) + 1;
    // Fully overdue → plan ended before the period started. Same rule as
    // today's code: skip from the aggregate ideal so a slipped epic
    // doesn't pin the line at full scope across the whole period
    // ("should already be 100% done" — misleading; the true signal is
    // "no plan exists in this period, reschedule").
    const isFullyOverdue = planEndDayIdx < 1;
    return {
      epic,
      plannedStart,
      plannedEnd,
      effectiveStart,
      planStartDayIdx,
      planEndDayIdx,
      isFullyOverdue,
    };
  });

  // For each day, project every story to end-of-day and apply the basis
  // formula via `computeProgress`. Same formula end-to-end → no leak.
  const perDay: BurnPoint[] = [];
  for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
    const date = new Date(
      args.periodStart.getFullYear(),
      args.periodStart.getMonth(),
      args.periodStart.getDate() + dayOffset,
    );
    const dayStartMs = startOfLocalDayMs(date);
    const dayEndMs = endOfLocalDayMs(date);
    const dayIdx = dayOffset + 1;
    const isToday = dayStartMs === todayMs;
    const isFuture = dayStartMs > todayMs;

    let aggScope = 0;
    let aggCompleted = 0;
    let aggDaysLeft = 0;
    let aggIdealDaysLeft = 0;
    let aggIdealCompleted = 0;
    let anyEpicHasData = false;
    let anyEpicHasIdeal = false;
    const perEpic: Record<string, EpicDayValues | null> = {};

    for (const meta of epicMeta) {
      const { epic } = meta;

      // Actuals — only meaningful for past/today days. Projecting story
      // state past today would be a guess, so future days carry null
      // actuals (Recharts ends the line at the last non-null point).
      let epicScope: number | null = null;
      let epicCompleted: number | null = null;
      let epicDaysLeft: number | null = null;
      if (!isFuture) {
        const projectedStories = (epic.userStories ?? []).map((s) =>
          projectStoryToCloseDate(s, dayEndMs),
        );
        const v = basisValuesForEpic(
          epic,
          projectedStories,
          args.basis,
          meta.effectiveStart,
          meta.plannedEnd,
          new Date(dayEndMs),
        );
        epicScope = v.scope;
        epicCompleted = v.completed;
        epicDaysLeft = v.daysLeft;
        aggScope += epicScope;
        aggCompleted += epicCompleted;
        aggDaysLeft += epicDaysLeft;
        if (epicScope > 0) anyEpicHasData = true;
      }

      // Ideal — computed for EVERY day inside the plan window (past +
      // today + future). The plan line is what the planner agreed to
      // at scope-set time and should extend all the way to the epic's
      // due date so the planner can read the trajectory and the gap to
      // the actual line at any point.
      //   - Past/today: anchor to the day's measured scope.
      //   - Future:     anchor to `originalEstimateDays` (or the story-
      //                 day fallback so the ideal still draws when no
      //                 explicit epic-est is set).
      let epicIdealDaysLeft: number | null = null;
      let epicIdealCompleted: number | null = null;
      if (!meta.isFullyOverdue) {
        const baselineScope = epicScope != null && epicScope > 0
          ? epicScope
          : (epic.originalEstimateDays ?? (epic.userStories ?? []).reduce(
              (s, st) => s + (st.estimatedDays ?? 0),
              0,
            ));
        epicIdealDaysLeft = idealDaysLeftFor(
          dayIdx,
          baselineScope,
          meta.planStartDayIdx,
          meta.planEndDayIdx,
        );
        if (epicIdealDaysLeft != null) {
          epicIdealCompleted = Math.max(0, baselineScope - epicIdealDaysLeft);
          aggIdealDaysLeft += epicIdealDaysLeft;
          aggIdealCompleted += epicIdealCompleted;
          anyEpicHasIdeal = true;
        }
      }

      perEpic[epic.id] = {
        scope: epicScope,
        completed: epicCompleted,
        daysLeft: epicDaysLeft,
        idealDaysLeft: epicIdealDaysLeft,
        idealCompleted: epicIdealCompleted,
      };
    }

    perDay.push({
      dayLabel: dayLabelFor(date),
      axisLabel: dayLabelFor(date),
      monthLabel: monthShortFor(date),
      date,
      isToday,
      scope: isFuture ? null : (anyEpicHasData ? aggScope : 0),
      completed: isFuture ? null : aggCompleted,
      daysLeft: isFuture ? null : aggDaysLeft,
      idealDaysLeft: anyEpicHasIdeal ? aggIdealDaysLeft : null,
      idealCompleted: anyEpicHasIdeal ? aggIdealCompleted : null,
      perEpic,
    });
  }

  // Headline: read today's row (or the period's last row when "today" is
  // past the period end) and compute the verdict via `computeProgress` /
  // `computeInitiativeProgress` so the chip and the chart are wired to
  // the SAME call.
  let headline: BurnSeries["headline"] = null;
  const visibleEpics = epicMeta.filter((m) => !m.isFullyOverdue);
  if (visibleEpics.length > 0) {
    // Pick the row to read: today's row inside the period, last row when
    // today is past the period end, first row when today is before.
    const todayDayIdx = Math.max(
      1,
      Math.min(totalDays, msToDays(todayMs - periodStartMs) + 1),
    );
    const headlineRow = perDay[todayDayIdx - 1];
    const aggStart = visibleEpics.reduce(
      (min, m) => m.effectiveStart < min ? m.effectiveStart : min,
      visibleEpics[0].effectiveStart,
    );
    const aggEnd = visibleEpics.reduce(
      (max, m) => m.plannedEnd > max ? m.plannedEnd : max,
      visibleEpics[0].plannedEnd,
    );
    const allStories = visibleEpics.flatMap((m) => m.epic.userStories ?? []);
    // Single-epic case: forward to computeProgress directly. Initiative
    // case: rollup with worst-child verdict (matches today's burndownHealth
    // / burnupHealth code path).
    // Today is, by construction, never a "future" day for the headline —
    // `todayDayIdx` clamps to the period, so the headline row's actuals
    // are always non-null numbers. Use `?? 0` as a TypeScript-narrow
    // fallback that's never actually hit at runtime.
    const headlineScope = headlineRow.scope ?? 0;
    const headlineCompleted = headlineRow.completed ?? 0;
    const headlineDaysLeft = headlineRow.daysLeft ?? 0;
    if (visibleEpics.length === 1) {
      const m = visibleEpics[0];
      const result = computeProgress({
        stories: m.epic.userStories ?? [],
        start: m.effectiveStart,
        end: m.plannedEnd,
        now,
        basis: args.basis,
        epicOriginalEstimateDays: m.epic.originalEstimateDays ?? null,
      });
      // Use the verdict's `deltaDays` directly (working-days based) and
      // derive `idealDaysLeft` from it so the headline trio is self-
      // consistent: `idealDaysLeft + deltaDays === daysLeft`. The chart
      // line's per-day `idealDaysLeft` is calendar-day based (matches
      // `buildQuarterBurndownSeries`); using THAT here would let the
      // headline disagree with the verdict chip, which is the exact
      // class of bug this module exists to prevent.
      headline = {
        scope: headlineScope,
        completed: headlineCompleted,
        daysLeft: headlineDaysLeft,
        idealDaysLeft: headlineDaysLeft - result.deltaDays,
        deltaDays: result.deltaDays,
        status: result.status,
        result,
      };
    } else {
      const childStatuses: HealthStatus[] = visibleEpics.map((m) => {
        const r = computeProgress({
          stories: m.epic.userStories ?? [],
          start: m.effectiveStart,
          end: m.plannedEnd,
          now,
          basis: args.basis,
          epicOriginalEstimateDays: m.epic.originalEstimateDays ?? null,
        });
        return r.status;
      });
      const epicOriginalEstSum = visibleEpics.reduce(
        (s, m) => s + (m.epic.originalEstimateDays ?? 0),
        0,
      );
      const result = computeInitiativeProgress({
        stories: allStories,
        childStatuses,
        start: aggStart,
        end: aggEnd,
        now,
        basis: args.basis,
        epicOriginalEstimateDays: epicOriginalEstSum > 0
          ? epicOriginalEstSum
          : null,
      });
      headline = {
        scope: headlineScope,
        completed: headlineCompleted,
        daysLeft: headlineDaysLeft,
        idealDaysLeft: headlineDaysLeft - result.deltaDays,
        deltaDays: result.deltaDays,
        status: result.status,
        result,
      };
    }
  }

  return { perDay, headline };
}
