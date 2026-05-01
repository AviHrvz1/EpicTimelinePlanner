import { fullDeliveryCapacityRoster } from "@/lib/sprint-capacity";
import type { InitiativeItem } from "@/lib/types";

/** Delivery roster plus every assignee string already used on initiatives, epics, and stories (sorted). */
export function collectAssigneeNameSuggestions(initiatives: InitiativeItem[]): string[] {
  const set = new Set<string>(fullDeliveryCapacityRoster());
  for (const init of initiatives) {
    if (init.assignee?.trim()) set.add(init.assignee.trim());
    for (const epic of init.epics ?? []) {
      if (epic.assignee?.trim()) set.add(epic.assignee.trim());
      for (const story of epic.userStories ?? []) {
        if (story.assignee?.trim()) set.add(story.assignee.trim());
      }
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
