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
  /**
   * Dedupe short-name entries when the directory has a full-name match.
   *
   * Legacy data or partially-typed assignees can leave `"Aaron"` in a
   * story while the directory canonical entry is `"Aaron Mendel"` — both
   * end up in the set above, so the picker shows two rows for the same
   * person. Here we drop the bare first-name version whenever any
   * directory user's first token (case-insensitive) matches it.
   *
   * Doesn't drop names without a matching full-name entry (e.g. a
   * single-word name in the roster like `"Mei"` with no longer form in
   * the directory survives).
   */
  if (directoryUsers && directoryUsers.length > 0) {
    const directoryFirstTokens = new Set<string>();
    for (const u of directoryUsers) {
      const name = u.name?.trim() ?? "";
      const first = name.split(/\s+/)[0]?.toLowerCase() ?? "";
      if (first && name.includes(" ")) directoryFirstTokens.add(first);
    }
    if (directoryFirstTokens.size > 0) {
      for (const candidate of [...set]) {
        if (candidate.includes(" ")) continue;
        if (directoryFirstTokens.has(candidate.toLowerCase())) set.delete(candidate);
      }
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
