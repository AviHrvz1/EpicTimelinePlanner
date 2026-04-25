"use client";

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, History, MessageSquare, Plus, Tag, X } from "lucide-react";
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
    labels: string | null;
    priority: string | null;
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
      labels: string | null;
      priority: string | null;
      sprint: number | null;
      estimatedDays: number | null;
      daysLeft: number | null;
      status: StoryStatus;
      epicId: string;
    },
  ) => Promise<void>;
  onDelete?: (storyId: string) => Promise<void>;
  onAddComment: (storyId: string, body: string) => Promise<void>;
  onOpenInitiative?: (initiativeId: string) => void;
  onOpenEpic?: (epicId: string) => void;
  onOpenStory?: (storyId: string) => void;
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
  onOpenInitiative,
  onOpenEpic,
  onOpenStory,
  storyRef,
  surfaceAnchorRef,
}: StoryDetailsDialogProps) {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("📄");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [labelsDraft, setLabelsDraft] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [priority, setPriority] = useState("");
  const [sprint, setSprint] = useState("");
  const [status, setStatus] = useState<StoryStatus>(StoryStatus.todo);
  const [estimatedDays, setEstimatedDays] = useState("");
  const [daysLeft, setDaysLeft] = useState("");
  const [epicId, setEpicId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [dialogWidthVw, setDialogWidthVw] = useState(50);
  const [detailsPanelWidthPx, setDetailsPanelWidthPx] = useState(296);
  const [activityPanelHeightPx, setActivityPanelHeightPx] = useState(220);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const [isDraggingDialog, setIsDraggingDialog] = useState(false);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);
  const lastAutosavePayloadRef = useRef<string>("");
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);

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
  const selectedBreadcrumbMeta = useMemo(() => {
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (epic.id !== epicId) continue;
        return { initiative, epic };
      }
    }
    return null;
  }, [initiatives, epicId]);
  const existingLabelSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        for (const row of epic.userStories ?? []) {
          const parts = (row.labels ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
          for (const part of parts) set.add(part);
        }
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [initiatives]);
  const siblingStories = useMemo(() => {
    if (!selectedBreadcrumbMeta) return [] as UserStoryItem[];
    return (selectedBreadcrumbMeta.epic.userStories ?? []).filter((row) => row.id !== story?.id);
  }, [selectedBreadcrumbMeta, story?.id]);

  useEffect(() => {
    if (story) {
      setTitle(story.title ?? "");
      setIcon(story.icon === "🧩" ? "📄" : (story.icon ?? "📄"));
      setDescription(story.description ?? "");
      setAssignee(story.assignee ?? "");
      setLabelsDraft(
        (story.labels ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
      setPriority(story.priority ?? "");
      setNewLabel("");
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
      setLabelsDraft([]);
      setPriority("");
      setNewLabel("");
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
      setDialogWidthVw(50);
      setDetailsPanelWidthPx(296);
      setActivityPanelHeightPx(220);
      setDialogOffset({ x: 0, y: 0 });
      setIsDraggingDialog(false);
      dragStartRef.current = null;
    }
  }, [open]);

  const { visible, leaving } = useDialogPresence(open, onExitComplete);
  const surfaceRect = usePlanningSurfaceRect(surfaceAnchorRef, visible);
  const anchored = false;
  const isCreateMode = !story;

  function buildStoryPayload() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle || !epicId) return null;
    return {
      title: normalizedTitle,
      icon: icon.trim() || "📄",
      description: description.trim() ? description.trim() : null,
      assignee: assignee.trim() ? assignee.trim() : null,
      labels: labelsDraft.length > 0 ? labelsDraft.join(", ") : null,
      priority: priority.trim() ? priority.trim() : null,
      sprint: sprint.trim() === "" ? null : Number(sprint),
      estimatedDays: estimatedDays.trim() === "" ? null : Number(estimatedDays),
      daysLeft: daysLeft.trim() === "" ? null : Number(daysLeft),
      status,
      epicId,
    };
  }

  async function handleSave() {
    const payload = buildStoryPayload();
    if (!payload) return;
    setSaving(true);
    try {
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

  useEffect(() => {
    if (!open || isCreateMode || !story) return;
    const payload = buildStoryPayload();
    if (!payload) return;
    const payloadKey = JSON.stringify(payload);
    if (payloadKey === lastAutosavePayloadRef.current) return;
    const timer = window.setTimeout(async () => {
      try {
        await onSave(story.id, payload);
        lastAutosavePayloadRef.current = payloadKey;
      } catch {
        // Keep editing; next change will retry autosave.
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    open,
    isCreateMode,
    story,
    title,
    icon,
    description,
    assignee,
    labelsDraft,
    priority,
    sprint,
    estimatedDays,
    daysLeft,
    status,
    epicId,
    onSave,
  ]);

  if (!visible) return null;

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

  function addLabel(label: string) {
    const normalized = label.trim();
    if (!normalized) return;
    setLabelsDraft((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    setNewLabel("");
  }

  function removeLabel(label: string) {
    setLabelsDraft((prev) => prev.filter((item) => item !== label));
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

  function beginDetailsPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = detailsPanelWidthPx;
    const containerWidth = splitLayoutRef.current?.getBoundingClientRect().width ?? 0;
    const maxWidth = containerWidth > 0 ? Math.max(240, Math.floor(containerWidth - 320)) : 760;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      // Dragging left grows details panel; dragging right shrinks it.
      const next = startWidth - delta;
      setDetailsPanelWidthPx(Math.max(240, Math.min(maxWidth, next)));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function beginActivityPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = activityPanelHeightPx;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientY - startY;
      // Drag up => larger activity panel.
      const next = startHeight - delta;
      setActivityPanelHeightPx(Math.max(140, Math.min(520, next)));
    }

    function onPointerUp() {
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
            ? "fixed flex flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xl ring-1 ring-black/[0.06]"
            : "relative h-full shrink-0",
        )}
        style={
          anchored
            ? planningDetailPanelAnchorStyle(surfaceRect)
            : { width: `${dialogWidthVw}vw`, maxWidth: `${dialogWidthVw}vw` }
        }
      >
        <div
          className={cn(
            "flex h-full min-h-0 w-full flex-col p-5",
            anchored
              ? "h-full min-h-0 flex-1 shadow-none ring-0"
              : "h-full min-h-0 rounded-none border-0 bg-white shadow-none",
            isDraggingDialog && "select-none",
          )}
          style={{ transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)` }}
        >
        <div className="mb-4 flex cursor-move items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5" onPointerDown={beginDialogDrag}>
          <div className="flex min-w-0 items-center gap-1 text-sm font-semibold text-slate-700">
            <button
              type="button"
              onClick={() => selectedBreadcrumbMeta?.initiative && onOpenInitiative?.(selectedBreadcrumbMeta.initiative.id)}
              className="truncate rounded px-1 py-0.5 hover:bg-slate-200/70"
              title={selectedBreadcrumbMeta?.initiative?.title ?? "Open initiative"}
            >
              {selectedBreadcrumbMeta?.initiative ? `I-${selectedBreadcrumbMeta.initiative.id.slice(0, 6)}` : "Initiative"}
            </button>
            <ChevronRight className="size-4 shrink-0 text-slate-400" />
            <button
              type="button"
              onClick={() => selectedBreadcrumbMeta?.epic && onOpenEpic?.(selectedBreadcrumbMeta.epic.id)}
              className="truncate rounded px-1 py-0.5 hover:bg-slate-200/70"
              title={selectedBreadcrumbMeta?.epic?.title ?? "Open epic"}
            >
              {selectedBreadcrumbMeta?.epic ? `E-${selectedBreadcrumbMeta.epic.id.slice(0, 6)}` : "Epic"}
            </button>
            <ChevronRight className="size-4 shrink-0 text-slate-400" />
            <button
              type="button"
              onClick={() => story && onOpenStory?.(story.id)}
              className="truncate rounded px-1 py-0.5 hover:bg-slate-200/70"
              title={(story?.title ?? title) || "Open user story"}
            >
              {story ? `US-${story.id.slice(0, 6)}` : "User Story"}
            </button>
            <ChevronRight className="size-4 shrink-0 text-slate-400" />
            <span className="truncate text-slate-900">{title || (isCreateMode ? "Create User Story" : "Untitled")}</span>
          </div>
          <div className="flex items-center gap-2">
            {!isCreateMode ? (
              <Button className="px-3 text-xs font-medium" variant="destructive" onClick={() => void handleDelete()}>
                Delete
              </Button>
            ) : (
              <Button className="px-3 text-xs font-medium" onClick={handleSave} disabled={saving}>
                {saving ? "Creating..." : "Create"}
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close story details">
              <X />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            ref={splitLayoutRef}
            className="grid min-h-0 gap-0"
            style={{ gridTemplateColumns: `minmax(0,1fr) 10px ${detailsPanelWidthPx}px` }}
          >
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Description & Children</h3>
            <label className="space-y-1">
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
            <label className="space-y-1">
              <p className="text-sm font-medium text-slate-600">Description</p>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="h-40 w-full rounded-md border bg-background px-3 py-2 text-base"
              />
            </label>
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-600">Children table</p>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">ID</th>
                      <th className="px-2 py-1.5 font-medium">Name</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siblingStories.length === 0 ? (
                      <tr>
                        <td className="px-2 py-2 text-slate-500" colSpan={3}>No sibling stories in this epic.</td>
                      </tr>
                    ) : (
                      siblingStories.slice(0, 6).map((row) => (
                        <tr key={row.id} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 text-slate-600">{`US-${row.id.slice(0, 6)}`}</td>
                          <td className="px-2 py-1.5 text-slate-800">{row.title}</td>
                          <td className="px-2 py-1.5 text-slate-600">{row.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
          <div className="relative mx-1.5">
            <div
              className="absolute inset-y-1 left-1/2 w-2 -translate-x-1/2 cursor-ew-resize rounded-full bg-slate-200/80 hover:bg-slate-300"
              onPointerDown={beginDetailsPanelResize}
              title="Resize details panel"
              aria-label="Resize details panel"
              role="separator"
            />
          </div>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Details</h3>
            <label className="space-y-1">
              <p className="text-sm font-medium text-slate-600">Status</p>
              <select value={status} onChange={(event) => setStatus(event.target.value as StoryStatus)} className="w-full rounded-md border bg-background px-3 py-2 text-base">
                <option value={StoryStatus.todo}>To Do</option>
                <option value={StoryStatus.inProgress}>In Progress</option>
                <option value={StoryStatus.done}>Done</option>
                <option value={StoryStatus.approved}>Approved</option>
              </select>
            </label>
            <label className="space-y-1">
              <p className="text-sm font-medium text-slate-600">Assignee</p>
              <input value={assignee} onChange={(event) => setAssignee(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-base" placeholder="e.g. Avi" />
            </label>
            <label className="space-y-1">
              <p className="text-sm font-medium text-slate-600">Team</p>
              <input value={selectedEpicMeta?.team ?? "Not set"} readOnly className="w-full rounded-md border bg-muted/40 px-3 py-2 text-base text-slate-700" />
            </label>
            <label className="space-y-1">
              <p className="text-sm font-medium text-slate-600">Sprint</p>
              <select value={sprint} onChange={(event) => setSprint(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-base">
                <option value="">Not set</option>
                {Array.from({ length: YEAR_SPRINT_MAX }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>{`Sprint ${i + 1}`}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Estimated days</p>
                <input type="number" min={0} value={estimatedDays} onChange={(event) => setEstimatedDays(event.target.value)} className="w-full rounded-md border bg-background px-2 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Days left</p>
                <input type="number" min={0} value={daysLeft} onChange={(event) => setDaysLeft(event.target.value)} className="w-full rounded-md border bg-background px-2 py-2 text-sm" />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Quarter</p>
                <input value={selectedEpicMeta?.quarter ?? "Not set"} readOnly className="w-full rounded-md border bg-muted/40 px-2 py-2 text-sm text-slate-700" />
              </label>
              <label className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Month</p>
                <input value={selectedEpicMeta?.month ?? "Not set"} readOnly className="w-full rounded-md border bg-muted/40 px-2 py-2 text-sm text-slate-700" />
              </label>
              <label className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Year</p>
                <input value={selectedEpicMeta?.year?.toString() ?? "Not set"} readOnly className="w-full rounded-md border bg-muted/40 px-2 py-2 text-sm text-slate-700" />
              </label>
            </div>
            <label className="space-y-1">
              <p className="text-sm font-medium text-slate-600">Priority</p>
              <select value={priority} onChange={(event) => setPriority(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-base">
                <option value="">Not set</option>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </select>
            </label>
            <label className="space-y-1">
              <p className="text-sm font-medium text-slate-600">Labels</p>
              <div className="flex flex-wrap gap-1.5 rounded-md border bg-white p-2">
                {labelsDraft.length === 0 ? <span className="text-xs text-slate-400">No labels yet.</span> : null}
                {labelsDraft.map((label) => (
                  <span key={label} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    <Tag className="size-3" />
                    {label}
                    <button type="button" onClick={() => removeLabel(label)} className="text-slate-500 hover:text-slate-700">x</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newLabel}
                  onChange={(event) => setNewLabel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addLabel(newLabel);
                    }
                  }}
                  list="story-label-suggestions"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="Add label"
                />
                <Button type="button" size="sm" variant="outline" onClick={() => addLabel(newLabel)}>Add</Button>
              </div>
              <datalist id="story-label-suggestions">
                {existingLabelSuggestions.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
            <label className="space-y-1">
              <p className="text-sm font-medium text-slate-600">Parent epic</p>
              <select value={epicId} onChange={(event) => setEpicId(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-base disabled:bg-muted/40" disabled={Boolean(lockParentEpicId)}>
                <option value="">Select epic</option>
                {initiatives.map((initiative) => (
                  <optgroup key={initiative.id} label={initiative.title}>
                    {(initiative.epics ?? []).map((epic) => (
                      <option key={epic.id} value={epic.id}>{epic.title}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </section>
          </div>
        </div>

        <div className="mt-3">
          <div
            className="mb-1 h-2 cursor-ns-resize rounded-full bg-slate-200/80 hover:bg-slate-300"
            onPointerDown={beginActivityPanelResize}
            title="Resize activity panel height"
            aria-label="Resize activity panel height"
            role="separator"
          />
          <section
            className="flex min-h-0 flex-col space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
            style={{ height: `${activityPanelHeightPx}px` }}
          >
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

            <div className="min-h-0 flex-1 overflow-y-auto">
            {isCreateMode ? (
              <p className="text-sm text-slate-500">Create the story first to add comments and history.</p>
            ) : activityTab === "comments" ? (
              <>
                <div className="space-y-2">
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
                <div className="space-y-2">
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
            </div>
          </section>
        </div>
        </div>
      </div>
    </div>
  );
}
