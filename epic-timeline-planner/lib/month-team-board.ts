import { InitiativeStatus } from "@/lib/generated/prisma";
import { EpicItem, InitiativeItem } from "@/lib/types";

export type MonthTeamDefinition = {
  id: string;
  label: string;
  subtitle: string;
  /** Column shell: border + soft background */
  tone: string;
  /** Soft “priority” strip under sprint chips (matches lane palette). */
  priorityHintClass: string;
  /** P1 / P2 chip on cards in this lane */
  priorityBadgeClass: string;
};

/** Delivery columns only (unassigned epics stay in the left month list). Order = display left → right. */
export const MONTH_TEAM_COLUMNS: MonthTeamDefinition[] = [
  {
    id: "platform",
    label: "Platform",
    subtitle: "Infra, APIs, shared systems",
    tone: "border-sky-200/90 bg-gradient-to-b from-sky-50/90 to-white",
    priorityHintClass:
      "bg-sky-100/75 text-sky-950/90 ring-1 ring-sky-200/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
    priorityBadgeClass: "bg-sky-100/95 text-sky-900 ring-1 ring-sky-300/55",
  },
  {
    id: "experience",
    label: "Experience",
    subtitle: "Product UI & journeys",
    tone: "border-violet-200/90 bg-gradient-to-b from-violet-50/90 to-white",
    priorityHintClass:
      "bg-violet-100/75 text-violet-950/90 ring-1 ring-violet-200/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
    priorityBadgeClass: "bg-violet-100/95 text-violet-900 ring-1 ring-violet-300/55",
  },
  {
    id: "data",
    label: "Data & analytics",
    subtitle: "Reporting, pipelines, ML",
    tone: "border-amber-200/90 bg-gradient-to-b from-amber-50/85 to-white",
    priorityHintClass:
      "bg-amber-100/80 text-amber-950/90 ring-1 ring-amber-200/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]",
    priorityBadgeClass: "bg-amber-100/95 text-amber-950 ring-1 ring-amber-300/55",
  },
];

export const MONTH_TEAM_IDS = MONTH_TEAM_COLUMNS.map((t) => t.id);

export function isKnownEpicTeamId(id: string | null | undefined): id is string {
  return Boolean(id && MONTH_TEAM_IDS.includes(id));
}

export function monthTeamLabelForId(teamId: string | null | undefined): string | null {
  if (!teamId || !MONTH_TEAM_IDS.includes(teamId)) return null;
  return MONTH_TEAM_COLUMNS.find((t) => t.id === teamId)?.label ?? null;
}

export type MonthTeamBoardPersisted = {
  /** Per team: epic ids in pull order (index 0 = highest priority). */
  queues: Record<string, string[]>;
};

export function emptyMonthTeamBoard(): MonthTeamBoardPersisted {
  return { queues: {} };
}

/** Epics whose initiative spans this roadmap month (same scope as month epic list). */
export function collectMonthEpicsForTeamBoard(
  initiatives: InitiativeItem[],
  month: number,
): Array<{ epic: EpicItem; initiative: InitiativeItem }> {
  const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
  for (const initiative of initiatives) {
    if (initiative.status !== InitiativeStatus.scheduled) continue;
    if (initiative.startMonth == null || initiative.endMonth == null) continue;
    if (initiative.endMonth < month || initiative.startMonth > month) continue;
    for (const epic of initiative.epics ?? []) {
      rows.push({ epic, initiative });
    }
  }
  return [...rows].sort((a, b) => {
    const byInit = a.initiative.title.localeCompare(b.initiative.title);
    if (byInit !== 0) return byInit;
    return a.epic.title.localeCompare(b.epic.title);
  });
}

export function monthTeamBoardStorageKey(year: number, month: number): string {
  return `${year}:${month}`;
}

export type MergedTeamColumn = {
  team: MonthTeamDefinition;
  cards: Array<{ epic: EpicItem; initiative: InitiativeItem }>;
};

/**
 * Builds team columns from each epic’s `team` field, ordered by persisted queue ids where valid.
 * Epics with no team (or unknown id) stay in the left month list until assigned.
 */
export function mergeMonthTeamBoardColumns(
  initiatives: InitiativeItem[],
  month: number,
  persisted: MonthTeamBoardPersisted | undefined,
): MergedTeamColumn[] {
  const candidates = collectMonthEpicsForTeamBoard(initiatives, month);
  const persistedQueues = persisted?.queues ?? {};

  return MONTH_TEAM_COLUMNS.map((team) => {
    const withTeam = candidates.filter(
      (c) => c.epic.team != null && MONTH_TEAM_IDS.includes(c.epic.team) && c.epic.team === team.id,
    );
    const byId = new Map(withTeam.map((c) => [c.epic.id, c] as const));
    const order = persistedQueues[team.id] ?? [];
    const placed = new Set<string>();
    const cards: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const id of order) {
      const row = byId.get(id);
      if (row && !placed.has(id)) {
        placed.add(id);
        cards.push(row);
      }
    }
    const rest = withTeam
      .filter((c) => !placed.has(c.epic.id))
      .sort((a, b) => {
        const byInit = a.initiative.title.localeCompare(b.initiative.title);
        if (byInit !== 0) return byInit;
        return a.epic.title.localeCompare(b.epic.title);
      });
    return { team, cards: [...cards, ...rest] };
  });
}

/** Drop legacy keys (e.g. `triage`) when persisting so localStorage stays small. */
export function sanitizeMonthTeamBoardPersisted(board: MonthTeamBoardPersisted): MonthTeamBoardPersisted {
  const queues: Record<string, string[]> = {};
  for (const id of MONTH_TEAM_IDS) {
    queues[id] = [...(board.queues[id] ?? [])];
  }
  return { queues };
}

export function applyEpicTeamQueueMove(
  prev: MonthTeamBoardPersisted,
  epicId: string,
  targetTeamId: string,
  insertIndex: number,
): MonthTeamBoardPersisted {
  if (!MONTH_TEAM_IDS.includes(targetTeamId)) return prev;
  /** Remove from every persisted lane (including legacy keys like `triage`). */
  const stripped: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(prev.queues)) {
    stripped[key] = list.filter((x) => x !== epicId);
  }
  const queues: Record<string, string[]> = {};
  for (const id of MONTH_TEAM_IDS) {
    queues[id] = [...(stripped[id] ?? [])];
  }
  const list = queues[targetTeamId] ?? [];
  const clamped = Math.max(0, Math.min(insertIndex, list.length));
  const nextList = [...list.slice(0, clamped), epicId, ...list.slice(clamped)];
  queues[targetTeamId] = nextList;
  return { queues };
}
