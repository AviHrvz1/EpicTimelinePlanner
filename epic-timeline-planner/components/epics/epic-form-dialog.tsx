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
  Trash,
  Type,
  Underline as UnderlineIcon,
  UserRound,
  X,
} from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { createPortal } from "react-dom";
import { TimelineDatePopover } from "@/components/epics/timeline-date-popover";

import { ActivityCommentComposer } from "@/components/ui/activity-comment-composer";
import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { InitiativeCombobox } from "@/components/ui/initiative-combobox";
import { TeamIdCombobox, blurActiveField } from "@/components/ui/team-id-combobox";
import { Button } from "@/components/ui/button";
import { RichCommentBody } from "@/components/ui/rich-comment-body";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { collectAssigneeNameSuggestions } from "@/lib/delivery-assignees";
import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { MONTHS } from "@/lib/timeline";
import { normalizeWorkspaceUserTeam, teamLabelForWorkspaceUser } from "@/lib/workspace-users";
import { useResizableTableColumns } from "@/lib/use-resizable-table-columns";
import { EpicItem, InitiativeItem, UserStoryItem, type RoadmapItem } from "@/lib/types";
import { useDialogPresence } from "@/lib/use-dialog-presence";
import { planningDetailPanelAnchorStyle, usePlanningSurfaceRect } from "@/lib/use-planning-surface-rect";
import { cn } from "@/lib/utils";
import { sprintEndDate, YEAR_SPRINT_MAX } from "@/lib/year-sprint";
import { EpicPlanBarIcon } from "@/components/timeline/epic-plan-bar";
import { EpicDeleteDialog } from "@/components/epics/epic-delete-dialog";

function quarterNumFromMonth(month: number): 1 | 2 | 3 | 4 {
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

function parseQuarterSelect(value: string): 1 | 2 | 3 | 4 | null {
  if (value === "Q1") return 1;
  if (value === "Q2") return 2;
  if (value === "Q3") return 3;
  if (value === "Q4") return 4;
  return null;
}

function monthIndicesForQuarter(q: 1 | 2 | 3 | 4 | null): number[] {
  if (q === null) return Array.from({ length: 12 }, (_, i) => i + 1);
  const start = (q - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

function formatShortDate(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return "";
  const dd = String(parsed.day).padStart(2, "0");
  const mm = String(parsed.month).padStart(2, "0");
  const yy = String(parsed.year).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function toIsoDate(year: number, month: number, day: number): string {
  const mm = String(Math.max(1, Math.min(12, month))).padStart(2, "0");
  const dd = String(Math.max(1, Math.min(31, day))).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parseSprintDraftValue(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const numericText = raw.replace(/[^0-9]/g, "");
  if (!numericText) return null;
  const parsed = Number(numericText);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.min(24, Math.round(parsed)));
}

const EPIC_CHILD_TABLE_DEFAULT_WIDTHS = [72, 200, 80, 104, 116, 88, 80, 80] as const;

type EpicChildStorySortKey = "id" | "title" | "sprint" | "status" | "assignee" | "priority" | "estimatedDays" | "daysLeft";

const STORY_STATUS_SORT_RANK: Record<string, number> = {
  todo: 0,
  inProgress: 1,
  done: 2,
  approved: 3,
};

const CHILD_TABLE_RESIZE_HANDLE =
  "absolute right-0 top-0 z-[1] h-full w-1.5 cursor-col-resize select-none hover:bg-slate-400/50";

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
    planStartMonth: number | null;
    planEndMonth: number | null;
    planStartDay: number | null;
    planEndDay: number | null;
  }) => Promise<void> | void;
  onDelete?: (epicId: string) => Promise<void> | void;
  storyRefById?: Record<string, string>;
  onRequestCreateStory?: (epicId: string) => void;
  /** Inline-create: posts a new user story directly under the epic without
   * opening the story popup. Called by the Add button next to the child
   * row's title input. */
  onCreateChildStoryQuick?: (epicId: string, title: string) => Promise<void>;
  onOpenStory?: (storyId: string) => void;
  onOpenInitiative?: (initiativeId: string) => void;
  /** Create a backlog initiative from the Parent field; must return the new row id. */
  onCreateInitiativeQuick?: (title: string) => Promise<string>;
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
  /** If provided, the BarChart3 header button switches the in-app view to
   * the insights surface (scoped to this epic) and closes the dialog,
   * instead of opening /epic-insights in a new tab. */
  onOpenInsights?: (kind: "epic" | "initiative", id: string) => void;
  onExitComplete?: () => void;
  surfaceAnchorRef?: RefObject<HTMLElement | null>;
  /** Users directory — custom team slugs appear in the team combobox alongside delivery teams. */
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  roadmaps?: RoadmapItem[];
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
  onCreateChildStoryQuick,
  onOpenStory,
  onOpenInitiative,
  onCreateInitiativeQuick,
  onPatchStory,
  onAddComment,
  onOpenInsights,
  surfaceAnchorRef,
  workspaceDirectoryUsers = [],
  roadmaps = [],
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
  const [planQuarterDraft, setPlanQuarterDraft] = useState("");
  // Timeline range as ISO date strings (YYYY-MM-DD). On save these are parsed
  // back into separate month + day fields. End date never goes earlier than
  // start.
  const [planStartDateDraft, setPlanStartDateDraft] = useState("");
  const [planEndDateDraft, setPlanEndDateDraft] = useState("");
  const [teamDraft, setTeamDraft] = useState("");
  const [forceTeamFieldEdit, setForceTeamFieldEdit] = useState(false);
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [activityOpen, setActivityOpen] = useState(true);
  const [descriptionAccordionOpen, setDescriptionAccordionOpen] = useState(true);
  const [labelsDraft, setLabelsDraft] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [labelsAutocompleteOpen, setLabelsAutocompleteOpen] = useState(false);
  const [labelsAutocompleteIndex, setLabelsAutocompleteIndex] = useState(-1);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [dialogWidthVw, setDialogWidthVw] = useState(64);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const [isDraggingDialog, setIsDraggingDialog] = useState(false);
  const [detailsPanelWidthPx, setDetailsPanelWidthPx] = useState(380);
  const [activityPanelHeightPx, setActivityPanelHeightPx] = useState(300);
  const [childStoryDrafts, setChildStoryDrafts] = useState<Record<string, ChildStoryDraft>>({});
  const [childEditingCell, setChildEditingCell] = useState<{
    rowId: string;
    field: "title" | "sprint" | "status" | "assignee" | "priority" | "estimatedDays" | "daysLeft";
  } | null>(null);
  const [childEditingValue, setChildEditingValue] = useState("");
  const [newChildTitle, setNewChildTitle] = useState("");
  const [childStorySortKey, setChildStorySortKey] = useState<EpicChildStorySortKey>("title");
  const [childStorySortDir, setChildStorySortDir] = useState<"asc" | "desc">("asc");
  const [isSprintAutocompleteOpen, setIsSprintAutocompleteOpen] = useState(false);
  const [sprintAutocompletePosition, setSprintAutocompletePosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const { widths: childTableWidths, onColumnResizeStart: onChildTableColResize } = useResizableTableColumns(
    `${open ? "1" : "0"}-${epic?.id ?? "none"}`,
    EPIC_CHILD_TABLE_DEFAULT_WIDTHS,
  );
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);
  const dialogShellRef = useRef<HTMLDivElement | null>(null);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const sprintInputRef = useRef<HTMLInputElement | null>(null);
  const timelineStartAnchorRef = useRef<HTMLButtonElement | null>(null);
  const timelineEndAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [startCalendarOpen, setStartCalendarOpen] = useState(false);
  const [endCalendarOpen, setEndCalendarOpen] = useState(false);
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
    setTitle(epic?.title ?? "");
    setIcon(epic?.icon ?? "📁");
    setDescription(epic?.description ?? "");
    setAssignee(epic?.assignee ?? "");
    setColor(epic?.color ?? "#3B82F6");
    setOriginalEstimateDaysDraft(epic?.originalEstimateDays == null ? "" : String(epic.originalEstimateDays));
    const nextInitiativeId = epic?.initiativeId ?? lockInitiativeId ?? initiatives[0]?.id ?? "";
    setInitiativeId(nextInitiativeId);
    const init = initiatives.find((i) => i.id === nextInitiativeId) ?? null;
    if (epic) {
      const q =
        epic.planQuarter != null
          ? epic.planQuarter
          : epic.planStartMonth != null
            ? quarterNumFromMonth(epic.planStartMonth)
            : null;
      setPlanQuarterDraft(q != null ? `Q${q}` : "");
      const epicYear = epic.planYear ?? init?.year ?? new Date().getFullYear();
      setPlanStartDateDraft(
        epic.planStartMonth != null
          ? toIsoDate(epicYear, epic.planStartMonth, epic.planStartDay ?? 1)
          : "",
      );
      const endMonth = epic.planEndMonth ?? epic.planStartMonth ?? null;
      const endDay = epic.planEndDay ?? epic.planStartDay ?? null;
      setPlanEndDateDraft(
        endMonth != null
          ? toIsoDate(epicYear, endMonth, endDay ?? lastDayOfMonth(epicYear, endMonth))
          : "",
      );
    } else if (init?.startMonth != null) {
      setPlanQuarterDraft(`Q${quarterNumFromMonth(init.startMonth)}`);
      const initIso = toIsoDate(init.year, init.startMonth, 1);
      setPlanStartDateDraft(initIso);
      setPlanEndDateDraft(initIso);
    } else {
      setPlanQuarterDraft("");
      setPlanStartDateDraft("");
      setPlanEndDateDraft("");
    }
    setForceTeamFieldEdit(false);
    setTeamDraft(epic?.team ? normalizeWorkspaceUserTeam(epic.team) : "");
    setActivityTab("comments");
    setActivityOpen(true);
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
      setDialogWidthVw(64);
      setDetailsPanelWidthPx(380);
      setActivityPanelHeightPx(340);
      setActivityOpen(true);
      setDescriptionAccordionOpen(true);
      dragStartRef.current = null;
    }
  }, [open]);
  useEffect(() => {
    if (!descriptionEditor) return;
    const next = epic?.description?.trim() ? epic.description : "<p></p>";
    descriptionEditor.commands.setContent(next, { emitUpdate: false });
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
  const sprintPlanningYear = useMemo(
    () => selectedInitiative?.year ?? epic?.planYear ?? initiatives[0]?.year ?? new Date().getFullYear(),
    [selectedInitiative?.year, epic?.planYear, initiatives],
  );
  const assignableSprintOptions = useMemo(
    () =>
      Array.from({ length: YEAR_SPRINT_MAX }, (_, idx) => idx + 1).filter(
        (n) => sprintEndDate(sprintPlanningYear, n).getTime() > Date.now(),
      ),
    [sprintPlanningYear],
  );
  const allAssigneeNameSuggestions = useMemo(() => {
    if (workspaceDirectoryUsers.length > 0) {
      const set = new Set(workspaceDirectoryUsers.map((u) => u.name.trim()).filter(Boolean));
      for (const init of initiatives) {
        for (const epic of init.epics ?? []) {
          for (const story of epic.userStories ?? []) {
            if (story.assignee?.trim()) set.add(story.assignee.trim());
          }
          if (epic.assignee?.trim()) set.add(epic.assignee.trim());
        }
        if (init.assignee?.trim()) set.add(init.assignee.trim());
      }
      return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    }
    return collectAssigneeNameSuggestions(initiatives);
  }, [initiatives, workspaceDirectoryUsers]);
  const assigneeNameSuggestions = useMemo(() => {
    const teamId = teamDraft.trim();
    if (!teamId || workspaceDirectoryUsers.length === 0) return allAssigneeNameSuggestions;
    const teamMembers = workspaceDirectoryUsers
      .filter((u) => normalizeWorkspaceUserTeam(u.team) === teamId)
      .map((u) => u.name.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return teamMembers.length > 0 ? teamMembers : allAssigneeNameSuggestions;
  }, [allAssigneeNameSuggestions, teamDraft, workspaceDirectoryUsers]);
  const filteredSprintAutocompleteOptions = useMemo(() => {
    if (!isSprintAutocompleteOpen || childEditingCell?.field !== "sprint") return [];
    const raw = childEditingValue.trim().toLowerCase();
    if (!raw) return assignableSprintOptions;
    const numericQuery = raw.replace(/[^0-9]/g, "");
    return assignableSprintOptions.filter((sprintNo) => {
      const sprintLabel = `sprint ${sprintNo}`;
      if (sprintLabel.includes(raw)) return true;
      if (!numericQuery) return false;
      return String(sprintNo).includes(numericQuery);
    });
  }, [assignableSprintOptions, childEditingCell?.field, childEditingValue, isSprintAutocompleteOpen]);
  const allowedMonthNames = useMemo(() => {
    const indices = monthIndicesForQuarter(parseQuarterSelect(planQuarterDraft));
    return indices.map((i) => MONTHS[i - 1]);
  }, [planQuarterDraft]);
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

  function toggleChildStorySort(key: EpicChildStorySortKey) {
    if (key === childStorySortKey) {
      setChildStorySortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setChildStorySortKey(key);
      setChildStorySortDir("asc");
    }
  }

  const sortedEpicChildStories = useMemo(() => {
    const raw = epic?.userStories ?? [];
    if (raw.length === 0) return raw;
    const list = [...raw] as UserStoryItem[];
    const asc = childStorySortDir === "asc";
    const mul = asc ? 1 : -1;
    const ids = displayIds.byStoryId;
    const drafts = childStoryDrafts;
    const missingNum = asc ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;

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

    list.sort((sa, sb) => {
      switch (childStorySortKey) {
        case "id": {
          const la = (ids.get(sa.id) ?? storyRefById?.[sa.id] ?? sa.id).toLowerCase();
          const lb = (ids.get(sb.id) ?? storyRefById?.[sb.id] ?? sb.id).toLowerCase();
          return la.localeCompare(lb, undefined, { numeric: true }) * mul;
        }
        case "title":
          return cmpStr(
            (drafts[sa.id]?.title ?? sa.title).toLowerCase(),
            (drafts[sb.id]?.title ?? sb.title).toLowerCase(),
          );
        case "sprint": {
          const parseS = (s: UserStoryItem) => {
            const d = drafts[s.id]?.sprint?.trim();
            const n = d ? parseSprintDraftValue(d) : s.sprint;
            return Number.isFinite(Number(n)) ? Number(n) : missingNum;
          };
          return cmpNum(parseS(sa), parseS(sb));
        }
        case "status": {
          const ra = STORY_STATUS_SORT_RANK[drafts[sa.id]?.status ?? sa.status] ?? 99;
          const rb = STORY_STATUS_SORT_RANK[drafts[sb.id]?.status ?? sb.status] ?? 99;
          return cmpNum(ra, rb);
        }
        case "assignee":
          return cmpStr(
            (drafts[sa.id]?.assignee ?? sa.assignee ?? "").toLowerCase(),
            (drafts[sb.id]?.assignee ?? sb.assignee ?? "").toLowerCase(),
          );
        case "priority": {
          const pa = (drafts[sa.id]?.priority ?? sa.priority ?? "").trim() || "zzz";
          const pb = (drafts[sb.id]?.priority ?? sb.priority ?? "").trim() || "zzz";
          return cmpStr(pa.toLowerCase(), pb.toLowerCase());
        }
        case "estimatedDays": {
          const parseE = (s: UserStoryItem) => {
            const d = drafts[s.id]?.estimatedDays?.trim();
            const n = d ? Number(d) : s.estimatedDays;
            return Number.isFinite(Number(n)) ? Number(n) : -1;
          };
          return cmpNum(parseE(sa), parseE(sb));
        }
        case "daysLeft": {
          const parseD = (s: UserStoryItem) => {
            const d = drafts[s.id]?.daysLeft?.trim();
            const n = d ? Number(d) : s.daysLeft;
            return Number.isFinite(Number(n)) ? Number(n) : -1;
          };
          return cmpNum(parseD(sa), parseD(sb));
        }
        default:
          return 0;
      }
    });
    // After the user's column sort, hoist the most-recently-created story to
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
  }, [epic?.userStories, childStorySortKey, childStorySortDir, childStoryDrafts, displayIds, storyRefById]);

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
    if (!q) return [];
    return existingLabelSuggestions
      .filter((item) => item.toLowerCase().includes(q) && !labelsDraft.includes(item))
      .slice(0, 8);
  }, [existingLabelSuggestions, labelsDraft, newLabel]);

  const totalUserStoryEstimate = useMemo(() => {
    return (epic?.userStories ?? []).reduce((sum, row) => sum + (row.estimatedDays ?? 0), 0);
  }, [epic?.userStories]);

  // Roll-up status derived from the epic's user stories.
  // Empty: "—". All approved: "Approved". All done/approved: "Done". Any in-progress (or mixed done+todo): "In progress". Else "To do".
  const derivedEpicStatus = useMemo<{ label: string; key: "todo" | "inProgress" | "done" | "approved" | "empty" }>(() => {
    const stories = epic?.userStories ?? [];
    if (stories.length === 0) return { label: "—", key: "empty" };
    const counts = { todo: 0, inProgress: 0, done: 0, approved: 0 };
    for (const s of stories) {
      const k = s.status as keyof typeof counts;
      if (k in counts) counts[k] += 1;
    }
    if (counts.approved === stories.length) return { label: "Approved", key: "approved" };
    if (counts.inProgress > 0) return { label: "In progress", key: "inProgress" };
    if (counts.done + counts.approved === stories.length) return { label: "Done", key: "done" };
    if (counts.done > 0 || counts.approved > 0) return { label: "In progress", key: "inProgress" };
    return { label: "To do", key: "todo" };
  }, [epic?.userStories]);
  const infoTooltipClass =
    "pointer-events-none absolute left-1/2 top-0 z-[320] w-48 max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-normal rounded-lg border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/40 px-2.5 py-1.5 text-[12px] font-medium leading-snug text-slate-700 opacity-0 shadow-md ring-1 ring-indigo-100/70 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100";

  useEffect(() => {
    setLabelsAutocompleteIndex(-1);
  }, [newLabel, labelsDraft, filteredLabelSuggestions.length]);

  const directoryExtraTeamIds = useMemo(() => {
    const ids = new Set<string>();
    for (const u of workspaceDirectoryUsers) {
      const id = normalizeWorkspaceUserTeam(u.team);
      if (id && !MONTH_TEAM_IDS.includes(id)) ids.add(id);
    }
    for (const initiative of initiatives) {
      for (const row of initiative.epics ?? []) {
        const id = normalizeWorkspaceUserTeam(row.team);
        if (id && !MONTH_TEAM_IDS.includes(id)) ids.add(id);
      }
    }
    return [...ids].sort((a, b) =>
      teamLabelForWorkspaceUser(a).localeCompare(teamLabelForWorkspaceUser(b), undefined, { sensitivity: "base" }),
    );
  }, [workspaceDirectoryUsers, initiatives]);

  const persistedTeam = epic?.team ? normalizeWorkspaceUserTeam(epic.team) || null : null;
  const persistedTeamLabel =
    !persistedTeam
      ? "Not set"
      : MONTH_TEAM_COLUMNS.find((t) => t.id === persistedTeam)?.label ?? teamLabelForWorkspaceUser(persistedTeam);
  const showTeamSelect = !persistedTeam || forceTeamFieldEdit;
  const planningYearDisplay =
    selectedInitiative?.year != null ? String(selectedInitiative.year) : epic?.planYear != null ? String(epic.planYear) : "Not set";
  function openInsightsWindow() {
    if (!epic) return;
    // Preferred: in-app navigation (parent switches view + closes dialog).
    if (onOpenInsights) {
      onOpenInsights("epic", epic.id);
      onClose();
      return;
    }
    // Fallback: open the standalone /epic-insights page in a new tab.
    const allEpicsSorted = [...initiatives]
      .sort((a, b) => new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime() || a.title.localeCompare(b.title))
      .flatMap((i) => i.epics ?? [])
      .sort((a, b) => new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime() || a.title.localeCompare(b.title));
    const idx = allEpicsSorted.findIndex((e) => e.id === epic.id);
    const displayId = idx >= 0 ? `EPIC-${String(idx + 1).padStart(2, "0")}` : epic.id;
    const cur = new URLSearchParams(window.location.search);
    const p = new URLSearchParams();
    p.set("epicDisplayId", displayId);
    for (const key of ["month", "planTab", "sprint"] as const) {
      const v = cur.get(key);
      if (v) p.set(key, v);
    }
    p.set("sprintView", "epic-insights");
    window.open(`/epic-insights?${p.toString()}`, "_blank");
  }

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

  useEffect(() => {
    if (!isSprintAutocompleteOpen || childEditingCell?.field !== "sprint") return;
    updateSprintAutocompletePosition();
    function handleViewportChange() {
      updateSprintAutocompletePosition();
    }
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isSprintAutocompleteOpen, childEditingCell?.field]);

  if (!visible) return null;

  async function handleSave() {
    blurActiveField();
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    const normalizedTitle = title.trim();
    if (!normalizedTitle || !initiativeId) return;

    setIsSaving(true);
    try {
      const start = parseIsoDate(planStartDateDraft);
      const end = parseIsoDate(planEndDateDraft);
      const planStartMonth = start ? start.month : null;
      const planStartDay = start ? start.day : null;
      // End: if missing, fall back to start. If earlier than start, clamp.
      let planEndMonth = end ? end.month : planStartMonth;
      let planEndDay = end ? end.day : planStartDay;
      if (start && end) {
        const startStamp = start.year * 10000 + start.month * 100 + start.day;
        const endStamp = end.year * 10000 + end.month * 100 + end.day;
        if (endStamp < startStamp) {
          planEndMonth = start.month;
          planEndDay = start.day;
        }
      }
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
        planStartMonth,
        planEndMonth,
        planStartDay,
        planEndDay,
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
    if (!epic || !onAddComment) return;
    setIsAddingComment(true);
    try {
      await onAddComment(epic.id, html);
    } finally {
      setIsAddingComment(false);
    }
  }

  function handleDelete() {
    if (!epic || !onDelete) return;
    setPendingDelete(true);
  }

  async function confirmDelete() {
    if (!epic || !onDelete) return;
    setIsDeleting(true);
    await onDelete(epic.id);
    setIsDeleting(false);
    setPendingDelete(false);
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

  function beginDialogWidthResize(event: React.PointerEvent<HTMLDivElement>) {
    if (anchored || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const fallbackWidth = (window.innerWidth * dialogWidthVw) / 100;
    const startWidth = dialogShellRef.current?.getBoundingClientRect().width ?? fallbackWidth;
    const startDetailsWidth = detailsPanelWidthPx;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      const nextWidth = startWidth - delta;
      const minWidth = Math.min(900, window.innerWidth * 0.55);
      const maxWidth = Math.max(minWidth, window.innerWidth - 8);
      const bounded = Math.max(minWidth, Math.min(maxWidth, nextWidth));
      setDialogWidthVw((bounded / window.innerWidth) * 100);
      const widthDelta = bounded - startWidth;
      const nextDetails = startDetailsWidth + widthDelta * 0.35;
      setDetailsPanelWidthPx(Math.max(296, Math.min(bounded - 320, nextDetails)));
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
    const startDetailsWidth = detailsPanelWidthPx;
    const startOffsetX = dialogOffset.x;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      const nextWidth = startWidth + delta;
      const minWidth = Math.min(900, window.innerWidth * 0.55);
      const maxWidth = Math.max(minWidth, window.innerWidth - 8);
      const bounded = Math.max(minWidth, Math.min(maxWidth, nextWidth));
      setDialogWidthVw((bounded / window.innerWidth) * 100);
      const widthDelta = bounded - startWidth;
      setDialogOffset((prev) => ({ ...prev, x: startOffsetX + widthDelta }));
      const nextDetails = startDetailsWidth + widthDelta * 0.35;
      setDetailsPanelWidthPx(Math.max(296, Math.min(bounded - 320, nextDetails)));
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
    setIsSprintAutocompleteOpen(field === "sprint");
  }

  function updateSprintAutocompletePosition() {
    const el = sprintInputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSprintAutocompletePosition({
      left: rect.left,
      top: rect.bottom + 4,
      width: rect.width,
    });
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
    setIsSprintAutocompleteOpen(false);
    setSprintAutocompletePosition(null);
    const sprintCandidate = parseSprintDraftValue(next.sprint);
    const sprintValue =
      sprintCandidate == null || assignableSprintOptions.includes(sprintCandidate)
        ? sprintCandidate
        : null;
    const patch =
      field === "title"
        ? { title: next.title.trim() }
        : field === "sprint"
          ? { sprint: sprintValue }
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
            isDraggingDialog && "select-none",
          )}
          style={{ transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)` }}
        >
          {!anchored ? (
            <div
              className="absolute inset-y-0 left-0 z-20 w-2.5 cursor-col-resize bg-transparent hover:bg-indigo-200/40"
              onPointerDown={beginDialogWidthResize}
              aria-label="Resize epic panel width"
              role="separator"
            />
          ) : null}
          {!anchored ? (
            <div
              className="absolute inset-y-0 right-0 z-20 w-2.5 cursor-col-resize bg-transparent hover:bg-indigo-200/40"
              onPointerDown={beginDialogWidthResizeRight}
              aria-label="Resize epic panel width from right"
              role="separator"
            />
          ) : null}
          <div
            className="mb-4 flex cursor-move items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-4"
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
              <span
                className="inline-flex min-w-0 items-center gap-1 truncate rounded px-1 py-0.5 text-slate-800"
                title={(epic?.title ?? title) || "Epic"}
              >
                {epic ? (displayIds.byEpicId.get(epic.id) ?? "Epic") : "Epic"}
              </span>
              <ChevronRight className="size-4 shrink-0 text-slate-400" />
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-base font-medium text-slate-900">
                <EpicPlanBarIcon icon={icon} className="mr-0 [&_svg]:size-4 [&_svg]:text-slate-600" />
                <span className="truncate">{title || (epic ? "Epic details" : "Create epic")}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              {epic ? (
                <span className="group relative inline-flex">
                  <button
                    type="button"
                    onClick={openInsightsWindow}
                    aria-label="Open epic insights"
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-indigo-200 px-4 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-50 transition-colors"
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
                  <span role="tooltip" className={infoTooltipClass}>
                    Open the insights view scoped to this epic — see scope burnup, sprint progress, and team workload.
                  </span>
                </span>
              ) : null}
              {epic ? (
                <span className="group relative inline-flex">
                  <button
                    type="button"
                    onClick={handleDelete}
                    aria-label="Delete epic"
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-4 text-[13px] font-semibold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash className="size-4" />
                    Delete
                  </button>
                  <span role="tooltip" className={infoTooltipClass}>
                    Permanently delete this epic and all of its user stories. This cannot be undone.
                  </span>
                </span>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="inline-flex h-9 items-center gap-2 rounded-md px-4 text-[13px] font-semibold [&_svg]:text-slate-500"
                onClick={onClose}
              >
                <X className="size-4" />
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="inline-flex h-9 items-center gap-2 rounded-md border-0 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-[13px] font-semibold text-white hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 [&_svg]:text-white"
                onClick={handleSave}
                disabled={isSaving}
              >
                <Check className="size-4" />
                {isSaving ? "Saving…" : epic ? "Save" : "Create"}
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              <div
                ref={splitLayoutRef}
                className="grid shrink-0 items-stretch gap-0"
                style={{ gridTemplateColumns: `minmax(0,1fr) 10px ${detailsPanelWidthPx}px` }}
              >
              <section className="flex h-full flex-col gap-3 overflow-x-hidden rounded-xl border-0 bg-white py-3 pl-[5px] pr-0 [scrollbar-gutter:stable]">
                <label className="block shrink-0 space-y-1">
                  <p className="flex shrink-0 items-center gap-2 text-lg font-semibold text-slate-800">
                    <Type className="size-5 shrink-0 text-slate-500" aria-hidden />
                    Title
                  </p>
                  <div className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 shadow-sm focus-within:ring-2 focus-within:ring-slate-300/70">
                    <input
                      className="w-full bg-transparent px-3 py-2 text-base outline-none"
                      placeholder="Epic title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </div>
                </label>

                <div className="mt-4 flex flex-1 flex-col gap-1">
                  <h3 className="flex shrink-0 items-center gap-2 py-1 text-lg font-semibold text-slate-800">
                    <FileText className="size-5 shrink-0 text-slate-500" aria-hidden />
                    Description
                  </h3>
                  <div className="flex flex-1 flex-col gap-2 rounded-xl bg-white p-3 shadow-[0_2px_8px_-2px_rgba(15,23,42,0.12)] ring-1 ring-slate-200 transition-all hover:ring-indigo-300 hover:shadow-[0_2px_12px_-2px_rgba(99,102,241,0.18)]">
                    <div className="flex flex-wrap gap-1 rounded-md bg-[#0897d5] p-1">
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
                        className="focus:outline-none [&_.ProseMirror]:min-h-[12rem] [&_.ProseMirror]:outline-none"
                      />
                    </div>
                  </div>
                </div>

              </section>

              <div className="relative mx-1.5">
                <div
                  className="group absolute inset-y-0 left-1/2 flex w-3 -translate-x-[calc(50%+2px)] cursor-col-resize items-stretch justify-center"
                  onPointerDown={beginDetailsPanelResize}
                  title="Resize details panel"
                  aria-label="Resize details panel"
                  role="separator"
                >
                  <div className="self-start h-[calc(80%+80px)] w-px bg-slate-300 transition group-hover:bg-slate-500" />
                  <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-[calc(50%+2px)]" />
                </div>
              </div>

              <section className="relative z-20 h-full space-y-5 rounded-xl bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                <h3 className="flex items-center gap-2 text-lg font-semibold leading-snug tracking-tight text-slate-800">
                  <ClipboardList className="size-5 shrink-0 text-slate-500" aria-hidden />
                  Details
                </h3>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Parent</p>
                  <InitiativeCombobox
                    valueId={initiativeId}
                    onValueChange={(next) => {
                      setInitiativeId(next);
                      if (epic) return;
                      const nextInit = initiatives.find((i) => i.id === next);
                      if (nextInit?.startMonth != null) {
                        setPlanQuarterDraft(`Q${quarterNumFromMonth(nextInit.startMonth)}`);
                        const iso = toIsoDate(nextInit.year, nextInit.startMonth, 1);
                        setPlanStartDateDraft(iso);
                        setPlanEndDateDraft(iso);
                      } else {
                        setPlanQuarterDraft("");
                        setPlanStartDateDraft("");
                        setPlanEndDateDraft("");
                      }
                    }}
                    options={initiativeOptions.map((o) => ({ id: o.id, title: o.label }))}
                    onCreateNew={onCreateInitiativeQuick}
                    disabled={isSaving}
                    placeholder="Search, pick, or create an initiative"
                    aria-label="Parent initiative"
                    className="h-7 w-full min-w-0 rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 shadow-sm px-1.5 text-[14px] text-slate-800"
                  />
                </label>
                <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <div className="inline-flex items-center gap-1">
                    <p className="text-[15px] font-normal text-slate-700">Status</p>
                    <span className="group relative inline-flex items-center">
                      <Info className="size-3.5 text-slate-400" aria-label="Status is derived from the epic's user stories" />
                      <span role="tooltip" className={infoTooltipClass}>
                        Status is rolled up from this epic&rsquo;s user stories.
                      </span>
                    </span>
                  </div>
                  <input
                    value={derivedEpicStatus.label}
                    readOnly
                    aria-label="Status (read-only)"
                    title="Status is calculated from the user stories"
                    className="h-7 w-full cursor-not-allowed rounded-md border border-slate-300 bg-slate-100 px-2 text-[14px] font-medium text-slate-500 shadow-sm"
                  />
                </div>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Team</p>
                  <div className="group/team relative flex min-w-0 w-full items-center">
                    <TeamIdCombobox
                      teamId={teamDraft}
                      onTeamIdChange={setTeamDraft}
                      allowCustomTeam
                      extraTeamIds={directoryExtraTeamIds}
                      placeholder="Type or pick a team"
                      className="h-7 w-full rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 px-1.5 text-[14px] text-slate-800 shadow-sm"
                    />
                    {teamDraft ? (
                      <button
                        type="button"
                        aria-label="Clear team"
                        onClick={() => setTeamDraft("")}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 flex size-4 items-center justify-center rounded-full text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 group-hover/team:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </div>
                </label>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Days Est</p>
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    step={1}
                    className="h-6 w-full rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 px-1.5 text-[14px] text-slate-800 shadow-sm"
                    placeholder="e.g. 40"
                    value={originalEstimateDaysDraft}
                    onChange={(event) => setOriginalEstimateDaysDraft(event.target.value)}
                  />
                </label>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <div className="inline-flex items-center gap-1">
                    <p className="text-[15px] font-normal text-slate-700">Σ Child Est.</p>
                    <span className="group relative inline-flex items-center">
                      <Info
                        className="size-3.5 text-slate-400"
                        aria-label="About sum of child estimates (user stories)"
                      />
                      <span role="tooltip" className={infoTooltipClass}>
                        Sum of estimated days from all child user stories.
                      </span>
                    </span>
                  </div>
                  <input
                    value={totalUserStoryEstimate}
                    readOnly
                    className="h-6 w-full cursor-not-allowed rounded-md border border-slate-300 bg-slate-100 px-1.5 text-[14px] font-medium text-slate-500 shadow-sm"
                  />
                </label>
                <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Timeline</p>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Each pill opens its own calendar popover (see
                        TimelineDatePopover) — the popover shows a Q1-Q4 chip
                        above the month grid so the user can see the quarter
                        without parsing the month name. */}
                    <button
                      ref={timelineStartAnchorRef}
                      type="button"
                      onClick={() => setStartCalendarOpen((p) => !p)}
                      aria-label="Pick start date"
                      aria-expanded={startCalendarOpen}
                      className="group inline-flex h-8 w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 pl-2.5 pr-2 text-left text-[13px] text-slate-800 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7)] transition-colors hover:border-slate-300 hover:bg-white focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                    >
                      <CalendarDays className="size-3.5 shrink-0 text-slate-400 transition-colors group-focus:text-indigo-500" aria-hidden />
                      <span className={formatShortDate(planStartDateDraft) ? "text-slate-800" : "text-slate-400"}>
                        {formatShortDate(planStartDateDraft) || "Start"}
                      </span>
                    </button>
                    <button
                      ref={timelineEndAnchorRef}
                      type="button"
                      onClick={() => setEndCalendarOpen((p) => !p)}
                      aria-label="Pick end date"
                      aria-expanded={endCalendarOpen}
                      className="group inline-flex h-8 w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 pl-2.5 pr-2 text-left text-[13px] text-slate-800 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7)] transition-colors hover:border-slate-300 hover:bg-white focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                    >
                      <CalendarDays className="size-3.5 shrink-0 text-slate-400 transition-colors group-focus:text-indigo-500" aria-hidden />
                      <span className={formatShortDate(planEndDateDraft) ? "text-slate-800" : "text-slate-400"}>
                        {formatShortDate(planEndDateDraft) || "End"}
                      </span>
                    </button>
                  </div>
                  <TimelineDatePopover
                    open={startCalendarOpen}
                    anchorRef={timelineStartAnchorRef}
                    value={planStartDateDraft}
                    fallbackYear={sprintPlanningYear}
                    fallbackMonth1={1}
                    onChange={(next) => {
                      setPlanStartDateDraft(next);
                      const parsed = parseIsoDate(next);
                      if (parsed) setPlanQuarterDraft(`Q${quarterNumFromMonth(parsed.month)}`);
                      // If the new start is after current end, snap end to start.
                      if (planEndDateDraft && next > planEndDateDraft) {
                        setPlanEndDateDraft(next);
                      } else if (!planEndDateDraft) {
                        setPlanEndDateDraft(next);
                      }
                    }}
                    onClose={() => setStartCalendarOpen(false)}
                  />
                  <TimelineDatePopover
                    open={endCalendarOpen}
                    anchorRef={timelineEndAnchorRef}
                    value={planEndDateDraft}
                    min={planStartDateDraft || undefined}
                    fallbackYear={sprintPlanningYear}
                    fallbackMonth1={1}
                    onChange={(next) => {
                      setPlanEndDateDraft(next);
                    }}
                    onClose={() => setEndCalendarOpen(false)}
                  />
                </div>
                {(() => {
                  const parentInit = initiatives.find((i) => i.id === initiativeId);
                  const roadmap = roadmaps.find((r) => r.id === parentInit?.roadmapId);
                  if (!roadmap) return null;
                  return (
                    <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                      <p className="text-[15px] font-normal text-slate-700">Roadmap</p>
                      <span className="inline-flex h-7 max-w-[16rem] items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-[13px] font-medium text-blue-800 select-none">
                        <MapIcon className="size-3.5 shrink-0 text-blue-500" aria-hidden />
                        <span className="truncate">{roadmap.name}</span>
                      </span>
                    </div>
                  );
                })()}
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Assignee</p>
                  <div className="relative flex min-w-0 w-full items-center">
                    <UserRound className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                    <AssigneeCombobox
                      value={assignee}
                      onChange={(name) => {
                        setAssignee(name);
                        if (name.trim() && workspaceDirectoryUsers.length > 0) {
                          const match = workspaceDirectoryUsers.find((u) => u.name.trim().toLowerCase() === name.trim().toLowerCase());
                          if (match) {
                            const teamId = normalizeWorkspaceUserTeam(match.team);
                            if (teamId) {
                              setTeamDraft(teamId);
                              setForceTeamFieldEdit(true);
                            }
                          }
                        }
                      }}
                      suggestions={assigneeNameSuggestions}
                      placeholder="Type or pick a name"
                      className={cn("h-7 w-full rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 shadow-sm pl-7 text-[14px] text-slate-800", assignee ? "pr-6" : "pr-1.5")}
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
                  Child User Stories
                </h3>
                <span className="rounded-full bg-white px-2 py-0.5 text-sm text-slate-600 ring-1 ring-slate-200">
                  {epic?.userStories?.length ?? 0}
                </span>
              </div>

              {!epic ? (
                <p className="shrink-0 rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">
                  Save this epic first, then add and manage user stories here.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="overflow-x-auto rounded-md bg-white ring-1 ring-slate-200">
                        <table className="w-full table-fixed text-left text-sm">
                          <colgroup>
                            {childTableWidths.map((w, i) => (
                              <col key={i} style={{ width: w }} />
                            ))}
                          </colgroup>
                          <thead className="bg-[#0897d5] text-white">
                            <tr>
                              <th className="relative px-2 py-1.5 text-left text-[14px] font-semibold" style={{ width: childTableWidths[0] }}>
                                <button
                                  type="button"
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
                                  onClick={() => toggleChildStorySort("id")}
                                >
                                  ID
                                  {childStorySortKey === "id" ? (
                                    childStorySortDir === "asc" ? (
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
                                  onPointerDown={(e) => onChildTableColResize(0, e)}
                                  aria-hidden
                                />
                              </th>
                              <th className="relative px-2 py-1.5 text-left text-[14px] font-semibold" style={{ width: childTableWidths[1] }}>
                                <button
                                  type="button"
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
                                  onClick={() => toggleChildStorySort("title")}
                                >
                                  Story
                                  {childStorySortKey === "title" ? (
                                    childStorySortDir === "asc" ? (
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
                                  onPointerDown={(e) => onChildTableColResize(1, e)}
                                  aria-hidden
                                />
                              </th>
                              <th className="relative px-2 py-1.5 text-left text-[14px] font-semibold" style={{ width: childTableWidths[2] }}>
                                <button
                                  type="button"
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
                                  onClick={() => toggleChildStorySort("sprint")}
                                >
                                  Sprint
                                  {childStorySortKey === "sprint" ? (
                                    childStorySortDir === "asc" ? (
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
                                  onPointerDown={(e) => onChildTableColResize(2, e)}
                                  aria-hidden
                                />
                              </th>
                              <th className="relative px-3 py-2 text-left text-[14px] font-semibold" style={{ width: childTableWidths[3] }}>
                                <button
                                  type="button"
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
                                  onClick={() => toggleChildStorySort("status")}
                                >
                                  Status
                                  {childStorySortKey === "status" ? (
                                    childStorySortDir === "asc" ? (
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
                                  onPointerDown={(e) => onChildTableColResize(3, e)}
                                  aria-hidden
                                />
                              </th>
                              <th className="relative px-3 py-2 text-left text-[14px] font-semibold" style={{ width: childTableWidths[4] }}>
                                <button
                                  type="button"
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
                                  onClick={() => toggleChildStorySort("assignee")}
                                >
                                  Assignee
                                  {childStorySortKey === "assignee" ? (
                                    childStorySortDir === "asc" ? (
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
                                  onPointerDown={(e) => onChildTableColResize(4, e)}
                                  aria-hidden
                                />
                              </th>
                              <th className="relative px-2 py-1.5 text-left text-[14px] font-semibold" style={{ width: childTableWidths[5] }}>
                                <button
                                  type="button"
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
                                  onClick={() => toggleChildStorySort("priority")}
                                >
                                  Priority
                                  {childStorySortKey === "priority" ? (
                                    childStorySortDir === "asc" ? (
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
                                  onPointerDown={(e) => onChildTableColResize(5, e)}
                                  aria-hidden
                                />
                              </th>
                              <th className="relative px-3 py-2 text-left text-[14px] font-semibold" style={{ width: childTableWidths[6] }}>
                                <button
                                  type="button"
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
                                  onClick={() => toggleChildStorySort("estimatedDays")}
                                >
                                  Est. days
                                  {childStorySortKey === "estimatedDays" ? (
                                    childStorySortDir === "asc" ? (
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
                                  onPointerDown={(e) => onChildTableColResize(6, e)}
                                  aria-hidden
                                />
                              </th>
                              <th className="relative px-3 py-2 text-left text-[14px] font-semibold" style={{ width: childTableWidths[7] }}>
                                <button
                                  type="button"
                                  className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left transition-colors hover:text-amber-200"
                                  onClick={() => toggleChildStorySort("daysLeft")}
                                >
                                  Days left
                                  {childStorySortKey === "daysLeft" ? (
                                    childStorySortDir === "asc" ? (
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
                                  onPointerDown={(e) => onChildTableColResize(7, e)}
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
                                    value={newChildTitle}
                                    onChange={(event) => setNewChildTitle(event.target.value)}
                                    placeholder="Add child user story title"
                                    autoComplete="off"
                                    spellCheck={false}
                                    data-1p-ignore="true"
                                    data-lpignore="true"
                                    data-form-type="other"
                                    className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-800"
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={async () => {
                                      const title = newChildTitle.trim();
                                      if (!epic || !title) return;
                                      // Prefer inline-create when wired; fall back to legacy popup flow.
                                      if (onCreateChildStoryQuick) {
                                        await onCreateChildStoryQuick(epic.id, title);
                                        setNewChildTitle("");
                                      } else if (onRequestCreateStory) {
                                        onRequestCreateStory(epic.id);
                                      }
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
                            {sortedEpicChildStories.map((story, rowIndex) => (
                              <tr
                                key={story.id}
                                className={cn(
                                  "border-t border-[#7cd3f7]/95 align-middle text-slate-700 transition hover:bg-[#c5ebff]",
                                  rowIndex % 2 === 0 ? "bg-white" : "bg-[#d8f2ff]",
                                )}
                              >
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
                                <td className="px-2 py-1.5 text-slate-800">
                                  {childEditingCell?.rowId === story.id && childEditingCell.field === "title" ? (
                                    <div className="relative z-20 flex items-center gap-1">
                                      <input value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-800" />
                                      <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded bg-white p-1 text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                      <button type="button" onClick={() => setChildEditingCell(null)} className="rounded bg-white p-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"><X className="size-3.5" /></button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => beginChildCellEdit(story.id, "title")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                      {childStoryDrafts[story.id]?.title ?? story.title}
                                    </button>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 text-slate-600">
                                  {childEditingCell?.rowId === story.id && childEditingCell.field === "sprint" ? (
                                    <div className="relative z-20 flex items-center gap-1">
                                      <input
                                        ref={sprintInputRef}
                                        value={childEditingValue}
                                        onChange={(event) => {
                                          setChildEditingValue(event.target.value);
                                          setIsSprintAutocompleteOpen(true);
                                          updateSprintAutocompletePosition();
                                        }}
                                        onFocus={() => {
                                          setIsSprintAutocompleteOpen(true);
                                          updateSprintAutocompletePosition();
                                        }}
                                        onBlur={() => {
                                          window.setTimeout(() => setIsSprintAutocompleteOpen(false), 120);
                                        }}
                                        placeholder="Sprint 1-24"
                                        className="w-[7.25rem] rounded-md border bg-white px-2 py-1 text-xs text-slate-700"
                                      />
                                      <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded bg-white p-1 text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setChildEditingCell(null);
                                          setIsSprintAutocompleteOpen(false);
                                          setSprintAutocompletePosition(null);
                                        }}
                                        className="rounded bg-white p-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"
                                      >
                                        <X className="size-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => beginChildCellEdit(story.id, "sprint")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                      {(() => {
                                        const sprint = parseSprintDraftValue(childStoryDrafts[story.id]?.sprint ?? "");
                                        return sprint != null ? `Sprint ${sprint}` : "Not set";
                                      })()}
                                    </button>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {childEditingCell?.rowId === story.id && childEditingCell.field === "status" ? (
                                    <div className="relative z-20 flex items-center gap-1">
                                      <select
                                        value={childEditingValue}
                                        onChange={(event) => setChildEditingValue(event.target.value)}
                                        className="w-[7rem] min-w-[7rem] rounded-md border bg-white px-2 py-1 text-xs text-slate-700"
                                      >
                                        <option value="todo">To Do</option>
                                        <option value="inProgress">In Progress</option>
                                        <option value="done">Done</option>
                                        <option value="approved">Approved</option>
                                      </select>
                                      <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded bg-white p-1 text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                      <button type="button" onClick={() => setChildEditingCell(null)} className="rounded bg-white p-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"><X className="size-3.5" /></button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => beginChildCellEdit(story.id, "status")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                      <span
                                        className={cn(
                                          "inline-flex items-center whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.04em]",
                                          statusTone[childStoryDrafts[story.id]?.status ?? story.status] ?? "bg-muted text-muted-foreground",
                                        )}
                                      >
                                        {storyStatusLabel[childStoryDrafts[story.id]?.status ?? story.status] ?? (childStoryDrafts[story.id]?.status ?? story.status)}
                                      </span>
                                    </button>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-slate-600">
                                  {childEditingCell?.rowId === story.id && childEditingCell.field === "assignee" ? (
                                    <div className="relative z-20 flex min-w-0 flex-1 items-center gap-1">
                                      <AssigneeCombobox
                                        value={childEditingValue}
                                        onChange={setChildEditingValue}
                                        suggestions={assigneeNameSuggestions}
                                        placeholder="Assignee"
                                        className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-xs text-slate-700"
                                      />
                                      <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded bg-white p-1 text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                      <button type="button" onClick={() => setChildEditingCell(null)} className="rounded bg-white p-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"><X className="size-3.5" /></button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => beginChildCellEdit(story.id, "assignee")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                      {(childStoryDrafts[story.id]?.assignee ?? story.assignee)?.trim() || "Unassigned"}
                                    </button>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 text-slate-600">
                                  {childEditingCell?.rowId === story.id && childEditingCell.field === "priority" ? (
                                    <div className="relative z-20 flex items-center gap-1">
                                      <select
                                        value={childEditingValue}
                                        onChange={(event) => setChildEditingValue(event.target.value)}
                                        className="w-[6rem] min-w-[6rem] rounded-md border bg-white px-2 py-1 text-xs text-slate-700"
                                      >
                                        <option value="">Not set</option>
                                        <option value="P0">P0</option>
                                        <option value="P1">P1</option>
                                        <option value="P2">P2</option>
                                        <option value="P3">P3</option>
                                      </select>
                                      <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded bg-white p-1 text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                      <button type="button" onClick={() => setChildEditingCell(null)} className="rounded bg-white p-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"><X className="size-3.5" /></button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => beginChildCellEdit(story.id, "priority")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                      {childStoryDrafts[story.id]?.priority?.trim() || "Not set"}
                                    </button>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-slate-700">
                                  {childEditingCell?.rowId === story.id && childEditingCell.field === "estimatedDays" ? (
                                    <div className="relative z-20 flex items-center gap-1">
                                      <input type="number" min={0} value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-[3.5rem] rounded-md border bg-white px-1.5 py-1 text-xs text-slate-700" />
                                      <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded bg-white p-1 text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                      <button type="button" onClick={() => setChildEditingCell(null)} className="rounded bg-white p-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"><X className="size-3.5" /></button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => beginChildCellEdit(story.id, "estimatedDays")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                      {childStoryDrafts[story.id]?.estimatedDays || "-"}
                                    </button>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-slate-700">
                                  {childEditingCell?.rowId === story.id && childEditingCell.field === "daysLeft" ? (
                                    <div className="relative z-20 flex items-center gap-1">
                                      <input type="number" min={0} value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-[3.5rem] rounded-md border bg-white px-1.5 py-1 text-xs text-slate-700" />
                                      <button type="button" onClick={() => void confirmChildCellEdit(story.id)} className="rounded bg-white p-1 text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                      <button type="button" onClick={() => setChildEditingCell(null)} className="rounded bg-white p-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"><X className="size-3.5" /></button>
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
              <button
                type="button"
                onClick={() => setActivityOpen((v) => !v)}
                aria-expanded={activityOpen}
                className="group flex w-full items-center justify-between gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <span className="flex items-center gap-2 text-lg font-semibold text-slate-800 transition-colors group-hover:text-indigo-600">
                  <ChevronDown
                    className={cn("size-5 shrink-0 text-slate-500 transition-transform", !activityOpen && "-rotate-90")}
                    aria-hidden
                  />
                  <ActivityIcon className="size-5 shrink-0 text-slate-500" aria-hidden />
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
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  {!epic ? (
                    <p className="text-sm text-slate-500">Save this epic first to add comments and history.</p>
                  ) : activityTab === "comments" ? (
                    <>
                      <div className="min-h-0 max-h-[40%] shrink space-y-2 overflow-y-auto">
                        {(epic.comments ?? []).length === 0 ? (
                          <p className="text-sm text-slate-500">No comments yet.</p>
                        ) : (
                          epic.comments.map((comment) => (
                            <div
                              key={comment.id}
                              className="rounded-md bg-white p-2 text-sm ring-1 ring-slate-200"
                            >
                              <p className="text-[12px] text-slate-500">
                                {comment.author ?? "Planner"} - {new Date(comment.createdAt).toLocaleString()}
                              </p>
                              <RichCommentBody body={comment.body} className="mt-1" />
                            </div>
                          ))
                        )}
                      </div>
                      <ActivityCommentComposer
                        key={`${open}-${epic.id}-comment`}
                        onSubmit={(html) => handleAddComment(html)}
                        disabled={isAddingComment}
                      />
                    </>
                  ) : (
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
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
              ) : null}
            </section>
            </div>

          </div>
        </div>
      </div>
      {typeof document !== "undefined" &&
      isSprintAutocompleteOpen &&
      filteredSprintAutocompleteOptions.length > 0 &&
      sprintAutocompletePosition != null
        ? createPortal(
            <div
              className="fixed z-[220] max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg"
              style={{
                left: sprintAutocompletePosition.left,
                top: sprintAutocompletePosition.top,
                width: sprintAutocompletePosition.width,
              }}
            >
              {filteredSprintAutocompleteOptions.map((sprintNo) => (
                <button
                  key={sprintNo}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setChildEditingValue(`Sprint ${sprintNo}`);
                    setIsSprintAutocompleteOpen(false);
                  }}
                  className="block w-full rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                >
                  Sprint {sprintNo}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
      {pendingDelete && epic && (
        <EpicDeleteDialog
          epic={epic}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(false)}
          deleting={isDeleting}
        />
      )}
    </div>
  );
}
