import { StoryStatus } from "@/lib/generated/prisma";
import {
  resolveEpicPlanYearSprint,
  resolveStoryYearSprint,
} from "@/lib/year-sprint";
import { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";

export function storyMatchesYearSprint(
  story: UserStoryItem,
  contextMonth: number,
  targetGlobalSprint: number,
): boolean {
  const g = resolveStoryYearSprint(story, contextMonth);
  return g === targetGlobalSprint;
}

export function epicPlanMatchesYearSprint(epic: EpicItem, month: number, targetGlobalSprint: number): boolean {
  if (epic.planStartMonth == null || epic.planEndMonth == null) return false;
  if (epic.planEndMonth < month || epic.planStartMonth > month) return false;
  if (epic.planSprint == null) return false;
  const g = resolveEpicPlanYearSprint(epic);
  return g === targetGlobalSprint;
}

/** @deprecated alias */
export function epicIsPlannedForMonthAndSprint(
  epic: EpicItem,
  month: number,
  yearSprint: number,
): boolean {
  return epicPlanMatchesYearSprint(epic, month, yearSprint);
}

export type BoardStoryRow = { story: UserStoryItem; epic: EpicItem; initiative: InitiativeItem };

export function collectPlannedEpicsForMonth(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
): Array<{ epic: EpicItem; initiative: InitiativeItem }> {
  const out: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null) {
      continue;
    }
    if (initiative.endMonth < month || initiative.startMonth > month) continue;
    for (const epic of initiative.epics ?? []) {
      if (!epicPlanMatchesYearSprint(epic, month, yearSprint)) continue;
      out.push({ epic, initiative });
    }
  }
  return out;
}

/** Epic has a Gantt plan overlapping `month` (same rule as left panel month list). */
function epicIsOnPlanForMonth(epic: EpicItem, month: number): boolean {
  if (epic.planSprint == null || epic.planStartMonth == null || epic.planEndMonth == null) return false;
  return epic.planStartMonth <= month && epic.planEndMonth >= month;
}

/**
 * Epics shown in the month/sprint left panel for a month (planned in month
 * or unscheduled under an in-scope initiative), optionally narrowed to a
 * delivery team when opening that team's sprint board.
 *
 * No overflow expansion: an epic appears here only when its plan overlaps
 * this month, or when it's unscheduled under an in-scope initiative. The
 * Phase 3 "epic has a story whose current sprint lands in this month"
 * branch was retired alongside auto-rollover — moves are deliberate now and
 * each story's `story.sprint` already points at the right month.
 */
export function collectMonthScopeEpicsForSprintPanel(
  initiatives: InitiativeItem[],
  month: number,
  filterEpicTeamIds?: string[] | null,
): Array<{ epic: EpicItem; initiative: InitiativeItem }> {
  const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
  for (const initiative of initiatives) {
    const initiativeIsInMonthScope =
      initiative.status === "scheduled" &&
      initiative.startMonth != null &&
      initiative.endMonth != null &&
      initiative.startMonth <= month &&
      initiative.endMonth >= month;
    const initiativeHasPlannedEpicInMonth = (initiative.epics ?? []).some((epic) =>
      epicIsOnPlanForMonth(epic, month),
    );
    for (const epic of initiative.epics ?? []) {
      if (filterEpicTeamIds?.length && !filterEpicTeamIds.includes(epic.team ?? "")) continue;
      const isPlannedInMonth = epicIsOnPlanForMonth(epic, month);
      const isUnscheduled =
        epic.planSprint == null && epic.planStartMonth == null && epic.planEndMonth == null;
      const includeUnscheduled = isUnscheduled && (initiativeIsInMonthScope || initiativeHasPlannedEpicInMonth);
      if (!isPlannedInMonth && !includeUnscheduled) continue;
      rows.push({ epic, initiative });
    }
  }
  return rows;
}

/**
 * Stories rendered on the sprint Kanban: every story whose `story.sprint`
 * matches the active global sprint, regardless of its parent epic's plan
 * window. The previous scope (epics planned in `month`) was correct under
 * Phase 3 auto-rollover but loses moved cards now — when the user moves
 * Sprint 10 work forward to Sprint 11 (June), those stories still live on
 * May-planned epics, so a strict epic-scope filter would hide them on
 * Sprint 11's kanban. The team filter (`filterEpicTeamIds`) stays — moves
 * never change a story's team.
 */
export function collectStoriesForSprintBoard(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
  /** When set, only stories whose effective team (story.team ?? epic.team)
   *  is one of these. Per-story override lets a planner pull a single
   *  story across team boundaries without splitting the epic. */
  filterEpicTeamIds?: string[] | null,
): BoardStoryRow[] {
  const out: BoardStoryRow[] = [];
  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      for (const story of epic.userStories ?? []) {
        if (!storyMatchesYearSprint(story, month, yearSprint)) continue;
        if (filterEpicTeamIds?.length && !filterEpicTeamIds.includes((story.team ?? epic.team) ?? "")) continue;
        out.push({ story, epic, initiative });
      }
    }
  }
  return out;
}

export type BoardEpicRow = { epic: EpicItem; initiative: InitiativeItem; sprintStatus: StoryStatus };

/** Status of an epic derived only from its stories scheduled on the active sprint. */
export function deriveEpicSprintStatus(epic: EpicItem, month: number, yearSprint: number): StoryStatus {
  const sprintStories = (epic.userStories ?? []).filter((s) => storyMatchesYearSprint(s, month, yearSprint));
  if (sprintStories.length === 0) return StoryStatus.todo;
  if (sprintStories.some((s) => s.status === StoryStatus.inProgress)) return StoryStatus.inProgress;
  if (sprintStories.every((s) => s.status === StoryStatus.done)) return StoryStatus.done;
  if (sprintStories.every((s) => s.status === StoryStatus.review || s.status === StoryStatus.done)) return StoryStatus.review;
  if (sprintStories.every((s) => s.status === StoryStatus.todo)) return StoryStatus.todo;
  return StoryStatus.inProgress;
}

/** Epics rendered as rows on the sprint kanban — derived from the stories
 *  actually on the active sprint (so a row appears even when the epic's
 *  plan window doesn't cover this month, e.g. a story was moved forward
 *  from the previous sprint into this one). */
export function collectEpicsForSprintKanban(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
  filterEpicTeamIds?: string[] | null,
): BoardEpicRow[] {
  const rows = new Map<string, BoardEpicRow>();
  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      // Include the epic when AT LEAST ONE of its sprint-active stories
      // has an effective team in the filter (story override > epic.team).
      // This way an epic whose stories all moved to another team via
      // override still shows under that team's column.
      const hasFilterMatch = (epic.userStories ?? []).some((s) => {
        if (!storyMatchesYearSprint(s, month, yearSprint)) return false;
        if (!filterEpicTeamIds?.length) return true;
        return filterEpicTeamIds.includes((s.team ?? epic.team) ?? "");
      });
      if (!hasFilterMatch) continue;
      rows.set(epic.id, {
        epic,
        initiative,
        sprintStatus: deriveEpicSprintStatus(epic, month, yearSprint),
      });
    }
  }
  return [...rows.values()];
}

export type SprintKanbanSummaryStats = {
  epicCount: number;
  storyUnscheduled: number;
  storyScheduledOnKanban: number;
  storyTotal: number;
};

/** Header chips for sprint Kanban: epic count = epics with stories on the
 *  active sprint (matches the kanban row set); story counts cover every
 *  story under the same team-filtered epics so the unscheduled / total
 *  framing stays honest with the left-panel scope. */
export function computeSprintKanbanSummaryStats(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
  filterEpicTeamIds?: string[] | null,
): SprintKanbanSummaryStats {
  const epicIdsOnSprint = new Set<string>();
  let storyScheduledOnKanban = 0;
  let storyTotal = 0;
  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      let epicHasStoryOnSprint = false;
      for (const story of epic.userStories ?? []) {
        // Per-story team filter: use effective team (story.team ?? epic.team).
        if (filterEpicTeamIds?.length && !filterEpicTeamIds.includes((story.team ?? epic.team) ?? "")) continue;
        storyTotal += 1;
        if (storyMatchesYearSprint(story, month, yearSprint)) {
          storyScheduledOnKanban += 1;
          epicHasStoryOnSprint = true;
        }
      }
      if (epicHasStoryOnSprint) epicIdsOnSprint.add(epic.id);
    }
  }
  return {
    epicCount: epicIdsOnSprint.size,
    storyUnscheduled: storyTotal - storyScheduledOnKanban,
    storyScheduledOnKanban,
    storyTotal,
  };
}
