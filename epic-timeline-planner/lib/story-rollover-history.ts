import type { EpicItem, InitiativeItem, StoryHistoryItem, UserStoryItem } from "@/lib/types";

/**
 * Rollover lineage derived from `story.history`. The auto-rollover effect
 * writes a single text line per move (see `epic-planner-app.tsx` rollover
 * effect → `historyEntry`), e.g.
 *
 *   "System auto-move: story moved from Sprint 6 to Sprint 7 after sprint close."
 *
 * Reading those back is a regex over each entry. We deliberately keep this in
 * a single helper so any future change to the line wording is one find/replace
 * away.
 */
export type StoryRolloverInfo = {
  /** Sprint the story started in (origin of the first rollover step). `null`
   *  when no rollover has happened yet. */
  rolledFromSprint: number | null;
  /** Sprint the story landed in after the most recent rollover step. `null`
   *  when no rollover has happened yet. Equal to `story.sprint` in the steady
   *  state, but populated even when the story has since been moved manually. */
  rolledToSprint: number | null;
  /** Number of rollover steps the story has been through. 0 when no rollover.
   *  ≥ 2 indicates a chained rollover (e.g. S6 → S7 → S8). */
  chainDepth: number;
};

const ROLLOVER_PATTERN = /System auto-move:\s*story moved from Sprint (\d+) to Sprint (\d+)/i;

export function parseStoryRollover(
  story: Pick<UserStoryItem, "history">,
): StoryRolloverInfo {
  const history: StoryHistoryItem[] = story.history ?? [];
  let earliestFrom: number | null = null;
  let latestTo: number | null = null;
  let chainDepth = 0;
  for (const entry of history) {
    const match = ROLLOVER_PATTERN.exec(entry.entry ?? "");
    if (!match) continue;
    const fromSprint = Number(match[1]);
    const toSprint = Number(match[2]);
    if (!Number.isFinite(fromSprint) || !Number.isFinite(toSprint)) continue;
    chainDepth += 1;
    if (earliestFrom == null) earliestFrom = fromSprint;
    latestTo = toSprint;
  }
  return { rolledFromSprint: earliestFrom, rolledToSprint: latestTo, chainDepth };
}

/** Convenience: did this story roll *into* the given sprint as part of its
 *  most-recent rollover step? Used by current-sprint kanban cards to decide
 *  whether to show a `↩ S{from}` pill. */
export function storyRolledIntoSprint(
  story: Pick<UserStoryItem, "history">,
  sprint: number,
): boolean {
  const info = parseStoryRollover(story);
  return info.rolledToSprint === sprint && info.rolledFromSprint != null;
}

/** Convenience: did this story roll *out of* the given sprint? Used by
 *  closed-sprint kanban cards to decide whether to show a `↪ S{to}` pill. */
export function storyRolledOutOfSprint(
  story: Pick<UserStoryItem, "history">,
  sprint: number,
): boolean {
  const info = parseStoryRollover(story);
  if (info.rolledFromSprint == null || info.rolledToSprint == null) return false;
  // The history records every hop, so a story that hopped S6 → S7 → S8 should
  // show "↪ S8" on both the S6 and S7 closed-sprint views. The `from` value
  // captures the *earliest* origin, so `sprint >= from && sprint < to` is the
  // window where this pill applies.
  return sprint >= info.rolledFromSprint && sprint < info.rolledToSprint;
}

/**
 * Snapshot helper used by {@link SnapshotHeaderStrip} +
 * {@link RolloverOverflowModal} to surface a "what rolled out of this
 * sprint" list on closed sprint views. Reads from rollover history so the
 * audit trail survives even though the closed sprint kanban no longer
 * scope-expands moved cards (Phase 3 retired).
 */
export type RolloverStoryRow = { story: UserStoryItem; epic: EpicItem; initiative: InitiativeItem };

/** Stories whose rollover history shows they rolled OUT of `sprint`,
 *  regardless of where their current `story.sprint` now sits. */
export function collectStoriesRolledOutOfSprint(
  initiatives: InitiativeItem[],
  sprint: number,
): RolloverStoryRow[] {
  const out: RolloverStoryRow[] = [];
  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      for (const story of epic.userStories ?? []) {
        if (!storyRolledOutOfSprint(story, sprint)) continue;
        out.push({ story, epic, initiative });
      }
    }
  }
  return out;
}
