"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LucideIcon } from "lucide-react";
import {
  CheckCheck,
  CheckCircle2,
  Folder,
  ListTodo,
  Pin,
  PinOff,
  PlayCircle,
  UserRound,
  Users,
  UserX,
  X,
} from "lucide-react";
import { StoryStatus } from "@/lib/generated/prisma";
import { storyBoardDraggableId, sprintKanbanDropId } from "@/lib/epic-dnd-ids";
import { epicDeliveryTeamAssignmentChip, monthTeamLabelForId } from "@/lib/month-team-board";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { assigneeMatchRosterForSprintTeam, type SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { collectStoriesForSprintBoard, collectEpicsForSprintKanban, type BoardStoryRow, type BoardEpicRow } from "@/lib/sprint-plan";
import { parseStoryRollover, storyRolledIntoSprint } from "@/lib/story-rollover-history";
import { projectInitiativesToCloseDate } from "@/lib/story-snapshot-projection";
import { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { sprintEndDate } from "@/lib/year-sprint";
import { nowMs as clockNowMs } from "@/lib/clock";
import { formatAssigneeShortLabel } from "@/lib/assignee-display";
import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { DragHandleIcon } from "@/components/ui/drag-handle";
import { UserAvatar, resolveAssigneeAvatar } from "@/components/ui/user-avatar";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { HealthBadge } from "@/components/timeline/health-badge";
import { computeStoryHealthVerdict, formatStoryHealthTooltip } from "@/lib/story-health";
import { computeEpicHealthVerdict } from "@/lib/epic-health";
import { formatHealthTooltip } from "@/components/timeline/health-badge";

function storyAssigneeLabel(story: UserStoryItem): string {
  const t = story.assignee?.trim();
  if (!t) return "Unassigned";
  return formatAssigneeShortLabel(t);
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
  { status: StoryStatus.review, label: "Review / Testing", tone: "border-violet-200 bg-violet-50/60", hoverTone: "hover:border-violet-300 hover:bg-violet-100/70 hover:shadow-sm hover:shadow-violet-100", Icon: CheckCheck },
  { status: StoryStatus.done, label: "Done", tone: "border-emerald-200 bg-emerald-50/60", hoverTone: "hover:border-emerald-300 hover:bg-emerald-100/70 hover:shadow-sm hover:shadow-emerald-100", Icon: CheckCircle2 },
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
  planYear,
  showHealthBadge = false,
  boardStoryAssigneeNames,
  workspaceDirectoryUsers,
  dragDisabled = false,
  viewedYearSprint,
  onOpenStory,
  onUnscheduleStory,
  onRequestUnscheduleStory,
  onPatchStory,
  emphasizeFlash = false,
  emphasizeTick = 0,
  showProgress = false,
}: {
  row: BoardStoryRow;
  planYear: number;
  showHealthBadge?: boolean;
  boardStoryAssigneeNames: ReadonlySet<string>;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  dragDisabled?: boolean;
  /** The sprint this card is being rendered FOR — used to surface the
   *  `↩ S{from}` "rolled in" pill on the destination sprint after a manual
   *  move. (The closed-sprint `↪` outgoing branch was retired alongside
   *  Phase 3 scope expansion — moves are deliberate and the source sprint
   *  no longer surfaces the moved card.) */
  viewedYearSprint?: number;
  onOpenStory: (storyId: string) => void;
  onUnscheduleStory?: (storyId: string) => void;
  onRequestUnscheduleStory?: (storyId: string, storyTitle: string) => void;
  onPatchStory?: (storyId: string, patch: SprintKanbanStoryPatch) => void;
  emphasizeFlash?: boolean;
  emphasizeTick?: number;
  showProgress?: boolean;
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

  // Rollover lineage derived from history. A single pill summarises chain
  // depth so chained moves (S6 → S7 → S8) stay one fixed-width label instead
  // of three.
  const rollover = useMemo(() => parseStoryRollover(story), [story]);
  const rolloverPill: { sprint: number; chainDepth: number } | null = (() => {
    if (viewedYearSprint == null) return null;
    if (rollover.rolledFromSprint == null || rollover.rolledToSprint == null) return null;
    if (rollover.rolledToSprint !== viewedYearSprint) return null;
    return { sprint: rollover.rolledFromSprint, chainDepth: rollover.chainDepth };
  })();

  // Days-burned-down progress: (estimated − left) / estimated. Stories in
  // review/done have daysLeft=0 by API invariant, so they read 100%.
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
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-1.5">
          {dragDisabled ? null : (
            <button
              type="button"
              className="mt-0.5 shrink-0 cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
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
            <div className="flex min-w-0 items-start gap-1.5 text-[15px] font-semibold leading-snug text-slate-900">
              <UserStoryIcon className="mt-[2px] size-4 shrink-0" />
              <span className="min-w-0">{story.title}</span>
            </div>
            <p className="mt-1.5 flex min-w-0 items-center gap-1.5 truncate text-[13px] text-slate-500">
              <span className="truncate">{epic.title}</span>
              {rolloverPill ? (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 rounded border border-indigo-200/80 bg-indigo-50 px-1 py-px text-[10px] font-medium leading-tight text-indigo-700"
                  title={`Rolled in from sprint ${rolloverPill.sprint}${rolloverPill.chainDepth > 1 ? ` (chain ×${rolloverPill.chainDepth})` : ""}`}
                >
                  ↩ S{rolloverPill.sprint}
                  {rolloverPill.chainDepth > 1 ? ` ·×${rolloverPill.chainDepth}` : null}
                </span>
              ) : null}
            </p>
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
        {showProgress && storyEstimatedDays > 0 ? (
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
          {/* Sprint-burndown health verdict — same helper the hero's
           *  Health Distribution donut + backlog Health column use,
           *  toggled by the chip-toolbar "Health" button. Null
           *  verdicts (no sprint, no resolvable burndown) skip the
           *  chip even when the toggle is on. Team chip removed from
           *  story cards — the team's identity already shows on the
           *  per-column team filter chips at the top of the kanban,
           *  duplicating it inside every card was redundant and
           *  pushed the assignee + days chips off the row. */}
          {showHealthBadge ? (() => {
            const v = computeStoryHealthVerdict(row.story, epic, planYear);
            if (!v) return null;
            const tip = formatStoryHealthTooltip(row.story, epic, planYear, v.status);
            return <HealthBadge status={v.status} size="xs" tooltip={tip ?? undefined} />;
          })() : null}
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
  if (stories.every((s) => s.status === "done")) return { label: "Done", className: "border border-emerald-200/90 bg-emerald-50 text-emerald-800" };
  if (stories.every((s) => s.status === "review" || s.status === "done")) return { label: "Review / Testing", className: "border border-violet-200/90 bg-violet-50 text-violet-800" };
  if (stories.some((s) => s.status === "inProgress" || s.status === "review" || s.status === "done")) return { label: "In Progress", className: "border border-blue-200/90 bg-blue-50 text-blue-800" };
  return { label: "To Do", className: "border border-amber-200/90 bg-amber-50 text-amber-800" };
}

function SprintEpicCard({
  row,
  month,
  yearSprint,
  planYear,
  progressBasis,
  showHealthBadge = false,
  onOpenEpic,
  workspaceDirectoryUsers,
  showProgress = false,
}: {
  row: BoardEpicRow;
  month: number;
  yearSprint: number;
  planYear: number;
  progressBasis: "days" | "stories" | "epicEst";
  showHealthBadge?: boolean;
  onOpenEpic?: (epicId: string) => void;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  showProgress?: boolean;
}) {
  const { epic, initiative } = row;
  const sprintStories = (epic.userStories ?? []).filter(
    (s) => s.sprint != null && (s.sprint >= 3 ? s.sprint === yearSprint : s.sprint + (month - 1) * 2 === yearSprint),
  );
  const todo = sprintStories.filter((s) => s.status === StoryStatus.todo).length;
  const inProgress = sprintStories.filter((s) => s.status === StoryStatus.inProgress).length;
  const review = sprintStories.filter((s) => s.status === StoryStatus.review).length;
  const done = sprintStories.filter((s) => s.status === StoryStatus.done).length;
  const total = sprintStories.length;

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

        {total === 0 ? (
          <p className="mt-1.5 text-[10px] text-slate-400">No stories in this sprint</p>
        ) : showProgress ? (
          <div className="mt-2 space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="flex h-full">
                {done > 0 && (
                  <div className="h-full bg-emerald-400" style={{ width: `${(done / total) * 100}%` }} />
                )}
                {review > 0 && (
                  <div className="h-full bg-violet-400" style={{ width: `${(review / total) * 100}%` }} />
                )}
                {inProgress > 0 && (
                  <div className="h-full bg-blue-400" style={{ width: `${(inProgress / total) * 100}%` }} />
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
              {todo > 0 && <span className="text-slate-400">{todo} to do</span>}
              {inProgress > 0 && <span className="text-blue-500">{inProgress} in progress</span>}
              {review > 0 && <span className="text-violet-500">{review} review</span>}
              {done > 0 && <span className="text-emerald-500">{done} done</span>}
            </div>
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-1.5">
          {/* Epic-level health verdict — same helper the hero's Health
           *  Distribution donut uses at Epic scope, gated by the
           *  chip-toolbar Health toggle. */}
          {showHealthBadge ? (() => {
            const v = computeEpicHealthVerdict(epic, planYear, progressBasis);
            if (!v) return null;
            const tip = formatHealthTooltip(v.result);
            return <HealthBadge status={v.status} size="xs" tooltip={tip} />;
          })() : null}
          {epic.assignee?.trim() ? (() => {
            const fullName = epic.assignee.trim();
            const resolved = resolveAssigneeAvatar(epic.assignee, workspaceDirectoryUsers);
            return (
              <span
                className={cn("inline-flex items-center gap-1 border border-slate-200 bg-slate-50 text-slate-700", chipBase)}
                title={fullName}
              >
                {resolved.image ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={resolved.image} alt="" className="size-3.5 shrink-0 rounded-full object-cover" />
                ) : (
                  <UserRound className="size-2.5 shrink-0 opacity-70" aria-hidden />
                )}
                <span className="max-w-[7rem] truncate">{formatAssigneeShortLabel(fullName)}</span>
              </span>
            );
          })() : null}
          {teamChip ? (
            <span className={cn("inline-flex items-center gap-1", chipBase, teamChip.className)}>
              <TeamAvatar slug={epic.team} sizePx={10} fallback={<Users className="size-2.5 shrink-0" aria-hidden />} />
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
  { status: StoryStatus.review, label: "Review / Testing", tone: "border-violet-200 bg-violet-50/60", hoverTone: "hover:border-violet-300 hover:bg-violet-100/70 hover:shadow-sm hover:shadow-violet-100", Icon: CheckCheck },
  { status: StoryStatus.done, label: "Done", tone: "border-emerald-200 bg-emerald-50/60", hoverTone: "hover:border-emerald-300 hover:bg-emerald-100/70 hover:shadow-sm hover:shadow-emerald-100", Icon: CheckCircle2 },
];

function SprintEpicKanbanView({
  epicRows,
  month,
  yearSprint,
  planYear,
  progressBasis,
  showHealthBadges = false,
  onOpenEpic,
  workspaceDirectoryUsers,
  showProgress = false,
}: {
  epicRows: BoardEpicRow[];
  month: number;
  yearSprint: number;
  planYear: number;
  progressBasis: "days" | "stories" | "epicEst";
  showHealthBadges?: boolean;
  onOpenEpic?: (epicId: string) => void;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  showProgress?: boolean;
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
                  planYear={planYear}
                  progressBasis={progressBasis}
                  showHealthBadge={showHealthBadges}
                  onOpenEpic={onOpenEpic}
                  workspaceDirectoryUsers={workspaceDirectoryUsers}
                  showProgress={showProgress}
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
  /** When true, story cards show the burn-down progress bar and epic cards
   *  show the status-breakdown bar. Off by default — the user opts in via
   *  the "Progress" toggle in the sprint-board toolbar so cards stay
   *  compact when progress isn't the focus. */
  showProgress?: boolean;
  /** When true, the board renders ONLY stories whose history says they
   *  carried over from a prior sprint. Toggle lives in the sprint-board
   *  toolbar (Carried over chip). */
  carriedOverOnly?: boolean;
  onUnscheduleStory?: (storyId: string) => void;
  onRequestUnscheduleStory?: (storyId: string, storyTitle: string) => void;
  onOpenStory: (storyId: string) => void;
  onOpenEpic?: (epicId: string) => void;
  onPatchStory?: (storyId: string, patch: SprintKanbanStoryPatch) => void;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  /** Progress basis driving epic-level health verdict math on epic
   *  cards. Defaults to `days` when omitted — matches the Hero's
   *  default basis. */
  progressBasis?: "days" | "stories" | "epicEst";
  /** When true, each story / epic card renders a sprint-burndown
   *  health chip. Toggled via the "Health" button on the sprint
   *  kanban chip toolbar. Off by default — cards stay compact when
   *  health isn't the focus. */
  showHealthBadges?: boolean;
};

export function SprintKanbanBoard({
  initiatives,
  planYear,
  month,
  yearSprint,
  progressBasis = "days",
  showHealthBadges = false,
  filterEpicTeamIds = null,
  epicAccordionEmphasis = null,
  scheduledStoriesEmphasis = null,
  sprintToolbarEnd = null,
  searchQuery: searchQueryProp = "",
  viewMode = "stories",
  showProgress = false,
  carriedOverOnly = false,
  onUnscheduleStory,
  onRequestUnscheduleStory,
  onOpenStory,
  onOpenEpic,
  onPatchStory,
  workspaceDirectoryUsers = [],
}: SprintKanbanProps) {
  const sprintClosed = sprintEndDate(planYear, yearSprint).getTime() <= clockNowMs();
  // Kanban reads LIVE story state. After the manual move at sprint close,
  // moved cards must be GONE from the closed sprint's kanban (their
  // `story.sprint` is now `N+1`). Charts get retro-fidelity from the snapshot
  // projection in `buildSprintAnalytics`; the board itself shows what's
  // truly there now.
  const allRows = useMemo(() => {
    const rows = collectStoriesForSprintBoard(initiatives, month, yearSprint, filterEpicTeamIds);
    if (!carriedOverOnly) return rows;
    return rows.filter((row) => storyRolledIntoSprint(row.story, yearSprint));
  }, [initiatives, month, yearSprint, filterEpicTeamIds, carriedOverOnly]);

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
  // When the pin is on, the assignee chips stay expanded even after the user
  // moves the cursor off the panel. Clicking the pin toggles it; default off.
  const [assigneeFilterPinned, setAssigneeFilterPinned] = useState(false);
  const showAssigneeChipsExpanded = assigneeFilterPinned || assigneeFilterExpanded;
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
      {/* The closed-sprint snapshot strip + Move/Jump action row used to
       *  live here. Both moved to the breadcrumb header (timeline-grid)
       *  next to the SprintEndCountdown so the kanban surface stays
       *  uncluttered. */}
      {showToolbarRow ? (
        <div className="shrink-0 px-2.5 py-1">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div
              className={cn(
                "flex min-w-0 flex-1 flex-wrap items-center gap-y-1.5 py-0.5",
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
                          "relative inline-flex shrink-0 items-center rounded-full text-left font-semibold tracking-[0.02em] ring-1 transition-[margin,transform,background-color,color,box-shadow,height,width,padding] duration-200",
                          // Both states render as an ellipse with the avatar at
                          // the left edge + a label on the right, so each chip
                          // reads as ONE shape (no "circle around image, second
                          // circle around name"). Collapsed = smaller height +
                          // 2-letter initials; expanded = taller pill + the
                          // longer "First L." label.
                          showAssigneeChipsExpanded
                            ? "h-9 w-auto gap-1.5 pl-0.5 pr-2.5 text-[11px]"
                            : "h-7 w-auto gap-1 pl-0.5 pr-2 text-[10.5px]",
                          on
                            ? "bg-sky-600 text-white ring-sky-700"
                            : "bg-white text-slate-800 ring-slate-200 hover:bg-slate-100",
                        )}
                        title={name}
                        style={{ marginLeft: 4, zIndex: 10 }}
                      >
                        {isUnassigned ? (
                          <Icon className="size-[15px] shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
                        ) : (
                          <UserAvatar
                            name={resolved.name}
                            image={resolved.image}
                            size={showAssigneeChipsExpanded ? 28 : 22}
                            className="ring-0"
                          />
                        )}
                        <span className="max-w-[12rem] truncate">
                          {isUnassigned
                            ? name
                            : showAssigneeChipsExpanded
                              ? formatAssigneeShortLabel(name)
                              : assigneeBadgeLabel(name)}
                        </span>
                      </button>
                    );
                  })}
                  {/* Clear-all selections: visible only when at least one
                   *  assignee is selected (otherwise the action would be a
                   *  no-op). Sits immediately before the pin so the row always
                   *  reads "[chips…] [clear] [pin]". */}
                  {selectedAssignees.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setSelectedAssignees([])}
                      onMouseEnter={(event) => event.stopPropagation()}
                      title="Clear all selected assignees"
                      aria-label="Clear all selected assignees"
                      style={{ marginLeft: 6 }}
                      className="relative z-20 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-600 ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200"
                    >
                      <X className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
                    </button>
                  ) : null}
                  {/* Pin toggle: when pressed, the chips above stay expanded
                   *  even after the cursor leaves the panel. Press again to
                   *  return to hover-only expansion. Sits at the end of the
                   *  row so it can't be hidden when the chips wrap. */}
                  <button
                    type="button"
                    aria-pressed={assigneeFilterPinned}
                    title={assigneeFilterPinned ? "Unpin — collapse now" : "Pin — keep expanded"}
                    aria-label={assigneeFilterPinned ? "Unpin assignee chips" : "Pin assignee chips open"}
                    onClick={() => {
                      setAssigneeFilterPinned((v) => {
                        // When transitioning to unpinned, force the hover-driven
                        // expanded flag off too so the chips collapse instantly
                        // — without this the cursor still sits over the pin
                        // (the panel reads as hovered), and the chips would
                        // stay expanded until the user moved the mouse away.
                        if (v) setAssigneeFilterExpanded(false);
                        return !v;
                      });
                    }}
                    onMouseEnter={(event) => event.stopPropagation()}
                    style={{ marginLeft: 6 }}
                    className={cn(
                      "relative z-20 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ring-1 transition",
                      assigneeFilterPinned
                        ? "bg-amber-500 text-white ring-amber-600"
                        : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100",
                    )}
                  >
                    {assigneeFilterPinned ? (
                      <Pin className="size-4 shrink-0 -rotate-45" strokeWidth={2.25} aria-hidden />
                    ) : (
                      <PinOff className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
                    )}
                  </button>
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
          planYear={planYear}
          progressBasis={progressBasis}
          showHealthBadges={showHealthBadges}
          onOpenEpic={onOpenEpic}
          workspaceDirectoryUsers={workspaceDirectoryUsers}
          showProgress={showProgress}
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
                  planYear={planYear}
                  showHealthBadge={showHealthBadges}
                  boardStoryAssigneeNames={boardStoryAssigneeNames}
                  workspaceDirectoryUsers={workspaceDirectoryUsers}
                  dragDisabled={sprintClosed}
                  viewedYearSprint={yearSprint}
                  onOpenStory={onOpenStory}
                  onUnscheduleStory={onUnscheduleStory}
                  onRequestUnscheduleStory={onRequestUnscheduleStory}
                  onPatchStory={onPatchStory}
                  emphasizeFlash={emphasizeFlash}
                  emphasizeTick={emphasizeTick}
                  showProgress={showProgress}
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
