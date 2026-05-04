import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";

export const MONTH_TEAM_CAPACITY_STORAGE_KEY = "epicPlanner.monthTeamCapacity.v1";

export type MonthTeamCapacityBoard = {
  capacities: Record<string, number>;
  /** Preferred left-to-right order of team buckets (subset of {@link MONTH_TEAM_IDS}). */
  columnOrder?: string[];
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
  let columnOrder: string[] | undefined;
  if (Array.isArray(board?.columnOrder)) {
    const cleaned = board.columnOrder.filter(
      (id) => typeof id === "string" && MONTH_TEAM_IDS.includes(id),
    );
    if (cleaned.length > 0) columnOrder = [...new Set(cleaned)];
  }
  return { capacities, ...(columnOrder ? { columnOrder } : {}) };
}

function arrayMoveTeamOrder(order: string[], from: number, to: number): string[] {
  const next = [...order];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Merge persisted column order with default {@link MONTH_TEAM_IDS} order; only includes `visibleTeamIds`. */
export function orderedMonthTeamCapacityTeams(args: {
  columnOrder: string[] | undefined;
  visibleTeamIds: string[];
}): string[] {
  const vis = new Set(args.visibleTeamIds.filter((id) => MONTH_TEAM_IDS.includes(id)));
  const base = MONTH_TEAM_IDS.filter((id) => vis.has(id));
  const { columnOrder } = args;
  if (!columnOrder?.length) return base;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of columnOrder) {
    if (vis.has(id) && !seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  for (const id of base) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

/** Full-board team order for persistence (always all delivery teams). */
export function fullMonthTeamCapacityColumnOrder(columnOrder: string[] | undefined): string[] {
  return orderedMonthTeamCapacityTeams({ columnOrder, visibleTeamIds: [...MONTH_TEAM_IDS] });
}

/** Reorder team columns. Returns null if no change. */
export function reorderMonthTeamCapacityColumnOrder(
  teamOrder: string[],
  activeTeamId: string,
  overTeamId: string,
): string[] | null {
  if (activeTeamId === overTeamId) return null;
  if (!MONTH_TEAM_IDS.includes(activeTeamId) || !MONTH_TEAM_IDS.includes(overTeamId)) return null;
  const a = teamOrder.indexOf(activeTeamId);
  const b = teamOrder.indexOf(overTeamId);
  if (a < 0 || b < 0) return null;
  return arrayMoveTeamOrder(teamOrder, a, b);
}
