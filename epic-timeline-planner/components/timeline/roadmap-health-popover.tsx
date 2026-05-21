"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertOctagon, AlertTriangle, Check, ChevronRight, Folder, GripHorizontal, X, Zap } from "lucide-react";

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

  return createPortal(
    <div
      ref={popoverRef}
      data-roadmap-health-popover
      role="dialog"
      aria-label="Roadmap health summary"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[9000] w-[320px] rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Draggable header */}
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        className="flex cursor-grab touch-none items-center justify-between gap-2 rounded-t-xl border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-3 py-2 select-none active:cursor-grabbing"
        title="Drag to move"
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="size-3.5 text-slate-400" aria-hidden />
          <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-slate-600">
            Roadmap health
          </div>
        </div>
        <button
          data-popover-no-drag
          type="button"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close health summary"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-2.5">
        {/* Toggle group 1 — bar mode (Initiatives vs Epics) */}
        <ToggleGroup
          label="Group by"
          options={[
            { value: "initiatives", label: "Initiatives", icon: Zap },
            { value: "epics", label: "Epics", icon: Folder },
          ]}
          value={barMode}
          onChange={(v) => onBarModeChange(v as "initiatives" | "epics")}
        />

        {/* Toggle group 2 — progress basis (Stories count vs Days burned) */}
        <ToggleGroup
          label="Progress basis"
          options={[
            { value: "days", label: "Days left" },
            { value: "stories", label: "Stories done" },
          ]}
          value={progressBasis}
          onChange={(v) => onProgressBasisChange(v as ProgressBasis)}
        />

        {/* Status filter rows */}
        <div className="pt-1">
          <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-[0.1em] text-slate-500">
            Filter by status
          </div>
          <ul className="space-y-1">
            {STATUS_ORDER.map((status) => {
              const meta = STATUS_META[status];
              const count = counts[status];
              const isActive = filter.has(status);
              const Icon = meta.icon;
              return (
                <li key={status}>
                  <button
                    type="button"
                    onClick={() => toggle(status)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                      isActive
                        ? `${meta.activeBg} ${meta.activeBorder}`
                        : "border-transparent hover:bg-slate-50",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex size-5 items-center justify-center rounded-full ring-1 ring-white/40",
                          isActive ? meta.dotBg : "bg-slate-200",
                        )}
                      >
                        {isActive ? (
                          <Check className="size-3 stroke-[3] text-white" aria-hidden />
                        ) : (
                          <Icon className={cn("size-3 stroke-[2.5]", meta.dotFg)} aria-hidden />
                        )}
                      </span>
                      <span className="text-[13px] font-semibold text-slate-800">{meta.label}</span>
                    </span>
                    <span className="text-[13px] font-bold tabular-nums text-slate-700">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-[11.5px] text-slate-500">
          <span>
            {totalBars} {totalBars === 1 ? unitLabel : `${unitLabel}s`} total
            {unestimatedStoryCount > 0 ? ` · ${unestimatedStoryCount} unestimated` : ""}
          </span>
          {filter.size > 0 ? (
            <button
              type="button"
              onClick={() => onFilterChange(new Set())}
              className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              Clear all
            </button>
          ) : null}
        </div>

        {onOpenInsights ? (
          <button
            type="button"
            onClick={() => {
              onOpenInsights();
              onClose();
            }}
            className="inline-flex w-full items-center justify-between rounded-lg bg-gradient-to-r from-sky-50 via-indigo-50 to-violet-50 px-3 py-2 text-[13px] font-semibold text-indigo-700 ring-1 ring-indigo-200/60 transition-all hover:from-sky-100 hover:via-indigo-100 hover:to-violet-100"
          >
            <span>View insights</span>
            <ChevronRight className="size-4" aria-hidden />
          </button>
        ) : null}
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
    dotBg: string;
    dotFg: string;
    activeBg: string;
    activeBorder: string;
  }
> = {
  onTrack: {
    label: "On Track",
    icon: Check,
    dotBg: "bg-emerald-500",
    dotFg: "text-emerald-700",
    activeBg: "bg-emerald-50",
    activeBorder: "border-emerald-300",
  },
  watch: {
    label: "Watch",
    icon: AlertTriangle,
    dotBg: "bg-amber-400",
    dotFg: "text-amber-700",
    activeBg: "bg-amber-50",
    activeBorder: "border-amber-300",
  },
  atRisk: {
    label: "At Risk",
    icon: AlertTriangle,
    dotBg: "bg-rose-500",
    dotFg: "text-rose-700",
    activeBg: "bg-rose-50",
    activeBorder: "border-rose-300",
  },
  overdue: {
    label: "Overdue",
    icon: AlertOctagon,
    dotBg: "bg-rose-700",
    dotFg: "text-rose-800",
    activeBg: "bg-rose-100",
    activeBorder: "border-rose-400",
  },
};
