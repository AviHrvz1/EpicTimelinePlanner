"use client";

import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import {
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Folder,
  ListFilter,
  ListTodo,
  PlayCircle,
  Plus,
  PanelLeftClose,
  Search,
  Eraser,
  User,
  Users,
  Zap,
} from "lucide-react";
import Image from "next/image";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { InitiativeCombobox } from "@/components/ui/initiative-combobox";
import { DragHandleIcon } from "@/components/ui/drag-handle";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { EpicPlanBarIcon, InitiativePlanBarIcon } from "@/components/timeline/epic-plan-bar";
import {
  EPICS_UNPLAN_DROP_ID,
  backlogSlotDropId,
  epicBacklogSlotDropId,
  epicListDraggableId,
  storyListDraggableId,
} from "@/lib/epic-dnd-ids";
import { MONTHS } from "@/lib/timeline";
import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { normalizeWorkspaceUserTeam, teamLabelForWorkspaceUser } from "@/lib/workspace-users";
import { InitiativeStatus } from "@/lib/generated/prisma";
import { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";
import { resolveStoryYearSprint } from "@/lib/year-sprint";
import { cn } from "@/lib/utils";

function epicIsOnPlanForMonth(epic: EpicItem, month: number): boolean {
  if (epic.planSprint == null || epic.planStartMonth == null || epic.planEndMonth == null) return false;
  return epic.planStartMonth <= month && epic.planEndMonth >= month;
}

function normalizedEpicTeamId(epic: EpicItem): string {
  const raw = epic.team?.trim();
  if (!raw) return "";
  return normalizeWorkspaceUserTeam(raw);
}

function storyAssigneeDisplayName(story: UserStoryItem): string | null {
  const t = story.assignee?.trim();
  return t || null;
}

/** Same visual language as Gantt bar + insights truncation hovers (indigo gradient). */
const LEFT_PANEL_TRUNCATION_TOOLTIP_CLASS =
  "pointer-events-none w-max max-w-[min(22rem,calc(100vw-2rem))] whitespace-normal rounded-lg border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/40 px-2.5 py-1.5 text-left text-[12px] font-medium leading-snug text-slate-700 shadow-md ring-1 ring-indigo-100/70 backdrop-blur-sm";

function useStoryTitleTruncationFlag(text: string) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setIsTruncated(el.scrollWidth > el.clientWidth + 1);
  }, []);
  useLayoutEffect(() => {
    measure();
  }, [text, measure]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  return { ref, isTruncated };
}

function LeftPanelStoryTitleTooltipPortal({
  show,
  anchorRef,
  text,
}: {
  show: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  text: string;
}) {
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left });
  }, [anchorRef]);
  useLayoutEffect(() => {
    if (!show) return;
    updatePosition();
    const onReposition = () => updatePosition();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [show, updatePosition, text]);
  if (!show || typeof document === "undefined") return null;
  return createPortal(
    <div
      role="tooltip"
      style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 9999 }}
      className={LEFT_PANEL_TRUNCATION_TOOLTIP_CLASS}
    >
      {text}
    </div>,
    document.body,
  );
}

function MiddlePanelStoryTitleButton({
  storyTitle,
  ariaLabel,
  onOpen,
  className,
}: {
  storyTitle: string;
  ariaLabel: string;
  onOpen: () => void;
  className: string;
}) {
  const { ref, isTruncated } = useStoryTitleTruncationFlag(storyTitle);
  const [hover, setHover] = useState(false);
  return (
    <>
      <span
        className="min-w-0 flex-1"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <button
          ref={ref}
          type="button"
          onClick={onOpen}
          aria-label={ariaLabel}
          className={cn("min-w-0 w-full truncate", className)}
        >
          {storyTitle}
        </button>
      </span>
      <LeftPanelStoryTitleTooltipPortal show={hover && isTruncated} anchorRef={ref} text={storyTitle} />
    </>
  );
}

function quarterFromMonth(month: number): string {
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

type IconFilterOption<T extends string> = {
  value: T;
  label: string;
  icon: ReactNode;
};

function QuarterProgressGlyph({ steps }: { steps: 1 | 2 | 3 | 4 }) {
  return (
    <span className="inline-flex h-3 w-3 items-end gap-[1px] text-slate-500" aria-hidden>
      {Array.from({ length: 4 }, (_, idx) => (
        <span
          key={idx}
          className={cn(
            "w-[2px] rounded-[1px] bg-current",
            idx === 0 && "h-[4px]",
            idx === 1 && "h-[6px]",
            idx === 2 && "h-[8px]",
            idx === 3 && "h-[10px]",
            idx < steps ? "opacity-95" : "opacity-25",
          )}
        />
      ))}
    </span>
  );
}

function IconFilterSelect<T extends string>({
  values,
  onToggle,
  options,
  ariaLabel,
  allValue,
  disabled = false,
}: {
  values: T[];
  onToggle: (value: T) => void;
  options: IconFilterOption<T>[];
  ariaLabel: string;
  allValue: T;
  disabled?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const allOption = options.find((opt) => opt.value === allValue) ?? null;
  const isAllSelected = values.includes(allValue) || values.length === 0;
  const selected = isAllSelected
    ? allOption
    : options.find((opt) => opt.value !== allValue && values.includes(opt.value)) ?? allOption;
  if (!selected) return null;
  const selectedCount = isAllSelected ? 0 : values.length;
  const selectedLabel = isAllSelected ? selected.label : selectedCount === 1 ? selected.label : `${selectedCount} selected`;
  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current != null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };
  const closeMenuSoon = () => {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => {
      detailsRef.current?.removeAttribute("open");
      closeTimeoutRef.current = null;
    }, 180);
  };

  return (
    <details
      ref={detailsRef}
      className="group relative"
      onMouseEnter={clearCloseTimeout}
      onMouseLeave={closeMenuSoon}
      onBlur={(event) => {
        clearCloseTimeout();
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) {
          detailsRef.current?.removeAttribute("open");
        }
      }}
    >
      <summary
        className={cn(
          "flex h-9 list-none items-center justify-between gap-2 rounded-lg bg-white px-2 text-[13px] font-semibold text-slate-700 outline-none ring-1 ring-slate-200 transition marker:content-none [&::-webkit-details-marker]:hidden",
          disabled ? "cursor-not-allowed opacity-70" : "hover:bg-slate-50 focus:ring-2 focus:ring-ring/40",
        )}
        aria-label={ariaLabel}
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          if (event.key === "Escape") detailsRef.current?.removeAttribute("open");
        }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">{selected.icon}</span>
          <span className="truncate">{selectedLabel}</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-slate-500 transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="absolute top-full left-0 z-50 mt-1 w-full min-w-max rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              if (disabled) return;
              onToggle(opt.value);
            }}
            disabled={disabled}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-100",
              disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
              (isAllSelected ? opt.value === allValue : values.includes(opt.value)) && "bg-slate-100 text-slate-900",
            )}
          >
            <input
              type="checkbox"
              tabIndex={-1}
              readOnly
              checked={isAllSelected ? opt.value === allValue : values.includes(opt.value)}
              className="size-3.5 rounded border-slate-300 text-slate-700"
            />
            <span className="shrink-0">{opt.icon}</span>
            <span className="whitespace-nowrap">{opt.label}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

function storyStatusMeta(story: UserStoryItem, contextMonth: number | null): {
  sprintLabel: string | null;
  statusLabel: string;
  statusClassName: string;
  /** Hide redundant “Unscheduled” chips when every backlog story looks the same (Linear/Notion-style). */
  showStatusBadge: boolean;
} {
  const resolved =
    story.sprint == null
      ? null
      : contextMonth != null
        ? resolveStoryYearSprint(story, contextMonth)
        : story.sprint >= 3
          ? story.sprint
          : null;
  const sprintLabel =
    story.sprint == null ? null : resolved != null ? `Sprint ${resolved}` : `Sprint ${story.sprint}`;

  if (story.sprint == null) {
    return {
      sprintLabel: null,
      statusLabel: "Unscheduled",
      statusClassName: "text-muted-foreground",
      showStatusBadge: false,
    };
  }
  if (story.status === "inProgress") {
    return {
      sprintLabel,
      statusLabel: "In progress",
      statusClassName:
        "border border-blue-200/70 bg-blue-50/80 px-1.5 py-0.5 text-[10px] font-medium text-blue-800",
      showStatusBadge: true,
    };
  }
  if (story.status === "done") {
    return {
      sprintLabel,
      statusLabel: "Done",
      statusClassName:
        "border border-emerald-200/70 bg-emerald-50/80 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800",
      showStatusBadge: true,
    };
  }
  if (story.status === "approved") {
    return {
      sprintLabel,
      statusLabel: "Approved",
      statusClassName:
        "border border-violet-200/70 bg-violet-50/80 px-1.5 py-0.5 text-[10px] font-medium text-violet-800",
      showStatusBadge: true,
    };
  }
  return {
    sprintLabel,
    statusLabel: "To do",
    statusClassName:
      "border border-amber-200/70 bg-amber-50/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-900",
    showStatusBadge: true,
  };
}

/** Left-panel initiative/epic cards: track grows to fill the row; summary stays on the same line (nowrap). */
const leftPanelProgressTrackClass =
  "h-1.5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-slate-100 ring-1 ring-slate-200/80";
const leftPanelProgressRowClass = "flex min-w-0 flex-nowrap items-center gap-x-2";
const leftPanelProgressSummaryClass =
  "shrink-0 whitespace-nowrap text-[11px] font-medium tabular-nums tracking-tight text-slate-600";

function epicCompletionMeta(epic: EpicItem): {
  total: number;
  finished: number;
  percent: number;
} {
  const stories = epic.userStories ?? [];
  const total = stories.length;
  const finished = stories.filter((story) => story.status === "done" || story.status === "approved").length;
  const percent = total > 0 ? Math.round((finished / total) * 100) : 0;
  return { total, finished, percent };
}

function epicPlanningStatusMeta(epic: EpicItem): { label: string; className: string } {
  const start = epic.planStartMonth;
  const end = epic.planEndMonth;
  const isPlanned = epic.planSprint != null && start != null && end != null;
  if (!isPlanned) {
    return {
      label: "Unscheduled",
      className: "border border-slate-200/90 bg-slate-100 text-slate-600",
    };
  }
  return {
    label: quarterFromMonth(start),
    className: "border border-violet-200/90 bg-violet-50 text-violet-800",
  };
}

function epicExecutionStatusMeta(epic: EpicItem): { label: string; className: string } {
  const stories = epic.userStories ?? [];
  if (stories.length === 0) {
    return {
      label: "To Do",
      className: "border border-amber-200/90 bg-amber-50 text-amber-800",
    };
  }
  if (stories.every((s) => s.status === "approved")) {
    return {
      label: "Approved",
      className: "border border-violet-200/90 bg-violet-50 text-violet-800",
    };
  }
  if (stories.every((s) => s.status === "done" || s.status === "approved")) {
    return {
      label: "Done",
      className: "border border-emerald-200/90 bg-emerald-50 text-emerald-800",
    };
  }
  const hasProgress = stories.some(
    (s) => s.status === "inProgress" || s.status === "done" || s.status === "approved",
  );
  if (hasProgress) {
    return {
      label: "In Progress",
      className: "border border-blue-200/90 bg-blue-50 text-blue-800",
    };
  }
  return {
    label: "To Do",
    className: "border border-amber-200/90 bg-amber-50 text-amber-800",
  };
}

function initiativeExecutionStatusMeta(initiative: InitiativeItem): { label: string; className: string } {
  const epics = initiative.epics ?? [];
  if (epics.length === 0) {
    return {
      label: "To Do",
      className: "border border-amber-200/90 bg-amber-50 text-amber-800",
    };
  }
  const statuses = epics.map((epic) => epicExecutionStatusMeta(epic).label);
  if (statuses.every((label) => label === "Approved")) {
    return {
      label: "Approved",
      className: "border border-violet-200/90 bg-violet-50 text-violet-800",
    };
  }
  if (statuses.every((label) => label === "Done" || label === "Approved")) {
    return {
      label: "Done",
      className: "border border-emerald-200/90 bg-emerald-50 text-emerald-800",
    };
  }
  if (statuses.some((label) => label === "In Progress")) {
    return {
      label: "In Progress",
      className: "border border-blue-200/90 bg-blue-50 text-blue-800",
    };
  }
  if (statuses.some((label) => label === "To Do")) {
    return {
      label: "To Do",
      className: "border border-amber-200/90 bg-amber-50 text-amber-800",
    };
  }
  return {
    label: "In Progress",
    className: "border border-blue-200/90 bg-blue-50 text-blue-800",
  };
}

type InitiativeListPanelProps = {
  initiatives: InitiativeItem[];
  activeMonth: number | null;
  /**
   * When true (Roadmap header “Progress” on), show done % and progress bars in initiative/epic cards.
   * Parent keeps this in sync with the timeline grid.
   */
  storyProgressDetailsVisible: boolean;
  /**
   * When true, show the month epic backlog layout (Epics header, + Epic). When false, show the initiatives
   * tree. The parent sets this from timeline month scope: any drilled-in month (Gantt, sprint, capacity,
   * insights, etc.) uses the epic list for that month.
   */
  useEpicPlanLeftPanel?: boolean;
  activeYearSprint: number | null;
  storyDragEnabled: boolean;
  isSprintModeActive: boolean;
  /** Opens full initiative dialog (optional if `onCreateInitiativeQuick` is used for + Initiative). */
  onCreateInitiative?: () => void;
  /** Opens full epic dialog (optional if inline + Epic via `onCreateEpicQuick` is used). */
  onCreateEpic?: () => void;
  /** When set, + Initiative opens an inline title field in this panel instead of a dialog. Return the new initiative id when creating (needed for parent pickers). */
  onCreateInitiativeQuick?: (title: string) => Promise<string | void>;
  onEditInitiative: (initiative: InitiativeItem) => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onOpenStory: (storyId: string) => void;
  onDeleteEpic: (epicId: string) => void;
  onDeleteInitiative: (id: string) => void;
  onCreateEpicQuick: (initiativeId: string, title: string) => Promise<void>;
  onCreateStoryQuick: (epicId: string, title: string) => Promise<void>;
  epicBacklogOrderByMonth: Record<number, string[]>;
  /** When set (e.g. sprint board scoped to a delivery team), month epic list only shows epics assigned to this team id. */
  monthEpicTeamFilterId?: string | null;
  /**
   * When the user changes the left-panel team filter on a sprint surface, update the sprint board team
   * (Kanban / capacity / insights) so both stay aligned.
   */
  onSprintBoardTeamFilterSync?: (teamId: string | null) => void;
  /** When set (quarter team assignment), list epics for initiatives spanning any of these months (deduped). */
  epicPanelQuarterMonths?: number[] | null;
  /** Label for quarter-scoped list (e.g. `Q1`). */
  epicPanelQuarterLabel?: string | null;
  /** Optional quarter sync from timeline selection. */
  panelQuarterQuickFilter?: "Q1" | "Q2" | "Q3" | "Q4" | null;
  /** Lock quarter filter UI (used in quarter gantt view). */
  panelQuarterFilterLocked?: boolean;
  /** Fires when an initiative accordion opens or closes (initiative list mode). */
  onInitiativeAccordionChange?: (initiativeId: string, isOpen: boolean) => void;
  /** Fires when an epic accordion opens or closes under an initiative card. */
  onEpicAccordionChange?: (epicId: string, isOpen: boolean) => void;
  /** Optional top-chip quick filter sync (Scheduled / Unscheduled epics). */
  panelStatusQuickFilter?: "Scheduled" | "Unscheduled" | null;
  /** Optional action to hide this entire left panel. */
  onHidePanel?: () => void;
  /**
   * Users directory (and derived custom teams) — merged into the Epics “All teams” filter with Platform /
   * Experience / Data.
   */
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
};

function DraggableInitiativeCard({
  initiative,
  onEdit,
  onDelete,
}: {
  initiative: InitiativeItem;
  onEdit: (initiative: InitiativeItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-black/5"
      style={{
        borderLeftColor: initiative.color,
        borderLeftWidth: 4,
      }}
    >
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-1 pl-0">
              <span className="inline-flex shrink-0 text-[16px] leading-none text-slate-800">
                <InitiativePlanBarIcon icon={initiative.icon} className="mr-0 text-slate-700 [&_svg]:text-blue-600" />
              </span>
              <p className="min-w-0 truncate text-[17px] leading-6 font-normal text-slate-900">{initiative.title}</p>
            </div>
            <div className="flex shrink-0 gap-1" />
          </div>
          {initiative.description ? (
            <p className="line-clamp-2 text-[12px] leading-4 text-slate-600">{initiative.description}</p>
          ) : null}
          {initiative.epics.length > 0 ? (
            <p className="text-[11px] text-slate-500">
              {initiative.epics.length} epic{initiative.epics.length !== 1 ? "s" : ""}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InitiativeTreeEpicRow({
  epic,
  initiative,
  isEpicOpen,
  onToggleEpic,
  planContextMonth,
  hideScheduledIcon = false,
  epicPlanDragEnabled,
  onOpenEpic,
  onOpenStory,
  onCreateStoryQuick,
  storyProgressDetailsVisible,
}: {
  epic: EpicItem;
  initiative: InitiativeItem;
  isEpicOpen: boolean;
  onToggleEpic: () => void;
  planContextMonth: number | null;
  hideScheduledIcon?: boolean;
  epicPlanDragEnabled: boolean;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onOpenStory: (storyId: string) => void;
  onCreateStoryQuick?: (epicId: string, title: string) => Promise<void>;
  storyProgressDetailsVisible: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: epicListDraggableId(epic.id),
    disabled: !epicPlanDragEnabled,
  });
  const stories = [...(epic.userStories ?? [])].sort((a, b) => a.title.localeCompare(b.title));
  const completion = epicCompletionMeta(epic);
  const epicPlanStatus = epicPlanningStatusMeta(epic);
  const epicExecutionStatus = epicExecutionStatusMeta(epic);
  const isEpicScheduledOnGantt =
    epic.planSprint != null && epic.planStartMonth != null && epic.planEndMonth != null;
  const [storyTitle, setStoryTitle] = useState("");
  const [isAddingStory, setIsAddingStory] = useState(false);

  async function handleAddStory() {
    if (!onCreateStoryQuick) return;
    const title = storyTitle.trim();
    if (!title) return;
    setIsAddingStory(true);
    try {
      await onCreateStoryQuick(epic.id, title);
      setStoryTitle("");
    } finally {
      setIsAddingStory(false);
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md py-2.5 pl-0.5 pr-0.5 font-sans transition-colors hover:bg-sky-50/70",
        isDragging && "opacity-60",
      )}
      style={{
        transform: !isDragging && transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 60 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {epicPlanDragEnabled && !isEpicScheduledOnGantt ? (
          <button
            type="button"
            className="inline-flex h-7 shrink-0 cursor-grab items-center rounded-md p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag epic"
            {...listeners}
            {...attributes}
          >
            <DragHandleIcon size="sm" />
          </button>
        ) : isEpicScheduledOnGantt && !hideScheduledIcon ? (
          <span
            className="inline-flex h-7 shrink-0 items-center rounded-md p-0.5 text-emerald-600"
            title="Scheduled on Gantt"
            aria-label="Scheduled on Gantt"
          >
            <Image src="/scheduled-icon.png" alt="" width={16} height={16} className="size-4 object-contain" aria-hidden />
          </span>
        ) : null}
        <button
          type="button"
          onClick={onToggleEpic}
          className="inline-flex h-7 shrink-0 items-center rounded-sm text-slate-400 transition-colors hover:text-slate-600"
          aria-label={isEpicOpen ? "Collapse epic" : "Expand epic"}
          aria-expanded={isEpicOpen}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              isEpicOpen && "rotate-90",
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => onOpenEpic(epic, initiative)}
          className="min-w-0 flex-1 rounded-md px-0.5 text-left font-normal hover:bg-white/90"
          aria-label={`Open epic ${epic.title}`}
        >
          <div className="flex min-w-0 items-center gap-2.5 pl-0">
            <span className="inline-flex shrink-0 text-[16px] leading-none text-slate-800">
              <EpicPlanBarIcon icon={epic.icon} className="mr-0 text-slate-700 [&_svg]:text-slate-600" />
            </span>
            <p className="min-w-0 truncate text-[19px] font-normal leading-7 tracking-tight text-slate-900">
              {epic.title}
            </p>
          </div>
        </button>
      </div>
      <div className="mt-2 space-y-2 px-0.5">
            <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="min-w-0 shrink-0 text-left">
                {completion.total === 0 ? "No stories yet" : `${completion.total} user stor${completion.total === 1 ? "y" : "ies"}`}
              </span>
              <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
                <span
                  className={cn(
                    "px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.02em] sm:px-2 sm:text-[11px]",
                    epicPlanStatus.className,
                  )}
                >
                  {epicPlanStatus.label}
                </span>
                <span
                  className={cn(
                    "px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.02em] sm:px-2 sm:text-[11px]",
                    epicExecutionStatus.className,
                  )}
                >
                  {epicExecutionStatus.label}
                </span>
              </div>
            </div>
            {storyProgressDetailsVisible ? (
              <div className={leftPanelProgressRowClass}>
                <div
                  className={leftPanelProgressTrackClass}
                  role="progressbar"
                  aria-valuenow={completion.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${completion.finished} of ${completion.total} stories done`}
                >
                  <div
                    className="h-full rounded-[3px] bg-gradient-to-r from-emerald-400 to-violet-500 transition-[width] duration-300 ease-out"
                    style={{ width: `${completion.percent}%` }}
                  />
                </div>
                <span className={leftPanelProgressSummaryClass}>
                  {completion.finished}/{completion.total} stories done · {completion.percent}%
                </span>
              </div>
            ) : null}
      </div>
      {isEpicOpen ? (
        <div className="mt-3 border-l border-border/70 pl-3">
              {stories.length === 0 && !onCreateStoryQuick ? (
                <p className="text-[11px] text-muted-foreground">No user stories.</p>
              ) : null}
              {stories.length > 0 ? (
                <ul className="space-y-0.5">
                  {stories.map((story) => {
                    const meta = storyStatusMeta(story, planContextMonth);
                    const { sprintLabel, statusLabel, statusClassName, showStatusBadge } = meta;
                    const assigneeName = storyAssigneeDisplayName(story);
                    const a11y = [story.title, assigneeName, statusLabel, sprintLabel].filter(Boolean).join(", ");
                    return (
                      <li key={story.id}>
                        <div className="group/story flex min-h-[28px] w-full items-center gap-2 rounded-md py-0.5 pr-0.5 pl-0 transition-colors hover:bg-white/90">
                          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                            <UserStoryIcon />
                          </span>
                          <MiddlePanelStoryTitleButton
                            storyTitle={story.title}
                            ariaLabel={a11y}
                            onOpen={() => onOpenStory(story.id)}
                            className="text-left text-[14px] font-normal text-slate-700 antialiased hover:text-foreground"
                          />
                          <div className="flex max-w-[58%] shrink-0 items-center justify-end gap-1">
                            {assigneeName ? (
                              <span
                                className="inline-flex max-w-[7.5rem] shrink-0 items-center gap-0.5 truncate rounded-md border border-border/60 bg-background px-1 py-0.5 text-[11px] font-medium text-slate-600"
                                title={assigneeName}
                              >
                                <User className="size-3 shrink-0 text-slate-500" aria-hidden />
                                <span className="min-w-0 truncate">{assigneeName}</span>
                              </span>
                            ) : null}
                            {sprintLabel ? (
                              <span className="max-w-[7rem] truncate border border-border/60 bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {sprintLabel}
                              </span>
                            ) : null}
                            {showStatusBadge ? (
                              <span className={cn("shrink-0 tabular-nums", statusClassName)}>{statusLabel}</span>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {onCreateStoryQuick ? (
                <div className={cn("flex items-center gap-1", stories.length > 0 && "mt-2")}>
                  <input
                    type="text"
                    name={`tree-quick-story-${epic.id}`}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-bwignore="true"
                    data-form-type="other"
                    data-protonpass-ignore="true"
                    value={storyTitle}
                    onChange={(event) => setStoryTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleAddStory();
                      }
                    }}
                    placeholder="Add user story"
                    className="h-7 min-w-0 flex-1 rounded-md border border-border/80 bg-background px-2 text-[13px] shadow-sm outline-none focus:border-ring/40 focus:ring-2 focus:ring-ring/25"
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="shrink-0 border-border/80 bg-background shadow-sm"
                    disabled={isAddingStory || storyTitle.trim().length === 0}
                    onClick={() => void handleAddStory()}
                  >
                    <Plus className="size-4" aria-hidden />
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
    </div>
  );
}

function InitiativeTreeCard({
  initiative,
  isOpen,
  onToggle,
  isSprintModeActive,
  onEditInitiative,
  onDeleteInitiative,
  onOpenEpic,
  onOpenStory,
  onDeleteEpic,
  onCreateEpicQuick,
  onCreateStoryQuick,
  onEpicAccordionChange,
  backlogDropIndex,
  planContextMonth,
  epicPlanDragEnabled,
  storyProgressDetailsVisible,
}: {
  initiative: InitiativeItem;
  isOpen: boolean;
  onToggle: () => void;
  isSprintModeActive: boolean;
  onEditInitiative: (initiative: InitiativeItem) => void;
  onDeleteInitiative: (id: string) => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onOpenStory: (storyId: string) => void;
  onDeleteEpic: (epicId: string) => void;
  onCreateEpicQuick: (initiativeId: string, title: string) => Promise<void>;
  onCreateStoryQuick: (epicId: string, title: string) => Promise<void>;
  onEpicAccordionChange?: (epicId: string, isOpen: boolean) => void;
  backlogDropIndex?: number;
  planContextMonth: number | null;
  epicPlanDragEnabled: boolean;
  storyProgressDetailsVisible: boolean;
}) {
  const inMonthView = planContextMonth != null;
  const { setNodeRef: setDropRef, isOver: isBacklogDropOver } = useDroppable({
    id: backlogDropIndex != null ? backlogSlotDropId(backlogDropIndex) : `initiative-card:${initiative.id}`,
    disabled: backlogDropIndex == null,
  });
  const epics = [...(initiative.epics ?? [])].sort((a, b) => a.title.localeCompare(b.title));
  const initiativeStories = epics.flatMap((e) => e.userStories ?? []);
  const initiativeStoryTotal = initiativeStories.length;
  const initiativeStoryDone = initiativeStories.filter(
    (s) => s.status === "done" || s.status === "approved",
  ).length;
  const initiativeProgressPct =
    initiativeStoryTotal > 0 ? Math.round((initiativeStoryDone / initiativeStoryTotal) * 100) : 0;
  const initiativeExecutionStatus = initiativeExecutionStatusMeta(initiative);
  const [epicTitle, setEpicTitle] = useState("");
  const [isAddingEpic, setIsAddingEpic] = useState(false);
  const [openEpicIds, setOpenEpicIds] = useState<Record<string, boolean>>({});

  async function handleAddEpic() {
    const title = epicTitle.trim();
    if (!title) return;
    setIsAddingEpic(true);
    try {
      await onCreateEpicQuick(initiative.id, title);
      setEpicTitle("");
    } finally {
      setIsAddingEpic(false);
    }
  }

  return (
    <div
      ref={setDropRef}
      className={cn(
        "rounded-xl border border-slate-200/90 bg-white p-3 font-sans antialiased shadow-sm ring-1 ring-black/5",
        isBacklogDropOver && "ring-2 ring-slate-300",
      )}
      style={{
        borderLeftColor: initiative.color,
        borderLeftWidth: 4,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="group/init">
            <div className="flex min-w-0 items-start gap-2">
              <button
                type="button"
                onClick={onToggle}
                className="inline-flex h-7 shrink-0 items-center rounded-sm text-slate-500 transition-colors hover:text-slate-700"
                aria-label={isOpen ? "Collapse initiative" : "Expand initiative"}
                aria-expanded={isOpen}
              >
                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 transition-transform",
                    isOpen && "rotate-90",
                  )}
                />
              </button>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onEditInitiative(initiative)}
                  className="w-full rounded-md px-0.5 text-left hover:bg-white/90"
                  aria-label={`Open initiative ${initiative.title}`}
                >
                  <div className="flex w-full min-w-0 items-center gap-1">
                    <div className="flex min-w-0 flex-1 items-center gap-1 pl-0">
                      <span className="inline-flex shrink-0 text-[16px] leading-none text-slate-800">
                        <InitiativePlanBarIcon icon={initiative.icon} className="mr-0 text-slate-700 [&_svg]:text-blue-600" />
                      </span>
                      <p className="min-w-0 truncate text-[19px] font-normal leading-7 tracking-tight text-slate-900">
                        {initiative.title}
                      </p>
                    </div>
                  </div>
                  {initiative.description ? (
                    <p className="line-clamp-2 text-[13px] leading-5 text-slate-600">{initiative.description}</p>
                  ) : null}
                </button>
                <div className="mt-2 space-y-2 px-0.5">
                  <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="min-w-0 shrink-0 text-left">
                      {epics.length === 0
                        ? "No epics"
                        : `${epics.length} epic${epics.length !== 1 ? "s" : ""}`}
                    </span>
                    <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
                      {initiative.status === "scheduled" && initiative.startMonth != null ? (
                        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-violet-700 sm:px-2 sm:text-[11px]">
                          {quarterFromMonth(initiative.startMonth)}
                        </span>
                      ) : null}
                      {initiative.status === "scheduled" ? (
                        <span className="rounded border border-emerald-200/90 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-emerald-800 sm:px-2 sm:text-[11px]">
                          Scheduled
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "px-1.5 py-0.5 text-[10px] font-semibold leading-tight tracking-[0.02em] sm:px-2 sm:text-[11px]",
                          initiativeExecutionStatus.className,
                        )}
                      >
                        {initiativeExecutionStatus.label}
                      </span>
                    </div>
                  </div>
                  {storyProgressDetailsVisible ? (
                    <div className={leftPanelProgressRowClass}>
                      <div
                        className={leftPanelProgressTrackClass}
                        role="progressbar"
                        aria-valuenow={initiativeProgressPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={
                          initiativeStoryTotal > 0
                            ? `${initiativeStoryDone} of ${initiativeStoryTotal} stories done or approved`
                            : "No user stories"
                        }
                      >
                        <div
                          className="h-full rounded-[3px] bg-gradient-to-r from-emerald-400 to-violet-500 transition-[width] duration-300 ease-out"
                          style={{ width: `${initiativeProgressPct}%` }}
                        />
                      </div>
                      <span className={leftPanelProgressSummaryClass}>
                        {initiativeStoryDone}/{initiativeStoryTotal} stories done · {initiativeProgressPct}%
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {isOpen ? (
            <div className="mt-3 border-t border-border/80 pt-3 font-sans antialiased">
              <div className="ml-3 border-l border-border/70 pl-4">
                {epics.length === 0 ? (
                  <p className="py-2 text-[12px] leading-relaxed text-muted-foreground">
                    No epics yet.
                  </p>
                ) : (
                  <div className="divide-y divide-border/55">
                    {epics.map((epic) => {
                      const isEpicOpen = openEpicIds[epic.id] ?? false;
                      return (
                        <InitiativeTreeEpicRow
                          key={epic.id}
                          epic={epic}
                          initiative={initiative}
                          isEpicOpen={isEpicOpen}
                          onToggleEpic={() =>
                            setOpenEpicIds((prev) => {
                              const next = !(prev[epic.id] ?? false);
                              queueMicrotask(() => onEpicAccordionChange?.(epic.id, next));
                              return {
                                ...prev,
                                [epic.id]: next,
                              };
                            })
                          }
                          planContextMonth={planContextMonth}
                          hideScheduledIcon={inMonthView || isSprintModeActive}
                          epicPlanDragEnabled={epicPlanDragEnabled}
                          onOpenEpic={onOpenEpic}
                          onOpenStory={onOpenStory}
                          onCreateStoryQuick={onCreateStoryQuick}
                          storyProgressDetailsVisible={storyProgressDetailsVisible}
                        />
                      );
                    })}
                  </div>
                )}
                <div className="mt-2.5 border-t border-border/50 pt-2.5">
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-gradient-to-r from-slate-50/80 to-white px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ring-1 ring-slate-200/40">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-600/10 text-slate-600 ring-1 ring-slate-600/10"
                      aria-hidden
                    >
                      <Folder className="size-3" strokeWidth={2} />
                    </span>
                    <input
                      type="text"
                      name={`init-${initiative.id}-quick-item`}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      inputMode="text"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-bwignore="true"
                      data-form-type="other"
                      data-protonpass-ignore="true"
                      value={epicTitle}
                      onChange={(event) => setEpicTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleAddEpic();
                        }
                      }}
                      placeholder="New epic title…"
                      className="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
                      aria-label="New epic title"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 shrink-0 gap-1 bg-slate-800 px-2 text-[12px] font-semibold text-white shadow-sm hover:bg-slate-900 disabled:opacity-45"
                      disabled={isAddingEpic || epicTitle.trim().length === 0}
                      onClick={() => void handleAddEpic()}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SprintEpicCard({
  epic,
  initiative,
  epicPlanDragEnabled,
  storyDragEnabled,
  activeYearSprint,
  onEpicAccordionChange,
  onOpenEpic,
  onOpenStory,
  onDeleteEpic,
  onCreateStoryQuick,
  backlogDropSlot,
  planContextMonth,
  hideScheduledIcon = false,
  storyProgressDetailsVisible,
}: {
  epic: EpicItem;
  initiative: InitiativeItem;
  epicPlanDragEnabled: boolean;
  storyDragEnabled: boolean;
  activeYearSprint: number | null;
  onEpicAccordionChange?: (epicId: string, isOpen: boolean) => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onOpenStory: (storyId: string) => void;
  onDeleteEpic: (epicId: string) => void;
  onCreateStoryQuick: (epicId: string, title: string) => Promise<void>;
  backlogDropSlot?: { month: number; index: number };
  planContextMonth: number | null;
  hideScheduledIcon?: boolean;
  storyProgressDetailsVisible: boolean;
}) {
  const { active } = useDndContext();
  /** Gantt bars use `timeline-epic:`; those drops should use thin `EpicBacklogDropSlot` targets or unplan strip, not the large card hit area (avoids accidental unplan). */
  const isTimelineEpicDragActive = active != null && String(active.id).startsWith("timeline-epic:");
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: epicListDraggableId(epic.id),
    disabled: !epicPlanDragEnabled,
  });
  const { setNodeRef: setDropRef, isOver: isBacklogDropOver } = useDroppable({
    id: backlogDropSlot ? epicBacklogSlotDropId(backlogDropSlot.month, backlogDropSlot.index) : `epic-card:${epic.id}`,
    disabled: !backlogDropSlot || isTimelineEpicDragActive,
  });
  const stories = [...(epic.userStories ?? [])].sort((a, b) => a.title.localeCompare(b.title));
  const epicPlanStatus = epicPlanningStatusMeta(epic);
  const epicExecutionStatus = epicExecutionStatusMeta(epic);
  const completion = epicCompletionMeta(epic);
  const isEpicScheduledOnGantt =
    epic.planSprint != null && epic.planStartMonth != null && epic.planEndMonth != null;
  const [isOpen, setIsOpen] = useState(false);
  const [storyTitle, setStoryTitle] = useState("");
  const [isAddingStory, setIsAddingStory] = useState(false);

  async function handleAddStory() {
    const title = storyTitle.trim();
    if (!title) return;
    setIsAddingStory(true);
    try {
      await onCreateStoryQuick(epic.id, title);
      setStoryTitle("");
    } finally {
      setIsAddingStory(false);
    }
  }

  const stripeColor = epic.color?.trim() ? epic.color : initiative.color;

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={cn(
        "group rounded-xl border border-slate-200/90 bg-white p-3 font-sans antialiased shadow-sm ring-1 ring-black/5 transition-colors hover:bg-sky-50/70",
        isDragging && "opacity-60",
        isBacklogDropOver && "ring-2 ring-slate-300",
      )}
      style={{
        borderLeftColor: stripeColor,
        borderLeftWidth: 4,
        transform: !isDragging && transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 60 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        {epicPlanDragEnabled && !isEpicScheduledOnGantt ? (
          <button
            type="button"
            className="inline-flex h-7 shrink-0 cursor-grab items-center rounded-md p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag epic"
            {...listeners}
            {...attributes}
          >
            <DragHandleIcon size="sm" />
          </button>
        ) : isEpicScheduledOnGantt && !hideScheduledIcon ? (
          <span
            className="inline-flex h-7 shrink-0 items-center rounded-md p-0.5 text-emerald-600"
            title="Scheduled on Gantt"
            aria-label="Scheduled on Gantt"
          >
            <Image src="/scheduled-icon.png" alt="" width={16} height={16} className="size-4 object-contain" aria-hidden />
          </span>
        ) : null}
        <button
          type="button"
          onClick={() =>
            setIsOpen((prev) => {
              const next = !prev;
              queueMicrotask(() => onEpicAccordionChange?.(epic.id, next));
              return next;
            })
          }
          className="inline-flex h-7 shrink-0 items-center rounded-sm text-slate-500 transition-colors hover:text-slate-700"
          aria-label={isOpen ? "Collapse epic" : "Expand epic"}
          aria-expanded={isOpen}
        >
          <ChevronRight
            className={cn(
              "size-4 shrink-0 transition-transform",
              isOpen && "rotate-90",
            )}
          />
        </button>
        <div className="min-w-0 flex-1 text-left">
          <button
            type="button"
            onClick={() => onOpenEpic(epic, initiative)}
            className="w-full rounded-md px-0.5 text-left font-normal hover:bg-slate-50"
            aria-label={`Open epic ${epic.title}`}
          >
            <div className="flex w-full min-w-0 items-center gap-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-0">
                <span className="inline-flex shrink-0 text-[16px] leading-none text-slate-800">
                  <EpicPlanBarIcon icon={epic.icon} className="mr-0 text-slate-700 [&_svg]:text-slate-600" />
                </span>
                <p className="min-w-0 truncate text-[19px] font-normal leading-7 tracking-tight text-slate-900">
                  {epic.title}
                </p>
              </div>
            </div>
            <p className="truncate text-[13px] leading-5 text-slate-600">{initiative.title}</p>
          </button>
          <div className="mt-2 space-y-2 px-0.5">
                <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="min-w-0 shrink-0 text-left">
                    {completion.total === 0
                      ? "No stories yet"
                      : `${completion.total} user stor${completion.total === 1 ? "y" : "ies"}`}
                  </span>
                  <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
                    <span
                      className={cn(
                        "px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.02em] sm:px-2 sm:text-[11px]",
                        epicPlanStatus.className,
                      )}
                    >
                      {epicPlanStatus.label}
                    </span>
                    <span
                      className={cn(
                        "px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.02em] sm:px-2 sm:text-[11px]",
                        epicExecutionStatus.className,
                      )}
                    >
                      {epicExecutionStatus.label}
                    </span>
                  </div>
                </div>
                {storyProgressDetailsVisible ? (
                  <div className={leftPanelProgressRowClass}>
                    <div
                      className={leftPanelProgressTrackClass}
                      role="progressbar"
                      aria-valuenow={completion.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={
                        completion.total > 0
                          ? `${completion.finished} of ${completion.total} stories done or approved`
                          : "No user stories"
                      }
                    >
                      <div
                        className="h-full rounded-[3px] bg-gradient-to-r from-emerald-400 to-violet-500 transition-[width] duration-300 ease-out"
                        style={{ width: `${completion.percent}%` }}
                      />
                    </div>
                    <span className={leftPanelProgressSummaryClass}>
                      {completion.finished}/{completion.total} stories done · {completion.percent}%
                    </span>
                  </div>
                ) : null}
          </div>
        </div>
      </div>
      {isOpen ? (
        <div className="mt-2 ml-8 space-y-1 font-sans">
          {stories.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No user stories.</p>
          ) : (
            stories.map((story) => {
              const meta = storyStatusMeta(story, planContextMonth);
              const { sprintLabel, statusLabel, statusClassName, showStatusBadge } = meta;
              const assigneeName = storyAssigneeDisplayName(story);
              const resolvedStorySprint =
                planContextMonth == null ? story.sprint : resolveStoryYearSprint(story, planContextMonth);
              const isScheduledInActiveSprint =
                activeYearSprint != null &&
                resolvedStorySprint != null &&
                resolvedStorySprint === activeYearSprint;
              /** Drag handle hidden only while someone is assigned; clearing assignee (capacity X) restores drag. */
              const showActiveSprintAssignedIcon = isScheduledInActiveSprint && assigneeName != null;
              const a11y = [story.title, assigneeName, statusLabel, sprintLabel].filter(Boolean).join(", ");
              return (
                <div
                  key={story.id}
                  className="group/story flex min-h-[28px] w-full items-center gap-1.5 rounded-md py-0.5 pr-0.5 transition-colors hover:bg-muted/40"
                >
                  {storyDragEnabled ? (
                    showActiveSprintAssignedIcon ? (
                      <span
                        className="inline-flex shrink-0 rounded-md p-1 text-emerald-600"
                        title="Assigned in active sprint"
                        aria-label="Assigned in active sprint"
                      >
                        <Image
                          src="/scheduled-icon.png"
                          alt=""
                          width={16}
                          height={16}
                          className="size-4 object-contain"
                          aria-hidden
                        />
                      </span>
                    ) : (
                      <StoryDragHandle storyId={story.id} />
                    )
                  ) : null}
                  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                    <UserStoryIcon />
                  </span>
                  <MiddlePanelStoryTitleButton
                    storyTitle={story.title}
                    ariaLabel={a11y}
                    onOpen={() => onOpenStory(story.id)}
                    className="rounded-md px-0.5 text-left text-[14px] font-normal text-slate-700 hover:text-foreground"
                  />
                  <div className="flex max-w-[58%] shrink-0 items-center justify-end gap-1">
                    {assigneeName ? (
                      <span
                        className="inline-flex max-w-[7.5rem] shrink-0 items-center gap-0.5 truncate rounded-md border border-border/60 bg-background px-1 py-0.5 text-[11px] font-medium text-slate-600"
                        title={assigneeName}
                      >
                        <User className="size-3 shrink-0 text-slate-500" aria-hidden />
                        <span className="min-w-0 truncate">{assigneeName}</span>
                      </span>
                    ) : null}
                    {sprintLabel ? (
                      <span className="max-w-[7rem] truncate border border-border/60 bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {sprintLabel}
                      </span>
                    ) : null}
                    {showStatusBadge ? (
                      <span className={cn("shrink-0 tabular-nums", statusClassName)}>{statusLabel}</span>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
          <div className="mt-1 flex items-center gap-1">
            <input
              type="text"
              name={`month-quick-story-${epic.id}`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              data-form-type="other"
              data-protonpass-ignore="true"
              value={storyTitle}
              onChange={(event) => setStoryTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleAddStory();
                }
              }}
              placeholder="Add user story"
              className="h-7 w-full rounded-md bg-white px-2 text-[13px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
            />
            <Button
              size="icon-xs"
              variant="outline"
              disabled={isAddingStory || storyTitle.trim().length === 0}
              onClick={() => void handleAddStory()}
            >
              <Plus />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BacklogDropSlot({ index }: { index: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id: backlogSlotDropId(index),
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "my-1 h-1 w-full rounded bg-transparent transition",
        isOver && "h-2 bg-primary/35",
      )}
      aria-hidden
    />
  );
}

function EpicBacklogDropSlot({
  month,
  index,
  disabled = false,
}: {
  month: number;
  index: number;
  disabled?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: epicBacklogSlotDropId(month, index),
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "my-0.5 min-h-2 w-full rounded bg-transparent transition",
        isOver && "min-h-3 bg-slate-300/90",
      )}
      aria-hidden
    />
  );
}

export function InitiativeListPanel({
  initiatives,
  activeMonth,
  storyProgressDetailsVisible,
  useEpicPlanLeftPanel,
  activeYearSprint,
  storyDragEnabled,
  isSprintModeActive,
  onCreateInitiative,
  onCreateEpic,
  onCreateInitiativeQuick,
  onEditInitiative,
  onOpenEpic,
  onOpenStory,
  onDeleteEpic,
  onDeleteInitiative,
  onCreateEpicQuick,
  onCreateStoryQuick,
  epicBacklogOrderByMonth,
  monthEpicTeamFilterId = null,
  onSprintBoardTeamFilterSync,
  epicPanelQuarterMonths = null,
  epicPanelQuarterLabel = null,
  panelQuarterQuickFilter = null,
  panelQuarterFilterLocked = false,
  onInitiativeAccordionChange,
  onEpicAccordionChange,
  panelStatusQuickFilter = null,
  onHidePanel,
  workspaceDirectoryUsers = [],
}: InitiativeListPanelProps) {
  const { active } = useDndContext();
  const isTimelineEpicDragActive = active != null && String(active.id).startsWith("timeline-epic:");
  /** Gantt epic bars must stay on the timeline; do not accept drops on the unplan / month backlog strip. */
  const blockEpicBacklogSlotsForTimelineDrag = isTimelineEpicDragActive;

  const { setNodeRef: setBacklogDropRef } = useDroppable({
    id: "initiatives:backlog-drop",
  });
  const { setNodeRef: setEpicUnplanDropRef, isOver: isEpicUnplanDropOver } = useDroppable({
    id: EPICS_UNPLAN_DROP_ID,
    disabled: isTimelineEpicDragActive,
  });

  const epicPlanPanelMode =
    useEpicPlanLeftPanel === undefined ? activeMonth != null : useEpicPlanLeftPanel;
  const epicListScopeMonth = epicPlanPanelMode ? activeMonth : null;
  const epicPlanDragEnabled = !isSprintModeActive;

  const [openInitiativeIds, setOpenInitiativeIds] = useState<Record<string, boolean>>({});
  const [initiativeSearch, setInitiativeSearch] = useState("");
  const [initiativeSearchFocused, setInitiativeSearchFocused] = useState(false);
  const [epicSearch, setEpicSearch] = useState("");
  const [epicSearchFocused, setEpicSearchFocused] = useState(false);
  const [inlineNewInitiativeOpen, setInlineNewInitiativeOpen] = useState(false);
  const [inlineNewInitiativeTitle, setInlineNewInitiativeTitle] = useState("");
  const [inlineNewInitiativeSubmitting, setInlineNewInitiativeSubmitting] = useState(false);
  const [inlineNewEpicOpen, setInlineNewEpicOpen] = useState(false);
  const [inlineNewEpicTitle, setInlineNewEpicTitle] = useState("");
  const [inlineNewEpicInitiativeId, setInlineNewEpicInitiativeId] = useState("");
  const [inlineNewEpicSubmitting, setInlineNewEpicSubmitting] = useState(false);
  const inlineInitiativeInputRef = useRef<HTMLInputElement>(null);
  const inlineEpicInputRef = useRef<HTMLInputElement>(null);
  const [panelQuarterFilters, setPanelQuarterFilters] = useState<Array<"all" | "Q1" | "Q2" | "Q3" | "Q4">>(["all"]);
  const [panelTeamFilterIds, setPanelTeamFilterIds] = useState<string[]>(["all"]);
  const [panelStatusFilters, setPanelStatusFilters] = useState<Array<
    "all" | "Scheduled" | "Unscheduled" | "To Do" | "In Progress" | "Done" | "Approved"
  >>(["all"]);

  const firstScheduledInitiativeForActiveMonth = useMemo(() => {
    if (activeMonth == null) return undefined;
    return initiatives.find(
      (i) =>
        i.status === InitiativeStatus.scheduled &&
        i.startMonth != null &&
        i.endMonth != null &&
        i.startMonth <= activeMonth &&
        i.endMonth >= activeMonth,
    );
  }, [initiatives, activeMonth]);

  useEffect(() => {
    setInlineNewInitiativeOpen(false);
    setInlineNewEpicOpen(false);
    setInlineNewInitiativeTitle("");
    setInlineNewEpicTitle("");
    setInlineNewEpicInitiativeId("");
  }, [epicPlanPanelMode]);

  useEffect(() => {
    if (inlineNewInitiativeOpen) inlineInitiativeInputRef.current?.focus();
  }, [inlineNewInitiativeOpen]);

  useEffect(() => {
    if (inlineNewEpicOpen) inlineEpicInputRef.current?.focus();
  }, [inlineNewEpicOpen]);

  const quarterFilterOptions: IconFilterOption<"all" | "Q1" | "Q2" | "Q3" | "Q4">[] = [
    { value: "all", label: "All quarters", icon: <CalendarDays className="size-3.5 text-slate-500" /> },
    { value: "Q1", label: "Q1", icon: <QuarterProgressGlyph steps={1} /> },
    { value: "Q2", label: "Q2", icon: <QuarterProgressGlyph steps={2} /> },
    { value: "Q3", label: "Q3", icon: <QuarterProgressGlyph steps={3} /> },
    { value: "Q4", label: "Q4", icon: <QuarterProgressGlyph steps={4} /> },
  ];
  const monthFilterOptions: IconFilterOption<"current">[] = [
    {
      value: "current",
      label: activeMonth != null ? MONTHS[activeMonth - 1] ?? `Month ${activeMonth}` : "Current month",
      icon: <CalendarDays className="size-3.5 text-slate-500" />,
    },
  ];
  const teamFilterOptions: IconFilterOption<string>[] = useMemo(() => {
    const customIds = new Map<string, string>();
    for (const u of workspaceDirectoryUsers) {
      const id = normalizeWorkspaceUserTeam(u.team);
      if (!id || MONTH_TEAM_IDS.includes(id)) continue;
      if (!customIds.has(id)) customIds.set(id, teamLabelForWorkspaceUser(id));
    }
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        const raw = epic.team?.trim();
        if (!raw) continue;
        const id = normalizeWorkspaceUserTeam(raw);
        if (!id || MONTH_TEAM_IDS.includes(id)) continue;
        if (!customIds.has(id)) customIds.set(id, teamLabelForWorkspaceUser(id));
      }
    }
    const customOpts = [...customIds.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }))
      .map(([value, label]) => ({
        value,
        label,
        icon: <span className="inline-block size-2.5 shrink-0 rounded-full bg-slate-400" aria-hidden />,
      }));
    return [
      { value: "all", label: "All Teams", icon: <Users className="size-3.5 text-slate-500" /> },
      ...MONTH_TEAM_COLUMNS.map((team) => ({
        value: team.id,
        label: team.label,
        icon: (
          <span
            className={cn(
              "inline-block size-2.5 rounded-full",
              team.id === "platform" && "bg-sky-500",
              team.id === "experience" && "bg-violet-500",
              team.id === "data" && "bg-amber-500",
            )}
          />
        ),
      })),
      ...customOpts,
    ];
  }, [workspaceDirectoryUsers, initiatives]);
  const statusFilterOptions: IconFilterOption<
    "all" | "Scheduled" | "Unscheduled" | "To Do" | "In Progress" | "Done" | "Approved"
  >[] = [
    { value: "all", label: "All Statuses", icon: <ListFilter className="size-3.5 text-slate-500" /> },
    { value: "Scheduled", label: "Scheduled", icon: <CalendarDays className="size-3.5 text-slate-500" /> },
    { value: "Unscheduled", label: "Unscheduled", icon: <Circle className="size-3.5 text-slate-500" /> },
    { value: "To Do", label: "To Do", icon: <ListTodo className="size-3.5 text-slate-500" /> },
    { value: "In Progress", label: "In Progress", icon: <PlayCircle className="size-3.5 text-slate-500" /> },
    { value: "Done", label: "Done", icon: <CheckCheck className="size-3.5 text-slate-500" /> },
    { value: "Approved", label: "Approved", icon: <CheckCircle2 className="size-3.5 text-slate-500" /> },
  ];
  const filtersAreDefault =
    panelQuarterFilters.length === 1 &&
    panelQuarterFilters[0] === "all" &&
    panelTeamFilterIds.length === 1 &&
    panelTeamFilterIds[0] === "all" &&
    panelStatusFilters.length === 1 &&
    panelStatusFilters[0] === "all";
  const notifySprintTeamFromPanelTeamIds = useCallback(
    (next: string[]) => {
      if (!onSprintBoardTeamFilterSync) return;
      const withoutAll = next.filter((x) => x !== "all");
      if (next.includes("all") || withoutAll.length !== 1) {
        onSprintBoardTeamFilterSync(null);
        return;
      }
      const id = withoutAll[0];
      onSprintBoardTeamFilterSync(id);
    },
    [onSprintBoardTeamFilterSync],
  );

  const handlePanelTeamFilterToggle = useCallback(
    (value: string) => {
      setPanelTeamFilterIds((prev) => {
        const next = toggleMultiFilter(prev, value, "all");
        queueMicrotask(() => notifySprintTeamFromPanelTeamIds(next));
        return next;
      });
    },
    [notifySprintTeamFromPanelTeamIds],
  );

  const resetAllFilters = () => {
    setPanelQuarterFilters(["all"]);
    setPanelTeamFilterIds(["all"]);
    setPanelStatusFilters(["all"]);
    onSprintBoardTeamFilterSync?.(null);
  };
  const toggleMultiFilter = <T extends string>(prev: T[], value: T, allToken: T): T[] => {
    if (value === allToken) return [allToken];
    const withoutAll = prev.filter((x) => x !== allToken);
    if (withoutAll.includes(value)) {
      const next = withoutAll.filter((x) => x !== value);
      return next.length > 0 ? next : [allToken];
    }
    return [...withoutAll, value];
  };
  useEffect(() => {
    if (epicPlanPanelMode) {
      // Month epic list uses a dedicated locked month filter UI; keep quarter filtering neutral.
      setPanelQuarterFilters(["all"]);
      return;
    }
    if (panelQuarterQuickFilter == null) {
      setPanelQuarterFilters(["all"]);
      return;
    }
    setPanelQuarterFilters([panelQuarterQuickFilter]);
  }, [epicPlanPanelMode, panelQuarterQuickFilter]);
  useEffect(() => {
    if (panelStatusQuickFilter == null) {
      setPanelStatusFilters((prev) => {
        const withoutQuick = prev.filter((value) => value !== "Scheduled" && value !== "Unscheduled");
        return withoutQuick.length > 0 ? withoutQuick : ["all"];
      });
      return;
    }
    setPanelStatusFilters([panelStatusQuickFilter]);
  }, [panelStatusQuickFilter]);

  /**
   * Keep left-panel team chips aligned with sprint board team (Kanban / capacity / insights).
   * When the board is scoped to one team, match that chip; when the board is “all teams”, clear a stale
   * single-team chip so epics from every team stay visible in the list.
   */
  useEffect(() => {
    if (monthEpicTeamFilterId) {
      setPanelTeamFilterIds([monthEpicTeamFilterId]);
      return;
    }
    if (onSprintBoardTeamFilterSync != null && monthEpicTeamFilterId == null) {
      setPanelTeamFilterIds(["all"]);
    }
  }, [monthEpicTeamFilterId, onSprintBoardTeamFilterSync]);

  const monthAssignedEpics = useMemo(() => {
    if (epicPanelQuarterMonths != null && epicPanelQuarterMonths.length > 0) {
      const byEpicId = new Map<string, { epic: EpicItem; initiative: InitiativeItem }>();
      for (const initiative of initiatives) {
        const initiativeIsInQuarterScope =
          initiative.status === "scheduled" &&
          initiative.startMonth != null &&
          initiative.endMonth != null &&
          epicPanelQuarterMonths.some((month) => initiative.startMonth! <= month && initiative.endMonth! >= month);
        const initiativeHasPlannedEpicInQuarter = (initiative.epics ?? []).some((epic) =>
          epicPanelQuarterMonths.some((month) => epicIsOnPlanForMonth(epic, month)),
        );
        for (const epic of initiative.epics ?? []) {
          const isPlannedInQuarterScope = epicPanelQuarterMonths.some((month) => epicIsOnPlanForMonth(epic, month));
          const isUnscheduled =
            epic.planSprint == null && epic.planStartMonth == null && epic.planEndMonth == null;
          const includeUnscheduled = isUnscheduled && (initiativeIsInQuarterScope || initiativeHasPlannedEpicInQuarter);
          if (!isPlannedInQuarterScope && !includeUnscheduled) continue;
          byEpicId.set(epic.id, { epic, initiative });
        }
      }
      return [...byEpicId.values()].sort((a, b) => {
        const byInit = a.initiative.title.localeCompare(b.initiative.title);
        if (byInit !== 0) return byInit;
        return a.epic.title.localeCompare(b.epic.title);
      });
    }
    if (epicListScopeMonth == null) return [];
    const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const initiative of initiatives) {
      const initiativeIsInMonthScope =
        initiative.status === "scheduled" &&
        initiative.startMonth != null &&
        initiative.endMonth != null &&
        initiative.startMonth <= epicListScopeMonth &&
        initiative.endMonth >= epicListScopeMonth;
      const initiativeHasPlannedEpicInMonth = (initiative.epics ?? []).some((epic) =>
        epicIsOnPlanForMonth(epic, epicListScopeMonth),
      );
      for (const epic of initiative.epics ?? []) {
        const isPlannedInMonth = epicIsOnPlanForMonth(epic, epicListScopeMonth);
        const isUnscheduled =
          epic.planSprint == null && epic.planStartMonth == null && epic.planEndMonth == null;
        const includeUnscheduled = isUnscheduled && (initiativeIsInMonthScope || initiativeHasPlannedEpicInMonth);
        if (!isPlannedInMonth && !includeUnscheduled) continue;
        rows.push({ epic, initiative });
      }
    }
    return [...rows].sort((a, b) => {
      const byInit = a.initiative.title.localeCompare(b.initiative.title);
      if (byInit !== 0) return byInit;
      return a.epic.title.localeCompare(b.epic.title);
    });
  }, [initiatives, epicListScopeMonth, epicPanelQuarterMonths]);
  /** Month list scope: all epics for the month, or only those on the selected team when viewing that team’s sprint board. */
  const monthPanelEpics = useMemo(() => {
    if (!monthEpicTeamFilterId) return monthAssignedEpics;
    const filterId = normalizeWorkspaceUserTeam(monthEpicTeamFilterId);
    return monthAssignedEpics.filter(({ epic }) => normalizedEpicTeamId(epic) === filterId);
  }, [monthAssignedEpics, monthEpicTeamFilterId]);
  const monthPanelEpicsFiltered = useMemo(() => {
    return monthPanelEpics.filter(({ epic, initiative }) => {
      if (!panelQuarterFilters.includes("all")) {
        const monthForQuarter = epic.planStartMonth ?? initiative.startMonth;
        if (
          monthForQuarter == null ||
          !panelQuarterFilters.includes(quarterFromMonth(monthForQuarter) as "Q1" | "Q2" | "Q3" | "Q4")
        ) {
          return false;
        }
      }
      if (!panelTeamFilterIds.includes("all") && !panelTeamFilterIds.includes(normalizedEpicTeamId(epic))) return false;
      if (!panelStatusFilters.includes("all")) {
        const planning = epicPlanningStatusMeta(epic).label;
        const execution = epicExecutionStatusMeta(epic).label as "To Do" | "In Progress" | "Done" | "Approved";
        const matches =
          (panelStatusFilters.includes("Scheduled") && planning !== "Unscheduled") ||
          (panelStatusFilters.includes("Unscheduled") && planning === "Unscheduled") ||
          panelStatusFilters.includes(execution);
        if (!matches) {
          return false;
        }
      }
      return true;
    });
  }, [monthPanelEpics, panelQuarterFilters, panelStatusFilters, panelTeamFilterIds]);
  const planAnchorMonth = epicPanelQuarterMonths?.[0] ?? epicListScopeMonth;

  const monthBacklogEpics = useMemo(() => {
    if (planAnchorMonth == null) return [];
    const base = monthPanelEpics.filter(({ epic }) => !epicIsOnPlanForMonth(epic, planAnchorMonth));
    const order = epicBacklogOrderByMonth[planAnchorMonth] ?? [];
    if (order.length === 0) return base;
    const byId = new Map(base.map((row) => [row.epic.id, row]));
    const ordered: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const id of order) {
      const row = byId.get(id);
      if (row) {
        ordered.push(row);
        byId.delete(id);
      }
    }
    const rest = [...byId.values()].sort((a, b) => a.epic.title.localeCompare(b.epic.title));
    return [...ordered, ...rest];
  }, [monthPanelEpics, planAnchorMonth, epicBacklogOrderByMonth]);
  const filteredMonthBacklogEpics = useMemo(() => {
    const q = epicSearch.trim().toLowerCase();
    if (!q) return monthPanelEpicsFiltered;
    return monthPanelEpicsFiltered.filter(
      ({ epic, initiative }) =>
        epic.title.toLowerCase().includes(q) || initiative.title.toLowerCase().includes(q),
    );
  }, [monthPanelEpicsFiltered, epicSearch]);

  const epicSearchSuggestionsList = useMemo(() => {
    const titles = monthPanelEpicsFiltered
      .map(({ epic }) => epic.title.trim())
      .filter((t) => t.length > 0);
    return [...new Set(titles)].sort((a, b) => a.localeCompare(b));
  }, [monthPanelEpicsFiltered]);
  const epicSearchSuggestionsFiltered = useMemo(() => {
    const q = epicSearch.trim().toLowerCase();
    if (!q) return epicSearchSuggestionsList.slice(0, 8);
    return epicSearchSuggestionsList
      .filter((entry) => entry.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.localeCompare(b);
      })
      .slice(0, 8);
  }, [epicSearch, epicSearchSuggestionsList]);

  const initiativeList = useMemo(
    () =>
      initiatives
        .slice()
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "backlog" ? -1 : 1;
          return a.timelineRow - b.timelineRow || a.title.localeCompare(b.title);
        }),
    [initiatives],
  );
  const filteredInitiatives = useMemo(() => {
    const q = initiativeSearch.trim().toLowerCase();
    return initiativeList.filter((initiative) => {
      if (q) {
        const initiativeMatch = initiative.title.toLowerCase().includes(q);
        const epicMatch = (initiative.epics ?? []).some((epic) => epic.title.toLowerCase().includes(q));
        const storyMatch = (initiative.epics ?? []).some((epic) =>
          (epic.userStories ?? []).some((story) => story.title.toLowerCase().includes(q)),
        );
        if (!initiativeMatch && !epicMatch && !storyMatch) return false;
      }
      if (!panelQuarterFilters.includes("all")) {
        if (
          initiative.startMonth == null ||
          !panelQuarterFilters.includes(quarterFromMonth(initiative.startMonth) as "Q1" | "Q2" | "Q3" | "Q4")
        ) {
          return false;
        }
      }
      if (!panelTeamFilterIds.includes("all")) {
        const hasTeam = (initiative.epics ?? []).some((epic) =>
          panelTeamFilterIds.includes(normalizedEpicTeamId(epic)),
        );
        if (!hasTeam) return false;
      }
      if (!panelStatusFilters.includes("all")) {
        const hasUnscheduledEpics = (initiative.epics ?? []).some(
          (epic) => epicPlanningStatusMeta(epic).label === "Unscheduled",
        );
        const hasScheduledEpics = (initiative.epics ?? []).some(
          (epic) => epicPlanningStatusMeta(epic).label !== "Unscheduled",
        );
        const initiativeExecution = initiativeExecutionStatusMeta(initiative).label as
          | "To Do"
          | "In Progress"
          | "Done"
          | "Approved";
        const matches =
          (panelStatusFilters.includes("Unscheduled") && (initiative.status === "backlog" || hasUnscheduledEpics)) ||
          (panelStatusFilters.includes("Scheduled") && (initiative.status === "scheduled" || hasScheduledEpics)) ||
          panelStatusFilters.includes(initiativeExecution);
        if (!matches) {
          return false;
        }
      }
      return true;
    });
  }, [initiativeList, initiativeSearch, panelQuarterFilters, panelStatusFilters, panelTeamFilterIds]);
  const initiativeSearchSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const initiative of initiativeList) {
      if (initiative.title.trim()) set.add(initiative.title);
      for (const epic of initiative.epics ?? []) {
        if (epic.title.trim()) set.add(epic.title);
        for (const story of epic.userStories ?? []) {
          if (story.title.trim()) set.add(story.title);
        }
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [initiativeList]);
  const initiativeSearchSuggestionsFiltered = useMemo(() => {
    const q = initiativeSearch.trim().toLowerCase();
    if (!q) return initiativeSearchSuggestions.slice(0, 8);
    return initiativeSearchSuggestions
      .filter((entry) => entry.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.localeCompare(b);
      })
      .slice(0, 8);
  }, [initiativeSearch, initiativeSearchSuggestions]);
  const showInitiativeBacklogDrop = !epicPlanPanelMode && !isSprintModeActive;

  const showNewButton = epicPlanPanelMode || !isSprintModeActive;

  const initiativePickerOptions = useMemo(
    () =>
      initiatives
        .map((i) => ({ id: i.id, title: i.title }))
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" })),
    [initiatives],
  );

  const handleNewButtonClick = useCallback(() => {
    if (epicPlanPanelMode) {
      if (!onCreateEpicQuick) {
        onCreateEpic?.();
        return;
      }
      const canInline =
        firstScheduledInitiativeForActiveMonth != null ||
        initiatives.length > 0 ||
        onCreateInitiativeQuick != null;
      if (!canInline) {
        toast.message(
          activeMonth != null
            ? "Add an initiative first (or schedule one for this month), then create an epic."
            : "Create an initiative first, then add an epic.",
        );
        return;
      }
      setInlineNewEpicInitiativeId(
        firstScheduledInitiativeForActiveMonth?.id ?? initiatives[0]?.id ?? "",
      );
      setInlineNewInitiativeOpen(false);
      setInlineNewInitiativeTitle("");
      setInlineNewEpicOpen(true);
      return;
    }
    if (onCreateInitiativeQuick) {
      setInlineNewEpicOpen(false);
      setInlineNewEpicTitle("");
      setInlineNewEpicInitiativeId("");
      setInlineNewInitiativeOpen(true);
      return;
    }
    onCreateInitiative?.();
  }, [
    activeMonth,
    epicPlanPanelMode,
    firstScheduledInitiativeForActiveMonth,
    initiatives,
    onCreateEpic,
    onCreateEpicQuick,
    onCreateInitiative,
    onCreateInitiativeQuick,
  ]);

  const submitInlineNewInitiative = useCallback(async () => {
    if (!onCreateInitiativeQuick) return;
    const title = inlineNewInitiativeTitle.trim();
    if (title.length < 2) return;
    setInlineNewInitiativeSubmitting(true);
    try {
      await onCreateInitiativeQuick(title);
      setInlineNewInitiativeTitle("");
      setInlineNewInitiativeOpen(false);
    } catch {
      // Parent surfaces toast and rethrows so the composer stays open.
    } finally {
      setInlineNewInitiativeSubmitting(false);
    }
  }, [inlineNewInitiativeTitle, onCreateInitiativeQuick]);

  const submitInlineNewEpic = useCallback(async () => {
    if (!onCreateEpicQuick || !inlineNewEpicInitiativeId) return;
    const title = inlineNewEpicTitle.trim();
    if (!title) return;
    setInlineNewEpicSubmitting(true);
    try {
      await onCreateEpicQuick(inlineNewEpicInitiativeId, title);
      setInlineNewEpicTitle("");
      setInlineNewEpicInitiativeId("");
      setInlineNewEpicOpen(false);
    } catch {
      // Parent surfaces toast and rethrows so the composer stays open.
    } finally {
      setInlineNewEpicSubmitting(false);
    }
  }, [inlineNewEpicInitiativeId, inlineNewEpicTitle, onCreateEpicQuick]);

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-white pt-7 pb-4 pl-0 pr-4 shadow-xl ring-1 ring-black/8">
      <div className="z-10 -mr-4 mb-4 flex shrink-0 items-center justify-between border-b border-slate-200 bg-white pr-4 pb-3">
        <div className="min-w-0 pl-8">
          <h2 className="inline-flex items-center gap-2 text-xl leading-8 font-bold tracking-tight text-slate-950">
            {epicPlanPanelMode ? (
              <>
                <Folder className="size-6 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
                Epics
              </>
            ) : (
              <>
                <Zap className="size-6 shrink-0 text-blue-600" strokeWidth={1.9} aria-hidden />
                Initiatives
              </>
            )}
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          {showNewButton ? (
            <Button
              size="sm"
              className="h-8 px-3 text-[13px] font-bold"
              onClick={handleNewButtonClick}
            >
              <Plus className="size-3.5" />
              {epicPlanPanelMode ? "Epic" : "Initiative"}
            </Button>
          ) : null}
          {onHidePanel ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={onHidePanel}
              aria-label="Hide left panel"
              title="Hide left panel"
            >
              <PanelLeftClose className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-white [direction:rtl] [scrollbar-gutter:stable]",
          "[scrollbar-width:thin] [scrollbar-color:#7dd3fc_#ffffff]",
          "[&::-webkit-scrollbar]:w-2.5",
          "[&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-white",
          "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-sky-300",
          "hover:[&::-webkit-scrollbar-thumb]:bg-sky-400",
        )}
      >
        <div className="min-h-0 bg-white ps-3 [direction:ltr]">
      {epicPlanPanelMode ? (
        <div className="space-y-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 z-10 size-4.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              value={epicSearch}
              onChange={(event) => setEpicSearch(event.target.value)}
              onFocus={() => setEpicSearchFocused(true)}
              onBlur={() => {
                window.setTimeout(() => setEpicSearchFocused(false), 80);
              }}
              placeholder="Search epic..."
              className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-[15px] outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200/70"
              aria-label="Search epics in selected month"
              aria-autocomplete="list"
              aria-expanded={epicSearchFocused && epicSearchSuggestionsFiltered.length > 0}
            />
            {epicSearchFocused && epicSearchSuggestionsFiltered.length > 0 ? (
              <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-300 bg-white p-1.5 ring-1 ring-slate-200/90">
                {epicSearchSuggestionsFiltered.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      setEpicSearch(entry);
                      setEpicSearchFocused(false);
                    }}
                    className="block w-full rounded-md px-2.5 py-2 text-left text-[15px] leading-snug text-slate-700 hover:bg-slate-100"
                  >
                    {entry}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
            {activeMonth != null ? (
              <IconFilterSelect
                values={["current"]}
                onToggle={() => {}}
                options={monthFilterOptions}
                ariaLabel="Month filter (locked to selected month)"
                allValue="current"
                disabled
              />
            ) : (
              <IconFilterSelect
                values={panelQuarterFilters}
                onToggle={(value) => setPanelQuarterFilters((prev) => toggleMultiFilter(prev, value, "all"))}
                options={quarterFilterOptions}
                ariaLabel="Filter left panel by quarter"
                allValue="all"
                disabled={panelQuarterFilterLocked}
              />
            )}
            <IconFilterSelect
              values={panelTeamFilterIds}
              onToggle={handlePanelTeamFilterToggle}
              options={teamFilterOptions}
              ariaLabel="Filter left panel by team"
              allValue="all"
            />
            <IconFilterSelect
              values={panelStatusFilters}
              onToggle={(value) => setPanelStatusFilters((prev) => toggleMultiFilter(prev, value, "all"))}
              options={statusFilterOptions}
              ariaLabel="Filter left panel by status"
              allValue="all"
            />
            <button
              type="button"
              onClick={resetAllFilters}
              disabled={filtersAreDefault}
              title="Reset all filters"
              aria-label="Reset all filters to default"
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200 transition",
                filtersAreDefault
                  ? "cursor-not-allowed text-slate-300"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-ring/40",
              )}
            >
              <Eraser className="size-4" aria-hidden />
            </button>
          </div>
          {inlineNewEpicOpen && onCreateEpicQuick && (initiativePickerOptions.length > 0 || onCreateInitiativeQuick) ? (
            <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-gradient-to-br from-slate-50/90 via-white to-violet-50/35 shadow-[0_2px_8px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/50">
              <div
                className="flex gap-3 border-l-[3px] border-slate-400 bg-white/50 px-3 py-3 pl-[14px] backdrop-blur-[1px]"
                style={{
                  borderLeftColor:
                    initiatives.find((i) => i.id === inlineNewEpicInitiativeId)?.color ||
                    firstScheduledInitiativeForActiveMonth?.color ||
                    undefined,
                }}
              >
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-600/10 text-slate-700 ring-1 ring-slate-600/15"
                  aria-hidden
                >
                  <Folder className="size-3.5" strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div>
                    <p className="text-lg font-bold tracking-tight text-slate-900">New epic</p>
                    <p className="mt-1 text-[12px] leading-snug text-slate-600">
                      Choose a parent initiative or create a new one from the field below.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Initiative
                      </p>
                      <InitiativeCombobox
                        valueId={inlineNewEpicInitiativeId}
                        onValueChange={setInlineNewEpicInitiativeId}
                        options={initiativePickerOptions}
                        onCreateNew={
                          onCreateInitiativeQuick
                            ? async (t) => {
                                const id = await onCreateInitiativeQuick(t);
                                if (typeof id === "string" && id) return id;
                                throw new Error("Initiative was not created");
                              }
                            : undefined
                        }
                        disabled={inlineNewEpicSubmitting}
                        placeholder="Search, pick, or create an initiative"
                        aria-label="Initiative for new epic"
                        className="h-8 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900 shadow-inner shadow-slate-900/5 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-200/70"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={inlineEpicInputRef}
                        type="text"
                        value={inlineNewEpicTitle}
                        onChange={(e) => setInlineNewEpicTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void submitInlineNewEpic();
                          }
                          if (e.key === "Escape") {
                            setInlineNewEpicOpen(false);
                            setInlineNewEpicTitle("");
                            setInlineNewEpicInitiativeId("");
                          }
                        }}
                        placeholder="Name this epic…"
                        autoComplete="off"
                        className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900 shadow-inner shadow-slate-900/5 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-200/70"
                        aria-label="New epic title"
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 shrink-0 gap-1 bg-slate-800 px-2 text-[12px] font-semibold text-white shadow-sm hover:bg-slate-900 disabled:opacity-50"
                        disabled={
                          inlineNewEpicSubmitting ||
                          inlineNewEpicTitle.trim().length === 0 ||
                          !inlineNewEpicInitiativeId
                        }
                        onClick={() => void submitInlineNewEpic()}
                      >
                        <Plus className="size-3.5" aria-hidden />
                        Add
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 shrink-0 px-2 text-[12px] text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        onClick={() => {
                          setInlineNewEpicOpen(false);
                          setInlineNewEpicTitle("");
                          setInlineNewEpicInitiativeId("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <h3 className="mb-2 text-[15px] font-medium tracking-[0.01em] text-slate-900">
            {epicPanelQuarterLabel
              ? `${epicPanelQuarterLabel} epics (${filteredMonthBacklogEpics.length})`
              : activeMonth != null
                ? `${MONTHS[activeMonth - 1]} epics (${filteredMonthBacklogEpics.length})`
                : `Month epics (${filteredMonthBacklogEpics.length})`}
          </h3>
          <div
            ref={setEpicUnplanDropRef}
            className={cn(
              "bg-transparent p-0 transition",
              isEpicUnplanDropOver && "bg-transparent",
            )}
          >
            {planAnchorMonth != null ? (
              <EpicBacklogDropSlot
                month={planAnchorMonth}
                index={0}
                disabled={blockEpicBacklogSlotsForTimelineDrag}
              />
            ) : null}
            {filteredMonthBacklogEpics.length === 0 ? (
              <p className="text-[11px] text-slate-700">
                {monthPanelEpics.length === 0
                  ? !panelQuarterFilters.includes("all") ||
                    !panelTeamFilterIds.includes("all") ||
                    !panelStatusFilters.includes("all")
                    ? "No epics match the selected filters."
                    : epicPanelQuarterLabel
                      ? "No epics are under initiatives scheduled in this quarter yet."
                      : "No epics are under initiatives scheduled in this month yet."
                  : "No epics match your search."}
              </p>
            ) : (
              filteredMonthBacklogEpics.map(({ epic, initiative }, idx) => (
                <div key={`backlog-${epic.id}`}>
                  <SprintEpicCard
                    epic={epic}
                    initiative={initiative}
                    epicPlanDragEnabled={epicPlanDragEnabled}
                    storyDragEnabled={isSprintModeActive && storyDragEnabled}
                    activeYearSprint={activeYearSprint}
                    onEpicAccordionChange={onEpicAccordionChange}
                    onOpenEpic={onOpenEpic}
                    onOpenStory={onOpenStory}
                    onDeleteEpic={onDeleteEpic}
                    onCreateStoryQuick={onCreateStoryQuick}
                    backlogDropSlot={
                      planAnchorMonth != null ? { month: planAnchorMonth, index: idx } : undefined
                    }
                    planContextMonth={planAnchorMonth}
                    hideScheduledIcon={epicPlanPanelMode || isSprintModeActive}
                    storyProgressDetailsVisible={storyProgressDetailsVisible}
                  />
                  {planAnchorMonth != null ? (
                    <EpicBacklogDropSlot
                      month={planAnchorMonth}
                      index={idx + 1}
                      disabled={blockEpicBacklogSlotsForTimelineDrag}
                    />
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 z-10 size-4.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              value={initiativeSearch}
              onChange={(event) => setInitiativeSearch(event.target.value)}
              onFocus={() => setInitiativeSearchFocused(true)}
              onBlur={() => {
                // Allow click on suggestion item before closing.
                window.setTimeout(() => setInitiativeSearchFocused(false), 80);
              }}
              placeholder="Search..."
              className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-[14px] outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200/70"
              aria-label="Search initiatives, epics, or user stories"
            />
            {initiativeSearchFocused && initiativeSearchSuggestionsFiltered.length > 0 ? (
              <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-300 bg-white p-1.5 ring-1 ring-slate-200/90">
                {initiativeSearchSuggestionsFiltered.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onMouseDown={(event) => {
                      // Prevent blur before click selects.
                      event.preventDefault();
                    }}
                    onClick={() => {
                      setInitiativeSearch(entry);
                      setInitiativeSearchFocused(false);
                    }}
                    className="block w-full rounded-md px-2.5 py-2 text-left text-[15px] leading-snug text-slate-700 hover:bg-slate-100"
                  >
                    {entry}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
            <IconFilterSelect
              values={panelQuarterFilters}
              onToggle={(value) => setPanelQuarterFilters((prev) => toggleMultiFilter(prev, value, "all"))}
              options={quarterFilterOptions}
              ariaLabel="Filter initiatives by quarter"
              allValue="all"
              disabled={panelQuarterFilterLocked}
            />
            <IconFilterSelect
              values={panelTeamFilterIds}
              onToggle={handlePanelTeamFilterToggle}
              options={teamFilterOptions}
              ariaLabel="Filter initiatives by team"
              allValue="all"
            />
            <IconFilterSelect
              values={panelStatusFilters}
              onToggle={(value) => setPanelStatusFilters((prev) => toggleMultiFilter(prev, value, "all"))}
              options={statusFilterOptions}
              ariaLabel="Filter initiatives by status"
              allValue="all"
            />
            <button
              type="button"
              onClick={resetAllFilters}
              disabled={filtersAreDefault}
              title="Reset all filters"
              aria-label="Reset all filters to default"
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200 transition",
                filtersAreDefault
                  ? "cursor-not-allowed text-slate-300"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-ring/40",
              )}
            >
              <Eraser className="size-4" aria-hidden />
            </button>
          </div>
          {inlineNewInitiativeOpen && onCreateInitiativeQuick ? (
            <div className="overflow-hidden rounded-xl border border-sky-200/80 bg-gradient-to-br from-sky-50/95 via-white to-white shadow-[0_2px_8px_rgba(14,165,233,0.12)] ring-1 ring-sky-100/60">
              <div className="flex gap-3 border-l-[3px] border-sky-500 bg-white/55 px-3 py-3 pl-[14px] backdrop-blur-[1px]">
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 ring-1 ring-sky-500/25"
                  aria-hidden
                >
                  <Zap className="size-3.5" strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div>
                    <p className="text-lg font-bold tracking-tight text-slate-900">New initiative</p>
                    <p className="mt-1 text-[12px] leading-snug text-slate-600">
                      Starts in the backlog; schedule it on the roadmap when you are ready.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={inlineInitiativeInputRef}
                      type="text"
                      value={inlineNewInitiativeTitle}
                      onChange={(e) => setInlineNewInitiativeTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void submitInlineNewInitiative();
                        }
                        if (e.key === "Escape") {
                          setInlineNewInitiativeOpen(false);
                          setInlineNewInitiativeTitle("");
                        }
                      }}
                      placeholder="Name your initiative…"
                      autoComplete="off"
                      className="h-8 min-w-0 flex-1 rounded-lg border border-sky-200/90 bg-white px-2.5 text-[13px] text-slate-900 shadow-inner shadow-sky-900/5 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-200/80"
                      aria-label="New initiative title"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 shrink-0 gap-1 bg-sky-600 px-2 text-[12px] font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50"
                      disabled={inlineNewInitiativeSubmitting || inlineNewInitiativeTitle.trim().length < 2}
                      onClick={() => void submitInlineNewInitiative()}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Add
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-[12px] text-slate-600 hover:bg-sky-50 hover:text-slate-900"
                      onClick={() => {
                        setInlineNewInitiativeOpen(false);
                        setInlineNewInitiativeTitle("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {showInitiativeBacklogDrop ? (
            <div
              ref={setBacklogDropRef}
              className="pointer-events-auto -mb-2 h-2 w-full max-w-full shrink-0 opacity-0"
              aria-hidden
            />
          ) : null}
          <h3 className="mb-2 text-[15px] font-medium tracking-[0.01em] text-slate-900">
            Initiatives ({filteredInitiatives.length})
          </h3>
          {filteredInitiatives.length === 0 ? (
            <p className="rounded-md border border-slate-200/80 bg-white p-3 text-[12px] leading-4 text-slate-600">
              {initiativeList.length === 0
                ? "No initiatives yet. Add one to begin planning."
                : "No initiatives match your filters/search."}
            </p>
          ) : (
            <>
              <BacklogDropSlot index={0} />
              {filteredInitiatives.map((initiative, idx) => (
                <div key={initiative.id}>
                  <InitiativeTreeCard
                    initiative={initiative}
                    isOpen={openInitiativeIds[initiative.id] ?? false}
                    isSprintModeActive={isSprintModeActive}
                    backlogDropIndex={idx}
                    planContextMonth={activeMonth}
                    epicPlanDragEnabled={epicPlanDragEnabled}
                    storyProgressDetailsVisible={storyProgressDetailsVisible}
                    onToggle={() => {
                      const next = !(openInitiativeIds[initiative.id] ?? false);
                      setOpenInitiativeIds((prev) => ({ ...prev, [initiative.id]: next }));
                      onInitiativeAccordionChange?.(initiative.id, next);
                    }}
                    onEditInitiative={onEditInitiative}
                    onDeleteInitiative={onDeleteInitiative}
                    onOpenEpic={onOpenEpic}
                    onOpenStory={onOpenStory}
                    onDeleteEpic={onDeleteEpic}
                    onCreateEpicQuick={onCreateEpicQuick}
                    onCreateStoryQuick={onCreateStoryQuick}
                    onEpicAccordionChange={onEpicAccordionChange}
                  />
                  <BacklogDropSlot index={idx + 1} />
                </div>
              ))}
            </>
          )}
        </div>
      )}
        </div>
      </div>
    </aside>
  );
}

function StoryDragHandle({ storyId }: { storyId: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: storyListDraggableId(storyId),
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={cn(
        "shrink-0 cursor-grab rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing",
        isDragging && "opacity-60",
      )}
      aria-label="Drag user story"
      {...attributes}
      {...listeners}
    >
      <DragHandleIcon size="sm" />
    </button>
  );
}
