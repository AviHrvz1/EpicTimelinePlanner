"use client";

import { DragEndEvent } from "@dnd-kit/core";
import { InitiativeStatus, StoryStatus } from "@/lib/generated/prisma";
import { Archive, LayoutDashboard, Map as MapIcon, PanelLeftOpen, Users } from "lucide-react";
import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { EpicFormDialog } from "@/components/epics/epic-form-dialog";
import { BacklogPlanningPanel } from "@/components/backlog/backlog-planning-panel";
import { UsersWorkspacePanel } from "@/components/users/users-workspace-panel";
import { DashboardPage } from "@/components/dashboard/dashboard-page";
import { EpicDeleteDialog } from "@/components/epics/epic-delete-dialog";
import { InitiativeDeleteDialog } from "@/components/initiatives/initiative-delete-dialog";
import { InitiativeFormDialog } from "@/components/initiatives/initiative-form-dialog";
import { InitiativeListPanel } from "@/components/initiatives/initiative-list-panel";
import { StoryDetailsDialog } from "@/components/stories/story-details-dialog";
import { DragContext } from "@/components/timeline/drag-context";
import { type SprintRetrospectiveDoc } from "@/components/timeline/sprint-retrospective";
import { TimelineGrid, type MonthPlanSurfaceTab, type QuarterSurfaceTab } from "@/components/timeline/timeline-grid";
import { Button } from "@/components/ui/button";
import {
  EPICS_UNPLAN_DROP_ID,
  STORIES_UNSCHEDULE_DROP_ID,
  isEpicPlanDraggableId,
  isEpicTimelineDraggableId,
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
  parseMonthTeamCapacityColumnDragId,
  parseMonthTeamCapacityColumnDropId,
  parseQuarterTeamCapacityBucketDropId,
  parseQuarterTeamCapacityColumnDragId,
  parseQuarterTeamCapacityColumnDropId,
  parseSprintCapacityBucketDropId,
  parseSprintCapacityColumnDragId,
  parseSprintCapacityColumnDropId,
  parseSprintCapacitySlotDropId,
} from "@/lib/epic-dnd-ids";
import {
  clientXLeadingEdgeFromDragEnd,
  clientYCenterFromDragEnd,
  inferGanttLaneHoverIndexFromClientY,
  inferGanttLaneHoverTimelineRowFromClientY,
  inferGanttLaneInsertIndexFromClientY,
} from "@/lib/gantt-lane-from-pointer";
import {
  applyEpicTeamQueueMove,
  collectMonthEpicsForTeamBoard,
  emptyMonthTeamBoard,
  inferEpicTeamIdFromMonthTeamQueues,
  monthTeamBoardStorageKey,
  MONTH_TEAM_IDS,
  removeEpicFromMonthTeamBoardQueues,
  sanitizeMonthTeamBoardPersisted,
  type MonthTeamBoardPersisted,
} from "@/lib/month-team-board";
import { collectQuarterEpics } from "@/lib/quarter-analytics";
import { splitQuarterTotalAcrossMonths } from "@/lib/quarter-team-capacity";
import { ALL_QUARTERS_TEAM_CAPACITY_LABEL, ALL_YEAR_PLAN_MONTHS, QUARTERS } from "@/lib/timeline";
import { EpicItem, InitiativeItem, RoadmapItem } from "@/lib/types";
import { normalizeWorkspaceUserTeam } from "@/lib/workspace-users";
import { cn } from "@/lib/utils";
import { DebugLogPanel } from "@/components/debug-log-panel";
import {
  SPRINT_CAPACITY_OTHER_BUCKET,
  SPRINT_CAPACITY_STORAGE_KEY,
  assignStoryToMember,
  assigneeMatchRosterForSprintTeam,
  emptySprintCapacityBoard,
  moveStoryInMemberBucket,
  orderedSprintCapacityMembers,
  reorderSprintCapacityPeopleOrder,
  sanitizeSprintCapacityBoard,
  sprintCapacityBoardKey,
  sprintStoryBoardEpicTeamFilter,
  syncCapacityAssignmentsWithKanban,
  type SprintCapacityBoard,
  type SprintWorkspaceDirectoryUser,
} from "@/lib/sprint-capacity";
import {
  applyKanbanOrderPatchesToInitiatives,
  computeKanbanStoryReorderPatches,
} from "@/lib/kanban-story-order";
import { collectStoriesForSprintBoard } from "@/lib/sprint-plan";
import {
  MONTH_TEAM_CAPACITY_STORAGE_KEY,
  emptyMonthTeamCapacityBoard,
  fullMonthTeamCapacityColumnOrder,
  monthTeamCapacityBoardKey,
  reorderMonthTeamCapacityColumnOrder,
  sanitizeMonthTeamCapacityBoard,
  type MonthTeamCapacityBoard,
} from "@/lib/month-team-capacity";
import {
  clampYearSprint,
  globalSprintFromMonthLane,
  monthLaneFromGlobalSprint,
  resolvedInitiativeYearSprintBounds,
  sprintEndDate,
  YEAR_SPRINT_MAX,
  yearSprintRangeFromMonthRange,
} from "@/lib/year-sprint";

const ROADMAP_STORAGE_KEY = "epicPlanner.selectedRoadmapId.v1";

type PlannerProps = {
  initialInitiatives: InitiativeItem[];
  year: number;
  initialRoadmaps: RoadmapItem[];
  initialRoadmapId: string;
};

const SPRINT_RETROSPECTIVE_STORAGE_KEY = "epicPlanner.sprintRetrospective.v1";

type SprintRetrospectiveEntry = {
  wentWellHtml: string;
  improveHtml: string;
  actionItems: Array<{ id: string; title: string; owner: string; dueDate: string }>;
  updatedAt: string;
};

type DndDropInspectorPayload = {
  at: string;
  activeId: string;
  overId: string;
  delta: { x: number; y: number };
  planner: {
    activeTimelineMonth: number | null;
    activeYearSprint: number | null;
    sprintCapacityPlanMonth: number | null;
    activeMonthPlanTab: MonthPlanSurfaceTab;
    isActiveSprintClosed: boolean;
    sprintStoryBoardTeamId: string | null;
    selectedYear: number;
    focusedQuarterLabel: string | null;
  };
  branch: string;
  detail: Record<string, unknown>;
  steps: string[];
};

/** Drag outcomes that completed normally — do not pop the debug panel (it reads like an error). */
const DND_DROP_INSPECTOR_SUPPRESS_BRANCHES = new Set<string>([
  "epic:gantt-month-placed",
  "epic:unplan-ok",
  "epic:month-team-capacity-saved",
  "epic:quarter-team-capacity-saved",
  "epic:month-team-slot-saved",
  "epic:month-kanban-all-todo",
  "epic:sprint-kanban-bulk-todo",
  "initiative:rescheduled",
  "initiative:scheduled-first-time",
  "initiative:backlog",
  "story:unschedule-ok",
  "story:plan-cell",
  "story:kanban",
  "story:kanban-reorder",
  "story:kanban-reorder-noop",
  "story:capacity",
  "capcol:reorder",
  "m-cap-col:reorder",
  "q-cap-col:reorder",
]);

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
    : hoveredTimelineRow != null && Number.isFinite(hoveredTimelineRow)
      ? hoveredTimelineRow
      : targetRowFromLaneForTarget != null
        ? targetRowFromLaneForTarget
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
    console.log("[gantt-drop][epic] first-schedule placement", {
      epicId,
      month,
      planSprint,
      insertAt,
      laneIndex,
      othersCount: others.length,
      newOrder: newOrder.map((r) => ({ epicId: r.epicId, row: r.timelineRow, range: [r.startMonth, r.endMonth] })),
      assignedRows: Object.fromEntries(rowByEpicId),
      epicsChangingRow: newOrder
        .map((r, idx) => ({ epicId: r.epicId, from: r.timelineRow, to: idx }))
        .filter((r) => r.from !== r.to),
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
  const distinctTimelineRows = [...new Set(scheduledAll.map((item) => item.timelineRow))].sort((a, b) => a - b);
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
  /** `laneIndex` is a Gantt lane index (0..n), not necessarily equal to persisted `timelineRow`. */
  const targetRowFromLaneForTarget =
    clampedLaneForTarget == null || distinctTimelineRows.length === 0
      ? null
      : clampedLaneForTarget < distinctTimelineRows.length
        ? (distinctTimelineRows[clampedLaneForTarget] ?? null)
        : null;
  const desiredTargetRow = wantsAppendRow
    ? appendTimelineRow
    : hoveredTimelineRow != null && Number.isFinite(hoveredTimelineRow)
      ? hoveredTimelineRow
      : targetRowFromLaneForTarget != null
        ? targetRowFromLaneForTarget
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

function buildInitiativeRefMaps(initiatives: InitiativeItem[]): {
  byId: Record<string, string>;
  idByRef: Record<string, string>;
} {
  const byId: Record<string, string> = {};
  const idByRef: Record<string, string> = {};
  [...initiatives]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.title.localeCompare(b.title))
    .forEach((initiative, idx) => {
      const ref = String(idx + 1).padStart(2, "0");
      byId[initiative.id] = ref;
      idByRef[ref] = initiative.id;
    });
  return { byId, idByRef };
}

function resolveInitiativeIdFromUrlParam(param: string, maps: ReturnType<typeof buildInitiativeRefMaps>): string {
  const raw = param.trim();
  if (!raw) return raw;
  const direct = maps.idByRef[raw];
  if (direct) return direct;
  const stripped = raw.replace(/^INIT-/i, "");
  const padded = stripped.padStart(2, "0");
  return maps.idByRef[stripped] ?? maps.idByRef[padded] ?? raw;
}

function buildEpicRefMaps(initiatives: InitiativeItem[]): {
  byId: Record<string, string>;
  idByRef: Record<string, string>;
} {
  const rows = initiatives
    .flatMap((initiative) => initiative.epics ?? [])
    .map((epic) => ({
      id: epic.id,
      createdAt: new Date(epic.createdAt).getTime(),
      title: epic.title,
    }))
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

/** Map URL `epic` param (e.g. `10`, `EPIC-10`, or raw id) to an epic primary key. */
function resolveEpicIdFromUrlParam(epicParam: string, maps: ReturnType<typeof buildEpicRefMaps>): string {
  const raw = epicParam.trim();
  if (!raw) return raw;
  const direct = maps.idByRef[raw];
  if (direct) return direct;
  const stripped = raw.replace(/^EPIC-/i, "");
  const padded = stripped.padStart(2, "0");
  return maps.idByRef[stripped] ?? maps.idByRef[padded] ?? raw;
}

export function EpicPlannerApp({ initialInitiatives, year, initialRoadmaps, initialRoadmapId }: PlannerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [initiatives, setInitiatives] = useState(initialInitiatives);
  const [roadmaps, setRoadmaps] = useState<RoadmapItem[]>(initialRoadmaps);
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(ROADMAP_STORAGE_KEY);
      if (stored && initialRoadmaps.some((r) => r.id === stored)) return stored;
    }
    return initialRoadmapId;
  });
  const selectedRoadmap = roadmaps.find((r) => r.id === selectedRoadmapId) ?? roadmaps[0] ?? null;

  // If the client restored a different roadmap from localStorage than the server pre-fetched,
  // the displayed initiatives belong to the server roadmap — re-fetch the correct ones.
  useEffect(() => {
    if (selectedRoadmapId !== initialRoadmapId) {
      void refresh(year, selectedRoadmapId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedYear, setSelectedYear] = useState(year);
  const [initiativeDialogOpen, setInitiativeDialogOpen] = useState(false);
  const [editingInitiative, setEditingInitiative] = useState<InitiativeItem | undefined>(undefined);
  const [epicDialogOpen, setEpicDialogOpen] = useState(false);
  const [editingEpic, setEditingEpic] = useState<EpicItem | undefined>(undefined);
  const [editingEpicInitiativeId, setEditingEpicInitiativeId] = useState<string | null>(null);
  const [insightsScopeEpicId, setInsightsScopeEpicId] = useState<string | null>(null);
  const [insightsScopeInitId, setInsightsScopeInitId] = useState<string | null>(null);
  const [focusedQuarterLabel, setFocusedQuarterLabel] = useState<string | null>(null);
  const [isSprintModeActive, setIsSprintModeActive] = useState(false);
  const [activeTimelineMonth, setActiveTimelineMonth] = useState<number | null>(null);
  const [activeYearSprint, setActiveYearSprint] = useState<number | null>(null);
  const isActiveSprintClosed =
    activeYearSprint != null && sprintEndDate(selectedYear, activeYearSprint).getTime() <= Date.now();
  const [activeSprintTab, setActiveSprintTab] = useState<"kanban" | "status">("kanban");
  const [activeMonthPlanTab, setActiveMonthPlanTab] = useState<MonthPlanSurfaceTab>("epic-gantt");
  const [activeQuarterViewTab, setActiveQuarterViewTab] = useState<QuarterSurfaceTab>("gantt");
  const [panelStatusQuickFilter, setPanelStatusQuickFilter] = useState<"Scheduled" | "Unscheduled" | null>(null);
  /** When sprint Kanban is opened from a team lane: team id for breadcrumb and left epic list. */
  const [sprintStoryBoardTeamId, setSprintStoryBoardTeamId] = useState<string | null>(null);
  /** Users directory (name + team) for sprint Kanban / capacity assignee rosters. */
  const [workspaceDirectoryUsers, setWorkspaceDirectoryUsers] = useState<SprintWorkspaceDirectoryUser[]>([]);
  /** Last drag-end snapshot for debugging drops (story Kanban, plan cells, etc.). */
  const [dndDropInspector, setDndDropInspector] = useState<DndDropInspectorPayload | null>(null);
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
  const [topMode, setTopMode] = useState<"roadmap" | "backlog" | "dashboard" | "users">("roadmap");
  const [epicBacklogOrderByMonth, setEpicBacklogOrderByMonth] = useState<Record<number, string[]>>({});
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [creatingStoryEpicId, setCreatingStoryEpicId] = useState<string | null>(null);
  /** Separate from selection so `open` can go false before IDs clear, allowing exit animation. */
  const [storyDialogOpen, setStoryDialogOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const [isConfirmingDialog, setIsConfirmingDialog] = useState(false);
  const pendingStoryDialogNavigationRef = useRef<null | (() => void)>(null);
  const [panelWidth, setPanelWidth] = useState(520);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const [isLeftPanelHidden, setIsLeftPanelHidden] = useState(false);
  /** Synced with TimelineGrid “Progress” chip — Gantt bar rows + left-panel story progress. */
  const [showRoadmapProgress, setShowRoadmapProgress] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  /** When true, we hid the initiative rail for insights/retro; restore on leaving those surfaces. */
  const leftInitiativePanelAutoCollapsedForInsightsRef = useRef(false);
  const planningRightSurfaceRef = useRef<HTMLDivElement | null>(null);
  const sprintAutoRolloverInFlightRef = useRef<Set<string>>(new Set());
  const ganttEmphasisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ganttEmphasisTickRef = useRef(0);
  const [ganttEmphasis, setGanttEmphasis] = useState<{ initiativeId: string; tick: number } | null>(null);
  const [isUrlHydrated, setIsUrlHydrated] = useState(false);
  const hasHydratedFromUrlRef = useRef(false);

  /**
   * Same month scope as TimelineGrid’s `activeMonth`: when a quarter is focused, a stale
   * `activeTimelineMonth` outside that quarter must not drive the left panel (epic vs initiative).
   */
  const initiativeListActiveMonth = useMemo(() => {
    if (activeTimelineMonth == null) return null;
    if (focusedQuarterLabel == null) return activeTimelineMonth;
    const visible = QUARTERS.find((q) => q.label === focusedQuarterLabel)?.months ?? null;
    if (visible == null || visible.length === 0) return activeTimelineMonth;
    return visible.includes(activeTimelineMonth) ? activeTimelineMonth : null;
  }, [activeTimelineMonth, focusedQuarterLabel]);

  const handleInitiativeAccordionChange = useCallback(
    (initiativeId: string, isOpen: boolean) => {
      console.log("[accordion->gantt] initiative toggle", {
        initiativeId,
        isOpen,
        topMode,
        activeMonthPlanTab,
        activeTimelineMonth,
        focusedQuarterLabel,
      });
      if (!isOpen) return;
      const inv = initiatives.find((i) => i.id === initiativeId);
      if (!inv || inv.status !== InitiativeStatus.scheduled) {
        console.log("[accordion->gantt] skip emphasis (initiative not scheduled/ranged)", {
          initiativeId,
          found: Boolean(inv),
          status: inv?.status,
          startMonth: inv?.startMonth ?? null,
          endMonth: inv?.endMonth ?? null,
        });
        return;
      }
      const plannedMonthRanges = (inv.epics ?? [])
        .map((epic) =>
          epic.planStartMonth != null && epic.planEndMonth != null
            ? { startMonth: epic.planStartMonth, endMonth: epic.planEndMonth }
            : null,
        )
        .filter((row): row is { startMonth: number; endMonth: number } => row != null);
      const fallbackStartMonth =
        plannedMonthRanges.length > 0 ? Math.min(...plannedMonthRanges.map((row) => row.startMonth)) : null;
      const fallbackEndMonth =
        plannedMonthRanges.length > 0 ? Math.max(...plannedMonthRanges.map((row) => row.endMonth)) : null;
      const sm = inv.startMonth ?? fallbackStartMonth;
      const em = inv.endMonth ?? fallbackEndMonth;
      if (sm == null || em == null) {
        console.log("[accordion->gantt] skip emphasis (no month range available)", {
          initiativeId,
          startMonth: inv.startMonth,
          endMonth: inv.endMonth,
          fallbackStartMonth,
          fallbackEndMonth,
          plannedEpicsWithRange: plannedMonthRanges.length,
        });
        return;
      }
      const epicCount = (inv.epics ?? []).length;
      const onPlanForActiveMonth =
        activeTimelineMonth == null
          ? null
          : (inv.epics ?? []).filter(
              (epic) =>
                epic.planStartMonth != null &&
                epic.planEndMonth != null &&
                epic.planStartMonth <= activeTimelineMonth &&
                epic.planEndMonth >= activeTimelineMonth,
            ).length;
      console.log("[accordion->gantt] initiative context", {
        initiativeId,
        monthRange: `${sm}-${em}`,
        monthRangeSource: inv.startMonth != null && inv.endMonth != null ? "initiative" : "epic-fallback",
        epicCount,
        onPlanForActiveMonth,
      });
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
      const isOnMonthSurface = activeTimelineMonth != null;
      if (isOnMonthSurface && (activeTimelineMonth < sm || activeTimelineMonth > em)) {
        console.log("[accordion->gantt] adjust activeTimelineMonth", {
          from: activeTimelineMonth,
          to: sm,
        });
        setActiveTimelineMonth(sm);
      }
      // Only retarget to epic-gantt if user is already on a month surface.
      if (isOnMonthSurface && activeMonthPlanTab !== "epic-gantt") {
        console.log("[accordion->gantt] switch month surface to epic-gantt", {
          from: activeMonthPlanTab,
        });
        setActiveMonthPlanTab("epic-gantt");
      }

      ganttEmphasisTickRef.current += 1;
      const tick = ganttEmphasisTickRef.current;
      console.log("[accordion->gantt] set ganttEmphasis", { initiativeId, tick });
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
    [initiatives, focusedQuarterLabel, activeTimelineMonth, activeMonthPlanTab],
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
  const sprintEpicAccordionEmphasisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sprintEpicAccordionEmphasisTickRef = useRef(0);
  const [sprintEpicAccordionEmphasis, setSprintEpicAccordionEmphasis] = useState<{
    epicId: string;
    tick: number;
  } | null>(null);
  const ganttScheduledFilterEmphasisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ganttScheduledFilterEmphasisTickRef = useRef(0);
  const [ganttScheduledFilterEmphasis, setGanttScheduledFilterEmphasis] = useState<{ tick: number } | null>(null);
  const sprintKanbanScheduledStoriesEmphasisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sprintKanbanScheduledStoriesEmphasisTickRef = useRef(0);
  const [sprintKanbanScheduledStoriesEmphasis, setSprintKanbanScheduledStoriesEmphasis] = useState<{
    tick: number;
  } | null>(null);

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
      if (sprintEpicAccordionEmphasisTimeoutRef.current) {
        clearTimeout(sprintEpicAccordionEmphasisTimeoutRef.current);
        sprintEpicAccordionEmphasisTimeoutRef.current = null;
      }
      if (ganttScheduledFilterEmphasisTimeoutRef.current) {
        clearTimeout(ganttScheduledFilterEmphasisTimeoutRef.current);
        ganttScheduledFilterEmphasisTimeoutRef.current = null;
      }
      if (sprintKanbanScheduledStoriesEmphasisTimeoutRef.current) {
        clearTimeout(sprintKanbanScheduledStoriesEmphasisTimeoutRef.current);
        sprintKanbanScheduledStoriesEmphasisTimeoutRef.current = null;
      }
    },
    [],
  );

  const flashSprintEpicAccordionEmphasis = useCallback((epicId: string) => {
    sprintEpicAccordionEmphasisTickRef.current += 1;
    const tick = sprintEpicAccordionEmphasisTickRef.current;
    setSprintEpicAccordionEmphasis({ epicId, tick });
    if (sprintEpicAccordionEmphasisTimeoutRef.current) {
      clearTimeout(sprintEpicAccordionEmphasisTimeoutRef.current);
      sprintEpicAccordionEmphasisTimeoutRef.current = null;
    }
    sprintEpicAccordionEmphasisTimeoutRef.current = setTimeout(() => {
      setSprintEpicAccordionEmphasis(null);
      sprintEpicAccordionEmphasisTimeoutRef.current = null;
    }, 2000);
  }, []);

  const flashGanttScheduledFilterEmphasis = useCallback(() => {
    ganttScheduledFilterEmphasisTickRef.current += 1;
    const tick = ganttScheduledFilterEmphasisTickRef.current;
    setGanttScheduledFilterEmphasis({ tick });
    if (ganttScheduledFilterEmphasisTimeoutRef.current) {
      clearTimeout(ganttScheduledFilterEmphasisTimeoutRef.current);
      ganttScheduledFilterEmphasisTimeoutRef.current = null;
    }
    ganttScheduledFilterEmphasisTimeoutRef.current = setTimeout(() => {
      setGanttScheduledFilterEmphasis(null);
      ganttScheduledFilterEmphasisTimeoutRef.current = null;
    }, 2000);
  }, []);

  const flashSprintKanbanScheduledStoriesEmphasis = useCallback(() => {
    sprintKanbanScheduledStoriesEmphasisTickRef.current += 1;
    const tick = sprintKanbanScheduledStoriesEmphasisTickRef.current;
    setSprintKanbanScheduledStoriesEmphasis({ tick });
    if (sprintKanbanScheduledStoriesEmphasisTimeoutRef.current) {
      clearTimeout(sprintKanbanScheduledStoriesEmphasisTimeoutRef.current);
      sprintKanbanScheduledStoriesEmphasisTimeoutRef.current = null;
    }
    sprintKanbanScheduledStoriesEmphasisTimeoutRef.current = setTimeout(() => {
      setSprintKanbanScheduledStoriesEmphasis(null);
      sprintKanbanScheduledStoriesEmphasisTimeoutRef.current = null;
    }, 2000);
  }, []);

  const prevPanelStatusQuickFilterRef = useRef(panelStatusQuickFilter);
  useEffect(() => {
    const prev = prevPanelStatusQuickFilterRef.current;
    prevPanelStatusQuickFilterRef.current = panelStatusQuickFilter;
    if (panelStatusQuickFilter !== "Scheduled" || prev === "Scheduled") return;
    flashGanttScheduledFilterEmphasis();
    if (activeMonthPlanTab === "sprint-kanban" && activeTimelineMonth != null) {
      flashSprintKanbanScheduledStoriesEmphasis();
    }
  }, [
    panelStatusQuickFilter,
    activeMonthPlanTab,
    activeTimelineMonth,
    flashGanttScheduledFilterEmphasis,
    flashSprintKanbanScheduledStoriesEmphasis,
  ]);

  const openConfirmDialog = useCallback(
    (opts: {
      title: string;
      message: string;
      confirmLabel?: string;
      onConfirm: () => void | Promise<void>;
    }) => {
      setConfirmDialog({
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? "Confirm",
        onConfirm: opts.onConfirm,
      });
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
    const estimatedEpics = epics.filter((e) => e.originalEstimateDays != null && e.originalEstimateDays > 0);
    const epicEstimatedPct = epics.length > 0 ? Math.round((estimatedEpics.length / epics.length) * 100) : 0;

    return {
      totalInitiatives: initiatives.length,
      scheduledInitiatives: scheduled.length,
      totalEpics: epics.length,
      scheduledEpics: scheduledEpics.length,
      unscheduledEpics,
      totalStories,
      completedStories,
      completionPercent,
      epicEstimatedPct,
    };
  }, [initiatives]);

  /** Month-plan tabs where sprint story scope follows `sprintStoryBoardTeamId` (Kanban team selector). */
  const sprintSurfaceUsesDeliveryTeam =
    activeMonthPlanTab === "sprint-kanban" ||
    activeMonthPlanTab === "sprint-capacity" ||
    activeMonthPlanTab === "sprint-status" ||
    activeMonthPlanTab === "sprint-retrospective";

  const storyRefMaps = useMemo(() => buildStoryRefMaps(initiatives), [initiatives]);
  const epicRefMaps = useMemo(() => buildEpicRefMaps(initiatives), [initiatives]);
  const initiativeRefMaps = useMemo(() => buildInitiativeRefMaps(initiatives), [initiatives]);

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
    const viewRaw = params.get("view");
    if (viewRaw === "users") setTopMode("users");
    else if (viewRaw === "backlog") setTopMode("backlog");
    else if (viewRaw === "dashboard") setTopMode("dashboard");
    const q = params.get("quarter");
    if (q && QUARTERS.some((item) => item.label === q)) {
      setFocusedQuarterLabel(q);
    }
    const quarterTabRaw = params.get("quarterTab");
    if (quarterTabRaw === "gantt" || quarterTabRaw === "capacity" || quarterTabRaw === "insights") {
      setActiveQuarterViewTab(quarterTabRaw);
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
      if (planTabRaw === "teamCapacity") {
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
        if (sprintTeamRaw) {
          const norm = normalizeWorkspaceUserTeam(sprintTeamRaw);
          if (norm) setSprintStoryBoardTeamId(norm);
        }
      }
    }
    const epicParam = params.get("epic");
    if (epicParam) {
      const initialEpicMaps = buildEpicRefMaps(initialInitiatives);
      const epicId = resolveEpicIdFromUrlParam(epicParam, initialEpicMaps);
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
    const iScopeEpicParam = params.get("iScopeEpicId");
    if (iScopeEpicParam) {
      const initialEpicMaps = buildEpicRefMaps(initialInitiatives);
      setInsightsScopeEpicId(resolveEpicIdFromUrlParam(iScopeEpicParam, initialEpicMaps));
    }
    const iScopeInitParam = params.get("iScopeInitId");
    if (iScopeInitParam) {
      const initialInitMaps = buildInitiativeRefMaps(initialInitiatives);
      setInsightsScopeInitId(resolveInitiativeIdFromUrlParam(iScopeInitParam, initialInitMaps));
    }
    setIsUrlHydrated(true);
  }, [initialInitiatives]);

  // Clear insights scope when the user navigates away from an insights surface.
  // Gate on isUrlHydrated so the initial URL hydration (which sets activeQuarterViewTab)
  // completes before this effect can wipe the scope that was just read from the URL.
  useEffect(() => {
    if (!isUrlHydrated) return;
    const inInsights =
      activeQuarterViewTab === "insights" ||
      activeMonthPlanTab === "month-status" ||
      epicDialogOpen;
    if (!inInsights) {
      setInsightsScopeEpicId(null);
      setInsightsScopeInitId(null);
    }
  }, [isUrlHydrated, activeQuarterViewTab, activeMonthPlanTab, epicDialogOpen]);

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
    if (topMode === "users") params.set("view", "users");
    else if (topMode === "backlog") params.set("view", "backlog");
    else if (topMode === "dashboard") params.set("view", "dashboard");
    if (focusedQuarterLabel) params.set("quarter", focusedQuarterLabel);
    if (activeTimelineMonth == null && activeQuarterViewTab !== "gantt") params.set("quarterTab", activeQuarterViewTab);
    if (activeTimelineMonth != null) {
      params.set("month", String(activeTimelineMonth));
      if (activeMonthPlanTab === "epic-gantt") params.set("planTab", "epic");
      else if (activeMonthPlanTab === "month-capacity") params.set("planTab", "teamCapacity");
      else if (activeMonthPlanTab === "month-status") params.set("planTab", "monthInsights");
      else if (activeMonthPlanTab === "sprint-kanban") params.set("planTab", "sprintBoard");
      else if (activeMonthPlanTab === "sprint-capacity") params.set("planTab", "sprintCapacity");
      else if (activeMonthPlanTab === "sprint-retrospective") params.set("planTab", "sprintRetro");
      else params.set("planTab", "sprintInsights");
    }
    if (activeYearSprint != null) params.set("sprint", String(activeYearSprint));
    if (activeYearSprint != null) params.set("sprintView", activeSprintTab);
    const sprintTeamForUrl = sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId);
    if (
      (activeMonthPlanTab === "sprint-kanban" ||
        activeMonthPlanTab === "sprint-status" ||
        activeMonthPlanTab === "sprint-capacity" ||
        activeMonthPlanTab === "sprint-retrospective") &&
      sprintTeamForUrl
    ) {
      params.set("sprintTeam", sprintTeamForUrl);
    }
    if (epicDialogOpen && editingEpic?.id) {
      const epicRef = epicRefMaps.byId[editingEpic.id];
      params.set("epic", epicRef ? `EPIC-${epicRef}` : editingEpic.id);
    }
    if (insightsScopeEpicId) {
      const ref = epicRefMaps.byId[insightsScopeEpicId];
      params.set("iScopeEpicId", ref ? `EPIC-${ref}` : insightsScopeEpicId);
    } else if (insightsScopeInitId) {
      const ref = initiativeRefMaps.byId[insightsScopeInitId];
      params.set("iScopeInitId", ref ? `INIT-${ref}` : insightsScopeInitId);
    }
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
    topMode,
    focusedQuarterLabel,
    activeTimelineMonth,
    activeQuarterViewTab,
    activeYearSprint,
    activeSprintTab,
    activeMonthPlanTab,
    epicDialogOpen,
    editingEpic?.id,
    epicRefMaps.byId,
    initiativeRefMaps.byId,
    insightsScopeEpicId,
    insightsScopeInitId,
    selectedStoryId,
    storyRefMaps.byId,
    router,
    pathname,
    sprintStoryBoardTeamId,
  ]);

  /** Keep top tab in sync when the user navigates with the browser Back/Forward buttons. */
  useEffect(() => {
    if (!isUrlHydrated) return;
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const v = params.get("view");
      if (v === "users") setTopMode("users");
      else if (v === "backlog") setTopMode("backlog");
      else if (v === "dashboard") setTopMode("dashboard");
      else setTopMode("roadmap");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isUrlHydrated]);

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
    if (tab === "epic-gantt" || tab === "month-capacity" || tab === "month-status") {
      setSprintStoryBoardTeamId(null);
    }
  }, []);

  /** Portfolio Insights (year/quarter), month/sprint Insights, or Sprint Retro: left rail stays collapsed; no expand control. */
  const leftRailLockedClosed = useMemo(() => {
    if (topMode !== "roadmap") return false;
    return (
      (activeTimelineMonth == null && activeQuarterViewTab === "insights") ||
      (activeTimelineMonth != null &&
        (activeMonthPlanTab === "month-status" ||
          activeMonthPlanTab === "sprint-status" ||
          activeMonthPlanTab === "sprint-retrospective"))
    );
  }, [topMode, activeTimelineMonth, activeQuarterViewTab, activeMonthPlanTab]);

  useEffect(() => {
    const isInsightsSurface =
      (activeTimelineMonth != null &&
        (activeMonthPlanTab === "month-status" || activeMonthPlanTab === "sprint-status")) ||
      (activeTimelineMonth == null && activeQuarterViewTab === "insights");
    if (!isInsightsSurface) return;
    const resetToTop = () => {
      planningRightSurfaceRef.current?.scrollTo({ top: 0, behavior: "auto" });
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "auto" });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    };
    resetToTop();
    const raf = requestAnimationFrame(resetToTop);
    return () => cancelAnimationFrame(raf);
  }, [activeTimelineMonth, activeMonthPlanTab, activeQuarterViewTab]);

  useEffect(() => {
    if (leftRailLockedClosed) {
      setIsLeftPanelHidden((prev) => {
        if (prev) return true;
        leftInitiativePanelAutoCollapsedForInsightsRef.current = true;
        return true;
      });
    } else if (leftInitiativePanelAutoCollapsedForInsightsRef.current) {
      setIsLeftPanelHidden(false);
      leftInitiativePanelAutoCollapsedForInsightsRef.current = false;
    }
  }, [leftRailLockedClosed]);

  useEffect(() => {
    const el = planningRightSurfaceRef.current;
    if (!el) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { opacity: 0.0, transform: "translateX(22px)" },
        { opacity: 1.0, transform: "translateX(0px)" },
      ],
      { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [topMode]);

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
      if (activeTimelineMonth != null) {
        const boardKey = monthTeamBoardStorageKey(selectedYear, activeTimelineMonth);
        setMonthTeamBoardByKey((prev) => {
          const cur = prev[boardKey] ?? { queues: {} };
          return { ...prev, [boardKey]: removeEpicFromMonthTeamBoardQueues(cur, epicId) };
        });
      } else {
        // Quarter / all-year view: remove from every month so the sync effect doesn't re-add the team.
        setMonthTeamBoardByKey((prev) => {
          const next = { ...prev };
          for (let m = 1; m <= 12; m++) {
            const key = monthTeamBoardStorageKey(selectedYear, m);
            const cur = prev[key] ?? { queues: {} };
            next[key] = removeEpicFromMonthTeamBoardQueues(cur, epicId);
          }
          return next;
        });
      }
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

  const openSprintStoryBoard = useCallback(
    (yearSprint: number, teamId: string | null) => {
      const clamped = clampYearSprint(yearSprint);
      const { month } = monthLaneFromGlobalSprint(clamped);
      /**
       * With a focused quarter, timeline `activeMonth` is null unless the month is in that quarter’s strip.
       * Jumping to a sprint in another quarter without retargeting caused `onSprintModeChange(false, …)`
       * and a max-update-depth loop. Year-wide view (`focusedQuarterLabel == null`) already includes all months.
       */
      if (focusedQuarterLabel != null) {
        const visibleMonths =
          QUARTERS.find((q) => q.label === focusedQuarterLabel)?.months ?? [];
        if (!visibleMonths.includes(month)) {
          const quarterForMonth = QUARTERS.find((q) => q.months.some((m) => m === month));
          if (quarterForMonth) setFocusedQuarterLabel(quarterForMonth.label);
        }
      }
      setActiveTimelineMonth(month);
      setIsSprintModeActive(true);
      setActiveYearSprint(clamped);
      setActiveSprintTab("kanban");
      setActiveMonthPlanTab("sprint-kanban");
      const normalizedTeamId = teamId?.trim() ? normalizeWorkspaceUserTeam(teamId) : null;
      setSprintStoryBoardTeamId(normalizedTeamId || null);
    },
    [focusedQuarterLabel],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspaceDirectory() {
      try {
        const res = await fetch("/api/workspace-users");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Array<{ name: string; team: string }>;
        if (!cancelled) {
          setWorkspaceDirectoryUsers(data.map((u) => ({ name: u.name, team: u.team ?? "" })));
        }
      } catch {
        if (!cancelled) setWorkspaceDirectoryUsers([]);
      }
    }
    void loadWorkspaceDirectory();
    const onRefresh = () => {
      void loadWorkspaceDirectory();
    };
    window.addEventListener("epic-planner-workspace-users-changed", onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener("epic-planner-workspace-users-changed", onRefresh);
    };
  }, []);

  const activeSprintCapacityKey = useMemo(() => {
    if (activeYearSprint == null) return null;
    return sprintCapacityBoardKey(selectedYear, activeYearSprint, sprintStoryBoardTeamId);
  }, [selectedYear, activeYearSprint, sprintStoryBoardTeamId]);

  /**
   * Sprint planning uses a calendar month for legacy lane resolution (story.sprint 1|2).
   * When the timeline has no focused month but a global sprint is active (e.g. year view),
   * derive the month from the sprint so capacity/kanban collect the same rows as sprint 9 → May.
   */
  const sprintCapacityPlanMonth = useMemo(() => {
    if (activeYearSprint == null) return null;
    if (activeTimelineMonth != null) return activeTimelineMonth;
    return monthLaneFromGlobalSprint(activeYearSprint).month;
  }, [activeTimelineMonth, activeYearSprint]);

  const activeSprintCapacityBoard = useMemo(() => {
    if (!activeSprintCapacityKey || activeYearSprint == null || sprintCapacityPlanMonth == null) {
      return { capacities: {}, assignments: {} };
    }
    const sprintTeamFilter = sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId);
    const members = assigneeMatchRosterForSprintTeam(sprintTeamFilter, workspaceDirectoryUsers);
    const raw = sprintCapacityByKey[activeSprintCapacityKey] ?? emptySprintCapacityBoard(members);
    const rows = collectStoriesForSprintBoard(
      initiatives,
      sprintCapacityPlanMonth,
      activeYearSprint,
      sprintTeamFilter ? [sprintTeamFilter] : null,
    );
    return syncCapacityAssignmentsWithKanban(
      raw,
      members,
      rows.map((r) => ({ id: r.story.id, assignee: r.story.assignee })),
      members,
    );
  }, [
    activeSprintCapacityKey,
    activeYearSprint,
    sprintCapacityPlanMonth,
    initiatives,
    sprintCapacityByKey,
    sprintStoryBoardTeamId,
    workspaceDirectoryUsers,
  ]);

  useEffect(() => {
    if (!activeSprintCapacityKey || activeYearSprint == null || sprintCapacityPlanMonth == null) return;
    setSprintCapacityByKey((prev) => {
      const sprintTeamFilter = sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId);
      const members = assigneeMatchRosterForSprintTeam(sprintTeamFilter, workspaceDirectoryUsers);
      const raw = prev[activeSprintCapacityKey] ?? emptySprintCapacityBoard(members);
      const rows = collectStoriesForSprintBoard(
        initiatives,
        sprintCapacityPlanMonth,
        activeYearSprint,
        sprintTeamFilter ? [sprintTeamFilter] : null,
      );
      const merged = syncCapacityAssignmentsWithKanban(
        raw,
        members,
        rows.map((r) => ({ id: r.story.id, assignee: r.story.assignee })),
        members,
      );
      if (JSON.stringify(merged.assignments) === JSON.stringify(raw.assignments)) return prev;
      return { ...prev, [activeSprintCapacityKey]: merged };
    });
  }, [
    activeSprintCapacityKey,
    activeYearSprint,
    sprintCapacityPlanMonth,
    initiatives,
    sprintStoryBoardTeamId,
    workspaceDirectoryUsers,
  ]);

  const activeSprintRetrospectiveKey = useMemo(() => {
    if (activeYearSprint == null) return null;
    return `${selectedYear}:${activeYearSprint}`;
  }, [selectedYear, activeYearSprint]);

  const activeSprintRetrospective = useMemo(() => {
    if (!activeSprintRetrospectiveKey) return null;
    return sprintRetrospectiveByKey[activeSprintRetrospectiveKey] ?? null;
  }, [activeSprintRetrospectiveKey, sprintRetrospectiveByKey]);

  /** Per-team docs for the active sprint: keyed by teamId using `"year:sprint:teamId"` storage keys. */
  const activeSprintRetrospectiveByTeam = useMemo((): Record<string, SprintRetrospectiveEntry> => {
    if (!activeSprintRetrospectiveKey) return {};
    const prefix = `${activeSprintRetrospectiveKey}:`;
    const out: Record<string, SprintRetrospectiveEntry> = {};
    for (const [key, value] of Object.entries(sprintRetrospectiveByKey)) {
      if (key.startsWith(prefix)) {
        const teamId = key.slice(prefix.length);
        if (teamId) out[teamId] = value;
      }
    }
    return out;
  }, [activeSprintRetrospectiveKey, sprintRetrospectiveByKey]);

  const saveSprintRetrospective = useCallback(
    (doc: SprintRetrospectiveDoc, teamId?: string) => {
      if (!activeSprintRetrospectiveKey) return;
      const key = teamId ? `${activeSprintRetrospectiveKey}:${teamId}` : activeSprintRetrospectiveKey;
      setSprintRetrospectiveByKey((prev) => ({
        ...prev,
        [key]: {
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
        const sprintTeamFilter = sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId);
        const members = assigneeMatchRosterForSprintTeam(sprintTeamFilter, workspaceDirectoryUsers);
        const cur = prev[activeSprintCapacityKey] ?? emptySprintCapacityBoard(members);
        return {
          ...prev,
          [activeSprintCapacityKey]: {
            capacities: { ...cur.capacities, [member]: Math.max(0, Math.min(10, Number(days) || 0)) },
            assignments: { ...cur.assignments },
          },
        };
      });
    },
    [activeSprintCapacityKey, sprintStoryBoardTeamId, workspaceDirectoryUsers],
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

  const updateStoryDaysLeftFromCapacity = useCallback(async (storyId: string, daysLeft: number) => {
    const nextDaysLeft = Math.max(0, Math.round(Number(daysLeft) || 0));
    flushSync(() => {
      setInitiatives((prev) =>
        prev.map((init) => ({
          ...init,
          epics: (init.epics ?? []).map((epic) => ({
            ...epic,
            userStories: (epic.userStories ?? []).map((story) =>
              story.id === storyId ? { ...story, daysLeft: nextDaysLeft } : story,
            ),
          })),
        })),
      );
    });
    try {
      const response = await fetch(`/api/stories/${storyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daysLeft: nextDaysLeft }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      await refresh();
      toast.error("Failed to update days left");
    }
  }, []);

  const patchStoryFromKanban = useCallback(
    async (
      storyId: string,
      patch: { assignee?: string | null; estimatedDays?: number; daysLeft?: number },
    ) => {
      const body: Record<string, string | number | null> = {};
      if (patch.assignee !== undefined) body.assignee = patch.assignee;
      if (patch.estimatedDays !== undefined) body.estimatedDays = patch.estimatedDays;
      if (patch.daysLeft !== undefined) body.daysLeft = patch.daysLeft;
      if (Object.keys(body).length === 0) return;

      flushSync(() => {
        setInitiatives((prev) =>
          prev.map((init) => ({
            ...init,
            epics: (init.epics ?? []).map((epic) => ({
              ...epic,
              userStories: (epic.userStories ?? []).map((story) =>
                story.id === storyId
                  ? {
                      ...story,
                      ...(patch.assignee !== undefined ? { assignee: patch.assignee } : {}),
                      ...(patch.estimatedDays !== undefined ? { estimatedDays: patch.estimatedDays } : {}),
                      ...(patch.daysLeft !== undefined ? { daysLeft: patch.daysLeft } : {}),
                    }
                  : story,
              ),
            })),
          })),
        );
      });
      try {
        const response = await fetch(`/api/stories/${storyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch {
        await refresh();
        toast.error("Failed to update story");
      }
    },
    [],
  );

  const updateEpicOriginalEstimateFromCapacity = useCallback(async (epicId: string, estimatedDays: number) => {
    /** Epic API validates integer days; normalize inline edits before PATCH. */
    const nextEstimate = Math.max(0, Math.round(Number(estimatedDays) || 0));
    flushSync(() => {
      setInitiatives((prev) =>
        prev.map((init) => ({
          ...init,
          epics: (init.epics ?? []).map((epic) =>
            epic.id === epicId ? { ...epic, originalEstimateDays: nextEstimate } : epic,
          ),
        })),
      );
    });
    try {
      const response = await fetch(`/api/epics/${epicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originalEstimateDays: nextEstimate }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      await refresh();
      toast.error("Failed to update original estimate");
    }
  }, []);

  const stripStoryFromPersistedCapacityAssignments = useCallback((storyId: string) => {
    setSprintCapacityByKey((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([k, board]) => [
          k,
          {
            capacities: { ...board.capacities },
            assignments: Object.fromEntries(
              Object.entries(board.assignments).map(([member, ids]) => [member, ids.filter((id) => id !== storyId)]),
            ),
          },
        ]),
      ),
    );
  }, []);

  /** Capacity card X: clear assignee only; story stays on the sprint (status, labels, etc. unchanged). */
  const clearStoryAssigneeFromSprintCapacity = useCallback(
    async (storyId: string) => {
      stripStoryFromPersistedCapacityAssignments(storyId);
      flushSync(() => {
        setInitiatives((prev) =>
          prev.map((init) => ({
            ...init,
            epics: (init.epics ?? []).map((epic) => ({
              ...epic,
              userStories: (epic.userStories ?? []).map((story) =>
                story.id === storyId ? { ...story, assignee: null } : story,
              ),
            })),
          })),
        );
      });
      try {
        const response = await fetch(`/api/stories/${storyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignee: null }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        toast.success("Assignee cleared");
      } catch {
        await refresh();
        toast.error("Failed to clear assignee");
      }
    },
    [stripStoryFromPersistedCapacityAssignments],
  );

  /** Kanban / confirm dialog: remove story from sprint (same as drag-to-unschedule). */
  const unscheduleStoryFromCapacity = useCallback(async (storyId: string) => {
    stripStoryFromPersistedCapacityAssignments(storyId);
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
  }, [stripStoryFromPersistedCapacityAssignments]);

  async function refresh(targetYear = selectedYear, targetRoadmapId = selectedRoadmapId) {
    const data = await parseJson<InitiativeItem[]>(
      await fetch(`/api/initiatives?year=${targetYear}&roadmapId=${targetRoadmapId}`, { cache: "no-store" }),
    );
    setInitiatives(data);
  }

  async function refreshRoadmaps() {
    const data = await parseJson<RoadmapItem[]>(await fetch("/api/roadmaps", { cache: "no-store" }));
    setRoadmaps(data);
  }

  async function handleCreateRoadmap(name: string, years: number[]) {
    const res = await fetch("/api/roadmaps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, years }),
    });
    if (!res.ok) { toast.error("Failed to create roadmap"); return; }
    const newRoadmap = await parseJson<RoadmapItem>(res);
    setRoadmaps((prev) => [newRoadmap, ...prev]);
    handleSelectRoadmap(newRoadmap.id, newRoadmap.years[0] ?? selectedYear, [newRoadmap]);
  }

  async function createRoadmapQuick(name: string): Promise<string | null> {
    const currentYear = new Date().getFullYear();
    const res = await fetch("/api/roadmaps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, years: [currentYear] }),
    });
    if (!res.ok) { toast.error("Failed to create roadmap"); return null; }
    const newRoadmap = await parseJson<RoadmapItem>(res);
    setRoadmaps((prev) => [...prev, newRoadmap]);
    toast.success(`Roadmap "${name}" created`);
    return newRoadmap.id;
  }

  async function handleRenameRoadmap(id: string, name: string) {
    const res = await fetch(`/api/roadmaps/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) { toast.error("Failed to rename roadmap"); return; }
    const updated = await parseJson<RoadmapItem>(res);
    setRoadmaps((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }

  async function handleAddYearToRoadmap(id: string, yr: number) {
    const res = await fetch(`/api/roadmaps/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addYear: yr }),
    });
    if (!res.ok) { toast.error("Failed to add year to roadmap"); return; }
    const updated = await parseJson<RoadmapItem>(res);
    setRoadmaps((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }

  async function handleRemoveYearFromRoadmap(id: string, yr: number): Promise<{ error?: string }> {
    const res = await fetch(`/api/roadmaps/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeYear: yr }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { message?: string }).message ?? "Cannot remove year" };
    }
    const updated = await parseJson<RoadmapItem>(res);
    setRoadmaps((prev) => prev.map((r) => (r.id === id ? updated : r)));
    if (selectedRoadmapId === id && selectedYear === yr) {
      const newYear = updated.years[0] ?? new Date().getFullYear();
      setSelectedYear(newYear);
      await refresh(newYear, id);
    }
    return {};
  }

  async function handleGetRoadmapCounts(id: string) {
    const res = await fetch(`/api/roadmaps/${id}`, { method: "POST", cache: "no-store" });
    if (!res.ok) return null;
    return res.json() as Promise<{ initiativeCount: number; epicCount: number; storyCount: number; snapshotCount: number }>;
  }

  async function handleDeleteRoadmap(id: string) {
    const res = await fetch(`/api/roadmaps/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to delete roadmap"); return; }
    setRoadmaps((prev) => {
      const remaining = prev.filter((r) => r.id !== id);
      const nextRoadmap = remaining[0] ?? null;
      if (nextRoadmap) {
        const nextYear = nextRoadmap.years[0] ?? new Date().getFullYear();
        handleSelectRoadmap(nextRoadmap.id, nextYear, remaining);
      } else {
        setInitiatives([]);
      }
      return remaining;
    });
  }

  function handleSelectRoadmap(id: string, yr?: number, roadmapList?: RoadmapItem[]) {
    const list = roadmapList ?? roadmaps;
    const roadmap = list.find((r) => r.id === id) ?? null;
    const nextYear = yr ?? (roadmap?.years.includes(selectedYear) ? selectedYear : (roadmap?.years[0] ?? selectedYear));
    setSelectedRoadmapId(id);
    setSelectedYear(nextYear);
    localStorage.setItem(ROADMAP_STORAGE_KEY, id);
    setFocusedQuarterLabel(null);
    setActiveTimelineMonth(null);
    setActiveYearSprint(null);
    setActiveSprintTab("kanban");
    setActiveMonthPlanTab("epic-gantt");
    setActiveQuarterViewTab("gantt");
    setSprintStoryBoardTeamId(null);
    void refresh(nextYear, id);
  }

  /** If an epic is in a month team board queue but `team` is still null, set team from that queue (month / quarter / year capacity). */
  useEffect(() => {
    const desired = new Map<string, string>();
    const conflicted = new Set<string>();
    for (let month = 1; month <= 12; month++) {
      const key = monthTeamBoardStorageKey(selectedYear, month);
      const persisted = monthTeamBoardByKey[key] ?? emptyMonthTeamBoard();
      for (const { epic } of collectMonthEpicsForTeamBoard(initiatives, month)) {
        if (epic.team != null) continue;
        const inferred = inferEpicTeamIdFromMonthTeamQueues(epic.id, persisted);
        if (!inferred) continue;
        if (conflicted.has(epic.id)) continue;
        const cur = desired.get(epic.id);
        if (cur === undefined) desired.set(epic.id, inferred);
        else if (cur !== inferred) {
          conflicted.add(epic.id);
          desired.delete(epic.id);
        }
      }
    }
    if (desired.size === 0) return;

    const updates = [...desired.entries()];

    setInitiatives((prev) =>
      prev.map((i) => ({
        ...i,
        epics: (i.epics ?? []).map((e) => {
          const t = desired.get(e.id);
          return t != null && e.team == null ? { ...e, team: t } : e;
        }),
      })),
    );

    void (async () => {
      for (const [epicId, teamId] of updates) {
        try {
          const response = await fetch(`/api/epics/${epicId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team: teamId }),
          });
          if (!response.ok) throw new Error(String(response.status));
        } catch {
          await refresh();
          toast.error("Failed to save team from board queue");
          return;
        }
      }
    })();
  }, [initiatives, monthTeamBoardByKey, selectedYear]);

  useEffect(() => {
    const now = new Date();
    if (selectedYear !== now.getFullYear()) return;

    const nowMs = now.getTime();
    const inFlight = sprintAutoRolloverInFlightRef.current;
    const candidates: Array<{ storyId: string; fromSprint: number; toSprint: number }> = [];

    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        for (const story of epic.userStories ?? []) {
          if (story.sprint == null) continue;
          if (story.status === StoryStatus.approved) continue;
          if (inFlight.has(story.id)) continue;
          const fromSprint = clampYearSprint(story.sprint);
          if (fromSprint >= YEAR_SPRINT_MAX) continue;
          if (sprintEndDate(selectedYear, fromSprint).getTime() > nowMs) continue;

          // Move to the nearest sprint that has not ended yet (or the final sprint).
          let toSprint = fromSprint + 1;
          while (toSprint < YEAR_SPRINT_MAX && sprintEndDate(selectedYear, toSprint).getTime() <= nowMs) {
            toSprint += 1;
          }
          if (toSprint !== fromSprint) {
            candidates.push({ storyId: story.id, fromSprint, toSprint });
          }
        }
      }
    }

    if (candidates.length === 0) return;

    candidates.forEach((entry) => inFlight.add(entry.storyId));
    let cancelled = false;

    (async () => {
      const results = await Promise.all(
        candidates.map(async (entry) => {
          try {
            const response = await fetch(`/api/stories/${entry.storyId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sprint: entry.toSprint,
                historyEntry: `System auto-move: story moved from Sprint ${entry.fromSprint} to Sprint ${entry.toSprint} after sprint close.`,
              }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return { ok: true as const, entry };
          } catch {
            return { ok: false as const, entry };
          }
        }),
      );

      results.forEach(({ entry }) => inFlight.delete(entry.storyId));
      if (cancelled) return;

      const movedCount = results.filter((row) => row.ok).length;
      const failedCount = results.length - movedCount;

      if (movedCount > 0) {
        await refresh(selectedYear);
        toast.success(`Moved ${movedCount} non-approved ticket${movedCount === 1 ? "" : "s"} to the next sprint.`);
      }
      if (failedCount > 0) {
        toast.error(`Failed to move ${failedCount} ticket${failedCount === 1 ? "" : "s"} to the next sprint.`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initiatives, selectedYear]);

  const [deleteInitiativeTarget, setDeleteInitiativeTarget] = useState<InitiativeItem | null>(null);
  const [deletingInitiative, setDeletingInitiative] = useState(false);

  function requestDeleteInitiative(id: string) {
    const initiative = initiatives.find((i) => i.id === id);
    if (initiative) setDeleteInitiativeTarget(initiative);
  }

  async function confirmDeleteInitiative() {
    if (!deleteInitiativeTarget) return;
    setDeletingInitiative(true);
    await fetch(`/api/initiatives/${deleteInitiativeTarget.id}`, { method: "DELETE" });
    setDeletingInitiative(false);
    setDeleteInitiativeTarget(null);
    await refresh();
  }

  const [deleteEpicTarget, setDeleteEpicTarget] = useState<EpicItem | null>(null);
  const [deletingEpic, setDeletingEpic] = useState(false);

  function requestDeleteEpic(id: string) {
    for (const initiative of initiatives) {
      const epic = (initiative.epics ?? []).find((e) => e.id === id);
      if (epic) { setDeleteEpicTarget(epic); return; }
    }
  }

  async function confirmDeleteEpic() {
    if (!deleteEpicTarget) return;
    setDeletingEpic(true);
    await fetch(`/api/epics/${deleteEpicTarget.id}`, { method: "DELETE" });
    setDeletingEpic(false);
    setDeleteEpicTarget(null);
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
          body: JSON.stringify({ ...payload, year: selectedYear, roadmapId: selectedRoadmapId }),
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
    const epicId = editingEpic?.id;
    if (epicId && payload.team === null) {
      setMonthTeamBoardByKey((prev) => {
        const next = { ...prev };
        for (let m = 1; m <= 12; m++) {
          const key = monthTeamBoardStorageKey(selectedYear, m);
          next[key] = removeEpicFromMonthTeamBoardQueues(prev[key] ?? { queues: {} }, epicId);
        }
        return next;
      });
    }
    const request = epicId
      ? fetch(`/api/epics/${epicId}`, {
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

  async function createInitiativeQuick(title: string): Promise<string> {
    const response = await fetch("/api/initiatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, year: selectedYear, roadmapId: selectedRoadmapId }),
    });
    if (!response.ok) {
      throw new Error("Failed to create initiative");
    }
    const created = (await response.json()) as { id: string };
    await refresh();
    return created.id;
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
    payload: { planSprint: number; planEndSprint: number; planStartMonth: number; planEndMonth: number; timelineRow?: number; planStartDay?: number | null; planEndDay?: number | null },
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
    if (team === null) {
      setMonthTeamBoardByKey((prev) => {
        const next = { ...prev };
        for (let m = 1; m <= 12; m++) {
          const key = monthTeamBoardStorageKey(selectedYear, m);
          const cur = prev[key] ?? { queues: {} };
          next[key] = removeEpicFromMonthTeamBoardQueues(cur, epicId);
        }
        return next;
      });
      setInitiatives((prev) =>
        prev.map((i) => ({
          ...i,
          epics: (i.epics ?? []).map((e) => (e.id === epicId ? { ...e, team: null } : e)),
        })),
      );
    }
    const response = await fetch(`/api/epics/${epicId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team }),
    });
    if (!response.ok) {
      throw new Error("Failed to update epic team");
    }
    if (team !== null) {
      await refresh();
    }
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
    const inspectorSteps: string[] = [];
    const step = (m: string) => {
      inspectorSteps.push(m);
    };
    let outcomeBranch = "unhandled";
    let outcomeDetail: Record<string, unknown> = {};
    const record = (branch: string, extra?: Record<string, unknown>) => {
      outcomeBranch = branch;
      if (extra && Object.keys(extra).length > 0) {
        outcomeDetail = { ...outcomeDetail, ...extra };
      }
    };

    try {
      step("onDragEnd");
      console.info("[gantt-drop] app onDragEnd", { activeId, overId });

      const capColDrag = parseSprintCapacityColumnDragId(activeId);
      const capColDrop = parseSprintCapacityColumnDropId(overId);
      if (capColDrag && capColDrop) {
        step("capacity-column-reorder");
        if (isActiveSprintClosed) {
          record("capcol:blocked-closed", {});
          toast.message("Sprint is closed. Drag and drop is disabled.");
          return;
        }
        if (capColDrag.yearSprint !== capColDrop.yearSprint || capColDrag.teamKey !== capColDrop.teamKey) {
          record("capcol:cross-target", { capColDrag, capColDrop });
          return;
        }
        const dropTeamId = capColDrag.teamKey === "all" ? null : capColDrag.teamKey.trim() || null;
        const boardKey = sprintCapacityBoardKey(selectedYear, capColDrag.yearSprint, dropTeamId);
        setSprintCapacityByKey((prev) => {
          const cur = prev[boardKey];
          if (!cur) return prev;
          const keySet = new Set([
            ...Object.keys(cur.assignments ?? {}),
            ...Object.keys(cur.capacities ?? {}),
          ]);
          keySet.delete(SPRINT_CAPACITY_OTHER_BUCKET);
          const sortedFallback = [...keySet].sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" }),
          );
          const peopleOnly = orderedSprintCapacityMembers({
            columnOrder: cur.columnOrder,
            sortedPeopleCols: sortedFallback,
            needsOtherColumn: false,
          });
          const nextPeople = reorderSprintCapacityPeopleOrder(peopleOnly, capColDrag.member, capColDrop.member);
          if (!nextPeople) return prev;
          return { ...prev, [boardKey]: { ...cur, columnOrder: nextPeople } };
        });
        record("capcol:reorder", { boardKey, from: capColDrag.member, to: capColDrop.member });
        return;
      }

      const mCapColDrag = parseMonthTeamCapacityColumnDragId(activeId);
      const mCapColDrop = parseMonthTeamCapacityColumnDropId(overId);
      if (mCapColDrag && mCapColDrop) {
        step("month-capacity-column-reorder");
        if (mCapColDrag.year !== selectedYear || mCapColDrop.year !== selectedYear) {
          record("m-cap-col:wrong-year", { mCapColDrag, mCapColDrop, selectedYear });
          return;
        }
        if (mCapColDrag.month !== mCapColDrop.month || mCapColDrag.year !== mCapColDrop.year) {
          record("m-cap-col:cross-target", { mCapColDrag, mCapColDrop });
          return;
        }
        const boardKey = monthTeamCapacityBoardKey(mCapColDrag.year, mCapColDrag.month);
        setMonthTeamCapacityByKey((prev) => {
          const cur = prev[boardKey] ?? emptyMonthTeamCapacityBoard();
          const fullOrder = fullMonthTeamCapacityColumnOrder(cur.columnOrder);
          const nextOrder = reorderMonthTeamCapacityColumnOrder(fullOrder, mCapColDrag.teamId, mCapColDrop.teamId);
          if (!nextOrder) return prev;
          return { ...prev, [boardKey]: { ...cur, columnOrder: nextOrder } };
        });
        record("m-cap-col:reorder", { boardKey, from: mCapColDrag.teamId, to: mCapColDrop.teamId });
        return;
      }

      const qCapColDrag = parseQuarterTeamCapacityColumnDragId(activeId);
      const qCapColDrop = parseQuarterTeamCapacityColumnDropId(overId);
      if (qCapColDrag && qCapColDrop) {
        step("quarter-capacity-column-reorder");
        if (qCapColDrag.year !== selectedYear || qCapColDrop.year !== selectedYear) {
          record("q-cap-col:wrong-year", { qCapColDrag, qCapColDrop, selectedYear });
          return;
        }
        if (qCapColDrag.quarterLabel !== qCapColDrop.quarterLabel) {
          record("q-cap-col:cross-quarter", { qCapColDrag, qCapColDrop });
          return;
        }
        const quarterMonths: readonly number[] | undefined =
          qCapColDrag.quarterLabel === ALL_QUARTERS_TEAM_CAPACITY_LABEL
            ? ALL_YEAR_PLAN_MONTHS
            : QUARTERS.find((item) => item.label === qCapColDrag.quarterLabel)?.months;
        if (!quarterMonths?.length) {
          record("q-cap-col:bad-label", { quarterLabel: qCapColDrag.quarterLabel });
          return;
        }
        setMonthTeamCapacityByKey((prev) => {
          let scopeColumnOrder: string[] | undefined;
          for (const m of quarterMonths) {
            const ord = prev[monthTeamCapacityBoardKey(qCapColDrag.year, m)]?.columnOrder;
            if (ord?.length) {
              scopeColumnOrder = ord;
              break;
            }
          }
          const fullOrder = fullMonthTeamCapacityColumnOrder(scopeColumnOrder);
          const nextOrder = reorderMonthTeamCapacityColumnOrder(fullOrder, qCapColDrag.teamId, qCapColDrop.teamId);
          if (!nextOrder) return prev;
          let next = { ...prev };
          for (const m of quarterMonths) {
            const bk = monthTeamCapacityBoardKey(qCapColDrag.year, m);
            const cur = next[bk] ?? emptyMonthTeamCapacityBoard();
            next = { ...next, [bk]: { ...cur, columnOrder: nextOrder } };
          }
          return next;
        });
        record("q-cap-col:reorder", {
          quarterLabel: qCapColDrag.quarterLabel,
          from: qCapColDrag.teamId,
          to: qCapColDrop.teamId,
        });
        return;
      }

      if (isStoryDraggableId(activeId)) {
        step("story-branch");
        const storyId = parseStoryIdFromDraggable(activeId);
        if (!storyId) {
          record("story:bad-draggable-id", { activeId });
          return;
        }
        if (isActiveSprintClosed) {
          record("story:blocked-closed-sprint", { storyId, activeYearSprint });
          toast.message("Sprint is closed. Drag and drop is disabled.");
          return;
        }

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
          record("story:unschedule-ok", { storyId });
        } catch (err) {
          console.error("[story-move] unschedule drop failed", {
            storyId,
            overId,
            cause: err instanceof Error ? err.message : String(err),
          });
          record("story:unschedule-failed", {
            storyId,
            cause: err instanceof Error ? err.message : String(err),
          });
          await refresh();
          toast.error("Failed to clear sprint on story");
        }
        return;
      }

      const capacityDrop = parseSprintCapacityBucketDropId(overId);
      if (capacityDrop) {
        if (capacityDrop.yearSprint !== activeYearSprint) {
          record("story:capacity-sprint-mismatch", {
            storyId,
            dropYearSprint: capacityDrop.yearSprint,
            activeYearSprint,
          });
          return;
        }
        const dropTeamId = capacityDrop.teamKey?.trim() ? capacityDrop.teamKey.trim() : null;
        const boardKey = sprintCapacityBoardKey(selectedYear, capacityDrop.yearSprint, dropTeamId);
        setSprintCapacityByKey((prev) => {
          const roster = assigneeMatchRosterForSprintTeam(dropTeamId, workspaceDirectoryUsers);
          const cur = prev[boardKey] ?? emptySprintCapacityBoard(roster);
          return { ...prev, [boardKey]: assignStoryToMember(cur, storyId, capacityDrop.member) };
        });
        const skipAssigneePatch = capacityDrop.member === SPRINT_CAPACITY_OTHER_BUCKET;
        if (!skipAssigneePatch) {
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
        } else {
          flushSync(() => {
            setInitiatives((prev) =>
              prev.map((init) => ({
                ...init,
                epics: (init.epics ?? []).map((epic) => ({
                  ...epic,
                  userStories: (epic.userStories ?? []).map((s) =>
                    s.id === storyId ? { ...s, sprint: capacityDrop.yearSprint } : s,
                  ),
                })),
              })),
            );
          });
        }
        try {
          const patchBody = skipAssigneePatch
            ? { sprint: capacityDrop.yearSprint }
            : { assignee: capacityDrop.member, sprint: capacityDrop.yearSprint };
          const response = await fetch(`/api/stories/${storyId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patchBody),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          toast.success(
            skipAssigneePatch ? "Story placed in Other assignees (assignee unchanged)" : `Assigned to ${capacityDrop.member}`,
          );
          record("story:capacity", {
            storyId,
            skipAssigneePatch,
            yearSprint: capacityDrop.yearSprint,
            member: capacityDrop.member,
            teamKey: capacityDrop.teamKey,
          });
        } catch {
          record("story:capacity-patch-failed", { storyId, capacityDrop });
          await refresh();
          toast.error("Failed to assign story");
        }
        return;
      }

      const sprintSlot = parseSprintCapacitySlotDropId(overId);
      if (sprintSlot && storyId) {
        if (sprintSlot.yearSprint !== activeYearSprint) return;
        const dropTeamId = sprintSlot.teamKey?.trim() ? sprintSlot.teamKey.trim() : null;
        const boardKey = sprintCapacityBoardKey(selectedYear, sprintSlot.yearSprint, dropTeamId);
        setSprintCapacityByKey((prev) => {
          const board = prev[boardKey];
          if (!board) return prev;
          const targetList = (board.assignments[sprintSlot.member] ?? []).filter((id) => id !== storyId);
          const insertIndex = Math.max(0, targetList.length - sprintSlot.index);
          return { ...prev, [boardKey]: moveStoryInMemberBucket(board, storyId, sprintSlot.member, insertIndex) };
        });
        return;
      }

      /** Gantt month / half-month cells (same targets as epic plan drops). */
      let storyPlanMonth: number | null = null;
      let storyPlanLane: 1 | 2 | null = null;
      const storyEpicCell = /^epic-plan:(\d+):([12])$/.exec(overId);
      if (storyEpicCell) {
        storyPlanMonth = Number(storyEpicCell[1]);
        storyPlanLane = Number(storyEpicCell[2]) as 1 | 2;
      } else if (overId.startsWith("month:")) {
        const parsed = parseMonthDropTarget(overId);
        if (parsed) {
          storyPlanMonth = parsed.month;
          storyPlanLane = 1;
          const cx = clientXLeadingEdgeFromDragEnd(event);
          const overRect = event.over?.rect;
          if (
            cx !== undefined &&
            overRect &&
            Number.isFinite(overRect.left) &&
            Number.isFinite(overRect.width) &&
            overRect.width > 0
          ) {
            const midpoint = overRect.left + overRect.width / 2;
            storyPlanLane = cx >= midpoint ? 2 : 1;
          }
        }
      }
      if (storyPlanMonth != null && storyPlanLane != null) {
        const yearSprint = globalSprintFromMonthLane(storyPlanMonth, storyPlanLane);
        console.log("[gantt-drop] story plan cell drop", {
          storyId,
          overId,
          storyPlanMonth,
          storyPlanLane,
          yearSprint,
        });
        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((init) => ({
              ...init,
              epics: (init.epics ?? []).map((epic) => ({
                ...epic,
                userStories: (epic.userStories ?? []).map((s) =>
                  s.id === storyId ? { ...s, sprint: yearSprint } : s,
                ),
              })),
            })),
          );
        });
        try {
          const response = await fetch(`/api/stories/${storyId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sprint: yearSprint }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          toast.success("Story placed on sprint");
          record("story:plan-cell", {
            storyId,
            storyPlanMonth,
            storyPlanLane,
            yearSprint,
            overId,
          });
        } catch (err) {
          console.error("[story-move] plan cell drop failed", {
            storyId,
            yearSprint,
            overId,
            cause: err instanceof Error ? err.message : String(err),
          });
          record("story:plan-cell-failed", {
            storyId,
            yearSprint,
            overId,
            cause: err instanceof Error ? err.message : String(err),
          });
          await refresh();
          toast.error("Failed to schedule story on sprint");
        }
        return;
      }

      if (
        overId.startsWith("story:board:") &&
        activeYearSprint != null &&
        sprintCapacityPlanMonth != null
      ) {
        const overStoryId = parseStoryIdFromDraggable(overId);
        if (overStoryId && overStoryId !== storyId) {
          const teamFilter = sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId);
          const boardRows = collectStoriesForSprintBoard(
            initiatives,
            sprintCapacityPlanMonth,
            activeYearSprint,
            teamFilter ? [teamFilter] : null,
          );
          const patches = computeKanbanStoryReorderPatches({
            boardRows,
            activeStoryId: storyId,
            overStoryId,
            targetSprint: activeYearSprint,
          });
          if (patches != null) {
            if (patches.length === 0) {
              record("story:kanban-reorder-noop", { storyId, overStoryId });
              return;
            }
            flushSync(() => {
              setInitiatives((prev) => applyKanbanOrderPatchesToInitiatives(prev, patches));
            });
            try {
              /** SQLite + Prisma: parallel PATCHes often hit SQLITE_BUSY / 500; apply in series. */
              for (const p of patches) {
                const res = await fetch(`/api/stories/${p.storyId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    backlogOrder: p.backlogOrder,
                    ...(p.status !== undefined ? { status: p.status } : {}),
                    ...(p.sprint !== undefined ? { sprint: p.sprint } : {}),
                  }),
                });
                if (!res.ok) {
                  const body = await res.text().catch(() => "");
                  throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 500)}` : ""}`);
                }
              }
              toast.success("Story updated");
              record("story:kanban-reorder", { storyId, overStoryId, patchCount: patches.length });
            } catch (err) {
              console.error("[story-move] kanban reorder failed", {
                storyId,
                overStoryId,
                cause: err instanceof Error ? err.message : String(err),
              });
              record("story:kanban-reorder-failed", {
                storyId,
                overStoryId,
                cause: err instanceof Error ? err.message : String(err),
              });
              await refresh();
              toast.error("Failed to reorder story");
            }
            return;
          }
        }
      }

      const kanbanMatch = /^kanban:(\d+):(todo|inProgress|done|approved)$/.exec(overId);
      if (!kanbanMatch) {
        console.warn("[gantt-drop] story drag: unsupported drop target", { activeId, overId });
        record("story:unsupported-target", { storyId, activeId, overId });
        toast.message("That target does not accept user stories. Try a sprint column or plan cell.");
        return;
      }
      const sprint = clampYearSprint(Number(kanbanMatch[1]));
      // Group 1 = year sprint; group 2 = status (there is no third capture).
      const status = kanbanMatch[2] as StoryStatus;
      const nextStatus = status;

      const teamFilter = sprintStoryBoardEpicTeamFilter(sprintStoryBoardTeamId);
      const monthForBoard = sprintCapacityPlanMonth;
      let collectRows = 0;
      let storyInCollectRows = false;
      if (monthForBoard != null) {
        const patchedInitiatives = initiatives.map((init) => ({
          ...init,
          epics: (init.epics ?? []).map((epic) => ({
            ...epic,
            userStories: (epic.userStories ?? []).map((s) =>
              s.id === storyId ? { ...s, status: nextStatus, sprint } : s,
            ),
          })),
        }));
        const rows = collectStoriesForSprintBoard(patchedInitiatives, monthForBoard, sprint, teamFilter ? [teamFilter] : null);
        collectRows = rows.length;
        storyInCollectRows = rows.some((r) => r.story.id === storyId);
      }

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
        record("story:kanban", {
          storyId,
          sprint,
          nextStatus,
          overId,
          monthForBoard,
          sprintCapacityPlanMonth,
          activeTimelineMonth,
          activeYearSprint,
          monthLaneFromDropSprint: monthLaneFromGlobalSprint(sprint),
          teamFilter,
          collectRows,
          storyInCollectRows,
        });
      } catch (err) {
        console.error("[story-move] kanban drop failed", {
          storyId,
          nextStatus,
          sprint,
          overId,
          cause: err instanceof Error ? err.message : String(err),
        });
        record("story:kanban-patch-failed", {
          storyId,
          nextStatus,
          sprint,
          overId,
          monthForBoard,
          teamFilter,
          collectRows,
          storyInCollectRows,
          cause: err instanceof Error ? err.message : String(err),
        });
        await refresh();
        toast.error("Failed to move story");
      }
      return;
    }

    if (isEpicPlanDraggableId(activeId)) {
      step("epic-branch");
      const epicId = parseEpicIdFromPlanDraggable(activeId);
      if (!epicId) {
        console.log("[gantt-drop] epic branch: no epicId", { activeId });
        record("epic:no-epic-id", { activeId, overId });
        return;
      }
      console.log("[gantt-drop] epic branch", { epicId, overId });
      record("epic:handling", { epicId, overId });

      if (
        !overId &&
        activeTimelineMonth != null &&
        activeMonthPlanTab !== "epic-gantt"
      ) {
        toast.message("Switch to Epic Plan to move this epic on the timeline.");
        record("epic:no-over-non-gantt-month", { epicId });
        return;
      }

      const teamCapacityDrop = parseMonthTeamCapacityBucketDropId(overId);
      if (teamCapacityDrop) {
        if (!MONTH_TEAM_IDS.includes(teamCapacityDrop.teamId)) {
          record("epic:month-team-capacity-invalid-team", { epicId, teamId: teamCapacityDrop.teamId });
          return;
        }
        if (teamCapacityDrop.year !== selectedYear) {
          record("epic:month-team-capacity-wrong-year", { epicId, dropYear: teamCapacityDrop.year, selectedYear });
          toast.message("Switch the roadmap year to update that month’s team capacity.");
          return;
        }
        const month = teamCapacityDrop.month;
        const inMonth = collectMonthEpicsForTeamBoard(initiatives, month).some((c) => c.epic.id === epicId);
        if (!inMonth) {
          record("epic:month-team-capacity-epic-not-in-month", { epicId, month });
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
          record("epic:month-team-capacity-saved", { epicId, teamId: teamCapacityDrop.teamId });
        } catch {
          record("epic:month-team-capacity-patch-failed", { epicId });
          await refresh();
          toast.error("Failed to save team");
        }
        return;
      }

      const quarterCapacityDrop = parseQuarterTeamCapacityBucketDropId(overId);
      if (quarterCapacityDrop) {
        if (!MONTH_TEAM_IDS.includes(quarterCapacityDrop.teamId)) {
          record("epic:quarter-team-capacity-invalid-team", { epicId, teamId: quarterCapacityDrop.teamId });
          return;
        }
        if (quarterCapacityDrop.year !== selectedYear) {
          record("epic:quarter-team-capacity-wrong-year", { epicId, dropYear: quarterCapacityDrop.year, selectedYear });
          toast.message("Switch the roadmap year to update that quarter’s team capacity.");
          return;
        }
        const quarterMonths: readonly number[] | undefined =
          quarterCapacityDrop.quarterLabel === ALL_QUARTERS_TEAM_CAPACITY_LABEL
            ? ALL_YEAR_PLAN_MONTHS
            : QUARTERS.find((item) => item.label === quarterCapacityDrop.quarterLabel)?.months;
        if (!quarterMonths?.length) {
          console.warn("[gantt-drop] quarter capacity: unknown quarter label", quarterCapacityDrop.quarterLabel);
          record("epic:quarter-team-capacity-bad-label", { epicId, quarterLabel: quarterCapacityDrop.quarterLabel });
          toast.message("Could not resolve this capacity board’s quarter.");
          return;
        }
        const inQuarter = collectQuarterEpics(initiatives, quarterMonths).some((c) => c.epic.id === epicId);
        if (!inQuarter) {
          record("epic:quarter-team-capacity-epic-not-in-quarter", { epicId });
          toast.message("Only epics tied to this quarter can be assigned to team capacity.");
          return;
        }
        const targetMonth =
          quarterMonths.find((m) => collectMonthEpicsForTeamBoard(initiatives, m).some((c) => c.epic.id === epicId)) ??
          quarterMonths[0]!;
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
          record("epic:quarter-team-capacity-saved", { epicId, teamId: quarterCapacityDrop.teamId });
        } catch {
          record("epic:quarter-team-capacity-patch-failed", { epicId });
          await refresh();
          toast.error("Failed to save team");
        }
        return;
      }

      const teamSlot = parseMonthTeamSlotDropId(overId);
      if (teamSlot) {
        if (teamSlot.year !== selectedYear) {
          record("epic:month-team-slot-wrong-year", { epicId, dropYear: teamSlot.year, selectedYear });
          toast.message("Switch the roadmap year to update that month’s team board.");
          return;
        }
        const inMonth = collectMonthEpicsForTeamBoard(initiatives, teamSlot.month).some((c) => c.epic.id === epicId);
        if (!inMonth) {
          record("epic:month-team-slot-epic-not-in-month", { epicId, month: teamSlot.month });
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
          record("epic:month-team-slot-saved", { epicId, teamId: teamSlot.teamId, index: teamSlot.index });
        } catch (err) {
          record("epic:month-team-slot-patch-failed", { epicId });
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
        if (!initiative || !epic) {
          record("epic:month-kanban-todo-missing-epic", { epicId });
          return;
        }
        const storyIds = (epic.userStories ?? []).map((s) => s.id);
        if (storyIds.length === 0) {
          record("epic:month-kanban-todo-no-stories", { epicId });
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
          record("epic:month-kanban-all-todo", { epicId, storyCount: storyIds.length });
        } catch {
          record("epic:month-kanban-all-todo-failed", { epicId });
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
        if (!initiative || !epic) {
          record("epic:sprint-kanban-bulk-missing-epic", { epicId });
          return;
        }
        const storyIds = (epic.userStories ?? []).map((s) => s.id);
        if (storyIds.length === 0) {
          record("epic:sprint-kanban-bulk-no-stories", { epicId });
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
          record("epic:sprint-kanban-bulk-todo", { epicId, sprint, storyCount: storyIds.length });
        } catch {
          record("epic:sprint-kanban-bulk-failed", { epicId, sprint });
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
        if (isEpicTimelineDraggableId(activeId)) {
          toast.message(
            "Epics on the roadmap can’t be dragged back to the list. Open the epic to clear its plan if needed.",
          );
          record("epic:unplan-blocked-timeline-source", { epicId, overId });
          return;
        }
        const initiative = initiatives.find((i) => (i.epics ?? []).some((e) => e.id === epicId));
        const epic = initiative?.epics?.find((e) => e.id === epicId);
        if (!initiative || !epic) {
          record("epic:unplan-missing-epic", { epicId });
          return;
        }
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
        if (isAlreadyBacklog) {
          record("epic:unplan-already-backlog", { epicId });
          return;
        }

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
          record("epic:unplan-ok", { epicId, epicBacklogSlot });
        } catch (err) {
          record("epic:unplan-failed", {
            epicId,
            cause: err instanceof Error ? err.message : String(err),
          });
          await refresh();
          const description = err instanceof Error ? err.message : undefined;
          toast.error("Failed to update epic placement", description ? { description } : undefined);
        }
        return;
      }

      let month: number;
      let planSprint: 1 | 2;
      let planStartDay: number | null = null;
      let laneIndex: number | undefined;
      const dayCell = /^epic-plan-day:(\d+):(\d+)$/.exec(overId);
      const epicCell = /^epic-plan:(\d+):([12])$/.exec(overId);
      if (dayCell) {
        month = Number(dayCell[1]);
        const day = Number(dayCell[2]);
        planSprint = day <= 15 ? 1 : 2;
        planStartDay = day;
        laneIndex = undefined;
      } else if (epicCell) {
        month = Number(epicCell[1]);
        const lane = Number(epicCell[2]) as 1 | 2;
        planSprint = lane;
        laneIndex = undefined;
      } else if (overId.startsWith("month:")) {
        const parsed = parseMonthDropTarget(overId);
        if (!parsed) {
          console.log("[gantt-drop] epic month drop: parse failed", { overId });
          record("epic:gantt-month-parse-failed", { epicId, overId });
          return;
        }
        month = parsed.month;
        planSprint = 1;
        const cx = clientXLeadingEdgeFromDragEnd(event);
        const overRect = event.over?.rect;
        if (
          cx !== undefined &&
          overRect &&
          Number.isFinite(overRect.left) &&
          Number.isFinite(overRect.width) &&
          overRect.width > 0
        ) {
          const midpoint = overRect.left + overRect.width / 2;
          planSprint = cx >= midpoint ? 2 : 1;
        }
        laneIndex = parsed.laneIndex;
        console.log("[gantt-drop] epic month drop parsed", { month, laneIndex, planSprint });
      } else {
        console.log("[gantt-drop] epic branch: overId not epic-plan or month", { overId });
        record("epic:gantt-unknown-target", { epicId, overId });
        if (activeTimelineMonth != null && activeMonthPlanTab !== "epic-gantt") {
          toast.message("Switch to Epic Plan to move this epic on the timeline.");
        }
        return;
      }
      if (!Number.isFinite(month)) {
        console.log("[gantt-drop] epic branch: invalid month", { month });
        record("epic:gantt-invalid-month", { epicId, month });
        return;
      }

      const before = initiatives;
      const currentInit = before.find((i) => (i.epics ?? []).some((e) => e.id === epicId));
      const currentEpic = currentInit?.epics?.find((e) => e.id === epicId);
      if (!currentInit || !currentEpic) {
        record("epic:gantt-missing-epic", { epicId });
        return;
      }

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
      // If a specific start day was picked, stamp it onto the placed epic before committing to state.
      const patchedNext = planStartDay != null
        ? placementNext.map((init) => ({
            ...init,
            epics: (init.epics ?? []).map((e) =>
              e.id === epicId ? { ...e, planStartDay } : e,
            ),
          }))
        : placementNext;
      flushSync(() => setInitiatives(patchedNext));
      const updatedEpic =
        patchedNext.flatMap((i) => i.epics ?? []).find((e) => e.id === epicId) ?? null;

      try {
        const planPatch: Parameters<typeof patchEpicQuarterPlan>[1] = {
          planSprint,
          planEndSprint: updatedEpic?.planEndSprint ?? 2,
          planStartMonth: updatedEpic?.planStartMonth ?? month,
          planEndMonth: updatedEpic?.planEndMonth ?? month,
        };
        if (planStartDay != null) planPatch.planStartDay = planStartDay;
        if (rowsChanged) {
          planPatch.timelineRow =
            movedTimelineRow ??
            (Number.isFinite(updatedEpic?.timelineRow) ? updatedEpic!.timelineRow : 0);
        }
        await patchEpicQuarterPlan(epicId, planPatch);
        if (rowsChanged) {
          await persistEpicTimelineRowPatches(before, placementNext);
        }
        toast.success("Epic placed on the plan");
        flashGanttEpicEmphasis(epicId);
        record("epic:gantt-month-placed", { epicId, month, planSprint, laneIndex, rowsChanged, movedTimelineRow });
      } catch (err) {
        record("epic:gantt-month-failed", {
          epicId,
          month,
          cause: err instanceof Error ? err.message : String(err),
        });
        await refresh();
        const description = err instanceof Error ? err.message : undefined;
        toast.error("Failed to place epic", description ? { description } : undefined);
      }
      return;
    }

    if (!isInitiativeDraggableId(activeId)) {
      console.log("[gantt-drop] no handler for activeId (not initiative)", { activeId, overId });
      record("no-handler", { activeId, overId });
      return;
    }

    step("initiative-branch");
    const initiativeId = parseInitiativeIdFromDraggable(activeId);
    if (!initiativeId) {
      record("initiative:bad-id", { activeId });
      return;
    }

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
        record("initiative:backlog", { initiativeId, wasScheduled });
      } catch {
        record("initiative:backlog-failed", { initiativeId });
        await refresh();
        toast.error("Failed to update backlog placement");
      }
      return;
    }

    if (!overId.startsWith("month:")) {
      console.log("[gantt-drop] initiative: overId not month:*", { overId });
      record("initiative:not-month-target", { initiativeId, overId });
      return;
    }

    const parsedDrop = parseMonthDropTarget(overId);
    if (!parsedDrop) {
      console.log("[gantt-drop] initiative: parseMonthDropTarget null", { overId });
      record("initiative:month-parse-failed", { initiativeId, overId });
      return;
    }
    const { month, laneIndex: laneFromTarget } = parsedDrop;
    if (!Number.isFinite(month)) {
      console.log("[gantt-drop] initiative: bad month", { month });
      record("initiative:bad-month", { initiativeId, month });
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
      record("initiative:not-found", { initiativeId });
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
        record("initiative:scheduled-first-time", {
          initiativeId,
          month,
          laneIndex,
          rowsChanged,
          movedTimelineRow,
        });
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
        record("initiative:rescheduled", {
          initiativeId,
          month,
          ...range,
          rowsChanged,
          movedTimelineRow,
        });
      }
    } catch {
      record("initiative:schedule-failed", { initiativeId, month });
      await refresh();
      toast.error("Failed to schedule initiative");
    }
  } finally {
      if (DND_DROP_INSPECTOR_SUPPRESS_BRANCHES.has(outcomeBranch)) {
        setDndDropInspector(null);
      } else {
        setDndDropInspector({
          at: new Date().toLocaleTimeString(),
          activeId,
          overId: overId || "(none)",
          delta: { x: event.delta?.x ?? 0, y: event.delta?.y ?? 0 },
          planner: {
            activeTimelineMonth,
            activeYearSprint,
            sprintCapacityPlanMonth,
            activeMonthPlanTab,
            isActiveSprintClosed,
            sprintStoryBoardTeamId,
            selectedYear,
            focusedQuarterLabel,
          },
          branch: outcomeBranch,
          detail: outcomeDetail,
          steps: inspectorSteps,
        });
      }
  }
  }

  useEffect(() => {
    if (!isResizingPanel) return;

    function onMouseMove(event: MouseEvent) {
      if (!layoutRef.current) return;
      const layoutBounds = layoutRef.current.getBoundingClientRect();
      const proposedWidth = event.clientX - layoutBounds.left - 6;
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

  useEffect(() => {
    if (isLeftPanelHidden && isResizingPanel) {
      setIsResizingPanel(false);
    }
  }, [isLeftPanelHidden, isResizingPanel]);

  const [isModeRailExpanded, setIsModeRailExpanded] = useState(false);
  const [summaryBarEl, setSummaryBarEl] = useState<HTMLElement | null>(null);
  const modeRailLabelClass =
    "min-w-0 flex-1 truncate text-left text-[15px] font-semibold leading-snug";
  /** Right mode rail only (Roadmap / Backlog / Users). Flat indigo active — separate from timeline toolbar chips. */
  const modeRailActiveClass = "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200";

  const modeSwitchMenu = (
    <aside className="relative z-20 flex h-full min-h-0 w-full flex-col overflow-visible">
      <nav className={cn("flex w-full flex-col gap-1.5 overflow-visible", isModeRailExpanded ? "p-1.5" : "p-1")}>
        <div className="group relative w-full overflow-visible">
          <button
            type="button"
            onClick={() => setTopMode("roadmap")}
            aria-label="Roadmap Planning"
            className={cn(
              "inline-flex h-11 w-full items-center rounded-lg transition-all duration-200",
              isModeRailExpanded ? "justify-start gap-0.5 px-2.5" : "justify-center px-0",
              topMode === "roadmap"
                ? modeRailActiveClass
                : "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <span
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                topMode === "roadmap" ? "text-indigo-700" : "text-slate-500 group-hover:text-indigo-700",
              )}
              aria-hidden
              onMouseEnter={() => setIsModeRailExpanded(true)}
            >
              <MapIcon className="size-4" aria-hidden />
            </span>
            <span
              className={cn(
                modeRailLabelClass,
                "overflow-hidden transition-[max-width,opacity,margin] duration-200",
                isModeRailExpanded ? "ml-0 max-w-[12rem] opacity-100" : "ml-0 max-w-0 opacity-0",
              )}
              aria-hidden={!isModeRailExpanded}
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
              "inline-flex h-11 w-full items-center rounded-lg transition-all duration-200",
              isModeRailExpanded ? "justify-start gap-0.5 px-2.5" : "justify-center px-0",
              topMode === "backlog"
                ? modeRailActiveClass
                : "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <span
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                topMode === "backlog" ? "text-indigo-700" : "text-slate-500 group-hover:text-indigo-700",
              )}
              aria-hidden
              onMouseEnter={() => setIsModeRailExpanded(true)}
            >
              <Archive className="size-4" aria-hidden />
            </span>
            <span
              className={cn(
                modeRailLabelClass,
                "overflow-hidden transition-[max-width,opacity,margin] duration-200",
                isModeRailExpanded ? "ml-0 max-w-[12rem] opacity-100" : "ml-0 max-w-0 opacity-0",
              )}
              aria-hidden={!isModeRailExpanded}
            >
              Backlog Workspace
            </span>
          </button>
        </div>
        <div className="group relative w-full overflow-visible">
          <button
            type="button"
            onClick={() => setTopMode("dashboard")}
            aria-label="Dashboard"
            className={cn(
              "inline-flex h-11 w-full items-center rounded-lg transition-all duration-200",
              isModeRailExpanded ? "justify-start gap-0.5 px-2.5" : "justify-center px-0",
              topMode === "dashboard"
                ? modeRailActiveClass
                : "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <span
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                topMode === "dashboard" ? "text-indigo-700" : "text-slate-500 group-hover:text-indigo-700",
              )}
              aria-hidden
              onMouseEnter={() => setIsModeRailExpanded(true)}
            >
              <LayoutDashboard className="size-4" aria-hidden />
            </span>
            <span
              className={cn(
                modeRailLabelClass,
                "overflow-hidden transition-[max-width,opacity,margin] duration-200",
                isModeRailExpanded ? "ml-0 max-w-[12rem] opacity-100" : "ml-0 max-w-0 opacity-0",
              )}
              aria-hidden={!isModeRailExpanded}
            >
              Dashboard
            </span>
          </button>
        </div>
        <div className="group relative w-full overflow-visible">
          <button
            type="button"
            onClick={() => setTopMode("users")}
            aria-label="Users"
            className={cn(
              "inline-flex h-11 w-full items-center rounded-lg transition-all duration-200",
              isModeRailExpanded ? "justify-start gap-0.5 px-2.5" : "justify-center px-0",
              topMode === "users"
                ? modeRailActiveClass
                : "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <span
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                topMode === "users" ? "text-indigo-700" : "text-slate-500 group-hover:text-indigo-700",
              )}
              aria-hidden
              onMouseEnter={() => setIsModeRailExpanded(true)}
            >
              <Users className="size-4" aria-hidden />
            </span>
            <span
              className={cn(
                modeRailLabelClass,
                "overflow-hidden transition-[max-width,opacity,margin] duration-200",
                isModeRailExpanded ? "ml-0 max-w-[12rem] opacity-100" : "ml-0 max-w-0 opacity-0",
              )}
              aria-hidden={!isModeRailExpanded}
            >
              Users
            </span>
          </button>
        </div>
      </nav>
    </aside>
  );

  return (
    <DragContext onDragEnd={onDragEnd}>
      <main
        className={cn(
          "flex h-screen min-h-0 flex-col pb-8 pl-0 pr-2",
          topMode === "users" && "overflow-x-hidden overflow-y-auto bg-white",
          topMode === "roadmap" &&
            "overflow-x-hidden overflow-y-visible bg-gradient-to-br from-gray-100 via-slate-50 to-zinc-100",
          topMode === "backlog" &&
            "overflow-hidden bg-gradient-to-br from-gray-100 via-slate-50 to-zinc-100",
        )}
      >
        {/* Global stats bar — full-bleed, chips portalled in from TimelineGrid */}
        <div className="-mr-2 flex shrink-0 items-center justify-end gap-1 overflow-visible border-b border-slate-200 bg-white px-6 py-3 shadow-sm sm:gap-1.5 md:gap-2">
          <div ref={setSummaryBarEl} className="flex flex-wrap items-center justify-end gap-1 sm:gap-1.5 md:gap-2" />
        </div>
        <div
          className={cn(
            "mx-auto flex w-full max-w-[2550px] flex-row gap-1.5",
            topMode === "backlog"
              ? "min-h-0 min-w-0 flex-1 items-stretch overflow-x-hidden overflow-y-hidden"
              : "flex-1 min-h-0 overflow-y-visible",
            topMode !== "backlog" && (isModeRailExpanded ? "overflow-x-visible" : "overflow-x-hidden"),
          )}
        >
          <div
            className="relative z-[60] h-full min-h-0 w-[58px] shrink-0 self-stretch overflow-visible"
            onFocusCapture={() => setIsModeRailExpanded(true)}
            onBlurCapture={(e) => {
              const next = e.relatedTarget;
              if (next instanceof Node && e.currentTarget.contains(next)) return;
              setIsModeRailExpanded(false);
            }}
          >
            <div
              className={cn(
                "absolute top-0 left-0 flex h-full min-h-0 flex-col overflow-hidden rounded-b-md border-x border-b border-slate-200/80 bg-white [clip-path:inset(0_-40px_-40px_-40px)] shadow-[2px_0_12px_-2px_rgba(15,23,42,0.14),0_4px_16px_-4px_rgba(15,23,42,0.10)] transition-[width,box-shadow] duration-200 ease-out",
                isModeRailExpanded
                  ? "z-50 w-[244px] shadow-[0_12px_40px_-8px_rgba(15,23,42,0.22)] ring-1 ring-slate-200/70"
                  : "z-30 w-[58px]",
              )}
              onMouseLeave={() => setIsModeRailExpanded(false)}
            >
              <div
                className={cn(
                  "shrink-0 overflow-hidden border-slate-200/55 bg-white transition-[max-height,opacity,padding,border-width] duration-200 ease-out",
                  isModeRailExpanded
                    ? "max-h-[6.25rem] border-b px-3 pb-3 pt-3 opacity-100"
                    : "max-h-0 border-0 bg-transparent p-0 opacity-0",
                )}
                aria-hidden={!isModeRailExpanded}
              >
                <img
                  src="/bird-eye-lockup-wide.png"
                  alt="Bird Eye Viewer logo"
                  className={cn(
                    "block w-full rounded-md object-contain object-left transition-opacity duration-200",
                    isModeRailExpanded ? "h-[62px] opacity-100" : "h-0 opacity-0",
                  )}
                />
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto py-2">{modeSwitchMenu}</div>
            </div>
          </div>
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col gap-5",
              topMode !== "roadmap" && "pt-2",
              topMode === "backlog"
                ? "h-full min-h-0 overflow-x-hidden overflow-y-hidden"
                : "overflow-x-hidden overflow-y-visible",
            )}
          >
            {topMode === "roadmap" ? (
            <div
              ref={layoutRef}
              className={cn(
                "grid min-h-0 flex-1 items-stretch",
                leftRailLockedClosed ? "gap-x-0" : "gap-x-0",
                isResizingPanel && "select-none",
              )}
              style={{
                gridTemplateColumns: leftRailLockedClosed ? "auto minmax(0, 1fr)" : "auto 20px minmax(0, 1fr)",
              }}
            >
              <div
                className={cn(
                  "relative min-h-0 overflow-hidden rounded-xl bg-white/90 motion-reduce:transition-none mt-2 ml-0.5",
                  !isResizingPanel && "transition-[width] duration-[320ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]",
                  leftRailLockedClosed && "min-w-0 border-0 p-0",
                )}
                style={{
                  width: leftRailLockedClosed
                    ? "0px"
                    : isLeftPanelHidden
                      ? "2.75rem"
                      : `${panelWidth}px`,
                }}
              >
                <div
                  className={cn(
                    "flex h-full min-h-0 motion-reduce:transition-none",
                    "transition-transform duration-[320ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]",
                    isLeftPanelHidden && "pointer-events-none",
                  )}
                  style={{
                    width: `${panelWidth}px`,
                    transform: isLeftPanelHidden ? "translateX(-100%)" : "translateX(0)",
                  }}
                >
                  <div className="h-full min-h-0 min-w-0 shrink-0 overflow-hidden rounded-xl bg-white" style={{ width: panelWidth }}>
                    <InitiativeListPanel
                      initiatives={initiatives}
                      activeMonth={initiativeListActiveMonth}
                      storyProgressDetailsVisible={showRoadmapProgress}
                      useEpicPlanLeftPanel={initiativeListActiveMonth != null}
                      activeYearSprint={activeYearSprint}
                      storyDragEnabled={isSprintModeActive && !isActiveSprintClosed}
                      isSprintModeActive={isSprintModeActive}
                      isOnEpicGanttTab={activeMonthPlanTab === "epic-gantt"}
                      isCapacityPlanningMode={
                        activeMonthPlanTab === "sprint-capacity" ||
                        activeMonthPlanTab === "month-capacity" ||
                        activeQuarterViewTab === "capacity"
                      }
                      onCreateInitiativeQuick={async (title) => {
                        try {
                          const id = await createInitiativeQuick(title);
                          toast.success("Initiative added");
                          return id;
                        } catch (err) {
                          toast.error("Failed to add initiative");
                          throw err;
                        }
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
                      onDeleteEpic={requestDeleteEpic}
                      onDeleteInitiative={requestDeleteInitiative}
                      onCreateEpicQuick={async (initiativeId, title) => {
                        try {
                          await createEpicQuick(initiativeId, title);
                          toast.success("Epic added");
                        } catch (err) {
                          toast.error("Failed to add epic");
                          throw err;
                        }
                      }}
                      onCreateStoryQuick={async (epicId, title) => {
                        try {
                          await createStoryQuick(epicId, title);
                          toast.success("User story added");
                        } catch (err) {
                          toast.error("Failed to add user story");
                          throw err;
                        }
                      }}
                      epicBacklogOrderByMonth={epicBacklogOrderByMonth}
                      monthEpicTeamFilterId={
                        activeTimelineMonth != null && sprintSurfaceUsesDeliveryTeam && sprintStoryBoardTeamId
                          ? sprintStoryBoardTeamId
                          : null
                      }
                      onSprintBoardTeamFilterSync={
                        activeTimelineMonth != null && sprintSurfaceUsesDeliveryTeam
                          ? (teamId) => setSprintStoryBoardTeamId(teamId)
                          : undefined
                      }
                      panelQuarterQuickFilter={activeTimelineMonth == null ? null : (focusedQuarterLabel as "Q1" | "Q2" | "Q3" | "Q4" | null)}
                      panelQuarterFilterLocked={false}
                      onInitiativeAccordionChange={handleInitiativeAccordionChange}
                      onEpicAccordionChange={(epicId, isOpen) => {
                        if (!isOpen) return;
                        if (activeMonthPlanTab !== "sprint-kanban") return;
                        flashSprintEpicAccordionEmphasis(epicId);
                      }}
                      panelStatusQuickFilter={panelStatusQuickFilter}
                      onHidePanel={
                        leftRailLockedClosed ? undefined : () => setIsLeftPanelHidden(true)
                      }
                      workspaceDirectoryUsers={workspaceDirectoryUsers}
                    />
                  </div>
                </div>
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 z-30 flex items-start justify-center bg-white/95 pt-2 transition-opacity duration-[320ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                    leftRailLockedClosed && "hidden",
                    !leftRailLockedClosed && isLeftPanelHidden && "pointer-events-auto opacity-100",
                    !leftRailLockedClosed && !isLeftPanelHidden && "opacity-0",
                  )}
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => {
                      if (leftRailLockedClosed) return;
                      setIsLeftPanelHidden(false);
                      leftInitiativePanelAutoCollapsedForInsightsRef.current = false;
                    }}
                    aria-label="Show left panel"
                    title="Show left panel"
                  >
                    <PanelLeftOpen className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
              {!leftRailLockedClosed && (
                <div
                  className="group relative flex h-full min-h-0 w-4 shrink-0 cursor-col-resize items-center justify-center self-stretch"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setIsResizingPanel(true);
                  }}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize panel"
                >
                  {/* Separator line — always visible, centered */}
                  <div
                    className="pointer-events-none absolute inset-y-0 left-[65%] z-30 w-[3px] -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.10)] transition-all duration-150 group-hover:shadow-[0_0_0_1px_rgba(15,23,42,0.18)]"
                    aria-hidden
                  />
                  {/* Downward triangle tip at top of separator */}
                  <svg
                    className="pointer-events-none absolute top-0 left-[65%] z-20 -translate-x-1/2 drop-shadow-sm"
                    width="14"
                    height="10"
                    viewBox="0 0 14 10"
                    aria-hidden
                  >
                    <polygon points="0,0 14,0 7,10" fill="white" />
                    <path d="M0,0 L7,10 L14,0" fill="none" stroke="rgba(15,23,42,0.13)" strokeWidth="1" strokeLinejoin="round" />
                  </svg>
                  {/* Drag pill */}
                  <div
                    className="pointer-events-none absolute left-[65%] top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 flex h-10 w-[7px] flex-col items-center justify-center gap-[3px] rounded-full bg-white shadow-[0_1px_4px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/80 transition-all duration-150 group-hover:shadow-[0_2px_8px_rgba(15,23,42,0.16)] group-hover:ring-slate-300 group-active:bg-slate-50"
                    aria-hidden
                  >
                    <span className="h-px w-[3px] rounded-full bg-slate-300" />
                    <span className="h-px w-[3px] rounded-full bg-slate-300" />
                    <span className="h-px w-[3px] rounded-full bg-slate-300" />
                  </div>
                </div>
              )}
              <div
                ref={planningRightSurfaceRef}
                className="mt-2 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-r-xl"
              >
                <TimelineGrid
                initiatives={initiatives}
                zoom={1}
                currentYear={selectedYear}
                showRoadmapProgress={showRoadmapProgress}
                onShowRoadmapProgressChange={setShowRoadmapProgress}
                initialInsightsScopeEpicId={insightsScopeEpicId}
                initialInsightsScopeInitId={insightsScopeInitId}
                onInsightsScopeChange={(epicId, initId) => {
                  setInsightsScopeEpicId(epicId);
                  setInsightsScopeInitId(initId);
                }}
                summaryBadges={roadmapSummary}
                summaryBarPortalElement={summaryBarEl}
                suppressInlineChips
                onSummaryStatusQuickFilterChange={setPanelStatusQuickFilter}
                summaryStatusQuickFilter={panelStatusQuickFilter}
                roadmaps={roadmaps}
                selectedRoadmapId={selectedRoadmapId}
                selectedRoadmap={selectedRoadmap}
                onSelectRoadmap={handleSelectRoadmap}
                onCreateRoadmap={handleCreateRoadmap}
                onRenameRoadmap={handleRenameRoadmap}
                onAddYearToRoadmap={handleAddYearToRoadmap}
                onRemoveYearFromRoadmap={handleRemoveYearFromRoadmap}
                onGetRoadmapCounts={handleGetRoadmapCounts}
                onDeleteRoadmap={handleDeleteRoadmap}
                onYearChange={async (nextYear) => {
                  if (nextYear === selectedYear) return;
                  setSelectedYear(nextYear);
                  await refresh(nextYear);
                  setFocusedQuarterLabel(null);
                  setActiveTimelineMonth(null);
                  setActiveYearSprint(null);
                  setActiveSprintTab("kanban");
                  setActiveMonthPlanTab("epic-gantt");
                  setActiveQuarterViewTab("gantt");
                  setSprintStoryBoardTeamId(null);
                }}
                focusedQuarterLabel={focusedQuarterLabel}
                focusedMonthExternal={activeTimelineMonth}
                activeSprintExternal={activeYearSprint}
                activeSprintTabExternal={activeSprintTab}
                quarterViewTabExternal={activeQuarterViewTab}
                monthPlanTab={activeMonthPlanTab}
                onMonthPlanTabChange={handleMonthPlanTabChange}
                onQuarterViewTabChange={setActiveQuarterViewTab}
                monthTeamCapacityBoard={activeMonthTeamCapacityBoard}
                monthTeamCapacityByKey={monthTeamCapacityByKey}
                onMonthTeamCapacityChange={updateMonthTeamCapacity}
                onQuarterTeamCapacityChange={updateQuarterTeamCapacity}
                onYearTeamCapacityChange={updateYearTeamCapacity}
                onMonthTeamCapacityEpicRemove={removeEpicFromMonthTeamCapacity}
                onCapacityEpicOriginalEstimateChange={updateEpicOriginalEstimateFromCapacity}
                monthTeamBoardByKey={monthTeamBoardByKey}
                sprintCapacityBoard={activeSprintCapacityBoard}
                sprintCapacityColumnReorderEnabled={!isActiveSprintClosed}
                onSprintCapacityChange={updateSprintCapacity}
                onSprintCapacityStoryEstimateChange={updateStoryEstimateFromCapacity}
                onSprintCapacityStoryDaysLeftChange={updateStoryDaysLeftFromCapacity}
                onSprintKanbanStoryPatch={patchStoryFromKanban}
                workspaceDirectoryUsers={workspaceDirectoryUsers}
                onSprintCapacityStoryClearAssignee={clearStoryAssigneeFromSprintCapacity}
                onSprintCapacityStoryUnschedule={unscheduleStoryFromCapacity}
                onRequestSprintKanbanStoryUnschedule={(storyId, storyTitle) => {
                  openConfirmDialog({
                    title: "Move user story back to backlog?",
                    message: `Remove "${storyTitle}" from sprint and move it back to unscheduled backlog?`,
                    confirmLabel: "Move to backlog",
                    onConfirm: async () => {
                      await unscheduleStoryFromCapacity(storyId);
                    },
                  });
                }}
                sprintRetrospective={activeSprintRetrospective}
                sprintRetrospectiveByTeam={activeSprintRetrospectiveByTeam}
                onSaveSprintRetrospective={saveSprintRetrospective}
                onEnterSprintStoryBoard={openSprintStoryBoard}
                sprintStoryBoardTeamId={sprintStoryBoardTeamId}
                onSprintStoryBoardTeamChange={setSprintStoryBoardTeamId}
                onFocusedQuarterChange={setFocusedQuarterLabel}
                onYearRoadmapNavigate={() => {
                  handleSprintModeChange(false, null, null);
                  setActiveMonthPlanTab("epic-gantt");
                }}
                onQuarterGanttFromMonthBreadcrumb={(quarterLabel) => {
                  setFocusedQuarterLabel(quarterLabel);
                  handleSprintModeChange(false, null, null);
                  setActiveMonthPlanTab("epic-gantt");
                }}
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
                  openConfirmDialog({
                    title: "Move epic back to backlog?",
                    message: `Remove "${target.title}" from Gantt and move it back to unscheduled backlog?`,
                    confirmLabel: "Move to backlog",
                    onConfirm: async () => {
                      flushSync(() => {
                        setInitiatives((prev) =>
                          prev.map((initiative) => ({
                            ...initiative,
                            epics: (initiative.epics ?? []).map((epic) =>
                              epic.id === epicId
                                ? {
                                    ...epic,
                                    planSprint: null,
                                    planEndSprint: null,
                                    planStartMonth: null,
                                    planEndMonth: null,
                                  }
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
                    },
                  });
                }}
                ganttEmphasis={ganttEmphasis}
                ganttEpicEmphasis={ganttEpicEmphasis}
                ganttScheduledFilterEmphasis={ganttScheduledFilterEmphasis}
                sprintEpicAccordionEmphasis={sprintEpicAccordionEmphasis}
                sprintKanbanScheduledStoriesEmphasis={sprintKanbanScheduledStoriesEmphasis}
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
                  console.log("[onResizeEpicPlanRange] called", { epicId, range });
                  const before = initiatives;
                  const target = before.flatMap((initiative) => initiative.epics ?? []).find((epic) => epic.id === epicId);
                  if (!target) { console.warn("[onResizeEpicPlanRange] epic not found", { epicId }); return; }
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
                            planStartDay: null,
                            planEndDay: null,
                          }
                        : epic,
                    ),
                  }));
                  console.log("[onResizeEpicPlanRange] applying", { epicId, range, nextTimelineRow, rowMoved: nextTimelineRow !== (Number.isFinite(target.timelineRow) ? target.timelineRow : 0) });
                  setInitiatives(after);
                  try {
                    const patch = {
                      planSprint: laneFromYearSprint(range.startYearSprint),
                      planEndSprint: laneFromYearSprint(range.endYearSprint),
                      planStartMonth: range.startMonth,
                      planEndMonth: range.endMonth,
                      timelineRow: nextTimelineRow,
                      planStartDay: null as null,
                      planEndDay: null as null,
                    };
                    console.log("[onResizeEpicPlanRange] PATCH", { epicId, patch });
                    await patchEpicQuarterPlan(epicId, patch);
                    await persistEpicTimelineRowPatches(before, after);
                    console.log("[onResizeEpicPlanRange] success");
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
                onMonthEpicDayRangeChange={async (epicId, startDay, endDay) => {
                  const epic = initiatives.flatMap((i) => i.epics ?? []).find((e) => e.id === epicId);
                  const monthName = epic?.planStartMonth != null
                    ? new Date(selectedYear, epic.planStartMonth - 1, 1).toLocaleString("default", { month: "long" })
                    : null;
                  // Derive sprint-level fields from the day values so year/quarter gantts update correctly.
                  const newPlanSprint = startDay <= 15 ? 1 : 2;
                  const newPlanEndSprint = endDay <= 15 ? 1 : 2;
                  setInitiatives((prev) =>
                    prev.map((initiative) => ({
                      ...initiative,
                      epics: (initiative.epics ?? []).map((e) =>
                        e.id === epicId
                          ? { ...e, planStartDay: startDay, planEndDay: endDay, planSprint: newPlanSprint, planEndSprint: newPlanEndSprint }
                          : e,
                      ),
                    })),
                  );
                  try {
                    const response = await fetch(`/api/epics/${epicId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ planStartDay: startDay, planEndDay: endDay, planSprint: newPlanSprint, planEndSprint: newPlanEndSprint }),
                    });
                    if (!response.ok) throw new Error(`Save failed (${response.status})`);
                    toast.success("Epic updated", {
                      description: `Day ${startDay} → Day ${endDay}${monthName ? ` · ${monthName}` : ""}`,
                    });
                  } catch (err) {
                    console.error("[onMonthEpicDayRangeChange]", err);
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
          ) : topMode === "dashboard" ? (
            <div className="min-h-0 min-w-0 flex-1">
              <DashboardPage initiatives={initiatives} planYear={selectedYear} roadmaps={roadmaps} workspaceDirectoryUsers={workspaceDirectoryUsers} />
            </div>
          ) : topMode === "users" ? (
            <div className="min-h-0 min-w-0 flex-1">
              <div className="h-full min-h-0 min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-md ring-1 ring-slate-200/60">
                <UsersWorkspacePanel />
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
              <div
                ref={planningRightSurfaceRef}
                className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-hidden"
              >
                <BacklogPlanningPanel
                summaryBarPortalElement={summaryBarEl}
                suppressInlineChips
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
                    const id = await createInitiativeQuick(title);
                    toast.success("Initiative added");
                    return id;
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
        </div>
        {dndDropInspector ? (
          <div
            className="pointer-events-auto fixed bottom-4 right-4 z-[100] flex max-h-[min(420px,70vh)] w-[min(100vw-2rem,420px)] flex-col rounded-lg border border-amber-200/80 bg-amber-50/95 text-slate-900 shadow-xl ring-1 ring-amber-900/10 backdrop-blur-sm"
            role="dialog"
            aria-label="Drag and drop debug"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-200/90 px-3 py-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-900/80">
                  Drop debug (unexpected / failed drops)
                </div>
                <div className="truncate font-mono text-[11px] text-slate-600">{dndDropInspector.at}</div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 border-amber-300 bg-white px-2 text-[11px] text-slate-800 hover:bg-amber-100/80"
                  onClick={() => {
                    void navigator.clipboard?.writeText(JSON.stringify(dndDropInspector, null, 2));
                    toast.message("Copied drop debug JSON");
                  }}
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 border-amber-300 bg-white px-2 text-[11px] text-slate-800 hover:bg-amber-100/80"
                  onClick={() => setDndDropInspector(null)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 text-[11px] leading-snug">
              <div>
                <span className="font-semibold text-slate-700">Branch:</span>{" "}
                <span className="font-mono text-slate-900">{dndDropInspector.branch}</span>
              </div>
              <div className="font-mono text-[10px] text-slate-700">
                <div>
                  <span className="text-slate-500">active</span> {dndDropInspector.activeId}
                </div>
                <div>
                  <span className="text-slate-500">over</span> {dndDropInspector.overId}
                </div>
                <div>
                  <span className="text-slate-500">Δ</span> {dndDropInspector.delta.x.toFixed(0)},{" "}
                  {dndDropInspector.delta.y.toFixed(0)}
                </div>
              </div>
              <div className="rounded border border-amber-100 bg-white/80 p-2 font-mono text-[10px] text-slate-700">
                <div>month {String(dndDropInspector.planner.activeTimelineMonth)}</div>
                <div>sprint {String(dndDropInspector.planner.activeYearSprint)}</div>
                <div>capacityMonth {String(dndDropInspector.planner.sprintCapacityPlanMonth)}</div>
                <div>planTab {dndDropInspector.planner.activeMonthPlanTab}</div>
                <div>sprintClosed {String(dndDropInspector.planner.isActiveSprintClosed)}</div>
                <div>sprintTeam {String(dndDropInspector.planner.sprintStoryBoardTeamId)}</div>
                <div>quarter {String(dndDropInspector.planner.focusedQuarterLabel)}</div>
              </div>
              {dndDropInspector.steps.length > 0 ? (
                <div>
                  <div className="mb-0.5 font-semibold text-slate-700">Steps</div>
                  <ol className="list-decimal space-y-0.5 pl-4 font-mono text-[10px] text-slate-600">
                    {dndDropInspector.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {Object.keys(dndDropInspector.detail).length > 0 ? (
                <pre className="max-h-40 overflow-auto rounded border border-slate-200 bg-white p-2 font-mono text-[10px] text-slate-800">
                  {JSON.stringify(dndDropInspector.detail, null, 2)}
                </pre>
              ) : null}
            </div>
          </div>
        ) : null}

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
        onDelete={requestDeleteInitiative}
        surfaceAnchorRef={planningRightSurfaceRef}
        roadmaps={roadmaps}
        selectedRoadmapId={selectedRoadmapId}
        onChangeRoadmap={() => {}}
        onCreateRoadmap={createRoadmapQuick}
      />
      <EpicFormDialog
        open={epicDialogOpen}
        epic={currentEditingEpic}
        initiatives={initiatives}
        lockInitiativeId={editingEpicInitiativeId}
        onCreateInitiativeQuick={async (title) => {
          try {
            const id = await createInitiativeQuick(title);
            toast.success("Initiative added");
            return id;
          } catch {
            toast.error("Failed to add initiative");
            throw new Error("Failed to create initiative");
          }
        }}
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
          setInsightsScopeEpicId(null);
          setInsightsScopeInitId(null);
        }}
        onSubmit={handleUpsertEpic}
        storyRefById={storyRefMaps.byId}
        onDelete={requestDeleteEpic}
        workspaceDirectoryUsers={workspaceDirectoryUsers}
        surfaceAnchorRef={planningRightSurfaceRef}
        roadmaps={roadmaps}
      />
      <StoryDetailsDialog
        open={storyDialogOpen}
        story={selectedStory}
        initiatives={initiatives}
        roadmaps={roadmaps}
        workspaceDirectoryUsers={workspaceDirectoryUsers}
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
            if (payload.assignee === null) {
              stripStoryFromPersistedCapacityAssignments(storyId);
            }
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
        onRequestConfirm={openConfirmDialog}
        onDelete={async (storyId) => {
          try {
            await deleteStory(storyId);
            toast.success("User story deleted");
          } catch {
            toast.error("Failed to delete user story");
            throw new Error("Failed to delete user story");
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
      {confirmDialog ? (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-slate-900/35 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/10">
            <h3 className="text-base font-semibold text-slate-900">{confirmDialog.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{confirmDialog.message}</p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs font-medium"
                disabled={isConfirmingDialog}
                onClick={() => setConfirmDialog(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 px-3 text-xs font-medium bg-slate-900 text-white hover:bg-[#6878b8]"
                disabled={isConfirmingDialog}
                onClick={async () => {
                  setIsConfirmingDialog(true);
                  try {
                    await confirmDialog.onConfirm();
                    setConfirmDialog(null);
                  } finally {
                    setIsConfirmingDialog(false);
                  }
                }}
              >
                {isConfirmingDialog ? "Working..." : confirmDialog.confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {deleteInitiativeTarget && (
        <InitiativeDeleteDialog
          initiative={deleteInitiativeTarget}
          onConfirm={confirmDeleteInitiative}
          onCancel={() => setDeleteInitiativeTarget(null)}
          deleting={deletingInitiative}
        />
      )}
      {deleteEpicTarget && (
        <EpicDeleteDialog
          epic={deleteEpicTarget}
          onConfirm={() => void confirmDeleteEpic()}
          onCancel={() => setDeleteEpicTarget(null)}
          deleting={deletingEpic}
        />
      )}
      <DebugLogPanel />
    </DragContext>
  );
}

