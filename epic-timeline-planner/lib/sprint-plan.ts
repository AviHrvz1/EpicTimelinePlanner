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

export function collectStoriesForSprintBoard(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
): BoardStoryRow[] {
  const out: BoardStoryRow[] = [];
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null) continue;
    if (initiative.endMonth < month || initiative.startMonth > month) continue;
    for (const epic of initiative.epics ?? []) {
      for (const story of epic.userStories ?? []) {
        if (!storyMatchesYearSprint(story, month, yearSprint)) continue;
        out.push({ story, epic, initiative });
      }
    }
  }
  return out;
}
