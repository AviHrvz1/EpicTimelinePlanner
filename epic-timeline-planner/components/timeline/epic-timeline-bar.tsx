"use client";

import { useDraggable } from "@dnd-kit/core";

import { initiativeTimelineDraggableId } from "@/lib/epic-dnd-ids";
import { cn } from "@/lib/utils";

type InitiativeTimelineBarProps = {
  id: string;
  title: string;
  color: string;
  progressPercent?: number;
  progressLabel?: string;
  isResizing?: boolean;
  onClick?: () => void;
};

export function InitiativeTimelineBar({
  id,
  title,
  color,
  progressPercent = 0,
  progressLabel,
  isResizing,
  onClick,
}: InitiativeTimelineBarProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: initiativeTimelineDraggableId(id),
    disabled: Boolean(isResizing),
  });
  const safeProgress = Math.max(0, Math.min(100, progressPercent));

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={`${title} — drag to move on timeline`}
      onClick={() => {
        if (isDragging || isResizing) return;
        onClick?.();
      }}
      className={cn(
        "relative z-20 space-y-0",
        isDragging && "z-50 opacity-60",
      )}
      style={{
        transform:
          transform && !isResizing
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      <div
        className={cn(
          "relative z-10 flex h-9 w-full min-w-0 cursor-grab items-center overflow-hidden rounded-md text-[13px] font-semibold text-white shadow-lg ring-1 ring-black/15 active:cursor-grabbing",
          isResizing && "cursor-ew-resize",
        )}
        style={{ backgroundColor: color }}
      >
        <span className="relative z-10 min-w-0 flex-1 truncate px-3 text-center">{title}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 px-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-slate-100 ring-1 ring-slate-200/80">
          <div
            className="h-full rounded-[3px] transition-all"
            style={{
              width: `${safeProgress}%`,
              backgroundColor: "#eab308",
            }}
            aria-hidden
          />
        </div>
        <span
          className="shrink-0 text-[10px] font-semibold text-slate-500"
          title={progressLabel}
        >
          {safeProgress}%
        </span>
      </div>
    </div>
  );
}
