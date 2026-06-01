import type {
  EpicDailySnapshotItem,
  EpicItem,
  InitiativeItem,
  StoryDailySnapshotItem,
  UserStoryItem,
} from "@/lib/types";

/**
 * Returns a story view whose editable fields reflect the snapshot taken on
 * or before `closeMs` rather than current live state. Used for closed-period
 * views (sprint kanban + capacity + 6 charts, past month / quarter / year
 * insights) so retrospective surfaces read as honest "what was true on the
 * close day" instead of evolving with post-close edits and rollovers.
 *
 * Phase B extends this to project title / description / priority / labels
 * when present on the snapshot (post-Phase-B rows). Snapshot fields default
 * to null for pre-Phase-B rows, in which case the projection falls back to
 * the live story field — graceful for the migration window and for newly
 * created stories with no history yet.
 */
export function projectStoryToCloseDate(story: UserStoryItem, closeMs: number): UserStoryItem {
  const snaps = story.snapshots;
  if (!snaps || snaps.length === 0) return story;
  let best: StoryDailySnapshotItem | null = null;
  let bestMs = -Infinity;
  for (const snap of snaps) {
    const snapMs = new Date(snap.snapshotDate).getTime();
    if (snapMs > closeMs) continue;
    if (snapMs > bestMs) {
      bestMs = snapMs;
      best = snap;
    }
  }
  if (best == null) return story;
  return {
    ...story,
    status: best.status,
    daysLeft: best.daysLeft,
    estimatedDays: best.estimatedDays ?? story.estimatedDays,
    sprint: best.sprint ?? story.sprint,
    // Phase B text fields: snapshot wins when present, otherwise fall back
    // to the live story so closed views never render a blank during the
    // pre-backfill window.
    title: best.title ?? story.title,
    description: best.description ?? story.description,
    priority: best.priority ?? story.priority,
    labels: best.labels ?? story.labels,
  };
}

/**
 * Phase C — mirror of {@link projectStoryToCloseDate} for epics. Reads the
 * epic's daily snapshot at `closeMs` and replaces every editable field
 * (title, description, icon, color, estimate, priority, labels, team, plan
 * dates) with the snapshot's value, falling back to the live epic field
 * when the snapshot has null. Relations (`userStories`, `comments`,
 * `history`, `epicSnapshots` itself) are preserved untouched.
 */
export function projectEpicToCloseDate(epic: EpicItem, closeMs: number): EpicItem {
  const snaps = epic.epicSnapshots;
  if (!snaps || snaps.length === 0) return epic;
  let best: EpicDailySnapshotItem | null = null;
  let bestMs = -Infinity;
  for (const snap of snaps) {
    const snapMs = new Date(snap.snapshotDate).getTime();
    if (snapMs > closeMs) continue;
    if (snapMs > bestMs) {
      bestMs = snapMs;
      best = snap;
    }
  }
  if (best == null) return epic;
  return {
    ...epic,
    title: best.title ?? epic.title,
    description: best.description ?? epic.description,
    icon: best.icon ?? epic.icon,
    color: best.color ?? epic.color,
    originalEstimateDays: best.originalEstimateDays ?? epic.originalEstimateDays,
    priority: best.priority ?? epic.priority,
    labels: best.labels ?? epic.labels,
    team: best.team ?? epic.team,
    planStartMonth: best.planStartMonth ?? epic.planStartMonth,
    planEndMonth: best.planEndMonth ?? epic.planEndMonth,
    planSprint: best.planSprint ?? epic.planSprint,
    planEndSprint: best.planEndSprint ?? epic.planEndSprint,
    planStartDay: best.planStartDay ?? epic.planStartDay,
    planEndDay: best.planEndDay ?? epic.planEndDay,
  };
}

/**
 * Walks every initiative → epic → story and rewrites each with close-day
 * snapshot values. Phase C extends this to also project the epic shell
 * (title, estimate, team, etc.) — not just the child stories. Relations
 * (snapshot arrays, history, comments) stay intact so the projection helper
 * can be called repeatedly on the same data without losing context.
 *
 * Closed-period views feed this into `collectStoriesForSprintBoard` /
 * `collectMonthEpicsForTeamBoard` / etc. so the entire row set reads from
 * snapshots without per-callsite plumbing.
 */
export function projectInitiativesToCloseDate(
  initiatives: InitiativeItem[],
  closeMs: number,
): InitiativeItem[] {
  return initiatives.map((init) => ({
    ...init,
    epics: (init.epics ?? []).map((epic) => {
      const projectedEpic = projectEpicToCloseDate(epic, closeMs);
      return {
        ...projectedEpic,
        userStories: (epic.userStories ?? []).map((story) => projectStoryToCloseDate(story, closeMs)),
      };
    }),
  }));
}
