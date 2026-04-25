"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronRight, Folder, Plus, Zap } from "lucide-react";
import { useMemo, useState } from "react";

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
  const isPlanned = epic.planSprint != null && epic.planStartMonth != null && epic.planEndMonth != null;
  if (!isPlanned) {
    return {
      label: "Unscheduled",
      className: "border border-slate-200/90 bg-slate-100 text-slate-600",
    };
  }
  return {
    label: quarterFromMonth(epic.planStartMonth),
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
  /** When set (e.g. sprint board opened from a team lane), month epic list only shows epics assigned to this team id. */
  monthEpicTeamFilterId?: string | null;
  /** When set (quarter team assignment), list epics for initiatives spanning any of these months (deduped). */
  epicPanelQuarterMonths?: number[] | null;
  /** Label for quarter-scoped list (e.g. `Q1`). */
  epicPanelQuarterLabel?: string | null;
  /** Fires when an initiative accordion opens or closes (initiative list mode). */
  onInitiativeAccordionChange?: (initiativeId: string, isOpen: boolean) => void;
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
  epicPlanDragEnabled,
  onOpenEpic,
  onOpenStory,
}: {
  epic: EpicItem;
  initiative: InitiativeItem;
  isEpicOpen: boolean;
  onToggleEpic: () => void;
  planContextMonth: number | null;
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

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md py-2.5 pl-0.5 pr-0.5 font-sans transition-colors hover:bg-white/70",
        isDragging && "opacity-60",
      )}
      style={{
        transform: !isDragging && transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 60 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      <div className="flex items-start gap-2">
        {epicPlanDragEnabled ? (
          <button
            type="button"
            className="mt-0.5 shrink-0 cursor-grab rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag epic"
            {...listeners}
            {...attributes}
          >
            <DragHandleIcon size="sm" />
          </button>
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
  onEditInitiative,
  onDeleteInitiative,
  onOpenEpic,
  onOpenStory,
  onDeleteEpic,
  onCreateEpicQuick,
  backlogDropIndex,
  planContextMonth,
  epicPlanDragEnabled,
}: {
  initiative: InitiativeItem;
  isOpen: boolean;
  onToggle: () => void;
  onEditInitiative: (initiative: InitiativeItem) => void;
  onDeleteInitiative: (id: string) => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onOpenStory: (storyId: string) => void;
  onDeleteEpic: (epicId: string) => void;
  onCreateEpicQuick: (initiativeId: string, title: string) => Promise<void>;
  backlogDropIndex?: number;
  planContextMonth: number | null;
  epicPlanDragEnabled: boolean;
}) {
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
                            setOpenEpicIds((prev) => ({
                              ...prev,
                              [epic.id]: !(prev[epic.id] ?? false),
                            }))
                          }
                          planContextMonth={planContextMonth}
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
  onOpenEpic,
  onOpenStory,
  onDeleteEpic,
  onCreateStoryQuick,
  backlogDropSlot,
  planContextMonth,
}: {
  epic: EpicItem;
  initiative: InitiativeItem;
  epicPlanDragEnabled: boolean;
  storyDragEnabled: boolean;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onOpenStory: (storyId: string) => void;
  onDeleteEpic: (epicId: string) => void;
  onCreateStoryQuick: (epicId: string, title: string) => Promise<void>;
  backlogDropSlot?: { month: number; index: number };
  planContextMonth: number | null;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: epicListDraggableId(epic.id),
    disabled: !epicPlanDragEnabled,
  });
  const { setNodeRef: setDropRef, isOver: isBacklogDropOver } = useDroppable({
    id: backlogDropSlot ? epicBacklogSlotDropId(backlogDropSlot.month, backlogDropSlot.index) : `epic-card:${epic.id}`,
    disabled: !backlogDropSlot,
  });
  const stories = [...(epic.userStories ?? [])].sort((a, b) => a.title.localeCompare(b.title));
  const epicPlanStatus = epicPlanningStatusMeta(epic);
  const epicExecutionStatus = epicExecutionStatusMeta(epic);
  const completion = epicCompletionMeta(epic);
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
        "group rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-black/5",
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
        {epicPlanDragEnabled ? (
          <button
            type="button"
            className="shrink-0 cursor-grab rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag epic"
            {...listeners}
            {...attributes}
          >
            <DragHandleIcon size="sm" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1.5 text-left">
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
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
              const a11y = [story.title, statusLabel, sprintLabel].filter(Boolean).join(", ");
              return (
                <div
                  key={story.id}
                  className="group/story flex min-h-[28px] w-full items-center gap-1.5 rounded-md py-0.5 pr-0.5 transition-colors hover:bg-muted/40"
                >
                  {storyDragEnabled ? <StoryDragHandle storyId={story.id} /> : null}
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

function EpicBacklogDropSlot({ month, index }: { month: number; index: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id: epicBacklogSlotDropId(month, index),
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "my-1 h-1 w-full rounded bg-transparent transition",
        isOver && "h-2 bg-slate-300/90",
      )}
      aria-hidden
    />
  );
}

export function InitiativeListPanel({
  initiatives,
  activeMonth,
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
  epicPanelQuarterMonths = null,
  epicPanelQuarterLabel = null,
  onInitiativeAccordionChange,
}: InitiativeListPanelProps) {
  const { setNodeRef: setBacklogDropRef } = useDroppable({
    id: "initiatives:backlog-drop",
  });
  const { setNodeRef: setEpicUnplanDropRef, isOver: isEpicUnplanDropOver } = useDroppable({
    id: EPICS_UNPLAN_DROP_ID,
  });

  const inMonthView = activeMonth != null;
  const epicPlanDragEnabled = !isSprintModeActive;
  const [openInitiativeIds, setOpenInitiativeIds] = useState<Record<string, boolean>>({});
  const [initiativeSearch, setInitiativeSearch] = useState("");
  const [epicSearch, setEpicSearch] = useState("");
  const [panelQuarterFilter, setPanelQuarterFilter] = useState<"all" | "Q1" | "Q2" | "Q3" | "Q4">("all");
  const [panelTeamFilterId, setPanelTeamFilterId] = useState<string>("all");
  const [panelStatusFilter, setPanelStatusFilter] = useState<"all" | "To Do" | "In Progress" | "Done" | "Approved">("all");

  const monthAssignedEpics = useMemo(() => {
    if (epicPanelQuarterMonths != null && epicPanelQuarterMonths.length > 0) {
      const byEpicId = new Map<string, { epic: EpicItem; initiative: InitiativeItem }>();
      for (const month of epicPanelQuarterMonths) {
        for (const initiative of initiatives) {
          for (const epic of initiative.epics ?? []) {
            if (!epicIsOnPlanForMonth(epic, month)) continue;
            byEpicId.set(epic.id, { epic, initiative });
          }
        }
      }
      return [...byEpicId.values()].sort((a, b) => {
        const byInit = a.initiative.title.localeCompare(b.initiative.title);
        if (byInit !== 0) return byInit;
        return a.epic.title.localeCompare(b.epic.title);
      });
    }
    if (activeMonth == null) return [];
    const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (!epicIsOnPlanForMonth(epic, activeMonth)) continue;
        rows.push({ epic, initiative });
      }
    }
    return [...rows].sort((a, b) => {
      const byInit = a.initiative.title.localeCompare(b.initiative.title);
      if (byInit !== 0) return byInit;
      return a.epic.title.localeCompare(b.epic.title);
    });
  }, [initiatives, activeMonth, epicPanelQuarterMonths]);
  /** Month list scope: all epics for the month, or only those on the selected team when viewing that team’s sprint board. */
  const monthPanelEpics = useMemo(() => {
    if (!isKnownEpicTeamId(monthEpicTeamFilterId)) return monthAssignedEpics;
    return monthAssignedEpics.filter(({ epic }) => epic.team === monthEpicTeamFilterId);
  }, [monthAssignedEpics, monthEpicTeamFilterId]);
  const monthPanelEpicsFiltered = useMemo(() => {
    return monthPanelEpics.filter(({ epic, initiative }) => {
      if (panelQuarterFilter !== "all") {
        const monthForQuarter = epic.planStartMonth ?? initiative.startMonth;
        if (monthForQuarter == null || quarterFromMonth(monthForQuarter) !== panelQuarterFilter) return false;
      }
      if (panelTeamFilterId !== "all" && epic.team !== panelTeamFilterId) return false;
      if (panelStatusFilter !== "all" && epicExecutionStatusMeta(epic).label !== panelStatusFilter) return false;
      return true;
    });
  }, [monthPanelEpics, panelQuarterFilter, panelStatusFilter, panelTeamFilterId]);
  const planAnchorMonth = epicPanelQuarterMonths?.[0] ?? activeMonth;

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
      if (q && !initiative.title.toLowerCase().includes(q)) return false;
      if (panelQuarterFilter !== "all") {
        if (initiative.startMonth == null || quarterFromMonth(initiative.startMonth) !== panelQuarterFilter) return false;
      }
      if (panelTeamFilterId !== "all") {
        const hasTeam = (initiative.epics ?? []).some((epic) => epic.team === panelTeamFilterId);
        if (!hasTeam) return false;
      }
      if (panelStatusFilter !== "all" && initiativeExecutionStatusMeta(initiative).label !== panelStatusFilter) {
        return false;
      }
      return true;
    });
  }, [initiativeList, initiativeSearch, panelQuarterFilter, panelStatusFilter, panelTeamFilterId]);
  const showInitiativeBacklogDrop = !inMonthView && !isSprintModeActive;

  const showNewButton = inMonthView || !isSprintModeActive;

  return (
    <aside className="h-full min-h-0 overflow-x-hidden overflow-y-auto rounded-xl bg-slate-50 p-4 shadow-lg ring-1 ring-black/5">
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 pb-3">
        <div>
          <h2
            className={cn(
              "inline-flex items-center font-medium tracking-tight text-slate-950",
              inMonthView
                ? "gap-1.5 text-[16px] leading-6"
                : "gap-2 text-xl leading-8",
            )}
          >
            {inMonthView ? (
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
        {showNewButton ? (
          <Button
            size="sm"
            className="h-8 px-3 text-[13px] font-bold"
            onClick={inMonthView ? onCreateEpic : onCreateInitiative}
          >
            <Plus className="size-3.5" />
            {inMonthView ? "Epic" : "Initiative"}
          </Button>
        ) : null}
      </div>

      {showInitiativeBacklogDrop ? (
        <div
          ref={setBacklogDropRef}
          className="pointer-events-auto -mb-2 h-2 w-full max-w-full shrink-0 opacity-0"
          aria-hidden
        />
      ) : null}

      {inMonthView ? (
        <div className="space-y-4">
          <div>
            <input
              value={epicSearch}
              onChange={(event) => setEpicSearch(event.target.value)}
              list="month-epic-search-suggestions"
              placeholder="Search epic..."
              className="h-10 w-full rounded-lg bg-white px-3 text-[13px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              aria-label="Search epics in selected month"
            />
            <datalist id="month-epic-search-suggestions">
              {monthPanelEpicsFiltered.map(({ epic }) => (
                <option key={`${epic.id}-${epic.title}`} value={epic.title} />
              ))}
            </datalist>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select
              value={panelQuarterFilter}
              onChange={(event) => setPanelQuarterFilter(event.target.value as "all" | "Q1" | "Q2" | "Q3" | "Q4")}
              className="h-9 rounded-lg bg-white px-2 text-[12px] font-semibold text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              aria-label="Filter left panel by quarter"
            >
              <option value="all">All quarters</option>
              <option value="Q1">Q1</option>
              <option value="Q2">Q2</option>
              <option value="Q3">Q3</option>
              <option value="Q4">Q4</option>
            </select>
            <select
              value={panelTeamFilterId}
              onChange={(event) => setPanelTeamFilterId(event.target.value)}
              className="h-9 rounded-lg bg-white px-2 text-[12px] font-semibold text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              aria-label="Filter left panel by team"
            >
              <option value="all">All teams</option>
              {MONTH_TEAM_COLUMNS.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
            <select
              value={panelStatusFilter}
              onChange={(event) =>
                setPanelStatusFilter(event.target.value as "all" | "To Do" | "In Progress" | "Done" | "Approved")
              }
              className="h-9 rounded-lg bg-white px-2 text-[12px] font-semibold text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              aria-label="Filter left panel by status"
            >
              <option value="all">All statuses</option>
              <option value="To Do">To Do</option>
              <option value="In Progress">In Progress</option>
              <option value="Done">Done</option>
              <option value="Approved">Approved</option>
            </select>
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
            {planAnchorMonth != null ? <EpicBacklogDropSlot month={planAnchorMonth} index={0} /> : null}
            {filteredMonthBacklogEpics.length === 0 ? (
              <p className="text-[11px] text-slate-700">
                {monthPanelEpics.length === 0
                  ? panelQuarterFilter !== "all" || panelTeamFilterId !== "all" || panelStatusFilter !== "all"
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
                    onOpenEpic={onOpenEpic}
                    onOpenStory={onOpenStory}
                    onDeleteEpic={onDeleteEpic}
                    onCreateStoryQuick={onCreateStoryQuick}
                    backlogDropSlot={
                      planAnchorMonth != null ? { month: planAnchorMonth, index: idx } : undefined
                    }
                    planContextMonth={planAnchorMonth}
                  />
                  {planAnchorMonth != null ? (
                    <EpicBacklogDropSlot month={planAnchorMonth} index={idx + 1} />
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <input
              value={initiativeSearch}
              onChange={(event) => setInitiativeSearch(event.target.value)}
              list="initiative-search-suggestions"
              placeholder="Search initiative..."
              className="h-10 w-full rounded-lg bg-white px-3 text-[13px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              aria-label="Search initiatives"
            />
            <datalist id="initiative-search-suggestions">
              {initiativeList.map((initiative) => (
                <option key={initiative.id} value={initiative.title} />
              ))}
            </datalist>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select
              value={panelQuarterFilter}
              onChange={(event) => setPanelQuarterFilter(event.target.value as "all" | "Q1" | "Q2" | "Q3" | "Q4")}
              className="h-9 rounded-lg bg-white px-2 text-[12px] font-semibold text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              aria-label="Filter initiatives by quarter"
            >
              <option value="all">All quarters</option>
              <option value="Q1">Q1</option>
              <option value="Q2">Q2</option>
              <option value="Q3">Q3</option>
              <option value="Q4">Q4</option>
            </select>
            <select
              value={panelTeamFilterId}
              onChange={(event) => setPanelTeamFilterId(event.target.value)}
              className="h-9 rounded-lg bg-white px-2 text-[12px] font-semibold text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              aria-label="Filter initiatives by team"
            >
              <option value="all">All teams</option>
              {MONTH_TEAM_COLUMNS.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
            <select
              value={panelStatusFilter}
              onChange={(event) =>
                setPanelStatusFilter(event.target.value as "all" | "To Do" | "In Progress" | "Done" | "Approved")
              }
              className="h-9 rounded-lg bg-white px-2 text-[12px] font-semibold text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              aria-label="Filter initiatives by status"
            >
              <option value="all">All statuses</option>
              <option value="To Do">To Do</option>
              <option value="In Progress">In Progress</option>
              <option value="Done">Done</option>
              <option value="Approved">Approved</option>
            </select>
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
