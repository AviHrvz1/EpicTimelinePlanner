const LIST_PREFIX = "list-initiative:";
const TIMELINE_PREFIX = "timeline-initiative:";

const EPIC_LIST_PREFIX = "list-epic:";
const EPIC_TIMELINE_PREFIX = "timeline-epic:";
const BACKLOG_SLOT_PREFIX = "backlog-slot:";
const EPIC_BACKLOG_SLOT_PREFIX = "epic-backlog-slot:";

/** Left panel: drop epic here to clear sprint plan (month drill). */
export const EPICS_UNPLAN_DROP_ID = "epics:unplan-drop";

/** Left panel (sprint Kanban): drop story here to clear sprint assignment (unscheduled). */
export const STORIES_UNSCHEDULE_DROP_ID = "stories:unschedule-drop";

export function initiativeListDraggableId(initiativeId: string): string {
  return `${LIST_PREFIX}${initiativeId}`;
}

export function initiativeTimelineDraggableId(initiativeId: string): string {
  return `${TIMELINE_PREFIX}${initiativeId}`;
}

export function isInitiativeDraggableId(activeId: string): boolean {
  return activeId.startsWith(LIST_PREFIX) || activeId.startsWith(TIMELINE_PREFIX);
}

export function parseInitiativeIdFromDraggable(activeId: string): string | null {
  if (activeId.startsWith(LIST_PREFIX)) return activeId.slice(LIST_PREFIX.length);
  if (activeId.startsWith(TIMELINE_PREFIX)) return activeId.slice(TIMELINE_PREFIX.length);
  return null;
}

/** `month:3` or `month:3:lane:0` (lane = Gantt row index, 0-based). */
export function parseMonthDropTarget(overId: string): { month: number; laneIndex?: number } | null {
  const m = /^month:(\d+)(?::lane:(\d+))?$/.exec(overId);
  if (!m) {
    console.log("[gantt-drop] parseMonthDropTarget: no match", { overId });
    return null;
  }
  const month = Number(m[1]);
  if (!Number.isFinite(month)) {
    console.log("[gantt-drop] parseMonthDropTarget: bad month", { overId, month });
    return null;
  }
  if (m[2] !== undefined) {
    const laneIndex = Number(m[2]);
    if (!Number.isFinite(laneIndex)) {
      console.log("[gantt-drop] parseMonthDropTarget: bad lane", { overId, laneIndex });
      return null;
    }
    const result = { month, laneIndex };
    console.log("[gantt-drop] parseMonthDropTarget", { overId, ...result });
    return result;
  }
  const result = { month };
  console.log("[gantt-drop] parseMonthDropTarget (month only, no lane)", { overId, month });
  return result;
}

export function epicListDraggableId(epicId: string): string {
  return `${EPIC_LIST_PREFIX}${epicId}`;
}

export function epicTimelineDraggableId(epicId: string): string {
  return `${EPIC_TIMELINE_PREFIX}${epicId}`;
}

export function isEpicPlanDraggableId(activeId: string): boolean {
  return activeId.startsWith(EPIC_LIST_PREFIX) || activeId.startsWith(EPIC_TIMELINE_PREFIX);
}

export function parseEpicIdFromPlanDraggable(activeId: string): string | null {
  if (activeId.startsWith(EPIC_LIST_PREFIX)) return activeId.slice(EPIC_LIST_PREFIX.length);
  if (activeId.startsWith(EPIC_TIMELINE_PREFIX)) return activeId.slice(EPIC_TIMELINE_PREFIX.length);
  return null;
}

/** Droppable id for placing an initiative at a backlog list index. */
export function backlogSlotDropId(index: number): string {
  return `${BACKLOG_SLOT_PREFIX}${index}`;
}

export function parseBacklogSlotDropId(overId: string): number | null {
  if (!overId.startsWith(BACKLOG_SLOT_PREFIX)) return null;
  const idx = Number(overId.slice(BACKLOG_SLOT_PREFIX.length));
  if (!Number.isFinite(idx) || idx < 0) return null;
  return idx;
}

/** Droppable id for placing an epic at an index in month epic backlog. */
export function epicBacklogSlotDropId(month: number, index: number): string {
  return `${EPIC_BACKLOG_SLOT_PREFIX}${month}:${index}`;
}

export function parseEpicBacklogSlotDropId(overId: string): { month: number; index: number } | null {
  if (!overId.startsWith(EPIC_BACKLOG_SLOT_PREFIX)) return null;
  const rest = overId.slice(EPIC_BACKLOG_SLOT_PREFIX.length);
  const [monthRaw, indexRaw] = rest.split(":");
  const month = Number(monthRaw);
  const index = Number(indexRaw);
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  if (!Number.isFinite(index) || index < 0) return null;
  return { month, index };
}

const STORY_LIST_PREFIX = "story:list:";
const STORY_BOARD_PREFIX = "story:board:";

export function storyListDraggableId(storyId: string): string {
  return `${STORY_LIST_PREFIX}${storyId}`;
}

export function storyBoardDraggableId(storyId: string): string {
  return `${STORY_BOARD_PREFIX}${storyId}`;
}

export function isStoryDraggableId(activeId: string): boolean {
  return activeId.startsWith(STORY_LIST_PREFIX) || activeId.startsWith(STORY_BOARD_PREFIX);
}

export function parseStoryIdFromDraggable(activeId: string): string | null {
  if (activeId.startsWith(STORY_LIST_PREFIX)) return activeId.slice(STORY_LIST_PREFIX.length);
  if (activeId.startsWith(STORY_BOARD_PREFIX)) return activeId.slice(STORY_BOARD_PREFIX.length);
  return null;
}

/** Droppable id for sprint kanban columns: month, sprint lane (1|2), StoryStatus. */
export function sprintKanbanDropId(month: number, sprint: 1 | 2, status: string): string {
  return `kanban:${month}:${sprint}:${status}`;
}
