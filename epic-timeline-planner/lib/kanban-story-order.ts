import { StoryStatus } from "@/lib/generated/prisma";
import type { BoardStoryRow } from "@/lib/sprint-plan";
import type { InitiativeItem } from "@/lib/types";

export const KANBAN_COLUMN_STATUSES: StoryStatus[] = [
  StoryStatus.todo,
  StoryStatus.inProgress,
  StoryStatus.done,
  StoryStatus.approved,
];

export type KanbanStoryOrderPatch = {
  storyId: string;
  backlogOrder: number;
  status?: StoryStatus;
  sprint?: number;
};

function cmpBoardRow(a: BoardStoryRow, b: BoardStoryRow): number {
  const ao = a.story.backlogOrder ?? 0;
  const bo = b.story.backlogOrder ?? 0;
  if (ao !== bo) return ao - bo;
  const t = a.story.title.localeCompare(b.story.title, undefined, { sensitivity: "base" });
  if (t !== 0) return t;
  return a.story.id.localeCompare(b.story.id);
}

/** Move one item from `from` to `to` (same semantics as @dnd-kit/sortable `arrayMove`). */
function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const next = [...array];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Ordered story ids per Kanban column for the current sprint board rows. */
export function kanbanOrderedIdsByStatus(rows: BoardStoryRow[]): Record<StoryStatus, string[]> {
  const out: Record<StoryStatus, string[]> = {
    [StoryStatus.todo]: [],
    [StoryStatus.inProgress]: [],
    [StoryStatus.done]: [],
    [StoryStatus.approved]: [],
  };
  for (const st of KANBAN_COLUMN_STATUSES) {
    const inCol = rows.filter((r) => r.story.status === st);
    inCol.sort(cmpBoardRow);
    out[st] = inCol.map((r) => r.story.id);
  }
  return out;
}

/**
 * Reorder after dropping `activeStoryId` onto `overStoryId`.
 * Same column: `arrayMove` to over’s index (so dragging down past a card can move below it).
 * Cross-column: insert before `overStoryId`, then renumber `backlogOrder` for affected stories.
 */
export function computeKanbanStoryReorderPatches(args: {
  boardRows: BoardStoryRow[];
  activeStoryId: string;
  overStoryId: string;
  targetSprint: number;
}): KanbanStoryOrderPatch[] | null {
  const { boardRows, activeStoryId, overStoryId, targetSprint } = args;
  if (activeStoryId === overStoryId) return [];

  const overRow = boardRows.find((r) => r.story.id === overStoryId);
  if (!overRow) return null;

  const lists = kanbanOrderedIdsByStatus(boardRows);
  const overStatus = overRow.story.status;
  const columnIds = lists[overStatus];
  const activeIdx = columnIds.indexOf(activeStoryId);
  const overIdx = columnIds.indexOf(overStoryId);
  if (overIdx < 0) return null;

  if (activeIdx >= 0) {
    // Same column: move active to over’s index (matches board DnD / “drop on card” behavior).
    if (activeIdx === overIdx) return [];
    lists[overStatus] = arrayMove([...columnIds], activeIdx, overIdx);
  } else {
    // Cross-column: insert before the card dropped on.
    for (const st of KANBAN_COLUMN_STATUSES) {
      lists[st] = lists[st].filter((id) => id !== activeStoryId);
    }
    const toList = [...lists[overStatus]];
    const i = toList.indexOf(overStoryId);
    if (i < 0) return null;
    toList.splice(i, 0, activeStoryId);
    lists[overStatus] = toList;
  }

  const patches: KanbanStoryOrderPatch[] = [];
  for (const st of KANBAN_COLUMN_STATUSES) {
    const ids = lists[st];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const prevRow = boardRows.find((r) => r.story.id === id);
      const nextOrder = i;

      if (id === activeStoryId) {
        if (
          !prevRow ||
          (prevRow.story.backlogOrder ?? 0) !== nextOrder ||
          prevRow.story.status !== st ||
          prevRow.story.sprint !== targetSprint
        ) {
          patches.push({
            storyId: id,
            backlogOrder: nextOrder,
            status: st,
            sprint: targetSprint,
          });
        }
      } else if (prevRow && (prevRow.story.backlogOrder ?? 0) !== nextOrder) {
        patches.push({ storyId: id, backlogOrder: nextOrder });
      }
    }
  }
  return patches;
}

export function applyKanbanOrderPatchesToInitiatives(
  initiatives: InitiativeItem[],
  patches: KanbanStoryOrderPatch[],
): InitiativeItem[] {
  const map = new Map(patches.map((p) => [p.storyId, p]));
  return initiatives.map((init) => ({
    ...init,
    epics: (init.epics ?? []).map((epic) => ({
      ...epic,
      userStories: (epic.userStories ?? []).map((story) => {
        const p = map.get(story.id);
        if (!p) return story;
        return {
          ...story,
          backlogOrder: p.backlogOrder,
          ...(p.status !== undefined ? { status: p.status } : {}),
          ...(p.sprint !== undefined ? { sprint: p.sprint } : {}),
        };
      }),
    })),
  }));
}
