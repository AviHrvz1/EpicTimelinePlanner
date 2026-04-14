"use client";

import { useDraggable } from "@dnd-kit/core";

import { epicTimelineDraggableId } from "@/lib/epic-dnd-ids";
import { cn } from "@/lib/utils";

type EpicPlanBarProps = {
  id: string;
  title: string;
  icon?: string | null;
  color: string;
  onClick?: () => void;
};

export function EpicPlanBar({ id, title, icon, color, onClick }: EpicPlanBarProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: epicTimelineDraggableId(id),
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (isDragging) return;
        onClick?.();
      }}
      className={cn(
        "relative z-10 flex h-9 w-full min-w-0 cursor-grab items-center overflow-hidden rounded-md text-[13px] font-semibold text-white shadow-md ring-1 ring-black/15 active:cursor-grabbing",
        isDragging && "z-50 opacity-60",
      )}
      style={{
        backgroundColor: color,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      <span className="min-w-0 flex-1 truncate px-2.5 text-center">
        {icon ? <span className="mr-1">{icon}</span> : null}
        {title}
      </span>
    </div>
  );
}
