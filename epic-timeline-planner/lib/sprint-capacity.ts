import { MONTH_TEAM_IDS } from "@/lib/month-team-board";

export type SprintCapacityBoard = {
  capacities: Record<string, number>;
  assignments: Record<string, string[]>;
};

export const SPRINT_CAPACITY_STORAGE_KEY = "epicPlanner.sprintCapacity.v1";

/**
 * Bucket for stories in this sprint whose `assignee` is not on the visible roster (e.g. cross-team
 * name while the board is filtered to one delivery team). Do not persist this label as a story assignee in the API.
 */
export const SPRINT_CAPACITY_OTHER_BUCKET = "Other assignees";

const DEFAULT_TEAM_MEMBERS: Record<string, string[]> = {
  platform: ["Alex", "Maya", "Noam"],
  experience: ["Lior", "Dana", "Ruth"],
  data: ["Eitan", "Yael", "Omer"],
  all: ["Alex", "Maya", "Noam", "Lior", "Dana", "Ruth", "Eitan", "Yael", "Omer"],
};

export function sprintCapacityBoardKey(year: number, yearSprint: number, teamId: string | null): string {
  const teamKey = teamId && MONTH_TEAM_IDS.includes(teamId) ? teamId : "all";
  return `${year}:${yearSprint}:${teamKey}`;
}

export function defaultMembersForTeam(teamId: string | null): string[] {
  const key = teamId && MONTH_TEAM_IDS.includes(teamId) ? teamId : "all";
  return [...(DEFAULT_TEAM_MEMBERS[key] ?? DEFAULT_TEAM_MEMBERS.all)];
}

export function sanitizeSprintCapacityBoard(board: SprintCapacityBoard): SprintCapacityBoard {
  const capacities: Record<string, number> = {};
  for (const [member, value] of Object.entries(board.capacities ?? {})) {
    const n = Number(value);
    capacities[member] = Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
  }
  const assignments: Record<string, string[]> = {};
  for (const [member, ids] of Object.entries(board.assignments ?? {})) {
    assignments[member] = [...new Set((ids ?? []).filter(Boolean))];
  }
  return { capacities, assignments };
}

export function emptySprintCapacityBoard(members: string[]): SprintCapacityBoard {
  const capacities: Record<string, number> = {};
  const assignments: Record<string, string[]> = {};
  for (const member of members) {
    capacities[member] = 6;
    assignments[member] = [];
  }
  return { capacities, assignments };
}

export function assignStoryToMember(board: SprintCapacityBoard, storyId: string, member: string): SprintCapacityBoard {
  const next: SprintCapacityBoard = {
    capacities: { ...board.capacities },
    assignments: {},
  };
  for (const [name, ids] of Object.entries(board.assignments)) {
    next.assignments[name] = ids.filter((id) => id !== storyId);
  }
  const list = next.assignments[member] ?? [];
  next.assignments[member] = [...list, storyId];
  if (member === SPRINT_CAPACITY_OTHER_BUCKET && next.capacities[member] == null) {
    next.capacities[member] = 6;
  }
  return next;
}

/** Map kanban assignee string to a capacity roster name (exact or case-insensitive). */
export function resolveCapacityMemberForAssignee(
  assignee: string | null | undefined,
  members: string[],
): string | null {
  const raw = assignee?.trim() ?? "";
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "unassigned") return null;
  const memberSet = new Set(members);
  if (memberSet.has(raw)) return raw;
  for (const m of members) {
    if (m.toLowerCase() === lower) return m;
  }
  return null;
}

function assigneeRoutesToOtherBucket(
  assignee: string | null | undefined,
  rosterMembers: string[],
): boolean {
  const raw = assignee?.trim() ?? "";
  if (!raw || raw.toLowerCase() === "unassigned") return false;
  return resolveCapacityMemberForAssignee(assignee, rosterMembers) == null;
}

/**
 * Places each sprint story under the capacity column whose name matches `story.assignee`
 * (same names as sprint kanban; matching is case-insensitive). Assignees not on `members` go to
 * {@link SPRINT_CAPACITY_OTHER_BUCKET} so capacity stays aligned with kanban when the board is
 * team-scoped or uses ad-hoc assignee labels. Stories with no assignee are unchanged unless already bucketed.
 */
export function syncCapacityAssignmentsWithKanban(
  board: SprintCapacityBoard,
  members: string[],
  sprintStories: Array<{ id: string; assignee: string | null | undefined }>,
): SprintCapacityBoard {
  const hasPersistedOther =
    (board.assignments[SPRINT_CAPACITY_OTHER_BUCKET]?.length ?? 0) > 0;
  const hasInSprintOther = sprintStories.some(({ assignee }) =>
    assigneeRoutesToOtherBucket(assignee, members),
  );
  const useOtherBucket = hasPersistedOther || hasInSprintOther;
  const memberKeys = useOtherBucket ? [...members, SPRINT_CAPACITY_OTHER_BUCKET] : [...members];

  const nextAssignments: Record<string, string[]> = {};
  for (const m of memberKeys) {
    nextAssignments[m] = [...(board.assignments[m] ?? [])];
  }

  for (const { id, assignee } of sprintStories) {
    let memberName = resolveCapacityMemberForAssignee(assignee, members);
    if (!memberName) {
      if (!assigneeRoutesToOtherBucket(assignee, members)) continue;
      if (!useOtherBucket) continue;
      memberName = SPRINT_CAPACITY_OTHER_BUCKET;
    }
    for (const m of memberKeys) {
      nextAssignments[m] = (nextAssignments[m] ?? []).filter((sid) => sid !== id);
    }
    const list = nextAssignments[memberName] ?? [];
    if (!list.includes(id)) {
      nextAssignments[memberName] = [...list, id];
    }
  }

  const nextCapacities = { ...board.capacities };
  if (useOtherBucket && nextCapacities[SPRINT_CAPACITY_OTHER_BUCKET] == null) {
    nextCapacities[SPRINT_CAPACITY_OTHER_BUCKET] = 6;
  }

  return {
    capacities: nextCapacities,
    assignments: nextAssignments,
  };
}
