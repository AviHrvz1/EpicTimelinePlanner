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
  {
    id: "mobile",
    label: "Mobile",
    subtitle: "iOS & Android apps",
    tone: "border-emerald-200/90 bg-gradient-to-b from-emerald-50/90 to-white",
    priorityHintClass:
      "bg-emerald-100/75 text-emerald-950/90 ring-1 ring-emerald-200/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
    priorityBadgeClass: "bg-emerald-100/95 text-emerald-900 ring-1 ring-emerald-300/55",
  },
  {
    id: "growth",
    label: "Growth",
    subtitle: "Acquisition & retention",
    tone: "border-rose-200/90 bg-gradient-to-b from-rose-50/90 to-white",
    priorityHintClass:
      "bg-rose-100/75 text-rose-950/90 ring-1 ring-rose-200/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
    priorityBadgeClass: "bg-rose-100/95 text-rose-900 ring-1 ring-rose-300/55",
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

/** Pill for Gantt epic bars: delivery team assignment (or unassigned / custom
 *  slug). `slug` is the team identifier (or null when unassigned) so callers
 *  can resolve the team's logo image alongside the label. */
export function epicDeliveryTeamAssignmentChip(teamId: string | null | undefined): {
  label: string;
  className: string;
  slug: string | null;
} {
  const known = monthTeamLabelForId(teamId);
  if (known) {
    const team = MONTH_TEAM_COLUMNS.find((t) => t.id === teamId);
    const pill =
      team?.priorityBadgeClass ?? "border-slate-200 bg-slate-100 text-slate-800 ring-slate-300/55";
    return {
      label: known,
      className: `inline-flex max-w-[7rem] shrink-0 truncate rounded px-2 py-0.5 text-[12px] font-normal leading-none ring-1 ${pill}`,
      slug: teamId ?? null,
    };
  }
  const raw = teamId?.trim();
  if (raw) {
    const label = raw
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
    return {
      label,
      className:
        "inline-flex max-w-[7rem] shrink-0 truncate rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[12px] font-normal leading-none text-slate-700 ring-1 ring-slate-200/80",
      slug: raw,
    };
  }
  return {
    label: "Unassigned",
    className:
      "inline-flex max-w-[6rem] shrink-0 truncate rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[12px] font-normal leading-none text-slate-500 ring-1 ring-slate-200/80",
    slug: null,
  };
}

export type MonthTeamBoardPersisted = {
  /** Per team: epic ids in pull order (index 0 = highest priority). */
  queues: Record<string, string[]>;
};

export function emptyMonthTeamBoard(): MonthTeamBoardPersisted {
  return { queues: {} };
}

/**
 * Capacity boards: anchor each epic to the month the user explicitly
 * placed it in (its `planStartMonth`). An epic whose plan range spans
 * Apr–Jun shows up only in the April capacity board — not also in May
 * and June — because the planner dragged it to April, not to all
 * three months. If a card needs to appear in another month, the user
 * drags it there explicitly.
 */
function epicSpansMonth(epic: EpicItem, month: number): boolean {
  if (epic.planStartMonth == null) return false;
  return epic.planStartMonth === month;
}

/**
 * Epics visible in the month panel. An epic appears when its plan covers
 * the month (or it's unscheduled under an in-scope initiative). No overflow
 * branch — past months reflect their PLAN, not where unfinished work has
 * since migrated. The manual `SprintMoveModal` already updates story sprint
 * numbers deliberately; capacity panels stay plan-driven.
 */
export function collectMonthEpicsForTeamBoard(
  initiatives: InitiativeItem[],
  month: number,
): Array<{ epic: EpicItem; initiative: InitiativeItem }> {
  const byEpicId = new Map<string, { epic: EpicItem; initiative: InitiativeItem }>();
  for (const initiative of initiatives) {
    const epics = initiative.epics ?? [];
    const initiativeSpansMonth =
      initiative.status === InitiativeStatus.scheduled &&
      initiative.startMonth != null &&
      initiative.endMonth != null &&
      initiative.startMonth <= month &&
      initiative.endMonth >= month;
    const initiativeHasPlannedEpicInMonth = epics.some((e) => epicSpansMonth(e, month));
    for (const epic of epics) {
      const isPlannedInMonth = epicSpansMonth(epic, month);
      const isUnscheduled =
        epic.planSprint == null && epic.planStartMonth == null && epic.planEndMonth == null;
      const includeUnscheduled = isUnscheduled && (initiativeSpansMonth || initiativeHasPlannedEpicInMonth);
      if (!isPlannedInMonth && !includeUnscheduled) continue;
      byEpicId.set(epic.id, { epic, initiative });
    }
  }
  return [...byEpicId.values()].sort((a, b) => {
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

/** Remove an epic id from every team queue (e.g. leaving month team capacity). */
export function removeEpicFromMonthTeamBoardQueues(
  prev: MonthTeamBoardPersisted,
  epicId: string,
): MonthTeamBoardPersisted {
  const stripped: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(prev.queues)) {
    stripped[key] = list.filter((x) => x !== epicId);
  }
  return sanitizeMonthTeamBoardPersisted({ queues: stripped });
}

/**
 * If `epicId` appears in exactly one delivery-team queue for this month board, returns that team id.
 * Multiple queues or none → null (caller should not auto-assign).
 */
export function inferEpicTeamIdFromMonthTeamQueues(
  epicId: string,
  persisted: MonthTeamBoardPersisted | undefined,
): string | null {
  if (!persisted?.queues) return null;
  let found: string | null = null;
  for (const teamId of MONTH_TEAM_IDS) {
    const list = persisted.queues[teamId] ?? [];
    if (list.includes(epicId)) {
      if (found != null) return null;
      found = teamId;
    }
  }
  return found;
}

/** Order quarter-scope epics for one team column using month board queue order across the quarter. */
export function orderedEpicsForTeamInQuarterCapacity(
  initiatives: InitiativeItem[],
  teamId: string,
  candidates: Array<{ epic: EpicItem; initiative: InitiativeItem }>,
  quarterMonths: readonly number[],
  year: number,
  boardByKey: Record<string, MonthTeamBoardPersisted>,
): Array<{ epic: EpicItem; initiative: InitiativeItem }> {
  const byId = new Map(candidates.map((c) => [c.epic.id, c] as const));
  const orderedIds: string[] = [];
  for (const month of quarterMonths) {
    const key = monthTeamBoardStorageKey(year, month);
    const persisted = boardByKey[key] ?? emptyMonthTeamBoard();
    const columns = mergeMonthTeamBoardColumns(initiatives, month, persisted);
    const col = columns.find((c) => c.team.id === teamId);
    if (!col) continue;
    for (const item of col.cards) {
      if (!orderedIds.includes(item.epic.id)) orderedIds.push(item.epic.id);
    }
  }
  const rest = candidates
    .filter((c) => !orderedIds.includes(c.epic.id))
    .sort((a, b) => {
      const byInit = a.initiative.title.localeCompare(b.initiative.title);
      if (byInit !== 0) return byInit;
      return a.epic.title.localeCompare(b.epic.title);
    });
  const ordered: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
  for (const id of orderedIds) {
    const row = byId.get(id);
    if (row) ordered.push(row);
  }
  return [...ordered, ...rest];
}
