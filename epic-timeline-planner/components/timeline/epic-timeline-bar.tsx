"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDraggable } from "@dnd-kit/core";
import { Users, X } from "lucide-react";

import {
  type GanttTimelineBarDragData,
  epicTimelineDraggableId,
} from "@/lib/epic-dnd-ids";
import type { HealthStatus } from "@/lib/progress";
import type { UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EpicPlanBarIcon, InitiativePlanBarIcon } from "@/components/timeline/epic-plan-bar";
import { EpicStatusBadge, HealthBadge } from "@/components/timeline/health-badge";
import { TeamAvatar } from "@/components/ui/team-avatar";

function isLightColor(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.58;
}

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
  icon,
  progressPercent,
  progressLabel,
}: {
  title: string;
  color: string;
  icon?: string | null;
  progressPercent: number;
  progressLabel?: string;
}) {
  const safeProgress = Math.max(0, Math.min(100, progressPercent));
  const lightBg = isLightColor(color);
  return (
    <div
      className={cn(
        "relative z-10 flex h-8 w-full min-w-0 cursor-grabbing items-center overflow-hidden rounded-sm border text-[13px] font-medium tracking-[0.01em] shadow-lg ring-1 ring-black/15",
        lightBg ? "text-slate-900" : "text-white",
      )}
      style={{
        backgroundColor: color,
        backgroundImage: `linear-gradient(to right, transparent 0%, transparent ${Math.max(0, safeProgress - 0.5)}%, rgba(255,255,255,0.35) ${Math.min(100, safeProgress + 0.5)}%, rgba(255,255,255,0.35) 100%)`,
        borderColor: color,
      }}
    >
      <span className={cn("relative z-10 flex min-w-0 flex-1 items-center gap-1.5 px-3 text-left antialiased", lightBg ? "" : "[text-shadow:0_1px_1px_rgba(0,0,0,0.22)]")}>
        <EpicPlanBarIcon icon={icon} className={cn("mr-0 text-[12px] [&_svg]:size-3.5", lightBg ? "[&_svg]:text-slate-700" : "[&_svg]:text-white/95")} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span
          className="shrink-0 rounded-sm bg-white/30 px-1 py-px text-[10px] font-bold tabular-nums leading-none text-black [text-shadow:none]"
          title={progressLabel}
        >
          {safeProgress}%
        </span>
      </span>
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
  /** Optional "remove from Gantt" handler — renders an X chip on hover.
   *  The action is whatever the caller wires up (typically "move initiative
   *  back to backlog"); the chip is just a UI affordance. */
  onDelete?: () => void;
  /** Override the X chip's tooltip/aria-label (defaults to "Move to backlog"). */
  onDeleteLabel?: string;
  /** When set, a chart icon appears at the start of the progress row;
   * clicking it opens the insights view in a new tab (initiative scope). */
  onInsightsClick?: () => void;
  /** Work-based health verdict — renders a colored badge inside the bar when `showProgress`. */
  healthStatus?: HealthStatus | null;
  /** Tooltip shown on hover of the health badge; falls back to the status label. */
  healthTooltip?: string;
  /** Optional team-assignment pill rendered below the bar (same pattern as
   *  the epic bar) when the toolbar's Teams toggle is on. */
  teamAssignmentChip?: { label: string; className: string; slug: string | null } | null;
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
  showProgress = true,
  progressRowPrefix,
  onDelete,
  onDeleteLabel = "Move to backlog",
  onInsightsClick,
  healthStatus = null,
  healthTooltip,
  teamAssignmentChip = null,
}: InitiativeTimelineBarProps) {
  const safeProgress = Math.max(0, Math.min(100, progressPercent));
  const lightBg = isLightColor(color);
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
      {onDelete ? (
        <button
          type="button"
          aria-label={onDeleteLabel}
          title={onDeleteLabel}
          className="pointer-events-none absolute right-1 -top-1.5 z-[70] inline-flex size-4 items-center justify-center rounded-full bg-white opacity-0 shadow ring-1 ring-slate-300/80 transition duration-150 hover:bg-rose-50 hover:ring-rose-300 group-hover/bar:pointer-events-auto group-hover/bar:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <X className="size-2.5 text-slate-500 hover:text-rose-500" strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
      <div
        className={cn(
          "relative z-10 flex h-[30px] w-full min-w-0 items-center overflow-hidden rounded-sm text-[13px] font-medium tracking-[0.01em]",
          lightBg ? "text-slate-900" : "text-white",
          emphasizeFlash
            ? "ring-1 ring-white/20"
            : "shadow-lg ring-1 ring-black/15",
          showProgress && "border",
          isResizing && "cursor-ew-resize",
        )}
        style={{
          backgroundColor: color,
          // Bar itself is the progress meter — solid color on the left, a
          // white-tinted (lighter) version of the same color on the right,
          // with a 2% soft transition for a polished look.
          backgroundImage: showProgress
            ? `linear-gradient(to right, transparent 0%, transparent ${Math.max(0, safeProgress - 0.5)}%, rgba(255,255,255,0.35) ${Math.min(100, safeProgress + 0.5)}%, rgba(255,255,255,0.35) 100%)`
            : undefined,
          borderColor: showProgress ? color : undefined,
        }}
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
              : lightBg ? "" : "[text-shadow:0_1px_1px_rgba(0,0,0,0.22)]",
          )}
        >
          {/* Always render the canonical Zap glyph regardless of `icon` —
              matches the middle-panel treatment so initiative bars stay
              recognisable across the app even when a custom emoji is set. */}
          <InitiativePlanBarIcon icon={null} className={cn("mr-0 text-[12px] [&_svg]:size-3.5", lightBg ? "[&_svg]:text-slate-700" : "[&_svg]:text-blue-200/95")} />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {showProgress ? (
            <span
              className="shrink-0 rounded-sm bg-white/30 px-1 py-px text-[10px] font-bold tabular-nums leading-none text-black [text-shadow:none]"
              title={progressLabel}
            >
              {safeProgress}%
            </span>
          ) : null}
        </span>
      </div>
      {(showProgress && healthStatus) || teamAssignmentChip ? (
        <div className="-mb-1.5 mt-0.5 flex items-center justify-between gap-2 px-1">
          {showProgress && healthStatus ? (
            <HealthBadge
              status={healthStatus}
              tooltip={healthTooltip}
              onClick={onInsightsClick}
            />
          ) : <span />}
          {teamAssignmentChip ? (
            <span
              className={cn("inline-flex items-center gap-1", teamAssignmentChip.className)}
              title={teamAssignmentChip.label}
            >
              <TeamAvatar slug={teamAssignmentChip.slug} sizePx={10} className="opacity-90" fallback={<Users className="size-2.5 shrink-0 opacity-70" aria-hidden />} />
              <span className="truncate">{teamAssignmentChip.label}</span>
            </span>
          ) : null}
        </div>
      ) : null}
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
  teamAssignmentChip?: { label: string; className: string; slug: string | null } | null;
  /** When set, a chart icon appears at the start of the progress row;
   * clicking it opens the insights view in a new tab (epic scope). */
  onInsightsClick?: () => void;
  /** Work-based health verdict — renders a colored badge inside the bar when `showProgress`. */
  healthStatus?: HealthStatus | null;
  /** Tooltip shown on hover of the health badge; falls back to the status label. */
  healthTooltip?: string;
  /**
   * Epic's MANUAL status (whatever the planner set on the epic). When
   * provided, the bar swaps the synthetic health verdict for this status
   * pill — so a "Review / Testing" epic reads as Review, not Done, even
   * if every child story already shipped. Pair with `isOverdue` for past-
   * due epics that haven't been formally closed.
   */
  epicStatus?: UserStoryItem["status"] | null;
  /** True when today is past the epic's plan-end date AND `epicStatus` is
   *  not `done`. Renders an `Overdue` indicator next to the status pill. */
  isOverdue?: boolean;
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
  onInsightsClick,
  healthStatus = null,
  healthTooltip,
  epicStatus = null,
  isOverdue = false,
}: EpicPlanTimelineBarProps) {
  const safeProgress = Math.max(0, Math.min(100, progressPercent));
  const lightBg = isLightColor(color);
  const dragData = {
    kind: "gantt-timeline-bar",
    title,
    color,
    icon,
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
        isDragging && "opacity-0",
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
      {onUnschedule ? (
        <button
          type="button"
          aria-label="Unschedule epic"
          title="Move epic to unscheduled backlog"
          className="pointer-events-none absolute right-1 -top-1.5 z-[70] inline-flex size-4 items-center justify-center rounded-full bg-white opacity-0 shadow ring-1 ring-slate-300/80 transition duration-150 hover:bg-rose-50 hover:ring-rose-300 group-hover/bar:pointer-events-auto group-hover/bar:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onUnschedule();
          }}
        >
          <X className="size-2.5 text-slate-500 hover:text-rose-500" strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
      <div
        className={cn(
          "relative z-10 flex w-full min-w-0 cursor-grab items-center overflow-hidden rounded-sm font-medium tracking-[0.01em] active:cursor-grabbing",
          lightBg ? "text-slate-900" : "text-white",
          compact ? "h-[28px] text-[13px]" : "h-[30px] text-[13px]",
          emphasizeFlash
            ? "ring-1 ring-white/20"
            : "shadow-lg ring-1 ring-black/15",
          showProgress && "border",
          isResizing && "cursor-ew-resize",
        )}
        style={{
          backgroundColor: color,
          backgroundImage: showProgress
            ? `linear-gradient(to right, transparent 0%, transparent ${Math.max(0, safeProgress - 0.5)}%, rgba(255,255,255,0.35) ${Math.min(100, safeProgress + 0.5)}%, rgba(255,255,255,0.35) 100%)`
            : undefined,
          borderColor: showProgress ? color : undefined,
        }}
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
            "relative z-10 flex min-w-0 flex-1 items-center gap-1.5 text-left antialiased",
            compact ? "px-2" : "px-3",
            emphasizeFlash
              ? "[text-shadow:0_1px_3px_rgba(0,0,0,0.32)]"
              : lightBg ? "" : "[text-shadow:0_1px_1px_rgba(0,0,0,0.22)]",
          )}
        >
          {!hideIcon ? (
            <EpicPlanBarIcon icon={icon} className={cn("mr-0 text-[12px] [&_svg]:size-3.5", lightBg ? "[&_svg]:text-slate-700" : "[&_svg]:text-white/95")} />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {showProgress ? (
            <span
              className="shrink-0 rounded-sm bg-white/30 px-1 py-px text-[10px] font-bold tabular-nums leading-none text-black [text-shadow:none]"
              title={progressLabel}
            >
              {safeProgress}%
            </span>
          ) : null}
        </span>
      </div>
      {(showProgress && (epicStatus || isOverdue || healthStatus)) || teamAssignmentChip ? (
        <div className="-mb-1.5 mt-0.5 flex items-center justify-between gap-2 px-1">
          {showProgress && (epicStatus || isOverdue || healthStatus) ? (
            // The bar's badge row now carries up to two pills side-by-side:
            //   • Epic status (To do / In progress / Review / Done) — sourced
            //     from `epicStatus` (rolled up from child story statuses) so
            //     the planner sees the actual progression label, not just a
            //     synthetic verdict. If the epic is overdue, an `Overdue`
            //     indicator pins to the right of the status pill.
            //   • Health verdict (`HealthBadge`) — only renders when the bar
            //     is NOT overdue, since "Overdue" already preempts the
            //     `On Track / Watch / At Risk / Done` reading. This keeps the
            //     reschedule workflow honest: drag an overdue bar past today
            //     and the Overdue pill flips off; the HealthBadge appears in
            //     its place with the new verdict.
            <span className="inline-flex items-center gap-1">
              {epicStatus ? (
                <EpicStatusBadge
                  status={epicStatus}
                  isOverdue={isOverdue}
                  tooltip={healthTooltip}
                  onClick={onInsightsClick}
                />
              ) : null}
              {!isOverdue && healthStatus ? (
                <HealthBadge
                  status={healthStatus}
                  tooltip={healthTooltip}
                  onClick={onInsightsClick}
                />
              ) : null}
            </span>
          ) : <span />}
          {teamAssignmentChip ? (
            <span
              className={cn("inline-flex items-center gap-1", teamAssignmentChip.className)}
              title={teamAssignmentChip.label}
            >
              <TeamAvatar slug={teamAssignmentChip.slug} sizePx={10} className="opacity-90" fallback={<Users className="size-2.5 shrink-0 opacity-70" aria-hidden />} />
              <span className="truncate">{teamAssignmentChip.label}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
