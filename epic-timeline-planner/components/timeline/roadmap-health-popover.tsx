"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertOctagon, AlertTriangle, Check, ChevronRight, X } from "lucide-react";

import type { HealthStatus } from "@/lib/progress";
import { cn } from "@/lib/utils";

/**
 * Small popover that opens from the toolbar's "Progress" button. Surfaces
 * the per-status counts for the currently-visible bars (epics or
 * initiatives), lets the user pin a single status as a filter, and links to
 * the insights view. Positioned via fixed coordinates derived from the
 * anchor's bounding rect so it tracks the button across scroll.
 */
export interface RoadmapHealthPopoverProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Counts indexed by HealthStatus — pass 0 for any status with no items. */
  counts: Record<HealthStatus, number>;
  /** Total number of bars (so we can show "of N"). */
  totalBars: number;
  /** Stories that couldn't be scored because they lacked estimatedDays. */
  unestimatedStoryCount: number;
  /** Currently pinned filter, or null for "show all". */
  filter: HealthStatus | null;
  onFilterChange: (filter: HealthStatus | null) => void;
  onClose: () => void;
  /** Click handler for the "View insights" link at the bottom. */
  onOpenInsights?: () => void;
  /** Singular noun for the unit being counted (e.g. "epic", "initiative"). */
  unitLabel: string;
}

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
}: RoadmapHealthPopoverProps) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Reposition on open + on scroll/resize so the popover stays glued to the
  // Progress button as the viewport changes.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 6 });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef]);

  // Click-outside + Escape to close.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      // Ignore clicks inside the popover itself or on the anchor button.
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

  if (!open || !pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-roadmap-health-popover
      role="dialog"
      aria-label="Roadmap health summary"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[9000] w-[300px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Roadmap health
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close health summary"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mb-2 text-[12.5px] text-slate-600">
        Tap a row to filter the timeline by status — tap again to clear.
      </div>
      <ul className="space-y-1">
        {STATUS_ORDER.map((status) => {
          const meta = STATUS_META[status];
          const count = counts[status];
          const isActive = filter === status;
          const Icon = meta.icon;
          return (
            <li key={status}>
              <button
                type="button"
                onClick={() => onFilterChange(isActive ? null : status)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                  isActive
                    ? `${meta.activeBg} ${meta.activeBorder}`
                    : "border-transparent hover:bg-slate-50",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn("inline-flex size-5 items-center justify-center rounded-full", meta.dotBg)}>
                    <Icon className={cn("size-3 stroke-[2.5]", meta.dotFg)} aria-hidden />
                  </span>
                  <span className="text-[13px] font-semibold text-slate-800">{meta.label}</span>
                </span>
                <span className="text-[13px] font-bold tabular-nums text-slate-700">{count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[11.5px] text-slate-500">
        <span>
          {totalBars} {totalBars === 1 ? unitLabel : `${unitLabel}s`} total
          {unestimatedStoryCount > 0 ? ` · ${unestimatedStoryCount} unestimated` : ""}
        </span>
        {filter ? (
          <button
            type="button"
            onClick={() => onFilterChange(null)}
            className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            Clear filter
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
          className="mt-2 inline-flex w-full items-center justify-between rounded-lg bg-gradient-to-r from-sky-50 via-indigo-50 to-violet-50 px-3 py-2 text-[13px] font-semibold text-indigo-700 ring-1 ring-indigo-200/60 transition-all hover:from-sky-100 hover:via-indigo-100 hover:to-violet-100"
        >
          <span>View insights</span>
          <ChevronRight className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>,
    document.body,
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
    dotFg: "text-white",
    activeBg: "bg-emerald-50",
    activeBorder: "border-emerald-300",
  },
  watch: {
    label: "Watch",
    icon: AlertTriangle,
    dotBg: "bg-amber-400",
    dotFg: "text-amber-950",
    activeBg: "bg-amber-50",
    activeBorder: "border-amber-300",
  },
  atRisk: {
    label: "At Risk",
    icon: AlertTriangle,
    dotBg: "bg-rose-500",
    dotFg: "text-white",
    activeBg: "bg-rose-50",
    activeBorder: "border-rose-300",
  },
  overdue: {
    label: "Overdue",
    icon: AlertOctagon,
    dotBg: "bg-rose-700",
    dotFg: "text-white",
    activeBg: "bg-rose-100",
    activeBorder: "border-rose-400",
  },
};
