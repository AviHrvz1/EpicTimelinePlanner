"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Flag, Folder, Loader2, Users, X, Zap } from "lucide-react";

import { StoryStatus } from "@/lib/generated/prisma";
import {
  collectMovableStoriesForSprint,
  groupMovableRowsByEpic,
} from "@/lib/sprint-close-move";
import type { InitiativeItem } from "@/lib/types";
import { YEAR_SPRINT_MAX } from "@/lib/year-sprint";
import { cn } from "@/lib/utils";
import { UserAvatar, resolveAssigneeAvatar } from "@/components/ui/user-avatar";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { monthTeamLabelForId } from "@/lib/month-team-board";
import { formatAssigneeShortLabel } from "@/lib/assignee-display";

type StatusBadgeProps = { status: StoryStatus };
function StatusBadge({ status }: StatusBadgeProps) {
  const meta = (() => {
    switch (status) {
      case StoryStatus.todo:
        return { label: "To Do", className: "border-amber-200/80 bg-amber-50 text-amber-800" };
      case StoryStatus.inProgress:
        return { label: "In Progress", className: "border-blue-200/80 bg-blue-50 text-blue-800" };
      case StoryStatus.review:
        return { label: "Review / Testing", className: "border-violet-200/80 bg-violet-50 text-violet-800" };
      case StoryStatus.done:
        return { label: "Done", className: "border-emerald-200/80 bg-emerald-50 text-emerald-800" };
    }
  })();
  return (
    <span className={cn("shrink-0 rounded border px-1 py-px text-[10px] font-medium leading-tight", meta.className)}>
      {meta.label}
    </span>
  );
}

export interface SprintMoveModalProps {
  initiatives: InitiativeItem[];
  /** Source sprint — the closed sprint whose unfinished work might move. */
  fromSprint: number;
  /** Sprint board scope month (same as kanban/capacity context). */
  month: number;
  filterEpicTeamIds?: string[] | null;
  /** Calendar year for the source sprint. Used to display "Sprint 1 ({year+1})"
   *  when the source is the year cap. */
  planYear: number;
  /** When source is `YEAR_SPRINT_MAX` and the roadmap has no next year, the
   *  modal becomes the year-end continuation prompt instead of a within-year
   *  move. Clicking the primary action calls `onConfirmYearEnd`. */
  isYearBoundaryBlocked: boolean;
  /** Within-year move handler. Receives the checked story ids and whether to
   *  also rewrite the sprint capacity board buckets. */
  onConfirmMove: (storyIds: string[], moveCapacity: boolean) => Promise<void>;
  /** Year-end continuation handler. Pulled in from `epic-planner-app` so the
   *  existing "Add YYYY+1 and continue" flow can be triggered through the
   *  same modal. */
  onConfirmYearEnd: () => Promise<void>;
  onDismiss: () => void;
  /** Optional workspace user directory — supplies avatar images for assignees. */
  workspaceDirectoryUsers?: readonly { name: string; image?: string | null }[] | null;
}

/**
 * Confirmation dialog for the manual "Move unfinished work to next sprint"
 * action. Lists every movable story (todo / inProgress / review) grouped by
 * its parent epic, with per-row checkboxes default-checked. `done` stories
 * are NOT in the list — they're terminal and stay on the closed sprint
 * board representing what shipped.
 */
export function SprintMoveModal({
  initiatives,
  fromSprint,
  month,
  filterEpicTeamIds = null,
  planYear,
  isYearBoundaryBlocked,
  onConfirmMove,
  onConfirmYearEnd,
  onDismiss,
  workspaceDirectoryUsers = null,
}: SprintMoveModalProps) {
  const movableRows = useMemo(
    () => collectMovableStoriesForSprint(initiatives, month, fromSprint, filterEpicTeamIds),
    [initiatives, month, fromSprint, filterEpicTeamIds],
  );
  const groups = useMemo(() => groupMovableRowsByEpic(movableRows), [movableRows]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(movableRows.map((r) => r.story.id)));
  const [moveCapacity, setMoveCapacity] = useState(true);
  const [busy, setBusy] = useState(false);

  // Reset checkbox state if the movable set changes shape (e.g., the user
  // edits a story's status outside the modal while it's open).
  useEffect(() => {
    setChecked((prev) => {
      const next = new Set<string>();
      for (const row of movableRows) {
        if (prev.has(row.story.id)) next.add(row.story.id);
        else next.add(row.story.id); // default-check newly-visible candidates
      }
      return next;
    });
  }, [movableRows]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onDismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [busy, onDismiss]);

  const toggle = (storyId: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(storyId)) next.delete(storyId);
      else next.add(storyId);
      return next;
    });

  const checkedCount = checked.size;
  const toSprint = fromSprint + 1;
  const atYearCap = fromSprint >= YEAR_SPRINT_MAX;

  const fromLabel = `Sprint ${fromSprint}`;
  const toLabel = isYearBoundaryBlocked
    ? `${planYear + 1}`
    : atYearCap
      ? `Sprint 1 (${planYear + 1})`
      : `Sprint ${toSprint}`;
  /** Header title is split so we can inline the rose flag immediately
   *  before the destination "Sprint N" — matches the breadcrumb chip. */
  const headerTitlePrefix = isYearBoundaryBlocked
    ? `${movableRows.length} ${movableRows.length === 1 ? "story" : "stories"} need continuation in `
    : "Move unfinished work to ";
  /** Short destination label for the footer button — uses `S{n}` rather
   *  than the full "Sprint N" wording so the button stays compact. */
  const shortToLabel = isYearBoundaryBlocked
    ? `${planYear + 1}`
    : atYearCap
      ? `S1 (${planYear + 1})`
      : `S${toSprint}`;

  /** Team scope chips for the header — when the move is scoped to one or
   *  more team filters, each becomes a small `{TeamAvatar} {Label}` chip
   *  beside the destination sprint. Empty filter == all teams (single
   *  "All teams" chip) so the user always sees the scope. */
  const teamScopeChips = useMemo(() => {
    if (!filterEpicTeamIds || filterEpicTeamIds.length === 0) {
      return [{ slug: null as string | null, label: "All teams" }];
    }
    return filterEpicTeamIds.map((slug) => ({
      slug,
      label: monthTeamLabelForId(slug) ?? slug,
    }));
  }, [filterEpicTeamIds]);

  const handlePrimaryAction = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isYearBoundaryBlocked) {
        await onConfirmYearEnd();
      } else {
        await onConfirmMove(Array.from(checked), moveCapacity);
      }
    } finally {
      setBusy(false);
    }
  };

  const primaryLabel = isYearBoundaryBlocked
    ? `Add ${planYear + 1} and continue`
    : checkedCount === 0
      ? "Nothing to move"
      : `Move ${checkedCount} ${checkedCount === 1 ? "story" : "stories"} to ${shortToLabel}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Move unfinished work from ${fromLabel}`}
      className="fixed inset-0 z-[9500] flex items-center justify-center bg-slate-900/40 p-6 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onDismiss();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 ring-1 ring-black/5">
        <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
            <ArrowRight className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="inline-flex flex-wrap items-center gap-1.5 text-[15px] font-bold tracking-tight text-slate-900">
              <span>{headerTitlePrefix}</span>
              <span className="inline-flex items-center gap-1">
                <Flag className="size-3.5 shrink-0 text-rose-500" strokeWidth={2.25} aria-hidden />
                <span>{toLabel}</span>
              </span>
              {!isYearBoundaryBlocked ? (
                <>
                  <span className="text-slate-400">·</span>
                  {teamScopeChips.map((team) => (
                    <span
                      key={team.slug ?? "all"}
                      className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 ring-1 ring-indigo-200/80"
                      title={team.label}
                    >
                      {team.slug ? (
                        <TeamAvatar
                          slug={team.slug}
                          sizePx={14}
                          rounded="rounded-[3px]"
                          fallback={<Users className="size-3 shrink-0 text-indigo-500" aria-hidden />}
                        />
                      ) : (
                        <Users className="size-3 shrink-0 text-indigo-500" aria-hidden />
                      )}
                      <span className="truncate">{team.label}</span>
                    </span>
                  ))}
                </>
              ) : null}
            </h2>
            <p className="mt-1 text-[12.5px] leading-snug text-slate-600">
              {isYearBoundaryBlocked
                ? `${planYear + 1} isn't in your roadmap yet — adding it creates continuation initiatives and epics, then carries these stories forward.`
                : `${movableRows.length} ${movableRows.length === 1 ? "story is" : "stories are"} unfinished in ${fromLabel}. Done cards stay on the closed sprint board.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Dismiss"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {groups.length === 0 ? (
            <p className="rounded-md border border-emerald-200/80 bg-emerald-50/60 px-3 py-2 text-[12.5px] text-emerald-800">
              Every ticket in {fromLabel} is done. Nothing to move forward.
            </p>
          ) : (
            <ul className="space-y-3">
              {groups.map((group) => (
                <li
                  key={group.epicId}
                  className="rounded-md border border-slate-200/70 bg-slate-50/40 p-2.5"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Folder className="size-3.5 shrink-0 text-sky-500" aria-hidden />
                    <span className="min-w-0 truncate text-[12.5px] font-semibold text-slate-900">
                      {group.epicTitle}
                    </span>
                    <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-slate-400">
                      <Zap className="mr-0.5 inline-block size-3 text-blue-600/70" aria-hidden />
                      {group.initiativeTitle}
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {group.items.map((row) => {
                      const id = row.story.id;
                      const on = checked.has(id);
                      const rawAssignee = row.story.assignee?.trim() ?? "";
                      const resolved = resolveAssigneeAvatar(rawAssignee, workspaceDirectoryUsers);
                      const displayName = rawAssignee
                        ? formatAssigneeShortLabel(resolved.name || rawAssignee)
                        : "Unassigned";
                      return (
                        <li key={id}>
                          <label className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] leading-snug text-slate-700 hover:bg-white">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggle(id)}
                              disabled={busy || isYearBoundaryBlocked}
                              className="size-3.5 shrink-0 cursor-pointer"
                            />
                            <UserStoryIcon className="size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{row.story.title}</span>
                            <StatusBadge status={row.story.status} />
                            <span className="inline-flex shrink-0 items-center gap-1.5 text-[10.5px] text-slate-500">
                              <UserAvatar
                                name={rawAssignee || undefined}
                                image={resolved.image}
                                size={18}
                                title={rawAssignee || "Unassigned"}
                              />
                              <span className="max-w-[8rem] truncate">{displayName}</span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!isYearBoundaryBlocked ? (
          <div className="border-t border-slate-100 px-5 py-2.5">
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-slate-600">
              <input
                type="checkbox"
                checked={moveCapacity}
                onChange={(e) => setMoveCapacity(e.target.checked)}
                disabled={busy}
                className="mt-0.5 size-3.5 shrink-0 cursor-pointer"
              />
              <span>
                <strong className="font-semibold text-slate-800">Also move capacity assignments.</strong>{" "}
                Each moved card lands in the same assignee bucket on {toLabel}. Uncheck to drop them into &quot;Other assignees&quot; for re-balancing.
              </span>
            </label>
          </div>
        ) : null}
        <footer className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={busy || (!isYearBoundaryBlocked && checkedCount === 0)}
            className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-1.5 text-[12.5px] font-bold text-white shadow-sm shadow-indigo-500/30 transition hover:from-indigo-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                <span>Working…</span>
              </>
            ) : (
              <>
                <Check className="size-3.5" aria-hidden />
                <span>{primaryLabel}</span>
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
