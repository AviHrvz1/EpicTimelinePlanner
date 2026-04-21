import { MONTH_TEAM_IDS } from "@/lib/month-team-board";

export type SprintCapacityBoard = {
  capacities: Record<string, number>;
  assignments: Record<string, string[]>;
};

export const SPRINT_CAPACITY_STORAGE_KEY = "epicPlanner.sprintCapacity.v1";

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
  return next;
}
