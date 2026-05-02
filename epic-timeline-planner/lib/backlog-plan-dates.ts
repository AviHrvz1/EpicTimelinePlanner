import type { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";
import {
  clampYearSprint,
  firstGlobalSprintForMonth,
  globalSprintFromMonthLane,
  resolveEpicPlanYearSprint,
  resolvedInitiativeYearSprintBounds,
  sprintEndDate,
  sprintStartDate,
} from "@/lib/year-sprint";

export function formatBacklogPlanDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Initiative bar on the full-year Gantt: sprint-accurate bounds when set, else full months. */
export function ganttDateRangeForInitiative(initiative: InitiativeItem): { start: Date | null; end: Date | null } {
  const b = resolvedInitiativeYearSprintBounds(initiative);
  if (!b) return { start: null, end: null };
  const y = initiative.year;
  return {
    start: sprintStartDate(y, b.startYearSprint),
    end: sprintEndDate(y, b.endYearSprint),
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
