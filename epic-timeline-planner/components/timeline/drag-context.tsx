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
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import { useState } from "react";

import {
  EPICS_UNPLAN_DROP_ID,
  STORIES_UNSCHEDULE_DROP_ID,
  isEpicPlanDraggableId,
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

const initiativeCollision: CollisionDetection = (args) => {
  const isDropTarget = (id: string) => id.startsWith("month:") || id === "initiatives:backlog-drop";
  const pointerHits = pointerWithin(args).filter((c) => isDropTarget(String(c.id)));
  if (pointerHits.length > 0) return pointerHits;
  return closestCenter(args).filter((c) => isDropTarget(String(c.id)));
};

const epicPlanCollision: CollisionDetection = (args) => {
  /** Roadmap month cells use `month:` — same targets as initiatives so epics can land on quarter months. */
  const isDropTarget = (id: string) =>
    id.startsWith("epic-plan:") || id.startsWith("month:") || id === EPICS_UNPLAN_DROP_ID;
  const pointerHits = pointerWithin(args).filter((c) => isDropTarget(String(c.id)));
  if (pointerHits.length > 0) return pointerHits;
  const rectHits = rectIntersection(args).filter((c) => isDropTarget(String(c.id)));
  if (rectHits.length > 0) return rectHits;
  return closestCenter(args).filter((c) => isDropTarget(String(c.id)));
};

const storyKanbanCollision: CollisionDetection = (args) => {
  const unscheduleId = STORIES_UNSCHEDULE_DROP_ID;
  /** Prefer left-panel unschedule so drops aren’t stolen by Kanban columns when crossing the layout. */
  const unschedulePointer = pointerWithin(args).filter((c) => String(c.id) === unscheduleId);
  if (unschedulePointer.length > 0) return unschedulePointer;
  const unscheduleRect = rectIntersection(args).filter((c) => String(c.id) === unscheduleId);
  if (unscheduleRect.length > 0) return unscheduleRect;

  const isKanban = (id: string) => id.startsWith("kanban:");
  const pointerHits = pointerWithin(args).filter((c) => isKanban(String(c.id)));
  if (pointerHits.length > 0) return pointerHits;
  const rectHits = rectIntersection(args).filter((c) => isKanban(String(c.id)));
  if (rectHits.length > 0) return rectHits;
  return closestCenter(args).filter(
    (c) => isKanban(String(c.id)) || String(c.id) === unscheduleId,
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

export function DragContext({ onDragEnd, children }: DragContextProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
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
        const id = String(event.active.id);
        console.log("[gantt-drop] dnd dragStart", { activeId: id });
        setActiveDragId(id);
      }}
      onDragEnd={(event) => {
        console.log("[gantt-drop] dnd dragEnd", {
          activeId: event.active?.id,
          overId: event.over?.id,
          delta: event.delta,
        });
        setActiveDragId(null);
        suppressPostDragClicksFor();
        onDragEnd(event);
      }}
      onDragCancel={() => {
        console.log("[gantt-drop] dnd dragCancel");
        setActiveDragId(null);
        suppressPostDragClicksFor();
      }}
    >
      {children}
      <DragOverlay zIndex={9999}>
        {activeDragId ? (
          <div className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-xl">
            {isEpicPlanDraggableId(activeDragId)
              ? "Place epic"
              : isInitiativeDraggableId(activeDragId)
                ? "Move initiative"
                : isStoryDraggableId(activeDragId)
                  ? "Move story"
                  : "Move"}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
