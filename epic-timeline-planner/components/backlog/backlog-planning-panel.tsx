"use client";

import { Check, ClipboardList, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, FileText, FolderKanban, Pencil, Plus, Search, Target, X } from "lucide-react";
import { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type BacklogPlanningPanelProps = {
  initiatives: InitiativeItem[];
  storyRefById: Record<string, string>;
  onOpenInitiative: (initiativeId: string) => void;
  onOpenEpic: (epicId: string) => void;
  onOpenStory: (storyId: string) => void;
  onCreateInitiativeQuick: (title: string) => Promise<void>;
  onCreateEpicQuick: (initiativeId: string, title: string) => Promise<void>;
  onCreateStoryQuick: (epicId: string, title: string) => Promise<void>;
  onPatchStoryQuick: (
    storyId: string,
    patch: Partial<{
      title: string;
      status: "todo" | "inProgress" | "done" | "approved";
      sprint: number | null;
      assignee: string | null;
      estimatedDays: number | null;
      daysLeft: number | null;
    }>,
  ) => Promise<void>;
  onPatchInitiativeQuick: (initiativeId: string, patch: { assignee?: string | null; title?: string }) => Promise<void>;
  onPatchEpicQuick: (epicId: string, patch: { assignee?: string | null; title?: string }) => Promise<void>;
};

type OptionItem = { id: string; label: string };
type CreateKind = "initiative" | "epic" | "story";
type CreateScope = "initiative" | "epic" | "story";
type BacklogColumnKey =
  | "workItem"
  | "year"
  | "quarter"
  | "month"
  | "status"
  | "sprint"
  | "assignee"
  | "estDays"
  | "daysLeft"
  | "progress";
type GroupLevel = "year" | "quarter" | "month" | "sprint";
type WorkflowStatus = "todo" | "inProgress" | "done" | "approved";
type InlineEditableStoryField = "status" | "sprint" | "assignee" | "estimatedDays" | "daysLeft";
type WorkItemKindFilter = "initiative" | "epic" | "story";

const BACKLOG_COLUMN_ORDER: BacklogColumnKey[] = [
  "workItem",
  "year",
  "quarter",
  "month",
  "status",
  "sprint",
  "assignee",
  "estDays",
  "daysLeft",
  "progress",
];

const BACKLOG_COLUMN_LABELS: Record<BacklogColumnKey, string> = {
  workItem: "Work item",
  year: "Year",
  quarter: "Quarter",
  month: "Month",
  status: "Status",
  sprint: "Sprint",
  assignee: "Assignee",
  estDays: "Est Days",
  daysLeft: "Days Left",
  progress: "Progress",
};

const BACKLOG_COLUMN_MIN_WIDTHS: Record<BacklogColumnKey, number> = {
  workItem: 300,
  year: 72,
  quarter: 52,
  month: 80,
  status: 100,
  sprint: 90,
  assignee: 120,
  estDays: 90,
  daysLeft: 90,
  progress: 180,
};

const BACKLOG_COLUMN_DEFAULT_WIDTHS: Record<BacklogColumnKey, number> = {
  workItem: 420,
  year: 96,
  quarter: 72,
  month: 120,
  status: 168,
  sprint: 148,
  assignee: 190,
  estDays: 128,
  daysLeft: 128,
  progress: 220,
};

const BACKLOG_COLUMN_WIDTHS_STORAGE_KEY = "epic-planner.backlog.column-widths.v1";
const BACKLOG_VIEW_STATE_STORAGE_KEY = "epic-planner.backlog.view-state.v1";
const CENTER_ALIGNED_BACKLOG_COLUMNS = new Set<BacklogColumnKey>([
  "year",
  "quarter",
  "month",
  "status",
  "sprint",
  "assignee",
  "estDays",
  "daysLeft",
  "progress",
]);
const GROUP_LEVEL_ORDER: GroupLevel[] = ["year", "quarter", "month", "sprint"];
const GROUP_LEVEL_LABELS: Record<GroupLevel, string> = {
  year: "Year",
  quarter: "Quarter",
  month: "Month",
  sprint: "Sprint",
};

function statusChip(status: string) {
  if (status === "approved") return "bg-violet-100 text-violet-700";
  if (status === "done") return "bg-emerald-100 text-emerald-700";
  if (status === "inProgress") return "bg-blue-100 text-blue-700";
  return "bg-amber-100 text-amber-700";
}

function sprintLabel(sprint: number | null) {
  return sprint == null ? "Unscheduled" : `Sprint ${sprint}`;
}

function quarterFromMonth(month: number | null | undefined): string {
  if (month == null) return "-";
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

function monthLabel(month: number | null | undefined): string {
  if (month == null) return "-";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
  return months[month - 1] ?? "-";
}

function quarterRange(quarter: string): { start: number; end: number } | null {
  if (quarter === "Q1") return { start: 1, end: 3 };
  if (quarter === "Q2") return { start: 4, end: 6 };
  if (quarter === "Q3") return { start: 7, end: 9 };
  if (quarter === "Q4") return { start: 10, end: 12 };
  return null;
}

function matchesAnySelectedQuarterByRange(
  selectedQuarters: string[],
  startMonth: number | null | undefined,
  endMonth: number | null | undefined,
): boolean {
  if (selectedQuarters.length === 0) return true;
  if (startMonth == null && endMonth == null) return false;
  const normalizedStart = startMonth ?? endMonth ?? null;
  const normalizedEnd = endMonth ?? startMonth ?? null;
  if (normalizedStart == null || normalizedEnd == null) return false;
  const rangeStart = Math.min(normalizedStart, normalizedEnd);
  const rangeEnd = Math.max(normalizedStart, normalizedEnd);
  return selectedQuarters.some((quarter) => {
    const qRange = quarterRange(quarter);
    if (!qRange) return false;
    return !(qRange.end < rangeStart || qRange.start > rangeEnd);
  });
}

function sumStoryDays(stories: Array<{ estimatedDays?: number | null; daysLeft?: number | null }>) {
  return stories.reduce(
    (acc, story) => {
      acc.estimated += story.estimatedDays ?? 0;
      acc.left += story.daysLeft ?? 0;
      return acc;
    },
    { estimated: 0, left: 0 },
  );
}

function completionFromStories(stories: Array<{ status: string }>) {
  const total = stories.length;
  const finished = stories.filter((story) => story.status === "done" || story.status === "approved").length;
  const percent = total === 0 ? 0 : Math.round((finished / total) * 100);
  return { finished, total, percent };
}

function storyCompletion(story: { status: string; estimatedDays?: number | null; daysLeft?: number | null }) {
  const estimated = story.estimatedDays ?? 0;
  const left = story.daysLeft ?? 0;
  if (estimated > 0) {
    const percent = Math.max(0, Math.min(100, Math.round(((estimated - left) / estimated) * 100)));
    return { label: `${Math.max(0, estimated - left)}/${estimated}`, percent };
  }
  if (story.status === "approved" || story.status === "done") return { label: "Done", percent: 100 };
  if (story.status === "inProgress") return { label: "In progress", percent: 50 };
  return { label: "To do", percent: 0 };
}

function rollupWorkflowStatus(stories: Array<{ status: string }>): WorkflowStatus {
  if (stories.length === 0) return "todo";
  const statuses = stories.map((story) => story.status);
  if (statuses.every((status) => status === "approved")) return "approved";
  if (statuses.every((status) => status === "done" || status === "approved")) return "done";
  if (statuses.some((status) => status === "inProgress" || status === "done" || status === "approved")) return "inProgress";
  return "todo";
}

function rollupWorkflowStatusFromGroupedRows(rows: Array<{ storyStatus: string }>): WorkflowStatus {
  return rollupWorkflowStatus(rows.map((row) => ({ status: row.storyStatus })));
}

function workflowStatusLabel(status: WorkflowStatus): string {
  if (status === "inProgress") return "In progress";
  if (status === "todo") return "To do";
  return status;
}

function MultiCheckboxFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: OptionItem[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allSelected = selected.length === 0;
  const selectedLabel =
    allSelected
      ? "All"
      : selected.length === 1
        ? options.find((option) => option.id === selected[0])?.label ?? "1 selected"
        : `${selected.length} selected`;
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  function scheduleClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 180);
  }

  function cancelScheduledClose() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  return (
    <div className="group relative" onMouseEnter={cancelScheduledClose} onMouseLeave={scheduleClose}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex h-8 min-w-[8.75rem] cursor-pointer items-center justify-between rounded-lg bg-gradient-to-b from-white to-slate-50 px-2.5 text-[13px] ring-1 ring-slate-300/80 outline-none shadow-sm transition hover:from-slate-50 hover:to-slate-100 hover:ring-slate-400/80"
      >
        <span className="font-medium text-slate-700">{label}: </span>
        <span className="ml-1 truncate text-slate-600">{selectedLabel}</span>
      </button>
      {isOpen ? (
        <div className="absolute z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
        <label className="mb-1 flex items-center gap-2 text-[14px] text-slate-700">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onChange([])}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          All
        </label>
        <div className="max-h-44 space-y-1 overflow-auto pr-1">
          {options.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-[14px] text-slate-700">
              <input
                type="checkbox"
                checked={allSelected || selected.includes(option.id)}
                onChange={() => {
                  const next = allSelected
                    ? [option.id]
                    : selected.includes(option.id)
                      ? selected.filter((x) => x !== option.id)
                      : [...selected, option.id];
                  onChange(next);
                }}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              {option.label}
            </label>
          ))}
        </div>
        </div>
      ) : null}
    </div>
  );
}

export function BacklogPlanningPanel({
  initiatives,
  storyRefById,
  onOpenInitiative,
  onOpenEpic,
  onOpenStory,
  onCreateInitiativeQuick,
  onCreateEpicQuick,
  onCreateStoryQuick,
  onPatchStoryQuick,
  onPatchInitiativeQuick,
  onPatchEpicQuick,
}: BacklogPlanningPanelProps) {
  const [query, setQuery] = useState("");
  const [openInitiatives, setOpenInitiatives] = useState<Record<string, boolean>>({});
  const [openEpics, setOpenEpics] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [sprintFilter, setSprintFilter] = useState<string[]>([]);
  const [yearFilter, setYearFilter] = useState<string[]>([]);
  const [quarterFilter, setQuarterFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [workItemFilter, setWorkItemFilter] = useState<WorkItemKindFilter[]>([]);
  const [sortBy, setSortBy] = useState<"titleAsc" | "titleDesc" | "assigneeAsc" | "estDesc" | "leftDesc" | "status">(
    "titleAsc",
  );
  const [openCreateMenuKey, setOpenCreateMenuKey] = useState<string | null>(null);
  const [createDraftTitle, setCreateDraftTitle] = useState("");
  const [createSelection, setCreateSelection] = useState<{
    anchorKey: string;
    scope: CreateScope;
    kind: CreateKind;
    initiativeId?: string;
    epicId?: string;
  } | null>(null);
  const [storyTargetEpicId, setStoryTargetEpicId] = useState("");
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const [groupLevels, setGroupLevels] = useState<GroupLevel[]>([]);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [openGroupFolders, setOpenGroupFolders] = useState<Record<string, boolean>>({});
  const [defaultTreeExpanded, setDefaultTreeExpanded] = useState(true);
  const [defaultGroupExpanded, setDefaultGroupExpanded] = useState(true);
  const groupMenuRef = useRef<HTMLDivElement | null>(null);
  const createMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<BacklogColumnKey, number>>(BACKLOG_COLUMN_DEFAULT_WIDTHS);
  const resizeStateRef = useRef<{ key: BacklogColumnKey; startX: number; startWidth: number } | null>(null);
  const [hasLoadedViewState, setHasLoadedViewState] = useState(false);
  const [savingStoryId, setSavingStoryId] = useState<string | null>(null);
  const [editingStoryCell, setEditingStoryCell] = useState<{
    storyId: string;
    field: InlineEditableStoryField;
    value: string;
  } | null>(null);
  const [editingParentAssignee, setEditingParentAssignee] = useState<{
    kind: "initiative" | "epic";
    id: string;
    value: string;
  } | null>(null);
  const [editingParentTitle, setEditingParentTitle] = useState<{
    kind: "initiative" | "epic";
    id: string;
    value: string;
  } | null>(null);
  const [editingStoryTitle, setEditingStoryTitle] = useState<{ id: string; value: string } | null>(null);

  async function patchStoryInline(
    storyId: string,
    patch: Partial<{
      status: "todo" | "inProgress" | "done" | "approved";
      sprint: number | null;
      assignee: string | null;
      estimatedDays: number | null;
      daysLeft: number | null;
      title: string;
    }>,
  ) {
    if (Object.keys(patch).length === 0) return;
    setSavingStoryId(storyId);
    try {
      await onPatchStoryQuick(storyId, patch);
    } finally {
      setSavingStoryId((current) => (current === storyId ? null : current));
    }
  }

  function beginStoryCellEdit(storyId: string, field: InlineEditableStoryField, value: string) {
    setEditingStoryCell({ storyId, field, value });
  }

  function cancelStoryCellEdit() {
    setEditingStoryCell(null);
  }

  async function confirmStoryCellEdit(
    storyId: string,
    field: InlineEditableStoryField,
    current: { status: string; sprint: number | null; assignee: string | null; estimatedDays: number | null; daysLeft: number | null },
  ) {
    if (!editingStoryCell || editingStoryCell.storyId !== storyId || editingStoryCell.field !== field) return;
    const nextRaw = editingStoryCell.value.trim();
    if (field === "status") {
      const next = nextRaw as "todo" | "inProgress" | "done" | "approved";
      if (next !== current.status) await patchStoryInline(storyId, { status: next });
    } else if (field === "sprint") {
      const next = nextRaw === "unscheduled" ? null : Number(nextRaw);
      if (next !== current.sprint) await patchStoryInline(storyId, { sprint: next });
    } else if (field === "assignee") {
      const next = nextRaw === "" ? null : nextRaw;
      const currentValue = current.assignee?.trim() || null;
      if (next !== currentValue) await patchStoryInline(storyId, { assignee: next });
    } else if (field === "estimatedDays") {
      const next = nextRaw === "" ? 0 : Math.max(0, Number(nextRaw) || 0);
      if (next !== (current.estimatedDays ?? 0)) await patchStoryInline(storyId, { estimatedDays: next });
    } else if (field === "daysLeft") {
      const next = nextRaw === "" ? 0 : Math.max(0, Number(nextRaw) || 0);
      if (next !== (current.daysLeft ?? 0)) await patchStoryInline(storyId, { daysLeft: next });
    }
    toast.success("User story updated");
    setEditingStoryCell(null);
  }

  function handleStoryCellKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    storyId: string,
    field: InlineEditableStoryField,
    current: { status: string; sprint: number | null; assignee: string | null; estimatedDays: number | null; daysLeft: number | null },
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelStoryCellEdit();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void confirmStoryCellEdit(storyId, field, current);
    }
  }

  async function confirmParentAssigneeEdit(kind: "initiative" | "epic", id: string, currentAssignee: string | null) {
    if (!editingParentAssignee || editingParentAssignee.kind !== kind || editingParentAssignee.id !== id) return;
    const next = editingParentAssignee.value.trim() || null;
    const current = currentAssignee?.trim() || null;
    if (next !== current) {
      if (kind === "initiative") await onPatchInitiativeQuick(id, { assignee: next });
      else await onPatchEpicQuick(id, { assignee: next });
      toast.success(`${kind === "initiative" ? "Initiative" : "Epic"} updated`);
    }
    setEditingParentAssignee(null);
  }

  async function confirmParentTitleEdit(kind: "initiative" | "epic", id: string, currentTitle: string) {
    if (!editingParentTitle || editingParentTitle.kind !== kind || editingParentTitle.id !== id) return;
    const next = editingParentTitle.value.trim();
    if (next.length >= 2 && next !== currentTitle) {
      if (kind === "initiative") await onPatchInitiativeQuick(id, { title: next });
      else await onPatchEpicQuick(id, { title: next });
      toast.success(`${kind === "initiative" ? "Initiative" : "Epic"} title updated`);
    }
    setEditingParentTitle(null);
  }

  async function confirmStoryTitleEdit(storyId: string, currentTitle: string) {
    if (!editingStoryTitle || editingStoryTitle.id !== storyId) return;
    const next = editingStoryTitle.value.trim();
    if (next.length >= 2 && next !== currentTitle) {
      await patchStoryInline(storyId, { title: next });
      toast.success("User story title updated");
    }
    setEditingStoryTitle(null);
  }

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const byInitiative = [...initiatives].sort((a, b) => a.title.localeCompare(b.title));
    if (!q) return byInitiative;
    return byInitiative
      .map((initiative) => {
        const initiativeMatch =
          initiative.title.toLowerCase().includes(q) ||
          (initiative.assignee ?? "").toLowerCase().includes(q) ||
          initiative.status.toLowerCase().includes(q);
        const epics = (initiative.epics ?? [])
          .map((epic) => {
            const epicMatch =
              epic.title.toLowerCase().includes(q) || (epic.assignee ?? "").toLowerCase().includes(q);
            const stories = (epic.userStories ?? []).filter((story) => {
              const ref = storyRefById[story.id] ?? "";
              return (
                story.title.toLowerCase().includes(q) ||
                (story.assignee ?? "").toLowerCase().includes(q) ||
                story.status.toLowerCase().includes(q) ||
                sprintLabel(story.sprint).toLowerCase().includes(q) ||
                ref.includes(q)
              );
            });
            if (epicMatch) return { ...epic, userStories: epic.userStories ?? [] };
            return { ...epic, userStories: stories };
          })
          .filter((epic) => epic.title.toLowerCase().includes(q) || (epic.userStories ?? []).length > 0);

        if (initiativeMatch) return initiative;
        return { ...initiative, epics };
      })
      .filter((initiative) => initiative.title.toLowerCase().includes(q) || (initiative.epics ?? []).length > 0);
  }, [initiatives, q, storyRefById]);

  const filteredWithControls = useMemo(() => {
    const statusRank: Record<string, number> = { todo: 0, inProgress: 1, done: 2, approved: 3 };
    return filtered
      .map((initiative) => ({
        ...initiative,
        epics: (initiative.epics ?? [])
          .map((epic) => {
            const stories = [...(epic.userStories ?? [])]
              .filter((story) => {
                if (statusFilter.length > 0 && !statusFilter.includes(story.status)) return false;
                const sprintKey = story.sprint == null ? "unscheduled" : String(story.sprint);
                if (sprintFilter.length > 0 && !sprintFilter.includes(sprintKey)) return false;
                return true;
              })
              .sort((a, b) => {
                if (sortBy === "titleDesc") return b.title.localeCompare(a.title);
                if (sortBy === "assigneeAsc") return (a.assignee ?? "Unassigned").localeCompare(b.assignee ?? "Unassigned");
                if (sortBy === "estDesc") return (b.estimatedDays ?? 0) - (a.estimatedDays ?? 0);
                if (sortBy === "leftDesc") return (b.daysLeft ?? 0) - (a.daysLeft ?? 0);
                if (sortBy === "status") return (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99);
                return a.title.localeCompare(b.title);
              });
            return { ...epic, userStories: stories };
          })
          .filter((epic) => (epic.userStories ?? []).length > 0 || (statusFilter.length === 0 && sprintFilter.length === 0)),
      }))
      .filter((initiative) => (initiative.epics ?? []).length > 0 || (statusFilter.length === 0 && sprintFilter.length === 0));
  }, [filtered, statusFilter, sprintFilter, sortBy]);

  const suggestions = useMemo(() => {
    const list: string[] = [];
    for (const initiative of initiatives) {
      list.push(initiative.title);
      for (const epic of initiative.epics ?? []) {
        list.push(epic.title);
        for (const story of epic.userStories ?? []) {
          const ref = storyRefById[story.id];
          if (ref) list.push(ref);
          list.push(story.title);
          if (story.assignee) list.push(story.assignee);
        }
      }
    }
    return [...new Set(list)].slice(0, 250);
  }, [initiatives, storyRefById]);
  const searchSuggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return suggestions.filter((item) => item.toLowerCase().includes(needle)).slice(0, 8);
  }, [query, suggestions]);

  const yearOptions = useMemo(() => {
    return Array.from(new Set(initiatives.map((initiative) => String(initiative.year))))
      .sort()
      .map((year) => ({ id: year, label: year }));
  }, [initiatives]);

  const assigneeOptions = useMemo(() => {
    const names = new Set<string>(["Unassigned"]);
    for (const initiative of initiatives) {
      if (initiative.assignee?.trim()) names.add(initiative.assignee.trim());
      for (const epic of initiative.epics ?? []) {
        if (epic.assignee?.trim()) names.add(epic.assignee.trim());
        for (const story of epic.userStories ?? []) {
          if (story.assignee?.trim()) names.add(story.assignee.trim());
        }
      }
    }
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ id: name, label: name }));
  }, [initiatives]);

  const statusOptions: OptionItem[] = [
    { id: "todo", label: "To do" },
    { id: "inProgress", label: "In progress" },
    { id: "done", label: "Done" },
    { id: "approved", label: "Approved" },
  ];
  const sprintOptions: OptionItem[] = [
    { id: "unscheduled", label: "Unscheduled" },
    { id: "1", label: "Sprint 1" },
    { id: "2", label: "Sprint 2" },
  ];
  const quarterOptions: OptionItem[] = [
    { id: "Q1", label: "Q1" },
    { id: "Q2", label: "Q2" },
    { id: "Q3", label: "Q3" },
    { id: "Q4", label: "Q4" },
  ];
  const workItemOptions: OptionItem[] = [
    { id: "initiative", label: "Initiative" },
    { id: "epic", label: "Epic" },
    { id: "story", label: "User Story" },
  ];

  const fullyFiltered = useMemo(() => {
    return filteredWithControls
      .map((initiative) => {
        if (yearFilter.length > 0 && !yearFilter.includes(String(initiative.year))) return null;
        const initiativeQuarterMatch = matchesAnySelectedQuarterByRange(
          quarterFilter,
          initiative.startMonth,
          initiative.endMonth,
        );
        const initAssignee = initiative.assignee?.trim() || "Unassigned";
        const epics = (initiative.epics ?? [])
          .map((epic) => {
            const epicStartMonth = epic.planStartMonth ?? initiative.startMonth;
            const epicEndMonth = epic.planEndMonth ?? initiative.endMonth ?? epicStartMonth;
            const epicQuarterMatch = matchesAnySelectedQuarterByRange(quarterFilter, epicStartMonth, epicEndMonth);
            if (!initiativeQuarterMatch && !epicQuarterMatch) return null;
            const epicAssignee = epic.assignee?.trim() || "Unassigned";
            const stories = (epic.userStories ?? []).filter((story) => {
              if (assigneeFilter.length === 0) return true;
              const storyAssignee = story.assignee?.trim() || "Unassigned";
              return (
                assigneeFilter.includes(storyAssignee) ||
                assigneeFilter.includes(epicAssignee) ||
                assigneeFilter.includes(initAssignee)
              );
            });
            if (assigneeFilter.length > 0 && stories.length === 0 && !assigneeFilter.includes(epicAssignee)) return null;
            return { ...epic, userStories: stories };
          })
          .filter(Boolean) as typeof initiative.epics;

        const initiativeAssigneeMatch = assigneeFilter.length === 0 || assigneeFilter.includes(initAssignee);
        if (assigneeFilter.length > 0 && epics.length === 0 && !initiativeAssigneeMatch) return null;
        if (!initiativeQuarterMatch && epics.length === 0 && quarterFilter.length > 0) return null;
        if (epics.length === 0 && !initiativeQuarterMatch) return null;
        const selectedKinds = new Set(workItemFilter);
        if (selectedKinds.size === 0) {
          return { ...initiative, epics };
        }
        const allowInitiative = selectedKinds.has("initiative");
        const allowEpic = selectedKinds.has("epic");
        const allowStory = selectedKinds.has("story");
        const filteredEpicsByWorkItem = epics
          .map((epic) => {
            const stories = (epic.userStories ?? []).filter(
              () => allowStory,
            );
            if (allowEpic || allowInitiative) return { ...epic, userStories: allowStory ? epic.userStories ?? [] : [] };
            if (stories.length > 0) return { ...epic, userStories: stories };
            return null;
          })
          .filter(Boolean) as typeof epics;
        if (!allowInitiative && filteredEpicsByWorkItem.length === 0) return null;
        return { ...initiative, epics: filteredEpicsByWorkItem };
      })
      .filter(Boolean) as typeof filteredWithControls;
  }, [filteredWithControls, yearFilter, quarterFilter, assigneeFilter, workItemFilter]);

  const tableGridTemplate = useMemo(
    () => BACKLOG_COLUMN_ORDER.map((key) => `${columnWidths[key]}px`).join(" "),
    [columnWidths],
  );
  const groupedStoryRows = useMemo(() => {
    return fullyFiltered.flatMap((initiative) =>
      (initiative.epics ?? []).flatMap((epic) =>
        (epic.userStories ?? []).map((story) => {
          const monthNum = epic.planStartMonth ?? initiative.startMonth ?? null;
          const initiativeMonthNum = initiative.startMonth ?? null;
          return {
            storyId: story.id,
            storyTitle: story.title,
            storyStatus: story.status,
            storyAssignee: story.assignee?.trim() || "Unassigned",
            storySprintLabel: sprintLabel(story.sprint),
            storyEstimatedDays: story.estimatedDays ?? 0,
            storyDaysLeft: story.daysLeft ?? 0,
            initiativeId: initiative.id,
            initiativeTitle: initiative.title,
            initiativeYear: String(initiative.year),
            initiativeStatus: rollupWorkflowStatus((initiative.epics ?? []).flatMap((epic) => epic.userStories ?? [])),
            initiativeAssignee: initiative.assignee?.trim() || "Unassigned",
            initiativeMonthNum,
            initiativeQuarterLabelValue: quarterFromMonth(initiativeMonthNum),
            initiativeMonthLabelValue: monthLabel(initiativeMonthNum),
            epicId: epic.id,
            epicTitle: epic.title,
            epicAssignee: epic.assignee?.trim() || "Unassigned",
            monthNum,
            monthLabelValue: monthLabel(monthNum),
            quarterLabelValue: quarterFromMonth(monthNum),
          };
        }),
      ),
    );
  }, [fullyFiltered]);
  const groupedStandaloneInitiatives = useMemo(() => {
    return fullyFiltered
      .filter((initiative) => (initiative.epics ?? []).every((epic) => (epic.userStories ?? []).length === 0))
      .map((initiative) => ({
        initiativeId: initiative.id,
        initiativeTitle: initiative.title,
        initiativeYear: String(initiative.year),
        initiativeStatus: rollupWorkflowStatus([]),
        initiativeAssignee: initiative.assignee?.trim() || "Unassigned",
        initiativeMonthNum: initiative.startMonth ?? null,
        initiativeMonthLabelValue: monthLabel(initiative.startMonth),
        initiativeQuarterLabelValue: quarterFromMonth(initiative.startMonth),
        epics: (initiative.epics ?? []).map((epic) => ({
          epicId: epic.id,
          epicTitle: epic.title,
          epicAssignee: epic.assignee?.trim() || "Unassigned",
          epicMonthNum: epic.planStartMonth ?? initiative.startMonth ?? null,
          epicMonthLabelValue: monthLabel(epic.planStartMonth ?? initiative.startMonth),
          epicQuarterLabelValue: quarterFromMonth(epic.planStartMonth ?? initiative.startMonth),
        })),
      }));
  }, [fullyFiltered]);
  const visibleEpicCount = useMemo(
    () => fullyFiltered.reduce((sum, initiative) => sum + (initiative.epics?.length ?? 0), 0),
    [fullyFiltered],
  );
  const visibleStoryCount = useMemo(
    () =>
      fullyFiltered.reduce(
        (sum, initiative) =>
          sum + (initiative.epics ?? []).reduce((epicSum, epic) => epicSum + (epic.userStories?.length ?? 0), 0),
        0,
      ),
    [fullyFiltered],
  );
  const groupSummaryLabel = groupLevels.length === 0 ? "None" : groupLevels.map((level) => GROUP_LEVEL_LABELS[level]).join(" / ");

  function toggleGroupLevel(level: GroupLevel) {
    setGroupLevels((prev) => {
      const idx = GROUP_LEVEL_ORDER.indexOf(level);
      if (prev.includes(level)) {
        return GROUP_LEVEL_ORDER.slice(0, idx).filter((item) => prev.includes(item));
      }
      return GROUP_LEVEL_ORDER.slice(0, idx + 1);
    });
  }

  function keyForLevel(row: (typeof groupedStoryRows)[number], level: GroupLevel): { key: string; label: string; sort: string } {
    if (level === "year") return { key: row.initiativeYear, label: row.initiativeYear, sort: row.initiativeYear.padStart(4, "0") };
    if (level === "quarter") {
      const q = row.initiativeQuarterLabelValue;
      return { key: q, label: q, sort: String(["Q1", "Q2", "Q3", "Q4"].indexOf(q)).padStart(2, "0") };
    }
    if (level === "month") {
      const m = row.initiativeMonthNum ?? 0;
      return { key: String(m), label: row.initiativeMonthLabelValue, sort: String(m).padStart(2, "0") };
    }
    const sprint = row.storySprintLabel;
    const order = sprint === "Sprint 1" ? "01" : sprint === "Sprint 2" ? "02" : "99";
    return { key: sprint, label: sprint, sort: order };
  }

  function keyForStandaloneLevel(
    row: (typeof groupedStandaloneInitiatives)[number],
    level: GroupLevel,
  ): { key: string; label: string; sort: string } {
    if (level === "year") return { key: row.initiativeYear, label: row.initiativeYear, sort: row.initiativeYear.padStart(4, "0") };
    if (level === "quarter") {
      const q = row.initiativeQuarterLabelValue;
      return { key: q, label: q, sort: String(["Q1", "Q2", "Q3", "Q4"].indexOf(q)).padStart(2, "0") };
    }
    if (level === "month") {
      const m = row.initiativeMonthNum ?? 0;
      return { key: String(m), label: row.initiativeMonthLabelValue, sort: String(m).padStart(2, "0") };
    }
    return { key: "none", label: "No sprint", sort: "99" };
  }

  function renderStoryDataRows(rows: typeof groupedStoryRows, indentPx: number, keyPrefix: string) {
    return rows
      .slice()
      .sort((a, b) => a.storyTitle.localeCompare(b.storyTitle))
      .map((row) => {
        const progress = storyCompletion({
          status: row.storyStatus,
          estimatedDays: row.storyEstimatedDays,
          daysLeft: row.storyDaysLeft,
        });
        return (
          <div
            key={`${keyPrefix}-story-${row.storyId}`}
            className="grid items-center gap-3 px-3 py-2 hover:bg-slate-50"
            style={{ gridTemplateColumns: tableGridTemplate }}
          >
            <div className="min-w-0" style={{ paddingLeft: indentPx }}>
              <div className="flex min-w-0 items-center gap-2 truncate text-left text-[14px] text-slate-800">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-700 ring-1 ring-sky-200/80">
                  <FileText className="size-3.5" />
                </span>
                {editingStoryTitle?.id === row.storyId ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <input
                      value={editingStoryTitle.value}
                      onChange={(event) => setEditingStoryTitle({ id: row.storyId, value: event.target.value })}
                      className="h-7 min-w-[180px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                      autoFocus
                    />
                    <button type="button" onClick={() => setEditingStoryTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                    <button type="button" onClick={() => void confirmStoryTitleEdit(row.storyId, row.storyTitle)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                  </span>
                ) : (
                  <span className="inline-flex min-w-0 items-center gap-1 truncate text-left">
                    <span className="truncate">{row.storyTitle}</span>
                    <button
                      type="button"
                      onClick={() => setEditingStoryTitle({ id: row.storyId, value: row.storyTitle })}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                      aria-label="Edit user story title"
                    >
                      <Pencil className="size-3.5 text-slate-500" />
                    </button>
                  </span>
                )}
              </div>
            </div>
            <span className="justify-self-center text-center text-[14px] text-slate-700">{row.initiativeYear}</span>
            <span className="justify-self-center text-center text-[14px] text-slate-700">{row.quarterLabelValue}</span>
            <span className="justify-self-center text-center text-[14px] text-slate-700">{row.monthLabelValue}</span>
            <span className={cn("w-fit justify-self-center rounded px-2 py-0.5 text-[12px] font-medium", statusChip(row.storyStatus))}>
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "status" ? (
                <span className="flex items-center gap-1">
                  <select
                    value={editingStoryCell.value}
                    onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                    onKeyDown={(event) =>
                      handleStoryCellKeyDown(event, row.storyId, "status", {
                        status: row.storyStatus,
                        sprint: row.storySprintLabel === "Unscheduled" ? null : row.storySprintLabel === "Sprint 1" ? 1 : 2,
                        assignee: row.storyAssignee === "Unassigned" ? null : row.storyAssignee,
                        estimatedDays: row.storyEstimatedDays,
                        daysLeft: row.storyDaysLeft,
                      })
                    }
                    className="w-full cursor-pointer bg-transparent text-[12px] font-medium outline-none"
                  >
                    <option value="todo">To do</option>
                    <option value="inProgress">In progress</option>
                    <option value="done">Done</option>
                    <option value="approved">Approved</option>
                  </select>
                  <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-slate-200">
                    <X className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      confirmStoryCellEdit(row.storyId, "status", {
                        status: row.storyStatus,
                        sprint: row.storySprintLabel === "Unscheduled" ? null : row.storySprintLabel === "Sprint 1" ? 1 : 2,
                        assignee: row.storyAssignee === "Unassigned" ? null : row.storyAssignee,
                        estimatedDays: row.storyEstimatedDays,
                        daysLeft: row.storyDaysLeft,
                      })
                    }
                    className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-slate-200"
                  >
                    <Check className="size-3" />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    beginStoryCellEdit(row.storyId, "status", row.storyStatus);
                  }}
                  className="text-[12px] font-medium"
                >
                  {row.storyStatus === "inProgress" ? "In progress" : row.storyStatus}
                </button>
              )}
            </span>
            <span className="justify-self-center text-center text-[14px] text-slate-700">
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "sprint" ? (
                <span className="inline-flex items-center gap-1">
                  <select
                    value={editingStoryCell.value}
                    onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                    onKeyDown={(event) =>
                      handleStoryCellKeyDown(event, row.storyId, "sprint", {
                        status: row.storyStatus,
                        sprint: row.storySprintLabel === "Unscheduled" ? null : row.storySprintLabel === "Sprint 1" ? 1 : 2,
                        assignee: row.storyAssignee === "Unassigned" ? null : row.storyAssignee,
                        estimatedDays: row.storyEstimatedDays,
                        daysLeft: row.storyDaysLeft,
                      })
                    }
                    className="h-7 min-w-[94px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                  >
                    <option value="unscheduled">Unscheduled</option>
                    <option value="1">Sprint 1</option>
                    <option value="2">Sprint 2</option>
                  </select>
                  <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                  <button
                    type="button"
                    onClick={() =>
                      confirmStoryCellEdit(row.storyId, "sprint", {
                        status: row.storyStatus,
                        sprint: row.storySprintLabel === "Unscheduled" ? null : row.storySprintLabel === "Sprint 1" ? 1 : 2,
                        assignee: row.storyAssignee === "Unassigned" ? null : row.storyAssignee,
                        estimatedDays: row.storyEstimatedDays,
                        daysLeft: row.storyDaysLeft,
                      })
                    }
                    className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
                  ><Check className="size-3.5" /></button>
                </span>
              ) : (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    beginStoryCellEdit(
                      row.storyId,
                      "sprint",
                      row.storySprintLabel === "Unscheduled" ? "unscheduled" : row.storySprintLabel === "Sprint 1" ? "1" : "2",
                    );
                  }}
                  className="rounded px-1 py-0.5 hover:bg-slate-100"
                >
                  {row.storySprintLabel}
                </button>
              )}
            </span>
            <span className="justify-self-center text-center text-[14px] text-slate-700">
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "assignee" ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    value={editingStoryCell.value}
                    onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                    onKeyDown={(event) =>
                      handleStoryCellKeyDown(event, row.storyId, "assignee", {
                        status: row.storyStatus,
                        sprint: row.storySprintLabel === "Unscheduled" ? null : row.storySprintLabel === "Sprint 1" ? 1 : 2,
                        assignee: row.storyAssignee === "Unassigned" ? null : row.storyAssignee,
                        estimatedDays: row.storyEstimatedDays,
                        daysLeft: row.storyDaysLeft,
                      })
                    }
                    placeholder="Unassigned"
                    className="h-7 w-full min-w-[104px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                  />
                  <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                  <button
                    type="button"
                    onClick={() =>
                      confirmStoryCellEdit(row.storyId, "assignee", {
                        status: row.storyStatus,
                        sprint: row.storySprintLabel === "Unscheduled" ? null : row.storySprintLabel === "Sprint 1" ? 1 : 2,
                        assignee: row.storyAssignee === "Unassigned" ? null : row.storyAssignee,
                        estimatedDays: row.storyEstimatedDays,
                        daysLeft: row.storyDaysLeft,
                      })
                    }
                    className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
                  ><Check className="size-3.5" /></button>
                </span>
              ) : (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    beginStoryCellEdit(row.storyId, "assignee", row.storyAssignee === "Unassigned" ? "" : row.storyAssignee);
                  }}
                  className="rounded px-1 py-0.5 hover:bg-slate-100"
                >
                  {row.storyAssignee}
                </button>
              )}
            </span>
            <span className="justify-self-center text-center text-[14px] text-slate-700">
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "estimatedDays" ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    value={editingStoryCell.value}
                    onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                    onKeyDown={(event) =>
                      handleStoryCellKeyDown(event, row.storyId, "estimatedDays", {
                        status: row.storyStatus,
                        sprint: row.storySprintLabel === "Unscheduled" ? null : row.storySprintLabel === "Sprint 1" ? 1 : 2,
                        assignee: row.storyAssignee === "Unassigned" ? null : row.storyAssignee,
                        estimatedDays: row.storyEstimatedDays,
                        daysLeft: row.storyDaysLeft,
                      })
                    }
                    className="h-7 w-20 rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                  />
                  <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                  <button
                    type="button"
                    onClick={() =>
                      confirmStoryCellEdit(row.storyId, "estimatedDays", {
                        status: row.storyStatus,
                        sprint: row.storySprintLabel === "Unscheduled" ? null : row.storySprintLabel === "Sprint 1" ? 1 : 2,
                        assignee: row.storyAssignee === "Unassigned" ? null : row.storyAssignee,
                        estimatedDays: row.storyEstimatedDays,
                        daysLeft: row.storyDaysLeft,
                      })
                    }
                    className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
                  ><Check className="size-3.5" /></button>
                </span>
              ) : (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    beginStoryCellEdit(row.storyId, "estimatedDays", String(row.storyEstimatedDays));
                  }}
                  className="rounded px-1 py-0.5 hover:bg-slate-100"
                >
                  {row.storyEstimatedDays}d
                </button>
              )}
            </span>
            <span className="justify-self-center text-center text-[14px] text-slate-700">
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "daysLeft" ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    value={editingStoryCell.value}
                    onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                    onKeyDown={(event) =>
                      handleStoryCellKeyDown(event, row.storyId, "daysLeft", {
                        status: row.storyStatus,
                        sprint: row.storySprintLabel === "Unscheduled" ? null : row.storySprintLabel === "Sprint 1" ? 1 : 2,
                        assignee: row.storyAssignee === "Unassigned" ? null : row.storyAssignee,
                        estimatedDays: row.storyEstimatedDays,
                        daysLeft: row.storyDaysLeft,
                      })
                    }
                    className="h-7 w-20 rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                  />
                  <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                  <button
                    type="button"
                    onClick={() =>
                      confirmStoryCellEdit(row.storyId, "daysLeft", {
                        status: row.storyStatus,
                        sprint: row.storySprintLabel === "Unscheduled" ? null : row.storySprintLabel === "Sprint 1" ? 1 : 2,
                        assignee: row.storyAssignee === "Unassigned" ? null : row.storyAssignee,
                        estimatedDays: row.storyEstimatedDays,
                        daysLeft: row.storyDaysLeft,
                      })
                    }
                    className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
                  ><Check className="size-3.5" /></button>
                </span>
              ) : (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    beginStoryCellEdit(row.storyId, "daysLeft", String(row.storyDaysLeft));
                  }}
                  className="rounded px-1 py-0.5 hover:bg-slate-100"
                >
                  {row.storyDaysLeft}d
                </button>
              )}
            </span>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span>{progress.label}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          </div>
        );
      });
  }

  function renderFolderRow(folderId: string, label: string, count: number, indentPx: number, children: React.ReactNode) {
    const isOpen = openGroupFolders[folderId] ?? defaultGroupExpanded;
    return (
      <div key={folderId}>
        <div className="grid items-center gap-3 px-3 py-1.5 hover:bg-slate-50" style={{ gridTemplateColumns: tableGridTemplate }}>
          <button
            type="button"
            onClick={() => setOpenGroupFolders((prev) => ({ ...prev, [folderId]: !(prev[folderId] ?? defaultGroupExpanded) }))}
            className="flex min-w-0 items-center gap-1.5 text-left text-[13px] font-semibold text-slate-700"
            style={{ paddingLeft: indentPx }}
          >
            {isOpen ? <ChevronDown className="size-4 shrink-0 text-slate-500" /> : <ChevronRight className="size-4 shrink-0 text-slate-500" />}
            <span className="truncate">{label}</span>
            <span className="text-[11px] font-medium text-slate-500">({count})</span>
          </button>
          <span className="justify-self-center text-slate-400">-</span>
          <span className="justify-self-center text-slate-400">-</span>
          <span className="justify-self-center text-slate-400">-</span>
          <span className="justify-self-center text-slate-400">-</span>
          <span className="justify-self-center text-slate-400">-</span>
          <span className="justify-self-center text-slate-400">-</span>
          <span className="justify-self-center text-slate-400">-</span>
          <span className="justify-self-center text-slate-400">-</span>
          <span className="justify-self-center text-slate-400">-</span>
        </div>
        {isOpen ? children : null}
      </div>
    );
  }

  function renderLeafRows(rows: typeof groupedStoryRows, indentPx: number, path: string): React.ReactNode {
    if (groupLevels.includes("sprint")) {
      return renderStoryDataRows(rows, indentPx, `${path}/stories`);
    }

    function completionForRows(storyRows: typeof groupedStoryRows) {
      const total = storyRows.length;
      const finished = storyRows.filter((r) => r.storyStatus === "done" || r.storyStatus === "approved").length;
      const percent = total > 0 ? Math.round((finished / total) * 100) : 0;
      return { total, finished, percent };
    }

    function renderCompletionCell(storyRows: typeof groupedStoryRows) {
      const { total, finished, percent } = completionForRows(storyRows);
      return (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[12px] text-slate-600">
            <span>{total === 0 ? "No stories" : "Completion"}</span>
            <span>
              {finished}/{total} · {percent}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      );
    }

    function sumEstimatedAndLeft(storyRows: typeof groupedStoryRows) {
      const estimated = storyRows.reduce((sum, r) => sum + (r.storyEstimatedDays ?? 0), 0);
      const left = storyRows.reduce((sum, r) => sum + (r.storyDaysLeft ?? 0), 0);
      return { estimated, left };
    }

    function renderEpicRow(epicId: string, epicTitle: string, epicAssignee: string, epicRows: typeof groupedStoryRows, epicIndentPx: number, epicPath: string) {
      const folderId = `${epicPath}/epic:${epicId}`;
      const isOpen = openGroupFolders[folderId] ?? defaultGroupExpanded;
      const storyCount = epicRows.length;
      const { estimated, left } = sumEstimatedAndLeft(epicRows);
      const completion = completionForRows(epicRows);

      return (
        <div key={folderId}>
          <div
            className="group grid items-center gap-3 px-3 py-2 hover:bg-slate-50"
            style={{ gridTemplateColumns: tableGridTemplate }}
          >
            <div className="relative flex min-w-0 items-center gap-2" style={{ paddingLeft: epicIndentPx }}>
              <button
                type="button"
                onClick={() => setOpenGroupFolders((prev) => ({ ...prev, [folderId]: !isOpen }))}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                aria-label={isOpen ? "Collapse epic" : "Expand epic"}
              >
                {isOpen ? (
                  <ChevronDown className="size-4 shrink-0 text-slate-500" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-slate-500" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onOpenEpic(epicId)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <FolderKanban className="size-4 shrink-0 text-slate-700" />
                {editingParentTitle?.kind === "epic" && editingParentTitle.id === epicId ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <input
                      value={editingParentTitle.value}
                      onChange={(event) => setEditingParentTitle({ kind: "epic", id: epicId, value: event.target.value })}
                      className="h-7 min-w-[180px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                      autoFocus
                    />
                    <button type="button" onClick={() => setEditingParentTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                    <button type="button" onClick={() => void confirmParentTitleEdit("epic", epicId, epicTitle)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                  </span>
                ) : (
                  <span className="inline-flex min-w-0 items-center gap-1 truncate text-[15px] font-medium text-slate-900">
                    <span className="truncate">{epicTitle}</span>
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); setEditingParentTitle({ kind: "epic", id: epicId, value: epicTitle }); }}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                      aria-label="Edit epic title"
                    >
                      <Pencil className="size-3.5 text-slate-500" />
                    </button>
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openCreateComposer({
                    anchorKey: `group-epic:${epicId}`,
                    scope: "epic",
                    kind: "story",
                    epicId,
                  });
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ring-1 ring-slate-200 text-slate-700 transition hover:bg-white hover:text-slate-900"
                title="Add user story"
              >
                <Plus className="size-3.5 text-slate-600" />
              </button>
            </div>
            <span className="justify-self-center text-center text-[15px] text-slate-700">{epicRows[0]?.initiativeYear ?? "-"}</span>
            <span className="justify-self-center text-center text-[15px] text-slate-700">
              {quarterFromMonth(epicRows[0]?.monthNum ?? null)}
            </span>
            <span className="justify-self-center text-center text-[15px] text-slate-700">{epicRows[0]?.monthLabelValue ?? "-"}</span>
            <span className={cn("w-fit justify-self-center rounded px-2 py-0.5 text-[13px] font-medium", statusChip(rollupWorkflowStatusFromGroupedRows(epicRows)))}>
              {workflowStatusLabel(rollupWorkflowStatusFromGroupedRows(epicRows))}
            </span>
            <span className="justify-self-center text-center text-[15px] text-slate-500">-</span>
            <span className="justify-self-center text-center text-[15px] text-slate-700">
              {editingParentAssignee?.kind === "epic" && editingParentAssignee.id === epicId ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    value={editingParentAssignee.value}
                    onChange={(event) => setEditingParentAssignee((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                    placeholder="Unassigned"
                    className="h-7 w-full min-w-[104px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                  />
                  <button type="button" onClick={() => setEditingParentAssignee(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                  <button type="button" onClick={() => void confirmParentAssigneeEdit("epic", epicId, epicAssignee === "Unassigned" ? null : epicAssignee)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                </span>
              ) : (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setEditingParentAssignee({ kind: "epic", id: epicId, value: epicAssignee === "Unassigned" ? "" : epicAssignee });
                  }}
                  className="rounded px-1 py-0.5 hover:bg-slate-100"
                >
                  {epicAssignee}
                </button>
              )}
            </span>
            <span
              className="justify-self-center text-center text-[15px] font-medium text-slate-600"
              title="Auto-summed from child user stories"
            >
              Σ {estimated}d
            </span>
            <span
              className="justify-self-center text-center text-[15px] font-medium text-slate-600"
              title="Auto-summed from child user stories"
            >
              Σ {left}d
            </span>
            <div>{renderCompletionCell(epicRows)}</div>
          </div>
          {createSelection?.anchorKey === `group-epic:${epicId}` ? (
            <form onSubmit={handleCreateSubmit} className="grid items-center gap-3 bg-slate-50 px-3 py-2" style={{ gridTemplateColumns: tableGridTemplate }}>
              <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: epicIndentPx + 18 }}>
                <input
                  value={createDraftTitle}
                  onChange={(event) => setCreateDraftTitle(event.target.value)}
                  placeholder="Type user story title and press Enter..."
                  className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                  autoFocus
                />
              </div>
              <div className="col-span-8 flex items-center gap-2">
                <button type="submit" disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-45"><Plus className="size-3.5" /></button>
                <button type="button" onClick={closeInlineCreator} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"><X className="size-3.5" /></button>
              </div>
            </form>
          ) : null}
          {isOpen ? (
            <div>
              {renderStoryDataRows(epicRows, epicIndentPx + 34, `${folderId}/stories`)}
            </div>
          ) : null}
        </div>
      );
    }

    function renderInitiativeRow(initiativeId: string, initiativeTitle: string, initiativeYear: string, initiativeStatus: WorkflowStatus, initiativeAssignee: string, initiativeQuarterLabel: string, initiativeMonthLabel: string, initiativeRows: typeof groupedStoryRows, initIndentPx: number, initPath: string) {
      const folderId = `${initPath}/initiative:${initiativeId}`;
      const isOpen = openGroupFolders[folderId] ?? defaultGroupExpanded;
      const { estimated, left } = sumEstimatedAndLeft(initiativeRows);
      return (
        <div key={folderId}>
          <div className="group grid items-center gap-3 px-3 py-2 hover:bg-slate-50" style={{ gridTemplateColumns: tableGridTemplate }}>
            <div className="relative flex min-w-0 items-center gap-2" style={{ paddingLeft: initIndentPx }}>
              <button
                type="button"
                onClick={() => setOpenGroupFolders((prev) => ({ ...prev, [folderId]: !isOpen }))}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                aria-label={isOpen ? "Collapse initiative" : "Expand initiative"}
              >
                {isOpen ? (
                  <ChevronDown className="size-4 shrink-0 text-slate-500" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-slate-500" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onOpenInitiative(initiativeId)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <Target className="size-4 shrink-0 text-slate-700" />
                {editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiativeId ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <input
                      value={editingParentTitle.value}
                      onChange={(event) => setEditingParentTitle({ kind: "initiative", id: initiativeId, value: event.target.value })}
                      className="h-7 min-w-[180px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                      autoFocus
                    />
                    <button type="button" onClick={() => setEditingParentTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                    <button type="button" onClick={() => void confirmParentTitleEdit("initiative", initiativeId, initiativeTitle)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                  </span>
                ) : (
                  <span className="inline-flex min-w-0 items-center gap-1 truncate text-[15px] font-medium text-slate-900">
                    <span className="truncate">{initiativeTitle}</span>
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); setEditingParentTitle({ kind: "initiative", id: initiativeId, value: initiativeTitle }); }}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                      aria-label="Edit initiative title"
                    >
                      <Pencil className="size-3.5 text-slate-500" />
                    </button>
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openCreateComposer({
                    anchorKey: `group-initiative:${initiativeId}`,
                    scope: "initiative",
                    kind: "epic",
                    initiativeId,
                  });
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ring-1 ring-slate-200 text-slate-700 transition hover:bg-white hover:text-slate-900"
                title="Add epic"
              >
                <Plus className="size-3.5 text-slate-600" />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openCreateComposer({
                    anchorKey: `group-initiative:${initiativeId}`,
                    scope: "initiative",
                    kind: "story",
                    initiativeId,
                  });
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ring-1 ring-slate-200 text-slate-700 transition hover:bg-white hover:text-slate-900"
                title="Add user story"
              >
                <FileText className="size-3.5 text-slate-600" />
              </button>
            </div>
            <span className="justify-self-center text-center text-[15px] text-slate-700">{initiativeYear}</span>
            <span className="justify-self-center text-center text-[15px] text-slate-700">{initiativeQuarterLabel}</span>
            <span className="justify-self-center text-center text-[15px] text-slate-700">{initiativeMonthLabel}</span>
            <span className={cn("w-fit justify-self-center rounded px-2 py-0.5 text-[13px] font-medium", statusChip(initiativeStatus))}>
              {workflowStatusLabel(initiativeStatus)}
            </span>
            <span className="justify-self-center text-center text-[15px] text-slate-500">-</span>
            <span className="justify-self-center text-center text-[15px] text-slate-700">
              {editingParentAssignee?.kind === "initiative" && editingParentAssignee.id === initiativeId ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    value={editingParentAssignee.value}
                    onChange={(event) => setEditingParentAssignee((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                    placeholder="Unassigned"
                    className="h-7 w-full min-w-[104px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                  />
                  <button type="button" onClick={() => setEditingParentAssignee(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                  <button type="button" onClick={() => void confirmParentAssigneeEdit("initiative", initiativeId, initiativeAssignee === "Unassigned" ? null : initiativeAssignee)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                </span>
              ) : (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setEditingParentAssignee({
                      kind: "initiative",
                      id: initiativeId,
                      value: initiativeAssignee === "Unassigned" ? "" : initiativeAssignee,
                    });
                  }}
                  className="rounded px-1 py-0.5 hover:bg-slate-100"
                >
                  {initiativeAssignee}
                </button>
              )}
            </span>
            <span
              className="justify-self-center text-center text-[15px] font-medium text-slate-600"
              title="Auto-summed from child user stories"
            >
              Σ {estimated}d
            </span>
            <span
              className="justify-self-center text-center text-[15px] font-medium text-slate-600"
              title="Auto-summed from child user stories"
            >
              Σ {left}d
            </span>
            <div>{renderCompletionCell(initiativeRows)}</div>
          </div>
          {createSelection?.anchorKey === `group-initiative:${initiativeId}` ? (
            <form onSubmit={handleCreateSubmit} className="grid items-center gap-3 bg-slate-50 px-3 py-2" style={{ gridTemplateColumns: tableGridTemplate }}>
              <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: initIndentPx + 18 }}>
                <input
                  value={createDraftTitle}
                  onChange={(event) => setCreateDraftTitle(event.target.value)}
                  placeholder={createSelection.kind === "epic" ? "Type epic title and press Enter..." : "Type user story title and press Enter..."}
                  className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                  autoFocus
                />
              </div>
              <div className="col-span-8 flex items-center gap-2">
                {createSelection.kind === "story" ? (
                  <select
                    value={storyTargetEpicId}
                    onChange={(event) => setStoryTargetEpicId(event.target.value)}
                    className="h-8 min-w-[180px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                  >
                    {Array.from(new Map(initiativeRows.map((r) => [r.epicId, r.epicTitle])).entries()).map(([epicId, title]) => (
                      <option key={epicId} value={epicId}>{title}</option>
                    ))}
                  </select>
                ) : null}
                <button type="submit" disabled={createDraftTitle.trim().length < 2 || submittingKey === "create" || (createSelection.kind === "story" && !storyTargetEpicId)} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-45"><Plus className="size-3.5" /></button>
                <button type="button" onClick={closeInlineCreator} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"><X className="size-3.5" /></button>
              </div>
            </form>
          ) : null}
          {isOpen ? (
            <div>
              {(() => {
                const byEpic = new Map<string, typeof groupedStoryRows>();
                for (const r of initiativeRows) {
                  if (!byEpic.has(r.epicId)) byEpic.set(r.epicId, []);
                  byEpic.get(r.epicId)!.push(r);
                }
                return Array.from(byEpic.entries())
                  .sort((a, b) => a[1][0]?.epicTitle.localeCompare(b[1][0]?.epicTitle ?? "") ?? 0)
                  .map(([epicId, epicRows]) => {
                    const first = epicRows[0];
                    return renderEpicRow(
                      epicId,
                      first.epicTitle,
                      first.epicAssignee,
                      epicRows,
                      initIndentPx + 18,
                      folderId,
                    );
                  });
              })()}
            </div>
          ) : null}
        </div>
      );
    }

    if (groupLevels.includes("month")) {
      const byEpic = new Map<string, typeof groupedStoryRows>();
      for (const row of rows) {
        if (!byEpic.has(row.epicId)) byEpic.set(row.epicId, []);
        byEpic.get(row.epicId)!.push(row);
      }
      return Array.from(byEpic.entries())
        .sort((a, b) => (a[1][0]?.epicTitle ?? "").localeCompare(b[1][0]?.epicTitle ?? ""))
        .map(([epicId, epicRows]) => {
          const first = epicRows[0];
          return renderEpicRow(epicId, first.epicTitle, first.epicAssignee, epicRows, indentPx, path);
        });
    }

    const byInitiative = new Map<string, typeof groupedStoryRows>();
    for (const row of rows) {
      if (!byInitiative.has(row.initiativeId)) byInitiative.set(row.initiativeId, []);
      byInitiative.get(row.initiativeId)!.push(row);
    }

    return Array.from(byInitiative.entries())
      .sort((a, b) => (a[1][0]?.initiativeTitle ?? "").localeCompare(b[1][0]?.initiativeTitle ?? ""))
      .map(([initiativeId, initiativeRows]) => {
        const first = initiativeRows[0];
        return renderInitiativeRow(
          initiativeId,
          first.initiativeTitle,
          first.initiativeYear,
          first.initiativeStatus,
          first.initiativeAssignee,
          first.initiativeQuarterLabelValue ?? "-",
          first.initiativeMonthLabelValue ?? "-",
          initiativeRows,
          indentPx,
          path,
        );
      });
  }

  function renderGroupedTree(rows: typeof groupedStoryRows, levelIndex = 0, path = ""): React.ReactNode {
    if (levelIndex >= groupLevels.length) return renderLeafRows(rows, levelIndex * 14, path);
    const level = groupLevels[levelIndex];
    const groups = new Map<string, { label: string; sort: string; rows: typeof groupedStoryRows }>();
    for (const row of rows) {
      const { key, label, sort } = keyForLevel(row, level);
      if (!groups.has(key)) groups.set(key, { label, sort, rows: [] });
      groups.get(key)!.rows.push(row);
    }
    return Array.from(groups.entries())
      .sort((a, b) => a[1].sort.localeCompare(b[1].sort))
      .map(([key, group]) =>
        renderFolderRow(`${path}${level}:${key}`, group.label, group.rows.length, levelIndex * 14, (
          <>{renderGroupedTree(group.rows, levelIndex + 1, `${path}${level}:${key}/`)}</>
        )),
      );
  }

  function renderStandaloneInitiativeRows(rows: typeof groupedStandaloneInitiatives, indentPx: number): React.ReactNode {
    return rows
      .slice()
      .sort((a, b) => a.initiativeTitle.localeCompare(b.initiativeTitle))
      .map((initiative) => {
        const initFolderId = `standalone-init:${initiative.initiativeId}`;
        const isInitOpen = openGroupFolders[initFolderId] ?? defaultGroupExpanded;
        return (
          <div key={initFolderId}>
            <div className="group grid items-center gap-3 px-3 py-2 hover:bg-slate-50" style={{ gridTemplateColumns: tableGridTemplate }}>
              <div className="relative flex min-w-0 items-center gap-2" style={{ paddingLeft: indentPx }}>
                <button
                  type="button"
                  onClick={() => setOpenGroupFolders((prev) => ({ ...prev, [initFolderId]: !isInitOpen }))}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                  aria-label={isInitOpen ? "Collapse initiative" : "Expand initiative"}
                >
                  {isInitOpen ? <ChevronDown className="size-4 shrink-0 text-slate-500" /> : <ChevronRight className="size-4 shrink-0 text-slate-500" />}
                </button>
                <button type="button" onClick={() => onOpenInitiative(initiative.initiativeId)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <Target className="size-4 shrink-0 text-slate-700" />
                  {editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiative.initiativeId ? (
                    <span className="flex min-w-0 items-center gap-1">
                      <input
                        value={editingParentTitle.value}
                        onChange={(event) => setEditingParentTitle({ kind: "initiative", id: initiative.initiativeId, value: event.target.value })}
                        className="h-7 min-w-[180px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                        autoFocus
                      />
                      <button type="button" onClick={() => setEditingParentTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                      <button type="button" onClick={() => void confirmParentTitleEdit("initiative", initiative.initiativeId, initiative.initiativeTitle)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                    </span>
                  ) : (
                    <span className="inline-flex min-w-0 items-center gap-1 truncate text-[15px] font-medium text-slate-900">
                      <span className="truncate">{initiative.initiativeTitle}</span>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); setEditingParentTitle({ kind: "initiative", id: initiative.initiativeId, value: initiative.initiativeTitle }); }}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                        aria-label="Edit initiative title"
                      >
                        <Pencil className="size-3.5 text-slate-500" />
                      </button>
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openCreateComposer({
                      anchorKey: `group-standalone-initiative:${initiative.initiativeId}`,
                      scope: "initiative",
                      kind: "epic",
                      initiativeId: initiative.initiativeId,
                    });
                  }}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ring-1 ring-slate-200 text-slate-700 transition hover:bg-white hover:text-slate-900"
                  title="Add epic"
                >
                  <Plus className="size-3.5 text-slate-600" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openCreateComposer({
                      anchorKey: `group-standalone-initiative:${initiative.initiativeId}`,
                      scope: "initiative",
                      kind: "story",
                      initiativeId: initiative.initiativeId,
                    });
                  }}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ring-1 ring-slate-200 text-slate-700 transition hover:bg-white hover:text-slate-900"
                  title="Add user story"
                >
                  <FileText className="size-3.5 text-slate-600" />
                </button>
              </div>
              <span className="justify-self-center text-center text-[15px] text-slate-700">{initiative.initiativeYear}</span>
              <span className="justify-self-center text-center text-[15px] text-slate-700">{initiative.initiativeQuarterLabelValue}</span>
              <span className="justify-self-center text-center text-[15px] text-slate-700">{initiative.initiativeMonthLabelValue}</span>
              <span className={cn("w-fit justify-self-center rounded px-2 py-0.5 text-[13px] font-medium", statusChip(initiative.initiativeStatus))}>
                {workflowStatusLabel(initiative.initiativeStatus)}
              </span>
              <span className="justify-self-center text-center text-[15px] text-slate-500">-</span>
              <span className="justify-self-center text-center text-[15px] text-slate-700">{initiative.initiativeAssignee}</span>
              <span className="justify-self-center text-center text-[15px] font-medium text-slate-600" title="Auto-summed from child user stories">
                Σ 0d
              </span>
              <span className="justify-self-center text-center text-[15px] font-medium text-slate-600" title="Auto-summed from child user stories">
                Σ 0d
              </span>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[12px] text-slate-600">
                  <span>No stories</span>
                  <span>0/0 · 0%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200" />
              </div>
            </div>
            {createSelection?.anchorKey === `group-standalone-initiative:${initiative.initiativeId}` ? (
              <form onSubmit={handleCreateSubmit} className="grid items-center gap-3 bg-slate-50 px-3 py-2" style={{ gridTemplateColumns: tableGridTemplate }}>
                <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: indentPx + 18 }}>
                  <input
                    value={createDraftTitle}
                    onChange={(event) => setCreateDraftTitle(event.target.value)}
                    placeholder={createSelection.kind === "epic" ? "Type epic title and press Enter..." : "Type user story title and press Enter..."}
                    className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                    autoFocus
                  />
                </div>
                <div className="col-span-8 flex items-center gap-2">
                  <button type="submit" disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-45"><Plus className="size-3.5" /></button>
                  <button type="button" onClick={closeInlineCreator} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"><X className="size-3.5" /></button>
                </div>
              </form>
            ) : null}
            {isInitOpen ? (
              <div>
                {initiative.epics.map((epic) => (
                  <div key={`standalone-epic:${epic.epicId}`}>
                    <div className="group grid items-center gap-3 px-3 py-2 hover:bg-slate-50" style={{ gridTemplateColumns: tableGridTemplate }}>
                      <div className="relative flex min-w-0 items-center gap-2" style={{ paddingLeft: indentPx + 34 }}>
                        <span className="inline-block h-7 w-7 shrink-0" />
                        <button type="button" onClick={() => onOpenEpic(epic.epicId)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <FolderKanban className="size-4 shrink-0 text-slate-700" />
                          {editingParentTitle?.kind === "epic" && editingParentTitle.id === epic.epicId ? (
                            <span className="flex min-w-0 items-center gap-1">
                              <input
                                value={editingParentTitle.value}
                                onChange={(event) => setEditingParentTitle({ kind: "epic", id: epic.epicId, value: event.target.value })}
                                className="h-7 min-w-[180px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                                autoFocus
                              />
                              <button type="button" onClick={() => setEditingParentTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                              <button type="button" onClick={() => void confirmParentTitleEdit("epic", epic.epicId, epic.epicTitle)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                            </span>
                          ) : (
                            <span className="inline-flex min-w-0 items-center gap-1 truncate text-[15px] font-medium text-slate-900">
                              <span className="truncate">{epic.epicTitle}</span>
                              <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); setEditingParentTitle({ kind: "epic", id: epic.epicId, value: epic.epicTitle }); }}
                                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                                aria-label="Edit epic title"
                              >
                                <Pencil className="size-3.5 text-slate-500" />
                              </button>
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openCreateComposer({
                              anchorKey: `group-standalone-epic:${epic.epicId}`,
                              scope: "epic",
                              kind: "story",
                              epicId: epic.epicId,
                            });
                          }}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 ring-1 ring-slate-200 transition hover:bg-white hover:text-slate-900 group-hover:opacity-100"
                          title="Add user story"
                        >
                          <Plus className="size-3.5 text-slate-600" />
                        </button>
                      </div>
                      <span className="justify-self-center text-center text-[15px] text-slate-700">{initiative.initiativeYear}</span>
                      <span className="justify-self-center text-center text-[15px] text-slate-700">{epic.epicQuarterLabelValue}</span>
                      <span className="justify-self-center text-center text-[15px] text-slate-700">{epic.epicMonthLabelValue}</span>
                      <span className={cn("w-fit justify-self-center rounded px-2 py-0.5 text-[13px] font-medium", statusChip("todo"))}>To do</span>
                      <span className="justify-self-center text-center text-[15px] text-slate-500">-</span>
                      <span className="justify-self-center text-center text-[15px] text-slate-700">{epic.epicAssignee}</span>
                      <span className="justify-self-center text-center text-[15px] font-medium text-slate-600" title="Auto-summed from child user stories">Σ 0d</span>
                      <span className="justify-self-center text-center text-[15px] font-medium text-slate-600" title="Auto-summed from child user stories">Σ 0d</span>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[12px] text-slate-600">
                          <span>No stories</span>
                          <span>0/0 · 0%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200" />
                      </div>
                    </div>
                    {createSelection?.anchorKey === `group-standalone-epic:${epic.epicId}` ? (
                      <form onSubmit={handleCreateSubmit} className="grid items-center gap-3 bg-slate-50 px-3 py-2" style={{ gridTemplateColumns: tableGridTemplate }}>
                        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: indentPx + 52 }}>
                          <input
                            value={createDraftTitle}
                            onChange={(event) => setCreateDraftTitle(event.target.value)}
                            placeholder="Type user story title and press Enter..."
                            className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                            autoFocus
                          />
                        </div>
                        <div className="col-span-8 flex items-center gap-2">
                          <button type="submit" disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-45"><Plus className="size-3.5" /></button>
                          <button type="button" onClick={closeInlineCreator} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"><X className="size-3.5" /></button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      });
  }

  function renderStandaloneGroupedTree(rows: typeof groupedStandaloneInitiatives, levelIndex = 0, path = "standalone/"): React.ReactNode {
    if (rows.length === 0) return null;
    if (levelIndex >= groupLevels.length) return renderStandaloneInitiativeRows(rows, levelIndex * 14);
    const level = groupLevels[levelIndex];
    const groups = new Map<string, { label: string; sort: string; rows: typeof groupedStandaloneInitiatives }>();
    for (const row of rows) {
      const { key, label, sort } = keyForStandaloneLevel(row, level);
      if (!groups.has(key)) groups.set(key, { label, sort, rows: [] });
      groups.get(key)!.rows.push(row);
    }
    return Array.from(groups.entries())
      .sort((a, b) => a[1].sort.localeCompare(b[1].sort))
      .map(([key, group]) =>
        renderFolderRow(`${path}${level}:${key}`, group.label, group.rows.length, levelIndex * 14, (
          <>{renderStandaloneGroupedTree(group.rows, levelIndex + 1, `${path}${level}:${key}/`)}</>
        )),
      );
  }

  function openCreateComposer(selection: {
    anchorKey: string;
    scope: CreateScope;
    kind: CreateKind;
    initiativeId?: string;
    epicId?: string;
  }) {
    setOpenCreateMenuKey(null);
    setCreateSelection(selection);
    setCreateDraftTitle("");
    if (selection.kind === "story" && selection.scope === "initiative" && selection.initiativeId) {
      const initiative = initiatives.find((item) => item.id === selection.initiativeId);
      setStoryTargetEpicId(initiative?.epics?.[0]?.id ?? "");
    } else {
      setStoryTargetEpicId(selection.epicId ?? "");
    }
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createSelection) return;
    const title = createDraftTitle.trim();
    if (title.length < 2) return;
    setSubmittingKey("create");
    try {
      if (createSelection.kind === "initiative") {
        await onCreateInitiativeQuick(title);
      } else if (createSelection.kind === "epic") {
        if (!createSelection.initiativeId) return;
        await onCreateEpicQuick(createSelection.initiativeId, title);
        setOpenInitiatives((prev) => ({ ...prev, [createSelection.initiativeId!]: true }));
      } else {
        const epicId = createSelection.scope === "initiative" ? storyTargetEpicId : createSelection.epicId;
        if (!epicId) return;
        await onCreateStoryQuick(epicId, title);
        setOpenEpics((prev) => ({ ...prev, [epicId!]: true }));
      }
      setCreateDraftTitle("");
      setCreateSelection(null);
    } finally {
      setSubmittingKey(null);
    }
  }

  function closeInlineCreator() {
    setCreateSelection(null);
    setCreateDraftTitle("");
    setStoryTargetEpicId("");
  }

  useEffect(() => {
    return () => {
      if (createMenuCloseTimerRef.current) clearTimeout(createMenuCloseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BACKLOG_VIEW_STATE_STORAGE_KEY);
      if (!raw) {
        setHasLoadedViewState(true);
        return;
      }
      const parsed = JSON.parse(raw) as {
        query?: unknown;
        statusFilter?: unknown;
        sprintFilter?: unknown;
        yearFilter?: unknown;
        quarterFilter?: unknown;
        assigneeFilter?: unknown;
        groupLevels?: unknown;
      };
      if (typeof parsed.query === "string") setQuery(parsed.query);
      if (Array.isArray(parsed.statusFilter)) setStatusFilter(parsed.statusFilter.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(parsed.sprintFilter)) setSprintFilter(parsed.sprintFilter.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(parsed.yearFilter)) setYearFilter(parsed.yearFilter.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(parsed.quarterFilter))
        setQuarterFilter(parsed.quarterFilter.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(parsed.assigneeFilter))
        setAssigneeFilter(parsed.assigneeFilter.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(parsed.groupLevels)) {
        const validLevels = parsed.groupLevels.filter(
          (v): v is GroupLevel => v === "year" || v === "quarter" || v === "month" || v === "sprint",
        );
        setGroupLevels(validLevels);
      }
    } catch {
      // Ignore corrupt localStorage entries.
    } finally {
      setHasLoadedViewState(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedViewState) return;
    try {
      window.localStorage.setItem(
        BACKLOG_VIEW_STATE_STORAGE_KEY,
        JSON.stringify({
          query,
          statusFilter,
          sprintFilter,
          yearFilter,
          quarterFilter,
          assigneeFilter,
          groupLevels,
        }),
      );
    } catch {
      // Ignore write failures (private mode, quotas, etc.)
    }
  }, [hasLoadedViewState, query, statusFilter, sprintFilter, yearFilter, quarterFilter, assigneeFilter, groupLevels]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!groupMenuRef.current) return;
      if (groupMenuRef.current.contains(event.target as Node)) return;
      setGroupMenuOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  function scheduleCreateMenuClose() {
    if (createMenuCloseTimerRef.current) clearTimeout(createMenuCloseTimerRef.current);
    createMenuCloseTimerRef.current = setTimeout(() => setOpenCreateMenuKey(null), 160);
  }

  function cancelCreateMenuClose() {
    if (createMenuCloseTimerRef.current) {
      clearTimeout(createMenuCloseTimerRef.current);
      createMenuCloseTimerRef.current = null;
    }
  }

  function collapseAllRows() {
    if (groupLevels.length > 0) {
      setDefaultGroupExpanded(false);
      setOpenGroupFolders({});
      return;
    }
    setDefaultTreeExpanded(false);
    setOpenInitiatives({});
    setOpenEpics({});
  }

  function expandAllRows() {
    if (groupLevels.length > 0) {
      setDefaultGroupExpanded(true);
      setOpenGroupFolders({});
      return;
    }
    setDefaultTreeExpanded(true);
    setOpenInitiatives({});
    setOpenEpics({});
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BACKLOG_COLUMN_WIDTHS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<BacklogColumnKey, number>>;
      setColumnWidths((prev) => {
        const next = { ...prev };
        for (const key of BACKLOG_COLUMN_ORDER) {
          const candidate = parsed[key];
          if (typeof candidate === "number" && Number.isFinite(candidate)) {
            next[key] = Math.max(BACKLOG_COLUMN_MIN_WIDTHS[key], Math.round(candidate));
          }
        }
        return next;
      });
    } catch {
      // Ignore corrupt or unavailable localStorage data.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(BACKLOG_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
    } catch {
      // Ignore write failures (private mode, quotas, etc.)
    }
  }, [columnWidths]);

  function beginColumnResize(key: BacklogColumnKey, event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = { key, startX: event.clientX, startWidth: columnWidths[key] };
  }

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const active = resizeStateRef.current;
      if (!active) return;
      const delta = event.clientX - active.startX;
      const minWidth = BACKLOG_COLUMN_MIN_WIDTHS[active.key];
      const nextWidth = Math.max(minWidth, active.startWidth + delta);
      setColumnWidths((prev) => ({ ...prev, [active.key]: nextWidth }));
    }

    function onMouseUp() {
      resizeStateRef.current = null;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <section className="h-full min-h-0 overflow-hidden rounded-2xl bg-gradient-to-b from-white to-slate-50/60 p-4 shadow-xl ring-1 ring-slate-200/80">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 ring-1 ring-slate-200">
            <ClipboardList className="size-4" />
          </span>
          <h2 className="text-[24px] font-semibold tracking-tight text-slate-900">Backlog</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200">
            {fullyFiltered.length} initiatives
          </span>
          <span className="rounded-full bg-blue-100 px-3 py-1 text-[12px] font-semibold text-blue-700">
            {visibleEpicCount} epics
          </span>
          <span className="rounded-full bg-violet-100 px-3 py-1 text-[12px] font-semibold text-violet-700">
            {visibleStoryCount} stories
          </span>
        </div>
      </div>

      <div className="relative mb-3 flex items-center gap-2 rounded-xl border border-slate-300/70 bg-gradient-to-b from-slate-100 via-slate-50 to-white p-2.5 shadow-sm ring-1 ring-white/60">
        <Search className="size-4 text-slate-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search work items..."
          autoComplete="off"
          onFocus={() => setShowSearchSuggestions(true)}
          onBlur={() => {
            window.setTimeout(() => setShowSearchSuggestions(false), 120);
          }}
          className="h-9 w-full rounded-lg bg-white/95 px-3 text-[14px] text-slate-700 outline-none ring-1 ring-slate-300/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] transition focus:ring-2 focus:ring-blue-200/70"
        />
        {showSearchSuggestions && searchSuggestions.length > 0 ? (
          <div className="absolute left-2 right-2 top-[calc(100%+0.35rem)] z-20 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            {searchSuggestions.map((item) => (
              <button
                key={item}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setQuery(item);
                  setShowSearchSuggestions(false);
                }}
                className="block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-slate-700 transition hover:bg-slate-100"
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-4 rounded-xl border border-slate-300/70 bg-gradient-to-b from-slate-100 via-slate-50 to-white p-3 shadow-sm ring-1 ring-white/60">
        <div className="relative" ref={groupMenuRef}>
          <button
            type="button"
            onClick={() => setGroupMenuOpen((prev) => !prev)}
            className="flex h-8 min-w-[11rem] items-center justify-between rounded-lg bg-gradient-to-b from-white to-slate-50 px-2.5 text-[13px] ring-1 ring-slate-300/80 shadow-sm transition hover:from-slate-50 hover:to-slate-100 hover:ring-slate-400/80"
          >
            <span className="font-medium text-slate-700">Group By:</span>
            <span className="ml-1 truncate text-slate-600">{groupSummaryLabel}</span>
          </button>
          {groupMenuOpen ? (
            <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
              {GROUP_LEVEL_ORDER.map((level, idx) => {
                const checked = groupLevels.includes(level);
                const disabled = idx > 0 && !groupLevels.includes(GROUP_LEVEL_ORDER[idx - 1]);
                return (
                  <label key={level} className={cn("mb-1 flex items-center gap-2 rounded px-1.5 py-1 text-[13px] text-slate-700", disabled && "opacity-50")}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled && !checked}
                      onChange={() => toggleGroupLevel(level)}
                      className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                    {GROUP_LEVEL_LABELS[level]}
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>
        <MultiCheckboxFilter label="Status" options={statusOptions} selected={statusFilter} onChange={setStatusFilter} />
        <MultiCheckboxFilter label="Sprint" options={sprintOptions} selected={sprintFilter} onChange={setSprintFilter} />
        <MultiCheckboxFilter label="Year" options={yearOptions} selected={yearFilter} onChange={setYearFilter} />
        <MultiCheckboxFilter label="Quarter" options={quarterOptions} selected={quarterFilter} onChange={setQuarterFilter} />
        <MultiCheckboxFilter
          label="Assignee"
          options={assigneeOptions}
          selected={assigneeFilter}
          onChange={setAssigneeFilter}
        />
        {groupLevels.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              openCreateComposer({
                anchorKey: "group-toolbar:add-initiative",
                scope: "initiative",
                kind: "initiative",
              })
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-b from-white to-slate-50 px-2.5 text-[13px] font-medium text-slate-700 ring-1 ring-slate-300/80 shadow-sm transition hover:from-slate-50 hover:to-slate-100 hover:ring-slate-400/80"
          >
            <Plus className="size-3.5 text-slate-600" />
            Initiative
          </button>
        ) : null}
        <MultiCheckboxFilter
          label="Work Item"
          options={workItemOptions}
          selected={workItemFilter}
          onChange={(next) =>
            setWorkItemFilter(
              next.filter((value): value is WorkItemKindFilter => value === "initiative" || value === "epic" || value === "story"),
            )
          }
        />
      </div>
      {createSelection?.anchorKey === "group-toolbar:add-initiative" ? (
        <form
          onSubmit={handleCreateSubmit}
          className="mb-3 grid items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
          style={{ gridTemplateColumns: tableGridTemplate }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <input
              value={createDraftTitle}
              onChange={(event) => setCreateDraftTitle(event.target.value)}
              placeholder="Type initiative title and press Enter..."
              className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              autoFocus
            />
          </div>
          <div className="col-span-8 flex items-center gap-2">
            <button type="submit" disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-45"><Plus className="size-3.5" /></button>
            <button type="button" onClick={closeInlineCreator} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"><X className="size-3.5" /></button>
          </div>
        </form>
      ) : null}

      <div className="h-[calc(100%-6.2rem)] overflow-auto rounded-xl border border-slate-200 bg-white shadow-inner">
        <>
        <div
          className="sticky top-0 z-10 grid items-center gap-3 border-b border-slate-200 bg-gradient-to-b from-slate-100 to-slate-50 px-3 py-2.5 text-[13px] font-semibold tracking-[0.02em] text-slate-700 uppercase"
          style={{ gridTemplateColumns: tableGridTemplate }}
        >
          {BACKLOG_COLUMN_ORDER.map((key, index) => (
            <div key={key} className={cn("relative min-w-0", CENTER_ALIGNED_BACKLOG_COLUMNS.has(key) && "text-center")}>
              {key === "workItem" ? (
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate">{BACKLOG_COLUMN_LABELS[key]}</span>
                  <span className="inline-flex items-center gap-0.5 rounded-md bg-white/80 p-0.5 ring-1 ring-slate-200/90">
                    <button
                      type="button"
                      onClick={collapseAllRows}
                      title="Collapse all rows"
                      aria-label="Collapse all rows"
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-600 transition hover:bg-slate-100 hover:text-slate-800"
                    >
                      <ChevronsUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={expandAllRows}
                      title="Expand all rows"
                      aria-label="Expand all rows"
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-600 transition hover:bg-slate-100 hover:text-slate-800"
                    >
                      <ChevronsDown className="size-3.5" />
                    </button>
                  </span>
                </span>
              ) : (
                <span className="truncate">{BACKLOG_COLUMN_LABELS[key]}</span>
              )}
              {index < BACKLOG_COLUMN_ORDER.length - 1 ? (
                <button
                  type="button"
                  aria-label={`Resize ${BACKLOG_COLUMN_LABELS[key]} column`}
                  onMouseDown={(event) => beginColumnResize(key, event)}
                  className="absolute -right-1 top-0 h-full w-2 cursor-col-resize"
                >
                  <span className="absolute right-0 top-1/2 h-4 w-px -translate-y-1/2 bg-slate-300" />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {fullyFiltered.length === 0 ? (
          <div className="p-4 text-[16px] text-slate-600">No items match your search/filter settings.</div>
        ) : (
          <div className="divide-y divide-slate-100 bg-white">
            {groupLevels.length > 0 ? (
              <>
                {renderGroupedTree(groupedStoryRows)}
                {renderStandaloneGroupedTree(groupedStandaloneInitiatives)}
              </>
            ) : (
            <>
            {fullyFiltered.map((initiative) => {
              const isInitOpen = openInitiatives[initiative.id] ?? defaultTreeExpanded;
              const initiativeStories = (initiative.epics ?? []).flatMap((epic) => epic.userStories ?? []);
              const initiativeWorkflowStatus = rollupWorkflowStatus(initiativeStories);
              const initiativeDays = sumStoryDays(initiativeStories);
              const initiativeProgress = completionFromStories(initiativeStories);
              return (
                <div key={initiative.id}>
                  <div
                    className="group grid items-center gap-3 px-3 py-2 hover:bg-slate-50"
                    style={{ gridTemplateColumns: tableGridTemplate }}
                  >
                    <div
                      className="relative flex min-w-0 items-center gap-2"
                      onMouseEnter={cancelCreateMenuClose}
                      onMouseLeave={scheduleCreateMenuClose}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenInitiatives((prev) => ({ ...prev, [initiative.id]: !isInitOpen }))}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                        aria-label={isInitOpen ? "Collapse initiative" : "Expand initiative"}
                      >
                        {isInitOpen ? (
                          <ChevronDown className="size-4 shrink-0 text-slate-500" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-slate-500" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenInitiative(initiative.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <Target className="size-4 shrink-0 text-slate-700" />
                        {editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiative.id ? (
                          <span className="flex min-w-0 items-center gap-1">
                            <input
                              value={editingParentTitle.value}
                              onChange={(event) => setEditingParentTitle({ kind: "initiative", id: initiative.id, value: event.target.value })}
                              className="h-7 min-w-[220px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                              autoFocus
                            />
                            <button type="button" onClick={() => setEditingParentTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                            <button type="button" onClick={() => void confirmParentTitleEdit("initiative", initiative.id, initiative.title)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                          </span>
                        ) : (
                          <span className="inline-flex min-w-0 items-center gap-1 truncate text-[17px] font-medium text-slate-900">
                            <span className="truncate">{initiative.title}</span>
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); setEditingParentTitle({ kind: "initiative", id: initiative.id, value: initiative.title }); }}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                              aria-label="Edit initiative title"
                            >
                              <Pencil className="size-3.5 text-slate-500" />
                            </button>
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenCreateMenuKey((prev) => (prev === `initiative:${initiative.id}` ? null : `initiative:${initiative.id}`));
                        }}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ring-1 ring-slate-200 text-slate-700 transition hover:bg-white hover:text-slate-900"
                        title="Add from this row"
                      >
                        <Plus className="size-3.5 text-slate-600" />
                      </button>
                      {openCreateMenuKey === `initiative:${initiative.id}` ? (
                        <div className="absolute left-full top-1/2 z-30 ml-2 w-52 -translate-y-1/2 rounded-xl border border-slate-200/90 bg-white/95 p-2 shadow-xl backdrop-blur-sm">
                          <button
                            type="button"
                            onClick={() =>
                              openCreateComposer({
                                anchorKey: `initiative:${initiative.id}`,
                                scope: "initiative",
                                kind: "initiative",
                                initiativeId: initiative.id,
                              })
                            }
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Target className="size-3.5 text-slate-500" />
                            Add initiative
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openCreateComposer({
                                anchorKey: `initiative:${initiative.id}`,
                                scope: "initiative",
                                kind: "epic",
                                initiativeId: initiative.id,
                              })
                            }
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <FolderKanban className="size-3.5 text-slate-500" />
                            Add epic
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openCreateComposer({
                                anchorKey: `initiative:${initiative.id}`,
                                scope: "initiative",
                                kind: "story",
                                initiativeId: initiative.id,
                              })
                            }
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <FileText className="size-3.5 text-slate-500" />
                            Add user story
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <span className="justify-self-center text-center text-[15px] text-slate-700">{initiative.year}</span>
                    <span className="justify-self-center text-center text-[15px] text-slate-700">
                      {quarterFromMonth(initiative.startMonth)}
                    </span>
                    <span className="justify-self-center text-center text-[15px] text-slate-700">
                      {monthLabel(initiative.startMonth)}
                    </span>
                    <span className={cn("w-fit justify-self-center rounded px-2 py-0.5 text-[13px] font-medium", statusChip(initiativeWorkflowStatus))}>
                      {workflowStatusLabel(initiativeWorkflowStatus)}
                    </span>
                    <span className="justify-self-center text-center text-[15px] text-slate-500">-</span>
                    <span className="justify-self-center text-center text-[15px] text-slate-700">
                      {editingParentAssignee?.kind === "initiative" && editingParentAssignee.id === initiative.id ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            value={editingParentAssignee.value}
                            onChange={(event) => setEditingParentAssignee((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                            placeholder="Unassigned"
                            className="h-7 w-full min-w-[104px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                          />
                          <button type="button" onClick={() => setEditingParentAssignee(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                          <button type="button" onClick={() => void confirmParentAssigneeEdit("initiative", initiative.id, initiative.assignee)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setEditingParentAssignee({ kind: "initiative", id: initiative.id, value: initiative.assignee?.trim() || "" });
                          }}
                          className="rounded px-1 py-0.5 hover:bg-slate-100"
                        >
                          {initiative.assignee ?? "Unassigned"}
                        </button>
                      )}
                    </span>
                    <span
                      className="justify-self-center text-center text-[15px] font-medium text-slate-600"
                      title="Auto-summed from child user stories"
                    >
                      Σ {initiativeDays.estimated}d
                    </span>
                    <span
                      className="justify-self-center text-center text-[15px] font-medium text-slate-600"
                      title="Auto-summed from child user stories"
                    >
                      Σ {initiativeDays.left}d
                    </span>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[12px] text-slate-600">
                        <span>{initiativeProgress.total === 0 ? "No stories" : "Completion"}</span>
                        <span>
                          {initiativeProgress.finished}/{initiativeProgress.total} · {initiativeProgress.percent}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500 transition-all"
                          style={{ width: `${initiativeProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  {createSelection?.anchorKey === `initiative:${initiative.id}` && createSelection.kind === "initiative" ? (
                    <form
                      onSubmit={handleCreateSubmit}
                      className="grid items-center gap-3 bg-slate-50 px-3 py-2"
                      style={{ gridTemplateColumns: tableGridTemplate }}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          value={createDraftTitle}
                          onChange={(event) => setCreateDraftTitle(event.target.value)}
                          placeholder="Type initiative title and press Enter..."
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          data-1p-ignore="true"
                          data-lpignore="true"
                          data-bwignore="true"
                          data-form-type="other"
                          data-protonpass-ignore="true"
                          className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                          autoFocus
                        />
                      </div>
                      <div className="col-span-8 flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Plus className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={closeInlineCreator}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {isInitOpen ? (
                    <div className="bg-slate-50/50">
                      {createSelection?.anchorKey === `initiative:${initiative.id}` && createSelection.kind !== "initiative" ? (
                        <form
                          onSubmit={handleCreateSubmit}
                          className="grid items-center gap-3 px-3 py-2"
                          style={{ gridTemplateColumns: tableGridTemplate }}
                        >
                          <div className="flex min-w-0 items-center gap-2 pl-6">
                            <input
                              value={createDraftTitle}
                              onChange={(event) => setCreateDraftTitle(event.target.value)}
                              placeholder={
                                createSelection.kind === "epic"
                                  ? "Type epic title and press Enter..."
                                  : "Type user story title and press Enter..."
                              }
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              data-1p-ignore="true"
                              data-lpignore="true"
                              data-bwignore="true"
                              data-form-type="other"
                              data-protonpass-ignore="true"
                              className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                              autoFocus
                            />
                          </div>
                          <div className="col-span-8 flex items-center gap-2">
                            {createSelection.kind === "story" ? (
                              <select
                                value={storyTargetEpicId}
                                onChange={(event) => setStoryTargetEpicId(event.target.value)}
                                className="h-9 rounded-md bg-white px-2 text-[14px] ring-1 ring-slate-200 outline-none"
                              >
                                <option value="">Select epic</option>
                                {(initiative.epics ?? []).map((epic) => (
                                  <option key={epic.id} value={epic.id}>
                                    {epic.icon} {epic.title}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                            <button
                              type="submit"
                              disabled={
                                createDraftTitle.trim().length < 2 ||
                                submittingKey === "create" ||
                                (createSelection.kind === "story" && !storyTargetEpicId)
                              }
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <Plus className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={closeInlineCreator}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        </form>
                      ) : null}
                      {(initiative.epics ?? []).map((epic) => {
                        const isEpicOpen = openEpics[epic.id] ?? defaultTreeExpanded;
                        const epicWorkflowStatus = rollupWorkflowStatus(epic.userStories ?? []);
                        const epicDays = sumStoryDays(epic.userStories ?? []);
                        const epicProgress = completionFromStories(epic.userStories ?? []);
                        return (
                          <div key={epic.id}>
                            <div
                              className="group grid items-center gap-3 px-3 py-2 hover:bg-slate-50"
                              style={{ gridTemplateColumns: tableGridTemplate }}
                            >
                              <div
                                className="relative flex min-w-0 items-center gap-2 pl-6"
                                onMouseEnter={cancelCreateMenuClose}
                                onMouseLeave={scheduleCreateMenuClose}
                              >
                                <button
                                  type="button"
                                  onClick={() => setOpenEpics((prev) => ({ ...prev, [epic.id]: !isEpicOpen }))}
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                                  aria-label={isEpicOpen ? "Collapse epic" : "Expand epic"}
                                >
                                  {isEpicOpen ? (
                                    <ChevronDown className="size-4 shrink-0 text-slate-500" />
                                  ) : (
                                    <ChevronRight className="size-4 shrink-0 text-slate-500" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onOpenEpic(epic.id)}
                                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                >
                                  <span className="inline-block size-4 shrink-0" aria-hidden />
                                  {editingParentTitle?.kind === "epic" && editingParentTitle.id === epic.id ? (
                                    <span className="flex min-w-0 items-center gap-1">
                                      <input
                                        value={editingParentTitle.value}
                                        onChange={(event) => setEditingParentTitle({ kind: "epic", id: epic.id, value: event.target.value })}
                                        className="h-7 min-w-[200px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                                        autoFocus
                                      />
                                      <button type="button" onClick={() => setEditingParentTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                      <button type="button" onClick={() => void confirmParentTitleEdit("epic", epic.id, epic.title)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                                    </span>
                                  ) : (
                                    <span className="inline-flex min-w-0 items-center gap-1 truncate text-[16px] font-medium text-slate-800">
                                      <span className="truncate">{epic.icon} {epic.title}</span>
                                      <button
                                        type="button"
                                        onClick={(event) => { event.stopPropagation(); setEditingParentTitle({ kind: "epic", id: epic.id, value: epic.title }); }}
                                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                                        aria-label="Edit epic title"
                                      >
                                        <Pencil className="size-3.5 text-slate-500" />
                                      </button>
                                    </span>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setOpenCreateMenuKey((prev) => (prev === `epic:${epic.id}` ? null : `epic:${epic.id}`));
                                  }}
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 ring-1 ring-slate-200 transition hover:bg-white hover:text-slate-900 group-hover:opacity-100"
                                  title="Add from this row"
                                >
                                  <Plus className="size-3.5 text-slate-600" />
                                </button>
                                {openCreateMenuKey === `epic:${epic.id}` ? (
                                  <div className="absolute left-full top-1/2 z-30 ml-2 w-52 -translate-y-1/2 rounded-xl border border-slate-200/90 bg-white/95 p-2 shadow-xl backdrop-blur-sm">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openCreateComposer({
                                          anchorKey: `epic:${epic.id}`,
                                          scope: "epic",
                                          kind: "epic",
                                          initiativeId: initiative.id,
                                        })
                                      }
                                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                      <FolderKanban className="size-3.5 text-slate-500" />
                                      Add epic
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openCreateComposer({
                                          anchorKey: `epic:${epic.id}`,
                                          scope: "epic",
                                          kind: "story",
                                          epicId: epic.id,
                                        })
                                      }
                                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                      <FileText className="size-3.5 text-slate-500" />
                                      Add user story
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                              <span className="justify-self-center text-center text-[15px] text-slate-700">{initiative.year}</span>
                              <span className="justify-self-center text-center text-[15px] text-slate-700">
                                {quarterFromMonth(epic.planStartMonth ?? initiative.startMonth)}
                              </span>
                              <span className="justify-self-center text-center text-[15px] text-slate-700">
                                {monthLabel(epic.planStartMonth ?? initiative.startMonth)}
                              </span>
                              <span className={cn("w-fit justify-self-center rounded px-2 py-0.5 text-[13px] font-medium", statusChip(epicWorkflowStatus))}>
                                {workflowStatusLabel(epicWorkflowStatus)}
                              </span>
                              <span className="justify-self-center text-center text-[15px] text-slate-500">-</span>
                              <span className="justify-self-center text-center text-[15px] text-slate-700">
                                {editingParentAssignee?.kind === "epic" && editingParentAssignee.id === epic.id ? (
                                  <span className="inline-flex items-center gap-1">
                                    <input
                                      value={editingParentAssignee.value}
                                      onChange={(event) => setEditingParentAssignee((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                                      placeholder="Unassigned"
                                      className="h-7 w-full min-w-[104px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                                    />
                                    <button type="button" onClick={() => setEditingParentAssignee(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                    <button type="button" onClick={() => void confirmParentAssigneeEdit("epic", epic.id, epic.assignee)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      setEditingParentAssignee({ kind: "epic", id: epic.id, value: epic.assignee?.trim() || "" });
                                    }}
                                    className="rounded px-1 py-0.5 hover:bg-slate-100"
                                  >
                                    {epic.assignee ?? "Unassigned"}
                                  </button>
                                )}
                              </span>
                              <span
                                className="justify-self-center text-center text-[15px] font-medium text-slate-600"
                                title="Auto-summed from child user stories"
                              >
                                Σ {epicDays.estimated}d
                              </span>
                              <span
                                className="justify-self-center text-center text-[15px] font-medium text-slate-600"
                                title="Auto-summed from child user stories"
                              >
                                Σ {epicDays.left}d
                              </span>
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[12px] text-slate-600">
                                  <span>{epicProgress.total === 0 ? "No stories" : "Completion"}</span>
                                  <span>
                                    {epicProgress.finished}/{epicProgress.total} · {epicProgress.percent}%
                                  </span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500 transition-all"
                                    style={{ width: `${epicProgress.percent}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                            {createSelection?.anchorKey === `epic:${epic.id}` ? (
                              <form
                                onSubmit={handleCreateSubmit}
                                className="grid items-center gap-3 px-3 py-2"
                                style={{ gridTemplateColumns: tableGridTemplate }}
                              >
                                <div className="flex min-w-0 items-center gap-2 pl-12">
                                  <input
                                    value={createDraftTitle}
                                    onChange={(event) => setCreateDraftTitle(event.target.value)}
                                    placeholder={
                                      createSelection.kind === "epic"
                                        ? "Type epic title and press Enter..."
                                        : "Type user story title and press Enter..."
                                    }
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    data-1p-ignore="true"
                                    data-lpignore="true"
                                    data-bwignore="true"
                                    data-form-type="other"
                                    data-protonpass-ignore="true"
                                    className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                                    autoFocus
                                  />
                                </div>
                                <div className="col-span-8 flex items-center gap-2">
                                  <button
                                    type="submit"
                                    disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:cursor-not-allowed disabled:opacity-45"
                                  >
                                    <Plus className="size-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={closeInlineCreator}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"
                                  >
                                    <X className="size-3.5" />
                                  </button>
                                </div>
                              </form>
                            ) : null}

                            {isEpicOpen ? (
                              <div>
                                {(epic.userStories ?? []).map((story) => (
                                  <div key={story.id}>
                                    {(() => {
                                      const progress = storyCompletion(story);
                                      return (
                                    <div
                                      className="group grid w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                                      style={{ gridTemplateColumns: tableGridTemplate }}
                                    >
                                    <div
                                      className="relative flex min-w-0 items-center gap-2 pl-24"
                                      onMouseEnter={cancelCreateMenuClose}
                                      onMouseLeave={scheduleCreateMenuClose}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => onOpenStory(story.id)}
                                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                      >
                                        <span className="inline-block size-3.5 shrink-0" aria-hidden />
                                        {editingStoryTitle?.id === story.id ? (
                                          <span className="flex min-w-0 items-center gap-1">
                                            <input
                                              value={editingStoryTitle.value}
                                              onChange={(event) => setEditingStoryTitle({ id: story.id, value: event.target.value })}
                                              className="h-7 min-w-[200px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                                              autoFocus
                                            />
                                            <button type="button" onClick={() => setEditingStoryTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                            <button type="button" onClick={() => void confirmStoryTitleEdit(story.id, story.title)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                                          </span>
                                        ) : (
                                          <span className="inline-flex min-w-0 items-center gap-1 truncate text-[15px] text-slate-800">
                                            <span className="truncate">{story.icon} {story.title}</span>
                                            <button
                                              type="button"
                                              onClick={(event) => { event.stopPropagation(); setEditingStoryTitle({ id: story.id, value: story.title }); }}
                                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                                              aria-label="Edit user story title"
                                            >
                                              <Pencil className="size-3.5 text-slate-500" />
                                            </button>
                                          </span>
                                        )}
                                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[12px] font-semibold text-slate-600">
                                          #{storyRefById[story.id] ?? story.id.slice(0, 6)}
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setOpenCreateMenuKey((prev) => (prev === `story:${story.id}` ? null : `story:${story.id}`));
                                        }}
                                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 ring-1 ring-slate-200 transition hover:bg-white hover:text-slate-900 group-hover:opacity-100"
                                        title="Add from this row"
                                      >
                                        <Plus className="size-3.5 text-slate-600" />
                                      </button>
                                      {openCreateMenuKey === `story:${story.id}` ? (
                                        <div className="absolute left-full top-1/2 z-30 ml-2 w-52 -translate-y-1/2 rounded-xl border border-slate-200/90 bg-white/95 p-2 shadow-xl backdrop-blur-sm">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openCreateComposer({
                                                anchorKey: `story:${story.id}`,
                                                scope: "story",
                                                kind: "story",
                                                epicId: epic.id,
                                              })
                                            }
                                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                                          >
                                            <FileText className="size-3.5 text-slate-500" />
                                            Add user story
                                          </button>
                                        </div>
                                      ) : null}
                                    </div>
                                    <span className="justify-self-center text-center text-[15px] text-slate-700">{initiative.year}</span>
                                    <span className="justify-self-center text-center text-[15px] text-slate-700">
                                      {quarterFromMonth(epic.planStartMonth ?? initiative.startMonth)}
                                    </span>
                                    <span className="justify-self-center text-center text-[15px] text-slate-700">
                                      {monthLabel(epic.planStartMonth ?? initiative.startMonth)}
                                    </span>
                                    <span
                                      className={cn(
                                        "w-fit justify-self-center rounded px-2 py-0.5 text-[13px] font-medium",
                                        statusChip(story.status),
                                      )}
                                    >
                                      {editingStoryCell?.storyId === story.id && editingStoryCell.field === "status" ? (
                                        <span className="flex items-center gap-1">
                                          <select
                                            value={editingStoryCell.value}
                                            onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                                            onKeyDown={(event) =>
                                              handleStoryCellKeyDown(event, story.id, "status", {
                                                status: story.status,
                                                sprint: story.sprint,
                                                assignee: story.assignee,
                                                estimatedDays: story.estimatedDays,
                                                daysLeft: story.daysLeft,
                                              })
                                            }
                                            className="w-full cursor-pointer bg-transparent text-[13px] font-medium outline-none"
                                          >
                                            <option value="todo">To do</option>
                                            <option value="inProgress">In progress</option>
                                            <option value="done">Done</option>
                                            <option value="approved">Approved</option>
                                          </select>
                                          <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-slate-200"><X className="size-3" /></button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              confirmStoryCellEdit(story.id, "status", {
                                                status: story.status,
                                                sprint: story.sprint,
                                                assignee: story.assignee,
                                                estimatedDays: story.estimatedDays,
                                                daysLeft: story.daysLeft,
                                              })
                                            }
                                            className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-slate-200"
                                          ><Check className="size-3" /></button>
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onMouseDown={(event) => {
                                            event.preventDefault();
                                            beginStoryCellEdit(story.id, "status", story.status);
                                          }}
                                          className="text-[13px] font-medium"
                                        >
                                          {story.status === "inProgress" ? "In progress" : story.status}
                                        </button>
                                      )}
                                    </span>
                                    <span className="justify-self-center text-center text-[15px] text-slate-700">
                                      {editingStoryCell?.storyId === story.id && editingStoryCell.field === "sprint" ? (
                                        <span className="inline-flex items-center gap-1">
                                          <select
                                            value={editingStoryCell.value}
                                            onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                                            onKeyDown={(event) =>
                                              handleStoryCellKeyDown(event, story.id, "sprint", {
                                                status: story.status,
                                                sprint: story.sprint,
                                                assignee: story.assignee,
                                                estimatedDays: story.estimatedDays,
                                                daysLeft: story.daysLeft,
                                              })
                                            }
                                            className="h-7 min-w-[96px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                                          >
                                            <option value="unscheduled">Unscheduled</option>
                                            <option value="1">Sprint 1</option>
                                            <option value="2">Sprint 2</option>
                                          </select>
                                          <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              confirmStoryCellEdit(story.id, "sprint", {
                                                status: story.status,
                                                sprint: story.sprint,
                                                assignee: story.assignee,
                                                estimatedDays: story.estimatedDays,
                                                daysLeft: story.daysLeft,
                                              })
                                            }
                                            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
                                          ><Check className="size-3.5" /></button>
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onMouseDown={(event) => {
                                            event.preventDefault();
                                            beginStoryCellEdit(story.id, "sprint", story.sprint == null ? "unscheduled" : String(story.sprint));
                                          }}
                                          className="rounded px-1 py-0.5 hover:bg-slate-100"
                                        >
                                          {sprintLabel(story.sprint)}
                                        </button>
                                      )}
                                    </span>
                                    <span className="justify-self-center text-center text-[15px] text-slate-700">
                                      {editingStoryCell?.storyId === story.id && editingStoryCell.field === "assignee" ? (
                                        <span className="inline-flex items-center gap-1">
                                          <input
                                            value={editingStoryCell.value}
                                            onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                                            onKeyDown={(event) =>
                                              handleStoryCellKeyDown(event, story.id, "assignee", {
                                                status: story.status,
                                                sprint: story.sprint,
                                                assignee: story.assignee,
                                                estimatedDays: story.estimatedDays,
                                                daysLeft: story.daysLeft,
                                              })
                                            }
                                            placeholder="Unassigned"
                                            className="h-7 w-full min-w-[104px] rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                                          />
                                          <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              confirmStoryCellEdit(story.id, "assignee", {
                                                status: story.status,
                                                sprint: story.sprint,
                                                assignee: story.assignee,
                                                estimatedDays: story.estimatedDays,
                                                daysLeft: story.daysLeft,
                                              })
                                            }
                                            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
                                          ><Check className="size-3.5" /></button>
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onMouseDown={(event) => {
                                            event.preventDefault();
                                            beginStoryCellEdit(story.id, "assignee", story.assignee?.trim() || "");
                                          }}
                                          className="rounded px-1 py-0.5 hover:bg-slate-100"
                                        >
                                          {story.assignee?.trim() || "Unassigned"}
                                        </button>
                                      )}
                                    </span>
                                    <span className="justify-self-center text-center text-[15px] text-slate-700">
                                      {editingStoryCell?.storyId === story.id && editingStoryCell.field === "estimatedDays" ? (
                                        <span className="inline-flex items-center gap-1">
                                          <input
                                            type="number"
                                            min={0}
                                            value={editingStoryCell.value}
                                            onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                                            onKeyDown={(event) =>
                                              handleStoryCellKeyDown(event, story.id, "estimatedDays", {
                                                status: story.status,
                                                sprint: story.sprint,
                                                assignee: story.assignee,
                                                estimatedDays: story.estimatedDays,
                                                daysLeft: story.daysLeft,
                                              })
                                            }
                                            className="h-7 w-20 rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                                          />
                                          <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              confirmStoryCellEdit(story.id, "estimatedDays", {
                                                status: story.status,
                                                sprint: story.sprint,
                                                assignee: story.assignee,
                                                estimatedDays: story.estimatedDays,
                                                daysLeft: story.daysLeft,
                                              })
                                            }
                                            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
                                          ><Check className="size-3.5" /></button>
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onMouseDown={(event) => {
                                            event.preventDefault();
                                            beginStoryCellEdit(story.id, "estimatedDays", String(story.estimatedDays ?? 0));
                                          }}
                                          className="rounded px-1 py-0.5 hover:bg-slate-100"
                                        >
                                          {story.estimatedDays ?? 0}d
                                        </button>
                                      )}
                                    </span>
                                    <span className="justify-self-center text-center text-[15px] text-slate-700">
                                      {editingStoryCell?.storyId === story.id && editingStoryCell.field === "daysLeft" ? (
                                        <span className="inline-flex items-center gap-1">
                                          <input
                                            type="number"
                                            min={0}
                                            value={editingStoryCell.value}
                                            onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                                            onKeyDown={(event) =>
                                              handleStoryCellKeyDown(event, story.id, "daysLeft", {
                                                status: story.status,
                                                sprint: story.sprint,
                                                assignee: story.assignee,
                                                estimatedDays: story.estimatedDays,
                                                daysLeft: story.daysLeft,
                                              })
                                            }
                                            className="h-7 w-20 rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
                                          />
                                          <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              confirmStoryCellEdit(story.id, "daysLeft", {
                                                status: story.status,
                                                sprint: story.sprint,
                                                assignee: story.assignee,
                                                estimatedDays: story.estimatedDays,
                                                daysLeft: story.daysLeft,
                                              })
                                            }
                                            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
                                          ><Check className="size-3.5" /></button>
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onMouseDown={(event) => {
                                            event.preventDefault();
                                            beginStoryCellEdit(story.id, "daysLeft", String(story.daysLeft ?? 0));
                                          }}
                                          className="rounded px-1 py-0.5 hover:bg-slate-100"
                                        >
                                          {story.daysLeft ?? 0}d
                                        </button>
                                      )}
                                    </span>
                                    <div className="space-y-1">
                                      <div className="flex items-center justify-between text-[12px] text-slate-600">
                                        <span>{progress.label}</span>
                                        <span>{progress.percent}%</span>
                                      </div>
                                      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                                        <div
                                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500 transition-all"
                                          style={{ width: `${progress.percent}%` }}
                                        />
                                      </div>
                                    </div>
                                    </div>
                                      );
                                    })()}
                                  {createSelection?.anchorKey === `story:${story.id}` ? (
                                    <form
                                      onSubmit={handleCreateSubmit}
                                      className="grid items-center gap-3 bg-slate-50 px-3 py-2"
                                      style={{ gridTemplateColumns: tableGridTemplate }}
                                    >
                                      <div className="flex min-w-0 items-center gap-2 pl-16">
                                        <input
                                          value={createDraftTitle}
                                          onChange={(event) => setCreateDraftTitle(event.target.value)}
                                          placeholder="Type user story title and press Enter..."
                                          autoComplete="off"
                                          autoCorrect="off"
                                          autoCapitalize="none"
                                          spellCheck={false}
                                          data-1p-ignore="true"
                                          data-lpignore="true"
                                          data-bwignore="true"
                                          data-form-type="other"
                                          data-protonpass-ignore="true"
                                          className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                                          autoFocus
                                        />
                                      </div>
                                      <div className="col-span-8 flex items-center gap-2">
                                        <button
                                          type="submit"
                                          disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"}
                                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:cursor-not-allowed disabled:opacity-45"
                                        >
                                          <Plus className="size-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={closeInlineCreator}
                                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"
                                        >
                                          <X className="size-3.5" />
                                        </button>
                                      </div>
                                    </form>
                                  ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
            </>
            )}
          </div>
        )}
        </>
      </div>
    </section>
  );
}
