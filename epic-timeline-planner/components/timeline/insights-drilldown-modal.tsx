"use client";

import { X as XIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Insights drilldown modal — portaled overlay matching the EpicDeleteDialog
 * translucent-ring chrome. Used to host the per-chart drilldown tables (Status
 * Pie, Workload Balance, Month/Sprint Load) without replacing the chart card
 * body. Content scrolls inside; close X, ESC, or backdrop click dismisses.
 *
 * Shared by `components/timeline/month-analytics.tsx` and
 * `components/timeline/sprint-analytics.tsx` so the visual chrome stays in
 * lockstep across the two insights surfaces (and matches the retrospective
 * drilldown).
 */
export function InsightsDrilldownModal({
  title,
  icon,
  subtitle,
  onClose,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    // Sits BELOW the epic / initiative / story dialogs (z-[70] / z-[80]) so
    // clicking a story / epic ID in a drilldown row pops the dialog above the
    // table. Listed at z-[65] — above the planning surface but under every
    // detail dialog the row links to.
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/20 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="relative flex h-[78vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-2xl ring-4 ring-sky-100/70 animate-in fade-in zoom-in-95 duration-150"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex min-w-0 items-center gap-2">
            {icon ?? null}
            <h3 className="truncate text-[15px] font-semibold text-slate-800">{title}</h3>
            {subtitle ? <span className="shrink-0 truncate text-[12px] text-slate-500">{subtitle}</span> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drilldown"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
          <div className="h-full overflow-hidden rounded-lg ring-1 ring-slate-200">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
