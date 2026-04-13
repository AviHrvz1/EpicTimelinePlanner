"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { initiativeListDraggableId } from "@/lib/epic-dnd-ids";
import { MONTHS, QUARTERS } from "@/lib/timeline";
import { EpicItem, InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type InitiativeListPanelProps = {
  initiatives: InitiativeItem[];
  focusedQuarterLabel: string | null;
  activeMonth: number | null;
  storyDragEnabled: boolean;
  isSprintModeActive: boolean;
  onCreateStory: (epicId: string, title: string) => Promise<void>;
  onCreateEpic: (initiativeId: string, title: string) => Promise<void>;
  onOpenStory: (storyId: string) => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onCreate: () => void;
  onEdit: (initiative: InitiativeItem) => void;
  onDelete: (id: string) => void;
  onDeleteEpic: (epicId: string) => void;
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
  const initIcon = initiative.icon || "🎯";
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: initiativeListDraggableId(initiative.id),
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "cursor-grab rounded-lg border bg-background p-3 shadow-sm active:cursor-grabbing",
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14px] leading-5 font-semibold text-slate-900">
            <span className="mr-1 inline-block text-[11px] align-middle">{initIcon}</span>
            {initiative.title}
          </p>
          {initiative.description ? (
            <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-slate-600">{initiative.description}</p>
          ) : null}
          {initiative.epics.length > 0 ? (
            <p className="mt-1 text-[11px] text-slate-500">
              {initiative.epics.length} epic{initiative.epics.length !== 1 ? "s" : ""}
            </p>
          ) : null}
        </div>
        <div className="flex gap-1">
          <Button size="icon-xs" variant="ghost" onClick={() => onEdit(initiative)}>
            <Pencil />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={() => onDelete(initiative.id)}>
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
}

function EpicAccordion({
  epic,
  initiative,
  isOpen,
  storyDragEnabled,
  onToggle,
  onOpenEpic,
  onDeleteEpic,
  onCreateStory,
  onOpenStory,
}: {
  epic: EpicItem;
  initiative: InitiativeItem;
  isOpen: boolean;
  storyDragEnabled: boolean;
  onToggle: () => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onDeleteEpic: (epicId: string) => void;
  onCreateStory: (epicId: string, title: string) => Promise<void>;
  onOpenStory: (storyId: string) => void;
}) {
  const epicIcon = epic.icon || "📁";
  const [storyTitle, setStoryTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const stories = epic.userStories ?? [];
  const storyStatusLabel: Record<string, string> = {
    todo: "To Do",
    inProgress: "In Progress",
    done: "Done",
    approved: "Approved",
  };
  const statusTone: Record<string, string> = {
    todo: "bg-slate-100 text-slate-700",
    inProgress: "bg-blue-100 text-blue-700",
    done: "bg-emerald-100 text-emerald-700",
    approved: "bg-violet-100 text-violet-700",
  };

  async function handleCreateStory() {
    const normalizedTitle = storyTitle.trim();
    if (!normalizedTitle) return;
    setIsSubmitting(true);
    try {
      await onCreateStory(epic.id, normalizedTitle);
      setStoryTitle("");
      if (!isOpen) onToggle();
    } finally {
      setIsSubmitting(false);
    }
  }

  function DraggableUserStoryRow({ story }: { story: EpicItem["userStories"][number] }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: `story:accordion:${story.id}`,
      disabled: !storyDragEnabled,
    });

    return (
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={cn(
          "rounded-lg border bg-card px-2.5 py-2 text-xs shadow-sm",
          storyDragEnabled && "cursor-grab active:cursor-grabbing",
          isDragging && "opacity-60",
        )}
        style={{
          transform: transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
          zIndex: isDragging ? 20 : undefined,
        }}
      >
        <p className="text-[13px] leading-5 font-medium text-slate-900">
          <span className="mr-1">{story.icon === "🧩" ? "📄" : (story.icon || "📄")}</span>
          {story.title}
        </p>
        <div className="mt-1.5 flex items-center justify-between">
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.04em]",
              statusTone[story.status] ?? "bg-muted text-muted-foreground",
            )}
          >
            {storyStatusLabel[story.status] ?? story.status}
          </span>
          {storyDragEnabled ? (
            <span className="text-[11px] text-slate-500">Drag to board</span>
          ) : null}
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenStory(story.id);
            }}
          >
            <Pencil />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-2 px-2.5 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start justify-between gap-2 text-left"
          onClick={onToggle}
        >
          <div className="flex min-w-0 items-start gap-1.5">
            <ChevronDown
              className={cn(
                "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
                isOpen && "rotate-180",
              )}
            />
            <div className="min-w-0">
              <p className="text-[13px] leading-5 font-semibold text-slate-800">
                <span className="mr-1 inline-block text-[10px] align-middle">{epicIcon}</span>
                {epic.title}
              </p>
              <p className="text-[11px] text-slate-500">
                {stories.length} stor{stories.length !== 1 ? "ies" : "y"}
              </p>
            </div>
          </div>
        </button>
        <div className="flex gap-0.5">
          <Button size="icon-xs" variant="ghost" onClick={() => onOpenEpic(epic, initiative)}>
            <Pencil />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={() => onDeleteEpic(epic.id)}>
            <Trash2 />
          </Button>
        </div>
      </div>

      {isOpen ? (
        <div className="px-2.5 pb-2.5">
          <div className="ml-3 space-y-1.5 border-l border-slate-200 pl-2.5">
            {stories.length === 0 ? (
              <p className="rounded-md bg-muted/40 p-2 text-[11px] leading-4 text-slate-500">
                No user stories yet.
              </p>
            ) : (
              stories.map((story) => (
                <DraggableUserStoryRow key={story.id} story={story} />
              ))
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={storyTitle}
              onChange={(event) => setStoryTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCreateStory();
                }
              }}
              placeholder="Add user story"
              className="h-7 w-full rounded-md bg-slate-100 px-2 text-[11px] leading-4 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
            />
            <Button size="sm" variant="outline" disabled={isSubmitting} onClick={handleCreateStory}>
              Add
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ScheduledInitiativeAccordion({
  initiative,
  isOpen,
  storyDragEnabled,
  openEpicIds,
  onToggle,
  onToggleEpic,
  onEdit,
  onDelete,
  onOpenEpic,
  onDeleteEpic,
  onCreateEpic,
  onCreateStory,
  onOpenStory,
}: {
  initiative: InitiativeItem;
  isOpen: boolean;
  storyDragEnabled: boolean;
  openEpicIds: Record<string, boolean>;
  onToggle: () => void;
  onToggleEpic: (epicId: string) => void;
  onEdit: (initiative: InitiativeItem) => void;
  onDelete: (id: string) => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onDeleteEpic: (epicId: string) => void;
  onCreateEpic: (initiativeId: string, title: string) => Promise<void>;
  onCreateStory: (epicId: string, title: string) => Promise<void>;
  onOpenStory: (storyId: string) => void;
}) {
  const initIcon = initiative.icon || "🎯";
  const [epicTitle, setEpicTitle] = useState("");
  const [isSubmittingEpic, setIsSubmittingEpic] = useState(false);

  async function handleCreateEpic() {
    const normalizedTitle = epicTitle.trim();
    if (!normalizedTitle) return;
    setIsSubmittingEpic(true);
    try {
      await onCreateEpic(initiative.id, normalizedTitle);
      setEpicTitle("");
    } finally {
      setIsSubmittingEpic(false);
    }
  }

  return (
    <div
      className="rounded-xl bg-background shadow-md ring-1 ring-black/5"
      style={{ borderLeftColor: initiative.color, borderLeftWidth: 4 }}
    >
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start justify-between gap-2 text-left"
          onClick={onToggle}
        >
          <div className="flex min-w-0 items-start gap-2">
            <ChevronDown
              className={cn(
                "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                isOpen && "rotate-180",
              )}
            />
            <div className="min-w-0">
              <p className="text-[14px] leading-5 font-semibold text-slate-900">
                <span className="mr-1 inline-block text-[11px] align-middle">{initIcon}</span>
                {initiative.title}
              </p>
              {initiative.description ? (
                <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-slate-600">{initiative.description}</p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-slate-500">
                {initiative.epics.length} epic{initiative.epics.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </button>
        <div className="flex gap-1">
          <Button size="icon-xs" variant="ghost" onClick={() => onEdit(initiative)}>
            <Pencil />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={() => onDelete(initiative.id)}>
            <Trash2 />
          </Button>
        </div>
      </div>

      {isOpen ? (
        <div className="px-3 pb-3">
          <div className="ml-4 space-y-2 border-l border-slate-200 pl-3">
            {initiative.epics.length === 0 ? (
              <p className="rounded-md bg-muted/40 p-2 text-[12px] leading-4 text-slate-600">
                No epics yet. Add one below.
              </p>
            ) : (
              initiative.epics.map((epic) => (
                <EpicAccordion
                  key={epic.id}
                  epic={epic}
                  initiative={initiative}
                  isOpen={Boolean(openEpicIds[epic.id])}
                  storyDragEnabled={storyDragEnabled}
                  onToggle={() => onToggleEpic(epic.id)}
                  onOpenEpic={onOpenEpic}
                  onDeleteEpic={onDeleteEpic}
                  onCreateStory={onCreateStory}
                  onOpenStory={onOpenStory}
                />
              ))
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={epicTitle}
              onChange={(event) => setEpicTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCreateEpic();
                }
              }}
              placeholder="Add epic"
              className="h-8 w-full rounded-md bg-slate-100 px-2 text-[12px] leading-4 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
            />
            <Button size="sm" variant="outline" disabled={isSubmittingEpic} onClick={handleCreateEpic}>
              Add
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function InitiativeListPanel({
  initiatives,
  focusedQuarterLabel,
  activeMonth,
  storyDragEnabled,
  isSprintModeActive,
  onCreateStory,
  onCreateEpic,
  onOpenStory,
  onOpenEpic,
  onCreate,
  onEdit,
  onDelete,
  onDeleteEpic,
}: InitiativeListPanelProps) {
  const { setNodeRef: setBacklogDropRef, isOver: isBacklogDropOver } = useDroppable({
    id: "initiatives:backlog-drop",
  });
  const [openInitiativeIds, setOpenInitiativeIds] = useState<Record<string, boolean>>({});
  const [openEpicIds, setOpenEpicIds] = useState<Record<string, boolean>>({});
  const backlog = initiatives.filter((i) => i.status === "backlog");
  const focusedQuarter = QUARTERS.find((quarter) => quarter.label === focusedQuarterLabel);
  const isMonthDrillDown = activeMonth != null;
  const showBacklogChrome = !isSprintModeActive && !isMonthDrillDown;
  const scheduled = initiatives.filter((initiative) => {
    if (initiative.status !== "scheduled") return false;
    if (activeMonth != null) {
      if (!initiative.startMonth || !initiative.endMonth) return false;
      return initiative.startMonth <= activeMonth && initiative.endMonth >= activeMonth;
    }
    if (!focusedQuarter) return true;
    if (!initiative.startMonth || !initiative.endMonth) return false;

    const quarterStart = focusedQuarter.months[0];
    const quarterEnd = focusedQuarter.months[focusedQuarter.months.length - 1];

    return initiative.endMonth >= quarterStart && initiative.startMonth <= quarterEnd;
  });

  return (
    <aside className="h-[72vh] overflow-y-auto rounded-xl bg-card p-4 shadow-lg ring-1 ring-black/5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[16px] leading-6 font-semibold tracking-tight text-slate-900">Initiatives</h2>
          <p className="text-[12px] leading-4 text-slate-600">
            {isSprintModeActive
              ? "Sprint mode: drag stories to Kanban columns"
              : isMonthDrillDown
                ? `Showing initiatives scheduled for ${MONTHS[activeMonth! - 1]}`
                : "Create, edit, and drag to schedule"}
          </p>
        </div>
        {!isSprintModeActive ? (
          <Button size="sm" onClick={onCreate}>
            <Plus />
            New
          </Button>
        ) : null}
      </div>

      {showBacklogChrome ? (
        <div
          ref={setBacklogDropRef}
          className={cn(
            "mb-3 rounded-lg border border-dashed bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-600 transition",
            isBacklogDropOver && "border-blue-400 bg-blue-50 text-blue-700",
          )}
        >
          Drop scheduled initiative here to move it back to backlog
        </div>
      ) : null}

      {showBacklogChrome ? (
        <div className="space-y-2">
          {backlog.length === 0 ? (
            <p className="rounded-md bg-muted/40 p-3 text-[12px] leading-4 text-slate-600">
              No backlog initiatives. Add one to begin planning.
            </p>
          ) : (
            backlog.map((initiative) => (
              <DraggableInitiativeCard key={initiative.id} initiative={initiative} onEdit={onEdit} onDelete={onDelete} />
            ))
          )}
        </div>
      ) : null}

      <div className={cn("pt-4", showBacklogChrome && "mt-4")}>
        <h3 className="mb-2 text-[12px] font-semibold tracking-[0.01em] text-slate-700">
          {isMonthDrillDown
            ? `Scheduled · ${MONTHS[activeMonth! - 1]} (${scheduled.length})`
            : `Scheduled${focusedQuarter ? ` ${focusedQuarter.label}` : ""} (${scheduled.length})`}
        </h3>
        <div className="space-y-2">
          {scheduled.map((initiative) => (
            <ScheduledInitiativeAccordion
              key={initiative.id}
              initiative={initiative}
              isOpen={Boolean(openInitiativeIds[initiative.id])}
              storyDragEnabled={storyDragEnabled}
              openEpicIds={openEpicIds}
              onToggle={() =>
                setOpenInitiativeIds((current) => ({
                  ...current,
                  [initiative.id]: !current[initiative.id],
                }))
              }
              onToggleEpic={(epicId) =>
                setOpenEpicIds((current) => ({
                  ...current,
                  [epicId]: !current[epicId],
                }))
              }
              onEdit={onEdit}
              onDelete={onDelete}
              onOpenEpic={onOpenEpic}
              onDeleteEpic={onDeleteEpic}
              onCreateEpic={onCreateEpic}
              onCreateStory={onCreateStory}
              onOpenStory={onOpenStory}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
