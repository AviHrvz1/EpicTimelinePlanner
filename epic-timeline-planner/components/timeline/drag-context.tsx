"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import { useState } from "react";

import { EPICS_UNPLAN_DROP_ID, isEpicPlanDraggableId, isInitiativeDraggableId } from "@/lib/epic-dnd-ids";

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

const collisionDetection: CollisionDetection = (args) => {
  if (isEpicPlanDraggableId(String(args.active.id))) {
    return epicPlanCollision(args);
  }
  if (isInitiativeDraggableId(String(args.active.id))) {
    return initiativeCollision(args);
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
      onDragStart={(event) => {
        setActiveDragId(String(event.active.id));
      }}
      onDragEnd={(event) => {
        setActiveDragId(null);
        onDragEnd(event);
      }}
      onDragCancel={() => {
        setActiveDragId(null);
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
                : "Move"}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
