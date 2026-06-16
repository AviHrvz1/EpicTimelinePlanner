/**
 * Sprint retrospective — snapshot-aware analytics that match the
 * Sprint Kanban's view of "what's in this sprint." Replaces the
 * earlier-built helper that froze on the sprint-close instant; the
 * close-instant rule undercounted stories whose status changed in
 * the grace window between sprint-end and the next-day mutation
 * (the snapshot record lagged the live row).
 *
 * Rule, applied per story:
 *   1. `story.sprint === yearSprint` (still in the sprint live)
 *      → use the LIVE status / daysLeft. Matches the kanban.
 *   2. Story is NOT live-in-sprint but has at least one snapshot
 *      whose `sprint === yearSprint` (rolled out via Move leftovers)
 *      → use the LATEST such snapshot's status / daysLeft. The
 *      story still belongs to this sprint's retro because it left
 *      the sprint mid-window, not before joining it.
 *   3. Otherwise → exclude. Workspace-wide `sprint == null` stories
 *      and stories that never touched this sprint never had it.
 *
 * The kept stories are rewritten with `sprint: yearSprint` and the
 * resolved status / daysLeft so the existing `buildSprintAnalytics`
 * builders (pie / burndown / CFD) can run unchanged — they all
 * filter by `story.sprint === yearSprint` and read `story.status`
 * / `story.daysLeft`, exactly the fields the projection populates.
 *
 * Two corrections layered on top of the existing analytics:
 *   - "Unscheduled" donut bucket dropped (it counted workspace-wide
 *     `sprint == null` stories that don't belong to this sprint).
 *   - `totalStories` recomputed against the projected-and-filtered
 *     set so the headline matches what the donut renders.
 */
import { StoryStatus } from "@/lib/generated/prisma";
import type {
  EpicItem,
  InitiativeItem,
  StoryDailySnapshotItem,
  UserStoryItem,
} from "@/lib/types";
import type { EstimateSource } from "@/lib/epic-estimates";
import {
  buildSprintAnalytics,
  type BurndownMetric,
  type SprintAnalyticsData,
} from "@/lib/sprint-analytics";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { storyMatchesYearSprint } from "@/lib/sprint-plan";
import { sprintEndDate, sprintStartDate } from "@/lib/year-sprint";

export type SprintRetrospectiveOptions = {
  initiatives: InitiativeItem[];
  month: number;
  yearSprint: number;
  metric: BurndownMetric;
  planYear: number;
  filterEpicTeamIds?: string[] | null;
  /** Pass-through args to `buildSprintAnalytics`. Sprint Insights
   *  needs these for the workload / capacity sub-views, even
   *  though Retrospective doesn't render them. */
  estimateSource?: EstimateSource;
  sprintCapacityBoard?: { capacities: Record<string, number>; assignments: Record<string, string[]> } | null;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[] | null;
};

/**
 * Project every story to its "as part of this sprint" state, then
 * defer to the existing analytics builders.
 */
export function buildSprintRetrospective(
  args: SprintRetrospectiveOptions,
): SprintAnalyticsData {
  const {
    initiatives,
    month,
    yearSprint,
    metric,
    planYear,
    filterEpicTeamIds,
    estimateSource,
    sprintCapacityBoard,
    workspaceDirectoryUsers,
  } = args;
  const startDate = sprintStartDate(planYear, yearSprint);
  const closeDate = sprintEndDate(planYear, yearSprint);
  const projected = projectInitiativesForRetrospective(initiatives, yearSprint, startDate, closeDate);
  const analytics = buildSprintAnalytics(
    projected,
    month,
    yearSprint,
    metric,
    planYear,
    filterEpicTeamIds,
    estimateSource,
    sprintCapacityBoard,
    workspaceDirectoryUsers,
  );
  const statusPieFiltered = analytics.statusPie.filter(
    (slice) => slice.name !== "Unscheduled",
  );
  const totalStories = countStoriesInSprint(
    projected,
    month,
    yearSprint,
    filterEpicTeamIds,
  );
  return {
    ...analytics,
    statusPie: statusPieFiltered,
    totalStories,
  };
}

function projectInitiativesForRetrospective(
  initiatives: InitiativeItem[],
  yearSprint: number,
  startDate: Date,
  closeDate: Date,
): InitiativeItem[] {
  // Midnight of start / close day in local time — the snapshot
  // map's per-day bucketing is keyed on startOfDay, so we anchor
  // the synthetic rows at midnight and strip any existing snapshot
  // dated on/after close-day midnight before appending the close
  // synthetic. Otherwise the chart could read a stale freeze
  // snapshot ahead of our injected live-state row.
  const startDayMidnightMs = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  ).getTime();
  const closeDayMidnightMs = new Date(
    closeDate.getFullYear(),
    closeDate.getMonth(),
    closeDate.getDate(),
  ).getTime();
  return initiatives.map((init) => ({
    ...init,
    epics: (init.epics ?? []).map<EpicItem>((epic) => ({
      ...epic,
      userStories: (epic.userStories ?? [])
        .map((story) =>
          projectStoryForSprint(story, yearSprint, startDayMidnightMs, closeDayMidnightMs),
        )
        .filter((s): s is UserStoryItem => s != null),
    })),
  }));
}

/**
 * Returns the story with its live state when it's still in the
 * sprint, or with values from its latest in-sprint snapshot when it
 * rolled out. Returns null when the story never touched the sprint.
 *
 * Also appends a synthetic close-day snapshot whose status / sprint /
 * daysLeft mirror the resolved (live or latest-in-sprint) values, so
 * the CFD and Burndown's day-by-day math reads the same final state
 * the donut shows. Without the synthetic row, those charts read the
 * last *real* snapshot (often dated mid-sprint, when a story was
 * still in Review) — which is what produced the donut-vs-chart
 * mismatch (32 Done on the donut but only 9 Done in the CFD).
 *
 * Clears `story.history` on the projected copy so
 * `storyRolledOutOfSprint()` returns false and `buildBurndown`'s
 * "skip the close-day snapshot for rolled-out stories" guard
 * doesn't suppress our synthetic row. The original story object is
 * untouched.
 */
function projectStoryForSprint(
  story: UserStoryItem,
  yearSprint: number,
  startDayMidnightMs: number,
  closeDayMidnightMs: number,
): UserStoryItem | null {
  let resolvedStatus: UserStoryItem["status"];
  let resolvedDaysLeft: number | null;
  let resolvedEstimatedDays: number | null;
  if (story.sprint === yearSprint) {
    resolvedStatus = story.status;
    resolvedDaysLeft = story.daysLeft;
    resolvedEstimatedDays = story.estimatedDays;
  } else {
    const lastInSprintSnap = findLatestSnapshotForSprint(story.snapshots, yearSprint);
    if (lastInSprintSnap == null) return null;
    resolvedStatus = lastInSprintSnap.status;
    resolvedDaysLeft = lastInSprintSnap.daysLeft ?? story.daysLeft;
    resolvedEstimatedDays = lastInSprintSnap.estimatedDays ?? story.estimatedDays;
  }
  // Synthetic SPRINT-START snapshot: pretend every kept story was
  // todo at the full estimate on day 0. Resolves the
  // "burndown starts at 4 instead of 5" surprise — a story that
  // happened to be already-done at sprint start would otherwise
  // count as 0 work-remaining at day 0, dropping the actual line
  // below the ideal start. For a sprint retrospective the
  // pedagogical reading is "we committed N stories, here's the
  // descent toward 0", which requires day 0 = N. Per-day burn
  // shape is reconstructed from the real mid-sprint snapshots.
  const syntheticStartSnap: StoryDailySnapshotItem = {
    id: `${story.id}-retro-start`,
    storyId: story.id,
    snapshotDate: new Date(startDayMidnightMs).toISOString(),
    status: StoryStatus.todo,
    sprint: yearSprint,
    estimatedDays: resolvedEstimatedDays ?? null,
    daysLeft: resolvedEstimatedDays ?? resolvedDaysLeft ?? 0,
    assignee: story.assignee,
    createdAt: new Date(startDayMidnightMs).toISOString(),
  };
  // Synthetic SPRINT-CLOSE snapshot: pin the close-day data point
  // on the chart to the resolved live (or last-in-sprint) state so
  // the donut + CFD + burndown agree at the right edge.
  const syntheticCloseSnap: StoryDailySnapshotItem = {
    id: `${story.id}-retro-close`,
    storyId: story.id,
    snapshotDate: new Date(closeDayMidnightMs).toISOString(),
    status: resolvedStatus,
    sprint: yearSprint,
    estimatedDays: resolvedEstimatedDays ?? null,
    daysLeft: resolvedDaysLeft ?? 0,
    assignee: story.assignee,
    createdAt: new Date(closeDayMidnightMs).toISOString(),
  };
  // Keep only mid-sprint snapshots (strictly between start and
  // close-day midnight). The two synthetic rows replace whatever
  // existed at the bounds.
  const midSprintSnaps = (story.snapshots ?? []).filter((s) => {
    const ms = new Date(s.snapshotDate).getTime();
    return ms > startDayMidnightMs && ms < closeDayMidnightMs;
  });
  return {
    ...story,
    sprint: yearSprint,
    status: resolvedStatus,
    daysLeft: resolvedDaysLeft,
    estimatedDays: resolvedEstimatedDays,
    snapshots: [syntheticStartSnap, ...midSprintSnaps, syntheticCloseSnap],
    history: [],
  };
}

function findLatestSnapshotForSprint(
  snapshots: StoryDailySnapshotItem[] | undefined,
  yearSprint: number,
): StoryDailySnapshotItem | null {
  if (!snapshots || snapshots.length === 0) return null;
  let best: StoryDailySnapshotItem | null = null;
  let bestMs = -Infinity;
  for (const snap of snapshots) {
    if (snap.sprint !== yearSprint) continue;
    const snapMs = new Date(snap.snapshotDate).getTime();
    if (snapMs > bestMs) {
      bestMs = snapMs;
      best = snap;
    }
  }
  return best;
}

function countStoriesInSprint(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
  filterEpicTeamIds?: string[] | null,
): number {
  let n = 0;
  const hasTeamFilter = !!filterEpicTeamIds?.length;
  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      for (const story of epic.userStories ?? []) {
        if (!storyMatchesYearSprint(story, month, yearSprint)) continue;
        if (hasTeamFilter) {
          const effective = (story.team ?? epic.team) ?? "";
          if (!filterEpicTeamIds!.includes(effective)) continue;
        }
        n += 1;
      }
    }
  }
  return n;
}
