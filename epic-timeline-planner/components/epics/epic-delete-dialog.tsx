"use client";

import { AlertTriangle, X } from "lucide-react";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { EpicItem, UserStoryItem } from "@/lib/types";
import { epicDeliveryTeamAssignmentChip } from "@/lib/month-team-board";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";

const STATUS_BADGE: Record<string, string> = {
  todo:       "bg-slate-100 text-slate-600",
  inProgress: "bg-blue-100 text-blue-700",
  done:       "bg-emerald-100 text-emerald-700",
  approved:   "bg-violet-100 text-violet-700",
};
const STATUS_LABEL: Record<string, string> = {
  todo:       "To Do",
  inProgress: "In Progress",
  done:       "Done",
  approved:   "Approved",
};

function TeamChip({ teamId }: { teamId: string }) {
  const chip = epicDeliveryTeamAssignmentChip(teamId);
  return <span className={chip.className}>{chip.label}</span>;
}

type Props = {
  epic: EpicItem;
  onConfirm: () => void;
  onCancel: () => void;
  deleting?: boolean;
};

export function EpicDeleteDialog({ epic, onConfirm, onCancel, deleting = false }: Props) {
  const stories = epic.userStories ?? [];

  const content = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-2xl ring-4 ring-rose-100/70 flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-slate-100 px-6 py-5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-red-600 shadow-md shadow-rose-200/70 ring-1 ring-white">
            <AlertTriangle className="size-5 text-white" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-extrabold tracking-tight text-slate-900">
              Delete &ldquo;{epic.title}&rdquo;?
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-slate-600">
              This will permanently remove the epic and{" "}
              <strong className="font-semibold text-slate-800">{stories.length} associated user stor{stories.length !== 1 ? "ies" : "y"}</strong>.
            </p>
            <p className="mt-1 text-[13.5px] font-semibold text-rose-600">
              Once deleted, it cannot be recovered.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Table */}
        {stories.length > 0 && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="overflow-hidden rounded-lg ring-1 ring-slate-200">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col style={{ width: "38%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "12%" }} />
                </colgroup>
                <thead className="bg-[#0897d5] text-white">
                  <tr>
                    <th className="px-3 py-2 text-[12px] font-semibold">Story</th>
                    <th className="px-3 py-2 text-[12px] font-semibold">Status</th>
                    <th className="px-3 py-2 text-[12px] font-semibold">Sprint</th>
                    <th className="px-3 py-2 text-[12px] font-semibold">Assignee</th>
                    <th className="px-3 py-2 text-[12px] font-semibold">Est.</th>
                  </tr>
                </thead>
                <tbody>
                  {stories.map((story: UserStoryItem, si) => (
                    <tr
                      key={story.id}
                      className={cn(
                        "border-t border-[#7cd3f7]/95 text-slate-700",
                        si % 2 === 0 ? "bg-white" : "bg-[#d8f2ff]",
                      )}
                    >
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2 text-[12px] text-slate-700">
                          <UserStoryIcon className="size-3 shrink-0 opacity-60" />
                          <span className="truncate">{story.title}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                          STATUS_BADGE[story.status] ?? "bg-slate-100 text-slate-600",
                        )}>
                          {STATUS_LABEL[story.status] ?? story.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[12px]">
                        {story.sprint != null
                          ? <span className="font-medium text-indigo-600">S{story.sprint}</span>
                          : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-slate-600 truncate">
                        {story.assignee ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-slate-500">
                        {story.estimatedDays != null ? `${story.estimatedDays}d` : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50/40 px-6 py-3.5">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-lg bg-gradient-to-br from-rose-500 to-red-600 px-4 py-2 text-[13px] font-semibold text-white shadow-md shadow-rose-200/70 transition-all hover:from-rose-400 hover:to-red-500 hover:shadow-lg disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete Epic"}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : null;
}
