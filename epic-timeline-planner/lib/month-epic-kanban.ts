import { StoryStatus } from "@/lib/generated/prisma";
import { EpicItem, InitiativeItem } from "@/lib/types";

/** Epics under initiatives scheduled in this calendar month (same scope as month epic panel). */
export function collectEpicsForMonthStatusBoard(
  initiatives: InitiativeItem[],
  month: number,
): Array<{ epic: EpicItem; initiative: InitiativeItem }> {
  const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled") continue;
    if (initiative.startMonth == null || initiative.endMonth == null) continue;
    if (initiative.endMonth < month || initiative.startMonth > month) continue;
    for (const epic of initiative.epics ?? []) {
      rows.push({ epic, initiative });
    }
  }
  return [...rows].sort((a, b) => {
    const byInit = a.initiative.title.localeCompare(b.initiative.title);
    if (byInit !== 0) return byInit;
    return a.epic.title.localeCompare(b.epic.title);
  });
}

/**
 * Rolled-up epic column from child story statuses:
 * — Any story in progress → epic in In progress
 * — All done → Approved
 * — All review → Done
 * — All to do → To do
 * — Mixed completion otherwise → In progress
 */
export function deriveEpicAggregateStatus(epic: EpicItem): StoryStatus {
  const stories = epic.userStories ?? [];
  if (stories.length === 0) return StoryStatus.todo;
  if (stories.some((s) => s.status === StoryStatus.inProgress)) return StoryStatus.inProgress;
  if (stories.every((s) => s.status === StoryStatus.done)) return StoryStatus.done;
  if (stories.every((s) => s.status === StoryStatus.review)) return StoryStatus.review;
  if (stories.every((s) => s.status === StoryStatus.todo)) return StoryStatus.todo;
  return StoryStatus.inProgress;
}
