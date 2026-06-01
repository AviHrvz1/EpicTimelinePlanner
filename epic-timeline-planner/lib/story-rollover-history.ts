import type { EpicItem, InitiativeItem, StoryHistoryItem, UserStoryItem } from "@/lib/types";

/**
 * Rollover lineage derived from `story.history`. Two wordings exist in the
 * wild because the source of the move changed over time:
 *
 *   - Legacy auto-rollover effect (retired):
 *     "System auto-move: story moved from Sprint 6 to Sprint 7 after sprint close."
 *   - Current `SprintMoveModal` flow:
 *     "Manual move: story moved from Sprint 6 to Sprint 7 at sprint close."
 *
 * Both produce a story.sprint change and should surface as rollover lineage.
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

const ROLLOVER_PATTERN = /(?:System auto-move|Manual move):\s*story moved from Sprint (\d+) to Sprint (\d+)/i;

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

/** Stories whose rollover history shows they rolled INTO or OUT OF
 *  `sprint`. The `fromSprint` field is named for the inbound case (origin
 *  sprint); for the outbound case it carries the DESTINATION sprint so the
 *  shared audit modal can label it generically ("From" vs "To") without
 *  needing two separate row types. */
export type RolledInStoryRow = RolloverStoryRow & { fromSprint: number };

/** Stories whose rollover history shows they rolled OUT of `sprint`,
 *  regardless of where their current `story.sprint` now sits. The
 *  `fromSprint` field carries the rollover DESTINATION (where the story
 *  ended up) — see {@link RolledInStoryRow}. */
export function collectStoriesRolledOutOfSprint(
  initiatives: InitiativeItem[],
  sprint: number,
): RolledInStoryRow[] {
  const out: RolledInStoryRow[] = [];
  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      for (const story of epic.userStories ?? []) {
        if (!storyRolledOutOfSprint(story, sprint)) continue;
        const info = parseStoryRollover(story);
        if (info.rolledToSprint == null) continue;
        out.push({ story, epic, initiative, fromSprint: info.rolledToSprint });
      }
    }
  }
  return out;
}

/** Stories whose rollover history shows they rolled INTO `sprint` — i.e.
 *  the destination of the most recent move chain matches `sprint`. Used to
 *  power the "Rolled in" audit chip on the destination sprint so the
 *  planner can see at a glance what carried over from the prior sprint.
 *  Each row carries the source sprint for display. */
export function collectStoriesRolledIntoSprint(
  initiatives: InitiativeItem[],
  sprint: number,
): RolledInStoryRow[] {
  const out: RolledInStoryRow[] = [];
  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      for (const story of epic.userStories ?? []) {
        if (!storyRolledIntoSprint(story, sprint)) continue;
        const info = parseStoryRollover(story);
        if (info.rolledFromSprint == null) continue;
        out.push({ story, epic, initiative, fromSprint: info.rolledFromSprint });
      }
    }
  }
  return out;
}
