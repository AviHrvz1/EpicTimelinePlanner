"use client";

import type { ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { LucideIcon } from "lucide-react";
import { BadgeCheck, CheckCircle2, ListTodo, PlayCircle } from "lucide-react";
import { StoryStatus } from "@/lib/generated/prisma";
import { storyBoardDraggableId, sprintKanbanDropId } from "@/lib/epic-dnd-ids";
import { collectStoriesForSprintBoard, type BoardStoryRow } from "@/lib/sprint-plan";
import { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DragHandleIcon } from "@/components/ui/drag-handle";

const KANBAN_COLUMNS: { status: StoryStatus; label: string; tone: string; Icon: LucideIcon }[] = [
  { status: StoryStatus.todo, label: "To do", tone: "border-slate-200 bg-slate-50/80", Icon: ListTodo },
  { status: StoryStatus.inProgress, label: "In progress", tone: "border-blue-200 bg-blue-50/60", Icon: PlayCircle },
  { status: StoryStatus.done, label: "Done", tone: "border-emerald-200 bg-emerald-50/60", Icon: CheckCircle2 },
  { status: StoryStatus.approved, label: "Approved", tone: "border-violet-200 bg-violet-50/60", Icon: BadgeCheck },
];

function KanbanColumn({
  month,
  sprintLane,
  status,
  label,
  tone,
  Icon,
  children,
}: {
  month: number;
  sprintLane: 1 | 2;
  status: StoryStatus;
  label: string;
  tone: string;
  Icon: LucideIcon;
  children: ReactNode;
}) {
  const dropId = sprintKanbanDropId(month, sprintLane, status);
  const { setNodeRef, isOver } = useDroppable({ id: dropId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full min-h-[36rem] flex-col rounded-xl border p-2 transition",
        tone,
        isOver && "border-primary bg-primary/5 ring-2 ring-primary/20",
      )}
    >
      <div className="mb-2 flex items-center justify-center gap-1.5 border-b border-black/5 pb-2 text-slate-600">
        <Icon className="size-4 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
        <p className="text-center text-[12px] font-bold uppercase tracking-wide">{label}</p>
      </div>
      <div className="flex flex-1 flex-col gap-2">{children}</div>
    </div>
  );
}

function KanbanStoryCard({
  row,
  onOpenStory,
}: {
  row: BoardStoryRow;
  onOpenStory: (storyId: string) => void;
}) {
  const { story, epic } = row;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: storyBoardDraggableId(story.id),
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm",
        isDragging && "opacity-60",
      )}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 20 : undefined,
      }}
    >
      <div className="flex items-start gap-2.5">
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
          className="min-w-0 flex-1 rounded-md px-1.5 py-0.5 text-left transition hover:bg-slate-50"
          aria-label="Open user story details"
        >
          <p className="min-w-0 text-[15px] font-semibold leading-snug text-slate-900">
            {story.icon ? <span className="mr-1.5 inline-block align-middle">{story.icon}</span> : null}
            {story.title}
          </p>
          <p className="mt-1.5 truncate text-[13px] text-slate-500">{epic.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-100 px-2 py-1 text-[12px] font-medium text-slate-700">
              {story.assignee?.trim() || "Unassigned"}
            </span>
            <span className="rounded-md bg-blue-100 px-2 py-1 text-[12px] font-medium text-blue-700">
              Est: {story.estimatedDays ?? 0}d
            </span>
            <span className="rounded-md bg-amber-100 px-2 py-1 text-[12px] font-medium text-amber-700">
              Left: {story.daysLeft ?? 0}d
            </span>
          </div>
        </button>
      </div>
    </div>
  );
}

type SprintKanbanProps = {
  initiatives: InitiativeItem[];
  month: number;
  sprintLane: 1 | 2;
  onOpenStory: (storyId: string) => void;
};

export function SprintKanbanBoard({ initiatives, month, sprintLane, onOpenStory }: SprintKanbanProps) {
  const rows = collectStoriesForSprintBoard(initiatives, sprintLane, month);
  const byStatus = new Map<StoryStatus, BoardStoryRow[]>();
  for (const col of KANBAN_COLUMNS) {
    byStatus.set(col.status, []);
  }
  for (const row of rows) {
    const list = byStatus.get(row.story.status);
    if (list) list.push(row);
  }

  return (
    <div className="flex h-full flex-col space-y-3">
      <div className="grid flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
        {KANBAN_COLUMNS.map(({ status, label, tone, Icon }) => (
          <KanbanColumn
            key={status}
            month={month}
            sprintLane={sprintLane}
            status={status}
            label={label}
            tone={tone}
            Icon={Icon}
          >
            {(byStatus.get(status) ?? []).map((row) => (
              <KanbanStoryCard key={row.story.id} row={row} onOpenStory={onOpenStory} />
            ))}
          </KanbanColumn>
        ))}
      </div>
    </div>
  );
}
