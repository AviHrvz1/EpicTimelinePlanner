"use client";

import { useDraggable } from "@dnd-kit/core";
import { Folder } from "lucide-react";

import { epicTimelineDraggableId } from "@/lib/epic-dnd-ids";
import { cn } from "@/lib/utils";

function EpicBarIcon({ icon }: { icon?: string | null }) {
  const raw = icon?.trim();
  if (raw && raw !== "📁") {
    return <span className="mr-1">{raw}</span>;
  }
  return (
    <span className="mr-1 inline-flex size-4 shrink-0 items-center justify-center text-white/95" aria-hidden>
      <Folder className="size-3.5" strokeWidth={2} />
    </span>
  );
}

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
        <EpicBarIcon icon={icon} />
        {title}
      </span>
    </div>
  );
}
