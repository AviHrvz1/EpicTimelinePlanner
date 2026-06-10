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
function GanttBarTooltip({
  label,
  anchorRef,
  icon,
  dateRange,
}: {
  label: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Emoji or icon glyph to show alongside the title. Renders the default folder
   *  glyph (via EpicPlanBarIcon) when the value is null/undefined. */
  icon?: string | null;
  /** Pre-formatted start–end date range, e.g. "Mar 1 – Apr 15". Omit to skip. */
  dateRange?: string | null;
}) {
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
      <div className="flex items-center gap-1.5">
        <EpicPlanBarIcon icon={icon} className="mr-0 size-3.5 [&_svg]:size-3 [&_svg]:text-slate-500" />
        <span className="font-semibold text-slate-800">{label}</span>
      </div>
      {dateRange ? (
        <div className="mt-0.5 text-[11px] font-medium text-slate-500">{dateRange}</div>
      ) : null}
    </div>,
    document.body,
  );
}

/** Formats a (year, month1, day) tuple as e.g. "Mar 1". Returns null for incomplete input. */
function fmtMonthDay(year: number | null | undefined, month1: number | null | undefined, day: number | null | undefined): string | null {
  if (year == null || month1 == null) return null;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = monthNames[month1 - 1];
  if (!m) return null;
  if (day == null) return m;
  return `${m} ${day}`;
}

/** Builds the "Mar 1 – Apr 15" line. Collapses to a single date when start==end. */
export function buildGanttBarDateRange(
  startYear: number | null | undefined,
  startMonth: number | null | undefined,
  startDay: number | null | undefined,
  endYear: number | null | undefined,
  endMonth: number | null | undefined,
  endDay: number | null | undefined,
): string | null {
  const start = fmtMonthDay(startYear, startMonth, startDay);
  const end = fmtMonthDay(endYear, endMonth, endDay);
  if (!start && !end) return null;
  if (start && end) {
    if (start === end) return start;
    return `${start} – ${end}`;
  }
  return start ?? end ?? null;
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
        backgroundColor: `color-mix(in srgb, ${color} 78%, white)`,
        backgroundImage: `linear-gradient(to right, transparent 0%, transparent ${Math.max(0, safeProgress - 0.5)}%, rgba(255,255,255,0.35) ${Math.min(100, safeProgress + 0.5)}%, rgba(255,255,255,0.35) 100%)`,
        borderColor: `color-mix(in srgb, ${color} 78%, white)`,
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

/**
 * Visual decoration that surfaces overdue-epic slippage AS A LAYER ON
 * TOP OF the plan bar, without modifying it. Renders two pieces, both
 * absolutely positioned so the caller can drop this inside the bar's
 * wrapper without affecting layout:
 *
 *   1. **Ghost extension** — a striped, semi-transparent strip extending
 *      to the right of the bar's right edge. Length = how far the
 *      projected real end overshoots the planned end. The stripe pattern
 *      reads visually as "outside the plan" (not a regular bar).
 *   2. **Slip icon (⚠)** — a small badge sitting at the far right of the
 *      ghost (or at the bar's right edge if there's no ghost), centered
 *      vertically. Hovering shows days past plan + projected ship.
 *
 * `ghostPct` is the ghost's width expressed as a PERCENTAGE OF THE
 * BAR'S WRAPPER WIDTH. So `ghostPct=50` means "ghost is half as long
 * as the planned bar." Caller computes this from
 * `(projectedDaysLeft / barPlanDays) * 100` so each day visually scales
 * the same regardless of the bar's column span.
 *
 * The bar wrapper MUST have `overflow: visible` (the default) for the
 * ghost to extend past its right edge.
 */
/** Instant portal-based tooltip for the slip icon. Avoids the native
 *  `title` attribute's ~500ms browser delay so hovering the small ⚠
 *  glyph reveals the message immediately. Renders into `document.body`
 *  via a portal so the chip is never clipped by ancestor `overflow`. */
function SlipIconTooltip({ anchorRef, text }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  text: string;
}) {
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
    el.addEventListener("focus", show);
    el.addEventListener("blur", hide);
    return () => {
      el.removeEventListener("mouseenter", show);
      el.removeEventListener("mouseleave", hide);
      el.removeEventListener("focus", show);
      el.removeEventListener("blur", hide);
    };
  }, [anchorRef, show, hide]);
  if (!pos || typeof document === "undefined") return null;
  return createPortal(
    <div
      role="tooltip"
      style={{ left: pos.x, top: pos.y - 8, transform: "translate(-50%, -100%)" }}
      className="pointer-events-none fixed z-[99999] whitespace-nowrap rounded-lg border border-rose-200/80 bg-white/95 px-2.5 py-1 text-[12px] font-medium text-rose-800 shadow-md ring-1 ring-rose-100/70 backdrop-blur-sm"
    >
      {text}
    </div>,
    document.body,
  );
}

export function OverdueSlipDecoration({
  severity,
  ghostPct,
  daysPastPlan,
  projectedDaysLeft,
  compact = false,
  fillMode = "extend",
  label,
}: {
  severity: "amber" | "red";
  ghostPct: number;
  daysPastPlan: number;
  projectedDaysLeft: number;
  /** Match the parent `EpicPlanTimelineBar`'s `compact` flag — drives
   *  the bar's height (28px vs 30px) so the ghost + icon land at the
   *  bar's true vertical center instead of the wrapper's (which is
   *  taller when a badge row is rendered below the bar). */
  compact?: boolean;
  /** Layout mode:
   *  - `"extend"` (default): ghost extends to the RIGHT of the bar's
   *    wrapper, width = `ghostPct%` of wrapper. Used by overdue epics
   *    that still have a planned bar in the visible quarter.
   *  - `"fill"`: ghost FILLS the wrapper itself (left: 0, right: 0);
   *    no solid bar is drawn — used by quarter-drilled views to
   *    surface slipped epics whose plan ended in a PRIOR quarter but
   *    whose work is still in flight in the focused one. The slip
   *    icon then sits at the wrapper's right edge.
   */
  fillMode?: "extend" | "fill";
  /** Epic title rendered inside the ghost in `fill` mode — without a
   *  solid bar there's no other place for it to appear, so the planner
   *  needs to know WHICH slipped epic this stripe represents. Ignored
   *  in `extend` mode (the bar carries the title there). */
  label?: string;
}) {
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const showGhost = fillMode === "fill" || ghostPct > 0;
  const stripe = severity === "red"
    ? "repeating-linear-gradient(135deg, rgba(239,68,68,0.55) 0 4px, rgba(254,226,226,0.65) 4px 8px)"
    : "repeating-linear-gradient(135deg, rgba(245,158,11,0.55) 0 4px, rgba(254,243,199,0.65) 4px 8px)";
  const iconColor = severity === "red" ? "#dc2626" : "#b45309";
  const iconBorder = severity === "red" ? "#dc2626" : "#f59e0b";
  const tooltip =
    projectedDaysLeft > 0
      ? `${daysPastPlan}d past plan · ~${projectedDaysLeft}d projected to ship`
      : `${daysPastPlan}d past plan — no daysLeft on open stories`;
  // Anchor everything to the BAR's top + height, not the wrapper's
  // center. The wrapper can extend below the bar (Overdue / health
  // pills are rendered as siblings beneath it) — `top: 50%` of the
  // wrapper would land on that badge row, not the bar.
  const barHeight = compact ? 28 : 30;
  const barCenterPx = barHeight / 2;
  // Geometry differs per mode:
  //  - "extend": ghost starts at the bar's right edge (left:100%), grows right.
  //  - "fill":   ghost fills the wrapper (left:0, right:0); icon at wrapper's right edge.
  const ghostStyleExtend = {
    left: "100%",
    top: 0,
    height: barHeight,
    width: `${Math.min(300, ghostPct)}%`,
    background: stripe,
  } as const;
  const ghostStyleFill = {
    left: 0,
    right: 0,
    top: 0,
    height: barHeight,
    background: stripe,
  } as const;
  // Icon positioning:
  //  - `fill` mode: icon sits AT the wrapper's right edge, padded
  //    inward by its own width + 4px so it stays fully inside the
  //    visible cell.
  //  - `extend` + ghost present: icon sits AT the ghost's right edge,
  //    padded inward similarly so the glyph never clips when the
  //    ghost reaches the column boundary.
  //  - `extend` + no ghost: icon sits JUST PAST the bar's right edge
  //    (2px), the same as before — there's no overflow risk because
  //    the bar always ends inside the cell.
  const ICON_BOX_PX = 20; // size-5 = 20px hit area
  const PADDING_PX = 4;
  const iconLeft = fillMode === "fill"
    ? `calc(100% - ${ICON_BOX_PX + PADDING_PX}px)`
    : showGhost
      ? `calc(100% + ${Math.min(300, ghostPct)}% - ${ICON_BOX_PX + PADDING_PX}px)`
      : "100%";
  const iconTransform = (fillMode === "fill" || showGhost)
    ? "translateY(-50%)"
    : "translate(2px, -50%)";
  return (
    <>
      {showGhost ? (
        <div
          aria-hidden
          // Square corners on left/top/bottom so the ghost flows
          // seamlessly out of the bar's right edge (no visible seam).
          className="pointer-events-none absolute z-10 opacity-70"
          style={fillMode === "fill" ? ghostStyleFill : ghostStyleExtend}
        />
      ) : null}
      {fillMode === "fill" && label ? (
        <span
          // Title rendered ABOVE the ghost stripes so the planner can
          // tell which slipped epic the row represents. Slate colour +
          // text-shadow keeps it readable against the stripe pattern.
          className="pointer-events-none absolute z-20 inline-flex items-center px-2 text-[12px] font-medium text-slate-800"
          style={{
            left: 0,
            top: 0,
            height: barHeight,
            maxWidth: "calc(100% - 28px)",
            textShadow: "0 1px 0 rgba(255,255,255,0.85)",
          }}
        >
          <span className="truncate">{label}</span>
        </span>
      ) : null}
      {/* Hit area is a `size-5` (20px) span wrapping a centered 16px
       *  glyph — bigger target = easier to hover. The visible disc is
       *  preserved via the inner span. */}
      <span
        ref={iconRef}
        aria-label={tooltip}
        tabIndex={0}
        className="pointer-events-auto absolute z-30 inline-flex size-5 items-center justify-center"
        style={{
          left: iconLeft,
          top: barCenterPx,
          transform: iconTransform,
        }}
      >
        <span
          className="inline-flex size-4 items-center justify-center rounded-full bg-white text-[10px] font-bold leading-none shadow-sm"
          style={{
            color: iconColor,
            border: `1.5px solid ${iconBorder}`,
          }}
        >
          ⚠
        </span>
        <SlipIconTooltip anchorRef={iconRef} text={tooltip} />
      </span>
    </>
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
  /** Workflow rollup status (To do / In progress / Review / Done) —
   *  initiative-level rollup of every child story's workflow status.
   *  Renders as an `EpicStatusBadge` instead of the health badge when
   *  the caller has decided status is the active label lane (the planner
   *  clicked a Work Progress slice). Mutually exclusive with
   *  `healthStatus` at the call site — the parent picks one. */
  workflowStatus?: UserStoryItem["status"] | null;
  /** Optional team-assignment pill rendered below the bar (same pattern as
   *  the epic bar) when the toolbar's Teams toggle is on. */
  teamAssignmentChip?: { label: string; className: string; slug: string | null } | null;
  /** Pre-formatted "Mar 1 – Apr 15" range, shown on the hover tooltip. */
  tooltipDateRange?: string | null;
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
  onDelete,
  onDeleteLabel = "Move to backlog",
  onInsightsClick,
  healthStatus = null,
  healthTooltip,
  workflowStatus = null,
  teamAssignmentChip = null,
  tooltipDateRange = null,
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
      <GanttBarTooltip label={title} anchorRef={barRef} icon={icon} dateRange={tooltipDateRange} />
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
          // Soften the raw initiative color with 22% white so the bar reads
          // as a polished pastel instead of a saturated swatch — same
          // identity, much less candy-bright.
          backgroundColor: `color-mix(in srgb, ${color} 78%, white)`,
          // Bar itself is the progress meter — solid color on the left, a
          // white-tinted (lighter) version of the same color on the right,
          // with a 2% soft transition for a polished look.
          backgroundImage: showProgress
            ? `linear-gradient(to right, transparent 0%, transparent ${Math.max(0, safeProgress - 0.5)}%, rgba(255,255,255,0.35) ${Math.min(100, safeProgress + 0.5)}%, rgba(255,255,255,0.35) 100%)`
            : undefined,
          borderColor: showProgress ? `color-mix(in srgb, ${color} 78%, white)` : undefined,
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
      {(showProgress && (healthStatus || workflowStatus)) || teamAssignmentChip ? (
        <div className="-mb-1.5 mt-0.5 flex items-center justify-between gap-2 px-1">
          {showProgress && workflowStatus ? (
            <EpicStatusBadge
              status={workflowStatus}
              isOverdue={false}
              tooltip={healthTooltip}
              onClick={onInsightsClick}
            />
          ) : showProgress && healthStatus ? (
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
  /** Calendar days past the epic's plan-end. Drives the overdue-severity
   *  border treatment: 0 = none; 1–7 = amber border; >7 = red border.
   *  Independent of `isOverdue` so the bar can render the badge without
   *  the border (or vice-versa). When omitted/0, no border is applied. */
  daysPastPlan?: number;
  /** Pre-formatted "Mar 1 – Apr 15" range, shown on the hover tooltip. Use
   *  `buildGanttBarDateRange` from this module to format consistently. */
  tooltipDateRange?: string | null;
  /** When true, fades the bar to a muted opacity — used by cross-mode
   *  highlight filters (e.g. Portfolio Burndown's "highlight laggards on
   *  Roadmap" flow) to surface a subset while keeping the rest of the
   *  plan visible as context. Defaults to false; no visual change. */
  dimmed?: boolean;
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
  daysPastPlan = 0,
  tooltipDateRange = null,
  dimmed = false,
}: EpicPlanTimelineBarProps) {
  const safeProgress = Math.max(0, Math.min(100, progressPercent));
  const lightBg = isLightColor(color);
  // Severity-borne border for overdue bars:
  //  - 1–7 days late → amber: "drifting"
  //  - >7 days late  → red:   "deeply past plan"
  // The default bar border is the existing soft-tint of `color`; we
  // OVERRIDE it (not augment) so the slippage signal is visually
  // dominant. `borderWidth: 2` lifts the line clear of the bar's
  // background tint at small bar heights.
  const overdueSeverity: "amber" | "red" | null =
    daysPastPlan <= 0 ? null : daysPastPlan > 7 ? "red" : "amber";
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
        "group/bar relative z-20 space-y-0 transition-opacity duration-150",
        isDragging && "opacity-0",
        dimmed && !isDragging && "opacity-30 saturate-50 hover:opacity-60",
      )}
      style={{
        transform:
          transform && !isResizing
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      <GanttBarTooltip label={title} anchorRef={barRef} icon={icon} dateRange={tooltipDateRange} />
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
          (showProgress || overdueSeverity != null) && "border",
          overdueSeverity != null && "border-2",
          isResizing && "cursor-ew-resize",
        )}
        style={{
          // Soften the raw initiative color with 22% white so the bar reads
          // as a polished pastel instead of a saturated swatch — same
          // identity, much less candy-bright.
          backgroundColor: `color-mix(in srgb, ${color} 78%, white)`,
          backgroundImage: showProgress
            ? `linear-gradient(to right, transparent 0%, transparent ${Math.max(0, safeProgress - 0.5)}%, rgba(255,255,255,0.35) ${Math.min(100, safeProgress + 0.5)}%, rgba(255,255,255,0.35) 100%)`
            : undefined,
          // Border priority: overdue severity overrides the soft color
          // tint so slippage reads at a glance. Amber for 1–7 days,
          // red for >7 — same threshold the banner uses.
          borderColor:
            overdueSeverity === "red"
              ? "#dc2626"
              : overdueSeverity === "amber"
                ? "#f59e0b"
                : showProgress
                  ? `color-mix(in srgb, ${color} 78%, white)`
                  : undefined,
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
