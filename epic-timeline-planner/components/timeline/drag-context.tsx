"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  DragEndEvent,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDndContext,
  useDndMonitor,
  useSensor,
  useSensors,
  type Collision,
  type CollisionDetection,
} from "@dnd-kit/core";
import { CalendarCheck2, UserRound } from "lucide-react";
import { useMemo, useState } from "react";

import { TimelineBarDragPreview } from "@/components/timeline/epic-timeline-bar";
import { EpicPlanBarIcon } from "@/components/timeline/epic-plan-bar";
import {
  EPICS_UNPLAN_DROP_ID,
  STORIES_UNSCHEDULE_DROP_ID,
  parseBacklogSlotDropId,
  parseEpicBacklogSlotDropId,
  parseMonthTeamSlotDropId,
  isEpicPlanDraggableId,
  isEpicPlanCompactDragData,
  isGanttTimelineBarDragData,
  isInitiativeDraggableId,
  isStoryDraggableId,
} from "@/lib/epic-dnd-ids";

/** After drag end, browsers often synthesize a click on the element under the cursor (e.g. month drill header). */
let postDragClickShieldUntilMs = 0;

export function suppressPostDragClicksFor(ms = 500) {
  postDragClickShieldUntilMs = Date.now() + ms;
}

export function isPostDragClickSuppressed() {
  return Date.now() < postDragClickShieldUntilMs;
}

type DragContextProps = {
  onDragEnd: (event: DragEndEvent) => void;
  children: React.ReactNode;
};

/** Header strip droppables: `month:1` … `month:12` (see `MonthDropCell`). */
function isMonthColumnDropId(id: string): boolean {
  return /^month:\d+$/.test(id);
}

function isTimelineInitiativeDrag(activeId: string): boolean {
  return activeId.startsWith("timeline-initiative:");
}

/**
 * Gantt month targets are thin strips under month titles; the pointer is usually over the lane, not the strip.
 * For timeline bars, use the bar's **left edge** (`collisionRect.left`) to pick the month column so long
 * initiatives match the visual start, not wherever the hand happens to be.
 */
const initiativeCollision: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  const isDropTarget = (id: string) =>
    id.startsWith("month:") || id === "initiatives:backlog-drop" || parseBacklogSlotDropId(id) != null;

  const pointerHits = pointerWithin(args).filter((c) => {
    const id = String(c.id);
    if (!isDropTarget(id)) return false;
    return !(c.data as { droppableContainer?: { disabled?: boolean } } | undefined)?.droppableContainer?.disabled;
  });

  /** Backlog / slot targets: pointer must be inside (not inferred from bar left). */
  const pointerPriority = pointerHits.filter((c) => !isMonthColumnDropId(String(c.id)));
  if (pointerPriority.length > 0) return pointerPriority;

  if (isTimelineInitiativeDrag(activeId) && args.collisionRect) {
    const anchorX = args.collisionRect.left;
    const monthContainers = args.droppableContainers.filter(
      (c) => !c.disabled && isMonthColumnDropId(String(c.id)) && args.droppableRects.get(c.id) != null,
    );
    if (monthContainers.length > 0) {
      let best: { id: (typeof monthContainers)[0]["id"]; dist: number; container: (typeof monthContainers)[0] } | null =
        null;
      for (const c of monthContainers) {
        const id = c.id;
        const rect = args.droppableRects.get(id)!;
        const inside = anchorX >= rect.left && anchorX <= rect.right;
        const dist = inside ? 0 : anchorX < rect.left ? rect.left - anchorX : anchorX - rect.right;
        if (
          !best ||
          dist < best.dist ||
          (dist === best.dist && rect.left < args.droppableRects.get(best.id)!.left)
        ) {
          best = { id, dist, container: c };
        }
      }
      if (best) {
        return [
          {
            id: best.id,
            data: { droppableContainer: best.container, value: best.dist },
          },
        ];
      }
    }
  }

  if (pointerHits.length > 0) return pointerHits;
  return closestCenter(args).filter((c) => isDropTarget(String(c.id)));
};

const epicPlanCollision: CollisionDetection = (args) => {
  /** Roadmap month cells use `month:` — same targets as initiatives so epics can land on quarter months. */
  const isKanbanTodoDrop = (id: string) => /^kanban:(\d+):todo$/.test(id);
  const isEpicKanbanDrop = (id: string) => /^epic-kanban:\d+:(todo|inProgress|review|done)$/.test(id);
  const isMonthTeamSlotDrop = (id: string) => parseMonthTeamSlotDropId(id) != null;
  const isSprintCapacityDrop = (id: string) => id.startsWith("capacity:");
  const isMonthTeamCapacityDrop = (id: string) => id.startsWith("month-capacity:");
  const isQuarterTeamCapacityDrop = (id: string) => id.startsWith("quarter-capacity:");
  /** Timeline column targets — sprint, day, or month cells on the Gantt. */
  const isTimelineColumn = (id: string) => id.startsWith("epic-plan:") || id.startsWith("epic-plan-day:") || id.startsWith("month:");
  const isDropTarget = (id: string) =>
    isTimelineColumn(id) ||
    id === EPICS_UNPLAN_DROP_ID ||
    parseEpicBacklogSlotDropId(id) != null ||
    isKanbanTodoDrop(id) ||
    isEpicKanbanDrop(id) ||
    isMonthTeamSlotDrop(id) ||
    isSprintCapacityDrop(id) ||
    isMonthTeamCapacityDrop(id) ||
    isQuarterTeamCapacityDrop(id);
  /** Thin insert zones (month epic list + team queue) should win when the pointer is over them. */
  const isNarrowSlot = (id: string) => parseEpicBacklogSlotDropId(id) != null || isMonthTeamSlotDrop(id);

  const pointerHits = pointerWithin(args).filter((c) => isDropTarget(String(c.id)));
  const pointerSlotHits = pointerHits.filter((c) => isNarrowSlot(String(c.id)));
  if (pointerSlotHits.length > 0) return pointerSlotHits;

  // Non-timeline pointer hits (kanban, capacity, unplan) win by pointer position.
  const pointerNonTimelineHits = pointerHits.filter((c) => !isTimelineColumn(String(c.id)));
  if (pointerNonTimelineHits.length > 0) return pointerNonTimelineHits;

  // For timeline columns: use the bar's LEFT EDGE to pick the target cell.
  // Two-pass: prefer specific sprint/day cells (epic-plan: / epic-plan-day:) over the broad
  // month wrapper (month:) so MonthEpicDropArea never steals a drop from SprintDropCell/DayDropCell.
  if (args.collisionRect) {
    const anchorX = args.collisionRect.left;
    const isSpecificCell = (id: string) => id.startsWith("epic-plan:") || id.startsWith("epic-plan-day:");
    const isMonthWrapper = (id: string) => id.startsWith("month:");

    function bestByAnchor(
      containers: typeof args.droppableContainers,
    ): { id: (typeof containers)[0]["id"]; dist: number; container: (typeof containers)[0] } | null {
      let best: { id: (typeof containers)[0]["id"]; dist: number; container: (typeof containers)[0] } | null = null;
      for (const c of containers) {
        const rect = args.droppableRects.get(c.id)!;
        const inside = anchorX >= rect.left && anchorX <= rect.right;
        const dist = inside ? 0 : anchorX < rect.left ? rect.left - anchorX : anchorX - rect.right;
        if (!best || dist < best.dist || (dist === best.dist && rect.left < args.droppableRects.get(best.id)!.left)) {
          best = { id: c.id, dist, container: c };
        }
      }
      return best;
    }

    // Pass 1: sprint/day cells only
    const specificContainers = args.droppableContainers.filter(
      (c) => !c.disabled && isSpecificCell(String(c.id)) && args.droppableRects.get(c.id) != null,
    );
    if (specificContainers.length > 0) {
      const best = bestByAnchor(specificContainers);
      if (best) return [{ id: best.id, data: { droppableContainer: best.container, value: best.dist } }];
    }

    // Pass 2: month wrapper fallback (all-quarters / single-quarter where no sprint cells exist)
    const monthContainers = args.droppableContainers.filter(
      (c) => !c.disabled && isMonthWrapper(String(c.id)) && args.droppableRects.get(c.id) != null,
    );
    if (monthContainers.length > 0) {
      const best = bestByAnchor(monthContainers);
      if (best) return [{ id: best.id, data: { droppableContainer: best.container, value: best.dist } }];
    }
  }

  const rectHits = rectIntersection(args).filter((c) => isDropTarget(String(c.id)));
  const rectSlotHits = rectHits.filter((c) => isNarrowSlot(String(c.id)));
  if (rectSlotHits.length > 0) return rectSlotHits;
  if (rectHits.length > 0) return rectHits;

  const centerHits = closestCenter(args).filter((c) => isDropTarget(String(c.id)));
  const centerSlotHits = centerHits.filter((c) => isNarrowSlot(String(c.id)));
  if (centerSlotHits.length > 0) return centerSlotHits;
  return centerHits;
};

/**
 * When Kanban columns overlap sprint-capacity buckets in layout/stacking, `pointerWithin` returns
 * multiple hits; dnd-kit would otherwise pick an arbitrary `over.id` and story drops on Kanban could
 * be treated as capacity (assignee change). Prefer explicit column/plan targets over `capacity:`.
 */
function prioritizeStoryDropCollisions(hits: Collision[]): Collision[] {
  if (hits.length <= 1) return hits;
  const un = hits.filter((c) => String(c.id) === STORIES_UNSCHEDULE_DROP_ID);
  if (un.length > 0) return un;
  /** Prefer a specific card hit so sprint Kanban can reorder within a column (not only the column droppable). */
  const boardCards = hits.filter((c) => String(c.id).startsWith("story:board:"));
  if (boardCards.length > 0) return boardCards;
  const kanban = hits.filter((c) => String(c.id).startsWith("kanban:"));
  if (kanban.length > 0) return kanban;
  const plan = hits.filter((c) => {
    const id = String(c.id);
    return id.startsWith("month:") || id.startsWith("epic-plan:");
  });
  if (plan.length > 0) return plan;
  return hits;
}

const storyKanbanCollision: CollisionDetection = (args) => {
  const unscheduleId = STORIES_UNSCHEDULE_DROP_ID;
  /** Prefer left-panel unschedule so drops aren’t stolen by Kanban columns when crossing the layout. */
  const unschedulePointer = pointerWithin(args).filter((c) => String(c.id) === unscheduleId);
  if (unschedulePointer.length > 0) return unschedulePointer;
  const unscheduleRect = rectIntersection(args).filter((c) => String(c.id) === unscheduleId);
  if (unscheduleRect.length > 0) return unscheduleRect;

  const isKanban = (id: string) => id.startsWith("kanban:");
  const isStoryBoardCard = (id: string) => id.startsWith("story:board:");
  const isSprintCapacityDrop = (id: string) => id.startsWith("capacity:");
  /** Same Gantt cells as epics (`MonthDropCell`, `epic-plan:`) so stories can be scheduled on the plan. */
  const isPlanCell = (id: string) => id.startsWith("month:") || id.startsWith("epic-plan:");
  const isStoryDropTarget = (id: string) =>
    isKanban(id) || isSprintCapacityDrop(id) || isPlanCell(id) || isStoryBoardCard(id);
  const pointerHits = prioritizeStoryDropCollisions(
    pointerWithin(args).filter((c) => isStoryDropTarget(String(c.id))),
  );
  if (pointerHits.length > 0) return pointerHits;
  const rectHits = prioritizeStoryDropCollisions(
    rectIntersection(args).filter((c) => isStoryDropTarget(String(c.id))),
  );
  if (rectHits.length > 0) return rectHits;
  return prioritizeStoryDropCollisions(
    closestCenter(args).filter(
      (c) => isStoryDropTarget(String(c.id)) || String(c.id) === unscheduleId,
    ),
  );
};

const collisionDetection: CollisionDetection = (args) => {
  if (isEpicPlanDraggableId(String(args.active.id))) {
    return epicPlanCollision(args);
  }
  if (isInitiativeDraggableId(String(args.active.id))) {
    return initiativeCollision(args);
  }
  if (isStoryDraggableId(String(args.active.id))) {
    return storyKanbanCollision(args);
  }
  return closestCenter(args);
};

function EpicPlanCompactDragPreview({
  title,
  color,
  icon,
}: {
  title: string;
  color: string;
  icon?: string | null;
}) {
  /** Fixed compact size — roughly one month on the year gantt — so the preview doesn't span 3 columns when dragged from the wide middle panel. */
  return (
    <div
      className="flex h-7 w-44 cursor-grabbing items-center overflow-hidden rounded-md text-[13px] font-semibold text-white shadow-md ring-1 ring-black/15"
      style={{ backgroundColor: color }}
    >
      <span className="min-w-0 flex-1 truncate px-2.5 text-center">
        <EpicPlanBarIcon icon={icon} />
        {title}
      </span>
    </div>
  );
}

function shallowCloneDragPayload(d: unknown): unknown {
  if (d && typeof d === "object" && !Array.isArray(d)) {
    return { ...(d as Record<string, unknown>) };
  }
  return d;
}

/** Snapshot drag `data` on start so overlay content isn’t `{}` for a frame (dnd-kit defaultData race). */
function DragOverlayLayer() {
  const [payloadSnapshot, setPayloadSnapshot] = useState<unknown>(undefined);
  useDndMonitor(
    useMemo(
      () => ({
        onDragStart({ active }) {
          setPayloadSnapshot(shallowCloneDragPayload(active.data.current));
        },
        onDragEnd() {
          setPayloadSnapshot(undefined);
        },
        onDragCancel() {
          setPayloadSnapshot(undefined);
        },
      }),
      [],
    ),
  );
  return (
    <DragOverlay
      zIndex={9999}
      /** Force the overlay to size to its child instead of the source draggable's rect, so dragging from the wide middle-panel card doesn't render a giant bar across the gantt. */
      style={{ width: "fit-content", height: "fit-content", pointerEvents: "none" }}
    >
      <PlannerDragOverlayBody payloadSnapshot={payloadSnapshot} />
    </DragOverlay>
  );
}

function PlannerDragOverlayBody({ payloadSnapshot }: { payloadSnapshot: unknown }) {
  const { active, over } = useDndContext();
  if (!active) return null;
  const id = String(active.id);
  const data =
    payloadSnapshot !== undefined ? payloadSnapshot : active.data.current;

  if (isGanttTimelineBarDragData(data)) {
    return (
      <TimelineBarDragPreview
        title={data.title}
        color={data.color}
        icon={data.icon}
        progressPercent={data.progressPercent}
        progressLabel={data.progressLabel}
      />
    );
  }
  if (isEpicPlanCompactDragData(data)) {
    return (
      <EpicPlanCompactDragPreview title={data.title} color={data.color} icon={data.icon} />
    );
  }

  if (isStoryDraggableId(id)) {
    const overId = active.data.current !== undefined && over ? String(over.id) : "";
    if (overId.startsWith("kanban:") || overId.startsWith("story:board:")) {
      return (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 shadow-xl">
          <CalendarCheck2 className="size-4 shrink-0" aria-hidden />
          Schedule
        </div>
      );
    }
    if (overId.startsWith("capacity:")) {
      return (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 shadow-xl">
          <UserRound className="size-4 shrink-0" aria-hidden />
          Assign
        </div>
      );
    }
    return (
      <div className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-xl">
        Move story
      </div>
    );
  }

  if (isEpicPlanDraggableId(id)) {
    const overId = active.data.current !== undefined && over ? String(over.id) : "";
    if (overId.startsWith("month-capacity:") || overId.startsWith("quarter-capacity:")) {
      return (
        <div className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-800 shadow-xl">
          <UserRound className="size-4 shrink-0" aria-hidden />
          Assign team
        </div>
      );
    }
    return (
      <div className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-xl">
        Place epic
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-xl">
      {isInitiativeDraggableId(id) ? "Move initiative" : "Move"}
    </div>
  );
}

export function DragContext({ onDragEnd, children }: DragContextProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor),
  );

  return (
    <DndContext
      id="epic-planner-dnd"
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{
        droppable: { strategy: MeasuringStrategy.Always },
      }}
      onDragStart={(event) => {
        // info: visible when Console default level hides verbose "log" in some setups
        console.info("[gantt-drop] dnd dragStart", { activeId: String(event.active.id) });
      }}
      onDragEnd={(event) => {
        console.info("[gantt-drop] dnd dragEnd", {
          activeId: event.active?.id,
          overId: event.over?.id,
          delta: event.delta,
        });
        suppressPostDragClicksFor();
        onDragEnd(event);
      }}
      onDragCancel={() => {
        console.info("[gantt-drop] dnd dragCancel");
        suppressPostDragClicksFor();
      }}
    >
      {children}
      <DragOverlayLayer />
    </DndContext>
  );
}
