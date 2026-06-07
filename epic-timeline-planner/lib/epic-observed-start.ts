/**
 * When did the team ACTUALLY start working on this epic, as recorded by
 * daily snapshots? Returns the earliest date on which any child story's
 * `status` advanced past `todo` — i.e. someone moved the card to
 * `inProgress`, `review`, or `done`.
 *
 * NOTE on what we look for: we deliberately do NOT use "daysLeft fell
 * below estimatedDays" as a signal. Some seeders (and some real-world
 * automations) write daysLeft snapshots gradually before a sprint even
 * starts — e.g. to render a smooth chart curve. That mechanical
 * decrement doesn't mean "the team started working"; it's just a
 * visualization scaffold. Anchoring observed start to genuine status
 * advances keeps the verdict aligned with the real human workflow.
 *
 * Stories without snapshots are ignored — there's nothing to observe.
 * Returns `null` when nothing has moved yet; callers should then fall
 * back to the epic's planned start.
 *
 * Why this exists: the burn-up / burn-down ideal line and the health
 * verdict both need to reflect WHERE THE TEAM ACTUALLY IS, not just
 * what the planner originally typed in. When the team starts ahead of
 * the planned date, the chart should ramp from observed-start and the
 * verdict should compute against the same window — otherwise the
 * verdict can show "On Track" against an empty plan window while the
 * chart visibly shows a deficit, which is confusing.
 *
 * Used by:
 *   - month-analytics insights burnup + burndown verdicts
 *   - dashboard Health Distribution donut
 *   - year-roadmap epic / initiative bar health badges
 *   - initiative-list-panel epic health map
 *   - dashboard epic-burnup-chart + epic-burndown-chart overlay verdicts
 */
import type { EpicItem } from "@/lib/types";

export function computeEpicObservedStart(epic: EpicItem): Date | null {
  const stories = epic.userStories ?? [];
  if (stories.length === 0) return null;
  let earliestMs = Infinity;
  for (const story of stories) {
    const snaps = story.snapshots ?? [];
    if (snaps.length === 0) continue;
    // Snapshots are usually persisted chronologically, but re-sort
    // defensively so callers don't depend on storage order.
    const sorted = [...snaps].sort((a, b) =>
      new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime());
    for (const snap of sorted) {
      // ONLY status advances count — see header. A daysLeft-only
      // drop while status is still `todo` is treated as scaffolding,
      // not as the team starting work.
      const advanced = snap.status === "inProgress"
        || snap.status === "review"
        || snap.status === "done";
      if (advanced) {
        const ts = new Date(snap.snapshotDate).getTime();
        if (Number.isFinite(ts) && ts < earliestMs) earliestMs = ts;
        break;
      }
    }
  }
  return Number.isFinite(earliestMs) ? new Date(earliestMs) : null;
}

/** Resolve an epic's effective start: observed when earlier than
 *  planned, planned otherwise. Returns `plannedStart` unchanged when
 *  no observation has been recorded yet. */
export function effectiveEpicStart(epic: EpicItem, plannedStart: Date): Date {
  const observed = computeEpicObservedStart(epic);
  return observed != null && observed < plannedStart ? observed : plannedStart;
}
