"use client";

import { Camera } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Thin sticky header strip mounted above closed-period views (sprint kanban /
 * capacity in a closed sprint, month / quarter team capacity for a past
 * period, and the closed-year roadmap header). Tells the user three things at
 * a glance:
 *
 *   1. The view is a snapshot, not live state.
 *   2. When the snapshot was taken (the period's close date).
 *   3. How many items rolled forward to the next period, with a button to
 *      reveal the grouped list (see {@link RolloverOverflowModal}).
 *
 * When `rolledCount === 0` the sentence reads "everything completed in this
 * {periodLabel}" and the reveal button is hidden — nothing useful to dig
 * into. When `onShowDetails` is omitted entirely the strip is informational
 * only (used by the closed-year strip when continuations weren't created).
 */
export type SnapshotHeaderStripScope = "sprint" | "month" | "quarter" | "year";
/**
 * Whether the strip is being mounted above a board surface (kanban /
 * capacity columns) — where the framing is "N items rolled to next
 * period" — or above a charts surface (analytics tabs) — where the
 * framing is "charts show end-of-period state."
 */
export type SnapshotHeaderStripFraming = "board" | "charts";

interface SnapshotHeaderStripProps {
  scope: SnapshotHeaderStripScope;
  /** Display name of the closed period (e.g. "Sprint 6", "March", "Q1", "2026"). */
  periodLabel: string;
  /** Friendly close date label (e.g. "Mar 31, 2026"). */
  closeDateLabel: string;
  /** Total items (stories for sprint scope; epics for month/quarter/year) rolled out of this period. */
  rolledCount: number;
  /** Name of the next period the rolled items landed in. */
  nextPeriodLabel: string;
  /** When set, the strip exposes a `Show what rolled out (N)` button. */
  onShowDetails?: () => void;
  /** Defaults to "board". On charts surfaces (sprint status / month +
   *  quarter analytics) the strip explains the snapshot in chart terms
   *  rather than rollover terms. */
  framing?: SnapshotHeaderStripFraming;
}

const SCOPE_NOUN: Record<SnapshotHeaderStripScope, { singular: string; plural: string }> = {
  sprint: { singular: "ticket", plural: "tickets" },
  month: { singular: "epic", plural: "epics" },
  quarter: { singular: "epic", plural: "epics" },
  year: { singular: "epic", plural: "epics" },
};

export function SnapshotHeaderStrip({
  scope,
  periodLabel,
  closeDateLabel,
  rolledCount,
  nextPeriodLabel,
  onShowDetails,
  framing = "board",
}: SnapshotHeaderStripProps) {
  const noun = rolledCount === 1 ? SCOPE_NOUN[scope].singular : SCOPE_NOUN[scope].plural;
  return (
    <div
      role="note"
      aria-label={`Snapshot of ${periodLabel}`}
      className={cn(
        "mb-2 flex items-start gap-2 rounded-md border border-slate-200/80 bg-slate-50/80 px-2.5 py-1.5 text-[12px] leading-snug text-slate-600 shadow-sm",
      )}
    >
      <Camera className="mt-[1px] size-3.5 shrink-0 text-slate-500" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold text-slate-800">Snapshot of {periodLabel}</span>{" "}
        <span className="text-slate-500">· frozen at {closeDateLabel}.</span>{" "}
        {framing === "charts" ? (
          <span>Charts show end-of-{scope} state.</span>
        ) : rolledCount === 0 ? (
          <span>Everything completed in this {scope}.</span>
        ) : (
          <span>
            <span className="font-semibold text-slate-800">{rolledCount}</span> {noun} rolled to {nextPeriodLabel}.
          </span>
        )}
      </p>
      {framing === "board" && onShowDetails && rolledCount > 0 ? (
        <button
          type="button"
          onClick={onShowDetails}
          className="shrink-0 rounded-md border border-indigo-200 bg-white px-2 py-0.5 text-[11.5px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-50"
        >
          Show what rolled out ({rolledCount})
        </button>
      ) : null}
    </div>
  );
}
