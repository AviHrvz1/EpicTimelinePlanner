import { StoryStatus } from "@/lib/generated/prisma";
import { epicOriginalEstimateDays, epicStoryEstimateDaysSum, type EstimateSource } from "@/lib/epic-estimates";
import {
  assigneeMatchRosterForSprintTeam,
  orderedSprintCapacityMembers,
  SPRINT_CAPACITY_OTHER_BUCKET,
  sprintCapacityAssigneeBucket,
  type SprintWorkspaceDirectoryUser,
} from "@/lib/sprint-capacity";
import { collectStoriesForSprintBoard, storyMatchesYearSprint } from "@/lib/sprint-plan";
import { InitiativeItem, UserStoryItem } from "@/lib/types";

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
  done: number;
  approved: number;
};

export type SprintAnalyticsData = {
  statusPie: Array<{ name: string; value: number }>;
  burndown: Array<{ labelShort: string; ideal: number; actual: number | null; isToday: boolean }>;
  workloadByAssignee: Array<{
    assignee: string;
    openCount: number;
    daysLeftTotal: number;
    storiesByStatus: WorkloadStoriesByStatus;
  }>;
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
    done: number;
    approved: number;
  }>;
  openStories: number;
  atRiskStories: number;
  totalStories: number;
  workloadCapacityByAssignee: WorkloadCapacityRow[];
  /** Calendar days remaining in the sprint from today (0 if the sprint has ended). */
  workloadSprintCalendarDaysLeft: number;
};

function collectMonthStories(
  initiatives: InitiativeItem[],
  month: number,
  filterEpicTeamId?: string | null,
  estimateSource: EstimateSource = "auto",
): UserStoryItem[] {
  const rows: UserStoryItem[] = [];
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null) continue;
    if (initiative.endMonth < month || initiative.startMonth > month) continue;
    for (const epic of initiative.epics ?? []) {
      if (filterEpicTeamId && epic.team !== filterEpicTeamId) continue;
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
    done: 0,
    approved: 0,
  };

  for (const story of stories) {
    if (story.sprint == null) {
      counts.unscheduled += 1;
      continue;
    }
    if (!storyMatchesYearSprint(story, month, yearSprint)) continue;
    if (story.status === "todo") counts.todo += 1;
    else if (story.status === "inProgress") counts.inProgress += 1;
    else if (story.status === "done") counts.done += 1;
    else if (story.status === "approved") counts.approved += 1;
  }

  return [
    { name: "Unscheduled", value: counts.unscheduled },
    { name: "To do", value: counts.todo },
    { name: "In progress", value: counts.inProgress },
    { name: "Done", value: counts.done },
    { name: "Approved", value: counts.approved },
  ];
}

/**
 * 1-based index of “today” along the sprint day list for burndown actuals (clamped before / after sprint).
 */
function sprintCalendarToday1Based(dayDates: Date[]): number {
  if (dayDates.length === 0) return 1;
  const t = startOfDay(new Date()).getTime();
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
  const sprintStories = stories.filter((story) => storyMatchesYearSprint(story, month, yearSprint));
  const dayDates = sprintDayDates(planYear, month, yearSprint);
  const horizon = Math.max(1, dayDates.length);
  const roundBurndown = (n: number) => (metric === "storyCount" ? Math.round(n) : Number(n.toFixed(1)));
  const todayMs = startOfDay(new Date()).getTime();

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

  // Value for one story on a given day using its snapshots (most-recent-on-or-before)
  function storyValueAtDay(story: UserStoryItem, dayMs: number): number {
    const snaps = snapMap.get(story.id);
    if (snaps?.length) {
      let best: SnapRow | null = null;
      for (const s of snaps) {
        if (s.dateMs <= dayMs) best = s;
        else break;
      }
      if (best) {
        if (metric === "daysLeft") return Math.max(0, best.daysLeft ?? 0);
        return best.status === StoryStatus.done || best.status === StoryStatus.approved ? 0 : 1;
      }
    }
    // No snapshot: fall back to current story value
    if (metric === "daysLeft") return Math.max(0, story.daysLeft ?? 0);
    return story.status === StoryStatus.done || story.status === StoryStatus.approved ? 0 : 1;
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
    : sprintStories.filter((s) => s.status !== StoryStatus.done && s.status !== StoryStatus.approved).length;

  if (horizon === 1) {
    const cal = dayDates[0] ?? new Date(planYear, month - 1, 1);
    return [{
      labelShort: flowChartDayLabel(cal),
      ideal: roundBurndown(0),
      actual: roundBurndown(hasSnapshots ? storyValueAtDay.length > 0 ? sprintStories.reduce((sum, s) => sum + storyValueAtDay(s, startOfDay(cal).getTime()), 0) : currentActual : currentActual),
      isToday: startOfDay(cal).getTime() === todayMs,
    }];
  }

  return dayDates.map((cal, idx) => {
    const dayIdx = idx + 1;
    const dayMs = startOfDay(cal).getTime();
    const ideal = roundBurndown(startValue * (1 - idx / (horizon - 1)));

    let actual: number | null = null;
    if (dayMs <= todayMs) {
      if (hasSnapshots) {
        actual = roundBurndown(sprintStories.reduce((sum, s) => sum + storyValueAtDay(s, dayMs), 0));
      } else {
        const interpolated = dayIdx <= today1Based
          ? startValue - (startValue - currentActual) * ((dayIdx - 1) / Math.max(today1Based - 1, 1))
          : null;
        actual = interpolated == null ? null : roundBurndown(interpolated);
      }
    }

    return {
      labelShort: flowChartDayLabel(cal),
      ideal,
      actual,
      isToday: dayMs === todayMs,
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
    done: 0,
    approved: 0,
  });
  const byAssignee = new Map<
    string,
    { openCount: number; daysLeftTotal: number; storiesByStatus: WorkloadStoriesByStatus }
  >();
  for (const story of sprintStories) {
    const assignee = story.assignee?.trim() || "Unassigned";
    const row =
      byAssignee.get(assignee) ?? {
        openCount: 0,
        daysLeftTotal: 0,
        storiesByStatus: emptyStatus(),
      };
    if (story.status === "todo") row.storiesByStatus.todo += 1;
    else if (story.status === "inProgress") row.storiesByStatus.inProgress += 1;
    else if (story.status === "done") row.storiesByStatus.done += 1;
    else if (story.status === "approved") row.storiesByStatus.approved += 1;
    if (story.status === "todo" || story.status === "inProgress") {
      row.openCount += 1;
      row.daysLeftTotal += Math.max(0, story.daysLeft ?? 0);
    }
    byAssignee.set(assignee, row);
  }
  const workload = [...byAssignee.entries()]
    .filter(([, v]) => v.openCount > 0)
    .map(([assignee, v]) => ({
      assignee,
      openCount: v.openCount,
      daysLeftTotal: v.daysLeftTotal,
      storiesByStatus: v.storiesByStatus,
    }))
    .sort((a, b) => b.daysLeftTotal - a.daysLeftTotal || b.openCount - a.openCount || a.assignee.localeCompare(b.assignee));
  const workloadMaxDays = Math.max(1, ...workload.map((item) => item.daysLeftTotal));
  const workloadMaxStoryTotal = Math.max(
    1,
    ...workload.map(
      (item) =>
        item.storiesByStatus.todo +
        item.storiesByStatus.inProgress +
        item.storiesByStatus.done +
        item.storiesByStatus.approved,
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

/**
 * Same rules as {@link SprintCapacityBoard} member columns, but respects `filterEpicTeamId` so Insights
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
  filterEpicTeamId?: string | null,
  directoryUsers?: readonly SprintWorkspaceDirectoryUser[] | null,
): string[] {
  const rows = collectStoriesForSprintBoard(initiatives, month, yearSprint, filterEpicTeamId ?? null);
  const storyIds = new Set(rows.map((r) => r.story.id));
  const assigneeRoster = assigneeMatchRosterForSprintTeam(filterEpicTeamId ?? null, directoryUsers);
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
  filterEpicTeamId?: string | null,
  directoryUsers?: readonly SprintWorkspaceDirectoryUser[] | null,
): { workloadCapacityByAssignee: WorkloadCapacityRow[]; workloadSprintCalendarDaysLeft: number } {
  const workloadSprintCalendarDaysLeft = sprintCalendarDaysRemaining(planYear, month, yearSprint);
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
    return { workloadCapacityByAssignee, workloadSprintCalendarDaysLeft };
  }

  const boardStoryRows = collectStoriesForSprintBoard(initiatives, month, yearSprint, filterEpicTeamId ?? null);
  const storyById = new Map(boardStoryRows.map((r) => [r.story.id, r.story]));
  const fullRoster = assigneeMatchRosterForSprintTeam(filterEpicTeamId ?? null, directoryUsers);
  const visibleMembers = sprintCapacityVisibleMemberKeys(
    initiatives,
    month,
    yearSprint,
    capacityBoard,
    filterEpicTeamId,
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
  return { workloadCapacityByAssignee, workloadSprintCalendarDaysLeft };
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
  const m = /^Status changed to (todo|inProgress|done|approved)$/.exec(entry);
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
  chain.push(StoryStatus.done);
  if (finalStatus === StoryStatus.done) return chain;
  chain.push(StoryStatus.approved);
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
  const today = startOfDay(new Date());
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
  const sprintStories = stories.filter((story) => storyMatchesYearSprint(story, month, yearSprint));
  const dayDates = sprintDayDates(planYear, month, yearSprint);

  const sprintFirstDay = dayDates[0];
  const sprintLastDay = dayDates[dayDates.length - 1];
  const todayMs = startOfDay(new Date()).getTime();
  const pastDates = dayDates.filter((d) => startOfDay(d).getTime() <= todayMs);

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
    if (snaps?.length) {
      let best: CfdSnapRow | null = null;
      for (const s of snaps) {
        if (s.dateMs <= dayMs) best = s;
        else break;
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
          let done = 0;
          let approved = 0;
          const dayMs = startOfDay(dayDate).getTime();

          for (const story of sprintStories) {
            const st = hasSnapshots
              ? storyStatusAtDay(story, dayMs)
              : statusAtEndOfDay(story, dayDate, sprintFirstDay, sprintLastDay);
            if (st == null) continue;
            if (st === StoryStatus.todo) todo += 1;
            else if (st === StoryStatus.inProgress) inProgress += 1;
            else if (st === StoryStatus.done) done += 1;
            else if (st === StoryStatus.approved) approved += 1;
          }

          return {
            dayInSprint: dayIndex + 1,
            labelShort: flowChartDayLabel(dayDate),
            isToday: dayMs === todayMs,
            todo,
            inProgress,
            done,
            approved,
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
  filterEpicTeamId?: string | null,
  estimateSource: EstimateSource = "auto",
  sprintCapacityBoard?: { capacities: Record<string, number>; assignments: Record<string, string[]> } | null,
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[] | null,
): SprintAnalyticsData {
  const stories = collectMonthStories(initiatives, month, filterEpicTeamId, estimateSource);
  const workload = buildWorkloadByAssignee(stories, month, yearSprint);
  const capacity = buildWorkloadCapacityByAssignee(
    stories,
    month,
    yearSprint,
    planYear,
    initiatives,
    sprintCapacityBoard,
    filterEpicTeamId,
    workspaceDirectoryUsers,
  );
  const flow = buildFlowTrend(stories, month, yearSprint, planYear);
  return {
    statusPie: buildStatusPie(stories, month, yearSprint),
    burndown: buildBurndown(stories, month, yearSprint, metric, planYear),
    ...workload,
    ...capacity,
    ...flow,
    totalStories: stories.filter((story) => storyMatchesYearSprint(story, month, yearSprint)).length,
  };
}
