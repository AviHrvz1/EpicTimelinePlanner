"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DragHandleIcon } from "@/components/ui/drag-handle";
import {
  EPICS_UNPLAN_DROP_ID,
  STORIES_UNSCHEDULE_DROP_ID,
  epicListDraggableId,
  initiativeListDraggableId,
  storyListDraggableId,
} from "@/lib/epic-dnd-ids";
import { epicIsPlannedForMonthAndSprint } from "@/lib/sprint-plan";
import { MONTHS, QUARTERS } from "@/lib/timeline";
import { EpicItem, InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

function epicIsOnPlanForMonth(epic: EpicItem, month: number): boolean {
  if (epic.planSprint == null || epic.planStartMonth == null || epic.planEndMonth == null) return false;
  return epic.planStartMonth <= month && epic.planEndMonth >= month;
}

type InitiativeListPanelProps = {
  initiatives: InitiativeItem[];
  focusedQuarterLabel: string | null;
  activeMonth: number | null;
  /** Set when Kanban is open for a sprint lane (month drill). Filters the scheduled list to that sprint’s epics. */
  activeSprintLane: 1 | 2 | null;
  storyDragEnabled: boolean;
  epicPlanDragEnabled: boolean;
  isSprintModeActive: boolean;
  onCreateStory: (epicId: string, title: string) => Promise<void>;
  onCreateEpic: (initiativeId: string, title: string) => Promise<void>;
  onOpenStory: (storyId: string) => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onCreate: () => void;
  onEdit: (initiative: InitiativeItem) => void;
  onDelete: (id: string) => void;
  onDeleteEpic: (epicId: string) => void;
  /** After an epic is placed on the month plan, expand this initiative and epic in the list. */
  planReveal?: { nonce: number; initiativeId: string; epicId: string } | null;
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

function OffPlanEpicRow({
  epic,
  initiative,
  epicPlanDragEnabled,
  onOpenEpic,
  onDeleteEpic,
  hideInitiativeLabel = false,
}: {
  epic: EpicItem;
  initiative: InitiativeItem;
  epicPlanDragEnabled: boolean;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onDeleteEpic: (epicId: string) => void;
  hideInitiativeLabel?: boolean;
}) {
  const epicIcon = epic.icon || "📁";
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: epicListDraggableId(epic.id),
    disabled: !epicPlanDragEnabled,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm",
        isDragging && "opacity-60",
      )}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 20 : undefined,
      }}
    >
      <div className="flex items-start gap-2">
        {epicPlanDragEnabled ? (
          <button
            type="button"
            className="mt-0.5 shrink-0 cursor-grab rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag epic to plan"
            {...listeners}
            {...attributes}
          >
            <DragHandleIcon size="sm" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-5 font-semibold text-slate-800">
            <span className="mr-1 inline-block text-[10px] align-middle">{epicIcon}</span>
            {epic.title}
          </p>
          {hideInitiativeLabel ? null : (
            <p className="text-[11px] text-slate-500">{initiative.title}</p>
          )}
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

function OffPlanInitiativeBox({
  initiative,
  epics,
  epicPlanDragEnabled,
  onEdit,
  onDelete,
  onOpenEpic,
  onDeleteEpic,
}: {
  initiative: InitiativeItem;
  epics: EpicItem[];
  epicPlanDragEnabled: boolean;
  onEdit: (initiative: InitiativeItem) => void;
  onDelete: (id: string) => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onDeleteEpic: (epicId: string) => void;
}) {
  const initIcon = initiative.icon || "🎯";

  return (
    <div
      className="rounded-xl bg-background shadow-md ring-1 ring-black/5"
      style={{ borderLeftColor: initiative.color, borderLeftWidth: 4 }}
    >
      <div className="flex items-start gap-2 p-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] leading-5 font-semibold text-slate-900">
              <span className="mr-1 inline-block text-[11px] align-middle">{initIcon}</span>
              {initiative.title}
            </p>
            {initiative.description ? (
              <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-slate-600">{initiative.description}</p>
            ) : null}
            <p className="mt-0.5 text-[11px] text-slate-500">
              {epics.length} epic{epics.length !== 1 ? "s" : ""} not on this month’s plan
            </p>
          </div>
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
      <div className="space-y-2 px-3 pb-3">
        {epics.map((epic) => (
          <OffPlanEpicRow
            key={epic.id}
            epic={epic}
            initiative={initiative}
            epicPlanDragEnabled={epicPlanDragEnabled}
            hideInitiativeLabel
            onOpenEpic={onOpenEpic}
            onDeleteEpic={onDeleteEpic}
          />
        ))}
      </div>
    </div>
  );
}

function EpicAccordion({
  epic,
  initiative,
  isOpen,
  storyDragEnabled,
  epicPlanDragEnabled,
  onToggle,
  onOpenEpic,
  onDeleteEpic,
  onCreateStory,
  onOpenStory,
  initiativeAccentColor,
}: {
  epic: EpicItem;
  initiative: InitiativeItem;
  isOpen: boolean;
  storyDragEnabled: boolean;
  epicPlanDragEnabled: boolean;
  onToggle: () => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onDeleteEpic: (epicId: string) => void;
  onCreateStory: (epicId: string, title: string) => Promise<void>;
  onOpenStory: (storyId: string) => void;
  /** Sprint Kanban flat list: color bar from parent initiative (no initiative row). */
  initiativeAccentColor?: string;
}) {
  const epicIcon = epic.icon || "📁";
  const {
    attributes: epicDragAttributes,
    listeners: epicDragListeners,
    setNodeRef: setEpicDragRef,
    isDragging: isEpicPlanDragging,
  } = useDraggable({
    id: epicListDraggableId(epic.id),
    disabled: !epicPlanDragEnabled,
  });
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
      id: storyListDraggableId(story.id),
      disabled: !storyDragEnabled,
    });

    return (
      <div
        ref={setNodeRef}
        className={cn(
          "rounded-lg border bg-card px-2.5 py-2 text-xs shadow-sm",
          isDragging && "opacity-60",
        )}
        style={{
          transform: transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
          zIndex: isDragging ? 20 : undefined,
        }}
      >
        <div className="flex items-start gap-2">
          {storyDragEnabled ? (
            <button
              type="button"
              className="mt-0.5 shrink-0 cursor-grab rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
              aria-label="Drag user story"
              {...attributes}
              {...listeners}
            >
              <DragHandleIcon size="sm" />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-5 font-medium text-slate-900">
              <span className="mr-1">{story.icon === "🧩" ? "📄" : (story.icon || "📄")}</span>
              {story.title}
            </p>
            <div className="mt-1.5 flex items-center justify-between gap-2">
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
              ) : epicPlanDragEnabled ? (
                <span className="text-[11px] text-slate-500">Use grip on epic to plan</span>
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
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-white shadow-sm",
        initiativeAccentColor != null && "border-l-[3px]",
        isEpicPlanDragging && "opacity-70 ring-2 ring-primary/25",
      )}
      style={
        initiativeAccentColor != null
          ? { borderLeftColor: initiativeAccentColor }
          : undefined
      }
    >
      <div className="flex items-start gap-2 px-2.5 py-2">
        {epicPlanDragEnabled ? (
          <button
            type="button"
            ref={setEpicDragRef}
            {...epicDragAttributes}
            {...epicDragListeners}
            className="mt-0.5 flex shrink-0 cursor-grab items-center justify-center rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag epic to quarter plan"
            onClick={(e) => e.stopPropagation()}
          >
            <DragHandleIcon size="sm" />
          </button>
        ) : null}
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
  epicPlanDragEnabled,
  planDrillMonth,
  planDrillSprintLane,
}: {
  initiative: InitiativeItem;
  isOpen: boolean;
  storyDragEnabled: boolean;
  epicPlanDragEnabled: boolean;
  /** When set with month plan UI, accordion only lists epics placed on this month (others are under Not on plan). */
  planDrillMonth: number | null;
  /** When Kanban sprint is open, only epics planned for this month + sprint lane appear (all stories under each epic). */
  planDrillSprintLane: 1 | 2 | null;
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

  const epicsShownInAccordion = useMemo(() => {
    const all = initiative.epics ?? [];
    if (planDrillMonth != null && epicPlanDragEnabled) {
      let list = all.filter((e) => epicIsOnPlanForMonth(e, planDrillMonth));
      if (planDrillSprintLane != null) {
        list = list.filter((e) => epicIsPlannedForMonthAndSprint(e, planDrillMonth, planDrillSprintLane));
      }
      return list;
    }
    return all;
  }, [initiative.epics, planDrillMonth, epicPlanDragEnabled, planDrillSprintLane]);

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
                {planDrillMonth != null && epicPlanDragEnabled ? (
                  planDrillSprintLane != null ? (
                    <>
                      {epicsShownInAccordion.length} epic{epicsShownInAccordion.length !== 1 ? "s" : ""} in Sprint{" "}
                      {planDrillSprintLane} ({MONTHS[planDrillMonth - 1]})
                      {initiative.epics.length > epicsShownInAccordion.length
                        ? ` · ${initiative.epics.length - epicsShownInAccordion.length} other epic${
                            initiative.epics.length - epicsShownInAccordion.length !== 1 ? "s" : ""
                          } hidden`
                        : ""}
                    </>
                  ) : (
                    <>
                      {epicsShownInAccordion.length} on {MONTHS[planDrillMonth - 1]} plan
                      {initiative.epics.length > epicsShownInAccordion.length
                        ? ` · ${initiative.epics.length - epicsShownInAccordion.length} in Not on plan`
                        : ""}
                    </>
                  )
                ) : (
                  <>
                    {initiative.epics.length} epic{initiative.epics.length !== 1 ? "s" : ""}
                  </>
                )}
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
            ) : epicsShownInAccordion.length === 0 ? (
              <p className="rounded-md bg-muted/40 p-2 text-[12px] leading-4 text-slate-600">
                {planDrillSprintLane != null && planDrillMonth != null ? (
                  <>
                    No epics on Sprint {planDrillSprintLane} for {MONTHS[planDrillMonth - 1]}. Return to{" "}
                    <span className="font-medium">Sprint plan</span> to assign epics.
                  </>
                ) : (
                  <>
                    No epics on {planDrillMonth != null ? MONTHS[planDrillMonth - 1] : "this month"}’s plan. Off-plan
                    epics are in <span className="font-medium">Not on plan</span> above.
                  </>
                )}
              </p>
            ) : (
              epicsShownInAccordion.map((epic) => (
                <EpicAccordion
                  key={epic.id}
                  epic={epic}
                  initiative={initiative}
                  isOpen={Boolean(openEpicIds[epic.id])}
                  storyDragEnabled={storyDragEnabled}
                  epicPlanDragEnabled={epicPlanDragEnabled}
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
  activeSprintLane,
  storyDragEnabled,
  epicPlanDragEnabled,
  isSprintModeActive,
  onCreateStory,
  onCreateEpic,
  onOpenStory,
  onOpenEpic,
  onCreate,
  onEdit,
  onDelete,
  onDeleteEpic,
  planReveal = null,
}: InitiativeListPanelProps) {
  const { setNodeRef: setBacklogDropRef, isOver: isBacklogDropOver } = useDroppable({
    id: "initiatives:backlog-drop",
  });
  const { setNodeRef: setEpicUnplanDropRef, isOver: isEpicUnplanDropOver } = useDroppable({
    id: EPICS_UNPLAN_DROP_ID,
  });
  const { setNodeRef: setStoryUnscheduleDropRef, isOver: isStoryUnscheduleDropOver } = useDroppable({
    id: STORIES_UNSCHEDULE_DROP_ID,
  });
  const [openInitiativeIds, setOpenInitiativeIds] = useState<Record<string, boolean>>({});
  const [openEpicIds, setOpenEpicIds] = useState<Record<string, boolean>>({});
  const backlog = initiatives.filter((i) => i.status === "backlog");
  const focusedQuarter = QUARTERS.find((quarter) => quarter.label === focusedQuarterLabel);
  const isMonthDrillDown = activeMonth != null;
  const showBacklogChrome = !isSprintModeActive && !isMonthDrillDown;

  /** Quarter that contains the drilled month (uses focused quarter when set, else inferred from month). */
  const quarterForMonthDrill = useMemo(() => {
    if (activeMonth == null) return null;
    if (focusedQuarter) return focusedQuarter;
    return QUARTERS.find((q) => q.months.some((m) => m === activeMonth)) ?? null;
  }, [activeMonth, focusedQuarter]);

  const scheduled = useMemo(() => {
    return initiatives.filter((initiative) => {
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
  }, [initiatives, activeMonth, focusedQuarter]);

  /** Month drill: epics on month plan; sprint Kanban: only initiatives with an epic in that month + sprint lane. */
  const scheduledForPlanSection = useMemo(() => {
    if (activeMonth == null || !epicPlanDragEnabled) return scheduled;
    if (isSprintModeActive && activeSprintLane != null) {
      return scheduled.filter((i) =>
        (i.epics ?? []).some((e) => epicIsPlannedForMonthAndSprint(e, activeMonth, activeSprintLane)),
      );
    }
    return scheduled.filter((i) => (i.epics ?? []).some((e) => epicIsOnPlanForMonth(e, activeMonth)));
  }, [scheduled, activeMonth, epicPlanDragEnabled, isSprintModeActive, activeSprintLane]);

  /** Sprint Kanban: flat epic → stories (no initiative accordion). */
  const sprintEpicFlatList = useMemo(() => {
    if (!isSprintModeActive || activeMonth == null || activeSprintLane == null || !epicPlanDragEnabled) {
      return null;
    }
    const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const initiative of scheduledForPlanSection) {
      for (const epic of initiative.epics ?? []) {
        if (epicIsPlannedForMonthAndSprint(epic, activeMonth, activeSprintLane)) {
          rows.push({ epic, initiative });
        }
      }
    }
    rows.sort((a, b) => {
      const byInit = a.initiative.title.localeCompare(b.initiative.title);
      if (byInit !== 0) return byInit;
      return a.epic.title.localeCompare(b.epic.title);
    });
    return rows;
  }, [
    isSprintModeActive,
    activeMonth,
    activeSprintLane,
    epicPlanDragEnabled,
    scheduledForPlanSection,
  ]);

  const scheduledHeadingCount =
    sprintEpicFlatList != null ? sprintEpicFlatList.length : scheduledForPlanSection.length;

  const monthDrillExpandKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeMonth == null || !quarterForMonthDrill) {
      monthDrillExpandKeyRef.current = null;
      return;
    }
    const key = `${quarterForMonthDrill.label}:${activeMonth}`;
    if (monthDrillExpandKeyRef.current === key) return;
    monthDrillExpandKeyRef.current = key;

    const spanningDrillMonth = initiatives.filter(
      (i) =>
        i.status === "scheduled" &&
        i.startMonth != null &&
        i.endMonth != null &&
        i.startMonth <= activeMonth &&
        i.endMonth >= activeMonth,
    );
    const nextInit: Record<string, boolean> = {};
    for (const i of spanningDrillMonth) {
      nextInit[i.id] = true;
    }
    setOpenInitiativeIds((prev) => ({ ...prev, ...nextInit }));
    setOpenEpicIds({});
  }, [activeMonth, quarterForMonthDrill, initiatives]);

  useEffect(() => {
    if (!planReveal) return;
    setOpenInitiativeIds((prev) => ({ ...prev, [planReveal.initiativeId]: true }));
    setOpenEpicIds((prev) => ({ ...prev, [planReveal.epicId]: true }));
  }, [planReveal]);

  const sprintDrillExpandKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeMonth == null || activeSprintLane == null || !isSprintModeActive) {
      sprintDrillExpandKeyRef.current = null;
      return;
    }
    const key = `${activeMonth}:${activeSprintLane}`;
    if (sprintDrillExpandKeyRef.current === key) return;
    sprintDrillExpandKeyRef.current = key;

    const nextInit: Record<string, boolean> = {};
    const nextEpic: Record<string, boolean> = {};
    for (const initiative of initiatives) {
      if (initiative.status !== "scheduled") continue;
      if (initiative.startMonth == null || initiative.endMonth == null) continue;
      if (initiative.startMonth > activeMonth || initiative.endMonth < activeMonth) continue;
      const matching = (initiative.epics ?? []).filter((e) =>
        epicIsPlannedForMonthAndSprint(e, activeMonth, activeSprintLane),
      );
      if (matching.length > 0) {
        nextInit[initiative.id] = true;
        for (const e of matching) nextEpic[e.id] = true;
      }
    }
    setOpenInitiativeIds((prev) => ({ ...prev, ...nextInit }));
    setOpenEpicIds((prev) => ({ ...prev, ...nextEpic }));
  }, [activeMonth, activeSprintLane, isSprintModeActive, initiatives]);

  const offPlanByInitiative = useMemo(() => {
    if (activeMonth == null || !epicPlanDragEnabled) return [];
    const groups: Array<{ initiative: InitiativeItem; epics: EpicItem[] }> = [];
    for (const initiative of scheduled) {
      const epics = (initiative.epics ?? [])
        .filter((e) => !epicIsOnPlanForMonth(e, activeMonth))
        .sort((a, b) => a.title.localeCompare(b.title));
      if (epics.length > 0) {
        groups.push({ initiative, epics });
      }
    }
    groups.sort((a, b) => a.initiative.title.localeCompare(b.initiative.title));
    return groups;
  }, [scheduled, activeMonth, epicPlanDragEnabled]);

  const offPlanEpicCount = useMemo(
    () => offPlanByInitiative.reduce((n, g) => n + g.epics.length, 0),
    [offPlanByInitiative],
  );

  return (
    <aside className="h-[72vh] overflow-y-auto rounded-xl bg-card p-4 shadow-lg ring-1 ring-black/5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[16px] leading-6 font-semibold tracking-tight text-slate-900">Initiatives</h2>
          <p className="text-[12px] leading-4 text-slate-600">
            {isSprintModeActive && activeMonth != null && activeSprintLane != null
              ? `Sprint ${activeSprintLane} · ${MONTHS[activeMonth - 1]}: each epic expands to its user stories (no initiative level). Drag stories to the board or drop on Unscheduled to clear sprint.`
              : isSprintModeActive
                ? "Sprint mode: drag stories to Kanban columns"
                : isMonthDrillDown && quarterForMonthDrill
                  ? `Scheduled initiatives for ${quarterForMonthDrill.label} (all overlapping ${MONTHS[activeMonth! - 1]}) — drag epics by the grip onto sprint cells`
                  : isMonthDrillDown
                    ? `Showing initiatives for ${MONTHS[activeMonth! - 1]} — drag epics from the grip handle onto the sprint plan`
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

      {isSprintModeActive && storyDragEnabled ? (
        <div className="mb-4">
          <h3 className="mb-2 text-[12px] font-semibold tracking-[0.01em] text-slate-700">Unscheduled</h3>
          <div
            ref={setStoryUnscheduleDropRef}
            className={cn(
              "rounded-lg border border-dashed border-sky-200/90 bg-sky-50/70 p-3 text-sky-900/90 transition",
              isStoryUnscheduleDropOver && "border-sky-400 bg-sky-100",
            )}
          >
            <p className="text-[11px] font-medium leading-4">
              Drop a user story here to clear its sprint (same idea as moving an epic off the plan). The story stays on
              the epic and shows under the epic bar as unscheduled on the sprint plan.
            </p>
          </div>
        </div>
      ) : null}

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

      {isMonthDrillDown && epicPlanDragEnabled && !isSprintModeActive ? (
        <div className="mb-4">
          <h3 className="mb-2 text-[12px] font-semibold tracking-[0.01em] text-slate-700">
            Not on plan · {MONTHS[activeMonth! - 1]} ({offPlanEpicCount})
          </h3>
          <div
            ref={setEpicUnplanDropRef}
            className={cn(
              "rounded-lg border border-dashed border-amber-200/90 bg-amber-50/60 p-3 text-amber-900/90 transition",
              isEpicUnplanDropOver && "border-amber-400 bg-amber-100",
            )}
          >
            <p className="text-[11px] font-medium leading-4">
              Drop an epic on this area to remove it from {MONTHS[activeMonth! - 1]}’s sprint plan. Epics below are not
              assigned to this month; drag them onto the timeline to plan.
            </p>
            {offPlanByInitiative.length === 0 ? (
              <p className="mt-2 text-[11px] leading-4 text-amber-900/70">No epics off plan for this month.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {offPlanByInitiative.map(({ initiative, epics }) => (
                  <OffPlanInitiativeBox
                    key={initiative.id}
                    initiative={initiative}
                    epics={epics}
                    epicPlanDragEnabled={epicPlanDragEnabled}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onOpenEpic={onOpenEpic}
                    onDeleteEpic={onDeleteEpic}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className={cn("pt-4", showBacklogChrome && "mt-4")}>
        <h3 className="mb-2 text-[12px] font-semibold tracking-[0.01em] text-slate-700">
          {isMonthDrillDown && isSprintModeActive && activeSprintLane != null && quarterForMonthDrill
            ? `Epics · ${quarterForMonthDrill.label} · ${MONTHS[activeMonth! - 1]} · Sprint ${activeSprintLane} (${scheduledHeadingCount})`
            : isMonthDrillDown && quarterForMonthDrill
              ? `Scheduled · ${quarterForMonthDrill.label} · ${MONTHS[activeMonth! - 1]} (${scheduledHeadingCount})`
              : isMonthDrillDown
                ? `Scheduled · ${MONTHS[activeMonth! - 1]} (${scheduledHeadingCount})`
                : `Scheduled${focusedQuarter ? ` ${focusedQuarter.label}` : ""} (${scheduledHeadingCount})`}
        </h3>
        <div className="space-y-2">
          {isMonthDrillDown && epicPlanDragEnabled && scheduledHeadingCount === 0 ? (
            <p className="rounded-md bg-muted/40 p-3 text-[12px] leading-4 text-slate-600">
              {isSprintModeActive && activeSprintLane != null ? (
                <>
                  No epics on Sprint {activeSprintLane} for {MONTHS[activeMonth! - 1]}. Use{" "}
                  <span className="font-medium">← Sprint plan</span> on the timeline to assign epics to this sprint.
                </>
              ) : (
                <>
                  No epics on {MONTHS[activeMonth! - 1]}’s plan yet. Drag epics from{" "}
                  <span className="font-medium">Not on plan</span> onto the sprint cells, or add epics under an initiative
                  there.
                </>
              )}
            </p>
          ) : null}
          {sprintEpicFlatList != null
            ? sprintEpicFlatList.map(({ epic, initiative }) => (
                <EpicAccordion
                  key={epic.id}
                  epic={epic}
                  initiative={initiative}
                  isOpen={Boolean(openEpicIds[epic.id])}
                  storyDragEnabled={storyDragEnabled}
                  epicPlanDragEnabled={epicPlanDragEnabled}
                  initiativeAccentColor={initiative.color}
                  onToggle={() =>
                    setOpenEpicIds((current) => ({
                      ...current,
                      [epic.id]: !current[epic.id],
                    }))
                  }
                  onOpenEpic={onOpenEpic}
                  onDeleteEpic={onDeleteEpic}
                  onCreateStory={onCreateStory}
                  onOpenStory={onOpenStory}
                />
              ))
            : scheduledForPlanSection.map((initiative) => (
                <ScheduledInitiativeAccordion
                  key={initiative.id}
                  initiative={initiative}
                  isOpen={Boolean(openInitiativeIds[initiative.id])}
                  storyDragEnabled={storyDragEnabled}
                  epicPlanDragEnabled={epicPlanDragEnabled}
                  planDrillMonth={isMonthDrillDown && epicPlanDragEnabled ? activeMonth : null}
                  planDrillSprintLane={isSprintModeActive ? activeSprintLane : null}
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
