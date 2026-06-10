"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, AlertOctagon, AlertTriangle, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, Folder, GripHorizontal, Info, ListChecks, Search, StickyNote, X, Zap } from "lucide-react";

import type { HealthStatus } from "@/lib/progress";
import { cn } from "@/lib/utils";
import { ToggleGroup } from "@/components/timeline/basis-toggle-group";
import { HealthExplainerPopover } from "@/components/dashboard/health-explainer-popover";

/** Re-export the canonical progress-basis type from `lib/progress` so the
 *  rest of the planner picks up the new `epicEst` variant. */
export type ProgressBasis = "stories" | "days" | "epicEst";

export type RoadmapHealthItem = {
  id: string;
  title: string;
  kind: "epic" | "initiative";
  status: HealthStatus;
};

export interface RoadmapHealthPopoverProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  counts: Record<HealthStatus, number>;
  totalBars: number;
  unestimatedStoryCount: number;
  filter: Set<HealthStatus>;
  onFilterChange: (filter: Set<HealthStatus>) => void;
  onClose: () => void;
  /**
   * Fires when the user clicks "View Insights" with a pick from the
   * autocomplete. Receives the picked item's kind + id so the consumer can
   * pre-scope the Insights tab to that specific initiative/epic.
   */
  onOpenInsights?: (kind: "epic" | "initiative", id: string) => void;
  unitLabel: string;
  /** "initiatives" or "epics" — which scope the popover summary describes. */
  barMode: "initiatives" | "epics";
  onBarModeChange: (mode: "initiatives" | "epics") => void;
  /** Whether progress % is computed from story counts or estimated-days burndown. */
  progressBasis: ProgressBasis;
  onProgressBasisChange: (basis: ProgressBasis) => void;
  /**
   * Bars currently visible on the Gantt with their computed health status.
   * Used to populate the "pick an initiative/epic to inspect" autocomplete
   * — filtered to the active `barMode` (epic vs initiative) and the active
   * `filter` set (so unticking "On Track" hides on-track items from the
   * suggestions just like it dims them on the chart).
   */
  items: ReadonlyArray<RoadmapHealthItem>;
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
  items,
}: RoadmapHealthPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const targetKind: "epic" | "initiative" = barMode === "initiatives" ? "initiative" : "epic";
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  // Opens the HealthExplainerPopover (the 7-slide carousel) from a small
  // Info icon in the header next to the "Roadmap Health" title.
  const [healthExplainerOpen, setHealthExplainerOpen] = useState(false);

  // Pool: only items matching the current bar mode AND, when any status
  // filter is active, only items whose status is in the filter set.
  const pickerPool = useMemo(() => {
    const base = items.filter((i) => i.kind === targetKind);
    return filter.size === 0 ? base : base.filter((i) => filter.has(i.status));
  }, [items, targetKind, filter]);

  // Drop the picked id whenever the pool changes shape such that the
  // current pick is no longer valid (e.g. user toggled the bar mode, or
  // unchecked the status that the picked item belongs to).
  useEffect(() => {
    if (pickedId == null) return;
    if (!pickerPool.some((i) => i.id === pickedId)) {
      setPickedId(null);
      setPickerQuery("");
    }
  }, [pickerPool, pickedId]);

  // Re-anchor the input value to the picked item's title when one is
  // chosen, so the field shows the selection at rest.
  useEffect(() => {
    if (pickedId == null) return;
    const picked = pickerPool.find((i) => i.id === pickedId);
    if (picked) setPickerQuery(picked.title);
  }, [pickedId, pickerPool]);

  // Close the suggestions list on outside click. Pointer-down (not click)
  // so we don't fight the option's onClick.
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: PointerEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [pickerOpen]);

  const filteredSuggestions = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q || (pickedId != null && pickerPool.find((i) => i.id === pickedId)?.title.toLowerCase() === q)) {
      return pickerPool.slice(0, 50);
    }
    return pickerPool.filter((i) => i.title.toLowerCase().includes(q)).slice(0, 50);
  }, [pickerPool, pickerQuery, pickedId]);
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

  // Reset the status filter to "All" whenever the popover transitions from
  // open → closed (X button or toolbar toggle). A ref tracks the previous
  // `open` value so we don't fire on initial mount when open=false.
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      onFilterChange(new Set());
    }
    prevOpenRef.current = open;
  }, [open, onFilterChange]);

  // Anchor on open; track scroll/resize *only* until the user moves it.
  useEffect(() => {
    if (!open) {
      setPos(null);
      userMovedRef.current = false;
      return;
    }
    const snapToAnchor = () => {
      if (userMovedRef.current) return;
      // Anchor to the top-RIGHT of the viewport — the popover sits 16px
      // in from the right edge so it doesn't cover the planner's left-
      // hand initiative / epic list (where the per-row health chips it
      // controls actually render). The card is 640px wide (matches the
      // Tailwind `w-[640px]` below) and capped at `calc(100vw - 2rem)`
      // on narrow viewports; clamping `left` to a 16px floor keeps the
      // card on-screen at any width. The planner can still drag it
      // wherever they want after open.
      const POPOVER_WIDTH = 640;
      const EDGE_MARGIN = 16;
      const viewportWidth =
        typeof window !== "undefined" ? window.innerWidth : POPOVER_WIDTH + EDGE_MARGIN * 2;
      const left = Math.max(EDGE_MARGIN, viewportWidth - POPOVER_WIDTH - EDGE_MARGIN);
      setPos({ left, top: 16 });
    };
    snapToAnchor();
    window.addEventListener("scroll", snapToAnchor, true);
    window.addEventListener("resize", snapToAnchor);
    return () => {
      window.removeEventListener("scroll", snapToAnchor, true);
      window.removeEventListener("resize", snapToAnchor);
    };
  }, [open, anchorRef]);

  // The popover is now closed only by explicit user action: the X button in
  // its header, or toggling the toolbar's Progress chip again. Click-outside
  // and Escape no longer dismiss it — too easy to lose by accident while
  // dragging the popover or interacting with the rest of the page.

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

  // Total of the five status counts — used to size the proportional
  // progress bar at the bottom.
  const statusTotal =
    counts.done + counts.onTrack + counts.watch + counts.atRisk + counts.overdue;
  // "Healthy share" — Done + On Track + Watch over the rest. Drives the
  // colored scrubber so the bar reads green→amber→red→deep-red left to right.
  const donePct = statusTotal > 0 ? (counts.done / statusTotal) * 100 : 0;
  const onTrackPct = statusTotal > 0 ? (counts.onTrack / statusTotal) * 100 : 0;
  const watchPct = statusTotal > 0 ? (counts.watch / statusTotal) * 100 : 0;
  const atRiskPct = statusTotal > 0 ? (counts.atRisk / statusTotal) * 100 : 0;
  const overduePct = statusTotal > 0 ? (counts.overdue / statusTotal) * 100 : 0;

  // Overall Status cards + Health Distribution highlights surface the top-3
  // statuses by count. With <3 non-zero, the rest are padded by status order
  // (On Track → At Risk → Done) so the layout always shows three slots and
  // the user gets a useful read even on lightly-populated roadmaps.
  const topThreeStatuses = (() => {
    const ranked = ([...STATUS_ORDER] as HealthStatus[]).sort((a, b) => counts[b] - counts[a]);
    const withCounts = ranked.filter((s) => counts[s] > 0);
    if (withCounts.length >= 3) return withCounts.slice(0, 3);
    const fillers: HealthStatus[] = ["onTrack", "atRisk", "done"];
    const out: HealthStatus[] = [...withCounts];
    for (const s of fillers) {
      if (out.length >= 3) break;
      if (!out.includes(s)) out.push(s);
    }
    return out.slice(0, 3);
  })();

  return createPortal(
    <div
      ref={popoverRef}
      data-roadmap-health-popover
      role="dialog"
      aria-label="Roadmap health summary"
      style={{ left: pos.left, top: pos.top }}
      // `overflow-hidden` was clipping the autocomplete dropdown below the
      // popover's bottom edge. Drop it and clip the gradient header on its
      // own (`rounded-t-2xl`) so the rounded-corner look is preserved while
      // descendants like the picker dropdown can extend past the popover.
      className="fixed z-[9000] w-[640px] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200/70 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Gradient header — drag handle + title + close */}
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        className="relative flex cursor-grab touch-none items-center justify-between gap-3 rounded-t-2xl bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 px-6 py-2.5 text-white select-none active:cursor-grabbing"
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
            <div className="inline-flex items-center gap-1.5 text-[15px] font-extrabold leading-tight tracking-tight">
              Roadmap Health
              <button
                data-popover-no-drag
                type="button"
                aria-label="How is health calculated?"
                title="How is health calculated?"
                onClick={(event) => {
                  event.stopPropagation();
                  setHealthExplainerOpen(true);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                className="inline-flex size-5 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              >
                <Info className="size-3.5" aria-hidden />
              </button>
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

      <div className="px-6 pb-5 pt-5">
        {/* Top row — View + Health calculation. Two segmented groups side
         *  by side with a vertical divider between, so the user can scan
         *  scope (Epic vs Initiative) and basis at a glance. Labels next
         *  to the controls (not above) match the mockup's compact layout. */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-[12.5px] font-semibold text-slate-700">View</span>
            <ToggleGroup
              label=""
              options={[
                { value: "epics", label: "Epic", icon: Folder },
                { value: "initiatives", label: "Initiative", icon: Zap },
              ]}
              value={barMode}
              onChange={(v) => onBarModeChange(v as "initiatives" | "epics")}
            />
          </div>
          <div className="hidden h-8 self-center border-l border-slate-200 sm:block" aria-hidden />
          <div className="flex flex-1 items-center gap-3">
            <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-700">
              Health calculation
              <BasisHelpTrigger />
            </span>
            <ToggleGroup
              label=""
              options={
                barMode === "initiatives"
                  ? [
                      { value: "epicEst", label: "Σ | Epic Est (d)", icon: Folder },
                      { value: "days", label: "Σ | Child Est (d)", icon: StickyNote },
                      { value: "stories", label: "Stories Completed (%)", icon: CheckCircle2 },
                    ]
                  : [
                      { value: "epicEst", label: "Epic Est (d)", icon: Folder },
                      { value: "days", label: "Σ | Child Est (d)", icon: StickyNote },
                      { value: "stories", label: "Stories Completed (%)", icon: CheckCircle2 },
                    ]
              }
              value={progressBasis}
              onChange={(v) => onProgressBasisChange(v as ProgressBasis)}
            />
          </div>
        </div>

        {/* Overall Status + Health Distribution — two-column split. Left:
         *  the top-3 statuses by count rendered as big cards with a colored
         *  status badge + count + share-of-total. Right: the same three
         *  shares as big stats stacked over the proportional bar (5 segments
         *  if all statuses are present). */}
        <div className="mt-5 grid grid-cols-1 items-stretch gap-5 border-t border-slate-200/70 pt-5 md:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
              Overall Status
            </div>
            <div className="grid flex-1 grid-cols-3 gap-2">
              {topThreeStatuses.map((status) => {
                const meta = STATUS_META[status];
                const count = counts[status];
                const pct = statusTotal > 0 ? Math.round((count / statusTotal) * 100) : 0;
                const Icon = meta.icon;
                const isActive = filter.has(status);
                return (
                  <button
                    key={`card-${status}`}
                    type="button"
                    onClick={() => toggle(status)}
                    aria-pressed={isActive}
                    className={cn(
                      "flex flex-col rounded-lg border bg-white p-2 text-left shadow-sm transition-colors",
                      isActive
                        ? `${meta.activeBg} ${meta.activeBorder}`
                        : "border-slate-200/80 hover:border-slate-300 hover:bg-slate-50",
                    )}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span
                        className={cn(
                          "inline-flex size-4 shrink-0 items-center justify-center rounded-full shadow-sm",
                          meta.dotBg,
                        )}
                      >
                        <Icon className={cn("size-2.5 stroke-[2.5]", meta.dotFg)} aria-hidden />
                      </span>
                      <span className="truncate text-[12.5px] font-semibold text-slate-800">{meta.label}</span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-center gap-1.5">
                      <span className="text-[22px] font-extrabold leading-none tabular-nums text-slate-900">{count}</span>
                      <span className={cn("text-[12px] font-semibold tabular-nums leading-none", meta.countFg)}>{pct}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
              Health Distribution
            </div>
            {/* `flex-1` + flex column with the bar pinned to the bottom — so
             *  this card auto-stretches to match the 3 Overall Status cards
             *  on its left, and the % stats stay centered vertically while
             *  the bar/total caption sit at the bottom edge. */}
            <div className="flex flex-1 flex-col rounded-lg border border-slate-200/80 bg-white p-2 shadow-sm">
              <div className="grid flex-1 grid-cols-3 items-center gap-2">
                {topThreeStatuses.map((status) => {
                  const meta = STATUS_META[status];
                  const count = counts[status];
                  const pct = statusTotal > 0 ? Math.round((count / statusTotal) * 100) : 0;
                  return (
                    <div key={`dist-${status}`} className="text-center">
                      <div className={cn("text-[14px] font-extrabold leading-none tabular-nums", meta.countFg)}>
                        {pct}%
                      </div>
                      <div className="mt-0.5 truncate text-[9.5px] font-semibold text-slate-600">{meta.label}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/60">
                {statusTotal > 0 ? (
                  <div className="flex h-full w-full">
                    <div className="h-full bg-emerald-500" style={{ width: `${onTrackPct}%` }} />
                    <div className="h-full bg-emerald-600" style={{ width: `${donePct}%` }} />
                    <div className="h-full bg-amber-400" style={{ width: `${watchPct}%` }} />
                    <div className="h-full bg-rose-500" style={{ width: `${atRiskPct}%` }} />
                    <div className="h-full bg-rose-700" style={{ width: `${overduePct}%` }} />
                  </div>
                ) : null}
              </div>
              <div className="mt-1.5 text-center text-[9.5px] text-slate-500">
                {totalBars} {totalBars === 1 ? unitLabel : `${unitLabel}s`} total
              </div>
            </div>
          </div>
        </div>

        {/* Filter by Status — six chips (All + 5 statuses) in a 3-col grid.
         *  Clicking the "All" chip clears every filter; clicking a status
         *  chip toggles it. Bigger chips than before so they're easy hit
         *  targets and match the mockup's spacing. */}
        <div className="mt-5 border-t border-slate-200/70 pt-5">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            Filter by Status
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => onFilterChange(new Set())}
              aria-pressed={filter.size === 0}
              className={cn(
                "inline-flex items-center justify-between gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors",
                filter.size === 0
                  ? "border-indigo-300 bg-indigo-50"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-indigo-700">
                  <ListChecks className="size-3" strokeWidth={2.25} aria-hidden />
                </span>
                <span className={cn("text-[11.5px] font-semibold", filter.size === 0 ? "text-indigo-900" : "text-slate-800")}>All</span>
              </span>
              <span className={cn("text-[12px] font-extrabold tabular-nums leading-none", filter.size === 0 ? "text-indigo-700" : "text-slate-700")}>
                {totalBars}
              </span>
            </button>
            {STATUS_ORDER_DISPLAY.map((status) => {
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
                    "inline-flex items-center justify-between gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors",
                    isActive
                      ? `${meta.activeBg} ${meta.activeBorder}`
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                    isZero && !isActive && "opacity-70",
                  )}
                >
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-md", meta.dotBg)}>
                      <Icon className={cn("size-3 stroke-[2.5]", meta.dotFg)} aria-hidden />
                    </span>
                    <span className="truncate text-[11.5px] font-semibold text-slate-800">{meta.label}</span>
                  </span>
                  <span
                    className={cn(
                      "text-[12px] font-extrabold tabular-nums leading-none",
                      isZero ? "text-slate-300" : meta.countFg,
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 4 — Scope picker. Pool is filtered by the active bar
            mode + the status filter, so the suggestions match exactly
            what's highlighted on the Gantt below. The View Insights
            button is disabled until the user has actually picked
            something. */}
        {onOpenInsights ? (
          <div className="mt-5 border-t border-slate-200/70 pt-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-indigo-700">
              Pick {targetKind === "initiative" ? "an initiative" : "an epic"} to inspect
            </div>
            <div ref={pickerRef} className="relative">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  ref={pickerInputRef}
                  type="text"
                  value={pickerQuery}
                  onFocus={() => setPickerOpen(true)}
                  onChange={(e) => {
                    setPickerQuery(e.target.value);
                    setPickerOpen(true);
                    if (pickedId != null) setPickedId(null);
                  }}
                  placeholder={
                    pickerPool.length === 0
                      ? `No ${targetKind === "initiative" ? "initiatives" : "epics"} match the current filter`
                      : `Search ${pickerPool.length} ${targetKind === "initiative" ? "initiative" : "epic"}${pickerPool.length === 1 ? "" : "s"}…`
                  }
                  disabled={pickerPool.length === 0}
                  className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-7 text-[12.5px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                />
                {pickedId != null || pickerQuery ? (
                  <button
                    type="button"
                    onClick={() => { setPickedId(null); setPickerQuery(""); pickerInputRef.current?.focus(); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Clear selection"
                  >
                    <X className="size-3" />
                  </button>
                ) : (
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                )}
              </div>
              {pickerOpen && filteredSuggestions.length > 0 ? (
                <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-[9100] max-h-[220px] overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-xl">
                  {filteredSuggestions.map((item) => {
                    const meta = STATUS_META[item.status];
                    // Leading icon matches the kind so the user can scan the
                    // dropdown at a glance: ⚡ for initiative, 📁 for epic.
                    // Replaces the previous status-color dot — status is still
                    // shown by the trailing pill on the right.
                    const KindIcon = item.kind === "initiative" ? Zap : Folder;
                    const kindIconColor = item.kind === "initiative" ? "text-blue-600" : "text-sky-500";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setPickedId(item.id);
                          setPickerQuery(item.title);
                          setPickerOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] text-slate-900 hover:bg-slate-50",
                          item.id === pickedId && "bg-indigo-50",
                        )}
                      >
                        <KindIcon className={cn("size-3.5 shrink-0", kindIconColor)} strokeWidth={2} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        <span className={cn("shrink-0 text-[10.5px] font-semibold uppercase tracking-wide", meta.countFg)}>{meta.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Section 5 — Footer. Meta count on the left, View Insights CTA
         *  on the right. Top divider separates it from the scope picker.
         *  Count reflects the ACTIVE filter — when one or more status chips
         *  are picked it shows just that subset; with no filter active it
         *  falls back to the full scope count. */}
        {(() => {
          const filteredCount = filter.size === 0
            ? totalBars
            : Array.from(filter).reduce((sum, s) => sum + counts[s], 0);
          const filterIsActive = filter.size > 0;
          return (
        <div className="mt-5 flex items-center justify-between gap-4 border-t border-slate-200/70 pt-4">
          <div className="text-[12px] text-slate-500">
            <span className="font-semibold text-slate-700">{filteredCount}</span>{" "}
            {filteredCount === 1 ? unitLabel : `${unitLabel}s`}
            {filterIsActive ? (
              <>
                {" "}filtered{" "}
                <span className="text-slate-400">/ {totalBars} total</span>
              </>
            ) : (
              <> total</>
            )}
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
              disabled={pickedId == null}
              onClick={() => {
                if (pickedId == null) return;
                onOpenInsights(targetKind, pickedId);
                onClose();
              }}
              className="group inline-flex shrink-0 items-center gap-1.5 rounded-md border border-indigo-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-slate-50"
              title={pickedId == null ? "Pick an item above to enable" : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/dialog-insights-icon.png"
                alt=""
                aria-hidden
                className="size-3.5 select-none object-contain"
                draggable={false}
              />
              <span>View Insights</span>
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
          );
        })()}
      </div>
      <HealthExplainerPopover open={healthExplainerOpen} onClose={() => setHealthExplainerOpen(false)} />
    </div>,
    document.body,
  );
}

/**
 * Collapsible explanation of the two progress-basis modes. Sits under the
 * "Health & progress basis" toggle in the popover. The toggle's choice is
 * persisted globally and feeds the Gantt bar badges, middle-panel
 * progress bars, and this popover's verdicts — so users hitting the
 * toggle for the first time need a quick read on what flips when they
 * change it.
 */
function BasisHelp({ inlineMode = false }: { inlineMode?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  // Inline mode (rendered inside the `BasisHelpTrigger` popover) skips the
  // collapsible chrome and just renders the help body, since the popover
  // itself already provides the open/close affordance.
  if (inlineMode) {
    return (
      <div className="space-y-2 text-[11.5px] leading-snug text-slate-600">
        <BasisHelpBody />
      </div>
    );
  }
  return (
    <div className="mt-2.5 rounded-lg border border-indigo-100/80 bg-indigo-50/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-50/70"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-3 shrink-0" aria-hidden />
        )}
        <Info className="size-3 shrink-0" aria-hidden />
        How each mode works
      </button>
      {open ? (
        <div className="space-y-2 border-t border-indigo-100/80 px-3 py-2.5 text-[11.5px] leading-snug text-slate-600">
          <BasisHelpBody />
        </div>
      ) : null}
    </div>
  );
}

/** Shared body for the basis-help content — used both by the legacy inline
 *  collapsible chrome and the new BasisHelpTrigger popover. */
function BasisHelpBody() {
  // Each mode is a self-contained card with a leading icon (matching the
  // toggle-group icon for that option), title, a two-line Epic / Initiative
  // breakdown rendered as a key:value pair (no bullets), and a subtle
  // when-to-use note in italics. Cleaner than the old nested-<ul> layout.
  type ModeRow = {
    icon: typeof Folder;
    title: string;
    iconTint: string;
    breakdown: { label: string; body: React.ReactNode }[];
    note: string;
  };
  const modes: ModeRow[] = [
    {
      icon: Folder,
      iconTint: "bg-sky-50 text-sky-700 ring-sky-100",
      title: "Epic Est (d)",
      breakdown: [
        { label: "Epic", body: <>Uses this epic&apos;s <em>Est. Days</em>.</> },
        { label: "Initiative", body: <>Sums <em>Est. Days</em> across the initiative&apos;s child epics.</> },
      ],
      note: "Useful for early-stage epics that don't have stories yet.",
    },
    {
      icon: StickyNote,
      iconTint: "bg-violet-50 text-violet-700 ring-violet-100",
      title: "Σ | Child Est (d)",
      breakdown: [
        { label: "Epic", body: <>Sums <em>Est. Days</em> on every child story.</> },
        { label: "Initiative", body: <>Sums across <em>initiative → epics → stories</em>.</> },
      ],
      note: "Most accurate once user stories are written.",
    },
    {
      icon: CheckCircle2,
      iconTint: "bg-emerald-50 text-emerald-700 ring-emerald-100",
      title: "Stories Completed (%)",
      breakdown: [
        { label: "All views", body: <>% of child stories whose status is <em>Done</em>.</> },
      ],
      note: "Ignores effort estimates entirely — pure headcount.",
    },
  ];
  return (
    <div className="space-y-2">
      {modes.map((m) => {
        const ModeIcon = m.icon;
        return (
          <div
            key={m.title}
            className="rounded-md border border-slate-200/80 bg-white p-2"
          >
            <div className="flex items-center gap-1.5">
              <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-md ring-1", m.iconTint)}>
                <ModeIcon className="size-3" strokeWidth={2.25} aria-hidden />
              </span>
              <p className="text-[12px] font-semibold text-slate-900">{m.title}</p>
            </div>
            <div className="mt-1 space-y-0.5 pl-[26px] text-[11px] leading-snug text-slate-600">
              {m.breakdown.map((b) => (
                <div key={b.label} className="flex gap-1.5">
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">{b.label}</span>
                  <span className="min-w-0">{b.body}</span>
                </div>
              ))}
              <p className="pt-0.5 text-[10.5px] italic text-slate-500">{m.note}</p>
            </div>
          </div>
        );
      })}
      <p className="border-t border-slate-100 pt-2 text-[10.5px] leading-snug text-slate-500">
        Applies to this popup, middle-panel progress bars, and Gantt health badges.
      </p>
    </div>
  );
}

const STATUS_ORDER: HealthStatus[] = ["done", "onTrack", "watch", "atRisk", "overdue"];

/** Order shown in the redesigned Filter by Status grid, mirroring the
 *  mockup: row 1 [All, On Track, At Risk], row 2 [Done, Overdue, Watch].
 *  "All" is rendered separately, this array is the 5 status chips that
 *  follow it. */
const STATUS_ORDER_DISPLAY: HealthStatus[] = ["onTrack", "atRisk", "done", "overdue", "watch"];

/**
 * Compact info-trigger that opens BasisHelp in a popover, used in the
 * "Health calculation" label. Replaces the inline collapsible card so the
 * top row stays tight. Click outside or Escape closes.
 */
function BasisHelpTrigger() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", handler);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="How each calculation works"
        aria-label="How each calculation works"
        className="inline-flex size-4 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {open ? (
        <div
          role="dialog"
          className="absolute left-0 top-[calc(100%+6px)] z-[9100] w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-indigo-100 bg-white p-2.5 shadow-xl ring-1 ring-indigo-100/70"
        >
          <BasisHelp inlineMode />
        </div>
      ) : null}
    </span>
  );
}

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
  done: {
    label: "Done",
    icon: CheckCheck,
    dotBg: "bg-emerald-600",
    dotFg: "text-white",
    activeBg: "bg-emerald-50",
    activeBorder: "border-emerald-400",
    fillBg: "bg-gradient-to-r from-emerald-300/80 to-transparent",
    countFg: "text-emerald-800",
  },
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
    activeBg: "bg-rose-50",
    activeBorder: "border-rose-300",
    fillBg: "bg-gradient-to-r from-rose-300/80 to-transparent",
    countFg: "text-rose-800",
  },
};
