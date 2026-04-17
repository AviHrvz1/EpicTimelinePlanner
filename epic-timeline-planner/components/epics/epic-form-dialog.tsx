"use client";

import { FileText, History, MessageSquare, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { EpicItem, InitiativeItem } from "@/lib/types";
import { useDialogPresence } from "@/lib/use-dialog-presence";
import { cn } from "@/lib/utils";

type EpicFormDialogProps = {
  open: boolean;
  epic?: EpicItem;
  initiatives: InitiativeItem[];
  lockInitiativeId?: string | null;
  onClose: () => void;
  onSubmit: (payload: {
    title: string;
    icon: string;
    description: string;
    assignee: string;
    color: string;
    initiativeId: string;
  }) => Promise<void> | void;
  onDelete?: (epicId: string) => Promise<void> | void;
  storyRefById?: Record<string, string>;
  onRequestCreateStory?: (epicId: string) => void;
  onOpenStory?: (storyId: string) => void;
  onAddComment?: (epicId: string, body: string) => Promise<void>;
  /** Called after exit animation; use to clear selected entity in parent. */
  onExitComplete?: () => void;
};

export function EpicFormDialog({
  open,
  epic,
  initiatives,
  lockInitiativeId,
  onClose,
  onExitComplete,
  onSubmit,
  onDelete,
  storyRefById,
  onRequestCreateStory,
  onOpenStory,
  onAddComment,
}: EpicFormDialogProps) {
  const [title, setTitle] = useState(epic?.title ?? "");
  const [icon, setIcon] = useState(epic?.icon ?? "📁");
  const [description, setDescription] = useState(epic?.description ?? "");
  const [assignee, setAssignee] = useState(epic?.assignee ?? "");
  const [color, setColor] = useState(epic?.color ?? "#3B82F6");
  const [initiativeId, setInitiativeId] = useState(epic?.initiativeId ?? lockInitiativeId ?? "");
  const [commentBody, setCommentBody] = useState("");
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const [isDraggingDialog, setIsDraggingDialog] = useState(false);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    setTitle(epic?.title ?? "");
    setIcon(epic?.icon ?? "📁");
    setDescription(epic?.description ?? "");
    setAssignee(epic?.assignee ?? "");
    setColor(epic?.color ?? "#3B82F6");
    setInitiativeId(epic?.initiativeId ?? lockInitiativeId ?? initiatives[0]?.id ?? "");
    setCommentBody("");
    setActivityTab("comments");
  }, [epic, open, lockInitiativeId, initiatives]);

  useEffect(() => {
    if (open) {
      setDialogOffset({ x: 0, y: 0 });
      setIsDraggingDialog(false);
      dragStartRef.current = null;
    }
  }, [open]);

  const initiativeOptions = useMemo(
    () =>
      initiatives
        .map((i) => ({ id: i.id, label: i.title }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [initiatives],
  );

  const { visible, leaving } = useDialogPresence(open, onExitComplete);

  if (!visible) return null;

  const storyStatusLabel: Record<string, string> = {
    todo: "To Do",
    inProgress: "In Progress",
    done: "Done",
    approved: "Approved",
  };
  const statusTone: Record<string, string> = {
    todo: "bg-slate-100 text-slate-700",
    inProgress: "bg-blue-100 text-blue-700",
    done: "bg-emerald-100 text-emerald-700",
    approved: "bg-violet-100 text-violet-700",
  };

  async function handleSave() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle || !initiativeId) return;

    setIsSaving(true);
    try {
      await onSubmit({
        title: normalizedTitle,
        icon: icon.trim() || "📁",
        description,
        assignee,
        color,
        initiativeId,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddComment() {
    if (!epic || !onAddComment) return;
    const normalized = commentBody.trim();
    if (!normalized) return;
    setIsAddingComment(true);
    try {
      await onAddComment(epic.id, normalized);
      setCommentBody("");
    } finally {
      setIsAddingComment(false);
    }
  }

  async function handleDelete() {
    if (!epic || !onDelete) return;
    const confirmed = window.confirm("Delete this epic? This will also delete all its user stories.");
    if (!confirmed) return;
    await onDelete(epic.id);
    onClose();
  }

  function beginDialogDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: dialogOffset.x,
      startY: dialogOffset.y,
    };
    setIsDraggingDialog(true);

    function onPointerMove(moveEvent: PointerEvent) {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = moveEvent.clientX - start.pointerX;
      const dy = moveEvent.clientY - start.pointerY;
      setDialogOffset({ x: start.startX + dx, y: start.startY + dy });
    }

    function onPointerUp() {
      setIsDraggingDialog(false);
      dragStartRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-[1px]",
        !leaving && "epic-dialog-backdrop",
        leaving && "epic-dialog-backdrop--exit",
        leaving && "pointer-events-none",
      )}
    >
      <div
        className={cn(
          "w-full max-w-5xl",
          !leaving ? "epic-dialog-panel-entrance" : "epic-dialog-panel--exit",
        )}
      >
        <div
          className={cn(
            "max-h-[88vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl",
            isDraggingDialog && "select-none",
          )}
          style={{ transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)` }}
        >
        <div
          className="mb-4 flex cursor-move items-center justify-between border-b border-slate-100 pb-3"
          onPointerDown={beginDialogDrag}
        >
          <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
            {epic ? "Epic details" : "Create epic"}
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
              />
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-base"
                placeholder="Epic title"
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
            <p className="text-sm font-medium text-slate-600">Parent initiative</p>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-base disabled:bg-muted/40"
              value={initiativeId}
              onChange={(event) => setInitiativeId(event.target.value)}
              disabled={Boolean(lockInitiativeId)}
            >
              <option value="">Select initiative</option>
              {initiativeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
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
            <p className="text-sm font-medium text-slate-600">Epic ID</p>
            <div className="h-10 rounded-md border bg-muted/40 px-3 py-2 text-base text-slate-600">
              {epic?.id ?? "Will be created on save"}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          {epic ? (
            <Button className="px-4 text-sm font-medium" variant="destructive" onClick={() => void handleDelete()}>
              Delete
            </Button>
          ) : null}
          <Button className="px-4 text-sm font-medium" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button className="px-4 text-sm font-medium" onClick={handleSave} disabled={isSaving}>
            Save
          </Button>
        </div>

        <section className="mt-6 space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-800">User stories in this epic</h3>
            <span className="rounded-full bg-white px-2 py-0.5 text-sm text-slate-600 ring-1 ring-slate-200">
              {epic?.userStories?.length ?? 0}
            </span>
          </div>

          {!epic ? (
            <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">
              Save this epic first, then add and manage user stories here.
            </p>
          ) : (
            <>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {(epic.userStories ?? []).length === 0 ? (
                  <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">
                    No user stories yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md bg-white ring-1 ring-slate-200">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 font-semibold">User story</th>
                          <th className="px-3 py-2 font-semibold">Status</th>
                          <th className="px-3 py-2 font-semibold">Assignee</th>
                          <th className="px-3 py-2 font-semibold">Est. days</th>
                          <th className="px-3 py-2 font-semibold">Days left</th>
                          <th className="px-3 py-2 text-right font-semibold">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {epic.userStories.map((story) => {
                          return (
                          <tr key={story.id} className="border-t border-slate-100 align-middle">
                            <td className="px-3 py-2">
                              <p className="max-w-[280px] truncate text-sm font-medium text-slate-900">
                                <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                                  {storyRefById?.[story.id] ?? "--"}
                                </span>
                                <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-slate-100 text-slate-600 ring-1 ring-slate-200/80 align-middle mr-1" aria-hidden><FileText className="size-2.5" strokeWidth={2} /></span>{story.title}
                              </p>
                              {story.sprint ? (
                                <p className="mt-0.5 text-[11px] text-slate-500">Sprint {story.sprint}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.04em]",
                                  statusTone[story.status] ?? "bg-muted text-muted-foreground",
                                )}
                              >
                                {storyStatusLabel[story.status] ?? story.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-700">{story.assignee ?? "-"}</td>
                            <td className="px-3 py-2 text-slate-700">
                              {story.estimatedDays == null ? "-" : story.estimatedDays}
                            </td>
                            <td className="px-3 py-2 text-slate-700">{story.daysLeft == null ? "-" : story.daysLeft}</td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onOpenStory?.(story.id)}
                                disabled={!onOpenStory}
                              >
                                Edit
                              </Button>
                            </td>
                          </tr>
                          );
                        })}
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
                    if (!epic || !onRequestCreateStory) return;
                    onRequestCreateStory(epic.id);
                  }}
                  disabled={!onRequestCreateStory}
                >
                  <Plus />
                  Add user story
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

          {!epic ? (
            <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">
              Save this epic first to add comments and history.
            </p>
          ) : activityTab === "comments" ? (
            <>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {(epic.comments ?? []).length === 0 ? (
                  <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">
                    No comments yet.
                  </p>
                ) : (
                  epic.comments.map((comment) => (
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
              {(epic.history ?? []).length === 0 ? (
                <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">
                  No history yet.
                </p>
              ) : (
                epic.history.map((entry) => (
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
