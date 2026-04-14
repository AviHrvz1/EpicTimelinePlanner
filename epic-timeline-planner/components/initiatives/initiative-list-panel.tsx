"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Briefcase, ChevronRight, FileText, Folder, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DragHandleIcon } from "@/components/ui/drag-handle";
import {
  EPICS_UNPLAN_DROP_ID,
  backlogSlotDropId,
  epicBacklogSlotDropId,
  epicListDraggableId,
  initiativeListDraggableId,
  storyListDraggableId,
} from "@/lib/epic-dnd-ids";
import { MONTHS } from "@/lib/timeline";
import { EpicItem, InitiativeItem } from "@/lib/types";
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

function storyStatusMeta(story: { sprint: number | null; status: string }): {
  sprintLabel: string | null;
  statusLabel: string;
  statusClassName: string;
} {
  if (story.sprint == null) {
    return {
      sprintLabel: null,
      statusLabel: "Unscheduled",
      statusClassName: "bg-slate-100 text-slate-600",
    };
  }
  if (story.status === "inProgress") {
    return {
      sprintLabel: `Sprint ${story.sprint}`,
      statusLabel: "In progress",
      statusClassName: "bg-blue-100 text-blue-700",
    };
  }
  if (story.status === "done") {
    return {
      sprintLabel: `Sprint ${story.sprint}`,
      statusLabel: "Done",
      statusClassName: "bg-emerald-100 text-emerald-700",
    };
  }
  if (story.status === "approved") {
    return {
      sprintLabel: `Sprint ${story.sprint}`,
      statusLabel: "Approved",
      statusClassName: "bg-violet-100 text-violet-700",
    };
  }
  return {
    sprintLabel: `Sprint ${story.sprint}`,
    statusLabel: "To do",
    statusClassName: "bg-amber-100 text-amber-700",
  };
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
        transform: !isDragging && transform
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
        transform: !isDragging && transform
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
                {initiative.status === "scheduled" && initiative.startMonth != null ? (
                  <div className="mt-1 flex items-center gap-1">
                    <span className="rounded bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                      Quarter {quarterFromMonth(initiative.startMonth)}
                    </span>
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                      {initiative.endMonth != null && initiative.endMonth !== initiative.startMonth
                        ? `${MONTHS[initiative.startMonth - 1]}-${MONTHS[initiative.endMonth - 1]}`
                        : MONTHS[initiative.startMonth - 1]}
                    </span>
                  </div>
                ) : null}
                {initiative.description ? (
                  <p className="line-clamp-2 text-[12px] leading-4 text-slate-600">{initiative.description}</p>
                ) : null}
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
            <div className="mt-3 ml-2 space-y-2">
              {epics.length === 0 ? (
                <p className="rounded-lg bg-slate-100/80 px-3 py-2 text-[12px] leading-4 text-slate-600">
                  No epics yet.
                </p>
              ) : (
                epics.map((epic) => {
                  const stories = [...(epic.userStories ?? [])].sort((a, b) => a.title.localeCompare(b.title));
                  const isEpicOpen = openEpicIds[epic.id] ?? false;
                  return (
                    <div key={epic.id} className="rounded-lg bg-slate-50/70 p-2.5 ring-1 ring-slate-200/80">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenEpicIds((prev) => ({
                              ...prev,
                              [epic.id]: !(prev[epic.id] ?? false),
                            }))
                          }
                          className="flex min-w-0 flex-1 items-start gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-slate-100"
                          aria-expanded={isEpicOpen}
                        >
                          <ChevronRight
                            className={cn("mt-0.5 size-4 shrink-0 text-slate-500 transition-transform", isEpicOpen && "rotate-90")}
                          />
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
                      {isEpicOpen ? (
                        <div className="mt-2 space-y-1">
                          {stories.length === 0 ? null : (
                            stories.map((story) => (
                              (() => {
                                const { sprintLabel, statusLabel, statusClassName } = storyStatusMeta(story);
                                return (
                                  <div
                                    key={story.id}
                                    className="flex w-full items-center gap-1 rounded-md border border-transparent bg-white/70 px-1.5 py-1 transition hover:border-slate-200 hover:bg-white"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => onOpenStory(story.id)}
                                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left text-[13px] text-slate-700"
                                    >
                                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-700 ring-1 ring-sky-200/80">
                                        <FileText className="size-3.5" />
                                      </span>
                                      <span className="truncate">{story.title}</span>
                                    </button>
                                    <div className="flex shrink-0 items-center gap-1">
                                      {sprintLabel ? (
                                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                          {sprintLabel}
                                        </span>
                                      ) : null}
                                      <span className={cn("rounded px-2 py-0.5 text-[11px] font-medium", statusClassName)}>
                                        {statusLabel}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })()
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
              <div className="mt-2 flex items-center gap-1 rounded-lg bg-slate-50/70 p-1 ring-1 ring-slate-200/80">
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
  storyDragEnabled,
  onOpenEpic,
  onOpenStory,
  onDeleteEpic,
  onCreateStoryQuick,
  backlogDropSlot,
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
        "bg-white p-2.5",
        isDragging && "opacity-60",
        isBacklogDropOver && "ring-2 ring-slate-300",
      )}
      style={{
        borderLeftColor: initiative.color,
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
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="flex min-w-0 items-center gap-1.5 text-left"
            aria-expanded={isOpen}
          >
            <ChevronRight className={cn("size-4 shrink-0 text-slate-500 transition-transform", isOpen && "rotate-90")} />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-slate-900">{epic.title}</p>
              <p className="truncate text-[11px] text-slate-500">{initiative.title}</p>
            </div>
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
              (() => {
                const { sprintLabel, statusLabel, statusClassName } = storyStatusMeta(story);
                return (
              <div
                key={story.id}
                className="flex w-full items-center gap-1 rounded-md border border-transparent bg-white/70 px-1.5 py-1 transition hover:border-slate-200 hover:bg-white"
              >
                {storyDragEnabled ? <StoryDragHandle storyId={story.id} /> : null}
                <button
                  type="button"
                  onClick={() => onOpenStory(story.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left text-[13px] text-slate-700"
                >
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-700 ring-1 ring-sky-200/80">
                    <FileText className="size-3.5" />
                  </span>
                  <span className="truncate">{story.title}</span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {sprintLabel ? (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {sprintLabel}
                    </span>
                  ) : null}
                  <span className={cn("rounded px-2 py-0.5 text-[11px] font-medium", statusClassName)}>
                    {statusLabel}
                  </span>
                </div>
              </div>
                );
              })()
            ))
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
  const sprintEpics = useMemo(() => {
    if (activeMonth == null || activeSprintLane == null) return [];
    return monthAssignedEpics.filter(({ epic }) => {
      const hasStoryInSprint = (epic.userStories ?? []).some((story) => story.sprint === activeSprintLane);
      const plannedForSprint =
        epicIsOnPlanForMonth(epic, activeMonth) && epic.planSprint != null && epic.planSprint === activeSprintLane;
      return plannedForSprint || hasStoryInSprint;
    });
  }, [monthAssignedEpics, activeMonth, activeSprintLane]);
  const monthPanelEpics = isSprintModeActive ? sprintEpics : monthAssignedEpics;
  const filteredMonthBacklogEpics = useMemo(() => {
    const q = epicSearch.trim().toLowerCase();
    if (!q) return monthPanelEpics;
    return monthPanelEpics.filter(
      ({ epic, initiative }) =>
        epic.title.toLowerCase().includes(q) || initiative.title.toLowerCase().includes(q),
    );
  }, [monthPanelEpics, epicSearch]);

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
    if (!q) return initiativeList;
    return initiativeList.filter((initiative) => initiative.title.toLowerCase().includes(q));
  }, [initiativeList, initiativeSearch]);
  const showInitiativeBacklogDrop = !inMonthView && !isSprintModeActive;

  const showNewButton = inMonthView || !isSprintModeActive;

  return (
    <aside className="h-[72vh] overflow-x-hidden overflow-y-auto rounded-xl bg-slate-50 p-4 shadow-lg ring-1 ring-black/5">
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 pb-3">
        <div>
          <h2 className="inline-flex items-center gap-1.5 text-[16px] leading-6 font-semibold tracking-tight text-slate-950">
            {inMonthView ? (
              <>
                <Target className="size-4 text-slate-600" />
                Epics
              </>
            ) : (
              <>
                <Briefcase className="size-4 text-slate-600" />
                Initiatives
              </>
            )}
          </h2>
          {isSprintModeActive ? null : inMonthView ? (
            null
          ) : null}
        </div>
        {showNewButton ? (
          <Button size="sm" onClick={inMonthView ? onCreateEpic : onCreateInitiative}>
            <Plus />
            New
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
              {monthPanelEpics.map(({ epic }) => (
                <option key={`${epic.id}-${epic.title}`} value={epic.title} />
              ))}
            </datalist>
          </div>
          <h3 className="mt-4 mb-2 text-[14px] font-semibold tracking-[0.01em] text-slate-900">
            {isSprintModeActive && activeSprintLane != null
              ? `Sprint ${activeSprintLane} epics (${filteredMonthBacklogEpics.length})`
              : `Month epics (${filteredMonthBacklogEpics.length})`}
          </h3>
          <div
            ref={setEpicUnplanDropRef}
            className={cn(
              "bg-transparent p-0 transition",
              isEpicUnplanDropOver && "bg-transparent",
            )}
          >
            {activeMonth != null ? <EpicBacklogDropSlot month={activeMonth} index={0} /> : null}
            {filteredMonthBacklogEpics.length === 0 ? (
              <p className="text-[11px] text-slate-700">
                {monthPanelEpics.length === 0
                  ? isSprintModeActive && activeSprintLane != null
                    ? `No epics or stories are assigned to Sprint ${activeSprintLane} for this month yet.`
                    : "No epics are assigned to this month yet."
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
              {initiativeList.map((initiative) => (
                <option key={initiative.id} value={initiative.title} />
              ))}
            </datalist>
          </div>
          <h3 className="mb-2 text-[14px] font-semibold tracking-[0.01em] text-slate-900">
            Initiatives ({filteredInitiatives.length})
          </h3>
          {filteredInitiatives.length === 0 ? (
            <p className="rounded-md bg-muted/40 p-3 text-[12px] leading-4 text-slate-600">
              {initiativeList.length === 0
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
