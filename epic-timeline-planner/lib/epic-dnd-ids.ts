const LIST_PREFIX = "list-initiative:";
const TIMELINE_PREFIX = "timeline-initiative:";

const EPIC_LIST_PREFIX = "list-epic:";
const EPIC_TIMELINE_PREFIX = "timeline-epic:";

/** Left panel: drop epic here to clear sprint plan (month drill). */
export const EPICS_UNPLAN_DROP_ID = "epics:unplan-drop";

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
