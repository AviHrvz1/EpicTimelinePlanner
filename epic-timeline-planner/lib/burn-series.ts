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

import type { EpicItem, StoryDailySnapshotItem, UserStoryItem } from "@/lib/types";
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

/** Sweep-line projection state for one story. `sortedMs` and `sortedSnaps`
 *  are parallel arrays of pre-parsed snapshot timestamps + their snapshot
 *  payloads, both sorted ascending by date. `pointer` is the index of the
 *  LATEST snapshot whose timestamp is ≤ the cursor day (or `-1` when no
 *  snapshot has been crossed yet). Because the per-day loop walks
 *  calendar days forward in time, the pointer only ever advances — never
 *  rewinds — so each story's projection is amortized O(1) per day. */
type StoryProjector = {
  story: UserStoryItem;
  sortedMs: number[];
  sortedSnaps: StoryDailySnapshotItem[];
  pointer: number;
};

/** Advance the projector's pointer to the latest snapshot ≤ `dayEndMs` and
 *  return the projected story view. Mirrors `projectStoryToCloseDate` from
 *  `lib/story-snapshot-projection.ts` field-for-field; the only difference
 *  is that the linear `O(snapshots)` scan is replaced with the amortized
 *  `O(1)` pointer walk. Callers MUST invoke this with monotonically
 *  non-decreasing `dayEndMs` values within a single `buildBurnSeries`
 *  call — going backwards would silently return a too-late snapshot. */
function advanceProjector(sp: StoryProjector, dayEndMs: number): UserStoryItem {
  while (sp.pointer + 1 < sp.sortedMs.length && sp.sortedMs[sp.pointer + 1] <= dayEndMs) {
    sp.pointer++;
  }
  if (sp.pointer < 0) return sp.story;
  const best = sp.sortedSnaps[sp.pointer];
  return {
    ...sp.story,
    status: best.status,
    daysLeft: best.daysLeft,
    estimatedDays: best.estimatedDays ?? sp.story.estimatedDays,
    sprint: best.sprint ?? sp.story.sprint,
    title: best.title ?? sp.story.title,
    description: best.description ?? sp.story.description,
    priority: best.priority ?? sp.story.priority,
    labels: best.labels ?? sp.story.labels,
  };
}

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
  // Stories basis short-circuit — return values come straight from
  // `projectedStories.length` and the `"done"` count, no story-day or
  // epic-estimate math involved. Doing this BEFORE the `computeProgress`
  // call (rather than after) saves one call + one full `projectedStories`
  // sweep per epic per day, which adds up to ~18k unnecessary calls in
  // the aggregate year view.
  if (basis === "stories") {
    const total = projectedStories.length;
    const done = projectedStories.filter((s) => s.status === "done").length;
    return { scope: total, completed: done, daysLeft: total - done };
  }
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
  //   - basis="epicEst"  → epic.originalEstimateDays
  // `r.remainingEffort` is the basis-scoped days-left (computed inside
  // `computeProgress` via the SAME `epicEst − storyDaysBurned` formula
  // that fixes the basis-leak bug).
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
    // Sweep-line projection state — one entry per story. Snapshot
    // timestamps are parsed once here instead of `O(days × snapshots)`
    // times inside the per-day loop, and the `pointer` advances
    // monotonically as the per-day loop walks calendar days forward.
    // Replaces the `projectStoryToCloseDate` call that previously ran
    // for every (day × story) pair — the dominant cost in the aggregate
    // view (51 epics × ~10 stories × ~5 snapshots × 365 days ≈ 930k
    // redundant Date parses per chart).
    const storyProjectors: StoryProjector[] = (epic.userStories ?? []).map((story) => {
      const snaps = story.snapshots ?? [];
      if (snaps.length === 0) {
        return { story, sortedMs: [], sortedSnaps: [], pointer: -1 };
      }
      // Defensive sort — the Prisma loader already orders snapshots by
      // `snapshotDate` ascending, but if a caller hands us un-ordered
      // data the sweep depends on ascending order, so spend the O(n log n)
      // here once rather than be wrong forever.
      const indexed = snaps
        .map((snap) => ({ ms: new Date(snap.snapshotDate).getTime(), snap }))
        .sort((a, b) => a.ms - b.ms);
      return {
        story,
        sortedMs: indexed.map((x) => x.ms),
        sortedSnaps: indexed.map((x) => x.snap),
        pointer: -1,
      };
    });
    return {
      epic,
      plannedStart,
      plannedEnd,
      effectiveStart,
      planStartDayIdx,
      planEndDayIdx,
      isFullyOverdue,
      storyProjectors,
    };
  });

  // Pre-compute the AGGREGATE ideal-line endpoints — one straight ramp
  // across the whole portfolio rather than a sum of per-epic ramps. The
  // sum-of-ramps version (which we used before) produced a bendy
  // piecewise composite that reads as "many plans, can't tell what's
  // ideal." The straight ramp from `Σ scope` at the earliest plan start
  // down to 0 at the latest plan end gives the planner one clean
  // reference line they can compare the blue actual against. Per-epic
  // ideals (stored on `perEpic[id].idealDaysLeft`) are still computed
  // below — those are used by the focused-epic view where the chart
  // shows a single epic's plan.
  const inScopeMetas = epicMeta.filter((m) => !m.isFullyOverdue);
  let aggregateBaselineScope = 0;
  let aggregateStartDayIdx = Number.POSITIVE_INFINITY;
  let aggregateEndDayIdx = Number.NEGATIVE_INFINITY;
  for (const m of inScopeMetas) {
    const stories = m.epic.userStories ?? [];
    let perEpicBaseline = 0;
    if (args.basis === "stories") {
      perEpicBaseline = stories.length;
    } else if (args.basis === "epicEst") {
      perEpicBaseline = m.epic.originalEstimateDays
        ?? stories.reduce((s, st) => s + (st.estimatedDays ?? 0), 0);
    } else {
      // "days" basis — Σ Child Est.
      perEpicBaseline = stories.reduce((s, st) => s + (st.estimatedDays ?? 0), 0);
    }
    aggregateBaselineScope += perEpicBaseline;
    if (m.planStartDayIdx < aggregateStartDayIdx) aggregateStartDayIdx = m.planStartDayIdx;
    if (m.planEndDayIdx > aggregateEndDayIdx) aggregateEndDayIdx = m.planEndDayIdx;
  }
  const hasAggregateIdeal = inScopeMetas.length > 0
    && aggregateBaselineScope > 0
    && Number.isFinite(aggregateStartDayIdx)
    && Number.isFinite(aggregateEndDayIdx);

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
    let anyEpicHasData = false;
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
        // Snapshots are for HISTORICAL reconstruction — they answer
        // "what was true on date X". "Today" is the present, and the
        // live `userStories` array is the authoritative present-day
        // state. Projecting today through stale snapshots can overwrite
        // a live `"done"` with the last snapshot's `"review"` /
        // `"inProgress"` when no snapshot ever captured the final
        // transition — the chart line then disagreed with the Status
        // pie + verdict chip (which both already read live). At today,
        // bypass projection so the chart matches the pie and the
        // verdict.
        const projectedStories = isToday
          ? (epic.userStories ?? [])
          : meta.storyProjectors.map((sp) => advanceProjector(sp, dayEndMs));
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

      // Per-epic ideal — kept for the focused-epic view (`perEpic[id]
      // .idealDaysLeft` is the data source for that chart line). The
      // aggregate ideal is now computed separately, OUTSIDE this loop,
      // as one straight ramp (see `hasAggregateIdeal` block below).
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

    // Aggregate ideal — single straight ramp from `aggregateBaselineScope`
    // at `aggregateStartDayIdx` to 0 at `aggregateEndDayIdx`. Null when
    // there's no scope or the day is outside the [start, end] window.
    let aggIdealDaysLeft: number | null = null;
    let aggIdealCompleted: number | null = null;
    if (hasAggregateIdeal) {
      const v = idealDaysLeftFor(
        dayIdx,
        aggregateBaselineScope,
        aggregateStartDayIdx,
        aggregateEndDayIdx,
      );
      if (v != null) {
        aggIdealDaysLeft = v;
        aggIdealCompleted = Math.max(0, aggregateBaselineScope - v);
      }
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
      idealDaysLeft: aggIdealDaysLeft,
      idealCompleted: aggIdealCompleted,
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
