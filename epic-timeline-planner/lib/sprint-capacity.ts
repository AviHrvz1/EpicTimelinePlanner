import { MONTH_TEAM_IDS } from "@/lib/month-team-board";

export type SprintCapacityBoard = {
  capacities: Record<string, number>;
  assignments: Record<string, string[]>;
};

export const SPRINT_CAPACITY_STORAGE_KEY = "epicPlanner.sprintCapacity.v1";

/**
 * When set in localStorage (any value), sync logs [sprint-capacity sync] diagnostics to the console.
 */
export const DEBUG_SPRINT_CAPACITY_STORAGE_KEY = "epicPlanner.debugSprintCapacity";

/**
 * Bucket for stories with no assignee (or legacy rows we could not map). Do not persist as a story assignee in the API.
 */
export const SPRINT_CAPACITY_OTHER_BUCKET = "Other assignees";

/**
 * Default capacity rosters — aligned with `prisma/seed.js` so sprint capacity and Kanban autocomplete
 * match names on cards. Combined “all teams” roster has 15 people (5 per delivery column).
 */
/** Five Platform people — names start with P (aligned with demo seed). */
const PLATFORM_MEMBERS = ["Paige", "Perry", "Poppy", "Petra", "Pascal"] as const;
/** Five Experience people — names start with E. */
const EXPERIENCE_MEMBERS = ["Elena", "Erin", "Evan", "Edith", "Emma"] as const;
/** Five Data & analytics people — names start with A. */
const DATA_MEMBERS = ["Alice", "Aaron", "Aria", "Asher", "Aiden"] as const;

function mergeUniqueSorted(...groups: readonly (readonly string[])[]): string[] {
  const set = new Set<string>();
  for (const g of groups) {
    for (const n of g) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

const DEFAULT_TEAM_MEMBERS: Record<string, string[]> = {
  platform: [...PLATFORM_MEMBERS],
  experience: [...EXPERIENCE_MEMBERS],
  data: [...DATA_MEMBERS],
  all: mergeUniqueSorted(PLATFORM_MEMBERS, EXPERIENCE_MEMBERS, DATA_MEMBERS),
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
  if (next.capacities[member] == null) {
    next.capacities[member] = 6;
  }
  return next;
}

function normalizeAssigneeForRosterMatch(raw: string): string {
  let s = raw.trim();
  // Jira/display quirks: "Eitan us" → Eitan (US locale/team suffix, not part of roster key)
  if (/\s+us$/i.test(s)) s = s.replace(/\s+us$/i, "").trim();
  // "Ava (Platform)" → Ava
  const paren = s.match(/^(.+?)\s*\([^)]{0,120}\)\s*$/);
  if (paren) s = paren[1]!.trim();
  return s;
}

/** Common spellings / typos → canonical roster first name (must exist in {@link fullDeliveryCapacityRoster}). */
const ROSTER_ASSIGNEE_ALIASES: Record<string, string> = {
  eithan: "Eitan",
  eytan: "Eitan",
  ayton: "Eitan",
};

/** Map kanban assignee string to a capacity roster name (exact, alias, or case-insensitive). */
export function resolveCapacityMemberForAssignee(
  assignee: string | null | undefined,
  members: string[],
): string | null {
  const raw = normalizeAssigneeForRosterMatch(assignee?.trim() ?? "");
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "unassigned") return null;
  const memberSet = new Set(members);
  if (memberSet.has(raw)) return raw;
  for (const m of members) {
    if (m.toLowerCase() === lower) return m;
  }
  const aliasCanonical = ROSTER_ASSIGNEE_ALIASES[lower];
  if (aliasCanonical) {
    for (const m of members) {
      if (m === aliasCanonical || m.toLowerCase() === aliasCanonical.toLowerCase()) return m;
    }
  }
  return null;
}

/** All planner delivery people (used to match assignees even when the board is team-filtered). */
export function fullDeliveryCapacityRoster(): string[] {
  return defaultMembersForTeam(null);
}

/**
 * Capacity column for a story: canonical roster name when it matches, otherwise the normalized free-text assignee.
 * Null = treat as unassigned (bucketed under {@link SPRINT_CAPACITY_OTHER_BUCKET} when that column is enabled).
 */
export function sprintCapacityAssigneeBucket(
  assignee: string | null | undefined,
  fullRoster: string[],
): string | null {
  const matched = resolveCapacityMemberForAssignee(assignee, fullRoster);
  if (matched) return matched;
  const raw = normalizeAssigneeForRosterMatch(assignee?.trim() ?? "");
  if (!raw || raw.toLowerCase() === "unassigned") return null;
  return raw;
}

function orderedSprintCapacityBucketKeys(
  baseMembers: string[],
  board: SprintCapacityBoard,
  sprintStories: Array<{ id: string; assignee: string | null | undefined }>,
  fullRoster: string[],
  useOtherBucket: boolean,
): string[] {
  const set = new Set<string>(baseMembers);
  for (const { assignee } of sprintStories) {
    const b = sprintCapacityAssigneeBucket(assignee, fullRoster);
    if (b) set.add(b);
  }
  for (const k of Object.keys(board.assignments ?? {})) {
    if (k === SPRINT_CAPACITY_OTHER_BUCKET) continue;
    set.add(k);
  }
  if (useOtherBucket) set.add(SPRINT_CAPACITY_OTHER_BUCKET);

  const rosterExtras = [...set].filter(
    (k) => !baseMembers.includes(k) && k !== SPRINT_CAPACITY_OTHER_BUCKET && fullRoster.includes(k),
  );
  const dynamicExtras = [...set].filter(
    (k) =>
      !baseMembers.includes(k) && k !== SPRINT_CAPACITY_OTHER_BUCKET && !fullRoster.includes(k),
  );
  rosterExtras.sort((a, b) => a.localeCompare(b));
  dynamicExtras.sort((a, b) => a.localeCompare(b));
  return [...baseMembers, ...rosterExtras, ...dynamicExtras, ...(useOtherBucket ? [SPRINT_CAPACITY_OTHER_BUCKET] : [])];
}

function logSprintCapacitySync(
  sprintStories: Array<{ id: string; assignee: string | null | undefined }>,
  fullRoster: string[],
  memberKeys: string[],
  nextAssignments: Record<string, string[]>,
): void {
  if (typeof globalThis === "undefined") return;
  try {
    const storage = (globalThis as unknown as { localStorage?: { getItem: (k: string) => string | null } })
      .localStorage;
    if (!storage?.getItem(DEBUG_SPRINT_CAPACITY_STORAGE_KEY)) return;
  } catch {
    return;
  }
  const sample = sprintStories.slice(0, 15).map((s) => ({
    id: s.id.slice(0, 8),
    assignee: s.assignee ?? null,
    bucket: sprintCapacityAssigneeBucket(s.assignee, fullRoster),
  }));
  const unassigned = sprintStories.filter((s) => sprintCapacityAssigneeBucket(s.assignee, fullRoster) == null).length;
  const byBucket: Record<string, number> = {};
  for (const [k, ids] of Object.entries(nextAssignments)) {
    byBucket[k] = ids.length;
  }
  console.info("[sprint-capacity sync]", {
    storyCount: sprintStories.length,
    unassignedCount: unassigned,
    rosterSize: fullRoster.length,
    columnKeys: memberKeys,
    cardsPerColumn: byBucket,
    sampleAssigneeResolution: sample,
  });
}

/**
 * Places each sprint story in a capacity column from {@link sprintCapacityAssigneeBucket}: roster match,
 * else a dynamic column named after the assignee (any non-empty text). Unassigned stories use
 * {@link SPRINT_CAPACITY_OTHER_BUCKET} when that bucket is present (persisted unassigned rows or any unassigned in sprint).
 */
export function syncCapacityAssignmentsWithKanban(
  board: SprintCapacityBoard,
  members: string[],
  sprintStories: Array<{ id: string; assignee: string | null | undefined }>,
): SprintCapacityBoard {
  const fullRoster = fullDeliveryCapacityRoster();
  const hasPersistedOther = (board.assignments[SPRINT_CAPACITY_OTHER_BUCKET]?.length ?? 0) > 0;
  const hasUnassignedInSprint = sprintStories.some(
    (s) => sprintCapacityAssigneeBucket(s.assignee, fullRoster) == null,
  );
  const useOtherBucket = hasPersistedOther || hasUnassignedInSprint;

  const memberKeys = orderedSprintCapacityBucketKeys(
    members,
    board,
    sprintStories,
    fullRoster,
    useOtherBucket,
  );

  const nextAssignments: Record<string, string[]> = {};
  for (const m of memberKeys) {
    nextAssignments[m] = [...(board.assignments[m] ?? [])];
  }

  for (const { id, assignee } of sprintStories) {
    const bucket = sprintCapacityAssigneeBucket(assignee, fullRoster);
    const memberName = bucket ?? (useOtherBucket ? SPRINT_CAPACITY_OTHER_BUCKET : null);
    if (!memberName) continue;
    for (const m of memberKeys) {
      nextAssignments[m] = (nextAssignments[m] ?? []).filter((sid) => sid !== id);
    }
    const list = nextAssignments[memberName] ?? [];
    if (!list.includes(id)) {
      nextAssignments[memberName] = [...list, id];
    }
  }

  const nextCapacities = { ...board.capacities };
  for (const m of memberKeys) {
    if (nextCapacities[m] == null) {
      nextCapacities[m] = 6;
    }
  }

  logSprintCapacitySync(sprintStories, fullRoster, memberKeys, nextAssignments);

  return {
    capacities: nextCapacities,
    assignments: nextAssignments,
  };
}
