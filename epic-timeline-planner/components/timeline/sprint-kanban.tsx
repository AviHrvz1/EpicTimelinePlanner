"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { LucideIcon } from "lucide-react";
import { CheckCheck, CheckCircle2, ListTodo, PlayCircle, UserRound, Users, UserX, X } from "lucide-react";
import { StoryStatus } from "@/lib/generated/prisma";
import { storyBoardDraggableId, sprintKanbanDropId } from "@/lib/epic-dnd-ids";
import { collectStoriesForSprintBoard, type BoardStoryRow } from "@/lib/sprint-plan";
import { InitiativeItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DragHandleIcon } from "@/components/ui/drag-handle";
import { UserStoryIcon } from "@/components/ui/user-story-icon";

function storyAssigneeLabel(story: UserStoryItem): string {
  return story.assignee?.trim() || "Unassigned";
}

function assigneeFilterIcon(name: string): LucideIcon {
  return name === "Unassigned" ? UserX : UserRound;
}

const KANBAN_COLUMNS: { status: StoryStatus; label: string; tone: string; Icon: LucideIcon }[] = [
  { status: StoryStatus.todo, label: "To do", tone: "border-slate-200 bg-slate-50/80", Icon: ListTodo },
  { status: StoryStatus.inProgress, label: "In progress", tone: "border-blue-200 bg-blue-50/60", Icon: PlayCircle },
  { status: StoryStatus.done, label: "Done", tone: "border-emerald-200 bg-emerald-50/60", Icon: CheckCheck },
  { status: StoryStatus.approved, label: "Approved", tone: "border-violet-200 bg-violet-50/60", Icon: CheckCircle2 },
];

function KanbanColumn({
  yearSprint,
  status,
  label,
  tone,
  Icon,
  children,
}: {
  yearSprint: number;
  status: StoryStatus;
  label: string;
  tone: string;
  Icon: LucideIcon;
  children: ReactNode;
}) {
  const dropId = sprintKanbanDropId(yearSprint, status);
  const { setNodeRef, isOver } = useDroppable({ id: dropId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-0 w-full flex-col rounded-xl border p-2 transition",
        tone,
        isOver && "border-primary bg-primary/5 ring-2 ring-primary/20",
      )}
    >
      <div className="mb-2 flex items-center justify-center gap-1.5 pb-1 text-slate-600">
        <Icon className="size-4 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
        <p className="text-center text-[12px] font-bold uppercase tracking-wide">{label}</p>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function KanbanStoryCard({
  row,
  onOpenStory,
  onUnscheduleStory,
  onRequestUnscheduleStory,
  emphasizeFlash = false,
  emphasizeTick = 0,
}: {
  row: BoardStoryRow;
  onOpenStory: (storyId: string) => void;
  onUnscheduleStory?: (storyId: string) => void;
  onRequestUnscheduleStory?: (storyId: string, storyTitle: string) => void;
  emphasizeFlash?: boolean;
  emphasizeTick?: number;
}) {
  const { story, epic } = row;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: storyBoardDraggableId(story.id),
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/story-card relative rounded-lg border border-slate-200/90 bg-white py-2.5 pl-2.5 pr-1.5 shadow-sm transition",
        emphasizeFlash && "ring-2 ring-sky-300/70",
        isDragging && "opacity-60",
      )}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 20 : undefined,
      }}
    >
      {emphasizeFlash ? (
        <div
          key={emphasizeTick}
          className="pointer-events-none absolute inset-0 z-[2] rounded-[inherit] animate-initiative-bar-emphasis-sheen"
          aria-hidden
        />
      ) : null}
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-1.5">
          <button
            type="button"
            className="mt-1 shrink-0 cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag story"
            {...attributes}
            {...listeners}
          >
            <DragHandleIcon size="sm" />
          </button>
          <button
            type="button"
            onClick={() => onOpenStory(story.id)}
            className="min-w-0 flex-1 rounded-md py-0.5 pl-0 pr-1 text-left transition hover:bg-slate-50"
            aria-label="Open user story details"
          >
            <p className="min-w-0 text-[15px] font-semibold leading-snug text-slate-900">
              <span className="mr-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center align-middle" aria-hidden>
                <UserStoryIcon />
              </span>
              {story.title}
            </p>
            <p className="mt-1.5 truncate text-[13px] text-slate-500">{epic.title}</p>
          </button>
          {onUnscheduleStory ? (
            <button
              type="button"
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-0 transition group-hover/story-card:opacity-100 hover:bg-slate-100 hover:text-rose-600"
              aria-label="Unschedule story"
              title="Move story to unscheduled backlog"
              onClick={(event) => {
                event.stopPropagation();
                if (onRequestUnscheduleStory) {
                  onRequestUnscheduleStory(story.id, story.title);
                } else {
                  onUnscheduleStory(story.id);
                }
              }}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-1.5 pr-0">
          <span className="rounded-md bg-slate-100 px-2 py-1 text-[12px] font-medium text-slate-700">
            {storyAssigneeLabel(story)}
          </span>
          <span className="rounded-md bg-blue-100 px-2 py-1 text-[12px] font-medium text-blue-700">
            Est: {story.estimatedDays ?? 0}d
          </span>
          <span className="rounded-md bg-amber-100 px-2 py-1 text-[12px] font-medium text-amber-700">
            Left: {story.daysLeft ?? 0}d
          </span>
        </div>
      </div>
    </div>
  );
}

type SprintKanbanProps = {
  initiatives: InitiativeItem[];
  month: number;
  yearSprint: number;
  /** When set, only stories for epics on this delivery team (same as left panel filter). */
  filterEpicTeamId?: string | null;
  epicAccordionEmphasis?: { epicId: string; tick: number } | null;
  /** Batch sheen on all visible Kanban cards (e.g. when “Scheduled” summary filter is toggled on). */
  scheduledStoriesEmphasis?: { tick: number } | null;
  onUnscheduleStory?: (storyId: string) => void;
  onRequestUnscheduleStory?: (storyId: string, storyTitle: string) => void;
  onOpenStory: (storyId: string) => void;
};

export function SprintKanbanBoard({
  initiatives,
  month,
  yearSprint,
  filterEpicTeamId = null,
  epicAccordionEmphasis = null,
  scheduledStoriesEmphasis = null,
  onUnscheduleStory,
  onRequestUnscheduleStory,
  onOpenStory,
}: SprintKanbanProps) {
  const allRows = useMemo(
    () => collectStoriesForSprintBoard(initiatives, month, yearSprint, filterEpicTeamId),
    [initiatives, month, yearSprint, filterEpicTeamId],
  );

  const assigneeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of allRows) names.add(storyAssigneeLabel(row.story));
    return [...names].sort((a, b) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
  }, [allRows]);

  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [assigneeFilterExpanded, setAssigneeFilterExpanded] = useState(false);

  useEffect(() => {
    const valid = new Set(assigneeOptions);
    setSelectedAssignees((prev) => {
      const next = prev.filter((name) => valid.has(name));
      if (next.length === prev.length && next.every((n, i) => n === prev[i])) return prev;
      return next;
    });
  }, [assigneeOptions]);

  const toggleAssigneeFilter = useCallback((name: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const allAssigneesSelected =
    assigneeOptions.length > 0 && selectedAssignees.length === assigneeOptions.length;

  const selectAllAssignees = useCallback(() => {
    setSelectedAssignees((prev) => {
      if (assigneeOptions.length === 0) return prev;
      if (prev.length === assigneeOptions.length) return [];
      return [...assigneeOptions];
    });
  }, [assigneeOptions]);

  const rows =
    selectedAssignees.length === 0
      ? allRows
      : allRows.filter((row) => selectedAssignees.includes(storyAssigneeLabel(row.story)));

  const byStatus = new Map<StoryStatus, BoardStoryRow[]>();
  for (const col of KANBAN_COLUMNS) {
    byStatus.set(col.status, []);
  }
  for (const row of rows) {
    const list = byStatus.get(row.story.status);
    if (list) list.push(row);
  }

  const assigneeBadgeLabel = useCallback((name: string) => {
    if (name === "Unassigned") return "U";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }, []);

  return (
    <div className="flex w-full min-h-0 flex-col gap-2">
      {assigneeOptions.length > 0 ? (
        <div className="shrink-0 rounded-xl bg-slate-50/90 px-2.5 py-1">
          <div
            className="flex min-w-0 items-center py-0.5"
            onMouseEnter={() => setAssigneeFilterExpanded(true)}
            onMouseLeave={() => setAssigneeFilterExpanded(false)}
          >
            <button
              type="button"
              aria-pressed={allAssigneesSelected}
              title={allAssigneesSelected ? "Clear assignee filter" : "Select all assignees"}
              aria-label={allAssigneesSelected ? "Clear assignee filter" : "Select all assignees"}
              onClick={selectAllAssignees}
              className={cn(
                "relative z-20 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tracking-[0.02em] ring-1 transition",
                allAssigneesSelected
                  ? "bg-sky-600 text-white ring-sky-700"
                  : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100",
              )}
            >
              <Users className="size-[15px]" strokeWidth={2.25} aria-hidden />
            </button>
            {assigneeOptions.map((name, idx) => {
              const on = selectedAssignees.includes(name);
              const Icon = assigneeFilterIcon(name);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleAssigneeFilter(name)}
                  className={cn(
                    "relative inline-flex h-9 shrink-0 items-center rounded-full text-left text-[11px] font-semibold tracking-[0.02em] ring-1 transition-[margin,transform,background-color,color,box-shadow,width,padding] duration-200",
                    assigneeFilterExpanded ? "w-auto gap-1.5 px-2.5" : "w-9 justify-center px-0",
                    on
                      ? "bg-sky-600 text-white ring-sky-700"
                      : "bg-white text-slate-800 ring-slate-200 hover:bg-slate-100",
                  )}
                  title={name}
                  style={{
                    marginLeft: assigneeFilterExpanded ? 6 : -12,
                    zIndex: assigneeFilterExpanded ? 10 : 10 - Math.min(idx, 9),
                  }}
                >
                  {name === "Unassigned" ? <Icon className="size-[15px] shrink-0 opacity-90" strokeWidth={2.25} aria-hidden /> : null}
                  {name !== "Unassigned" && !assigneeFilterExpanded ? <span>{assigneeBadgeLabel(name)}</span> : null}
                  {assigneeFilterExpanded ? (
                    <span className="max-w-[12rem] truncate text-[12px]">{name}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
        {KANBAN_COLUMNS.map(({ status, label, tone, Icon }) => (
          <KanbanColumn
            key={status}
            yearSprint={yearSprint}
            status={status}
            label={label}
            tone={tone}
            Icon={Icon}
          >
            {(byStatus.get(status) ?? []).map((row) => {
              const accordionEmphasis =
                epicAccordionEmphasis != null && epicAccordionEmphasis.epicId === row.epic.id;
              const scheduledBatch = scheduledStoriesEmphasis != null;
              const emphasizeFlash = accordionEmphasis || scheduledBatch;
              const emphasizeTick = accordionEmphasis
                ? epicAccordionEmphasis!.tick
                : scheduledBatch
                  ? scheduledStoriesEmphasis!.tick
                  : 0;
              return (
                <KanbanStoryCard
                  key={row.story.id}
                  row={row}
                  onOpenStory={onOpenStory}
                  onUnscheduleStory={onUnscheduleStory}
                  onRequestUnscheduleStory={onRequestUnscheduleStory}
                  emphasizeFlash={emphasizeFlash}
                  emphasizeTick={emphasizeTick}
                />
              );
            })}
          </KanbanColumn>
        ))}
      </div>
    </div>
  );
}
