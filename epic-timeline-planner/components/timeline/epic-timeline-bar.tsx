"use client";

import { useDraggable } from "@dnd-kit/core";
import { X } from "lucide-react";

import {
  type GanttTimelineBarDragData,
  epicTimelineDraggableId,
} from "@/lib/epic-dnd-ids";
import { cn } from "@/lib/utils";

const ganttBarTooltipClass =
  "pointer-events-none absolute left-2 top-0 z-[200] -translate-y-[calc(100%+6px)] whitespace-nowrap rounded-lg border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/40 px-2.5 py-1.5 text-[12px] font-medium text-slate-700 opacity-0 shadow-md ring-1 ring-indigo-100/70 backdrop-blur-sm transition-opacity duration-150 group-hover/bar:opacity-100";

/** Fills DragOverlay bounds so the preview lines up with the real Gantt bar. */
export function TimelineBarDragPreview({
  title,
  color,
  progressPercent,
  progressLabel,
}: {
  title: string;
  color: string;
  progressPercent: number;
  progressLabel?: string;
}) {
  const safeProgress = Math.max(0, Math.min(100, progressPercent));
  return (
    <div className="flex h-full w-full flex-col space-y-0">
      <div
        className="relative z-10 flex h-9 w-full min-w-0 cursor-grabbing items-center overflow-hidden rounded-md text-[13px] font-semibold text-white shadow-lg ring-1 ring-black/15"
        style={{ backgroundColor: color }}
      >
        <span className="relative z-10 min-w-0 flex-1 truncate px-3 text-left antialiased">
          {title}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 px-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-slate-100 ring-1 ring-slate-200/80">
          <div
            className="h-full rounded-[3px] bg-gradient-to-r from-emerald-400 to-violet-500"
            style={{ width: `${safeProgress}%` }}
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

type InitiativeTimelineBarProps = {
  id: string;
  title: string;
  color: string;
  progressPercent?: number;
  progressLabel?: string;
  isResizing?: boolean;
  onClick?: () => void;
  /** Brief neon highlight (left accordion → Gantt); `emphasizeTick` restarts CSS when re-triggered. */
  emphasizeFlash?: boolean;
  emphasizeTick?: number;
};

export function InitiativeTimelineBar({
  id,
  title,
  color,
  progressPercent = 0,
  progressLabel,
  isResizing,
  onClick,
  emphasizeFlash = false,
  emphasizeTick = 0,
}: InitiativeTimelineBarProps) {
  const safeProgress = Math.max(0, Math.min(100, progressPercent));

  return (
    <div
      title={title}
      onClick={() => {
        if (isResizing) return;
        onClick?.();
      }}
      className="group/bar relative z-20 space-y-0"
    >
      <div role="tooltip" className={ganttBarTooltipClass}>
        {title}
      </div>
      <div
        className={cn(
          "relative z-10 flex h-9 w-full min-w-0 items-center overflow-hidden rounded-md text-[13px] font-semibold text-white",
          emphasizeFlash
            ? "ring-1 ring-white/20"
            : "shadow-lg ring-1 ring-black/15",
          isResizing && "cursor-ew-resize",
        )}
        style={{ backgroundColor: color }}
      >
        {emphasizeFlash ? (
          <div
            key={emphasizeTick}
            className="pointer-events-none absolute inset-0 z-[5] rounded-[inherit] animate-initiative-bar-emphasis-sheen"
            aria-hidden
          />
        ) : null}
        <span
          className={cn(
            "relative z-10 min-w-0 flex-1 truncate px-3 text-left antialiased",
            emphasizeFlash && "[text-shadow:0_1px_3px_rgba(0,0,0,0.32)]",
          )}
        >
          {title}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 px-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-slate-100 ring-1 ring-slate-200/80">
          <div
            className="h-full rounded-[3px] bg-gradient-to-r from-emerald-400 to-violet-500 transition-all"
            style={{ width: `${safeProgress}%` }}
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

type EpicPlanTimelineBarProps = {
  id: string;
  title: string;
  color: string;
  progressPercent?: number;
  progressLabel?: string;
  isResizing?: boolean;
  onClick?: () => void;
  onUnschedule?: () => void;
  emphasizeFlash?: boolean;
  emphasizeTick?: number;
};

/** Draggable epic plan bar (month / quarter timeline); uses `epicTimelineDraggableId`. */
export function EpicPlanTimelineBar({
  id,
  title,
  color,
  progressPercent = 0,
  progressLabel,
  isResizing,
  onClick,
  onUnschedule,
  emphasizeFlash = false,
  emphasizeTick = 0,
}: EpicPlanTimelineBarProps) {
  const safeProgress = Math.max(0, Math.min(100, progressPercent));
  const dragData = {
    kind: "gantt-timeline-bar",
    title,
    color,
    progressPercent: safeProgress,
    progressLabel,
  } satisfies GanttTimelineBarDragData;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: epicTimelineDraggableId(id),
    disabled: Boolean(isResizing),
    data: dragData,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={title}
      onClick={() => {
        if (isDragging || isResizing) return;
        onClick?.();
      }}
      className={cn(
        "group/bar relative z-20 space-y-0",
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
      <div role="tooltip" className={ganttBarTooltipClass}>
        {title}
      </div>
      <div
        className={cn(
          "relative z-10 flex h-9 w-full min-w-0 cursor-grab items-center overflow-hidden rounded-md text-[13px] font-semibold text-white active:cursor-grabbing",
          emphasizeFlash
            ? "ring-1 ring-white/20"
            : "shadow-lg ring-1 ring-black/15",
          isResizing && "cursor-ew-resize",
        )}
        style={{ backgroundColor: color }}
      >
        {onUnschedule ? (
          <button
            type="button"
            aria-label="Unschedule epic"
            title="Move epic to unscheduled backlog"
            className="pointer-events-none absolute right-2 top-0.5 z-[60] inline-flex size-4.5 items-center justify-center rounded-full bg-white/20 text-white opacity-0 ring-1 ring-white/40 transition duration-150 group-hover/bar:pointer-events-auto group-hover/bar:opacity-100 hover:bg-white/30"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onUnschedule();
            }}
          >
            <X className="size-3" strokeWidth={2.5} aria-hidden />
          </button>
        ) : null}
        {emphasizeFlash ? (
          <div
            key={emphasizeTick}
            className="pointer-events-none absolute inset-0 z-[5] rounded-[inherit] animate-initiative-bar-emphasis-sheen"
            aria-hidden
          />
        ) : null}
        <span
          className={cn(
            "relative z-10 min-w-0 flex-1 truncate px-3 text-left antialiased",
            emphasizeFlash && "[text-shadow:0_1px_3px_rgba(0,0,0,0.32)]",
          )}
        >
          {title}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 px-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-slate-100 ring-1 ring-slate-200/80">
          <div
            className="h-full rounded-[3px] bg-gradient-to-r from-emerald-400 to-violet-500 transition-all"
            style={{ width: `${safeProgress}%` }}
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
