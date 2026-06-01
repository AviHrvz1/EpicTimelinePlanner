import { StoryStatus } from "@/lib/generated/prisma";
import {
  type BoardStoryRow,
  collectStoriesForSprintBoard,
} from "@/lib/sprint-plan";
import type { InitiativeItem } from "@/lib/types";

/**
 * Candidate set for the manual "Move unfinished work to next sprint" action.
 *
 * A story is movable when:
 *   - It belongs to the active sprint's board scope (same scope the kanban
 *     and capacity views render), and
 *   - Its status is `todo`, `inProgress`, or `done`.
 *
 * `approved` is intentionally excluded — approved work is shipped and stays
 * on the closed sprint board after the move. The `done` column is included
 * because "done but unsigned-off" is still work the team needs to carry
 * forward; the planner can untick individual rows in the modal if they want
 * a specific done card to remain.
 */
export function collectMovableStoriesForSprint(
  initiatives: InitiativeItem[],
  month: number,
  yearSprint: number,
  filterEpicTeamIds?: string[] | null,
): BoardStoryRow[] {
  return collectStoriesForSprintBoard(initiatives, month, yearSprint, filterEpicTeamIds).filter(
    (row) => row.story.status !== StoryStatus.approved,
  );
}

/**
 * Convenience: group movable rows by their parent epic for the confirmation
 * modal's render. Keeps initiative title around for the subtitle line.
 */
export type SprintMoveGroup = {
  epicId: string;
  epicTitle: string;
  initiativeTitle: string;
  items: BoardStoryRow[];
};

export function groupMovableRowsByEpic(rows: BoardStoryRow[]): SprintMoveGroup[] {
  const map = new Map<string, SprintMoveGroup>();
  for (const row of rows) {
    const existing = map.get(row.epic.id);
    if (existing) {
      existing.items.push(row);
    } else {
      map.set(row.epic.id, {
        epicId: row.epic.id,
        epicTitle: row.epic.title,
        initiativeTitle: row.initiative.title,
        items: [row],
      });
    }
  }
  return [...map.values()];
}
