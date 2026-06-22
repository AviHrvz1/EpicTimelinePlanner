/**
 * Canonical workflow-status rollup used everywhere a list of stories
 * needs a single workflow verdict — Hero Work Progress donut (initiative
 * + epic scopes), Gantt initiative-bar status filter / status badge,
 * Initiative side panel's external-status filter.
 *
 * Same priority ladder as the per-epic `deriveEpicStatusKey` in
 * `timeline-grid.tsx`: "any in-flight wins → all-done wins next →
 * everything else folds to todo". Centralising it keeps every surface
 * agreeing on what e.g. "the In progress slice" means; otherwise
 * subtle drift between the donut, the Gantt filter, and the panel
 * produces counts that look correct in isolation but disagree under
 * a single click.
 *
 * Backlog stories (`sprint == null`) are filtered out before the
 * rollup. They carry the default `status="todo"` from creation but
 * represent "no execution signal yet" — counting them would leak the
 * default into the parent's status pill. If no sprinted stories
 * remain after filtering, the rollup returns null exactly like the
 * empty-stories case.
 *
 * Returns null when the input has zero sprinted stories — callers
 * decide whether to surface that as "no verdict" (Gantt: drop from
 * filter) or fold to "todo" (donut: count it as a todo initiative).
 */
import type { UserStoryItem } from "@/lib/types";

export type WorkflowStatusKey = NonNullable<UserStoryItem["status"]>;

export function rollupWorkflowStatus(
  stories: ReadonlyArray<{ status: string | null | undefined; sprint?: number | null }>,
): WorkflowStatusKey | null {
  const sprinted = stories.filter((s) => s.sprint != null);
  if (sprinted.length === 0) return null;
  const counts = { todo: 0, inProgress: 0, review: 0, done: 0 };
  for (const s of sprinted) {
    if (
      s.status === "todo" ||
      s.status === "inProgress" ||
      s.status === "review" ||
      s.status === "done"
    ) {
      counts[s.status] += 1;
    }
  }
  if (counts.inProgress > 0) return "inProgress";
  if (counts.done === sprinted.length) return "done";
  if (counts.done > 0 && counts.todo === 0) return "done";
  if (counts.review === sprinted.length) return "review";
  if (counts.review > 0 && counts.todo === 0) return "review";
  if (counts.done > 0 || counts.review > 0) return "inProgress";
  return "todo";
}
