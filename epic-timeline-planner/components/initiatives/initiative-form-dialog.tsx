"use client";

import {
  Activity as ActivityIcon,
  ArrowUpDown,
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  FileText,
  Folder,
  Heading2,
  Heading3,
  History,
  Info,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTree,
  MessageSquare,
  Quote,
  Tag,
  Type,
  UserRound,
  Zap,
  Underline as UnderlineIcon,
  X,
} from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { ActivityCommentComposer } from "@/components/ui/activity-comment-composer";
import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { Button } from "@/components/ui/button";
import { RichCommentBody } from "@/components/ui/rich-comment-body";
import { collectAssigneeNameSuggestions } from "@/lib/delivery-assignees";
import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";
import { MONTHS } from "@/lib/timeline";
import { type EpicItem, InitiativeItem } from "@/lib/types";
import { useDialogPresence } from "@/lib/use-dialog-presence";
import { planningDetailPanelAnchorStyle, usePlanningSurfaceRect } from "@/lib/use-planning-surface-rect";
import { useResizableTableColumns } from "@/lib/use-resizable-table-columns";
import { cn } from "@/lib/utils";

function sumUserStoryEstDaysForEpic(epic: EpicItem): number {
  return (epic.userStories ?? []).reduce((sum, story) => sum + (story.estimatedDays ?? 0), 0);
}

const INIT_CHILD_TABLE_DEFAULT_WIDTHS = [72, 220, 116, 120, 96, 96] as const;

type InitChildEpicSortKey = "id" | "title" | "team" | "assignee" | "originalEstimateDays" | "childSum";

const CHILD_TABLE_RESIZE_HANDLE =
  "absolute right-0 top-0 z-[1] h-full w-1.5 cursor-col-resize select-none hover:bg-slate-400/50";

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
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [activityOpen, setActivityOpen] = useState(() => (initiative?.epics?.length ?? 0) === 0);
  const [descriptionAccordionOpen, setDescriptionAccordionOpen] = useState(true);
  const [labelsDraft, setLabelsDraft] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [labelsAutocompleteOpen, setLabelsAutocompleteOpen] = useState(false);
  const [labelsAutocompleteIndex, setLabelsAutocompleteIndex] = useState(-1);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const [isDraggingDialog, setIsDraggingDialog] = useState(false);
  const [dialogWidthVw, setDialogWidthVw] = useState(68);
  const [detailsPanelWidthPx, setDetailsPanelWidthPx] = useState(296);
  const [activityPanelHeightPx, setActivityPanelHeightPx] = useState(220);
  const [childEpicDrafts, setChildEpicDrafts] = useState<Record<string, ChildEpicDraft>>({});
  const [childEditingCell, setChildEditingCell] = useState<{
    rowId: string;
    field: "title" | "assignee" | "team" | "originalEstimateDays";
  } | null>(null);
  const [childEditingValue, setChildEditingValue] = useState("");
  const [newChildEpicTitle, setNewChildEpicTitle] = useState("");
  const [childEpicSortKey, setChildEpicSortKey] = useState<InitChildEpicSortKey>("title");
  const [childEpicSortDir, setChildEpicSortDir] = useState<"asc" | "desc">("asc");
  const { widths: initChildTableWidths, onColumnResizeStart: onInitChildTableColResize } = useResizableTableColumns(
    `${open ? "1" : "0"}-${initiative?.id ?? "none"}`,
    INIT_CHILD_TABLE_DEFAULT_WIDTHS,
  );

  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);
  const dialogShellRef = useRef<HTMLDivElement | null>(null);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const descriptionEditor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-blue-600 underline decoration-blue-600/40 underline-offset-2",
        },
      }),
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
    setActivityTab("comments");
    setActivityOpen((initiative?.epics?.length ?? 0) === 0);
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
      setDialogWidthVw(68);
      setDetailsPanelWidthPx(296);
      setActivityPanelHeightPx(220);
      setActivityOpen((initiative?.epics?.length ?? 0) === 0);
      setDescriptionAccordionOpen(true);
      dragStartRef.current = null;
    }
  }, [open]);
  useEffect(() => {
    if (!descriptionEditor) return;
    const next = initiative?.description?.trim() ? initiative.description : "<p></p>";
    descriptionEditor.commands.setContent(next, { emitUpdate: false });
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

  const assigneeNameSuggestions = useMemo(() => collectAssigneeNameSuggestions(initiatives), [initiatives]);

  function toggleChildEpicSort(key: InitChildEpicSortKey) {
    if (key === childEpicSortKey) {
      setChildEpicSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setChildEpicSortKey(key);
      setChildEpicSortDir("asc");
    }
  }

  const sortedInitiativeChildEpics = useMemo(() => {
    const raw = initiative?.epics ?? [];
    if (raw.length === 0) return raw;
    const list = [...raw];
    const asc = childEpicSortDir === "asc";
    const mul = asc ? 1 : -1;
    const ids = displayIds.byEpicId;
    const drafts = childEpicDrafts;

    const cmpStr = (a: string, b: string) => {
      if (a < b) return -1 * mul;
      if (a > b) return 1 * mul;
      return 0;
    };
    const cmpNum = (a: number, b: number) => {
      if (a < b) return -1 * mul;
      if (a > b) return 1 * mul;
      return 0;
    };

    const teamLabel = (row: EpicItem) => {
      const tid = drafts[row.id]?.team ?? row.team ?? "";
      return (MONTH_TEAM_COLUMNS.find((t) => t.id === tid)?.label ?? tid).toLowerCase();
    };

    list.sort((ra, rb) => {
      switch (childEpicSortKey) {
        case "id": {
          const la = (ids.get(ra.id) ?? ra.id).toLowerCase();
          const lb = (ids.get(rb.id) ?? rb.id).toLowerCase();
          return la.localeCompare(lb, undefined, { numeric: true }) * mul;
        }
        case "title":
          return cmpStr(
            (drafts[ra.id]?.title ?? ra.title).toLowerCase(),
            (drafts[rb.id]?.title ?? rb.title).toLowerCase(),
          );
        case "team":
          return cmpStr(teamLabel(ra), teamLabel(rb));
        case "assignee":
          return cmpStr(
            (drafts[ra.id]?.assignee ?? ra.assignee ?? "").toLowerCase(),
            (drafts[rb.id]?.assignee ?? rb.assignee ?? "").toLowerCase(),
          );
        case "originalEstimateDays": {
          const parseO = (row: EpicItem) => {
            const d = drafts[row.id]?.originalEstimateDays?.trim();
            const n = d ? Number(d) : row.originalEstimateDays;
            return Number.isFinite(Number(n)) ? Number(n) : -1;
          };
          return cmpNum(parseO(ra), parseO(rb));
        }
        case "childSum":
          return cmpNum(sumUserStoryEstDaysForEpic(ra), sumUserStoryEstDaysForEpic(rb));
        default:
          return 0;
      }
    });
    return list;
  }, [initiative?.epics, childEpicSortKey, childEpicSortDir, childEpicDrafts, displayIds]);

  const hasChildren = (initiative?.epics?.length ?? 0) > 0;

  const initiativePlanningQuarter = useMemo(() => {
    const m = initiative?.startMonth;
    if (m == null) return "Not set";
    if (m <= 3) return "Q1";
    if (m <= 6) return "Q2";
    if (m <= 9) return "Q3";
    return "Q4";
  }, [initiative?.startMonth]);

  const initiativePlanningMonth = useMemo(() => {
    if (initiative?.startMonth == null) return "Not set";
    const s = initiative.startMonth;
    const e = initiative.endMonth;
    if (e != null && e !== s) return `${MONTHS[s - 1]}-${MONTHS[e - 1]}`;
    return MONTHS[s - 1];
  }, [initiative?.startMonth, initiative?.endMonth]);

  const initiativePlanningYear = useMemo(() => {
    if (initiative == null) return "Not set";
    return String(initiative.year);
  }, [initiative]);
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
    if (!q) return [];
    return existingLabelSuggestions
      .filter((item) => item.toLowerCase().includes(q) && !labelsDraft.includes(item))
      .slice(0, 8);
  }, [existingLabelSuggestions, labelsDraft, newLabel]);

  const totalUserStoryEstimate = useMemo(() => {
    return (initiative?.epics ?? []).reduce(
      (sum, row) => sum + (row.userStories ?? []).reduce((storySum, story) => storySum + (story.estimatedDays ?? 0), 0),
      0,
    );
  }, [initiative?.epics]);
  const infoTooltipClass =
    "pointer-events-none absolute left-1/2 top-0 z-[320] w-48 max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-normal rounded-lg border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/40 px-2.5 py-1.5 text-[12px] font-medium leading-snug text-slate-700 opacity-0 shadow-md ring-1 ring-indigo-100/70 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100";

  useEffect(() => {
    setLabelsAutocompleteIndex(-1);
  }, [newLabel, labelsDraft, filteredLabelSuggestions.length]);

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

  async function handleAddComment(html: string) {
    if (!initiative || !onAddComment) return;
    setIsAddingComment(true);
    try {
      await onAddComment(initiative.id, html);
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
      setActivityPanelHeightPx(Math.max(180, Math.min(560, next)));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function beginDialogWidthResize(event: React.PointerEvent<HTMLDivElement>) {
    if (anchored || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const fallbackWidth = (window.innerWidth * dialogWidthVw) / 100;
    const startWidth = dialogShellRef.current?.getBoundingClientRect().width ?? fallbackWidth;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      const nextWidth = startWidth - delta;
      const minWidth = Math.min(900, window.innerWidth * 0.55);
      const maxWidth = Math.min(window.innerWidth - 12, 1700);
      const bounded = Math.max(minWidth, Math.min(maxWidth, nextWidth));
      setDialogWidthVw((bounded / window.innerWidth) * 100);
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function beginDialogWidthResizeRight(event: React.PointerEvent<HTMLDivElement>) {
    if (anchored || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const fallbackWidth = (window.innerWidth * dialogWidthVw) / 100;
    const startWidth = dialogShellRef.current?.getBoundingClientRect().width ?? fallbackWidth;
    const startOffsetX = dialogOffset.x;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      const nextWidth = startWidth + delta;
      const minWidth = Math.min(900, window.innerWidth * 0.55);
      const maxWidth = Math.min(window.innerWidth - 12, 1700);
      const bounded = Math.max(minWidth, Math.min(maxWidth, nextWidth));
      setDialogWidthVw((bounded / window.innerWidth) * 100);
      const widthDelta = bounded - startWidth;
      setDialogOffset((prev) => ({ ...prev, x: startOffsetX + widthDelta }));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function beginChildCellEdit(storyId: string, field: "title" | "assignee" | "team" | "originalEstimateDays") {
    const draft = childEpicDrafts[storyId];
    if (!draft) return;
    setChildEditingCell({ rowId: storyId, field });
    setChildEditingValue(draft[field] ?? "");
  }

  async function confirmChildCellEdit(epicId: string) {
    if (!onPatchEpic || !childEditingCell || childEditingCell.rowId !== epicId) return;
    const existing = childEpicDrafts[epicId];
    if (!existing) return;
    const field = childEditingCell.field;
    const next: ChildEpicDraft = { ...existing, [field]: childEditingValue };
    setChildEpicDrafts((prev) => ({ ...prev, [epicId]: next }));
    setChildEditingCell(null);
    setChildEditingValue("");

    const patch: {
      title?: string;
      assignee?: string | null;
      team?: string | null;
      originalEstimateDays?: number | null;
    } = {};
    if (field === "title") {
      patch.title = next.title.trim();
    } else if (field === "assignee") {
      patch.assignee = next.assignee.trim() || null;
    } else if (field === "team") {
      const t = next.team.trim();
      patch.team = t && MONTH_TEAM_IDS.includes(t as (typeof MONTH_TEAM_IDS)[number]) ? t : null;
    } else if (field === "originalEstimateDays") {
      patch.originalEstimateDays =
        next.originalEstimateDays.trim() === "" ? null : Number(next.originalEstimateDays);
    }
    await onPatchEpic(epicId, patch);
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
        ref={dialogShellRef}
        className={cn(
          !leaving ? "epic-dialog-panel-entrance" : "epic-dialog-panel--exit",
          anchored
            ? "fixed flex flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xl ring-1 ring-black/[0.06]"
            : "relative h-full shrink-0",
        )}
        style={
          anchored
            ? (surfaceRect ? planningDetailPanelAnchorStyle(surfaceRect) : undefined)
            : { width: `${dialogWidthVw}vw`, maxWidth: "99.5vw" }
        }
      >
        <div
          className={cn(
            "relative flex h-full min-h-0 w-full flex-col p-5",
            anchored ? "h-full min-h-0 flex-1 shadow-none ring-0" : "h-full min-h-0 rounded-none border-0 bg-white shadow-none",
          )}
          style={{ transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)` }}
        >
          {!anchored ? (
            <div
              className="absolute inset-y-0 left-0 z-20 w-2.5 cursor-col-resize bg-transparent hover:bg-indigo-200/40"
              onPointerDown={beginDialogWidthResize}
              aria-label="Resize initiative panel width"
              role="separator"
            />
          ) : null}
          {!anchored ? (
            <div
              className="absolute inset-y-0 right-0 z-20 w-2.5 cursor-col-resize bg-transparent hover:bg-indigo-200/40"
              onPointerDown={beginDialogWidthResizeRight}
              aria-label="Resize initiative panel width from right"
              role="separator"
            />
          ) : null}
          <div className="mb-4 flex cursor-move items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-4" onPointerDown={beginDialogDrag}>
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
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-base font-medium text-slate-900">
                <Zap className="size-4 shrink-0 text-blue-600" strokeWidth={1.9} aria-hidden />
                <span className="truncate">{title || (initiative ? "Initiative details" : "Create initiative")}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 min-w-[100px] px-4 text-sm font-medium"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 min-w-[100px] gap-1.5 border-0 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : initiative ? "Save" : "Create"}
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close initiative details"><X /></Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              <div ref={splitLayoutRef} className="grid h-full min-h-0 gap-0" style={{ gridTemplateColumns: `minmax(0,1fr) 10px ${detailsPanelWidthPx}px` }}>
              <section className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overflow-x-hidden rounded-xl border-0 bg-white p-4 [scrollbar-gutter:stable]">
                <label className="block shrink-0 space-y-1">
                  <p className="flex shrink-0 items-center gap-2 text-base font-normal text-slate-800">
                    <Type className="size-4 shrink-0 text-slate-500" aria-hidden />
                    Title
                  </p>
                  <div className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-slate-300/70">
                    <input value={icon} onChange={(event) => setIcon(event.target.value)} maxLength={2} placeholder="⚡" className="w-12 border-r border-slate-200 bg-transparent px-2 py-2 text-center text-xl outline-none" />
                    <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full bg-transparent px-3 py-2 text-base outline-none" placeholder="Initiative title" />
                  </div>
                </label>

                <div className="mt-3 grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-md border-0 bg-white py-2.5 shadow-none ring-0">
                  <p className="text-[15px] font-normal text-slate-700">Year</p>
                  <input readOnly value={initiativePlanningYear} className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[14px] text-slate-800" />
                  <p className="text-[15px] font-normal text-slate-700">Quarter</p>
                  <input readOnly value={initiativePlanningQuarter} className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[14px] text-slate-800" />
                  <p className="text-[15px] font-normal text-slate-700">Month</p>
                  <input readOnly value={initiativePlanningMonth} className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[14px] text-slate-800" />
                </div>

                <div className="mt-1 flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    id="initiative-form-description-accordion-trigger"
                    aria-expanded={descriptionAccordionOpen}
                    aria-controls="initiative-form-description-accordion-panel"
                    onClick={() => setDescriptionAccordionOpen((v) => !v)}
                    className="-ml-1 flex w-full shrink-0 items-center gap-2 rounded-md py-1 text-left text-base font-normal text-slate-800 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/60"
                  >
                    {descriptionAccordionOpen ? (
                      <ChevronDown className="size-4 shrink-0 text-slate-500" aria-hidden />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-slate-500" aria-hidden />
                    )}
                    <FileText className="size-4 shrink-0 text-slate-500" aria-hidden />
                    Description
                  </button>
                  <div
                    id="initiative-form-description-accordion-panel"
                    role="region"
                    aria-labelledby="initiative-form-description-accordion-trigger"
                    hidden={!descriptionAccordionOpen}
                    className="flex flex-col gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200"
                  >
                    <div className="flex shrink-0 flex-wrap gap-1 rounded-md bg-[#0897d5] p-1">
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleBold().run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-white", descriptionEditor?.isActive("bold") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20")}><Bold className="size-3.5" /></button>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleItalic().run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-white", descriptionEditor?.isActive("italic") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20")}><Italic className="size-3.5" /></button>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleUnderline().run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-white", descriptionEditor?.isActive("underline") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20")}><UnderlineIcon className="size-3.5" /></button>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleBulletList().run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-white", descriptionEditor?.isActive("bulletList") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20")}><List className="size-3.5" /></button>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleOrderedList().run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-white", descriptionEditor?.isActive("orderedList") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20")}><ListOrdered className="size-3.5" /></button>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleBlockquote().run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-white", descriptionEditor?.isActive("blockquote") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20")}><Quote className="size-3.5" /></button>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleHeading({ level: 2 }).run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-white", descriptionEditor?.isActive("heading", { level: 2 }) ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20")}><Heading2 className="size-3.5" /></button>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => descriptionEditor?.chain().focus().toggleHeading({ level: 3 }).run()} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-white", descriptionEditor?.isActive("heading", { level: 3 }) ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20")}><Heading3 className="size-3.5" /></button>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { const prev = (descriptionEditor?.getAttributes("link").href as string | undefined) ?? ""; const url = window.prompt("Link URL", prev || "https://"); if (!descriptionEditor || url == null) return; const trimmed = url.trim(); if (!trimmed) { descriptionEditor.chain().focus().extendMarkRange("link").unsetLink().run(); return; } descriptionEditor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run(); }} className={cn("inline-flex h-7 w-7 items-center justify-center rounded border text-white", descriptionEditor?.isActive("link") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20")}><LinkIcon className="size-3.5" /></button>
                    </div>
                    <div className="min-h-[10rem] rounded-md px-1 py-2">
                      <EditorContent
                        editor={descriptionEditor}
                        className="focus:outline-none [&_.ProseMirror]:min-h-[10rem] [&_.ProseMirror]:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <section className="mt-5 flex shrink-0 flex-col gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                  <div className="flex shrink-0 items-center justify-between">
                    <h3 className="flex items-center gap-2 text-base font-normal text-slate-800">
                      <ListTree className="size-4 shrink-0 text-slate-500" aria-hidden />
                      Child Epics
                    </h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-sm text-slate-600 ring-1 ring-slate-200">{initiative?.epics?.length ?? 0}</span>
                  </div>

                  {!initiative ? (
                    <p className="shrink-0 rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">Save this initiative first, then add and manage epics here.</p>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {(initiative.epics ?? []).length === 0 ? (
                          <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">No epics yet.</p>
                        ) : (
                          <div className="overflow-x-auto rounded-md bg-white ring-1 ring-slate-200">
                            <table className="w-full table-fixed text-left text-sm">
                              <colgroup>
                                {initChildTableWidths.map((w, i) => (
                                  <col key={i} style={{ width: w }} />
                                ))}
                              </colgroup>
                              <thead className="bg-[#0897d5] text-white">
                                <tr>
                                  <th className="relative px-2 py-1.5 text-left text-[14px] font-semibold" style={{ width: initChildTableWidths[0] }}>
                                    <button
                                      type="button"
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
                                      onClick={() => toggleChildEpicSort("id")}
                                    >
                                      ID
                                      {childEpicSortKey === "id" ? (
                                        childEpicSortDir === "asc" ? (
                                          <ChevronUp className="size-3.5 shrink-0" />
                                        ) : (
                                          <ChevronDown className="size-3.5 shrink-0" />
                                        )
                                      ) : (
                                        <ArrowUpDown className="size-3 shrink-0 opacity-0 transition-opacity group-hover/col-sort:opacity-40" />
                                      )}
                                    </button>
                                    <span
                                      className={CHILD_TABLE_RESIZE_HANDLE}
                                      onPointerDown={(e) => onInitChildTableColResize(0, e)}
                                      aria-hidden
                                    />
                                  </th>
                                  <th className="relative px-2 py-1.5 text-left text-[14px] font-semibold" style={{ width: initChildTableWidths[1] }}>
                                    <button
                                      type="button"
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
                                      onClick={() => toggleChildEpicSort("title")}
                                    >
                                      Epic
                                      {childEpicSortKey === "title" ? (
                                        childEpicSortDir === "asc" ? (
                                          <ChevronUp className="size-3.5 shrink-0" />
                                        ) : (
                                          <ChevronDown className="size-3.5 shrink-0" />
                                        )
                                      ) : (
                                        <ArrowUpDown className="size-3 shrink-0 opacity-0 transition-opacity group-hover/col-sort:opacity-40" />
                                      )}
                                    </button>
                                    <span
                                      className={CHILD_TABLE_RESIZE_HANDLE}
                                      onPointerDown={(e) => onInitChildTableColResize(1, e)}
                                      aria-hidden
                                    />
                                  </th>
                                  <th className="relative px-2 py-1.5 text-left text-[14px] font-semibold" style={{ width: initChildTableWidths[2] }}>
                                    <button
                                      type="button"
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
                                      onClick={() => toggleChildEpicSort("team")}
                                    >
                                      Team
                                      {childEpicSortKey === "team" ? (
                                        childEpicSortDir === "asc" ? (
                                          <ChevronUp className="size-3.5 shrink-0" />
                                        ) : (
                                          <ChevronDown className="size-3.5 shrink-0" />
                                        )
                                      ) : (
                                        <ArrowUpDown className="size-3 shrink-0 opacity-0 transition-opacity group-hover/col-sort:opacity-40" />
                                      )}
                                    </button>
                                    <span
                                      className={CHILD_TABLE_RESIZE_HANDLE}
                                      onPointerDown={(e) => onInitChildTableColResize(2, e)}
                                      aria-hidden
                                    />
                                  </th>
                                  <th className="relative px-2 py-1.5 text-left text-[14px] font-semibold" style={{ width: initChildTableWidths[3] }}>
                                    <button
                                      type="button"
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
                                      onClick={() => toggleChildEpicSort("assignee")}
                                    >
                                      Assignee
                                      {childEpicSortKey === "assignee" ? (
                                        childEpicSortDir === "asc" ? (
                                          <ChevronUp className="size-3.5 shrink-0" />
                                        ) : (
                                          <ChevronDown className="size-3.5 shrink-0" />
                                        )
                                      ) : (
                                        <ArrowUpDown className="size-3 shrink-0 opacity-0 transition-opacity group-hover/col-sort:opacity-40" />
                                      )}
                                    </button>
                                    <span
                                      className={CHILD_TABLE_RESIZE_HANDLE}
                                      onPointerDown={(e) => onInitChildTableColResize(3, e)}
                                      aria-hidden
                                    />
                                  </th>
                                  <th className="relative px-2 py-1.5 text-left text-[14px] font-semibold" style={{ width: initChildTableWidths[4] }}>
                                    <button
                                      type="button"
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
                                      onClick={() => toggleChildEpicSort("originalEstimateDays")}
                                    >
                                      Days Est
                                      {childEpicSortKey === "originalEstimateDays" ? (
                                        childEpicSortDir === "asc" ? (
                                          <ChevronUp className="size-3.5 shrink-0" />
                                        ) : (
                                          <ChevronDown className="size-3.5 shrink-0" />
                                        )
                                      ) : (
                                        <ArrowUpDown className="size-3 shrink-0 opacity-0 transition-opacity group-hover/col-sort:opacity-40" />
                                      )}
                                    </button>
                                    <span
                                      className={CHILD_TABLE_RESIZE_HANDLE}
                                      onPointerDown={(e) => onInitChildTableColResize(4, e)}
                                      aria-hidden
                                    />
                                  </th>
                                  <th
                                    className="relative px-2 py-1.5 text-left text-[14px] font-semibold"
                                    style={{ width: initChildTableWidths[5] }}
                                    title="Sum of estimated days from all user stories under this epic"
                                  >
                                    <button
                                      type="button"
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
                                      onClick={() => toggleChildEpicSort("childSum")}
                                    >
                                      Σ Child Est.
                                      {childEpicSortKey === "childSum" ? (
                                        childEpicSortDir === "asc" ? (
                                          <ChevronUp className="size-3.5 shrink-0" />
                                        ) : (
                                          <ChevronDown className="size-3.5 shrink-0" />
                                        )
                                      ) : (
                                        <ArrowUpDown className="size-3 shrink-0 opacity-0 transition-opacity group-hover/col-sort:opacity-40" />
                                      )}
                                    </button>
                                    <span
                                      className={CHILD_TABLE_RESIZE_HANDLE}
                                      onPointerDown={(e) => onInitChildTableColResize(5, e)}
                                      aria-hidden
                                    />
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-t border-[#7cd3f7]/95 bg-white">
                                  <td className="px-2 py-1.5 text-slate-400">-</td>
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
                                {sortedInitiativeChildEpics.map((row, rowIndex) => (
                                  <tr
                                    key={row.id}
                                    className={cn(
                                      "border-t border-[#7cd3f7]/95 text-slate-700 transition hover:bg-[#c5ebff]",
                                      rowIndex % 2 === 0 ? "bg-white" : "bg-[#d8f2ff]",
                                    )}
                                  >
                                    <td className="px-2 py-1.5 text-slate-600"><button type="button" onClick={() => onOpenEpic?.(row.id)} className="rounded px-1 py-0.5 text-blue-700 hover:bg-blue-50 hover:underline">{displayIds.byEpicId.get(row.id) ?? row.id}</button></td>
                                    <td className="px-2 py-1.5 text-slate-800">{childEditingCell?.rowId === row.id && childEditingCell.field === "title" ? <div className="relative z-20 flex items-center gap-1"><input value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-800" /><button type="button" onClick={() => void confirmChildCellEdit(row.id)} className="rounded bg-white p-1 text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50"><Check className="size-3.5" /></button><button type="button" onClick={() => setChildEditingCell(null)} className="rounded bg-white p-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"><X className="size-3.5" /></button></div> : <button type="button" onClick={() => beginChildCellEdit(row.id, "title")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">{childEpicDrafts[row.id]?.title ?? row.title}</button>}</td>
                                    <td className="px-2 py-1.5 text-slate-600">
                                      {childEditingCell?.rowId === row.id && childEditingCell.field === "team" ? (
                                        <div className="relative z-20 flex items-center gap-1">
                                          <select
                                            value={childEditingValue}
                                            onChange={(event) => setChildEditingValue(event.target.value)}
                                            className="min-w-[7.5rem] flex-1 rounded-md border bg-white px-2 py-1 text-xs text-slate-700"
                                          >
                                            <option value="">Not set</option>
                                            {MONTH_TEAM_COLUMNS.map((t) => (
                                              <option key={t.id} value={t.id}>
                                                {t.label}
                                              </option>
                                            ))}
                                          </select>
                                          <button
                                            type="button"
                                            onClick={() => void confirmChildCellEdit(row.id)}
                                            className="shrink-0 rounded bg-white p-1 text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50"
                                          >
                                            <Check className="size-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setChildEditingCell(null)}
                                            className="shrink-0 rounded bg-white p-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"
                                          >
                                            <X className="size-3.5" />
                                          </button>
                                        </div>
                                      ) : (
                                        <button type="button" onClick={() => beginChildCellEdit(row.id, "team")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                          {MONTH_TEAM_COLUMNS.find((t) => t.id === (childEpicDrafts[row.id]?.team ?? row.team))?.label ?? (childEpicDrafts[row.id]?.team ?? row.team) ?? "Not set"}
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-slate-600">
                                      {childEditingCell?.rowId === row.id && childEditingCell.field === "assignee" ? (
                                        <div className="relative z-20 flex min-w-0 items-center gap-1">
                                          <AssigneeCombobox
                                            value={childEditingValue}
                                            onChange={setChildEditingValue}
                                            suggestions={assigneeNameSuggestions}
                                            placeholder="Assignee"
                                            className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-xs text-slate-700"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => void confirmChildCellEdit(row.id)}
                                            className="shrink-0 rounded bg-white p-1 text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50"
                                          >
                                            <Check className="size-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setChildEditingCell(null)}
                                            className="shrink-0 rounded bg-white p-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"
                                          >
                                            <X className="size-3.5" />
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => beginChildCellEdit(row.id, "assignee")}
                                          className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100"
                                        >
                                          {(childEpicDrafts[row.id]?.assignee ?? row.assignee)?.trim() || "Unassigned"}
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-slate-600">{childEditingCell?.rowId === row.id && childEditingCell.field === "originalEstimateDays" ? <div className="relative z-20 flex items-center gap-1"><input type="number" min={0} value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-[4.5rem] rounded-md border bg-white px-2 py-1 text-xs text-slate-700" /><button type="button" onClick={() => void confirmChildCellEdit(row.id)} className="rounded bg-white p-1 text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50"><Check className="size-3.5" /></button><button type="button" onClick={() => setChildEditingCell(null)} className="rounded bg-white p-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"><X className="size-3.5" /></button></div> : <button type="button" onClick={() => beginChildCellEdit(row.id, "originalEstimateDays")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">{childEpicDrafts[row.id]?.originalEstimateDays || (row.originalEstimateDays == null ? "-" : String(row.originalEstimateDays))}</button>}</td>
                                    <td className="px-2 py-1.5 text-slate-600 tabular-nums" title="Sum of estimated days from child user stories">
                                      {sumUserStoryEstDaysForEpic(row)}
                                    </td>
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
                <div className="group absolute inset-y-0 left-1/2 flex w-3 -translate-x-[calc(50%+2px)] cursor-col-resize items-stretch justify-center" onPointerDown={beginDetailsPanelResize} title="Resize details panel" aria-label="Resize details panel" role="separator">
                  <div className="h-full w-px bg-slate-300 transition group-hover:bg-slate-500" />
                  <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-[calc(50%+2px)]" />
                </div>
              </div>

              <section className="relative z-20 h-full min-h-0 space-y-5 overflow-y-auto rounded-xl bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                <h3 className="flex items-center gap-2 border-b border-slate-200/90 pb-2 text-lg font-normal leading-snug tracking-tight text-slate-900">
                  <ClipboardList className="size-4 shrink-0 text-slate-500" aria-hidden />
                  Details
                </h3>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Assignee</p>
                  <div className="relative flex min-w-0 w-full items-center">
                    <UserRound className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                    <AssigneeCombobox
                      value={assignee}
                      onChange={setAssignee}
                      suggestions={assigneeNameSuggestions}
                      placeholder="Type or pick a name"
                      className={cn("h-7 w-full rounded-md border border-slate-300 bg-white pl-7 text-[14px] text-slate-800", assignee ? "pr-6" : "pr-1.5")}
                    />
                    {assignee ? (
                      <button
                        type="button"
                        onClick={() => setAssignee("")}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:text-slate-600"
                        aria-label="Clear assignee"
                        tabIndex={-1}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </label>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3"><p className="text-[15px] font-normal text-slate-700">Color</p><input type="color" className="h-7 w-full rounded-md border border-slate-300 bg-white px-1.5" value={color} onChange={(event) => setColor(event.target.value)} /></label>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3"><div className="inline-flex items-center gap-1"><p className="text-[15px] font-normal text-slate-700">Σ Child Est.</p><span className="group relative inline-flex items-center"><Info className="size-3.5 text-slate-400" aria-label="Roll-up of child estimates across all epics and user stories" /><span role="tooltip" className={infoTooltipClass}>Total estimated days from all user stories across every child epic in this initiative.</span></span></div><input value={totalUserStoryEstimate} readOnly className="h-6 w-full rounded-md border border-slate-300 bg-slate-100 px-1.5 text-[14px] font-medium text-slate-700" /></label>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Labels</p>
                  <div className="relative z-30">
                    <div className="flex min-h-6 flex-wrap items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-0.5">
                      {labelsDraft.map((label) => (
                        <span key={label} className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-700">
                          <Tag className="size-2.5 shrink-0" />
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

          <div className="relative z-0 mt-3 shrink-0">
            {activityOpen ? (
              <div className="group relative mb-1 flex h-3 cursor-row-resize items-center justify-center" onPointerDown={beginActivityPanelResize} title="Resize activity panel height" aria-label="Resize activity panel height" role="separator">
                <div className="h-px w-full bg-slate-300 transition group-hover:bg-slate-500" />
                <div className="absolute left-0 top-1/2 h-3 w-full -translate-y-1/2" />
              </div>
            ) : null}
            <section
              className={cn(
                "flex min-h-0 flex-col rounded-xl bg-white",
                activityOpen ? "space-y-3 p-3" : "p-3",
              )}
              style={
                activityOpen
                  ? { height: `${hasChildren ? Math.max(180, Math.min(440, activityPanelHeightPx - 40)) : activityPanelHeightPx}px` }
                  : undefined
              }
            >
              <button
                type="button"
                className="group flex w-full items-center justify-between gap-2 rounded-lg text-left outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-slate-400"
                onClick={() => {
                  setActivityOpen((wasOpen) => {
                    if (!wasOpen) {
                      setActivityPanelHeightPx((h) => Math.min(560, h + 96));
                    }
                    return !wasOpen;
                  });
                }}
                aria-expanded={activityOpen}
              >
                <span className="flex items-center gap-2 text-base font-normal text-slate-800 transition-colors group-hover:text-indigo-600">
                  <ChevronDown
                    className={cn("size-4 shrink-0 text-slate-500 transition-transform", !activityOpen && "-rotate-90")}
                    aria-hidden
                  />
                  <ActivityIcon className="size-4 shrink-0 text-slate-500" aria-hidden />
                  Activity
                </span>
                {activityOpen ? (
                  <div
                    className="inline-flex shrink-0 rounded-lg bg-white p-1 ring-1 ring-slate-200"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    role="presentation"
                  >
                    <button type="button" className={cn("rounded-md px-2.5 py-1 text-sm font-medium transition", activityTab === "comments" ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200" : "text-slate-600 hover:bg-slate-100")} onClick={() => setActivityTab("comments")}><MessageSquare className="mr-1 inline size-3.5" />Comments</button>
                    <button type="button" className={cn("rounded-md px-2.5 py-1 text-sm font-medium transition", activityTab === "history" ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200" : "text-slate-600 hover:bg-slate-100")} onClick={() => setActivityTab("history")}><History className="mr-1 inline size-3.5" />History</button>
                  </div>
                ) : null}
              </button>

              {activityOpen ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {!initiative ? (
                    <p className="text-sm text-slate-500">Save this initiative first to add comments and history.</p>
                  ) : activityTab === "comments" ? (
                    <>
                      <div className="space-y-2">
                        {(initiative.comments ?? []).length === 0 ? <p className="text-sm text-slate-500">No comments yet.</p> : initiative.comments.map((comment) => (
                          <div
                            key={comment.id}
                            className="rounded-md bg-white p-2 text-sm ring-1 ring-slate-200"
                          >
                            <p className="text-[12px] text-slate-500">{comment.author ?? "Planner"} - {new Date(comment.createdAt).toLocaleString()}</p>
                            <RichCommentBody body={comment.body} className="mt-1" />
                          </div>
                        ))}
                      </div>
                      <ActivityCommentComposer
                        key={`${open}-${initiative.id}-comment`}
                        onSubmit={(html) => handleAddComment(html)}
                        disabled={isAddingComment}
                      />
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
              ) : null}
            </section>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
