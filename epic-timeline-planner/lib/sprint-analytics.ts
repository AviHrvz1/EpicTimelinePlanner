import { StoryStatus } from "@/lib/generated/prisma";
import { epicOriginalEstimateDays, epicStoryEstimateDaysSum, type EstimateSource } from "@/lib/epic-estimates";
import { storyMatchesYearSprint } from "@/lib/sprint-plan";
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

  let startValue = 0;
  let actualRemaining = 0;
  if (metric === "daysLeft") {
    startValue = sprintStories.reduce((sum, s) => sum + (s.estimatedDays ?? s.daysLeft ?? 1), 0);
    actualRemaining = sprintStories.reduce((sum, s) => sum + (s.daysLeft ?? 0), 0);
  } else {
    startValue = sprintStories.length;
    actualRemaining = sprintStories.filter((s) => s.status !== "done" && s.status !== "approved").length;
  }

  const today1Based = sprintCalendarToday1Based(dayDates);
  const roundBurndown = (n: number) => (metric === "storyCount" ? Math.round(n) : Number(n.toFixed(1)));
  const todayStart = startOfDay(new Date()).getTime();

  if (horizon === 1) {
    const cal = dayDates[0] ?? new Date(planYear, month - 1, 1);
    return [
      {
        labelShort: flowChartDayLabel(cal),
        ideal: roundBurndown(0),
        actual: roundBurndown(actualRemaining),
        isToday: startOfDay(cal).getTime() === todayStart,
      },
    ];
  }

  return dayDates.map((cal, idx) => {
    const dayIdx = idx + 1;
    const ideal = startValue * (1 - idx / (horizon - 1));
    const actual =
      dayIdx <= today1Based
        ? startValue - (startValue - actualRemaining) * ((dayIdx - 1) / Math.max(today1Based - 1, 1))
        : null;
    return {
      labelShort: flowChartDayLabel(cal),
      ideal: roundBurndown(ideal),
      actual: actual == null ? null : roundBurndown(actual),
      isToday: startOfDay(cal).getTime() === todayStart,
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

function buildWorkloadCapacityByAssignee(
  stories: UserStoryItem[],
  month: number,
  yearSprint: number,
  planYear: number,
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
  const todayStart = startOfDay(new Date());

  const flowSprintTrendData =
    dayDates.length === 0
      ? []
      : dayDates.map((dayDate, dayIndex) => {
          const assigneesTodo = new Set<string>();
          const assigneesInProgress = new Set<string>();
          const assigneesDone = new Set<string>();
          const assigneesApproved = new Set<string>();

          for (const story of sprintStories) {
            const st = statusAtEndOfDay(story, dayDate, sprintFirstDay, sprintLastDay);
            if (st == null) continue;
            const a = story.assignee?.trim() || "Unassigned";
            if (st === StoryStatus.todo) assigneesTodo.add(a);
            else if (st === StoryStatus.inProgress) assigneesInProgress.add(a);
            else if (st === StoryStatus.done) assigneesDone.add(a);
            else if (st === StoryStatus.approved) assigneesApproved.add(a);
          }

          return {
            dayInSprint: dayIndex + 1,
            labelShort: flowChartDayLabel(dayDate),
            isToday: startOfDay(dayDate).getTime() === todayStart.getTime(),
            todo: assigneesTodo.size,
            inProgress: assigneesInProgress.size,
            done: assigneesDone.size,
            approved: assigneesApproved.size,
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
): SprintAnalyticsData {
  const stories = collectMonthStories(initiatives, month, filterEpicTeamId, estimateSource);
  const workload = buildWorkloadByAssignee(stories, month, yearSprint);
  const capacity = buildWorkloadCapacityByAssignee(stories, month, yearSprint, planYear);
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
