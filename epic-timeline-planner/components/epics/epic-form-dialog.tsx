"use client";

import { Bold, Check, CheckCheck, CheckCircle2, ChevronRight, Heading2, Heading3, History, ImagePlus, Italic, Link as LinkIcon, List, ListOrdered, ListTodo, MessageSquare, PlayCircle, Plus, Quote, Trash, Underline as UnderlineIcon, X } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { Button } from "@/components/ui/button";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";
import { MONTHS } from "@/lib/timeline";
import { EpicItem, InitiativeItem } from "@/lib/types";
import { useDialogPresence } from "@/lib/use-dialog-presence";
import { planningDetailPanelAnchorStyle, usePlanningSurfaceRect } from "@/lib/use-planning-surface-rect";
import { cn } from "@/lib/utils";

type ChildStoryDraft = {
  title: string;
  sprint: string;
  status: string;
  assignee: string;
  priority: string;
  estimatedDays: string;
  daysLeft: string;
};

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
    team: string | null;
    originalEstimateDays: number | null;
  }) => Promise<void> | void;
  onDelete?: (epicId: string) => Promise<void> | void;
  storyRefById?: Record<string, string>;
  onRequestCreateStory?: (epicId: string) => void;
  onOpenStory?: (storyId: string) => void;
  onOpenInitiative?: (initiativeId: string) => void;
  onPatchStory?: (
    storyId: string,
    patch: {
      title?: string;
      sprint?: number | null;
      status?: string;
      assignee?: string | null;
      priority?: string | null;
      estimatedDays?: number | null;
      daysLeft?: number | null;
    },
  ) => Promise<void>;
  onAddComment?: (epicId: string, body: string) => Promise<void>;
  onExitComplete?: () => void;
  surfaceAnchorRef?: RefObject<HTMLElement | null>;
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
  onOpenInitiative,
  onPatchStory,
  onAddComment,
  surfaceAnchorRef,
}: EpicFormDialogProps) {
  const [title, setTitle] = useState(epic?.title ?? "");
  const [icon, setIcon] = useState(epic?.icon ?? "📁");
  const [description, setDescription] = useState(epic?.description ?? "");
  const [assignee, setAssignee] = useState(epic?.assignee ?? "");
  const [color, setColor] = useState(epic?.color ?? "#3B82F6");
  const [originalEstimateDaysDraft, setOriginalEstimateDaysDraft] = useState(
    epic?.originalEstimateDays == null ? "" : String(epic.originalEstimateDays),
  );
  const [initiativeId, setInitiativeId] = useState(epic?.initiativeId ?? lockInitiativeId ?? "");
  const [teamDraft, setTeamDraft] = useState("");
  const [forceTeamFieldEdit, setForceTeamFieldEdit] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [labelsDraft, setLabelsDraft] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const [isDraggingDialog, setIsDraggingDialog] = useState(false);
  const [detailsPanelWidthPx, setDetailsPanelWidthPx] = useState(296);
  const [activityPanelHeightPx, setActivityPanelHeightPx] = useState(220);
  const [childStoryDrafts, setChildStoryDrafts] = useState<Record<string, ChildStoryDraft>>({});
  const [childEditingCell, setChildEditingCell] = useState<{
    rowId: string;
    field: "title" | "sprint" | "status" | "assignee" | "priority" | "estimatedDays" | "daysLeft";
  } | null>(null);
  const [childEditingValue, setChildEditingValue] = useState("");
  const [newChildTitle, setNewChildTitle] = useState("");
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const descriptionEditor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
      Placeholder.configure({ placeholder: "Description" }),
    ],
    content: description?.trim() ? description : "<p></p>",
    onUpdate: ({ editor }) => {
      setDescription(editor.getHTML());
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    setTitle(epic?.title ?? "");
    setIcon(epic?.icon ?? "📁");
    setDescription(epic?.description ?? "");
    setAssignee(epic?.assignee ?? "");
    setColor(epic?.color ?? "#3B82F6");
    setOriginalEstimateDaysDraft(epic?.originalEstimateDays == null ? "" : String(epic.originalEstimateDays));
    setInitiativeId(epic?.initiativeId ?? lockInitiativeId ?? initiatives[0]?.id ?? "");
    setForceTeamFieldEdit(false);
    setTeamDraft(epic?.team && MONTH_TEAM_IDS.includes(epic.team) ? epic.team : "");
    setCommentBody("");
    setActivityTab("comments");
    if (epic?.id) {
      const raw = window.localStorage.getItem(`epic-labels:${epic.id}`) ?? "";
      setLabelsDraft(
        raw
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    } else {
      setLabelsDraft([]);
    }
    setNewLabel("");
  }, [epic, open, lockInitiativeId, initiatives]);
  useEffect(() => {
    if (!epic?.id) return;
    window.localStorage.setItem(`epic-labels:${epic.id}`, labelsDraft.join(", "));
  }, [epic?.id, labelsDraft]);

  useEffect(() => {
    if (open) {
      setDialogOffset({ x: 0, y: 0 });
      setIsDraggingDialog(false);
      setDetailsPanelWidthPx(296);
      setActivityPanelHeightPx(220);
      dragStartRef.current = null;
    }
  }, [open]);
  useEffect(() => {
    if (!descriptionEditor) return;
    const next = description?.trim() ? description : "<p></p>";
    if (descriptionEditor.getHTML() !== next) {
      descriptionEditor.commands.setContent(next, false);
    }
  }, [descriptionEditor, epic?.id, open]);

  const initiativeOptions = useMemo(
    () =>
      initiatives
        .map((i) => ({ id: i.id, label: i.title }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [initiatives],
  );

  const { visible, leaving } = useDialogPresence(open, onExitComplete);
  const surfaceRect = usePlanningSurfaceRect(surfaceAnchorRef, visible);
  const anchored = false;
  const selectedInitiative = useMemo(
    () => initiatives.find((initiative) => initiative.id === initiativeId) ?? null,
    [initiativeId, initiatives],
  );
  const orderedInitiatives = useMemo(
    () =>
      [...initiatives].sort((a, b) => {
        const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (t !== 0) return t;
        return a.title.localeCompare(b.title);
      }),
    [initiatives],
  );
  const displayIds = useMemo(() => {
    const byInitiativeId = new Map<string, string>();
    const byEpicId = new Map<string, string>();
    const byStoryId = new Map<string, string>();
    orderedInitiatives.forEach((initiative, index) => {
      byInitiativeId.set(initiative.id, `INIT-${String(index + 1).padStart(2, "0")}`);
    });
    const allEpics = orderedInitiatives
      .flatMap((initiative) => initiative.epics ?? [])
      .sort((a, b) => {
        const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (t !== 0) return t;
        return a.title.localeCompare(b.title);
      });
    allEpics.forEach((row, index) => {
      byEpicId.set(row.id, `EPIC-${String(index + 1).padStart(2, "0")}`);
    });
    const allStories = allEpics
      .flatMap((row) => row.userStories ?? [])
      .sort((a, b) => {
        const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (t !== 0) return t;
        return a.title.localeCompare(b.title);
      });
    allStories.forEach((row, index) => {
      byStoryId.set(row.id, `US-${String(index + 1).padStart(2, "0")}`);
    });
    return { byInitiativeId, byEpicId, byStoryId };
  }, [orderedInitiatives]);
  const hasChildren = (epic?.userStories?.length ?? 0) > 0;
  const existingLabelSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const row of epic?.userStories ?? []) {
      const parts = (row.labels ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      for (const part of parts) set.add(part);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [epic?.userStories]);
  const filteredLabelSuggestions = useMemo(() => {
    const q = newLabel.trim().toLowerCase();
    if (!q) return existingLabelSuggestions.filter((item) => !labelsDraft.includes(item)).slice(0, 8);
    return existingLabelSuggestions
      .filter((item) => item.toLowerCase().includes(q) && !labelsDraft.includes(item))
      .slice(0, 8);
  }, [existingLabelSuggestions, labelsDraft, newLabel]);

  const persistedTeam = epic?.team && MONTH_TEAM_IDS.includes(epic.team) ? epic.team : null;
  const showTeamSelect = !persistedTeam || forceTeamFieldEdit;
  const planningQuarter = epic?.planQuarter != null ? `Q${epic.planQuarter}` : "Not set";
  const planningMonth =
    epic?.planStartMonth == null
      ? "Not set"
      : epic.planEndMonth != null && epic.planEndMonth !== epic.planStartMonth
        ? `${MONTHS[epic.planStartMonth - 1]}-${MONTHS[epic.planEndMonth - 1]}`
        : MONTHS[epic.planStartMonth - 1];
  const planningYear = epic?.planYear ?? "Not set";

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

  useEffect(() => {
    if (!epic) {
      setChildStoryDrafts({});
      return;
    }
    const next: Record<string, ChildStoryDraft> = {};
    for (const row of epic.userStories ?? []) {
      next[row.id] = {
        title: row.title ?? "",
        sprint: row.sprint == null ? "" : String(row.sprint),
        status: row.status ?? "todo",
        assignee: row.assignee ?? "",
        priority: row.priority ?? "",
        estimatedDays: row.estimatedDays == null ? "" : String(row.estimatedDays),
        daysLeft: row.daysLeft == null ? "" : String(row.daysLeft),
      };
    }
    setChildStoryDrafts(next);
    setChildEditingCell(null);
    setChildEditingValue("");
    setNewChildTitle("");
  }, [epic]);

  if (!visible) return null;

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
        team: teamDraft === "" ? null : teamDraft,
        originalEstimateDays:
          originalEstimateDaysDraft.trim() === "" ? null : Math.max(0, Math.round(Number(originalEstimateDaysDraft) || 0)),
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
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
      const next = startHeight - delta;
      setActivityPanelHeightPx(Math.max(180, Math.min(560, next)));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function beginChildCellEdit(
    storyId: string,
    field: "title" | "sprint" | "status" | "assignee" | "priority" | "estimatedDays" | "daysLeft",
  ) {
    const draft = childStoryDrafts[storyId];
    if (!draft) return;
    const value = draft[field] ?? "";
    setChildEditingCell({ rowId: storyId, field });
    setChildEditingValue(value);
  }

  async function confirmChildCellEdit(storyId: string) {
    if (!onPatchStory || !childEditingCell || childEditingCell.rowId !== storyId) return;
    const existing = childStoryDrafts[storyId];
    if (!existing) return;
    const field = childEditingCell.field;
    const next: ChildStoryDraft = { ...existing, [field]: childEditingValue };
    setChildStoryDrafts((prev) => ({ ...prev, [storyId]: next }));
    setChildEditingCell(null);
    setChildEditingValue("");
    const patch =
      field === "title"
        ? { title: next.title.trim() }
        : field === "sprint"
          ? { sprint: next.sprint.trim() === "" ? null : Number(next.sprint) }
          : field === "status"
            ? { status: next.status }
            : field === "assignee"
              ? { assignee: next.assignee.trim() === "" ? null : next.assignee.trim() }
              : field === "priority"
                ? { priority: next.priority.trim() === "" ? null : next.priority.trim() }
                : field === "estimatedDays"
                  ? { estimatedDays: next.estimatedDays.trim() === "" ? null : Number(next.estimatedDays) }
                  : { daysLeft: next.daysLeft.trim() === "" ? null : Number(next.daysLeft) };
    await onPatchStory(storyId, patch);
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
            ? "fixed flex flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xl ring-1 ring-black/[0.06]"
            : "relative h-full w-[50vw] max-w-[50vw] shrink-0",
        )}
        style={anchored ? planningDetailPanelAnchorStyle(surfaceRect) : undefined}
      >
        <div
          className={cn(
            "flex h-full min-h-0 w-full flex-col p-5",
            anchored ? "h-full min-h-0 flex-1 shadow-none ring-0" : "h-full min-h-0 rounded-none border-0 bg-white shadow-none",
            isDraggingDialog && "select-none",
          )}
          style={{ transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)` }}
        >
          <div
            className="mb-4 flex cursor-move items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
            onPointerDown={beginDialogDrag}
          >
            <div className="flex min-w-0 items-center gap-1 text-sm font-semibold text-slate-700">
              <button
                type="button"
                onClick={() => selectedInitiative && onOpenInitiative?.(selectedInitiative.id)}
                className="inline-flex min-w-0 items-center gap-1 truncate cursor-pointer rounded px-1 py-0.5 text-blue-700 underline decoration-blue-300 underline-offset-2 hover:bg-blue-50"
                title={selectedInitiative?.title ?? "Open initiative"}
              >
                {selectedInitiative ? (displayIds.byInitiativeId.get(selectedInitiative.id) ?? "Initiative") : "Initiative"}
              </button>
              <ChevronRight className="size-4 shrink-0 text-slate-400" />
              <button
                type="button"
                onClick={() => undefined}
                className="inline-flex min-w-0 items-center gap-1 truncate cursor-pointer rounded px-1 py-0.5 text-blue-700 underline decoration-blue-300 underline-offset-2 hover:bg-blue-50"
                title={(epic?.title ?? title) || "Open epic"}
              >
                {epic ? (displayIds.byEpicId.get(epic.id) ?? "Epic") : "Epic"}
              </button>
              <ChevronRight className="size-4 shrink-0 text-slate-400" />
              <span className="truncate text-slate-900">{title || (epic ? "Epic details" : "Create epic")}</span>
            </div>
            <div className="flex items-center gap-2">
              {epic ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => void handleDelete()}
                  aria-label="Delete epic"
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash className="size-4" />
                </Button>
              ) : null}
              <Button size="sm" variant="outline" className="h-8 px-3 text-xs font-medium" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" className="h-8 px-3 text-xs font-medium" onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving..." : epic ? "Save" : "Create"}
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close epic details">
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
              <section className="h-full min-h-0 overflow-y-auto space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                <label className="block space-y-1">
                  <p className="text-sm font-medium text-slate-600">Title</p>
                  <div className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-slate-300/70">
                    <input
                      className="w-12 border-r border-slate-200 bg-transparent px-2 py-2 text-center text-xl outline-none"
                      maxLength={2}
                      value={icon}
                      onChange={(event) => setIcon(event.target.value)}
                    />
                    <input
                      className="w-full bg-transparent px-3 py-2 text-base outline-none"
                      placeholder="Epic title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </div>
                </label>

                <label className="mt-5 block space-y-1">
                  <p className="text-sm font-medium text-slate-600">Description</p>
                  <div className="flex flex-wrap gap-1 rounded-md border border-slate-200 bg-slate-50 p-1">
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleBold().run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700", descriptionEditor?.isActive("bold") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white")}><Bold className="size-3.5" /></button>
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleItalic().run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700", descriptionEditor?.isActive("italic") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white")}><Italic className="size-3.5" /></button>
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleUnderline().run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700", descriptionEditor?.isActive("underline") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white")}><UnderlineIcon className="size-3.5" /></button>
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleBulletList().run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700", descriptionEditor?.isActive("bulletList") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white")}><List className="size-3.5" /></button>
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleOrderedList().run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700", descriptionEditor?.isActive("orderedList") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white")}><ListOrdered className="size-3.5" /></button>
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleBlockquote().run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700", descriptionEditor?.isActive("blockquote") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white")}><Quote className="size-3.5" /></button>
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleHeading({ level: 2 }).run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700", descriptionEditor?.isActive("heading", { level: 2 }) ? "border-slate-400 bg-white" : "border-transparent hover:bg-white")}><Heading2 className="size-3.5" /></button>
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleHeading({ level: 3 }).run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700", descriptionEditor?.isActive("heading", { level: 3 }) ? "border-slate-400 bg-white" : "border-transparent hover:bg-white")}><Heading3 className="size-3.5" /></button>
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { const prev = (descriptionEditor?.getAttributes("link").href as string | undefined) ?? ""; const url = window.prompt("Link URL", prev || "https://"); if (!descriptionEditor || url == null) return; const trimmed = url.trim(); if (!trimmed) { descriptionEditor.chain().focus().extendMarkRange("link").unsetLink().run(); return; } descriptionEditor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run(); }} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700", descriptionEditor?.isActive("link") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white")}><LinkIcon className="size-3.5" /></button>
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { if (!descriptionEditor) return; const picker = document.createElement("input"); picker.type = "file"; picker.accept = "image/*"; picker.onchange = () => { const file = picker.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const src = typeof reader.result === "string" ? reader.result : ""; if (!src) return; descriptionEditor.chain().focus().setImage({ src }).run(); }; reader.readAsDataURL(file); }; picker.click(); }} className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-slate-700 hover:bg-white"><ImagePlus className="size-3.5" /></button>
                  </div>
                  <div
                    className={cn(
                      "w-full rounded-md border bg-background px-3 py-2",
                      hasChildren ? "min-h-[11rem]" : "min-h-[16rem]",
                    )}
                  >
                    <EditorContent
                      editor={descriptionEditor}
                      className="focus:outline-none [&_.ProseMirror]:min-h-[9rem] [&_.ProseMirror]:outline-none"
                    />
                  </div>
                </label>

                <section className="mt-5 space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-slate-800">Child user stories</h3>
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
                            <table className="w-full min-w-[860px] text-left text-sm">
                              <thead className="bg-indigo-50/70 text-slate-600">
                                <tr>
                                  <th className="px-2 py-1.5 font-medium">ID</th>
                                  <th className="px-2 py-1.5 font-medium">Type</th>
                                  <th className="px-2 py-1.5 font-medium">Story</th>
                                  <th className="px-2 py-1.5 font-medium">Sprint</th>
                                  <th className="px-3 py-2 font-semibold">Status</th>
                                  <th className="px-3 py-2 font-semibold">Assignee</th>
                                  <th className="px-2 py-1.5 font-medium">Priority</th>
                                  <th className="px-3 py-2 font-semibold">Est. days</th>
                                  <th className="px-3 py-2 font-semibold">Days left</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-t border-slate-100 bg-blue-50/40">
                                  <td className="px-2 py-1.5 text-slate-400">-</td>
                                  <td className="px-2 py-1.5">
                                    <span className="inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                                      User Story
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <div className="flex gap-1">
                                      <input
                                        value={newChildTitle}
                                        onChange={(event) => setNewChildTitle(event.target.value)}
                                        placeholder="Add child user story title"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-800"
                                      />
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          if (!epic || !onRequestCreateStory || !newChildTitle.trim()) return;
                                          onRequestCreateStory(epic.id);
                                        }}
                                      >
                                        Add
                                      </Button>
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-400">Not set</td>
                                  <td className="px-2 py-1.5 text-slate-400">To Do</td>
                                  <td className="px-2 py-1.5 text-slate-400">Unassigned</td>
                                  <td className="px-2 py-1.5 text-slate-400">Not set</td>
                                  <td className="px-2 py-1.5 text-slate-400">-</td>
                                  <td className="px-2 py-1.5 text-slate-400">-</td>
                                </tr>
                                {epic.userStories.map((story) => (
                                  <tr key={story.id} className="border-t border-slate-100 align-middle">
                                    <td className="px-2 py-1.5 text-slate-600">
                                      <button
                                        type="button"
                                        onClick={() => onOpenStory?.(story.id)}
                                        className="rounded px-1 py-0.5 text-blue-700 hover:bg-blue-50 hover:underline"
                                        title={story.title}
                                      >
                                        {displayIds.byStoryId.get(story.id) ?? storyRefById?.[story.id] ?? story.id}
                                      </button>
                                    </td>
                                    <td className="px-2 py-1.5 text-slate-600">
                                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                        User Story
                                      </span>
                                    </td>
                                    <td className="px-2 py-1.5 text-slate-800">
                                      {childEditingCell?.rowId === story.id && childEditingCell.field === "title" ? (
                                        <div className="flex items-center gap-1">
                                          <input value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-800" />
                                          <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                          <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                                        </div>
                                      ) : (
                                        <button type="button" onClick={() => beginChildCellEdit(story.id, "title")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                          {childStoryDrafts[story.id]?.title ?? story.title}
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-slate-600">
                                      {childEditingCell?.rowId === story.id && childEditingCell.field === "sprint" ? (
                                        <div className="flex items-center gap-1">
                                          <input value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-[4.5rem] rounded-md border bg-white px-2 py-1 text-xs text-slate-700" />
                                          <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                          <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                                        </div>
                                      ) : (
                                        <button type="button" onClick={() => beginChildCellEdit(story.id, "sprint")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                          {childStoryDrafts[story.id]?.sprint ? `Sprint ${childStoryDrafts[story.id]?.sprint}` : "Not set"}
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      {childEditingCell?.rowId === story.id && childEditingCell.field === "status" ? (
                                        <div className="flex items-center gap-1">
                                          <select value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-700">
                                            <option value="todo">To Do</option>
                                            <option value="inProgress">In Progress</option>
                                            <option value="done">Done</option>
                                            <option value="approved">Approved</option>
                                          </select>
                                          <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                          <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                                        </div>
                                      ) : (
                                        <button type="button" onClick={() => beginChildCellEdit(story.id, "status")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                          <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.04em]", statusTone[childStoryDrafts[story.id]?.status ?? story.status] ?? "bg-muted text-muted-foreground")}>
                                            {(childStoryDrafts[story.id]?.status ?? story.status) === "todo" ? <ListTodo className="size-3" /> : null}
                                            {(childStoryDrafts[story.id]?.status ?? story.status) === "inProgress" ? <PlayCircle className="size-3" /> : null}
                                            {(childStoryDrafts[story.id]?.status ?? story.status) === "done" ? <CheckCheck className="size-3" /> : null}
                                            {(childStoryDrafts[story.id]?.status ?? story.status) === "approved" ? <CheckCircle2 className="size-3" /> : null}
                                            {storyStatusLabel[childStoryDrafts[story.id]?.status ?? story.status] ?? (childStoryDrafts[story.id]?.status ?? story.status)}
                                          </span>
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-slate-600">
                                      {childEditingCell?.rowId === story.id && childEditingCell.field === "assignee" ? (
                                        <div className="flex items-center gap-1">
                                          <input value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-700" />
                                          <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                          <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                                        </div>
                                      ) : (
                                        <button type="button" onClick={() => beginChildCellEdit(story.id, "assignee")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                          {(childStoryDrafts[story.id]?.assignee ?? story.assignee)?.trim() || "Unassigned"}
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-slate-600">
                                      {childEditingCell?.rowId === story.id && childEditingCell.field === "priority" ? (
                                        <div className="flex items-center gap-1">
                                          <select value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-700">
                                            <option value="">Not set</option>
                                            <option value="P0">P0</option>
                                            <option value="P1">P1</option>
                                            <option value="P2">P2</option>
                                            <option value="P3">P3</option>
                                          </select>
                                          <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                          <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                                        </div>
                                      ) : (
                                        <button type="button" onClick={() => beginChildCellEdit(story.id, "priority")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                          {childStoryDrafts[story.id]?.priority?.trim() || "Not set"}
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-slate-700">
                                      {childEditingCell?.rowId === story.id && childEditingCell.field === "estimatedDays" ? (
                                        <div className="flex items-center gap-1">
                                          <input type="number" min={0} value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-[3.5rem] rounded-md border bg-white px-1.5 py-1 text-xs text-slate-700" />
                                          <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                          <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                                        </div>
                                      ) : (
                                        <button type="button" onClick={() => beginChildCellEdit(story.id, "estimatedDays")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                          {childStoryDrafts[story.id]?.estimatedDays || "-"}
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-slate-700">
                                      {childEditingCell?.rowId === story.id && childEditingCell.field === "daysLeft" ? (
                                        <div className="flex items-center gap-1">
                                          <input type="number" min={0} value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-[3.5rem] rounded-md border bg-white px-1.5 py-1 text-xs text-slate-700" />
                                          <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                          <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                                        </div>
                                      ) : (
                                        <button type="button" onClick={() => beginChildCellEdit(story.id, "daysLeft")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                          {childStoryDrafts[story.id]?.daysLeft || "-"}
                                        </button>
                                      )}
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
              </section>

              <div className="relative mx-1.5">
                <div
                  className="group absolute inset-y-0 left-1/2 flex w-3 -translate-x-1/2 cursor-col-resize items-stretch justify-center"
                  onPointerDown={beginDetailsPanelResize}
                  title="Resize details panel"
                  aria-label="Resize details panel"
                  role="separator"
                >
                  <div className="h-full w-px bg-slate-300 transition group-hover:bg-slate-500" />
                  <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" />
                </div>
              </div>

              <section className="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                <h3 className="inline-flex w-fit items-center rounded-md bg-indigo-100 px-2.5 py-1 text-[13px] font-semibold tracking-[0.03em] text-indigo-800 ring-1 ring-indigo-200">
                  Details
                </h3>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
                  <p className="text-[12px] font-semibold text-slate-600">Assignee</p>
                  <input
                    className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[14px] text-slate-800"
                    placeholder="e.g. Avi"
                    value={assignee}
                    onChange={(event) => setAssignee(event.target.value)}
                  />
                </label>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
                  <p className="text-[12px] font-semibold text-slate-600">Parent</p>
                  <select
                    className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[14px] text-slate-800 disabled:bg-muted/40"
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
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
                  <p className="text-[12px] font-semibold text-slate-600">Team</p>
                  {showTeamSelect ? (
                    <select
                      className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[14px] text-slate-800"
                      value={teamDraft}
                      onChange={(event) => setTeamDraft(event.target.value)}
                    >
                      <option value="">Not set</option>
                      {MONTH_TEAM_COLUMNS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        value={MONTH_TEAM_COLUMNS.find((t) => t.id === persistedTeam)?.label ?? persistedTeam ?? "Not set"}
                        readOnly
                        className="h-8 w-full rounded-md border border-slate-300 bg-slate-100 px-2.5 text-[14px] text-slate-700"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0 px-2 text-[12px]"
                        onClick={() => {
                          setForceTeamFieldEdit(true);
                          setTeamDraft("");
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  )}
                </label>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
                  <p className="text-[12px] font-semibold text-slate-600">Color</p>
                  <input
                    type="color"
                    className="h-8 w-full rounded-md border border-slate-300 bg-white px-1.5"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                  />
                </label>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
                  <p className="text-[12px] font-semibold text-slate-600">Orig. Est.</p>
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    step={1}
                    className="h-7 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[14px] text-slate-800"
                    placeholder="e.g. 40"
                    value={originalEstimateDaysDraft}
                    onChange={(event) => setOriginalEstimateDaysDraft(event.target.value)}
                  />
                </label>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-start gap-2">
                  <p className="pt-2 text-[12px] font-semibold text-slate-600">Labels</p>
                  <div className="space-y-1.5">
                    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-slate-300 bg-white p-2">
                      {labelsDraft.length === 0 ? <span className="text-xs text-slate-400">No labels yet.</span> : null}
                      {labelsDraft.map((label) => (
                        <span key={label} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {label}
                          <button type="button" onClick={() => removeLabel(label)} className="text-slate-500 hover:text-slate-700">x</button>
                        </span>
                      ))}
                      <input
                        value={newLabel}
                        onChange={(event) => setNewLabel(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addLabel(newLabel);
                          }
                        }}
                        className="h-7 min-w-[10rem] flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-slate-400"
                        placeholder="Type label..."
                      />
                    </div>
                    {filteredLabelSuggestions.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {filteredLabelSuggestions.map((item) => (
                          <button
                            key={item}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              addLabel(item);
                            }}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </label>
                <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-start gap-2">
                  <p className="pt-1 text-[12px] font-semibold text-slate-600">Context</p>
                  <div className="grid gap-1.5 sm:grid-cols-3">
                    <div className="rounded-md border bg-slate-50 px-2 py-1.5 text-[12px] text-slate-700">
                      <p className="text-[11px] text-slate-500">Quarter</p>
                      <p className="font-medium">{planningQuarter}</p>
                    </div>
                    <div className="rounded-md border bg-slate-50 px-2 py-1.5 text-[12px] text-slate-700">
                      <p className="text-[11px] text-slate-500">Month</p>
                      <p className="font-medium">{planningMonth}</p>
                    </div>
                    <div className="rounded-md border bg-slate-50 px-2 py-1.5 text-[12px] text-slate-700">
                      <p className="text-[11px] text-slate-500">Year</p>
                      <p className="font-medium">{planningYear}</p>
                    </div>
                  </div>
                </div>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
                  <p className="text-[12px] font-semibold text-slate-600">Epic ID</p>
                  <input
                    value={epic?.id ?? "Will be created on save"}
                    readOnly
                    className="h-8 w-full rounded-md border border-slate-300 bg-slate-100 px-2.5 text-[14px] text-slate-700"
                  />
                </label>
              </section>
            </div>
          </div>

          <div className="mt-3">
            <div
              className="group relative mb-1 flex h-3 cursor-row-resize items-center justify-center"
              onPointerDown={beginActivityPanelResize}
              title="Resize activity panel height"
              aria-label="Resize activity panel height"
              role="separator"
            >
              <div className="h-px w-full bg-slate-300 transition group-hover:bg-slate-500" />
              <div className="absolute left-0 top-1/2 h-3 w-full -translate-y-1/2" />
            </div>
            <section
              className="flex min-h-0 flex-col space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
              style={{ height: `${hasChildren ? Math.max(180, Math.min(440, activityPanelHeightPx - 40)) : activityPanelHeightPx}px` }}
            >
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

              <div className="min-h-0 flex-1 overflow-y-auto">
                {!epic ? (
                  <p className="text-sm text-slate-500">Save this epic first to add comments and history.</p>
                ) : activityTab === "comments" ? (
                  <>
                    <div className="space-y-2">
                      {(epic.comments ?? []).length === 0 ? (
                        <p className="text-sm text-slate-500">No comments yet.</p>
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
                    <div className="mt-2 flex gap-2">
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
                  <div className="space-y-2">
                    {(epic.history ?? []).length === 0 ? (
                      <p className="text-sm text-slate-500">No history yet.</p>
                    ) : (
                      epic.history.map((entry) => (
                        <div key={entry.id} className="rounded-md bg-white p-2 text-sm ring-1 ring-slate-200">
                          <p className="text-slate-800">{entry.entry}</p>
                          <p className="mt-1 text-[12px] text-slate-500">{new Date(entry.createdAt).toLocaleString()}</p>
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
