import { MONTH_TEAM_IDS } from "@/lib/month-team-board";
import { normalizeWorkspaceUserTeam } from "@/lib/workspace-users";

export type SprintCapacityBoard = {
  capacities: Record<string, number>;
  assignments: Record<string, string[]>;
  /** Preferred left-to-right order of people buckets (excludes {@link SPRINT_CAPACITY_OTHER_BUCKET}). */
  columnOrder?: string[];
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

export function sprintCapacityBoardKey(year: number, yearSprint: number, teamId: string | null | undefined): string {
  const t = teamId?.trim();
  const teamKey = t ? t : "all";
  return `${year}:${yearSprint}:${teamKey}`;
}

/** `null` = all teams on the sprint board; otherwise filter epics/stories to this `epic.team` id (delivery or custom slug). */
export function sprintStoryBoardEpicTeamFilter(teamId: string | null | undefined): string | null {
  const t = teamId?.trim();
  return t ? t : null;
}

export function defaultMembersForTeam(teamId: string | null): string[] {
  // `null` → the full union of delivery-trio rosters (used when the sprint
  // board is filtered to "all teams"). Otherwise return the team's hardcoded
  // default roster, or [] for any team that doesn't have one (e.g. Mobile /
  // Growth, or custom directory-only teams). Non-trio teams previously fell
  // through to `.all`, which made the sprint capacity / kanban surface every
  // delivery-trio person on those team lanes — confusing and wrong.
  if (teamId == null) return [...DEFAULT_TEAM_MEMBERS.all];
  const defaults = DEFAULT_TEAM_MEMBERS[teamId];
  return defaults ? [...defaults] : [];
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
  let columnOrder: string[] | undefined;
  if (Array.isArray(board.columnOrder)) {
    const cleaned = board.columnOrder.filter(
      (m) => typeof m === "string" && m.trim().length > 0 && m !== SPRINT_CAPACITY_OTHER_BUCKET,
    );
    if (cleaned.length > 0) columnOrder = [...new Set(cleaned)];
  }
  return { capacities, assignments, ...(columnOrder ? { columnOrder } : {}) };
}

/** Merge persisted column order with the current roster-derived list; append Other last when needed. */
export function orderedSprintCapacityMembers(args: {
  columnOrder: string[] | undefined;
  sortedPeopleCols: string[];
  needsOtherColumn: boolean;
}): string[] {
  const { columnOrder, sortedPeopleCols, needsOtherColumn } = args;
  const people =
    columnOrder?.length ?
      (() => {
        const set = new Set(sortedPeopleCols);
        const seen = new Set<string>();
        const out: string[] = [];
        for (const m of columnOrder) {
          if (!set.has(m) || seen.has(m)) continue;
          out.push(m);
          seen.add(m);
        }
        for (const m of sortedPeopleCols) {
          if (!seen.has(m)) {
            out.push(m);
            seen.add(m);
          }
        }
        return out;
      })()
    : [...sortedPeopleCols];
  return [...people, ...(needsOtherColumn ? [SPRINT_CAPACITY_OTHER_BUCKET] : [])];
}

function arrayMovePeopleOrder(order: string[], from: number, to: number): string[] {
  const next = [...order];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Reorder people buckets (not Other). Returns null if no change. */
export function reorderSprintCapacityPeopleOrder(
  peopleOrder: string[],
  activeMember: string,
  overMember: string,
): string[] | null {
  if (activeMember === overMember) return null;
  if (activeMember === SPRINT_CAPACITY_OTHER_BUCKET || overMember === SPRINT_CAPACITY_OTHER_BUCKET) return null;
  const a = peopleOrder.indexOf(activeMember);
  const b = peopleOrder.indexOf(overMember);
  if (a < 0 || b < 0) return null;
  return arrayMovePeopleOrder(peopleOrder, a, b);
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

/** Move a story to a specific position within a member's bucket. insertIndex is in the original (non-reversed) array. */
export function moveStoryInMemberBucket(
  board: SprintCapacityBoard,
  storyId: string,
  member: string,
  insertIndex: number,
): SprintCapacityBoard {
  const next: SprintCapacityBoard = {
    ...board,
    capacities: { ...board.capacities },
    assignments: {},
  };
  for (const [name, ids] of Object.entries(board.assignments)) {
    next.assignments[name] = ids.filter((id) => id !== storyId);
  }
  const list = next.assignments[member] ?? [];
  const clamped = Math.max(0, Math.min(insertIndex, list.length));
  next.assignments[member] = [...list.slice(0, clamped), storyId, ...list.slice(clamped)];
  if (next.capacities[member] == null) next.capacities[member] = 6;
  return next;
}

export function assignStoryToMember(board: SprintCapacityBoard, storyId: string, member: string): SprintCapacityBoard {
  const next: SprintCapacityBoard = {
    ...board,
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

/** Minimal shape from workspace directory rows merged into sprint rosters.
 *  `image` is the avatar URL when the user has one — used by `<UserAvatar>`
 *  to render the photo instead of the initials/icon fallback. */
export type SprintWorkspaceDirectoryUser = {
  name: string;
  team: string;
  image?: string | null;
};

/**
 * First names used to map story assignees → capacity columns; matches sprint Kanban team filter.
 * When `directoryUsers` is set, people from the Users directory are merged in (deduped case-insensitively):
 * - **All teams** (`teamId` empty): everyone in the directory (custom teams, delivery trio, unassigned).
 * - **Delivery team** (`platform` | `experience` | `data`): seed roster + directory users on that team.
 * - **Custom team** (any other slug, e.g. from the directory): directory users on that team only (+ seed none).
 */
export function assigneeMatchRosterForSprintTeam(
  teamId: string | null | undefined,
  directoryUsers?: readonly SprintWorkspaceDirectoryUser[] | null,
): string[] {
  const fid = teamId?.trim() || null;
  const isMonthTeam = fid != null && MONTH_TEAM_IDS.includes(fid);

  const base = isMonthTeam ? defaultMembersForTeam(fid) : fid == null ? fullDeliveryCapacityRoster() : [];

  if (!directoryUsers?.length) return base;

  // Two-pass merge:
  //  1. If a directory user's FIRST NAME matches a base roster entry (e.g.
  //     base "Paige", directory "Paige Cohen"), REPLACE the base entry with
  //     the directory user's full name. This unifies the chip on sprint
  //     kanban / capacity so the user's uploaded photo shows up — otherwise
  //     "Paige" and "Paige Cohen" both render as separate chips and the
  //     unmatched first-name chip ends up with no avatar.
  //  2. Directory users whose first name doesn't appear in the base roster
  //     are appended as extras (sorted).
  const baseByFirstName = new Map<string, string>();
  for (const b of base) baseByFirstName.set(b.toLowerCase(), b);

  const dedupedFull = new Set<string>();
  const extras: string[] = [];
  for (const u of directoryUsers) {
    const n = (u.name ?? "").trim();
    if (!n) continue;
    const nt = normalizeWorkspaceUserTeam(u.team);
    if (fid != null && nt !== fid) continue;

    const nl = n.toLowerCase();
    const firstWordLower = nl.split(/\s+/)[0] ?? "";
    if (firstWordLower && baseByFirstName.has(firstWordLower)) {
      // Replace the base entry with the directory user's full name; the
      // chip will pick up the matching photo from the directory.
      baseByFirstName.set(firstWordLower, n);
      dedupedFull.add(nl);
      continue;
    }
    if (dedupedFull.has(nl)) continue;
    dedupedFull.add(nl);
    extras.push(n);
  }
  extras.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  // Preserve original base ordering (don't re-sort) — call sites may depend
  // on it for capacity-column display order.
  const baseResult = base.map((b) => baseByFirstName.get(b.toLowerCase()) ?? b);
  return [...baseResult, ...extras];
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
  /** Same roster as sprint Kanban team filter (per-team first names vs all delivery). */
  assigneeMatchRoster: string[] = fullDeliveryCapacityRoster(),
): SprintCapacityBoard {
  const fullRoster = assigneeMatchRoster;
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
    ...(board.columnOrder?.length ? { columnOrder: board.columnOrder } : {}),
  };
}

