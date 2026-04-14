"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DragHandleIcon } from "@/components/ui/drag-handle";
import { STORIES_UNSCHEDULE_DROP_ID, epicListDraggableId, initiativeListDraggableId } from "@/lib/epic-dnd-ids";
import { collectPlannedEpicsForMonth } from "@/lib/sprint-plan";
import { MONTHS } from "@/lib/timeline";
import { EpicItem, InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  const initIcon = initiative.icon || String.fromCodePoint(0x1f3af);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: initiativeListDraggableId(initiative.id),
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border bg-background p-3 shadow-sm",
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
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          className="mt-[3px] shrink-0 cursor-grab rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
          aria-label="Drag initiative"
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon size="sm" />
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-[14px] leading-5 font-semibold text-slate-900">
              <span className="mr-1">{initIcon}</span>
              {initiative.title}
            </p>
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
}) {
  const initIcon = initiative.icon || String.fromCodePoint(0x1f3af);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: initiativeListDraggableId(initiative.id),
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
      ref={setNodeRef}
      className={cn(
        "rounded-lg border bg-background p-3 shadow-sm",
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
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          className="mt-[3px] shrink-0 cursor-grab rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
          aria-label="Drag initiative"
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon size="sm" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-2 text-left">
              <ChevronDown
                className={cn(
                  "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                  isOpen && "rotate-180",
                )}
              />
              <div className="min-w-0">
                <p className="min-w-0 text-[14px] leading-5 font-semibold text-slate-900">
                  <span className="mr-1">{initIcon}</span>
                  {initiative.title}
                </p>
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
            <div className="mt-2 ml-5 space-y-2 border-l border-slate-200 pl-3">
              {epics.length === 0 ? (
                <p className="rounded-md bg-muted/40 p-2 text-[12px] leading-4 text-slate-600">No epics yet.</p>
              ) : (
                epics.map((epic) => {
                  const stories = [...(epic.userStories ?? [])].sort((a, b) => a.title.localeCompare(b.title));
                  const epicIcon = epic.icon || String.fromCodePoint(0x1f4c1);
                  return (
                    <div key={epic.id} className="rounded-md border border-slate-200/80 bg-slate-50/30 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenEpic(epic, initiative)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="text-[13px] font-semibold text-slate-800">
                            <span className="mr-1">{epicIcon}</span>
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
                            <button
                              key={story.id}
                              type="button"
                              onClick={() => onOpenStory(story.id)}
                              className="block w-full truncate rounded-sm px-1 py-0.5 text-left text-[11px] text-slate-700 hover:bg-slate-100"
                            >
                              {story.title}
                            </button>
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
  onDeleteEpic,
}: {
  epic: EpicItem;
  initiative: InitiativeItem;
  epicPlanDragEnabled: boolean;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onDeleteEpic: (epicId: string) => void;
}) {
  const epicIcon = epic.icon || String.fromCodePoint(0x1f4c1);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: epicListDraggableId(epic.id),
    disabled: !epicPlanDragEnabled,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border border-slate-200 bg-white p-3 shadow-sm",
        isDragging && "opacity-60",
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
            className="mt-0.5 shrink-0 cursor-grab rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag epic"
            {...listeners}
            {...attributes}
          >
            <DragHandleIcon size="sm" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-900">
            <span className="mr-1 text-[11px]">{epicIcon}</span>
            {epic.title}
          </p>
          <p className="text-[11px] text-slate-500">{initiative.title}</p>
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
    </div>
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
}: InitiativeListPanelProps) {
  const { setNodeRef: setBacklogDropRef } = useDroppable({
    id: "initiatives:backlog-drop",
  });
  const { setNodeRef: setStoryUnscheduleDropRef, isOver: isStoryUnscheduleDropOver } = useDroppable({
    id: STORIES_UNSCHEDULE_DROP_ID,
  });

  const inMonthView = activeMonth != null;
  const epicPlanDragEnabled = inMonthView;
  const [openInitiativeIds, setOpenInitiativeIds] = useState<Record<string, boolean>>({});

  const sprintEpics = useMemo(() => {
    if (activeMonth == null) return [];
    const sortRows = (rows: Array<{ epic: EpicItem; initiative: InitiativeItem }>) =>
      [...rows].sort((a, b) => {
        const byInit = a.initiative.title.localeCompare(b.initiative.title);
        if (byInit !== 0) return byInit;
        return a.epic.title.localeCompare(b.epic.title);
      });
    if (activeSprintLane != null) {
      return sortRows(collectPlannedEpicsForMonth(initiatives, activeSprintLane, activeMonth));
    }
    const s1 = collectPlannedEpicsForMonth(initiatives, 1, activeMonth);
    const s2 = collectPlannedEpicsForMonth(initiatives, 2, activeMonth);
    const byId = new Map<string, { epic: EpicItem; initiative: InitiativeItem }>();
    for (const row of [...s1, ...s2]) {
      byId.set(row.epic.id, row);
    }
    return sortRows([...byId.values()]);
  }, [initiatives, activeMonth, activeSprintLane]);

  const backlog = initiatives.filter((i) => i.status === "backlog");
  const allInitiatives = useMemo(
    () => [...initiatives].sort((a, b) => a.title.localeCompare(b.title)),
    [initiatives],
  );
  const showInitiativeBacklogDrop = !inMonthView && !isSprintModeActive;

  const showNewButton = inMonthView || !isSprintModeActive;

  return (
    <aside className="h-[72vh] overflow-y-auto rounded-xl bg-card p-4 shadow-lg ring-1 ring-black/5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[16px] leading-6 font-semibold tracking-tight text-slate-900">
            {inMonthView ? "Epics" : "Initiatives"}
          </h2>
          {isSprintModeActive ? (
            <p className="text-[12px] leading-4 text-slate-600">
              {activeMonth != null && activeSprintLane != null
                ? `Sprint ${activeSprintLane} · ${MONTHS[activeMonth - 1]}: drop a story below to clear its sprint. Epics listed are on this sprint only.`
                : "Sprint mode: use Unscheduled below to clear story sprints."}
            </p>
          ) : inMonthView ? (
            <p className="text-[12px] leading-4 text-slate-600">
              {activeSprintLane != null
                ? `Sprint ${activeSprintLane} · ${MONTHS[activeMonth - 1]} — epics on this sprint only.`
                : `${MONTHS[activeMonth - 1]} — epics on Sprint 1 or Sprint 2 for this month.`}
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
              "min-h-[5.5rem] rounded-lg border-2 border-dashed border-sky-200/90 bg-sky-50/70 p-3 text-sky-900/90 transition",
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
          <h3 className="mb-2 text-[12px] font-semibold tracking-[0.01em] text-slate-700">
            {activeSprintLane != null && activeMonth != null
              ? `Sprint ${activeSprintLane} (${sprintEpics.length})`
              : activeMonth != null
                ? `This month (${sprintEpics.length})`
                : "Epics"}
          </h3>
          {sprintEpics.length === 0 ? (
            <p className="rounded-md bg-muted/40 p-3 text-[12px] leading-4 text-slate-600">
              {activeSprintLane != null
                ? `No epics on Sprint ${activeSprintLane} for ${MONTHS[activeMonth - 1]}. Add one with New or assign epics on the sprint plan.`
                : `No epics on the plan for ${MONTHS[activeMonth - 1]} yet. Add one with New or drag epics onto the sprint plan.`}
            </p>
          ) : (
            sprintEpics.map(({ epic, initiative }) => (
              <SprintEpicCard
                key={epic.id}
                epic={epic}
                initiative={initiative}
                epicPlanDragEnabled={epicPlanDragEnabled}
                onOpenEpic={onOpenEpic}
                onDeleteEpic={onDeleteEpic}
              />
            ))
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <h3 className="mb-2 text-[12px] font-semibold tracking-[0.01em] text-slate-700">
            All initiatives ({allInitiatives.length})
          </h3>
          {allInitiatives.length === 0 ? (
            <p className="rounded-md bg-muted/40 p-3 text-[12px] leading-4 text-slate-600">
              No initiatives yet. Add one to begin planning.
            </p>
          ) : (
            allInitiatives.map((initiative) => (
              <InitiativeTreeCard
                key={initiative.id}
                initiative={initiative}
                isOpen={openInitiativeIds[initiative.id] ?? true}
                onToggle={() =>
                  setOpenInitiativeIds((prev) => ({
                    ...prev,
                    [initiative.id]: !(prev[initiative.id] ?? true),
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
            ))
          )}
        </div>
      )}
    </aside>
  );
}
