"use client";

import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { Folder, Info, Users } from "lucide-react";
import { isPostDragClickSuppressed } from "@/components/timeline/drag-context";
import { epicTimelineDraggableId, monthTeamSlotDropId } from "@/lib/epic-dnd-ids";
import { FULL_MONTH_NAMES } from "@/lib/timeline";
import {
  mergeMonthTeamBoardColumns,
  type MergedTeamColumn,
  type MonthTeamBoardPersisted,
} from "@/lib/month-team-board";
import { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { globalSprintFromMonthLane } from "@/lib/year-sprint";
import { DragHandleIcon } from "@/components/ui/drag-handle";

function quarterFromMonth(month: number): string {
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

function epicPlanningLabel(epic: InitiativeItem["epics"][number]): string {
  const start = epic.planStartMonth;
  const isPlanned = epic.planSprint != null && start != null && epic.planEndMonth != null;
  if (!isPlanned) return "Unscheduled";
  return quarterFromMonth(start);
}

function epicExecutionStatusMeta(epic: InitiativeItem["epics"][number]): { label: string; className: string } {
  const stories = epic.userStories ?? [];
  if (stories.length === 0) {
    return { label: "To Do", className: "border-amber-200/90 bg-amber-50 text-amber-800" };
  }
  if (stories.every((s) => s.status === "done")) {
    return { label: "Done", className: "border-emerald-200/90 bg-emerald-50 text-emerald-800" };
  }
  if (stories.every((s) => s.status === "review" || s.status === "done")) {
    return { label: "Review / Testing", className: "border-violet-200/90 bg-violet-50 text-violet-800" };
  }
  const hasProgress = stories.some(
    (s) => s.status === "inProgress" || s.status === "review" || s.status === "done",
  );
  if (hasProgress) {
    return { label: "In Progress", className: "border-blue-200/90 bg-blue-50 text-blue-800" };
  }
  return { label: "To Do", className: "border-amber-200/90 bg-amber-50 text-amber-800" };
}

function TeamQueueDropSlot({
  year,
  month,
  teamId,
  index,
}: {
  year: number;
  month: number;
  teamId: string;
  index: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: monthTeamSlotDropId(year, month, teamId, index),
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "my-0.5 min-h-2.5 w-full shrink-0 rounded-md py-0.5 transition",
        isOver ? "min-h-4 bg-blue-400/45 ring-1 ring-blue-300/50" : "bg-transparent",
      )}
      aria-hidden
    />
  );
}

function TeamEpicCard({
  epicRow,
  priorityLabel,
  priorityBadgeClass,
  onOpenEpic,
}: {
  epicRow: MergedTeamColumn["cards"][number];
  priorityLabel: string;
  priorityBadgeClass: string;
  onOpenEpic: (epicId: string) => void;
}) {
  const { epic, initiative } = epicRow;
  const planLabel = epicPlanningLabel(epic);
  const executionStatus = epicExecutionStatusMeta(epic);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: epicTimelineDraggableId(epic.id),
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm ring-1 ring-black/[0.03] transition",
        isDragging && "opacity-55 shadow-md ring-2 ring-blue-200/60",
      )}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 30 : undefined,
      }}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 shrink-0 cursor-grab rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
          aria-label="Drag to reorder or move team"
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon size="sm" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase",
                priorityBadgeClass,
              )}
            >
              {priorityLabel}
            </span>
            <span className="truncate text-[10px] font-medium tracking-wide text-slate-400 uppercase">
              Epic
            </span>
          </div>
          <button
            type="button"
            onClick={() => onOpenEpic(epic.id)}
            className="w-full rounded-lg px-1 py-0.5 text-left transition hover:bg-slate-50"
          >
            <div className="mb-1 flex flex-wrap items-center gap-1">
              <span className="inline-flex items-center rounded border border-violet-200/90 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                {planLabel}
              </span>
              <span
                className={cn(
                  "inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold",
                  executionStatus.className,
                )}
              >
                {executionStatus.label}
              </span>
            </div>
            <p className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold leading-snug text-slate-900">
              {epic.icon?.trim() && epic.icon !== "📁" ? (
                <span className="shrink-0">{epic.icon}</span>
              ) : (
                <span className="inline-flex size-4 shrink-0 items-center justify-center text-slate-400" aria-hidden>
                  <Folder className="size-3.5" strokeWidth={2} />
                </span>
              )}
              <span className="min-w-0 truncate">{epic.title}</span>
            </p>
            <p className="mt-1 truncate text-[12px] text-slate-500">{initiative.title}</p>
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamColumn({
  year,
  month,
  column,
  onOpenEpic,
  sprint1,
  sprint2,
  onOpenSprintKanban,
}: {
  year: number;
  month: number;
  column: MergedTeamColumn;
  onOpenEpic: (epicId: string) => void;
  sprint1: number;
  sprint2: number;
  onOpenSprintKanban: (yearSprint: number, teamId: string) => void;
}) {
  const { team, cards } = column;
  const n = cards.length;

  return (
    <section
      className={cn(
        "flex h-full min-h-[min(36rem,70dvh)] w-[min(100%,20rem)] shrink-0 flex-col rounded-2xl border p-3 shadow-sm md:min-h-[38rem] md:w-auto md:min-w-0",
        team.tone,
      )}
    >
      <header className="mb-3 shrink-0 border-b border-black/[0.06] pb-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/90 text-slate-600 shadow-sm ring-1 ring-slate-200/80">
            <Users className="size-4" strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h4 className="flex w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
              <span className="shrink-0 text-[12px] font-semibold tracking-tight text-slate-600">Team :</span>
              <span
                className={cn(
                  "min-w-0 max-w-full truncate rounded-md px-2 py-0.5 text-[12px] font-bold tracking-tight",
                  team.priorityBadgeClass,
                )}
              >
                {team.label}
              </span>
            </h4>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{team.subtitle}</p>
            <div className="mt-2 grid grid-cols-2 gap-1">
              <button
                type="button"
                title={`Open sprint ${sprint1} Kanban`}
                onClick={() => {
                  if (isPostDragClickSuppressed()) return;
                  onOpenSprintKanban(sprint1, team.id);
                }}
                className="rounded-md bg-white/90 py-1.5 text-center text-[10px] font-bold tabular-nums text-slate-700 shadow-sm ring-1 ring-slate-200/90 transition hover:bg-white hover:text-slate-900"
              >
                Sprint {sprint1}
              </button>
              <button
                type="button"
                title={`Open sprint ${sprint2} Kanban`}
                onClick={() => {
                  if (isPostDragClickSuppressed()) return;
                  onOpenSprintKanban(sprint2, team.id);
                }}
                className="rounded-md bg-white/90 py-1.5 text-center text-[10px] font-bold tabular-nums text-slate-700 shadow-sm ring-1 ring-slate-200/90 transition hover:bg-white hover:text-slate-900"
              >
                Sprint {sprint2}
              </button>
            </div>
            <p
              className={cn(
                "mt-2 inline-flex w-full items-center justify-center rounded-md px-2 py-1 text-[10px] font-semibold tracking-wide uppercase",
                team.priorityHintClass,
              )}
            >
              Priority · top = next
            </p>
          </div>
        </div>
        <p className="mt-2 text-right text-[11px] font-medium tabular-nums text-slate-500">{n} in queue</p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-0.5">
        <TeamQueueDropSlot year={year} month={month} teamId={team.id} index={0} />
        {cards.map((row, idx) => (
          <div key={row.epic.id}>
            <TeamEpicCard
              epicRow={row}
              priorityLabel={`P${idx + 1}`}
              priorityBadgeClass={team.priorityBadgeClass}
              onOpenEpic={onOpenEpic}
            />
            <TeamQueueDropSlot year={year} month={month} teamId={team.id} index={idx + 1} />
          </div>
        ))}
      </div>
    </section>
  );
}

export type MonthTeamKanbanBoardProps = {
  initiatives: InitiativeItem[];
  month: number;
  year: number;
  board: MonthTeamBoardPersisted | undefined;
  onOpenEpic: (epicId: string) => void;
  /** Opens story Kanban for the global sprint; `teamId` scopes the left epic list when viewing that sprint. */
  onOpenSprintKanban: (yearSprint: number, teamId: string) => void;
  /** When set (e.g. opened from quarter drill), replaces the calendar month in the title (e.g. show `Q1` instead of `January`). */
  teamTriageHeadingPrimaryOverride?: string | null;
};

export function MonthTeamKanbanBoard({
  initiatives,
  month,
  year,
  board,
  onOpenEpic,
  onOpenSprintKanban,
  teamTriageHeadingPrimaryOverride = null,
}: MonthTeamKanbanBoardProps) {
  const columns = mergeMonthTeamBoardColumns(initiatives, month, board);
  const sprint1 = globalSprintFromMonthLane(month, 1);
  const sprint2 = globalSprintFromMonthLane(month, 2);
  const assignmentHelp =
    "Use the left panel to pull epics into a team. Here you only set priority within each team (P1 = next). Each lane includes this month's two sprints — click one to open that sprint's Kanban for team stories.";
  const monthTitle = FULL_MONTH_NAMES[month - 1] ?? `Month ${month}`;
  const headingPrimary = teamTriageHeadingPrimaryOverride?.trim() || monthTitle;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start gap-3 border-b border-slate-200/80 pb-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-100 via-white to-indigo-100 text-sky-800 shadow-sm ring-1 ring-sky-200/70">
          <Users className="size-[18px]" strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              <span className="text-slate-900">{headingPrimary}</span>
              <span className="font-semibold text-slate-500"> - Team assignment</span>
            </h2>
            <button
              type="button"
              title={assignmentHelp}
              aria-label={assignmentHelp}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
            >
              <Info className="size-4" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-3 md:overflow-x-visible">
        {columns.map((col) => (
          <TeamColumn
            key={col.team.id}
            year={year}
            month={month}
            column={col}
            onOpenEpic={onOpenEpic}
            sprint1={sprint1}
            sprint2={sprint2}
            onOpenSprintKanban={onOpenSprintKanban}
          />
        ))}
      </div>
    </div>
  );
}
