import { StoryStatus } from "@/lib/generated/prisma";
import { epicOriginalEstimateDays, epicStoryEstimateDaysSum, type EstimateSource } from "@/lib/epic-estimates";
import { MONTH_TEAM_COLUMNS } from "@/lib/month-team-board";
import { teamLabelForWorkspaceUser } from "@/lib/workspace-users";
import {
  assigneeMatchRosterForSprintTeam,
  orderedSprintCapacityMembers,
  SPRINT_CAPACITY_OTHER_BUCKET,
  sprintCapacityAssigneeBucket,
  type SprintWorkspaceDirectoryUser,
} from "@/lib/sprint-capacity";
import { collectMonthScopeEpicsForSprintPanel, collectStoriesForSprintBoard, storyMatchesYearSprint } from "@/lib/sprint-plan";
import { storyRolledOutOfSprint } from "@/lib/story-rollover-history";
import { InitiativeItem, UserStoryItem } from "@/lib/types";
import { now as clockNow } from "@/lib/clock";
import { sprintEndDate } from "@/lib/year-sprint";

export type BurndownMetric = "daysLeft" | "storyCount";

export type WorkloadCapacityRow = {
  assignee: string;
  /** Sum of estimated days (fallback days left) on open sprint stories for this assignee. */
  estimatedTotal: number;
  /** Sum of days left on open sprint stories. */
  daysLeftTotal: number;
  /** `daysLeftTotal / sprint calendar days left` × 100 when sprint days left > 0. */
  utilizationPct: number;
  isOverCapacity: boolean;
  /**
   * When set, {@link utilizationPct} / {@link isOverCapacity} match the Sprint capacity board
   * (assigned estimate sum in bucket vs personal capacity days).
   */
  sprintCapacity?: { capDays: number; assignedDays: number };
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function flowChartDayLabel(dayDate: Date): string {
  const d = dayDate.getDate();
  const m = dayDate.getMonth() + 1;
  const w = WEEKDAY_SHORT[dayDate.getDay()];
  return `${d}/${m}(${w})`;
}

export type WorkloadStoriesByStatus = {
  todo: number;
  inProgress: number;
  review: number;
  done: number;
};

export type WorkloadTeamRow = {
  teamId: string | null;
  teamLabel: string;
  storiesByStatus: WorkloadStoriesByStatus;
  /** Sum of estimatedDays per status — for the days-left view of Workload Balance. */
  daysByStatus: WorkloadStoriesByStatus;
  daysLeftTotal: number;
  estimatedTotal: number;
  openCount: number;
};

export type SprintAnalyticsData = {
  statusPie: Array<{ name: string; value: number }>;
  burndown: Array<{
    labelShort: string;
    ideal: number;
    actual: number | null;
    isToday: boolean;
    /** Always-present cross-metric values used by the chart tooltip so the
     *  user sees "stories remaining" and "est days left" side-by-side
     *  regardless of which series is plotted. Null when the day is in the
     *  future (no actual yet). */
    actualStories: number | null;
    actualDaysLeft: number | null;
    totalStories: number;
    totalDaysLeft: number;
  }>;
  workloadByAssignee: Array<{
    assignee: string;
    openCount: number;
    daysLeftTotal: number;
    estimatedTotal: number;
    storiesByStatus: WorkloadStoriesByStatus;
    daysByStatus: WorkloadStoriesByStatus;
  }>;
  /** Team-level aggregation — only populated when filterEpicTeamId is null (All Teams). */
  workloadByTeam: WorkloadTeamRow[];
  workloadMaxDays: number;
  /** Max total sprint stories (all statuses) among rows in workloadByAssignee — for bar length scale. */
  workloadMaxStoryTotal: number;
  /**
   * Per calendar day in the sprint window: count of unique assignees with ≥1 story
   * in that status at end of day (from story history replay, with DB fallback).
   */
  flowSprintTrendData: Array<{
    dayInSprint: number;
    /** e.g. `18/4(Sat)` — day/month and short weekday */
    labelShort: string;
    isToday: boolean;
    todo: number;
    inProgress: number;
    review: number;
    done: number;
  }>;
  openStories: number;
  atRiskStories: number;
  totalStories: number;
  workloadCapacityByAssignee: WorkloadCapacityRow[];
  /** Calendar days remaining in the sprint from today (0 if the sprint has ended). */
  workloadSprintCalendarDaysLeft: number;
  /** Total calendar-day length of the sprint (independent of "today"). Used for
   *  burndown-style verdicts (Sprint Load health badge) so consumers can derive
   *  the elapsed fraction without re-reading the calendar. */
  workloadSprintCalendarDaysTotal: number;
};

/** All sprint stories from scheduled initiatives spanning the month — broader scope than Gantt-planned epics only.
 * Used for workload/sprint-load to match what the drilldown table shows. */
function collectWorkloadStories(
  initiatives: InitiativeItem[],
  month: number,
  filterEpicTeamIds?: string[] | null,
  directoryUsers?: readonly SprintWorkspaceDirectoryUser[] | null,
): UserStoryItem[] {
  // Team filter is OR-style: a story counts if EITHER its parent epic's team
  // is in the filter OR the story's assignee is a directory member of one
  // of the filtered teams. That way, when a platform-team person is assigned
  // to a story under an experience epic, the story still shows up under the
  // platform filter — "what my team is working on this sprint" rather than
  // strictly "what my team's epics contain".
  //
  // Scope by EPIC plan range (via the same helper the kanban uses) rather
  // than the parent initiative's month bounds — initiatives are coarse
  // containers whose dates can lag their child epics' plans, and the
  // previous initiative-bounds check silently dropped epics that planned
  // beyond the initiative's end.
  /**
   * Mirror the kanban board's epic scope: iterate every initiative's epics
   * (no month-plan filter). Without this, sprint-N stories whose parent
   * epic is planned outside the calendar month silently drop out of the
   * Workload Balance / Workload by Team charts, even though the board and
   * the drilldown show them.
   */
  const teamMemberNames = buildTeamMemberNameSet(directoryUsers, filterEpicTeamIds ?? null);
  const rows: UserStoryItem[] = [];
  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      const epicTeamInFilter =
        !filterEpicTeamIds?.length || filterEpicTeamIds.includes(epic.team ?? "");
      if (epicTeamInFilter) {
        rows.push(...(epic.userStories ?? []));
        continue;
      }
      // Cross-team fallback: include stories whose assignee belongs to the
      // filtered team. Skip when there's no directory or no matches at all.
      if (teamMemberNames.size === 0) continue;
      for (const story of epic.userStories ?? []) {
        const a = (story.assignee ?? "").trim().toLowerCase();
        if (a && teamMemberNames.has(a)) rows.push(story);
      }
    }
  }
  return rows;
}

/** Build a Set of lowercase assignee names belonging to the filtered teams.
 *  Returns an empty Set when there's no team filter, no directory, or no
 *  matches — callers should skip the cross-team fallback in that case. */
function buildTeamMemberNameSet(
  directoryUsers: readonly SprintWorkspaceDirectoryUser[] | null | undefined,
  filterTeamIds: readonly string[] | null,
): Set<string> {
  const set = new Set<string>();
  if (!filterTeamIds?.length || !directoryUsers || directoryUsers.length === 0) return set;
  const filterLower = new Set(filterTeamIds.map((t) => t.toLowerCase()));
  for (const u of directoryUsers) {
    const team = (u.team ?? "").trim().toLowerCase();
    const name = (u.name ?? "").trim().toLowerCase();
    if (!team || !name) continue;
    if (filterLower.has(team)) set.add(name);
  }
  return set;
}

export function collectMonthStories(
  initiatives: InitiativeItem[],
  month: number,
  filterEpicTeamIds?: string[] | null,
  estimateSource: EstimateSource = "auto",
): UserStoryItem[] {
  /**
   * Mirror the board's scope (`collectStoriesForSprintBoard`): iterate ALL
   * team-filtered epics across all initiatives, NOT just epics whose plan
   * window overlaps `month`. The earlier `collectMonthScopeEpicsForSprintPanel`
   * filter dropped any sprint-10 story whose parent epic was planned outside
   * May — so the pie / workload / drilldown undercounted vs the kanban board.
   * Each consumer still filters by `storyMatchesYearSprint` for the actual
   * sprint cut.
   */
  const rows: UserStoryItem[] = [];
  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      if (filterEpicTeamIds?.length && !filterEpicTeamIds.includes(epic.team ?? "")) continue;
      const stories = epic.userStories ?? [];
      const storySum = epicStoryEstimateDaysSum(epic);
      const useOriginal = estimateSource === "original" || (estimateSource === "auto" && storySum <= 0);
      const perStoryOriginal = stories.length > 0 ? epicOriginalEstimateDays(epic) / stories.length : 0;
      rows.push(
        ...stories.map((story) => {
          if (estimateSource === "stories") return story;
          if (!useOriginal) return story;
          const nextEst = Math.max(0, Math.round(perStoryOriginal));
          return {
            ...story,
            estimatedDays: nextEst,
            daysLeft: nextEst,
          };
        }),
      );
    }
  }
  return rows;
}

function buildStatusPie(stories: UserStoryItem[], month: number, yearSprint: number): Array<{ name: string; value: number }> {
  const counts = {
    unscheduled: 0,
    todo: 0,
    inProgress: 0,
    review: 0,
    done: 0,
  };

  for (const story of stories) {
    if (story.sprint == null) {
      counts.unscheduled += 1;
      continue;
    }
    if (!storyMatchesYearSprint(story, month, yearSprint)) continue;
    if (story.status === "todo") counts.todo += 1;
    else if (story.status === "inProgress") counts.inProgress += 1;
    else if (story.status === "review") counts.review += 1;
    else if (story.status === "done") counts.done += 1;
  }

  return [
    { name: "Unscheduled", value: counts.unscheduled },
    { name: "To do", value: counts.todo },
    { name: "In progress", value: counts.inProgress },
    { name: "Review / Testing", value: counts.review },
    { name: "Done", value: counts.done },
  ];
}

/**
 * 1-based index of “today” along the sprint day list for burndown actuals (clamped before / after sprint).
 */
function sprintCalendarToday1Based(dayDates: Date[]): number {
  if (dayDates.length === 0) return 1;
  const t = startOfDay(clockNow()).getTime();
  const first = startOfDay(dayDates[0]).getTime();
  const last = startOfDay(dayDates[dayDates.length - 1]).getTime();
  if (t < first) return 1;
  if (t > last) return dayDates.length;
  for (let i = 0; i < dayDates.length; i++) {
    if (startOfDay(dayDates[i]).getTime() === t) return i + 1;
  }
  let best = 1;
  for (let i = 0; i < dayDates.length; i++) {
    if (startOfDay(dayDates[i]).getTime() <= t) best = i + 1;
  }
  return best;
}

function buildBurndown(
  stories: UserStoryItem[],
  month: number,
  yearSprint: number,
  metric: BurndownMetric,
  planYear: number,
) {
  /**
   * Include stories that ROLLED OUT of this sprint (Move-leftovers shifts
   * `story.sprint` to the next sprint). Without this, a closed sprint's
   * burndown collapses to its `done` stories only — flatlining at 0 — once
   * the planner moves leftovers forward.
   */
  const sprintStories = stories.filter(
    (story) =>
      storyMatchesYearSprint(story, month, yearSprint) ||
      storyRolledOutOfSprint(story, yearSprint),
  );
  const dayDates = sprintDayDates(planYear, month, yearSprint);
  const horizon = Math.max(1, dayDates.length);
  const roundBurndown = (n: number) => (metric === "storyCount" ? Math.round(n) : Number(n.toFixed(1)));
  const todayMs = startOfDay(clockNow()).getTime();
  /**
   * Close-day snapshot of rolled-out stories is the FREEZE row captured by
   * `/api/sprints/freeze-snapshots` right before Move-leftovers patched the
   * story's sprint forward. That row reflects the LIVE leftover daysLeft at
   * sprint close (correct for the closed kanban projection) — but if we let
   * it land on the burndown's last day it spikes ABOVE the daily snapshot
   * trend. Skip the close-day row for rolled-out stories so the last point
   * keeps reading from the prior daily snapshot, matching the smooth curve
   * the chart had before Move-leftovers ran.
   */
  const sprintCloseDayMs = startOfDay(sprintEndDate(planYear, yearSprint)).getTime();
  const rolledOutStoryIds = new Set(
    sprintStories.filter((s) => storyRolledOutOfSprint(s, yearSprint)).map((s) => s.id),
  );

  // Build per-story snapshot lookup: storyId → sorted [{dateMs, daysLeft, status}]
  type SnapRow = { dateMs: number; daysLeft: number | null; status: StoryStatus };
  const snapMap = new Map<string, SnapRow[]>();
  for (const story of sprintStories) {
    if (story.snapshots?.length) {
      snapMap.set(
        story.id,
        [...story.snapshots]
          .map((s) => ({
            dateMs: startOfDay(new Date(s.snapshotDate)).getTime(),
            daysLeft: s.daysLeft,
            status: s.status,
          }))
          .sort((a, b) => a.dateMs - b.dateMs),
      );
    }
  }
  const hasSnapshots = snapMap.size > 0;

  // Value for one story on a given day using its snapshots (most-recent-on-or-before).
  // Returns BOTH metrics so the tooltip can show stories + est-days simultaneously
  // and the active series can pick whichever one it plots. Only the terminal
  // `done` counts as burned-down for the stories metric (review work hasn't
  // shipped) — mirrors the pie chart's distinction between Review / Testing
  // and Done.
  function storyValuesAtDay(story: UserStoryItem, dayMs: number): { daysLeft: number; stories: number } {
    const snaps = snapMap.get(story.id);
    const skipCloseDay = rolledOutStoryIds.has(story.id);
    if (snaps?.length) {
      let best: SnapRow | null = null;
      for (const s of snaps) {
        if (s.dateMs > dayMs) break;
        if (skipCloseDay && s.dateMs === sprintCloseDayMs) continue;
        best = s;
      }
      if (best) {
        return {
          daysLeft: Math.max(0, best.daysLeft ?? 0),
          stories: best.status === StoryStatus.done ? 0 : 1,
        };
      }
    }
    return {
      daysLeft: Math.max(0, story.daysLeft ?? 0),
      stories: story.status === StoryStatus.done ? 0 : 1,
    };
  }
  function storyValueAtDay(story: UserStoryItem, dayMs: number): number {
    const v = storyValuesAtDay(story, dayMs);
    return metric === "daysLeft" ? v.daysLeft : v.stories;
  }

  // Start value from day-1 snapshots (or estimated if no snapshots)
  let startValue: number;
  if (hasSnapshots && dayDates[0]) {
    const day0Ms = startOfDay(dayDates[0]).getTime();
    startValue = sprintStories.reduce((sum, s) => {
      const snaps = snapMap.get(s.id);
      const firstSnap = snaps?.find((sn) => sn.dateMs <= day0Ms);
      if (firstSnap) {
        return sum + (metric === "daysLeft" ? Math.max(0, firstSnap.daysLeft ?? 0) : 1);
      }
      return sum + (metric === "daysLeft" ? (s.estimatedDays ?? s.daysLeft ?? 1) : 1);
    }, 0);
  } else if (metric === "daysLeft") {
    startValue = sprintStories.reduce((sum, s) => sum + (s.estimatedDays ?? s.daysLeft ?? 1), 0);
  } else {
    startValue = sprintStories.length;
  }

  // Fallback for non-snapshot path: interpolate from start to current
  const today1Based = sprintCalendarToday1Based(dayDates);
  const currentActual = metric === "daysLeft"
    ? sprintStories.reduce((sum, s) => sum + Math.max(0, s.daysLeft ?? 0), 0)
    : sprintStories.filter((s) => s.status !== StoryStatus.done).length;

  // Cross-metric totals (constant across the chart) — used in tooltip for
  // "X of Y stories left" framing.
  const totalStories = sprintStories.length;
  const totalDaysLeft = sprintStories.reduce(
    (sum, s) => sum + Math.max(0, s.estimatedDays ?? s.daysLeft ?? 0),
    0,
  );
  const aggregateValuesAtDay = (dayMs: number) =>
    sprintStories.reduce(
      (acc, s) => {
        const v = storyValuesAtDay(s, dayMs);
        acc.daysLeft += v.daysLeft;
        acc.stories += v.stories;
        return acc;
      },
      { daysLeft: 0, stories: 0 },
    );

  if (horizon === 1) {
    const cal = dayDates[0] ?? new Date(planYear, month - 1, 1);
    const dayMs = startOfDay(cal).getTime();
    const agg = aggregateValuesAtDay(dayMs);
    return [{
      labelShort: flowChartDayLabel(cal),
      ideal: roundBurndown(0),
      actual: roundBurndown(hasSnapshots ? (metric === "daysLeft" ? agg.daysLeft : agg.stories) : currentActual),
      isToday: dayMs === todayMs,
      actualStories: hasSnapshots ? Math.round(agg.stories) : Math.round(currentActual),
      actualDaysLeft: hasSnapshots ? Number(agg.daysLeft.toFixed(1)) : Number(currentActual.toFixed(1)),
      totalStories,
      totalDaysLeft: Number(totalDaysLeft.toFixed(1)),
    }];
  }

  return dayDates.map((cal, idx) => {
    const dayIdx = idx + 1;
    const dayMs = startOfDay(cal).getTime();
    const ideal = roundBurndown(startValue * (1 - idx / (horizon - 1)));

    let actual: number | null = null;
    let actualStories: number | null = null;
    let actualDaysLeft: number | null = null;
    if (dayMs <= todayMs) {
      if (hasSnapshots) {
        const agg = aggregateValuesAtDay(dayMs);
        actual = roundBurndown(metric === "daysLeft" ? agg.daysLeft : agg.stories);
        actualStories = Math.round(agg.stories);
        actualDaysLeft = Number(agg.daysLeft.toFixed(1));
      } else {
        const interpolated = dayIdx <= today1Based
          ? startValue - (startValue - currentActual) * ((dayIdx - 1) / Math.max(today1Based - 1, 1))
          : null;
        actual = interpolated == null ? null : roundBurndown(interpolated);
        // Without snapshots there's no day-by-day cross-metric data — fall
        // back to scaling today's known values along the same linear curve.
        if (interpolated != null) {
          const scale = startValue > 0 ? interpolated / startValue : 0;
          actualStories = Math.round(totalStories * scale);
          actualDaysLeft = Number((totalDaysLeft * scale).toFixed(1));
        }
      }
    }

    return {
      labelShort: flowChartDayLabel(cal),
      ideal,
      actual,
      isToday: dayMs === todayMs,
      actualStories,
      actualDaysLeft,
      totalStories,
      totalDaysLeft: Number(totalDaysLeft.toFixed(1)),
    };
  });
}

function buildWorkloadByAssignee(stories: UserStoryItem[], month: number, yearSprint: number) {
  const sprintStories = stories.filter((story) => storyMatchesYearSprint(story, month, yearSprint));
  const openStories = sprintStories.filter(
    (story) => story.status === "todo" || story.status === "inProgress",
  );
  const emptyStatus = (): WorkloadStoriesByStatus => ({
    todo: 0,
    inProgress: 0,
    review: 0,
    done: 0,
  });
  const byAssignee = new Map<
    string,
    { openCount: number; daysLeftTotal: number; estimatedTotal: number; storiesByStatus: WorkloadStoriesByStatus; daysByStatus: WorkloadStoriesByStatus }
  >();
  for (const story of sprintStories) {
    const assignee = story.assignee?.trim() || "Unassigned";
    const row =
      byAssignee.get(assignee) ?? {
        openCount: 0,
        daysLeftTotal: 0,
        estimatedTotal: 0,
        storiesByStatus: emptyStatus(),
        daysByStatus: emptyStatus(),
      };
    const estDays = Math.max(0, story.estimatedDays ?? story.daysLeft ?? 0);
    if (story.status === "todo") { row.storiesByStatus.todo += 1; row.daysByStatus.todo += estDays; }
    else if (story.status === "inProgress") { row.storiesByStatus.inProgress += 1; row.daysByStatus.inProgress += estDays; }
    else if (story.status === "review") { row.storiesByStatus.review += 1; row.daysByStatus.review += estDays; }
    else if (story.status === "done") { row.storiesByStatus.done += 1; row.daysByStatus.done += estDays; }
    row.estimatedTotal += estDays;
    if (story.status === "todo" || story.status === "inProgress") {
      row.openCount += 1;
      row.daysLeftTotal += Math.max(0, story.daysLeft ?? 0);
    }
    byAssignee.set(assignee, row);
  }
  const workload = [...byAssignee.entries()]
    .map(([assignee, v]) => ({
      assignee,
      openCount: v.openCount,
      daysLeftTotal: v.daysLeftTotal,
      estimatedTotal: v.estimatedTotal,
      storiesByStatus: v.storiesByStatus,
      daysByStatus: v.daysByStatus,
    }))
    .sort((a, b) => b.daysLeftTotal - a.daysLeftTotal || b.openCount - a.openCount || a.assignee.localeCompare(b.assignee));
  const workloadMaxDays = Math.max(1, ...workload.map((item) => item.daysLeftTotal));
  const workloadMaxStoryTotal = Math.max(
    1,
    ...workload.map(
      (item) =>
        item.storiesByStatus.todo +
        item.storiesByStatus.inProgress +
        item.storiesByStatus.review +
        item.storiesByStatus.done,
    ),
  );
  const atRiskStories = openStories.filter(
    (story) => story.status === "inProgress" && (story.daysLeft ?? 0) < 0,
  ).length;
  return {
    workloadByAssignee: workload,
    workloadMaxDays,
    workloadMaxStoryTotal,
    openStories: openStories.length,
    atRiskStories,
  };
}

function buildWorkloadByTeam(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
  filterTeamIds?: string[] | null,
  directoryUsers?: readonly SprintWorkspaceDirectoryUser[] | null,
): WorkloadTeamRow[] {
  const emptyStatus = (): WorkloadStoriesByStatus => ({ todo: 0, inProgress: 0, review: 0, done: 0 });
  const byTeam = new Map<string, WorkloadTeamRow>();
  // Map<lowercased-name, normalized team id> for assignee-team lookup. Used
  // to bucket cross-team stories under the ASSIGNEE'S team when the epic's
  // team isn't in the filter (mirrors the OR-style logic in
  // `collectWorkloadStories`). Only built when there's a filter + directory.
  const memberToTeam = new Map<string, string>();
  if (filterTeamIds?.length && directoryUsers) {
    for (const u of directoryUsers) {
      const team = (u.team ?? "").trim();
      const name = (u.name ?? "").trim().toLowerCase();
      if (!team || !name) continue;
      memberToTeam.set(name, team);
    }
  }
  // Same epic scope as `collectWorkloadStories` — iterate every initiative's
  // epics (no month-plan filter) so sprint-N stories whose parent epic is
  // planned outside the calendar month still land in the right team bucket.
  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      const epicTeamId = epic.team ?? null;
      const epicTeamInFilter =
        !filterTeamIds?.length || filterTeamIds.includes(epicTeamId ?? "");
      for (const story of epic.userStories ?? []) {
        if (!storyMatchesYearSprint(story, month, yearSprint)) continue;
      // Resolve which team's bar this story should land on.
      //  - Epic team in filter (or no filter at all) → bucket by epic team.
      //  - Otherwise, if the assignee is on a filter team → bucket there.
      //  - Otherwise → skip (excluded by filter).
      let bucketTeamId: string | null;
      if (epicTeamInFilter) {
        bucketTeamId = epicTeamId;
      } else {
        const a = (story.assignee ?? "").trim().toLowerCase();
        const assigneeTeam = a ? memberToTeam.get(a) : undefined;
        if (assigneeTeam && filterTeamIds?.includes(assigneeTeam)) {
          bucketTeamId = assigneeTeam;
        } else {
          continue;
        }
      }
      const teamKey = bucketTeamId ?? "__unassigned__";
      const teamLabel = bucketTeamId ? teamLabelForWorkspaceUser(bucketTeamId) : "Unassigned";
      const row = byTeam.get(teamKey) ?? { teamId: bucketTeamId, teamLabel, storiesByStatus: emptyStatus(), daysByStatus: emptyStatus(), daysLeftTotal: 0, estimatedTotal: 0, openCount: 0 };
      const estDays = Math.max(0, story.estimatedDays ?? story.daysLeft ?? 0);
      if (story.status === "todo") { row.storiesByStatus.todo += 1; row.daysByStatus.todo += estDays; }
      else if (story.status === "inProgress") { row.storiesByStatus.inProgress += 1; row.daysByStatus.inProgress += estDays; }
      else if (story.status === "review") { row.storiesByStatus.review += 1; row.daysByStatus.review += estDays; }
      else if (story.status === "done") { row.storiesByStatus.done += 1; row.daysByStatus.done += estDays; }
      row.estimatedTotal += estDays;
      if (story.status === "todo" || story.status === "inProgress") {
        row.openCount += 1;
        row.daysLeftTotal += Math.max(0, story.daysLeft ?? 0);
      }
      byTeam.set(teamKey, row);
      }
    }
  }
  return [...byTeam.values()].sort((a, b) => a.teamLabel.localeCompare(b.teamLabel));
}

/**
 * Same rules as {@link SprintCapacityBoard} member columns, but respects `filterEpicTeamIds` so Insights
 * sprint load matches Kanban assignee chips when a delivery team filter is active.
 */
function sprintCapacityVisibleMemberKeys(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
  capacityBoard: {
    capacities: Record<string, number>;
    assignments: Record<string, string[]>;
    columnOrder?: string[];
  },
  filterEpicTeamIds?: string[] | null,
  directoryUsers?: readonly SprintWorkspaceDirectoryUser[] | null,
): string[] {
  const rows = collectStoriesForSprintBoard(initiatives, month, yearSprint, filterEpicTeamIds ?? null);
  const storyIds = new Set(rows.map((r) => r.story.id));
  const rosterTeamId = filterEpicTeamIds?.length === 1 ? filterEpicTeamIds[0] : null;
  const assigneeRoster = assigneeMatchRosterForSprintTeam(rosterTeamId, directoryUsers);
  const memberSet = new Set<string>(assigneeRoster);
  for (const row of rows) {
    const m = sprintCapacityAssigneeBucket(row.story.assignee, assigneeRoster);
    if (m) memberSet.add(m);
  }
  for (const [key, ids] of Object.entries(capacityBoard.assignments ?? {})) {
    if (key === SPRINT_CAPACITY_OTHER_BUCKET) continue;
    if (Array.isArray(ids) && ids.length > 0 && ids.some((id) => storyIds.has(id))) {
      memberSet.add(key);
    }
  }
  const otherIds = capacityBoard.assignments[SPRINT_CAPACITY_OTHER_BUCKET] ?? [];
  const needsOtherColumn =
    otherIds.some((id) => storyIds.has(id)) ||
    rows.some((row) => sprintCapacityAssigneeBucket(row.story.assignee, assigneeRoster) == null);
  const sortedPeopleCols = [...memberSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return orderedSprintCapacityMembers({
    columnOrder: capacityBoard.columnOrder,
    sortedPeopleCols,
    needsOtherColumn,
  });
}

function workloadLegacyAssigneeKeyToCapacityColumn(
  assigneeLabel: string,
  fullRoster: string[],
  visibleHasOther: boolean,
): string | null {
  const raw = assigneeLabel.trim();
  if (!raw || raw === "Unassigned") {
    return visibleHasOther ? SPRINT_CAPACITY_OTHER_BUCKET : null;
  }
  return sprintCapacityAssigneeBucket(raw, fullRoster);
}

function buildWorkloadCapacityByAssignee(
  stories: UserStoryItem[],
  month: number,
  yearSprint: number,
  planYear: number,
  initiatives: InitiativeItem[],
  capacityBoard?: { capacities: Record<string, number>; assignments: Record<string, string[]> } | null,
  filterEpicTeamIds?: string[] | null,
  directoryUsers?: readonly SprintWorkspaceDirectoryUser[] | null,
): { workloadCapacityByAssignee: WorkloadCapacityRow[]; workloadSprintCalendarDaysLeft: number; workloadSprintCalendarDaysTotal: number } {
  const workloadSprintCalendarDaysLeft = sprintCalendarDaysRemaining(planYear, month, yearSprint);
  const workloadSprintCalendarDaysTotal = sprintDayDates(planYear, month, yearSprint).length;
  const sprintStories = stories.filter((story) => storyMatchesYearSprint(story, month, yearSprint));
  const byAssignee = new Map<string, { estimatedTotal: number; daysLeftTotal: number }>();
  for (const story of sprintStories) {
    if (story.status !== "todo" && story.status !== "inProgress") continue;
    const assignee = story.assignee?.trim() || "Unassigned";
    const row = byAssignee.get(assignee) ?? { estimatedTotal: 0, daysLeftTotal: 0 };
    const estPiece = story.estimatedDays ?? story.daysLeft ?? 0;
    const daysLeftPiece = story.daysLeft ?? story.estimatedDays ?? 0;
    row.estimatedTotal += Math.max(0, estPiece);
    row.daysLeftTotal += Math.max(0, daysLeftPiece);
    byAssignee.set(assignee, row);
  }

  const useBoard =
    capacityBoard &&
    (Object.keys(capacityBoard.capacities ?? {}).length > 0 ||
      Object.keys(capacityBoard.assignments ?? {}).length > 0);

  if (!useBoard) {
    const workloadCapacityByAssignee = [...byAssignee.entries()]
      .map(([assignee, v]) => {
        const utilizationPct =
          workloadSprintCalendarDaysLeft > 0
            ? (v.daysLeftTotal / workloadSprintCalendarDaysLeft) * 100
            : v.daysLeftTotal > 0
              ? 999
              : 0;
        const isOverCapacity =
          workloadSprintCalendarDaysLeft > 0
            ? v.daysLeftTotal > workloadSprintCalendarDaysLeft
            : v.daysLeftTotal > 0;
        return {
          assignee,
          estimatedTotal: v.estimatedTotal,
          daysLeftTotal: v.daysLeftTotal,
          utilizationPct,
          isOverCapacity,
        };
      })
      .sort(
        (a, b) =>
          b.utilizationPct - a.utilizationPct ||
          b.daysLeftTotal - a.daysLeftTotal ||
          a.assignee.localeCompare(b.assignee),
      );
    return { workloadCapacityByAssignee, workloadSprintCalendarDaysLeft, workloadSprintCalendarDaysTotal };
  }

  const boardStoryRows = collectStoriesForSprintBoard(initiatives, month, yearSprint, filterEpicTeamIds ?? null);
  const storyById = new Map(boardStoryRows.map((r) => [r.story.id, r.story]));
  const rosterTeamId = filterEpicTeamIds?.length === 1 ? filterEpicTeamIds[0] : null;
  const fullRoster = assigneeMatchRosterForSprintTeam(rosterTeamId, directoryUsers);
  const visibleMembers = sprintCapacityVisibleMemberKeys(
    initiatives,
    month,
    yearSprint,
    capacityBoard,
    filterEpicTeamIds,
    directoryUsers,
  );
  const visibleSet = new Set(visibleMembers);
  const visibleHasOther = visibleMembers.includes(SPRINT_CAPACITY_OTHER_BUCKET);

  const boardRows: WorkloadCapacityRow[] = visibleMembers.map((member) => {
    const capRaw = capacityBoard.capacities?.[member];
    const capDays = Number.isFinite(Number(capRaw)) ? Math.max(0, Number(capRaw)) : 6;
    const ids = capacityBoard.assignments?.[member] ?? [];
    let assignedDays = 0;
    let openEst = 0;
    let openDaysLeft = 0;
    for (const id of ids) {
      const st = storyById.get(id);
      if (!st) continue;
      if (!storyMatchesYearSprint(st, month, yearSprint)) continue;
      const est = Math.max(0, st.estimatedDays ?? st.daysLeft ?? 0);
      assignedDays += est;
      if (st.status === "todo" || st.status === "inProgress") {
        openEst += est;
        openDaysLeft += Math.max(0, st.daysLeft ?? st.estimatedDays ?? 0);
      }
    }
    const utilizationPct =
      capDays > 0 ? (assignedDays / capDays) * 100 : assignedDays > 0 ? 999 : 0;
    const isOverCapacity = capDays > 0 ? assignedDays > capDays : assignedDays > 0;
    return {
      assignee: member,
      estimatedTotal: openEst,
      daysLeftTotal: openDaysLeft,
      utilizationPct,
      isOverCapacity,
      sprintCapacity: { capDays, assignedDays },
    };
  });

  const supplemental: WorkloadCapacityRow[] = [];
  for (const [assignee, v] of byAssignee.entries()) {
    const col = workloadLegacyAssigneeKeyToCapacityColumn(assignee, fullRoster, visibleHasOther);
    if (col != null && visibleSet.has(col)) continue;
    const utilizationPct =
      workloadSprintCalendarDaysLeft > 0
        ? (v.daysLeftTotal / workloadSprintCalendarDaysLeft) * 100
        : v.daysLeftTotal > 0
          ? 999
          : 0;
    const isOverCapacity =
      workloadSprintCalendarDaysLeft > 0
        ? v.daysLeftTotal > workloadSprintCalendarDaysLeft
        : v.daysLeftTotal > 0;
    supplemental.push({
      assignee,
      estimatedTotal: v.estimatedTotal,
      daysLeftTotal: v.daysLeftTotal,
      utilizationPct,
      isOverCapacity,
    });
  }

  const workloadCapacityByAssignee = [...boardRows, ...supplemental].sort(
    (a, b) =>
      b.utilizationPct - a.utilizationPct ||
      b.daysLeftTotal - a.daysLeftTotal ||
      a.assignee.localeCompare(b.assignee),
  );
  return { workloadCapacityByAssignee, workloadSprintCalendarDaysLeft, workloadSprintCalendarDaysTotal };
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseStatusChangeEntry(entry: string): StoryStatus | null {
  const m = /^Status changed to (todo|inProgress|review|done)$/.exec(entry);
  if (!m) return null;
  return m[1] as StoryStatus;
}

function hasParsedStatusHistory(story: UserStoryItem): boolean {
  return (story.history ?? []).some((h) => parseStatusChangeEntry(h.entry) != null);
}

function hashStoryId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(31, h) + id.charCodeAt(i);
  }
  return Math.abs(h | 0);
}

/** todo → … → finalStatus (shortest path on the board). */
function statusChainTo(finalStatus: StoryStatus): StoryStatus[] {
  const chain: StoryStatus[] = [StoryStatus.todo];
  if (finalStatus === StoryStatus.todo) return chain;
  chain.push(StoryStatus.inProgress);
  if (finalStatus === StoryStatus.inProgress) return chain;
  chain.push(StoryStatus.review);
  if (finalStatus === StoryStatus.review) return chain;
  chain.push(StoryStatus.done);
  return chain;
}

/**
 * When DB has no status history (typical seed) or createdAt is after the sprint window, replay a
 * plausible path across the sprint so the CFD moves instead of flat horizontal bands.
 */
function syntheticStatusTimeline(
  storyId: string,
  finalStatus: StoryStatus,
  windowStartT: number,
  windowEndT: number,
): { t: number; s: StoryStatus }[] {
  const chain = statusChainTo(finalStatus);
  const span = Math.max(1, windowEndT - windowStartT);
  const jitter = (hashStoryId(storyId) % 1000) / 1000;
  if (chain.length === 1) {
    return [{ t: windowStartT, s: chain[0] }];
  }
  return chain.map((s, i) => {
    const u = (i + jitter * 0.35) / (chain.length - 1 + jitter * 0.35);
    // +i ms so transitions stay strictly ordered if floor collapses to the same day
    return { t: windowStartT + Math.floor(u * span) + i, s };
  });
}

function eventsFromHistoryReplay(story: UserStoryItem): { t: number; s: StoryStatus }[] {
  const rawCreatedT = startOfDay(new Date(story.createdAt)).getTime();
  const events: { t: number; s: StoryStatus }[] = [{ t: rawCreatedT, s: StoryStatus.todo }];
  for (const h of story.history ?? []) {
    const next = parseStatusChangeEntry(h.entry);
    if (next == null) continue;
    events.push({ t: new Date(h.createdAt).getTime(), s: next });
  }
  const u = new Date(story.updatedAt).getTime();
  const last = events[events.length - 1];
  if (last && u > last.t && story.status !== last.s) {
    events.push({ t: u, s: story.status });
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

/** True if some parsed status history event falls inside the sprint calendar window (so replay can move within the CFD). */
function hasStatusChangeInsideSprint(
  story: UserStoryItem,
  sprintStartT: number,
  sprintEndT: number,
): boolean {
  for (const h of story.history ?? []) {
    if (parseStatusChangeEntry(h.entry) == null) continue;
    const t = new Date(h.createdAt).getTime();
    if (t >= sprintStartT && t <= sprintEndT) return true;
  }
  return false;
}

/**
 * Status at end of `dayEndCalendar` for cumulative flow.
 * Never uses “current status for every day” (that produced flat strips when createdAt was after the sprint).
 */
function statusAtEndOfDay(
  story: UserStoryItem,
  dayEndCalendar: Date,
  sprintFirstDay: Date,
  sprintLastDay: Date,
): StoryStatus | null {
  const endT = endOfDay(dayEndCalendar).getTime();
  const rawCreatedT = startOfDay(new Date(story.createdAt)).getTime();
  const sprintStartT = startOfDay(sprintFirstDay).getTime();
  const sprintEndT = endOfDay(sprintLastDay).getTime();

  let events: { t: number; s: StoryStatus }[];

  if (rawCreatedT > sprintEndT) {
    // Row created after this sprint window but still tagged to it — no real per-day history; model a path across the sprint.
    events = syntheticStatusTimeline(story.id, story.status, sprintStartT, sprintEndT);
  } else {
    if (rawCreatedT > endT) {
      return null;
    }
    const useHistoryReplay =
      hasParsedStatusHistory(story) && hasStatusChangeInsideSprint(story, sprintStartT, sprintEndT);
    if (useHistoryReplay) {
      events = eventsFromHistoryReplay(story);
    } else {
      const windowStartT = Math.max(rawCreatedT, sprintStartT);
      events = syntheticStatusTimeline(story.id, story.status, windowStartT, sprintEndT);
    }
  }

  let status: StoryStatus = StoryStatus.todo;
  for (const e of events) {
    if (e.t <= endT) status = e.s;
    else break;
  }
  return status;
}

function sprintLane(yearSprint: number): 1 | 2 {
  return (yearSprint % 2 === 0 ? 2 : 1) as 1 | 2;
}

/** Calendar days in the sprint half-month for the roadmap `month` + global `yearSprint`. */
function sprintDayDates(planYear: number, month: number, yearSprint: number): Date[] {
  const lane = sprintLane(yearSprint);
  const lastDay = new Date(planYear, month, 0).getDate();
  const startDay = lane === 1 ? 1 : 16;
  const endDay = lane === 1 ? 15 : lastDay;
  const out: Date[] = [];
  for (let d = startDay; d <= endDay; d++) {
    out.push(new Date(planYear, month - 1, d));
  }
  return out;
}

/** Count of calendar days from the start of today through the end of the sprint (inclusive), or 0 if the sprint has ended. */
function sprintCalendarDaysRemaining(planYear: number, month: number, yearSprint: number): number {
  const dayDates = sprintDayDates(planYear, month, yearSprint);
  if (dayDates.length === 0) return 0;
  const today = startOfDay(clockNow());
  const first = startOfDay(dayDates[0]);
  const lastEnd = endOfDay(dayDates[dayDates.length - 1]);
  const t = today.getTime();
  if (t > lastEnd.getTime()) return 0;
  if (t < first.getTime()) return dayDates.length;
  let n = 0;
  for (const d of dayDates) {
    if (startOfDay(d).getTime() >= t) n += 1;
  }
  return n;
}

function buildFlowTrend(
  stories: UserStoryItem[],
  month: number,
  yearSprint: number,
  planYear: number,
) {
  /** Same rolled-out inclusion as buildBurndown — keeps the CFD / burnup
   *  scope honest after Move-leftovers. */
  const sprintStories = stories.filter(
    (story) =>
      storyMatchesYearSprint(story, month, yearSprint) ||
      storyRolledOutOfSprint(story, yearSprint),
  );
  const dayDates = sprintDayDates(planYear, month, yearSprint);

  const sprintFirstDay = dayDates[0];
  const sprintLastDay = dayDates[dayDates.length - 1];
  const todayMs = startOfDay(clockNow()).getTime();
  const pastDates = dayDates.filter((d) => startOfDay(d).getTime() <= todayMs);
  /** See buildBurndown — skip the close-day FREEZE snapshot for rolled-out
   *  stories so the CFD doesn't jump on the last day. */
  const sprintCloseDayMs = startOfDay(sprintEndDate(planYear, yearSprint)).getTime();
  const rolledOutStoryIds = new Set(
    sprintStories.filter((s) => storyRolledOutOfSprint(s, yearSprint)).map((s) => s.id),
  );

  // Build snapshot map same as burndown: storyId → sorted [{dateMs, status}]
  type CfdSnapRow = { dateMs: number; status: StoryStatus };
  const snapMap = new Map<string, CfdSnapRow[]>();
  for (const story of sprintStories) {
    if (story.snapshots?.length) {
      snapMap.set(
        story.id,
        [...story.snapshots]
          .map((s) => ({
            dateMs: startOfDay(new Date(s.snapshotDate)).getTime(),
            status: s.status,
          }))
          .sort((a, b) => a.dateMs - b.dateMs),
      );
    }
  }
  const hasSnapshots = snapMap.size > 0;

  function storyStatusAtDay(story: UserStoryItem, dayMs: number): StoryStatus | null {
    const snaps = snapMap.get(story.id);
    const skipCloseDay = rolledOutStoryIds.has(story.id);
    if (snaps?.length) {
      let best: CfdSnapRow | null = null;
      for (const s of snaps) {
        if (s.dateMs > dayMs) break;
        if (skipCloseDay && s.dateMs === sprintCloseDayMs) continue;
        best = s;
      }
      if (best) return best.status;
    }
    // No snapshot: fall back to synthetic history replay
    if (!sprintFirstDay || !sprintLastDay) return null;
    return statusAtEndOfDay(story, new Date(dayMs), sprintFirstDay, sprintLastDay);
  }

  const flowSprintTrendData =
    pastDates.length === 0
      ? []
      : pastDates.map((dayDate, dayIndex) => {
          let todo = 0;
          let inProgress = 0;
          let review = 0;
          let done = 0;
          const dayMs = startOfDay(dayDate).getTime();

          for (const story of sprintStories) {
            const st = hasSnapshots
              ? storyStatusAtDay(story, dayMs)
              : statusAtEndOfDay(story, dayDate, sprintFirstDay, sprintLastDay);
            if (st == null) continue;
            if (st === StoryStatus.todo) todo += 1;
            else if (st === StoryStatus.inProgress) inProgress += 1;
            else if (st === StoryStatus.review) review += 1;
            else if (st === StoryStatus.done) done += 1;
          }

          return {
            dayInSprint: dayIndex + 1,
            labelShort: flowChartDayLabel(dayDate),
            isToday: dayMs === todayMs,
            todo,
            inProgress,
            review,
            done,
          };
        });

  return { flowSprintTrendData };
}

export function buildSprintAnalytics(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
  metric: BurndownMetric,
  /** Calendar year for the roadmap view (must match the timeline year, not arbitrary initiative order). */
  planYear: number,
  filterEpicTeamIds?: string[] | null,
  estimateSource: EstimateSource = "auto",
  sprintCapacityBoard?: { capacities: Record<string, number>; assignments: Record<string, string[]> } | null,
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[] | null,
): SprintAnalyticsData {
  /**
   * Analytics read LIVE initiatives so the pie / workload / capacity match
   * what the kanban board shows (the board itself reads LIVE — see
   * `sprint-kanban.tsx` `allRows`). The earlier close-day projection gave
   * "honest retro" semantics but produced confusing pie/board mismatches
   * for stories whose status changed after sprint close. Burndown still
   * reads raw snapshots through `buildBurndown`'s own snapshot map for its
   * day-by-day curve; that's independent of this `stories` array.
   */
  const stories = collectMonthStories(initiatives, month, filterEpicTeamIds, estimateSource);
  const workloadStories = collectWorkloadStories(initiatives, month, filterEpicTeamIds, workspaceDirectoryUsers);
  const workload = buildWorkloadByAssignee(workloadStories, month, yearSprint);
  const isTeamMode = !filterEpicTeamIds?.length || filterEpicTeamIds.length !== 1;
  const workloadByTeam = isTeamMode
    ? buildWorkloadByTeam(initiatives, month, yearSprint, filterEpicTeamIds?.length ? filterEpicTeamIds : null, workspaceDirectoryUsers)
    : [];
  const capacity = buildWorkloadCapacityByAssignee(
    stories,
    month,
    yearSprint,
    planYear,
    initiatives,
    sprintCapacityBoard,
    filterEpicTeamIds,
    workspaceDirectoryUsers,
  );
  const flow = buildFlowTrend(stories, month, yearSprint, planYear);
  return {
    statusPie: buildStatusPie(stories, month, yearSprint),
    burndown: buildBurndown(stories, month, yearSprint, metric, planYear),
    ...workload,
    workloadByTeam,
    ...capacity,
    ...flow,
    totalStories: stories.filter((story) => storyMatchesYearSprint(story, month, yearSprint)).length,
  };
}
