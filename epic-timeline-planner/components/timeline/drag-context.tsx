"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import { useState } from "react";

import { isInitiativeDraggableId } from "@/lib/epic-dnd-ids";

type DragContextProps = {
  onDragEnd: (event: DragEndEvent) => void;
  children: React.ReactNode;
};

const storyKanbanCollision: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args).filter((c) => String(c.id).startsWith("kanban:"));
  if (pointerHits.length > 0) return pointerHits;
  return closestCenter(args).filter((c) => String(c.id).startsWith("kanban:"));
};

const initiativeCollision: CollisionDetection = (args) => {
  const isDropTarget = (id: string) => id.startsWith("month:") || id === "initiatives:backlog-drop";
  const pointerHits = pointerWithin(args).filter((c) => isDropTarget(String(c.id)));
  if (pointerHits.length > 0) return pointerHits;
  return closestCenter(args).filter((c) => isDropTarget(String(c.id)));
};

const collisionDetection: CollisionDetection = (args) => {
  if (String(args.active.id).startsWith("story:")) {
    return storyKanbanCollision(args);
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
            {isInitiativeDraggableId(activeDragId) ? "Move initiative" : "Move story"}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
