import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";

export const MONTH_TEAM_CAPACITY_STORAGE_KEY = "epicPlanner.monthTeamCapacity.v1";

export type MonthTeamCapacityBoard = {
  capacities: Record<string, number>;
};

export function monthTeamCapacityBoardKey(year: number, month: number): string {
  return `${year}:${month}`;
}

export function emptyMonthTeamCapacityBoard(): MonthTeamCapacityBoard {
  const capacities: Record<string, number> = {};
  for (const team of MONTH_TEAM_COLUMNS) {
    capacities[team.id] = 20;
  }
  return { capacities };
}

export function sanitizeMonthTeamCapacityBoard(board: MonthTeamCapacityBoard): MonthTeamCapacityBoard {
  const capacities: Record<string, number> = {};
  for (const teamId of MONTH_TEAM_IDS) {
    const n = Number(board?.capacities?.[teamId]);
    capacities[teamId] = Number.isFinite(n) ? Math.max(0, Math.min(200, n)) : 20;
  }
  return { capacities };
}
