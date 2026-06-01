"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertOctagon, AlertTriangle, Check, CheckCheck, GripHorizontal, X } from "lucide-react";

import type { HealthStatus, ProgressBasis, ProgressResult } from "@/lib/progress";
import { cn } from "@/lib/utils";

/**
 * Text label rendered beneath a Gantt bar — mirrors the team-assignment chip's
 * visual weight so the two read as siblings. When `onClick` is set the chip
 * becomes a button (used to open insights in place of the % click target).
 */
export function HealthBadge({
  status,
  tooltip,
  onClick,
  className,
  size = "sm",
}: {
  status: HealthStatus;
  tooltip?: string;
  onClick?: () => void;
  className?: string;
  /** "xs" is the most compact (used inside Sprint Load rows where vertical
   *  space is tight); "sm" (default) matches the inline Gantt chip; "md"
   *  matches the scope-panel user/team chips (text-[13px] / px-2.5 /
   *  py-1.5); "chip" matches the breadcrumb h-7 rounded-full pill family
   *  used by `SprintEndCountdown` and the Move/Jump chips. */
  size?: "xs" | "sm" | "md" | "chip";
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const sharedClass = cn(
    "inline-flex shrink-0 items-center font-semibold leading-none ring-1",
    size === "chip"
      ? "h-7 gap-1 rounded-full px-2.5 text-[11px] tracking-[0.02em] sm:gap-1.5 sm:px-3 sm:text-[12px]"
      : size === "md"
        ? "gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] shadow-sm font-medium"
        : size === "xs"
          ? "gap-0.5 rounded px-1.5 py-px text-[10px] font-medium"
          : "gap-1 rounded px-2 py-0.5 text-[12px] font-medium",
    meta.chip,
    onClick && "cursor-pointer transition-transform duration-150 hover:scale-105 hover:brightness-105",
    className,
  );
  const content = (
    <>
      <Icon className={cn("shrink-0", size === "md" ? "size-4" : size === "chip" ? "size-3 sm:size-3.5" : size === "xs" ? "size-2.5" : "size-3")} aria-hidden />
      <span>{meta.label}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        title={tooltip ?? meta.label}
        aria-label={tooltip ?? meta.label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={sharedClass}
      >
        {content}
      </button>
    );
  }
  return (
    <span title={tooltip ?? meta.label} aria-label={tooltip ?? meta.label} className={sharedClass}>
      {content}
    </span>
  );
}

const STATUS_META: Record<
  HealthStatus,
  { label: string; icon: typeof Check; chip: string }
> = {
  done: {
    label: "Done",
    icon: CheckCheck,
    // Saturated emerald so "Done" reads as a celebratory end-state and
    // is visually distinct from the paler "On Track" pill.
    chip: "bg-emerald-500 text-white ring-emerald-600/60",
  },
  onTrack: {
    label: "On Track",
    icon: Check,
    chip: "bg-emerald-100 text-emerald-800 ring-emerald-300/60",
  },
  watch: {
    label: "Watch",
    icon: AlertTriangle,
    chip: "bg-amber-100 text-amber-800 ring-amber-300/60",
  },
  atRisk: {
    label: "At Risk",
    icon: AlertTriangle,
    chip: "bg-rose-100 text-rose-800 ring-rose-300/60",
  },
  overdue: {
    label: "Overdue",
    icon: AlertOctagon,
    chip: "bg-rose-200 text-rose-900 ring-rose-400/70",
  },
};

/**
 * Builds a human-readable tooltip from the health computation result. Pass
 * the relevant fields from `computeProgress`'s return.
 */
export function formatHealthTooltip(args: {
  status: HealthStatus;
  progressPercent: number;
  remainingEffort: number;
  daysRemaining: number;
  deltaDays: number;
  unestimatedCount: number;
}): string {
  const { status, progressPercent, remainingEffort, daysRemaining, deltaDays, unestimatedCount } = args;
  const label = STATUS_META[status].label;
  // 1-decimal day formatter — keeps headline numbers readable. Whole-day
  // values render without a trailing ".0" so common cases (e.g. "12d") stay
  // tight. The previous template-literal `${deltaDays}d` would print the
  // raw float (e.g. "26.758620689655146d"), which read as a bug.
  const fmt = (n: number) => (Number.isInteger(n) ? `${n}d` : `${n.toFixed(1)}d`);
  const parts: string[] = [`${label} · ${progressPercent}% complete`];
  if (status === "overdue") {
    parts.push(`Past deadline with ${fmt(remainingEffort)} of work remaining.`);
  } else if (remainingEffort === 0) {
    parts.push("All estimated effort burned down.");
  } else {
    parts.push(`${fmt(remainingEffort)} of work · ${daysRemaining} working days left`);
    if (deltaDays > 0) parts.push(`${fmt(deltaDays)} over budget`);
    else if (deltaDays < 0) parts.push(`${fmt(-deltaDays)} of buffer`);
  }
  if (unestimatedCount > 0) {
    parts.push(`${unestimatedCount} unestimated ${unestimatedCount === 1 ? "story" : "stories"} excluded`);
  }
  return parts.join(" · ");
}

/**
 * Clickable health badge with a designed click-popover explaining the
 * verdict — surfaces the calculation breakdown (total effort, remaining,
 * ideal-line target, delta) plus a plain-English "Why this status?"
 * summary. Used in the Insights scope picker so the user can see WHY
 * something is "At Risk" without leaving the page.
 */
export function HealthBadgeWithDetail({
  status,
  result,
  basis,
  basisLabel,
  scopeLabel,
  className,
  badgeClassName,
  size = "sm",
  chartKind,
}: {
  status: HealthStatus;
  result: ProgressResult;
  basis: ProgressBasis;
  /** Human-readable label of the basis, e.g. "Σ Epic Days Est." */
  basisLabel: string;
  /** What the verdict applies to: e.g. "Mobile platform v2 (initiative)". */
  scopeLabel?: string;
  className?: string;
  /** Forwarded to the inner `HealthBadge` so callers can fine-tune the
   *  badge itself (e.g. tighter padding next to chart titles) without
   *  also styling the anchor wrapper. */
  badgeClassName?: string;
  size?: "sm" | "md";
  /** Adjusts the "Why this status?" wording so the popover speaks the
   *  chart's language. Omit for the generic popover (defaults to neutral
   *  pacing language). */
  chartKind?: "burndown" | "burnup";
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  /** Committed popover position. Null until first anchor measurement. */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  /** Once dragged, stop snapping back to the anchor on scroll/resize. */
  const userMovedRef = useRef(false);
  /** Live drag state — kept off React's render loop so dragging is 1:1
   *  with the cursor (mutates `style.left/top` directly, commits to React
   *  state only on pointer-up). Mirrors the same pattern as
   *  RoadmapHealthPopover. */
  const dragRef = useRef<{
    pointerId: number;
    grabX: number;
    grabY: number;
    currentLeft: number;
    currentTop: number;
  } | null>(null);

  // Anchor on open; track scroll/resize *only* until the user moves it,
  // then leave the popover wherever they dropped it.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      userMovedRef.current = false;
      return;
    }
    const snapToAnchor = () => {
      if (userMovedRef.current) return;
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Default: open below the badge, right-aligned to the badge so the
      // popover doesn't blow off the chart's right edge.
      const popW = 320; // matches w-[20rem]
      const right = Math.min(window.innerWidth - 8, r.right);
      const left = Math.max(8, right - popW);
      setPos({ left, top: r.bottom + 6 });
    };
    snapToAnchor();
    window.addEventListener("scroll", snapToAnchor, true);
    window.addEventListener("resize", snapToAnchor);
    return () => {
      window.removeEventListener("scroll", snapToAnchor, true);
      window.removeEventListener("resize", snapToAnchor);
    };
  }, [open]);

  // Escape closes; click-outside no longer closes (was too easy to lose
  // the popover by accident while dragging or interacting with the page).
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = popoverRef.current;
    if (!el) return;
    // Don't start a drag from the close button.
    if ((e.target as HTMLElement).closest("[data-popover-no-drag]")) return;
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      currentLeft: rect.left,
      currentTop: rect.top,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointer capture can fail in rare cases — keep moving via global listeners
    }
    userMovedRef.current = true;
  }, []);

  const onHandlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const el = popoverRef.current;
    if (!drag || !el) return;
    e.stopPropagation();
    const w = el.offsetWidth || 320;
    const h = el.offsetHeight || 260;
    const maxLeft = Math.max(8, window.innerWidth - w - 8);
    const maxTop = Math.max(8, window.innerHeight - h - 8);
    const left = Math.max(8, Math.min(maxLeft, e.clientX - drag.grabX));
    const top = Math.max(8, Math.min(maxTop, e.clientY - drag.grabY));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    drag.currentLeft = left;
    drag.currentTop = top;
  }, []);

  const onHandlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(drag.pointerId);
    } catch {
      // capture may have been lost — fine
    }
    setPos({ left: drag.currentLeft, top: drag.currentTop });
    dragRef.current = null;
  }, []);

  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const tooltip = formatHealthTooltip(result);
  const reason = buildHealthReason(result, basis, chartKind);

  const popover = open && pos && typeof document !== "undefined" ? createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`${meta.label} details`}
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 1000 }}
      className="w-[20rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header doubles as the drag handle — grab anywhere on the colored
       *  band to relocate the popover. The close button opts out via
       *  `data-popover-no-drag`. */}
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        className={cn("flex cursor-move select-none items-center justify-between gap-2 px-3 py-2 touch-none", meta.chip, "rounded-none")}
      >
        <div className="inline-flex items-center gap-1.5">
          <GripHorizontal className="size-3 shrink-0 opacity-60" aria-hidden />
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="text-[13px] font-bold">{meta.label}</span>
          <span className="text-[12px] font-semibold opacity-80">· {result.progressPercent}% complete</span>
        </div>
        <button
          type="button"
          data-popover-no-drag
          onClick={() => setOpen(false)}
          onPointerDown={(e) => e.stopPropagation()}
          className="inline-flex size-5 items-center justify-center rounded hover:bg-white/40"
          aria-label="Close details"
        >
          <X className="size-3" aria-hidden />
        </button>
      </div>
          {/* Body — plain-English reason + a small table of the math. */}
          <div className="space-y-3 px-3 py-3 text-[12px] text-slate-700">
            {scopeLabel ? (
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {scopeLabel}
              </div>
            ) : null}
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Why this status?</p>
              <p className="leading-snug text-slate-700">{reason}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2">
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Calculation</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                <dt className="text-slate-500">Total effort</dt>
                <dd className="text-right tabular-nums font-medium text-slate-800">{formatDays(result.totalEffort)}</dd>
                <dt className="text-slate-500">Remaining</dt>
                <dd className="text-right tabular-nums font-medium text-slate-800">{formatDays(result.remainingEffort)}</dd>
                <dt className="text-slate-500">Working days left</dt>
                <dd className="text-right tabular-nums font-medium text-slate-800">{result.daysRemaining}d</dd>
                <dt className="text-slate-500">Delta from ideal</dt>
                <dd className={cn(
                  "text-right tabular-nums font-semibold",
                  result.deltaDays > 1 ? "text-rose-700" : result.deltaDays < -1 ? "text-emerald-700" : "text-slate-800",
                )}>
                  {result.deltaDays > 0 ? `+${formatDays(result.deltaDays)}` : formatDays(result.deltaDays)}
                </dd>
                {result.unestimatedCount > 0 ? (
                  <>
                    <dt className="text-slate-500">Unestimated stories</dt>
                    <dd className="text-right tabular-nums font-medium text-amber-700">{result.unestimatedCount}</dd>
                  </>
                ) : null}
              </dl>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-600">Based on:</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700 ring-1 ring-slate-200">
                {basisLabel}
              </span>
            </div>
          </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <div ref={anchorRef} className={cn("inline-flex shrink-0", className)}>
        <HealthBadge
          status={status}
          tooltip={tooltip}
          onClick={() => setOpen((v) => !v)}
          size={size}
          className={badgeClassName}
        />
      </div>
      {popover}
    </>
  );
}

function formatDays(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  // Whole numbers render without ".0"; fractional values keep one decimal.
  return `${sign}${Number.isInteger(abs) ? abs : abs.toFixed(1)}d`;
}

/**
 * Plain-English explanation of the verdict, derived from the same
 * `ProgressResult` the badge uses. `chartKind` swaps "burndown" vs
 * "burnup" wording so the popover matches the chart it sits on.
 */
function buildHealthReason(
  result: ProgressResult,
  basis: ProgressBasis,
  chartKind?: "burndown" | "burnup",
): string {
  // Direction of the deviation reads opposite on the two charts:
  //  - burndown: behind pace → ABOVE the ideal line
  //  - burnup:   behind pace → BELOW the ideal line
  const lineNoun =
    chartKind === "burnup" ? "burnup" : chartKind === "burndown" ? "burndown" : "pace";
  const behindDirection = chartKind === "burnup" ? "Below" : "Above";
  const aheadDirection = chartKind === "burnup" ? "Above" : "Below";
  const remainingPhrase =
    chartKind === "burnup"
      ? `${formatDays(result.remainingEffort)} still to deliver`
      : `${formatDays(result.remainingEffort)} of work remaining`;

  if (result.status === "overdue") {
    return `Past deadline with ${formatDays(result.remainingEffort)} of work still remaining. The window ended before the team could deliver everything in scope.`;
  }
  if (result.progressPercent >= 100) {
    return chartKind === "burnup"
      ? "All planned work is delivered — the burnup has reached the scope line."
      : "All planned work is delivered — every estimated effort has been burned down.";
  }
  if (result.totalEffort === 0 && basis === "epicEst") {
    return "Epic has no estimate set yet. Add an Est. Epic Days value to get a meaningful verdict.";
  }
  if (result.totalEffort === 0) {
    return "No estimated work to track. Add estimates to child stories to see this verdict reflect real progress.";
  }
  const aheadOrBehind = result.deltaDays;
  if (aheadOrBehind <= 1 && aheadOrBehind >= -1) {
    return `Pace matches the ideal ${lineNoun} — within a day of where it should be. ${remainingPhrase} over ${result.daysRemaining} working days.`;
  }
  if (aheadOrBehind < 0) {
    return `${aheadDirection} the ideal ${lineNoun} line by ${formatDays(-aheadOrBehind)} — ahead of pace. ${remainingPhrase} over ${result.daysRemaining} working days — buffer in hand.`;
  }
  // aheadOrBehind > 1 → Watch or AtRisk
  const severity = result.status === "atRisk" ? "significantly" : "slightly";
  return `${behindDirection} the ideal ${lineNoun} line by ${formatDays(aheadOrBehind)} — ${severity} behind pace. ${remainingPhrase} but only ${result.daysRemaining} working days left.`;
}
