import { resolveEpicPlanYearSprint, resolveStoryYearSprint } from "@/lib/year-sprint";
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
 * Epics shown in the month/sprint left panel for a month (planned in month or unscheduled under an in-scope initiative),
 * optionally narrowed to a delivery team when opening that team’s sprint board.
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
 * Stories rendered on the sprint Kanban: same epic scope as the month/sprint left panel
 * (`collectMonthScopeEpicsForSprintPanel`), filtered to the active global sprint.
 * Using only “scheduled initiatives overlapping month” excluded unscheduled epics that still
 * appear in the panel, so cards could disappear after a successful drop.
 */
export function collectStoriesForSprintBoard(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
  /** When set, only stories under epics assigned to one of these teams. */
  filterEpicTeamIds?: string[] | null,
): BoardStoryRow[] {
  const scope = collectMonthScopeEpicsForSprintPanel(initiatives, month, filterEpicTeamIds);
  const out: BoardStoryRow[] = [];
  for (const { epic, initiative } of scope) {
    for (const story of epic.userStories ?? []) {
      if (!storyMatchesYearSprint(story, month, yearSprint)) continue;
      out.push({ story, epic, initiative });
    }
  }
  return out;
}

export type SprintKanbanSummaryStats = {
  epicCount: number;
  storyUnscheduled: number;
  storyScheduledOnKanban: number;
  storyTotal: number;
};

/** Header chips for sprint Kanban: epics in left-panel scope, story counts for the active global sprint. */
export function computeSprintKanbanSummaryStats(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
  filterEpicTeamIds?: string[] | null,
): SprintKanbanSummaryStats {
  const scope = collectMonthScopeEpicsForSprintPanel(initiatives, month, filterEpicTeamIds);
  let storyScheduledOnKanban = 0;
  let storyTotal = 0;
  for (const { epic } of scope) {
    for (const story of epic.userStories ?? []) {
      storyTotal += 1;
      if (storyMatchesYearSprint(story, month, yearSprint)) {
        storyScheduledOnKanban += 1;
      }
    }
  }
  return {
    epicCount: scope.length,
    storyUnscheduled: storyTotal - storyScheduledOnKanban,
    storyScheduledOnKanban,
    storyTotal,
  };
}
