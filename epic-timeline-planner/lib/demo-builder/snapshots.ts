/**
 * Snapshot generator for demo stories — produces a per-workday
 * `StoryDailySnapshot` series that makes burndown / burnup / CFD charts
 * look like real teams have been chipping away at the work.
 *
 * Design goals (set in the original ask):
 *  - Per-sprint curves should be **smooth and monotonic** (no jagged jitter)
 *  - Across sprints, story-level variance should land at ~70% on-ideal /
 *    ~15% ahead / ~15% behind so charts read as "mostly on plan with some
 *    drift", not "perfectly straight" and not "noise"
 *  - Generation must be deterministic given the same `seed` so the same
 *    reseed produces the same data (helps when comparing screenshots)
 */
import { StoryStatus } from "@/lib/generated/prisma";
import { workingDaysBetween } from "@/lib/progress";
import { sprintEndDate, sprintStartDate } from "@/lib/year-sprint";

/** Adds "watch" + "atRisk" variants used by the seeder to force specific
 *  epics into Watch / At Risk health states for the demo, on top of the
 *  random 70/15/15 onIdeal/ahead/behind mix used for everything else. */
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
 * deliberately push 2–3 epics into At Risk and 2–3 into Watch so the
 * Roadmap Health popover and the Insights chart verdicts show variety
 * instead of "everything On Track / Done".
 *
 * Distribution (designated by `initIdx` + `teamIdx`):
 *   - At Risk: 3 epics (initIdx 0/teamIdx 1, 2/3, 5/0)
 *   - Watch:   3 epics (initIdx 1/teamIdx 2, 3/4, 4/1)
 * The picks land on initiatives whose plan windows overlap May–Aug, so the
 * health verdict reads against an in-flight period (not future or done).
 */
export function pickDemoEpicHealthOverride(
  initIdx: number,
  teamIdx: number,
): DemoStoryCurve | null {
  const key = `${initIdx}/${teamIdx}`;
  if (key === "0/1" || key === "2/3" || key === "5/0") return "atRisk";
  if (key === "1/2" || key === "3/4" || key === "4/1") return "watch";
  return null;
}

export type DemoSnapshotInput = {
  storyId: string;
  sprint: number;
  estimatedDays: number;
  /** "Today" (or any cutoff) — snapshots are generated for every workday
   *  from the sprint's start up to and including `min(today, sprintEnd)`. */
  today: Date;
  planYear: number;
  curve: DemoStoryCurve;
  assignee: string | null;
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
 * Final state the story should be left in *now* based on its curve, so the
 * live row matches what the snapshot series implies. Returned alongside the
 * snapshots so the seeder can `UPDATE` the parent UserStory row in one go.
 */
export type DemoFinalStoryState = {
  status: StoryStatus;
  daysLeft: number;
};

export function buildDemoSnapshotSeries(
  input: DemoSnapshotInput,
): { snapshots: DemoSnapshotRecord[]; final: DemoFinalStoryState } {
  const { storyId, sprint, estimatedDays, today, planYear, curve, assignee } = input;
  const sprintStart = sprintStartDate(planYear, sprint);
  const sprintEnd = sprintEndDate(planYear, sprint);
  // Demo intent: every epic should show progress on its burndown / burnup
  // chart, including epics whose sprints fall in the future relative to
  // real today. We therefore generate snapshots through the full sprint
  // window, not capped at `today`. The chart's "Today" indicator still
  // tracks real time via Date.now() — the actual line may visually extend
  // past it for forward-looking sprints, reading as "projected progress".
  const cutoff = sprintEnd;
  // The LIVE story.status/daysLeft (returned in `final`) should reflect
  // where we'd "actually" be today, not where we'll be at sprint end. We
  // track the latest snapshot whose date is ≤ today and return that as
  // `final` — so:
  //   - past sprints: final = sprint-end snapshot (done / inProgress-residual)
  //   - current sprint: final = today's snapshot (mid-sprint state)
  //   - future sprints: final stays at initial todo / full estimate
  const todayMs = today.getTime();

  // Workdays span of the whole sprint (denominator for "ideal" math), and
  // workdays elapsed up to the cutoff (numerator).
  const sprintTotalWd = Math.max(1, workingDaysBetween(sprintStart, sprintEnd));
  const elapsedWd = Math.max(1, workingDaysBetween(sprintStart, cutoff));

  // Curve coefficients — how aggressively `daysLeft` drops relative to the
  // pure ideal line. >1 means faster burn (ahead), <1 means slower (behind).
  // Picked to look distinct on the chart without screaming. `watch` and
  // `atRisk` are slow enough that the epic-level deltaDays = remaining −
  // ideal lands in the Watch (>1 d) / At Risk (>4 d) bands of progress.ts.
  const speed =
    curve === "ahead" ? 1.25
    : curve === "behind" ? 0.78
    : curve === "watch" ? 0.55
    : curve === "atRisk" ? 0.35
    : 1.0;
  // Sprint-level finished flag: ahead stories finish ~75% into the sprint;
  // on-ideal stories finish exactly at sprint end; behind / watch / atRisk
  // stories *may* not finish even by cutoff (chart shows leftover days).
  const idealFinishFraction = curve === "ahead" ? 0.75 : 1.0;

  const snapshots: DemoSnapshotRecord[] = [];
  let finalStatus: StoryStatus = StoryStatus.todo;
  let finalDaysLeft = estimatedDays;

  // ANCHOR snapshot at the start of the plan year showing the story as
  // `todo` at full estimate. Without this, the burndown chart sums
  // `daysLeft` across stories with no snapshot before their sprint start
  // (treating them as 0d), making the blue actual line start near zero
  // instead of at the epic's total scope.
  const yearAnchorDate = new Date(planYear, 0, 1, 0, 0, 0, 0);
  if (yearAnchorDate < sprintStart) {
    snapshots.push({
      storyId,
      snapshotDate: yearAnchorDate,
      status: StoryStatus.todo,
      sprint,
      estimatedDays,
      daysLeft: estimatedDays,
      assignee,
    });
    if (yearAnchorDate.getTime() <= todayMs) {
      // Counts as the current state when nothing else has come in yet.
      finalStatus = StoryStatus.todo;
      finalDaysLeft = estimatedDays;
    }
  }

  // PRE-SPRINT RAMP — a sparse series of snapshots between Jan 1 and sprint
  // start that gradually decreases `daysLeft` from `estimatedDays` toward
  // `estimatedDays * preSprintFloor`. Status stays `todo` so per-sprint
  // kanban filters still treat the story as "not yet started" until its
  // sprint actually begins.
  //
  // This exists purely so the epic-scope / quarter-scope / year-scope
  // burndown chart (which sums per-day open `daysLeft` across all stories
  // in the epic) shows a gradual descent across the full chart range,
  // rather than the previous "flat then cliff" shape that only dropped
  // during the in-sprint window. With 10 stories per epic each contributing
  // a small per-week decrease, the summed actual line trends toward ideal
  // throughout the period leading up to each story's sprint.
  const preSprintFloor = 0.85;
  const preSprintTargetDaysLeft = Math.max(0, estimatedDays * preSprintFloor);
  const rampStart = new Date(yearAnchorDate);
  rampStart.setDate(rampStart.getDate() + 7);
  const yearAnchorMs = yearAnchorDate.getTime();
  const sprintStartMs = sprintStart.getTime();
  const preSpanMs = sprintStartMs - yearAnchorMs;
  if (preSpanMs > 0) {
    const rampCursor = new Date(rampStart);
    while (rampCursor < sprintStart) {
      const day = rampCursor.getDay();
      if (day !== 0 && day !== 6) {
        const ratio = (rampCursor.getTime() - yearAnchorMs) / preSpanMs;
        const daysLeft = Number(
          (estimatedDays - (estimatedDays - preSprintTargetDaysLeft) * ratio).toFixed(1),
        );
        const snapshotDate = new Date(rampCursor);
        snapshots.push({
          storyId,
          snapshotDate,
          status: StoryStatus.todo,
          sprint,
          estimatedDays,
          daysLeft,
          assignee,
        });
        if (snapshotDate.getTime() <= todayMs) {
          finalStatus = StoryStatus.todo;
          finalDaysLeft = daysLeft;
        }
      }
      // Emit one ramp snapshot per workweek — sparse is fine, the chart
      // interpolates between points anyway via the carry-forward in
      // `latestSnapshotAtDay`.
      rampCursor.setDate(rampCursor.getDate() + 5);
    }
  }

  // Walk one workday at a time so the snapshot series is dense and the
  // chart can draw a smooth line. Saturday/Sunday skipped via the same
  // working-days definition used in `lib/progress`.
  const cursor = new Date(sprintStart.getFullYear(), sprintStart.getMonth(), sprintStart.getDate());
  const stop = new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate());
  let wdIndex = 0;
  while (cursor <= stop) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      wdIndex += 1;
      const fractionElapsed = Math.min(1, wdIndex / sprintTotalWd);
      // Linear burn-down with curve speed multiplier, clamped to [0, est].
      // `(1 - fractionElapsed * speed)` is the "how much work is left if we
      // continue at our pace". Tiny per-day jitter (≤ 0.3d) keeps the line
      // alive without breaking monotonicity (only ever subtracts).
      const remainingFraction = Math.max(0, 1 - fractionElapsed * speed / idealFinishFraction);
      const jitter = ((wdIndex * 2654435761) % 7) / 7; // 0..1 deterministic
      const noise = jitter * 0.3; // up to 0.3d
      // In-sprint burn starts where the pre-sprint ramp left off
      // (`preSprintTargetDaysLeft` ≈ 85% of estimate) — picking up from the
      // last snapshot value keeps the chart line continuous (no jump-up at
      // sprint start) while still showing the bulk of the burn happening
      // within the sprint window.
      const inSprintStart = preSprintTargetDaysLeft;
      const raw = inSprintStart * remainingFraction - noise;
      const daysLeft = Math.max(0, Number(raw.toFixed(1)));
      const status: StoryStatus =
        daysLeft === 0
          ? StoryStatus.done
          : wdIndex === 1
            ? StoryStatus.inProgress
            : StoryStatus.inProgress;
      const snapshotDate = new Date(cursor);
      snapshots.push({
        storyId,
        snapshotDate,
        status,
        sprint,
        estimatedDays,
        daysLeft,
        assignee,
      });
      // Only update `final` for snapshots dated ≤ today; later snapshots
      // are "future projection" and shouldn't drive the live story state.
      if (snapshotDate.getTime() <= todayMs) {
        finalStatus = status;
        finalDaysLeft = daysLeft;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    snapshots,
    final: { status: finalStatus, daysLeft: finalDaysLeft },
  };
}
