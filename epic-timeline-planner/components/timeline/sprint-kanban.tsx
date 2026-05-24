"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  CheckCheck,
  CheckCircle2,
  Folder,
  ListTodo,
  PlayCircle,
  UserRound,
  Users,
  UserX,
  X,
} from "lucide-react";
import { StoryStatus } from "@/lib/generated/prisma";
import { storyBoardDraggableId, sprintKanbanDropId } from "@/lib/epic-dnd-ids";
import { epicDeliveryTeamAssignmentChip, monthTeamLabelForId } from "@/lib/month-team-board";
import { assigneeMatchRosterForSprintTeam, type SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { collectStoriesForSprintBoard, collectEpicsForSprintKanban, type BoardStoryRow, type BoardEpicRow } from "@/lib/sprint-plan";
import { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { currentWorkYearSprintForPlan, sprintEndDate } from "@/lib/year-sprint";
import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { DragHandleIcon } from "@/components/ui/drag-handle";
import { UserAvatar, resolveAssigneeAvatar } from "@/components/ui/user-avatar";
import { UserStoryIcon } from "@/components/ui/user-story-icon";

function storyAssigneeLabel(story: UserStoryItem): string {
  return story.assignee?.trim() || "Unassigned";
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

function labelChipClass(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) & 0xffff;
  return LABEL_CHIP_PALETTES[hash % LABEL_CHIP_PALETTES.length]!;
}

function parseLabels(raw: string | null | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function LabelChips({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((lab, i) => (
        <span
          key={`${lab}-${i}`}
          className={cn(
            "inline-flex max-w-[10rem] shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold leading-tight",
            labelChipClass(lab),
          )}
        >
          <span className="truncate">{lab}</span>
        </span>
      ))}
    </div>
  );
}

function assigneeFilterIcon(name: string): LucideIcon {
  return name === "Unassigned" ? UserX : UserRound;
}

/** Roster for the active team filter plus names on stories (for typing/editing). */
function kanbanAssigneeSuggestions(
  boardStoryAssigneeNames: ReadonlySet<string>,
  currentAssignee: string | null | undefined,
): string[] {
  const set = new Set<string>(boardStoryAssigneeNames);
  const cur = currentAssignee?.trim();
  if (cur) set.add(cur);
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export type SprintKanbanStoryPatch = {
  assignee?: string | null;
  estimatedDays?: number;
  daysLeft?: number;
};

const KANBAN_COLUMNS: { status: StoryStatus; label: string; tone: string; hoverTone: string; Icon: LucideIcon }[] = [
  { status: StoryStatus.todo, label: "To do", tone: "border-slate-200 bg-slate-50/80", hoverTone: "hover:border-slate-300 hover:bg-slate-100/90 hover:shadow-sm", Icon: ListTodo },
  { status: StoryStatus.inProgress, label: "In progress", tone: "border-blue-200 bg-blue-50/60", hoverTone: "hover:border-blue-300 hover:bg-blue-100/70 hover:shadow-sm hover:shadow-blue-100", Icon: PlayCircle },
  { status: StoryStatus.done, label: "Done", tone: "border-emerald-200 bg-emerald-50/60", hoverTone: "hover:border-emerald-300 hover:bg-emerald-100/70 hover:shadow-sm hover:shadow-emerald-100", Icon: CheckCheck },
  { status: StoryStatus.approved, label: "Approved", tone: "border-violet-200 bg-violet-50/60", hoverTone: "hover:border-violet-300 hover:bg-violet-100/70 hover:shadow-sm hover:shadow-violet-100", Icon: CheckCircle2 },
];

function KanbanColumn({
  yearSprint,
  status,
  label,
  tone,
  hoverTone,
  Icon,
  dropDisabled = false,
  sortableItemIds,
  count,
  totalEst,
  totalLeft,
  children,
}: {
  yearSprint: number;
  status: StoryStatus;
  label: string;
  tone: string;
  hoverTone: string;
  Icon: LucideIcon;
  dropDisabled?: boolean;
  /** Draggable ids (`story:board:…`) in column order for vertical sortable. */
  sortableItemIds: string[];
  count: number;
  totalEst?: number;
  totalLeft?: number;
  children: ReactNode;
}) {
  const dropId = sprintKanbanDropId(yearSprint, status);
  const { setNodeRef, isOver } = useDroppable({ id: dropId, disabled: dropDisabled });
  const showStats = totalEst !== undefined && totalLeft !== undefined;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[calc(100dvh-10rem)] w-full min-w-0 flex-col rounded-xl border p-2 transition-all duration-150",
        tone,
        hoverTone,
        isOver && "border-primary bg-primary/5 ring-2 ring-primary/20",
      )}
    >
      <div className="mb-2 flex shrink-0 flex-col gap-0.5 pb-1">
        <div className="flex items-center justify-center gap-1.5 text-slate-600">
          <Icon className="size-4 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
          <p className="text-center text-[12px] font-bold uppercase tracking-wide">{label}</p>
          <span className="rounded-full bg-slate-200/80 px-1.5 py-0 text-[10px] font-semibold text-slate-500">
            {count}
          </span>
        </div>
        {showStats && (
          <div className="flex items-center justify-center gap-2 text-[10px] text-slate-500">
            <span title="Total estimate">{totalEst}d est</span>
            <span className="text-slate-300">·</span>
            <span title="Total days left">{totalLeft}d left</span>
          </div>
        )}
      </div>
      <SortableContext items={sortableItemIds} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">{children}</div>
      </SortableContext>
    </div>
  );
}

function KanbanStoryCard({
  row,
  boardStoryAssigneeNames,
  workspaceDirectoryUsers,
  dragDisabled = false,
  onOpenStory,
  onUnscheduleStory,
  onRequestUnscheduleStory,
  onPatchStory,
  emphasizeFlash = false,
  emphasizeTick = 0,
}: {
  row: BoardStoryRow;
  boardStoryAssigneeNames: ReadonlySet<string>;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  dragDisabled?: boolean;
  onOpenStory: (storyId: string) => void;
  onUnscheduleStory?: (storyId: string) => void;
  onRequestUnscheduleStory?: (storyId: string, storyTitle: string) => void;
  onPatchStory?: (storyId: string, patch: SprintKanbanStoryPatch) => void;
  emphasizeFlash?: boolean;
  emphasizeTick?: number;
}) {
  const { story, epic } = row;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: storyBoardDraggableId(story.id),
    disabled: dragDisabled,
  });

  const [editing, setEditing] = useState<null | "assignee" | "estimatedDays" | "daysLeft">(null);
  const [draftEst, setDraftEst] = useState(String(story.estimatedDays ?? 0));
  const [draftLeft, setDraftLeft] = useState(String(story.daysLeft ?? 0));
  const [draftAssignee, setDraftAssignee] = useState(story.assignee?.trim() ?? "");
  const assigneeInputWrapRef = useRef<HTMLDivElement>(null);
  const estInputRef = useRef<HTMLInputElement>(null);
  const leftInputRef = useRef<HTMLInputElement>(null);

  const assigneeSuggestions = useMemo(
    () => kanbanAssigneeSuggestions(boardStoryAssigneeNames, story.assignee),
    [boardStoryAssigneeNames, story.assignee],
  );

  useEffect(() => {
    setDraftEst(String(story.estimatedDays ?? 0));
    setDraftLeft(String(story.daysLeft ?? 0));
    setDraftAssignee(story.assignee?.trim() ?? "");
  }, [story.estimatedDays, story.daysLeft, story.assignee, story.id]);

  useLayoutEffect(() => {
    if (editing === "estimatedDays") estInputRef.current?.focus();
    else if (editing === "daysLeft") leftInputRef.current?.focus();
  }, [editing]);

  const commitAssignee = useCallback(() => {
    if (!onPatchStory) return;
    const next = draftAssignee.trim() || null;
    const prev = story.assignee?.trim() || null;
    if (next !== prev) onPatchStory(story.id, { assignee: next });
    setEditing(null);
  }, [draftAssignee, onPatchStory, story.assignee, story.id]);

  const commitEst = useCallback(() => {
    if (!onPatchStory) return;
    const n = Math.max(0, Math.round(Number(draftEst) || 0));
    if (n === (story.estimatedDays ?? 0)) {
      setEditing(null);
      return;
    }
    const patch: SprintKanbanStoryPatch = { estimatedDays: n };
    /** First-time fill: copy estimate into days left only while `daysLeft` has never been set in the DB. */
    if (story.daysLeft == null) patch.daysLeft = n;
    onPatchStory(story.id, patch);
    setEditing(null);
  }, [draftEst, onPatchStory, story.daysLeft, story.estimatedDays, story.id]);

  const commitLeft = useCallback(() => {
    if (!onPatchStory) return;
    const n = Math.max(0, Math.round(Number(draftLeft) || 0));
    if (n !== (story.daysLeft ?? 0)) onPatchStory(story.id, { daysLeft: n });
    setEditing(null);
  }, [draftLeft, onPatchStory, story.daysLeft, story.id]);

  useEffect(() => {
    if (editing !== "assignee") return;
    const fn = (e: MouseEvent) => {
      const t = e.target as Node;
      if (assigneeInputWrapRef.current?.contains(t)) return;
      commitAssignee();
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [editing, commitAssignee]);

  const editable = !dragDisabled && onPatchStory != null;

  // Days-burned-down progress: (estimated − left) / estimated. Stories in
  // done/approved have daysLeft=0 by API invariant, so they read 100%.
  // Stories with no estimate get no bar at all (nothing meaningful to show).
  const storyEstimatedDays = story.estimatedDays ?? 0;
  const storyDaysLeft = story.daysLeft ?? storyEstimatedDays;
  const storyDaysBurned = Math.max(0, storyEstimatedDays - storyDaysLeft);
  const storyProgressPercent =
    storyEstimatedDays > 0
      ? Math.min(100, Math.round((storyDaysBurned / storyEstimatedDays) * 100))
      : 0;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/story-card relative rounded-lg border border-slate-200/90 bg-white py-2.5 pl-2.5 pr-1.5 shadow-sm transition hover:bg-sky-50/70",
        emphasizeFlash && "ring-2 ring-sky-300/70",
        isDragging && "opacity-60",
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
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
          {dragDisabled ? null : (
            <button
              type="button"
              className="mt-1 shrink-0 cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
              aria-label="Drag story"
              {...attributes}
              {...listeners}
            >
              <DragHandleIcon size="sm" />
            </button>
          )}
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
            {story.labels && <LabelChips labels={parseLabels(story.labels)} />}
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
        {storyEstimatedDays > 0 ? (
          <div className="space-y-1">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-valuenow={storyProgressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${storyDaysBurned} of ${storyEstimatedDays} estimated days burned`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500 transition-[width] duration-300 ease-out"
                style={{ width: `${storyProgressPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-medium text-slate-500 tabular-nums">
              <span>
                <span className="font-semibold text-slate-700">{storyDaysBurned}d</span>
                <span className="mx-0.5 text-slate-300">/</span>
                <span>{storyEstimatedDays}d</span>
                <span className="ml-1 text-slate-400">burned</span>
              </span>
              <span className="font-semibold text-slate-700">{storyProgressPercent}%</span>
            </div>
          </div>
        ) : null}
        <div className="flex w-full flex-wrap items-center justify-end gap-2 pr-0">
          {epic.team ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-1 text-[12px] font-medium text-violet-700">
              <Users className="size-3 shrink-0 opacity-70" aria-hidden />
              {monthTeamLabelForId(epic.team) ?? epic.team}
            </span>
          ) : null}
          {editing === "assignee" && editable ? (
            <div ref={assigneeInputWrapRef} className="min-w-[7.5rem] max-w-[14rem] flex-1">
              <AssigneeCombobox
                value={draftAssignee}
                onChange={setDraftAssignee}
                suggestions={assigneeSuggestions}
                placeholder="Assignee"
                aria-label="Assignee"
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] font-medium text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitAssignee();
                  }
                  if (e.key === "Escape") {
                    setDraftAssignee(story.assignee?.trim() ?? "");
                    setEditing(null);
                  }
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              disabled={!editable}
              title={editable ? "Edit assignee" : undefined}
              onClick={() => editable && setEditing("assignee")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-left text-[12px] font-medium text-slate-700",
                editable && "cursor-pointer hover:bg-slate-200/90",
                !editable && "cursor-default",
              )}
            >
              {(() => {
                const resolved = resolveAssigneeAvatar(story.assignee, workspaceDirectoryUsers);
                return (
                  <UserAvatar name={resolved.name} image={resolved.image} size={18} />
                );
              })()}
              {storyAssigneeLabel(story)}
            </button>
          )}
          {editing === "estimatedDays" && editable ? (
            <input
              ref={estInputRef}
              type="number"
              min={0}
              value={draftEst}
              onChange={(e) => setDraftEst(e.target.value)}
              onBlur={commitEst}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setDraftEst(String(story.estimatedDays ?? 0));
                  setEditing(null);
                }
              }}
              className="w-[4.5rem] rounded-md border border-blue-200 bg-white px-2 py-1 text-center text-[12px] font-medium text-blue-800 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
              aria-label="Estimated days"
            />
          ) : (
            <button
              type="button"
              disabled={!editable}
              title={editable ? "Edit estimate" : undefined}
              onClick={() => editable && setEditing("estimatedDays")}
              className={cn(
                "rounded-md bg-blue-100 px-2 py-1 text-[12px] font-medium text-blue-700",
                editable && "cursor-pointer hover:bg-blue-200/80",
                !editable && "cursor-default",
              )}
            >
              Est: {story.estimatedDays ?? 0}d
            </button>
          )}
          {editing === "daysLeft" && editable ? (
            <input
              ref={leftInputRef}
              type="number"
              min={0}
              value={draftLeft}
              onChange={(e) => setDraftLeft(e.target.value)}
              onBlur={commitLeft}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setDraftLeft(String(story.daysLeft ?? 0));
                  setEditing(null);
                }
              }}
              className="w-[4.5rem] rounded-md border border-amber-200 bg-white px-2 py-1 text-center text-[12px] font-medium text-amber-800 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
              aria-label="Days left"
            />
          ) : (
            <button
              type="button"
              disabled={!editable}
              title={editable ? "Edit days left" : undefined}
              onClick={() => editable && setEditing("daysLeft")}
              className={cn(
                "rounded-md bg-amber-100 px-2 py-1 text-[12px] font-medium text-amber-700",
                editable && "cursor-pointer hover:bg-amber-200/80",
                !editable && "cursor-default",
              )}
            >
              Left: {story.daysLeft ?? 0}d
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Epic view (read-only) ───────────────────────────────────────────────────

const chipBase = "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold leading-none tracking-[0.01em]";

function quarterFromMonth(month: number): string {
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

function epicPlanningStatusMeta(epic: EpicItem): { label: string; className: string } {
  const isPlanned = epic.planSprint != null && epic.planStartMonth != null && epic.planEndMonth != null;
  if (!isPlanned) return { label: "Unscheduled", className: "border border-slate-200/90 bg-slate-100 text-slate-600" };
  return { label: quarterFromMonth(epic.planStartMonth!), className: "border border-violet-200/90 bg-violet-50 text-violet-800" };
}

function epicExecutionStatusMeta(epic: EpicItem): { label: string; className: string } {
  const stories = epic.userStories ?? [];
  if (stories.length === 0) return { label: "To Do", className: "border border-amber-200/90 bg-amber-50 text-amber-800" };
  if (stories.every((s) => s.status === "approved")) return { label: "Approved", className: "border border-violet-200/90 bg-violet-50 text-violet-800" };
  if (stories.every((s) => s.status === "done" || s.status === "approved")) return { label: "Done", className: "border border-emerald-200/90 bg-emerald-50 text-emerald-800" };
  if (stories.some((s) => s.status === "inProgress" || s.status === "done" || s.status === "approved")) return { label: "In Progress", className: "border border-blue-200/90 bg-blue-50 text-blue-800" };
  return { label: "To Do", className: "border border-amber-200/90 bg-amber-50 text-amber-800" };
}

function SprintEpicCard({
  row,
  month,
  yearSprint,
  onOpenEpic,
  workspaceDirectoryUsers,
}: {
  row: BoardEpicRow;
  month: number;
  yearSprint: number;
  onOpenEpic?: (epicId: string) => void;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
}) {
  const { epic, initiative } = row;
  const sprintStories = (epic.userStories ?? []).filter(
    (s) => s.sprint != null && (s.sprint >= 3 ? s.sprint === yearSprint : s.sprint + (month - 1) * 2 === yearSprint),
  );
  const todo = sprintStories.filter((s) => s.status === StoryStatus.todo).length;
  const inProgress = sprintStories.filter((s) => s.status === StoryStatus.inProgress).length;
  const done = sprintStories.filter((s) => s.status === StoryStatus.done).length;
  const approved = sprintStories.filter((s) => s.status === StoryStatus.approved).length;
  const total = sprintStories.length;

  const epicLabels = [...new Set(
    sprintStories.flatMap((s) => parseLabels(s.labels)),
  )];

  const planStatus = epicPlanningStatusMeta(epic);
  const execStatus = epicExecutionStatusMeta(epic);
  const teamChip = epic.team ? epicDeliveryTeamAssignmentChip(epic.team) : null;

  return (
    <div
      className="group rounded-lg border border-slate-200/90 bg-white py-2.5 pl-3 pr-2.5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
      style={{ borderLeftColor: epic.color, borderLeftWidth: 3 }}
    >
      <button
        type="button"
        onClick={() => onOpenEpic?.(epic.id)}
        className="w-full text-left"
        disabled={!onOpenEpic}
      >
        <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold leading-snug text-slate-900">
          {epic.icon?.trim() && epic.icon !== "📁" ? (
            <span className="shrink-0 text-[14px]">{epic.icon}</span>
          ) : (
            <Folder className="size-3.5 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
          )}
          <span className="min-w-0 truncate">{epic.title}</span>
        </p>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">{initiative.title}</p>
        {epicLabels.length > 0 && <LabelChips labels={epicLabels} />}

        {total > 0 ? (
          <div className="mt-2 space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="flex h-full">
                {approved > 0 && (
                  <div className="h-full bg-violet-400" style={{ width: `${(approved / total) * 100}%` }} />
                )}
                {done > 0 && (
                  <div className="h-full bg-emerald-400" style={{ width: `${(done / total) * 100}%` }} />
                )}
                {inProgress > 0 && (
                  <div className="h-full bg-blue-400" style={{ width: `${(inProgress / total) * 100}%` }} />
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
              {todo > 0 && <span className="text-slate-400">{todo} to do</span>}
              {inProgress > 0 && <span className="text-blue-500">{inProgress} in progress</span>}
              {done > 0 && <span className="text-emerald-500">{done} done</span>}
              {approved > 0 && <span className="text-violet-500">{approved} approved</span>}
            </div>
          </div>
        ) : (
          <p className="mt-1.5 text-[10px] text-slate-400">No stories in this sprint</p>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
          {epic.assignee?.trim() ? (() => {
            const resolved = resolveAssigneeAvatar(epic.assignee, workspaceDirectoryUsers);
            return (
              <span className={cn("inline-flex items-center gap-1 border border-slate-200 bg-slate-50 text-slate-700", chipBase)}>
                {resolved.image ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={resolved.image} alt="" className="size-3.5 shrink-0 rounded-full object-cover" />
                ) : (
                  <UserRound className="size-2.5 shrink-0 opacity-70" aria-hidden />
                )}
                <span className="max-w-[7rem] truncate">{epic.assignee.trim()}</span>
              </span>
            );
          })() : null}
          {teamChip ? (
            <span className={cn("inline-flex items-center gap-1", chipBase, teamChip.className)}>
              <Users className="size-2.5 shrink-0" aria-hidden />
              {teamChip.label}
            </span>
          ) : null}
          <span className={cn(chipBase, planStatus.className)}>{planStatus.label}</span>
          <span className={cn(chipBase, execStatus.className)}>{execStatus.label}</span>
        </div>
      </button>
    </div>
  );
}

const EPIC_STATUS_COLUMNS: { status: StoryStatus; label: string; tone: string; hoverTone: string; Icon: LucideIcon }[] = [
  { status: StoryStatus.todo, label: "To do", tone: "border-slate-200 bg-slate-50/80", hoverTone: "hover:border-slate-300 hover:bg-slate-100/90 hover:shadow-sm", Icon: ListTodo },
  { status: StoryStatus.inProgress, label: "In progress", tone: "border-blue-200 bg-blue-50/60", hoverTone: "hover:border-blue-300 hover:bg-blue-100/70 hover:shadow-sm hover:shadow-blue-100", Icon: PlayCircle },
  { status: StoryStatus.done, label: "Done", tone: "border-emerald-200 bg-emerald-50/60", hoverTone: "hover:border-emerald-300 hover:bg-emerald-100/70 hover:shadow-sm hover:shadow-emerald-100", Icon: CheckCheck },
  { status: StoryStatus.approved, label: "Approved", tone: "border-violet-200 bg-violet-50/60", hoverTone: "hover:border-violet-300 hover:bg-violet-100/70 hover:shadow-sm hover:shadow-violet-100", Icon: CheckCircle2 },
];

function SprintEpicKanbanView({
  epicRows,
  month,
  yearSprint,
  onOpenEpic,
  workspaceDirectoryUsers,
}: {
  epicRows: BoardEpicRow[];
  month: number;
  yearSprint: number;
  onOpenEpic?: (epicId: string) => void;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
}) {
  const byStatus = new Map<StoryStatus, BoardEpicRow[]>();
  for (const col of EPIC_STATUS_COLUMNS) byStatus.set(col.status, []);
  for (const row of epicRows) {
    byStatus.get(row.sprintStatus)?.push(row);
  }

  return (
    <div className="grid w-full min-w-0 grid-cols-2 gap-3 md:grid-cols-4">
      {EPIC_STATUS_COLUMNS.map(({ status, label, tone, hoverTone, Icon }) => {
        const colRows = byStatus.get(status) ?? [];
        return (
          <div
            key={status}
            className={cn(
              "flex min-h-[24rem] w-full min-w-0 flex-col rounded-xl border p-2 transition-all duration-150",
              tone,
              hoverTone,
            )}
          >
            <div className="mb-2 flex shrink-0 flex-col gap-0.5 pb-1">
              <div className="flex items-center justify-center gap-1.5 text-slate-600">
                <Icon className="size-4 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
                <p className="text-center text-[12px] font-bold uppercase tracking-wide">{label}</p>
                <span className="rounded-full bg-slate-200/80 px-1.5 py-0 text-[10px] font-semibold text-slate-500">
                  {colRows.length}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {colRows.map((row) => (
                <SprintEpicCard
                  key={row.epic.id}
                  row={row}
                  month={month}
                  yearSprint={yearSprint}
                  onOpenEpic={onOpenEpic}
                  workspaceDirectoryUsers={workspaceDirectoryUsers}
                />
              ))}
              {colRows.length === 0 && (
                <p className="py-4 text-center text-[11px] text-slate-400">No epics</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type SprintKanbanProps = {
  initiatives: InitiativeItem[];
  planYear: number;
  month: number;
  yearSprint: number;
  /** When set, only stories for epics on these delivery teams (same as left panel filter). */
  filterEpicTeamIds?: string[] | null;
  epicAccordionEmphasis?: { epicId: string; tick: number } | null;
  /** Batch sheen on all visible Kanban cards (e.g. when "Scheduled" summary filter is toggled on). */
  scheduledStoriesEmphasis?: { tick: number } | null;
  /** Shown on the same row as assignee filter chips (e.g. sprint countdown). */
  sprintToolbarEnd?: ReactNode;
  /** External search query (controlled from header bar). Filters story/epic titles. */
  searchQuery?: string;
  /** "epics" replaces story cards with read-only epic status cards. */
  viewMode?: "stories" | "epics";
  onUnscheduleStory?: (storyId: string) => void;
  onRequestUnscheduleStory?: (storyId: string, storyTitle: string) => void;
  onOpenStory: (storyId: string) => void;
  onOpenEpic?: (epicId: string) => void;
  onPatchStory?: (storyId: string, patch: SprintKanbanStoryPatch) => void;
  /** When viewing a closed sprint, jump to the first still-open sprint in `planYear` (same team filter). */
  onGoToOpenSprint?: (yearSprint: number) => void;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
};

export function SprintKanbanBoard({
  initiatives,
  planYear,
  month,
  yearSprint,
  filterEpicTeamIds = null,
  epicAccordionEmphasis = null,
  scheduledStoriesEmphasis = null,
  sprintToolbarEnd = null,
  searchQuery: searchQueryProp = "",
  viewMode = "stories",
  onUnscheduleStory,
  onRequestUnscheduleStory,
  onOpenStory,
  onOpenEpic,
  onPatchStory,
  onGoToOpenSprint,
  workspaceDirectoryUsers = [],
}: SprintKanbanProps) {
  const sprintClosed = sprintEndDate(planYear, yearSprint).getTime() <= Date.now();
  /** Fresh on each render so the target matches wall-clock "today" when the tab stays open across a sprint boundary. */
  const workTargetSprint = currentWorkYearSprintForPlan(planYear);
  const showGoToOpenSprint =
    sprintClosed && workTargetSprint != null && workTargetSprint !== yearSprint && onGoToOpenSprint;
  const allRows = useMemo(
    () => collectStoriesForSprintBoard(initiatives, month, yearSprint, filterEpicTeamIds),
    [initiatives, month, yearSprint, filterEpicTeamIds],
  );

  const epicRows = useMemo(
    () => viewMode === "epics" ? collectEpicsForSprintKanban(initiatives, month, yearSprint, filterEpicTeamIds) : [],
    [viewMode, initiatives, month, yearSprint, filterEpicTeamIds],
  );

  const activeTeamIds = filterEpicTeamIds ?? [];

  /** Team roster + assignees on visible sprint stories — drives filter chips and assignee autocomplete. */
  const boardStoryAssigneeNames = useMemo(() => {
    const s = new Set<string>();
    for (const teamId of activeTeamIds) {
      for (const name of assigneeMatchRosterForSprintTeam(teamId, workspaceDirectoryUsers)) s.add(name);
    }
    for (const row of allRows) {
      const a = row.story.assignee?.trim();
      if (a) s.add(a);
    }
    return s;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, filterEpicTeamIds, workspaceDirectoryUsers]);

  const assigneeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const teamId of activeTeamIds) {
      for (const name of assigneeMatchRosterForSprintTeam(teamId, workspaceDirectoryUsers)) names.add(name);
    }
    for (const row of allRows) names.add(storyAssigneeLabel(row.story));
    return [...names].sort((a, b) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, filterEpicTeamIds, workspaceDirectoryUsers]);

  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [assigneeFilterExpanded, setAssigneeFilterExpanded] = useState(false);
  const searchQuery = searchQueryProp;

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

  /** Assignee avatar circles when one or more delivery teams are selected (not "all teams"). */
  const showAssigneePeopleFilter = activeTeamIds.length > 0;

  const selectAllAssignees = useCallback(() => {
    setSelectedAssignees((prev) => {
      if (assigneeOptions.length === 0) return prev;
      if (prev.length === assigneeOptions.length) return [];
      return [...assigneeOptions];
    });
  }, [assigneeOptions]);

  const searchLower = searchQuery.trim().toLowerCase();

  const filteredByAssignee =
    !showAssigneePeopleFilter || selectedAssignees.length === 0
      ? allRows
      : allRows.filter((row) => selectedAssignees.includes(storyAssigneeLabel(row.story)));

  const rows = searchLower
    ? filteredByAssignee.filter(
        (row) =>
          row.story.title.toLowerCase().includes(searchLower) ||
          row.epic.title.toLowerCase().includes(searchLower),
      )
    : filteredByAssignee;

  const filteredEpicRows = searchLower
    ? epicRows.filter(
        (row) =>
          row.epic.title.toLowerCase().includes(searchLower) ||
          row.initiative.title.toLowerCase().includes(searchLower),
      )
    : epicRows;

  const byStatus = new Map<StoryStatus, BoardStoryRow[]>();
  for (const col of KANBAN_COLUMNS) {
    byStatus.set(col.status, []);
  }
  for (const row of rows) {
    const list = byStatus.get(row.story.status);
    if (list) list.push(row);
  }
  for (const col of KANBAN_COLUMNS) {
    const list = byStatus.get(col.status);
    if (list && list.length > 1) {
      list.sort((a, b) => {
        const ao = a.story.backlogOrder ?? 0;
        const bo = b.story.backlogOrder ?? 0;
        if (ao !== bo) return ao - bo;
        const t = a.story.title.localeCompare(b.story.title, undefined, { sensitivity: "base" });
        if (t !== 0) return t;
        return a.story.id.localeCompare(b.story.id);
      });
    }
  }

  const assigneeBadgeLabel = useCallback((name: string) => {
    if (name === "Unassigned") return "U";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) {
      const p = parts[0];
      if (p.length <= 1) return p.toUpperCase();
      return p.slice(0, 2).toUpperCase();
    }
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }, []);

  const showToolbarRow = (showAssigneePeopleFilter && assigneeOptions.length > 0) || sprintToolbarEnd != null;

  return (
    <div className="relative flex w-full min-h-min flex-col gap-2">
      {sprintClosed ? (
        <>
          <div className="pointer-events-none absolute inset-0 z-20 rounded-xl bg-slate-900/5 backdrop-blur-[1px]" />
          <div className="pointer-events-none absolute inset-x-3 top-2 z-30 flex flex-col items-center gap-3">
            <div
              className="px-4 py-2 text-[13px] font-semibold tracking-[0.01em] text-slate-800"
              style={{
                background: "rgba(255, 255, 255, 0.2)",
                borderRadius: "16px",
                boxShadow: "0 2px 16px rgba(15, 23, 42, 0.05)",
                backdropFilter: "blur(1.2px)",
                WebkitBackdropFilter: "blur(1.2px)",
                border: "1px solid rgba(255, 255, 255, 0.44)",
              }}
            >
              <img
                src="/closed-sign-transparent.png"
                alt={`Sprint ${yearSprint} is closed`}
                className="h-40 w-auto object-contain"
                draggable={false}
              />
            </div>
            {showGoToOpenSprint ? (
              <a
                href="#"
                className="pointer-events-auto inline-flex items-center gap-1.5 text-[13px] font-semibold text-sky-700 underline decoration-sky-400 underline-offset-4 hover:text-sky-800"
                onClick={(event) => {
                  event.preventDefault();
                  const target = currentWorkYearSprintForPlan(planYear);
                  if (target != null) onGoToOpenSprint!(target);
                }}
              >
                <ArrowRight className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
                View current sprint (Sprint {workTargetSprint})
              </a>
            ) : null}
          </div>
        </>
      ) : null}
      {showToolbarRow ? (
        <div className="shrink-0 px-2.5 py-1">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center py-0.5",
                !(showAssigneePeopleFilter && assigneeOptions.length > 0) && "min-h-[2.25rem]",
              )}
              onMouseEnter={() =>
                showAssigneePeopleFilter && assigneeOptions.length > 0 && setAssigneeFilterExpanded(true)
              }
              onMouseLeave={() =>
                showAssigneePeopleFilter && assigneeOptions.length > 0 && setAssigneeFilterExpanded(false)
              }
            >
              {showAssigneePeopleFilter && assigneeOptions.length > 0 ? (
                <>
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
                    const isUnassigned = name === "Unassigned";
                    const resolved = isUnassigned
                      ? { name: "", image: null }
                      : resolveAssigneeAvatar(name, workspaceDirectoryUsers);
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
                        {/* Collapsed: show photo / initials inside the circle.
                            Expanded: small avatar + the full name. */}
                        {isUnassigned ? (
                          <Icon className="size-[15px] shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
                        ) : !assigneeFilterExpanded ? (
                          resolved.image ? (
                            <UserAvatar name={resolved.name} image={resolved.image} size={32} className="ring-0" />
                          ) : (
                            <span>{assigneeBadgeLabel(name)}</span>
                          )
                        ) : (
                          <UserAvatar name={resolved.name} image={resolved.image} size={22} className="ring-0" />
                        )}
                        {assigneeFilterExpanded ? (
                          <span className="max-w-[12rem] truncate text-[12px]">{name}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </>
              ) : null}
            </div>
            {sprintToolbarEnd ? <div className="flex shrink-0 items-center">{sprintToolbarEnd}</div> : null}
          </div>
        </div>
      ) : null}
      {viewMode === "epics" ? (
        <SprintEpicKanbanView
          epicRows={filteredEpicRows}
          month={month}
          yearSprint={yearSprint}
          onOpenEpic={onOpenEpic}
          workspaceDirectoryUsers={workspaceDirectoryUsers}
        />
      ) : null}
      <div className={cn("grid w-full min-w-0 grid-cols-2 gap-3 md:grid-cols-4", viewMode === "epics" && "hidden")}>
        {KANBAN_COLUMNS.map(({ status, label, tone, hoverTone, Icon }) => {
          const colRows = byStatus.get(status) ?? [];
          const sortableItemIds = colRows.map((r) => storyBoardDraggableId(r.story.id));
          const showEstStats = status === StoryStatus.todo || status === StoryStatus.inProgress;
          const totalEst = showEstStats
            ? colRows.reduce((s, r) => s + (r.story.estimatedDays ?? 0), 0)
            : undefined;
          const totalLeft = showEstStats
            ? colRows.reduce((s, r) => s + (r.story.daysLeft ?? 0), 0)
            : undefined;
          return (
          <KanbanColumn
            key={status}
            yearSprint={yearSprint}
            status={status}
            label={label}
            tone={tone}
            hoverTone={hoverTone}
            Icon={Icon}
            dropDisabled={sprintClosed}
            sortableItemIds={sortableItemIds}
            count={colRows.length}
            totalEst={totalEst}
            totalLeft={totalLeft}
          >
            {colRows.map((row) => {
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
                  boardStoryAssigneeNames={boardStoryAssigneeNames}
                  workspaceDirectoryUsers={workspaceDirectoryUsers}
                  dragDisabled={sprintClosed}
                  onOpenStory={onOpenStory}
                  onUnscheduleStory={onUnscheduleStory}
                  onRequestUnscheduleStory={onRequestUnscheduleStory}
                  onPatchStory={onPatchStory}
                  emphasizeFlash={emphasizeFlash}
                  emphasizeTick={emphasizeTick}
                />
              );
            })}
          </KanbanColumn>
          );
        })}
      </div>
    </div>
  );
}
