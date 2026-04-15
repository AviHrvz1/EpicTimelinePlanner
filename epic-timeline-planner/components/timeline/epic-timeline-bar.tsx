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
  const progressTone =
    safeProgress >= 67 ? "bg-emerald-500" : safeProgress >= 34 ? "bg-amber-500" : "bg-rose-500";

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
        "relative z-10 flex h-9 w-full min-w-0 cursor-grab items-center overflow-hidden rounded-md text-[13px] font-semibold text-white shadow-lg ring-1 ring-black/15 active:cursor-grabbing",
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
      <span className="relative z-10 min-w-0 flex-1 truncate px-3 text-center">{title}</span>
      <span
        className="relative z-10 mr-2 rounded bg-black/25 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white/95 ring-1 ring-white/20"
        title={progressLabel}
      >
        {safeProgress}%
      </span>
      <div className="pointer-events-none absolute right-2 bottom-1 left-2 h-1.5 overflow-hidden rounded-full bg-black/20 ring-1 ring-white/25">
        <div
          className={cn("h-full rounded-full", progressTone)}
          style={{
            width: `${safeProgress}%`,
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,0.35) 0 4px, rgba(255,255,255,0.08) 4px 8px)",
          }}
          aria-hidden
        />
      </div>
    </div>
  );
}
