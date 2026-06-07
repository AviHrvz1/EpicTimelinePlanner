"use client";

/**
 * Portfolio Burndown — a quarter-scope burndown across every epic whose plan
 * overlaps the focused quarter. The line trails today, the ideal line shows
 * the linear drop expected to land at zero by the quarter end, and a forecast
 * tail extrapolates "if we keep this pace, here's when we hit zero."
 *
 * The KPIs floating at top-left answer the planner's three Monday-morning
 * questions in one glance:
 *   1. Done X/Y epics    → how much of the quarter's scope already shipped?
 *   2. ±Nd vs ideal      → are we ahead or behind today's burn target?
 *   3. ETA <date>        → at current pace, when will we finish?
 *
 * Phase 1 (this file): static chart + KPIs, no click-to-filter yet. The next
 * phase adds gap-region click → laggard list → Gantt highlight.
 *
 * Health calc coupling: the chart's unit follows `progressBasis` exactly the
 * same way the Health Distribution donut does — flip the basis and the Y
 * axis, ideal slope, pace delta, and ETA all recompute.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  EpicItem,
  InitiativeItem,
  StoryDailySnapshotItem,
  UserStoryItem,
} from "@/lib/types";
import { computeEpicHealthVerdict } from "@/lib/epic-health";
import { cn } from "@/lib/utils";

type ProgressBasis = "days" | "stories" | "epicEst";

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  /** 1..4 — the quarter being burned down. */
  quarter: number;
  team?: string | null;
  /** Follows the global Health calc setting. Controls unit + per-epic math. */
  progressBasis?: ProgressBasis;
  /** Fires when the planner picks a row in the contributor popover or the
   *  "Highlight on Roadmap" button. The caller is expected to (a) store
   *  the selection as a cross-mode filter and (b) switch the top mode to
   *  the Roadmap so the highlight lands on a visible Gantt. Receives a
   *  human label for the filter banner (e.g. "3 epics behind plan"). */
  onSelectLaggards?: (epicIds: string[], label: string) => void;
  /** Hide the Recharts bottom-aligned legend. Used by the Hero card,
   *  which renders its own vertical legend on the right (matching the
   *  donut-card layout) and reclaims the bottom strip for chart area.
   *  Defaults to false (legend renders inline). */
  hideLegend?: boolean;
  /** Where the KPI strip (Done X/Y · pace · ETA) lives.
   *   - "floating" (default): the legacy floating chip pinned top-left
   *     inside the chart area — matches the dashboard chart card layout.
   *   - "side": the KPIs become rows in a right-column list, stacked
   *     above the legend rows. Used by the Hero card so the dense
   *     130px slot doesn't waste pixels on a top-left chrome that
   *     overlaps the chart's first data points. */
  kpiPlacement?: "floating" | "side";
};

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function shortLabel(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function isStoryOpen(status: UserStoryItem["status"] | null | undefined): boolean {
  // "open" = anything that still has work attached. Matches the per-epic
  // burndown's convention so the curves agree when one epic is summed in.
  return status === "todo" || status === "inProgress";
}

function latestSnapshotAtDay(story: UserStoryItem, day: Date): StoryDailySnapshotItem | null {
  const snapshots = story.snapshots ?? [];
  if (snapshots.length === 0) return null;
  const cutoff = day.getTime();
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const snap = snapshots[i];
    if (!snap) continue;
    const ts = new Date(snap.snapshotDate).getTime();
    if (Number.isFinite(ts) && ts <= cutoff) return snap;
  }
  return null;
}

function quarterMonthRange(quarter: number): { startMonth: number; endMonth: number } {
  const q = Math.max(1, Math.min(4, Math.round(quarter)));
  return { startMonth: (q - 1) * 3 + 1, endMonth: q * 3 };
}

function quarterBounds(year: number, quarter: number): { start: Date; end: Date } {
  const { startMonth, endMonth } = quarterMonthRange(quarter);
  const lastDay = new Date(year, endMonth, 0).getDate();
  return {
    start: startOfDay(new Date(year, startMonth - 1, 1)),
    end: startOfDay(new Date(year, endMonth - 1, lastDay)),
  };
}

/**
 * Per-epic "open work" measured in whatever unit the basis selects.
 *
 *  - stories   → count of stories still open
 *  - days      → sum of remaining estimated days across open stories
 *  - epicEst   → same daysLeft sum, scaled into the epic's
 *                originalEstimateDays unit so the chart's Y axis can stack
 *                epics that priced their work differently
 */
function epicOpenAt(epic: EpicItem, day: Date, basis: ProgressBasis): number {
  const stories = epic.userStories ?? [];
  let openDays = 0;
  let openStoryCount = 0;
  let totalStoryDays = 0;
  for (const story of stories) {
    const snap = latestSnapshotAtDay(story, day);
    const status = snap?.status ?? story.status;
    const estDays =
      snap?.estimatedDays ?? story.estimatedDays ?? null;
    if (estDays != null) totalStoryDays += estDays;
    if (!isStoryOpen(status)) continue;
    if (basis === "stories") {
      openStoryCount += 1;
      continue;
    }
    const daysLeft =
      snap?.daysLeft ?? snap?.estimatedDays ?? story.daysLeft ?? story.estimatedDays ?? 1;
    openDays += Math.max(0, daysLeft);
  }
  if (basis === "stories") return openStoryCount;
  if (basis === "epicEst") {
    const epicEst = epic.originalEstimateDays ?? 0;
    if (epicEst > 0 && totalStoryDays > 0) {
      return Math.max(0, (openDays * epicEst) / totalStoryDays);
    }
    // Fallback when no epic estimate is set: behave like `days`.
    return openDays;
  }
  return openDays;
}

function epicCountsForDone(epic: EpicItem): boolean {
  const stories = epic.userStories ?? [];
  if (stories.length === 0) return false;
  return stories.every((s) => s.status === "done");
}

function formatEta(d: Date | null): string {
  if (d == null) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function basisUnitLabel(basis: ProgressBasis): string {
  if (basis === "stories") return "stories";
  return "days";
}

function basisYAxisLabel(basis: ProgressBasis): string {
  if (basis === "stories") return "Stories remaining";
  if (basis === "epicEst") return "Epic-days remaining";
  return "Story-days remaining";
}

export function PortfolioBurndownChart({
  initiatives,
  year,
  quarter,
  team,
  progressBasis = "days",
  onSelectLaggards,
  hideLegend = false,
  kpiPlacement = "floating",
}: Props) {
  const { start, end } = useMemo(() => quarterBounds(year, quarter), [year, quarter]);
  const { startMonth, endMonth } = useMemo(() => quarterMonthRange(quarter), [quarter]);

  const startMs = start.getTime();
  const endMs = end.getTime();
  const today = useMemo(() => startOfDay(new Date()), []);
  const todayMs = today.getTime();
  const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);

  // Epics whose plan window touches the quarter at all. Team filter applied
  // here so per-team dashboards burn only their slice. Keep the parent
  // initiative alongside so the contributor popover can show "<epic> ·
  // <initiative>" without re-walking the tree.
  type ScopeRow = { epic: EpicItem; initiative: InitiativeItem };
  const epicsInScopeRows: ScopeRow[] = useMemo(() => {
    const out: ScopeRow[] = [];
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (team && epic.team !== team) continue;
        if (epic.planStartMonth == null || epic.planEndMonth == null) continue;
        if (epic.planStartMonth > endMonth) continue;
        if (epic.planEndMonth < startMonth) continue;
        out.push({ epic, initiative });
      }
    }
    return out;
  }, [initiatives, team, startMonth, endMonth]);
  const epicsInScope: EpicItem[] = useMemo(
    () => epicsInScopeRows.map((r) => r.epic),
    [epicsInScopeRows],
  );

  // Total scope at quarter start — the burndown's ceiling.
  const startTotal = useMemo(() => {
    return epicsInScope.reduce(
      (sum, epic) => sum + epicOpenAt(epic, start, progressBasis),
      0,
    );
  }, [epicsInScope, start, progressBasis]);

  type Row = {
    label: string;
    /** `null` for future days — Recharts skips them so the line stops at today. */
    actual: number | null;
    ideal: number;
    /** Forecast tail value — `null` until today; numeric only on/after today. */
    forecast: number | null;
  };

  // First pass: actual + ideal for every day.
  const baseRows: Row[] = useMemo(() => {
    const rows: Row[] = [];
    for (let i = 0; i < totalDays; i += 1) {
      const day = startOfDay(new Date(startMs + i * 86400000));
      const isFuture = day.getTime() > todayMs;
      let actual: number | null = null;
      if (!isFuture) {
        let v = 0;
        for (const epic of epicsInScope) v += epicOpenAt(epic, day, progressBasis);
        actual = Number(v.toFixed(progressBasis === "stories" ? 0 : 1));
      }
      const idealRaw = totalDays <= 1 ? 0 : startTotal * (1 - i / (totalDays - 1));
      const ideal = Number(Math.max(0, idealRaw).toFixed(progressBasis === "stories" ? 0 : 1));
      rows.push({ label: shortLabel(day), actual, ideal, forecast: null });
    }
    return rows;
  }, [totalDays, startMs, todayMs, epicsInScope, startTotal, progressBasis]);

  // Forecast: simple linear fit on the last ≤14 days of actuals. Skip when
  // the team isn't burning down (slope ≥ 0) — there's nothing to project.
  const forecast = useMemo(() => {
    const elapsedDays = Math.min(
      totalDays,
      Math.max(0, Math.floor((todayMs - startMs) / 86400000) + 1),
    );
    if (elapsedDays < 2) return null;
    const lastIdx = elapsedDays - 1;
    const firstIdx = Math.max(0, lastIdx - 13);
    const v0 = baseRows[firstIdx]?.actual;
    const v1 = baseRows[lastIdx]?.actual;
    if (v0 == null || v1 == null) return null;
    const days = lastIdx - firstIdx;
    if (days <= 0) return null;
    const slope = (v1 - v0) / days;
    if (slope >= 0 || v1 <= 0) return null;
    const daysToZero = v1 / -slope;
    const projectedIdx = lastIdx + daysToZero;
    const etaMs = startMs + projectedIdx * 86400000;
    return { lastIdx, lastValue: v1, slope, projectedIdx, etaDate: new Date(etaMs) };
  }, [baseRows, totalDays, startMs, todayMs]);

  // Second pass: fold the forecast tail in. Two anchor points (today's value
  // and the projected zero) so the line draws cleanly. Use the same dataset
  // so Recharts shares the X domain.
  const rows: Row[] = useMemo(() => {
    if (forecast == null) return baseRows;
    const out = baseRows.map((r) => ({ ...r }));
    // Anchor at today.
    const f0 = out[forecast.lastIdx];
    if (f0) f0.forecast = forecast.lastValue;
    // Anchor at the projected zero — clip to the last row if the forecast
    // overshoots the quarter end (slips past Q's last day).
    const endIdx = Math.min(out.length - 1, Math.round(forecast.projectedIdx));
    if (endIdx > forecast.lastIdx) {
      const target = out[endIdx];
      if (target) {
        // Linear interpolate forecast value at the end of the visible window
        // when ETA is past the quarter end.
        const remainingDays = endIdx - forecast.lastIdx;
        const projectedValue =
          forecast.lastValue + forecast.slope * remainingDays;
        target.forecast = Math.max(0, Number(projectedValue.toFixed(progressBasis === "stories" ? 0 : 1)));
      }
    }
    return out;
  }, [baseRows, forecast, progressBasis]);

  // KPIs.
  const todayIdx = Math.max(0, Math.min(totalDays - 1, Math.floor((todayMs - startMs) / 86400000)));
  const todayRow = rows[todayIdx];
  const paceDeltaRaw =
    todayRow != null && todayRow.actual != null
      ? todayRow.actual - todayRow.ideal
      : null;
  // Tolerance: treat sub-half-unit deltas as "on pace" so micro-jitter doesn't
  // flash amber/emerald. Stories basis snaps to whole units.
  const tolerance = progressBasis === "stories" ? 0.5 : 0.5;
  const paceState: "behind" | "ahead" | "onPace" | "unknown" =
    paceDeltaRaw == null
      ? "unknown"
      : paceDeltaRaw > tolerance
        ? "behind"
        : paceDeltaRaw < -tolerance
          ? "ahead"
          : "onPace";
  const paceMagnitude = paceDeltaRaw == null ? null : Math.abs(paceDeltaRaw);

  const doneEpicCount = useMemo(
    () => epicsInScope.filter(epicCountsForDone).length,
    [epicsInScope],
  );
  const totalEpicCount = epicsInScope.length;

  // Per-epic contribution to the pace gap. Each row carries the epic's own
  // delta vs its own plan window (positive = behind, negative = ahead) —
  // computed via the shared verdict helper so this surface speaks the same
  // basis-aware language as the dashboard donut and Gantt bar badges.
  //
  // We rank by absolute delta and split into a behind list and an ahead
  // list. The popover shows whichever side matches the chart's current
  // overall paceState, so clicking "4d behind" surfaces the laggards and
  // clicking "3d ahead" surfaces the outperformers — symmetric semantics.
  type ContributorRow = {
    epicId: string;
    epicTitle: string;
    initiativeTitle: string;
    /** Days/stories above the per-epic ideal at "now". Positive = behind. */
    delta: number;
  };
  const epicContributors: ContributorRow[] = useMemo(() => {
    const out: ContributorRow[] = [];
    for (const { epic, initiative } of epicsInScopeRows) {
      const v = computeEpicHealthVerdict(epic, year, progressBasis);
      if (v == null) continue;
      const delta = v.result.deltaDays;
      if (!Number.isFinite(delta)) continue;
      out.push({
        epicId: epic.id,
        epicTitle: epic.title,
        initiativeTitle: initiative.title,
        delta,
      });
    }
    return out;
  }, [epicsInScopeRows, year, progressBasis]);

  const topBehind = useMemo(
    () =>
      epicContributors
        .filter((c) => c.delta > 0.5)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 8),
    [epicContributors],
  );
  const topAhead = useMemo(
    () =>
      epicContributors
        .filter((c) => c.delta < -0.5)
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 8),
    [epicContributors],
  );

  const etaDate = forecast?.etaDate ?? null;
  const etaWithinPeriod = etaDate != null && etaDate.getTime() <= endMs;

  // Markers + axis ticks.
  const todayLabel =
    todayMs >= startMs && todayMs <= endMs ? shortLabel(today) : null;
  const endLabel = shortLabel(end);
  const xAxisTicks: string[] = useMemo(() => {
    const labels = rows.map((r) => r.label);
    if (labels.length <= 10) return labels;
    const targetCount = 10;
    const step = (labels.length - 1) / (targetCount - 1);
    const picked = Array.from({ length: targetCount }, (_, i) => labels[Math.round(i * step)]);
    return Array.from(new Set(picked.filter((l): l is string => l != null)));
  }, [rows]);

  // Empty-state guards.
  if (totalEpicCount === 0) {
    return (
      <p className="flex h-full min-h-[180px] items-center justify-center text-xs text-slate-400">
        No epics planned in Q{quarter} {year}
        {team ? ` · ${team}` : ""} yet.
      </p>
    );
  }
  if (startTotal <= 0) {
    return (
      <p className="flex h-full min-h-[180px] items-center justify-center text-xs text-slate-400">
        Q{quarter} {year} has no measurable work in this basis.
      </p>
    );
  }

  const unit = basisUnitLabel(progressBasis);
  const unitSuffix = unit === "stories" ? "" : "d";
  const decimals = progressBasis === "stories" ? 0 : 1;

  // The pace chip turns into a button when there are contributors to drill
  // into. Click opens a popover with the top contributors — laggards if
  // we're behind, outperformers if we're ahead. Outside-click + Esc close.
  // The popover renders via a portal into document.body so a parent's
  // `overflow-x-auto` (Hero row) can't clip it — without the portal, any
  // tall popover hosted inside a horizontally-scrolling container gets
  // its bottom hidden behind the next page section.
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const paceButtonRef = useRef<HTMLButtonElement | null>(null);
  // Live viewport-relative coordinates for the portal popover. Recomputed
  // when the popover opens, when the window scrolls, and on resize so the
  // popover stays anchored to the chip.
  const [popoverAnchor, setPopoverAnchor] = useState<
    { top: number; left: number; width: number } | null
  >(null);
  useEffect(() => {
    if (!popoverOpen) {
      setPopoverAnchor(null);
      return;
    }
    function reanchor() {
      const btn = paceButtonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      // Anchor the popover's top edge ~6px below the chip and align its
      // left edge with the chip. Width is capped at 360 but clamped to
      // the viewport so the popover never overflows the right edge of
      // narrow screens.
      const maxLeft = Math.max(8, window.innerWidth - 368);
      setPopoverAnchor({
        top: rect.bottom + 6,
        left: Math.min(rect.left, maxLeft),
        width: Math.min(360, window.innerWidth - 16),
      });
    }
    reanchor();
    function onPointer(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (paceButtonRef.current?.contains(target)) return;
      setPopoverOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPopoverOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reanchor, true);
    window.addEventListener("resize", reanchor);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reanchor, true);
      window.removeEventListener("resize", reanchor);
    };
  }, [popoverOpen]);

  const contributorList = paceState === "behind" ? topBehind : paceState === "ahead" ? topAhead : [];
  const paceClickable =
    (paceState === "behind" && topBehind.length > 0) ||
    (paceState === "ahead" && topAhead.length > 0);

  // Render the pace KPI either as part of the floating chip (inline) or as
  // a row in the side column. Both spellings share the same click target
  // and the same anchor ref so the popover still tracks the chip across
  // layouts.
  const renderPaceCell = (variant: "inline" | "row") => {
    if (paceState === "behind" && paceMagnitude != null) {
      return (
        <button
          ref={paceButtonRef}
          type="button"
          disabled={!paceClickable}
          onClick={() => setPopoverOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded text-amber-700 transition-colors",
            paceClickable
              ? variant === "inline"
                ? "cursor-pointer hover:bg-amber-50 hover:text-amber-800 px-1 -mx-1"
                : "cursor-pointer hover:bg-amber-50 hover:text-amber-800 px-1 -ml-1"
              : "cursor-default",
            variant === "row" && "justify-start text-left",
          )}
          title={paceClickable ? `Show top ${topBehind.length} epic${topBehind.length === 1 ? "" : "s"} behind plan` : undefined}
        >
          <span aria-hidden>⚠</span>
          <span className="tabular-nums font-semibold">{paceMagnitude.toFixed(decimals)}{unitSuffix}</span>
          <span className="text-amber-600">behind</span>
        </button>
      );
    }
    if (paceState === "ahead" && paceMagnitude != null) {
      return (
        <button
          ref={paceButtonRef}
          type="button"
          disabled={!paceClickable}
          onClick={() => setPopoverOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded text-emerald-700 transition-colors",
            paceClickable
              ? variant === "inline"
                ? "cursor-pointer hover:bg-emerald-50 hover:text-emerald-800 px-1 -mx-1"
                : "cursor-pointer hover:bg-emerald-50 hover:text-emerald-800 px-1 -ml-1"
              : "cursor-default",
            variant === "row" && "justify-start text-left",
          )}
          title={paceClickable ? `Show top ${topAhead.length} epic${topAhead.length === 1 ? "" : "s"} ahead of plan` : undefined}
        >
          <span aria-hidden>✓</span>
          <span className="tabular-nums font-semibold">{paceMagnitude.toFixed(decimals)}{unitSuffix}</span>
          <span className="text-emerald-600">ahead</span>
        </button>
      );
    }
    if (paceState === "onPace") {
      return (
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <span aria-hidden>✓</span>
          <span>on pace</span>
        </span>
      );
    }
    return <span className="text-slate-400">pace —</span>;
  };

  // The side-column legend rows — used in side layout AND when the
  // floating layout is told to hide its inline Recharts legend (Hero
  // card path); kept identical so both layouts read the same.
  const sideLegendRows: Array<{ label: string; color: string }> = [
    { label: "Actual", color: "#2563eb" },
    { label: "Forecast", color: "#0ea5e9" },
    { label: "Ideal pace", color: "#f97316" },
  ];

  // The chart subtree itself — same JSX in both layouts. Extracted so the
  // floating / side wrappers don't have to duplicate it.
  // Recharts auto-hides its inline legend whenever the side column owns
  // the legend rendering (kpiPlacement="side" implies hideLegend).
  const inlineLegendHidden = hideLegend || kpiPlacement === "side";
  // Floating layout uses a 36px top margin to clear the chip; side
  // layout doesn't need that, so axes get more vertical room.
  const chartTopMargin = kpiPlacement === "side" ? 8 : 36;

  return (
    <div className="relative h-full w-full">
      {kpiPlacement === "floating" ? (
        /* Floating KPI strip — three numbers in one chip pinned top-left,
         *  mirroring the HealthBadge placement used in the per-epic
         *  burndown so the visual language stays consistent across charts.
         *  Used by the customizable Dashboard cards which give the chart
         *  the full card width to breathe. */
        <div className="absolute left-3 top-1 z-10 flex items-center gap-2 rounded-md bg-white/85 px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm ring-1 ring-slate-200/80 backdrop-blur-sm">
          <span>
            Done <span className="tabular-nums font-semibold text-slate-900">{doneEpicCount}/{totalEpicCount}</span>{" "}
            <span className="text-slate-500">epics</span>
          </span>
          <span className="text-slate-300">·</span>
          {renderPaceCell("inline")}
          <span className="text-slate-300">·</span>
          <span className={etaDate == null ? "text-slate-400" : etaWithinPeriod ? "text-emerald-700" : "text-amber-700"}>
            ETA <span className="tabular-nums font-semibold">{formatEta(etaDate)}</span>
            {etaDate != null ? (etaWithinPeriod ? " ✓" : " ⚠") : ""}
          </span>
        </div>
      ) : null}

      {/* Contributor popover — renders into document.body via a portal so
       *  the Hero row's `overflow-x-auto` (which also clips vertical
       *  overflow) can't truncate the bottom of the list. Positioned with
       *  `position: fixed` anchored to the chip's viewport rect; re-
       *  anchored on scroll / resize so it tracks the chip. */}
      {popoverOpen && contributorList.length > 0 && popoverAnchor && typeof document !== "undefined" ? (
        createPortal(
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            top: popoverAnchor.top,
            left: popoverAnchor.left,
            width: popoverAnchor.width,
          }}
          className="z-[1000] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl ring-1 ring-slate-900/5"
          role="dialog"
          aria-label={paceState === "behind" ? "Epics behind plan" : "Epics ahead of plan"}
        >
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              {paceState === "behind"
                ? `Top ${contributorList.length} behind plan`
                : `Top ${contributorList.length} ahead of plan`}
            </span>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              aria-label="Close"
            >
              <span aria-hidden>×</span>
            </button>
          </div>
          <ul className="max-h-[260px] overflow-y-auto py-1">
            {contributorList.map((c) => {
              const abs = Math.abs(c.delta);
              const rowClickable = !!onSelectLaggards;
              return (
                <li key={c.epicId}>
                  <button
                    type="button"
                    disabled={!rowClickable}
                    onClick={() => {
                      if (!onSelectLaggards) return;
                      const sideLabel = paceState === "behind" ? "behind plan" : "ahead of plan";
                      onSelectLaggards([c.epicId], `1 epic ${sideLabel}`);
                      setPopoverOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-slate-700 transition-colors",
                      rowClickable
                        ? "cursor-pointer hover:bg-slate-50"
                        : "cursor-default",
                    )}
                    title={rowClickable ? "Highlight this epic on the Roadmap" : undefined}
                  >
                    <span
                      className={cn(
                        "inline-flex h-1.5 w-1.5 shrink-0 rounded-full",
                        paceState === "behind" ? "bg-amber-500" : "bg-emerald-500",
                      )}
                      aria-hidden
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium text-slate-800">{c.epicTitle}</span>
                      <span className="truncate text-[10.5px] text-slate-500">{c.initiativeTitle}</span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums font-semibold",
                        paceState === "behind" ? "text-amber-700" : "text-emerald-700",
                      )}
                    >
                      {abs.toFixed(decimals)}{unitSuffix}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {/* "Highlight all" footer — only shown when the caller wired the
           *  cross-mode emit. Sends every epic in the list (not just the
           *  visible top 8) so the Roadmap filter covers everyone behind. */}
          {onSelectLaggards ? (
            <div className="border-t border-slate-100 bg-slate-50 px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  const fullList = paceState === "behind" ? topBehind : topAhead;
                  if (fullList.length === 0) return;
                  const ids = fullList.map((c) => c.epicId);
                  const sideLabel = paceState === "behind" ? "behind plan" : "ahead of plan";
                  const label = `${ids.length} epic${ids.length === 1 ? "" : "s"} ${sideLabel}`;
                  onSelectLaggards(ids, label);
                  setPopoverOpen(false);
                }}
                className={cn(
                  "inline-flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-semibold transition-colors",
                  paceState === "behind"
                    ? "bg-amber-100 text-amber-800 hover:bg-amber-200/80"
                    : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200/80",
                )}
              >
                Highlight {contributorList.length} on Roadmap →
              </button>
            </div>
          ) : null}
        </div>,
        document.body,
        )
      ) : null}
      {/* Chart + optional side column. In `floating` placement the chart
       *  takes the full width and the floating chip overlays it. In
       *  `side` placement, the chart takes the flex-1 left half and a
       *  KPI + legend column sits on the right. */}
      <div className={cn("flex h-full w-full flex-row", kpiPlacement === "side" ? "gap-2" : "gap-3")}>
        <div className={cn("relative h-full min-w-0", kpiPlacement === "side" ? "flex-1" : "w-full")}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={rows}
              margin={{
                top: chartTopMargin,
                right: kpiPlacement === "side" ? 12 : 56,
                // Side layout drops the rotated Y-axis label entirely,
                // so the YAxis itself can be ~30px wide and the chart's
                // left margin can shrink toward zero — giving the lines
                // and grid noticeably more horizontal room.
                left: kpiPlacement === "side" ? -10 : 16,
                bottom: 0,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} ticks={xAxisTicks} />
              <YAxis
                tick={{ fontSize: 10 }}
                width={kpiPlacement === "side" ? 30 : 48}
                allowDecimals={progressBasis !== "stories"}
                label={
                  kpiPlacement === "side"
                    ? undefined
                    : {
                        value: basisYAxisLabel(progressBasis),
                        angle: -90,
                        position: "insideLeft",
                        offset: 0,
                        style: { fontSize: 11, fill: "#475569", fontWeight: 600 },
                      }
                }
                domain={[0, Math.max(1, Math.ceil(startTotal * 1.12))]}
              />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
              {inlineLegendHidden ? null : (
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
              )}
          {todayLabel ? (
            <ReferenceLine
              x={todayLabel}
              stroke="#94a3b8"
              strokeDasharray="4 2"
              label={{ value: "Today", position: "insideTop", fontSize: 10, fill: "#64748b" }}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="actual"
            stroke="#2563eb"
            dot={false}
            strokeWidth={2}
            name="Actual"
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ideal"
            stroke="#f97316"
            strokeDasharray="6 4"
            dot={false}
            strokeWidth={1.5}
            name="Ideal pace"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="forecast"
            stroke="#0ea5e9"
            strokeDasharray="2 4"
            dot={false}
            strokeWidth={1.5}
            name="Forecast"
            connectNulls={true}
            isAnimationActive={false}
          />
          {/* Quarter-end marker at zero — the destination the ideal line is
           *  aiming at, and the bar against which the forecast is judged. */}
          <ReferenceDot
            x={endLabel}
            y={0}
            r={5}
            fill="#fff"
            stroke="#dc2626"
            strokeWidth={2}
            label={{ value: `End ${endLabel}`, position: "top", fontSize: 10, fill: "#dc2626" }}
          />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {/* Side column — only rendered in `side` placement. Three KPI
         *  rows (Done / pace / ETA); the chart-line legend (Actual /
         *  Forecast / Ideal pace) lives at the card's title strip in the
         *  hero, so we don't repeat it here. Narrower width (110px)
         *  hands more horizontal pixels to the chart itself. */}
        {kpiPlacement === "side" ? (
          <aside className="flex w-[110px] shrink-0 flex-col justify-center gap-1.5 text-[11px] text-slate-700">
            <div>
              <span className="text-slate-500">Done</span>{" "}
              <span className="tabular-nums font-semibold text-slate-900">
                {doneEpicCount}/{totalEpicCount}
              </span>{" "}
              <span className="text-slate-500">epics</span>
            </div>
            {renderPaceCell("row")}
            <div className={etaDate == null ? "text-slate-400" : etaWithinPeriod ? "text-emerald-700" : "text-amber-700"}>
              <span className="text-slate-500">ETA</span>{" "}
              <span className="tabular-nums font-semibold">{formatEta(etaDate)}</span>
              {etaDate != null ? (etaWithinPeriod ? " ✓" : " ⚠") : ""}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
