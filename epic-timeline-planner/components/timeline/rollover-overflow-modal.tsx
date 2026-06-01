"use client";

import { useEffect } from "react";
import { Folder, Package, X, Zap } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared modal that lists items rolled out of one period into the next,
 * grouped by their parent unit (epic when scope is "sprint", initiative
 * when scope is "month" / "quarter" / "year"). Reused by:
 *
 *   - The sprint rollover event dialog (fires once when the rollover effect
 *     moves stories).
 *   - The "Show what rolled out" reveal from {@link SnapshotHeaderStrip}
 *     on closed sprint kanban / capacity, past month / quarter team
 *     capacity, and the closed-year strip.
 *   - The year-end overflow dialog (with a primary action wired to
 *     create-continuations).
 *
 * Layout: header line ("N items moved from {from} → {to}"), optional
 * crossing callout chips, grouped bullets (parent title + children rows),
 * optional primary action button + dismiss. Z-index 9500 matches the
 * existing YearEndOverflowDialog so they layer consistently.
 */
export type RolloverScope = "sprint" | "month" | "quarter" | "year";

export type RolloverItem = {
  id: string;
  title: string;
  detail?: string;
  onClick?: () => void;
};

export type RolloverGroup = {
  parentTitle: string;
  parentSubtitle?: string;
  parentKind: "initiative" | "epic";
  items: RolloverItem[];
};

export interface RolloverOverflowModalProps {
  scope: RolloverScope;
  /** Source period (e.g. "Sprint 6", "March", "Q1", "2026"). */
  fromLabel: string;
  /** Destination period (e.g. "Sprint 7", "April", "Q2", "2027"). */
  toLabel: string;
  groups: RolloverGroup[];
  totalCount: number;
  /** Optional callouts surfaced as small chips below the header — e.g.
   *  "3 of these cross into April (Q2)". */
  crossingNotes?: string[];
  /** When set, renders a primary CTA button (e.g. "Add 2027") alongside the
   *  Dismiss button. */
  primaryAction?: { label: string; onClick: () => void; busy?: boolean };
  onDismiss: () => void;
}

const SCOPE_VERB: Record<RolloverScope, string> = {
  sprint: "moved",
  month: "carrying work into",
  quarter: "carrying work into",
  year: "carried over to",
};

const SCOPE_NOUN: Record<RolloverScope, { singular: string; plural: string }> = {
  sprint: { singular: "story", plural: "stories" },
  month: { singular: "epic", plural: "epics" },
  quarter: { singular: "epic", plural: "epics" },
  year: { singular: "epic", plural: "epics" },
};

export function RolloverOverflowModal({
  scope,
  fromLabel,
  toLabel,
  groups,
  totalCount,
  crossingNotes,
  primaryAction,
  onDismiss,
}: RolloverOverflowModalProps) {
  // Escape key closes the modal — keeps parity with browser dialog conventions
  // and avoids trapping the user inside a popup with no obvious exit.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onDismiss]);

  const noun = totalCount === 1 ? SCOPE_NOUN[scope].singular : SCOPE_NOUN[scope].plural;
  const verb = SCOPE_VERB[scope];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${totalCount} ${noun} ${verb} from ${fromLabel} to ${toLabel}`}
      className="fixed inset-0 z-[9500] flex items-center justify-center bg-slate-900/40 p-6 backdrop-blur-sm"
      onClick={(e) => {
        // Click on the backdrop dismisses; clicks inside the dialog body
        // bubble normally so child onClick handlers work.
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 ring-1 ring-black/5">
        <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
            <Package className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold tracking-tight text-slate-900">
              {totalCount} {noun} {verb} {fromLabel} → {toLabel}
            </h2>
            {crossingNotes && crossingNotes.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {crossingNotes.map((note) => (
                  <span
                    key={note}
                    className="inline-flex items-center rounded border border-amber-200/80 bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-800"
                  >
                    {note}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Dismiss"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {groups.length === 0 ? (
            <p className="text-[12.5px] text-slate-500">Nothing to show.</p>
          ) : (
            <ul className="space-y-3">
              {groups.map((group, idx) => {
                const ParentIcon = group.parentKind === "initiative" ? Zap : Folder;
                const parentIconClass =
                  group.parentKind === "initiative" ? "text-blue-600" : "text-sky-500";
                return (
                  <li key={`${group.parentTitle}-${idx}`} className="rounded-md border border-slate-200/70 bg-slate-50/40 p-2.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <ParentIcon className={cn("size-3.5 shrink-0", parentIconClass)} aria-hidden />
                      <span className="min-w-0 truncate text-[12.5px] font-semibold text-slate-900">
                        {group.parentTitle}
                      </span>
                      {group.parentSubtitle ? (
                        <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-slate-400">
                          {group.parentSubtitle}
                        </span>
                      ) : null}
                    </div>
                    <ul className="mt-1.5 space-y-0.5 pl-[1.25rem]">
                      {group.items.map((item) => {
                        const interactive = typeof item.onClick === "function";
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => item.onClick?.()}
                              disabled={!interactive}
                              className={cn(
                                "group/item flex w-full min-w-0 items-baseline gap-2 rounded px-1.5 py-0.5 text-left text-[12px] leading-snug text-slate-700",
                                interactive
                                  ? "hover:bg-white hover:text-indigo-700"
                                  : "cursor-default",
                              )}
                            >
                              <span className="text-[10px] text-slate-400" aria-hidden>
                                •
                              </span>
                              <span className="min-w-0 flex-1 truncate">{item.title}</span>
                              {item.detail ? (
                                <span className="shrink-0 text-[10.5px] text-slate-500">{item.detail}</span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onDismiss}
            disabled={primaryAction?.busy}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {primaryAction ? "Cancel" : "Dismiss"}
          </button>
          {primaryAction ? (
            <button
              type="button"
              onClick={primaryAction.onClick}
              disabled={primaryAction.busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-1.5 text-[12.5px] font-bold text-white shadow-sm shadow-indigo-500/30 transition hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50"
            >
              {primaryAction.busy ? "Working…" : primaryAction.label}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
