const LIST_PREFIX = "list-initiative:";
const TIMELINE_PREFIX = "timeline-initiative:";

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
