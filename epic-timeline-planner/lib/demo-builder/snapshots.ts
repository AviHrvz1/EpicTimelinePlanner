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

export type DemoStoryCurve = "onIdeal" | "ahead" | "behind";

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
  const cutoff = today < sprintEnd ? today : sprintEnd;

  // Sprint hasn't started yet → no snapshots, story stays in `todo`.
  if (sprintStart > today) {
    return {
      snapshots: [],
      final: { status: StoryStatus.todo, daysLeft: estimatedDays },
    };
  }

  // Workdays span of the whole sprint (denominator for "ideal" math), and
  // workdays elapsed up to the cutoff (numerator).
  const sprintTotalWd = Math.max(1, workingDaysBetween(sprintStart, sprintEnd));
  const elapsedWd = Math.max(1, workingDaysBetween(sprintStart, cutoff));

  // Curve coefficients — how aggressively `daysLeft` drops relative to the
  // pure ideal line. >1 means faster burn (ahead), <1 means slower (behind).
  // Picked to look distinct on the chart without screaming.
  const speed = curve === "ahead" ? 1.25 : curve === "behind" ? 0.78 : 1.0;
  // Sprint-level finished flag: ahead stories finish ~75% into the sprint;
  // on-ideal stories finish exactly at sprint end; behind stories *may* not
  // finish even by cutoff (chart shows leftover days).
  const idealFinishFraction = curve === "ahead" ? 0.75 : 1.0;

  const snapshots: DemoSnapshotRecord[] = [];
  let finalStatus: StoryStatus = StoryStatus.todo;
  let finalDaysLeft = estimatedDays;

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
      const raw = estimatedDays * remainingFraction - noise;
      const daysLeft = Math.max(0, Number(raw.toFixed(1)));
      const status: StoryStatus =
        daysLeft === 0
          ? StoryStatus.done
          : wdIndex === 1
            ? StoryStatus.inProgress
            : StoryStatus.inProgress;
      snapshots.push({
        storyId,
        snapshotDate: new Date(cursor),
        status,
        sprint,
        estimatedDays,
        daysLeft,
        assignee,
      });
      finalStatus = status;
      finalDaysLeft = daysLeft;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    snapshots,
    final: { status: finalStatus, daysLeft: finalDaysLeft },
  };
}
