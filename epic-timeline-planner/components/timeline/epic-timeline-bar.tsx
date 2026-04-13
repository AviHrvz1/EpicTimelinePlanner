"use client";

import { useDraggable } from "@dnd-kit/core";

import { initiativeTimelineDraggableId } from "@/lib/epic-dnd-ids";
import { cn } from "@/lib/utils";

type InitiativeTimelineBarProps = {
  id: string;
  title: string;
  color: string;
  isResizing?: boolean;
  onClick?: () => void;
};

export function InitiativeTimelineBar({
  id,
  title,
  color,
  isResizing,
  onClick,
}: InitiativeTimelineBarProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: initiativeTimelineDraggableId(id),
    disabled: Boolean(isResizing),
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (isDragging || isResizing) return;
        onClick?.();
      }}
      className={cn(
        "relative z-10 flex h-9 w-full min-w-0 cursor-grab items-center overflow-hidden rounded-md text-xs font-semibold text-white shadow-lg ring-1 ring-black/15 active:cursor-grabbing",
        isDragging && "z-50 opacity-60",
        isResizing && "cursor-ew-resize",
      )}
      style={{
        backgroundColor: color,
        transform:
          transform && !isResizing
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      <span className="min-w-0 flex-1 truncate px-3 text-center">{title}</span>
    </div>
  );
}
