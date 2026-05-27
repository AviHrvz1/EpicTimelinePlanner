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
export type HealthStatus = "onTrack" | "watch" | "atRisk" | "overdue";

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
  /** remainingEffort − daysRemaining. Positive = behind, negative = buffer. */
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
  const now = input.now ?? new Date();
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

  // `epicEst` basis: ignore the child-story rollup entirely and treat the
  // epic as a single unit of effort with an "ideal linear burn-down".
  // - totalEffort = the epic's own originalEstimateDays
  // - remainingEffort = totalEffort − workingDaysElapsed(start → now),
  //   clamped to [0, totalEffort]
  // This gives early-stage epics (no child stories yet) a deterministic
  // verdict against the picked Gantt window, without leaning on stories
  // that haven't been written.
  if (basis === "epicEst") {
    const epicEst = input.epicOriginalEstimateDays ?? null;
    if (epicEst != null && epicEst > 0) {
      const elapsedWorkingDays = workingDaysBetween(input.start, now);
      const burned = Math.min(epicEst, Math.max(0, elapsedWorkingDays));
      totalEffort = epicEst;
      remainingEffort = Math.max(0, epicEst - burned);
      // `unestimatedCount` represents child-story coverage; in epicEst mode
      // we surface 0 since the verdict doesn't depend on child stories.
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
  const deltaDays = remainingEffort - daysRemaining;

  let status: HealthStatus;
  if (now > input.end && progressPercent < 100) {
    status = "overdue";
  } else if (progressPercent >= 100) {
    status = "onTrack";
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
