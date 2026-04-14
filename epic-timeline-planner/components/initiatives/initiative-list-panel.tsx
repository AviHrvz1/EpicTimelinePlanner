"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronRight, FileText, Folder, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DragHandleIcon } from "@/components/ui/drag-handle";
import {
  EPICS_UNPLAN_DROP_ID,
  STORIES_UNSCHEDULE_DROP_ID,
  backlogSlotDropId,
  epicBacklogSlotDropId,
  epicListDraggableId,
  initiativeListDraggableId,
} from "@/lib/epic-dnd-ids";
import { MONTHS } from "@/lib/timeline";
import { EpicItem, InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

function epicIsOnPlanForMonth(epic: EpicItem, month: number): boolean {
  if (epic.planSprint == null || epic.planStartMonth == null || epic.planEndMonth == null) return false;
  return epic.planStartMonth <= month && epic.planEndMonth >= month;
}

type InitiativeListPanelProps = {
  initiatives: InitiativeItem[];
  activeMonth: number | null;
  activeSprintLane: 1 | 2 | null;
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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: initiativeListDraggableId(initiative.id),
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-black/5",
        isDragging && "opacity-60",
      )}
      style={{
        borderLeftColor: initiative.color,
        borderLeftWidth: 4,
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        zIndex: isDragging ? 60 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          className="shrink-0 cursor-grab rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
          aria-label="Drag initiative"
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon size="sm" />
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-[15px] leading-5 font-semibold text-slate-900">{initiative.title}</p>
            <div className="flex shrink-0 gap-1">
              <Button size="icon-xs" variant="ghost" onClick={() => onEdit(initiative)}>
                <Pencil />
              </Button>
              <Button size="icon-xs" variant="ghost" onClick={() => onDelete(initiative.id)}>
                <Trash2 />
              </Button>
            </div>
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
  onCreateStoryQuick,
  backlogDropIndex,
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
  onCreateStoryQuick: (epicId: string, title: string) => Promise<void>;
  backlogDropIndex?: number;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: initiativeListDraggableId(initiative.id),
  });
  const { setNodeRef: setDropRef, isOver: isBacklogDropOver } = useDroppable({
    id: backlogDropIndex != null ? backlogSlotDropId(backlogDropIndex) : `initiative-card:${initiative.id}`,
    disabled: backlogDropIndex == null,
  });
  const epics = [...(initiative.epics ?? [])].sort((a, b) => a.title.localeCompare(b.title));
  const [epicTitle, setEpicTitle] = useState("");
  const [isAddingEpic, setIsAddingEpic] = useState(false);
  const [storyDraftByEpic, setStoryDraftByEpic] = useState<Record<string, string>>({});
  const [addingStoryEpicId, setAddingStoryEpicId] = useState<string | null>(null);

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

  async function handleAddStory(epicId: string) {
    const title = (storyDraftByEpic[epicId] ?? "").trim();
    if (!title) return;
    setAddingStoryEpicId(epicId);
    try {
      await onCreateStoryQuick(epicId, title);
      setStoryDraftByEpic((prev) => ({ ...prev, [epicId]: "" }));
    } finally {
      setAddingStoryEpicId(null);
    }
  }

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={cn(
        "rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-black/5",
        isDragging && "opacity-60",
        isBacklogDropOver && "ring-2 ring-slate-300",
      )}
      style={{
        borderLeftColor: initiative.color,
        borderLeftWidth: 4,
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        zIndex: isDragging ? 60 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="mt-0.5 shrink-0 cursor-grab rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
          aria-label="Drag initiative"
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon size="sm" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-2 text-left">
              <ChevronRight
                className={cn(
                  "mt-1 size-4 shrink-0 text-slate-500 transition-transform",
                  isOpen && "rotate-90",
                )}
              />
              <div className="min-w-0">
                <p className="min-w-0 text-[16px] leading-6 font-semibold text-slate-900">{initiative.title}</p>
                {initiative.description ? (
                  <p className="line-clamp-2 text-[12px] leading-4 text-slate-600">{initiative.description}</p>
                ) : null}
                <p className="text-[11px] text-slate-500">
                  {epics.length} epic{epics.length !== 1 ? "s" : ""}
                </p>
              </div>
            </button>
            <div className="flex shrink-0 gap-1">
              <Button size="icon-xs" variant="ghost" onClick={() => onEditInitiative(initiative)}>
                <Pencil />
              </Button>
              <Button size="icon-xs" variant="ghost" onClick={() => onDeleteInitiative(initiative.id)}>
                <Trash2 />
              </Button>
            </div>
          </div>

          {isOpen ? (
            <div className="mt-2 ml-5 space-y-2 border-l border-slate-300 pl-3">
              {epics.length === 0 ? (
                <p className="rounded-md bg-muted/40 p-2 text-[12px] leading-4 text-slate-600">No epics yet.</p>
              ) : (
                epics.map((epic) => {
                  const stories = [...(epic.userStories ?? [])].sort((a, b) => a.title.localeCompare(b.title));
                  return (
                    <div key={epic.id} className="rounded-md border border-slate-200 bg-slate-50/70 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenEpic(epic, initiative)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="text-[13px] font-semibold text-slate-800">
                            <span className="mr-1 inline-flex h-4 w-4 items-center justify-center align-middle text-slate-600">
                              <Folder className="size-3.5" />
                            </span>
                            {epic.title}
                          </p>
                        </button>
                        <div className="flex shrink-0 gap-0.5">
                          <Button size="icon-xs" variant="ghost" onClick={() => onOpenEpic(epic, initiative)}>
                            <Pencil />
                          </Button>
                          <Button size="icon-xs" variant="ghost" onClick={() => onDeleteEpic(epic.id)}>
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-1 space-y-1">
                        {stories.length === 0 ? (
                          <p className="text-[11px] text-slate-500">No user stories.</p>
                        ) : (
                          stories.map((story) => (
                            <div
                              key={story.id}
                              className="flex w-full items-center gap-1 rounded-md border border-transparent bg-white/70 px-1.5 py-1 transition hover:border-slate-200 hover:bg-white"
                            >
                              <button
                                type="button"
                                onClick={() => onOpenStory(story.id)}
                                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left text-[12px] text-slate-700"
                              >
                                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500">
                                  <FileText className="size-3" />
                                </span>
                                <span className="truncate">{story.title}</span>
                              </button>
                            </div>
                          ))
                        )}
                        <div className="mt-1 flex items-center gap-1">
                          <input
                            value={storyDraftByEpic[epic.id] ?? ""}
                            onChange={(event) =>
                              setStoryDraftByEpic((prev) => ({ ...prev, [epic.id]: event.target.value }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handleAddStory(epic.id);
                              }
                            }}
                            placeholder="Add user story"
                            className="h-7 w-full rounded-md bg-white px-2 text-[11px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                          />
                          <Button
                            size="icon-xs"
                            variant="outline"
                            disabled={addingStoryEpicId === epic.id}
                            onClick={() => void handleAddStory(epic.id)}
                          >
                            <Plus />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div className="mt-2 flex items-center gap-1">
                <input
                  value={epicTitle}
                  onChange={(event) => setEpicTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleAddEpic();
                    }
                  }}
                  placeholder="Add epic"
                  className="h-8 w-full rounded-md bg-white px-2 text-[12px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                />
                <Button size="icon-sm" variant="outline" disabled={isAddingEpic} onClick={() => void handleAddEpic()}>
                  <Plus />
                </Button>
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
  onOpenEpic,
  onOpenStory,
  onDeleteEpic,
  onCreateStoryQuick,
  backlogDropSlot,
}: {
  epic: EpicItem;
  initiative: InitiativeItem;
  epicPlanDragEnabled: boolean;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onOpenStory: (storyId: string) => void;
  onDeleteEpic: (epicId: string) => void;
  onCreateStoryQuick: (epicId: string, title: string) => Promise<void>;
  backlogDropSlot?: { month: number; index: number };
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

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={cn(
        "rounded-lg border border-slate-200 bg-white p-3 shadow-sm",
        isDragging && "opacity-60",
        isBacklogDropOver && "ring-2 ring-slate-300",
      )}
      style={{
        borderLeftColor: initiative.color,
        borderLeftWidth: 4,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
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
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="flex min-w-0 items-center gap-1.5 text-left"
            aria-expanded={isOpen}
          >
            <ChevronRight className={cn("size-4 shrink-0 text-slate-500 transition-transform", isOpen && "rotate-90")} />
            <p className="truncate text-[14px] font-semibold text-slate-900">{epic.title}</p>
          </button>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <Button size="icon-xs" variant="ghost" onClick={() => onOpenEpic(epic, initiative)}>
            <Pencil />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={() => onDeleteEpic(epic.id)}>
            <Trash2 />
          </Button>
        </div>
      </div>
      {isOpen ? (
        <div className="mt-2 ml-8 space-y-1">
          {stories.length === 0 ? (
            <p className="text-[11px] text-slate-500">No user stories.</p>
          ) : (
            stories.map((story) => (
              <div
                key={story.id}
                className="flex w-full items-center gap-1 rounded-md border border-transparent bg-white/70 px-1.5 py-1 transition hover:border-slate-200 hover:bg-white"
              >
                <button
                  type="button"
                  onClick={() => onOpenStory(story.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left text-[12px] text-slate-700"
                >
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500">
                    <FileText className="size-3" />
                  </span>
                  <span className="truncate">{story.title}</span>
                </button>
              </div>
            ))
          )}
          <div className="mt-1 flex items-center gap-1">
            <input
              value={storyTitle}
              onChange={(event) => setStoryTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleAddStory();
                }
              }}
              placeholder="Add user story"
              className="h-7 w-full rounded-md bg-white px-2 text-[11px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
            />
            <Button
              size="icon-xs"
              variant="outline"
              disabled={isAddingStory}
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
  activeSprintLane,
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
}: InitiativeListPanelProps) {
  const { setNodeRef: setBacklogDropRef } = useDroppable({
    id: "initiatives:backlog-drop",
  });
  const { setNodeRef: setEpicUnplanDropRef, isOver: isEpicUnplanDropOver } = useDroppable({
    id: EPICS_UNPLAN_DROP_ID,
  });
  const { setNodeRef: setStoryUnscheduleDropRef, isOver: isStoryUnscheduleDropOver } = useDroppable({
    id: STORIES_UNSCHEDULE_DROP_ID,
  });

  const inMonthView = activeMonth != null;
  const epicPlanDragEnabled = inMonthView;
  const [openInitiativeIds, setOpenInitiativeIds] = useState<Record<string, boolean>>({});
  const [initiativeSearch, setInitiativeSearch] = useState("");
  const [epicSearch, setEpicSearch] = useState("");

  const monthAssignedEpics = useMemo(() => {
    if (activeMonth == null) return [];
    const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const initiative of initiatives) {
      if (initiative.status !== "scheduled") continue;
      if (initiative.startMonth == null || initiative.endMonth == null) continue;
      if (initiative.endMonth < activeMonth || initiative.startMonth > activeMonth) continue;
      for (const epic of initiative.epics ?? []) {
        rows.push({ epic, initiative });
      }
    }
    return [...rows].sort((a, b) => {
      const byInit = a.initiative.title.localeCompare(b.initiative.title);
      if (byInit !== 0) return byInit;
      return a.epic.title.localeCompare(b.epic.title);
    });
  }, [initiatives, activeMonth]);
  const monthBacklogEpics = useMemo(() => {
    if (activeMonth == null) return [];
    const base = monthAssignedEpics.filter(({ epic }) => !epicIsOnPlanForMonth(epic, activeMonth));
    const order = epicBacklogOrderByMonth[activeMonth] ?? [];
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
  }, [monthAssignedEpics, activeMonth, epicBacklogOrderByMonth]);
  const filteredMonthBacklogEpics = useMemo(() => {
    const q = epicSearch.trim().toLowerCase();
    if (!q) return monthBacklogEpics;
    return monthBacklogEpics.filter(
      ({ epic, initiative }) =>
        epic.title.toLowerCase().includes(q) || initiative.title.toLowerCase().includes(q),
    );
  }, [monthBacklogEpics, epicSearch]);

  const backlog = useMemo(
    () =>
      initiatives
        .filter((i) => i.status === "backlog")
        .sort((a, b) => a.timelineRow - b.timelineRow || a.title.localeCompare(b.title)),
    [initiatives],
  );
  const filteredInitiatives = useMemo(() => {
    const q = initiativeSearch.trim().toLowerCase();
    if (!q) return backlog;
    return backlog.filter((initiative) => initiative.title.toLowerCase().includes(q));
  }, [backlog, initiativeSearch]);
  const showInitiativeBacklogDrop = !inMonthView && !isSprintModeActive;

  const showNewButton = inMonthView || !isSprintModeActive;

  return (
    <aside className="h-[72vh] overflow-y-auto rounded-xl bg-slate-50 p-4 shadow-lg ring-1 ring-black/5">
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 pb-3">
        <div>
          <h2 className="text-[16px] leading-6 font-semibold tracking-tight text-slate-950">
            {inMonthView ? "Epics" : "Initiatives"}
          </h2>
          {isSprintModeActive ? (
            <p className="text-[12px] leading-4 text-slate-700">
              {activeMonth != null && activeSprintLane != null
                ? `Sprint ${activeSprintLane} · ${MONTHS[activeMonth - 1]}: drop a story below to clear its sprint. List shows all epics assigned to ${MONTHS[activeMonth - 1]}.`
                : "Sprint mode: use Unscheduled below to clear story sprints."}
            </p>
          ) : inMonthView ? (
            <p className="text-[12px] leading-4 text-slate-700">
              {`${MONTHS[activeMonth - 1]} — all epics assigned to this month.`}
            </p>
          ) : null}
        </div>
        {showNewButton ? (
          <Button size="sm" onClick={inMonthView ? onCreateEpic : onCreateInitiative}>
            <Plus />
            New
          </Button>
        ) : null}
      </div>

      {isSprintModeActive && storyDragEnabled ? (
        <div className="mb-4">
          <div
            ref={setStoryUnscheduleDropRef}
            className={cn(
              "min-h-[5.5rem] rounded-lg border-2 border-dashed border-sky-300/90 bg-sky-50 p-3 text-sky-900 transition",
              isStoryUnscheduleDropOver && "border-sky-500 bg-sky-100 ring-2 ring-sky-300/50",
            )}
          >
            <h3 className="mb-2 text-[12px] font-semibold tracking-[0.01em] text-slate-700">Unscheduled</h3>
            <p className="text-[11px] font-medium leading-4">
              Drop a user story here (from the board) to clear its sprint. The story stays on the epic.
            </p>
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

      {inMonthView ? (
        <div className="space-y-2">
          <div className="mb-2">
            <input
              value={epicSearch}
              onChange={(event) => setEpicSearch(event.target.value)}
              list="month-epic-search-suggestions"
              placeholder="Search epic..."
              className="h-8 w-full rounded-md bg-white px-2 text-[12px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              aria-label="Search epics in selected month"
            />
            <datalist id="month-epic-search-suggestions">
              {monthBacklogEpics.map(({ epic }) => (
                <option key={`${epic.id}-${epic.title}`} value={epic.title} />
              ))}
            </datalist>
          </div>
          <h3 className="mt-4 mb-2 text-[12px] font-semibold tracking-[0.01em] text-slate-900">
            Epic backlog ({filteredMonthBacklogEpics.length})
          </h3>
          <div
            ref={setEpicUnplanDropRef}
            className={cn(
              "rounded-md border border-dashed border-slate-300 bg-slate-50 p-2 transition",
              isEpicUnplanDropOver && "border-slate-400 bg-slate-100",
            )}
          >
            {activeMonth != null ? <EpicBacklogDropSlot month={activeMonth} index={0} /> : null}
            {filteredMonthBacklogEpics.length === 0 ? (
              <p className="text-[11px] text-slate-700">
                {monthBacklogEpics.length === 0
                  ? "Drag epics from the month timeline here to move them into epic backlog."
                  : "No epics match your search."}
              </p>
            ) : (
              filteredMonthBacklogEpics.map(({ epic, initiative }, idx) => (
                <div key={`backlog-${epic.id}`}>
                  <SprintEpicCard
                    epic={epic}
                    initiative={initiative}
                    epicPlanDragEnabled={epicPlanDragEnabled}
                    onOpenEpic={onOpenEpic}
                    onOpenStory={onOpenStory}
                    onDeleteEpic={onDeleteEpic}
                    onCreateStoryQuick={onCreateStoryQuick}
                    backlogDropSlot={activeMonth != null ? { month: activeMonth, index: idx } : undefined}
                  />
                  {activeMonth != null ? <EpicBacklogDropSlot month={activeMonth} index={idx + 1} /> : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="mb-2">
            <input
              value={initiativeSearch}
              onChange={(event) => setInitiativeSearch(event.target.value)}
              list="initiative-search-suggestions"
              placeholder="Search initiative..."
              className="h-8 w-full rounded-md bg-white px-2 text-[12px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
              aria-label="Search initiatives"
            />
            <datalist id="initiative-search-suggestions">
              {backlog.map((initiative) => (
                <option key={initiative.id} value={initiative.title} />
              ))}
            </datalist>
          </div>
          <h3 className="mb-2 text-[12px] font-semibold tracking-[0.01em] text-slate-900">
            Backlog ({filteredInitiatives.length})
          </h3>
          {filteredInitiatives.length === 0 ? (
            <p className="rounded-md bg-muted/40 p-3 text-[12px] leading-4 text-slate-600">
              {backlog.length === 0
                ? "No initiatives yet. Add one to begin planning."
                : "No initiatives match your search."}
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
                    onToggle={() =>
                      setOpenInitiativeIds((prev) => ({
                        ...prev,
                        [initiative.id]: !(prev[initiative.id] ?? false),
                      }))
                    }
                    onEditInitiative={onEditInitiative}
                    onDeleteInitiative={onDeleteInitiative}
                    onOpenEpic={onOpenEpic}
                    onOpenStory={onOpenStory}
                    onDeleteEpic={onDeleteEpic}
                    onCreateEpicQuick={onCreateEpicQuick}
                    onCreateStoryQuick={onCreateStoryQuick}
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
