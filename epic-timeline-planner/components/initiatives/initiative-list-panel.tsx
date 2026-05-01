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
  Users,
  Zap,
} from "lucide-react";
import Image from "next/image";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
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
import { MONTH_TEAM_COLUMNS, isKnownEpicTeamId } from "@/lib/month-team-board";
import { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";
import { resolveStoryYearSprint } from "@/lib/year-sprint";
import { cn } from "@/lib/utils";

function epicIsOnPlanForMonth(epic: EpicItem, month: number): boolean {
  if (epic.planSprint == null || epic.planStartMonth == null || epic.planEndMonth == null) return false;
  return epic.planStartMonth <= month && epic.planEndMonth >= month;
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
   * When true, show the month epic backlog layout (Epics header, + Epic). When false, show the initiatives
   * tree even if `activeMonth` is set (Sprint/Capacity/etc. while the month rail still carries a month).
   */
  useEpicPlanLeftPanel?: boolean;
  activeYearSprint: number | null;
  storyDragEnabled: boolean;
  isSprintModeActive: boolean;
  onCreateInitiative: () => void;
  onCreateEpic: () => void;
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
   * When the month rail is on a surface other than Epic Plan (e.g. Sprint Capacity), the main timeline
   * has no `month:*` / `epic-plan:*` epic droppables — only these backlog slots would win collision,
   * which looks like “highlights on the left” and clears the plan. Disable backlog-slot targets for
   * `timeline-epic:` drags until the user opens Epic Plan. The wide unplan strip (`EPICS_UNPLAN_DROP_ID`)
   * stays available.
   */
  suppressTimelineEpicBacklogSlotDrops?: boolean;
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
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="inline-flex shrink-0 text-[16px] leading-none text-slate-800">
                <InitiativePlanBarIcon icon={initiative.icon} className="mr-0 text-slate-700 [&_svg]:text-blue-600" />
              </span>
              <p className="min-w-0 truncate text-[15px] leading-5 font-normal text-slate-900">{initiative.title}</p>
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
      <div className="flex items-start gap-2">
        {epicPlanDragEnabled && !isEpicScheduledOnGantt ? (
          <button
            type="button"
            className="mt-0.5 shrink-0 cursor-grab rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag epic"
            {...listeners}
            {...attributes}
          >
            <DragHandleIcon size="sm" />
          </button>
        ) : isEpicScheduledOnGantt && !hideScheduledIcon ? (
          <span
            className="mt-0.5 inline-flex shrink-0 rounded-md p-1 text-emerald-600"
            title="Scheduled on Gantt"
            aria-label="Scheduled on Gantt"
          >
            <Image src="/scheduled-icon.png" alt="" width={16} height={16} className="size-4 object-contain" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="group/epic flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-1.5">
              <button
                type="button"
                onClick={onToggleEpic}
                className="mt-0.5 inline-flex shrink-0 rounded-sm text-slate-400 transition-colors hover:text-slate-600"
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
                className="min-w-0 flex-1 rounded-md px-0.5 text-left hover:bg-white/90"
                aria-label={`Open epic ${epic.title}`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="inline-flex shrink-0 text-[15px] leading-none text-slate-700">
                    <EpicPlanBarIcon icon={epic.icon} className="mr-0 text-slate-600 [&_svg]:text-slate-500" />
                  </span>
                  <p className="min-w-0 truncate text-[15px] font-normal leading-snug tracking-tight text-foreground">
                    {epic.title}
                  </p>
                </div>
              </button>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 pt-0.5">
              <span className={cn("px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em]", epicPlanStatus.className)}>
                {epicPlanStatus.label}
              </span>
              <span className={cn("px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em]", epicExecutionStatus.className)}>
                {epicExecutionStatus.label}
              </span>
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-[12px] text-muted-foreground">
              <span className="min-w-0 truncate">
                {completion.total === 0 ? "No stories yet" : `${completion.total} user stor${completion.total === 1 ? "y" : "ies"}`}
              </span>
              {completion.total > 0 ? (
                <span className="shrink-0 tabular-nums tracking-tight text-slate-600">
                  {completion.finished}/{completion.total} done · {completion.percent}%
                </span>
              ) : null}
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-[3px] bg-slate-100 ring-1 ring-slate-200/80"
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
          </div>
          {isEpicOpen ? (
            <div className="mt-3 border-l border-border/70 pl-3">
              {stories.length === 0 ? null : (
                <ul className="space-y-0.5">
                  {stories.map((story) => {
                    const meta = storyStatusMeta(story, planContextMonth);
                    const { sprintLabel, statusLabel, statusClassName, showStatusBadge } = meta;
                    const a11y = [story.title, statusLabel, sprintLabel].filter(Boolean).join(", ");
                    return (
                      <li key={story.id}>
                        <div className="group/story flex min-h-[28px] w-full items-center gap-2 rounded-md py-0.5 pr-0.5 pl-0 transition-colors hover:bg-white/90">
                          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                            <UserStoryIcon />
                          </span>
                          <button
                            type="button"
                            onClick={() => onOpenStory(story.id)}
                            aria-label={a11y}
                            className="min-w-0 flex-1 truncate text-left text-[14px] font-normal text-slate-700 antialiased hover:text-foreground"
                          >
                            {story.title}
                          </button>
                          <div className="flex max-w-[55%] shrink-0 items-center justify-end gap-1">
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
              )}
            </div>
          ) : null}
        </div>
      </div>
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
  onEpicAccordionChange,
  backlogDropIndex,
  planContextMonth,
  epicPlanDragEnabled,
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
  onEpicAccordionChange?: (epicId: string, isOpen: boolean) => void;
  backlogDropIndex?: number;
  planContextMonth: number | null;
  epicPlanDragEnabled: boolean;
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
          <div className="group/init flex items-start justify-between gap-1">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <button
                type="button"
                onClick={onToggle}
                className="mt-1 inline-flex shrink-0 rounded-sm text-slate-500 transition-colors hover:text-slate-700"
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
              <button
                type="button"
                onClick={() => onEditInitiative(initiative)}
                className="min-w-0 flex-1 rounded-md px-0.5 text-left hover:bg-white/90"
                aria-label={`Open initiative ${initiative.title}`}
              >
                <div className="flex w-full min-w-0 items-center gap-1">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="inline-flex shrink-0 text-[16px] leading-none text-slate-800">
                      <InitiativePlanBarIcon icon={initiative.icon} className="mr-0 text-slate-700 [&_svg]:text-blue-600" />
                    </span>
                  <p className="min-w-0 truncate text-[17px] font-normal leading-6 tracking-tight text-slate-900">
                      {initiative.title}
                    </p>
                  </div>
                </div>
                {initiative.description ? (
                  <p className="line-clamp-2 text-[13px] leading-5 text-slate-600">{initiative.description}</p>
                ) : null}
                <div className="mt-2 space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="min-w-0 truncate">
                      {initiativeStoryTotal === 0
                        ? "No user stories"
                        : `${initiativeStoryTotal} user stor${initiativeStoryTotal === 1 ? "y" : "ies"}`}
                    </span>
                    {initiativeStoryTotal > 0 ? (
                      <span className="shrink-0 tabular-nums text-slate-600">
                        {initiativeStoryDone}/{initiativeStoryTotal} done · {initiativeProgressPct}%
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-[3px] bg-slate-100 ring-1 ring-slate-200/80"
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
                </div>
              </button>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 pl-1 pr-0.5 pt-0.5">
              {initiative.status === "scheduled" && initiative.startMonth != null ? (
                <span className="rounded bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                  {quarterFromMonth(initiative.startMonth)}
                </span>
              ) : null}
              <span
                className={cn(
                  "px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em]",
                  initiativeExecutionStatus.className,
                )}
              >
                {initiativeExecutionStatus.label}
              </span>
            </div>
          </div>

          {isOpen ? (
            <div className="mt-3 border-t border-border/80 pt-3 font-sans antialiased">
              <div className="rounded-lg border border-border/70 bg-gradient-to-b from-white/80 via-white/45 to-muted/35 p-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)] backdrop-blur-[1px]">
                {epics.length === 0 ? (
                  <p className="px-1.5 py-2 text-[12px] leading-relaxed text-muted-foreground">
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
                        />
                      );
                    })}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1.5 border-t border-border/50 pt-2">
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
                    placeholder="Add epic"
                    className="h-8 w-full rounded-md border border-border/80 bg-background px-2.5 text-[13px] text-foreground shadow-sm outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground focus:border-ring/40 focus:ring-2 focus:ring-ring/25"
                  />
                  <Button
                    size="icon-sm"
                    variant="outline"
                    className="shrink-0 border-border/80 bg-background shadow-sm"
                    disabled={isAddingEpic || epicTitle.trim().length === 0}
                    onClick={() => void handleAddEpic()}
                  >
                    <Plus />
                  </Button>
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
        "group rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-black/5 transition-colors hover:bg-sky-50/70",
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
      <div className="flex items-start gap-2">
        {epicPlanDragEnabled && !isEpicScheduledOnGantt ? (
          <button
            type="button"
            className="shrink-0 cursor-grab rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag epic"
            {...listeners}
            {...attributes}
          >
            <DragHandleIcon size="sm" />
          </button>
        ) : isEpicScheduledOnGantt && !hideScheduledIcon ? (
          <span
            className="inline-flex shrink-0 rounded-md p-1.5 text-emerald-600"
            title="Scheduled on Gantt"
            aria-label="Scheduled on Gantt"
          >
            <Image src="/scheduled-icon.png" alt="" width={16} height={16} className="size-4 object-contain" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1.5 text-left">
            <button
              type="button"
              onClick={() =>
                setIsOpen((prev) => {
                  const next = !prev;
                  queueMicrotask(() => onEpicAccordionChange?.(epic.id, next));
                  return next;
                })
              }
              className="mt-0.5 inline-flex shrink-0 rounded-sm text-slate-500 transition-colors hover:text-slate-700"
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
            <button
              type="button"
              onClick={() => onOpenEpic(epic, initiative)}
              className="min-w-0 flex-1 rounded-md px-0.5 text-left hover:bg-slate-50"
              aria-label={`Open epic ${epic.title}`}
            >
              <div className="min-w-0 flex-1 text-left">
              <div className="flex w-full min-w-0 items-center gap-1">
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="inline-flex shrink-0 text-[16px] leading-none text-slate-800">
                    <EpicPlanBarIcon icon={epic.icon} className="mr-0 text-slate-700 [&_svg]:text-slate-600" />
                  </span>
                  <p className="min-w-0 truncate text-[16px] font-normal leading-6 text-slate-900">{epic.title}</p>
                </div>
              </div>
              <p className="truncate text-[12px] font-normal text-slate-500">{initiative.title}</p>
              <div className="mt-2 space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="min-w-0 truncate">
                    {completion.total === 0
                      ? "No stories yet"
                      : `${completion.total} user stor${completion.total === 1 ? "y" : "ies"}`}
                  </span>
                  {completion.total > 0 ? (
                    <span className="shrink-0 tabular-nums tracking-tight text-slate-600">
                      {completion.finished}/{completion.total} done · {completion.percent}%
                    </span>
                  ) : null}
                </div>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-[3px] bg-slate-100 ring-1 ring-slate-200/80"
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
              </div>
              </div>
            </button>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 pl-1 pr-0.5 pt-0.5">
          <span className={cn("px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em]", epicPlanStatus.className)}>
            {epicPlanStatus.label}
          </span>
          <span className={cn("px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em]", epicExecutionStatus.className)}>
            {epicExecutionStatus.label}
          </span>
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
              const resolvedStorySprint =
                planContextMonth == null ? story.sprint : resolveStoryYearSprint(story, planContextMonth);
              const isScheduledInActiveSprint =
                activeYearSprint != null &&
                resolvedStorySprint != null &&
                resolvedStorySprint === activeYearSprint;
              const a11y = [story.title, statusLabel, sprintLabel].filter(Boolean).join(", ");
              return (
                <div
                  key={story.id}
                  className="group/story flex min-h-[28px] w-full items-center gap-1.5 rounded-md py-0.5 pr-0.5 transition-colors hover:bg-muted/40"
                >
                  {storyDragEnabled ? (
                    isScheduledInActiveSprint ? (
                      <span
                        className="inline-flex shrink-0 rounded-md p-1 text-emerald-600"
                        title="Scheduled in active sprint"
                        aria-label="Scheduled in active sprint"
                      >
                        <Image src="/scheduled-icon.png" alt="" width={16} height={16} className="size-4 object-contain" aria-hidden />
                      </span>
                    ) : (
                      <StoryDragHandle storyId={story.id} />
                    )
                  ) : null}
                  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                    <UserStoryIcon />
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenStory(story.id)}
                    aria-label={a11y}
                    className="min-w-0 flex-1 truncate rounded-md px-0.5 text-left text-[14px] font-normal text-slate-700 hover:text-foreground"
                  >
                    {story.title}
                  </button>
                  <div className="flex max-w-[55%] shrink-0 items-center justify-end gap-1">
                    {sprintLabel ? (
                      <span className="truncate border border-border/60 bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
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
  useEpicPlanLeftPanel,
  activeYearSprint,
  storyDragEnabled,
  isSprintModeActive,
  onCreateInitiative,
  onCreateEpic,
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
  suppressTimelineEpicBacklogSlotDrops = false,
}: InitiativeListPanelProps) {
  const { active } = useDndContext();
  const isTimelineEpicDragActive = active != null && String(active.id).startsWith("timeline-epic:");
  const blockEpicBacklogSlotsForTimelineDrag =
    suppressTimelineEpicBacklogSlotDrops && isTimelineEpicDragActive;

  const { setNodeRef: setBacklogDropRef } = useDroppable({
    id: "initiatives:backlog-drop",
  });
  const { setNodeRef: setEpicUnplanDropRef, isOver: isEpicUnplanDropOver } = useDroppable({
    id: EPICS_UNPLAN_DROP_ID,
  });

  const epicPlanPanelMode = useEpicPlanLeftPanel ?? activeMonth != null;
  const epicListScopeMonth = epicPlanPanelMode ? activeMonth : null;
  const epicPlanDragEnabled = !isSprintModeActive;
  const [openInitiativeIds, setOpenInitiativeIds] = useState<Record<string, boolean>>({});
  const [initiativeSearch, setInitiativeSearch] = useState("");
  const [initiativeSearchFocused, setInitiativeSearchFocused] = useState(false);
  const [epicSearch, setEpicSearch] = useState("");
  const [panelQuarterFilters, setPanelQuarterFilters] = useState<Array<"all" | "Q1" | "Q2" | "Q3" | "Q4">>(["all"]);
  const [panelTeamFilterIds, setPanelTeamFilterIds] = useState<string[]>(["all"]);
  const [panelStatusFilters, setPanelStatusFilters] = useState<Array<
    "all" | "Scheduled" | "Unscheduled" | "To Do" | "In Progress" | "Done" | "Approved"
  >>(["all"]);
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
  const teamFilterOptions: IconFilterOption<string>[] = [
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
  ];
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
      onSprintBoardTeamFilterSync(isKnownEpicTeamId(id) ? id : null);
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
    if (isKnownEpicTeamId(monthEpicTeamFilterId)) {
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
    if (!isKnownEpicTeamId(monthEpicTeamFilterId)) return monthAssignedEpics;
    return monthAssignedEpics.filter(({ epic }) => epic.team === monthEpicTeamFilterId);
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
      if (!panelTeamFilterIds.includes("all") && !panelTeamFilterIds.includes(epic.team ?? "")) return false;
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
        const hasTeam = (initiative.epics ?? []).some((epic) => panelTeamFilterIds.includes(epic.team ?? ""));
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

  return (
    <aside className="h-full min-h-0 overflow-x-hidden overflow-y-auto rounded-xl bg-slate-50 p-4 shadow-lg ring-1 ring-black/5">
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 pb-3">
        <div>
          <h2
            className={cn(
              "inline-flex items-center font-medium tracking-tight text-slate-950",
              epicPlanPanelMode
                ? "gap-1.5 text-[16px] leading-6"
                : "gap-2 text-xl leading-8",
            )}
          >
            {epicPlanPanelMode ? (
              <>
                <Folder className="size-5 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
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
              onClick={epicPlanPanelMode ? onCreateEpic : onCreateInitiative}
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

      {showInitiativeBacklogDrop ? (
        <div
          ref={setBacklogDropRef}
          className="pointer-events-auto -mb-2 h-2 w-full max-w-full shrink-0 opacity-0"
          aria-hidden
        />
      ) : null}

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
              list="month-epic-search-suggestions"
              placeholder="Search epic..."
              className="h-10 w-full rounded-lg bg-white pl-10 pr-3 text-[13px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              aria-label="Search epics in selected month"
            />
            <datalist id="month-epic-search-suggestions">
              {monthPanelEpicsFiltered.map(({ epic }) => (
                <option key={`${epic.id}-${epic.title}`} value={epic.title} />
              ))}
            </datalist>
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
          <h3 className="mb-2 text-[14px] font-medium tracking-[0.01em] text-slate-900">
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
              className="h-11 w-full rounded-lg bg-white pl-10 pr-3 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              aria-label="Search initiatives, epics, or user stories"
            />
            {initiativeSearchFocused && initiativeSearchSuggestionsFiltered.length > 0 ? (
              <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
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
                    className="block w-full rounded-md px-2 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-100"
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
          <h3 className="mb-2 text-[15px] font-medium tracking-[0.01em] text-slate-900">
            Initiatives ({filteredInitiatives.length})
          </h3>
          {filteredInitiatives.length === 0 ? (
            <p className="rounded-md bg-muted/40 p-3 text-[12px] leading-4 text-slate-600">
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
                    onEpicAccordionChange={onEpicAccordionChange}
                  />
                  <BacklogDropSlot index={idx + 1} />
                </div>
              ))}
            </>
          )}
        </div>
      )}
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
