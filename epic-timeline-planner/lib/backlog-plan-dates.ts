import type { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";
import {
  clampYearSprint,
  firstGlobalSprintForMonth,
  globalSprintFromMonthLane,
  resolveEpicPlanYearSprint,
  sprintEndDate,
  sprintStartDate,
} from "@/lib/year-sprint";

export function formatBacklogPlanDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Initiative date range — derived from `[min(epic.planStart), max(epic.planEnd)]`
 * across its child epics, mirroring how the year-Gantt's `yearRoadmapInitiatives`
 * positions the initiative bar. Returns `null` start/end when the initiative
 * has no scheduled epics so callers can render an "Unscheduled" state.
 *
 * The `initiative.startMonth/endMonth` fields are NOT consulted — they are
 * legacy storage that no UI path writes to anymore (UI edit was disabled in
 * favor of the derived model). Keeping a single source of truth (the epics)
 * means the backlog and Gantt can never disagree about an initiative's range.
 */
export function ganttDateRangeForInitiative(initiative: InitiativeItem): { start: Date | null; end: Date | null } {
  const scheduledEpics = (initiative.epics ?? []).filter(
    (epic) => epic.planStartMonth != null && epic.planEndMonth != null,
  );
  if (scheduledEpics.length === 0) return { start: null, end: null };
  const bounds = scheduledEpics.map((epic) => {
    const startYS = resolveEpicPlanYearSprint(epic) ?? firstGlobalSprintForMonth(epic.planStartMonth!);
    const endLane: 1 | 2 = epic.planEndSprint === 1 ? 1 : 2;
    const endYS = globalSprintFromMonthLane(epic.planEndMonth!, endLane);
    return {
      start: clampYearSprint(Math.min(startYS, endYS)),
      end: clampYearSprint(Math.max(startYS, endYS)),
    };
  });
  const startYS = Math.min(...bounds.map((b) => b.start));
  const endYS = Math.max(...bounds.map((b) => b.end));
  return {
    start: sprintStartDate(initiative.year, startYS),
    end: sprintEndDate(initiative.year, endYS),
  };
}

/** Epic bar on the Gantt: `planStartMonth` / `planEndMonth` with sprint lanes. */
export function ganttDateRangeForEpic(epic: EpicItem, planYear: number): { start: Date | null; end: Date | null } {
  if (epic.planStartMonth == null || epic.planEndMonth == null) return { start: null, end: null };
  const startYS = resolveEpicPlanYearSprint(epic) ?? firstGlobalSprintForMonth(epic.planStartMonth);
  const endLane: 1 | 2 = epic.planEndSprint === 1 ? 1 : 2;
  const endYS = globalSprintFromMonthLane(epic.planEndMonth, endLane);
  const lo = clampYearSprint(Math.min(startYS, endYS));
  const hi = clampYearSprint(Math.max(startYS, endYS));
  return {
    start: sprintStartDate(planYear, lo),
    end: sprintEndDate(planYear, hi),
  };
}

const STATUS_CHANGE_RE = /^Status changed to (todo|inProgress|done|approved)$/;

/**
 * User story: start = first time status became in progress (history, else snapshots, else updatedAt);
 * end = start + estimated calendar days when estimate &gt; 0.
 */
export function storyWorkPlanRangeFromProgress(story: UserStoryItem): { start: Date | null; end: Date | null } {
  let firstInProgressMs: number | null = null;
  for (const h of story.history ?? []) {
    const m = STATUS_CHANGE_RE.exec(h.entry);
    if (!m || m[1] !== "inProgress") continue;
    const t = new Date(h.createdAt).getTime();
    if (firstInProgressMs == null || t < firstInProgressMs) firstInProgressMs = t;
  }
  if (firstInProgressMs == null && story.status === "inProgress") {
    for (const snap of story.snapshots ?? []) {
      if (snap.status !== "inProgress") continue;
      const t = new Date(snap.snapshotDate).getTime();
      if (firstInProgressMs == null || t < firstInProgressMs) firstInProgressMs = t;
    }
  }
  if (firstInProgressMs == null && story.status === "inProgress") {
    firstInProgressMs = new Date(story.updatedAt).getTime();
  }
  if (firstInProgressMs == null) return { start: null, end: null };

  const est = story.estimatedDays;
  const start = new Date(firstInProgressMs);
  if (est == null || est <= 0) return { start, end: null };
  const end = new Date(firstInProgressMs);
  end.setDate(end.getDate() + Math.max(1, Math.round(est)));
  return { start, end };
}
