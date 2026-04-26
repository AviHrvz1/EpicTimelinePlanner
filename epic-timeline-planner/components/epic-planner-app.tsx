"use client";

import { DragEndEvent } from "@dnd-kit/core";
import { InitiativeStatus, StoryStatus } from "@/lib/generated/prisma";
import { Archive, Map as MapIcon } from "lucide-react";
import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { EpicFormDialog } from "@/components/epics/epic-form-dialog";
import { BacklogPlanningPanel } from "@/components/backlog/backlog-planning-panel";
import { InitiativeFormDialog } from "@/components/initiatives/initiative-form-dialog";
import { InitiativeListPanel } from "@/components/initiatives/initiative-list-panel";
import { StoryDetailsDialog } from "@/components/stories/story-details-dialog";
import { DragContext } from "@/components/timeline/drag-context";
import { type SprintRetrospectiveDoc } from "@/components/timeline/sprint-retrospective";
import { TimelineGrid, type MonthPlanSurfaceTab } from "@/components/timeline/timeline-grid";
import {
  EPICS_UNPLAN_DROP_ID,
  STORIES_UNSCHEDULE_DROP_ID,
  isEpicPlanDraggableId,
  isInitiativeDraggableId,
  parseEpicIdFromPlanDraggable,
  parseBacklogSlotDropId,
  parseEpicBacklogSlotDropId,
  parseMonthDropTarget,
  parseInitiativeIdFromDraggable,
  isStoryDraggableId,
  parseStoryIdFromDraggable,
  parseMonthEpicKanbanDropId,
  parseMonthTeamSlotDropId,
  parseMonthTeamCapacityBucketDropId,
  parseQuarterTeamCapacityBucketDropId,
  parseSprintCapacityBucketDropId,
} from "@/lib/epic-dnd-ids";
import {
  clientYCenterFromDragEnd,
  inferGanttLaneHoverIndexFromClientY,
  inferGanttLaneHoverTimelineRowFromClientY,
  inferGanttLaneInsertIndexFromClientY,
} from "@/lib/gantt-lane-from-pointer";
import {
  applyEpicTeamQueueMove,
  collectMonthEpicsForTeamBoard,
  isKnownEpicTeamId,
  monthTeamBoardStorageKey,
  MONTH_TEAM_IDS,
  removeEpicFromMonthTeamBoardQueues,
  sanitizeMonthTeamBoardPersisted,
  type MonthTeamBoardPersisted,
} from "@/lib/month-team-board";
import { collectQuarterEpics } from "@/lib/quarter-analytics";
import { splitQuarterTotalAcrossMonths } from "@/lib/quarter-team-capacity";
import { MONTHS, QUARTERS } from "@/lib/timeline";
import { EpicItem, InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  SPRINT_CAPACITY_STORAGE_KEY,
  assignStoryToMember,
  defaultMembersForTeam,
  emptySprintCapacityBoard,
  sanitizeSprintCapacityBoard,
  sprintCapacityBoardKey,
  type SprintCapacityBoard,
} from "@/lib/sprint-capacity";
import {
  MONTH_TEAM_CAPACITY_STORAGE_KEY,
  emptyMonthTeamCapacityBoard,
  monthTeamCapacityBoardKey,
  sanitizeMonthTeamCapacityBoard,
  type MonthTeamCapacityBoard,
} from "@/lib/month-team-capacity";
import {
  clampYearSprint,
  globalSprintFromMonthLane,
  monthLaneFromGlobalSprint,
  resolvedInitiativeYearSprintBounds,
  yearSprintRangeFromMonthRange,
} from "@/lib/year-sprint";

type PlannerProps = {
  initialInitiatives: InitiativeItem[];
  year: number;
};

const SPRINT_RETROSPECTIVE_STORAGE_KEY = "epicPlanner.sprintRetrospective.v1";

type SprintRetrospectiveEntry = {
  wentWellHtml: string;
  improveHtml: string;
  actionItems: Array<{ id: string; title: string; owner: string; dueDate: string }>;
  updatedAt: string;
};

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error("Request failed");
  }
  return (await response.json()) as T;
}

/** Avoid infinite `router.replace` loops when the browser serializes query params in a different order than `URLSearchParams#toString()`. */
function queryParamsEquivalent(searchA: string, searchB: string): boolean {
  const norm = (s: string) => (s.startsWith("?") ? s.slice(1) : s);
  const a = new URLSearchParams(norm(searchA));
  const b = new URLSearchParams(norm(searchB));
  const keysA = [...new Set(a.keys())].sort();
  const keysB = [...new Set(b.keys())].sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
  }
  for (const k of keysA) {
    if (a.getAll(k).join("\0") !== b.getAll(k).join("\0")) return false;
  }
  return true;
}

/** Drop month becomes the new start month; preserve span when rescheduling a multi-month initiative. */
function monthRangeForInitiativeDrop(
  initiative: InitiativeItem,
  dropMonth: number,
  isFirstSchedule: boolean,
): { startMonth: number; endMonth: number } {
  if (isFirstSchedule || initiative.startMonth == null || initiative.endMonth == null) {
    return { startMonth: dropMonth, endMonth: dropMonth };
  }
  const span = initiative.endMonth - initiative.startMonth + 1;
  let startMonth = dropMonth;
  let endMonth = dropMonth + span - 1;
  if (endMonth > 12) {
    endMonth = 12;
    startMonth = Math.max(1, endMonth - span + 1);
  }
  startMonth = Math.max(1, Math.min(12, startMonth));
  endMonth = Math.max(startMonth, Math.min(12, endMonth));
  return { startMonth, endMonth };
}

/** Place initiative in Gantt lanes; only adjust overlapping rows for existing scheduled items. */
function computeInitiativeMonthLanePlacement(
  prev: InitiativeItem[],
  initiativeId: string,
  month: number,
  laneIndex: number | undefined,
  hoveredLaneIndex: number | undefined,
  hoveredTimelineRow: number | undefined,
  isFirstSchedule: boolean,
): {
  next: InitiativeItem[];
  orderedScheduledIds: string[];
  rowsChanged: boolean;
  movedTimelineRow: number | null;
} {
  const scheduledAll = prev
    .filter(
      (i) =>
        i.status === InitiativeStatus.scheduled &&
        i.startMonth != null &&
        i.endMonth != null,
    )
    .sort((a, b) => a.timelineRow - b.timelineRow || a.title.localeCompare(b.title));
  const others = prev
    .filter(
      (i) =>
        i.status === InitiativeStatus.scheduled &&
        i.startMonth != null &&
        i.endMonth != null &&
        i.id !== initiativeId,
    )
    .sort((a, b) => a.timelineRow - b.timelineRow || a.title.localeCompare(b.title));

  const current = prev.find((i) => i.id === initiativeId);
  if (!current) return { next: prev, orderedScheduledIds: [], rowsChanged: false, movedTimelineRow: null };

  const { startMonth: sm, endMonth: em } = monthRangeForInitiativeDrop(current, month, isFirstSchedule);

  const placedBase: InitiativeItem = {
    ...current,
    status: InitiativeStatus.scheduled,
    startMonth: sm,
    endMonth: em,
    ...yearSprintRangeFromMonthRange(sm, em),
  };

  if (isFirstSchedule) {
    const insertAt = laneIndex !== undefined ? Math.max(0, Math.min(laneIndex, others.length)) : others.length;
    const newOrder = [...others.slice(0, insertAt), placedBase, ...others.slice(insertAt)];
    const orderedScheduledIds = newOrder.map((i) => i.id);
    const rowById = new Map(newOrder.map((i, idx) => [i.id, idx]));

    const next = prev.map((i) => {
      if (rowById.has(i.id)) {
        const r = rowById.get(i.id)!;
        if (i.id === initiativeId) {
          return {
            ...i,
            status: InitiativeStatus.scheduled,
            startMonth: sm,
            endMonth: em,
            ...yearSprintRangeFromMonthRange(sm, em),
            timelineRow: r,
          };
        }
        return { ...i, timelineRow: r };
      }
      return i;
    });

    return { next, orderedScheduledIds, rowsChanged: true, movedTimelineRow: rowById.get(initiativeId) ?? null };
  }

  const overlapsPlacedRange = (item: InitiativeItem) => {
    const os = item.startMonth ?? 1;
    const oe = item.endMonth ?? os;
    return !(oe < sm || os > em);
  };

  const overlappingOthers = others.filter(overlapsPlacedRange);
  const clampedLaneForTarget = laneIndex == null ? undefined : Math.max(0, laneIndex);
  /** Gantt row groups: one per distinct `timelineRow` (matches `data-gantt-lane-index` 0..n-1, append = n). */
  const distinctScheduledRowCount = new Set(scheduledAll.map((item) => item.timelineRow)).size;
  const maxTimelineRow =
    scheduledAll.length > 0 ? Math.max(...scheduledAll.map((item) => item.timelineRow)) : current.timelineRow;
  const appendTimelineRow = maxTimelineRow + 1;
  const wantsAppendRow = laneIndex != null && laneIndex >= distinctScheduledRowCount;
  const hoveredScheduledForTarget =
    hoveredLaneIndex == null
      ? null
      : (scheduledAll[Math.max(0, Math.min(hoveredLaneIndex, Math.max(0, scheduledAll.length - 1)))] ?? null);
  const targetRowFromHoverLaneForTarget =
    hoveredScheduledForTarget && hoveredScheduledForTarget.id !== initiativeId
      ? hoveredScheduledForTarget.timelineRow
      : null;
  const laneScheduledForTarget =
    clampedLaneForTarget == null
      ? null
      : (scheduledAll[Math.max(0, Math.min(clampedLaneForTarget, Math.max(0, scheduledAll.length - 1)))] ?? null);
  const targetRowFromLaneForTarget =
    clampedLaneForTarget == null
      ? null
      : clampedLaneForTarget >= others.length
        ? null
        : laneScheduledForTarget?.id === initiativeId
          ? null
          : (laneScheduledForTarget?.timelineRow ?? null);
  /** Bottom insert (lane index past last Gantt row) uses a new `timelineRow`, not nearest row from pointer. */
  const desiredTargetRow = wantsAppendRow
    ? appendTimelineRow
    : targetRowFromLaneForTarget != null
      ? targetRowFromLaneForTarget
      : hoveredTimelineRow != null && Number.isFinite(hoveredTimelineRow)
        ? hoveredTimelineRow
        : targetRowFromHoverLaneForTarget;
  console.log("[gantt-drop] target-row inputs", {
    initiativeId,
    laneIndex,
    hoveredLaneIndex,
    hoveredTimelineRow,
    clampedLaneForTarget,
    distinctScheduledRowCount,
    scheduledAllLength: scheduledAll.length,
    othersLength: others.length,
    maxTimelineRow,
    appendTimelineRow,
    wantsAppendRow,
    targetRowFromHoverLaneForTarget,
    targetRowFromLaneForTarget,
    desiredTargetRow,
    scheduledRows: scheduledAll.map((x) => ({ id: x.id, timelineRow: x.timelineRow })),
  });

  // No overlap with existing initiatives: only update moved initiative range/status.
  if (overlappingOthers.length === 0) {
    const movedTimelineRow = desiredTargetRow ?? current.timelineRow;
    const rowChanged = movedTimelineRow !== current.timelineRow;
    console.log("[gantt-drop] non-overlap lane resolution", {
      initiativeId,
      laneIndex,
      hoveredLaneIndex,
      hoveredTimelineRow,
      wantsAppendRow,
      appendTimelineRow,
      clampedLaneForTarget,
      scheduledAllLength: scheduledAll.length,
      currentTimelineRow: current.timelineRow,
      desiredTargetRow,
      movedTimelineRow,
      rowChanged,
      scheduledAll: scheduledAll.map((x) => ({ id: x.id, row: x.timelineRow, range: [x.startMonth, x.endMonth] })),
    });
    const next = prev.map((i) =>
      i.id === initiativeId
        ? {
            ...i,
            status: InitiativeStatus.scheduled,
            startMonth: sm,
            endMonth: em,
            ...yearSprintRangeFromMonthRange(sm, em),
            timelineRow: movedTimelineRow,
          }
        : i,
    );
    return { next, orderedScheduledIds: [], rowsChanged: rowChanged, movedTimelineRow };
  }

  // Even when the moved range overlaps elsewhere, allow exact target row sharing
  // if no overlapping initiative currently occupies that target row.
  if (desiredTargetRow != null) {
    const overlappingOnTargetRow = overlappingOthers.some((item) => item.timelineRow === desiredTargetRow);
    if (!overlappingOnTargetRow) {
      const rowChanged = desiredTargetRow !== current.timelineRow;
      console.log("[gantt-drop] overlap bypass (target row safe)", {
        initiativeId,
        laneIndex,
        hoveredLaneIndex,
        hoveredTimelineRow,
        wantsAppendRow,
        appendTimelineRow,
        clampedLaneForTarget,
        scheduledAllLength: scheduledAll.length,
        desiredTargetRow,
        currentTimelineRow: current.timelineRow,
        overlappingIds: overlappingOthers.map((x) => ({ id: x.id, row: x.timelineRow })),
      });
      const next = prev.map((i) =>
        i.id === initiativeId
          ? {
              ...i,
              status: InitiativeStatus.scheduled,
              startMonth: sm,
              endMonth: em,
              ...yearSprintRangeFromMonthRange(sm, em),
              timelineRow: desiredTargetRow,
            }
          : i,
      );
      return { next, orderedScheduledIds: [], rowsChanged: rowChanged, movedTimelineRow: desiredTargetRow };
    }
  }

  const overlappingIds = new Set(overlappingOthers.map((i) => i.id));
  const overlapRows = [...new Set([current.timelineRow, ...overlappingOthers.map((i) => i.timelineRow)])].sort(
    (a, b) => a - b,
  );

  let insertAtOverlap = overlappingOthers.length;
  if (laneIndex !== undefined) {
    const overlapsBeforeLane = others.reduce((count, item, idx) => {
      if (idx >= laneIndex) return count;
      return overlappingIds.has(item.id) ? count + 1 : count;
    }, 0);
    insertAtOverlap = Math.max(0, Math.min(overlapsBeforeLane, overlappingOthers.length));
  }

  const overlapOrder = [
    ...overlappingOthers.slice(0, insertAtOverlap),
    placedBase,
    ...overlappingOthers.slice(insertAtOverlap),
  ];
  console.log("[gantt-drop] overlap lane resolution", {
    initiativeId,
    laneIndex,
    hoveredLaneIndex,
    hoveredTimelineRow,
    insertAtOverlap,
    overlapRows,
    overlappingIds: overlappingOthers.map((x) => x.id),
    overlapOrder: overlapOrder.map((x) => x.id),
  });
  const rowById = new Map<string, number>();
  overlapOrder.forEach((item, idx) => {
    rowById.set(item.id, overlapRows[Math.min(idx, overlapRows.length - 1)]!);
  });

  const next = prev.map((i) => {
    if (i.id === initiativeId) {
      return {
        ...i,
        status: InitiativeStatus.scheduled,
        startMonth: sm,
        endMonth: em,
        ...yearSprintRangeFromMonthRange(sm, em),
        timelineRow: rowById.get(i.id) ?? i.timelineRow,
      };
    }
    if (rowById.has(i.id)) {
      return { ...i, timelineRow: rowById.get(i.id)! };
    }
    return i;
  });

  const rowsChanged = next.some((item) => {
    const before = prev.find((p) => p.id === item.id);
    return !!before && before.timelineRow !== item.timelineRow;
  });
  const orderedScheduledIds = rowsChanged
    ? [...next]
        .filter((i) => i.status === InitiativeStatus.scheduled && i.startMonth != null && i.endMonth != null)
        .sort((a, b) => a.timelineRow - b.timelineRow || a.title.localeCompare(b.title))
        .map((i) => i.id)
    : [];

  return {
    next,
    orderedScheduledIds,
    rowsChanged,
    movedTimelineRow: rowById.get(initiativeId) ?? current.timelineRow,
  };
}

type ScheduledEpicPlacementRow = {
  epicId: string;
  initiativeId: string;
  title: string;
  timelineRow: number;
  startMonth: number;
  endMonth: number;
};

function monthRangeForEpicDrop(
  epic: EpicItem,
  dropMonth: number,
  isFirstSchedule: boolean,
): { startMonth: number; endMonth: number } {
  if (isFirstSchedule || epic.planStartMonth == null || epic.planEndMonth == null) {
    return { startMonth: dropMonth, endMonth: dropMonth };
  }
  const span = epic.planEndMonth - epic.planStartMonth + 1;
  let startMonth = dropMonth;
  let endMonth = dropMonth + span - 1;
  if (endMonth > 12) {
    endMonth = 12;
    startMonth = Math.max(1, endMonth - span + 1);
  }
  startMonth = Math.max(1, Math.min(12, startMonth));
  endMonth = Math.max(startMonth, Math.min(12, endMonth));
  return { startMonth, endMonth };
}

function laneFromYearSprint(yearSprint: number): 1 | 2 {
  return yearSprint % 2 === 0 ? 2 : 1;
}

function collectScheduledEpicRows(initiatives: InitiativeItem[]): ScheduledEpicPlacementRow[] {
  const rows: ScheduledEpicPlacementRow[] = [];
  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      if (epic.planStartMonth == null || epic.planEndMonth == null) continue;
      rows.push({
        epicId: epic.id,
        initiativeId: initiative.id,
        title: epic.title,
        timelineRow: Number.isFinite(epic.timelineRow) ? epic.timelineRow : 0,
        startMonth: epic.planStartMonth,
        endMonth: epic.planEndMonth,
      });
    }
  }
  return rows.sort((a, b) => a.timelineRow - b.timelineRow || a.title.localeCompare(b.title));
}

function computeEpicMonthLanePlacement(
  prev: InitiativeItem[],
  epicId: string,
  month: number,
  planSprint: 1 | 2,
  laneIndex: number | undefined,
  hoveredLaneIndex: number | undefined,
  hoveredTimelineRow: number | undefined,
  isFirstSchedule: boolean,
): { next: InitiativeItem[]; rowsChanged: boolean; movedTimelineRow: number | null } {
  const currentInit = prev.find((i) => (i.epics ?? []).some((e) => e.id === epicId));
  const currentEpic = currentInit?.epics?.find((e) => e.id === epicId);
  if (!currentInit || !currentEpic) {
    return { next: prev, rowsChanged: false, movedTimelineRow: null };
  }

  const { startMonth: sm, endMonth: em } = monthRangeForEpicDrop(currentEpic, month, isFirstSchedule);
  const scheduledAll = collectScheduledEpicRows(prev);
  const others = scheduledAll.filter((row) => row.epicId !== epicId);
  const overlapsPlacedRange = (row: ScheduledEpicPlacementRow) => !(row.endMonth < sm || row.startMonth > em);
  const overlappingOthers = others.filter(overlapsPlacedRange);
  const currentRow = Number.isFinite(currentEpic.timelineRow) ? currentEpic.timelineRow : 0;

  if (isFirstSchedule) {
    const insertAt = laneIndex !== undefined ? Math.max(0, Math.min(laneIndex, others.length)) : others.length;
    const newOrder = [
      ...others.slice(0, insertAt),
      { epicId, initiativeId: currentInit.id, title: currentEpic.title, timelineRow: 0, startMonth: sm, endMonth: em },
      ...others.slice(insertAt),
    ];
    const rowByEpicId = new Map(newOrder.map((row, idx) => [row.epicId, idx]));
    const next = prev.map((initiative) => ({
      ...initiative,
      epics: (initiative.epics ?? []).map((epic) =>
        epic.id === epicId
          ? {
              ...epic,
              planSprint,
              planStartMonth: sm,
              planEndMonth: em,
              planEndSprint: 2,
              timelineRow: rowByEpicId.get(epic.id) ?? 0,
            }
          : rowByEpicId.has(epic.id)
            ? { ...epic, timelineRow: rowByEpicId.get(epic.id)! }
            : epic,
      ),
    }));
    return { next, rowsChanged: true, movedTimelineRow: rowByEpicId.get(epicId) ?? null };
  }

  const clampedLaneForTarget = laneIndex == null ? undefined : Math.max(0, laneIndex);
  const distinctScheduledRowCount = new Set(scheduledAll.map((item) => item.timelineRow)).size;
  const maxTimelineRow = scheduledAll.length > 0 ? Math.max(...scheduledAll.map((item) => item.timelineRow)) : currentRow;
  const appendTimelineRow = maxTimelineRow + 1;
  const wantsAppendRow = laneIndex != null && laneIndex >= distinctScheduledRowCount;
  const hoveredScheduledForTarget =
    hoveredLaneIndex == null
      ? null
      : (scheduledAll[Math.max(0, Math.min(hoveredLaneIndex, Math.max(0, scheduledAll.length - 1)))] ?? null);
  const targetRowFromHoverLaneForTarget =
    hoveredScheduledForTarget && hoveredScheduledForTarget.epicId !== epicId
      ? hoveredScheduledForTarget.timelineRow
      : null;
  const targetRowFromLaneForTarget =
    clampedLaneForTarget == null
      ? null
      : clampedLaneForTarget;
  const desiredTargetRow = wantsAppendRow
    ? appendTimelineRow
    : targetRowFromLaneForTarget != null
      ? targetRowFromLaneForTarget
      : hoveredTimelineRow != null && Number.isFinite(hoveredTimelineRow)
        ? hoveredTimelineRow
        : targetRowFromHoverLaneForTarget;
  console.log("[gantt-drop][epic] target-row inputs", {
    epicId,
    month,
    laneIndex,
    hoveredLaneIndex,
    hoveredTimelineRow,
    isFirstSchedule,
    currentRow,
    clampedLaneForTarget,
    distinctScheduledRowCount,
    scheduledAllLength: scheduledAll.length,
    othersLength: others.length,
    maxTimelineRow,
    appendTimelineRow,
    wantsAppendRow,
    targetRowFromHoverLaneForTarget,
    targetRowFromLaneForTarget,
    desiredTargetRow,
    scheduledRows: scheduledAll.map((x) => ({
      epicId: x.epicId,
      row: x.timelineRow,
      range: [x.startMonth, x.endMonth],
    })),
  });

  if (overlappingOthers.length === 0 || (desiredTargetRow != null && !overlappingOthers.some((row) => row.timelineRow === desiredTargetRow))) {
    const movedTimelineRow = desiredTargetRow ?? currentRow;
    const rowsChanged = movedTimelineRow !== currentRow;
    console.log("[gantt-drop][epic] non-overlap lane resolution", {
      epicId,
      month,
      laneIndex,
      hoveredLaneIndex,
      hoveredTimelineRow,
      desiredTargetRow,
      movedTimelineRow,
      currentRow,
      rowsChanged,
      overlapCount: overlappingOthers.length,
    });
    const next = prev.map((initiative) => ({
      ...initiative,
      epics: (initiative.epics ?? []).map((epic) =>
        epic.id === epicId
          ? { ...epic, planSprint, planStartMonth: sm, planEndMonth: em, planEndSprint: 2, timelineRow: movedTimelineRow }
          : epic,
      ),
    }));
    return { next, rowsChanged, movedTimelineRow };
  }

  const overlappingIds = new Set(overlappingOthers.map((row) => row.epicId));
  const overlapRows = [...new Set([currentRow, ...overlappingOthers.map((row) => row.timelineRow)])].sort((a, b) => a - b);
  let insertAtOverlap = overlappingOthers.length;
  if (laneIndex !== undefined) {
    const overlapsBeforeLane = others.reduce((count, row, idx) => {
      if (idx >= laneIndex) return count;
      return overlappingIds.has(row.epicId) ? count + 1 : count;
    }, 0);
    insertAtOverlap = Math.max(0, Math.min(overlapsBeforeLane, overlappingOthers.length));
  }
  const overlapOrder = [
    ...overlappingOthers.slice(0, insertAtOverlap),
    { epicId, initiativeId: currentInit.id, title: currentEpic.title, timelineRow: currentRow, startMonth: sm, endMonth: em },
    ...overlappingOthers.slice(insertAtOverlap),
  ];
  const rowByEpicId = new Map<string, number>();
  overlapOrder.forEach((row, idx) => rowByEpicId.set(row.epicId, overlapRows[Math.min(idx, overlapRows.length - 1)]!));
  console.log("[gantt-drop][epic] overlap lane resolution", {
    epicId,
    month,
    laneIndex,
    hoveredLaneIndex,
    hoveredTimelineRow,
    currentRow,
    overlapRows,
    overlappingIds: overlappingOthers.map((x) => ({ epicId: x.epicId, row: x.timelineRow })),
    overlapOrder: overlapOrder.map((x) => x.epicId),
    nextRow: rowByEpicId.get(epicId) ?? currentRow,
  });

  const next = prev.map((initiative) => ({
    ...initiative,
    epics: (initiative.epics ?? []).map((epic) =>
      epic.id === epicId
        ? {
            ...epic,
            planSprint,
            planStartMonth: sm,
            planEndMonth: em,
            planEndSprint: 2,
            timelineRow: rowByEpicId.get(epic.id) ?? epic.timelineRow,
          }
        : rowByEpicId.has(epic.id)
          ? { ...epic, timelineRow: rowByEpicId.get(epic.id)! }
          : epic,
    ),
  }));
  const rowsChanged = next.some((initiative) => {
    const beforeInit = prev.find((item) => item.id === initiative.id);
    if (!beforeInit) return false;
    return (initiative.epics ?? []).some((epic) => {
      const beforeEpic = (beforeInit.epics ?? []).find((row) => row.id === epic.id);
      return beforeEpic != null && beforeEpic.timelineRow !== epic.timelineRow;
    });
  });
  return { next, rowsChanged, movedTimelineRow: rowByEpicId.get(epicId) ?? currentRow };
}

function epicIsOnPlanForMonth(epic: EpicItem, month: number): boolean {
  if (epic.planSprint == null || epic.planStartMonth == null || epic.planEndMonth == null) return false;
  return epic.planStartMonth <= month && epic.planEndMonth >= month;
}

function monthBacklogEpicIds(
  initiatives: InitiativeItem[],
  month: number,
  epicBacklogOrderByMonth: Record<number, string[]>,
): string[] {
  const base = initiatives
    .filter((initiative) => {
      if (initiative.status !== InitiativeStatus.scheduled) return false;
      if (initiative.startMonth == null || initiative.endMonth == null) return false;
      return !(initiative.endMonth < month || initiative.startMonth > month);
    })
    .flatMap((initiative) => (initiative.epics ?? []).filter((epic) => !epicIsOnPlanForMonth(epic, month)))
    .map((epic) => epic.id);

  const order = epicBacklogOrderByMonth[month] ?? [];
  if (order.length === 0) return base;
  const baseSet = new Set(base);
  const ordered = order.filter((id) => baseSet.has(id));
  const orderedSet = new Set(ordered);
  const rest = base.filter((id) => !orderedSet.has(id));
  return [...ordered, ...rest];
}

function buildStoryRefMaps(initiatives: InitiativeItem[]): {
  byId: Record<string, string>;
  idByRef: Record<string, string>;
} {
  const rows = initiatives
    .flatMap((initiative) =>
      (initiative.epics ?? []).flatMap((epic) =>
        (epic.userStories ?? []).map((story) => ({
          id: story.id,
          createdAt: new Date(story.createdAt).getTime(),
          title: story.title,
        })),
      ),
    )
    .sort((a, b) => a.createdAt - b.createdAt || a.title.localeCompare(b.title));
  const byId: Record<string, string> = {};
  const idByRef: Record<string, string> = {};
  rows.forEach((row, idx) => {
    const ref = String(idx + 1).padStart(2, "0");
    byId[row.id] = ref;
    idByRef[ref] = row.id;
  });
  return { byId, idByRef };
}

/** Map URL `story` param (e.g. `09`, `9`, `US-09`, or raw id) to a story primary key. */
function resolveStoryIdFromUrlParam(storyParam: string, maps: ReturnType<typeof buildStoryRefMaps>): string {
  const raw = storyParam.trim();
  if (!raw) return raw;
  const direct = maps.idByRef[raw];
  if (direct) return direct;
  const stripped = raw.replace(/^US-/i, "");
  const padded = stripped.padStart(2, "0");
  return maps.idByRef[stripped] ?? maps.idByRef[padded] ?? raw;
}

export function EpicPlannerApp({ initialInitiatives, year }: PlannerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [initiatives, setInitiatives] = useState(initialInitiatives);
  const [selectedYear, setSelectedYear] = useState(year);
  const [initiativeDialogOpen, setInitiativeDialogOpen] = useState(false);
  const [editingInitiative, setEditingInitiative] = useState<InitiativeItem | undefined>(undefined);
  const [epicDialogOpen, setEpicDialogOpen] = useState(false);
  const [editingEpic, setEditingEpic] = useState<EpicItem | undefined>(undefined);
  const [editingEpicInitiativeId, setEditingEpicInitiativeId] = useState<string | null>(null);
  const [focusedQuarterLabel, setFocusedQuarterLabel] = useState<string | null>(null);
  const [isSprintModeActive, setIsSprintModeActive] = useState(false);
  const [activeTimelineMonth, setActiveTimelineMonth] = useState<number | null>(null);
  const [activeYearSprint, setActiveYearSprint] = useState<number | null>(null);
  const [activeSprintTab, setActiveSprintTab] = useState<"kanban" | "status">("kanban");
  const [activeMonthPlanTab, setActiveMonthPlanTab] = useState<MonthPlanSurfaceTab>("epic-gantt");
  const [panelStatusQuickFilter, setPanelStatusQuickFilter] = useState<"Scheduled" | "Unscheduled" | null>(null);
  /** When sprint Kanban is opened from a team lane: team id for breadcrumb and left epic list. */
  const [sprintStoryBoardTeamId, setSprintStoryBoardTeamId] = useState<string | null>(null);
  const [monthTeamBoardByKey, setMonthTeamBoardByKey] = useState<Record<string, MonthTeamBoardPersisted>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem("epicPlanner.monthTeamBoard.v1");
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, MonthTeamBoardPersisted>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const [sprintCapacityByKey, setSprintCapacityByKey] = useState<Record<string, SprintCapacityBoard>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(SPRINT_CAPACITY_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, SprintCapacityBoard>;
      if (!parsed || typeof parsed !== "object") return {};
      return Object.fromEntries(
        Object.entries(parsed).map(([k, board]) => [k, sanitizeSprintCapacityBoard(board)]),
      );
    } catch {
      return {};
    }
  });
  const [monthTeamCapacityByKey, setMonthTeamCapacityByKey] = useState<Record<string, MonthTeamCapacityBoard>>(
    () => {
      if (typeof window === "undefined") return {};
      try {
        const raw = localStorage.getItem(MONTH_TEAM_CAPACITY_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, MonthTeamCapacityBoard>;
        if (!parsed || typeof parsed !== "object") return {};
        return Object.fromEntries(
          Object.entries(parsed).map(([k, board]) => [k, sanitizeMonthTeamCapacityBoard(board)]),
        );
      } catch {
        return {};
      }
    },
  );
  const [sprintRetrospectiveByKey, setSprintRetrospectiveByKey] = useState<
    Record<string, SprintRetrospectiveEntry>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(SPRINT_RETROSPECTIVE_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") return {};
      const out: Record<string, SprintRetrospectiveEntry> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value !== "object") continue;
        const v = value as {
          content?: unknown;
          wentWellHtml?: unknown;
          improveHtml?: unknown;
          actionItems?: unknown;
          updatedAt?: unknown;
        };
        const updatedAt = typeof v.updatedAt === "string" ? v.updatedAt : new Date().toISOString();
        const wentWellHtml =
          typeof v.wentWellHtml === "string"
            ? v.wentWellHtml
            : typeof v.content === "string"
              ? v.content
              : "<p><br/></p>";
        const improveHtml = typeof v.improveHtml === "string" ? v.improveHtml : "<p><br/></p>";
        const actionItems = Array.isArray(v.actionItems)
          ? v.actionItems
              .filter((item) => item && typeof item === "object")
              .map((item) => {
                const row = item as { id?: unknown; title?: unknown; owner?: unknown; dueDate?: unknown };
                return {
                  id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
                  title: typeof row.title === "string" ? row.title : "",
                  owner: typeof row.owner === "string" ? row.owner : "",
                  dueDate: typeof row.dueDate === "string" ? row.dueDate : "",
                };
              })
          : [];
        out[key] = { wentWellHtml, improveHtml, actionItems, updatedAt };
      }
      return out;
    } catch {
      return {};
    }
  });
  const [topMode, setTopMode] = useState<"roadmap" | "backlog">("roadmap");
  const [epicBacklogOrderByMonth, setEpicBacklogOrderByMonth] = useState<Record<number, string[]>>({});
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [creatingStoryEpicId, setCreatingStoryEpicId] = useState<string | null>(null);
  /** Separate from selection so `open` can go false before IDs clear, allowing exit animation. */
  const [storyDialogOpen, setStoryDialogOpen] = useState(false);
  const pendingStoryDialogNavigationRef = useRef<null | (() => void)>(null);
  const [panelWidth, setPanelWidth] = useState(520);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const planningRightSurfaceRef = useRef<HTMLDivElement | null>(null);
  const ganttEmphasisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ganttEmphasisTickRef = useRef(0);
  const [ganttEmphasis, setGanttEmphasis] = useState<{ initiativeId: string; tick: number } | null>(null);
  const [isUrlHydrated, setIsUrlHydrated] = useState(false);
  const hasHydratedFromUrlRef = useRef(false);

  const handleInitiativeAccordionChange = useCallback(
    (initiativeId: string, isOpen: boolean) => {
      if (!isOpen) return;
      const inv = initiatives.find((i) => i.id === initiativeId);
      if (
        !inv ||
        inv.status !== InitiativeStatus.scheduled ||
        inv.startMonth == null ||
        inv.endMonth == null
      ) {
        return;
      }
      const sm = inv.startMonth;
      const em = inv.endMonth;
      const overlappingQuarter =
        QUARTERS.find((q) => {
          const qs = q.months[0];
          const qe = q.months[q.months.length - 1];
          return !(em < qs || sm > qe);
        }) ?? null;

      if (overlappingQuarter != null && focusedQuarterLabel != null) {
        const current = QUARTERS.find((q) => q.label === focusedQuarterLabel);
        if (current) {
          const cqs = current.months[0];
          const cqe = current.months[current.months.length - 1];
          const overlapsCurrent = !(em < cqs || sm > cqe);
          if (!overlapsCurrent) {
            setFocusedQuarterLabel(overlappingQuarter.label);
          }
        }
      }

      ganttEmphasisTickRef.current += 1;
      const tick = ganttEmphasisTickRef.current;
      setGanttEmphasis({ initiativeId, tick });
      if (ganttEmphasisTimeoutRef.current) {
        clearTimeout(ganttEmphasisTimeoutRef.current);
        ganttEmphasisTimeoutRef.current = null;
      }
      ganttEmphasisTimeoutRef.current = setTimeout(() => {
        setGanttEmphasis(null);
        ganttEmphasisTimeoutRef.current = null;
      }, 2000);
    },
    [initiatives, focusedQuarterLabel],
  );

  useEffect(
    () => () => {
      if (ganttEmphasisTimeoutRef.current) {
        clearTimeout(ganttEmphasisTimeoutRef.current);
        ganttEmphasisTimeoutRef.current = null;
      }
    },
    [],
  );

  const ganttEpicEmphasisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ganttEpicEmphasisTickRef = useRef(0);
  const [ganttEpicEmphasis, setGanttEpicEmphasis] = useState<{ epicId: string; tick: number } | null>(
    null,
  );

  const flashGanttEpicEmphasis = useCallback((epicId: string) => {
    ganttEpicEmphasisTickRef.current += 1;
    const tick = ganttEpicEmphasisTickRef.current;
    setGanttEpicEmphasis({ epicId, tick });
    if (ganttEpicEmphasisTimeoutRef.current) {
      clearTimeout(ganttEpicEmphasisTimeoutRef.current);
      ganttEpicEmphasisTimeoutRef.current = null;
    }
    ganttEpicEmphasisTimeoutRef.current = setTimeout(() => {
      setGanttEpicEmphasis(null);
      ganttEpicEmphasisTimeoutRef.current = null;
    }, 2000);
  }, []);

  useEffect(
    () => () => {
      if (ganttEpicEmphasisTimeoutRef.current) {
        clearTimeout(ganttEpicEmphasisTimeoutRef.current);
        ganttEpicEmphasisTimeoutRef.current = null;
      }
    },
    [],
  );

  const roadmapSummary = useMemo(() => {
    const scheduled = initiatives.filter((i) => i.status === "scheduled");
    const epics = initiatives.flatMap((initiative) => initiative.epics ?? []);
    const scheduledEpics = epics.filter(
      (epic) => epic.planSprint != null && epic.planStartMonth != null && epic.planEndMonth != null,
    );
    const unscheduledEpics = epics.length - scheduledEpics.length;
    const totalStories = initiatives.reduce(
      (sum, i) => sum + (i.epics ?? []).reduce((es, e) => es + (e.userStories?.length ?? 0), 0),
      0,
    );
    const completedStories = initiatives.reduce(
      (sum, initiative) =>
        sum +
        (initiative.epics ?? []).reduce(
          (epicSum, epic) =>
            epicSum +
            (epic.userStories ?? []).filter(
              (story) => story.status === StoryStatus.done || story.status === StoryStatus.approved,
            ).length,
          0,
        ),
      0,
    );
    const completionPercent = totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;

    return {
      totalInitiatives: initiatives.length,
      scheduledInitiatives: scheduled.length,
      scheduledEpics: scheduledEpics.length,
      unscheduledEpics,
      totalStories,
      completedStories,
      completionPercent,
    };
  }, [initiatives]);
  const storyRefMaps = useMemo(() => buildStoryRefMaps(initiatives), [initiatives]);

  const currentEditingInitiative = useMemo(() => {
    if (!editingInitiative) return undefined;
    return initiatives.find((i) => i.id === editingInitiative.id) ?? editingInitiative;
  }, [initiatives, editingInitiative]);

  const currentEditingEpic = useMemo(() => {
    if (!editingEpic) return undefined;
    for (const initiative of initiatives) {
      const epic = (initiative.epics ?? []).find((e) => e.id === editingEpic.id);
      if (epic) return epic;
    }
    return editingEpic;
  }, [initiatives, editingEpic]);

  const selectedStory = useMemo(() => {
    if (!selectedStoryId) return null;
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        const story = (epic.userStories ?? []).find((s) => s.id === selectedStoryId);
        if (story) {
          return { ...story, epicTitle: epic.title };
        }
      }
    }
    const epic = currentEditingEpic;
    if (epic) {
      const story = (epic.userStories ?? []).find((s) => s.id === selectedStoryId);
      if (story) {
        return { ...story, epicTitle: epic.title };
      }
    }
    return null;
  }, [selectedStoryId, initiatives, currentEditingEpic]);

  useEffect(() => {
    if (selectedStoryId != null || creatingStoryEpicId != null) {
      setStoryDialogOpen(true);
    }
  }, [selectedStoryId, creatingStoryEpicId]);

  useEffect(() => {
    if (selectedStoryId == null && creatingStoryEpicId == null) {
      setStoryDialogOpen(false);
    }
  }, [selectedStoryId, creatingStoryEpicId]);

  useEffect(() => {
    if (hasHydratedFromUrlRef.current) return;
    hasHydratedFromUrlRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("quarter");
    if (q && QUARTERS.some((item) => item.label === q)) {
      setFocusedQuarterLabel(q);
    }
    const monthRaw = params.get("month");
    let hydratedMonth: number | null = null;
    if (monthRaw) {
      const month = Number(monthRaw);
      if (Number.isFinite(month) && month >= 1 && month <= 12) {
        hydratedMonth = month;
        setActiveTimelineMonth(month);
      }
    }
    const sprintRaw = params.get("sprint");
    if (sprintRaw != null) {
      const n = Number(sprintRaw);
      if (Number.isFinite(n) && n >= 1 && n <= 24) {
        setActiveYearSprint(clampYearSprint(n));
        setIsSprintModeActive(true);
      }
    }
    const sprintViewRaw = params.get("sprintView");
    if (sprintViewRaw === "kanban" || sprintViewRaw === "status") {
      setActiveSprintTab(sprintViewRaw);
    }
    const planTabRaw = params.get("planTab");
    let hydratedMonthPlanTab: MonthPlanSurfaceTab = "epic-gantt";
    if (hydratedMonth != null) {
      if (planTabRaw === "team") {
        hydratedMonthPlanTab = "team-queue";
      } else if (planTabRaw === "teamCapacity") {
        hydratedMonthPlanTab = "month-capacity";
      } else if (planTabRaw === "epic") {
        hydratedMonthPlanTab = "epic-gantt";
      } else if (planTabRaw === "monthInsights") {
        hydratedMonthPlanTab = "month-status";
      } else if (planTabRaw === "sprintBoard") {
        hydratedMonthPlanTab = "sprint-kanban";
      } else if (planTabRaw === "sprintCapacity") {
        hydratedMonthPlanTab = "sprint-capacity";
      } else if (planTabRaw === "sprintRetro") {
        hydratedMonthPlanTab = "sprint-retrospective";
      } else if (planTabRaw === "sprintInsights") {
        hydratedMonthPlanTab = params.get("sprint") != null ? "sprint-status" : "month-status";
      } else if (params.get("sprint") != null) {
        hydratedMonthPlanTab = sprintViewRaw === "status" ? "sprint-status" : "sprint-kanban";
      } else {
        hydratedMonthPlanTab = "epic-gantt";
      }
      setActiveMonthPlanTab(hydratedMonthPlanTab);
      if (
        hydratedMonthPlanTab === "sprint-kanban" ||
        hydratedMonthPlanTab === "sprint-status" ||
        hydratedMonthPlanTab === "sprint-capacity" ||
        hydratedMonthPlanTab === "sprint-retrospective"
      ) {
        const sprintTeamRaw = params.get("sprintTeam");
        if (sprintTeamRaw && MONTH_TEAM_IDS.includes(sprintTeamRaw)) {
          setSprintStoryBoardTeamId(sprintTeamRaw);
        }
      }
    }
    const epicId = params.get("epic");
    if (epicId) {
      for (const initiative of initialInitiatives) {
        const epic = (initiative.epics ?? []).find((e) => e.id === epicId);
        if (epic) {
          setEditingEpic(epic);
          setEditingEpicInitiativeId(initiative.id);
          setEpicDialogOpen(true);
          break;
        }
      }
    }
    const storyRef = params.get("story");
    if (storyRef) {
      const initialMaps = buildStoryRefMaps(initialInitiatives);
      setSelectedStoryId(resolveStoryIdFromUrlParam(storyRef, initialMaps));
    }
    setIsUrlHydrated(true);
  }, [initialInitiatives]);

  const prevTimelineMonthRef = useRef<number | null | "init">("init");
  useEffect(() => {
    if (prevTimelineMonthRef.current === "init") {
      prevTimelineMonthRef.current = activeTimelineMonth;
      return;
    }
    if (prevTimelineMonthRef.current !== activeTimelineMonth) {
      prevTimelineMonthRef.current = activeTimelineMonth;
      if (activeTimelineMonth != null) {
        const onSprintSurface =
          activeMonthPlanTab === "sprint-kanban" ||
          activeMonthPlanTab === "sprint-status" ||
          activeMonthPlanTab === "sprint-capacity" ||
          activeMonthPlanTab === "sprint-retrospective";
        /** Opening sprint from the roadmap sets month + sprint tab in one update; don't clobber back to epic Gantt. */
        if (!onSprintSurface) {
          setActiveMonthPlanTab("epic-gantt");
          setSprintStoryBoardTeamId(null);
        }
      }
    }
  }, [activeTimelineMonth, activeMonthPlanTab]);

  useEffect(() => {
    try {
      const cleaned = Object.fromEntries(
        Object.entries(monthTeamBoardByKey).map(([k, v]) => [k, sanitizeMonthTeamBoardPersisted(v)]),
      );
      localStorage.setItem("epicPlanner.monthTeamBoard.v1", JSON.stringify(cleaned));
    } catch {
      /* ignore quota / private mode */
    }
  }, [monthTeamBoardByKey]);

  useEffect(() => {
    try {
      const cleaned = Object.fromEntries(
        Object.entries(sprintCapacityByKey).map(([k, v]) => [k, sanitizeSprintCapacityBoard(v)]),
      );
      localStorage.setItem(SPRINT_CAPACITY_STORAGE_KEY, JSON.stringify(cleaned));
    } catch {
      /* ignore quota / private mode */
    }
  }, [sprintCapacityByKey]);

  useEffect(() => {
    try {
      const cleaned = Object.fromEntries(
        Object.entries(monthTeamCapacityByKey).map(([k, v]) => [k, sanitizeMonthTeamCapacityBoard(v)]),
      );
      localStorage.setItem(MONTH_TEAM_CAPACITY_STORAGE_KEY, JSON.stringify(cleaned));
    } catch {
      /* ignore quota / private mode */
    }
  }, [monthTeamCapacityByKey]);

  useEffect(() => {
    try {
      localStorage.setItem(SPRINT_RETROSPECTIVE_STORAGE_KEY, JSON.stringify(sprintRetrospectiveByKey));
    } catch {
      /* ignore quota / private mode */
    }
  }, [sprintRetrospectiveByKey]);

  useEffect(() => {
    if (!isUrlHydrated) return;
    const params = new URLSearchParams();
    if (focusedQuarterLabel) params.set("quarter", focusedQuarterLabel);
    if (activeTimelineMonth != null) {
      params.set("month", String(activeTimelineMonth));
      if (activeMonthPlanTab === "epic-gantt") params.set("planTab", "epic");
      else if (activeMonthPlanTab === "team-queue") params.set("planTab", "team");
      else if (activeMonthPlanTab === "month-capacity") params.set("planTab", "teamCapacity");
      else if (activeMonthPlanTab === "month-status") params.set("planTab", "monthInsights");
      else if (activeMonthPlanTab === "sprint-kanban") params.set("planTab", "sprintBoard");
      else if (activeMonthPlanTab === "sprint-capacity") params.set("planTab", "sprintCapacity");
      else if (activeMonthPlanTab === "sprint-retrospective") params.set("planTab", "sprintRetro");
      else params.set("planTab", "sprintInsights");
    }
    if (activeYearSprint != null) params.set("sprint", String(activeYearSprint));
    if (activeYearSprint != null) params.set("sprintView", activeSprintTab);
    if (
      (activeMonthPlanTab === "sprint-kanban" ||
        activeMonthPlanTab === "sprint-status" ||
        activeMonthPlanTab === "sprint-capacity" ||
        activeMonthPlanTab === "sprint-retrospective") &&
      isKnownEpicTeamId(sprintStoryBoardTeamId)
    ) {
      params.set("sprintTeam", sprintStoryBoardTeamId);
    }
    if (epicDialogOpen && editingEpic?.id) params.set("epic", editingEpic.id);
    if (selectedStoryId) params.set("story", storyRefMaps.byId[selectedStoryId] ?? selectedStoryId);
    const next = params.toString();
    const target = next ? `${pathname}?${next}` : pathname;
    const targetSearch = next ? `?${next}` : "";
    if (window.location.pathname !== pathname) {
      router.replace(target, { scroll: false });
    } else if (!queryParamsEquivalent(window.location.search, targetSearch)) {
      router.replace(target, { scroll: false });
    }
  }, [
    isUrlHydrated,
    focusedQuarterLabel,
    activeTimelineMonth,
    activeYearSprint,
    activeSprintTab,
    activeMonthPlanTab,
    epicDialogOpen,
    editingEpic?.id,
    selectedStoryId,
    storyRefMaps.byId,
    router,
    pathname,
    sprintStoryBoardTeamId,
  ]);

  const handleSprintModeChange = useCallback(
    (active: boolean, month: number | null, yearSprint: number | null) => {
      setIsSprintModeActive(active);
      setActiveTimelineMonth(month);
      setActiveYearSprint(yearSprint == null ? null : clampYearSprint(yearSprint));
      if (!active || month == null) {
        setSprintStoryBoardTeamId(null);
      }
      if (yearSprint == null) {
        setActiveSprintTab("kanban");
      }
    },
    [],
  );

  const handleMonthPlanTabChange = useCallback((tab: MonthPlanSurfaceTab) => {
    setActiveMonthPlanTab(tab);
    if (tab === "sprint-kanban") setActiveSprintTab("kanban");
    if (tab === "sprint-status") setActiveSprintTab("status");
    if (tab === "epic-gantt" || tab === "team-queue" || tab === "month-capacity" || tab === "month-status") {
      setSprintStoryBoardTeamId(null);
    }
  }, []);

  const activeMonthTeamCapacityKey = useMemo(() => {
    if (activeTimelineMonth == null) return null;
    return monthTeamCapacityBoardKey(selectedYear, activeTimelineMonth);
  }, [selectedYear, activeTimelineMonth]);

  const activeMonthTeamCapacityBoard = useMemo(() => {
    if (!activeMonthTeamCapacityKey) return emptyMonthTeamCapacityBoard();
    return monthTeamCapacityByKey[activeMonthTeamCapacityKey] ?? emptyMonthTeamCapacityBoard();
  }, [activeMonthTeamCapacityKey, monthTeamCapacityByKey]);

  const updateMonthTeamCapacity = useCallback(
    (teamId: string, days: number) => {
      if (!activeMonthTeamCapacityKey) return;
      setMonthTeamCapacityByKey((prev) => {
        const cur = prev[activeMonthTeamCapacityKey] ?? emptyMonthTeamCapacityBoard();
        return {
          ...prev,
          [activeMonthTeamCapacityKey]: {
            capacities: { ...cur.capacities, [teamId]: Math.max(0, Math.min(200, Number(days) || 0)) },
          },
        };
      });
    },
    [activeMonthTeamCapacityKey],
  );

  const updateQuarterTeamCapacity = useCallback((quarterLabel: string, teamId: string, quarterTotalDays: number) => {
    const q = QUARTERS.find((item) => item.label === quarterLabel);
    if (!q) return;
    const parts = splitQuarterTotalAcrossMonths(quarterTotalDays, q.months.length, 200);
    setMonthTeamCapacityByKey((prev) => {
      let next = { ...prev };
      for (let i = 0; i < q.months.length; i++) {
        const mk = monthTeamCapacityBoardKey(selectedYear, q.months[i]!);
        const cur = next[mk] ?? emptyMonthTeamCapacityBoard();
        next = {
          ...next,
          [mk]: {
            capacities: { ...cur.capacities, [teamId]: parts[i]! },
          },
        };
      }
      return next;
    });
  }, [selectedYear]);

  const updateYearTeamCapacity = useCallback((teamId: string, yearTotalDays: number) => {
    const allMonths = Array.from({ length: 12 }, (_, index) => index + 1);
    const parts = splitQuarterTotalAcrossMonths(yearTotalDays, allMonths.length, 200);
    setMonthTeamCapacityByKey((prev) => {
      let next = { ...prev };
      for (let i = 0; i < allMonths.length; i++) {
        const mk = monthTeamCapacityBoardKey(selectedYear, allMonths[i]!);
        const cur = next[mk] ?? emptyMonthTeamCapacityBoard();
        next = {
          ...next,
          [mk]: {
            capacities: { ...cur.capacities, [teamId]: parts[i]! },
          },
        };
      }
      return next;
    });
  }, [selectedYear]);

  const removeEpicFromMonthTeamCapacity = useCallback(
    async (epicId: string) => {
      if (activeTimelineMonth == null) return;
      const boardKey = monthTeamBoardStorageKey(selectedYear, activeTimelineMonth);
      setMonthTeamBoardByKey((prev) => {
        const cur = prev[boardKey] ?? { queues: {} };
        return { ...prev, [boardKey]: removeEpicFromMonthTeamBoardQueues(cur, epicId) };
      });
      flushSync(() => {
        setInitiatives((prev) =>
          prev.map((i) => ({
            ...i,
            epics: (i.epics ?? []).map((e) => (e.id === epicId ? { ...e, team: null } : e)),
          })),
        );
      });
      try {
        const response = await fetch(`/api/epics/${epicId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team: null }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        toast.success("Removed from team capacity");
      } catch {
        await refresh();
        toast.error("Failed to clear team on epic");
      }
    },
    [activeTimelineMonth, selectedYear],
  );

  const openSprintStoryBoard = useCallback((yearSprint: number, teamId: string | null) => {
    const clamped = clampYearSprint(yearSprint);
    const { month } = monthLaneFromGlobalSprint(clamped);
    setActiveTimelineMonth(month);
    setIsSprintModeActive(true);
    setActiveYearSprint(clamped);
    setActiveSprintTab("kanban");
    setActiveMonthPlanTab("sprint-kanban");
    setSprintStoryBoardTeamId(teamId?.trim() ? teamId.trim() : null);
  }, []);

  const activeSprintCapacityKey = useMemo(() => {
    if (activeYearSprint == null) return null;
    return sprintCapacityBoardKey(selectedYear, activeYearSprint, sprintStoryBoardTeamId);
  }, [selectedYear, activeYearSprint, sprintStoryBoardTeamId]);

  const activeSprintCapacityBoard = useMemo(() => {
    if (!activeSprintCapacityKey) return { capacities: {}, assignments: {} };
    const existing = sprintCapacityByKey[activeSprintCapacityKey];
    if (existing) return existing;
    const members = defaultMembersForTeam(sprintStoryBoardTeamId);
    return emptySprintCapacityBoard(members);
  }, [activeSprintCapacityKey, sprintCapacityByKey, sprintStoryBoardTeamId]);

  const activeSprintRetrospectiveKey = useMemo(() => {
    if (activeYearSprint == null) return null;
    return `${selectedYear}:${activeYearSprint}`;
  }, [selectedYear, activeYearSprint]);

  const activeSprintRetrospective = useMemo(() => {
    if (!activeSprintRetrospectiveKey) return null;
    return sprintRetrospectiveByKey[activeSprintRetrospectiveKey] ?? null;
  }, [activeSprintRetrospectiveKey, sprintRetrospectiveByKey]);

  const saveSprintRetrospective = useCallback(
    (doc: SprintRetrospectiveDoc) => {
      if (!activeSprintRetrospectiveKey) return;
      setSprintRetrospectiveByKey((prev) => ({
        ...prev,
        [activeSprintRetrospectiveKey]: {
          wentWellHtml: doc.wentWellHtml,
          improveHtml: doc.improveHtml,
          actionItems: doc.actionItems,
          updatedAt: new Date().toISOString(),
        },
      }));
      toast.success("Retrospective saved");
    },
    [activeSprintRetrospectiveKey],
  );

  const updateSprintCapacity = useCallback(
    (member: string, days: number) => {
      if (!activeSprintCapacityKey) return;
      setSprintCapacityByKey((prev) => {
        const cur =
          prev[activeSprintCapacityKey] ??
          emptySprintCapacityBoard(defaultMembersForTeam(sprintStoryBoardTeamId));
        return {
          ...prev,
          [activeSprintCapacityKey]: {
            capacities: { ...cur.capacities, [member]: Math.max(0, Math.min(10, Number(days) || 0)) },
            assignments: { ...cur.assignments },
          },
        };
      });
    },
    [activeSprintCapacityKey, sprintStoryBoardTeamId],
  );

  const updateStoryEstimateFromCapacity = useCallback(async (storyId: string, estimatedDays: number) => {
    /** Stories API validates integer days; normalize capacity inline edits before PATCH. */
    const nextEstimate = Math.max(0, Math.round(Number(estimatedDays) || 0));
    flushSync(() => {
      setInitiatives((prev) =>
        prev.map((init) => ({
          ...init,
          epics: (init.epics ?? []).map((epic) => ({
            ...epic,
            userStories: (epic.userStories ?? []).map((story) =>
              story.id === storyId ? { ...story, estimatedDays: nextEstimate } : story,
            ),
          })),
        })),
      );
    });
    try {
      const response = await fetch(`/api/stories/${storyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimatedDays: nextEstimate }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      await refresh();
      toast.error("Failed to update estimate");
    }
  }, []);

  const unscheduleStoryFromCapacity = useCallback(async (storyId: string) => {
    setSprintCapacityByKey((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).map(([k, board]) => [
          k,
          {
            capacities: { ...board.capacities },
            assignments: Object.fromEntries(
              Object.entries(board.assignments).map(([member, ids]) => [member, ids.filter((id) => id !== storyId)]),
            ),
          },
        ]),
      );
      return next;
    });
    flushSync(() => {
      setInitiatives((prev) =>
        prev.map((init) => ({
          ...init,
          epics: (init.epics ?? []).map((epic) => ({
            ...epic,
            userStories: (epic.userStories ?? []).map((story) =>
              story.id === storyId ? { ...story, sprint: null } : story,
            ),
          })),
        })),
      );
    });
    try {
      const response = await fetch(`/api/stories/${storyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprint: null }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      toast.success("Story moved to unscheduled");
    } catch {
      await refresh();
      toast.error("Failed to unschedule story");
    }
  }, []);

  async function refresh(targetYear = selectedYear) {
    const data = await parseJson<InitiativeItem[]>(
      await fetch(`/api/initiatives?year=${targetYear}`, { cache: "no-store" }),
    );
    setInitiatives(data);
  }

  async function handleDeleteInitiative(id: string) {
    await fetch(`/api/initiatives/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function handleUpsertInitiative(payload: {
    title: string;
    icon: string;
    description: string;
    assignee: string;
    color: string;
    startMonth: number | null;
    endMonth: number | null;
  }) {
    const request = editingInitiative
      ? fetch(`/api/initiatives/${editingInitiative.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : fetch("/api/initiatives", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, year: selectedYear }),
        });

    await request;
    setEditingInitiative(undefined);
    await refresh();
  }

  async function handleUpsertEpic(payload: {
    title: string;
    icon: string;
    description: string;
    assignee: string;
    color: string;
    initiativeId: string;
    team: string | null;
    originalEstimateDays: number | null;
    planStartMonth: number | null;
    planEndMonth: number | null;
  }) {
    const request = editingEpic
      ? fetch(`/api/epics/${editingEpic.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : fetch(`/api/initiatives/${payload.initiativeId}/epics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    await request;
    setEditingEpic(undefined);
    setEditingEpicInitiativeId(null);
    await refresh();
  }

  async function handleDeleteEpic(epicId: string) {
    await fetch(`/api/epics/${epicId}`, { method: "DELETE" });
    await refresh();
  }

  async function createEpicQuick(initiativeId: string, title: string) {
    const response = await fetch(`/api/initiatives/${initiativeId}/epics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error("Failed to create epic");
    }
    await refresh();
  }

  async function createInitiativeQuick(title: string) {
    const response = await fetch("/api/initiatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, year: selectedYear }),
    });
    if (!response.ok) {
      throw new Error("Failed to create initiative");
    }
    await refresh();
  }

  async function createStoryQuick(epicId: string, title: string) {
    const response = await fetch(`/api/epics/${epicId}/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error("Failed to create user story");
    }
    await refresh();
  }

  async function scheduleInitiative(initiativeId: string, month: number, timelineRow?: number) {
    const payload: {
      year: number;
      startMonth: number;
      endMonth: number;
      startYearSprint: number;
      endYearSprint: number;
      timelineRow?: number;
    } = {
      year: selectedYear,
      startMonth: month,
      endMonth: month,
      ...yearSprintRangeFromMonthRange(month, month),
    };
    if (timelineRow !== undefined) payload.timelineRow = timelineRow;
    console.log("[gantt-drop] fetch PATCH schedule", { initiativeId, payload });
    const response = await fetch(`/api/initiatives/${initiativeId}/schedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.log("[gantt-drop] schedule PATCH failed", { status: response.status, errText });
      throw new Error("Failed to schedule initiative");
    }
    console.log("[gantt-drop] schedule PATCH ok", { initiativeId });
  }

  /** PATCH only initiatives whose `timelineRow` changed (avoids renumbering the whole plan to 0..n-1). */
  async function persistInitiativeTimelineRowPatches(prev: InitiativeItem[], next: InitiativeItem[]) {
    const patches = next.filter((after) => {
      if (after.status !== InitiativeStatus.scheduled) return false;
      if (after.startMonth == null || after.endMonth == null) return false;
      const before = prev.find((i) => i.id === after.id);
      return before != null && before.timelineRow !== after.timelineRow;
    });
    if (patches.length === 0) return;
    await Promise.all(
      patches.map((after) =>
        fetch(`/api/initiatives/${after.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timelineRow: after.timelineRow }),
        }).then((res) => {
          if (!res.ok) throw new Error("Failed to save timeline row");
        }),
      ),
    );
  }

  async function persistBacklogOrder(orderedIds: string[]) {
    await Promise.all(
      orderedIds.map((id, idx) =>
        fetch(`/api/initiatives/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timelineRow: idx }),
        }).then((res) => {
          if (!res.ok) throw new Error("Failed to save backlog order");
        }),
      ),
    );
  }

  async function unscheduleInitiative(initiativeId: string) {
    const response = await fetch(`/api/initiatives/${initiativeId}/schedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: selectedYear, startMonth: null, endMonth: null }),
    });
    if (!response.ok) {
      throw new Error("Failed to unschedule initiative");
    }
  }

  async function patchInitiativeScheduleRange(
    initiativeId: string,
    startMonth: number,
    endMonth: number,
    sprintBounds?: { startYearSprint: number; endYearSprint: number },
    planYear: number = selectedYear,
  ) {
    const bounds = sprintBounds ?? yearSprintRangeFromMonthRange(startMonth, endMonth);
    const response = await fetch(`/api/initiatives/${initiativeId}/schedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: planYear,
        startMonth,
        endMonth,
        startYearSprint: bounds.startYearSprint,
        endYearSprint: bounds.endYearSprint,
      }),
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      let detail = `${response.status} ${response.statusText}`;
      try {
        const body = JSON.parse(raw) as { message?: string; issues?: unknown };
        if (typeof body?.message === "string") {
          detail = body.message;
          if (body.issues) console.error("[patch schedule] issues", initiativeId, body.issues);
        } else if (raw) detail = `${detail}: ${raw.slice(0, 400)}`;
      } catch {
        if (raw) detail = `${detail}: ${raw.slice(0, 400)}`;
      }
      console.error("[patch schedule] failed", initiativeId, detail);
      throw new Error(detail);
    }
  }

  async function patchEpicClearPlan(epicId: string) {
    const response = await fetch(`/api/epics/${epicId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planSprint: null,
        planEndSprint: null,
        planStartMonth: null,
        planEndMonth: null,
      }),
    });
    if (!response.ok) {
      let message = `Could not save (${response.status})`;
      try {
        const body = (await response.json()) as {
          message?: string;
          issues?: { fieldErrors?: Record<string, string[] | undefined> };
        };
        if (typeof body?.message === "string") message = body.message;
        const details = Object.entries(body?.issues?.fieldErrors ?? {})
          .flatMap(([field, errs]) => (errs ?? []).map((err) => `${field}: ${err}`))
          .join("; ");
        if (details) message = `${message} (${details})`;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
  }

  async function patchEpicQuarterPlan(
    epicId: string,
    payload: { planSprint: number; planEndSprint: number; planStartMonth: number; planEndMonth: number; timelineRow?: number },
  ) {
    const response = await fetch(`/api/epics/${epicId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let message = `Could not save (${response.status})`;
      try {
        const body = (await response.json()) as {
          message?: string;
          issues?: { fieldErrors?: Record<string, string[] | undefined> };
        };
        if (typeof body?.message === "string") message = body.message;
        const details = Object.entries(body?.issues?.fieldErrors ?? {})
          .flatMap(([field, errs]) => (errs ?? []).map((err) => `${field}: ${err}`))
          .join("; ");
        if (details) message = `${message} (${details})`;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
  }

  async function persistEpicTimelineRowPatches(prev: InitiativeItem[], next: InitiativeItem[]) {
    const prevRows = new Map<string, number>();
    for (const initiative of prev) {
      for (const epic of initiative.epics ?? []) {
        prevRows.set(epic.id, Number.isFinite(epic.timelineRow) ? epic.timelineRow : 0);
      }
    }
    const changed: Array<{ epicId: string; timelineRow: number }> = [];
    for (const initiative of next) {
      for (const epic of initiative.epics ?? []) {
        const before = prevRows.get(epic.id);
        const row = Number.isFinite(epic.timelineRow) ? epic.timelineRow : 0;
        if (before != null && before !== row) changed.push({ epicId: epic.id, timelineRow: row });
      }
    }
    if (changed.length === 0) return;
    await Promise.all(
      changed.map(async ({ epicId, timelineRow }) => {
        const response = await fetch(`/api/epics/${epicId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timelineRow }),
        });
        if (!response.ok) throw new Error(`Failed to persist epic row for ${epicId}`);
      }),
    );
  }

  async function createStoryWithDetails(payload: {
    title: string;
    icon: string;
    description: string | null;
    assignee: string | null;
    labels: string | null;
    priority: string | null;
    sprint: number | null;
    estimatedDays: number | null;
    daysLeft: number | null;
    status: StoryStatus;
    epicId: string;
  }) {
    const response = await fetch(`/api/epics/${payload.epicId}/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("Failed to create story");
    }
    await refresh();
  }

  async function addInitiativeComment(initiativeId: string, body: string) {
    const response = await fetch(`/api/initiatives/${initiativeId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, author: "Planner" }),
    });
    if (!response.ok) {
      throw new Error("Failed to add comment");
    }
    await refresh();
  }

  async function addEpicComment(epicId: string, body: string) {
    const response = await fetch(`/api/epics/${epicId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, author: "Planner" }),
    });
    if (!response.ok) {
      throw new Error("Failed to add epic comment");
    }
    await refresh();
  }

  async function updateStoryDetails(
    storyId: string,
    payload: {
      title: string;
      icon: string;
      description: string | null;
      assignee: string | null;
      labels: string | null;
      priority: string | null;
      sprint: number | null;
      estimatedDays: number | null;
      daysLeft: number | null;
      status: StoryStatus;
      epicId: string;
    },
  ) {
    const response = await fetch(`/api/stories/${storyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("Failed to update story");
    }
    await refresh();
  }

  async function patchEpicTeamFromStoryDialog(epicId: string, team: string | null) {
    const response = await fetch(`/api/epics/${epicId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team }),
    });
    if (!response.ok) {
      throw new Error("Failed to update epic team");
    }
    await refresh();
  }

  async function addStoryComment(storyId: string, body: string) {
    const response = await fetch(`/api/stories/${storyId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, author: "Planner" }),
    });
    if (!response.ok) {
      throw new Error("Failed to add comment");
    }
    await refresh();
  }

  async function deleteStory(storyId: string) {
    const response = await fetch(`/api/stories/${storyId}`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error("Failed to delete story");
    }
    await refresh();
  }

  async function onDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : "";
    console.log("[gantt-drop] app onDragEnd", { activeId, overId });

    if (isStoryDraggableId(activeId)) {
      const storyId = parseStoryIdFromDraggable(activeId);
      if (!storyId) return;

      if (overId === STORIES_UNSCHEDULE_DROP_ID) {
        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((init) => ({
              ...init,
              epics: (init.epics ?? []).map((epic) => ({
                ...epic,
                userStories: (epic.userStories ?? []).map((s) =>
                  s.id === storyId ? { ...s, sprint: null } : s,
                ),
              })),
            })),
          );
        });
        try {
          const response = await fetch(`/api/stories/${storyId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sprint: null }),
          });
          if (!response.ok) {
            const body = await response.text().catch(() => "");
            console.error("[story-move] unschedule PATCH failed", {
              storyId,
              httpStatus: response.status,
              responseBody: body || undefined,
              patch: { sprint: null },
            });
            throw new Error(`Failed to update story: ${response.status}`);
          }
          toast.success("Story moved to unscheduled");
        } catch (err) {
          console.error("[story-move] unschedule drop failed", {
            storyId,
            overId,
            cause: err instanceof Error ? err.message : String(err),
          });
          await refresh();
          toast.error("Failed to clear sprint on story");
        }
        return;
      }

      const capacityDrop = parseSprintCapacityBucketDropId(overId);
      if (capacityDrop) {
        if (capacityDrop.yearSprint !== activeYearSprint) return;
        const dropTeamId = MONTH_TEAM_IDS.includes(capacityDrop.teamKey) ? capacityDrop.teamKey : null;
        const boardKey = sprintCapacityBoardKey(selectedYear, capacityDrop.yearSprint, dropTeamId);
        setSprintCapacityByKey((prev) => {
          const cur = prev[boardKey] ?? emptySprintCapacityBoard(defaultMembersForTeam(dropTeamId));
          return { ...prev, [boardKey]: assignStoryToMember(cur, storyId, capacityDrop.member) };
        });
        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((init) => ({
              ...init,
              epics: (init.epics ?? []).map((epic) => ({
                ...epic,
                userStories: (epic.userStories ?? []).map((s) =>
                  s.id === storyId
                    ? { ...s, assignee: capacityDrop.member, sprint: capacityDrop.yearSprint }
                    : s,
                ),
              })),
            })),
          );
        });
        try {
          const response = await fetch(`/api/stories/${storyId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignee: capacityDrop.member, sprint: capacityDrop.yearSprint }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          toast.success(`Assigned to ${capacityDrop.member}`);
        } catch {
          await refresh();
          toast.error("Failed to assign story");
        }
        return;
      }

      const kanbanMatch = /^kanban:(\d+):(todo|inProgress|done|approved)$/.exec(overId);
      if (!kanbanMatch) return;
      const sprint = clampYearSprint(Number(kanbanMatch[1]));
      // Group 1 = year sprint; group 2 = status (there is no third capture).
      const status = kanbanMatch[2] as StoryStatus;
      const nextStatus = status;

      flushSync(() => {
        setInitiatives((prev) =>
          prev.map((init) => ({
            ...init,
            epics: (init.epics ?? []).map((epic) => ({
              ...epic,
              userStories: (epic.userStories ?? []).map((s) =>
                s.id === storyId ? { ...s, status: nextStatus, sprint } : s,
              ),
            })),
          })),
        );
      });
      try {
        const patchBody = { status: nextStatus, sprint };
        const response = await fetch(`/api/stories/${storyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          console.error("[story-move] kanban PATCH failed", {
            storyId,
            httpStatus: response.status,
            responseBody: body || undefined,
            patch: patchBody,
            overId,
          });
          throw new Error(`Failed to update story: ${response.status}`);
        }
        toast.success("Story updated");
      } catch (err) {
        console.error("[story-move] kanban drop failed", {
          storyId,
          nextStatus,
          sprint,
          overId,
          cause: err instanceof Error ? err.message : String(err),
        });
        await refresh();
        toast.error("Failed to move story");
      }
      return;
    }

    if (isEpicPlanDraggableId(activeId)) {
      const epicId = parseEpicIdFromPlanDraggable(activeId);
      if (!epicId) {
        console.log("[gantt-drop] epic branch: no epicId", { activeId });
        return;
      }
      console.log("[gantt-drop] epic branch", { epicId, overId });

      const teamCapacityDrop = parseMonthTeamCapacityBucketDropId(overId);
      if (teamCapacityDrop) {
        if (!MONTH_TEAM_IDS.includes(teamCapacityDrop.teamId)) return;
        if (teamCapacityDrop.year !== selectedYear) {
          toast.message("Switch the roadmap year to update that month’s team capacity.");
          return;
        }
        const inMonth = collectMonthEpicsForTeamBoard(initiatives, teamCapacityDrop.month).some(
          (c) => c.epic.id === epicId,
        );
        if (!inMonth) {
          toast.message("Only epics tied to this month can be assigned to team capacity.");
          return;
        }
        const key = monthTeamBoardStorageKey(teamCapacityDrop.year, teamCapacityDrop.month);
        setMonthTeamBoardByKey((prev) => {
          const cur = prev[key] ?? { queues: {} };
          return {
            ...prev,
            [key]: applyEpicTeamQueueMove(cur, epicId, teamCapacityDrop.teamId, Number.MAX_SAFE_INTEGER),
          };
        });
        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((i) => ({
              ...i,
              epics: (i.epics ?? []).map((e) =>
                e.id === epicId ? { ...e, team: teamCapacityDrop.teamId } : e,
              ),
            })),
          );
        });
        try {
          const response = await fetch(`/api/epics/${epicId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team: teamCapacityDrop.teamId }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          toast.success("Team updated");
        } catch {
          await refresh();
          toast.error("Failed to save team");
        }
        return;
      }

      const quarterCapacityDrop = parseQuarterTeamCapacityBucketDropId(overId);
      if (quarterCapacityDrop) {
        if (!MONTH_TEAM_IDS.includes(quarterCapacityDrop.teamId)) return;
        if (quarterCapacityDrop.year !== selectedYear) {
          toast.message("Switch the roadmap year to update that quarter’s team capacity.");
          return;
        }
        const qDef = QUARTERS.find((item) => item.label === quarterCapacityDrop.quarterLabel);
        if (!qDef) return;
        const inQuarter = collectQuarterEpics(initiatives, qDef.months).some((c) => c.epic.id === epicId);
        if (!inQuarter) {
          toast.message("Only epics tied to this quarter can be assigned to team capacity.");
          return;
        }
        const targetMonth =
          qDef.months.find((m) => collectMonthEpicsForTeamBoard(initiatives, m).some((c) => c.epic.id === epicId)) ??
          qDef.months[0]!;
        const queueKey = monthTeamBoardStorageKey(quarterCapacityDrop.year, targetMonth);
        setMonthTeamBoardByKey((prev) => {
          const cur = prev[queueKey] ?? { queues: {} };
          return {
            ...prev,
            [queueKey]: applyEpicTeamQueueMove(cur, epicId, quarterCapacityDrop.teamId, Number.MAX_SAFE_INTEGER),
          };
        });
        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((i) => ({
              ...i,
              epics: (i.epics ?? []).map((e) =>
                e.id === epicId ? { ...e, team: quarterCapacityDrop.teamId } : e,
              ),
            })),
          );
        });
        try {
          const response = await fetch(`/api/epics/${epicId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team: quarterCapacityDrop.teamId }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          toast.success("Team updated");
        } catch {
          await refresh();
          toast.error("Failed to save team");
        }
        return;
      }

      const teamSlot = parseMonthTeamSlotDropId(overId);
      if (teamSlot) {
        if (teamSlot.year !== selectedYear) {
          toast.message("Switch the roadmap year to update that month’s team board.");
          return;
        }
        const inMonth = collectMonthEpicsForTeamBoard(initiatives, teamSlot.month).some((c) => c.epic.id === epicId);
        if (!inMonth) {
          toast.message("Only epics tied to this month can be queued for a team.");
          return;
        }
        const key = monthTeamBoardStorageKey(teamSlot.year, teamSlot.month);
        setMonthTeamBoardByKey((prev) => {
          const cur = prev[key] ?? { queues: {} };
          return { ...prev, [key]: applyEpicTeamQueueMove(cur, epicId, teamSlot.teamId, teamSlot.index) };
        });
        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((i) => ({
              ...i,
              epics: (i.epics ?? []).map((e) =>
                e.id === epicId ? { ...e, team: teamSlot.teamId } : e,
              ),
            })),
          );
        });
        try {
          const response = await fetch(`/api/epics/${epicId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team: teamSlot.teamId }),
          });
          if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(text || `HTTP ${response.status}`);
          }
          toast.success("Team updated");
        } catch (err) {
          await refresh();
          const description = err instanceof Error ? err.message : undefined;
          toast.error("Failed to save team", description ? { description } : undefined);
        }
        return;
      }

      const monthEpicBoard = parseMonthEpicKanbanDropId(overId);
      if (monthEpicBoard && monthEpicBoard.status === "todo") {
        const initiative = initiatives.find((i) => (i.epics ?? []).some((e) => e.id === epicId));
        const epic = initiative?.epics?.find((e) => e.id === epicId);
        if (!initiative || !epic) return;
        const storyIds = (epic.userStories ?? []).map((s) => s.id);
        if (storyIds.length === 0) {
          toast.message("Epic has no stories to reset");
          return;
        }

        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((i) => ({
              ...i,
              epics: (i.epics ?? []).map((e) =>
                e.id === epicId
                  ? {
                      ...e,
                      userStories: (e.userStories ?? []).map((s) => ({
                        ...s,
                        status: StoryStatus.todo,
                      })),
                    }
                  : e,
              ),
            })),
          );
        });

        try {
          await Promise.all(
            storyIds.map(async (storyId) => {
              const response = await fetch(`/api/stories/${storyId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: StoryStatus.todo }),
              });
              if (!response.ok) throw new Error("Failed to update story");
            }),
          );
          toast.success("All epic stories set to To do");
        } catch {
          await refresh();
          toast.error("Failed to reset epic stories");
        }
        return;
      }

      const epicKanbanTodoMatch = /^kanban:(\d+):todo$/.exec(overId);
      if (epicKanbanTodoMatch) {
        const sprint = clampYearSprint(Number(epicKanbanTodoMatch[1]));
        const initiative = initiatives.find((i) => (i.epics ?? []).some((e) => e.id === epicId));
        const epic = initiative?.epics?.find((e) => e.id === epicId);
        if (!initiative || !epic) return;
        const storyIds = (epic.userStories ?? []).map((s) => s.id);
        if (storyIds.length === 0) {
          toast.message("Epic has no stories to move");
          return;
        }

        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((i) => ({
              ...i,
              epics: (i.epics ?? []).map((e) =>
                e.id === epicId
                  ? {
                      ...e,
                      userStories: (e.userStories ?? []).map((s) => ({
                        ...s,
                        sprint,
                        status: StoryStatus.todo,
                      })),
                    }
                  : e,
              ),
            })),
          );
        });

        try {
          await Promise.all(
            storyIds.map(async (storyId) => {
              const response = await fetch(`/api/stories/${storyId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sprint, status: StoryStatus.todo }),
              });
              if (!response.ok) throw new Error("Failed to update story");
            }),
          );
          toast.success("All epic stories moved to To do");
        } catch {
          await refresh();
          toast.error("Failed to move epic stories");
        }
        return;
      }

      let epicBacklogSlot = parseEpicBacklogSlotDropId(overId);
      if (epicBacklogSlot == null) {
        const overEpicId = parseEpicIdFromPlanDraggable(overId);
        if (overEpicId && activeTimelineMonth != null) {
          const backlogIds = monthBacklogEpicIds(initiatives, activeTimelineMonth, epicBacklogOrderByMonth);
          const overIdx = backlogIds.findIndex((id) => id === overEpicId);
          if (overIdx >= 0) {
            epicBacklogSlot = { month: activeTimelineMonth, index: overIdx };
          }
        }
      }
      if (overId === EPICS_UNPLAN_DROP_ID || epicBacklogSlot != null) {
        const initiative = initiatives.find((i) => (i.epics ?? []).some((e) => e.id === epicId));
        const epic = initiative?.epics?.find((e) => e.id === epicId);
        if (!initiative || !epic) return;
        if (epicBacklogSlot != null) {
          setEpicBacklogOrderByMonth((prev) => {
            const month = epicBacklogSlot.month;
            const current = prev[month] ?? [];
            const without = current.filter((id) => id !== epicId);
            const insertAt = Math.max(0, Math.min(epicBacklogSlot.index, without.length));
            const next = [...without.slice(0, insertAt), epicId, ...without.slice(insertAt)];
            return { ...prev, [month]: next };
          });
        }

        const isAlreadyBacklog =
          epic.planSprint == null && epic.planStartMonth == null && epic.planEndMonth == null;
        if (isAlreadyBacklog) return;

        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((i) => ({
              ...i,
              epics: (i.epics ?? []).map((e) =>
                e.id === epicId
                  ? { ...e, planSprint: null, planEndSprint: null, planStartMonth: null, planEndMonth: null }
                  : e,
              ),
            })),
          );
        });
        try {
          await patchEpicClearPlan(epicId);
          toast.success("Epic moved to backlog");
        } catch (err) {
          await refresh();
          const description = err instanceof Error ? err.message : undefined;
          toast.error("Failed to update epic placement", description ? { description } : undefined);
        }
        return;
      }

      let month: number;
      let planSprint: 1 | 2;
      let laneIndex: number | undefined;
      const epicCell = /^epic-plan:(\d+):([12])$/.exec(overId);
      if (epicCell) {
        month = Number(epicCell[1]);
        const lane = Number(epicCell[2]) as 1 | 2;
        planSprint = lane;
        laneIndex = undefined;
      } else if (overId.startsWith("month:")) {
        const parsed = parseMonthDropTarget(overId);
        if (!parsed) {
          console.log("[gantt-drop] epic month drop: parse failed", { overId });
          return;
        }
        month = parsed.month;
        planSprint = 1;
        laneIndex = parsed.laneIndex;
        console.log("[gantt-drop] epic month drop parsed", { month, laneIndex });
      } else {
        console.log("[gantt-drop] epic branch: overId not epic-plan or month", { overId });
        return;
      }
      if (!Number.isFinite(month)) {
        console.log("[gantt-drop] epic branch: invalid month", { month });
        return;
      }

      const before = initiatives;
      const currentInit = before.find((i) => (i.epics ?? []).some((e) => e.id === epicId));
      const currentEpic = currentInit?.epics?.find((e) => e.id === epicId);
      if (!currentInit || !currentEpic) return;

      const isFirstSchedule = currentEpic.planStartMonth == null || currentEpic.planEndMonth == null;
      let hoveredLaneIndex: number | undefined;
      let hoveredTimelineRow: number | undefined;
      const cy = clientYCenterFromDragEnd(event);
      console.log("[gantt-drop][epic] pointer baseline", {
        activeId,
        overId,
        epicId,
        month,
        laneFromTarget: laneIndex,
        clientYCenter: cy,
        isFirstSchedule,
      });
      if (cy !== undefined) {
        if (laneIndex === undefined) {
          const inferred = inferGanttLaneInsertIndexFromClientY(cy);
          console.log("[gantt-drop][epic] infer lane insert index", {
            epicId,
            clientYCenter: cy,
            inferredLaneIndex: inferred,
          });
          if (inferred !== undefined) laneIndex = inferred;
        }
        const hovered = inferGanttLaneHoverIndexFromClientY(cy);
        console.log("[gantt-drop][epic] infer lane hover index", {
          epicId,
          clientYCenter: cy,
          hoveredLaneIndex: hovered,
        });
        if (hovered !== undefined) hoveredLaneIndex = hovered;
        const hoverRow = inferGanttLaneHoverTimelineRowFromClientY(cy);
        console.log("[gantt-drop][epic] infer lane hover timeline row", {
          epicId,
          clientYCenter: cy,
          hoveredTimelineRow: hoverRow,
        });
        if (hoverRow !== undefined) hoveredTimelineRow = hoverRow;
      }
      console.log("[gantt-drop][epic] month drop", {
        epicId,
        month,
        laneIndex,
        hoveredLaneIndex,
        hoveredTimelineRow,
        isFirstSchedule,
      });

      const { next: placementNext, rowsChanged, movedTimelineRow } = computeEpicMonthLanePlacement(
        before,
        epicId,
        month,
        planSprint,
        laneIndex,
        hoveredLaneIndex,
        hoveredTimelineRow,
        isFirstSchedule,
      );
      console.log("[gantt-drop][epic] placement", {
        epicId,
        rowsChanged,
        movedTimelineRow,
      });
      flushSync(() => setInitiatives(placementNext));
      const updatedEpic =
        placementNext.flatMap((i) => i.epics ?? []).find((e) => e.id === epicId) ?? null;

      try {
        await patchEpicQuarterPlan(epicId, {
          planSprint,
          planEndSprint: updatedEpic?.planEndSprint ?? 2,
          planStartMonth: updatedEpic?.planStartMonth ?? month,
          planEndMonth: updatedEpic?.planEndMonth ?? month,
          ...(movedTimelineRow != null ? { timelineRow: movedTimelineRow } : {}),
        });
        if (rowsChanged) {
          await persistEpicTimelineRowPatches(before, placementNext);
        }
        toast.success("Epic placed on the plan");
        flashGanttEpicEmphasis(epicId);
      } catch (err) {
        await refresh();
        const description = err instanceof Error ? err.message : undefined;
        toast.error("Failed to place epic", description ? { description } : undefined);
      }
      return;
    }

    if (!isInitiativeDraggableId(activeId)) {
      console.log("[gantt-drop] no handler for activeId (not initiative)", { activeId, overId });
      return;
    }

    const initiativeId = parseInitiativeIdFromDraggable(activeId);
    if (!initiativeId) return;

    const backlogSlot = parseBacklogSlotDropId(overId);
    if (overId === "initiatives:backlog-drop" || backlogSlot != null) {
      const wasScheduled = initiatives.some(
        (i) => i.id === initiativeId && i.status === InitiativeStatus.scheduled,
      );
      const backlogOrdered = initiatives
        .filter((i) => i.status === InitiativeStatus.backlog && i.id !== initiativeId)
        .sort((a, b) => a.timelineRow - b.timelineRow || a.title.localeCompare(b.title));
      const insertAt = Math.max(
        0,
        Math.min(backlogSlot ?? backlogOrdered.length, backlogOrdered.length),
      );
      const orderedIds = [
        ...backlogOrdered.slice(0, insertAt).map((i) => i.id),
        initiativeId,
        ...backlogOrdered.slice(insertAt).map((i) => i.id),
      ];
      const rowById = new Map(orderedIds.map((id, idx) => [id, idx]));
      flushSync(() => {
        setInitiatives((prev) =>
          prev.map((i) =>
            rowById.has(i.id)
              ? {
                  ...i,
                  status: InitiativeStatus.backlog,
                  startMonth: null,
                  endMonth: null,
                  startYearSprint: null,
                  endYearSprint: null,
                  timelineRow: rowById.get(i.id)!,
                }
              : i,
          ),
        );
      });
      try {
        if (wasScheduled) {
          await unscheduleInitiative(initiativeId);
        }
        await persistBacklogOrder(orderedIds);
        toast.success("Initiative placed in backlog");
      } catch {
        await refresh();
        toast.error("Failed to update backlog placement");
      }
      return;
    }

    if (!overId.startsWith("month:")) {
      console.log("[gantt-drop] initiative: overId not month:*", { overId });
      return;
    }

    const parsedDrop = parseMonthDropTarget(overId);
    if (!parsedDrop) {
      console.log("[gantt-drop] initiative: parseMonthDropTarget null", { overId });
      return;
    }
    const { month, laneIndex: laneFromTarget } = parsedDrop;
    if (!Number.isFinite(month)) {
      console.log("[gantt-drop] initiative: bad month", { month });
      return;
    }

    let laneIndex = laneFromTarget;
    let hoveredLaneIndex: number | undefined;
    let hoveredTimelineRow: number | undefined;
    const cy = clientYCenterFromDragEnd(event);
    console.log("[gantt-drop] initiative pointer baseline", {
      activeId,
      overId,
      clientYCenter: cy,
      laneFromTarget,
    });
    if (cy !== undefined) {
      if (laneIndex === undefined) {
        const inferred = inferGanttLaneInsertIndexFromClientY(cy);
        console.log("[gantt-drop] infer lane insert index", {
          clientYCenter: cy,
          inferredLaneIndex: inferred,
        });
        if (inferred !== undefined) laneIndex = inferred;
      }
      const hovered = inferGanttLaneHoverIndexFromClientY(cy);
      console.log("[gantt-drop] infer lane hover index", {
        clientYCenter: cy,
        hoveredLaneIndex: hovered,
      });
      if (hovered !== undefined) hoveredLaneIndex = hovered;
      const hoverRow = inferGanttLaneHoverTimelineRowFromClientY(cy);
      console.log("[gantt-drop] infer lane hover timeline row", {
        clientYCenter: cy,
        hoveredTimelineRow: hoverRow,
      });
      if (hoverRow !== undefined) hoveredTimelineRow = hoverRow;
    }

    const initiativeBefore = initiatives.find((i) => i.id === initiativeId);
    if (!initiativeBefore) {
      console.log("[gantt-drop] initiative: not found", { initiativeId });
      return;
    }
    const isFirstSchedule = initiativeBefore.status === InitiativeStatus.backlog;
    console.log("[gantt-drop] initiative month drop", {
      initiativeId,
      month,
      laneIndex,
      hoveredLaneIndex,
      hoveredTimelineRow,
      laneFromTarget,
      isFirstSchedule,
    });

    const { next: placementNext, orderedScheduledIds, rowsChanged, movedTimelineRow } =
      computeInitiativeMonthLanePlacement(
      initiatives,
      initiativeId,
      month,
      laneIndex,
      hoveredLaneIndex,
      hoveredTimelineRow,
      isFirstSchedule,
      );
    console.log("[gantt-drop] placement", {
      orderedScheduledIds,
      /** Only set when overlap path re-sorts rows; otherwise empty (see non-overlap branch). */
      rowIndexFromOrder: orderedScheduledIds.indexOf(initiativeId),
      movedTimelineRow,
      rowsChanged,
    });

    flushSync(() => setInitiatives(placementNext));
    try {
      if (isFirstSchedule) {
        console.log("[gantt-drop] initiative → scheduleInitiative + persist rows", {
          initiativeId,
          month,
        });
        await scheduleInitiative(initiativeId, month);
        await persistInitiativeTimelineRowPatches(initiatives, placementNext);
        toast.success("Initiative scheduled");
        if (focusedQuarterLabel != null) {
          setFocusedQuarterLabel((prev) => {
            if (prev == null) return null;
            const q = QUARTERS.find((quarter) => quarter.label === prev);
            if (q?.months.some((m) => m === month)) return prev;
            const targetQ = QUARTERS.find((quarter) => quarter.months.some((m) => m === month));
            return targetQ?.label ?? prev;
          });
        }
      } else {
        const range = monthRangeForInitiativeDrop(initiativeBefore, month, isFirstSchedule);
        console.log("[gantt-drop] initiative reschedule → patch range + persist rows", {
          initiativeId,
          ...range,
          rowsChanged,
          movedTimelineRow,
        });
        await patchInitiativeScheduleRange(
          initiativeId,
          range.startMonth,
          range.endMonth,
          undefined,
          initiativeBefore.year,
        );
        if (rowsChanged) {
          await persistInitiativeTimelineRowPatches(initiatives, placementNext);
        }
        toast.success("Initiative moved");
        if (focusedQuarterLabel != null) {
          setFocusedQuarterLabel((prev) => {
            if (prev == null) return null;
            const q = QUARTERS.find((quarter) => quarter.label === prev);
            if (q?.months.some((m) => m === month)) return prev;
            const targetQ = QUARTERS.find((quarter) => quarter.months.some((m) => m === month));
            return targetQ?.label ?? prev;
          });
        }
      }
    } catch {
      await refresh();
      toast.error("Failed to schedule initiative");
    }
  }

  useEffect(() => {
    if (!isResizingPanel) return;

    function onMouseMove(event: MouseEvent) {
      if (!layoutRef.current) return;
      const layoutBounds = layoutRef.current.getBoundingClientRect();
      const proposedWidth = event.clientX - layoutBounds.left;
      const minPanelWidth = 260;
      const minTimelineWidth = 520;
      const maxPanelWidth = Math.max(minPanelWidth, layoutBounds.width - minTimelineWidth);
      const clampedWidth = Math.max(minPanelWidth, Math.min(proposedWidth, maxPanelWidth));
      setPanelWidth(Math.round(clampedWidth));
    }

    function onMouseUp() {
      setIsResizingPanel(false);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizingPanel]);

  const [isModeRailExpanded, setIsModeRailExpanded] = useState(false);
  const modeRailLabelClass =
    "pointer-events-none overflow-hidden whitespace-nowrap text-[13px] font-semibold transition-all duration-150";

  const modeSwitchMenu = (
    <aside className="relative z-20 flex min-h-0 items-start overflow-visible">
      <nav
        className={cn(
          "mt-1 flex flex-col gap-1.5 overflow-visible rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/75 p-1.5 shadow-lg ring-1 ring-slate-100/90 transition-[width] duration-200",
          isModeRailExpanded ? "w-44" : "w-full",
        )}
        onMouseEnter={() => setIsModeRailExpanded(true)}
        onMouseLeave={() => setIsModeRailExpanded(false)}
      >
        <div className="group relative w-full overflow-visible">
          <button
            type="button"
            onClick={() => setTopMode("roadmap")}
            aria-label="Roadmap Planning"
            className={cn(
              "inline-flex h-10 w-full items-center justify-start gap-2.5 rounded-lg px-2.5 transition-all duration-200",
              topMode === "roadmap"
                ? "bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 ring-1 ring-indigo-200/90 shadow-sm"
                : "text-slate-600 hover:bg-white hover:text-slate-800 hover:ring-1 hover:ring-slate-200/80",
            )}
          >
            <span
              className={cn(
                "inline-flex size-6 items-center justify-center rounded-md transition-colors",
                topMode === "roadmap"
                  ? "bg-indigo-100 text-indigo-700"
                  : "bg-slate-100 text-slate-500 group-hover:bg-slate-200/80 group-hover:text-slate-700",
              )}
              aria-hidden
            >
              <MapIcon className="size-3.5" aria-hidden />
            </span>
            <span
              aria-hidden
              className={cn(
                modeRailLabelClass,
                isModeRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
              )}
            >
              Roadmap Planning
            </span>
          </button>
        </div>
        <div className="group relative w-full overflow-visible">
          <button
            type="button"
            onClick={() => setTopMode("backlog")}
            aria-label="Backlog Workspace"
            className={cn(
              "inline-flex h-10 w-full items-center justify-start gap-2.5 rounded-lg px-2.5 transition-all duration-200",
              topMode === "backlog"
                ? "bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 ring-1 ring-indigo-200/90 shadow-sm"
                : "text-slate-600 hover:bg-white hover:text-slate-800 hover:ring-1 hover:ring-slate-200/80",
            )}
          >
            <span
              className={cn(
                "inline-flex size-6 items-center justify-center rounded-md transition-colors",
                topMode === "backlog"
                  ? "bg-indigo-100 text-indigo-700"
                  : "bg-slate-100 text-slate-500 group-hover:bg-slate-200/80 group-hover:text-slate-700",
              )}
              aria-hidden
            >
              <Archive className="size-3.5" aria-hidden />
            </span>
            <span
              aria-hidden
              className={cn(
                modeRailLabelClass,
                isModeRailExpanded ? "max-w-[9rem] opacity-100" : "max-w-0 opacity-0",
              )}
            >
              Backlog Workspace
            </span>
          </button>
        </div>
      </nav>
    </aside>
  );

  return (
    <DragContext onDragEnd={onDragEnd}>
      <main className="h-screen overflow-hidden bg-gradient-to-br from-slate-100 via-zinc-100 to-slate-200 p-8">
        <div className="mx-auto flex h-full w-full max-w-[2550px] flex-col gap-5 overflow-hidden">
          <div className="rounded-2xl bg-card p-4 shadow-lg ring-1 ring-black/5">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <div className="inline-flex flex-col p-1">
                  <img
                    src="/bird-eye-lockup-wide.png"
                    alt="Bird Eye Viewer logo"
                    className="h-[90px] w-auto max-w-[760px] rounded-md object-contain object-left"
                  />
                </div>
              </div>
              <div className="shrink-0" />
            </div>
          </div>

          {topMode === "roadmap" ? (
            <div
              ref={layoutRef}
              className={cn("grid min-h-0 flex-1 items-stretch gap-3", isResizingPanel && "select-none")}
              style={{ gridTemplateColumns: `54px ${panelWidth}px 14px minmax(0, 1fr)` }}
            >
              {modeSwitchMenu}
              <InitiativeListPanel
                initiatives={initiatives}
                activeMonth={activeTimelineMonth}
                activeYearSprint={activeYearSprint}
                storyDragEnabled={isSprintModeActive}
                isSprintModeActive={isSprintModeActive}
                onCreateInitiative={() => {
                  setEditingInitiative(undefined);
                  setInitiativeDialogOpen(true);
                }}
                onCreateEpic={() => {
                  setEditingEpic(undefined);
                  const m = activeTimelineMonth;
                  const firstForMonth =
                    m == null
                      ? undefined
                      : initiatives.find(
                          (i) =>
                            i.status === InitiativeStatus.scheduled &&
                            i.startMonth != null &&
                            i.endMonth != null &&
                            i.startMonth <= m &&
                            i.endMonth >= m,
                        );
                  if (!firstForMonth) {
                    if (m != null) {
                      toast.message("No scheduled initiative for this month. Plan an initiative in this month first.");
                    } else {
                      toast.message("Create an initiative first, then add an epic.");
                    }
                    return;
                  }
                  setEditingEpicInitiativeId(firstForMonth.id);
                  setEpicDialogOpen(true);
                }}
                onEditInitiative={(initiative) => {
                  setEditingInitiative(initiative);
                  setInitiativeDialogOpen(true);
                }}
                onOpenEpic={(epic, initiative) => {
                  setEditingEpic(epic);
                  setEditingEpicInitiativeId(initiative.id);
                  setEpicDialogOpen(true);
                }}
                onOpenStory={(storyId) => {
                  setSelectedStoryId(storyId);
                }}
                onDeleteEpic={handleDeleteEpic}
                onDeleteInitiative={handleDeleteInitiative}
                onCreateEpicQuick={async (initiativeId, title) => {
                  try {
                    await createEpicQuick(initiativeId, title);
                    toast.success("Epic added");
                  } catch {
                    toast.error("Failed to add epic");
                  }
                }}
                onCreateStoryQuick={async (epicId, title) => {
                  try {
                    await createStoryQuick(epicId, title);
                    toast.success("User story added");
                  } catch {
                    toast.error("Failed to add user story");
                  }
                }}
                epicBacklogOrderByMonth={epicBacklogOrderByMonth}
                monthEpicTeamFilterId={
                  activeTimelineMonth != null &&
                  (activeMonthPlanTab === "sprint-kanban" || activeMonthPlanTab === "sprint-capacity") &&
                  isKnownEpicTeamId(sprintStoryBoardTeamId)
                    ? sprintStoryBoardTeamId
                    : null
                }
                panelQuarterQuickFilter={focusedQuarterLabel as "Q1" | "Q2" | "Q3" | "Q4" | null}
                panelQuarterFilterLocked={focusedQuarterLabel != null && activeTimelineMonth == null}
                onInitiativeAccordionChange={handleInitiativeAccordionChange}
                panelStatusQuickFilter={panelStatusQuickFilter}
              />
              <div
                className="group relative flex cursor-col-resize items-stretch justify-center"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setIsResizingPanel(true);
                }}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panel"
              >
                <div className="h-full w-px bg-slate-300 transition group-hover:bg-slate-500" />
                <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" />
              </div>
              <div
                ref={planningRightSurfaceRef}
                className="flex min-h-0 min-w-0 flex-col overflow-x-visible overflow-y-hidden"
              >
                <TimelineGrid
                initiatives={initiatives}
                zoom={1}
                currentYear={selectedYear}
                summaryBadges={roadmapSummary}
                onSummaryStatusQuickFilterChange={setPanelStatusQuickFilter}
                summaryStatusQuickFilter={panelStatusQuickFilter}
                onYearChange={async (nextYear) => {
                  if (nextYear === selectedYear) return;
                  setSelectedYear(nextYear);
                  await refresh(nextYear);
                  setFocusedQuarterLabel(null);
                  setActiveTimelineMonth(null);
                  setActiveYearSprint(null);
                  setActiveSprintTab("kanban");
                  setActiveMonthPlanTab("epic-gantt");
                  setSprintStoryBoardTeamId(null);
                }}
                focusedQuarterLabel={focusedQuarterLabel}
                focusedMonthExternal={activeTimelineMonth}
                activeSprintExternal={activeYearSprint}
                activeSprintTabExternal={activeSprintTab}
                monthPlanTab={activeMonthPlanTab}
                onMonthPlanTabChange={handleMonthPlanTabChange}
                monthTeamBoardByKey={monthTeamBoardByKey}
                monthTeamCapacityBoard={activeMonthTeamCapacityBoard}
                monthTeamCapacityByKey={monthTeamCapacityByKey}
                onMonthTeamCapacityChange={updateMonthTeamCapacity}
                onQuarterTeamCapacityChange={updateQuarterTeamCapacity}
                onYearTeamCapacityChange={updateYearTeamCapacity}
                onMonthTeamCapacityEpicRemove={removeEpicFromMonthTeamCapacity}
                sprintCapacityBoard={activeSprintCapacityBoard}
                onSprintCapacityChange={updateSprintCapacity}
                onSprintCapacityStoryEstimateChange={updateStoryEstimateFromCapacity}
                onSprintCapacityStoryUnschedule={unscheduleStoryFromCapacity}
                sprintRetrospective={activeSprintRetrospective}
                onSaveSprintRetrospective={saveSprintRetrospective}
                onEnterSprintStoryBoard={openSprintStoryBoard}
                sprintStoryBoardTeamId={sprintStoryBoardTeamId}
                onSprintStoryBoardTeamChange={setSprintStoryBoardTeamId}
                onFocusedQuarterChange={setFocusedQuarterLabel}
                onSprintTabChange={setActiveSprintTab}
                onOpenEpic={(epicId) => {
                  for (const initiative of initiatives) {
                    const epic = (initiative.epics ?? []).find((e) => e.id === epicId);
                    if (epic) {
                      setEditingEpic(epic);
                      setEditingEpicInitiativeId(initiative.id);
                      setEpicDialogOpen(true);
                      return;
                    }
                  }
                }}
                onOpenInitiative={(initiativeId) => {
                  const initiative = initiatives.find((i) => i.id === initiativeId);
                  if (!initiative) return;
                  setEditingInitiative(initiative);
                  setInitiativeDialogOpen(true);
                }}
                onUnscheduleEpic={async (epicId) => {
                  const before = initiatives;
                  const target = before.flatMap((i) => i.epics ?? []).find((e) => e.id === epicId);
                  if (!target) return;
                  const alreadyUnscheduled =
                    target.planSprint == null && target.planStartMonth == null && target.planEndMonth == null;
                  if (alreadyUnscheduled) return;
                  flushSync(() => {
                    setInitiatives((prev) =>
                      prev.map((initiative) => ({
                        ...initiative,
                        epics: (initiative.epics ?? []).map((epic) =>
                          epic.id === epicId
                            ? { ...epic, planSprint: null, planEndSprint: null, planStartMonth: null, planEndMonth: null }
                            : epic,
                        ),
                      })),
                    );
                  });
                  try {
                    await patchEpicClearPlan(epicId);
                    toast.success("Epic moved to unscheduled");
                  } catch (err) {
                    await refresh();
                    const description = err instanceof Error ? err.message : undefined;
                    toast.error("Failed to unschedule epic", description ? { description } : undefined);
                  }
                }}
                ganttEmphasis={ganttEmphasis}
                ganttEpicEmphasis={ganttEpicEmphasis}
                onResizeInitiativeRange={async (initiativeId, range) => {
                  const planYear =
                    initiatives.find((i) => i.id === initiativeId)?.year ?? selectedYear;
                  const before = initiatives;
                  const target = before.find((i) => i.id === initiativeId);
                  const nextRangeStart = range.startYearSprint;
                  const nextRangeEnd = range.endYearSprint;
                  const overlaps = (aS: number, aE: number, bS: number, bE: number) => !(aE < bS || bE < aS);
                  let nextTimelineRow = target?.timelineRow ?? 0;
                  if (target) {
                    const scheduledOthers = before.filter(
                      (i) =>
                        i.id !== initiativeId &&
                        i.status === InitiativeStatus.scheduled &&
                        i.startMonth != null &&
                        i.endMonth != null,
                    );
                    const sameRowOverlaps = scheduledOthers.filter((i) => {
                      if (i.timelineRow !== target.timelineRow) return false;
                      const b = resolvedInitiativeYearSprintBounds(i);
                      if (!b) return false;
                      return overlaps(nextRangeStart, nextRangeEnd, b.startYearSprint, b.endYearSprint);
                    });
                    if (sameRowOverlaps.length > 0) {
                      const maxRow = Math.max(
                        target.timelineRow,
                        ...scheduledOthers.map((i) => i.timelineRow),
                      );
                      for (let row = 0; row <= maxRow + 1; row += 1) {
                        const blocked = scheduledOthers.some((i) => {
                          if (i.timelineRow !== row) return false;
                          const b = resolvedInitiativeYearSprintBounds(i);
                          if (!b) return false;
                          return overlaps(nextRangeStart, nextRangeEnd, b.startYearSprint, b.endYearSprint);
                        });
                        if (!blocked) {
                          nextTimelineRow = row;
                          break;
                        }
                      }
                      console.log("[gantt-resize] reflow row for overlap", {
                        initiativeId,
                        previousRow: target.timelineRow,
                        nextTimelineRow,
                        conflictingIds: sameRowOverlaps.map((i) => i.id),
                        nextRange: [nextRangeStart, nextRangeEnd],
                      });
                    }
                  }
                  const after = before.map((i) =>
                    i.id === initiativeId
                      ? {
                          ...i,
                          startMonth: range.startMonth,
                          endMonth: range.endMonth,
                          startYearSprint: range.startYearSprint,
                          endYearSprint: range.endYearSprint,
                          timelineRow: nextTimelineRow,
                        }
                      : i,
                  );
                  setInitiatives(after);
                  try {
                    await patchInitiativeScheduleRange(
                      initiativeId,
                      range.startMonth,
                      range.endMonth,
                      {
                        startYearSprint: range.startYearSprint,
                        endYearSprint: range.endYearSprint,
                      },
                      planYear,
                    );
                    await persistInitiativeTimelineRowPatches(before, after);
                    toast.success("Approved", {
                      description: "The initiative timeline was adjusted and saved.",
                    });
                  } catch (err) {
                    console.error("[onResizeInitiativeRange]", err);
                    await refresh();
                    const description = err instanceof Error ? err.message : undefined;
                    toast.error("Failed to resize initiative", description ? { description } : undefined);
                  }
                }}
                onResizeEpicPlanRange={async (epicId, range) => {
                  const before = initiatives;
                  const target = before.flatMap((initiative) => initiative.epics ?? []).find((epic) => epic.id === epicId);
                  if (!target) return;
                  const overlaps = (aS: number, aE: number, bS: number, bE: number) => !(aE < bS || bE < aS);
                  let nextTimelineRow = Number.isFinite(target.timelineRow) ? target.timelineRow : 0;
                  const scheduledOthers = before
                    .flatMap((initiative) => initiative.epics ?? [])
                    .filter((epic) => epic.id !== epicId && epic.planStartMonth != null && epic.planEndMonth != null);
                  const sameRowOverlaps = scheduledOthers.filter((epic) => {
                    const row = Number.isFinite(epic.timelineRow) ? epic.timelineRow : 0;
                    if (row !== nextTimelineRow) return false;
                    const bS = globalSprintFromMonthLane(epic.planStartMonth!, epic.planSprint === 2 ? 2 : 1);
                    const bE = globalSprintFromMonthLane(epic.planEndMonth!, epic.planEndSprint === 1 ? 1 : 2);
                    return overlaps(range.startYearSprint, range.endYearSprint, bS, bE);
                  });
                  if (sameRowOverlaps.length > 0) {
                    const maxRow = Math.max(nextTimelineRow, ...scheduledOthers.map((epic) => Number.isFinite(epic.timelineRow) ? epic.timelineRow : 0));
                    for (let row = 0; row <= maxRow + 1; row += 1) {
                      const blocked = scheduledOthers.some((epic) => {
                        const rowValue = Number.isFinite(epic.timelineRow) ? epic.timelineRow : 0;
                        if (rowValue !== row) return false;
                        const bS = globalSprintFromMonthLane(epic.planStartMonth!, epic.planSprint === 2 ? 2 : 1);
                        const bE = globalSprintFromMonthLane(epic.planEndMonth!, epic.planEndSprint === 1 ? 1 : 2);
                        return overlaps(range.startYearSprint, range.endYearSprint, bS, bE);
                      });
                      if (!blocked) {
                        nextTimelineRow = row;
                        break;
                      }
                    }
                  }
                  const after = before.map((initiative) => ({
                    ...initiative,
                    epics: (initiative.epics ?? []).map((epic) =>
                      epic.id === epicId
                        ? {
                            ...epic,
                            planSprint: laneFromYearSprint(range.startYearSprint),
                            planEndSprint: laneFromYearSprint(range.endYearSprint),
                            planStartMonth: range.startMonth,
                            planEndMonth: range.endMonth,
                            timelineRow: nextTimelineRow,
                          }
                        : epic,
                    ),
                  }));
                  setInitiatives(after);
                  try {
                    await patchEpicQuarterPlan(epicId, {
                      planSprint: laneFromYearSprint(range.startYearSprint),
                      planEndSprint: laneFromYearSprint(range.endYearSprint),
                      planStartMonth: range.startMonth,
                      planEndMonth: range.endMonth,
                      timelineRow: nextTimelineRow,
                    });
                    await persistEpicTimelineRowPatches(before, after);
                    toast.success("Approved", {
                      description: "The epic timeline was adjusted and saved.",
                    });
                  } catch (err) {
                    console.error("[onResizeEpicPlanRange]", err);
                    await refresh();
                    const description = err instanceof Error ? err.message : undefined;
                    toast.error("Failed to resize epic", description ? { description } : undefined);
                  }
                }}
                onOpenStory={(storyId) => {
                  setSelectedStoryId(storyId);
                }}
                onSprintModeChange={handleSprintModeChange}
              />
              </div>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 items-stretch gap-3" style={{ gridTemplateColumns: "54px minmax(0, 1fr)" }}>
              {modeSwitchMenu}
              <div
                ref={planningRightSurfaceRef}
                className="flex min-h-0 min-w-0 flex-col overflow-x-visible overflow-y-hidden"
              >
                <BacklogPlanningPanel
                initiatives={initiatives}
                storyRefById={storyRefMaps.byId}
                onOpenInitiative={(initiativeId) => {
                  const initiative = initiatives.find((item) => item.id === initiativeId);
                  if (!initiative) return;
                  setEditingInitiative(initiative);
                  setInitiativeDialogOpen(true);
                }}
                onOpenEpic={(epicId) => {
                  for (const initiative of initiatives) {
                    const epic = (initiative.epics ?? []).find((item) => item.id === epicId);
                    if (!epic) continue;
                    setEditingEpic(epic);
                    setEditingEpicInitiativeId(initiative.id);
                    setEpicDialogOpen(true);
                    return;
                  }
                }}
                onOpenStory={(storyId) => {
                  setSelectedStoryId(storyId);
                }}
                onCreateInitiativeQuick={async (title) => {
                  try {
                    await createInitiativeQuick(title);
                    toast.success("Initiative added");
                  } catch {
                    toast.error("Failed to add initiative");
                  }
                }}
                onCreateEpicQuick={async (initiativeId, title) => {
                  try {
                    await createEpicQuick(initiativeId, title);
                    toast.success("Epic added");
                  } catch {
                    toast.error("Failed to add epic");
                  }
                }}
                onCreateStoryQuick={async (epicId, title) => {
                  try {
                    await createStoryQuick(epicId, title);
                    toast.success("User story added");
                  } catch {
                    toast.error("Failed to add user story");
                  }
                }}
                onPatchStoryQuick={async (storyId, patch) => {
                  try {
                    const response = await fetch(`/api/stories/${storyId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(patch),
                    });
                    if (!response.ok) {
                      throw new Error("Failed to patch story");
                    }
                    await refresh();
                  } catch {
                    toast.error("Failed to update story");
                  }
                }}
                onPatchInitiativeQuick={async (initiativeId, patch) => {
                  try {
                    const response = await fetch(`/api/initiatives/${initiativeId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(patch),
                    });
                    if (!response.ok) throw new Error("Failed to patch initiative");
                    await refresh();
                  } catch {
                    toast.error("Failed to update initiative");
                  }
                }}
                onPatchEpicQuick={async (epicId, patch) => {
                  try {
                    const response = await fetch(`/api/epics/${epicId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(patch),
                    });
                    if (!response.ok) throw new Error("Failed to patch epic");
                    await refresh();
                  } catch {
                    toast.error("Failed to update epic");
                  }
                }}
              />
              </div>
            </div>
          )}
        </div>
      </main>
      <InitiativeFormDialog
        open={initiativeDialogOpen}
        initiatives={initiatives}
        initiative={currentEditingInitiative}
        onOpenEpic={(epicId) => {
          for (const initiative of initiatives) {
            const epic = (initiative.epics ?? []).find((e) => e.id === epicId);
            if (epic) {
              setEditingEpic(epic);
              setEditingEpicInitiativeId(initiative.id);
              setEpicDialogOpen(true);
              return;
            }
          }
        }}
        onRequestCreateEpic={(initiativeId) => {
          setEditingEpic(undefined);
          setEditingEpicInitiativeId(initiativeId);
          setEpicDialogOpen(true);
        }}
        onPatchEpic={async (epicId, patch) => {
          try {
            const response = await fetch(`/api/epics/${epicId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patch),
            });
            if (!response.ok) throw new Error("Failed to patch epic");
            await refresh();
          } catch {
            toast.error("Failed to update epic");
          }
        }}
        onAddComment={async (initiativeId, body) => {
          try {
            await addInitiativeComment(initiativeId, body);
            toast.success("Comment added");
          } catch {
            toast.error("Failed to add comment");
          }
        }}
        onClose={() => {
          setInitiativeDialogOpen(false);
        }}
        onExitComplete={() => {
          setEditingInitiative(undefined);
        }}
        onSubmit={handleUpsertInitiative}
        surfaceAnchorRef={planningRightSurfaceRef}
      />
      <EpicFormDialog
        open={epicDialogOpen}
        epic={currentEditingEpic}
        initiatives={initiatives}
        lockInitiativeId={editingEpicInitiativeId}
        onOpenInitiative={(initiativeId) => {
          setTopMode("roadmap");
          const initiative = initiatives.find((i) => i.id === initiativeId);
          if (initiative) setEditingInitiative(initiative);
          setInitiativeDialogOpen(true);
          setEpicDialogOpen(false);
        }}
        onOpenStory={(storyId) => {
          setCreatingStoryEpicId(null);
          setSelectedStoryId(storyId);
        }}
        onPatchStory={async (storyId, patch) => {
          try {
            const response = await fetch(`/api/stories/${storyId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patch),
            });
            if (!response.ok) throw new Error("Failed to patch story");
            await refresh();
          } catch {
            toast.error("Failed to update story");
          }
        }}
        onRequestCreateStory={(epicId) => {
          setSelectedStoryId(null);
          setCreatingStoryEpicId(epicId);
        }}
        onAddComment={async (epicId, body) => {
          try {
            await addEpicComment(epicId, body);
            toast.success("Comment added");
          } catch {
            toast.error("Failed to add comment");
          }
        }}
        onClose={() => {
          setEpicDialogOpen(false);
        }}
        onExitComplete={() => {
          setEditingEpic(undefined);
          setEditingEpicInitiativeId(null);
        }}
        onSubmit={handleUpsertEpic}
        storyRefById={storyRefMaps.byId}
        onDelete={async (epicId) => {
          try {
            await handleDeleteEpic(epicId);
            toast.success("Epic deleted");
          } catch {
            toast.error("Failed to delete epic");
          }
        }}
        surfaceAnchorRef={planningRightSurfaceRef}
      />
      <StoryDetailsDialog
        open={storyDialogOpen}
        story={selectedStory}
        initiatives={initiatives}
        lockParentEpicId={creatingStoryEpicId}
        onClose={() => {
          setStoryDialogOpen(false);
        }}
        onExitComplete={() => {
          if (pendingStoryDialogNavigationRef.current) {
            const run = pendingStoryDialogNavigationRef.current;
            pendingStoryDialogNavigationRef.current = null;
            run();
            return;
          }
          setSelectedStoryId(null);
          setCreatingStoryEpicId(null);
        }}
        onCreate={async (payload) => {
          try {
            await createStoryWithDetails(payload);
            toast.success("User story created");
          } catch {
            toast.error("Failed to create story");
          }
        }}
        onSave={async (storyId, payload) => {
          try {
            await updateStoryDetails(storyId, payload);
            toast.success("Story details updated");
          } catch {
            toast.error("Failed to update story");
          }
        }}
        onAddComment={async (storyId, body) => {
          try {
            await addStoryComment(storyId, body);
            toast.success("Comment added");
          } catch {
            toast.error("Failed to add comment");
          }
        }}
        onPatchEpicTeam={async (epicId, team) => {
          try {
            await patchEpicTeamFromStoryDialog(epicId, team);
          } catch {
            toast.error("Failed to update team on epic");
            throw new Error("Failed to update epic team");
          }
        }}
        onDelete={async (storyId) => {
          try {
            await deleteStory(storyId);
            toast.success("User story deleted");
          } catch {
            toast.error("Failed to delete user story");
          }
        }}
        onOpenInitiative={(initiativeId) => {
          pendingStoryDialogNavigationRef.current = () => {
            setTopMode("roadmap");
            const initiative = initiatives.find((i) => i.id === initiativeId);
            if (initiative) setEditingInitiative(initiative);
            setInitiativeDialogOpen(true);
          };
          setStoryDialogOpen(false);
        }}
        onOpenEpic={(epicId) => {
          pendingStoryDialogNavigationRef.current = () => {
            setTopMode("roadmap");
            const initiative = initiatives.find((item) => (item.epics ?? []).some((epic) => epic.id === epicId));
            const epic = initiative?.epics?.find((e) => e.id === epicId);
            setEditingEpicInitiativeId(initiative?.id ?? null);
            if (epic) setEditingEpic(epic);
            setEpicDialogOpen(true);
          };
          setStoryDialogOpen(false);
        }}
        onOpenStory={(storyId) => {
          pendingStoryDialogNavigationRef.current = () => {
            setTopMode("roadmap");
            setSelectedStoryId(storyId);
            setStoryDialogOpen(true);
          };
          setStoryDialogOpen(false);
        }}
        storyRef={selectedStoryId ? storyRefMaps.byId[selectedStoryId] : undefined}
        surfaceAnchorRef={planningRightSurfaceRef}
      />
    </DragContext>
  );
}

