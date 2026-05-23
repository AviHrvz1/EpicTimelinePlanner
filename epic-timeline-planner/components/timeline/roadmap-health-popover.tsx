"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, AlertOctagon, AlertTriangle, Check, ChevronRight, Folder, GripHorizontal, Hourglass, ListChecks, X, Zap } from "lucide-react";

import type { HealthStatus } from "@/lib/progress";
import { cn } from "@/lib/utils";

export type ProgressBasis = "stories" | "days";

export interface RoadmapHealthPopoverProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  counts: Record<HealthStatus, number>;
  totalBars: number;
  unestimatedStoryCount: number;
  filter: Set<HealthStatus>;
  onFilterChange: (filter: Set<HealthStatus>) => void;
  onClose: () => void;
  onOpenInsights?: () => void;
  unitLabel: string;
  /** "initiatives" or "epics" — which scope the popover summary describes. */
  barMode: "initiatives" | "epics";
  onBarModeChange: (mode: "initiatives" | "epics") => void;
  /** Whether progress % is computed from story counts or estimated-days burndown. */
  progressBasis: ProgressBasis;
  onProgressBasisChange: (basis: ProgressBasis) => void;
}

/**
 * Health-summary popover opened from the toolbar's Progress button.
 *
 * The popover renders into a portal so it can move freely on the viewport.
 * On open it positions itself just below the anchor button; the user can
 * grab the header to drag it anywhere. Drag uses refs + direct `style`
 * mutation so move events don't trigger React renders (smooth at 60fps).
 * Filter is a multi-select set; bars not matching any selected status get
 * dimmed in the timeline.
 */
export function RoadmapHealthPopover({
  open,
  anchorRef,
  counts,
  totalBars,
  unestimatedStoryCount,
  filter,
  onFilterChange,
  onClose,
  onOpenInsights,
  unitLabel,
  barMode,
  onBarModeChange,
  progressBasis,
  onProgressBasisChange,
}: RoadmapHealthPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  /** Latest committed position (post-drag). React only renders on this. */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  /** Once dragged, stop snapping back to the anchor on scroll/resize. */
  const userMovedRef = useRef(false);
  /** Live drag state — kept off React's render loop. */
  const dragRef = useRef<{
    pointerId: number;
    grabX: number;
    grabY: number;
    currentLeft: number;
    currentTop: number;
  } | null>(null);

  // Anchor on open; track scroll/resize *only* until the user moves it.
  useEffect(() => {
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
      setPos({ left: r.left, top: r.bottom + 6 });
    };
    snapToAnchor();
    window.addEventListener("scroll", snapToAnchor, true);
    window.addEventListener("resize", snapToAnchor);
    return () => {
      window.removeEventListener("scroll", snapToAnchor, true);
      window.removeEventListener("resize", snapToAnchor);
    };
  }, [open, anchorRef]);

  // Click-outside + Escape to close.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const inside = (target as HTMLElement).closest?.("[data-roadmap-health-popover]");
      if (inside) return;
      if (anchorRef.current && anchorRef.current.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
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
    },
    [],
  );

  const onHandlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const el = popoverRef.current;
    if (!drag || !el) return;
    e.stopPropagation();
    const w = el.offsetWidth || 300;
    const h = el.offsetHeight || 280;
    const maxLeft = Math.max(8, window.innerWidth - w - 8);
    const maxTop = Math.max(8, window.innerHeight - h - 8);
    const left = Math.max(8, Math.min(maxLeft, e.clientX - drag.grabX));
    const top = Math.max(8, Math.min(maxTop, e.clientY - drag.grabY));
    // Mutate the DOM directly — bypasses React reconciliation, keeps drag 1:1
    // with the cursor.
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
      // ignore — capture may have been lost
    }
    // Commit the final position to React state so future renders preserve it.
    setPos({ left: drag.currentLeft, top: drag.currentTop });
    dragRef.current = null;
  }, []);

  if (!open || !pos || typeof document === "undefined") return null;

  const toggle = (status: HealthStatus) => {
    const next = new Set(filter);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    onFilterChange(next);
  };

  // Total of the four status counts — used to size the proportional
  // progress bar at the bottom.
  const statusTotal =
    counts.onTrack + counts.watch + counts.atRisk + counts.overdue;
  // "Healthy share" — On Track + Watch over the rest. Drives the colored
  // scrubber so the bar reads green→amber→red→deep-red left to right.
  const onTrackPct = statusTotal > 0 ? (counts.onTrack / statusTotal) * 100 : 0;
  const watchPct = statusTotal > 0 ? (counts.watch / statusTotal) * 100 : 0;
  const atRiskPct = statusTotal > 0 ? (counts.atRisk / statusTotal) * 100 : 0;
  const overduePct = statusTotal > 0 ? (counts.overdue / statusTotal) * 100 : 0;
  const healthyPct = onTrackPct + watchPct;

  return createPortal(
    <div
      ref={popoverRef}
      data-roadmap-health-popover
      role="dialog"
      aria-label="Roadmap health summary"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[9000] w-[640px] overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Gradient header — drag handle + title + close */}
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        className="relative flex cursor-grab touch-none items-center justify-between gap-3 bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 px-6 py-2.5 text-white select-none active:cursor-grabbing"
        title="Drag to move"
      >
        {/* Subtle pattern overlay for depth */}
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_120%,rgba(255,255,255,0.18),transparent_50%)]" />
        <div className="relative flex items-center gap-3">
          <GripHorizontal className="size-4 shrink-0 text-white/50" aria-hidden />
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white shadow-sm ring-1 ring-white/30 backdrop-blur-sm">
            <Activity className="size-4 stroke-[2.5]" aria-hidden />
          </span>
          <div>
            <div className="text-[15px] font-extrabold leading-tight tracking-tight">
              Roadmap Health
            </div>
            <div className="text-[11px] font-medium leading-tight text-white/80">
              {totalBars} {totalBars === 1 ? unitLabel : `${unitLabel}s`} in scope
            </div>
          </div>
        </div>
        <button
          data-popover-no-drag
          type="button"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          className="relative rounded-md p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          aria-label="Close health summary"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="px-6 pb-4 pt-5">
        {/* Toggles row — Group by + Progress basis side by side */}
        <div className="grid grid-cols-2 gap-4">
          <ToggleGroup
            label="Group by"
            options={[
              { value: "initiatives", label: "Initiatives", icon: Zap },
              { value: "epics", label: "Epics", icon: Folder },
            ]}
            value={barMode}
            onChange={(v) => onBarModeChange(v as "initiatives" | "epics")}
          />
          <ToggleGroup
            label="Progress basis"
            options={[
              { value: "days", label: "Days Left", icon: Hourglass },
              { value: "stories", label: "Stories Done", icon: ListChecks },
            ]}
            value={progressBasis}
            onChange={(v) => onProgressBasisChange(v as ProgressBasis)}
          />
        </div>

        {/* Status filter — horizontal pills */}
        <div className="mt-3">
          <div className="mb-1.5 flex items-baseline justify-between">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-indigo-700">
              Filter by status
            </div>
            {filter.size > 0 ? (
              <button
                type="button"
                onClick={() => onFilterChange(new Set())}
                className="text-[11.5px] font-semibold text-indigo-600 transition-colors hover:text-indigo-700"
              >
                Clear all
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-4 gap-2.5">
            {STATUS_ORDER.map((status) => {
              const meta = STATUS_META[status];
              const count = counts[status];
              const isActive = filter.has(status);
              const isZero = count === 0;
              const Icon = meta.icon;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggle(status)}
                  aria-pressed={isActive}
                  className={cn(
                    "group relative inline-flex items-center gap-2 overflow-hidden rounded-lg border px-2 py-1 text-left transition-all",
                    isActive
                      ? `${meta.activeBg} ${meta.activeBorder} shadow-sm`
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                    isZero && !isActive && "opacity-70",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-5 shrink-0 items-center justify-center rounded-full shadow-sm ring-2 ring-white",
                      meta.dotBg,
                    )}
                  >
                    <Icon className={cn("size-2.5 stroke-[2.5]", meta.dotFg)} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-1.5">
                    <span className="truncate text-[12px] font-semibold text-slate-800">{meta.label}</span>
                    <span
                      className={cn(
                        "text-[14px] font-extrabold tabular-nums leading-none",
                        isZero ? "text-slate-300" : meta.countFg,
                      )}
                    >
                      {count}
                    </span>
                  </span>
                  {isActive ? (
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-x-0 bottom-0 h-[2px]",
                        meta.dotBg,
                      )}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Health distribution bar — stacked segments showing % of each status */}
        <div className="mt-3">
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/60">
            {statusTotal > 0 ? (
              <div className="flex h-full w-full">
                <div className="h-full bg-emerald-500" style={{ width: `${onTrackPct}%` }} />
                <div className="h-full bg-amber-400" style={{ width: `${watchPct}%` }} />
                <div className="h-full bg-rose-500" style={{ width: `${atRiskPct}%` }} />
                <div className="h-full bg-rose-700" style={{ width: `${overduePct}%` }} />
              </div>
            ) : null}
            {/* Scrubber marker at the boundary between healthy and risky */}
            {statusTotal > 0 ? (
              <div
                className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-indigo-600 shadow-md"
                style={{ left: `${healthyPct}%` }}
                aria-hidden
              />
            ) : null}
          </div>
        </div>

        {/* Footer — meta + View Insights CTA */}
        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="text-[12px] text-slate-500">
            <span className="font-semibold text-slate-700">{totalBars}</span>{" "}
            {totalBars === 1 ? unitLabel : `${unitLabel}s`} total
            {unestimatedStoryCount > 0 ? (
              <>
                <span aria-hidden className="mx-1.5 text-slate-300">·</span>
                <span className="font-semibold text-amber-700">{unestimatedStoryCount}</span> unestimated
              </>
            ) : null}
          </div>
          {onOpenInsights ? (
            <button
              type="button"
              onClick={() => {
                onOpenInsights();
                onClose();
              }}
              className="group inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-1.5 text-[12px] font-bold text-white shadow-md shadow-indigo-500/25 ring-1 ring-white/15 transition-all hover:shadow-lg hover:shadow-indigo-500/35 hover:brightness-110 active:scale-[0.99]"
            >
              <span>View Insights</span>
              <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ToggleGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string; icon?: typeof Check }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[11.5px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</div>
      <div className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {options.map((opt) => {
          const isOn = opt.value === value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold transition-all",
                isOn
                  ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              {Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_ORDER: HealthStatus[] = ["onTrack", "watch", "atRisk", "overdue"];

const STATUS_META: Record<
  HealthStatus,
  {
    label: string;
    icon: typeof Check;
    /** Round status pill — solid color w/ white icon. */
    dotBg: string;
    dotFg: string;
    /** Tinted row background + border when filter is active for this row. */
    activeBg: string;
    activeBorder: string;
    /** Soft gradient fill behind the row, proportional to count. */
    fillBg: string;
    /** Count number color when count > 0. */
    countFg: string;
  }
> = {
  onTrack: {
    label: "On Track",
    icon: Check,
    dotBg: "bg-emerald-500",
    dotFg: "text-white",
    activeBg: "bg-emerald-50",
    activeBorder: "border-emerald-300",
    fillBg: "bg-gradient-to-r from-emerald-200/80 to-transparent",
    countFg: "text-emerald-700",
  },
  watch: {
    label: "Watch",
    icon: AlertTriangle,
    dotBg: "bg-amber-400",
    dotFg: "text-amber-950",
    activeBg: "bg-amber-50",
    activeBorder: "border-amber-300",
    fillBg: "bg-gradient-to-r from-amber-200/80 to-transparent",
    countFg: "text-amber-700",
  },
  atRisk: {
    label: "At Risk",
    icon: AlertTriangle,
    dotBg: "bg-rose-500",
    dotFg: "text-white",
    activeBg: "bg-rose-50",
    activeBorder: "border-rose-300",
    fillBg: "bg-gradient-to-r from-rose-200/80 to-transparent",
    countFg: "text-rose-700",
  },
  overdue: {
    label: "Overdue",
    icon: AlertOctagon,
    dotBg: "bg-rose-700",
    dotFg: "text-white",
    activeBg: "bg-rose-100",
    activeBorder: "border-rose-400",
    fillBg: "bg-gradient-to-r from-rose-300/80 to-transparent",
    countFg: "text-rose-800",
  },
};
