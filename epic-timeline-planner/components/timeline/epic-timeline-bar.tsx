"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDraggable } from "@dnd-kit/core";
import { X } from "lucide-react";

import {
  type GanttTimelineBarDragData,
  epicTimelineDraggableId,
} from "@/lib/epic-dnd-ids";
import { cn } from "@/lib/utils";
import { EpicPlanBarIcon, InitiativePlanBarIcon } from "@/components/timeline/epic-plan-bar";

/** Portal tooltip that always renders above everything via fixed positioning. */
function GanttBarTooltip({ label, anchorRef }: { label: string; anchorRef: React.RefObject<HTMLElement | null> }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.top });
  }, [anchorRef]);

  const hide = useCallback(() => setPos(null), []);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    el.addEventListener("mouseenter", show);
    el.addEventListener("mouseleave", hide);
    return () => {
      el.removeEventListener("mouseenter", show);
      el.removeEventListener("mouseleave", hide);
    };
  }, [anchorRef, show, hide]);

  if (!pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="tooltip"
      style={{ left: pos.x, top: pos.y - 6, transform: "translate(-50%, -100%)" }}
      className="pointer-events-none fixed z-[99999] whitespace-nowrap rounded-lg border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/40 px-2.5 py-1.5 text-[12px] font-medium text-slate-700 shadow-md ring-1 ring-indigo-100/70 backdrop-blur-sm"
    >
      {label}
    </div>,
    document.body,
  );
}

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
        className="relative z-10 flex h-8 w-full min-w-0 cursor-grabbing items-center overflow-hidden rounded-md text-[13px] font-medium tracking-[0.01em] text-white shadow-lg ring-1 ring-black/15"
        style={{ backgroundColor: color }}
      >
        <span className="relative z-10 min-w-0 flex-1 truncate px-3 text-left antialiased [text-shadow:0_1px_1px_rgba(0,0,0,0.22)]">
          {title}
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 px-2">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-slate-100 ring-1 ring-slate-200/80">
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
  icon?: string | null;
  color: string;
  progressPercent?: number;
  progressLabel?: string;
  isResizing?: boolean;
  onClick?: () => void;
  /** Brief neon highlight (left accordion → Gantt); `emphasizeTick` restarts CSS when re-triggered. */
  emphasizeFlash?: boolean;
  emphasizeTick?: number;
  showProgress?: boolean;
  /** Renders at the start of the progress row (below the title strip), not on the colored title row. */
  progressRowPrefix?: ReactNode;
};

export function InitiativeTimelineBar({
  id,
  title,
  icon,
  color,
  progressPercent = 0,
  progressLabel,
  isResizing,
  onClick,
  emphasizeFlash = false,
  emphasizeTick = 0,
  showProgress = true,
  progressRowPrefix,
}: InitiativeTimelineBarProps) {
  const safeProgress = Math.max(0, Math.min(100, progressPercent));
  const barRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={barRef}
      title={title}
      onClick={() => {
        if (isResizing) return;
        onClick?.();
      }}
      className="group/bar relative z-20 overflow-visible space-y-0"
    >
      <GanttBarTooltip label={title} anchorRef={barRef} />
      <div
        className={cn(
          "relative z-10 flex h-8 w-full min-w-0 items-center overflow-hidden rounded-md text-[13px] font-medium tracking-[0.01em] text-white",
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
            "relative z-10 flex min-w-0 flex-1 items-center gap-1 px-3 text-left antialiased",
            emphasizeFlash
              ? "[text-shadow:0_1px_3px_rgba(0,0,0,0.32)]"
              : "[text-shadow:0_1px_1px_rgba(0,0,0,0.22)]",
          )}
        >
          <InitiativePlanBarIcon icon={icon} className="mr-0 text-[12px] [&_svg]:size-3.5 [&_svg]:text-blue-200/95" />
          <span className="min-w-0 truncate">{title}</span>
        </span>
      </div>
      <div
        className={cn(
          "mt-0.5 flex min-w-0 items-center gap-1.5 px-2",
          showProgress ? "visible" : "invisible pointer-events-none",
        )}
        aria-hidden={!showProgress}
      >
        {progressRowPrefix ? (
          <span className="pointer-events-none flex min-w-0 shrink-0 items-center">{progressRowPrefix}</span>
        ) : null}
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-slate-100 ring-1 ring-slate-200/80">
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
  icon?: string | null;
  hideIcon?: boolean;
  color: string;
  progressPercent?: number;
  progressLabel?: string;
  isResizing?: boolean;
  onClick?: () => void;
  onUnschedule?: () => void;
  emphasizeFlash?: boolean;
  emphasizeTick?: number;
  compact?: boolean;
  showProgress?: boolean;
  /** Renders at the start of the progress row (below the epic title strip), not on the colored title row. */
  progressRowPrefix?: ReactNode;
  /** Small pill after the title: delivery team assignment (Gantt middle panel). */
  teamAssignmentChip?: { label: string; className: string } | null;
};

/** Draggable epic plan bar (month / quarter timeline); uses `epicTimelineDraggableId`. */
export function EpicPlanTimelineBar({
  id,
  title,
  icon,
  hideIcon = false,
  color,
  progressPercent = 0,
  progressLabel,
  isResizing,
  onClick,
  onUnschedule,
  emphasizeFlash = false,
  emphasizeTick = 0,
  compact = false,
  showProgress = true,
  progressRowPrefix,
  teamAssignmentChip = null,
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
  const barRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={(node) => { setNodeRef(node); (barRef as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
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
      <GanttBarTooltip label={title} anchorRef={barRef} />
      <div
        className={cn(
          "relative z-10 flex w-full min-w-0 cursor-grab items-center overflow-hidden rounded-md font-medium tracking-[0.01em] text-white active:cursor-grabbing",
          compact ? "h-7 text-[13px]" : "h-8 text-[13px]",
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
            "relative z-10 flex min-w-0 flex-1 items-center gap-1.5 text-left antialiased",
            compact ? "px-2" : "px-3",
            emphasizeFlash
              ? "[text-shadow:0_1px_3px_rgba(0,0,0,0.32)]"
              : "[text-shadow:0_1px_1px_rgba(0,0,0,0.22)]",
          )}
        >
          {!hideIcon ? (
            <EpicPlanBarIcon icon={icon} className="mr-0 text-[12px] [&_svg]:size-3.5 [&_svg]:text-white/95" />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {teamAssignmentChip ? (
            <span className={teamAssignmentChip.className} title={teamAssignmentChip.label}>
              {teamAssignmentChip.label}
            </span>
          ) : null}
        </span>
      </div>
      <div
        className={cn(
          "flex min-w-0 items-center gap-1.5 px-2",
          compact ? "mt-0.25" : "mt-0.5",
          showProgress ? "visible" : "invisible pointer-events-none",
        )}
        aria-hidden={!showProgress}
      >
        {progressRowPrefix ? (
          <span className="pointer-events-none flex min-w-0 shrink-0 items-center">{progressRowPrefix}</span>
        ) : null}
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-slate-100 ring-1 ring-slate-200/80">
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
