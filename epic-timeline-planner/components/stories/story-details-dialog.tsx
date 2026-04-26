"use client";

import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Bold, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, Heading2, Heading3, History, ImagePlus, Italic, Link as LinkIcon, List, ListOrdered, ListTodo, MessageSquare, PlayCircle, Plus, Quote, Tag, Trash, Underline as UnderlineIcon, X } from "lucide-react";
import { StoryStatus } from "@/lib/generated/prisma";

import { Button } from "@/components/ui/button";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { EpicPlanBarIcon, InitiativePlanBarIcon } from "@/components/timeline/epic-plan-bar";
import { monthTeamLabelForId } from "@/lib/month-team-board";
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
  storyRef: _storyRef,
  surfaceAnchorRef,
}: StoryDetailsDialogProps) {
  const statusMeta: Record<StoryStatus, { Icon: typeof ListTodo }> = {
    [StoryStatus.todo]: { Icon: ListTodo },
    [StoryStatus.inProgress]: { Icon: PlayCircle },
    [StoryStatus.done]: { Icon: CheckCheck },
    [StoryStatus.approved]: { Icon: CheckCircle2 },
  };
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("📄");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [labelsDraft, setLabelsDraft] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [labelsAutocompleteOpen, setLabelsAutocompleteOpen] = useState(false);
  const [labelsAutocompleteIndex, setLabelsAutocompleteIndex] = useState(-1);
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
  const [dialogWidthVw, setDialogWidthVw] = useState(75);
  const [activityOpen, setActivityOpen] = useState(false);
  const [detailsPanelWidthPx, setDetailsPanelWidthPx] = useState(296);
  const [activityPanelHeightPx, setActivityPanelHeightPx] = useState(280);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const [isDraggingDialog, setIsDraggingDialog] = useState(false);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const descriptionEditor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
      Placeholder.configure({
        placeholder: "Description",
      }),
    ],
    content: description?.trim() ? description : "<p></p>",
    onUpdate: ({ editor }) => {
      setDescription(editor.getHTML());
    },
    immediatelyRender: false,
  });

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
        return { team };
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
  const filteredLabelSuggestions = useMemo(() => {
    const q = newLabel.trim().toLowerCase();
    if (!q) return [];
    return existingLabelSuggestions
      .filter((item) => item.toLowerCase().includes(q) && !labelsDraft.includes(item))
      .slice(0, 8);
  }, [existingLabelSuggestions, labelsDraft, newLabel]);

  useEffect(() => {
    setLabelsAutocompleteIndex(-1);
  }, [newLabel, labelsDraft, filteredLabelSuggestions.length]);
  const displayIds = useMemo(() => {
    const byInitiativeId = new Map<string, string>();
    const byEpicId = new Map<string, string>();
    const byStoryId = new Map<string, string>();

    const initiativesSorted = [...initiatives].sort((a, b) => {
      const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (t !== 0) return t;
      return a.title.localeCompare(b.title);
    });
    initiativesSorted.forEach((initiative, index) => {
      byInitiativeId.set(initiative.id, `INIT-${String(index + 1).padStart(2, "0")}`);
    });

    const allEpics = initiatives
      .flatMap((initiative) => initiative.epics ?? [])
      .sort((a, b) => {
        const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (t !== 0) return t;
        return a.title.localeCompare(b.title);
      });
    allEpics.forEach((epic, index) => {
      byEpicId.set(epic.id, `EPIC-${String(index + 1).padStart(2, "0")}`);
    });

    const allStories = initiatives
      .flatMap((initiative) => initiative.epics ?? [])
      .flatMap((epic) => epic.userStories ?? [])
      .sort((a, b) => {
        const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (t !== 0) return t;
        return a.title.localeCompare(b.title);
      });
    allStories.forEach((row, index) => {
      byStoryId.set(row.id, `US-${String(index + 1).padStart(2, "0")}`);
    });

    return { byInitiativeId, byEpicId, byStoryId };
  }, [initiatives]);

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
      setDialogWidthVw(75);
      setActivityOpen(false);
      setDetailsPanelWidthPx(296);
      setActivityPanelHeightPx(280);
      setDialogOffset({ x: 0, y: 0 });
      setIsDraggingDialog(false);
      dragStartRef.current = null;
    }
  }, [open]);
  useEffect(() => {
    if (!descriptionEditor) return;
    const next = description?.trim() ? description : "<p></p>";
    if (descriptionEditor.getHTML() !== next) {
      descriptionEditor.commands.setContent(next, { emitUpdate: false });
    }
  }, [descriptionEditor, story?.id, open]);

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
      setActivityPanelHeightPx(Math.max(180, Math.min(560, next)));
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
            ? surfaceRect
              ? planningDetailPanelAnchorStyle(surfaceRect)
              : undefined
            : { width: `min(${dialogWidthVw}vw, 1320px)`, maxWidth: `min(${dialogWidthVw}vw, 1320px)` }
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
              className="inline-flex min-w-0 items-center gap-1 truncate cursor-pointer rounded px-1 py-0.5 text-blue-700 underline decoration-blue-300 underline-offset-2 hover:bg-blue-50"
              title={selectedBreadcrumbMeta?.initiative?.title ?? "Open initiative"}
            >
              <InitiativePlanBarIcon
                icon={selectedBreadcrumbMeta?.initiative?.icon}
                className="mr-0 text-[11px] [&_svg]:size-3 [&_svg]:text-blue-600"
              />
              {selectedBreadcrumbMeta?.initiative
                ? (displayIds.byInitiativeId.get(selectedBreadcrumbMeta.initiative.id) ?? "Initiative")
                : "Initiative"}
            </button>
            <ChevronRight className="size-4 shrink-0 text-slate-400" />
            <button
              type="button"
              onClick={() => selectedBreadcrumbMeta?.epic && onOpenEpic?.(selectedBreadcrumbMeta.epic.id)}
              className="inline-flex min-w-0 items-center gap-1 truncate cursor-pointer rounded px-1 py-0.5 text-blue-700 underline decoration-blue-300 underline-offset-2 hover:bg-blue-50"
              title={selectedBreadcrumbMeta?.epic?.title ?? "Open epic"}
            >
              <EpicPlanBarIcon icon={selectedBreadcrumbMeta?.epic?.icon} className="mr-0 text-[11px] [&_svg]:size-3 [&_svg]:text-slate-600" />
              {selectedBreadcrumbMeta?.epic
                ? (displayIds.byEpicId.get(selectedBreadcrumbMeta.epic.id) ?? "Epic")
                : "Epic"}
            </button>
            <ChevronRight className="size-4 shrink-0 text-slate-400" />
            <button
              type="button"
              onClick={() => story && onOpenStory?.(story.id)}
              className="inline-flex min-w-0 items-center gap-1 truncate cursor-pointer rounded px-1 py-0.5 text-blue-700 underline decoration-blue-300 underline-offset-2 hover:bg-blue-50"
              title={(story?.title ?? title) || "Open user story"}
            >
              <UserStoryIcon className="size-3.5" />
              {story ? (displayIds.byStoryId.get(story.id) ?? "User Story") : "User Story"}
            </button>
            <ChevronRight className="size-4 shrink-0 text-slate-400" />
            <span className="truncate text-slate-900">{title || (isCreateMode ? "Create User Story" : "Untitled")}</span>
          </div>
          <div className="flex items-center gap-2">
            {!isCreateMode ? (
              <>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => void handleDelete()}
                  aria-label="Delete story"
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash className="size-4" />
                </Button>
                <Button size="sm" variant="outline" className="h-8 px-3 text-xs font-medium" onClick={onClose}>
                  Cancel
                </Button>
                <Button size="sm" className="h-8 px-3 text-xs font-medium" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </>
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
          <section className="h-full min-h-0 overflow-y-auto space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <label className="block space-y-1">
              <p className="text-sm font-medium text-slate-600">Title</p>
              <div className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-slate-300/70">
                <input
                  value={icon}
                  onChange={(event) => setIcon(event.target.value)}
                  maxLength={2}
                  className="w-12 border-r border-slate-200 bg-transparent px-2 py-2 text-center text-xl outline-none"
                />
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full bg-transparent px-3 py-2 text-base outline-none"
                />
              </div>
            </label>
            <label className="mt-5 block space-y-1">
              <p className="text-sm font-medium text-slate-600">Description</p>
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1 rounded-md border border-slate-200 bg-slate-50 p-1">
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleBold().run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
                      descriptionEditor?.isActive("bold") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
                    )}
                  >
                    <Bold className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleHeading({ level: 2 }).run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
                      descriptionEditor?.isActive("heading", { level: 2 }) ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
                    )}
                  >
                    <Heading2 className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleHeading({ level: 3 }).run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
                      descriptionEditor?.isActive("heading", { level: 3 }) ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
                    )}
                  >
                    <Heading3 className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      const prev = (descriptionEditor?.getAttributes("link").href as string | undefined) ?? "";
                      const url = window.prompt("Link URL", prev || "https://");
                      if (!descriptionEditor || url == null) return;
                      const trimmed = url.trim();
                      if (!trimmed) {
                        descriptionEditor.chain().focus().extendMarkRange("link").unsetLink().run();
                        return;
                      }
                      descriptionEditor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
                    }}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
                      descriptionEditor?.isActive("link") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
                    )}
                  >
                    <LinkIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!descriptionEditor) return;
                      const picker = document.createElement("input");
                      picker.type = "file";
                      picker.accept = "image/*";
                      picker.onchange = () => {
                        const file = picker.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          const src = typeof reader.result === "string" ? reader.result : "";
                          if (!src) return;
                          descriptionEditor.chain().focus().setImage({ src }).run();
                        };
                        reader.readAsDataURL(file);
                      };
                      picker.click();
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-slate-700 hover:bg-white"
                  >
                    <ImagePlus className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleItalic().run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
                      descriptionEditor?.isActive("italic") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
                    )}
                  >
                    <Italic className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleUnderline().run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
                      descriptionEditor?.isActive("underline") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
                    )}
                  >
                    <UnderlineIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleBulletList().run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
                      descriptionEditor?.isActive("bulletList") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
                    )}
                  >
                    <List className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleOrderedList().run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
                      descriptionEditor?.isActive("orderedList") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
                    )}
                  >
                    <ListOrdered className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleBlockquote().run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
                      descriptionEditor?.isActive("blockquote") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
                    )}
                  >
                    <Quote className="size-3.5" />
                  </button>
                </div>
                <div className="min-h-0 rounded-md border bg-background px-3 py-2">
                  <EditorContent
                    editor={descriptionEditor}
                    className="focus:outline-none [&_.ProseMirror]:min-h-[16rem] [&_.ProseMirror]:outline-none"
                  />
                </div>
              </div>
            </label>
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

          <section className="relative z-20 space-y-5 rounded-xl border border-slate-200/80 bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
            <h3 className="border-b border-slate-200/90 pb-2 text-base font-semibold leading-snug tracking-tight text-slate-900">
              Details
            </h3>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-sm font-semibold text-slate-700">Status</p>
              <div className="flex h-7 items-center gap-1.5 rounded-md border border-blue-300/80 bg-blue-50/35 px-2">
                {(() => {
                  const Icon = statusMeta[status].Icon;
                  return <Icon className="size-3.5 shrink-0 text-slate-600" />;
                })()}
                <select value={status} onChange={(event) => setStatus(event.target.value as StoryStatus)} className="h-7 w-full bg-transparent text-[13px] font-medium text-slate-800 outline-none">
                  <option value={StoryStatus.todo}>To Do</option>
                  <option value={StoryStatus.inProgress}>In Progress</option>
                  <option value={StoryStatus.done}>Done</option>
                  <option value={StoryStatus.approved}>Approved</option>
                </select>
              </div>
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-sm font-semibold text-slate-700">Assignee</p>
              <input value={assignee} onChange={(event) => setAssignee(event.target.value)} className="h-7 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-800" placeholder="e.g. Avi" />
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-sm font-semibold text-slate-700">Team</p>
              <input value={selectedEpicMeta?.team ?? "Not set"} readOnly className="h-7 w-full rounded-md border border-slate-300 bg-slate-100 px-2.5 text-[13px] text-slate-700" />
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-sm font-semibold text-slate-700">Sprint</p>
              <select value={sprint} onChange={(event) => setSprint(event.target.value)} className="h-7 w-full rounded-md border border-blue-300/80 bg-blue-50/35 px-2.5 text-[13px] font-medium text-slate-800">
                <option value="">Not set</option>
                {Array.from({ length: YEAR_SPRINT_MAX }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>{`Sprint ${i + 1}`}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3 pt-0.5">
              <p className="text-sm font-semibold text-slate-700">Estimated Days</p>
              <input
                type="number"
                min={0}
                value={estimatedDays}
                onChange={(event) => setEstimatedDays(event.target.value)}
                className="h-6 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-800"
              />
            </div>
            <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-sm font-semibold text-slate-700">Est. Days left</p>
              <input
                type="number"
                min={0}
                value={daysLeft}
                onChange={(event) => setDaysLeft(event.target.value)}
                className="h-6 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-800"
              />
            </div>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-sm font-semibold text-slate-700">Priority</p>
              <select value={priority} onChange={(event) => setPriority(event.target.value)} className="h-7 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-800">
                <option value="">Not set</option>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </select>
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-sm font-semibold text-slate-700">Parent</p>
              <select value={epicId} onChange={(event) => setEpicId(event.target.value)} className="h-7 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-800 disabled:bg-muted/40" disabled={Boolean(lockParentEpicId)}>
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
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-sm font-semibold text-slate-700">Labels</p>
              <div className="relative z-30">
                <div className="flex min-h-6 flex-wrap items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-0.5">
                  {labelsDraft.map((label) => (
                    <span key={label} className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-700">
                      <Tag className="size-2.5" />
                      {label}
                      <button type="button" onClick={() => removeLabel(label)} className="text-slate-500 hover:text-slate-700">x</button>
                    </span>
                  ))}
                  <input
                    value={newLabel}
                    onChange={(event) => setNewLabel(event.target.value)}
                    onFocus={() => setLabelsAutocompleteOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => {
                        setLabelsAutocompleteOpen(false);
                        setLabelsAutocompleteIndex(-1);
                      }, 120);
                    }}
                    onKeyDown={(event) => {
                      const list = filteredLabelSuggestions;
                      if (event.key === "ArrowDown" && list.length > 0) {
                        event.preventDefault();
                        setLabelsAutocompleteIndex((i) => (i + 1) % list.length);
                        return;
                      }
                      if (event.key === "ArrowUp" && list.length > 0) {
                        event.preventDefault();
                        setLabelsAutocompleteIndex((i) => (i <= 0 ? list.length - 1 : i - 1));
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setLabelsAutocompleteOpen(false);
                        setLabelsAutocompleteIndex(-1);
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const pick = labelsAutocompleteIndex >= 0 ? list[labelsAutocompleteIndex] : null;
                        if (pick) addLabel(pick);
                        else addLabel(newLabel);
                        setLabelsAutocompleteIndex(-1);
                      }
                    }}
                    autoComplete="off"
                    className="h-6 min-w-[8rem] flex-1 bg-transparent px-1 text-[12px] outline-none placeholder:text-slate-400"
                    placeholder="Type to search labels..."
                  />
                </div>
                {labelsAutocompleteOpen && filteredLabelSuggestions.length > 0 ? (
                  <ul
                    className="absolute left-0 right-0 top-full z-[200] mt-1 max-h-44 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
                    role="listbox"
                  >
                    {filteredLabelSuggestions.map((item, i) => (
                      <li key={item} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={i === labelsAutocompleteIndex}
                          className={cn(
                            "flex w-full px-3 py-2 text-left text-[13px] text-slate-800 hover:bg-slate-50",
                            i === labelsAutocompleteIndex && "bg-indigo-50 text-indigo-900",
                          )}
                          onMouseEnter={() => setLabelsAutocompleteIndex(i)}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            addLabel(item);
                          }}
                        >
                          {item}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </label>
          </section>
          </div>
        </div>

        <div className="relative z-0 mt-3">
          {activityOpen ? (
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
          ) : null}
          <section
            className={cn(
              "flex min-h-0 flex-col rounded-xl bg-slate-50 ring-1 ring-slate-200",
              activityOpen ? "space-y-3 p-3" : "p-3",
            )}
            style={activityOpen ? { height: `${activityPanelHeightPx}px` } : undefined}
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-lg text-left outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-slate-400"
              onClick={() => setActivityOpen((open) => !open)}
              aria-expanded={activityOpen}
            >
              <span className="flex items-center gap-2 text-base font-semibold text-slate-800">
                <ChevronDown
                  className={cn("size-4 shrink-0 text-slate-500 transition-transform", !activityOpen && "-rotate-90")}
                  aria-hidden
                />
                Activity
              </span>
              {activityOpen ? (
                <div
                  className="inline-flex shrink-0 rounded-lg bg-white p-1 ring-1 ring-slate-200"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  role="presentation"
                >
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
              ) : null}
            </button>

            {activityOpen ? (
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
                    <div className="mt-2 flex gap-2">
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
            ) : null}
          </section>
        </div>
        </div>
      </div>
    </div>
  );
}
