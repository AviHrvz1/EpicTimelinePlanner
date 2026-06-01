/**
 * Effort-weighted progress + health computation for epic and initiative bars.
 *
 * Rationale: the previous "stories done / total stories" formula treated every
 * story as equal, which makes the year-roadmap bars lie when story sizes vary.
 * This module computes progress as "estimated effort burned down" and pairs it
 * with an at-risk verdict by comparing remaining effort against working days
 * left before the deadline.
 *
 * The API layer (see app/api/stories/[id]/route.ts) maintains three invariants
 * on (estimatedDays, daysLeft, status) so this module can trust the inputs
 * without fallbacks:
 *   - done/approved stories always have daysLeft = 0
 *   - daysLeft is initialized to estimatedDays when a story is sized
 *   - daysLeft <= estimatedDays always
 */
import { now as clockNow } from "@/lib/clock";

export type HealthStatus = "done" | "onTrack" | "watch" | "atRisk" | "overdue";

/** Which formula drives the rendered progress %.
 *
 *  - `days` (default) — sum of Est. Days across child stories ("Σ Child
 *    Stories" in the UI). Burn-down comes from each story's daysLeft.
 *    Most accurate once user stories are defined.
 *  - `stories` — headcount of done stories / total stories. Treats every
 *    story as equal weight, ignores days entirely.
 *  - `epicEst` — uses the epic's own `originalEstimateDays` ("Σ Epic Est."
 *    in the UI). Burn-down is time-based (working days elapsed since
 *    `start`). Useful for early-stage epics that don't have user stories
 *    yet — R&D can put a guess on the epic and still get a health verdict
 *    against the chosen Gantt window.
 *
 *  The at-risk verdict is always derived from the chosen totalEffort vs.
 *  working-days remaining — only the totalEffort source differs between
 *  modes. */
export type ProgressBasis = "days" | "stories" | "epicEst";

export interface ProgressStoryInput {
  estimatedDays: number | null;
  daysLeft: number | null;
  status: string;
}

export interface ProgressInputs {
  stories: ProgressStoryInput[];
  /** First calendar date the bar covers (inclusive). */
  start: Date;
  /** Last calendar date the bar covers (inclusive). */
  end: Date;
  /** Override "today" — defaults to new Date(). */
  now?: Date;
  /** Which formula to use for `progressPercent`. Default = "days". */
  basis?: ProgressBasis;
  /** Required when `basis === "epicEst"`. Sourced from `epic.originalEstimateDays`
   *  (or, for initiative rollups, the sum across child epics). When omitted in
   *  `epicEst` mode the math falls back to treating the epic as unestimated. */
  epicOriginalEstimateDays?: number | null;
}

export interface ProgressResult {
  /** Effort-weighted progress 0–100. 0 when no stories have estimatedDays. */
  progressPercent: number;
  /** Sum of daysLeft across not-yet-done estimated stories. */
  remainingEffort: number;
  /** Sum of estimatedDays across all estimated stories. */
  totalEffort: number;
  /** Working days (Mon–Fri) from today (inclusive) to `end` (inclusive). 0 past deadline. */
  daysRemaining: number;
  /** `remainingEffort − idealRemaining` where ideal is the linear burn-down
   *  line at "now". Positive = above the line (behind), negative = below
   *  the line (ahead / buffer). Drives the on-track / watch / at-risk
   *  thresholds. */
  deltaDays: number;
  /** Stories without estimatedDays — excluded from the math, surfaced for tooltips. */
  unestimatedCount: number;
  /** Health verdict — see HEALTH_THRESHOLDS for the cutoffs. */
  status: HealthStatus;
}

/** On-track grace zone — 1-day jitter is forgiven. */
export const HEALTH_ON_TRACK_DELTA = 1;
/** Above this delta the bar is "atRisk" (red). Between this and on-track is "watch" (amber). */
export const HEALTH_AT_RISK_DELTA = 4;

const DONE_STATUSES = new Set(["done", "approved"]);

/** Count of weekdays (Mon–Fri) in the closed interval [from, to]. Returns 0 if to is before from. */
export function workingDaysBetween(from: Date, to: Date): number {
  if (to < from) return 0;
  // Normalize to midnight in local time so partial-day differences don't slip
  // past the loop boundary.
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const stop = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  let count = 0;
  while (cur <= stop) {
    const day = cur.getDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export function computeProgress(input: ProgressInputs): ProgressResult {
  const now = input.now ?? clockNow();
  const basis: ProgressBasis = input.basis ?? "days";

  let totalEffort = 0;
  let remainingEffort = 0;
  let unestimatedCount = 0;
  let doneStoryCount = 0;
  let totalStoryCount = 0;
  for (const story of input.stories) {
    totalStoryCount += 1;
    if (DONE_STATUSES.has(story.status)) doneStoryCount += 1;
    if (story.estimatedDays == null) {
      unestimatedCount += 1;
      continue;
    }
    totalEffort += story.estimatedDays;
    // Done/approved stories have daysLeft = 0 by API invariant; daysLeft is
    // never null for estimated stories thanks to the auto-init rule. Defensive
    // fallback only matters if the invariant is somehow violated by a manual
    // DB edit — fall back to estimatedDays in that case (assume no progress).
    if (!DONE_STATUSES.has(story.status)) {
      remainingEffort += story.daysLeft ?? story.estimatedDays;
    }
  }

  // `epicEst` basis: scale ACTUAL story progress into epic-estimate units.
  // - totalEffort = the epic's own originalEstimateDays
  // - remainingEffort = epicEst × (currentOpenStoryDays / totalStoryDays)
  // The previous formula used `epicEst − workingDaysElapsed`, which counts
  // calendar time as if it were work delivered — that gave "100% complete"
  // for any epic whose start was far in the past, regardless of whether
  // child stories had actually burned down. Scaling against the same
  // story-day rollup the burndown chart uses keeps the popover honest with
  // the visualization. Fallback to time-based burn only when the epic has
  // no estimated stories yet (early-stage), so a freshly-created epic
  // doesn't immediately show "—".
  if (basis === "epicEst") {
    const epicEst = input.epicOriginalEstimateDays ?? null;
    if (epicEst != null && epicEst > 0) {
      let totalStoryDays = 0;
      let currentOpenStoryDays = 0;
      for (const story of input.stories) {
        if (story.estimatedDays == null) continue;
        totalStoryDays += story.estimatedDays;
        if (!DONE_STATUSES.has(story.status)) {
          currentOpenStoryDays += story.daysLeft ?? story.estimatedDays;
        }
      }
      totalEffort = epicEst;
      if (totalStoryDays > 0) {
        const ratio = Math.min(1, Math.max(0, currentOpenStoryDays / totalStoryDays));
        remainingEffort = epicEst * ratio;
      } else {
        // No estimated stories yet → fall back to the time-elapsed burn so
        // the verdict isn't stuck at "all done" the moment the period
        // starts (and isn't stuck at "all remaining" forever).
        const elapsedWorkingDays = workingDaysBetween(input.start, now);
        const burned = Math.min(epicEst, Math.max(0, elapsedWorkingDays));
        remainingEffort = Math.max(0, epicEst - burned);
      }
      // `unestimatedCount` represents child-story coverage; in epicEst mode
      // we surface 0 since the verdict doesn't depend on per-story coverage.
      unestimatedCount = 0;
    } else {
      // Epic has no estimate in epicEst mode → treat as unestimated; the
      // status fallthrough below will pick `onTrack` (no work claimed yet)
      // unless past the deadline.
      totalEffort = 0;
      remainingEffort = 0;
      unestimatedCount = 1;
    }
  }

  // Days/epicEst basis uses effort burn-down; stories basis uses headcount of done.
  // All clamp to 0..100. Stories basis treats unestimated stories the same
  // as estimated ones (it doesn't care about days at all).
  const daysProgressPercent =
    totalEffort > 0
      ? Math.round(((totalEffort - remainingEffort) / totalEffort) * 100)
      : 0;
  const storiesProgressPercent =
    totalStoryCount > 0 ? Math.round((doneStoryCount / totalStoryCount) * 100) : 0;
  const progressPercent =
    basis === "stories" ? storiesProgressPercent : daysProgressPercent;

  const daysRemaining = workingDaysBetween(now, input.end);

  // Health verdict uses an **ideal-line** comparison (not just "do we have
  // enough time left"). At any point in the window the ideal remaining is
  // a linear interpolation from `totalEffort` on `start` → 0 on `end`:
  //
  //     idealRemaining = totalEffort × (daysRemaining / totalWorkingDays)
  //
  // `deltaDays = remainingEffort − idealRemaining` then says "how far above
  // (positive = behind) or below (negative = ahead) the burndown's ideal
  // line is the team right now?" That matches what the user sees on the
  // burndown chart: above the orange line = at risk earlier than the old
  // "fits in remaining time" cliff check.
  //
  // Edge cases:
  //  - totalWorkingDays = 0 (start == end) → fall back to the deadline-cliff
  //    delta so we never divide by zero.
  //  - now < start (epic hasn't started yet) → ratio clamps to 1 and
  //    `idealRemaining = totalEffort`; if work hasn't started, delta is ~0
  //    and verdict is OnTrack.
  //  - now > end (past deadline) → ratio clamps to 0, `idealRemaining = 0`,
  //    delta = remainingEffort; the Overdue check below short-circuits anyway.
  const totalWorkingDays = workingDaysBetween(input.start, input.end);
  const ratio = totalWorkingDays > 0
    ? Math.min(1, Math.max(0, daysRemaining / totalWorkingDays))
    : 0;
  const idealRemaining = totalEffort > 0 && totalWorkingDays > 0
    ? totalEffort * ratio
    : daysRemaining; // legacy fallback when there's no measurable window/effort
  const deltaDays = remainingEffort - idealRemaining;

  let status: HealthStatus;
  if (now > input.end && progressPercent < 100) {
    status = "overdue";
  } else if (progressPercent >= 100) {
    status = "done";
  } else if (deltaDays <= HEALTH_ON_TRACK_DELTA) {
    status = "onTrack";
  } else if (deltaDays < HEALTH_AT_RISK_DELTA) {
    status = "watch";
  } else {
    status = "atRisk";
  }

  return {
    progressPercent,
    remainingEffort,
    totalEffort,
    daysRemaining,
    deltaDays,
    unestimatedCount,
    status,
  };
}

/**
 * Roll-up for an initiative bar: aggregate effort across every story under
 * every child epic, and pick the worst child status as the initiative's
 * status (Overdue > AtRisk > Watch > OnTrack).
 *
 * `start` and `end` are the initiative's own bar bounds (used only for the
 * Overdue check and `daysRemaining`); per-epic deadlines are honored via the
 * `childStatuses` input so a single late epic surfaces here.
 */
export interface InitiativeRollupInputs {
  stories: ProgressStoryInput[];
  childStatuses: HealthStatus[];
  start: Date;
  end: Date;
  now?: Date;
  basis?: ProgressBasis;
  /** Required when `basis === "epicEst"`. For an initiative this is the
   *  sum of `originalEstimateDays` across every child epic. */
  epicOriginalEstimateDays?: number | null;
}

const STATUS_RANK: Record<HealthStatus, number> = {
  // `done` ranks alongside onTrack (0) — a 100%-done epic shouldn't drag
  // an initiative's worst-child rollup any worse than an on-track one.
  done: 0,
  onTrack: 0,
  watch: 1,
  atRisk: 2,
  overdue: 3,
};

export function computeInitiativeProgress(input: InitiativeRollupInputs): ProgressResult {
  // First, do the same effort-weighted math across the flattened stories so
  // the initiative bar's progress % reflects total effort burned down.
  const flat = computeProgress({
    stories: input.stories,
    start: input.start,
    end: input.end,
    now: input.now,
    basis: input.basis,
    epicOriginalEstimateDays: input.epicOriginalEstimateDays,
  });

  // Then override the status to be the worst of (own status, child statuses)
  // — an initiative is at risk as soon as one of its epics is.
  let worst: HealthStatus = flat.status;
  for (const childStatus of input.childStatuses) {
    if (STATUS_RANK[childStatus] > STATUS_RANK[worst]) {
      worst = childStatus;
    }
  }

  return { ...flat, status: worst };
}
