"use client";

import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowUpDown,
  Bookmark,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  Eraser,
  ExternalLink,
  Filter,
  Flag,
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
  SquarePen,
  TableProperties,
  Tag,
  Trash2,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import type { CSSProperties, MouseEvent, ReactNode, RefObject } from "react";
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
import Image from "next/image";
import { toast } from "sonner";

import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { EditRowIconButton } from "@/components/ui/edit-row-icon-button";
import { TableColumnDragGrip } from "@/components/ui/table-column-drag-grip";
import { resolveAssigneeAvatar } from "@/components/ui/user-avatar";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import {
  formatBacklogPlanDate,
  ganttDateRangeForEpic,
  ganttDateRangeForInitiative,
  storyWorkPlanRangeFromProgress,
} from "@/lib/backlog-plan-dates";
import { EpicPlanBarIcon, InitiativePlanBarIcon } from "@/components/timeline/epic-plan-bar";
import { QuarterYearProgressIcon } from "@/components/ui/quarter-year-progress-icon";
import { TimelineDatePopover } from "@/components/epics/timeline-date-popover";
import { exportBacklogToPrintableWindow } from "@/lib/backlog-excel-export";
import { collectAssigneeNameSuggestions } from "@/lib/delivery-assignees";
import { monthTeamLabelForId, MONTH_TEAM_COLUMNS } from "@/lib/month-team-board";
import { defaultMembersForTeam } from "@/lib/sprint-capacity";
import { EpicItem, InitiativeItem, RoadmapItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { teamLabelForWorkspaceUser } from "@/lib/workspace-users";
import { monthLaneFromGlobalSprint, sprintEndDate, YEAR_SPRINT_MAX } from "@/lib/year-sprint";

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
  onCreateInitiativeQuick: (title: string, roadmapId?: string | null) => Promise<string | void>;
  /** Optional roadmap operations exposed by the parent. When undefined, the
   *  backlog hides its create-roadmap/edit-roadmap-name affordances. Years
   *  default to the current calendar year when omitted. */
  onCreateRoadmapQuick?: (name: string, years?: number[]) => Promise<string | null>;
  onRenameRoadmap?: (id: string, name: string) => Promise<void>;
  /** Jump the user to the Roadmap Planning view with the middle panel
   *  filtered to "Unscheduled" epics. When an `epicTitle` is supplied, the
   *  panel's initiative search box is also pre-filled so the user lands
   *  right at the epic they wanted to schedule. */
  onJumpToRoadmapPlanning?: (epicTitle?: string) => void;
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
      originalEstimateDays?: number | null;
    },
  ) => Promise<void>;
  summaryBarPortalElement?: HTMLElement | null;
  suppressInlineChips?: boolean;
  /** Workspace directory — surfaces directory-only members in the assignee
   *  autocomplete (otherwise newly-added users with no assignment yet never
   *  appear) and lets the picker show their photo when present. */
  workspaceDirectoryUsers?: readonly { name: string; team?: string; image?: string | null }[];
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
  | "parent"
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

/**
 * Per-column header sort state. When non-null this OVERRIDES the saved-view
 * `BacklogSortBy` for initiative-level ordering (the saved-view sort still
 * governs story-level ordering inside each epic). Third click clears it back
 * to null so the saved-view default takes over again.
 */
type BacklogColumnSort = { key: BacklogColumnKey; dir: "asc" | "desc" } | null;

function compareByColumn(a: InitiativeItem, b: InitiativeItem, sort: BacklogColumnSort): number {
  if (!sort) return 0;
  const dir = sort.dir === "asc" ? 1 : -1;
  const key = sort.key;
  if (key === "workItem") return dir * a.title.localeCompare(b.title);
  if (key === "assignee") return dir * (a.assignee ?? "Unassigned").localeCompare(b.assignee ?? "Unassigned");
  if (key === "year") return dir * ((a.year ?? 0) - (b.year ?? 0));
  if (key === "startDate") return dir * ((a.startMonth ?? 99) - (b.startMonth ?? 99));
  if (key === "endDate") return dir * ((a.endMonth ?? 99) - (b.endMonth ?? 99));
  if (key === "month") return dir * ((a.startMonth ?? 99) - (b.startMonth ?? 99));
  if (key === "quarter") {
    const qa = a.startMonth ? Math.ceil(a.startMonth / 3) : 99;
    const qb = b.startMonth ? Math.ceil(b.startMonth / 3) : 99;
    return dir * (qa - qb);
  }
  if (key === "status") {
    const order: Record<string, number> = { backlog: 0, planning: 1, "in-progress": 2, blocked: 3, done: 4 };
    return dir * ((order[a.status as string] ?? 99) - (order[b.status as string] ?? 99));
  }
  if (key === "team") {
    const at = (a.team ?? "").toString();
    const bt = (b.team ?? "").toString();
    return dir * at.localeCompare(bt);
  }
  if (key === "labels") return dir * ((a.labels ?? "").localeCompare(b.labels ?? ""));
  // Numeric/sprint/progress/est columns roll up across epics → use sums for initiatives.
  const aEpics = a.epics ?? [];
  const bEpics = b.epics ?? [];
  if (key === "epicOriginalEst") {
    const av = aEpics.reduce((s, e) => s + (e.originalEstimateDays ?? 0), 0);
    const bv = bEpics.reduce((s, e) => s + (e.originalEstimateDays ?? 0), 0);
    return dir * (av - bv);
  }
  if (key === "estDays") {
    const av = aEpics.reduce((s, e) => s + (e.userStories ?? []).reduce((ss, st) => ss + (st.estimatedDays ?? 0), 0), 0);
    const bv = bEpics.reduce((s, e) => s + (e.userStories ?? []).reduce((ss, st) => ss + (st.estimatedDays ?? 0), 0), 0);
    return dir * (av - bv);
  }
  if (key === "daysLeft") {
    const av = aEpics.reduce((s, e) => s + (e.userStories ?? []).reduce((ss, st) => ss + (st.daysLeft ?? 0), 0), 0);
    const bv = bEpics.reduce((s, e) => s + (e.userStories ?? []).reduce((ss, st) => ss + (st.daysLeft ?? 0), 0), 0);
    return dir * (av - bv);
  }
  if (key === "progress") {
    const tot = (arr: typeof aEpics) => {
      const all = arr.flatMap((e) => e.userStories ?? []);
      if (all.length === 0) return 0;
      const done = all.filter((s) => s.status === "done" || s.status === "approved").length;
      return done / all.length;
    };
    return dir * (tot(aEpics) - tot(bEpics));
  }
  if (key === "sprint") {
    const firstSprint = (arr: typeof aEpics): number => {
      const sprints = arr.flatMap((e) => (e.userStories ?? []).map((s) => s.sprint ?? Infinity));
      return sprints.length === 0 ? Infinity : Math.min(...sprints);
    };
    return dir * (firstSprint(aEpics) - firstSprint(bEpics));
  }
  return 0;
}

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
              "inline-flex max-w-[min(100%,10rem)] shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[10.5px] font-semibold leading-tight",
              labelChipClasses(lab),
            )}
          >
            <Tag className="size-2.5 shrink-0 opacity-70" aria-hidden />
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
  "parent",
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
  parent: "Parent",
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
  parent: 200,
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
  parent: 260,
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
const BACKLOG_TABLE_LAYOUT_DEFAULTS_VERSION = 11;
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
  parent: true,
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
  columnSort: BacklogColumnSort;
  onToggleSort: (key: BacklogColumnKey) => void;
};

function SortableBacklogColumnHeader({
  id,
  className,
  centered,
  label,
  resizeHandle,
  columnSort,
  onToggleSort,
}: SortableBacklogColumnHeaderProps) {
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
  const isActive = columnSort?.key === id;
  const dir = isActive ? columnSort?.dir : null;
  // Sort icons rendered AFTER the title (trailing). Bumped to size-4 with a slightly thicker stroke
  // so they read clearly on the indigo header bg.
  const sortIcon = isActive ? (
    dir === "asc" ? <ChevronUp className="size-4 shrink-0" strokeWidth={2.4} /> : <ChevronDown className="size-4 shrink-0" strokeWidth={2.4} />
  ) : (
    <ArrowUpDown className="size-4 shrink-0 opacity-0 transition-opacity group-hover/col-sort:opacity-60" strokeWidth={2.2} />
  );
  const sortableLabel = (
    <button
      type="button"
      onClick={() => onToggleSort(id)}
      className="group/col-sort inline-flex min-w-0 items-center gap-1 truncate"
    >
      {label}
      {sortIcon}
    </button>
  );
  return (
    <div ref={setNodeRef} style={style} className={cn(className, "group/col w-full min-w-0 transition-colors hover:text-amber-200")}>
      {/* pr-2.5 reserves the resize strip; overflow-hidden keeps label from painting past the column edge */}
      {centered ? (
        <span className="flex min-h-[1.25rem] w-full min-w-0 justify-center overflow-hidden pr-2.5">
          <span className="flex min-w-0 max-w-full items-center justify-center gap-1">
            {grip}
            <span className="min-w-0 overflow-hidden">{sortableLabel}</span>
          </span>
        </span>
      ) : (
        <span className="flex min-h-[1.25rem] w-full min-w-0 items-center gap-1 overflow-hidden pr-2.5">
          {grip}
          <span className="min-w-0 flex-1 overflow-hidden">{sortableLabel}</span>
        </span>
      )}
      {resizeHandle}
    </div>
  );
}
// Month and Sprint were removed as group options because backlog grouping is
// about planning horizon, not execution granularity — sprint-scoped views
// belong in the Sprint Kanban. Quarter is the deepest meaningful bucket here.
// The `month`/`sprint` enum values stay in the `GroupLevel` type so any
// renderLeafRows branches that switched on them keep compiling, but no UI
// surface offers them anymore and `isGroupLevelValue` filters them out on
// state restore.
const GROUP_LEVEL_ORDER: GroupLevel[] = ["roadmap", "year", "quarter"];
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
const CELL_POPOVER_Z = 8000;
const CELL_POPOVER_GAP = 6;
const CELL_POPOVER_VIEW_MARGIN = 8;

function CellOptionPopover<T extends string>({
  value,
  options,
  onSelect,
  onCancel,
  widthClass = "w-[220px]",
  triggerRef,
}: {
  value: T | "";
  options: Array<{ value: T | ""; label: string; subtitle?: string; icon?: ReactNode }>;
  onSelect: (v: T | "") => void;
  onCancel: () => void;
  widthClass?: string;
  /** Element to anchor the portaled popover to (its bounding rect drives positioning). */
  triggerRef?: RefObject<HTMLElement | null>;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden", zIndex: CELL_POPOVER_Z });

  const recalc = useCallback(() => {
    const trigger = triggerRef?.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const menuH = rootRef.current?.offsetHeight ?? 220;
    const spaceBelow = window.innerHeight - r.bottom - CELL_POPOVER_VIEW_MARGIN;
    const spaceAbove = r.top - CELL_POPOVER_VIEW_MARGIN;
    const openUp = spaceBelow < Math.min(menuH, 160) && spaceAbove > spaceBelow;
    const next: CSSProperties = {
      position: "fixed",
      zIndex: CELL_POPOVER_Z,
      left: Math.round(r.left + r.width / 2),
      transform: "translateX(-50%)",
      visibility: "visible",
    };
    if (openUp) {
      next.bottom = Math.round(window.innerHeight - r.top + CELL_POPOVER_GAP);
      next.maxHeight = Math.max(120, spaceAbove - CELL_POPOVER_GAP);
    } else {
      next.top = Math.round(r.bottom + CELL_POPOVER_GAP);
      next.maxHeight = Math.max(120, spaceBelow - CELL_POPOVER_GAP);
    }
    setStyle(next);
  }, [triggerRef]);

  useLayoutEffect(() => {
    recalc();
  }, [recalc, value, options.length]);

  useEffect(() => {
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [recalc]);

  useEffect(() => {
    function onDocMouseDown(event: globalThis.MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // Click inside the portaled popover -> ignore
      if (rootRef.current && rootRef.current.contains(target)) return;
      // Click inside the anchored trigger -> ignore (so the parent toggle handler runs cleanly)
      const trigger = triggerRef?.current;
      if (trigger && trigger.contains(target)) return;
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
  }, [onCancel, triggerRef]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={rootRef}
      role="listbox"
      className={cn(
        "overflow-y-auto rounded-xl border border-slate-200/80 bg-white p-1 shadow-lg ring-1 ring-black/[0.04]",
        widthClass,
      )}
      style={style}
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
    </div>,
    document.body,
  );
}

/**
 * Inline team-cell editor. Renders the current-team chip as the visible anchor
 * and a portaled CellOptionPopover positioned to that anchor (so it isn't
 * clipped by the cell's overflow box).
 */
function ParentTeamEditor({
  kind,
  editingValue,
  onSelect,
  onCancel,
}: {
  kind: "epic" | "initiative";
  editingValue: string;
  onSelect: (v: string) => void;
  onCancel: () => void;
}) {
  // kind currently doesn't change rendering -- preserved for future per-kind tweaks.
  void kind;
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const value = editingValue;
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
      data-cell-editing
      className="relative inline-flex items-center gap-1"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span
        ref={anchorRef}
        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-white px-2 text-[14px] text-slate-700 ring-1 ring-slate-200"
      >
        <span className={cn("inline-block size-2 rounded-full", currentColor)} aria-hidden />
        <span className="truncate">{currentLabel}</span>
      </span>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
      >
        <X className="size-3.5" />
      </button>
      <CellOptionPopover
        value={value}
        options={popoverOptions}
        onSelect={onSelect}
        onCancel={onCancel}
        triggerRef={anchorRef}
      />
    </span>
  );
}

// Single uniform style for every label chip — no per-text hash-coloring so
// users don't have to read meaning into the color of a chip.
const LABEL_CHIP_CLASS = "border-indigo-200/70 bg-indigo-50 text-indigo-700";

function labelChipClasses(_label: string): string {
  return LABEL_CHIP_CLASS;
}

function sprintLabel(sprint: number | null) {
  return sprint == null ? "Unscheduled" : `Sprint ${sprint}`;
}

/**
 * Inline editor for a story's status. Owns an anchor ref so the portaled
 * CellOptionPopover is positioned against the visible status chip (which lives
 * inside an `overflow-hidden` cell wrapper).
 */
function StoryStatusEditor({
  currentValue,
  onSelect,
  onCancel,
}: {
  currentValue: WorkflowStatus;
  onSelect: (v: WorkflowStatus) => void;
  onCancel: () => void;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  return (
    <>
      <span ref={anchorRef} data-cell-editing className="inline-flex items-center gap-1.5 font-semibold">
        {statusIcon(currentValue)}
        {workflowStatusLabel(currentValue)}
      </span>
      <CellOptionPopover
        value={currentValue}
        options={STORY_STATUS_POPOVER_OPTIONS}
        onSelect={(v) => onSelect(v as WorkflowStatus)}
        onCancel={onCancel}
        widthClass="w-[180px]"
        triggerRef={anchorRef}
      />
    </>
  );
}

/**
 * Inline editor for a story's sprint assignment. Mirrors StoryStatusEditor:
 * an anchor span (marked with data-cell-editing so the row pencil icon hides)
 * plus a portaled CellOptionPopover listing "Unscheduled" + the year's
 * assignable sprints. Each option shows a Flag icon to match the cell display.
 */
function SprintSelectEditor({
  currentValue,
  options,
  onSelect,
  onCancel,
}: {
  currentValue: string;
  options: number[];
  onSelect: (v: string) => void;
  onCancel: () => void;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const popoverOptions = [
    {
      value: "unscheduled",
      label: "Unscheduled",
      icon: <Flag className="size-3.5 text-slate-400" aria-hidden />,
    },
    ...options.map((n) => ({
      value: String(n),
      label: `Sprint ${n}`,
      icon: <Flag className="size-3.5 text-rose-500" aria-hidden />,
    })),
  ];
  return (
    <>
      <span ref={anchorRef} data-cell-editing className="inline-flex items-center gap-1.5 text-[15px]">
        <Flag className="size-3.5 text-rose-500" aria-hidden />
        {currentValue === "unscheduled" ? "Unscheduled" : `Sprint ${currentValue}`}
      </span>
      <CellOptionPopover
        value={currentValue}
        options={popoverOptions}
        onSelect={onSelect}
        onCancel={onCancel}
        widthClass="w-[200px]"
        triggerRef={anchorRef}
      />
    </>
  );
}

/**
 * Inline date editor rendered as a portaled floating card so it can't be
 * clipped by the cell's `overflow-hidden` wrapper. Anchored to the closest
 * positioned ancestor's bounding box via the host span ref.
 */
/** Inline date editor for epic (date) / initiative (month). Reuses the same
 *  `TimelineDatePopover` the epic dialog uses so the user sees the Q1-Q4 chip
 *  above the month grid here too. For initiatives the day is ignored on
 *  commit — picking any day in March sets `startMonth=3`. */
function ParentDateEditorOverlay({
  initialValue,
  fallbackYear,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  fallbackYear: number;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  // Tiny anchor placed where the cell sits so the popover positions under it.
  const hostRef = useRef<HTMLSpanElement | null>(null);
  return (
    <>
      <span
        ref={hostRef}
        data-cell-editing
        aria-hidden
        className="pointer-events-none inline-block h-4 w-1"
      />
      <TimelineDatePopover
        open
        anchorRef={hostRef}
        value={initialValue}
        fallbackYear={fallbackYear}
        fallbackMonth1={1}
        onChange={(next) => onCommit(next)}
        onClose={onCancel}
      />
    </>
  );
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
  return !value || value === "-" ? "Unscheduled work" : value;
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
  // Filters restored localStorage state against the currently-allowed
  // levels. Month/Sprint values from older saves get dropped silently.
  return v === "roadmap" || v === "year" || v === "quarter";
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
function rosterNamesForDeliveryTeams(
  teamIds: string[],
  directoryUsers?: readonly { name: string; team?: string }[] | null,
): Set<string> {
  const set = new Set<string>();
  for (const id of teamIds) {
    for (const n of defaultMembersForTeam(id)) set.add(n);
  }
  // Merge workspace directory members assigned to one of the filtered teams.
  // Without this, brand-new users (or any user not in the seeded delivery
  // roster) silently vanish from the assignee filter dropdown the moment a
  // team filter is active — and get *stripped* from the active filter by the
  // useEffect that prunes filters to allowed names.
  if (directoryUsers && teamIds.length > 0) {
    const filterLower = new Set(teamIds.map((t) => t.toLowerCase()));
    for (const u of directoryUsers) {
      const team = (u.team ?? "").trim().toLowerCase();
      if (!team || !filterLower.has(team)) continue;
      const name = u.name?.trim();
      if (name) set.add(name);
    }
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

/**
 * Hierarchical Parent picker — top-level initiative checkboxes with epic
 * children indented below. Ticking an initiative cascade-adds all its epic
 * ids (so subsequently unticking a single epic still hides that epic).
 * Selected ids are a flat list mixing initiative + epic ids — filter logic
 * treats either-membership as a match.
 */
type BacklogParentFilterTree = ReadonlyArray<{
  initiativeId: string;
  initiativeTitle: string;
  epics: ReadonlyArray<{ epicId: string; epicTitle: string }>;
}>;

function BacklogParentFilterControl({
  tree,
  selected,
  onChange,
  buttonClassName,
}: {
  tree: BacklogParentFilterTree;
  selected: string[];
  onChange: (next: string[]) => void;
  buttonClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = selected.length === 0;
  const selectedLabel = allSelected
    ? "All"
    : `${selected.length} selected`;

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
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

  const lowerQuery = query.trim().toLowerCase();
  const filteredTree = useMemo(() => {
    if (!lowerQuery) return tree;
    return tree
      .map((init) => {
        const initMatch = init.initiativeTitle.toLowerCase().includes(lowerQuery);
        const epics = init.epics.filter((e) => initMatch || e.epicTitle.toLowerCase().includes(lowerQuery));
        if (!initMatch && epics.length === 0) return null;
        return { ...init, epics };
      })
      .filter(Boolean) as typeof tree;
  }, [tree, lowerQuery]);

  function toggleInitiative(initiativeId: string, epicIds: string[]) {
    const isOn = selectedSet.has(initiativeId);
    if (isOn) {
      onChange(selected.filter((id) => id !== initiativeId && !epicIds.includes(id)));
    } else {
      const next = new Set(selected);
      next.add(initiativeId);
      for (const eid of epicIds) next.add(eid);
      onChange(Array.from(next));
    }
  }
  function toggleEpic(epicId: string) {
    if (selectedSet.has(epicId)) {
      onChange(selected.filter((id) => id !== epicId));
    } else {
      onChange([...selected, epicId]);
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
        <span className="shrink-0 font-medium text-slate-500">Parent: </span>
        <span className="ml-1 min-w-0 truncate font-normal text-slate-600">{selectedLabel}</span>
      </button>
      {isOpen ? (
        <div className="absolute z-30 mt-1 w-72 rounded-lg bg-gradient-to-b from-indigo-50 to-violet-50 p-2 shadow-lg shadow-indigo-900/5 backdrop-blur-sm">
          <label className="mb-1 flex items-center gap-2 text-[14px] text-slate-700">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onChange([])}
              className="h-3.5 w-3.5 rounded border-indigo-200 accent-indigo-600"
            />
            All
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search initiative or epic..."
            className="mb-2 h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200/70"
          />
          <div className="max-h-72 space-y-1 overflow-auto pr-1">
            {filteredTree.length === 0 ? (
              <div className="px-1 py-2 text-[12px] text-slate-400">No matches</div>
            ) : null}
            {filteredTree.map((init) => {
              const initChecked = selectedSet.has(init.initiativeId);
              const epicIds = init.epics.map((e) => e.epicId);
              return (
                <div key={init.initiativeId} className="rounded">
                  <label className="flex items-center gap-2 text-[14px] font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={initChecked}
                      onChange={() => toggleInitiative(init.initiativeId, epicIds)}
                      className="h-3.5 w-3.5 rounded border-indigo-200 accent-indigo-600"
                    />
                    <span className="truncate" title={init.initiativeTitle}>{init.initiativeTitle}</span>
                  </label>
                  {init.epics.length > 0 ? (
                    <div className="ml-5 mt-0.5 space-y-0.5 border-l border-slate-200/70 pl-2">
                      {init.epics.map((e) => (
                        <label key={e.epicId} className="flex items-center gap-2 text-[13px] text-slate-600">
                          <input
                            type="checkbox"
                            checked={selectedSet.has(e.epicId)}
                            onChange={() => toggleEpic(e.epicId)}
                            className="h-3 w-3 rounded border-indigo-200 accent-indigo-600"
                          />
                          <span className="truncate" title={e.epicTitle}>{e.epicTitle}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Tiny avatar/icon used in backlog row "assignee" cells. Same fallback
 * pattern as the rest of the app: photo when the directory has one for this
 * name, else the generic `UserRound` icon at the historical 14px size.
 */
function BacklogRowAvatar({
  name,
  directoryUsers,
}: {
  name: string | null | undefined;
  directoryUsers?: readonly { name: string; image?: string | null }[];
}) {
  const resolved = resolveAssigneeAvatar(name, directoryUsers);
  if (resolved.image) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={resolved.image}
        alt=""
        draggable={false}
        className="size-4 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
      />
    );
  }
  return <UserRound className="size-3.5 text-slate-400" aria-hidden />;
}

/**
 * Self-contained text input used by every inline editor in the backlog
 * table that takes typed text (titles, labels, estimates, create forms).
 * Owns its own `value` in LOCAL state so each keystroke only re-renders
 * this ~30-line component — not the 7k-line BacklogPlanningPanel and its
 * ~600 grid rows (each render is 300-900ms on demo data, which is why
 * typing in panel-state-bound inputs felt laggy).
 *
 * Renders: input + X (cancel) + ✓ (save). Esc cancels, Enter saves.
 * `onMouseDown={e.preventDefault()}` on the buttons prevents the input's
 * blur from racing the click handler.
 */
function IsolatedTextInput({
  initial,
  placeholder,
  onSave,
  onCancel,
  inputClassName,
  inputType = "text",
  minLength = 2,
  saveOnBlur = false,
  ariaLabel,
}: {
  initial: string;
  placeholder?: string;
  onSave: (value: string) => void;
  onCancel: () => void;
  inputClassName?: string;
  inputType?: "text" | "number";
  /** Minimum trimmed length required to enable save. Default 2. Set to 0
   *  to allow empty (used by labels editor where empty = clear). */
  minLength?: number;
  /** When true, blur auto-commits the current value (after 120ms so the
   *  Cancel/Save buttons can take precedence). Used by editors that
   *  previously had this behavior. */
  saveOnBlur?: boolean;
  ariaLabel?: string;
}) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  const canSave = trimmed.length >= minLength;
  return (
    <span className="inline-flex items-center gap-1" onMouseDown={(event) => event.stopPropagation()}>
      <input
        type={inputType}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        autoFocus
        aria-label={ariaLabel}
        className={inputClassName ?? "h-7 min-w-0 flex-1 rounded-md bg-white px-2 text-[14px] ring-1 ring-slate-200 outline-none"}
        onBlur={
          saveOnBlur
            ? () => {
                window.setTimeout(() => {
                  if (canSave) onSave(value);
                }, 120);
              }
            : undefined
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (canSave) onSave(value);
          }
        }}
      />
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onCancel}
        className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
        aria-label="Cancel"
      >
        <X className="size-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { if (canSave) onSave(value); }}
        disabled={!canSave}
        className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100 disabled:opacity-40"
        aria-label="Save"
      >
        <Check className="size-3.5" />
      </button>
    </span>
  );
}

/**
 * Isolated textarea/number editor for story cell edits (labels,
 * estimated days, days left). Same isolation rationale — typing only
 * re-renders this small component, never the 7k-line panel.
 */
function IsolatedStoryCellTextEditor({
  initial,
  multiline,
  inputType = "text",
  placeholder,
  className,
  onSave,
  onCancel,
}: {
  initial: string;
  multiline?: boolean;
  inputType?: "text" | "number";
  placeholder?: string;
  className?: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const commonProps = {
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValue(event.target.value),
    autoFocus: true,
    placeholder,
    className,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      // Single-line: Enter saves. Multiline: Cmd/Ctrl+Enter saves (Enter
      // alone inserts a newline as expected for textareas).
      const isEnter = event.key === "Enter";
      const shouldSave = isEnter && (!multiline || event.metaKey || event.ctrlKey);
      if (shouldSave) {
        event.preventDefault();
        onSave(value);
      }
    },
  };
  return (
    <span className="inline-flex w-full items-stretch gap-1" onMouseDown={(event) => event.stopPropagation()}>
      {multiline ? (
        <textarea {...commonProps} rows={2} />
      ) : (
        <input {...commonProps} type={inputType} />
      )}
      <span className="flex flex-col items-center justify-center gap-0.5">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSave(value)}
          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
          aria-label="Save"
        >
          <Check className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCancel}
          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100"
          aria-label="Cancel"
        >
          <X className="size-3.5" />
        </button>
      </span>
    </span>
  );
}

/**
 * Generic isolated inline-create form used by every "+ row" create site
 * (story under epic, epic under initiative, initiative under quarter,
 * etc). Same isolation rationale as `IsolatedTextInput` — keystrokes
 * stay local. Accepts an optional `extras` slot for sibling controls
 * (e.g. the story-target-epic <select> in the initiative-row form).
 */
function IsolatedCreateRowForm({
  placeholder,
  inputClassName,
  inputWrapperStyle,
  rightSlotStyle,
  extras,
  onSubmit,
  onCancel,
  formClassName,
  formStyle,
  submitting,
  saveDisabledExtra,
  leadingIcon,
}: {
  placeholder: string;
  inputClassName?: string;
  inputWrapperStyle?: CSSProperties;
  rightSlotStyle?: CSSProperties;
  extras?: ReactNode;
  onSubmit: (title: string) => void;
  onCancel: () => void;
  formClassName?: string;
  formStyle?: CSSProperties;
  submitting?: boolean;
  /** Extra disable condition (e.g. story form requires a target epic to
   *  be picked before save is allowed). */
  saveDisabledExtra?: boolean;
  /** Type-affordance icon (initiative/epic/story) shown left of the input. */
  leadingIcon?: ReactNode;
}) {
  const [title, setTitle] = useState("");
  const trimmed = title.trim();
  const canSubmit = trimmed.length >= 2 && !submitting && !saveDisabledExtra;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit(trimmed);
      }}
      className={formClassName ?? "grid min-w-full w-max items-center gap-3 bg-slate-50 py-2"}
      style={formStyle}
    >
      <div className="flex min-w-0 items-center gap-2" style={inputWrapperStyle}>
        {leadingIcon ? (
          /* When a leading icon is provided, swap to a wrapper that owns the
           * border/ring so the icon sits visually INSIDE the field. */
          <div className="relative flex h-9 max-w-[28rem] flex-1 items-center rounded-md bg-white ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-ring/40">
            <span className="pointer-events-none flex h-full w-7 items-center justify-center text-slate-400">
              {leadingIcon}
            </span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={placeholder}
              className="h-full w-full bg-transparent pl-0 pr-2.5 text-[16px] outline-none"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancel();
                }
              }}
            />
          </div>
        ) : (
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={placeholder}
            className={inputClassName ?? "h-9 w-full rounded-md bg-white px-2.5 text-[16px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        )}
      </div>
      <div className="flex items-center gap-2" style={rightSlotStyle}>
        {extras}
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-45"
          aria-label="Save"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"
          aria-label="Cancel"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </form>
  );
}

/**
 * Self-contained inline form for creating an initiative scoped to a
 * specific quarter (rendered when the user clicks the `+` on a quarter
 * folder header). Holds the typed title in LOCAL state so each keystroke
 * only re-renders this component — not the whole BacklogPlanningPanel
 * (which is 7k lines and ~600 rows on demo data, easily 300-900ms per
 * render). The previous version bound the input to the panel's
 * `createDraftTitle` state, which made typing in this field unusably
 * laggy.
 */
function QuarterInitiativeCreateForm({
  placeholder,
  indentPx,
  submitting,
  onSubmit,
  onCancel,
  leadingIcon,
  extras,
  canSubmitExtra = true,
}: {
  placeholder: string;
  indentPx: number;
  submitting: boolean;
  onSubmit: (title: string) => void;
  onCancel: () => void;
  /** Type-affordance icon shown inside the input (left side) so the user
   *  knows what kind of work item this composer will create. */
  leadingIcon?: ReactNode;
  /** Optional UI rendered to the right of the input (e.g. roadmap selector). */
  extras?: ReactNode;
  /** Additional submit gate — when false, save is disabled even with a valid
   *  title. Used by the header initiative form to require a roadmap pick. */
  canSubmitExtra?: boolean;
}) {
  const [title, setTitle] = useState("");
  const trimmed = title.trim();
  const canSubmit = trimmed.length >= 2 && !submitting && canSubmitExtra;
  return (
    <div className="border-b border-slate-200/80 bg-slate-50 px-3 py-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit(trimmed);
        }}
        className="flex items-center gap-2"
        style={{ paddingLeft: indentPx }}
      >
        <div className="relative flex h-8 max-w-[28rem] flex-1 items-center rounded-md bg-white ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-ring/40">
          {leadingIcon ? (
            <span className="pointer-events-none flex h-full w-7 items-center justify-center text-slate-400">
              {leadingIcon}
            </span>
          ) : null}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={placeholder}
            className={cn(
              "h-full w-full bg-transparent pr-2.5 text-[14px] outline-none",
              leadingIcon ? "pl-0" : "pl-2.5",
            )}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </div>
        {extras}
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-45"
          aria-label="Save"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"
          aria-label="Cancel"
        >
          <X className="size-3.5" />
        </button>
      </form>
    </div>
  );
}

/**
 * Self-contained roadmap create form — name + years picker. Mirrors the
 * roadmap planning header's create flow (1-4 years selectable from this
 * calendar year forward). Keeps state local so keystrokes don't re-render
 * the whole 7k-line backlog panel.
 */
function IsolatedRoadmapCreateForm({
  indentPx,
  submitting,
  onSubmit,
  onCancel,
}: {
  indentPx: number;
  submitting: boolean;
  onSubmit: (name: string, years: number[]) => void;
  onCancel: () => void;
}) {
  const currentCalYear = new Date().getFullYear();
  const [name, setName] = useState("");
  const [years, setYears] = useState<number[]>([currentCalYear]);
  const trimmed = name.trim();
  const canSubmit = trimmed.length >= 2 && years.length > 0 && !submitting;
  return (
    <div className="border-b border-slate-200/80 bg-slate-50 px-3 py-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit(trimmed, [...years].sort());
        }}
        className="flex flex-wrap items-center gap-2"
        style={{ paddingLeft: indentPx }}
      >
        <div className="relative flex h-8 max-w-[24rem] flex-1 items-center rounded-md bg-white ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-ring/40">
          <span className="pointer-events-none flex h-full w-7 items-center justify-center text-indigo-500">
            <MapIcon className="size-3.5" aria-hidden />
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New roadmap name…"
            className="h-full w-full bg-transparent pl-0 pr-2.5 text-[14px] outline-none"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Years
          </span>
          {[0, 1, 2, 3].map((i) => {
            const y = currentCalYear + i;
            const checked = years.includes(y);
            return (
              <button
                key={y}
                type="button"
                onClick={() =>
                  setYears((prev) => (checked ? prev.filter((x) => x !== y) : [...prev, y]))
                }
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[12px] font-medium transition",
                  checked
                    ? "border-indigo-400 bg-indigo-50 text-indigo-950"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50",
                )}
              >
                {y}
              </button>
            );
          })}
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-45"
          aria-label="Save"
          title={
            !trimmed ? "Enter a roadmap name" : years.length === 0 ? "Pick at least one year" : "Save"
          }
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"
          aria-label="Cancel"
        >
          <X className="size-3.5" />
        </button>
      </form>
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
  onCreateRoadmapQuick,
  onRenameRoadmap,
  onJumpToRoadmapPlanning,
  onCreateEpicQuick,
  onCreateStoryQuick,
  onPatchStoryQuick,
  onPatchInitiativeQuick,
  onPatchEpicQuick,
  summaryBarPortalElement,
  suppressInlineChips,
  workspaceDirectoryUsers,
}: BacklogPlanningPanelProps) {
  // Render-time diagnostic: count + time every commit to help spot whether
  // slowness is the mount itself, re-renders from a parent, or some heavy
  // useMemo recomputing on every change.
  const renderStartRef = useRef<number>(0);
  renderStartRef.current = typeof performance !== "undefined" ? performance.now() : 0;
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    const t = typeof performance !== "undefined" ? performance.now() : 0;
    const renderMs = renderStartRef.current ? Math.round(t - renderStartRef.current) : 0;
    if (isFirstRenderRef.current) {
      console.log("[backlog] panel: first render committed", { renderMs });
      isFirstRenderRef.current = false;
    } else {
      console.log("[backlog] panel: re-render", { renderCount: renderCountRef.current, renderMs });
    }
  });
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
  /** Hierarchical parent filter — holds initiative IDs and/or epic IDs the user
   *  ticked in the Parent picker. A row matches if either its initiativeId or
   *  its epicId is in the set. Empty array = no filter. */
  const [parentFilter, setParentFilter] = useState<string[]>([]);
  const [workItemFilter, setWorkItemFilter] = useState<WorkItemKindFilter[]>([]);
  const [sortBy, setSortBy] = useState<BacklogSortBy>("titleAsc");
  // Per-column header sort: overrides initiative ordering when non-null. Third
  // click on the same header clears back to null so the saved-view sort wins.
  const [columnSort, setColumnSort] = useState<BacklogColumnSort>(null);
  function toggleColumnSort(key: BacklogColumnKey) {
    setColumnSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }
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
  /** Roadmap picked when the user uses the header "+" to create an
   *  initiative. Empty string = "no roadmap chosen yet" — required for the
   *  form to submit (see `canSubmitExtra`). */
  const [initiativeTargetRoadmapId, setInitiativeTargetRoadmapId] = useState<string>("");
  /** When true, an inline roadmap-create form appears BELOW the initiative
   *  composer so the user can spin up a roadmap without losing the title
   *  they've already typed. Cleared after create succeeds or cancels. */
  const [inlineCreatingRoadmap, setInlineCreatingRoadmap] = useState(false);
  /** Roadmap inline-edit target. Null = not editing. Active id swaps the
   *  folder label for an `IsolatedTextInput` until save / cancel. */
  const [editingRoadmapId, setEditingRoadmapId] = useState<string | null>(null);
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const [groupLevels, setGroupLevels] = useState<GroupLevel[]>(["roadmap", "year", "quarter"]);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [openGroupFolders, setOpenGroupFolders] = useState<Record<string, boolean>>({});
  const [defaultTreeExpanded, setDefaultTreeExpanded] = useState(true);
  // Default group folders open so the user sees the roadmap → year → quarter tree on first load.
  // The O(N²) `.find()` removal earlier in this file makes eager expansion fast enough.
  const [defaultGroupExpanded, setDefaultGroupExpanded] = useState(true);
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
  // Inline editor for an epic's `originalEstimateDays` (the per-epic budget
  // shown in the "Est" column). String value to preserve user input mid-typing.
  const [editingEpicEstimate, setEditingEpicEstimate] = useState<{ id: string; value: string } | null>(null);
  // Track newly-created user story so it can be bubbled to the top of its
  // epic's story list — mirrors the `newestInitiativeId` pattern in the
  // middle panel. Reset on each render of `initiatives` via the effect
  // below; persists in state so the sort can read it.
  const [newestStoryId, setNewestStoryId] = useState<string | null>(null);
  const prevAllStoryIdsRef = useRef<Set<string>>(
    new Set(initiatives.flatMap((i) => (i.epics ?? []).flatMap((e) => (e.userStories ?? []).map((s) => s.id)))),
  );
  useEffect(() => {
    const currentIds = new Set(
      initiatives.flatMap((i) => (i.epics ?? []).flatMap((e) => (e.userStories ?? []).map((s) => s.id))),
    );
    const newId = [...currentIds].find((id) => !prevAllStoryIdsRef.current.has(id)) ?? null;
    prevAllStoryIdsRef.current = currentIds;
    if (newId) setNewestStoryId(newId);
  }, [initiatives]);
  // Same idea for epics — pins the newly-created epic at the top of its
  // initiative's epic list so the user sees what they just made without
  // hunting for it among the alphabetical / API-creation-order siblings.
  const [newestEpicId, setNewestEpicId] = useState<string | null>(null);
  const prevAllEpicIdsRef = useRef<Set<string>>(
    new Set(initiatives.flatMap((i) => (i.epics ?? []).map((e) => e.id))),
  );
  useEffect(() => {
    const currentIds = new Set(initiatives.flatMap((i) => (i.epics ?? []).map((e) => e.id)));
    const newId = [...currentIds].find((id) => !prevAllEpicIdsRef.current.has(id)) ?? null;
    prevAllEpicIdsRef.current = currentIds;
    if (newId) setNewestEpicId(newId);
  }, [initiatives]);
  // …and for initiatives — pins a newly-created initiative at the top of
  // its containing group (e.g. the quarter bucket it landed in when the
  // user created it via the quarter folder's + button).
  const [newestInitiativeId, setNewestInitiativeId] = useState<string | null>(null);
  const prevInitiativeIdsRef = useRef<Set<string>>(new Set(initiatives.map((i) => i.id)));
  useEffect(() => {
    const currentIds = new Set(initiatives.map((i) => i.id));
    const newId = [...currentIds].find((id) => !prevInitiativeIdsRef.current.has(id)) ?? null;
    prevInitiativeIdsRef.current = currentIds;
    if (newId) setNewestInitiativeId(newId);
  }, [initiatives]);
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
    if (Object.keys(patch).length === 0) {
      console.log("[BacklogEdit] patchStoryInline noop (empty patch)", { storyId });
      return;
    }
    console.log("[BacklogEdit] patchStoryInline start", { storyId, patch });
    setSavingStoryId(storyId);
    try {
      await onPatchStoryQuick(storyId, patch);
      console.log("[BacklogEdit] patchStoryInline success", { storyId, patch });
    } catch (err) {
      console.error("[BacklogEdit] patchStoryInline error", { storyId, patch, err });
      throw err;
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
    // When the user explicitly picked a value (e.g. clicked a popover option), trust the override and skip
    // the state-guard — popover state changes can race with this handler and null out editingStoryCell
    // mid-flight, which previously caused the patch to be skipped (the editor closes but the change was
    // never sent → the cell visually reverts on the next refresh).
    if (nextValueOverride === undefined) {
      if (!editingStoryCell || editingStoryCell.storyId !== storyId || editingStoryCell.field !== field) return;
    }
    const nextRaw = (nextValueOverride ?? editingStoryCell?.value ?? "").trim();
    if (field === "status") {
      const next = nextRaw as "todo" | "inProgress" | "done" | "approved";
      if (next !== current.status) await patchStoryInline(storyId, { status: next });
    } else if (field === "sprint") {
      const next = nextRaw === "unscheduled" ? null : Number(nextRaw);
      if (next !== current.sprint) await patchStoryInline(storyId, { sprint: next });
    } else if (field === "assignee") {
      const next = nextRaw === "" ? null : nextRaw;
      const currentValue = current.assignee?.trim() || null;
      console.log("[BacklogEdit] confirmStoryCellEdit assignee", { storyId, nextRaw, next, currentValue, willPatch: next !== currentValue });
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

  /**
   * Helper: render an isolated text editor for an epic / initiative title.
   * Used by every parent-title edit site; keeps the input's typing local
   * to a tiny component instead of triggering full panel re-renders.
   */
  function renderParentTitleEditor(kind: "epic" | "initiative", id: string, currentTitle: string): ReactNode {
    const initial = editingParentTitle?.value ?? currentTitle;
    return (
      <IsolatedTextInput
        initial={initial}
        inputClassName="h-7 min-w-[180px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
        onCancel={() => setEditingParentTitle(null)}
        onSave={async (value) => {
          const next = value.trim();
          if (next.length >= 2 && next !== currentTitle) {
            try {
              if (kind === "initiative") await onPatchInitiativeQuick(id, { title: next });
              else await onPatchEpicQuick(id, { title: next });
              toast.success(`${kind === "initiative" ? "Initiative" : "Epic"} title updated`);
            } catch {
              toast.error(`Failed to update ${kind === "initiative" ? "initiative" : "epic"} title`);
            }
          }
          setEditingParentTitle(null);
        }}
      />
    );
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
  /** YYYY-MM-DD (day = 01) for the initiative month. Day is ignored on commit —
   *  the format only matches `TimelineDatePopover`'s expected ISO string so the
   *  same picker can be reused for both epic (date) and initiative (month). */
  function initiativeMonthInputValue(year: number, month: number | null | undefined): string {
    return `${year}-${pad2(month ?? 1)}-01`;
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
  async function commitEpicDateEdit(explicitRaw?: string) {
    if (!editingParentDate || editingParentDate.kind !== "epic") return;
    const raw = (explicitRaw ?? editingParentDate.value).trim();
    // YYYY-MM-DD from TimelineDatePopover (or the legacy native input).
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
  async function commitInitiativeDateEdit(explicitRaw?: string) {
    if (!editingParentDate || editingParentDate.kind !== "initiative") return;
    const raw = (explicitRaw ?? editingParentDate.value).trim();
    // Accept YYYY-MM-DD (from TimelineDatePopover — day is ignored) or YYYY-MM.
    const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(raw);
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
  /** Inline editor for epic (date) and initiative (month). Picking a day in
   *  the calendar commits immediately; closing/Escape cancels. */
  /** Per-render guard so the editor mounts at most once even when the same
   *  initiative/epic row appears in multiple group buckets (e.g. an initiative
   *  that spans Q1+Q2 renders in both quarter folders — without this, two
   *  popovers would stack on top of each other). Reset on every render. */
  const renderedDateEditorRef = useRef(false);
  renderedDateEditorRef.current = false;
  function renderParentDateEditor(args: {
    kind: "epic" | "initiative";
    id: string;
    field: "start" | "end";
  }): ReactNode {
    if (renderedDateEditorRef.current) return null;
    renderedDateEditorRef.current = true;
    const isEpic = args.kind === "epic";
    const initial = editingParentDate?.value ?? "";
    // The popover needs a year fallback for the case the value is blank.
    const yearFromValue = /^(\d{4})-/.exec(initial)?.[1];
    const fallbackYear = yearFromValue ? Number(yearFromValue) : new Date().getFullYear();
    return (
      <ParentDateEditorOverlay
        initialValue={initial}
        fallbackYear={fallbackYear}
        onCommit={(next) => {
          if (isEpic) void commitEpicDateEdit(next);
          else void commitInitiativeDateEdit(next);
        }}
        onCancel={() => setEditingParentDate(null)}
      />
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
    return (
      <ParentTeamEditor
        kind={args.kind}
        editingValue={editingParentTeam?.value ?? ""}
        onSelect={(v) => {
          setEditingParentTeam((prev) => (prev ? { ...prev, value: v } : prev));
          if (args.kind === "epic") void commitEpicTeamEdit(v);
          else void commitInitiativeTeamEdit(v);
        }}
        onCancel={() => setEditingParentTeam(null)}
      />
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
  function beginEpicEstimateEdit(epic: { id: string; originalEstimateDays?: number | null }) {
    setEditingEpicEstimate({ id: epic.id, value: String(epic.originalEstimateDays ?? 0) });
  }
  async function commitEpicEstimateEdit() {
    if (!editingEpicEstimate) return;
    const raw = editingEpicEstimate.value.trim();
    const parsed = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Estimate must be a non-negative number");
      return;
    }
    const next = Math.round(parsed);
    try {
      await onPatchEpicQuick(editingEpicEstimate.id, { originalEstimateDays: next });
      toast.success("Epic estimate updated");
    } catch {
      toast.error("Failed to update epic estimate");
      return;
    }
    setEditingEpicEstimate(null);
  }
  function isEditingEpicEstimate(id: string): boolean {
    return editingEpicEstimate?.id === id;
  }
  function renderEpicEstimateEditor(): ReactNode {
    if (!editingEpicEstimate) return null;
    const epicId = editingEpicEstimate.id;
    const initial = editingEpicEstimate.value;
    return (
      <span className="inline-flex items-center gap-1" onMouseDown={(event) => event.stopPropagation()}>
        <IsolatedTextInput
          initial={initial}
          inputType="number"
          ariaLabel="Epic estimate in days"
          minLength={0}
          saveOnBlur
          inputClassName="h-7 w-16 rounded-md bg-white px-2 text-center text-[14px] tabular-nums ring-1 ring-slate-200 outline-none"
          onCancel={() => setEditingEpicEstimate(null)}
          onSave={async (value) => {
            const raw = value.trim();
            const parsed = raw === "" ? 0 : Number(raw);
            if (!Number.isFinite(parsed) || parsed < 0) {
              toast.error("Estimate must be a non-negative number");
              return;
            }
            try {
              await onPatchEpicQuick(epicId, { originalEstimateDays: Math.round(parsed) });
              toast.success("Epic estimate updated");
              setEditingEpicEstimate(null);
            } catch {
              toast.error("Failed to update epic estimate");
            }
          }}
        />
        <span className="text-[12px] text-slate-500">d</span>
      </span>
    );
  }
  function isEditingParentLabels(kind: "epic" | "initiative", id: string): boolean {
    return (
      editingParentLabels !== null &&
      editingParentLabels.kind === kind &&
      editingParentLabels.id === id
    );
  }
  function renderParentLabelsEditor(args: { kind: "epic" | "initiative"; id: string }): ReactNode {
    const initial = editingParentLabels?.value ?? "";
    const patchFn = args.kind === "epic" ? onPatchEpicQuick : onPatchInitiativeQuick;
    const toastLabel = args.kind === "epic" ? "Epic labels" : "Initiative labels";
    return (
      <IsolatedTextInput
        initial={initial}
        placeholder="Comma-separated labels"
        minLength={0}
        saveOnBlur
        onCancel={() => setEditingParentLabels(null)}
        onSave={async (value) => {
          const next = value.trim() === "" ? null : value.trim();
          try {
            await patchFn(args.id, { labels: next });
            toast.success(`${toastLabel} updated`);
            setEditingParentLabels(null);
          } catch {
            toast.error(`Failed to update ${toastLabel.toLowerCase()}`);
          }
        }}
      />
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
    const storyFilterActive = statusFilter.length > 0 || sprintFilter.length > 0 || labelFilter.length > 0;
    return filtered
      .map((initiative) => {
        const originalHadEpics = (initiative.epics ?? []).length > 0;
        const epics = (initiative.epics ?? [])
          .map((epic) => {
            const originalHadStories = (epic.userStories ?? []).length > 0;
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
            return { epic, originalHadStories, stories };
          })
          // Keep epics whose stories survived a story-level filter, OR
          // brand-new epics that never had stories (so users see things
          // they just created even with filters active).
          .filter(({ originalHadStories, stories }) => {
            if (!storyFilterActive) return true;
            if (!originalHadStories) return true;
            return stories.length > 0;
          })
          .map(({ epic, stories }) => ({ ...epic, userStories: stories }));
        return { initiative, originalHadEpics, epics };
      })
      // Keep initiatives whose epics survived, OR brand-new initiatives that
      // never had epics (the just-created standalone case — without this, a
      // story-level filter would silently hide newly added initiatives).
      .filter(({ originalHadEpics, epics }) => {
        if (!storyFilterActive) return true;
        if (!originalHadEpics) return true;
        return epics.length > 0;
      })
      .map(({ initiative, epics }) => ({ ...initiative, epics }));
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
    // Surface EVERY known roadmap, even ones that don't have an initiative
    // yet — the user just created an empty roadmap and should still be able
    // to filter to it (e.g. to confirm it's empty, or before adding the
    // first initiative). The backlog already loads year=all/roadmapId=all
    // so a previously-hidden roadmap won't appear empty just because of
    // parent pre-filtering.
    return (roadmaps ?? [])
      .map((r) => ({ id: r.id, label: r.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [roadmaps]);

  /** Parent picker tree — built from the unfiltered initiatives so users can
   *  always re-select a parent they previously filtered out. Sorted by title. */
  const parentFilterTree = useMemo<BacklogParentFilterTree>(() => {
    return [...initiatives]
      .map((init) => ({
        initiativeId: init.id,
        initiativeTitle: init.title,
        epics: (init.epics ?? [])
          .map((epic) => ({ epicId: epic.id, epicTitle: epic.title }))
          .sort((a, b) => a.epicTitle.localeCompare(b.epicTitle)),
      }))
      .sort((a, b) => a.initiativeTitle.localeCompare(b.initiativeTitle));
  }, [initiatives]);

  const roadmapNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roadmaps ?? []) map.set(r.id, r.name);
    return map;
  }, [roadmaps]);

  const assigneeNameSuggestions = useMemo(
    () => collectAssigneeNameSuggestions(initiatives, workspaceDirectoryUsers),
    [initiatives, workspaceDirectoryUsers],
  );

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
    const allowed = rosterNamesForDeliveryTeams(teamFilter, workspaceDirectoryUsers);
    const merged = new Set<string>();
    for (const n of data) {
      if (allowed.has(n)) merged.add(n);
    }
    for (const n of allowed) merged.add(n);
    const rest = [...merged].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return ["Unassigned", ...rest];
  }, [assigneeNameSuggestions, teamFilter, workspaceDirectoryUsers]);

  useEffect(() => {
    if (teamFilter.length === 0) return;
    const allowed = rosterNamesForDeliveryTeams(teamFilter, workspaceDirectoryUsers);
    setAssigneeFilter((prev) => prev.filter((n) => n === "Unassigned" || allowed.has(n)));
  }, [teamFilter, workspaceDirectoryUsers]);

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
    /** Parent filter: ticking an initiative keeps all its epics; ticking only
     *  certain epics restricts to those epics. The hierarchical picker enforces
     *  cascade-tick at write time, so here we only check membership. */
    const parentFilterSet = new Set(parentFilter);
    return filteredWithControls
      .map((initiative) => {
        if (roadmapFilter.length > 0 && (!initiative.roadmapId || !roadmapFilter.includes(initiative.roadmapId))) return null;
        if (yearFilter.length > 0 && !yearFilter.includes(String(initiative.year))) return null;
        const initiativeInParentFilter = parentFilterSet.has(initiative.id);
        const initiativeQuarterMatch = matchesAnySelectedQuarterByRange(
          quarterFilter,
          initiative.startMonth,
          initiative.endMonth,
        );
        const initAssignee = initiative.assignee?.trim() || "Unassigned";
        const epics = (initiative.epics ?? [])
          .map((epic) => {
            if (parentFilterSet.size > 0 && !initiativeInParentFilter && !parentFilterSet.has(epic.id)) return null;
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

        if (parentFilterSet.size > 0 && !initiativeInParentFilter && epics.length === 0) return null;
        const initiativeAssigneeMatch = assigneeFilter.length === 0 || assigneeFilter.includes(initAssignee);
        if (assigneeFilter.length > 0 && epics.length === 0 && !initiativeAssigneeMatch) return null;
        if (!initiativeQuarterMatch && epics.length === 0 && quarterFilter.length > 0) return null;
        if (epics.length === 0 && !initiativeQuarterMatch) return null;
        return { ...initiative, epics };
      })
      .filter(Boolean) as typeof filteredWithControls;
  }, [filteredWithControls, roadmapFilter, yearFilter, quarterFilter, teamFilter, assigneeFilter, parentFilter]);

  const fullyFiltered = useMemo(() => {
    const base = applyWorkItemKindFilter(backlogFilteredBeforeWorkItem, workItemFilter);
    // When the user clicks a column header, columnSort takes priority over the
    // saved-view sortBy (which still governs per-epic story ordering inside
    // `filteredWithControls`). Cleared (null) → fall back to the upstream order.
    if (columnSort) return [...base].sort((a, b) => compareByColumn(a, b, columnSort));
    return base;
  }, [backlogFilteredBeforeWorkItem, workItemFilter, columnSort]);
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

  /** Parent cell — story rows show "Initiative · Epic" (both clickable);
   *  epic rows show just the initiative; initiative rows show "—".
   *  Used by the new Parent column to keep hierarchy visible alongside any
   *  group-by choice (so users can flatten by status/sprint and still see
   *  what each row belongs to). */
  /** Type-affordance icon for an inline create form, so the user can see at
   *  a glance whether the composer will create an initiative, epic, or
   *  story (matches what's shown in the corresponding row icon). */
  function createKindIcon(kind: CreateKind): ReactNode {
    // Use the canonical icons from epic-plan-bar so the composer field matches
    // the row icons used everywhere else (Zap for initiative, Folder for epic).
    if (kind === "initiative") return <InitiativePlanBarIcon className="mr-0 [&_svg]:size-3.5" />;
    if (kind === "epic") return <EpicPlanBarIcon className="mr-0 text-slate-500 [&_svg]:size-3.5" />;
    return <UserStoryIcon className="size-4" />;
  }

  function renderParentCell(args: {
    initiativeId?: string | null;
    initiativeTitle?: string | null;
    epicId?: string | null;
    epicTitle?: string | null;
  }): ReactNode {
    const parts: ReactNode[] = [];
    if (args.initiativeId && args.initiativeTitle) {
      parts.push(
        <button
          key="init"
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenInitiative(args.initiativeId!); }}
          className="min-w-0 max-w-[14rem] truncate rounded px-1 text-left text-[14px] text-slate-700 hover:bg-indigo-50 hover:underline hover:decoration-slate-400 hover:underline-offset-2"
          title={args.initiativeTitle ?? undefined}
        >
          {args.initiativeTitle}
        </button>,
      );
    }
    if (args.epicId && args.epicTitle) {
      if (parts.length > 0) {
        parts.push(<span key="sep" className="shrink-0 text-slate-400">·</span>);
      }
      parts.push(
        <button
          key="epic"
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenEpic(args.epicId!); }}
          className="min-w-0 max-w-[14rem] truncate rounded px-1 text-left text-[14px] text-slate-700 hover:bg-indigo-50 hover:underline hover:decoration-slate-400 hover:underline-offset-2"
          title={args.epicTitle ?? undefined}
        >
          {args.epicTitle}
        </button>,
      );
    }
    if (parts.length === 0) {
      return <span className="text-[16px] text-slate-400">-</span>;
    }
    return <span className="inline-flex min-w-0 items-center gap-1 overflow-hidden">{parts}</span>;
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
              // Hidden while the cell is in edit mode — each `group-has-[…]/cell:hidden` rule applies when
              // the cell contains one of: native form element (inline editors) or an explicit
              // `data-cell-editing` marker (portal-anchored status / team / date editors).
              // Multiple rules used (instead of `:is(...)`) so Tailwind v4 generates each simple selector reliably.
              className="pointer-events-auto absolute right-1 top-1/2 z-20 shrink-0 -translate-y-1/2 opacity-0 transition-opacity group-hover/cell:opacity-100 group-has-[input]/cell:hidden group-has-[select]/cell:hidden group-has-[textarea]/cell:hidden group-has-[[data-cell-editing]]/cell:hidden"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <EditRowIconButton label="Edit" onClick={hint.onEdit} />
            </span>
          ) : (
            <span
              title="Read only"
              aria-label="Read only"
              className="pointer-events-none absolute right-1 top-1/2 z-20 shrink-0 -translate-y-1/2 inline-flex size-7 items-center justify-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-200/80 opacity-0 transition-opacity group-hover/cell:opacity-100 group-has-[input]/cell:hidden group-has-[select]/cell:hidden group-has-[textarea]/cell:hidden group-has-[[data-cell-editing]]/cell:hidden"
            >
              <Lock className="size-3.5" strokeWidth={2} aria-hidden />
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
            // Quarter the story actually lives in — derived from its sprint
            // number (sprint → month → quarter). Stories without a sprint
            // land in an "Unscheduled" bucket. Used by quarter grouping so a
            // story shows under the quarter where its work happens, not under
            // its initiative's start quarter. Null → Unscheduled.
            storyQuarterLabelValue: story.sprint != null
              ? quarterFromMonth(monthLaneFromGlobalSprint(story.sprint).month)
              : null,
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
            workPlanStart: workPlan.start,
            workPlanEnd: workPlan.end,
          };
        }),
      ),
    );
  }, [fullyFiltered]);

  // Sort the story-row list by the user's column choice. The bucket renderer preserves iteration order
  // when filling groups, so sorting here causes rows to appear in the chosen order both flat AND inside
  // each group bucket. Bucket order itself stays alphabetical (group-by isn't changed).
  const sortedGroupedStoryRows = useMemo(() => {
    if (!columnSort) return groupedStoryRows;
    const dir = columnSort.dir === "asc" ? 1 : -1;
    const key = columnSort.key;
    const STATUS_RANK: Record<string, number> = { todo: 0, inProgress: 1, done: 2, approved: 3 };
    const arr = [...groupedStoryRows];
    arr.sort((a, b) => {
      switch (key) {
        case "workItem":
          return dir * a.storyTitle.localeCompare(b.storyTitle);
        case "status":
          return dir * ((STATUS_RANK[a.storyStatus] ?? 99) - (STATUS_RANK[b.storyStatus] ?? 99));
        case "team":
          return dir * (a.teamId ?? "").localeCompare(b.teamId ?? "");
        case "assignee":
          return dir * a.storyAssignee.localeCompare(b.storyAssignee);
        case "sprint":
          return dir * ((a.storySprintNum ?? Number.MAX_SAFE_INTEGER) - (b.storySprintNum ?? Number.MAX_SAFE_INTEGER));
        case "estDays":
          return dir * (a.storyEstimatedDays - b.storyEstimatedDays);
        case "daysLeft":
          return dir * (a.storyDaysLeft - b.storyDaysLeft);
        case "epicOriginalEst":
          return dir * (a.epicOriginalEstimateDays - b.epicOriginalEstimateDays);
        case "labels":
          return dir * (a.storyLabels ?? "").localeCompare(b.storyLabels ?? "");
        case "year":
          return dir * (Number(a.initiativeYear) - Number(b.initiativeYear));
        case "quarter":
          return dir * (a.quarterLabelValue ?? "").localeCompare(b.quarterLabelValue ?? "");
        case "month":
          return dir * ((a.monthNum ?? 99) - (b.monthNum ?? 99));
        case "startDate":
          return dir * ((a.workPlanStart?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.workPlanStart?.getTime() ?? Number.MAX_SAFE_INTEGER));
        case "endDate":
          return dir * ((a.workPlanEnd?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.workPlanEnd?.getTime() ?? Number.MAX_SAFE_INTEGER));
        case "progress": {
          const ap = a.storyEstimatedDays > 0 ? (a.storyEstimatedDays - a.storyDaysLeft) / a.storyEstimatedDays : 0;
          const bp = b.storyEstimatedDays > 0 ? (b.storyEstimatedDays - b.storyDaysLeft) / b.storyEstimatedDays : 0;
          return dir * (ap - bp);
        }
        default:
          return 0;
      }
    });
    return arr;
  }, [groupedStoryRows, columnSort]);
  const groupedStandaloneInitiatives = useMemo(() => {
    return fullyFiltered
      .filter((initiative) => (initiative.epics ?? []).every((epic) => (epic.userStories ?? []).length === 0))
      .map((initiative) => {
        // Initiative-level month/quarter is now derived as the min of its
        // child epics' planStartMonth — `initiative.startMonth` itself is
        // legacy/ignored, and never falls back into the epic-level fields.
        const scheduledEpicMonths = (initiative.epics ?? [])
          .map((epic) => epic.planStartMonth)
          .filter((m): m is number => m != null);
        const derivedInitiativeMonth = scheduledEpicMonths.length > 0 ? Math.min(...scheduledEpicMonths) : null;
        return {
          initiativeId: initiative.id,
          initiativeTitle: initiative.title,
          initiativeYear: String(initiative.year),
          initiativeRoadmapId: initiative.roadmapId ?? "",
          initiativeRoadmapLabel: initiative.roadmapId ? (roadmapNameById.get(initiative.roadmapId) ?? initiative.roadmapId) : "No roadmap",
          initiativeStatus: rollupWorkflowStatus([]),
          initiativeAssignee: initiative.assignee?.trim() || "Unassigned",
          initiativeMonthNum: derivedInitiativeMonth,
          initiativeMonthLabelValue: monthLabel(derivedInitiativeMonth),
          initiativeQuarterLabelValue: quarterFromMonth(derivedInitiativeMonth),
          initiativeTeamId: aggregateInitiativeTeamId(initiative),
          epics: (initiative.epics ?? []).map((epic) => ({
            epicId: epic.id,
            epicTitle: epic.title,
            epicAssignee: epic.assignee?.trim() || "Unassigned",
            epicOriginalEstimateDays: epic.originalEstimateDays ?? 0,
            epicTeamId: (epic.team ?? null) as string | null,
            // Unscheduled epics keep `null` here — no longer borrow from the
            // initiative's legacy month. That borrowing was the source of
            // "ghost" Q-bucketing for empty initiatives.
            epicMonthNum: epic.planStartMonth ?? null,
            epicMonthLabelValue: monthLabel(epic.planStartMonth),
            epicQuarterLabelValue: quarterFromMonth(epic.planStartMonth),
          })),
        };
      });
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
  // Group-by and column sort coexist: buckets stay in their natural order (alphabetical by label),
  // while rows WITHIN each bucket reflect the column sort because `fullyFiltered` is sorted by
  // `compareByColumn` and `renderGroupedTree` preserves that iteration order when filling buckets.
  const effectiveGroupLevels = groupLevels;
  const hasAnyActiveFilter =
    yearFilter.length > 0 ||
    quarterFilter.length > 0 ||
    statusFilter.length > 0 ||
    sprintFilter.length > 0 ||
    teamFilter.length > 0 ||
    assigneeFilter.length > 0 ||
    labelFilter.length > 0 ||
    roadmapFilter.length > 0 ||
    parentFilter.length > 0 ||
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
    setParentFilter([]);
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
      // Bucket each STORY by its sprint's quarter (where the work actually
      // happens), not by the parent initiative's start quarter. Stories
      // without a sprint go to "Unscheduled". A spanning initiative/epic
      // naturally reappears in multiple quarter buckets because each of its
      // stories lands in whichever quarter its sprint belongs to.
      const q = quarterLabelOrUnscheduled(row.storyQuarterLabelValue);
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
      .sort((a, b) => {
        // The just-created story wins — keeps it pinned at the top of its
        // epic's list until the next reload / new story, so the user
        // doesn't have to hunt for the row they just made.
        if (newestStoryId != null) {
          if (a.storyId === newestStoryId) return -1;
          if (b.storyId === newestStoryId) return 1;
        }
        return a.storyTitle.localeCompare(b.storyTitle);
      })
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
                      <IsolatedTextInput
                        initial={editingStoryTitle.value}
                        inputClassName="h-7 min-w-[180px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                        onCancel={() => setEditingStoryTitle(null)}
                        onSave={async (value) => {
                          const next = value.trim();
                          if (next.length >= 2 && next !== row.storyTitle) {
                            await patchStoryInline(row.storyId, { title: next });
                            toast.success("User story title updated");
                          }
                          setEditingStoryTitle(null);
                        }}
                      />
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
                <span className="inline-flex items-center justify-center gap-1.5 text-[14px] tabular-nums text-slate-700">
                  {/* storyStartDateLabel is the formatted string (em-dash when null), so also skip on "—" */}
                  {row.storyStartDateLabel && row.storyStartDateLabel !== "—" ? <CalendarDays className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
                  {row.storyStartDateLabel}
                </span>
              ),
              endDate: (
                <span className="inline-flex items-center justify-center gap-1.5 text-[14px] tabular-nums text-slate-700">
                  {row.storyEndDateLabel && row.storyEndDateLabel !== "—" ? <CalendarRange className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
                  {row.storyEndDateLabel}
                </span>
              ),
              status: (
            <span className={cn("relative inline-flex min-w-[104px] items-center justify-center justify-self-center rounded-full px-3 py-[3px] text-[13px] font-semibold tracking-wide", statusChip(row.storyStatus))}>
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "status" ? (
                <StoryStatusEditor
                  currentValue={editingStoryCell.value as WorkflowStatus}
                  onSelect={(v) => {
                    setEditingStoryCell((prev) => (prev ? { ...prev, value: v } : prev));
                    void confirmStoryCellEdit(row.storyId, "status", storyEditSnapshotFromGroupedRow(row), v);
                  }}
                  onCancel={cancelStoryCellEdit}
                />
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
                <SprintSelectEditor
                  currentValue={editingStoryCell.value}
                  options={assignableSprintsForYear(Number(row.initiativeYear))}
                  onSelect={(v) => {
                    setEditingStoryCell((prev) => (prev ? { ...prev, value: v } : prev));
                    void confirmStoryCellEdit(row.storyId, "sprint", storyEditSnapshotFromGroupedRow(row), v);
                  }}
                  onCancel={cancelStoryCellEdit}
                />
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
                  className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-100"
                >
                  <Flag className="size-3.5 shrink-0 text-rose-500" aria-hidden />
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
                    directoryUsers={workspaceDirectoryUsers}
                    showLeadingAvatar
                    placeholder="Unassigned"
                    className="h-7 w-full min-w-[104px] rounded-md bg-white pl-7 pr-2 text-[16px] ring-1 ring-slate-200 outline-none"
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
                  <BacklogRowAvatar name={row.storyAssignee} directoryUsers={workspaceDirectoryUsers} />
                  {row.storyAssignee}
                </button>
              )}
            </span>
              ),
              parent: renderParentCell({
                epicId: row.epicId,
                epicTitle: row.epicTitle,
              }),
              labels: (
            <div className="w-full min-w-0 overflow-hidden">
              {editingStoryCell?.storyId === row.storyId && editingStoryCell.field === "labels" ? (
                <div className="mx-auto flex w-full min-w-0 max-w-full flex-col gap-1.5 rounded-lg border border-indigo-200/55 bg-gradient-to-b from-white to-slate-50/95 p-2 shadow-sm ring-1 ring-slate-200/45">
                  <IsolatedStoryCellTextEditor
                    initial={editingStoryCell.value}
                    multiline
                    placeholder="Comma-separated labels"
                    className="min-h-[2.5rem] w-full min-w-0 rounded-md border border-slate-200/80 bg-white px-2 py-1.5 text-left text-[14px] leading-snug text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200/70"
                    onCancel={cancelStoryCellEdit}
                    onSave={(value) =>
                      confirmStoryCellEdit(row.storyId, "labels", storyEditSnapshotFromGroupedRow(row), value)
                    }
                  />
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
                <IsolatedStoryCellTextEditor
                  initial={editingStoryCell.value}
                  inputType="number"
                  className="h-7 w-20 rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                  onCancel={cancelStoryCellEdit}
                  onSave={(value) =>
                    confirmStoryCellEdit(row.storyId, "estimatedDays", storyEditSnapshotFromGroupedRow(row), value)
                  }
                />
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
                <IsolatedStoryCellTextEditor
                  initial={editingStoryCell.value}
                  inputType="number"
                  className="h-7 w-20 rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                  onCancel={cancelStoryCellEdit}
                  onSave={(value) =>
                    confirmStoryCellEdit(row.storyId, "daysLeft", storyEditSnapshotFromGroupedRow(row), value)
                  }
                />
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
    /** Trailing UI shown to the right of the folder title (used by the
     *  quarter folder's `+ Add initiative` button). */
    trailingAction?: React.ReactNode,
    /** When provided, overrides `defaultGroupExpanded` for the FIRST render of
     *  this folder. Used to start empty quarter folders collapsed so the
     *  always-rendered Q1-Q4 scaffolding doesn't fill the screen with blank
     *  rows. The user's explicit toggle (saved in `openGroupFolders`) still
     *  wins after they interact with the folder. */
    defaultOpenOverride?: boolean,
    /** When provided, replaces the rendered `<span>{label}</span>` (e.g. an
     *  inline rename editor for roadmaps). The `label` arg is still used for
     *  zebra-stripe data attributes so DOM diagnostics keep working. */
    labelOverride?: React.ReactNode,
  ) {
    const isOpen = openGroupFolders[folderId] ?? (defaultOpenOverride ?? defaultGroupExpanded);
    const renderedChildren = isOpen ? renderChildren() : null;
    return (
      <div key={folderId}>
        <div
          className={cn("group/workitem grid min-w-full w-max items-center gap-2 border-b border-slate-200/80 py-1.5 hover:!bg-indigo-50/40")}
          style={{ gridTemplateColumns: tableGridTemplate }}
          data-backlog-zebra-row="true"
          data-backlog-zebra-kind="folder"
          data-backlog-zebra-label={label}
        >
          {renderBacklogCells({
            workItem: (
              <div className="relative flex min-w-0 items-center gap-1.5">
                <BacklogTreeConnector indentPx={indentPx} />
                <button
                  type="button"
                  onClick={() => setOpenGroupFolders((prev) => ({ ...prev, [folderId]: !(prev[folderId] ?? (defaultOpenOverride ?? defaultGroupExpanded)) }))}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[16px] font-semibold text-slate-700"
                  style={{ paddingLeft: indentPx }}
                >
                  {isOpen ? <ChevronDown className="size-4 shrink-0 text-slate-500" /> : <ChevronRight className="size-4 shrink-0 text-slate-500" />}
                  {leadingIcon}
                  {labelOverride ?? <span className="truncate">{label}</span>}
                  <span className="shrink-0 text-[12px] font-normal tabular-nums text-slate-500">({count})</span>
                </button>
                {trailingAction}
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
            parent: <span className="text-[16px] text-slate-400">-</span>,
            labels: <BacklogLabelsEmptyRowSlot />,
            estDays: <span className="text-center text-[16px] text-slate-400">-</span>,
            epicOriginalEst: <span className="text-center text-[16px] text-slate-400">-</span>,
            daysLeft: <span className="text-center text-[16px] text-slate-400">-</span>,
            progress: <span className="text-center text-[16px] text-slate-400">-</span>,
          }, {
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
                      renderParentTitleEditor("epic", epicId, epicTitle)
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
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-40 ring-1 ring-slate-200 text-slate-700 transition hover:bg-white hover:text-slate-900 group-hover/workitem:opacity-100 focus-visible:opacity-100"
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
                <span className="inline-flex items-center justify-center gap-1.5 text-[14px] tabular-nums text-slate-700">
                  {isEditingParentDate("epic", epicId, "start") ? (
                    renderParentDateEditor({ kind: "epic", id: epicId, field: "start" })
                  ) : (
                    <>
                      {epicGanttRange.start ? <CalendarDays className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
                      {formatBacklogPlanDate(epicGanttRange.start)}
                    </>
                  )}
                </span>
              ),
              endDate: (
                <span className="inline-flex items-center justify-center gap-1.5 text-[14px] tabular-nums text-slate-700">
                  {isEditingParentDate("epic", epicId, "end") ? (
                    renderParentDateEditor({ kind: "epic", id: epicId, field: "end" })
                  ) : (
                    <>
                      {epicGanttRange.end ? <CalendarRange className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
                      {formatBacklogPlanDate(epicGanttRange.end)}
                    </>
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
                    directoryUsers={workspaceDirectoryUsers}
                    showLeadingAvatar
                        placeholder="Unassigned"
                        className="h-7 w-full min-w-[104px] rounded-md bg-white pl-7 pr-2 text-[16px] ring-1 ring-slate-200 outline-none"
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
                      <BacklogRowAvatar name={epicAssignee} directoryUsers={workspaceDirectoryUsers} />
                      {epicAssignee}
                    </button>
                  )}
                </span>
              ),
              parent: renderParentCell({
                initiativeId: epicRows[0]?.initiativeId,
                initiativeTitle: epicRows[0]?.initiativeTitle,
              }),
              labels: isEditingParentLabels("epic", epicId) ? (
                renderParentLabelsEditor({ kind: "epic", id: epicId })
              ) : (
                <BacklogLabelsChipPanel
                  labelsSerialized={epicModelForRow?.labels}
                  onMouseDownBeginEdit={(event) => {
                    event.preventDefault();
                    beginEpicLabelsEdit({ id: epicId, labels: epicModelForRow?.labels ?? null });
                  }}
                />
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
              epicOriginalEst: isEditingEpicEstimate(epicId) ? (
                renderEpicEstimateEditor()
              ) : (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    beginEpicEstimateEdit({ id: epicId, originalEstimateDays: originalEstimate });
                  }}
                  className="w-full text-center text-[16px] font-medium text-slate-600 hover:text-indigo-600"
                  title="Click to edit estimate"
                >
                  {originalEstimate}d
                </button>
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
              epicOriginalEst: { kind: "edit", onEdit: () => beginEpicEstimateEdit({ id: epicId, originalEstimateDays: originalEstimate }) },
              daysLeft: { kind: "lock" },
              progress: { kind: "lock" },
            })}
          </div>
          {createSelection?.anchorKey === `group-epic:${epicId}` ? (
            <IsolatedCreateRowForm
              placeholder="Type user story title and press Enter..."
              formStyle={{ gridTemplateColumns: tableGridTemplate }}
              inputWrapperStyle={{ paddingLeft: epicIndentPx + 18 }}
              rightSlotStyle={createFormRestGridStyle}
              submitting={submittingKey === "create"}
              leadingIcon={createKindIcon("story")}
              onCancel={closeInlineCreator}
              onSubmit={(title) => { void handleCreateSubmit(null, title); }}
            />
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
                    <Zap className="size-4 shrink-0 text-sky-500" strokeWidth={1.9} />
                    {editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiativeId ? (
                      renderParentTitleEditor("initiative", initiativeId, initiativeTitle)
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
                  className={cn(backlogReadonlyInitiativeDateButtonClass, "inline-flex items-center justify-center gap-1.5")}
                >
                  {initGanttRange.start ? <CalendarDays className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
                  {formatBacklogPlanDate(initGanttRange.start)}
                </button>
              ),
              endDate: isEditingParentDate("initiative", initiativeId, "end") ? (
                renderParentDateEditor({ kind: "initiative", id: initiativeId, field: "end" })
              ) : (
                <button
                  type="button"
                  onClick={() => {}}
                  className={cn(backlogReadonlyInitiativeDateButtonClass, "inline-flex items-center justify-center gap-1.5")}
                >
                  {initGanttRange.end ? <CalendarRange className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
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
                    directoryUsers={workspaceDirectoryUsers}
                    showLeadingAvatar
                        placeholder="Unassigned"
                        className="h-7 w-full min-w-[104px] rounded-md bg-white pl-7 pr-2 text-[16px] ring-1 ring-slate-200 outline-none"
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
                      <BacklogRowAvatar name={initiativeAssignee} directoryUsers={workspaceDirectoryUsers} />
                      {initiativeAssignee}
                    </button>
                  )}
                </span>
              ),
              parent: <span className="text-[16px] text-slate-400">-</span>,
              labels: isEditingParentLabels("initiative", initiativeId) ? (
                renderParentLabelsEditor({ kind: "initiative", id: initiativeId })
              ) : (
                <BacklogLabelsChipPanel
                  labelsSerialized={initModelForRow?.labels}
                  onMouseDownBeginEdit={(event) => {
                    event.preventDefault();
                    beginInitiativeLabelsEdit({ id: initiativeId, labels: initModelForRow?.labels ?? null });
                  }}
                />
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
              team: { kind: "edit", onEdit: () => beginInitiativeTeamEdit({ id: initiativeId, team: initModelForRow?.team ?? null }) },
              assignee: { kind: "edit", onEdit: () => setEditingParentAssignee({ kind: "initiative", id: initiativeId, value: initiativeAssignee === "Unassigned" ? "" : initiativeAssignee }) },
              year: { kind: "lock" },
              quarter: { kind: "lock" },
              month: { kind: "lock" },
              // Initiative dates are derived from child epics — no inline edit.
              // The lock icon on hover signals "read-only by design" so users
              // know to plan via epics rather than typing here.
              startDate: { kind: "lock" },
              endDate: { kind: "lock" },
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
            <IsolatedCreateRowForm
              placeholder={createSelection.kind === "epic" ? "Type epic title and press Enter..." : "Type user story title and press Enter..."}
              formStyle={{ gridTemplateColumns: tableGridTemplate }}
              inputWrapperStyle={{ paddingLeft: initIndentPx + 18 }}
              rightSlotStyle={createFormRestGridStyle}
              submitting={submittingKey === "create"}
              leadingIcon={createKindIcon(createSelection.kind)}
              saveDisabledExtra={createSelection.kind === "story" && !storyTargetEpicId}
              extras={createSelection.kind === "story" ? (
                <select
                  value={storyTargetEpicId}
                  onChange={(event) => setStoryTargetEpicId(event.target.value)}
                  className="h-8 min-w-[180px] rounded-md bg-white px-2 text-[16px] ring-1 ring-slate-200 outline-none"
                >
                  {Array.from(new Map(initiativeRows.map((r) => [r.epicId, r.epicTitle])).entries()).map(([epicId, title]) => (
                    <option key={epicId} value={epicId}>{title}</option>
                  ))}
                </select>
              ) : undefined}
              onCancel={closeInlineCreator}
              onSubmit={(title) => { void handleCreateSubmit(null, title); }}
            />
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
                  .sort(([aId, aRows], [bId, bRows]) => {
                    if (newestEpicId != null) {
                      if (aId === newestEpicId) return -1;
                      if (bId === newestEpicId) return 1;
                    }
                    return aRows[0]?.epicTitle.localeCompare(bRows[0]?.epicTitle ?? "") ?? 0;
                  })
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
      const epicEntries = Array.from(byEpic.entries());
      // Honor the upstream sort when columnSort is active (Map preserves insertion order = sorted-row order).
      // Otherwise fall back to alphabetical-by-epic-title.
      if (!columnSort) {
        epicEntries.sort(([aId, aRows], [bId, bRows]) => {
          if (newestEpicId != null) {
            if (aId === newestEpicId) return -1;
            if (bId === newestEpicId) return 1;
          }
          return (aRows[0]?.epicTitle ?? "").localeCompare(bRows[0]?.epicTitle ?? "");
        });
      }
      return epicEntries.map(([epicId, epicRows]) => {
        const first = epicRows[0];
        return renderEpicRow(epicId, first.epicTitle, first.epicAssignee, epicRows, indentPx, path);
      });
    }

    const byInitiative = new Map<string, typeof groupedStoryRows>();
    for (const row of rows) {
      if (!byInitiative.has(row.initiativeId)) byInitiative.set(row.initiativeId, []);
      byInitiative.get(row.initiativeId)!.push(row);
    }

    const initiativeEntries = Array.from(byInitiative.entries());
    if (!columnSort) {
      initiativeEntries.sort((a, b) => (a[1][0]?.initiativeTitle ?? "").localeCompare(b[1][0]?.initiativeTitle ?? ""));
    }
    return initiativeEntries
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
    if (levelIndex >= effectiveGroupLevels.length) {
      return (
        <>
          {renderLeafRows(rows, levelIndex * 14, path)}
          {standaloneRows.length > 0 ? renderStandaloneInitiativeRows(standaloneRows, levelIndex * 14) : null}
        </>
      );
    }
    const level = effectiveGroupLevels[levelIndex];
    type Bucket = {
      label: string;
      sort: string;
      rows: typeof groupedStoryRows;
      standaloneRows: typeof groupedStandaloneInitiatives;
    };
    const groups = new Map<string, Bucket>();
    // When grouping by roadmap, seed the map with every known roadmap so
    // roadmaps with zero initiatives still get a (empty) header row. This
    // lets a brand-new "Roadmap2" be visible in the backlog even before
    // anyone has added an initiative to it. Honors the active roadmap
    // filter so the seeded buckets don't bypass it (the row data goes
    // through `backlogFilteredBeforeWorkItem` which DOES filter, but the
    // seed is independent — must replicate the filter here).
    if (level === "roadmap" && roadmaps && roadmaps.length > 0) {
      for (const r of roadmaps) {
        if (roadmapFilter.length > 0 && !roadmapFilter.includes(r.id)) continue;
        const key = r.id;
        const label = r.name;
        groups.set(key, { label, sort: label.toLowerCase(), rows: [], standaloneRows: [] });
      }
    }
    // Quarter level: always seed Q1-Q4 PLUS an "Unscheduled work" bucket so
    // the user has a predictable parking spot for any initiative/epic/story
    // whose epics aren't scheduled yet. New initiatives without scheduled
    // epics land here automatically instead of getting buried under a
    // dynamically-created folder users can miss.
    if (level === "quarter") {
      for (const q of ["Q1", "Q2", "Q3", "Q4"] as const) {
        groups.set(q, { label: q, sort: quarterSortValue(q), rows: [], standaloneRows: [] });
      }
      const unscheduledKey = "Unscheduled work";
      groups.set(unscheduledKey, {
        label: unscheduledKey,
        sort: quarterSortValue(unscheduledKey),
        rows: [],
        standaloneRows: [],
      });
    }
    for (const row of rows) {
      const { key, label, sort } = keyForLevel(row, level);
      if (!groups.has(key)) groups.set(key, { label, sort, rows: [], standaloneRows: [] });
      groups.get(key)!.rows.push(row);
    }
    // Quarter level: fan out each standalone initiative by its epics' own
    // quarters. An initiative with epics in Q1 AND Q2 appears in BOTH
    // quarter folders, each containing only the relevant epics. Unscheduled
    // epics (or initiatives with no epics) collect under "Unscheduled work".
    // This matches how story rows already cascade by sprint's quarter, so
    // the multi-instance behavior is consistent across the tree.
    if (level === "quarter") {
      for (const row of standaloneRows) {
        if (row.epics.length === 0) {
          groups.get("Unscheduled work")!.standaloneRows.push(row);
          continue;
        }
        const byQuarter = new Map<string, typeof row.epics>();
        for (const epic of row.epics) {
          const q = quarterLabelOrUnscheduled(epic.epicQuarterLabelValue);
          if (!byQuarter.has(q)) byQuarter.set(q, []);
          byQuarter.get(q)!.push(epic);
        }
        for (const [q, epics] of byQuarter.entries()) {
          if (!groups.has(q)) {
            groups.set(q, { label: q, sort: quarterSortValue(q), rows: [], standaloneRows: [] });
          }
          // Push a row variant containing only the epics for this quarter.
          // The renderer maps over row.epics directly, so this naturally
          // limits which epics appear under each quarter folder.
          groups.get(q)!.standaloneRows.push({ ...row, epics });
        }
      }
    } else {
      for (const row of standaloneRows) {
        const { key, label, sort } = keyForStandaloneLevel(row, level);
        if (!groups.has(key)) groups.set(key, { label, sort, rows: [], standaloneRows: [] });
        groups.get(key)!.standaloneRows.push(row);
      }
    }
    // Year level with no real data: seed the current calendar year so the
    // recursion can still descend into a quarter level for empty roadmaps.
    if (level === "year" && groups.size === 0) {
      const y = String(new Date().getFullYear());
      groups.set(y, { label: y, sort: y.padStart(4, "0"), rows: [], standaloneRows: [] });
    }
    return Array.from(groups.entries())
      .sort((a, b) => a[1].sort.localeCompare(b[1].sort))
      .map(([key, group]) => {
        const folderId = `${path}${level}:${key}`;
        // Trailing actions vary by level:
        //  - Quarter (Q1-Q4): "+ Add initiative" composer trigger
        //  - Quarter (Unscheduled work): "Schedule in Roadmap Planning" link
        //  - Roadmap: inline-edit pencil (hover-revealed) when rename is wired
        const trailingAction = level === "quarter" && key === "Unscheduled work" && onJumpToRoadmapPlanning ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onJumpToRoadmapPlanning();
            }}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-semibold text-sky-700 opacity-60 ring-1 ring-sky-200 transition hover:bg-sky-50 hover:opacity-100 group-hover/workitem:opacity-100 focus-visible:opacity-100"
            title="Open Roadmap Planning with Unscheduled epics filter"
            aria-label="Open Roadmap Planning to schedule these epics"
          >
            <ExternalLink className="size-3 text-sky-600" />
            Schedule
          </button>
        ) : level === "quarter" ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              // Ensure the folder is expanded so the inline form below
              // becomes visible.
              setOpenGroupFolders((prev) => ({ ...prev, [folderId]: true }));
              openCreateComposer({
                anchorKey: `group-quarter:${folderId}`,
                scope: "initiative",
                kind: "initiative",
              });
            }}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-40 ring-1 ring-slate-200 text-slate-700 transition hover:bg-white hover:text-indigo-700 hover:ring-indigo-300 group-hover/workitem:opacity-100 focus-visible:opacity-100"
            title="Add initiative in this quarter"
            aria-label="Add initiative in this quarter"
          >
            <Plus className="size-3.5 text-slate-600" />
          </button>
        ) : level === "roadmap" && onRenameRoadmap && key !== "__no_roadmap__" && editingRoadmapId !== key ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setEditingRoadmapId(key);
              // Ensure folder stays expanded so the edit input is visible.
              setOpenGroupFolders((prev) => ({ ...prev, [folderId]: true }));
            }}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-40 ring-1 ring-slate-200 text-slate-700 transition hover:bg-white hover:text-indigo-700 hover:ring-indigo-300 group-hover/workitem:opacity-100 focus-visible:opacity-100"
            title="Rename roadmap"
            aria-label="Rename roadmap"
          >
            <SquarePen className="size-3.5 text-slate-600" />
          </button>
        ) : undefined;
        // Inline rename: swap the label for an IsolatedTextInput when this
        // roadmap is the active rename target.
        const labelOverride =
          level === "roadmap" && editingRoadmapId === key && onRenameRoadmap ? (
            <IsolatedTextInput
              initial={group.label}
              ariaLabel="Rename roadmap"
              inputClassName="h-7 min-w-[180px] rounded-md bg-white px-2 text-[14px] ring-1 ring-slate-200 outline-none"
              onCancel={() => setEditingRoadmapId(null)}
              onSave={async (value) => {
                const next = value.trim();
                if (next && next !== group.label) {
                  try {
                    await onRenameRoadmap(key, next);
                    toast.success("Roadmap renamed");
                  } catch {
                    toast.error("Failed to rename roadmap");
                  }
                }
                setEditingRoadmapId(null);
              }}
            />
          ) : undefined;
        const showQuarterForm =
          level === "quarter" && createSelection?.anchorKey === `group-quarter:${folderId}`;
        return renderFolderRow(
          folderId,
          group.label,
          group.rows.length + group.standaloneRows.length,
          levelIndex * 14,
          () => (
            <>
              {/* Self-contained form — its own local state, so typing
                  doesn't re-render this 7k-line panel. */}
              {showQuarterForm ? (
                <QuarterInitiativeCreateForm
                  placeholder={`New initiative in ${group.label}…`}
                  indentPx={levelIndex * 14 + 18}
                  submitting={submittingKey === "create"}
                  leadingIcon={createKindIcon("initiative")}
                  onSubmit={async (title) => {
                    setSubmittingKey("create");
                    try {
                      await onCreateInitiativeQuick(title);
                      setCreateSelection(null);
                    } finally {
                      setSubmittingKey(null);
                    }
                  }}
                  onCancel={closeInlineCreator}
                />
              ) : null}
              {renderGroupedTree(group.rows, group.standaloneRows, levelIndex + 1, `${path}${level}:${key}/`)}
            </>
          ),
          // Per-level leading icon: roadmap=map, year=full calendar, quarter
          // =the 4-bars progress icon (same icon used on the year-Gantt quarter
          // chips, so users see a consistent "this is a quarter" identity).
          level === "roadmap"
            ? <MapIcon className="size-4 shrink-0 text-sky-500" aria-hidden />
            : level === "year"
              ? <CalendarDays className="size-4 shrink-0 text-sky-500" aria-hidden />
              : level === "quarter"
                ? key === "Unscheduled work"
                  ? <CalendarOff className="size-4 shrink-0 text-slate-400" aria-hidden />
                  : <QuarterYearProgressIcon quarterLabel={key} className="text-sky-500" />
                : undefined,
          trailingAction,
          // Empty quarter folders default to collapsed so the always-rendered
          // Q1-Q4 scaffolding doesn't fill the screen with blank rows. The
          // user's manual toggle still wins via openGroupFolders.
          level === "quarter" && group.rows.length === 0 && group.standaloneRows.length === 0
            ? false
            : undefined,
          labelOverride,
        );
      });
  }

  function renderStandaloneInitiativeRows(rows: typeof groupedStandaloneInitiatives, indentPx: number): React.ReactNode {
    return rows
      .slice()
      .sort((a, b) => {
        // Pin the just-created initiative to the top of its group so the
        // user sees it immediately under the inline form they just used,
        // not buried in the alphabetical list.
        if (newestInitiativeId != null) {
          if (a.initiativeId === newestInitiativeId) return -1;
          if (b.initiativeId === newestInitiativeId) return 1;
        }
        return a.initiativeTitle.localeCompare(b.initiativeTitle);
      })
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
                      <Zap className="size-4 shrink-0 text-sky-500" strokeWidth={1.9} />
                      {editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiative.initiativeId ? (
                        renderParentTitleEditor("initiative", initiative.initiativeId, initiative.initiativeTitle)
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
                    className={cn(backlogReadonlyInitiativeDateButtonClass, "inline-flex items-center justify-center gap-1.5")}
                  >
                    {standInitGantt.start ? <CalendarDays className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
                    {formatBacklogPlanDate(standInitGantt.start)}
                  </button>
                ),
                endDate: isEditingParentDate("initiative", initiative.initiativeId, "end") ? (
                  renderParentDateEditor({ kind: "initiative", id: initiative.initiativeId, field: "end" })
                ) : (
                  <button
                    type="button"
                    onClick={() => {}}
                    className={cn(backlogReadonlyInitiativeDateButtonClass, "inline-flex items-center justify-center gap-1.5")}
                  >
                    {standInitGantt.end ? <CalendarRange className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
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
                    <BacklogRowAvatar name={initiative.initiativeAssignee} directoryUsers={workspaceDirectoryUsers} />
                    {initiative.initiativeAssignee}
                  </span>
                ),
                parent: <span className="text-[16px] text-slate-400">-</span>,
                labels: isEditingParentLabels("initiative", initiative.initiativeId) ? (
                  renderParentLabelsEditor({ kind: "initiative", id: initiative.initiativeId })
                ) : (
                  <BacklogLabelsChipPanel
                    labelsSerialized={standInitModel?.labels}
                    onMouseDownBeginEdit={(event) => {
                      event.preventDefault();
                      beginInitiativeLabelsEdit({ id: initiative.initiativeId, labels: standInitModel?.labels ?? null });
                    }}
                  />
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
                team: { kind: "edit", onEdit: () => beginInitiativeTeamEdit({ id: initiative.initiativeId, team: standInitModel?.team ?? null }) },
                year: { kind: "lock" },
                quarter: { kind: "lock" },
                month: { kind: "lock" },
                // Initiative dates are derived from child epics — no inline edit.
                startDate: { kind: "lock" },
                endDate: { kind: "lock" },
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
              <IsolatedCreateRowForm
                placeholder={createSelection.kind === "epic" ? "Type epic title and press Enter..." : "Type user story title and press Enter..."}
                formStyle={{ gridTemplateColumns: tableGridTemplate }}
                inputWrapperStyle={{ paddingLeft: indentPx + 18 }}
                rightSlotStyle={createFormRestGridStyle}
                submitting={submittingKey === "create"}
                leadingIcon={createKindIcon(createSelection.kind)}
                onCancel={closeInlineCreator}
                onSubmit={(title) => { void handleCreateSubmit(null, title); }}
              />
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
                                renderParentTitleEditor("epic", epic.epicId, epic.epicTitle)
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
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-40 ring-1 ring-slate-200 transition hover:bg-white hover:text-slate-900 group-hover/workitem:opacity-100 focus-visible:opacity-100"
                              title="Add user story"
                            >
                              <Plus className="size-3.5 text-slate-600" />
                            </button>
                            {epic.epicMonthNum == null && onJumpToRoadmapPlanning ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onJumpToRoadmapPlanning(epic.epicTitle);
                                }}
                                className="inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-semibold text-sky-700 opacity-60 ring-1 ring-sky-200 transition hover:bg-sky-50 hover:opacity-100 group-hover/workitem:opacity-100 focus-visible:opacity-100"
                                title={`Open Roadmap Planning and search "${epic.epicTitle}" to schedule`}
                                aria-label={`Schedule epic "${epic.epicTitle}" in Roadmap Planning`}
                              >
                                <ExternalLink className="size-3 text-sky-600" />
                                Schedule
                              </button>
                            ) : null}
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
                          <span className="inline-flex items-center justify-center gap-1.5 text-[14px] tabular-nums text-slate-700">
                            {isEditingParentDate("epic", epic.epicId, "start") ? (
                              renderParentDateEditor({ kind: "epic", id: epic.epicId, field: "start" })
                            ) : (
                              <>
                                {standEpicGantt.start ? <CalendarDays className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
                                {formatBacklogPlanDate(standEpicGantt.start)}
                              </>
                            )}
                          </span>
                        ),
                        endDate: (
                          <span className="inline-flex items-center justify-center gap-1.5 text-[14px] tabular-nums text-slate-700">
                            {isEditingParentDate("epic", epic.epicId, "end") ? (
                              renderParentDateEditor({ kind: "epic", id: epic.epicId, field: "end" })
                            ) : (
                              <>
                                {standEpicGantt.end ? <CalendarRange className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
                                {formatBacklogPlanDate(standEpicGantt.end)}
                              </>
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
                            <BacklogRowAvatar name={epic.epicAssignee} directoryUsers={workspaceDirectoryUsers} />
                            {epic.epicAssignee}
                          </span>
                        ),
                        parent: renderParentCell({
                          initiativeId: initiative.initiativeId,
                          initiativeTitle: initiative.initiativeTitle,
                        }),
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
                        epicOriginalEst: isEditingEpicEstimate(epic.epicId) ? (
                          renderEpicEstimateEditor()
                        ) : (
                          <button
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              beginEpicEstimateEdit({ id: epic.epicId, originalEstimateDays: epic.epicOriginalEstimateDays });
                            }}
                            className="w-full text-center text-[16px] font-medium text-slate-600 hover:text-indigo-600"
                            title="Click to edit estimate"
                          >
                            {epic.epicOriginalEstimateDays}d
                          </button>
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
                        epicOriginalEst: { kind: "edit", onEdit: () => beginEpicEstimateEdit({ id: epic.epicId, originalEstimateDays: epic.epicOriginalEstimateDays }) },
                        daysLeft: { kind: "lock" },
                        progress: { kind: "lock" },
                      })}
                    </div>
                    {createSelection?.anchorKey === `group-standalone-epic:${epic.epicId}` ? (
                      <IsolatedCreateRowForm
                        placeholder="Type user story title and press Enter..."
                        formStyle={{ gridTemplateColumns: tableGridTemplate }}
                        inputWrapperStyle={{ paddingLeft: indentPx + 52 }}
                        rightSlotStyle={createFormRestGridStyle}
                        submitting={submittingKey === "create"}
                        leadingIcon={createKindIcon("story")}
                        onCancel={closeInlineCreator}
                        onSubmit={(title) => { void handleCreateSubmit(null, title); }}
                      />
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
    if (levelIndex >= effectiveGroupLevels.length) return renderStandaloneInitiativeRows(rows, levelIndex * 14);
    const level = effectiveGroupLevels[levelIndex];
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

  /**
   * Inline-form submit handler. Accepts an optional explicit title arg so
   * isolated-state inputs (where the typed value lives in a child
   * component's local state, not `createDraftTitle`) can call this from
   * their own submit handler without first pushing the value into panel
   * state. Falls back to `createDraftTitle` for the few sites that still
   * use the old form layout.
   */
  async function handleCreateSubmit(event: FormEvent<HTMLFormElement> | null, explicitTitle?: string) {
    event?.preventDefault();
    if (!createSelection) return;
    const title = (explicitTitle ?? createDraftTitle).trim();
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
        // Only restore from localStorage when at least one valid level
        // survives. A stored empty array (left over from a prior
        // "ungroup" click) would otherwise stick across sessions and
        // hide the default roadmap/year/quarter grouping every time the
        // backlog opens — annoying for repeat visitors who'd want to see
        // the standard structure on first paint each session.
        if (validLevels.length > 0) setGroupLevels(validLevels);
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
    <section className="ml-1 mr-0 flex h-full min-h-0 w-full max-w-full min-w-0 flex-1 flex-col overflow-x-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
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
          {onCreateRoadmapQuick ? (
            <button
              type="button"
              onClick={() => openCreateComposer({ anchorKey: "header:roadmap", scope: "initiative", kind: "initiative" })}
              /* Soft tinted background matching the indigo accent, with the
               * same `--ring`-tinted outline. Hover deepens the tint a touch. */
              className="inline-flex h-8 w-[7.25rem] items-center justify-center gap-1.5 rounded-lg bg-indigo-50/80 px-3 text-[13px] font-semibold text-indigo-700 outline-1 outline-offset-[-1px] [outline-color:color-mix(in_oklab,var(--ring)_25%,transparent)] transition hover:bg-indigo-100 focus-visible:outline-2 focus-visible:[outline-color:var(--ring)]"
              aria-label="Add roadmap"
              title="Add roadmap"
            >
              <MapIcon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
              <Plus className="size-3 shrink-0" strokeWidth={2.4} aria-hidden />
              <span>Roadmap</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleExcelExport}
            /* Same visual shape as the "+ Roadmap" button — soft tinted
             * emerald background with the `--ring`-tinted outline, icon on
             * the left, label on the right. */
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-50/80 px-3 text-[13px] font-semibold text-emerald-700 outline-1 outline-offset-[-1px] [outline-color:color-mix(in_oklab,var(--ring)_25%,transparent)] transition hover:bg-emerald-100 focus-visible:outline-2 focus-visible:[outline-color:var(--ring)]"
            aria-label="Export backlog to Excel"
            title="Export to Excel (preview, then download .xls)"
          >
            <Image
              src="/export-to-excel-icon.png"
              alt=""
              width={28}
              height={28}
              /* `unoptimized` skips Next's image optimizer so the source PNG
               * is served as-is. The optimizer caches derived webp files in
               * `.next/dev/cache/images/`, and that cache doesn't invalidate
               * when the source file changes — every icon swap would
               * silently keep showing the old version until manual cleanup. */
              unoptimized
              /* size-3.5 (14px) matches the Roadmap button's MapIcon. */
              className="size-3.5 shrink-0 select-none"
              aria-hidden
            />
            <span>Export Excel</span>
          </button>
        </div>
      </div>
      {summaryBarPortalElement ? createPortal(summaryChipsJsx, summaryBarPortalElement) : null}

      <div className="relative z-20 mb-10 max-w-full shrink-0 rounded-xl bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 px-4 pb-9 pt-9 [contain:inline-size] shadow-[inset_0_2px_6px_-2px_rgba(15,23,42,0.18),inset_0_-1px_3px_-1px_rgba(15,23,42,0.10),0_1px_3px_0_rgba(148,163,184,0.20)]">
        <div
          className="grid w-full min-w-0 max-w-[140rem] items-center gap-x-5 gap-y-5"
          style={{ gridTemplateColumns: "auto auto repeat(12, minmax(0, 1fr)) auto" }}
        >
          <div className="relative col-span-15 col-start-1 row-start-1 min-w-0">
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
          <div className="col-start-12 row-start-2 min-w-0">
            <BacklogParentFilterControl
              tree={parentFilterTree}
              selected={parentFilter}
              onChange={setParentFilter}
              buttonClassName="min-w-0 w-full gap-1 px-1.5 sm:gap-1.5 sm:px-2.5 text-[15px]"
            />
          </div>
          <div
            className="relative col-start-13 row-start-2 min-w-0"
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
          <div className="relative col-start-14 row-start-2 min-w-0" ref={savedViewMenuRef}>
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
          <div className="col-start-15 row-start-2 flex min-w-0 justify-start">
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
          <IsolatedCreateRowForm
            placeholder="Type initiative title and press Enter..."
            formClassName={cn("grid w-max min-w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 py-2 ps-3")}
            formStyle={{ gridTemplateColumns: tableGridTemplate }}
            rightSlotStyle={createFormRestGridStyle}
            submitting={submittingKey === "create"}
            leadingIcon={createKindIcon("initiative")}
            onCancel={closeInlineCreator}
            onSubmit={(title) => { void handleCreateSubmit(null, title); }}
          />
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
                              {/* Always-visible "+" — primary path to create
                               *  an initiative or a roadmap when the table is
                               *  empty (or just the fastest path generally).
                               *  Opens a small popover with both options so
                               *  the header button covers both creation paths. */}
                              <div className="relative mr-1">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setOpenCreateMenuKey((prev) => (prev === "header" ? null : "header"));
                                  }}
                                  title="Add"
                                  aria-label="Add initiative or roadmap"
                                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                                >
                                  <Plus className="size-3.5" strokeWidth={2.2} />
                                </button>
                                {openCreateMenuKey === "header" ? (
                                  <div className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200/90 bg-white/95 p-1.5 text-slate-900 shadow-xl backdrop-blur-sm">
                                    <p className="px-2 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Create</p>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenCreateMenuKey(null);
                                        openCreateComposer({
                                          anchorKey: "header:initiative",
                                          scope: "initiative",
                                          kind: "initiative",
                                        });
                                      }}
                                      className="group/menu-item flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-blue-50"
                                    >
                                      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 ring-1 ring-blue-200/80 group-hover/menu-item:bg-blue-200">
                                        <Zap className="size-3.5" strokeWidth={2} aria-hidden />
                                      </span>
                                      <span className="flex min-w-0 flex-col">
                                        <span className="text-[13.5px] font-semibold text-slate-900">Initiative</span>
                                        <span className="text-[11px] text-slate-500">Pick a roadmap below</span>
                                      </span>
                                    </button>
                                    {onCreateRoadmapQuick ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenCreateMenuKey(null);
                                          openCreateComposer({
                                            anchorKey: "header:roadmap",
                                            scope: "initiative",
                                            kind: "initiative",
                                          });
                                        }}
                                        className="group/menu-item flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-indigo-50"
                                      >
                                        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200/80 group-hover/menu-item:bg-indigo-200">
                                          <MapIcon className="size-3.5" strokeWidth={2} aria-hidden />
                                        </span>
                                        <span className="flex min-w-0 flex-col">
                                          <span className="text-[13.5px] font-semibold text-slate-900">Roadmap</span>
                                          <span className="text-[11px] text-slate-500">New top-level grouping</span>
                                        </span>
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
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
                        columnSort={columnSort}
                        onToggleSort={toggleColumnSort}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        ) : null}

        {fullyFiltered.length === 0 && effectiveGroupLevels.length === 0 ? (
          <div className="px-4 py-10 text-[16px] text-slate-600">No items match your search/filter settings.</div>
        ) : (
          <div className="min-w-max bg-white" ref={backlogRowsRootRef}>
            {/* Header-level "New initiative" composer — sits ABOVE the
             *  grouped tree so it works regardless of grouping/filter state
             *  (the primary path to start when the table is empty). The
             *  roadmap picker is required so the user always knows where the
             *  initiative will land. */}
            {createSelection?.anchorKey === "header:initiative" ? (
              <>
                <QuarterInitiativeCreateForm
                  placeholder="New initiative…"
                  indentPx={18}
                  submitting={submittingKey === "create"}
                  leadingIcon={createKindIcon("initiative")}
                  canSubmitExtra={initiativeTargetRoadmapId !== ""}
                  extras={
                    <select
                      value={initiativeTargetRoadmapId}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (next === "__create__") {
                          // Stay on the previous value; render the inline
                          // roadmap create form below until the user finishes
                          // (or cancels) — preserves the initiative title
                          // they've already typed.
                          if (onCreateRoadmapQuick) setInlineCreatingRoadmap(true);
                          return;
                        }
                        setInitiativeTargetRoadmapId(next);
                      }}
                      className="h-8 min-w-[160px] rounded-md bg-white px-2 text-[14px] ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      <option value="">Pick roadmap…</option>
                      {(roadmaps ?? []).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                      {onCreateRoadmapQuick ? (
                        <option value="__create__">+ Create new roadmap…</option>
                      ) : null}
                    </select>
                  }
                  onSubmit={async (title) => {
                    setSubmittingKey("create");
                    try {
                      await onCreateInitiativeQuick(title, initiativeTargetRoadmapId);
                      setCreateSelection(null);
                      setInitiativeTargetRoadmapId("");
                      setInlineCreatingRoadmap(false);
                    } finally {
                      setSubmittingKey(null);
                    }
                  }}
                  onCancel={() => {
                    closeInlineCreator();
                    setInitiativeTargetRoadmapId("");
                    setInlineCreatingRoadmap(false);
                  }}
                />
                {inlineCreatingRoadmap && onCreateRoadmapQuick ? (
                  <IsolatedRoadmapCreateForm
                    indentPx={36}
                    submitting={submittingKey === "create-roadmap"}
                    onSubmit={async (name, years) => {
                      setSubmittingKey("create-roadmap");
                      try {
                        const id = await onCreateRoadmapQuick(name, years);
                        if (id) setInitiativeTargetRoadmapId(id);
                        setInlineCreatingRoadmap(false);
                      } finally {
                        setSubmittingKey(null);
                      }
                    }}
                    onCancel={() => setInlineCreatingRoadmap(false)}
                  />
                ) : null}
              </>
            ) : null}
            {/* Header-level "New roadmap" composer. */}
            {createSelection?.anchorKey === "header:roadmap" && onCreateRoadmapQuick ? (
              <IsolatedRoadmapCreateForm
                indentPx={18}
                submitting={submittingKey === "create"}
                onSubmit={async (name, years) => {
                  setSubmittingKey("create");
                  try {
                    await onCreateRoadmapQuick(name, years);
                    setCreateSelection(null);
                  } finally {
                    setSubmittingKey(null);
                  }
                }}
                onCancel={closeInlineCreator}
              />
            ) : null}
            {effectiveGroupLevels.length > 0 ? (
              renderGroupedTree(sortedGroupedStoryRows, groupedStandaloneInitiatives)
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
                            <Zap className="size-4 shrink-0 text-sky-500" strokeWidth={1.9} />
                            {editingParentTitle?.kind === "initiative" && editingParentTitle.id === initiative.id ? (
                              renderParentTitleEditor("initiative", initiative.id, initiative.title)
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
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-40 ring-1 ring-slate-200 text-slate-700 transition hover:bg-white hover:text-slate-900 group-hover/workitem:opacity-100 focus-visible:opacity-100"
                            title="Add from this row"
                          >
                            <Plus className="size-3.5 text-slate-600" />
                          </button>
                          {openCreateMenuKey === `initiative:${initiative.id}` ? (
                            <div className="absolute left-full top-1/2 z-30 ml-2 w-60 -translate-y-1/2 overflow-hidden rounded-xl border border-slate-200/90 bg-white/95 p-1.5 shadow-xl backdrop-blur-sm">
                              <p className="px-2 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Create</p>
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
                                className="group/menu-item flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-blue-50"
                              >
                                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 ring-1 ring-blue-200/80 group-hover/menu-item:bg-blue-200">
                                  <Zap className="size-4" strokeWidth={2} aria-hidden />
                                </span>
                                <span className="flex min-w-0 flex-col">
                                  <span className="text-[14.5px] font-semibold text-slate-900">Initiative</span>
                                  <span className="text-[11.5px] text-slate-500">New sibling initiative</span>
                                </span>
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
                                className="group/menu-item flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-amber-50"
                              >
                                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 ring-1 ring-amber-200/80 group-hover/menu-item:bg-amber-200">
                                  <Folder className="size-4" strokeWidth={2} aria-hidden />
                                </span>
                                <span className="flex min-w-0 flex-col">
                                  <span className="text-[14.5px] font-semibold text-slate-900">Epic</span>
                                  <span className="text-[11.5px] text-slate-500">Under this initiative</span>
                                </span>
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
                          className={cn(backlogReadonlyInitiativeDateButtonClass, "inline-flex items-center justify-center gap-1.5")}
                        >
                          {flatInitGantt.start ? <CalendarDays className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
                          {formatBacklogPlanDate(flatInitGantt.start)}
                        </button>
                      ),
                      endDate: isEditingParentDate("initiative", initiative.id, "end") ? (
                        renderParentDateEditor({ kind: "initiative", id: initiative.id, field: "end" })
                      ) : (
                        <button
                          type="button"
                          onClick={() => {}}
                          className={cn(backlogReadonlyInitiativeDateButtonClass, "inline-flex items-center justify-center gap-1.5")}
                        >
                          {flatInitGantt.end ? <CalendarRange className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
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
                    directoryUsers={workspaceDirectoryUsers}
                    showLeadingAvatar
                                placeholder="Unassigned"
                                className="h-7 w-full min-w-[104px] rounded-md bg-white pl-7 pr-2 text-[16px] ring-1 ring-slate-200 outline-none"
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
                              <BacklogRowAvatar name={initiative.assignee} directoryUsers={workspaceDirectoryUsers} />
                              {initiative.assignee ?? "Unassigned"}
                            </button>
                          )}
                        </span>
                      ),
                      parent: <span className="text-[16px] text-slate-400">-</span>,
                      labels: isEditingParentLabels("initiative", initiative.id) ? (
                        renderParentLabelsEditor({ kind: "initiative", id: initiative.id })
                      ) : (
                        <BacklogLabelsChipPanel
                          labelsSerialized={initiative.labels}
                          onMouseDownBeginEdit={(event) => {
                            event.preventDefault();
                            beginInitiativeLabelsEdit({ id: initiative.id, labels: initiative.labels ?? null });
                          }}
                        />
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
                      team: { kind: "edit", onEdit: () => beginInitiativeTeamEdit({ id: initiative.id, team: initiative.team ?? null }) },
                      year: { kind: "lock" },
                      quarter: { kind: "lock" },
                      month: { kind: "lock" },
                      // Initiative dates are derived from child epics — no inline edit.
                      startDate: { kind: "lock" },
                      endDate: { kind: "lock" },
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
                    <IsolatedCreateRowForm
                      placeholder="Type initiative title and press Enter..."
                      formStyle={{ gridTemplateColumns: tableGridTemplate }}
                      rightSlotStyle={createFormRestGridStyle}
                      submitting={submittingKey === "create"}
                      leadingIcon={createKindIcon("initiative")}
                      onCancel={closeInlineCreator}
                      onSubmit={(title) => { void handleCreateSubmit(null, title); }}
                    />
                  ) : null}

                  {isInitOpen ? (
                    <div className="relative bg-slate-50/50"><div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-slate-300/70" aria-hidden />
                      {createSelection?.anchorKey === `initiative:${initiative.id}` && createSelection.kind !== "initiative" ? (
                        <IsolatedCreateRowForm
                          placeholder={
                            createSelection.kind === "epic"
                              ? "Type epic title and press Enter..."
                              : "Type user story title and press Enter..."
                          }
                          formClassName={cn("grid min-w-full w-max items-center gap-3 py-2")}
                          formStyle={{ gridTemplateColumns: tableGridTemplate }}
                          inputWrapperStyle={{ paddingLeft: 24 }}
                          rightSlotStyle={createFormRestGridStyle}
                          submitting={submittingKey === "create"}
                          leadingIcon={createKindIcon(createSelection.kind)}
                          saveDisabledExtra={createSelection.kind === "story" && !storyTargetEpicId}
                          extras={createSelection.kind === "story" ? (
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
                          ) : undefined}
                          onCancel={closeInlineCreator}
                          onSubmit={(title) => { void handleCreateSubmit(null, title); }}
                        />
                      ) : null}
                      {(initiative.epics ?? [])
                        .slice()
                        .sort((a, b) => {
                          if (newestEpicId != null) {
                            if (a.id === newestEpicId) return -1;
                            if (b.id === newestEpicId) return 1;
                          }
                          return 0; // preserve API order otherwise
                        })
                        .map((epic) => {
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
                                        renderParentTitleEditor("epic", epic.id, epic.title)
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
                                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-40 ring-1 ring-slate-200 transition hover:bg-white hover:text-slate-900 group-hover/workitem:opacity-100 focus-visible:opacity-100"
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
                                  <span className="inline-flex items-center justify-center gap-1.5 text-[14px] tabular-nums text-slate-700">
                                    {isEditingParentDate("epic", epic.id, "start") ? (
                                      renderParentDateEditor({ kind: "epic", id: epic.id, field: "start" })
                                    ) : (
                                      <>
                                        {flatEpicGantt.start ? <CalendarDays className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
                                        {formatBacklogPlanDate(flatEpicGantt.start)}
                                      </>
                                    )}
                                  </span>
                                ),
                                endDate: (
                                  <span className="inline-flex items-center justify-center gap-1.5 text-[14px] tabular-nums text-slate-700">
                                    {isEditingParentDate("epic", epic.id, "end") ? (
                                      renderParentDateEditor({ kind: "epic", id: epic.id, field: "end" })
                                    ) : (
                                      <>
                                        {flatEpicGantt.end ? <CalendarRange className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
                                        {formatBacklogPlanDate(flatEpicGantt.end)}
                                      </>
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
                    directoryUsers={workspaceDirectoryUsers}
                    showLeadingAvatar
                                          placeholder="Unassigned"
                                          className="h-7 w-full min-w-[104px] rounded-md bg-white pl-7 pr-2 text-[16px] ring-1 ring-slate-200 outline-none"
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
                                        <BacklogRowAvatar name={epic.assignee} directoryUsers={workspaceDirectoryUsers} />
                                        {epic.assignee ?? "Unassigned"}
                                      </button>
                                    )}
                                  </span>
                                ),
                                parent: renderParentCell({
                                  initiativeId: initiative.id,
                                  initiativeTitle: initiative.title,
                                }),
                                labels: isEditingParentLabels("epic", epic.id) ? (
                                  renderParentLabelsEditor({ kind: "epic", id: epic.id })
                                ) : (
                                  <BacklogLabelsChipPanel
                                    labelsSerialized={epic.labels}
                                    onMouseDownBeginEdit={(event) => {
                                      event.preventDefault();
                                      beginEpicLabelsEdit({ id: epic.id, labels: epic.labels ?? null });
                                    }}
                                  />
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
                                epicOriginalEst: isEditingEpicEstimate(epic.id) ? (
                                  renderEpicEstimateEditor()
                                ) : (
                                  <button
                                    type="button"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      beginEpicEstimateEdit({ id: epic.id, originalEstimateDays: epic.originalEstimateDays });
                                    }}
                                    className="w-full text-center text-[16px] font-medium text-slate-600 hover:text-indigo-600"
                                    title="Click to edit estimate"
                                  >
                                    {epic.originalEstimateDays ?? 0}d
                                  </button>
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
                                epicOriginalEst: { kind: "edit", onEdit: () => beginEpicEstimateEdit({ id: epic.id, originalEstimateDays: epic.originalEstimateDays }) },
                                daysLeft: { kind: "lock" },
                                progress: { kind: "lock" },
                              })}
                            </div>
                            {createSelection?.anchorKey === `epic:${epic.id}` ? (
                              <IsolatedCreateRowForm
                                placeholder={
                                  createSelection.kind === "epic"
                                    ? "Type epic title and press Enter..."
                                    : "Type user story title and press Enter..."
                                }
                                formClassName={cn("grid min-w-full w-max items-center gap-3 py-2")}
                                formStyle={{ gridTemplateColumns: tableGridTemplate }}
                                inputWrapperStyle={{ paddingLeft: 48 }}
                                rightSlotStyle={createFormRestGridStyle}
                                submitting={submittingKey === "create"}
                                leadingIcon={createKindIcon(createSelection.kind)}
                                onCancel={closeInlineCreator}
                                onSubmit={(title) => { void handleCreateSubmit(null, title); }}
                              />
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
                                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-40 ring-1 ring-slate-200 transition hover:bg-white hover:text-slate-900 group-hover/workitem:opacity-100 focus-visible:opacity-100"
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
                                        <span className="inline-flex items-center justify-center gap-1.5 text-[14px] tabular-nums text-slate-700">
                                          {flatStoryWork.start ? <CalendarDays className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
                                          {formatBacklogPlanDate(flatStoryWork.start)}
                                        </span>
                                      ),
                                      endDate: (
                                        <span className="inline-flex items-center justify-center gap-1.5 text-[14px] tabular-nums text-slate-700">
                                          {flatStoryWork.end ? <CalendarRange className="size-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
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
                                        <StoryStatusEditor
                                          currentValue={editingStoryCell.value as WorkflowStatus}
                                          onSelect={(v) => {
                                            setEditingStoryCell((prev) => (prev ? { ...prev, value: v } : prev));
                                            void confirmStoryCellEdit(story.id, "status", storyEditSnapshotFromFlat(story), v);
                                          }}
                                          onCancel={cancelStoryCellEdit}
                                        />
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
                                        <SprintSelectEditor
                                          currentValue={editingStoryCell.value}
                                          options={assignableSprintsForYear(Number(initiative.year))}
                                          onSelect={(v) => {
                                            setEditingStoryCell((prev) => (prev ? { ...prev, value: v } : prev));
                                            void confirmStoryCellEdit(story.id, "sprint", storyEditSnapshotFromFlat(story), v);
                                          }}
                                          onCancel={cancelStoryCellEdit}
                                        />
                                      ) : (
                                        <button
                                          type="button"
                                          onMouseDown={(event) => {
                                            event.preventDefault();
                                            beginStoryCellEdit(story.id, "sprint", story.sprint == null ? "unscheduled" : String(story.sprint));
                                          }}
                                          className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-100"
                                        >
                                          <Flag className="size-3.5 shrink-0 text-rose-500" aria-hidden />
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
                    directoryUsers={workspaceDirectoryUsers}
                    showLeadingAvatar
                                            placeholder="Unassigned"
                                            className="h-7 w-full min-w-[104px] rounded-md bg-white pl-7 pr-2 text-[16px] ring-1 ring-slate-200 outline-none"
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
                                          <BacklogRowAvatar name={story.assignee?.trim() || "Unassigned"} directoryUsers={workspaceDirectoryUsers} />
                                          {story.assignee?.trim() || "Unassigned"}
                                        </button>
                                      )}
                                    </span>
                                      ),
                                      parent: renderParentCell({
                                        epicId: epic.id,
                                        epicTitle: epic.title,
                                      }),
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
                                    <IsolatedCreateRowForm
                                      placeholder="Type user story title and press Enter..."
                                      formStyle={{ gridTemplateColumns: tableGridTemplate }}
                                      inputWrapperStyle={{ paddingLeft: 64 }}
                                      rightSlotStyle={createFormRestGridStyle}
                                      submitting={submittingKey === "create"}
                                      leadingIcon={createKindIcon("story")}
                                      onCancel={closeInlineCreator}
                                      onSubmit={(title) => { void handleCreateSubmit(null, title); }}
                                    />
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
