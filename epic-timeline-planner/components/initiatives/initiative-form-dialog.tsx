"use client";

import {
  Activity as ActivityIcon,
  ArrowUpDown,
  Bold,
  CalendarDays,
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
  Map as MapIcon,
  MessageSquare,
  Quote,
  Tag,
  Trash2,
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
import { AssigneeFieldDecoration } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { RichCommentBody } from "@/components/ui/rich-comment-body";
import { InitiativePlanBarIcon } from "@/components/timeline/epic-plan-bar";
import { collectAssigneeNameSuggestions } from "@/lib/delivery-assignees";
import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";
import { type EpicItem, InitiativeItem, type RoadmapItem } from "@/lib/types";
import { useDialogPresence } from "@/lib/use-dialog-presence";
import { planningDetailPanelAnchorStyle, usePlanningSurfaceRect } from "@/lib/use-planning-surface-rect";
import { useResizableTableColumns } from "@/lib/use-resizable-table-columns";
import { cn } from "@/lib/utils";

function sumUserStoryEstDaysForEpic(epic: EpicItem): number {
  return (epic.userStories ?? []).reduce((sum, story) => sum + (story.estimatedDays ?? 0), 0);
}

function formatShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
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

/** Curated, gantt-friendly palette — even brightness, good legibility against white panels. */
const SUGGESTED_INITIATIVE_COLORS: ReadonlyArray<{ hex: string; label: string }> = [
  { hex: "#6366f1", label: "Indigo" },
  { hex: "#8b5cf6", label: "Violet" },
  { hex: "#a855f7", label: "Purple" },
  { hex: "#d946ef", label: "Fuchsia" },
  { hex: "#ec4899", label: "Pink" },
  { hex: "#f43f5e", label: "Rose" },
  { hex: "#ef4444", label: "Red" },
  { hex: "#f97316", label: "Orange" },
  { hex: "#f59e0b", label: "Amber" },
  { hex: "#84cc16", label: "Lime" },
  { hex: "#22c55e", label: "Green" },
  { hex: "#10b981", label: "Emerald" },
  { hex: "#14b8a6", label: "Teal" },
  { hex: "#06b6d4", label: "Cyan" },
  { hex: "#0ea5e9", label: "Sky" },
  { hex: "#3b82f6", label: "Blue" },
  { hex: "#64748b", label: "Slate" },
  { hex: "#475569", label: "Charcoal" },
];

function normalizeHex(value: string): string {
  const v = value.trim().toLowerCase();
  return v.startsWith("#") ? v : `#${v}`;
}

function InitiativeColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const normalized = normalizeHex(value);
  const matched = SUGGESTED_INITIATIVE_COLORS.find((c) => c.hex.toLowerCase() === normalized);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nativePickerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5 text-left text-[13px] shadow-sm transition-all",
          open ? "border-violet-400 ring-2 ring-violet-100" : "border-slate-300 hover:border-slate-400",
        )}
      >
        <span
          className="inline-block size-4 shrink-0 rounded-md ring-1 ring-slate-300"
          style={{ backgroundColor: normalized }}
          aria-hidden
        />
        <span className="flex-1 truncate font-medium text-slate-700">{matched ? matched.label : "Custom"}</span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">{normalized}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Initiative color"
          className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-black/5"
        >
          {SUGGESTED_INITIATIVE_COLORS.map((c) => {
            const isActive = c.hex.toLowerCase() === normalized;
            return (
              <button
                key={c.hex}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => { onChange(c.hex); setOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                  isActive ? "bg-violet-50 text-violet-700" : "text-slate-700 hover:bg-slate-50",
                )}
              >
                <span
                  className="inline-block size-4 shrink-0 rounded-md ring-1 ring-slate-300"
                  style={{ backgroundColor: c.hex }}
                  aria-hidden
                />
                <span className="flex-1 truncate font-medium">{c.label}</span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">{c.hex}</span>
                {isActive && <Check className="size-3.5 shrink-0 text-violet-600" />}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => nativePickerRef.current?.click()}
            className="mt-1 flex w-full items-center gap-2.5 rounded-md border-t border-slate-100 px-2 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50"
          >
            <span className="inline-block size-4 shrink-0 rounded-md bg-gradient-to-br from-rose-400 via-amber-400 to-sky-400 ring-1 ring-slate-300" aria-hidden />
            <span className="flex-1 font-medium">Custom…</span>
          </button>
          <input
            ref={nativePickerRef}
            type="color"
            value={normalized}
            onChange={(e) => onChange(e.target.value)}
            className="pointer-events-none absolute h-0 w-0 opacity-0"
            aria-label="Pick any color"
            tabIndex={-1}
          />
        </div>
      )}
    </div>
  );
}

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
  onDelete?: (id: string) => void;
  onOpenEpic?: (epicId: string) => void;
  onRequestCreateEpic?: (initiativeId: string) => void;
  /** Inline-create: posts a new child epic directly under the initiative
   * without opening the epic popup. Called by the Add button next to the
   * child row's title input. */
  onCreateChildEpicQuick?: (initiativeId: string, title: string) => Promise<void>;
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
  /** If provided, the BarChart3 header button switches the in-app view to
   * the insights surface (scoped to this initiative) and closes the dialog,
   * instead of opening /epic-insights in a new tab. */
  onOpenInsights?: (kind: "epic" | "initiative", id: string) => void;
  onExitComplete?: () => void;
  surfaceAnchorRef?: RefObject<HTMLElement | null>;
  roadmaps?: RoadmapItem[];
  selectedRoadmapId?: string;
  onChangeRoadmap?: (roadmapId: string) => void;
  onCreateRoadmap?: (name: string) => Promise<string | null>;
  /** Workspace directory — used by AssigneeCombobox to render user photos
   *  next to suggestions when the assignee matches a directory entry. */
  workspaceDirectoryUsers?: readonly { name: string; image?: string | null }[];
};

export function InitiativeFormDialog({
  open,
  initiatives,
  initiative,
  onClose,
  onExitComplete,
  onSubmit,
  onDelete,
  onOpenEpic,
  onRequestCreateEpic,
  onCreateChildEpicQuick,
  onPatchEpic,
  onAddComment,
  onOpenInsights,
  surfaceAnchorRef,
  roadmaps = [],
  selectedRoadmapId,
  onChangeRoadmap,
  onCreateRoadmap,
  workspaceDirectoryUsers,
}: InitiativeFormDialogProps) {
  const [title, setTitle] = useState(initiative?.title ?? "");
  const [icon, setIcon] = useState(initiative?.icon === "🎯" ? "" : (initiative?.icon ?? ""));
  const [description, setDescription] = useState(initiative?.description ?? "");
  const [assignee, setAssignee] = useState(initiative?.assignee ?? "");
  const [color, setColor] = useState(initiative?.color ?? "#3B82F6");
  const [formRoadmapId, setFormRoadmapId] = useState(initiative?.roadmapId ?? selectedRoadmapId ?? "");
  const [roadmapQuery, setRoadmapQuery] = useState("");
  const [roadmapDropdownOpen, setRoadmapDropdownOpen] = useState(false);
  const [roadmapHighlightIdx, setRoadmapHighlightIdx] = useState(0);
  const [roadmapCreating, setRoadmapCreating] = useState(false);
  const roadmapInputRef = useRef<HTMLInputElement>(null);
  const roadmapDropdownRef = useRef<HTMLDivElement>(null);
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [activityOpen, setActivityOpen] = useState(true);
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
  const [detailsPanelWidthPx, setDetailsPanelWidthPx] = useState(380);
  const [activityPanelHeightPx, setActivityPanelHeightPx] = useState(360);
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
    setFormRoadmapId(initiative?.roadmapId ?? selectedRoadmapId ?? "");
    setRoadmapQuery("");
    setRoadmapDropdownOpen(false);
    setActivityTab("comments");
    setActivityOpen(true);
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
      setDetailsPanelWidthPx(380);
      setActivityPanelHeightPx(360);
      setActivityOpen(true);
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
    // After the user's column sort, hoist the most-recently-created epic to
    // the top so a freshly-added child appears in the first data row.
    if (list.length > 1) {
      let newestIdx = 0;
      let newestStamp = new Date(list[0].createdAt as string).getTime();
      for (let i = 1; i < list.length; i++) {
        const t = new Date(list[i].createdAt as string).getTime();
        if (t > newestStamp) {
          newestIdx = i;
          newestStamp = t;
        }
      }
      if (newestIdx !== 0) {
        const [newest] = list.splice(newestIdx, 1);
        list.unshift(newest);
      }
    }
    return list;
  }, [initiative?.epics, childEpicSortKey, childEpicSortDir, childEpicDrafts, displayIds]);

  const hasChildren = (initiative?.epics?.length ?? 0) > 0;

  // Initiative timeline is read-only — derived from child epics' actual
  // start/end dates: earliest start across all epics, latest end across all
  // epics. Returned as ISO date strings (YYYY-MM-DD) so an `<input type="date">`
  // can display them; empty string when no child is scheduled yet.
  const initiativeTimelineStart = useMemo(() => {
    const year = initiative?.year ?? new Date().getFullYear();
    const stamps = (initiative?.epics ?? [])
      .filter((e): e is typeof e & { planStartMonth: number } =>
        typeof e.planStartMonth === "number" && e.planStartMonth >= 1 && e.planStartMonth <= 12,
      )
      .map((e) => {
        const day = e.planStartDay ?? 1;
        return { month: e.planStartMonth, day, stamp: e.planStartMonth * 100 + day };
      });
    if (stamps.length === 0) return "";
    const min = stamps.reduce((a, b) => (b.stamp < a.stamp ? b : a));
    const mm = String(min.month).padStart(2, "0");
    const dd = String(min.day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }, [initiative?.epics, initiative?.year]);
  const initiativeTimelineEnd = useMemo(() => {
    const year = initiative?.year ?? new Date().getFullYear();
    const stamps = (initiative?.epics ?? [])
      .filter((e) =>
        typeof e.planEndMonth === "number" && e.planEndMonth >= 1 && e.planEndMonth <= 12,
      )
      .map((e) => {
        const month = e.planEndMonth as number;
        const day = e.planEndDay ?? new Date(year, month, 0).getDate();
        return { month, day, stamp: month * 100 + day };
      });
    if (stamps.length === 0) return "";
    const max = stamps.reduce((a, b) => (b.stamp > a.stamp ? b : a));
    const mm = String(max.month).padStart(2, "0");
    const dd = String(max.day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }, [initiative?.epics, initiative?.year]);
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
  // Same look as `infoTooltipClass` but anchored *below* the trigger — for
  // header-row buttons (Insights / Delete) where the default above-anchored
  // tooltip gets clipped by the dialog's top edge.
  const belowTooltipClass =
    "pointer-events-none absolute left-1/2 top-full z-[320] mt-2 w-48 max-w-[calc(100vw-3rem)] -translate-x-1/2 whitespace-normal rounded-lg border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/40 px-2.5 py-1.5 text-[12px] font-medium leading-snug text-slate-700 opacity-0 shadow-md ring-1 ring-indigo-100/70 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100";

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

  /**
   * Opens the insights view in a new tab, scoped to this initiative — mirrors
   * the BarChart3 button in the epic dialog. The `/epic-insights` route picks
   * up `initiativeId` and defaults the Epic / Initiative Scope dropdown to
   * this initiative.
   */
  function openInsightsWindow() {
    if (!initiative) return;
    // Preferred: in-app navigation (parent switches view + closes dialog).
    if (onOpenInsights) {
      onOpenInsights("initiative", initiative.id);
      onClose();
      return;
    }
    // Fallback: open the standalone /epic-insights page in a new tab.
    const params = new URLSearchParams();
    params.set("initiativeId", initiative.id);
    const cur = new URLSearchParams(window.location.search);
    for (const key of ["month", "planTab", "sprint"] as const) {
      const v = cur.get(key);
      if (v) params.set(key, v);
    }
    params.set("sprintView", "epic-insights");
    window.open(`/epic-insights?${params.toString()}`, "_blank");
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

  async function handleAddChildEpic() {
    const title = newChildEpicTitle.trim();
    if (!initiative || !title) return;
    // Prefer inline-create when wired; fall back to legacy popup flow.
    if (onCreateChildEpicQuick) {
      await onCreateChildEpicQuick(initiative.id, title);
      setNewChildEpicTitle("");
    } else if (onRequestCreateEpic) {
      onRequestCreateEpic(initiative.id);
    }
  }

  if (!visible) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[70] bg-slate-900/30 backdrop-blur-[1px]",
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
              <span className="inline-flex min-w-0 items-center gap-1 truncate rounded px-1 py-0.5 text-blue-700 underline decoration-blue-300 underline-offset-2">
                {initiative ? (displayIds.byInitiativeId.get(initiative.id) ?? "Initiative") : "Initiative"}
              </span>
              <ChevronRight className="size-4 shrink-0 text-slate-400" />
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-base font-medium text-slate-900">
                <InitiativePlanBarIcon icon={icon} className="mr-0 [&_svg]:size-4 [&_svg]:text-blue-600" />
                <span className="truncate">{title || (initiative ? "Initiative details" : "Create initiative")}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              {initiative ? (
                <span className="group relative inline-flex">
                  <button
                    type="button"
                    onClick={openInsightsWindow}
                    aria-label="Open initiative insights"
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-indigo-200 px-4 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-50 transition-colors"
                  >
                    <img
                      src="/dialog-insights-icon.png"
                      alt=""
                      aria-hidden
                      className="size-4 select-none object-contain"
                      draggable={false}
                    />
                    Insights
                  </button>
                  <span role="tooltip" className={belowTooltipClass}>
                    Open the insights view scoped to this initiative — see scope burnup, sprint progress, and team workload across all child epics.
                  </span>
                </span>
              ) : null}
              {initiative && onDelete && (
                <span className="group relative inline-flex">
                  <button
                    type="button"
                    onClick={() => { onDelete(initiative.id); onClose(); }}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-red-200 px-4 text-[13px] font-semibold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </button>
                  <span role="tooltip" className={belowTooltipClass}>
                    Permanently delete this initiative and every child epic and user story under it. This cannot be undone.
                  </span>
                </span>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="inline-flex h-8 items-center gap-2 rounded-md px-4 text-[13px] font-semibold [&_svg]:text-slate-500"
                onClick={onClose}
              >
                <X className="size-4" />
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="inline-flex h-8 items-center gap-2 rounded-md border-0 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-[13px] font-semibold text-white hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 [&_svg]:text-white"
                onClick={handleSave}
                disabled={isSaving}
              >
                <Check className="size-4" />
                {isSaving ? "Saving..." : initiative ? "Save" : "Create"}
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              <div ref={splitLayoutRef} className="grid shrink-0 items-stretch gap-0" style={{ gridTemplateColumns: `minmax(0,1fr) 10px ${detailsPanelWidthPx}px` }}>
              <section className="flex h-full flex-col gap-3 overflow-x-hidden rounded-xl border-0 bg-white py-3 pl-[5px] pr-0 [scrollbar-gutter:stable]">
                <label className="block shrink-0 space-y-1">
                  <p className="flex shrink-0 items-center gap-2 text-lg font-semibold text-slate-800">
                    <Type className="size-5 shrink-0 text-slate-500" aria-hidden />
                    Title
                  </p>
                  <div className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 shadow-sm focus-within:ring-2 focus-within:ring-slate-300/70">
                    <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full bg-transparent px-3 py-2 text-base outline-none" placeholder="Initiative title" />
                  </div>
                </label>

                <div className="mt-4 flex flex-1 flex-col gap-1">
                  <h3 className="flex shrink-0 items-center gap-2 py-1 text-lg font-semibold text-slate-800">
                    <FileText className="size-5 shrink-0 text-slate-500" aria-hidden />
                    Description
                  </h3>
                  <div className="flex flex-1 flex-col gap-2 rounded-xl bg-white p-3 shadow-[0_2px_8px_-2px_rgba(15,23,42,0.12)] ring-1 ring-slate-200 transition-all hover:ring-indigo-300 hover:shadow-[0_2px_12px_-2px_rgba(99,102,241,0.18)]">
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
                    <div className="min-h-[10rem] flex-1 rounded-md px-1 py-2">
                      <EditorContent
                        editor={descriptionEditor}
                        className="focus:outline-none [&_.ProseMirror]:min-h-[10rem] [&_.ProseMirror]:outline-none"
                      />
                    </div>
                  </div>
                </div>

              </section>

              <div className="relative mx-1.5">
                <div className="group absolute inset-y-0 left-1/2 flex w-3 -translate-x-[calc(50%+2px)] cursor-col-resize items-stretch justify-center" onPointerDown={beginDetailsPanelResize} title="Resize details panel" aria-label="Resize details panel" role="separator">
                  <div className="self-start h-[calc(80%+70px)] w-px bg-slate-300 transition group-hover:bg-slate-500" />
                  <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-[calc(50%+2px)]" />
                </div>
              </div>

              <section className="relative z-20 h-full space-y-5 rounded-xl bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                <h3 className="flex items-center gap-2 text-lg font-semibold leading-snug tracking-tight text-slate-800">
                  <ClipboardList className="size-5 shrink-0 text-slate-500" aria-hidden />
                  Details
                </h3>
                <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Color</p>
                  <InitiativeColorPicker value={color} onChange={setColor} />
                </div>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3"><div className="inline-flex items-center gap-1"><p className="text-[15px] font-normal text-slate-700">Σ Child Est.</p><span className="group relative inline-flex items-center"><Info className="size-3.5 text-slate-400" aria-label="Roll-up of child estimates across all epics and user stories" /><span role="tooltip" className={infoTooltipClass}>Total estimated days from all user stories across every child epic in this initiative.</span></span></div><input value={totalUserStoryEstimate} readOnly className="h-6 w-full cursor-not-allowed rounded-md border border-slate-300 bg-slate-100 px-1.5 text-[14px] font-medium text-slate-500 shadow-sm" /></label>
                <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <div className="inline-flex items-center gap-1">
                    <p className="text-[15px] font-normal text-slate-700">Timeline</p>
                    <span className="group relative inline-flex items-center">
                      <Info
                        className="size-3.5 text-slate-400"
                        aria-label="Timeline is derived from child epic dates"
                      />
                      <span role="tooltip" className={infoTooltipClass}>
                        Derived from child epic dates: start = earliest epic
                        start, end = latest epic end. Set epic dates on the
                        Gantt to update this range.
                      </span>
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div
                      className="inline-flex h-8 w-full cursor-not-allowed items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 pl-2.5 pr-2 text-[13px] text-slate-600 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.55)]"
                      aria-label="Earliest start across epics"
                      title="Earliest start date across the initiative's epics"
                    >
                      <CalendarDays className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                      <span className={formatShortDate(initiativeTimelineStart) ? "text-slate-600" : "text-slate-400"}>
                        {formatShortDate(initiativeTimelineStart) || "Start"}
                      </span>
                    </div>
                    <div
                      className="inline-flex h-8 w-full cursor-not-allowed items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 pl-2.5 pr-2 text-[13px] text-slate-600 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.55)]"
                      aria-label="Latest end across epics"
                      title="Latest end date across the initiative's epics"
                    >
                      <CalendarDays className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                      <span className={formatShortDate(initiativeTimelineEnd) ? "text-slate-600" : "text-slate-400"}>
                        {formatShortDate(initiativeTimelineEnd) || "End"}
                      </span>
                    </div>
                  </div>
                </div>
                {(() => {
                  const selectedRoadmap = roadmaps.find((r) => r.id === formRoadmapId);
                  const q = roadmapQuery.trim().toLowerCase();
                  const filteredRoadmaps = q
                    ? roadmaps.filter((r) => r.name.toLowerCase().includes(q))
                    : roadmaps;
                  const createLabel = roadmapQuery.trim() ? `Create "${roadmapQuery.trim()}"` : "Create new roadmap";
                  const allOptions = [{ id: "__create__", name: createLabel }, ...filteredRoadmaps];
                  return (
                    <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-start gap-3">
                      <p className="mt-1.5 text-[15px] font-normal text-slate-700">Roadmap</p>
                      <div className="relative">
                        <div className="flex h-7 items-center overflow-hidden rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.08)] focus-within:ring-2 focus-within:ring-blue-400/40">
                          <MapIcon className="ml-2 size-3.5 shrink-0 text-slate-400" aria-hidden />
                          <input
                            ref={roadmapInputRef}
                            value={roadmapDropdownOpen ? roadmapQuery : (selectedRoadmap?.name ?? "")}
                            onChange={(e) => {
                              setRoadmapQuery(e.target.value);
                              setRoadmapHighlightIdx(0);
                            }}
                            onFocus={() => {
                              setRoadmapQuery("");
                              setRoadmapDropdownOpen(true);
                              setRoadmapHighlightIdx(0);
                            }}
                            onBlur={() => {
                              window.setTimeout(() => {
                                setRoadmapDropdownOpen(false);
                                setRoadmapQuery("");
                              }, 150);
                            }}
                            onKeyDown={(e) => {
                              if (!roadmapDropdownOpen) return;
                              if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setRoadmapHighlightIdx((i) => Math.min(i + 1, allOptions.length - 1));
                              } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setRoadmapHighlightIdx((i) => Math.max(i - 1, 0));
                              } else if (e.key === "Enter") {
                                e.preventDefault();
                                const opt = allOptions[roadmapHighlightIdx];
                                if (!opt) return;
                                if (opt.id === "__create__") {
                                  const name = roadmapQuery.trim() || "New Roadmap";
                                  setRoadmapCreating(true);
                                  onCreateRoadmap?.(name).then((newId) => {
                                    if (newId) { setFormRoadmapId(newId); onChangeRoadmap?.(newId); }
                                  }).finally(() => setRoadmapCreating(false));
                                } else {
                                  setFormRoadmapId(opt.id);
                                  onChangeRoadmap?.(opt.id);
                                }
                                setRoadmapDropdownOpen(false);
                                setRoadmapQuery("");
                              } else if (e.key === "Escape") {
                                setRoadmapDropdownOpen(false);
                                setRoadmapQuery("");
                              }
                            }}
                            placeholder="Search roadmaps…"
                            autoComplete="off"
                            className="h-full min-w-0 flex-1 bg-transparent px-2 text-[14px] text-slate-800 outline-none"
                          />
                          {roadmapCreating ? (
                            <span className="mr-2 text-[11px] text-slate-400">Creating…</span>
                          ) : (
                            <ChevronDown className="mr-2 size-3.5 shrink-0 text-slate-400" aria-hidden />
                          )}
                        </div>
                        {roadmapDropdownOpen && (
                          <div
                            ref={roadmapDropdownRef}
                            className="absolute left-0 right-0 top-full z-[200] mt-1 max-h-52 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
                          >
                            {allOptions.map((opt, i) => (
                              <button
                                key={opt.id}
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]",
                                  opt.id === "__create__"
                                    ? "font-medium text-blue-700 hover:bg-blue-50"
                                    : "text-slate-800 hover:bg-slate-50",
                                  i === roadmapHighlightIdx &&
                                    (opt.id === "__create__" ? "bg-blue-50" : "bg-slate-50"),
                                  opt.id === formRoadmapId && opt.id !== "__create__" && "font-medium text-indigo-700",
                                )}
                                onMouseEnter={() => setRoadmapHighlightIdx(i)}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  if (opt.id === "__create__") {
                                    const name = roadmapQuery.trim() || "New Roadmap";
                                    setRoadmapCreating(true);
                                    onCreateRoadmap?.(name).then((newId) => {
                                      if (newId) { setFormRoadmapId(newId); onChangeRoadmap?.(newId); }
                                    }).finally(() => setRoadmapCreating(false));
                                  } else {
                                    setFormRoadmapId(opt.id);
                                    onChangeRoadmap?.(opt.id);
                                  }
                                  setRoadmapDropdownOpen(false);
                                  setRoadmapQuery("");
                                }}
                              >
                                {opt.id === "__create__" ? (
                                  <>
                                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-[11px] font-bold">+</span>
                                    {opt.name}
                                  </>
                                ) : (
                                  <>
                                    <MapIcon className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                                    {opt.name}
                                    {opt.id === formRoadmapId && <Check className="ml-auto size-3.5 text-indigo-500" />}
                                  </>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Assignee</p>
                  <div className="relative flex min-w-0 w-full items-center">
                    <AssigneeFieldDecoration value={assignee} directoryUsers={workspaceDirectoryUsers} />
                    <AssigneeCombobox
                      value={assignee}
                      onChange={setAssignee}
                      suggestions={assigneeNameSuggestions}
                      directoryUsers={workspaceDirectoryUsers}
                      placeholder="Type or pick a name"
                      className={cn("h-7 w-full rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 shadow-sm pl-9 text-[14px] text-slate-800", assignee ? "pr-6" : "pr-1.5")}
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
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Labels</p>
                  <div className="relative z-30">
                    <div className="flex min-h-6 flex-wrap items-center gap-1 rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 px-1.5 py-0.5 shadow-sm">
                      <Tag className="size-3 shrink-0 text-slate-400" aria-hidden />
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
                      {newLabel.trim().length > 0 ? (
                        <>
                          <button
                            type="button"
                            aria-label="Add label"
                            title="Add label"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              addLabel(newLabel);
                            }}
                            className="inline-flex size-4 shrink-0 items-center justify-center rounded text-emerald-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
                          >
                            <Check className="size-3" strokeWidth={2.5} aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label="Clear input"
                            title="Clear"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setNewLabel("");
                            }}
                            className="inline-flex size-4 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                          >
                            <X className="size-3" strokeWidth={2.5} aria-hidden />
                          </button>
                        </>
                      ) : null}
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
            <section className="flex shrink-0 flex-col gap-3 rounded-xl bg-white px-3 pt-3 pb-5 shadow-[0_2px_8px_-2px_rgba(15,23,42,0.12)] ring-1 ring-slate-200 transition-all hover:ring-indigo-300 hover:shadow-[0_2px_12px_-2px_rgba(99,102,241,0.18)]">
              <div className="flex shrink-0 items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
                  <ListTree className="size-5 shrink-0 text-slate-500" aria-hidden />
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
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
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
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
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
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
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
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
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
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
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
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
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
                                    data-1p-ignore="true"
                                    data-lpignore="true"
                                    data-form-type="other"
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
                                        directoryUsers={workspaceDirectoryUsers}
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

            <section
              className={cn(
                "mt-4 flex min-h-0 shrink-0 flex-col space-y-3 rounded-xl bg-white p-3 ring-1 ring-slate-200 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_2px_4px_rgba(15,23,42,0.08)] transition-all hover:ring-indigo-300 hover:shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_2px_8px_rgba(99,102,241,0.18)]",
                activityOpen ? "" : "h-auto",
              )}
              style={activityOpen ? { height: `${activityPanelHeightPx}px` } : undefined}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setActivityOpen((v) => !v)}
                  aria-expanded={activityOpen}
                  className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  <span className="flex items-center gap-2 text-lg font-semibold text-slate-800 transition-colors group-hover:text-indigo-600">
                    <ChevronDown
                      className={cn("size-5 shrink-0 text-slate-500 transition-transform", !activityOpen && "-rotate-90")}
                      aria-hidden
                    />
                    <ActivityIcon className="size-5 shrink-0 text-slate-500" aria-hidden />
                    Activity
                  </span>
                </button>
                {activityOpen ? (
                  <div className="inline-flex shrink-0 rounded-lg bg-white p-1 ring-1 ring-slate-200">
                    <button type="button" className={cn("rounded-md px-2.5 py-1 text-sm font-medium transition", activityTab === "comments" ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200" : "text-slate-600 hover:bg-slate-100")} onClick={() => setActivityTab("comments")}><MessageSquare className="mr-1 inline size-3.5" />Comments</button>
                    <button type="button" className={cn("rounded-md px-2.5 py-1 text-sm font-medium transition", activityTab === "history" ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200" : "text-slate-600 hover:bg-slate-100")} onClick={() => setActivityTab("history")}><History className="mr-1 inline size-3.5" />History</button>
                  </div>
                ) : null}
              </div>

              {activityOpen ? (
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  {!initiative ? (
                    <p className="text-sm text-slate-500">Save this initiative first to add comments and history.</p>
                  ) : activityTab === "comments" ? (
                    <>
                      <div className="min-h-0 max-h-[40%] shrink space-y-2 overflow-y-auto">
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
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
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
