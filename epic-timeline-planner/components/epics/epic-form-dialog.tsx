"use client";

import {
  Activity as ActivityIcon,
  BarChart3,
  ArrowUpDown,
  Bold,
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
  MessageSquare,
  Quote,
  Tag,
  Trash,
  Type,
  Underline as UnderlineIcon,
  UserRound,
  X,
} from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { createPortal } from "react-dom";

import { ActivityCommentComposer } from "@/components/ui/activity-comment-composer";
import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { InitiativeCombobox } from "@/components/ui/initiative-combobox";
import { TeamIdCombobox, blurActiveField } from "@/components/ui/team-id-combobox";
import { Button } from "@/components/ui/button";
import { RichCommentBody } from "@/components/ui/rich-comment-body";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { MonthAnalytics } from "@/components/timeline/month-analytics";
import { collectAssigneeNameSuggestions } from "@/lib/delivery-assignees";
import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { MONTHS } from "@/lib/timeline";
import { normalizeWorkspaceUserTeam, teamLabelForWorkspaceUser } from "@/lib/workspace-users";
import { useResizableTableColumns } from "@/lib/use-resizable-table-columns";
import { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";
import { useDialogPresence } from "@/lib/use-dialog-presence";
import { planningDetailPanelAnchorStyle, usePlanningSurfaceRect } from "@/lib/use-planning-surface-rect";
import { cn } from "@/lib/utils";
import { sprintEndDate, YEAR_SPRINT_MAX } from "@/lib/year-sprint";
import { EpicPlanBarIcon } from "@/components/timeline/epic-plan-bar";

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
  }) => Promise<void> | void;
  onDelete?: (epicId: string) => Promise<void> | void;
  storyRefById?: Record<string, string>;
  onRequestCreateStory?: (epicId: string) => void;
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
  onExitComplete?: () => void;
  surfaceAnchorRef?: RefObject<HTMLElement | null>;
  /** Users directory — custom team slugs appear in the team combobox alongside delivery teams. */
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  /** Insights scope pre-selection read from URL (epic or initiative id). */
  initialInsightsScopeEpicId?: string | null;
  initialInsightsScopeInitId?: string | null;
  /** Called when the insights scope selection changes so the parent can persist to URL. */
  onInsightsScopeChange?: (epicId: string | null, initId: string | null) => void;
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
  onCreateInitiativeQuick,
  onPatchStory,
  onAddComment,
  surfaceAnchorRef,
  workspaceDirectoryUsers = [],
  initialInsightsScopeEpicId,
  initialInsightsScopeInitId,
  onInsightsScopeChange,
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
  const [planMonthDraft, setPlanMonthDraft] = useState("");
  const [teamDraft, setTeamDraft] = useState("");
  const [forceTeamFieldEdit, setForceTeamFieldEdit] = useState(false);
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [activityOpen, setActivityOpen] = useState(() => (epic?.userStories?.length ?? 0) === 0);
  const [descriptionAccordionOpen, setDescriptionAccordionOpen] = useState(true);
  const [labelsDraft, setLabelsDraft] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [labelsAutocompleteOpen, setLabelsAutocompleteOpen] = useState(false);
  const [labelsAutocompleteIndex, setLabelsAutocompleteIndex] = useState(-1);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [epicInsightsPanelOpen, setEpicInsightsPanelOpen] = useState(false);
  const [insightsScopeLabel, setInsightsScopeLabel] = useState<string | null>(null);
  const [dialogWidthVw, setDialogWidthVw] = useState(64);
  const [epicInsightsPanelOffset, setEpicInsightsPanelOffset] = useState({ x: 0, y: 0 });
  const [epicInsightsPanelWidthPx, setEpicInsightsPanelWidthPx] = useState(560);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const [isDraggingDialog, setIsDraggingDialog] = useState(false);
  const [detailsPanelWidthPx, setDetailsPanelWidthPx] = useState(296);
  const [activityPanelHeightPx, setActivityPanelHeightPx] = useState(340);
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
      if (epic.planStartMonth != null) {
        setPlanMonthDraft(MONTHS[epic.planStartMonth - 1] ?? "");
      } else {
        setPlanMonthDraft("");
      }
    } else if (init?.startMonth != null) {
      setPlanQuarterDraft(`Q${quarterNumFromMonth(init.startMonth)}`);
      setPlanMonthDraft(MONTHS[init.startMonth - 1] ?? "");
    } else {
      setPlanQuarterDraft("");
      setPlanMonthDraft("");
    }
    setForceTeamFieldEdit(false);
    setTeamDraft(epic?.team ? normalizeWorkspaceUserTeam(epic.team) : "");
    setActivityTab("comments");
    setActivityOpen((epic?.userStories?.length ?? 0) === 0);
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
      setDetailsPanelWidthPx(296);
      setActivityPanelHeightPx(340);
      setActivityOpen((epic?.userStories?.length ?? 0) === 0);
      setDescriptionAccordionOpen(true);
      setEpicInsightsPanelOpen(false);
      setEpicInsightsPanelOffset({ x: 0, y: 0 });
      const epicPanelWidth = Math.min(window.innerWidth * 0.75, 1320);
      const available = Math.max(520, Math.floor(window.innerWidth - epicPanelWidth));
      setEpicInsightsPanelWidthPx(available);
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
  const assigneeNameSuggestions = useMemo(() => collectAssigneeNameSuggestions(initiatives), [initiatives]);
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
  const epicInsightsMonth = epic?.planStartMonth ?? selectedInitiative?.startMonth ?? 1;
  const epicInsightsQuarter = quarterNumFromMonth(epicInsightsMonth);
  const epicInsightsMonths = monthIndicesForQuarter(epicInsightsQuarter);
  const epicInsightsPlanYear = selectedInitiative?.year ?? epic?.planYear ?? initiatives[0]?.year ?? new Date().getFullYear();
  const epicScopedInitiativesForInsights = useMemo(() => {
    if (!epic) return [];
    return initiatives
      .map((initiative) =>
        initiative.id === epic.initiativeId
          ? { ...initiative, epics: (initiative.epics ?? []).filter((row) => row.id === epic.id) }
          : { ...initiative, epics: [] },
      )
      .filter((initiative) => (initiative.epics ?? []).length > 0);
  }, [epic, initiatives]);
  const getEpicDetailsSeparatorX = useCallback(() => {
    const rect = dialogShellRef.current?.getBoundingClientRect();
    if (!rect) return window.innerWidth;
    const visualLeft = rect.left + dialogOffset.x;
    const separatorX = visualLeft + rect.width - detailsPanelWidthPx - 44;
    return Math.max(0, Math.min(window.innerWidth, separatorX));
  }, [dialogOffset.x, detailsPanelWidthPx]);

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
      const monthIdx = planMonthDraft.trim() === "" ? -1 : MONTHS.indexOf(planMonthDraft as (typeof MONTHS)[number]);
      const planStartMonth = monthIdx >= 0 ? monthIdx + 1 : null;
      const planEndMonth = planStartMonth;
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

  function beginEpicInsightsDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!epicInsightsPanelOpen || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startOffset = epicInsightsPanelOffset;

    function onPointerMove(moveEvent: PointerEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const separatorX = getEpicDetailsSeparatorX();
      const maxX = Math.max(0, separatorX - epicInsightsPanelWidthPx);
      const maxY = Math.max(0, window.innerHeight - 180);
      setEpicInsightsPanelOffset({
        x: Math.max(0, Math.min(maxX, startOffset.x + dx)),
        y: Math.max(0, Math.min(maxY, startOffset.y + dy)),
      });
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function beginEpicInsightsResizeRight(event: React.PointerEvent<HTMLDivElement>) {
    if (!epicInsightsPanelOpen || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = epicInsightsPanelWidthPx;
    const currentLeft = epicInsightsPanelOffset.x;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      const separatorX = getEpicDetailsSeparatorX();
      const maxWidth = Math.max(520, separatorX - currentLeft);
      const next = Math.max(520, Math.min(maxWidth, startWidth + delta));
      setEpicInsightsPanelWidthPx(next);
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function beginEpicInsightsResizeLeft(event: React.PointerEvent<HTMLDivElement>) {
    if (!epicInsightsPanelOpen || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = epicInsightsPanelWidthPx;
    const startLeft = epicInsightsPanelOffset.x;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      const separatorX = getEpicDetailsSeparatorX();
      const nextLeft = startLeft + delta;
      const boundedLeft = Math.max(0, Math.min(separatorX - 520, nextLeft));
      const adjustedDelta = boundedLeft - startLeft;
      const nextWidth = startWidth - adjustedDelta;
      const maxWidth = Math.max(520, separatorX - boundedLeft);
      const boundedWidth = Math.max(520, Math.min(maxWidth, nextWidth));
      setEpicInsightsPanelOffset((prev) => ({ ...prev, x: boundedLeft }));
      setEpicInsightsPanelWidthPx(boundedWidth);
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
              {epicInsightsPanelOpen && insightsScopeLabel ? (
                <>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" />
                  <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-base font-medium text-indigo-700">
                    <BarChart3 className="size-4 shrink-0 text-indigo-500" aria-hidden />
                    <span className="truncate">{insightsScopeLabel}</span>
                  </span>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {epic ? (
                <Button
                  size="icon-sm"
                  variant={epicInsightsPanelOpen ? "secondary" : "ghost"}
                  onClick={() =>
                    setEpicInsightsPanelOpen((prev) => {
                      if (!prev) {
                        const initialWidth = Math.max(520, Math.min(Math.round(window.innerWidth * 0.80), window.innerWidth - 48));
                        const initialLeft = Math.round((window.innerWidth - initialWidth) / 2);
                        setEpicInsightsPanelOffset({ x: initialLeft, y: 0 });
                        setEpicInsightsPanelWidthPx(initialWidth);
                      }
                      return !prev;
                    })
                  }
                  aria-label={epicInsightsPanelOpen ? "Close epic insights panel" : "Open epic insights panel"}
                  title="Epic insights"
                  className="text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800"
                >
                  <BarChart3 className="size-4" />
                </Button>
              ) : null}
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
                className="h-8 min-w-[100px] border-0 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? "Saving…" : epic ? "Save" : "Create"}
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close epic details">
                <X />
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              <div
                ref={splitLayoutRef}
                className="grid h-full min-h-0 gap-0"
                style={{ gridTemplateColumns: `minmax(0,1fr) 10px ${detailsPanelWidthPx}px` }}
              >
              <section className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overflow-x-hidden rounded-xl border-0 bg-white p-4 [scrollbar-gutter:stable]">
                <label className="block shrink-0 space-y-1">
                  <p className="flex shrink-0 items-center gap-2 text-base font-normal text-slate-800">
                    <Type className="size-4 shrink-0 text-slate-500" aria-hidden />
                    Title
                  </p>
                  <div className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-slate-300/70">
                    <input
                      className="w-full bg-transparent px-3 py-2 text-base outline-none"
                      placeholder="Epic title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </div>
                </label>

                <div className="mt-4 flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    id="epic-form-description-accordion-trigger"
                    aria-expanded={descriptionAccordionOpen}
                    aria-controls="epic-form-description-accordion-panel"
                    onClick={() => setDescriptionAccordionOpen((v) => !v)}
                    className="-ml-1 flex w-full items-center gap-2 rounded-md py-1 text-left text-base font-normal text-slate-800 transition-colors hover:bg-slate-100/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/60"
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
                    id="epic-form-description-accordion-panel"
                    role="region"
                    aria-labelledby="epic-form-description-accordion-trigger"
                    hidden={!descriptionAccordionOpen}
                    className="flex flex-col gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200"
                  >
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
                    <div className="min-h-[14rem] rounded-md px-1 py-2">
                      <EditorContent
                        editor={descriptionEditor}
                        className="focus:outline-none [&_.ProseMirror]:min-h-[12rem] [&_.ProseMirror]:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <section className="mt-5 flex shrink-0 flex-col gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                  <div className="flex shrink-0 items-center justify-between">
                    <h3 className="flex items-center gap-2 text-base font-normal text-slate-800">
                      <ListTree className="size-4 shrink-0 text-slate-500" aria-hidden />
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
                        {(epic.userStories ?? []).length === 0 ? (
                          <p className="rounded-md bg-white p-2 text-sm text-slate-600 ring-1 ring-slate-200">
                            No user stories yet.
                          </p>
                        ) : (
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
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
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
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
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
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
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
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
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
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
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
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
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
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
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
                                      className="group/col-sort flex w-full min-w-0 items-center gap-0.5 pr-2 text-left hover:text-slate-900"
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
                        )}
                      </div>
                    </>
                  )}
                </section>
              </section>

              <div className="relative mx-1.5">
                <div
                  className="group absolute inset-y-0 left-1/2 flex w-3 -translate-x-[calc(50%+2px)] cursor-col-resize items-stretch justify-center"
                  onPointerDown={beginDetailsPanelResize}
                  title="Resize details panel"
                  aria-label="Resize details panel"
                  role="separator"
                >
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
                  <p className="text-[15px] font-normal text-slate-700">Parent</p>
                  <InitiativeCombobox
                    valueId={initiativeId}
                    onValueChange={(next) => {
                      setInitiativeId(next);
                      if (epic) return;
                      const nextInit = initiatives.find((i) => i.id === next);
                      if (nextInit?.startMonth != null) {
                        setPlanQuarterDraft(`Q${quarterNumFromMonth(nextInit.startMonth)}`);
                        setPlanMonthDraft(MONTHS[nextInit.startMonth - 1] ?? "");
                      } else {
                        setPlanQuarterDraft("");
                        setPlanMonthDraft("");
                      }
                    }}
                    options={initiativeOptions.map((o) => ({ id: o.id, title: o.label }))}
                    onCreateNew={onCreateInitiativeQuick}
                    disabled={isSaving}
                    placeholder="Search, pick, or create an initiative"
                    aria-label="Parent initiative"
                    className="h-7 w-full min-w-0 rounded-md border border-slate-300 bg-white px-1.5 text-[14px] text-slate-800"
                  />
                </label>
                <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Team</p>
                  <div className="group/team relative flex min-w-0 w-full items-center">
                    <TeamIdCombobox
                      teamId={teamDraft}
                      onTeamIdChange={setTeamDraft}
                      allowCustomTeam
                      extraTeamIds={directoryExtraTeamIds}
                      placeholder="Type or pick a team"
                      className="h-7 w-full rounded-md border border-slate-300 bg-white px-1.5 text-[14px] text-slate-800"
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
                    className="h-6 w-full rounded-md border border-slate-300 bg-white px-1.5 text-[14px] text-slate-800"
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
                    className="h-6 w-full rounded-md border border-slate-300 bg-white px-1.5 text-[14px] font-medium text-slate-700"
                  />
                </label>
                <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Year</p>
                  <input readOnly value={planningYearDisplay} title="Year comes from the parent initiative" className="h-7 w-full rounded-md border border-slate-300 bg-white px-2 text-[14px] text-slate-800" />
                </div>
                <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Quarter</p>
                  <select value={planQuarterDraft} onChange={(event) => { const nextQ = event.target.value; setPlanQuarterDraft(nextQ); if (!planMonthDraft) return; const allowed = monthIndicesForQuarter(parseQuarterSelect(nextQ)).map((i) => MONTHS[i - 1]); if (!allowed.includes(planMonthDraft as (typeof MONTHS)[number])) { setPlanMonthDraft(""); } }} className="h-7 w-full rounded-md border border-slate-300 bg-white px-2 text-[14px] text-slate-800"><option value="">Not set</option><option value="Q1">Q1</option><option value="Q2">Q2</option><option value="Q3">Q3</option><option value="Q4">Q4</option></select>
                </div>
                <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Month</p>
                  <select value={planMonthDraft} onChange={(event) => { const name = event.target.value; setPlanMonthDraft(name); if (!name) return; const idx = MONTHS.indexOf(name as (typeof MONTHS)[number]); if (idx >= 0) { setPlanQuarterDraft(`Q${quarterNumFromMonth(idx + 1)}`); } }} className="h-7 w-full rounded-md border border-slate-300 bg-white px-2 text-[14px] text-slate-800"><option value="">Not set</option>{allowedMonthNames.map((month) => (<option key={month} value={month}>{month}</option>))}</select>
                </div>
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

          <div className="relative z-0 mt-0 shrink-0">
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
                "flex min-h-0 flex-col rounded-xl bg-white",
                activityOpen ? "space-y-3 p-3" : "p-3",
              )}
              style={
                activityOpen
                  ? { height: `${hasChildren ? Math.max(180, Math.min(440, activityPanelHeightPx - 40)) : activityPanelHeightPx}px` }
                  : undefined
              }
            >
              <div
                role="button"
                tabIndex={0}
                className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg text-left outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-slate-400"
                onClick={() => {
                  setActivityOpen((wasOpen) => {
                    if (!wasOpen) {
                      setActivityPanelHeightPx((h) => Math.min(560, h + 96));
                    }
                    return !wasOpen;
                  });
                }}
                aria-expanded={activityOpen}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActivityOpen((wasOpen) => { if (!wasOpen) setActivityPanelHeightPx((h) => Math.min(560, h + 96)); return !wasOpen; }); } }}
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
              </div>

              {activityOpen ? (
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
              ) : null}
            </section>
          </div>
          </div>
        </div>
      </div>
      <div
        className={cn(
          "fixed left-0 top-0 z-[60] border-l border-slate-200/90 bg-white shadow-2xl transition-transform duration-300",
          !epicInsightsPanelOpen && "pointer-events-none",
        )}
        style={{
          left: epicInsightsPanelOffset.x,
          top: epicInsightsPanelOffset.y,
          width: epicInsightsPanelWidthPx,
          height: `calc(80vh - ${epicInsightsPanelOffset.y}px)`,
          transform: epicInsightsPanelOpen
            ? "translateX(0)"
            : "translateX(100vw)",
        }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div
            className="flex cursor-move items-center justify-between border-b border-slate-200/90 px-8 py-4"
            onPointerDown={beginEpicInsightsDrag}
          >
            <div className="inline-flex items-center gap-3 text-2xl font-bold text-slate-800">
              <BarChart3 className="size-6 text-indigo-600" aria-hidden />
              Epic Insights · {`Q${epicInsightsQuarter}`}{epic?.title ? <span className="text-slate-400 font-normal"> ({epic.title})</span> : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setEpicInsightsPanelOpen(false)}
              aria-label="Close epic insights"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-4">
            {epic ? (
              <MonthAnalytics
                initiatives={epicScopedInitiativesForInsights}
                month={epicInsightsMonth}
                periodMonths={epicInsightsMonths}
                periodLabel={`Q${epicInsightsQuarter}`}
                planYear={epicInsightsPlanYear}
                initialSelectedEpicId={initialInsightsScopeEpicId ?? epic.id}
                initialSelectedInitiativeId={initialInsightsScopeInitId ?? undefined}
                onOpenEpic={() => {
                  setEpicInsightsPanelOpen(false);
                }}
                onOpenStory={onOpenStory}
                onScopeChange={(type, id, label) => {
                  setInsightsScopeLabel(label);
                  onInsightsScopeChange?.(
                    type === "epic" ? id : null,
                    type === "initiative" ? id : null,
                  );
                }}
              />
            ) : (
              <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                Save this epic first to view insights.
              </p>
            )}
          </div>
        </div>
        <div
          className="absolute inset-y-0 left-0 w-2.5 cursor-col-resize bg-transparent hover:bg-indigo-200/40"
          onPointerDown={beginEpicInsightsResizeLeft}
          aria-label="Resize epic insights panel from left"
          role="separator"
        />
        <div
          className="absolute inset-y-0 right-0 w-2.5 cursor-col-resize bg-transparent hover:bg-indigo-200/40"
          onPointerDown={beginEpicInsightsResizeRight}
          aria-label="Resize epic insights panel from right"
          role="separator"
        />
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
    </div>
  );
}
