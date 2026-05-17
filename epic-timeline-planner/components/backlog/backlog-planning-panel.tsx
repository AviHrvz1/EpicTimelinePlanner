"use client";

import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Bookmark,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Eraser,
  FileSpreadsheet,
  Filter,
  Folder,
  Layers3,
  LayoutGrid,
  ListTodo,
  Lock,
  Map as MapIcon,
  PlayCircle,
  Plus,
  Save,
  Search,
  TableProperties,
  Trash2,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { EditRowIconButton } from "@/components/ui/edit-row-icon-button";
import { TableColumnDragGrip } from "@/components/ui/table-column-drag-grip";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import {
  formatBacklogPlanDate,
  ganttDateRangeForEpic,
  ganttDateRangeForInitiative,
  storyWorkPlanRangeFromProgress,
} from "@/lib/backlog-plan-dates";
import { EpicPlanBarIcon } from "@/components/timeline/epic-plan-bar";
import { exportBacklogToPrintableWindow } from "@/lib/backlog-excel-export";
import { collectAssigneeNameSuggestions } from "@/lib/delivery-assignees";
import { monthTeamLabelForId, MONTH_TEAM_COLUMNS } from "@/lib/month-team-board";
import { defaultMembersForTeam } from "@/lib/sprint-capacity";
import { EpicItem, InitiativeItem, RoadmapItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { teamLabelForWorkspaceUser } from "@/lib/workspace-users";
import { sprintEndDate, YEAR_SPRINT_MAX } from "@/lib/year-sprint";

/** Softer than shared table zebra -- long wide rows read cleaner with lower-contrast bands. */
const BACKLOG_TABLE_STRIPE_BG = "#f4f7fc";
const BACKLOG_TABLE_BASE_BG = "#ffffff";

const TEAM_DOT_COLOR: Record<string, string> = {
  platform: "bg-sky-500",
  experience: "bg-violet-500",
  data: "bg-amber-500",
  mobile: "bg-emerald-500",
  growth: "bg-rose-500",
};

function aggregateInitiativeTeamId(initiative: InitiativeItem): string | null {
  const teams = new Set<string>();
  for (const epic of initiative.epics ?? []) {
    if (epic.team) teams.add(epic.team);
  }
  if (teams.size === 1) return [...teams][0]!;
  return null;
}

type BacklogPlanningPanelProps = {
  initiatives: InitiativeItem[];
  roadmaps?: RoadmapItem[];
  storyRefById: Record<string, string>;
  onOpenInitiative: (initiativeId: string) => void;
  onOpenEpic: (epicId: string) => void;
  onOpenStory: (storyId: string) => void;
  onCreateInitiativeQuick: (title: string) => Promise<string | void>;
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
      labels: string | null;
    }>,
  ) => Promise<void>;
  onPatchInitiativeQuick: (
    initiativeId: string,
    patch: {
      assignee?: string | null;
      title?: string;
      startMonth?: number | null;
      endMonth?: number | null;
      team?: string | null;
      labels?: string | null;
    },
  ) => Promise<void>;
  onPatchEpicQuick: (
    epicId: string,
    patch: {
      assignee?: string | null;
      title?: string;
      planStartMonth?: number | null;
      planStartDay?: number | null;
      planEndMonth?: number | null;
      planEndDay?: number | null;
      team?: string | null;
      labels?: string | null;
    },
  ) => Promise<void>;
  summaryBarPortalElement?: HTMLElement | null;
  suppressInlineChips?: boolean;
};

type OptionItem = { id: string; label: string };
type CreateKind = "initiative" | "epic" | "story";
type CreateScope = "initiative" | "epic" | "story";
type BacklogColumnKey =
  | "workItem"
  | "team"
  | "year"
  | "quarter"
  | "month"
  | "startDate"
  | "endDate"
  | "status"
  | "sprint"
  | "assignee"
  | "labels"
  | "estDays"
  | "epicOriginalEst"
  | "daysLeft"
  | "progress";
type GroupLevel = "roadmap" | "year" | "quarter" | "month" | "sprint";
type WorkflowStatus = "todo" | "inProgress" | "done" | "approved";
type InlineEditableStoryField = "status" | "sprint" | "assignee" | "labels" | "estimatedDays" | "daysLeft";
type WorkItemKindFilter = "initiative" | "epic" | "story";

type BacklogSortBy = "titleAsc" | "titleDesc" | "assigneeAsc" | "estDesc" | "leftDesc" | "status";

/** Filters, group-by, and work-item scope only (no table layout or sort). */
type BacklogFilterSnapshot = {
  query: string;
  statusFilter: string[];
  sprintFilter: string[];
  yearFilter: string[];
  quarterFilter: string[];
  teamFilter: string[];
  assigneeFilter: string[];
  labelFilter: string[];
  roadmapFilter: string[];
  workItemFilter: WorkItemKindFilter[];
  groupLevels: GroupLevel[];
};

/** Table sort, column order, visibility, header row, and column widths. */
type BacklogViewSnapshot = {
  sortBy: BacklogSortBy;
  columnOrder: BacklogColumnKey[];
  columnVisibility: Record<BacklogColumnKey, boolean>;
  showTableHeaderRow: boolean;
  columnWidths: Record<BacklogColumnKey, number>;
};

type SavedBacklogFilterPreset = {
  id: string;
  name: string;
  snapshot: BacklogFilterSnapshot;
  updatedAt: number;
};

type SavedBacklogViewPreset = {
  id: string;
  name: string;
  snapshot: BacklogViewSnapshot;
  updatedAt: number;
};

function parseStoryLabels(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatStoryLabelsForEditInput(raw: string | null | undefined): string {
  return parseStoryLabels(raw).join(", ");
}

/** Read-only labels cell: chips inside a light panel; click to edit. */
function BacklogLabelsChipPanel({
  labelsSerialized,
  onMouseDownBeginEdit,
}: {
  labelsSerialized: string | null | undefined;
  onMouseDownBeginEdit: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const tokens = parseStoryLabels(labelsSerialized);
  const title = formatStoryLabelsForEditInput(labelsSerialized) || undefined;
  const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80 focus-visible:ring-offset-1";
  if (tokens.length === 0) {
    return (
      <button
        type="button"
        title={title}
        onMouseDown={onMouseDownBeginEdit}
        className={cn(
          "w-full min-w-0 bg-transparent px-2 py-1.5 text-[13px] text-transparent transition",
          "hover:rounded-lg hover:border hover:border-dashed hover:border-slate-300 hover:bg-slate-100/80 hover:text-slate-400",
          focusRing,
        )}
      >
        --
      </button>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onMouseDown={onMouseDownBeginEdit}
      className={cn(
        "flex w-full min-w-0 items-center overflow-hidden rounded-lg px-2 py-1.5 text-left transition",
        "hover:bg-indigo-50/60",
        focusRing,
      )}
    >
      <span className="flex min-w-0 flex-1 flex-nowrap items-center justify-start gap-1 overflow-hidden whitespace-nowrap">
        {tokens.map((lab, i) => (
          <span
            key={`${lab}-${i}`}
            className={cn(
              "inline-flex max-w-[min(100%,10rem)] shrink-0 items-center rounded-md border px-2 py-0.5 text-[10.5px] font-semibold leading-tight",
              labelChipClasses(lab),
            )}
          >
            <span className="truncate">{lab}</span>
          </span>
        ))}
      </span>
    </button>
  );
}

function BacklogLabelsEmptyRowSlot() {
  return <span className="inline-block w-full min-w-0" aria-hidden />;
}

function BacklogTreeConnector({ indentPx }: { indentPx: number }) {
  if (indentPx <= 0) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: Math.max(2, indentPx - 18),
        top: 0,
        bottom: "50%",
        width: 14,
        borderLeft: "1.5px solid #e2e8f0",
        borderBottom: "1.5px solid #e2e8f0",
        borderBottomLeftRadius: 3,
      }}
    />
  );
}

const BACKLOG_READONLY_AUTO_SUM_DAYS = {
  title: "Totals are automatic",
  body: "Estimated days and days left on initiative and epic rows are the sum of their child user stories. They cannot be edited here -- change the values on the user stories instead.",
} as const;

const BACKLOG_READONLY_INITIATIVE_DATES = {
  title: "Initiative dates are set by epics",
  body: "Start and end dates come from child epics: the earliest epic start and the latest epic end. Initiative timelines are defined by those epics -- edit epic and story plans to change these dates.",
} as const;

const BACKLOG_READONLY_PROGRESS = {
  title: "Progress is read-only",
  body: "Progress is calculated from story status and completion. It cannot be edited directly in the table.",
} as const;

const backlogReadonlyAutoSumButtonClass =
  "w-full min-w-0 rounded-md px-1 py-0.5 text-center text-[16px] font-medium text-slate-600 transition hover:bg-slate-100/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80";

const backlogReadonlyInitiativeDateButtonClass =
  "w-full min-w-0 rounded-md px-1 py-0.5 text-center text-[14px] tabular-nums text-slate-700 transition hover:bg-slate-100/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80";

const backlogReadonlyProgressButtonClass =
  "w-full min-w-0 space-y-0.5 rounded-md px-0.5 py-0.5 text-left transition hover:bg-slate-100/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80";

type StoryCellEditSnapshot = {
  status: string;
  sprint: number | null;
  assignee: string | null;
  estimatedDays: number | null;
  daysLeft: number | null;
  labels: string | null;
};

function storyEditSnapshotFromFlat(
  story: Pick<UserStoryItem, "status" | "sprint" | "assignee" | "estimatedDays" | "daysLeft" | "labels">,
): StoryCellEditSnapshot {
  return {
    status: story.status,
    sprint: story.sprint,
    assignee: story.assignee?.trim() || null,
    estimatedDays: story.estimatedDays,
    daysLeft: story.daysLeft,
    labels: story.labels,
  };
}

type BacklogGroupedStoryRowForSnapshot = {
  storyStatus: string;
  storySprintNum: number | null;
  storyAssignee: string;
  storyEstimatedDays: number;
  storyDaysLeft: number;
  storyLabels: string | null;
};

function storyEditSnapshotFromGroupedRow(row: BacklogGroupedStoryRowForSnapshot): StoryCellEditSnapshot {
  return {
    status: row.storyStatus,
    sprint: row.storySprintNum,
    assignee: row.storyAssignee === "Unassigned" ? null : row.storyAssignee,
    estimatedDays: row.storyEstimatedDays,
    daysLeft: row.storyDaysLeft,
    labels: row.storyLabels,
  };
}

const BACKLOG_COLUMN_ORDER: BacklogColumnKey[] = [
  "workItem",
  "status",
  "team",
  "assignee",
  "epicOriginalEst",
  "estDays",
  "daysLeft",
  "sprint",
  "progress",
  "startDate",
  "endDate",
  "year",
  "quarter",
  "month",
  "labels",
];

const BACKLOG_COLUMN_LABELS: Record<BacklogColumnKey, string> = {
  workItem: "Work item",
  team: "Team",
  year: "Year",
  quarter: "Quarter",
  month: "Month",
  startDate: "Start",
  endDate: "End",
  status: "Status",
  sprint: "Sprint",
  assignee: "Assignee",
  labels: "Labels",
  estDays: "Est Days",
  epicOriginalEst: "Epic Est",
  daysLeft: "Est. Days Left",
  progress: "Progress",
};

const BACKLOG_COLUMN_MIN_WIDTHS: Record<BacklogColumnKey, number> = {
  workItem: 300,
  team: 120,
  year: 88,
  quarter: 104,
  month: 80,
  startDate: 96,
  endDate: 96,
  status: 100,
  sprint: 90,
  assignee: 120,
  labels: 140,
  estDays: 90,
  epicOriginalEst: 110,
  daysLeft: 150,
  progress: 180,
};

const BACKLOG_COLUMN_DEFAULT_WIDTHS: Record<BacklogColumnKey, number> = {
  workItem: 420,
  team: 150,
  year: 104,
  quarter: 112,
  month: 120,
  startDate: 118,
  endDate: 118,
  status: 168,
  sprint: 148,
  assignee: 190,
  labels: 200,
  estDays: 128,
  epicOriginalEst: 150,
  daysLeft: 160,
  progress: 220,
};

const BACKLOG_COLUMN_WIDTHS_STORAGE_KEY = "epic-planner.backlog.column-widths.v1";
const BACKLOG_VIEW_STATE_STORAGE_KEY = "epic-planner.backlog.view-state.v1";
const BACKLOG_TABLE_LAYOUT_STORAGE_KEY = "epic-planner.backlog.table-layout.v1";
/** Bump when default visibility for columns changes so stored layout can migrate once. */
const BACKLOG_TABLE_LAYOUT_DEFAULTS_VERSION = 10;
const BACKLOG_SAVED_FILTERS_STORAGE_KEY = "epic-planner.backlog.saved-filters.v1";
const BACKLOG_SAVED_VIEWS_STORAGE_KEY = "epic-planner.backlog.saved-views.v1";

const DEFAULT_BACKLOG_COLUMN_VISIBILITY: Record<BacklogColumnKey, boolean> = {
  workItem: true,
  team: true,
  /** Calendar facets duplicate Group by / filters for most views; enable from Table → columns when needed. */
  year: false,
  quarter: false,
  month: false,
  startDate: true,
  endDate: true,
  status: true,
  sprint: true,
  assignee: true,
  labels: true,
  /** Core planning columns -- on by default. */
  estDays: true,
  epicOriginalEst: true,
  daysLeft: true,
  progress: true,
};

const CENTER_ALIGNED_BACKLOG_COLUMNS = new Set<BacklogColumnKey>([
  "team",
  "year",
  "quarter",
  "month",
  "startDate",
  "endDate",
  "status",
  "sprint",
  "assignee",
  "labels",
  "estDays",
  "epicOriginalEst",
  "daysLeft",
  "progress",
]);

function backlogCellClassName(key: BacklogColumnKey): string {
  if (key === "workItem") return "group/workitem relative min-w-0 pl-4";
  if (key === "progress") return "min-w-0";
  /** `justify-self-center` would size the item to max-content and let long text spill out of the column. */
  if (key === "labels") return "flex min-w-0 w-full max-w-full justify-center overflow-hidden text-center";
  return cn("min-w-0", CENTER_ALIGNED_BACKLOG_COLUMNS.has(key) && "justify-self-center text-center");
}

function isBacklogColumnKey(value: unknown): value is BacklogColumnKey {
  return typeof value === "string" && (BACKLOG_COLUMN_ORDER as string[]).includes(value);
}

/** Ensures a full permutation; `workItem` stays first; appends any missing keys. */
function normalizeColumnOrder(input: unknown): BacklogColumnKey[] {
  if (!Array.isArray(input)) return [...BACKLOG_COLUMN_ORDER];
  const seen = new Set<BacklogColumnKey>();
  const out: BacklogColumnKey[] = [];
  for (const item of input) {
    if (!isBacklogColumnKey(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  for (const key of BACKLOG_COLUMN_ORDER) {
    if (!seen.has(key)) out.push(key);
  }
  const wi = out.indexOf("workItem");
  if (wi > 0) {
    out.splice(wi, 1);
    out.unshift("workItem");
  }
  return out;
}

type SortableBacklogColumnHeaderProps = {
  id: BacklogColumnKey;
  className?: string;
  centered: boolean;
  label: ReactNode;
  resizeHandle: ReactNode;
};

function SortableBacklogColumnHeader({ id, className, centered, label, resizeHandle }: SortableBacklogColumnHeaderProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 3 : undefined,
  };
  const grip = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      className="inline-flex h-5 w-5 shrink-0 touch-none cursor-grab items-center justify-center rounded outline-none opacity-0 transition-opacity group-hover/col:opacity-100 hover:bg-white/20 active:cursor-grabbing"
      aria-label={`Drag to reorder ${BACKLOG_COLUMN_LABELS[id]} column`}
      {...attributes}
      {...listeners}
    >
      <TableColumnDragGrip />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style} className={cn(className, "group/col w-full min-w-0 transition-colors hover:text-amber-200")}>
      {/* pr-2.5 reserves the resize strip; overflow-hidden keeps label from painting past the column edge */}
      {centered ? (
        <span className="flex min-h-[1.25rem] w-full min-w-0 justify-center overflow-hidden pr-2.5">
          <span className="flex min-w-0 max-w-full items-center justify-center gap-1">
            {grip}
            <span className="min-w-0 overflow-hidden">{label}</span>
          </span>
        </span>
      ) : (
        <span className="flex min-h-[1.25rem] w-full min-w-0 items-center gap-1 overflow-hidden pr-2.5">
          {grip}
          <span className="min-w-0 flex-1 overflow-hidden">{label}</span>
        </span>
      )}
      {resizeHandle}
    </div>
  );
}
const GROUP_LEVEL_ORDER: GroupLevel[] = ["roadmap", "year", "quarter", "month", "sprint"];
const GROUP_LEVEL_LABELS: Record<GroupLevel, string> = {
  roadmap: "Roadmap",
  year: "Year",
  quarter: "Quarter",
  month: "Month",
  sprint: "Sprint",
};

function statusChip(status: string) {
  if (status === "approved") return "border border-violet-200/70 bg-violet-50 text-violet-700";
  if (status === "done") return "border border-emerald-200/70 bg-emerald-50 text-emerald-700";
  if (status === "inProgress") return "border border-blue-200/70 bg-blue-50 text-blue-700";
  return "border border-amber-200/70 bg-amber-50 text-amber-700";
}

function statusDot(status: string) {
  if (status === "approved") return "bg-violet-500";
  if (status === "done") return "bg-emerald-500";
  if (status === "inProgress") return "bg-blue-500";
  return "bg-amber-400";
}

/**
 * Lucide icon for a workflow status. Matches the conventions used in
 * `components/initiatives/initiative-list-panel.tsx` so the backlog status
 * chips read the same across surfaces (To do/In progress/Done/Approved).
 */
function statusIcon(status: string, className = "size-3.5"): ReactNode {
  if (status === "approved") return <CheckCircle2 className={cn(className, "text-violet-600")} />;
  if (status === "done") return <CheckCheck className={cn(className, "text-emerald-600")} />;
  if (status === "inProgress") return <PlayCircle className={cn(className, "text-blue-600")} />;
  return <ListTodo className={cn(className, "text-amber-600")} />;
}

/**
 * Lightweight popover used by inline cell editors that need icons next to
 * each option (status, team). Native <select>/<option> can't show icons
 * reliably across browsers, so we render a small card menu instead. The
 * shell matches the project's existing rounded-xl + slate-200 + shadow-lg
 * dropdown convention (see initiative-form-dialog suggestion panels).
 *
 * Behavior:
 *   • Esc → onCancel
 *   • Click outside → onCancel
 *   • Click option → onSelect(value) (parent decides whether to also close)
 */
function CellOptionPopover<T extends string>({
  value,
  options,
  onSelect,
  onCancel,
  widthClass = "w-[220px]",
}: {
  value: T | "";
  options: Array<{ value: T | ""; label: string; subtitle?: string; icon?: ReactNode }>;
  onSelect: (v: T | "") => void;
  onCancel: () => void;
  widthClass?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDocMouseDown(event: globalThis.MouseEvent) {
      if (!rootRef.current) return;
      if (event.target instanceof Node && rootRef.current.contains(event.target)) return;
      onCancel();
    }
    function onDocKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onDocKeyDown);
    return () => {
      window.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onDocKeyDown);
    };
  }, [onCancel]);
  return (
    <div
      ref={rootRef}
      role="listbox"
      className={cn(
        "absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 rounded-xl border border-slate-200/80 bg-white p-1 shadow-lg ring-1 ring-black/[0.04]",
        widthClass,
      )}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value || "__none__"}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onSelect(opt.value)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[14px] outline-none transition-colors",
              selected ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50",
            )}
          >
            {opt.icon ? <span className="flex size-4 shrink-0 items-center justify-center">{opt.icon}</span> : null}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium leading-tight">{opt.label}</span>
              {opt.subtitle ? (
                <span className="truncate text-[11.5px] leading-tight text-slate-500">{opt.subtitle}</span>
              ) : null}
            </span>
            {selected ? <Check className="size-3.5 shrink-0 text-indigo-600" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

const LABEL_CHIP_PALETTES = [
  "border-indigo-200/70 bg-indigo-50 text-indigo-700",
  "border-violet-200/70 bg-violet-50 text-violet-700",
  "border-sky-200/70 bg-sky-50 text-sky-700",
  "border-emerald-200/70 bg-emerald-50 text-emerald-700",
  "border-amber-200/70 bg-amber-50 text-amber-700",
  "border-rose-200/70 bg-rose-50 text-rose-700",
  "border-teal-200/70 bg-teal-50 text-teal-700",
  "border-orange-200/70 bg-orange-50 text-orange-700",
] as const;

function labelChipClasses(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) & 0xffff;
  return LABEL_CHIP_PALETTES[hash % LABEL_CHIP_PALETTES.length]!;
}

function sprintLabel(sprint: number | null) {
  return sprint == null ? "Unscheduled" : `Sprint ${sprint}`;
}

/** Option list for the inline status popover (story status edit). */
const STORY_STATUS_POPOVER_OPTIONS: Array<{
  value: "todo" | "inProgress" | "done" | "approved";
  label: string;
  icon: ReactNode;
}> = [
  { value: "todo", label: "To do", icon: <ListTodo className="size-3.5 text-amber-600" /> },
  { value: "inProgress", label: "In progress", icon: <PlayCircle className="size-3.5 text-blue-600" /> },
  { value: "done", label: "Done", icon: <CheckCheck className="size-3.5 text-emerald-600" /> },
  { value: "approved", label: "Approved", icon: <CheckCircle2 className="size-3.5 text-violet-600" /> },
];

function quarterFromMonth(month: number | null | undefined): string {
  if (month == null) return "-";
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

function quarterLabelOrUnscheduled(value: string | null | undefined): string {
  return !value || value === "-" ? "Unscheduled" : value;
}

function quarterSortValue(value: string | null | undefined): string {
  const normalized = quarterLabelOrUnscheduled(value);
  const order = ["Q1", "Q2", "Q3", "Q4"].indexOf(normalized);
  return String(order === -1 ? 99 : order).padStart(2, "0");
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

function isWorkItemKindFilterValue(v: unknown): v is WorkItemKindFilter {
  return v === "initiative" || v === "epic" || v === "story";
}

function isGroupLevelValue(v: unknown): v is GroupLevel {
  return v === "roadmap" || v === "year" || v === "quarter" || v === "month" || v === "sprint";
}

function isBacklogSortByValue(v: unknown): v is BacklogSortBy {
  return (
    v === "titleAsc" ||
    v === "titleDesc" ||
    v === "assigneeAsc" ||
    v === "estDesc" ||
    v === "leftDesc" ||
    v === "status"
  );
}

function backlogViewSnapshotFromUnknown(raw: unknown): BacklogViewSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const sortBy = isBacklogSortByValue(s.sortBy) ? s.sortBy : "titleAsc";
  if (!Array.isArray(s.columnOrder) || s.columnOrder.length === 0) return null;
  const columnOrder = normalizeColumnOrder(s.columnOrder);
  const vis = s.columnVisibility;
  if (!vis || typeof vis !== "object") return null;
  const columnVisibility = { ...DEFAULT_BACKLOG_COLUMN_VISIBILITY };
  for (const key of BACKLOG_COLUMN_ORDER) {
    const v = (vis as Record<string, unknown>)[key];
    if (typeof v === "boolean") columnVisibility[key] = v;
  }
  columnVisibility.workItem = true;
  const showTableHeaderRow = typeof s.showTableHeaderRow === "boolean" ? s.showTableHeaderRow : true;
  const widthsRaw = s.columnWidths;
  const columnWidths = { ...BACKLOG_COLUMN_DEFAULT_WIDTHS };
  if (widthsRaw && typeof widthsRaw === "object") {
    for (const key of BACKLOG_COLUMN_ORDER) {
      const w = (widthsRaw as Record<string, unknown>)[key];
      if (typeof w === "number" && Number.isFinite(w)) {
        columnWidths[key] = Math.max(BACKLOG_COLUMN_MIN_WIDTHS[key], Math.round(w));
      }
    }
  }
  return { sortBy, columnOrder, columnVisibility, showTableHeaderRow, columnWidths };
}

function backlogFilterSnapshotFromUnknown(raw: unknown): BacklogFilterSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const teamRaw = Array.isArray(s.teamFilter) ? s.teamFilter.filter((x): x is string => typeof x === "string") : [];
  const teamFilter = teamRaw.filter((v) => MONTH_TEAM_COLUMNS.some((c) => c.id === v));
  const workItemFilter = Array.isArray(s.workItemFilter) ? s.workItemFilter.filter(isWorkItemKindFilterValue) : [];
  const groupLevels = Array.isArray(s.groupLevels) ? s.groupLevels.filter(isGroupLevelValue) : [];
  return {
    query: typeof s.query === "string" ? s.query : "",
    statusFilter: Array.isArray(s.statusFilter) ? s.statusFilter.filter((x): x is string => typeof x === "string") : [],
    sprintFilter: Array.isArray(s.sprintFilter) ? s.sprintFilter.filter((x): x is string => typeof x === "string") : [],
    yearFilter: Array.isArray(s.yearFilter) ? s.yearFilter.filter((x): x is string => typeof x === "string") : [],
    quarterFilter: Array.isArray(s.quarterFilter) ? s.quarterFilter.filter((x): x is string => typeof x === "string") : [],
    teamFilter,
    assigneeFilter: Array.isArray(s.assigneeFilter) ? s.assigneeFilter.filter((x): x is string => typeof x === "string") : [],
    labelFilter: Array.isArray(s.labelFilter) ? s.labelFilter.filter((x): x is string => typeof x === "string") : [],
    roadmapFilter: Array.isArray(s.roadmapFilter) ? s.roadmapFilter.filter((x): x is string => typeof x === "string") : [],
    workItemFilter,
    groupLevels,
  };
}

function parseSavedBacklogFilterPresetsJson(raw: unknown): SavedBacklogFilterPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedBacklogFilterPreset[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string" || typeof r.updatedAt !== "number") continue;
    const snapshot = backlogFilterSnapshotFromUnknown(r.snapshot);
    if (!snapshot) continue;
    const name = r.name.trim();
    if (!name) continue;
    out.push({ id: r.id, name, snapshot, updatedAt: r.updatedAt });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function newSavedFilterPresetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `bf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseSavedBacklogViewPresetsJson(raw: unknown): SavedBacklogViewPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedBacklogViewPreset[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string" || typeof r.updatedAt !== "number") continue;
    const snapshot = backlogViewSnapshotFromUnknown(r.snapshot);
    if (!snapshot) continue;
    const name = r.name.trim();
    if (!name) continue;
    out.push({ id: r.id, name, snapshot, updatedAt: r.updatedAt });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function newSavedViewPresetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `bw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const BACKLOG_SORT_LABELS: Record<BacklogSortBy, string> = {
  titleAsc: "Title (A–Z)",
  titleDesc: "Title (Z–A)",
  assigneeAsc: "Assignee (A–Z)",
  estDesc: "Estimate (high to low)",
  leftDesc: "Days left (high to low)",
  status: "Status",
};

const WORK_ITEM_KIND_SUMMARY_LABELS: Record<WorkItemKindFilter, string> = {
  initiative: "Initiative",
  epic: "Epic",
  story: "User story",
};

const STATUS_FILTER_SUMMARY_LABELS: Record<string, string> = {
  todo: "To do",
  inProgress: "In progress",
  done: "Done",
  approved: "Approved",
};

function teamIdToSummaryLabel(teamId: string): string {
  return MONTH_TEAM_COLUMNS.find((c) => c.id === teamId)?.label ?? teamId;
}

function sprintFilterIdToSummaryLabel(id: string): string {
  if (id === "unscheduled") return "Unscheduled";
  const n = Number(id);
  if (!Number.isNaN(n) && String(n) === id) return `Sprint ${n}`;
  return id;
}

/** Human-readable lines describing what a saved filter preset will store. */
function backlogFilterSnapshotSummaryLines(snapshot: BacklogFilterSnapshot): string[] {
  const lines: string[] = [];
  const q = snapshot.query.trim();
  if (q) lines.push(`Search: "${q}"`);

  if (snapshot.groupLevels.length === 0) {
    lines.push("Group by: None");
  } else {
    lines.push(`Group by: ${snapshot.groupLevels.map((level) => GROUP_LEVEL_LABELS[level]).join(" / ")}`);
  }

  if (snapshot.workItemFilter.length > 0) {
    lines.push(`Work item types: ${snapshot.workItemFilter.map((k) => WORK_ITEM_KIND_SUMMARY_LABELS[k]).join(", ")}`);
  }
  if (snapshot.yearFilter.length > 0) {
    lines.push(`Year: ${snapshot.yearFilter.join(", ")}`);
  }
  if (snapshot.quarterFilter.length > 0) {
    lines.push(`Quarter: ${snapshot.quarterFilter.join(", ")}`);
  }
  if (snapshot.statusFilter.length > 0) {
    lines.push(`Status: ${snapshot.statusFilter.map((id) => STATUS_FILTER_SUMMARY_LABELS[id] ?? id).join(", ")}`);
  }
  if (snapshot.sprintFilter.length > 0) {
    lines.push(`Sprint: ${snapshot.sprintFilter.map(sprintFilterIdToSummaryLabel).join(", ")}`);
  }
  if (snapshot.teamFilter.length > 0) {
    lines.push(`Team: ${snapshot.teamFilter.map(teamIdToSummaryLabel).join(", ")}`);
  }
  if (snapshot.assigneeFilter.length > 0) {
    lines.push(`Assignee: ${snapshot.assigneeFilter.join(", ")}`);
  }
  if (snapshot.labelFilter.length > 0) {
    lines.push(`Labels: ${snapshot.labelFilter.join(", ")}`);
  }

  return lines;
}

/** Human-readable lines for a saved table view preset. */
function backlogViewSnapshotSummaryLines(snapshot: BacklogViewSnapshot): string[] {
  const lines: string[] = [];
  lines.push(`Sort: ${BACKLOG_SORT_LABELS[snapshot.sortBy]}`);
  lines.push(`Table header row: ${snapshot.showTableHeaderRow ? "shown" : "hidden"}`);
  const visible = snapshot.columnOrder.filter((k) => snapshot.columnVisibility[k]);
  lines.push(`Visible columns (${visible.length}): ${visible.map((k) => BACKLOG_COLUMN_LABELS[k]).join(", ")}`);
  lines.push(`Column order: ${snapshot.columnOrder.map((k) => BACKLOG_COLUMN_LABELS[k]).join(" → ")}`);
  lines.push("Column widths: saved for each visible column");
  return lines;
}

function applyWorkItemKindFilter(rows: InitiativeItem[], workItemFilter: WorkItemKindFilter[]): InitiativeItem[] {
  const selectedKinds = new Set(workItemFilter);
  if (selectedKinds.size === 0) {
    return rows;
  }
  const allowInitiative = selectedKinds.has("initiative");
  const allowEpic = selectedKinds.has("epic");
  const allowStory = selectedKinds.has("story");
  return rows
    .map((initiative) => {
      const epics = (initiative.epics ?? [])
        .map((epic) => {
          const stories = (epic.userStories ?? []).filter(() => allowStory);
          if (allowEpic || allowInitiative) return { ...epic, userStories: allowStory ? epic.userStories ?? [] : [] };
          if (stories.length > 0) return { ...epic, userStories: stories };
          return null;
        })
        .filter(Boolean) as NonNullable<InitiativeItem["epics"]>;
      if (!allowInitiative && epics.length === 0) return null;
      return { ...initiative, epics };
    })
    .filter(Boolean) as InitiativeItem[];
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
  if (status === "todo") return "To Do";
  if (status === "done") return "Done";
  if (status === "approved") return "Approved";
  return status;
}

/** Union of demo delivery rosters for the given team column ids (e.g. platform, experience, data). */
function rosterNamesForDeliveryTeams(teamIds: string[]): Set<string> {
  const set = new Set<string>();
  for (const id of teamIds) {
    for (const n of defaultMembersForTeam(id)) set.add(n);
  }
  return set;
}

const BACKLOG_TEAM_FILTER_LABELS = [...MONTH_TEAM_COLUMNS.map((c) => c.label)].sort((a, b) =>
  a.localeCompare(b, undefined, { sensitivity: "base" }),
);

function backlogTeamLabelFromId(id: string): string {
  return MONTH_TEAM_COLUMNS.find((c) => c.id === id)?.label ?? id;
}

function BacklogTeamFilterControl({
  selectedIds,
  onChange,
  buttonClassName,
}: {
  selectedIds: string[];
  onChange: (next: string[]) => void;
  buttonClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teamAutocompleteLabels = useMemo(
    () =>
      BACKLOG_TEAM_FILTER_LABELS.filter((label) => {
        const col = MONTH_TEAM_COLUMNS.find((c) => c.label === label);
        return col != null && !selectedIds.includes(col.id);
      }),
    [selectedIds],
  );
  const allSelected = selectedIds.length === 0;
  const selectedLabel =
    allSelected
      ? "All"
      : selectedIds.length === 1
        ? backlogTeamLabelFromId(selectedIds[0]!)
        : `${selectedIds.length} selected`;

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

  function pickTeam(labelPicked: string) {
    const t = labelPicked.trim();
    if (!t) return;
    const col = MONTH_TEAM_COLUMNS.find(
      (c) => c.label === t || c.label.toLowerCase() === t.toLowerCase(),
    );
    if (!col) return;
    if (!allSelected && selectedIds.includes(col.id)) {
      setDraft("");
      return;
    }
    if (allSelected) onChange([col.id]);
    else onChange([...selectedIds, col.id]);
    setDraft("");
  }

  return (
    <div className="group relative min-w-0 w-full" onMouseEnter={cancelScheduledClose} onMouseLeave={scheduleClose}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          "flex h-[34px] min-w-[8rem] cursor-pointer items-center justify-between rounded-lg border border-slate-300 bg-white px-2.5 text-[14px] text-slate-900 outline-none transition hover:border-slate-400 hover:bg-slate-50",
          buttonClassName,
        )}
      >
        <span className="shrink-0 font-medium text-slate-500">Team: </span>
        <span className="ml-1 min-w-0 truncate font-normal text-slate-600">{selectedLabel}</span>
      </button>
      {isOpen ? (
        <div className="absolute z-30 mt-1 w-64 rounded-lg bg-gradient-to-b from-indigo-50 to-violet-50 p-2 shadow-lg shadow-indigo-900/5 backdrop-blur-sm">
          <label className="mb-2 flex items-center gap-2 text-[14px] text-slate-700">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => {
                onChange([]);
                setDraft("");
              }}
              className="h-3.5 w-3.5 rounded border-indigo-200 accent-indigo-600"
            />
            All teams
          </label>
          <AssigneeCombobox
            value={draft}
            onChange={setDraft}
            suggestions={teamAutocompleteLabels}
            placeholder="Type to search teams…"
            className="h-9 w-full rounded-md border border-indigo-200/90 bg-white px-2 text-[14px] text-slate-800 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200/80"
            aria-label="Add team to filter"
            onSuggestionPick={pickTeam}
          />
          {!allSelected && selectedIds.length > 0 ? (
            <ul className="mt-2 max-h-36 space-y-1 overflow-auto pr-0.5">
              {selectedIds.map((id) => {
                const label = backlogTeamLabelFromId(id);
                return (
                  <li
                    key={id}
                    className="flex items-center justify-between gap-2 rounded-md bg-white/85 px-2 py-1 text-[13px] text-slate-800 ring-1 ring-indigo-200/60"
                  >
                    <span className="min-w-0 truncate font-medium">{label}</span>
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                      aria-label={`Remove ${label} from filter`}
                      onClick={() => onChange(selectedIds.filter((x) => x !== id))}
                    >
                      <X className="size-3.5" strokeWidth={2} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BacklogAssigneeFilterControl({
  selected,
  onChange,
  suggestions,
  buttonClassName,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  suggestions: readonly string[];
  buttonClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allSelected = selected.length === 0;
  const selectedLabel =
    allSelected ? "All" : selected.length === 1 ? selected[0]! : `${selected.length} selected`;

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

  function pickAssignee(name: string) {
    const t = name.trim();
    if (!t) return;
    if (allSelected) onChange([t]);
    else if (!selected.includes(t)) onChange([...selected, t]);
    setDraft("");
  }

  return (
    <div className="group relative min-w-0 w-full" onMouseEnter={cancelScheduledClose} onMouseLeave={scheduleClose}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          "flex h-[34px] min-w-[8rem] cursor-pointer items-center justify-between rounded-lg border border-slate-300 bg-white px-2.5 text-[14px] text-slate-900 outline-none transition hover:border-slate-400 hover:bg-slate-50",
          buttonClassName,
        )}
      >
        <span className="shrink-0 font-medium text-slate-500">Assignee: </span>
        <span className="ml-1 min-w-0 truncate font-normal text-slate-600">{selectedLabel}</span>
      </button>
      {isOpen ? (
        <div className="absolute z-30 mt-1 w-64 rounded-lg bg-gradient-to-b from-indigo-50 to-violet-50 p-2 shadow-lg shadow-indigo-900/5 backdrop-blur-sm">
          <label className="mb-2 flex items-center gap-2 text-[14px] text-slate-700">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => {
                onChange([]);
                setDraft("");
              }}
              className="h-3.5 w-3.5 rounded border-indigo-200 accent-indigo-600"
            />
            All
          </label>
          <AssigneeCombobox
            value={draft}
            onChange={setDraft}
            suggestions={suggestions}
            placeholder="Type to search…"
            className="h-9 w-full rounded-md border border-indigo-200/90 bg-white px-2 text-[14px] text-slate-800 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200/80"
            aria-label="Add assignee to filter"
            onSuggestionPick={pickAssignee}
          />
          {!allSelected && selected.length > 0 ? (
            <ul className="mt-2 max-h-36 space-y-1 overflow-auto pr-0.5">
              {selected.map((name) => (
                <li
                  key={name}
                  className="flex items-center justify-between gap-2 rounded-md bg-white/85 px-2 py-1 text-[13px] text-slate-800 ring-1 ring-indigo-200/60"
                >
                  <span className="min-w-0 truncate font-medium">{name}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                    aria-label={`Remove ${name} from filter`}
                    onClick={() => onChange(selected.filter((x) => x !== name))}
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BacklogLabelsFilterControl({
  selected,
  onChange,
  suggestions,
  buttonClassName,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  suggestions: readonly string[];
  buttonClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allSelected = selected.length === 0;
  const selectedLabel =
    allSelected ? "All" : selected.length === 1 ? selected[0]! : `${selected.length} selected`;

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

  function pickLabel(name: string) {
    const t = name.trim();
    if (!t) return;
    if (allSelected) onChange([t]);
    else if (!selected.includes(t)) onChange([...selected, t]);
    setDraft("");
  }

  return (
    <div className="group relative min-w-0 w-full" onMouseEnter={cancelScheduledClose} onMouseLeave={scheduleClose}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          "flex h-[34px] min-w-[8rem] cursor-pointer items-center justify-between rounded-lg border border-slate-300 bg-white px-2.5 text-[14px] text-slate-900 outline-none transition hover:border-slate-400 hover:bg-slate-50",
          buttonClassName,
        )}
      >
        <span className="shrink-0 font-medium text-slate-500">Labels: </span>
        <span className="ml-1 min-w-0 truncate font-normal text-slate-600">{selectedLabel}</span>
      </button>
      {isOpen ? (
        <div className="absolute z-30 mt-1 w-72 rounded-lg bg-gradient-to-b from-indigo-50 to-violet-50 p-2 shadow-lg shadow-indigo-900/5 backdrop-blur-sm">
          <label className="mb-2 flex items-center gap-2 text-[14px] text-slate-700">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => {
                onChange([]);
                setDraft("");
              }}
              className="h-3.5 w-3.5 rounded border-indigo-200 accent-indigo-600"
            />
            All labels
          </label>
          <AssigneeCombobox
            value={draft}
            onChange={setDraft}
            suggestions={suggestions}
            placeholder="Type to add a label…"
            className="h-9 w-full rounded-md border border-indigo-200/90 bg-white px-2 text-[14px] text-slate-800 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200/80"
            aria-label="Add label to filter"
            onSuggestionPick={pickLabel}
          />
          {!allSelected && selected.length > 0 ? (
            <ul className="mt-2 max-h-36 space-y-1 overflow-auto pr-0.5">
              {selected.map((name) => (
                <li
                  key={name}
                  className="flex items-center justify-between gap-2 rounded-md bg-white/85 px-2 py-1 text-[13px] text-slate-800 ring-1 ring-indigo-200/60"
                >
                  <span className="min-w-0 truncate font-medium">{name}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                    aria-label={`Remove ${name} from label filter`}
                    onClick={() => onChange(selected.filter((x) => x !== name))}
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MultiCheckboxFilter({
  label,
  options,
  selected,
  onChange,
  buttonClassName,
}: {
  label: string;
  options: OptionItem[];
  selected: string[];
  onChange: (next: string[]) => void;
  buttonClassName?: string;
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
    <div className="group relative min-w-0 w-full" onMouseEnter={cancelScheduledClose} onMouseLeave={scheduleClose}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          "flex h-[34px] min-w-[8rem] cursor-pointer items-center justify-between rounded-lg border border-slate-300 bg-white px-2.5 text-[14px] text-slate-900 outline-none transition hover:border-slate-400 hover:bg-slate-50",
          buttonClassName,
        )}
      >
        <span className="shrink-0 font-medium text-slate-500">{label}: </span>
        <span className="ml-1 min-w-0 truncate font-normal text-slate-600">{selectedLabel}</span>
      </button>
      {isOpen ? (
        <div className="absolute z-30 mt-1 w-56 rounded-lg bg-gradient-to-b from-indigo-50 to-violet-50 p-2 shadow-lg shadow-indigo-900/5 backdrop-blur-sm">
        <label className="mb-1 flex items-center gap-2 text-[14px] text-slate-700">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onChange([])}
            className="h-3.5 w-3.5 rounded border-indigo-200 accent-indigo-600"
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
                className="h-3.5 w-3.5 rounded border-indigo-200 accent-indigo-600"
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
  roadmaps,
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
  summaryBarPortalElement,
  suppressInlineChips,
}: BacklogPlanningPanelProps) {
  const [query, setQuery] = useState("");
  const [openInitiatives, setOpenInitiatives] = useState<Record<string, boolean>>({});
  const [openEpics, setOpenEpics] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [sprintFilter, setSprintFilter] = useState<string[]>([]);
  const [yearFilter, setYearFilter] = useState<string[]>([]);
  const [quarterFilter, setQuarterFilter] = useState<string[]>([]);
  /** Epic `team` lane ids (`platform` / `experience` / `data`). Empty = all teams. */
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [roadmapFilter, setRoadmapFilter] = useState<string[]>([]);
  const [workItemFilter, setWorkItemFilter] = useState<WorkItemKindFilter[]>([]);
  const [sortBy, setSortBy] = useState<BacklogSortBy>("titleAsc");
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
  const [groupLevels, setGroupLevels] = useState<GroupLevel[]>(["roadmap", "year"]);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [openGroupFolders, setOpenGroupFolders] = useState<Record<string, boolean>>({});
  const [defaultTreeExpanded, setDefaultTreeExpanded] = useState(true);
  // Default to *collapsed* so changing Group by doesn't recursively render the entire backlog.
  // Without this, picking "roadmap / year / quarter / month / sprint" eagerly expands every level
  // and renders every leaf — N×levels of work on a single click. Users still expand via the row chevron.
  const [defaultGroupExpanded, setDefaultGroupExpanded] = useState(false);
  const groupMenuRef = useRef<HTMLDivElement | null>(null);
  const savedFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const savedViewMenuRef = useRef<HTMLDivElement | null>(null);
  const columnsMenuRef = useRef<HTMLDivElement | null>(null);
  const columnsMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const backlogRowsRootRef = useRef<HTMLDivElement | null>(null);
  const createMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<BacklogColumnKey, number>>(BACKLOG_COLUMN_DEFAULT_WIDTHS);
  const [columnVisibility, setColumnVisibility] = useState<Record<BacklogColumnKey, boolean>>(DEFAULT_BACKLOG_COLUMN_VISIBILITY);
  const [columnOrder, setColumnOrder] = useState<BacklogColumnKey[]>(() => [...BACKLOG_COLUMN_ORDER]);
  const [showTableHeaderRow, setShowTableHeaderRow] = useState(true);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [columnsMenuFixedPosition, setColumnsMenuFixedPosition] = useState<{ top: number; left: number } | null>(null);
  const [hasLoadedTableLayout, setHasLoadedTableLayout] = useState(false);
  const resizeStateRef = useRef<{ key: BacklogColumnKey; startX: number; startWidth: number } | null>(null);
  const [hasLoadedViewState, setHasLoadedViewState] = useState(false);
  const [savedFilterPresets, setSavedFilterPresets] = useState<SavedBacklogFilterPreset[]>([]);
  const [savedFilterPresetsLoaded, setSavedFilterPresetsLoaded] = useState(false);
  const [presetSearch, setPresetSearch] = useState("");
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [saveAsFilterDialogOpen, setSaveAsFilterDialogOpen] = useState(false);
  const [saveAsFilterName, setSaveAsFilterName] = useState("");
  const saveAsFilterNameInputRef = useRef<HTMLInputElement | null>(null);
  const [savedViewPresets, setSavedViewPresets] = useState<SavedBacklogViewPreset[]>([]);
  const [savedViewPresetsLoaded, setSavedViewPresetsLoaded] = useState(false);
  const [viewPresetSearch, setViewPresetSearch] = useState("");
  const [viewPresetMenuOpen, setViewPresetMenuOpen] = useState(false);
  const [saveViewDialogOpen, setSaveViewDialogOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const saveViewNameInputRef = useRef<HTMLInputElement | null>(null);
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
  type ParentDateEditTarget = {
    kind: "epic" | "initiative";
    id: string;
    field: "start" | "end";
    value: string;
  };
  const [editingParentDate, setEditingParentDate] = useState<ParentDateEditTarget | null>(null);
  const [editingParentTeam, setEditingParentTeam] = useState<{
    kind: "epic" | "initiative";
    id: string;
    value: string;
  } | null>(null);
  const [editingParentLabels, setEditingParentLabels] = useState<{
    kind: "epic" | "initiative";
    id: string;
    value: string;
  } | null>(null);
  const [backlogReadonlyNotice, setBacklogReadonlyNotice] = useState<{ title: string; body: string } | null>(null);

  async function patchStoryInline(
    storyId: string,
    patch: Partial<{
      status: "todo" | "inProgress" | "done" | "approved";
      sprint: number | null;
      assignee: string | null;
      estimatedDays: number | null;
      daysLeft: number | null;
      labels: string | null;
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
    current: StoryCellEditSnapshot,
    nextValueOverride?: string,
  ) {
    if (!editingStoryCell || editingStoryCell.storyId !== storyId || editingStoryCell.field !== field) return;
    const nextRaw = (nextValueOverride ?? editingStoryCell.value).trim();
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
    } else if (field === "labels") {
      const nextLabs = parseStoryLabels(nextRaw.replace(/\r?\n/g, ","));
      const nextSerialized = nextLabs.length > 0 ? nextLabs.join(", ") : null;
      const curLabs = parseStoryLabels(current.labels);
      const curSerialized = curLabs.length > 0 ? curLabs.join(", ") : null;
      if (nextSerialized !== curSerialized) await patchStoryInline(storyId, { labels: nextSerialized });
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
    current: StoryCellEditSnapshot,
  ) {
    if (field === "labels") {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelStoryCellEdit();
        return;
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void confirmStoryCellEdit(storyId, field, current);
      }
      return;
    }
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

  // ───────────────────────────────────────────────────────────────────────────
  // Parent date inline edit (epic: month + day; initiative: month only).
  // ───────────────────────────────────────────────────────────────────────────
  function daysInMonth(year: number, month: number): number {
    // month is 1-12; using day=0 of next month yields last day of `month`.
    return new Date(year, month, 0).getDate();
  }
  function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
  }
  /** YYYY-MM-DD from epic plan month/day + initiative year. Falls back to month=1/day=1 when missing. */
  function epicDateInputValue(year: number, month: number | null | undefined, day: number | null | undefined): string {
    const m = month ?? 1;
    const dim = daysInMonth(year, m);
    const d = Math.min(Math.max(day ?? 1, 1), dim);
    return `${year}-${pad2(m)}-${pad2(d)}`;
  }
  /** YYYY-MM from initiative month + year. Falls back to month=1 when missing. */
  function initiativeMonthInputValue(year: number, month: number | null | undefined): string {
    return `${year}-${pad2(month ?? 1)}`;
  }
  function beginEpicDateEdit(
    epicId: string,
    field: "start" | "end",
    year: number,
    month: number | null | undefined,
    day: number | null | undefined,
  ) {
    setEditingParentDate({ kind: "epic", id: epicId, field, value: epicDateInputValue(year, month, day) });
  }
  function beginInitiativeDateEdit(
    initiativeId: string,
    field: "start" | "end",
    year: number,
    month: number | null | undefined,
  ) {
    setEditingParentDate({
      kind: "initiative",
      id: initiativeId,
      field,
      value: initiativeMonthInputValue(year, month),
    });
  }
  function reportParentDateValidationError(message: string) {
    try {
      toast.error(message);
    } catch {
      console.warn(message);
    }
  }
  async function commitEpicDateEdit() {
    if (!editingParentDate || editingParentDate.kind !== "epic") return;
    const raw = editingParentDate.value.trim();
    // <input type="date"> emits YYYY-MM-DD.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) {
      reportParentDateValidationError("Enter a valid date (YYYY-MM-DD)");
      return;
    }
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      reportParentDateValidationError("Month must be 1-12");
      return;
    }
    if (!Number.isFinite(day) || day < 1 || day > 31) {
      reportParentDateValidationError("Day must be 1-31");
      return;
    }
    const patch =
      editingParentDate.field === "start"
        ? { planStartMonth: month, planStartDay: day }
        : { planEndMonth: month, planEndDay: day };
    try {
      await onPatchEpicQuick(editingParentDate.id, patch);
      toast.success("Epic updated");
    } catch {
      reportParentDateValidationError("Failed to update epic");
      return;
    }
    setEditingParentDate(null);
  }
  async function commitInitiativeDateEdit() {
    if (!editingParentDate || editingParentDate.kind !== "initiative") return;
    const raw = editingParentDate.value.trim();
    // <input type="month"> emits YYYY-MM.
    const m = /^(\d{4})-(\d{2})$/.exec(raw);
    if (!m) {
      reportParentDateValidationError("Enter a valid month (YYYY-MM)");
      return;
    }
    const month = Number(m[2]);
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      reportParentDateValidationError("Month must be 1-12");
      return;
    }
    const patch = editingParentDate.field === "start" ? { startMonth: month } : { endMonth: month };
    try {
      await onPatchInitiativeQuick(editingParentDate.id, patch);
      toast.success("Initiative updated");
    } catch {
      reportParentDateValidationError("Failed to update initiative");
      return;
    }
    setEditingParentDate(null);
  }
  function isEditingParentDate(
    kind: "epic" | "initiative",
    id: string,
    field: "start" | "end",
  ): boolean {
    return (
      editingParentDate !== null &&
      editingParentDate.kind === kind &&
      editingParentDate.id === id &&
      editingParentDate.field === field
    );
  }
  /** Inline editor for epic (date) and initiative (month). Commits on Enter / blur; cancels on Escape. */
  function renderParentDateEditor(args: {
    kind: "epic" | "initiative";
    id: string;
    field: "start" | "end";
  }): ReactNode {
    const isEpic = args.kind === "epic";
    const commit = isEpic ? commitEpicDateEdit : commitInitiativeDateEdit;
    const value = editingParentDate?.value ?? "";
    return (
      <span
        className="inline-flex items-center gap-1"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          type={isEpic ? "date" : "month"}
          value={value}
          onChange={(event) =>
            setEditingParentDate((prev) => (prev ? { ...prev, value: event.target.value } : prev))
          }
          onBlur={() => {
            // Defer so click on Check/X buttons can fire first.
            window.setTimeout(() => {
              if (
                editingParentDate &&
                editingParentDate.kind === args.kind &&
                editingParentDate.id === args.id &&
                editingParentDate.field === args.field
              ) {
                void commit();
              }
            }, 120);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditingParentDate(null);
            } else if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
          }}
          autoFocus
          className="h-7 rounded-md bg-white px-2 text-[14px] tabular-nums ring-1 ring-slate-200 outline-none"
        />
        <button
          type="button"
          onClick={() => setEditingParentDate(null)}
          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
        >
          <X className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void commit()}
          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
        >
          <Check className="size-3.5" />
        </button>
      </span>
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Parent team & labels inline edits (epic and initiative rows).
  // Team is a <select> populated from MONTH_TEAM_COLUMNS plus "(none)".
  // Labels is a free-text input; Enter/blur commits, Escape cancels.
  // ───────────────────────────────────────────────────────────────────────────
  function beginEpicTeamEdit(epic: { id: string; team?: string | null }) {
    setEditingParentTeam({ kind: "epic", id: epic.id, value: epic.team ?? "" });
  }
  function beginInitiativeTeamEdit(initiative: { id: string; team?: string | null }) {
    setEditingParentTeam({ kind: "initiative", id: initiative.id, value: initiative.team ?? "" });
  }
  async function commitEpicTeamEdit(nextValue?: string) {
    if (!editingParentTeam || editingParentTeam.kind !== "epic") return;
    const raw = (nextValue ?? editingParentTeam.value).trim();
    const next = raw === "" ? null : raw;
    try {
      await onPatchEpicQuick(editingParentTeam.id, { team: next });
      toast.success("Epic team updated");
    } catch {
      toast.error("Failed to update epic team");
      return;
    }
    setEditingParentTeam(null);
  }
  async function commitInitiativeTeamEdit(nextValue?: string) {
    if (!editingParentTeam || editingParentTeam.kind !== "initiative") return;
    const raw = (nextValue ?? editingParentTeam.value).trim();
    const next = raw === "" ? null : raw;
    try {
      await onPatchInitiativeQuick(editingParentTeam.id, { team: next });
      toast.success("Initiative team updated");
    } catch {
      toast.error("Failed to update initiative team");
      return;
    }
    setEditingParentTeam(null);
  }
  function isEditingParentTeam(kind: "epic" | "initiative", id: string): boolean {
    return (
      editingParentTeam !== null &&
      editingParentTeam.kind === kind &&
      editingParentTeam.id === id
    );
  }
  function renderParentTeamEditor(args: { kind: "epic" | "initiative"; id: string }): ReactNode {
    const isEpic = args.kind === "epic";
    const value = editingParentTeam?.value ?? "";
    const currentColor = value ? TEAM_DOT_COLOR[value] ?? "bg-slate-300" : "bg-slate-300";
    const currentLabel = value
      ? monthTeamLabelForId(value) ?? teamLabelForWorkspaceUser(value) ?? value
      : "(none)";
    const popoverOptions: Array<{ value: string; label: string; subtitle?: string; icon: ReactNode }> = [
      {
        value: "",
        label: "(none)",
        icon: <span className="inline-block size-2 rounded-full bg-slate-300" aria-hidden />,
      },
      ...MONTH_TEAM_COLUMNS.map((team) => ({
        value: team.id,
        label: team.label,
        subtitle: team.subtitle,
        icon: (
          <span
            className={cn("inline-block size-2 rounded-full", TEAM_DOT_COLOR[team.id] ?? "bg-slate-400")}
            aria-hidden
          />
        ),
      })),
    ];
    return (
      <span
        className="relative inline-flex items-center gap-1"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-white px-2 text-[14px] text-slate-700 ring-1 ring-slate-200">
          <span className={cn("inline-block size-2 rounded-full", currentColor)} aria-hidden />
          <span className="truncate">{currentLabel}</span>
        </span>
        <button
          type="button"
          onClick={() => setEditingParentTeam(null)}
          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
        >
          <X className="size-3.5" />
        </button>
        <CellOptionPopover
          value={value}
          options={popoverOptions}
          onSelect={(v) => {
            setEditingParentTeam((prev) => (prev ? { ...prev, value: v } : prev));
            if (isEpic) void commitEpicTeamEdit(v);
            else void commitInitiativeTeamEdit(v);
          }}
          onCancel={() => setEditingParentTeam(null)}
        />
      </span>
    );
  }

  function beginEpicLabelsEdit(epic: { id: string; labels?: string | null }) {
    setEditingParentLabels({ kind: "epic", id: epic.id, value: epic.labels ?? "" });
  }
  function beginInitiativeLabelsEdit(initiative: { id: string; labels?: string | null }) {
    setEditingParentLabels({ kind: "initiative", id: initiative.id, value: initiative.labels ?? "" });
  }
  async function commitEpicLabelsEdit() {
    if (!editingParentLabels || editingParentLabels.kind !== "epic") return;
    const raw = editingParentLabels.value;
    const next = raw.trim() === "" ? null : raw.trim();
    try {
      await onPatchEpicQuick(editingParentLabels.id, { labels: next });
      toast.success("Epic labels updated");
    } catch {
      toast.error("Failed to update epic labels");
      return;
    }
    setEditingParentLabels(null);
  }
  async function commitInitiativeLabelsEdit() {
    if (!editingParentLabels || editingParentLabels.kind !== "initiative") return;
    const raw = editingParentLabels.value;
    const next = raw.trim() === "" ? null : raw.trim();
    try {
      await onPatchInitiativeQuick(editingParentLabels.id, { labels: next });
      toast.success("Initiative labels updated");
    } catch {
      toast.error("Failed to update initiative labels");
      return;
    }
    setEditingParentLabels(null);
  }
  function isEditingParentLabels(kind: "epic" | "initiative", id: string): boolean {
    return (
      editingParentLabels !== null &&
      editingParentLabels.kind === kind &&
      editingParentLabels.id === id
    );
  }
  function renderParentLabelsEditor(args: { kind: "epic" | "initiative"; id: string }): ReactNode {
    const isEpic = args.kind === "epic";
    const commit = isEpic ? commitEpicLabelsEdit : commitInitiativeLabelsEdit;
    const value = editingParentLabels?.value ?? "";
    return (
      <span
        className="inline-flex w-full items-center gap-1"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          type="text"
          value={value}
          onChange={(event) =>
            setEditingParentLabels((prev) => (prev ? { ...prev, value: event.target.value } : prev))
          }
          onBlur={() => {
            // Defer so click on Check/X buttons can fire first.
            window.setTimeout(() => {
              if (
                editingParentLabels &&
                editingParentLabels.kind === args.kind &&
                editingParentLabels.id === args.id
              ) {
                void commit();
              }
            }, 120);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditingParentLabels(null);
            } else if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
          }}
          autoFocus
          placeholder="Comma-separated labels"
          className="h-7 min-w-0 flex-1 rounded-md bg-white px-2 text-[14px] ring-1 ring-slate-200 outline-none"
        />
        <button
          type="button"
          onClick={() => setEditingParentLabels(null)}
          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
        >
          <X className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void commit()}
          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
        >
          <Check className="size-3.5" />
        </button>
      </span>
    );
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
              const labelMatch = parseStoryLabels(story.labels).some((lab) => lab.toLowerCase().includes(q));
              return (
                story.title.toLowerCase().includes(q) ||
                (story.assignee ?? "").toLowerCase().includes(q) ||
                story.status.toLowerCase().includes(q) ||
                sprintLabel(story.sprint).toLowerCase().includes(q) ||
                ref.includes(q) ||
                labelMatch
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
                if (labelFilter.length > 0) {
                  const labs = parseStoryLabels(story.labels);
                  if (!labelFilter.some((lf) => labs.includes(lf))) return false;
                }
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
          .filter(
            (epic) =>
              (epic.userStories ?? []).length > 0 ||
              (statusFilter.length === 0 && sprintFilter.length === 0 && labelFilter.length === 0),
          ),
      }))
      .filter(
        (initiative) =>
          (initiative.epics ?? []).length > 0 ||
          (statusFilter.length === 0 && sprintFilter.length === 0 && labelFilter.length === 0),
      );
  }, [filtered, statusFilter, sprintFilter, labelFilter, sortBy]);

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

  const roadmapOptions = useMemo(() => {
    // Only surface roadmaps that have at least one initiative loaded — the parent
    // pre-filters by the active roadmap, so other roadmaps would appear empty.
    const ids = new Set<string>();
    for (const i of initiatives) if (i.roadmapId) ids.add(i.roadmapId);
    if (ids.size === 0) return [];
    const byId = new Map<string, string>();
    for (const r of roadmaps ?? []) byId.set(r.id, r.name);
    return [...ids]
      .map((id) => ({ id, label: byId.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [roadmaps, initiatives]);

  const roadmapNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roadmaps ?? []) map.set(r.id, r.name);
    return map;
  }, [roadmaps]);

  const assigneeNameSuggestions = useMemo(() => collectAssigneeNameSuggestions(initiatives), [initiatives]);

  const storyLabelSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        for (const story of epic.userStories ?? []) {
          for (const lab of parseStoryLabels(story.labels)) set.add(lab);
        }
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [initiatives]);

  const assigneeAutocompleteSuggestions = useMemo(() => {
    const data = assigneeNameSuggestions.filter((n) => n !== "Unassigned");
    if (teamFilter.length === 0) return ["Unassigned", ...data];
    const allowed = rosterNamesForDeliveryTeams(teamFilter);
    const merged = new Set<string>();
    for (const n of data) {
      if (allowed.has(n)) merged.add(n);
    }
    for (const n of allowed) merged.add(n);
    const rest = [...merged].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return ["Unassigned", ...rest];
  }, [assigneeNameSuggestions, teamFilter]);

  useEffect(() => {
    if (teamFilter.length === 0) return;
    const allowed = rosterNamesForDeliveryTeams(teamFilter);
    setAssigneeFilter((prev) => prev.filter((n) => n === "Unassigned" || allowed.has(n)));
  }, [teamFilter]);

  const statusOptions: OptionItem[] = [
    { id: "todo", label: "To do" },
    { id: "inProgress", label: "In progress" },
    { id: "done", label: "Done" },
    { id: "approved", label: "Approved" },
  ];
  const sprintOptions: OptionItem[] = [
    { id: "unscheduled", label: "Unscheduled" },
    ...Array.from({ length: YEAR_SPRINT_MAX }, (_, i) => {
      const n = i + 1;
      return { id: String(n), label: `Sprint ${n}` };
    }),
  ];
  const assignableSprintsForYear = useMemo(() => {
    const cache = new Map<number, number[]>();
    return (year: number): number[] => {
      const cached = cache.get(year);
      if (cached) return cached;
      const list = Array.from({ length: YEAR_SPRINT_MAX }, (_, i) => i + 1).filter(
        (n) => sprintEndDate(year, n).getTime() > Date.now(),
      );
      cache.set(year, list);
      return list;
    };
  }, []);
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

  const backlogFilteredBeforeWorkItem = useMemo(() => {
    return filteredWithControls
      .map((initiative) => {
        if (roadmapFilter.length > 0 && (!initiative.roadmapId || !roadmapFilter.includes(initiative.roadmapId))) return null;
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
            if (teamFilter.length > 0) {
              const tid = epic.team?.trim();
              if (!tid || !teamFilter.includes(tid)) return null;
            }
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
        return { ...initiative, epics };
      })
      .filter(Boolean) as typeof filteredWithControls;
  }, [filteredWithControls, roadmapFilter, yearFilter, quarterFilter, teamFilter, assigneeFilter]);

  const fullyFiltered = useMemo(
    () => applyWorkItemKindFilter(backlogFilteredBeforeWorkItem, workItemFilter),
    [backlogFilteredBeforeWorkItem, workItemFilter],
  );
  // O(1) lookups by id — replaces `fullyFiltered.find(...)` calls that fired once per rendered
  // row (= O(N²) total) and made changing Group by feel slow on large backlogs.
  const initiativeById = useMemo(() => {
    const map = new Map<string, InitiativeItem>();
    for (const initiative of fullyFiltered) map.set(initiative.id, initiative);
    return map;
  }, [fullyFiltered]);
  const epicById = useMemo(() => {
    const map = new Map<string, EpicItem>();
    for (const initiative of fullyFiltered) {
      for (const epic of initiative.epics ?? []) map.set(epic.id, epic);
    }
    return map;
  }, [fullyFiltered]);

  const summaryInitiativeCount = backlogFilteredBeforeWorkItem.length;
  const summaryEpicCount = useMemo(
    () => backlogFilteredBeforeWorkItem.reduce((sum, initiative) => sum + (initiative.epics?.length ?? 0), 0),
    [backlogFilteredBeforeWorkItem],
  );
  const summaryStoryCount = useMemo(
    () =>
      backlogFilteredBeforeWorkItem.reduce(
        (sum, initiative) =>
          sum + (initiative.epics ?? []).reduce((epicSum, epic) => epicSum + (epic.userStories?.length ?? 0), 0),
        0,
      ),
    [backlogFilteredBeforeWorkItem],
  );
  useEffect(() => {
    // Debug aid: keep concise counts + active filters to diagnose missing backlog rows.
    console.log("[BacklogDebug] counts", {
      sourceInitiatives: initiatives.length,
      filteredWithControls: filteredWithControls.length,
      backlogFilteredBeforeWorkItem: backlogFilteredBeforeWorkItem.length,
      fullyFiltered: fullyFiltered.length,
      summaryInitiativeCount,
      summaryEpicCount,
      summaryStoryCount,
    });
    console.log("[BacklogDebug] filters", {
      query,
      yearFilter,
      quarterFilter,
      statusFilter,
      sprintFilter,
      teamFilter,
      assigneeFilter,
      labelFilter,
      workItemFilter,
      groupLevels,
    });
    console.log(
      "[BacklogDebug] visible initiative IDs",
      fullyFiltered.map((initiative) => initiative.id),
    );
    console.log("[BacklogDebug] ui open state", {
      groupLevels,
      openGroupFoldersCount: Object.keys(openGroupFolders).length,
      openInitiativesCount: Object.keys(openInitiatives).length,
      openEpicsCount: Object.keys(openEpics).length,
    });
  }, [
    initiatives.length,
    filteredWithControls.length,
    backlogFilteredBeforeWorkItem.length,
    fullyFiltered,
    summaryInitiativeCount,
    summaryEpicCount,
    summaryStoryCount,
    query,
    yearFilter,
    quarterFilter,
    statusFilter,
    sprintFilter,
    teamFilter,
    assigneeFilter,
    labelFilter,
    workItemFilter,
    groupLevels,
    openGroupFolders,
    openInitiatives,
    openEpics,
  ]);

  useEffect(() => {
    const root = backlogRowsRootRef.current;
    if (!root) return;

    const rowEls = Array.from(root.querySelectorAll<HTMLElement>('[data-backlog-zebra-row="true"]'));
    rowEls.forEach((el, idx) => {
      const bg = idx % 2 === 0 ? BACKLOG_TABLE_STRIPE_BG : BACKLOG_TABLE_BASE_BG;
      el.style.backgroundColor = bg;
    });
  }, [
    fullyFiltered,
    groupLevels,
    query,
    yearFilter,
    quarterFilter,
    statusFilter,
    sprintFilter,
    teamFilter,
    assigneeFilter,
    labelFilter,
    workItemFilter,
    openGroupFolders,
    openInitiatives,
    openEpics,
  ]);

  const columnDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleBacklogColumnDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const aid = active.id as BacklogColumnKey;
    const oid = over.id as BacklogColumnKey;
    if (aid === "workItem" || oid === "workItem") return;
    setColumnOrder((prev) => {
      const oldIndex = prev.indexOf(aid);
      const newIndex = prev.indexOf(oid);
      if (oldIndex < 0 || newIndex < 0) return prev;
      let next = arrayMove(prev, oldIndex, newIndex);
      if (next[0] !== "workItem") {
        const wi = next.indexOf("workItem");
        if (wi >= 0) {
          const rest = next.filter((k) => k !== "workItem");
          next = ["workItem", ...rest];
        }
      }
      return normalizeColumnOrder(next);
    });
  }, []);

  const visibleColumnKeys = useMemo(
    () => columnOrder.filter((key) => columnVisibility[key]),
    [columnOrder, columnVisibility],
  );

  const tableGridTemplate = useMemo(
    () => visibleColumnKeys.map((key) => `${columnWidths[key]}px`).join(" "),
    [visibleColumnKeys, columnWidths],
  );

  const createFormRestGridStyle = useMemo(
    () => (visibleColumnKeys.length > 1 ? ({ gridColumn: "2 / -1" } as const) : undefined),
    [visibleColumnKeys.length],
  );

  type CellIconHint = { kind: "edit"; onEdit: () => void } | { kind: "lock" };

  function renderBacklogTeamCell(teamId: string | null | undefined): ReactNode {
    if (!teamId) return <span className="text-[14px] text-slate-400">—</span>;
    const color = TEAM_DOT_COLOR[teamId] ?? "bg-slate-400";
    const label = monthTeamLabelForId(teamId) ?? teamLabelForWorkspaceUser(teamId) ?? teamId;
    return (
      <span className="inline-flex items-center gap-1.5 text-[15px] text-slate-800">
        <span className={cn("inline-block size-2 rounded-full", color)} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  function renderBacklogCells(
    cells: Record<BacklogColumnKey, ReactNode>,
    iconHints?: Partial<Record<BacklogColumnKey, CellIconHint>>,
  ) {
    return visibleColumnKeys.map((key) => {
      const hint = iconHints?.[key];

      if (!hint) {
        return (
          <div key={key} className={backlogCellClassName(key)}>
            {cells[key]}
          </div>
        );
      }

      // Hint present: absolute-position the icon over the right edge so the cell content (especially
      // centered chips like Status / Team / Start / End) stays visually centered within the column —
      // the previous flex layout reserved a fixed icon slot which pulled centered content slightly left.
      const isCentered = CENTER_ALIGNED_BACKLOG_COLUMNS.has(key);
      const stretchClass =
        key === "workItem" ? "relative min-w-0 pl-4"
        : key === "progress" ? "relative min-w-0"
        : key === "labels" ? "relative min-w-0 w-full max-w-full overflow-hidden"
        : "relative min-w-0";

      return (
        <div key={key} className={cn(stretchClass, "group/cell flex items-center")}>
          <div className={cn("w-full min-w-0 flex items-center overflow-hidden", isCentered && "justify-center")}>
            {cells[key]}
          </div>
          {hint.kind === "edit" ? (
            <span
              className="pointer-events-auto absolute right-1 top-1/2 z-[1] shrink-0 -translate-y-1/2 opacity-0 transition-opacity group-hover/cell:opacity-100"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <EditRowIconButton label="Edit" onClick={hint.onEdit} />
            </span>
          ) : (
            <span
              title="Read only"
              className="pointer-events-none absolute right-1 top-1/2 z-[1] shrink-0 -translate-y-1/2 opacity-0 transition-opacity group-hover/cell:opacity-100"
            >
              <Lock className="size-3.5 text-slate-300" />
            </span>
          )}
        </div>
      );
    });
  }
  const groupedStoryRows = useMemo(() => {
    return fullyFiltered.flatMap((initiative) =>
      (initiative.epics ?? []).flatMap((epic) =>
        (epic.userStories ?? []).map((story) => {
          const monthNum = epic.planStartMonth ?? initiative.startMonth ?? null;
          const initiativeMonthNum = initiative.startMonth ?? null;
          const workPlan = storyWorkPlanRangeFromProgress(story);
          return {
            storyId: story.id,
            storyTitle: story.title,
            storyIcon: story.icon,
            storyStatus: story.status,
            storyAssignee: story.assignee?.trim() || "Unassigned",
            storySprintLabel: sprintLabel(story.sprint),
            storySprintNum: story.sprint,
            storyEstimatedDays: story.estimatedDays ?? 0,
            storyDaysLeft: story.daysLeft ?? 0,
            storyLabels: story.labels ?? null,
            initiativeId: initiative.id,
            initiativeTitle: initiative.title,
            initiativeYear: String(initiative.year),
            initiativeRoadmapId: initiative.roadmapId ?? "",
            initiativeRoadmapLabel: initiative.roadmapId ? (roadmapNameById.get(initiative.roadmapId) ?? initiative.roadmapId) : "No roadmap",
            initiativeStatus: rollupWorkflowStatus((initiative.epics ?? []).flatMap((epic) => epic.userStories ?? [])),
            initiativeAssignee: initiative.assignee?.trim() || "Unassigned",
            initiativeMonthNum,
            initiativeQuarterLabelValue: quarterFromMonth(initiativeMonthNum),
            initiativeMonthLabelValue: monthLabel(initiativeMonthNum),
            epicId: epic.id,
            epicTitle: epic.title,
            epicAssignee: epic.assignee?.trim() || "Unassigned",
            epicOriginalEstimateDays: epic.originalEstimateDays ?? 0,
            teamId: (epic.team ?? null) as string | null,
            monthNum,
            monthLabelValue: monthLabel(monthNum),
            quarterLabelValue: quarterFromMonth(monthNum),
            storyStartDateLabel: formatBacklogPlanDate(workPlan.start),
            storyEndDateLabel: formatBacklogPlanDate(workPlan.end),
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
        initiativeRoadmapId: initiative.roadmapId ?? "",
        initiativeRoadmapLabel: initiative.roadmapId ? (roadmapNameById.get(initiative.roadmapId) ?? initiative.roadmapId) : "No roadmap",
        initiativeStatus: rollupWorkflowStatus([]),
        initiativeAssignee: initiative.assignee?.trim() || "Unassigned",
        initiativeMonthNum: initiative.startMonth ?? null,
        initiativeMonthLabelValue: monthLabel(initiative.startMonth),
        initiativeQuarterLabelValue: quarterFromMonth(initiative.startMonth),
        initiativeTeamId: aggregateInitiativeTeamId(initiative),
        epics: (initiative.epics ?? []).map((epic) => ({
          epicId: epic.id,
          epicTitle: epic.title,
          epicAssignee: epic.assignee?.trim() || "Unassigned",
          epicOriginalEstimateDays: epic.originalEstimateDays ?? 0,
          epicTeamId: (epic.team ?? null) as string | null,
          epicMonthNum: epic.planStartMonth ?? initiative.startMonth ?? null,
          epicMonthLabelValue: monthLabel(epic.planStartMonth ?? initiative.startMonth),
          epicQuarterLabelValue: quarterFromMonth(epic.planStartMonth ?? initiative.startMonth),
        })),
      }));
  }, [fullyFiltered]);

  /**
   * Excel export — builds a row-per-story payload from the currently filtered `groupedStoryRows`, mapping
   * each visible column to its plain-text value. The preview window then offers a one-click .xls download.
   * Honors the user's column order + visibility exactly so the export matches what's on screen.
   */
  const handleExcelExport = useCallback(() => {
    const teamLabelOf = (teamId: string | null | undefined): string => {
      if (!teamId) return "";
      return monthTeamLabelForId(teamId) ?? teamLabelForWorkspaceUser(teamId) ?? teamId;
    };
    const STATUS_LABEL: Record<string, string> = {
      todo: "To do",
      inProgress: "In progress",
      done: "Done",
      approved: "Approved",
    };
    // Sequential short IDs (INIT-001, EPIC-001, STORY-001). Computed deterministically by encounter order in
    // the filtered rows so the same backlog snapshot always gets the same IDs in the export.
    const initIds = new Map<string, string>();
    const epicIds = new Map<string, string>();
    const storyIds = new Map<string, string>();
    const pad = (n: number) => String(n).padStart(3, "0");
    for (const r of groupedStoryRows) {
      if (!initIds.has(r.initiativeId)) initIds.set(r.initiativeId, `INIT-${pad(initIds.size + 1)}`);
      if (!epicIds.has(r.epicId)) epicIds.set(r.epicId, `EPIC-${pad(epicIds.size + 1)}`);
      if (!storyIds.has(r.storyId)) storyIds.set(r.storyId, `STORY-${pad(storyIds.size + 1)}`);
    }
    // Non-workItem cell extractor — workItem is replaced by 6 dedicated columns up front and is not emitted here.
    const cellValueFor = (row: (typeof groupedStoryRows)[number], key: BacklogColumnKey): string => {
      switch (key) {
        case "workItem":
          return "";
        case "team":
          return teamLabelOf(row.teamId);
        case "assignee":
          return row.storyAssignee || "";
        case "status":
          return STATUS_LABEL[row.storyStatus] ?? row.storyStatus ?? "";
        case "sprint":
          return row.storySprintLabel || "";
        case "progress": {
          const total = row.storyEstimatedDays || 0;
          if (total <= 0) return "";
          const done = Math.max(0, total - (row.storyDaysLeft || 0));
          return `${Math.round((done / total) * 100)}%`;
        }
        case "estDays":
          return String(row.storyEstimatedDays ?? 0);
        case "epicOriginalEst":
          return String(row.epicOriginalEstimateDays ?? 0);
        case "daysLeft":
          return String(row.storyDaysLeft ?? 0);
        case "labels":
          return row.storyLabels ?? "";
        case "startDate":
          return row.storyStartDateLabel ?? "";
        case "endDate":
          return row.storyEndDateLabel ?? "";
        case "year":
          return row.initiativeYear ?? "";
        case "quarter":
          return row.quarterLabelValue ?? "";
        case "month":
          return row.monthLabelValue ?? "";
        default:
          return "";
      }
    };
    // 6 leading hierarchy columns replace the on-screen combined "Work item" column.
    const hierarchyLabels = [
      "INIT ID",
      "Initiative Description",
      "EPIC ID",
      "Epic Description",
      "STORY ID",
      "User Story Description",
    ];
    // Drop workItem from the trailing column list — it's superseded by the hierarchy columns above.
    const trailingKeys = visibleColumnKeys.filter((key) => key !== "workItem");
    const trailingLabels = trailingKeys.map((key) => BACKLOG_COLUMN_LABELS[key]);
    const columnLabels = [...hierarchyLabels, ...trailingLabels];

    const rows = groupedStoryRows.map((r) => ({
      cells: [
        initIds.get(r.initiativeId) ?? "",
        r.initiativeTitle ?? "",
        epicIds.get(r.epicId) ?? "",
        r.epicTitle ?? "",
        storyIds.get(r.storyId) ?? "",
        r.storyTitle ?? "",
        ...trailingKeys.map((key) => cellValueFor(r, key)),
      ],
    }));
    const subtitle = `${rows.length} ${rows.length === 1 ? "story" : "stories"} · ${columnLabels.length} columns`;
    exportBacklogToPrintableWindow({
      columnLabels,
      rows,
      title: "Backlog export",
      subtitle,
      filename: `backlog-${new Date().toISOString().slice(0, 10)}`,
    });
  }, [groupedStoryRows, visibleColumnKeys]);

  const groupSummaryLabel = groupLevels.length === 0 ? "None" : groupLevels.map((level) => GROUP_LEVEL_LABELS[level]).join(" / ");
  const hasAnyActiveFilter =
    yearFilter.length > 0 ||
    quarterFilter.length > 0 ||
    statusFilter.length > 0 ||
    sprintFilter.length > 0 ||
    teamFilter.length > 0 ||
    assigneeFilter.length > 0 ||
    labelFilter.length > 0 ||
    roadmapFilter.length > 0 ||
    workItemFilter.length > 0 ||
    groupLevels.length > 0 ||
    query.trim().length > 0 ||
    presetSearch.trim().length > 0;

  function toggleGroupLevel(level: GroupLevel) {
    setGroupLevels((prev) => {
      const idx = GROUP_LEVEL_ORDER.indexOf(level);
      if (prev.includes(level)) {
        return GROUP_LEVEL_ORDER.slice(0, idx).filter((item) => prev.includes(item));
      }
      return GROUP_LEVEL_ORDER.slice(0, idx + 1);
    });
  }

  function resetAllFilters() {
    setQuery("");
    setStatusFilter([]);
    setSprintFilter([]);
    setYearFilter([]);
    setQuarterFilter([]);
    setTeamFilter([]);
    setAssigneeFilter([]);
    setLabelFilter([]);
    setRoadmapFilter([]);
    setWorkItemFilter([]);
    setGroupLevels([]);
    setGroupMenuOpen(false);
    setPresetSearch("");
    setPresetMenuOpen(false);
  }

  const buildBacklogFilterSnapshot = useCallback((): BacklogFilterSnapshot => {
    return {
      query,
      statusFilter,
      sprintFilter,
      yearFilter,
      quarterFilter,
      teamFilter,
      assigneeFilter,
      labelFilter,
      roadmapFilter,
      workItemFilter,
      groupLevels,
    };
  }, [
    query,
    statusFilter,
    sprintFilter,
    yearFilter,
    quarterFilter,
    teamFilter,
    assigneeFilter,
    labelFilter,
    roadmapFilter,
    workItemFilter,
    groupLevels,
  ]);

  const buildBacklogViewSnapshot = useCallback((): BacklogViewSnapshot => {
    return {
      sortBy,
      columnOrder: [...columnOrder],
      columnVisibility: { ...columnVisibility },
      showTableHeaderRow,
      columnWidths: { ...columnWidths },
    };
  }, [sortBy, columnOrder, columnVisibility, showTableHeaderRow, columnWidths]);

  const applyBacklogFilterSnapshot = useCallback((snapshot: BacklogFilterSnapshot) => {
    setQuery(snapshot.query);
    setStatusFilter([...snapshot.statusFilter]);
    setSprintFilter([...snapshot.sprintFilter]);
    setYearFilter([...snapshot.yearFilter]);
    setQuarterFilter([...snapshot.quarterFilter]);
    setTeamFilter(snapshot.teamFilter.filter((v) => MONTH_TEAM_COLUMNS.some((c) => c.id === v)));
    setAssigneeFilter([...snapshot.assigneeFilter]);
    setLabelFilter([...snapshot.labelFilter]);
    setRoadmapFilter([...(snapshot.roadmapFilter ?? [])]);
    setWorkItemFilter([...snapshot.workItemFilter]);
    setGroupLevels([...snapshot.groupLevels]);
    setGroupMenuOpen(false);
  }, []);

  const applyBacklogViewSnapshot = useCallback((snapshot: BacklogViewSnapshot) => {
    setSortBy(snapshot.sortBy);
    setColumnOrder(normalizeColumnOrder(snapshot.columnOrder));
    setColumnVisibility(() => {
      const next = { ...DEFAULT_BACKLOG_COLUMN_VISIBILITY };
      for (const key of BACKLOG_COLUMN_ORDER) {
        const v = snapshot.columnVisibility[key];
        if (typeof v === "boolean") next[key] = v;
      }
      next.workItem = true;
      return next;
    });
    setShowTableHeaderRow(snapshot.showTableHeaderRow);
    setColumnWidths(() => {
      const next = { ...BACKLOG_COLUMN_DEFAULT_WIDTHS };
      for (const key of BACKLOG_COLUMN_ORDER) {
        const w = snapshot.columnWidths[key];
        if (typeof w === "number" && Number.isFinite(w)) {
          next[key] = Math.max(BACKLOG_COLUMN_MIN_WIDTHS[key], Math.round(w));
        }
      }
      return next;
    });
    setColumnsMenuOpen(false);
    setViewPresetMenuOpen(false);
  }, []);

  const filteredSavedFilterPresets = useMemo(() => {
    const q = presetSearch.trim().toLowerCase();
    if (!q) return savedFilterPresets.slice(0, 12);
    return savedFilterPresets.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [savedFilterPresets, presetSearch]);

  const filteredSavedViewPresets = useMemo(() => {
    const q = viewPresetSearch.trim().toLowerCase();
    if (!q) return savedViewPresets.slice(0, 12);
    return savedViewPresets.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [savedViewPresets, viewPresetSearch]);

  const saveAsFilterSummaryLines = useMemo(() => {
    if (!saveAsFilterDialogOpen) return [];
    return backlogFilterSnapshotSummaryLines(buildBacklogFilterSnapshot());
  }, [saveAsFilterDialogOpen, buildBacklogFilterSnapshot]);

  const saveViewSummaryLines = useMemo(() => {
    if (!saveViewDialogOpen) return [];
    return backlogViewSnapshotSummaryLines(buildBacklogViewSnapshot());
  }, [saveViewDialogOpen, buildBacklogViewSnapshot]);

  function openSaveAsFilterDialog() {
    setPresetMenuOpen(false);
    setViewPresetMenuOpen(false);
    setSaveAsFilterName("");
    setSaveAsFilterDialogOpen(true);
  }

  function openSaveViewDialog() {
    setViewPresetMenuOpen(false);
    setPresetMenuOpen(false);
    setSaveViewName("");
    setSaveViewDialogOpen(true);
  }

  function confirmSaveAsFilterPreset() {
    const name = saveAsFilterName.trim();
    if (!name) {
      toast.error("Enter a name for this saved filter");
      return;
    }
    const snapshot = buildBacklogFilterSnapshot();
    const now = Date.now();
    setSavedFilterPresets((prev) => {
      const rest = prev.filter((p) => p.name.trim().toLowerCase() !== name.toLowerCase());
      return [{ id: newSavedFilterPresetId(), name, snapshot, updatedAt: now }, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
    });
    setSaveAsFilterDialogOpen(false);
    setSaveAsFilterName("");
    toast.success(`Saved filter "${name}"`);
  }

  function confirmSaveViewPreset() {
    const name = saveViewName.trim();
    if (!name) {
      toast.error("Enter a name for this saved view");
      return;
    }
    const snapshot = buildBacklogViewSnapshot();
    const now = Date.now();
    setSavedViewPresets((prev) => {
      const rest = prev.filter((p) => p.name.trim().toLowerCase() !== name.toLowerCase());
      return [{ id: newSavedViewPresetId(), name, snapshot, updatedAt: now }, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
    });
    setSaveViewDialogOpen(false);
    setSaveViewName("");
    toast.success(`Saved view "${name}"`);
  }

  function deleteSavedFilterPreset(id: string) {
    setSavedFilterPresets((prev) => prev.filter((p) => p.id !== id));
    toast.success("Saved filter removed");
  }

  function deleteSavedViewPreset(id: string) {
    setSavedViewPresets((prev) => prev.filter((p) => p.id !== id));
    toast.success("Saved view removed");
  }

  function toggleWorkItemBadgeFilter(kind: WorkItemKindFilter) {
    setWorkItemFilter((prev) => {
      if (prev.length === 1 && prev[0] === kind) return [];
      return [kind];
    });
  }

  function keyForLevel(row: (typeof groupedStoryRows)[number], level: GroupLevel): { key: string; label: string; sort: string } {
    if (level === "roadmap") {
      const key = row.initiativeRoadmapId || "__no_roadmap__";
      const label = row.initiativeRoadmapLabel;
      return { key, label, sort: row.initiativeRoadmapId ? label.toLowerCase() : "zzzz" };
    }
    if (level === "year") return { key: row.initiativeYear, label: row.initiativeYear, sort: row.initiativeYear.padStart(4, "0") };
    if (level === "quarter") {
      const q = quarterLabelOrUnscheduled(row.initiativeQuarterLabelValue);
      return { key: q, label: q, sort: quarterSortValue(q) };
    }
    if (level === "month") {
      const m = row.initiativeMonthNum ?? 0;
      return { key: String(m), label: row.initiativeMonthLabelValue, sort: String(m).padStart(2, "0") };
    }
    const n = row.storySprintNum;
    const sprint = row.storySprintLabel;
    const order = n == null ? "99" : String(n).padStart(2, "0");
    return { key: sprint, label: sprint, sort: order };
  }

  function keyForStandaloneLevel(
    row: (typeof groupedStandaloneInitiatives)[number],
    level: GroupLevel,
  ): { key: string; label: string; sort: string } {
    if (level === "roadmap") {
      const key = row.initiativeRoadmapId || "__no_roadmap__";
      const label = row.initiativeRoadmapLabel;
      return { key, label, sort: row.initiativeRoadmapId ? label.toLowerCase() : "zzzz" };
    }
    if (level === "year") return { key: row.initiativeYear, label: row.initiativeYear, sort: row.initiativeYear.padStart(4, "0") };
    if (level === "quarter") {
      const q = quarterLabelOrUnscheduled(row.initiativeQuarterLabelValue);
      return { key: q, label: q, sort: quarterSortValue(q) };
    }
    if (level === "month") {
      const m = row.initiativeMonthNum ?? 0;
      return { key: String(m), label: row.initiativeMonthLabelValue, sort: String(m).padStart(2, "0") };
    }
    return { key: "none", label: "No sprint", sort: "99" };
  }

  // Backlog zebra striping:
  // Applied after render via a DOM hook (see useEffect above).

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
            className={cn("group grid min-w-full w-max items-center gap-2 border-b border-slate-200/80 py-1.5 hover:!bg-indigo-50/40")}
            data-backlog-zebra-row="true"
            data-backlog-zebra-kind="story"
            data-backlog-zebra-label={row.storyTitle}
            style={{
              gridTemplateColumns: tableGridTemplate,
            }}
          >
            {renderBacklogCells({
              workItem: (
                <div className="relative min-w-0" style={{ paddingLeft: indentPx }}>
                  <BacklogTreeConnector indentPx={indentPx} />
                  <div className="flex min-w-0 items-center gap-2 truncate text-left text-slate-800">
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                      <UserStoryIcon />
                    </span>
                    {editingStoryTitle?.id === row.storyId ? (
                      <span className="flex min-w-0 items-center gap-1">
                        <input
                          value={editingStoryTitle.value}
                          onChange={(event) => setEditingStoryTitle({ id: row.storyId, value: event.target.value })}
                          className="h-7 min-w-[180px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                          autoFocus
                        />
                        <button type="button" onClick={() => setEditingStoryTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                        <button type="button" onClick={() => void confirmStoryTitleEdit(row.storyId, row.storyTitle)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                      </span>
                    ) : (
                      <span className="inline-flex w-full min-w-0 items-center gap-1 text-left text-[16px]">
                        <button
                          type="button"
                          className="min-w-0 truncate text-left hover:underline hover:decoration-slate-400 hover:underline-offset-2"
                          onClick={() => onOpenStory(row.storyId)}
                        >
                          {row.storyTitle}
                        </button>
                        <span className="ml-auto opacity-0 transition group-hover/workitem:opacity-100 focus-within:opacity-100">
                          <EditRowIconButton
                            label="Edit user story title"
                            onClick={() => setEditingStoryTitle({ id: row.storyId, value: row.storyTitle })}
                          />
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              ),
              team: isEditingParentTeam("epic", row.epicId) ? (
                renderParentTeamEditor({ kind: "epic", id: row.epicId })
              ) : (
                renderBacklogTeamCell(row.teamId)
              ),
              year: <span className="text-center text-[16px] text-slate-700">{row.initiativeYear}</span>,
              quarter: <span className="text-center text-[16px] text-slate-700">{row.quarterLabelValue}</span>,
              month: <span className="text-center text-[16px] text-slate-700">{row.monthLabelValue}</span>,
              startDate: (
                <span className="text-center text-[14px] tabular-nums text-slate-700">{row.storyStartDateLabel}</span>
              ),
              endDate: (
                <span className="text-center text-[14px] tabular-nums text-slate-700">{row.storyEndDateLabel}</span>
              ),
              status: (
            <span className={cn("relative inline-flex min-w-[104px] items-center justify-center justify-self-center rounded-full px-3 py-[3px] text-[13px] font-semibold tracking-wide", statusChip(row.storyStatus))}>
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "status" ? (
                <>
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    {statusIcon(editingStoryCell.value)}
                    {workflowStatusLabel(editingStoryCell.value as WorkflowStatus)}
                  </span>
                  <CellOptionPopover
                    value={editingStoryCell.value as WorkflowStatus}
                    options={STORY_STATUS_POPOVER_OPTIONS}
                    onSelect={(v) => {
                      setEditingStoryCell((prev) => (prev ? { ...prev, value: v } : prev));
                      void confirmStoryCellEdit(row.storyId, "status", storyEditSnapshotFromGroupedRow(row), v);
                    }}
                    onCancel={cancelStoryCellEdit}
                    widthClass="w-[180px]"
                  />
                </>
              ) : (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    beginStoryCellEdit(row.storyId, "status", row.storyStatus);
                  }}
                  className="inline-flex items-center gap-1.5 font-semibold"
                >
                  {statusIcon(row.storyStatus)}
                  {workflowStatusLabel(row.storyStatus as WorkflowStatus)}
                </button>
              )}
            </span>
              ),
              sprint: (
            <span className="text-center text-[16px] text-slate-700">
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "sprint" ? (
                <span className="inline-flex items-center gap-1">
                  <select
                    value={editingStoryCell.value}
                    onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                    onKeyDown={(event) =>
                      handleStoryCellKeyDown(event, row.storyId, "sprint", storyEditSnapshotFromGroupedRow(row))
                    }
                    className="h-7 min-w-[94px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                  >
                    <option value="unscheduled">Unscheduled</option>
                    {assignableSprintsForYear(Number(row.initiativeYear)).map((n) => {
                      return (
                        <option key={n} value={String(n)}>
                          Sprint {n}
                        </option>
                      );
                    })}
                  </select>
                  <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                  <button
                    type="button"
                    onClick={() =>
                      confirmStoryCellEdit(row.storyId, "sprint", storyEditSnapshotFromGroupedRow(row))
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
                      row.storySprintNum == null ? "unscheduled" : String(row.storySprintNum),
                    );
                  }}
                  className="rounded px-1 py-0.5 hover:bg-slate-100"
                >
                  {row.storySprintLabel}
                </button>
              )}
            </span>
              ),
              assignee: (
            <span className="text-center text-[16px] text-slate-700">
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "assignee" ? (
                <span className="inline-flex items-center gap-1">
                  <AssigneeCombobox
                    value={editingStoryCell.value}
                    onChange={(v) => setEditingStoryCell((prev) => (prev ? { ...prev, value: v } : prev))}
                    onKeyDown={(event) =>
                      handleStoryCellKeyDown(event, row.storyId, "assignee", storyEditSnapshotFromGroupedRow(row))
                    }
                    suggestions={assigneeNameSuggestions}
                    placeholder="Unassigned"
                    className="h-7 w-full min-w-[104px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                  />
                  <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                  <button
                    type="button"
                    onClick={() =>
                      confirmStoryCellEdit(row.storyId, "assignee", storyEditSnapshotFromGroupedRow(row))
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
                  className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-100"
                >
                  <UserRound className="size-3.5 text-slate-400" aria-hidden />
                  {row.storyAssignee}
                </button>
              )}
            </span>
              ),
              labels: (
            <div className="w-full min-w-0 overflow-hidden">
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "labels" ? (
                <div className="mx-auto flex w-full min-w-0 max-w-full flex-col gap-1.5 rounded-lg border border-indigo-200/55 bg-gradient-to-b from-white to-slate-50/95 p-2 shadow-sm ring-1 ring-slate-200/45">
                  <textarea
                    value={editingStoryCell.value}
                    onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                    onKeyDown={(event) =>
                      handleStoryCellKeyDown(event, row.storyId, "labels", storyEditSnapshotFromGroupedRow(row))
                    }
                    rows={2}
                    className="min-h-[2.5rem] w-full min-w-0 rounded-md border border-slate-200/80 bg-white px-2 py-1.5 text-left text-[14px] leading-snug text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200/70"
                    placeholder="Comma-separated labels"
                  />
                  <span className="flex items-center justify-center gap-0.5">
                    <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                    <button
                      type="button"
                      onClick={() =>
                        confirmStoryCellEdit(row.storyId, "labels", storyEditSnapshotFromGroupedRow(row))
                      }
                      className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
                    ><Check className="size-3.5" /></button>
                  </span>
                </div>
              ) : (
                <BacklogLabelsChipPanel
                  labelsSerialized={row.storyLabels}
                  onMouseDownBeginEdit={(event) => {
                    event.preventDefault();
                    beginStoryCellEdit(row.storyId, "labels", formatStoryLabelsForEditInput(row.storyLabels));
                  }}
                />
              )}
            </div>
              ),
              estDays: (
            <span className="text-center text-[16px] text-slate-700">
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "estimatedDays" ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    value={editingStoryCell.value}
                    onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                    onKeyDown={(event) =>
                      handleStoryCellKeyDown(event, row.storyId, "estimatedDays", storyEditSnapshotFromGroupedRow(row))
                    }
                    className="h-7 w-20 rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                  />
                  <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                  <button
                    type="button"
                    onClick={() =>
                      confirmStoryCellEdit(row.storyId, "estimatedDays", storyEditSnapshotFromGroupedRow(row))
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
              ),
              epicOriginalEst: <span className="text-center text-[16px] text-slate-400">-</span>,
              daysLeft: (
            <span className="text-center text-[16px] text-slate-700">
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "daysLeft" ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    value={editingStoryCell.value}
                    onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                    onKeyDown={(event) =>
                      handleStoryCellKeyDown(event, row.storyId, "daysLeft", storyEditSnapshotFromGroupedRow(row))
                    }
                    className="h-7 w-20 rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                  />
                  <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                  <button
                    type="button"
                    onClick={() =>
                      confirmStoryCellEdit(row.storyId, "daysLeft", storyEditSnapshotFromGroupedRow(row))
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
              ),
              progress: (
            <button
              type="button"
              onClick={() => {}}
              className={backlogReadonlyProgressButtonClass}
            >
              <div className="text-right text-[13px] tabular-nums text-slate-600">
                <span>{progress.percent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500" style={{ width: `${progress.percent}%` }} />
              </div>
            </button>
              ),
            }, {
              workItem: { kind: "lock" },
              team: { kind: "edit", onEdit: () => beginEpicTeamEdit({ id: row.epicId, team: row.teamId }) },
              status: { kind: "edit", onEdit: () => beginStoryCellEdit(row.storyId, "status", row.storyStatus) },
              sprint: { kind: "edit", onEdit: () => beginStoryCellEdit(row.storyId, "sprint", row.storySprintNum == null ? "unscheduled" : String(row.storySprintNum)) },
              assignee: { kind: "edit", onEdit: () => beginStoryCellEdit(row.storyId, "assignee", row.storyAssignee === "Unassigned" ? "" : row.storyAssignee) },
              labels: { kind: "edit", onEdit: () => beginStoryCellEdit(row.storyId, "labels", formatStoryLabelsForEditInput(row.storyLabels)) },
              estDays: { kind: "edit", onEdit: () => beginStoryCellEdit(row.storyId, "estimatedDays", String(row.storyEstimatedDays)) },
              daysLeft: { kind: "edit", onEdit: () => beginStoryCellEdit(row.storyId, "daysLeft", String(row.storyDaysLeft)) },
              year: { kind: "lock" },
              quarter: { kind: "lock" },
              month: { kind: "lock" },
              startDate: { kind: "lock" },
              endDate: { kind: "lock" },
              epicOriginalEst: { kind: "lock" },
              progress: { kind: "lock" },
            })}
          </div>
        );
      });
  }

  function renderFolderRow(
    folderId: string,
    label: string,
    count: number,
    indentPx: number,
    renderChildren: () => React.ReactNode,
    leadingIcon?: React.ReactNode,
  ) {
    const isOpen = openGroupFolders[folderId] ?? defaultGroupExpanded;
    const renderedChildren = isOpen ? renderChildren() : null;
    return (
      <div key={folderId}>
        <div
          className={cn("grid min-w-full w-max items-center gap-2 border-b border-slate-200/80 py-1.5 hover:!bg-indigo-50/40")}
          style={{ gridTemplateColumns: tableGridTemplate }}
          data-backlog-zebra-row="true"
          data-backlog-zebra-kind="folder"
          data-backlog-zebra-label={label}
        >
          {renderBacklogCells({
            workItem: (
              <div className="relative min-w-0">
                <BacklogTreeConnector indentPx={indentPx} />
                <button
                  type="button"
                  onClick={() => setOpenGroupFolders((prev) => ({ ...prev, [folderId]: !(prev[folderId] ?? defaultGroupExpanded) }))}
                  className="flex w-full min-w-0 items-center gap-1.5 text-left text-[16px] font-semibold text-slate-700"
                  style={{ paddingLeft: indentPx }}
                >
                  {isOpen ? <ChevronDown className="size-4 shrink-0 text-slate-500" /> : <ChevronRight className="size-4 shrink-0 text-slate-500" />}
                  {leadingIcon}
                  <span className="truncate">{label}</span>
                  <span className="shrink-0 text-[12px] font-normal tabular-nums text-slate-500">({count})</span>
                </button>
              </div>
            ),
            team: renderBacklogTeamCell(null),
            year: <span className="text-center text-[16px] text-slate-400">-</span>,
            quarter: <span className="text-center text-[16px] text-slate-400">-</span>,
            month: <span className="text-center text-[16px] text-slate-400">-</span>,
            startDate: <span className="text-center text-[16px] text-slate-400">-</span>,
            endDate: <span className="text-center text-[16px] text-slate-400">-</span>,
            status: <span className="text-center text-[16px] text-slate-400">-</span>,
            sprint: <span className="text-center text-[16px] text-slate-400">-</span>,
            assignee: <span className="text-center text-[16px] text-slate-400">-</span>,
            labels: <BacklogLabelsEmptyRowSlot />,
            estDays: <span className="text-center text-[16px] text-slate-400">-</span>,
            epicOriginalEst: <span className="text-center text-[16px] text-slate-400">-</span>,
            daysLeft: <span className="text-center text-[16px] text-slate-400">-</span>,
            progress: <span className="text-center text-[16px] text-slate-400">-</span>,
          }, {
            workItem: { kind: "lock" },
            team: { kind: "lock" },
            year: { kind: "lock" },
            quarter: { kind: "lock" },
            month: { kind: "lock" },
            startDate: { kind: "lock" },
            endDate: { kind: "lock" },
            status: { kind: "lock" },
            sprint: { kind: "lock" },
            assignee: { kind: "lock" },
            labels: { kind: "lock" },
            estDays: { kind: "lock" },
            epicOriginalEst: { kind: "lock" },
            daysLeft: { kind: "lock" },
            progress: { kind: "lock" },
          })}
        </div>
        {renderedChildren}
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
        <button
          type="button"
          onClick={() => {}}
          className={backlogReadonlyProgressButtonClass}
        >
          <div className="flex items-center justify-between text-[13px] tabular-nums text-slate-600">
            <span>{total === 0 ? "No stories" : null}</span>
            <span>
              {finished}/{total} · {percent}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </button>
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
      const { estimated, left } = sumEstimatedAndLeft(epicRows);
      const originalEstimate = epicRows[0]?.epicOriginalEstimateDays ?? 0;
      const initModelForEpic = epicRows[0]?.initiativeId ? initiativeById.get(epicRows[0].initiativeId) : undefined;
      const epicModelForRow = epicById.get(epicId);
      const planYearForEpic = initModelForEpic?.year ?? Number(epicRows[0]?.initiativeYear);
      const epicGanttRange =
        epicModelForRow && Number.isFinite(planYearForEpic)
          ? ganttDateRangeForEpic(epicModelForRow, planYearForEpic)
          : { start: null as Date | null, end: null as Date | null };

      return (
        <div key={folderId}>
          <div
            className={cn("group grid min-w-full w-max items-center gap-2 border-b border-slate-200/80 py-1.5 hover:!bg-indigo-50/40")}
            style={{
              gridTemplateColumns: tableGridTemplate,
            }}
            data-backlog-zebra-row="true"
            data-backlog-zebra-kind="epic"
            data-backlog-zebra-label={epicTitle}
          >
            {renderBacklogCells({
              workItem: (
                <div className="relative flex min-w-0 items-center gap-2" style={{ paddingLeft: epicIndentPx }}>
                  <BacklogTreeConnector indentPx={epicIndentPx} />
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
                    onClick={() => { if (editingParentTitle?.kind === "epic" && editingParentTitle.id === epicId) return; onOpenEpic(epicId); }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <EpicPlanBarIcon icon={epicModelForRow?.icon} className="mr-0 text-slate-400 [&_svg]:size-4" />
                    {editingParentTitle?.kind === "epic" && editingParentTitle.id === epicId ? (
                      <span className="flex min-w-0 items-center gap-1">
                        <input
                          value={editingParentTitle.value}
                          onChange={(event) => setEditingParentTitle({ kind: "epic", id: epicId, value: event.target.value })}
                          className="h-7 min-w-[180px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                          autoFocus
                        />
                        <button type="button" onClick={() => setEditingParentTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                        <button type="button" onClick={() => void confirmParentTitleEdit("epic", epicId, epicTitle)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                      </span>
                    ) : (
                      <span className="inline-flex w-full min-w-0 items-center gap-1 text-[16px] font-medium text-slate-900">
                        <span className="truncate">{epicTitle}</span>
                        <span
                          className="ml-auto opacity-0 transition group-hover/workitem:opacity-100 focus-within:opacity-100"
                          onMouseDown={(event) => event.stopPropagation()}
                        >
                          <EditRowIconButton
                            label="Edit epic title"
                            onClick={() => setEditingParentTitle({ kind: "epic", id: epicId, value: epicTitle })}
                          />
                        </span>
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
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 ring-1 ring-slate-200 text-slate-700 transition hover:bg-white hover:text-slate-900 group-hover/workitem:opacity-100 focus-visible:opacity-100"
                    title="Add user story"
                  >
                    <Plus className="size-3.5 text-slate-600" />
                  </button>
                </div>
              ),
              team: isEditingParentTeam("epic", epicId) ? (
                renderParentTeamEditor({ kind: "epic", id: epicId })
              ) : (
                renderBacklogTeamCell(epicModelForRow?.team ?? epicRows[0]?.teamId ?? null)
              ),
              year: <span className="text-center text-[16px] text-slate-700">{epicRows[0]?.initiativeYear ?? "-"}</span>,
              quarter: (
                <span className="text-center text-[16px] text-slate-700">
                  {quarterLabelOrUnscheduled(quarterFromMonth(epicRows[0]?.monthNum ?? null))}
                </span>
              ),
              month: <span className="text-center text-[16px] text-slate-700">{epicRows[0]?.monthLabelValue ?? "-"}</span>,
              startDate: (
                <span className="text-center text-[14px] tabular-nums text-slate-700">
                  {isEditingParentDate("epic", epicId, "start") ? (
                    renderParentDateEditor({ kind: "epic", id: epicId, field: "start" })
                  ) : (
                    formatBacklogPlanDate(epicGanttRange.start)
                  )}
                </span>
              ),
              endDate: (
                <span className="text-center text-[14px] tabular-nums text-slate-700">
                  {isEditingParentDate("epic", epicId, "end") ? (
                    renderParentDateEditor({ kind: "epic", id: epicId, field: "end" })
                  ) : (
                    formatBacklogPlanDate(epicGanttRange.end)
                  )}
                </span>
              ),
              status: (
                <span className={cn("inline-flex min-w-[104px] items-center justify-center gap-1.5 justify-self-center rounded-full px-3 py-[3px] text-[13px] font-semibold tracking-wide", statusChip(rollupWorkflowStatusFromGroupedRows(epicRows)))}>
                  {statusIcon(rollupWorkflowStatusFromGroupedRows(epicRows))}
                  {workflowStatusLabel(rollupWorkflowStatusFromGroupedRows(epicRows))}
                </span>
              ),
              sprint: <span className="text-center text-[16px] text-slate-500">-</span>,
              assignee: (
                <span className="text-center text-[16px] text-slate-700">
                  {editingParentAssignee?.kind === "epic" && editingParentAssignee.id === epicId ? (
                    <span className="inline-flex items-center gap-1">
                      <AssigneeCombobox
                        value={editingParentAssignee.value}
                        onChange={(v) => setEditingParentAssignee((prev) => (prev ? { ...prev, value: v } : prev))}
                        suggestions={assigneeNameSuggestions}
                        placeholder="Unassigned"
                        className="h-7 w-full min-w-[104px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setEditingParentAssignee(null);
                          }
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void confirmParentAssigneeEdit("epic", epicId, epicAssignee === "Unassigned" ? null : epicAssignee);
                          }
                        }}
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
                      className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-100"
                    >
                      <UserRound className="size-3.5 text-slate-400" aria-hidden />
                      {epicAssignee}
                    </button>
                  )}
                </span>
              ),
              labels: isEditingParentLabels("epic", epicId) ? (
                renderParentLabelsEditor({ kind: "epic", id: epicId })
              ) : (
                <span className="truncate text-[14px] text-slate-700">{epicModelForRow?.labels ?? ""}</span>
              ),
              estDays: (
                <button
                  type="button"
                  onClick={() => {}}
                  className={backlogReadonlyAutoSumButtonClass}
                >
                  Σ {estimated}d
                </button>
              ),
              epicOriginalEst: (
                <span className="text-center text-[16px] font-medium text-slate-600">
                  {originalEstimate}d
                </span>
              ),
              daysLeft: (
                <button
                  type="button"
                  onClick={() => {}}
                  className={backlogReadonlyAutoSumButtonClass}
                >
                  Σ {left}d
                </button>
              ),
              progress: renderCompletionCell(epicRows),
            }, {
              workItem: { kind: "lock" },
              team: { kind: "edit", onEdit: () => beginEpicTeamEdit({ id: epicId, team: epicModelForRow?.team ?? epicRows[0]?.teamId ?? null }) },
              assignee: { kind: "edit", onEdit: () => setEditingParentAssignee({ kind: "epic", id: epicId, value: epicAssignee === "Unassigned" ? "" : epicAssignee }) },
              year: { kind: "lock" },
              quarter: { kind: "lock" },
              month: { kind: "lock" },
              startDate: {
                kind: "edit",
                onEdit: () =>
                  beginEpicDateEdit(
                    epicId,
                    "start",
                    Number(epicRows[0]?.initiativeYear),
                    epicModelForRow?.planStartMonth ?? null,
                    epicModelForRow?.planStartDay ?? null,
                  ),
              },
              endDate: {
                kind: "edit",
                onEdit: () =>
                  beginEpicDateEdit(
                    epicId,
                    "end",
                    Number(epicRows[0]?.initiativeYear),
                    epicModelForRow?.planEndMonth ?? null,
                    epicModelForRow?.planEndDay ?? null,
                  ),
              },
              status: { kind: "lock" },
              sprint: { kind: "lock" },
              labels: { kind: "edit", onEdit: () => beginEpicLabelsEdit({ id: epicId, labels: epicModelForRow?.labels ?? null }) },
              estDays: { kind: "lock" },
              epicOriginalEst: { kind: "lock" },
              daysLeft: { kind: "lock" },
              progress: { kind: "lock" },
            })}
          </div>
          {createSelection?.anchorKey === `group-epic:${epicId}` ? (
            <form onSubmit={handleCreateSubmit} className={cn("grid min-w-full w-max items-center gap-3 bg-slate-50 py-2")} style={{ gridTemplateColumns: tableGridTemplate }}>
              <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: epicIndentPx + 18 }}>
                <input
                  value={createDraftTitle}
                  onChange={(event) => setCreateDraftTitle(event.target.value)}
                  placeholder="Type user story title and press Enter..."
                  className="h-9 w-full rounded-md bg-white px-2.5 text-[16px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2" style={createFormRestGridStyle}>
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
      const initModelForRow = initiativeById.get(initiativeId);
      const initGanttRange = initModelForRow ? ganttDateRangeForInitiative(initModelForRow) : { start: null as Date | null, end: null as Date | null };
      return (
        <div key={folderId}>
          <div
            className={cn("group grid min-w-full w-max items-center gap-2 border-b border-slate-200/80 py-1.5 hover:!bg-indigo-50/40")}
            style={{
              gridTemplateColumns: tableGridTemplate,
            }}
            data-backlog-zebra-row="true"
            data-backlog-zebra-kind="initiative"
            data-backlog-zebra-label={initiativeTitle}
          >
            {renderBacklogCells({
              workItem: (
                <div className="relative flex min-w-0 items-center gap-2" style={{ paddingLeft: initIndentPx }}>
                  <BacklogTreeConnector indentPx={initIndentPx} />
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
                    onClick={() => { if (editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiativeId) return; onOpenInitiative(initiativeId); }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Zap className="size-4 shrink-0 text-blue-600" strokeWidth={1.9} />
                    {editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiativeId ? (
                      <span className="flex min-w-0 items-center gap-1">
                        <input
                          value={editingParentTitle.value}
                          onChange={(event) => setEditingParentTitle({ kind: "initiative", id: initiativeId, value: event.target.value })}
                          className="h-7 min-w-[180px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                          autoFocus
                        />
                        <button type="button" onClick={() => setEditingParentTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                        <button type="button" onClick={() => void confirmParentTitleEdit("initiative", initiativeId, initiativeTitle)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                      </span>
                    ) : (
                      <span className="inline-flex w-full min-w-0 items-center gap-1 text-[16px] font-medium text-slate-900">
                        <span className="truncate">{initiativeTitle}</span>
                        <span
                          className="ml-auto opacity-0 transition group-hover/workitem:opacity-100 focus-within:opacity-100"
                          onMouseDown={(event) => event.stopPropagation()}
                        >
                          <EditRowIconButton
                            label="Edit initiative title"
                            onClick={() => setEditingParentTitle({ kind: "initiative", id: initiativeId, value: initiativeTitle })}
                          />
                        </span>
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
                </div>
              ),
              team: isEditingParentTeam("initiative", initiativeId) ? (
                renderParentTeamEditor({ kind: "initiative", id: initiativeId })
              ) : (
                renderBacklogTeamCell(initModelForRow?.team ?? (initModelForRow ? aggregateInitiativeTeamId(initModelForRow) : null))
              ),
              year: <span className="text-center text-[16px] text-slate-700">{initiativeYear}</span>,
              quarter: <span className="text-center text-[16px] text-slate-700">{quarterLabelOrUnscheduled(initiativeQuarterLabel)}</span>,
              month: <span className="text-center text-[16px] text-slate-700">{initiativeMonthLabel}</span>,
              startDate: isEditingParentDate("initiative", initiativeId, "start") ? (
                renderParentDateEditor({ kind: "initiative", id: initiativeId, field: "start" })
              ) : (
                <button
                  type="button"
                  onClick={() => {}}
                  className={backlogReadonlyInitiativeDateButtonClass}
                >
                  {formatBacklogPlanDate(initGanttRange.start)}
                </button>
              ),
              endDate: isEditingParentDate("initiative", initiativeId, "end") ? (
                renderParentDateEditor({ kind: "initiative", id: initiativeId, field: "end" })
              ) : (
                <button
                  type="button"
                  onClick={() => {}}
                  className={backlogReadonlyInitiativeDateButtonClass}
                >
                  {formatBacklogPlanDate(initGanttRange.end)}
                </button>
              ),
              status: (
                <span className={cn("inline-flex min-w-[104px] items-center justify-center gap-1.5 justify-self-center rounded-full px-3 py-[3px] text-[13px] font-semibold tracking-wide", statusChip(initiativeStatus))}>
                  {statusIcon(initiativeStatus)}
                  {workflowStatusLabel(initiativeStatus)}
                </span>
              ),
              sprint: <span className="text-center text-[16px] text-slate-500">-</span>,
              assignee: (
                <span className="text-center text-[16px] text-slate-700">
                  {editingParentAssignee?.kind === "initiative" && editingParentAssignee.id === initiativeId ? (
                    <span className="inline-flex items-center gap-1">
                      <AssigneeCombobox
                        value={editingParentAssignee.value}
                        onChange={(v) => setEditingParentAssignee((prev) => (prev ? { ...prev, value: v } : prev))}
                        suggestions={assigneeNameSuggestions}
                        placeholder="Unassigned"
                        className="h-7 w-full min-w-[104px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setEditingParentAssignee(null);
                          }
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void confirmParentAssigneeEdit(
                              "initiative",
                              initiativeId,
                              initiativeAssignee === "Unassigned" ? null : initiativeAssignee,
                            );
                          }
                        }}
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
                      className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-100"
                    >
                      <UserRound className="size-3.5 text-slate-400" aria-hidden />
                      {initiativeAssignee}
                    </button>
                  )}
                </span>
              ),
              labels: isEditingParentLabels("initiative", initiativeId) ? (
                renderParentLabelsEditor({ kind: "initiative", id: initiativeId })
              ) : (
                <span className="truncate text-[14px] text-slate-700">{initModelForRow?.labels ?? ""}</span>
              ),
              estDays: (
                <button
                  type="button"
                  onClick={() => {}}
                  className={backlogReadonlyAutoSumButtonClass}
                >
                  Σ {estimated}d
                </button>
              ),
              epicOriginalEst: <span className="text-center text-[16px] text-slate-400">-</span>,
              daysLeft: (
                <button
                  type="button"
                  onClick={() => {}}
                  className={backlogReadonlyAutoSumButtonClass}
                >
                  Σ {left}d
                </button>
              ),
              progress: renderCompletionCell(initiativeRows),
            }, {
              workItem: { kind: "lock" },
              team: { kind: "edit", onEdit: () => beginInitiativeTeamEdit({ id: initiativeId, team: initModelForRow?.team ?? null }) },
              assignee: { kind: "edit", onEdit: () => setEditingParentAssignee({ kind: "initiative", id: initiativeId, value: initiativeAssignee === "Unassigned" ? "" : initiativeAssignee }) },
              year: { kind: "lock" },
              quarter: { kind: "lock" },
              month: { kind: "lock" },
              startDate: {
                kind: "edit",
                onEdit: () =>
                  beginInitiativeDateEdit(
                    initiativeId,
                    "start",
                    Number(initiativeYear),
                    initModelForRow?.startMonth ?? null,
                  ),
              },
              endDate: {
                kind: "edit",
                onEdit: () =>
                  beginInitiativeDateEdit(
                    initiativeId,
                    "end",
                    Number(initiativeYear),
                    initModelForRow?.endMonth ?? null,
                  ),
              },
              status: { kind: "lock" },
              sprint: { kind: "lock" },
              labels: { kind: "edit", onEdit: () => beginInitiativeLabelsEdit({ id: initiativeId, labels: initModelForRow?.labels ?? null }) },
              estDays: { kind: "lock" },
              epicOriginalEst: { kind: "lock" },
              daysLeft: { kind: "lock" },
              progress: { kind: "lock" },
            })}
          </div>
          {createSelection?.anchorKey === `group-initiative:${initiativeId}` ? (
            <form onSubmit={handleCreateSubmit} className={cn("grid min-w-full w-max items-center gap-3 bg-slate-50 py-2")} style={{ gridTemplateColumns: tableGridTemplate }}>
              <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: initIndentPx + 18 }}>
                <input
                  value={createDraftTitle}
                  onChange={(event) => setCreateDraftTitle(event.target.value)}
                  placeholder={createSelection.kind === "epic" ? "Type epic title and press Enter..." : "Type user story title and press Enter..."}
                  className="h-9 w-full rounded-md bg-white px-2.5 text-[16px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2" style={createFormRestGridStyle}>
                {createSelection.kind === "story" ? (
                  <select
                    value={storyTargetEpicId}
                    onChange={(event) => setStoryTargetEpicId(event.target.value)}
                    className="h-8 min-w-[180px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
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
            <div className="relative bg-slate-50/50"><div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-slate-300/70" aria-hidden />
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

  function renderGroupedTree(
    rows: typeof groupedStoryRows,
    standaloneRows: typeof groupedStandaloneInitiatives = [],
    levelIndex = 0,
    path = "",
  ): React.ReactNode {
    if (levelIndex >= groupLevels.length) {
      return (
        <>
          {renderLeafRows(rows, levelIndex * 14, path)}
          {standaloneRows.length > 0 ? renderStandaloneInitiativeRows(standaloneRows, levelIndex * 14) : null}
        </>
      );
    }
    const level = groupLevels[levelIndex];
    type Bucket = {
      label: string;
      sort: string;
      rows: typeof groupedStoryRows;
      standaloneRows: typeof groupedStandaloneInitiatives;
    };
    const groups = new Map<string, Bucket>();
    for (const row of rows) {
      const { key, label, sort } = keyForLevel(row, level);
      if (!groups.has(key)) groups.set(key, { label, sort, rows: [], standaloneRows: [] });
      groups.get(key)!.rows.push(row);
    }
    for (const row of standaloneRows) {
      const { key, label, sort } = keyForStandaloneLevel(row, level);
      if (!groups.has(key)) groups.set(key, { label, sort, rows: [], standaloneRows: [] });
      groups.get(key)!.standaloneRows.push(row);
    }
    return Array.from(groups.entries())
      .sort((a, b) => a[1].sort.localeCompare(b[1].sort))
      .map(([key, group]) =>
        renderFolderRow(
          `${path}${level}:${key}`,
          group.label,
          group.rows.length + group.standaloneRows.length,
          levelIndex * 14,
          () => <>{renderGroupedTree(group.rows, group.standaloneRows, levelIndex + 1, `${path}${level}:${key}/`)}</>,
          level === "roadmap"
            ? <MapIcon className="size-4 shrink-0 text-indigo-500" aria-hidden />
            : undefined,
        ),
      );
  }

  function renderStandaloneInitiativeRows(rows: typeof groupedStandaloneInitiatives, indentPx: number): React.ReactNode {
    return rows
      .slice()
      .sort((a, b) => a.initiativeTitle.localeCompare(b.initiativeTitle))
      .map((initiative) => {
        const initFolderId = `standalone-init:${initiative.initiativeId}`;
        const isInitOpen = openGroupFolders[initFolderId] ?? defaultGroupExpanded;
        const standInitModel = initiativeById.get(initiative.initiativeId);
        const standInitGantt = standInitModel ? ganttDateRangeForInitiative(standInitModel) : { start: null, end: null };
        return (
              <div key={initFolderId}>
                <div
                  className={cn("group grid min-w-full w-max items-center gap-2 border-b border-slate-200/80 py-1.5 hover:!bg-indigo-50/40")}
                  style={{
                    gridTemplateColumns: tableGridTemplate,
                  }}
                  data-backlog-zebra-row="true"
                  data-backlog-zebra-kind="initiative"
                  data-backlog-zebra-label={initiative.initiativeTitle}
                >
              {renderBacklogCells({
                workItem: (
                  <div className="relative flex min-w-0 items-center gap-2" style={{ paddingLeft: indentPx }}>
                    <BacklogTreeConnector indentPx={indentPx} />
                    <button
                      type="button"
                      onClick={() => setOpenGroupFolders((prev) => ({ ...prev, [initFolderId]: !isInitOpen }))}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-slate-100"
                      aria-label={isInitOpen ? "Collapse initiative" : "Expand initiative"}
                    >
                      {isInitOpen ? <ChevronDown className="size-4 shrink-0 text-slate-500" /> : <ChevronRight className="size-4 shrink-0 text-slate-500" />}
                    </button>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => { if (editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiative.initiativeId) return; onOpenInitiative(initiative.initiativeId); }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiative.initiativeId) return;
                          onOpenInitiative(initiative.initiativeId);
                        }
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <Zap className="size-4 shrink-0 text-blue-600" strokeWidth={1.9} />
                      {editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiative.initiativeId ? (
                        <span className="flex min-w-0 items-center gap-1">
                          <input
                            value={editingParentTitle.value}
                            onChange={(event) => setEditingParentTitle({ kind: "initiative", id: initiative.initiativeId, value: event.target.value })}
                            className="h-7 min-w-[180px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                            autoFocus
                          />
                          <button type="button" onClick={() => setEditingParentTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                          <button type="button" onClick={() => void confirmParentTitleEdit("initiative", initiative.initiativeId, initiative.initiativeTitle)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                        </span>
                      ) : (
                        <span className="inline-flex w-full min-w-0 items-center gap-1 text-[16px] font-medium text-slate-900">
                          <span className="truncate">{initiative.initiativeTitle}</span>
                          <span
                            className="ml-auto opacity-0 transition group-hover/workitem:opacity-100 focus-within:opacity-100"
                            onMouseDown={(event) => event.stopPropagation()}
                          >
                            <EditRowIconButton
                              label="Edit initiative title"
                              onClick={() =>
                                setEditingParentTitle({
                                  kind: "initiative",
                                  id: initiative.initiativeId,
                                  value: initiative.initiativeTitle,
                                })
                              }
                            />
                          </span>
                        </span>
                      )}
                    </div>
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
                  </div>
                ),
                team: isEditingParentTeam("initiative", initiative.initiativeId) ? (
                  renderParentTeamEditor({ kind: "initiative", id: initiative.initiativeId })
                ) : (
                  renderBacklogTeamCell(standInitModel?.team ?? initiative.initiativeTeamId)
                ),
                year: <span className="text-center text-[16px] text-slate-700">{initiative.initiativeYear}</span>,
                quarter: <span className="text-center text-[16px] text-slate-700">{quarterLabelOrUnscheduled(initiative.initiativeQuarterLabelValue)}</span>,
                month: <span className="text-center text-[16px] text-slate-700">{initiative.initiativeMonthLabelValue}</span>,
                startDate: isEditingParentDate("initiative", initiative.initiativeId, "start") ? (
                  renderParentDateEditor({ kind: "initiative", id: initiative.initiativeId, field: "start" })
                ) : (
                  <button
                    type="button"
                    onClick={() => {}}
                    className={backlogReadonlyInitiativeDateButtonClass}
                  >
                    {formatBacklogPlanDate(standInitGantt.start)}
                  </button>
                ),
                endDate: isEditingParentDate("initiative", initiative.initiativeId, "end") ? (
                  renderParentDateEditor({ kind: "initiative", id: initiative.initiativeId, field: "end" })
                ) : (
                  <button
                    type="button"
                    onClick={() => {}}
                    className={backlogReadonlyInitiativeDateButtonClass}
                  >
                    {formatBacklogPlanDate(standInitGantt.end)}
                  </button>
                ),
                status: (
                  <span className={cn("inline-flex min-w-[104px] items-center justify-center gap-1.5 justify-self-center rounded-full px-3 py-[3px] text-[13px] font-semibold tracking-wide", statusChip(initiative.initiativeStatus))}>
                    {statusIcon(initiative.initiativeStatus)}
                    {workflowStatusLabel(initiative.initiativeStatus)}
                  </span>
                ),
                sprint: <span className="text-center text-[16px] text-slate-500">-</span>,
                assignee: (
                  <span className="inline-flex items-center justify-center gap-1.5 text-center text-[16px] text-slate-700">
                    <UserRound className="size-3.5 text-slate-400" aria-hidden />
                    {initiative.initiativeAssignee}
                  </span>
                ),
                labels: isEditingParentLabels("initiative", initiative.initiativeId) ? (
                  renderParentLabelsEditor({ kind: "initiative", id: initiative.initiativeId })
                ) : (
                  <span className="truncate text-[14px] text-slate-700">{standInitModel?.labels ?? ""}</span>
                ),
                estDays: (
                  <button
                    type="button"
                    onClick={() => {}}
                    className={backlogReadonlyAutoSumButtonClass}
                  >
                    Σ 0d
                  </button>
                ),
                epicOriginalEst: <span className="text-center text-[16px] text-slate-400">-</span>,
                daysLeft: (
                  <button
                    type="button"
                    onClick={() => {}}
                    className={backlogReadonlyAutoSumButtonClass}
                  >
                    Σ 0d
                  </button>
                ),
                progress: (
                  <button
                    type="button"
                    onClick={() => {}}
                    className={backlogReadonlyProgressButtonClass}
                  >
                    <div className="flex items-center justify-between text-[13px] tabular-nums text-slate-600">
                      <span>No stories</span>
                      <span>0/0 · 0%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" />
                  </button>
                ),
              }, {
                workItem: { kind: "lock" },
                team: { kind: "edit", onEdit: () => beginInitiativeTeamEdit({ id: initiative.initiativeId, team: standInitModel?.team ?? null }) },
                year: { kind: "lock" },
                quarter: { kind: "lock" },
                month: { kind: "lock" },
                startDate: {
                  kind: "edit",
                  onEdit: () =>
                    beginInitiativeDateEdit(
                      initiative.initiativeId,
                      "start",
                      Number(initiative.initiativeYear),
                      standInitModel?.startMonth ?? null,
                    ),
                },
                endDate: {
                  kind: "edit",
                  onEdit: () =>
                    beginInitiativeDateEdit(
                      initiative.initiativeId,
                      "end",
                      Number(initiative.initiativeYear),
                      standInitModel?.endMonth ?? null,
                    ),
                },
                status: { kind: "lock" },
                sprint: { kind: "lock" },
                assignee: { kind: "lock" },
                labels: { kind: "edit", onEdit: () => beginInitiativeLabelsEdit({ id: initiative.initiativeId, labels: standInitModel?.labels ?? null }) },
                estDays: { kind: "lock" },
                epicOriginalEst: { kind: "lock" },
                daysLeft: { kind: "lock" },
                progress: { kind: "lock" },
              } as Partial<Record<BacklogColumnKey, CellIconHint>>)}
            </div>
            {createSelection?.anchorKey === `group-standalone-initiative:${initiative.initiativeId}` ? (
              <form onSubmit={handleCreateSubmit} className={cn("grid min-w-full w-max items-center gap-3 bg-slate-50 py-2")} style={{ gridTemplateColumns: tableGridTemplate }}>
                <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: indentPx + 18 }}>
                  <input
                    value={createDraftTitle}
                    onChange={(event) => setCreateDraftTitle(event.target.value)}
                    placeholder={createSelection.kind === "epic" ? "Type epic title and press Enter..." : "Type user story title and press Enter..."}
                    className="h-9 w-full rounded-md bg-white px-2.5 text-[16px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                    autoFocus
                  />
                </div>
                <div className="flex items-center gap-2" style={createFormRestGridStyle}>
                  <button type="submit" disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-45"><Plus className="size-3.5" /></button>
                  <button type="button" onClick={closeInlineCreator} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"><X className="size-3.5" /></button>
                </div>
              </form>
            ) : null}
            {isInitOpen ? (
              <div className="relative bg-slate-50/50"><div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-slate-300/70" aria-hidden />
                {initiative.epics.map((epic) => {
                  const standEpicModel = standInitModel?.epics?.find((e) => e.id === epic.epicId);
                  const standPlanYear = Number(initiative.initiativeYear);
                  const standEpicGantt =
                    standEpicModel && Number.isFinite(standPlanYear)
                      ? ganttDateRangeForEpic(standEpicModel, standPlanYear)
                      : { start: null as Date | null, end: null as Date | null };
                  return (
                  <div key={`standalone-epic:${epic.epicId}`}>
                    <div
                      className={cn("group grid min-w-full w-max items-center gap-2 border-b border-slate-200/80 py-1.5 hover:!bg-indigo-50/40")}
                      style={{
                        gridTemplateColumns: tableGridTemplate,
                      }}
                    data-backlog-zebra-row="true"
                    data-backlog-zebra-kind="epic"
                    data-backlog-zebra-label={epic.epicTitle}
                    >
                      {renderBacklogCells({
                        workItem: (
                          <div className="relative flex min-w-0 items-center gap-2" style={{ paddingLeft: indentPx + 34 }}>
                            <BacklogTreeConnector indentPx={indentPx + 34} />
                            <span className="inline-block h-7 w-7 shrink-0" />
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => { if (editingParentTitle?.kind === "epic" && editingParentTitle.id === epic.epicId) return; onOpenEpic(epic.epicId); }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  if (editingParentTitle?.kind === "epic" && editingParentTitle.id === epic.epicId) return;
                                  onOpenEpic(epic.epicId);
                                }
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <EpicPlanBarIcon icon={standEpicModel?.icon} className="mr-0 text-slate-400 [&_svg]:size-4" />
                              {editingParentTitle?.kind === "epic" && editingParentTitle.id === epic.epicId ? (
                                <span className="flex min-w-0 items-center gap-1">
                                  <input
                                    value={editingParentTitle.value}
                                    onChange={(event) => setEditingParentTitle({ kind: "epic", id: epic.epicId, value: event.target.value })}
                                    className="h-7 min-w-[180px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                                    autoFocus
                                  />
                                  <button type="button" onClick={() => setEditingParentTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                  <button type="button" onClick={() => void confirmParentTitleEdit("epic", epic.epicId, epic.epicTitle)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                                </span>
                              ) : (
                                <span className="inline-flex w-full min-w-0 items-center gap-1 text-[16px] font-medium text-slate-900">
                                  <span className="truncate">{epic.epicTitle}</span>
                                  <span
                                    className="ml-auto opacity-0 transition group-hover/workitem:opacity-100 focus-within:opacity-100"
                                    onMouseDown={(event) => event.stopPropagation()}
                                  >
                                    <EditRowIconButton
                                      label="Edit epic title"
                                      onClick={() =>
                                        setEditingParentTitle({ kind: "epic", id: epic.epicId, value: epic.epicTitle })
                                      }
                                    />
                                  </span>
                                </span>
                              )}
                            </div>
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
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 ring-1 ring-slate-200 transition hover:bg-white hover:text-slate-900 group-hover/workitem:opacity-100 focus-visible:opacity-100"
                              title="Add user story"
                            >
                              <Plus className="size-3.5 text-slate-600" />
                            </button>
                          </div>
                        ),
                        team: isEditingParentTeam("epic", epic.epicId) ? (
                          renderParentTeamEditor({ kind: "epic", id: epic.epicId })
                        ) : (
                          renderBacklogTeamCell(standEpicModel?.team ?? epic.epicTeamId)
                        ),
                        year: <span className="text-center text-[16px] text-slate-700">{initiative.initiativeYear}</span>,
                        quarter: <span className="text-center text-[16px] text-slate-700">{quarterLabelOrUnscheduled(epic.epicQuarterLabelValue)}</span>,
                        month: <span className="text-center text-[16px] text-slate-700">{epic.epicMonthLabelValue}</span>,
                        startDate: (
                          <span className="text-center text-[14px] tabular-nums text-slate-700">
                            {isEditingParentDate("epic", epic.epicId, "start") ? (
                              renderParentDateEditor({ kind: "epic", id: epic.epicId, field: "start" })
                            ) : (
                              formatBacklogPlanDate(standEpicGantt.start)
                            )}
                          </span>
                        ),
                        endDate: (
                          <span className="text-center text-[14px] tabular-nums text-slate-700">
                            {isEditingParentDate("epic", epic.epicId, "end") ? (
                              renderParentDateEditor({ kind: "epic", id: epic.epicId, field: "end" })
                            ) : (
                              formatBacklogPlanDate(standEpicGantt.end)
                            )}
                          </span>
                        ),
                        status: (
                          <span className={cn("inline-flex min-w-[104px] items-center justify-center gap-1.5 justify-self-center rounded-full px-3 py-[3px] text-[13px] font-semibold tracking-wide", statusChip("todo"))}>
                            {statusIcon("todo")}
                            To do
                          </span>
                        ),
                        sprint: <span className="text-center text-[16px] text-slate-500">-</span>,
                        assignee: (
                          <span className="inline-flex items-center justify-center gap-1.5 text-center text-[16px] text-slate-700">
                            <UserRound className="size-3.5 text-slate-400" aria-hidden />
                            {epic.epicAssignee}
                          </span>
                        ),
                        labels: isEditingParentLabels("epic", epic.epicId) ? (
                          renderParentLabelsEditor({ kind: "epic", id: epic.epicId })
                        ) : (
                          <span className="truncate text-[14px] text-slate-700">{standEpicModel?.labels ?? ""}</span>
                        ),
                        estDays: (
                          <button
                            type="button"
                            onClick={() => {}}
                            className={backlogReadonlyAutoSumButtonClass}
                          >
                            Σ 0d
                          </button>
                        ),
                        epicOriginalEst: (
                          <span className="text-center text-[16px] font-medium text-slate-600">
                            {epic.epicOriginalEstimateDays}d
                          </span>
                        ),
                        daysLeft: (
                          <button
                            type="button"
                            onClick={() => {}}
                            className={backlogReadonlyAutoSumButtonClass}
                          >
                            Σ 0d
                          </button>
                        ),
                        progress: (
                          <button
                            type="button"
                            onClick={() => {}}
                            className={backlogReadonlyProgressButtonClass}
                          >
                            <div className="flex items-center justify-between text-[13px] tabular-nums text-slate-600">
                              <span>No stories</span>
                              <span>0/0 · 0%</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" />
                          </button>
                        ),
                      }, {
                        workItem: { kind: "lock" },
                        team: { kind: "edit", onEdit: () => beginEpicTeamEdit({ id: epic.epicId, team: standEpicModel?.team ?? epic.epicTeamId ?? null }) },
                        year: { kind: "lock" },
                        quarter: { kind: "lock" },
                        month: { kind: "lock" },
                        startDate: {
                          kind: "edit",
                          onEdit: () =>
                            beginEpicDateEdit(
                              epic.epicId,
                              "start",
                              Number(initiative.initiativeYear),
                              standEpicModel?.planStartMonth ?? null,
                              standEpicModel?.planStartDay ?? null,
                            ),
                        },
                        endDate: {
                          kind: "edit",
                          onEdit: () =>
                            beginEpicDateEdit(
                              epic.epicId,
                              "end",
                              Number(initiative.initiativeYear),
                              standEpicModel?.planEndMonth ?? null,
                              standEpicModel?.planEndDay ?? null,
                            ),
                        },
                        status: { kind: "lock" },
                        sprint: { kind: "lock" },
                        assignee: { kind: "lock" },
                        labels: { kind: "edit", onEdit: () => beginEpicLabelsEdit({ id: epic.epicId, labels: standEpicModel?.labels ?? null }) },
                        estDays: { kind: "lock" },
                        epicOriginalEst: { kind: "lock" },
                        daysLeft: { kind: "lock" },
                        progress: { kind: "lock" },
                      })}
                    </div>
                    {createSelection?.anchorKey === `group-standalone-epic:${epic.epicId}` ? (
                      <form onSubmit={handleCreateSubmit} className={cn("grid min-w-full w-max items-center gap-3 bg-slate-50 py-2")} style={{ gridTemplateColumns: tableGridTemplate }}>
                        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: indentPx + 52 }}>
                          <input
                            value={createDraftTitle}
                            onChange={(event) => setCreateDraftTitle(event.target.value)}
                            placeholder="Type user story title and press Enter..."
                            className="h-9 w-full rounded-md bg-white px-2.5 text-[16px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                            autoFocus
                          />
                        </div>
                        <div className="flex items-center gap-2" style={createFormRestGridStyle}>
                          <button type="submit" disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-45"><Plus className="size-3.5" /></button>
                          <button type="button" onClick={closeInlineCreator} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"><X className="size-3.5" /></button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                  );
                })}
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
        renderFolderRow(
          `${path}${level}:${key}`,
          group.label,
          group.rows.length,
          levelIndex * 14,
          (
            () => <>{renderStandaloneGroupedTree(group.rows, levelIndex + 1, `${path}${level}:${key}/`)}</>
          ),
        ),
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
        statusFilter?: unknown;
        sprintFilter?: unknown;
        yearFilter?: unknown;
        quarterFilter?: unknown;
        teamFilter?: unknown;
        assigneeFilter?: unknown;
        labelFilter?: unknown;
        roadmapFilter?: unknown;
        groupLevels?: unknown;
      };
      if (Array.isArray(parsed.statusFilter)) setStatusFilter(parsed.statusFilter.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(parsed.sprintFilter)) setSprintFilter(parsed.sprintFilter.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(parsed.yearFilter)) setYearFilter(parsed.yearFilter.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(parsed.quarterFilter))
        setQuarterFilter(parsed.quarterFilter.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(parsed.teamFilter))
        setTeamFilter(
          parsed.teamFilter.filter(
            (v): v is string => typeof v === "string" && MONTH_TEAM_COLUMNS.some((c) => c.id === v),
          ),
        );
      if (Array.isArray(parsed.assigneeFilter))
        setAssigneeFilter(parsed.assigneeFilter.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(parsed.labelFilter))
        setLabelFilter(parsed.labelFilter.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(parsed.roadmapFilter))
        setRoadmapFilter(parsed.roadmapFilter.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(parsed.groupLevels)) {
        const validLevels = parsed.groupLevels.filter(isGroupLevelValue);
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
          statusFilter,
          sprintFilter,
          yearFilter,
          quarterFilter,
          teamFilter,
          assigneeFilter,
          labelFilter,
          roadmapFilter,
          groupLevels,
        }),
      );
    } catch {
      // Ignore write failures (private mode, quotas, etc.)
    }
  }, [hasLoadedViewState, statusFilter, sprintFilter, yearFilter, quarterFilter, teamFilter, assigneeFilter, labelFilter, roadmapFilter, groupLevels]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BACKLOG_SAVED_FILTERS_STORAGE_KEY);
      if (raw) setSavedFilterPresets(parseSavedBacklogFilterPresetsJson(JSON.parse(raw)));
    } catch {
      // Ignore corrupt localStorage entries.
    }
    setSavedFilterPresetsLoaded(true);
  }, []);

  useEffect(() => {
    if (!savedFilterPresetsLoaded) return;
    try {
      window.localStorage.setItem(BACKLOG_SAVED_FILTERS_STORAGE_KEY, JSON.stringify(savedFilterPresets));
    } catch {
      // Ignore write failures (private mode, quotas, etc.)
    }
  }, [savedFilterPresetsLoaded, savedFilterPresets]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BACKLOG_SAVED_VIEWS_STORAGE_KEY);
      if (raw) setSavedViewPresets(parseSavedBacklogViewPresetsJson(JSON.parse(raw)));
    } catch {
      // Ignore corrupt localStorage entries.
    }
    setSavedViewPresetsLoaded(true);
  }, []);

  useEffect(() => {
    if (!savedViewPresetsLoaded) return;
    try {
      window.localStorage.setItem(BACKLOG_SAVED_VIEWS_STORAGE_KEY, JSON.stringify(savedViewPresets));
    } catch {
      // Ignore write failures (private mode, quotas, etc.)
    }
  }, [savedViewPresetsLoaded, savedViewPresets]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!groupMenuRef.current?.contains(target)) setGroupMenuOpen(false);
      if (!savedFilterMenuRef.current?.contains(target)) setPresetMenuOpen(false);
      if (!savedViewMenuRef.current?.contains(target)) setViewPresetMenuOpen(false);
      if (!columnsMenuRef.current?.contains(target) && !columnsMenuPanelRef.current?.contains(target)) {
        setColumnsMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  const COLUMNS_MENU_PANEL_WIDTH_PX = 256;

  useLayoutEffect(() => {
    if (!columnsMenuOpen) {
      setColumnsMenuFixedPosition(null);
      return;
    }

    function updatePosition() {
      const anchor = columnsMenuRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const panelMaxPx = Math.min(window.innerHeight * 0.7, 26 * 16);
      let left = rect.left;
      left = Math.max(margin, Math.min(left, window.innerWidth - COLUMNS_MENU_PANEL_WIDTH_PX - margin));
      let top = rect.bottom + 4;
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      if (spaceBelow < Math.min(160, panelMaxPx * 0.4) && spaceAbove > spaceBelow) {
        top = Math.max(margin, rect.top - panelMaxPx - 4);
      }
      setColumnsMenuFixedPosition({ top, left });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [columnsMenuOpen]);

  useEffect(() => {
    if (!saveAsFilterDialogOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSaveAsFilterDialogOpen(false);
        setSaveAsFilterName("");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveAsFilterDialogOpen]);

  useEffect(() => {
    if (!saveAsFilterDialogOpen) return;
    const id = window.requestAnimationFrame(() => {
      saveAsFilterNameInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [saveAsFilterDialogOpen]);

  useEffect(() => {
    if (!saveViewDialogOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSaveViewDialogOpen(false);
        setSaveViewName("");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveViewDialogOpen]);

  useEffect(() => {
    if (!saveViewDialogOpen) return;
    const id = window.requestAnimationFrame(() => {
      saveViewNameInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [saveViewDialogOpen]);

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
      const raw = window.localStorage.getItem(BACKLOG_TABLE_LAYOUT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          columnVisibility?: Partial<Record<BacklogColumnKey, boolean>>;
          columnOrder?: unknown;
          showTableHeaderRow?: unknown;
          defaultsVersion?: unknown;
        };
        const storedDefaultsVersion =
          typeof parsed.defaultsVersion === "number" && Number.isFinite(parsed.defaultsVersion)
            ? parsed.defaultsVersion
            : 0;
        // When defaults bump (new column added, order changed, visibility tweaked), discard the saved layout
        // entirely so the user picks up the new defaults. The save effect below will re-persist with the new
        // defaultsVersion on the next render.
        const needsReset = storedDefaultsVersion < BACKLOG_TABLE_LAYOUT_DEFAULTS_VERSION;
        if (!needsReset) {
          if (parsed.columnVisibility && typeof parsed.columnVisibility === "object") {
            setColumnVisibility(() => {
              // Start from defaults; merge saved booleans so new columns get default visibility until saved.
              const next = { ...DEFAULT_BACKLOG_COLUMN_VISIBILITY };
              for (const key of BACKLOG_COLUMN_ORDER) {
                const v = parsed.columnVisibility![key];
                if (typeof v === "boolean") next[key] = v;
              }
              next.workItem = true;
              return next;
            });
          }
          setColumnOrder(normalizeColumnOrder(parsed.columnOrder));
        }
        if (typeof parsed.showTableHeaderRow === "boolean") setShowTableHeaderRow(parsed.showTableHeaderRow);
      }
    } catch {
      // Ignore corrupt localStorage entries.
    } finally {
      setHasLoadedTableLayout(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedTableLayout) return;
    try {
      window.localStorage.setItem(
        BACKLOG_TABLE_LAYOUT_STORAGE_KEY,
        JSON.stringify({
          columnVisibility,
          columnOrder,
          showTableHeaderRow,
          defaultsVersion: BACKLOG_TABLE_LAYOUT_DEFAULTS_VERSION,
        }),
      );
    } catch {
      // Ignore write failures (private mode, quotas, etc.)
    }
  }, [hasLoadedTableLayout, columnVisibility, columnOrder, showTableHeaderRow]);

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

  const summaryChipsJsx = (
    <>
      <button
        type="button"
        onClick={() => toggleWorkItemBadgeFilter("initiative")}
        aria-pressed={workItemFilter.length === 1 && workItemFilter[0] === "initiative"}
        title="Show only initiatives in the table (click again for all work items)"
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold leading-none tracking-wide ring-1 transition",
          workItemFilter.length === 1 && workItemFilter[0] === "initiative"
            ? "bg-gradient-to-br from-indigo-100 via-indigo-200 to-indigo-200 text-indigo-950 ring-indigo-300/75 shadow-sm"
            : "bg-gradient-to-br from-indigo-50 via-indigo-100 to-indigo-100 text-indigo-950 ring-indigo-200/75 hover:from-indigo-100 hover:via-indigo-200 hover:to-indigo-200",
        )}
      >
        {summaryInitiativeCount} Initiatives
      </button>
      <button
        type="button"
        onClick={() => toggleWorkItemBadgeFilter("epic")}
        aria-pressed={workItemFilter.length === 1 && workItemFilter[0] === "epic"}
        title="Show only epics in the table (click again for all work items)"
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold leading-none tracking-wide ring-1 transition",
          workItemFilter.length === 1 && workItemFilter[0] === "epic"
            ? "bg-gradient-to-br from-yellow-100 via-yellow-200 to-yellow-200 text-yellow-950 ring-yellow-300/75 shadow-sm"
            : "bg-gradient-to-br from-yellow-50 via-yellow-100 to-yellow-100 text-yellow-950 ring-yellow-200/75 hover:from-yellow-100 hover:via-yellow-200 hover:to-yellow-200",
        )}
      >
        {summaryEpicCount} Epics
      </button>
      <button
        type="button"
        onClick={() => toggleWorkItemBadgeFilter("story")}
        aria-pressed={workItemFilter.length === 1 && workItemFilter[0] === "story"}
        title="Show only user stories in the table (click again for all work items)"
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold leading-none tracking-wide ring-1 transition",
          workItemFilter.length === 1 && workItemFilter[0] === "story"
            ? "bg-gradient-to-br from-blue-100 via-blue-200 to-blue-200 text-blue-950 ring-blue-300/75 shadow-sm"
            : "bg-gradient-to-br from-sky-50 via-blue-100 to-blue-100 text-blue-950 ring-blue-200/75 hover:from-sky-100 hover:via-blue-200 hover:to-blue-200",
        )}
      >
        {summaryStoryCount} Stories
      </button>
    </>
  );

  return (
    <section className="ml-3 flex h-full min-h-0 w-full max-w-full min-w-0 flex-1 flex-col overflow-x-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <div className="mb-6 flex shrink-0 items-center justify-between gap-3 pb-2 pt-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
            <ListTodo className="size-4.5" strokeWidth={2} aria-hidden />
          </span>
          <h2 className="text-[27px] font-bold tracking-tight text-slate-900">Backlog Workspace</h2>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {!(suppressInlineChips || summaryBarPortalElement) && (
            <div className="flex flex-wrap items-center gap-1.5">{summaryChipsJsx}</div>
          )}
          <button
            type="button"
            onClick={handleExcelExport}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 text-[13px] font-semibold text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60"
            aria-label="Export backlog to Excel"
            title="Export to Excel (preview, then download .xls)"
          >
            <FileSpreadsheet className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            <span>Export Excel</span>
          </button>
        </div>
      </div>
      {summaryBarPortalElement ? createPortal(summaryChipsJsx, summaryBarPortalElement) : null}

      <div className="relative z-20 mb-10 max-w-full shrink-0 rounded-xl bg-gradient-to-br from-blue-50 via-violet-50 to-pink-50 px-4 pb-9 pt-9 [contain:inline-size] shadow-[inset_0_2px_6px_-2px_rgba(15,23,42,0.18),inset_0_-1px_3px_-1px_rgba(15,23,42,0.10),0_1px_3px_0_rgba(148,163,184,0.20)]">
        <div
          className="grid w-full min-w-0 max-w-[140rem] items-center gap-x-5 gap-y-5"
          style={{ gridTemplateColumns: "auto auto repeat(11, minmax(0, 1fr)) auto" }}
        >
          <div className="relative col-span-14 col-start-1 row-start-1 min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search work items..."
              autoComplete="off"
              onFocus={() => setShowSearchSuggestions(true)}
              onBlur={() => {
                window.setTimeout(() => setShowSearchSuggestions(false), 120);
              }}
              className="h-9 w-full min-w-0 rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-[14px] text-slate-900 outline-none placeholder:text-slate-400 transition hover:border-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-200/80"
            />
            {showSearchSuggestions && searchSuggestions.length > 0 ? (
              <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-20 rounded-lg bg-white p-1 shadow-lg">
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
          <div
            className="relative col-start-12 row-start-2 min-w-0"
            ref={savedFilterMenuRef}
          >
            <button
              type="button"
              onClick={() => setPresetMenuOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={presetMenuOpen}
              className="flex h-[34px] w-full items-center justify-between gap-1 rounded-lg border border-slate-300 bg-white px-1.5 text-[14px] text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 sm:px-2"
            >
              <span className="inline-flex shrink-0 items-center gap-1 font-medium text-slate-500">
                <Bookmark className="size-3 shrink-0 text-indigo-400" strokeWidth={2} aria-hidden />
                <span>Filters</span>
              </span>
              <span className="ml-1 min-w-0 truncate font-normal text-slate-600">{presetSearch}</span>
              <ChevronDown className={cn("size-3 shrink-0 text-slate-400 transition-transform", presetMenuOpen && "rotate-180")} aria-hidden />
            </button>
            {presetMenuOpen && (
              <div
                id="backlog-saved-filter-listbox"
                role="listbox"
                className="absolute left-0 top-[calc(100%+0.35rem)] z-30 w-[260px] overflow-hidden rounded-none border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
              >
                {/* Save current filter -- always first */}
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 bg-slate-50 px-4 py-3 text-left text-[13px] font-semibold text-indigo-600 transition hover:bg-indigo-50"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setPresetMenuOpen(false);
                    openSaveAsFilterDialog();
                  }}
                >
                  <Plus className="size-3.5 shrink-0 text-indigo-500" aria-hidden />
                  Save current filter
                </button>
                <div className="h-px bg-slate-200" />
                {savedFilterPresets.length === 0 ? (
                  <div className="px-4 py-3 text-[12px] leading-snug text-slate-400">
                    No saved filters yet. Click "Save current filter" to store your current search and facets.
                  </div>
                ) : (
                  <div className="max-h-56 overflow-y-auto">
                    {savedFilterPresets.map((preset) => (
                      <div key={preset.id} className="flex items-center border-b border-slate-100 transition last:border-b-0 hover:bg-indigo-50/50">
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate px-4 py-2.5 text-left text-[13px] text-slate-700"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyBacklogFilterSnapshot(preset.snapshot);
                            setPresetSearch(preset.name);
                            setPresetMenuOpen(false);
                            toast.success(`Loaded filter "${preset.name}"`);
                          }}
                        >
                          {preset.name}
                        </button>
                        <button
                          type="button"
                          className="mr-3 inline-flex size-6 shrink-0 items-center justify-center rounded text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                          aria-label={`Delete saved filter ${preset.name}`}
                          title="Remove saved filter"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            deleteSavedFilterPreset(preset.id);
                          }}
                        >
                          <Trash2 className="size-3" strokeWidth={2} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="relative col-start-13 row-start-2 min-w-0" ref={savedViewMenuRef}>
            <button
              type="button"
              onClick={() => setViewPresetMenuOpen((v) => !v)}
              className="flex h-[34px] w-full items-center justify-between gap-1 rounded-lg border border-slate-300 bg-white px-1.5 text-[14px] text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 sm:px-2"
              aria-haspopup="listbox"
              aria-expanded={viewPresetMenuOpen}
            >
              <span className="inline-flex shrink-0 items-center gap-1 font-medium text-slate-500">
                <LayoutGrid className="size-3 shrink-0 text-sky-500" strokeWidth={2} aria-hidden />
                <span>Views</span>
              </span>
              <span className="ml-1 min-w-0 truncate font-normal text-slate-600">{viewPresetSearch}</span>
              <ChevronDown className={cn("size-3 shrink-0 text-slate-400 transition-transform", viewPresetMenuOpen && "rotate-180")} />
            </button>
            {viewPresetMenuOpen && (
              <div className="absolute left-0 top-[calc(100%+0.35rem)] z-30 w-[260px] overflow-hidden rounded-none border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 bg-slate-50 px-4 py-3 text-left text-[13px] font-semibold text-sky-600 transition hover:bg-sky-50"
                  onMouseDown={() => { setViewPresetMenuOpen(false); openSaveViewDialog(); }}
                >
                  <Plus className="size-3.5 shrink-0 text-sky-500" />
                  Save current view
                </button>
                <div className="h-px bg-slate-200" />
                {savedViewPresets.length === 0 ? (
                  <div className="px-4 py-3 text-[12px] text-slate-400">No saved views yet...</div>
                ) : (
                  <div className="max-h-56 overflow-y-auto">
                    {savedViewPresets.map((preset) => (
                      <div key={preset.id} className="flex items-center border-b border-slate-100 transition last:border-b-0 hover:bg-sky-50/50">
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate px-4 py-2.5 text-left text-[13px] text-slate-700"
                          onMouseDown={() => {
                            applyBacklogViewSnapshot(preset.snapshot);
                            setViewPresetSearch(preset.name);
                            setViewPresetMenuOpen(false);
                            toast.success(`Loaded view "${preset.name}"`);
                          }}
                        >
                          {preset.name}
                        </button>
                        <button
                          type="button"
                          className="mr-3 inline-flex size-6 shrink-0 items-center justify-center rounded text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                          aria-label={`Delete saved view ${preset.name}`}
                          title="Remove saved view"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            deleteSavedViewPreset(preset.id);
                          }}
                        >
                          <Trash2 className="size-3" strokeWidth={2} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="relative col-start-1 row-start-2 min-w-0" ref={groupMenuRef}>
            <button
              type="button"
              onClick={() => setGroupMenuOpen((prev) => !prev)}
              className="flex h-[34px] w-full min-w-0 items-center justify-between rounded-lg border border-slate-300 bg-gradient-to-b from-indigo-50 to-violet-50 px-2.5 text-[14px] transition hover:from-indigo-100 hover:to-violet-100 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-200/80"
            >
              <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-indigo-700">
                <Layers3 className="size-3.5 shrink-0 text-indigo-500" strokeWidth={2} aria-hidden />
                Group By
              </span>
              <span className="ml-1 min-w-0 truncate font-medium text-indigo-600/80">{groupSummaryLabel}</span>
            </button>
            {groupMenuOpen ? (
              <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg bg-white p-2 shadow-lg">
                {GROUP_LEVEL_ORDER.map((level, idx) => {
                  const checked = groupLevels.includes(level);
                  const disabled = idx > 0 && !groupLevels.includes(GROUP_LEVEL_ORDER[idx - 1]);
                  return (
                    <label key={level} className={cn("mb-1 flex items-center gap-2 rounded px-1.5 py-1 text-[14px] text-slate-700", disabled && "opacity-50")}>
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
          <div className="col-start-2 row-start-2 flex min-w-0 w-full items-center justify-center gap-1.5">
            <div className="h-5 w-px shrink-0 bg-slate-300/70" aria-hidden />
            <span className="inline-flex min-w-0 items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <Filter className="size-3 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
              <span className="truncate">Filters</span>
            </span>
          </div>
          <div className="col-start-3 row-start-2 min-w-0">
            <MultiCheckboxFilter
              label="Work Item"
              options={workItemOptions}
              selected={workItemFilter}
              onChange={(next) =>
                setWorkItemFilter(
                  next.filter((value): value is WorkItemKindFilter => value === "initiative" || value === "epic" || value === "story"),
                )
              }
              buttonClassName="min-w-0 w-full gap-1 px-1.5 sm:gap-1.5 sm:px-2.5 text-[15px]"
            />
          </div>
          <div className="col-start-4 row-start-2 min-w-0">
            <MultiCheckboxFilter
              label="Roadmap"
              options={roadmapOptions}
              selected={roadmapFilter}
              onChange={setRoadmapFilter}
              buttonClassName="min-w-0 w-full gap-1 px-1.5 sm:gap-1.5 sm:px-2.5 text-[15px]"
            />
          </div>
          <div className="col-start-5 row-start-2 min-w-0">
            <MultiCheckboxFilter
              label="Year"
              options={yearOptions}
              selected={yearFilter}
              onChange={setYearFilter}
              buttonClassName="min-w-0 w-full gap-1 px-1.5 sm:gap-1.5 sm:px-2.5 text-[15px]"
            />
          </div>
          <div className="col-start-6 row-start-2 min-w-0">
            <MultiCheckboxFilter
              label="Quarter"
              options={quarterOptions}
              selected={quarterFilter}
              onChange={setQuarterFilter}
              buttonClassName="min-w-0 w-full gap-1 px-1.5 sm:gap-1.5 sm:px-2.5 text-[15px]"
            />
          </div>
          <div className="col-start-7 row-start-2 min-w-0">
            <MultiCheckboxFilter
              label="Status"
              options={statusOptions}
              selected={statusFilter}
              onChange={setStatusFilter}
              buttonClassName="min-w-0 w-full gap-1 px-1.5 sm:gap-1.5 sm:px-2.5 text-[15px]"
            />
          </div>
          <div className="col-start-8 row-start-2 min-w-0">
            <MultiCheckboxFilter
              label="Sprint"
              options={sprintOptions}
              selected={sprintFilter}
              onChange={setSprintFilter}
              buttonClassName="min-w-0 w-full gap-1 px-1.5 sm:gap-1.5 sm:px-2.5 text-[15px]"
            />
          </div>
          <div className="col-start-9 row-start-2 min-w-0">
            <BacklogTeamFilterControl
              selectedIds={teamFilter}
              onChange={setTeamFilter}
              buttonClassName="min-w-0 w-full gap-1 px-1.5 sm:gap-1.5 sm:px-2.5 text-[15px]"
            />
          </div>
          <div className="col-start-10 row-start-2 min-w-0">
            <BacklogAssigneeFilterControl
              selected={assigneeFilter}
              onChange={setAssigneeFilter}
              suggestions={assigneeAutocompleteSuggestions}
              buttonClassName="min-w-0 w-full gap-1 px-1.5 sm:gap-1.5 sm:px-2.5 text-[15px]"
            />
          </div>
          <div className="col-start-11 row-start-2 min-w-0">
            <BacklogLabelsFilterControl
              selected={labelFilter}
              onChange={setLabelFilter}
              suggestions={storyLabelSuggestions}
              buttonClassName="min-w-0 w-full gap-1 px-1.5 sm:gap-1.5 sm:px-2.5 text-[15px]"
            />
          </div>
          <div className="col-start-14 row-start-2 flex min-w-0 justify-start">
            <span className="group relative inline-flex h-[34px] w-[34px] shrink-0">
            <button
              type="button"
              onClick={resetAllFilters}
              disabled={!hasAnyActiveFilter}
              className="relative z-0 inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Clear all filters"
            >
              <Eraser className="size-3.5" strokeWidth={2} />
            </button>
            {!hasAnyActiveFilter ? (
              <span className="absolute inset-0 z-10 cursor-not-allowed rounded-lg" aria-hidden />
            ) : null}
            <span
              role="tooltip"
              className="pointer-events-none absolute right-full top-1/2 z-30 mr-2 w-64 max-w-[calc(100vw-2rem)] -translate-y-1/2 rounded-lg border border-slate-200/90 bg-white/95 px-3 py-2 text-left text-[12px] font-medium leading-snug whitespace-normal text-slate-700 opacity-0 shadow-lg shadow-slate-900/10 ring-1 ring-slate-200/80 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100"
            >
              Erases all filters: search, group-by, and every filter selection.
            </span>
            </span>
          </div>
        </div>
      </div>
      {createSelection?.anchorKey === "group-toolbar:add-initiative" ? (
        <div className="mb-3 w-full min-w-0 max-w-full shrink-0 overflow-x-auto">
        <form
          onSubmit={handleCreateSubmit}
          className={cn("grid w-max min-w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 py-2 ps-3")}
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
          <div className="flex items-center gap-2" style={createFormRestGridStyle}>
            <button type="submit" disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-45"><Plus className="size-3.5" /></button>
            <button type="button" onClick={closeInlineCreator} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"><X className="size-3.5" /></button>
          </div>
        </form>
        </div>
      ) : null}

      <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200/60 bg-white">
        <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto [scrollbar-gutter:stable]">
        <div className="w-max min-w-full text-[15px] leading-snug text-slate-700">
        <>
        {showTableHeaderRow ? (
          <div className="sticky top-0 z-10 min-w-full w-max border-b border-[#19abeb]/70 bg-[#0897d5] shadow-[0_1px_0_rgba(15,23,42,0.04)] relative">
            <div ref={columnsMenuRef} className="absolute left-4 top-0 flex h-full items-center gap-1.5 z-20">
              <button
                type="button"
                onClick={() => setColumnsMenuOpen((open) => !open)}
                className="inline-flex size-6 items-center justify-center rounded-md bg-white/15 text-white ring-1 ring-white/50 transition hover:bg-white/30 hover:ring-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                aria-label="Table columns and layout"
                title="Table columns and layout"
                aria-expanded={columnsMenuOpen}
                aria-haspopup="menu"
              >
                <TableProperties className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
              </button>
            </div>
            <DndContext sensors={columnDragSensors} collisionDetection={closestCenter} onDragEnd={handleBacklogColumnDragEnd}>
              <SortableContext
                items={visibleColumnKeys.filter((k) => k !== "workItem")}
                strategy={horizontalListSortingStrategy}
              >
                <div
                  className="grid min-w-full w-max items-center gap-2 py-2.5 ps-0 text-[14px] font-semibold tracking-[0.03em] text-white uppercase"
                  style={{ gridTemplateColumns: tableGridTemplate }}
                >
                  {visibleColumnKeys.map((key, index) => {
                    const cellClass = cn(
                      "relative min-w-0 w-full",
                      key === "workItem" && "pl-4",
                      CENTER_ALIGNED_BACKLOG_COLUMNS.has(key) && "text-center",
                    );
                    const resizeHandle =
                      index < visibleColumnKeys.length - 1 ? (
                        <button
                          type="button"
                          aria-label={`Resize ${BACKLOG_COLUMN_LABELS[key]} column`}
                          onMouseDown={(event) => beginColumnResize(key, event)}
                          className="absolute top-0 right-0 z-[1] h-full w-2 cursor-col-resize"
                        >
                          <span className="absolute top-1/2 right-0 h-4 w-px -translate-y-1/2 bg-white/55" />
                        </button>
                      ) : null;
                    if (key === "workItem") {
                      return (
                        <div key={key} className={cn(cellClass, "group/col transition-colors hover:text-amber-200")}>
                          <span className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 truncate pl-10">
                              <span className="truncate">{BACKLOG_COLUMN_LABELS[key]}</span>
                            </span>
                            <span
                              className="mr-1.5 inline-flex h-6 shrink-0 items-center gap-0.5 px-0.5"
                              role="group"
                              aria-label="Row tree expand and collapse"
                            >
                              <button
                                type="button"
                                onClick={collapseAllRows}
                                title="Collapse all rows"
                                aria-label="Collapse all rows"
                                className="inline-flex h-5 w-5 items-center justify-center text-white/85 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                              >
                                <ChevronsUp className="size-3.5" strokeWidth={2.2} />
                              </button>
                              <button
                                type="button"
                                onClick={expandAllRows}
                                title="Expand all rows"
                                aria-label="Expand all rows"
                                className="inline-flex h-5 w-5 items-center justify-center text-white/85 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                              >
                                <ChevronsDown className="size-3.5" strokeWidth={2.2} />
                              </button>
                            </span>
                          </span>
                          {resizeHandle}
                        </div>
                      );
                    }
                    return (
                      <SortableBacklogColumnHeader
                        key={key}
                        id={key}
                        className={cellClass}
                        // All column titles align center per project spec (workItem keeps its own custom header layout above).
                        centered
                        label={<span className="truncate">{BACKLOG_COLUMN_LABELS[key]}</span>}
                        resizeHandle={resizeHandle}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        ) : null}

        {fullyFiltered.length === 0 ? (
          <div className="px-4 py-10 text-[16px] text-slate-600">No items match your search/filter settings.</div>
        ) : (
          <div className="min-w-max bg-white" ref={backlogRowsRootRef}>
            {groupLevels.length > 0 ? (
              renderGroupedTree(groupedStoryRows, groupedStandaloneInitiatives)
            ) : (
            <>
            {fullyFiltered.map((initiative) => {
              const isInitOpen = openInitiatives[initiative.id] ?? defaultTreeExpanded;
              const initiativeStories = (initiative.epics ?? []).flatMap((epic) => epic.userStories ?? []);
              const initiativeWorkflowStatus = rollupWorkflowStatus(initiativeStories);
              const initiativeDays = sumStoryDays(initiativeStories);
              const initiativeProgress = completionFromStories(initiativeStories);
              const flatInitGantt = ganttDateRangeForInitiative(initiative);
              return (
                <div key={initiative.id}>
                  <div
                    className={cn("group grid min-w-full w-max items-center gap-2 border-b border-slate-200/80 py-1.5 hover:!bg-indigo-50/40")}
                    style={{
                      gridTemplateColumns: tableGridTemplate,
                    }}
                    data-backlog-zebra-row="true"
                    data-backlog-zebra-kind="initiative"
                    data-backlog-zebra-label={initiative.title}
                  >
                    {renderBacklogCells({
                      workItem: (
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
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => { if (editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiative.id) return; onOpenInitiative(initiative.id); }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                if (editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiative.id) return;
                                onOpenInitiative(initiative.id);
                              }
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <Zap className="size-4 shrink-0 text-blue-600" strokeWidth={1.9} />
                            {editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiative.id ? (
                              <span className="flex min-w-0 items-center gap-1">
                                <input
                                  value={editingParentTitle.value}
                                  onChange={(event) => setEditingParentTitle({ kind: "initiative", id: initiative.id, value: event.target.value })}
                                  className="h-7 min-w-[220px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                                  autoFocus
                                />
                                <button type="button" onClick={() => setEditingParentTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                <button type="button" onClick={() => void confirmParentTitleEdit("initiative", initiative.id, initiative.title)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                              </span>
                            ) : (
                              <span className="inline-flex w-full min-w-0 items-center gap-1 text-[16px] font-medium text-slate-900">
                                <span className="truncate">{initiative.title}</span>
                                <span
                                  className="ml-auto opacity-0 transition group-hover/workitem:opacity-100 focus-within:opacity-100"
                                  onMouseDown={(event) => event.stopPropagation()}
                                >
                                  <EditRowIconButton
                                    label="Edit initiative title"
                                    onClick={() =>
                                      setEditingParentTitle({ kind: "initiative", id: initiative.id, value: initiative.title })
                                    }
                                  />
                                </span>
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenCreateMenuKey((prev) => (prev === `initiative:${initiative.id}` ? null : `initiative:${initiative.id}`));
                            }}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 ring-1 ring-slate-200 text-slate-700 transition hover:bg-white hover:text-slate-900 group-hover/workitem:opacity-100 focus-visible:opacity-100"
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
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[16px] font-medium text-slate-700 hover:!bg-indigo-50/40"
                              >
                                <Zap className="size-3.5 text-blue-600" strokeWidth={1.9} />
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
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[16px] font-medium text-slate-700 hover:!bg-indigo-50/40"
                              >
                                <Folder className="size-3.5 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
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
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[16px] font-medium text-slate-700 hover:!bg-indigo-50/40"
                              >
                                <UserStoryIcon />
                                Add user story
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ),
                      team: isEditingParentTeam("initiative", initiative.id) ? (
                        renderParentTeamEditor({ kind: "initiative", id: initiative.id })
                      ) : (
                        renderBacklogTeamCell(initiative.team ?? aggregateInitiativeTeamId(initiative))
                      ),
                      year: <span className="text-center text-[16px] text-slate-700">{initiative.year}</span>,
                      quarter: <span className="text-center text-[16px] text-slate-700">{quarterFromMonth(initiative.startMonth)}</span>,
                      month: <span className="text-center text-[16px] text-slate-700">{monthLabel(initiative.startMonth)}</span>,
                      startDate: isEditingParentDate("initiative", initiative.id, "start") ? (
                        renderParentDateEditor({ kind: "initiative", id: initiative.id, field: "start" })
                      ) : (
                        <button
                          type="button"
                          onClick={() => {}}
                          className={backlogReadonlyInitiativeDateButtonClass}
                        >
                          {formatBacklogPlanDate(flatInitGantt.start)}
                        </button>
                      ),
                      endDate: isEditingParentDate("initiative", initiative.id, "end") ? (
                        renderParentDateEditor({ kind: "initiative", id: initiative.id, field: "end" })
                      ) : (
                        <button
                          type="button"
                          onClick={() => {}}
                          className={backlogReadonlyInitiativeDateButtonClass}
                        >
                          {formatBacklogPlanDate(flatInitGantt.end)}
                        </button>
                      ),
                      status: (
                        <span className={cn("inline-flex min-w-[104px] items-center justify-center gap-1.5 justify-self-center rounded-full px-3 py-[3px] text-[13px] font-semibold tracking-wide", statusChip(initiativeWorkflowStatus))}>
                          {statusIcon(initiativeWorkflowStatus)}
                          {workflowStatusLabel(initiativeWorkflowStatus)}
                        </span>
                      ),
                      sprint: <span className="text-center text-[16px] text-slate-500">-</span>,
                      assignee: (
                        <span className="text-center text-[16px] text-slate-700">
                          {editingParentAssignee?.kind === "initiative" && editingParentAssignee.id === initiative.id ? (
                            <span className="inline-flex items-center gap-1">
                              <AssigneeCombobox
                                value={editingParentAssignee.value}
                                onChange={(v) => setEditingParentAssignee((prev) => (prev ? { ...prev, value: v } : prev))}
                                suggestions={assigneeNameSuggestions}
                                placeholder="Unassigned"
                                className="h-7 w-full min-w-[104px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    setEditingParentAssignee(null);
                                  }
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void confirmParentAssigneeEdit("initiative", initiative.id, initiative.assignee);
                                  }
                                }}
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
                              className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-100"
                            >
                              <UserRound className="size-3.5 text-slate-400" aria-hidden />
                              {initiative.assignee ?? "Unassigned"}
                            </button>
                          )}
                        </span>
                      ),
                      labels: isEditingParentLabels("initiative", initiative.id) ? (
                        renderParentLabelsEditor({ kind: "initiative", id: initiative.id })
                      ) : (
                        <span className="truncate text-[14px] text-slate-700">{initiative.labels ?? ""}</span>
                      ),
                      estDays: (
                        <button
                          type="button"
                          onClick={() => {}}
                          className={backlogReadonlyAutoSumButtonClass}
                        >
                          Σ {initiativeDays.estimated}d
                        </button>
                      ),
                      epicOriginalEst: <span className="text-center text-[16px] text-slate-400">-</span>,
                      daysLeft: (
                        <button
                          type="button"
                          onClick={() => {}}
                          className={backlogReadonlyAutoSumButtonClass}
                        >
                          Σ {initiativeDays.left}d
                        </button>
                      ),
                      progress: (
                        <button
                          type="button"
                          onClick={() => {}}
                          className={backlogReadonlyProgressButtonClass}
                        >
                          <div className="flex items-center justify-between text-[13px] tabular-nums text-slate-600">
                            <span>{initiativeProgress.total === 0 ? "No stories" : null}</span>
                            <span>
                              {initiativeProgress.finished}/{initiativeProgress.total} · {initiativeProgress.percent}%
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500 transition-all"
                              style={{ width: `${initiativeProgress.percent}%` }}
                            />
                          </div>
                        </button>
                      ),
                    }, {
                      workItem: { kind: "lock" },
                      team: { kind: "edit", onEdit: () => beginInitiativeTeamEdit({ id: initiative.id, team: initiative.team ?? null }) },
                      year: { kind: "lock" },
                      quarter: { kind: "lock" },
                      month: { kind: "lock" },
                      startDate: {
                        kind: "edit",
                        onEdit: () =>
                          beginInitiativeDateEdit(
                            initiative.id,
                            "start",
                            initiative.year,
                            initiative.startMonth ?? null,
                          ),
                      },
                      endDate: {
                        kind: "edit",
                        onEdit: () =>
                          beginInitiativeDateEdit(
                            initiative.id,
                            "end",
                            initiative.year,
                            initiative.endMonth ?? null,
                          ),
                      },
                      status: { kind: "lock" },
                      sprint: { kind: "lock" },
                      assignee: { kind: "edit", onEdit: () => setEditingParentAssignee({ kind: "initiative", id: initiative.id, value: initiative.assignee?.trim() || "" }) },
                      labels: { kind: "edit", onEdit: () => beginInitiativeLabelsEdit({ id: initiative.id, labels: initiative.labels ?? null }) },
                      estDays: { kind: "lock" },
                      epicOriginalEst: { kind: "lock" },
                      daysLeft: { kind: "lock" },
                      progress: { kind: "lock" },
                    })}
                  </div>
                  {createSelection?.anchorKey === `initiative:${initiative.id}` && createSelection.kind === "initiative" ? (
                    <form
                      onSubmit={handleCreateSubmit}
                      className={cn("grid min-w-full w-max items-center gap-3 bg-slate-50 py-2")}
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
                          className="h-9 w-full rounded-md bg-white px-2.5 text-[16px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                          autoFocus
                        />
                      </div>
                      <div className="flex items-center gap-2" style={createFormRestGridStyle}>
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
                    <div className="relative bg-slate-50/50"><div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-slate-300/70" aria-hidden />
                      {createSelection?.anchorKey === `initiative:${initiative.id}` && createSelection.kind !== "initiative" ? (
                        <form
                          onSubmit={handleCreateSubmit}
                          className={cn("grid min-w-full w-max items-center gap-3 py-2")}
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
                              className="h-9 w-full rounded-md bg-white px-2.5 text-[16px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                              autoFocus
                            />
                          </div>
                          <div className="flex items-center gap-2" style={createFormRestGridStyle}>
                            {createSelection.kind === "story" ? (
                              <select
                                value={storyTargetEpicId}
                                onChange={(event) => setStoryTargetEpicId(event.target.value)}
                                className="h-9 rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
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
                        const flatEpicGantt = ganttDateRangeForEpic(epic, initiative.year);
                        return (
                          <div key={epic.id}>
                            <div
                            className={cn("group grid min-w-full w-max items-center gap-2 border-b border-slate-200/80 py-1.5 hover:!bg-indigo-50/40")}
                              style={{ gridTemplateColumns: tableGridTemplate }}
                            data-backlog-zebra-row="true"
                            data-backlog-zebra-kind="epic"
                            data-backlog-zebra-label={epic.title}
                            >
                              {renderBacklogCells({
                                workItem: (
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
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => { if (editingParentTitle?.kind === "epic" && editingParentTitle.id === epic.id) return; onOpenEpic(epic.id); }}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault();
                                          if (editingParentTitle?.kind === "epic" && editingParentTitle.id === epic.id) return;
                                          onOpenEpic(epic.id);
                                        }
                                      }}
                                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                    >
                                      <span className="inline-block size-4 shrink-0" aria-hidden />
                                      {editingParentTitle?.kind === "epic" && editingParentTitle.id === epic.id ? (
                                        <span className="flex min-w-0 items-center gap-1">
                                          <input
                                            value={editingParentTitle.value}
                                            onChange={(event) => setEditingParentTitle({ kind: "epic", id: epic.id, value: event.target.value })}
                                            className="h-7 min-w-[200px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                                            autoFocus
                                          />
                                          <button type="button" onClick={() => setEditingParentTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                          <button type="button" onClick={() => void confirmParentTitleEdit("epic", epic.id, epic.title)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                                        </span>
                                      ) : (
                                        <span className="inline-flex w-full min-w-0 items-center gap-1.5 text-[16px] font-medium text-slate-800">
                                          <EpicPlanBarIcon icon={epic.icon} className="mr-0 text-slate-400 [&_svg]:size-4" />
                                          <span className="truncate">{epic.title}</span>
                                          <span
                                            className="ml-auto opacity-0 transition group-hover/workitem:opacity-100 focus-within:opacity-100"
                                            onMouseDown={(event) => event.stopPropagation()}
                                          >
                                            <EditRowIconButton
                                              label="Edit epic title"
                                              onClick={() =>
                                                setEditingParentTitle({ kind: "epic", id: epic.id, value: epic.title })
                                              }
                                            />
                                          </span>
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setOpenCreateMenuKey((prev) => (prev === `epic:${epic.id}` ? null : `epic:${epic.id}`));
                                      }}
                                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 ring-1 ring-slate-200 transition hover:bg-white hover:text-slate-900 group-hover/workitem:opacity-100 focus-visible:opacity-100"
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
                                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[16px] font-medium text-slate-700 hover:!bg-indigo-50/40"
                                        >
                                          <Folder className="size-3.5 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
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
                                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[16px] font-medium text-slate-700 hover:!bg-indigo-50/40"
                                        >
                                          <UserStoryIcon />
                                          Add user story
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                ),
                                team: isEditingParentTeam("epic", epic.id) ? (
                                  renderParentTeamEditor({ kind: "epic", id: epic.id })
                                ) : (
                                  renderBacklogTeamCell(epic.team ?? null)
                                ),
                                year: <span className="text-center text-[16px] text-slate-700">{initiative.year}</span>,
                                quarter: (
                                  <span className="text-center text-[16px] text-slate-700">
                                    {quarterFromMonth(epic.planStartMonth ?? initiative.startMonth)}
                                  </span>
                                ),
                                month: (
                                  <span className="text-center text-[16px] text-slate-700">
                                    {monthLabel(epic.planStartMonth ?? initiative.startMonth)}
                                  </span>
                                ),
                                startDate: (
                                  <span className="text-center text-[14px] tabular-nums text-slate-700">
                                    {isEditingParentDate("epic", epic.id, "start") ? (
                                      renderParentDateEditor({ kind: "epic", id: epic.id, field: "start" })
                                    ) : (
                                      formatBacklogPlanDate(flatEpicGantt.start)
                                    )}
                                  </span>
                                ),
                                endDate: (
                                  <span className="text-center text-[14px] tabular-nums text-slate-700">
                                    {isEditingParentDate("epic", epic.id, "end") ? (
                                      renderParentDateEditor({ kind: "epic", id: epic.id, field: "end" })
                                    ) : (
                                      formatBacklogPlanDate(flatEpicGantt.end)
                                    )}
                                  </span>
                                ),
                                status: (
                                  <span className={cn("inline-flex min-w-[104px] items-center justify-center gap-1.5 justify-self-center rounded-full px-3 py-[3px] text-[13px] font-semibold tracking-wide", statusChip(epicWorkflowStatus))}>
                                    {statusIcon(epicWorkflowStatus)}
                                    {workflowStatusLabel(epicWorkflowStatus)}
                                  </span>
                                ),
                                sprint: <span className="text-center text-[16px] text-slate-500">-</span>,
                                assignee: (
                                  <span className="text-center text-[16px] text-slate-700">
                                    {editingParentAssignee?.kind === "epic" && editingParentAssignee.id === epic.id ? (
                                      <span className="inline-flex items-center gap-1">
                                        <AssigneeCombobox
                                          value={editingParentAssignee.value}
                                          onChange={(v) => setEditingParentAssignee((prev) => (prev ? { ...prev, value: v } : prev))}
                                          suggestions={assigneeNameSuggestions}
                                          placeholder="Unassigned"
                                          className="h-7 w-full min-w-[104px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                                          onKeyDown={(e) => {
                                            if (e.key === "Escape") {
                                              e.preventDefault();
                                              setEditingParentAssignee(null);
                                            }
                                            if (e.key === "Enter") {
                                              e.preventDefault();
                                              void confirmParentAssigneeEdit("epic", epic.id, epic.assignee);
                                            }
                                          }}
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
                                        className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-100"
                                      >
                                        <UserRound className="size-3.5 text-slate-400" aria-hidden />
                                        {epic.assignee ?? "Unassigned"}
                                      </button>
                                    )}
                                  </span>
                                ),
                                labels: isEditingParentLabels("epic", epic.id) ? (
                                  renderParentLabelsEditor({ kind: "epic", id: epic.id })
                                ) : (
                                  <span className="truncate text-[14px] text-slate-700">{epic.labels ?? ""}</span>
                                ),
                                estDays: (
                                  <button
                                    type="button"
                                    onClick={() => {}}
                                    className={backlogReadonlyAutoSumButtonClass}
                                  >
                                    Σ {epicDays.estimated}d
                                  </button>
                                ),
                                epicOriginalEst: (
                                  <span className="text-center text-[16px] font-medium text-slate-600">
                                    {epic.originalEstimateDays ?? 0}d
                                  </span>
                                ),
                                daysLeft: (
                                  <button
                                    type="button"
                                    onClick={() => {}}
                                    className={backlogReadonlyAutoSumButtonClass}
                                  >
                                    Σ {epicDays.left}d
                                  </button>
                                ),
                                progress: (
                                  <button
                                    type="button"
                                    onClick={() => {}}
                                    className={backlogReadonlyProgressButtonClass}
                                  >
                                    <div className="flex items-center justify-between text-[13px] tabular-nums text-slate-600">
                                      <span>{epicProgress.total === 0 ? "No stories" : null}</span>
                                      <span>
                                        {epicProgress.finished}/{epicProgress.total} · {epicProgress.percent}%
                                      </span>
                                    </div>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                                      <div
                                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500 transition-all"
                                        style={{ width: `${epicProgress.percent}%` }}
                                      />
                                    </div>
                                  </button>
                                ),
                              }, {
                                workItem: { kind: "lock" },
                                team: { kind: "edit", onEdit: () => beginEpicTeamEdit({ id: epic.id, team: epic.team ?? null }) },
                                year: { kind: "lock" },
                                quarter: { kind: "lock" },
                                month: { kind: "lock" },
                                startDate: {
                                  kind: "edit",
                                  onEdit: () =>
                                    beginEpicDateEdit(
                                      epic.id,
                                      "start",
                                      initiative.year,
                                      epic.planStartMonth ?? null,
                                      epic.planStartDay ?? null,
                                    ),
                                },
                                endDate: {
                                  kind: "edit",
                                  onEdit: () =>
                                    beginEpicDateEdit(
                                      epic.id,
                                      "end",
                                      initiative.year,
                                      epic.planEndMonth ?? null,
                                      epic.planEndDay ?? null,
                                    ),
                                },
                                status: { kind: "lock" },
                                sprint: { kind: "lock" },
                                assignee: { kind: "edit", onEdit: () => setEditingParentAssignee({ kind: "epic", id: epic.id, value: epic.assignee?.trim() || "" }) },
                                labels: { kind: "edit", onEdit: () => beginEpicLabelsEdit({ id: epic.id, labels: epic.labels ?? null }) },
                                estDays: { kind: "lock" },
                                epicOriginalEst: { kind: "lock" },
                                daysLeft: { kind: "lock" },
                                progress: { kind: "lock" },
                              })}
                            </div>
                            {createSelection?.anchorKey === `epic:${epic.id}` ? (
                              <form
                                onSubmit={handleCreateSubmit}
                                className={cn("grid min-w-full w-max items-center gap-3 py-2")}
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
                                    className="h-9 w-full rounded-md bg-white px-2.5 text-[16px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                                    autoFocus
                                  />
                                </div>
                                <div className="flex items-center gap-2" style={createFormRestGridStyle}>
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
                                  <div
                                    key={story.id}
                                    className={cn("min-w-full w-max border-b border-slate-200/80 hover:!bg-indigo-50/40")}
                                    data-backlog-zebra-row="true"
                                    data-backlog-zebra-kind="story"
                                    data-backlog-zebra-label={story.title}
                                  >
                                    {(() => {
                                      const progress = storyCompletion(story);
                                      const flatStoryWork = storyWorkPlanRangeFromProgress(story);
                                                                            return (
                                    <div
                                      className={cn("group grid min-w-full w-max items-center gap-2 py-1.5 text-left")}
                                      style={{ gridTemplateColumns: tableGridTemplate }}
                                    >
                                    {renderBacklogCells({
                                      workItem: (
                                    <div
                                      className="relative flex min-w-0 items-center gap-2 pl-24"
                                      onMouseEnter={cancelCreateMenuClose}
                                      onMouseLeave={scheduleCreateMenuClose}
                                    >
                                      <div
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => { if (editingStoryTitle?.id === story.id) return; onOpenStory(story.id); }}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            if (editingStoryTitle?.id === story.id) return;
                                            onOpenStory(story.id);
                                          }
                                        }}
                                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                      >
                                        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                                          <UserStoryIcon />
                                        </span>
                                        {editingStoryTitle?.id === story.id ? (
                                          <span className="flex min-w-0 items-center gap-1">
                                            <input
                                              value={editingStoryTitle.value}
                                              onChange={(event) => setEditingStoryTitle({ id: story.id, value: event.target.value })}
                                              className="h-7 min-w-[200px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                                              autoFocus
                                            />
                                            <button type="button" onClick={() => setEditingStoryTitle(null)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                            <button type="button" onClick={() => void confirmStoryTitleEdit(story.id, story.title)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><Check className="size-3.5" /></button>
                                          </span>
                                        ) : (
                                          <span className="inline-flex w-full min-w-0 items-center gap-1 text-[16px] text-slate-800">
                                            <span className="truncate">
                                              {story.title}
                                            </span>
                                            <span
                                              className="ml-auto opacity-0 transition group-hover/workitem:opacity-100 focus-within:opacity-100"
                                              onMouseDown={(event) => event.stopPropagation()}
                                            >
                                              <EditRowIconButton
                                                label="Edit user story title"
                                                onClick={() => setEditingStoryTitle({ id: story.id, value: story.title })}
                                              />
                                            </span>
                                          </span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setOpenCreateMenuKey((prev) => (prev === `story:${story.id}` ? null : `story:${story.id}`));
                                        }}
                                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 ring-1 ring-slate-200 transition hover:bg-white hover:text-slate-900 group-hover/workitem:opacity-100 focus-visible:opacity-100"
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
                                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[16px] font-medium text-slate-700 hover:!bg-indigo-50/40"
                                          >
                                            <UserStoryIcon />
                                            Add user story
                                          </button>
                                        </div>
                                      ) : null}
                                    </div>
                                      ),
                                      team: isEditingParentTeam("epic", epic.id) ? (
                                        renderParentTeamEditor({ kind: "epic", id: epic.id })
                                      ) : (
                                        renderBacklogTeamCell(epic.team ?? null)
                                      ),
                                      year: <span className="text-center text-[16px] text-slate-700">{initiative.year}</span>,
                                      quarter: (
                                    <span className="text-center text-[16px] text-slate-700">
                                      {quarterFromMonth(epic.planStartMonth ?? initiative.startMonth)}
                                    </span>
                                      ),
                                      month: (
                                    <span className="text-center text-[16px] text-slate-700">
                                      {monthLabel(epic.planStartMonth ?? initiative.startMonth)}
                                    </span>
                                      ),
                                      startDate: (
                                        <span className="text-center text-[14px] tabular-nums text-slate-700">
                                          {formatBacklogPlanDate(flatStoryWork.start)}
                                        </span>
                                      ),
                                      endDate: (
                                        <span className="text-center text-[14px] tabular-nums text-slate-700">
                                          {formatBacklogPlanDate(flatStoryWork.end)}
                                        </span>
                                      ),
                                      status: (
                                    <span
                                      className={cn(
                                        "relative inline-flex min-w-[104px] items-center justify-center justify-self-center rounded-full px-3 py-[3px] text-[13px] font-semibold tracking-wide",
                                        statusChip(story.status),
                                      )}
                                    >
                                      {editingStoryCell?.storyId === story.id && editingStoryCell.field === "status" ? (
                                        <>
                                          <span className="inline-flex items-center gap-1.5 font-semibold">
                                            {statusIcon(editingStoryCell.value)}
                                            {workflowStatusLabel(editingStoryCell.value as WorkflowStatus)}
                                          </span>
                                          <CellOptionPopover
                                            value={editingStoryCell.value as WorkflowStatus}
                                            options={STORY_STATUS_POPOVER_OPTIONS}
                                            onSelect={(v) => {
                                              setEditingStoryCell((prev) => (prev ? { ...prev, value: v } : prev));
                                              void confirmStoryCellEdit(story.id, "status", storyEditSnapshotFromFlat(story), v);
                                            }}
                                            onCancel={cancelStoryCellEdit}
                                            widthClass="w-[180px]"
                                          />
                                        </>
                                      ) : (
                                        <button
                                          type="button"
                                          onMouseDown={(event) => {
                                            event.preventDefault();
                                            beginStoryCellEdit(story.id, "status", story.status);
                                          }}
                                          className="inline-flex items-center gap-1.5 font-semibold"
                                        >
                                          {statusIcon(story.status)}
                                          {workflowStatusLabel(story.status as WorkflowStatus)}
                                        </button>
                                      )}
                                    </span>
                                      ),
                                      sprint: (
                                    <span className="text-center text-[16px] text-slate-700">
                                      {editingStoryCell?.storyId === story.id && editingStoryCell.field === "sprint" ? (
                                        <span className="inline-flex items-center gap-1">
                                          <select
                                            value={editingStoryCell.value}
                                            onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                                            onKeyDown={(event) =>
                                              handleStoryCellKeyDown(event, story.id, "sprint", storyEditSnapshotFromFlat(story))
                                            }
                                            className="h-7 min-w-[96px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                                          >
                                            <option value="unscheduled">Unscheduled</option>
                                            {assignableSprintsForYear(Number(initiative.year)).map((n) => {
                                              return (
                                                <option key={n} value={String(n)}>
                                                  Sprint {n}
                                                </option>
                                              );
                                            })}
                                          </select>
                                          <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              confirmStoryCellEdit(story.id, "sprint", storyEditSnapshotFromFlat(story))
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
                                      ),
                                      assignee: (
                                    <span className="text-center text-[16px] text-slate-700">
                                      {editingStoryCell?.storyId === story.id && editingStoryCell.field === "assignee" ? (
                                        <span className="inline-flex items-center gap-1">
                                          <AssigneeCombobox
                                            value={editingStoryCell.value}
                                            onChange={(v) => setEditingStoryCell((prev) => (prev ? { ...prev, value: v } : prev))}
                                            onKeyDown={(event) =>
                                              handleStoryCellKeyDown(event, story.id, "assignee", storyEditSnapshotFromFlat(story))
                                            }
                                            suggestions={assigneeNameSuggestions}
                                            placeholder="Unassigned"
                                            className="h-7 w-full min-w-[104px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                                          />
                                          <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              confirmStoryCellEdit(story.id, "assignee", storyEditSnapshotFromFlat(story))
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
                                          className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-100"
                                        >
                                          <UserRound className="size-3.5 text-slate-400" aria-hidden />
                                          {story.assignee?.trim() || "Unassigned"}
                                        </button>
                                      )}
                                    </span>
                                      ),
                                      labels: (
                                    <div className="w-full min-w-0 overflow-hidden">
                                      {editingStoryCell?.storyId === story.id && editingStoryCell.field === "labels" ? (
                                        <div className="mx-auto flex w-full min-w-0 max-w-full flex-col gap-1.5 rounded-lg border border-indigo-200/55 bg-gradient-to-b from-white to-slate-50/95 p-2 shadow-sm ring-1 ring-slate-200/45">
                                          <textarea
                                            value={editingStoryCell.value}
                                            onChange={(event) =>
                                              setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))
                                            }
                                            onKeyDown={(event) =>
                                              handleStoryCellKeyDown(event, story.id, "labels", storyEditSnapshotFromFlat(story))
                                            }
                                            rows={2}
                                            className="min-h-[2.5rem] w-full min-w-0 rounded-md border border-slate-200/80 bg-white px-2 py-1.5 text-left text-[14px] leading-snug text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200/70"
                                            placeholder="Comma-separated labels"
                                          />
                                          <span className="flex items-center justify-center gap-0.5">
                                            <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                confirmStoryCellEdit(story.id, "labels", storyEditSnapshotFromFlat(story))
                                              }
                                              className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
                                            ><Check className="size-3.5" /></button>
                                          </span>
                                        </div>
                                      ) : (
                                        <BacklogLabelsChipPanel
                                          labelsSerialized={story.labels}
                                          onMouseDownBeginEdit={(event) => {
                                            event.preventDefault();
                                            beginStoryCellEdit(story.id, "labels", formatStoryLabelsForEditInput(story.labels));
                                          }}
                                        />
                                      )}
                                    </div>
                                      ),
                                      estDays: (
                                    <span className="text-center text-[16px] text-slate-700">
                                      {editingStoryCell?.storyId === story.id && editingStoryCell.field === "estimatedDays" ? (
                                        <span className="inline-flex items-center gap-1">
                                          <input
                                            type="number"
                                            min={0}
                                            value={editingStoryCell.value}
                                            onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                                            onKeyDown={(event) =>
                                              handleStoryCellKeyDown(event, story.id, "estimatedDays", storyEditSnapshotFromFlat(story))
                                            }
                                            className="h-7 w-20 rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                                          />
                                          <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              confirmStoryCellEdit(story.id, "estimatedDays", storyEditSnapshotFromFlat(story))
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
                                      ),
                                      epicOriginalEst: <span className="text-center text-[16px] text-slate-400">-</span>,
                                      daysLeft: (
                                    <span className="text-center text-[16px] text-slate-700">
                                      {editingStoryCell?.storyId === story.id && editingStoryCell.field === "daysLeft" ? (
                                        <span className="inline-flex items-center gap-1">
                                          <input
                                            type="number"
                                            min={0}
                                            value={editingStoryCell.value}
                                            onChange={(event) => setEditingStoryCell((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
                                            onKeyDown={(event) =>
                                              handleStoryCellKeyDown(event, story.id, "daysLeft", storyEditSnapshotFromFlat(story))
                                            }
                                            className="h-7 w-20 rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                                          />
                                          <button type="button" onClick={cancelStoryCellEdit} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"><X className="size-3.5" /></button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              confirmStoryCellEdit(story.id, "daysLeft", storyEditSnapshotFromFlat(story))
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
                                      ),
                                      progress: (
                                    <button
                                      type="button"
                                      onClick={() => {}}
                                      className={backlogReadonlyProgressButtonClass}
                                    >
                                      <div className="text-right text-[13px] tabular-nums text-slate-600">
                                        <span>{progress.percent}%</span>
                                      </div>
                                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                                        <div
                                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500 transition-all"
                                          style={{ width: `${progress.percent}%` }}
                                        />
                                      </div>
                                    </button>
                                      ),
                                    }, {
                                      workItem: { kind: "lock" },
                                      team: { kind: "edit", onEdit: () => beginEpicTeamEdit({ id: epic.id, team: epic.team ?? null }) },
                                      status: { kind: "edit", onEdit: () => beginStoryCellEdit(story.id, "status", story.status) },
                                      sprint: { kind: "edit", onEdit: () => beginStoryCellEdit(story.id, "sprint", story.sprint == null ? "unscheduled" : String(story.sprint)) },
                                      assignee: { kind: "edit", onEdit: () => beginStoryCellEdit(story.id, "assignee", story.assignee?.trim() || "") },
                                      labels: { kind: "edit", onEdit: () => beginStoryCellEdit(story.id, "labels", formatStoryLabelsForEditInput(story.labels)) },
                                      estDays: { kind: "edit", onEdit: () => beginStoryCellEdit(story.id, "estimatedDays", String(story.estimatedDays ?? 0)) },
                                      daysLeft: { kind: "edit", onEdit: () => beginStoryCellEdit(story.id, "daysLeft", String(story.daysLeft ?? 0)) },
                                      year: { kind: "lock" },
                                      quarter: { kind: "lock" },
                                      month: { kind: "lock" },
                                      startDate: { kind: "lock" },
                                      endDate: { kind: "lock" },
                                      epicOriginalEst: { kind: "lock" },
                                      progress: { kind: "lock" },
                                    })}
                                    </div>
                                      );
                                    })()}
                                  {createSelection?.anchorKey === `story:${story.id}` ? (
                                    <form
                                      onSubmit={handleCreateSubmit}
                                      className={cn("grid min-w-full w-max items-center gap-3 bg-slate-50 py-2")}
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
                                          className="h-9 w-full rounded-md bg-white px-2.5 text-[16px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                                          autoFocus
                                        />
                                      </div>
                                      <div className="flex items-center gap-2" style={createFormRestGridStyle}>
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
        </div>
      </div>
      {saveAsFilterDialogOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSaveAsFilterDialogOpen(false);
              setSaveAsFilterName("");
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="backlog-save-filter-title"
            className="max-h-[min(90vh,32rem)] w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl shadow-slate-900/20 ring-1 ring-slate-200/80"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-emerald-100/80 bg-gradient-to-b from-emerald-50/90 to-white px-5 py-4">
              <h3 id="backlog-save-filter-title" className="text-[17px] font-semibold tracking-tight text-slate-900">
                Save as filter
              </h3>
              <p className="mt-1 text-[13px] leading-snug text-slate-600">
                Name this preset. The list below is what will be restored -- search, group-by, and facet filters only (not
                sort or table layout).
              </p>
            </div>
            <form
              className="flex flex-col gap-4 px-5 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                confirmSaveAsFilterPreset();
              }}
            >
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-slate-600">Preset name</span>
                <input
                  ref={saveAsFilterNameInputRef}
                  value={saveAsFilterName}
                  onChange={(event) => setSaveAsFilterName(event.target.value)}
                  placeholder="e.g. Q2 Platform backlog"
                  autoComplete="off"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[14px] text-slate-800 outline-none ring-slate-200 transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/70"
                />
              </label>
              <div>
                <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-600">Included in this filter</div>
                <ul className="max-h-48 list-disc space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/80 px-5 py-3 text-[13px] leading-snug text-slate-700 marker:text-emerald-600">
                  {saveAsFilterSummaryLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setSaveAsFilterDialogOpen(false);
                    setSaveAsFilterName("");
                  }}
                  className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-emerald-600 to-teal-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm ring-1 ring-emerald-800/25 transition hover:from-emerald-500 hover:to-teal-500"
                >
                  <Save className="size-4 shrink-0 opacity-95" strokeWidth={2} aria-hidden />
                  Save as filter
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {saveViewDialogOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSaveViewDialogOpen(false);
              setSaveViewName("");
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="backlog-save-view-title"
            className="max-h-[min(90vh,32rem)] w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl shadow-slate-900/20 ring-1 ring-slate-200/80"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-violet-100/80 bg-gradient-to-b from-violet-50/90 to-white px-5 py-4">
              <h3 id="backlog-save-view-title" className="text-[17px] font-semibold tracking-tight text-slate-900">
                Save view
              </h3>
              <p className="mt-1 text-[13px] leading-snug text-slate-600">
                Saves how the table looks and sorts: column order, visible columns, header row, column widths, and sort.
                Filters and group-by are not included -- use Save as filter for those.
              </p>
            </div>
            <form
              className="flex flex-col gap-4 px-5 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                confirmSaveViewPreset();
              }}
            >
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-slate-600">View name</span>
                <input
                  ref={saveViewNameInputRef}
                  value={saveViewName}
                  onChange={(event) => setSaveViewName(event.target.value)}
                  placeholder="e.g. Compact estimates"
                  autoComplete="off"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[14px] text-slate-800 outline-none ring-slate-200 transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200/70"
                />
              </label>
              <div>
                <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-600">Included in this view</div>
                <ul className="max-h-48 list-disc space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/80 px-5 py-3 text-[13px] leading-snug text-slate-700 marker:text-violet-600">
                  {saveViewSummaryLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setSaveViewDialogOpen(false);
                    setSaveViewName("");
                  }}
                  className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-violet-600 to-fuchsia-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm ring-1 ring-violet-800/25 transition hover:from-violet-500 hover:to-fuchsia-500"
                >
                  <Save className="size-4 shrink-0 opacity-95" strokeWidth={2} aria-hidden />
                  Save view
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {backlogReadonlyNotice ? (
        <div
          className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setBacklogReadonlyNotice(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="backlog-readonly-notice-title"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl shadow-slate-900/20 ring-1 ring-slate-200/80"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-indigo-100/80 bg-gradient-to-b from-indigo-50/90 to-white px-5 py-4">
              <h3 id="backlog-readonly-notice-title" className="text-[17px] font-semibold tracking-tight text-slate-900">
                {backlogReadonlyNotice.title}
              </h3>
              <p className="mt-2 text-[13px] leading-snug text-slate-600">{backlogReadonlyNotice.body}</p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4">
              <button
                type="button"
                onClick={() => setBacklogReadonlyNotice(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-slate-800"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {columnsMenuOpen && columnsMenuFixedPosition != null && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={columnsMenuPanelRef}
              id="backlog-columns-menu-panel"
              role="menu"
              aria-label="Table columns and layout"
              className="fixed z-[110] max-h-[min(70vh,26rem)] w-64 overflow-y-auto overflow-x-hidden rounded-xl border border-indigo-200/80 bg-gradient-to-b from-indigo-50 to-violet-50 p-2 shadow-xl shadow-indigo-900/20 ring-1 ring-indigo-200/60 backdrop-blur-sm"
              style={{ top: columnsMenuFixedPosition.top, left: columnsMenuFixedPosition.left }}
            >
              <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-[13px] font-medium text-slate-800 hover:bg-indigo-100/50">
                <input
                  type="checkbox"
                  checked={showTableHeaderRow}
                  onChange={() => setShowTableHeaderRow((v) => !v)}
                  className="h-3.5 w-3.5 rounded border-indigo-200 accent-indigo-600"
                />
                Show column titles
              </label>
              <div className="mb-1 border-t border-indigo-200/70 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Visible columns
              </div>
              <p className="mb-2 text-[11px] leading-snug text-slate-600">Drag the dotted handle in a blue column header to reorder columns.</p>
              {columnOrder.map((colKey) => {
                const locked = colKey === "workItem";
                return (
                  <label
                    key={colKey}
                    className={cn(
                      "mb-0.5 flex items-center gap-2 rounded px-1.5 py-1 text-[13px] text-slate-700",
                      locked ? "cursor-not-allowed opacity-70" : "hover:bg-indigo-100/40",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={columnVisibility[colKey]}
                      disabled={locked}
                      onChange={() => {
                        if (locked) return;
                        setColumnVisibility((prev) => ({ ...prev, [colKey]: !prev[colKey] }));
                      }}
                      className="h-3.5 w-3.5 rounded border-indigo-200 accent-indigo-600"
                    />
                    {BACKLOG_COLUMN_LABELS[colKey]}
                    {locked ? <span className="text-[11px] font-normal text-slate-500">(required)</span> : null}
                  </label>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
