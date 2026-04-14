import { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";

/** Epic’s quarter plan covers this calendar month and sprint lane. */
export function epicIsPlannedForMonthAndSprint(epic: EpicItem, month: number, sprintLane: 1 | 2): boolean {
  if (epic.planSprint !== sprintLane) return false;
  if (epic.planStartMonth == null || epic.planEndMonth == null) return false;
  if (epic.planEndMonth < month || epic.planStartMonth > month) return false;
  return true;
}

/** Epics planned for a single calendar month in a given sprint lane (month drill-down view). */
export function collectPlannedEpicsForMonth(
  initiatives: InitiativeItem[],
  sprintLane: 1 | 2,
  month: number,
): Array<{ epic: EpicItem; initiative: InitiativeItem }> {
  const out: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null) {
      continue;
    }
    if (initiative.endMonth < month || initiative.startMonth > month) continue;
    for (const epic of initiative.epics ?? []) {
      if (!epicIsPlannedForMonthAndSprint(epic, month, sprintLane)) continue;
      out.push({ epic, initiative });
    }
  }
  return out;
}

export type BoardStoryRow = { story: UserStoryItem; epic: EpicItem; initiative: InitiativeItem };

/** Stories shown on this sprint board (initiative scheduled in month; story assigned to this sprint lane). */
export function collectStoriesForSprintBoard(
  initiatives: InitiativeItem[],
  sprintLane: 1 | 2,
  month: number,
): BoardStoryRow[] {
  const out: BoardStoryRow[] = [];
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null) continue;
    if (initiative.endMonth < month || initiative.startMonth > month) continue;
    for (const epic of initiative.epics ?? []) {
      for (const story of epic.userStories ?? []) {
        if (story.sprint !== sprintLane) continue;
        out.push({ story, epic, initiative });
      }
    }
  }
  return out;
}
