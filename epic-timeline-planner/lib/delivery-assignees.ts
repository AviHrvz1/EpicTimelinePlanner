import { fullDeliveryCapacityRoster } from "@/lib/sprint-capacity";
import type { InitiativeItem } from "@/lib/types";

/**
 * Delivery roster + every assignee string already in use on initiatives /
 * epics / stories + (optional) workspace directory members. Pass
 * `directoryUsers` from the caller to ensure directory-only people show up
 * in the autocomplete even when they have no assignments yet — otherwise a
 * brand-new user is invisible until you assign them to something.
 */
export function collectAssigneeNameSuggestions(
  initiatives: InitiativeItem[],
  directoryUsers?: readonly { name: string }[] | null,
): string[] {
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
  if (directoryUsers) {
    for (const u of directoryUsers) {
      const name = u.name?.trim();
      if (name) set.add(name);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
