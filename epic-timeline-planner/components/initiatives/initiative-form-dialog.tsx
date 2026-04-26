"use client";

import { Bold, Check, ChevronRight, Folder, Heading2, Heading3, History, ImagePlus, Italic, Link as LinkIcon, List, ListOrdered, MessageSquare, Plus, Quote, Underline as UnderlineIcon, X } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { Button } from "@/components/ui/button";
import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";
import { InitiativeItem } from "@/lib/types";
import { useDialogPresence } from "@/lib/use-dialog-presence";
import { planningDetailPanelAnchorStyle, usePlanningSurfaceRect } from "@/lib/use-planning-surface-rect";
import { cn } from "@/lib/utils";

type ChildEpicDraft = {
  title: string;
  assignee: string;
  team: string;
  originalEstimateDays: string;
  color: string;
};

type InitiativeFormDialogProps = {
  open: boolean;
  initiatives: InitiativeItem[];
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
  onPatchEpic?: (
    epicId: string,
    patch: {
      title?: string;
      assignee?: string | null;
      team?: string | null;
      originalEstimateDays?: number | null;
      color?: string;
    },
  ) => Promise<void>;
  onAddComment?: (initiativeId: string, body: string) => Promise<void>;
  onExitComplete?: () => void;
  surfaceAnchorRef?: RefObject<HTMLElement | null>;
};

export function InitiativeFormDialog({
  open,
  initiatives,
  initiative,
  onClose,
  onExitComplete,
  onSubmit,
  onOpenEpic,
  onRequestCreateEpic,
  onPatchEpic,
  onAddComment,
  surfaceAnchorRef,
}: InitiativeFormDialogProps) {
  const [title, setTitle] = useState(initiative?.title ?? "");
  const [icon, setIcon] = useState(initiative?.icon === "🎯" ? "" : (initiative?.icon ?? ""));
  const [description, setDescription] = useState(initiative?.description ?? "");
  const [assignee, setAssignee] = useState(initiative?.assignee ?? "");
  const [color, setColor] = useState(initiative?.color ?? "#3B82F6");
  const [commentBody, setCommentBody] = useState("");
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [labelsDraft, setLabelsDraft] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const [isDraggingDialog, setIsDraggingDialog] = useState(false);
  const [detailsPanelWidthPx, setDetailsPanelWidthPx] = useState(296);
  const [activityPanelHeightPx, setActivityPanelHeightPx] = useState(180);
  const [childEpicDrafts, setChildEpicDrafts] = useState<Record<string, ChildEpicDraft>>({});
  const [childEditingCell, setChildEditingCell] = useState<{
    rowId: string;
    field: "title" | "assignee" | "team" | "originalEstimateDays" | "color";
  } | null>(null);
  const [childEditingValue, setChildEditingValue] = useState("");
  const [newChildEpicTitle, setNewChildEpicTitle] = useState("");

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
    setTitle(initiative?.title ?? "");
    setIcon(initiative?.icon === "🎯" ? "" : (initiative?.icon ?? ""));
    setDescription(initiative?.description ?? "");
    setAssignee(initiative?.assignee ?? "");
    setColor(initiative?.color ?? "#3B82F6");
    setCommentBody("");
    setActivityTab("comments");
    if (initiative?.id) {
      const raw = window.localStorage.getItem(`initiative-labels:${initiative.id}`) ?? "";
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
  }, [initiative, open]);
  useEffect(() => {
    if (!initiative?.id) return;
    window.localStorage.setItem(`initiative-labels:${initiative.id}`, labelsDraft.join(", "));
  }, [initiative?.id, labelsDraft]);

  useEffect(() => {
    if (open) {
      setDialogOffset({ x: 0, y: 0 });
      setIsDraggingDialog(false);
      setDetailsPanelWidthPx(296);
      setActivityPanelHeightPx(180);
      dragStartRef.current = null;
    }
  }, [open]);
  useEffect(() => {
    if (!descriptionEditor) return;
    const next = description?.trim() ? description : "<p></p>";
    if (descriptionEditor.getHTML() !== next) {
      descriptionEditor.commands.setContent(next, false);
    }
  }, [descriptionEditor, initiative?.id, open]);
  useEffect(() => {
    if (!descriptionEditor) return;
    const next = description?.trim() ? description : "<p></p>";
    if (descriptionEditor.getHTML() !== next) {
      descriptionEditor.commands.setContent(next, false);
    }
  }, [descriptionEditor, initiative?.id, open]);

  useEffect(() => {
    if (!initiative) {
      setChildEpicDrafts({});
      return;
    }
    const next: Record<string, ChildEpicDraft> = {};
    for (const row of initiative.epics ?? []) {
      next[row.id] = {
        title: row.title ?? "",
        assignee: row.assignee ?? "",
        team: row.team ?? "",
        originalEstimateDays: row.originalEstimateDays == null ? "" : String(row.originalEstimateDays),
        color: row.color ?? "#3B82F6",
      };
    }
    setChildEpicDrafts(next);
    setChildEditingCell(null);
    setChildEditingValue("");
    setNewChildEpicTitle("");
  }, [initiative]);

  const { visible, leaving } = useDialogPresence(open, onExitComplete);
  const surfaceRect = usePlanningSurfaceRect(surfaceAnchorRef, visible);
  const anchored = false;

  const displayIds = useMemo(() => {
    const byInitiativeId = new Map<string, string>();
    const byEpicId = new Map<string, string>();
    const initiativesSorted = [...initiatives].sort((a, b) => {
      const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (t !== 0) return t;
      return a.title.localeCompare(b.title);
    });
    initiativesSorted.forEach((row, index) => {
      byInitiativeId.set(row.id, `INIT-${String(index + 1).padStart(2, "0")}`);
    });
    const allEpics = initiativesSorted
      .flatMap((row) => row.epics ?? [])
      .sort((a, b) => {
        const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (t !== 0) return t;
        return a.title.localeCompare(b.title);
      });
    allEpics.forEach((row, index) => {
      byEpicId.set(row.id, `EPIC-${String(index + 1).padStart(2, "0")}`);
    });
    return { byInitiativeId, byEpicId };
  }, [initiatives]);

  const hasChildren = (initiative?.epics?.length ?? 0) > 0;
  const existingLabelSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const row of initiative?.epics ?? []) {
      if (row.team && MONTH_TEAM_IDS.includes(row.team)) set.add(MONTH_TEAM_COLUMNS.find((t) => t.id === row.team)?.label ?? row.team);
      if (row.assignee?.trim()) set.add(row.assignee.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [initiative?.epics]);
  const filteredLabelSuggestions = useMemo(() => {
    const q = newLabel.trim().toLowerCase();
    if (!q) return existingLabelSuggestions.filter((item) => !labelsDraft.includes(item)).slice(0, 8);
    return existingLabelSuggestions
      .filter((item) => item.toLowerCase().includes(q) && !labelsDraft.includes(item))
      .slice(0, 8);
  }, [existingLabelSuggestions, labelsDraft, newLabel]);

  async function handleSave() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return;

    setIsSaving(true);
    try {
      await onSubmit({
        title: normalizedTitle,
        icon: icon.trim(),
        description,
        assignee,
        color,
        startMonth: null,
        endMonth: null,
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
      setActivityPanelHeightPx(Math.max(160, Math.min(520, next)));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function beginChildCellEdit(storyId: string, field: "title" | "assignee" | "team" | "originalEstimateDays" | "color") {
    const draft = childEpicDrafts[storyId];
    if (!draft) return;
    setChildEditingCell({ rowId: storyId, field });
    setChildEditingValue(draft[field] ?? "");
  }

  async function confirmChildCellEdit(epicId: string) {
    if (!onPatchEpic || !childEditingCell || childEditingCell.rowId !== epicId) return;
    const existing = childEpicDrafts[epicId];
    if (!existing) return;
    const next: ChildEpicDraft = { ...existing, [childEditingCell.field]: childEditingValue };
    setChildEpicDrafts((prev) => ({ ...prev, [epicId]: next }));
    setChildEditingCell(null);
    setChildEditingValue("");
    await onPatchEpic(epicId, {
      title: next.title.trim(),
      assignee: next.assignee.trim() || null,
      team: next.team.trim() || null,
      originalEstimateDays: next.originalEstimateDays.trim() === "" ? null : Number(next.originalEstimateDays),
      color: next.color,
    });
  }

  function handleAddChildEpic() {
    if (!initiative || !onRequestCreateEpic || !newChildEpicTitle.trim()) return;
    onRequestCreateEpic(initiative.id);
  }

  if (!visible) return null;

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
          )}
          style={{ transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)` }}
        >
          <div className="mb-4 flex cursor-move items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5" onPointerDown={beginDialogDrag}>
            <div className="flex min-w-0 items-center gap-1 text-sm font-semibold text-slate-700">
              <span
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-slate-100 text-[12px] leading-none text-slate-700 ring-1 ring-slate-200"
                aria-hidden
              >
                {(icon || initiative?.icon || "⚡").trim() || "⚡"}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1 truncate rounded px-1 py-0.5 text-blue-700 underline decoration-blue-300 underline-offset-2">
                {initiative ? (displayIds.byInitiativeId.get(initiative.id) ?? "Initiative") : "Initiative"}
              </span>
              <ChevronRight className="size-4 shrink-0 text-slate-400" />
              <span className="truncate text-slate-900">{title || (initiative ? "Initiative details" : "Create initiative")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 px-3 text-xs font-medium" onClick={onClose}>Cancel</Button>
              <Button size="sm" className="h-8 px-3 text-xs font-medium" onClick={handleSave} disabled={isSaving}>{isSaving ? "Saving..." : initiative ? "Save" : "Create"}</Button>
              <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close initiative details"><X /></Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div ref={splitLayoutRef} className="grid min-h-0 gap-0" style={{ gridTemplateColumns: `minmax(0,1fr) 10px ${detailsPanelWidthPx}px` }}>
              <section className="h-full min-h-0 overflow-y-auto space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                <label className="block space-y-1">
                  <p className="text-sm font-medium text-slate-600">Title</p>
                  <div className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-slate-300/70">
                    <input value={icon} onChange={(event) => setIcon(event.target.value)} maxLength={2} placeholder="⚡" className="w-12 border-r border-slate-200 bg-transparent px-2 py-2 text-center text-xl outline-none" />
                    <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full bg-transparent px-3 py-2 text-base outline-none" placeholder="Initiative title" />
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
                    <h3 className="text-base font-semibold text-slate-800">Child epics</h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-sm text-slate-600 ring-1 ring-slate-200">{initiative?.epics?.length ?? 0}</span>
                  </div>

                  {!initiative ? (
                    <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">Save this initiative first, then add and manage epics here.</p>
                  ) : (
                    <>
                      <div className="max-h-56 space-y-2 overflow-y-auto">
                        {(initiative.epics ?? []).length === 0 ? (
                          <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">No epics yet.</p>
                        ) : (
                          <div className="overflow-x-auto rounded-md bg-white ring-1 ring-slate-200">
                            <table className="w-full min-w-[860px] text-left text-sm">
                              <thead className="bg-indigo-50/70 text-slate-600">
                                <tr>
                                  <th className="px-2 py-1.5 font-medium">ID</th>
                                  <th className="px-2 py-1.5 font-medium">Type</th>
                                  <th className="px-2 py-1.5 font-medium">Epic</th>
                                  <th className="px-2 py-1.5 font-medium">Team</th>
                                  <th className="px-2 py-1.5 font-medium">Assignee</th>
                                  <th className="px-2 py-1.5 font-medium">Color</th>
                                  <th className="px-2 py-1.5 font-medium">Orig. Est.</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-t border-slate-100 bg-blue-50/40">
                                  <td className="px-2 py-1.5 text-slate-400">-</td>
                                  <td className="px-2 py-1.5">
                                    <span className="inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                                      Epic
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <div className="flex gap-1">
                                      <input
                                        value={newChildEpicTitle}
                                        onChange={(event) => setNewChildEpicTitle(event.target.value)}
                                        placeholder="Add child epic title"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-800"
                                      />
                                      <Button type="button" size="sm" variant="outline" onClick={handleAddChildEpic}>
                                        Add
                                      </Button>
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-400">Not set</td>
                                  <td className="px-2 py-1.5 text-slate-400">Unassigned</td>
                                  <td className="px-2 py-1.5 text-slate-400">-</td>
                                  <td className="px-2 py-1.5 text-slate-400">-</td>
                                </tr>
                                {initiative.epics.map((row) => (
                                  <tr key={row.id} className="border-t border-slate-100">
                                    <td className="px-2 py-1.5 text-slate-600"><button type="button" onClick={() => onOpenEpic?.(row.id)} className="rounded px-1 py-0.5 text-blue-700 hover:bg-blue-50 hover:underline">{displayIds.byEpicId.get(row.id) ?? row.id}</button></td>
                                    <td className="px-2 py-1.5 text-slate-600"><span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">Epic</span></td>
                                    <td className="px-2 py-1.5 text-slate-800">{childEditingCell?.rowId === row.id && childEditingCell.field === "title" ? <div className="flex items-center gap-1"><input value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-800" /><button type="button" onClick={() => void confirmChildCellEdit(row.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button><button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button></div> : <button type="button" onClick={() => beginChildCellEdit(row.id, "title")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">{childEpicDrafts[row.id]?.title ?? row.title}</button>}</td>
                                    <td className="px-2 py-1.5 text-slate-600">{childEditingCell?.rowId === row.id && childEditingCell.field === "team" ? <div className="flex items-center gap-1"><select value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-700"><option value="">Not set</option>{MONTH_TEAM_COLUMNS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select><button type="button" onClick={() => void confirmChildCellEdit(row.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button><button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button></div> : <button type="button" onClick={() => beginChildCellEdit(row.id, "team")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">{MONTH_TEAM_COLUMNS.find((t) => t.id === (childEpicDrafts[row.id]?.team ?? row.team))?.label ?? (childEpicDrafts[row.id]?.team ?? row.team) ?? "Not set"}</button>}</td>
                                    <td className="px-2 py-1.5 text-slate-600">{childEditingCell?.rowId === row.id && childEditingCell.field === "assignee" ? <div className="flex items-center gap-1"><input value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-700" /><button type="button" onClick={() => void confirmChildCellEdit(row.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button><button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button></div> : <button type="button" onClick={() => beginChildCellEdit(row.id, "assignee")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">{(childEpicDrafts[row.id]?.assignee ?? row.assignee)?.trim() || "Unassigned"}</button>}</td>
                                    <td className="px-2 py-1.5 text-slate-600">{childEditingCell?.rowId === row.id && childEditingCell.field === "color" ? <div className="flex items-center gap-1"><input type="color" value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="h-7 w-10 rounded border bg-white p-0.5" /><button type="button" onClick={() => void confirmChildCellEdit(row.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button><button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button></div> : <button type="button" onClick={() => beginChildCellEdit(row.id, "color")} className="inline-flex rounded px-1 py-0.5 hover:bg-slate-100"><span className="inline-block h-4 w-8 rounded border" style={{ backgroundColor: childEpicDrafts[row.id]?.color ?? row.color ?? "#3B82F6" }} /></button>}</td>
                                    <td className="px-2 py-1.5 text-slate-600">{childEditingCell?.rowId === row.id && childEditingCell.field === "originalEstimateDays" ? <div className="flex items-center gap-1"><input type="number" min={0} value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-[4.5rem] rounded-md border bg-white px-2 py-1 text-xs text-slate-700" /><button type="button" onClick={() => void confirmChildCellEdit(row.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button><button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button></div> : <button type="button" onClick={() => beginChildCellEdit(row.id, "originalEstimateDays")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">{childEpicDrafts[row.id]?.originalEstimateDays || (row.originalEstimateDays == null ? "-" : String(row.originalEstimateDays))}</button>}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                    </>
                  )}
                </section>
              </section>

              <div className="relative mx-1.5">
                <div className="group absolute inset-y-0 left-1/2 flex w-3 -translate-x-1/2 cursor-col-resize items-stretch justify-center" onPointerDown={beginDetailsPanelResize} title="Resize details panel" aria-label="Resize details panel" role="separator">
                  <div className="h-full w-px bg-slate-300 transition group-hover:bg-slate-500" />
                  <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" />
                </div>
              </div>

              <section className="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                <h3 className="inline-flex w-fit items-center rounded-md bg-indigo-100 px-2.5 py-1 text-[13px] font-semibold tracking-[0.03em] text-indigo-800 ring-1 ring-indigo-200">Details</h3>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2"><p className="text-[12px] font-semibold text-slate-600">Assignee</p><input className="h-7 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[14px] text-slate-800" value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="e.g. Avi" /></label>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2"><p className="text-[12px] font-semibold text-slate-600">Color</p><input type="color" className="h-7 w-full rounded-md border border-slate-300 bg-white px-1.5" value={color} onChange={(event) => setColor(event.target.value)} /></label>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2"><p className="text-[12px] font-semibold text-slate-600">Initiative ID</p><input value={initiative?.id ?? "Will be created on save"} readOnly className="h-7 w-full rounded-md border border-slate-300 bg-slate-100 px-2.5 text-[14px] text-slate-700" /></label>
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
                <div className="rounded-md border bg-slate-50 px-2 py-1.5 text-[12px] text-slate-700"><p className="text-[11px] text-slate-500">Epics</p><p className="font-medium">{initiative?.epics?.length ?? 0}</p></div>
              </section>
            </div>
          </div>

          <div className="mt-3">
            <div className="group relative mb-1 flex h-3 cursor-row-resize items-center justify-center" onPointerDown={beginActivityPanelResize} title="Resize activity panel height" aria-label="Resize activity panel height" role="separator">
              <div className="h-px w-full bg-slate-300 transition group-hover:bg-slate-500" />
              <div className="absolute left-0 top-1/2 h-3 w-full -translate-y-1/2" />
            </div>
            <section className="flex min-h-0 flex-col space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200" style={{ height: `${hasChildren ? Math.max(160, Math.min(420, activityPanelHeightPx - 30)) : activityPanelHeightPx}px` }}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-800">Activity</h3>
                <div className="inline-flex rounded-lg bg-white p-1 ring-1 ring-slate-200">
                  <button type="button" className={cn("rounded-md px-2.5 py-1 text-sm font-medium transition", activityTab === "comments" ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200" : "text-slate-600 hover:bg-slate-100")} onClick={() => setActivityTab("comments")}><MessageSquare className="mr-1 inline size-3.5" />Comments</button>
                  <button type="button" className={cn("rounded-md px-2.5 py-1 text-sm font-medium transition", activityTab === "history" ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200" : "text-slate-600 hover:bg-slate-100")} onClick={() => setActivityTab("history")}><History className="mr-1 inline size-3.5" />History</button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {!initiative ? (
                  <p className="text-sm text-slate-500">Save this initiative first to add comments and history.</p>
                ) : activityTab === "comments" ? (
                  <>
                    <div className="space-y-2">
                      {(initiative.comments ?? []).length === 0 ? <p className="text-sm text-slate-500">No comments yet.</p> : initiative.comments.map((comment) => (
                        <div key={comment.id} className="rounded-md bg-white p-2 text-sm ring-1 ring-slate-200">
                          <p className="text-[12px] text-slate-500">{comment.author ?? "Planner"} - {new Date(comment.createdAt).toLocaleString()}</p>
                          <p className="mt-1 text-slate-800">{comment.body}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input value={commentBody} onChange={(event) => setCommentBody(event.target.value)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Write a comment..." />
                      <Button size="sm" variant="outline" onClick={handleAddComment} disabled={isAddingComment}><Plus />Add</Button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    {(initiative.history ?? []).length === 0 ? <p className="text-sm text-slate-500">No history yet.</p> : initiative.history.map((entry) => (
                      <div key={entry.id} className="rounded-md bg-white p-2 text-sm ring-1 ring-slate-200">
                        <p className="text-slate-800">{entry.entry}</p>
                        <p className="mt-1 text-[12px] text-slate-500">{new Date(entry.createdAt).toLocaleString()}</p>
                      </div>
                    ))}
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
