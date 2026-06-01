"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Latency probe for backlog filter changes.
 *
 * Two-phase pattern so we capture the FULL click-to-stable latency, not
 * just the first paint:
 *
 *   1. Each filter calls `markFilterChange(label)` SYNCHRONOUSLY inside
 *      its click handler — this captures T0, the true user-action moment.
 *      The local-state mirror update + startTransition all happen AFTER
 *      this call, so the recorded `startedAt` is the click instant.
 *
 *   2. The parent component (BacklogPlanningPanel) calls
 *      `reportFilterStable()` inside a useEffect that depends on every
 *      filter state slot. The effect fires after React commits the
 *      transition (which is the slow backlog re-render), and one rAF
 *      later the elapsed time is recorded — that's the time from the
 *      click to "the new filtered table is on screen and paint is review".
 *
 * Without this split, the previous implementation reported just the
 * synchronous local-state paint (~300ms) and missed the transition
 * commit (the ~3s the user actually feels).
 */

type LatencyKind = "filter" | "phase";

type LatencyEntry = {
  id: string;
  label: string;
  durationMs: number;
  timestamp: number;
  kind: LatencyKind;
};

const MAX_ENTRIES = 50;
const listeners = new Set<(entry: LatencyEntry) => void>();

function emit(entry: LatencyEntry) {
  // Defer the listener fanout to a microtask. timePhase() runs inside
  // useMemo bodies (the parent's render phase) and the listener does a
  // setState on the debugger — calling that synchronously during render
  // triggers React's "Cannot update a component while rendering a
  // different component" warning. Microtask = after current render, no
  // observable delay.
  queueMicrotask(() => {
    listeners.forEach((l) => l(entry));
  });
}
let pendingMark: { label: string; startedAt: number } | null = null;

export function markFilterChange(label: string) {
  if (typeof window === "undefined") return;
  // Last writer wins — if the user toggles two filters back-to-back the
  // second one resets the clock so we don't end up attributing the slow
  // re-render of #2 to #1.
  pendingMark = { label, startedAt: performance.now() };
}

/**
 * Time the synchronous body of `fn` and log it under the `[backlog-perf]`
 * prefix with the supplied phase label. Returns the function's value
 * unchanged so it can wrap any computation:
 *
 *   const fullyFiltered = useMemo(
 *     () => timePhase("fullyFiltered", () => applyKindFilter(...)),
 *     [deps],
 *   );
 *
 * Disabled in production builds (logs only in dev) to keep the console
 * clean when not profiling.
 */
export function timePhase<T>(label: string, fn: () => T): T {
  if (process.env.NODE_ENV !== "development") return fn();
  const started = performance.now();
  const result = fn();
  const elapsed = performance.now() - started;
  recordPhase(label, elapsed);
  return result;
}

/** Record a measured duration as a phase entry (logs + popup feed). */
export function recordPhase(label: string, durationMs: number) {
  if (process.env.NODE_ENV !== "development") return;
  // eslint-disable-next-line no-console
  console.log(`[backlog-perf] ${label}: ${durationMs.toFixed(1)}ms`);
  emit({
    id: `phase-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    durationMs,
    timestamp: Date.now(),
    kind: "phase",
  });
}

/**
 * Returns the active pending mark's `startedAt` (the click moment) so
 * downstream code (useLayoutEffect, rAF) can compute "click → commit"
 * or "click → paint" deltas. Returns null when nothing is pending.
 */
export function getPendingMarkStartedAt(): number | null {
  return pendingMark?.startedAt ?? null;
}

export function reportFilterStable() {
  if (typeof window === "undefined") return;
  if (!pendingMark) return;
  const { label, startedAt } = pendingMark;
  pendingMark = null;
  // One rAF after the effect commits → fires after browser paint with
  // the new filtered table. That's the "stable" moment we want.
  requestAnimationFrame(() => {
    const elapsed = performance.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(`[filter-latency] ${label}: ${elapsed.toFixed(1)}ms`);
    emit({
      id: `filter-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label,
      durationMs: elapsed,
      timestamp: Date.now(),
      kind: "filter",
    });
  });
}

export function FilterLatencyDebugger() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LatencyEntry[]>([]);

  useEffect(() => {
    const cb = (entry: LatencyEntry) => {
      setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
    };
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  const filterEntries = entries.filter((e) => e.kind === "filter");
  const slowest = filterEntries.length > 0 ? filterEntries.reduce((a, b) => (a.durationMs > b.durationMs ? a : b)) : null;
  const newest = filterEntries[0];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-3 z-[9999] inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg ring-1 ring-slate-700 hover:bg-slate-800"
        title="Show filter latency log"
      >
        <span aria-hidden>⏱</span>
        {newest ? (
          <span className="font-mono tabular-nums">
            {newest.label}: {newest.durationMs.toFixed(0)}ms
          </span>
        ) : (
          <span>Debug latency</span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed bottom-3 right-3 z-[9999] flex max-h-[70vh] w-[360px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex flex-col">
          <span className="text-[12px] font-semibold text-slate-700">Filter latency</span>
          {slowest ? (
            <span className="text-[10.5px] text-slate-500">
              Slowest so far: {slowest.label}{" "}
              <span className="font-mono tabular-nums font-semibold text-slate-700">
                {slowest.durationMs.toFixed(1)}ms
              </span>
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEntries([])}
            className="rounded px-1.5 py-0.5 text-[10.5px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            clear
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded px-1.5 py-0.5 text-[12px] text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close debugger"
          >
            ×
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-slate-400">
            No measurements yet — toggle a filter to record one.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.map((e) => (
              <li
                key={e.id}
                className={cn(
                  "flex items-center justify-between gap-2 px-3 py-1.5 text-[12px]",
                  e.kind === "phase" && "bg-slate-50/60 pl-6",
                )}
              >
                <span
                  className={cn(
                    "truncate",
                    e.kind === "filter" ? "font-semibold text-slate-800" : "font-normal text-slate-500",
                  )}
                >
                  {e.kind === "phase" ? "↳ " : ""}
                  {e.label}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-mono tabular-nums font-semibold",
                    e.durationMs > 250
                      ? "text-rose-600"
                      : e.durationMs > 100
                        ? "text-amber-600"
                        : "text-emerald-600",
                  )}
                >
                  {e.durationMs.toFixed(1)}ms
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
