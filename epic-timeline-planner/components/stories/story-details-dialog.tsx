"use client";

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { History, MessageSquare, Plus, X } from "lucide-react";
import { StoryStatus } from "@/lib/generated/prisma";

import { Button } from "@/components/ui/button";
import { monthTeamLabelForId } from "@/lib/month-team-board";
import { MONTHS } from "@/lib/timeline";
import { InitiativeItem, UserStoryItem } from "@/lib/types";
import { useDialogPresence } from "@/lib/use-dialog-presence";
import {
  isUsablePlanningSurfaceRect,
  planningDetailPanelAnchorStyle,
  usePlanningSurfaceRect,
} from "@/lib/use-planning-surface-rect";
import { cn } from "@/lib/utils";
import { YEAR_SPRINT_MAX } from "@/lib/year-sprint";

type StoryWithEpic = UserStoryItem & { epicTitle: string };

function quarterLabelFromMonth(month: number | null | undefined): string | null {
  if (month == null) return null;
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

type StoryDetailsDialogProps = {
  open: boolean;
  story: StoryWithEpic | null;
  initiatives: InitiativeItem[];
  lockParentEpicId?: string | null;
  onClose: () => void;
  onCreate: (payload: {
    title: string;
    icon: string;
    description: string | null;
    assignee: string | null;
    sprint: number | null;
    estimatedDays: number | null;
    daysLeft: number | null;
    status: StoryStatus;
    epicId: string;
  }) => Promise<void>;
  onSave: (
    storyId: string,
    payload: {
      title: string;
      icon: string;
      description: string | null;
      assignee: string | null;
      sprint: number | null;
      estimatedDays: number | null;
      daysLeft: number | null;
      status: StoryStatus;
      epicId: string;
    },
  ) => Promise<void>;
  onDelete?: (storyId: string) => Promise<void>;
  onAddComment: (storyId: string, body: string) => Promise<void>;
  storyRef?: string;
  /** Called after exit animation; use to clear selection in parent without remounting mid-close. */
  onExitComplete?: () => void;
  /** When set, the panel matches this element (e.g. right timeline column). */
  surfaceAnchorRef?: RefObject<HTMLElement | null>;
};

export function StoryDetailsDialog({
  open,
  story,
  initiatives,
  lockParentEpicId,
  onClose,
  onExitComplete,
  onCreate,
  onSave,
  onDelete,
  onAddComment,
  storyRef,
  surfaceAnchorRef,
}: StoryDetailsDialogProps) {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("📄");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [sprint, setSprint] = useState("");
  const [status, setStatus] = useState<StoryStatus>(StoryStatus.todo);
  const [estimatedDays, setEstimatedDays] = useState("");
  const [daysLeft, setDaysLeft] = useState("");
  const [epicId, setEpicId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const [isDraggingDialog, setIsDraggingDialog] = useState(false);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);

  const allEpics = useMemo(
    () =>
      initiatives.flatMap((initiative) =>
        (initiative.epics ?? []).map((epic) => ({
          id: epic.id,
          title: epic.title,
          initiativeTitle: initiative.title,
        })),
      ),
    [initiatives],
  );

  const firstEpicId = allEpics[0]?.id ?? "";
  const selectedEpicMeta = useMemo(() => {
    if (!epicId) return null;
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (epic.id !== epicId) continue;
        const team = monthTeamLabelForId(epic.team) ?? "Not set";
        const quarter = epic.planQuarter != null ? `Q${epic.planQuarter}` : quarterLabelFromMonth(epic.planStartMonth);
        const month =
          epic.planStartMonth == null
            ? null
            : epic.planEndMonth != null && epic.planEndMonth !== epic.planStartMonth
              ? `${MONTHS[epic.planStartMonth - 1]}-${MONTHS[epic.planEndMonth - 1]}`
              : MONTHS[epic.planStartMonth - 1];
        const year = epic.planYear ?? initiative.year ?? null;
        return { team, quarter, month, year };
      }
    }
    return null;
  }, [initiatives, epicId]);

  useEffect(() => {
    if (story) {
      setTitle(story.title ?? "");
      setIcon(story.icon === "🧩" ? "📄" : (story.icon ?? "📄"));
      setDescription(story.description ?? "");
      setAssignee(story.assignee ?? "");
      setSprint(story.sprint == null ? "" : String(story.sprint));
      setStatus(story.status ?? StoryStatus.todo);
      setEstimatedDays(story.estimatedDays == null ? "" : String(story.estimatedDays));
      setDaysLeft(story.daysLeft == null ? "" : String(story.daysLeft));
      setEpicId(story.epicId);
    } else {
      setTitle("");
      setIcon("📄");
      setDescription("");
      setAssignee("");
      setSprint("");
      setStatus(StoryStatus.todo);
      setEstimatedDays("");
      setDaysLeft("");
      setEpicId(lockParentEpicId ?? firstEpicId);
    }
    setCommentBody("");
    setActivityTab("comments");
  }, [story, initiatives, lockParentEpicId, firstEpicId]);

  useEffect(() => {
    if (open) {
      setDialogOffset({ x: 0, y: 0 });
      setIsDraggingDialog(false);
      dragStartRef.current = null;
    }
  }, [open]);

  const { visible, leaving } = useDialogPresence(open, onExitComplete);
  const surfaceRect = usePlanningSurfaceRect(surfaceAnchorRef, visible);
  const anchored = isUsablePlanningSurfaceRect(surfaceRect);

  if (!visible) return null;

  const isCreateMode = !story;

  async function handleSave() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle || !epicId) return;

    setSaving(true);
    try {
      const payload = {
        title: normalizedTitle,
        icon: icon.trim() || "📄",
        description: description.trim() ? description.trim() : null,
        assignee: assignee.trim() ? assignee.trim() : null,
        sprint: sprint.trim() === "" ? null : Number(sprint),
        estimatedDays: estimatedDays.trim() === "" ? null : Number(estimatedDays),
        daysLeft: daysLeft.trim() === "" ? null : Number(daysLeft),
        status,
        epicId,
      };
      if (isCreateMode) {
        await onCreate(payload);
      } else {
        await onSave(story.id, payload);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleCommentAdd() {
    const normalizedComment = commentBody.trim();
    if (!normalizedComment) return;

    setCommenting(true);
    try {
      if (!story) return;
      await onAddComment(story.id, normalizedComment);
      setCommentBody("");
    } finally {
      setCommenting(false);
    }
  }

  async function handleDelete() {
    if (isCreateMode || !story || !onDelete) return;
    const confirmed = window.confirm("Delete this user story?");
    if (!confirmed) return;
    await onDelete(story.id);
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
        "fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-[1px]",
        !anchored && "flex items-start justify-end p-4 pb-6 pl-6 pr-4 pt-6 md:pr-12",
        !leaving && "epic-dialog-backdrop",
        leaving && "epic-dialog-backdrop--exit",
        leaving && "pointer-events-none",
      )}
    >
      <div
        className={cn(
          !leaving ? "epic-dialog-panel-entrance" : "epic-dialog-panel--exit",
          anchored
            ? "fixed flex flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xl ring-1 ring-black/[0.06]"
            : "w-full max-w-[31.36rem] shrink-0",
        )}
        style={anchored ? planningDetailPanelAnchorStyle(surfaceRect) : undefined}
      >
        <div
          className={cn(
            "w-full overflow-y-auto p-5",
            anchored
              ? "h-full min-h-0 flex-1 shadow-none ring-0"
              : "max-h-[88vh] rounded-2xl border border-slate-200 bg-white shadow-2xl",
            isDraggingDialog && "select-none",
          )}
          style={{ transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)` }}
        >
        <div
          className="mb-4 flex cursor-move items-center justify-between border-b border-slate-100 pb-3"
          onPointerDown={beginDialogDrag}
        >
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            {isCreateMode ? "Create user story" : "User story details"}
          </h2>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close story details">
            <X />
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 md:col-span-2">
            <p className="text-sm font-medium text-slate-600">Title</p>
            <div className="flex gap-2">
              <input
                value={icon}
                onChange={(event) => setIcon(event.target.value)}
                maxLength={2}
                className="w-16 rounded-md border bg-background px-2 py-2 text-center text-xl"
              />
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-base"
              />
            </div>
          </label>
          <label className="space-y-1 md:col-span-2">
            <p className="text-sm font-medium text-slate-600">Description</p>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="h-40 w-full rounded-md border bg-background px-3 py-2 text-base"
            />
          </label>
          <label className="space-y-1">
            <p className="text-sm font-medium text-slate-600">Assignee</p>
            <input
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-base"
              placeholder="e.g. Avi"
            />
          </label>
          <label className="space-y-1">
            <p className="text-sm font-medium text-slate-600">Parent epic</p>
            <select
              value={epicId}
              onChange={(event) => setEpicId(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-base disabled:bg-muted/40"
              disabled={Boolean(lockParentEpicId)}
            >
              <option value="">Select epic</option>
              {initiatives.map((initiative) => (
                <optgroup key={initiative.id} label={initiative.title}>
                  {(initiative.epics ?? []).map((epic) => (
                    <option key={epic.id} value={epic.id}>
                      {epic.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="space-y-1 md:col-span-2">
            <p className="text-sm font-medium text-slate-600">Planning context</p>
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-slate-700">
                <p className="text-[11px] text-slate-500">Team</p>
                <p className="font-medium">{selectedEpicMeta?.team ?? "Not set"}</p>
              </div>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-slate-700">
                <p className="text-[11px] text-slate-500">Quarter</p>
                <p className="font-medium">{selectedEpicMeta?.quarter ?? "Not set"}</p>
              </div>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-slate-700">
                <p className="text-[11px] text-slate-500">Month</p>
                <p className="font-medium">{selectedEpicMeta?.month ?? "Not set"}</p>
              </div>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-slate-700">
                <p className="text-[11px] text-slate-500">Year</p>
                <p className="font-medium">{selectedEpicMeta?.year ?? "Not set"}</p>
              </div>
            </div>
          </div>
          <label className="space-y-1">
            <p className="text-sm font-medium text-slate-600">Sprint</p>
            <select
              value={sprint}
              onChange={(event) => setSprint(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-base"
            >
              <option value="">Not set</option>
              {Array.from({ length: YEAR_SPRINT_MAX }, (_, i) => {
                const n = i + 1;
                return (
                  <option key={n} value={String(n)}>
                    Sprint {n}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="space-y-1">
            <p className="text-sm font-medium text-slate-600">Status</p>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as StoryStatus)}
              className="w-full rounded-md border bg-background px-3 py-2 text-base"
            >
              <option value={StoryStatus.todo}>To do</option>
              <option value={StoryStatus.inProgress}>In progress</option>
              <option value={StoryStatus.done}>Done</option>
              <option value={StoryStatus.approved}>Approved</option>
            </select>
          </label>
          <label className="space-y-1">
            <p className="text-sm font-medium text-slate-600">Estimated days</p>
            <input
              type="number"
              min={0}
              value={estimatedDays}
              onChange={(event) => setEstimatedDays(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-base"
            />
          </label>
          <label className="space-y-1">
            <p className="text-sm font-medium text-slate-600">Days left</p>
            <input
              type="number"
              min={0}
              value={daysLeft}
              onChange={(event) => setDaysLeft(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-base"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          {!isCreateMode ? (
            <Button className="px-4 text-sm font-medium" variant="destructive" onClick={() => void handleDelete()}>
              Delete
            </Button>
          ) : null}
          <Button className="px-4 text-sm font-medium" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button className="px-4 text-sm font-medium" onClick={handleSave} disabled={saving}>
            {isCreateMode ? "Create story" : "Save story"}
          </Button>
        </div>

        <div className="mt-10">
          <section className="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">Activity</h3>
              <div className="inline-flex rounded-lg bg-white p-1 ring-1 ring-slate-200">
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-sm font-medium transition ${
                    activityTab === "comments"
                      ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                  onClick={() => setActivityTab("comments")}
                >
                  <MessageSquare className="mr-1 inline size-3.5" />
                  Comments
                </button>
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-sm font-medium transition ${
                    activityTab === "history"
                      ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                  onClick={() => setActivityTab("history")}
                >
                  <History className="mr-1 inline size-3.5" />
                  History
                </button>
              </div>
            </div>

            {isCreateMode ? (
              <p className="text-sm text-slate-500">Create the story first to add comments and history.</p>
            ) : activityTab === "comments" ? (
              <>
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {story.comments.length === 0 ? (
                    <p className="text-sm text-slate-500">No comments yet.</p>
                  ) : (
                    story.comments.map((comment) => (
                      <div key={comment.id} className="rounded-md bg-white p-2 text-sm ring-1 ring-slate-200">
                        <p className="text-[12px] text-slate-500">
                          {comment.author ?? "Team"} - {new Date(comment.createdAt).toLocaleString()}
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
                  <Button size="sm" variant="outline" onClick={handleCommentAdd} disabled={commenting}>
                    <Plus />
                    Add
                  </Button>
                </div>
              </>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {story.history.length === 0 ? (
                  <p className="text-sm text-slate-500">No history yet.</p>
                ) : (
                  story.history.map((entry) => (
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
    </div>
  );
}
