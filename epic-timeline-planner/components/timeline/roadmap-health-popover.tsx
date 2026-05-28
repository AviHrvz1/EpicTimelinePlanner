"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, AlertOctagon, AlertTriangle, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, Folder, GripHorizontal, Info, ListChecks, Search, StickyNote, X, Zap } from "lucide-react";

import type { HealthStatus } from "@/lib/progress";
import { cn } from "@/lib/utils";
import { ToggleGroup } from "@/components/timeline/basis-toggle-group";

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
      // `overflow-hidden` was clipping the autocomplete dropdown below the
      // popover's bottom edge. Drop it and clip the gradient header on its
      // own (`rounded-t-2xl`) so the rounded-corner look is preserved while
      // descendants like the picker dropdown can extend past the popover.
      className="fixed z-[9000] w-[600px] rounded-2xl border border-slate-200/70 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150"
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

      <div className="px-5 pb-5 pt-5">
        {/* Section 1 — Scope toggle. Self-labeling buttons so we don't
         *  need a header above them; the words "Initiative Health" /
         *  "Epic Health" carry their own context. */}
        <ToggleGroup
          label=""
          options={[
            { value: "initiatives", label: "Initiative Health", icon: Zap },
            { value: "epics", label: "Epic Health", icon: Folder },
          ]}
          value={barMode}
          onChange={(v) => onBarModeChange(v as "initiatives" | "epics")}
        />

        {/* Section 2 — Basis toggle. Option labels adapt to the
         *  selected scope so the same button means the right thing
         *  under Initiative vs Epic health. Order follows the planning
         *  workflow: early-stage epic estimate first, child story
         *  rollup second, % completed third. */}
        <div className="mt-5 border-t border-slate-200/70 pt-4">
          <ToggleGroup
            label="Health & progress basis"
            options={
              barMode === "initiatives"
                ? [
                    { value: "epicEst", label: "Σ Epic Days Est.", icon: Folder },
                    { value: "days", label: "Σ Story Days Est.", icon: StickyNote },
                    { value: "stories", label: "% Stories Completed", icon: CheckCircle2 },
                  ]
                : [
                    { value: "epicEst", label: "Epic Days Est.", icon: Folder },
                    { value: "days", label: "Σ Story Days Est.", icon: StickyNote },
                    { value: "stories", label: "% Stories Completed", icon: CheckCircle2 },
                  ]
            }
            value={progressBasis}
            onChange={(v) => onProgressBasisChange(v as ProgressBasis)}
          />
          {/* "How each mode works" — collapsed by default. Carries the
           *  scope-aware explanation for users who aren't sure which
           *  mode to pick. */}
          <div className="mt-2.5">
            <BasisHelp />
          </div>
        </div>

        {/* Section 3 — Status filter pills + healthy/risky distribution
         *  bar. Grouped together because the filter and the bar are two
         *  views of the same data. */}
        <div className="mt-5 border-t border-slate-200/70 pt-4">
          <div className="mb-2 flex items-baseline justify-between">
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
          <div className="grid grid-cols-4 gap-2">
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
                    "group relative inline-flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-lg border px-2 py-1.5 text-left transition-colors",
                    isActive
                      ? `${meta.activeBg} ${meta.activeBorder}`
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                    isZero && !isActive && "opacity-75",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-4 shrink-0 items-center justify-center rounded-full shadow-sm ring-2 ring-white",
                      meta.dotBg,
                    )}
                  >
                    <Icon className={cn("size-2 stroke-[2.5]", meta.dotFg)} aria-hidden />
                  </span>
                  <span className="text-[11.5px] font-semibold text-slate-800">{meta.label}</span>
                  <span
                    className={cn(
                      "ml-auto text-[14px] font-extrabold tabular-nums leading-none",
                      isZero ? "text-slate-300" : meta.countFg,
                    )}
                  >
                    {count}
                  </span>
                  {/* Active state is conveyed by the soft tint + matching
                      border alone — no bottom underline so the row doesn't
                      feel over-emphasized. */}
                </button>
              );
            })}
          </div>
        </div>

        {/* Health distribution bar — stacked segments showing % of each
         *  status. Sits inside the same section as the filter pills above
         *  since they show the same data. */}
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
         *  on the right. Top divider separates it from the scope picker. */}
        <div className="mt-5 flex items-center justify-between gap-4 border-t border-slate-200/70 pt-4">
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
      </div>
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
function BasisHelp() {
  const [open, setOpen] = useState(false);
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
          <div>
            <p className="font-semibold text-slate-800">Σ Epic Days Est. / Epic Days Est.</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              <li><strong>Epic Health</strong> — uses this epic's <em>Est. Days</em>.</li>
              <li><strong>Initiative Health</strong> — sums <em>Est. Days</em> across the initiative's child epics.</li>
            </ul>
            <p className="mt-0.5 text-slate-500">Useful for early-stage epics that don't have stories yet.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Σ Story Days Est.</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              <li><strong>Epic Health</strong> — sums <em>Est. Days</em> on every child story.</li>
              <li><strong>Initiative Health</strong> — sums across <em>initiative → epics → stories</em>.</li>
            </ul>
            <p className="mt-0.5 text-slate-500">Most accurate once user stories are written.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">% Stories Completed</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              <li>Counts child stories whose status is <em>Done</em> or <em>Approved</em> against the total.</li>
            </ul>
            <p className="mt-0.5 text-slate-500">Ignores effort estimates entirely — pure headcount.</p>
          </div>
          <p className="text-[11px] italic text-slate-500">
            Applies to this popup, the middle-panel progress bars, and the Gantt bar health badges.
          </p>
        </div>
      ) : null}
    </div>
  );
}

const STATUS_ORDER: HealthStatus[] = ["done", "onTrack", "watch", "atRisk", "overdue"];

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
