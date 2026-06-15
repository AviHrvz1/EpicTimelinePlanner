/**
 * Snapshot generator for demo stories — produces a `StoryDailySnapshot`
 * series that makes burndown / burnup / CFD charts look like real teams
 * have been chipping away at the work across the whole epic timeline,
 * not just within one sprint window.
 *
 * Design (Chunk 1): each story has an "ideal completion date" derived
 * from its position in its parent epic's story list, spread evenly
 * across the epic's plan window. Snapshots are generated weekly from
 * the epic start through 7 days before completion, then daily for the
 * final week, with status transitioning todo → inProgress → done. This
 * replaces the older "pre-sprint ramp + in-sprint burn" model that
 * clustered all completions at sprint-end boundaries (which read as
 * step-function descent on the workspace-level burndown).
 *
 * Generation stays deterministic given the same seed inputs so reseeds
 * produce the same data — important for screenshot diffing in tests.
 */
import { StoryStatus } from "@/lib/generated/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Adds "watch" + "atRisk" variants used by the seeder to force specific
 *  epics into Watch / At Risk health states for the demo, on top of the
 *  random 70/15/15 onIdeal/ahead/behind mix used for everything else.
 *  Chunk 2 will use these to offset each story's actual completion date
 *  relative to its ideal completion date (ahead = earlier, atRisk =
 *  much later). Chunk 1 ignores the variance and uses ideal directly. */
export type DemoStoryCurve = "onIdeal" | "ahead" | "behind" | "watch" | "atRisk";

/**
 * Deterministic pick of a per-story curve given its index. ~70/15/15.
 * Using a stable hash so the same story id always lands in the same bucket
 * across reseeds.
 */
export function pickDemoStoryCurve(seed: string): DemoStoryCurve {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const bucket = Math.abs(h) % 100;
  if (bucket < 70) return "onIdeal";
  if (bucket < 85) return "ahead";
  return "behind";
}

/**
 * Optional epic-level curve override. When set, every story under that epic
 * gets this curve regardless of `pickDemoStoryCurve`. Lets the seeder
 * deliberately push specific epics into At Risk and Watch so the Roadmap
 * Health popover and the Insights chart verdicts show variety instead of
 * "everything On Track / Done".
 *
 * Distribution (most On Track · 3 At Risk · 3 Watch · 2 Overdue):
 *   - At Risk:
 *       initIdx 0 / teamIdx 4  → "Onboarding revamp" epic at month 6
 *       initIdx 2 / teamIdx 3  → "Mobile app redesign" epic at months 6-8
 *       initIdx 4 / teamIdx 1  → "Growth experiments Q2" epic at months 6-7
 *   - Watch:
 *       initIdx 1 / teamIdx 3  → "Payments platform v2" epic at month 6
 *       initIdx 3 / teamIdx 2  → "Analytics data warehouse" epic at month 6
 *       initIdx 5 / teamIdx 1  → "Search & discovery" epic at month 6
 *   - Overdue:
 *       initIdx 0 / teamIdx 0  → "Onboarding revamp" epic at month 1
 *       initIdx 1 / teamIdx 1  → "Payments platform v2" epic at month 3
 */
/** Health verdicts we explicitly seed in the demo data so the popover and
 *  Insights chart show a realistic mix instead of "everything On Track".
 *  Most epics are intentionally left to read On Track; a handful here are
 *  forced into the other buckets. */
export type DemoEpicVerdictOverride = "atRisk" | "watch" | "overdue";

export function pickDemoEpicHealthOverride(
  initIdx: number,
  teamIdx: number,
): DemoEpicVerdictOverride | null {
  const key = `${initIdx}/${teamIdx}`;
  if (key === "0/4" || key === "2/3" || key === "4/1") return "atRisk";
  if (key === "1/3" || key === "3/2" || key === "5/1") return "watch";
  if (key === "0/0" || key === "1/1") return "overdue";
  return null;
}

export type DemoSnapshotInput = {
  storyId: string;
  /** Sprint number recorded on each snapshot (lets sprint-scoped filters
   *  on snapshots — e.g. closed-sprint cleanup — still find the right
   *  rows). The sprint no longer drives the trajectory itself. */
  sprint: number;
  estimatedDays: number;
  /** Wall-clock "today" for `final` derivation (which snapshot drives
   *  the live `UserStory.status` / `.daysLeft`). Snapshots after today
   *  are projected progress and don't affect `final`. */
  today: Date;
  planYear: number;
  curve: DemoStoryCurve;
  assignee: string | null;
  /** Start of the parent epic's plan window. Stories begin their
   *  trajectory here regardless of sprint number. */
  epicStartDate: Date;
  /** End of the parent epic's plan window. Used together with
   *  `storyPosition` to spread per-story ideal completion dates evenly
   *  across the epic timeline. */
  epicEndDate: Date;
  /** 1-indexed position of this story within its epic's story list.
   *  Drives the per-story ideal completion date so completions spread
   *  evenly across the epic window (the aggregate burndown then tracks
   *  the linear ideal line). */
  storyPosition: number;
  /** Total story count in the parent epic. Denominator for the
   *  position-based completion-date spread. */
  totalStoriesInEpic: number;
};

export type DemoSnapshotRecord = {
  storyId: string;
  snapshotDate: Date;
  status: StoryStatus;
  sprint: number;
  estimatedDays: number;
  daysLeft: number;
  assignee: string | null;
};

/**
 * Final state the story should be left in *now* based on its trajectory,
 * so the live `UserStory` row matches what the snapshot series implies.
 * Returned alongside the snapshots so the seeder can `UPDATE` the parent
 * row in one go.
 */
export type DemoFinalStoryState = {
  status: StoryStatus;
  daysLeft: number;
};

/** Normalize a Date to midnight (local time) so per-day uniqueness on
 *  `(storyId, snapshotDate)` is preserved across weekly + daily walks
 *  that might otherwise produce slightly different times-of-day. */
function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Curve-driven completion-date offset as a fraction of epic duration.
 *  Applied on top of the position-based ideal completion date so per-
 *  story variance shifts each story earlier (ahead) or later (behind /
 *  watch / atRisk). Tuned per the user-approved "moderate spread"
 *  default — atRisk overshoots by 25% of the epic window, often past
 *  the plan end, producing the overdue contribution the chart needs. */
function curveCompletionOffset(curve: DemoStoryCurve): number {
  switch (curve) {
    case "ahead":
      return -0.10;
    case "behind":
      return 0.10;
    case "watch":
      return 0.15;
    case "atRisk":
      return 0.25;
    case "onIdeal":
    default:
      return 0;
  }
}

/** Stable per-snapshot pseudo-random in [-1, 1]. Combines a story-level
 *  seed (hash of storyId) with the day index along the trajectory so
 *  every snapshot has a distinct jitter, but reseeding the demo
 *  reproduces the same series byte-for-byte. */
function snapshotJitter(storyId: string, dayIndex: number): number {
  let h = 0;
  for (let i = 0; i < storyId.length; i++) h = (h * 31 + storyId.charCodeAt(i)) | 0;
  h = (h * 2654435761 + dayIndex * 1597334677) | 0;
  const u = ((h >>> 0) % 2001) / 1000 - 1; // [-1, 1) at 0.001 resolution
  return u;
}

function nextWeekday(d: Date): Date {
  const next = new Date(d);
  while (isWeekend(next)) next.setDate(next.getDate() + 1);
  return next;
}

export function buildDemoSnapshotSeries(
  input: DemoSnapshotInput,
): { snapshots: DemoSnapshotRecord[]; final: DemoFinalStoryState } {
  const {
    storyId,
    sprint,
    estimatedDays,
    today,
    planYear,
    assignee,
    epicStartDate,
    epicEndDate,
    storyPosition,
    totalStoriesInEpic,
    curve,
  } = input;
  const todayMs = today.getTime();

  const snapshots: DemoSnapshotRecord[] = [];
  let finalStatus: StoryStatus = StoryStatus.todo;
  let finalDaysLeft = estimatedDays;
  const emittedDateKeys = new Set<number>();

  const emit = (date: Date, status: StoryStatus, daysLeft: number) => {
    const snap = atMidnight(date);
    const key = snap.getTime();
    if (emittedDateKeys.has(key)) return;
    emittedDateKeys.add(key);
    snapshots.push({
      storyId,
      snapshotDate: snap,
      status,
      sprint,
      estimatedDays,
      daysLeft,
      assignee,
    });
    if (snap.getTime() <= todayMs) {
      finalStatus = status;
      finalDaysLeft = daysLeft;
    }
  };

  // Year-anchor snapshot. Same purpose as the previous generator: gives
  // the workspace-level burndown a baseline data point at Jan 1 so the
  // actual line starts at full scope even when an epic begins later in
  // the year.
  const yearAnchorDate = atMidnight(new Date(planYear, 0, 1));
  const yearAnchorMs = yearAnchorDate.getTime();
  const epicStartMs = epicStartDate.getTime();
  if (yearAnchorMs < epicStartMs) {
    emit(yearAnchorDate, StoryStatus.todo, estimatedDays);
  }

  // Per-story ideal completion date — spread evenly across the epic
  // window. With `storyPosition` = 1..N, the last story completes at
  // epic end and the first completes one-Nth of the way in. This makes
  // the aggregate "open story count" decline linearly toward 0 as the
  // epic progresses — i.e. the actual line tracks the ideal line.
  const epicEndMs = epicEndDate.getTime();
  const epicSpanMs = Math.max(DAY_MS, epicEndMs - epicStartMs);
  const safeTotal = Math.max(1, totalStoriesInEpic);
  const positionFraction = Math.max(0, Math.min(1, storyPosition / safeTotal));
  // Chunk 2: shift the ideal completion date by a curve-dependent
  // offset (-10% for ahead, +10% behind, +15% watch, +25% atRisk).
  // The offset is a fraction of epic duration so longer epics get
  // proportionally larger shifts.
  const idealCompletionMs = epicStartMs + positionFraction * epicSpanMs;
  const offsetMs = curveCompletionOffset(curve) * epicSpanMs;
  const completionMs = idealCompletionMs + offsetMs;
  const completionDate = atMidnight(new Date(completionMs));
  const completionDateMs = completionDate.getTime();

  // Trajectory walks from the epic start through completion. If the
  // epic begins before the year anchor (extreme edge case), fall back
  // to the anchor + one week so we don't backdate into the prior year.
  const trajectoryStart = nextWeekday(
    atMidnight(epicStartMs >= yearAnchorMs ? epicStartDate : new Date(yearAnchorMs + 7 * DAY_MS)),
  );
  const trajectoryStartMs = trajectoryStart.getTime();
  const trajectorySpanMs = Math.max(DAY_MS, completionDateMs - trajectoryStartMs);

  // Status rule: todo until 7 days before completion, inProgress in the
  // final week, done at completion. `daysLeft` interpolates linearly
  // from estimatedDays → 0 across the trajectory.
  const computeProgress = (snapshotMs: number) =>
    Math.max(0, Math.min(1, (snapshotMs - trajectoryStartMs) / trajectorySpanMs));

  const dailyWindowStartMs = completionDateMs - 7 * DAY_MS;

  // Per-snapshot jitter ceiling: ±5% of estimatedDays, capped at ±1
  // day. Keeps the trajectory visually alive (slight wiggle) without
  // crossing zero or breaking monotonicity at the end (the final
  // completion snapshot still locks to daysLeft = 0).
  const jitterMagnitude = Math.min(1, estimatedDays * 0.05);

  // Walk: weekly cadence while > 7 days from completion, daily for the
  // final week. Weekends are skipped via `isWeekend`. When the weekly
  // step lands on or past the daily window, the loop shifts to single-
  // day increments naturally because `daysUntilCompletion` falls below
  // 8 each iteration.
  let cursor = new Date(trajectoryStart);
  let dayIndex = 0;
  while (cursor.getTime() <= completionDateMs) {
    if (!isWeekend(cursor)) {
      const snapMs = cursor.getTime();
      const progress = computeProgress(snapMs);
      const rawDaysLeft = estimatedDays * (1 - progress);
      // Apply jitter, but never to the very first or very last
      // snapshot (start should sit at the full estimate, end at zero
      // — both pinned to the ideal). Mid-trajectory values wobble.
      const wobble =
        progress > 0 && progress < 1 ? snapshotJitter(storyId, dayIndex) * jitterMagnitude : 0;
      const daysLeft = Math.max(0, Math.min(estimatedDays, Number((rawDaysLeft + wobble).toFixed(1))));
      const daysUntilCompletion = (completionDateMs - snapMs) / DAY_MS;
      const status: StoryStatus =
        daysUntilCompletion <= 0
          ? StoryStatus.done
          : daysUntilCompletion <= 7
            ? StoryStatus.inProgress
            : StoryStatus.todo;
      emit(cursor, status, daysLeft);
      dayIndex += 1;
    }
    const daysUntilCompletion = (completionDateMs - cursor.getTime()) / DAY_MS;
    const stepDays = cursor.getTime() < dailyWindowStartMs && daysUntilCompletion > 7 ? 7 : 1;
    cursor = new Date(cursor.getTime() + stepDays * DAY_MS);
  }

  // Always emit the final completion snapshot — the loop above may have
  // stopped one day shy because of the weekend skip or the inclusive
  // boundary check. Forces `done` with `daysLeft = 0`.
  emit(completionDate, StoryStatus.done, 0);

  return {
    snapshots,
    final: { status: finalStatus, daysLeft: finalDaysLeft },
  };
}
