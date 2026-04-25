"use client";

import { Folder, History, MessageSquare, Plus, X } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { InitiativeItem } from "@/lib/types";
import { MONTHS } from "@/lib/timeline";
import { useDialogPresence } from "@/lib/use-dialog-presence";
import {
  isUsablePlanningSurfaceRect,
  planningDetailPanelAnchorStyle,
  usePlanningSurfaceRect,
} from "@/lib/use-planning-surface-rect";
import { cn } from "@/lib/utils";

type InitiativeFormDialogProps = {
  open: boolean;
  initiative?: InitiativeItem;
  onClose: () => void;
  onSubmit: (payload: {
    title: string;
    icon: string;
    description: string;
    assignee: string;
    color: string;
    startMonth: number | null;
    endMonth: number | null;
  }) => Promise<void> | void;
  onOpenEpic?: (epicId: string) => void;
  onRequestCreateEpic?: (initiativeId: string) => void;
  onAddComment?: (initiativeId: string, body: string) => Promise<void>;
  /** Called after exit animation; use to clear selected entity in parent. */
  onExitComplete?: () => void;
  surfaceAnchorRef?: RefObject<HTMLElement | null>;
};

export function InitiativeFormDialog({
  open,
  initiative,
  onClose,
  onExitComplete,
  onSubmit,
  onOpenEpic,
  onRequestCreateEpic,
  onAddComment,
  surfaceAnchorRef,
}: InitiativeFormDialogProps) {
  const [title, setTitle] = useState(initiative?.title ?? "");
  const [icon, setIcon] = useState(initiative?.icon === "🎯" ? "" : (initiative?.icon ?? ""));
  const [description, setDescription] = useState(initiative?.description ?? "");
  const [assignee, setAssignee] = useState(initiative?.assignee ?? "");
  const [assignedMonth, setAssignedMonth] = useState(initiative?.startMonth ? String(initiative.startMonth) : "");
  const [color, setColor] = useState(initiative?.color ?? "#3B82F6");
  const [commentBody, setCommentBody] = useState("");
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingComment, setIsAddingComment] = useState(false);

  useEffect(() => {
    setTitle(initiative?.title ?? "");
    setIcon(initiative?.icon === "🎯" ? "" : (initiative?.icon ?? ""));
    setDescription(initiative?.description ?? "");
    setAssignee(initiative?.assignee ?? "");
    setAssignedMonth(initiative?.startMonth ? String(initiative.startMonth) : "");
    setColor(initiative?.color ?? "#3B82F6");
    setCommentBody("");
    setActivityTab("comments");
  }, [initiative, open]);

  const { visible, leaving } = useDialogPresence(open, onExitComplete);
  const surfaceRect = usePlanningSurfaceRect(surfaceAnchorRef, visible);
  const anchored = false;

  if (!visible) return null;

  async function handleSave() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return;

    setIsSaving(true);
    try {
      const month = assignedMonth ? Number(assignedMonth) : null;
      await onSubmit({
        title: normalizedTitle,
        icon: icon.trim(),
        description,
        assignee,
        color,
        startMonth: month,
        endMonth: month,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddComment() {
    if (!initiative || !onAddComment) return;
    const normalized = commentBody.trim();
    if (!normalized) return;
    setIsAddingComment(true);
    try {
      await onAddComment(initiative.id, normalized);
      setCommentBody("");
    } finally {
      setIsAddingComment(false);
    }
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[1px]",
        !anchored && "flex items-stretch justify-end p-0",
        !leaving && "epic-dialog-backdrop",
        leaving && "epic-dialog-backdrop--exit",
        leaving && "pointer-events-none",
      )}
    >
      <div
        className={cn(
          !leaving ? "epic-dialog-panel-entrance" : "epic-dialog-panel--exit",
          anchored
            ? "fixed flex flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-card shadow-2xl ring-1 ring-black/[0.06]"
            : "h-full w-[50vw] max-w-[50vw] shrink-0",
        )}
        style={anchored ? planningDetailPanelAnchorStyle(surfaceRect) : undefined}
      >
        <div
          className={cn(
            "w-full overflow-y-auto p-5",
            anchored ? "h-full min-h-0 flex-1 shadow-none" : "h-full min-h-0 rounded-none border-0 bg-card shadow-none",
          )}
        >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">
            {initiative ? "Initiative details" : "Create initiative"}
          </h2>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 md:col-span-2">
            <p className="text-sm font-medium text-slate-600">Title</p>
            <div className="flex gap-2">
              <input
                className="w-16 rounded-md border bg-background px-2 py-2 text-center text-base"
                maxLength={2}
                value={icon}
                onChange={(event) => setIcon(event.target.value)}
                placeholder="⚡"
                title="Emoji icon, or leave empty for lightning bolt"
                aria-label="Initiative icon emoji"
              />
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-base"
                placeholder="Initiative title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
          </label>
          <label className="space-y-1 md:col-span-2">
            <p className="text-sm font-medium text-slate-600">Description</p>
            <textarea
              className="h-28 w-full rounded-md border bg-background px-3 py-2 text-base"
              placeholder="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="space-y-1">
            <p className="text-sm font-medium text-slate-600">Assignee</p>
            <input
              className="w-full rounded-md border bg-background px-3 py-2 text-base"
              placeholder="e.g. Avi"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            />
          </label>
          <label className="space-y-1">
            <p className="text-sm font-medium text-slate-600">Assigned month</p>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-base"
              value={assignedMonth}
              onChange={(event) => setAssignedMonth(event.target.value)}
            >
              <option value="">Not scheduled</option>
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <p className="text-sm font-medium text-slate-600">Color</p>
            <input
              type="color"
              className="h-10 w-full rounded-md border bg-background px-2"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-600">Initiative ID</p>
            <div className="h-10 rounded-md border bg-muted/40 px-3 py-2 text-base text-slate-600">
              {initiative?.id ?? "Will be created on save"}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button className="px-4 text-sm font-medium" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button className="px-4 text-sm font-medium" onClick={handleSave} disabled={isSaving}>
            Save
          </Button>
        </div>

        <section className="mt-6 space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-800">Epics in this initiative</h3>
            <span className="rounded-full bg-white px-2 py-0.5 text-sm text-slate-600 ring-1 ring-slate-200">
              {initiative?.epics?.length ?? 0}
            </span>
          </div>

          {!initiative ? (
            <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">
              Save this initiative first, then add and manage epics here.
            </p>
          ) : (
            <>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {(initiative.epics ?? []).length === 0 ? (
                  <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">
                    No epics yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md bg-white ring-1 ring-slate-200">
                    <table className="w-full min-w-[600px] text-left text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Epic</th>
                          <th className="px-3 py-2 font-semibold">Stories</th>
                          <th className="px-3 py-2 font-semibold">Assignee</th>
                          <th className="px-3 py-2 text-right font-semibold">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {initiative.epics.map((epic) => (
                          <tr key={epic.id} className="border-t border-slate-100 align-middle">
                            <td className="px-3 py-2">
                              <p className="flex max-w-[280px] items-center gap-2 text-sm font-medium text-slate-900">
                                {epic.icon && epic.icon.trim() !== "" && epic.icon !== "📁" ? (
                                  <span className="shrink-0 text-[15px] leading-none" aria-hidden>
                                    {epic.icon}
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400 ring-1 ring-slate-200/80"
                                    aria-hidden
                                  >
                                    <Folder className="size-3.5" strokeWidth={2} />
                                  </span>
                                )}
                                <span className="min-w-0 truncate">{epic.title}</span>
                              </p>
                            </td>
                            <td className="px-3 py-2 text-slate-700">
                              {epic.userStories?.length ?? 0}
                            </td>
                            <td className="px-3 py-2 text-slate-700">{epic.assignee ?? "-"}</td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onOpenEpic?.(epic.id)}
                                disabled={!onOpenEpic}
                              >
                                Edit
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex justify-start">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!initiative || !onRequestCreateEpic) return;
                    onRequestCreateEpic(initiative.id);
                  }}
                  disabled={!onRequestCreateEpic}
                >
                  <Plus />
                  Add epic
                </Button>
              </div>
            </>
          )}
        </section>

        <section className="mt-4 space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-800">Activity</h3>
            <div className="inline-flex rounded-lg bg-white p-1 ring-1 ring-slate-200">
              <button
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm font-medium transition",
                  activityTab === "comments"
                    ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200"
                    : "text-slate-600 hover:bg-slate-100",
                )}
                onClick={() => setActivityTab("comments")}
              >
                <MessageSquare className="mr-1 inline size-3.5" />
                Comments
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm font-medium transition",
                  activityTab === "history"
                    ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200"
                    : "text-slate-600 hover:bg-slate-100",
                )}
                onClick={() => setActivityTab("history")}
              >
                <History className="mr-1 inline size-3.5" />
                History
              </button>
            </div>
          </div>

          {!initiative ? (
            <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">
              Save this initiative first to add comments and history.
            </p>
          ) : activityTab === "comments" ? (
            <>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {(initiative.comments ?? []).length === 0 ? (
                  <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">
                    No comments yet.
                  </p>
                ) : (
                  initiative.comments.map((comment) => (
                    <div key={comment.id} className="rounded-md bg-white p-2 text-sm ring-1 ring-slate-200">
                      <p className="text-[12px] text-slate-500">
                        {comment.author ?? "Planner"} - {new Date(comment.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-1 text-slate-800">{comment.body}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  placeholder="Write a comment..."
                />
                <Button size="sm" variant="outline" onClick={handleAddComment} disabled={isAddingComment}>
                  <Plus />
                  Add
                </Button>
              </div>
            </>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {(initiative.history ?? []).length === 0 ? (
                <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">
                  No history yet.
                </p>
              ) : (
                initiative.history.map((entry) => (
                  <div key={entry.id} className="rounded-md bg-white p-2 text-sm ring-1 ring-slate-200">
                    <p className="text-slate-800">{entry.entry}</p>
                    <p className="mt-1 text-[12px] text-slate-500">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}
