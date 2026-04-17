"use client";

import type { ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { LucideIcon } from "lucide-react";
import { BadgeCheck, CheckCircle2, Folder, ListTodo, PlayCircle } from "lucide-react";
import { StoryStatus } from "@/lib/generated/prisma";
import { epicTimelineDraggableId, monthEpicKanbanDropId } from "@/lib/epic-dnd-ids";
import { collectEpicsForMonthStatusBoard, deriveEpicAggregateStatus } from "@/lib/month-epic-kanban";
import { EpicItem, InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DragHandleIcon } from "@/components/ui/drag-handle";

const EPIC_KANBAN_COLUMNS: { status: StoryStatus; label: string; tone: string; Icon: LucideIcon }[] = [
  { status: StoryStatus.todo, label: "To do", tone: "border-slate-200 bg-slate-50/80", Icon: ListTodo },
  { status: StoryStatus.inProgress, label: "In progress", tone: "border-blue-200 bg-blue-50/60", Icon: PlayCircle },
  { status: StoryStatus.done, label: "Done", tone: "border-emerald-200 bg-emerald-50/60", Icon: CheckCircle2 },
  { status: StoryStatus.approved, label: "Approved", tone: "border-violet-200 bg-violet-50/60", Icon: BadgeCheck },
];

function EpicKanbanColumn({
  month,
  status,
  label,
  tone,
  Icon,
  children,
}: {
  month: number;
  status: StoryStatus;
  label: string;
  tone: string;
  Icon: LucideIcon;
  children: ReactNode;
}) {
  const dropId = monthEpicKanbanDropId(month, status);
  const { setNodeRef, isOver } = useDroppable({ id: dropId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full min-h-[36rem] flex-col rounded-xl border p-2 transition",
        tone,
        isOver && status === StoryStatus.todo && "border-primary bg-primary/5 ring-2 ring-primary/20",
        isOver && status !== StoryStatus.todo && "ring-1 ring-slate-300/80",
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

function MonthEpicKanbanCard({
  epic,
  initiativeTitle,
  onOpenEpic,
}: {
  epic: EpicItem;
  initiativeTitle: string;
  onOpenEpic: (epicId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: epicTimelineDraggableId(epic.id),
  });

  const stories = epic.userStories ?? [];
  const n = stories.length;
  const summary =
    n === 0
      ? "No stories"
      : `${n} ${n === 1 ? "story" : "stories"} · ${stories.filter((s) => s.status === StoryStatus.todo).length} to do · ${stories.filter((s) => s.status === StoryStatus.inProgress).length} in progress · ${stories.filter((s) => s.status === StoryStatus.done).length} done · ${stories.filter((s) => s.status === StoryStatus.approved).length} approved`;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border border-slate-200/90 bg-white px-2 py-2 shadow-sm",
        isDragging && "opacity-60",
      )}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 20 : undefined,
      }}
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          className="mt-0.5 shrink-0 cursor-grab rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
          aria-label="Drag epic"
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon size="sm" />
        </button>
        <button
          type="button"
          onClick={() => onOpenEpic(epic.id)}
          className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left transition hover:bg-slate-50"
          aria-label="Open epic details"
        >
          <p className="flex min-w-0 items-center gap-1 text-[14px] font-semibold leading-snug text-slate-900">
            {epic.icon?.trim() && epic.icon !== "📁" ? (
              <span className="shrink-0">{epic.icon}</span>
            ) : (
              <span className="inline-flex size-4 shrink-0 items-center justify-center text-slate-400" aria-hidden>
                <Folder className="size-3.5" strokeWidth={2} />
              </span>
            )}
            <span className="min-w-0">{epic.title}</span>
          </p>
          <p className="mt-1 truncate text-[12px] text-slate-500">{initiativeTitle}</p>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-600">{summary}</p>
        </button>
      </div>
    </div>
  );
}

type MonthEpicKanbanProps = {
  initiatives: InitiativeItem[];
  month: number;
  onOpenEpic: (epicId: string) => void;
};

export function MonthEpicKanbanBoard({ initiatives, month, onOpenEpic }: MonthEpicKanbanProps) {
  const rows = collectEpicsForMonthStatusBoard(initiatives, month);
  const byStatus = new Map<StoryStatus, typeof rows>();
  for (const col of EPIC_KANBAN_COLUMNS) {
    byStatus.set(col.status, []);
  }
  for (const row of rows) {
    const col = deriveEpicAggregateStatus(row.epic);
    const list = byStatus.get(col);
    if (list) list.push(row);
  }

  return (
    <div className="flex h-full flex-col space-y-3">
      <p className="text-[13px] leading-snug text-slate-600">
        Columns reflect story progress. Drag an epic onto <span className="font-semibold text-slate-800">To do</span> to
        reset every story in that epic to to do.
      </p>
      <div className="grid flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
        {EPIC_KANBAN_COLUMNS.map(({ status, label, tone, Icon }) => (
          <EpicKanbanColumn key={status} month={month} status={status} label={label} tone={tone} Icon={Icon}>
            {(byStatus.get(status) ?? []).map(({ epic, initiative }) => (
              <MonthEpicKanbanCard
                key={epic.id}
                epic={epic}
                initiativeTitle={initiative.title}
                onOpenEpic={onOpenEpic}
              />
            ))}
          </EpicKanbanColumn>
        ))}
      </div>
    </div>
  );
}
