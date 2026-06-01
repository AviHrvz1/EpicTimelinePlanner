"use client";

import { Inbox, Send, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { UserStoryIcon } from "@/components/ui/user-story-icon";
import type { RolledInStoryRow } from "@/lib/story-rollover-history";

interface RolledStoriesModalProps {
  /** The sprint being audited. Shown in the header label. */
  yearSprint: number;
  /** "in" → "Rolled into Sprint N (from S{fromSprint})"; "out" →
   *  "Rolled out of Sprint N (to S{toSprint})". The column showing the
   *  partner sprint is labeled accordingly. */
  direction: "in" | "out";
  rows: RolledInStoryRow[];
  onClose: () => void;
  onOpenStory?: (storyId: string) => void;
}

/**
 * Audit modal — "what rolled in / what rolled out". Opened from the
 * breadcrumb `Rolled in N` chip (destination side) or `Rolled out N` chip
 * (source side). Lists every story whose history shows it was moved
 * (manually via {@link SprintMoveModal} or by the legacy auto-rollover)
 * across the sprint boundary, with the partner sprint visible.
 *
 * Mirrors `InsightsDrilldownModal`'s chrome so the visual lineage stays
 * consistent with the rest of the analytics drilldowns.
 */
export function RolledInStoriesModal({
  yearSprint,
  direction,
  rows,
  onClose,
  onOpenStory,
}: RolledStoriesModalProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const isOutbound = direction === "out";
  const HeaderIcon = isOutbound ? Send : Inbox;
  const headerLabel = isOutbound
    ? `Rolled out of Sprint ${yearSprint}`
    : `Rolled into Sprint ${yearSprint}`;
  const partnerColumnLabel = isOutbound ? "To" : "From";
  const emptyLabel = isOutbound
    ? "Nothing rolled out of this sprint."
    : "Nothing rolled into this sprint.";

  return createPortal(
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="relative flex h-[78vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-2xl ring-4 ring-sky-100/70 animate-in fade-in zoom-in-95 duration-150"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <HeaderIcon className="size-4 shrink-0 text-slate-600" aria-hidden />
            <h3 className="truncate text-[15px] font-semibold text-slate-800">
              {headerLabel}
            </h3>
            <span className="shrink-0 text-[12px] text-slate-500">
              {rows.length} stor{rows.length === 1 ? "y" : "ies"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isOutbound ? "Close rolled-out audit" : "Close rolled-in audit"}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
          <div className="h-full overflow-hidden rounded-lg ring-1 ring-slate-200">
            <div className="h-full overflow-auto bg-white">
              {rows.length === 0 ? (
                <p className="px-3 py-8 text-center text-[13px] text-slate-500">
                  {emptyLabel}
                </p>
              ) : (
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead className="sticky top-0 bg-[#0897d5] text-white">
                    <tr>
                      <th className="px-2 py-1 text-[14px] font-semibold">Story ID</th>
                      <th className="w-[36%] min-w-[18rem] px-2 py-1 text-[14px] font-semibold">
                        Story name
                      </th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Epic</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Initiative</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">{partnerColumnLabel}</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Assignee</th>
                      <th className="px-2 py-1 text-[14px] font-semibold">Status</th>
                      <th className="px-2 py-1 text-right text-[14px] font-semibold">Est days</th>
                      <th className="px-2 py-1 text-right text-[14px] font-semibold">Est days left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ story, epic, initiative, fromSprint }) => (
                      <tr
                        key={story.id}
                        className="border-t border-[#7cd3f7]/95 text-slate-700 odd:bg-[#d8f2ff] even:bg-white transition hover:bg-[#c5ebff]"
                      >
                        <td className="px-2 py-1">
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <UserStoryIcon className="size-3.5" />
                            <button
                              type="button"
                              onClick={() => onOpenStory?.(story.id)}
                              className="truncate font-semibold text-blue-700 underline-offset-2 hover:underline"
                            >
                              {story.id.slice(0, 8)}
                            </button>
                          </span>
                        </td>
                        <td className="px-2 py-1">{story.title}</td>
                        <td className="px-2 py-1 truncate">{epic.title}</td>
                        <td className="px-2 py-1 truncate">{initiative.title}</td>
                        <td className="px-2 py-1 tabular-nums">
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200/80">
                            S{fromSprint}
                          </span>
                        </td>
                        <td className="px-2 py-1">{story.assignee?.trim() || "Unassigned"}</td>
                        <td className="px-2 py-1">{story.status}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{story.estimatedDays ?? "—"}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{story.daysLeft ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
