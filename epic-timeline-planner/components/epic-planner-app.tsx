"use client";

import { DragEndEvent } from "@dnd-kit/core";
import { InitiativeStatus, StoryStatus } from "@/lib/generated/prisma";
import { useMemo, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { EpicFormDialog } from "@/components/epics/epic-form-dialog";
import { InitiativeFormDialog } from "@/components/initiatives/initiative-form-dialog";
import { InitiativeListPanel } from "@/components/initiatives/initiative-list-panel";
import { StoryDetailsDialog } from "@/components/stories/story-details-dialog";
import { DragContext } from "@/components/timeline/drag-context";
import { TimelineGrid } from "@/components/timeline/timeline-grid";
import {
  EPICS_UNPLAN_DROP_ID,
  STORIES_UNSCHEDULE_DROP_ID,
  isEpicPlanDraggableId,
  isInitiativeDraggableId,
  parseEpicIdFromPlanDraggable,
  parseInitiativeIdFromDraggable,
  isStoryDraggableId,
  parseStoryIdFromDraggable,
} from "@/lib/epic-dnd-ids";
import { MONTHS } from "@/lib/timeline";
import { EpicItem, InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type PlannerProps = {
  initialInitiatives: InitiativeItem[];
  year: number;
};

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error("Request failed");
  }
  return (await response.json()) as T;
}

export function EpicPlannerApp({ initialInitiatives, year }: PlannerProps) {
  const [initiatives, setInitiatives] = useState(initialInitiatives);
  const [initiativeDialogOpen, setInitiativeDialogOpen] = useState(false);
  const [editingInitiative, setEditingInitiative] = useState<InitiativeItem | undefined>(undefined);
  const [epicDialogOpen, setEpicDialogOpen] = useState(false);
  const [editingEpic, setEditingEpic] = useState<EpicItem | undefined>(undefined);
  const [editingEpicInitiativeId, setEditingEpicInitiativeId] = useState<string | null>(null);
  const [focusedQuarterLabel, setFocusedQuarterLabel] = useState<string | null>(null);
  const [isSprintModeActive, setIsSprintModeActive] = useState(false);
  const [activeTimelineMonth, setActiveTimelineMonth] = useState<number | null>(null);
  const [activeSprintLane, setActiveSprintLane] = useState<1 | 2 | null>(null);
  const [planReveal, setPlanReveal] = useState<{
    nonce: number;
    initiativeId: string;
    epicId: string;
  } | null>(null);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [creatingStoryEpicId, setCreatingStoryEpicId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(420);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);

  const title = useMemo(() => `Roadmap ${year}`, [year]);
  const roadmapSummary = useMemo(() => {
    const scheduled = initiatives.filter((i) => i.status === "scheduled");
    const backlog = initiatives.filter((i) => i.status === "backlog");
    const totalEpics = initiatives.reduce((sum, i) => sum + (i.epics?.length ?? 0), 0);
    const totalStories = initiatives.reduce(
      (sum, i) => sum + (i.epics ?? []).reduce((es, e) => es + (e.userStories?.length ?? 0), 0),
      0,
    );

    return {
      totalInitiatives: initiatives.length,
      scheduledInitiatives: scheduled.length,
      backlogInitiatives: backlog.length,
      totalEpics,
      totalStories,
    };
  }, [initiatives]);

  const selectedStory = (() => {
    if (!selectedStoryId) return null;
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        const story = (epic.userStories ?? []).find((s) => s.id === selectedStoryId);
        if (story) {
          return { ...story, epicTitle: epic.title };
        }
      }
    }
    return null;
  })();

  const currentEditingInitiative = useMemo(() => {
    if (!editingInitiative) return undefined;
    return initiatives.find((i) => i.id === editingInitiative.id) ?? editingInitiative;
  }, [initiatives, editingInitiative]);

  const currentEditingEpic = useMemo(() => {
    if (!editingEpic) return undefined;
    for (const initiative of initiatives) {
      const epic = (initiative.epics ?? []).find((e) => e.id === editingEpic.id);
      if (epic) return epic;
    }
    return editingEpic;
  }, [initiatives, editingEpic]);

  async function refresh() {
    const data = await parseJson<InitiativeItem[]>(
      await fetch(`/api/initiatives?year=${year}`, { cache: "no-store" }),
    );
    setInitiatives(data);
  }

  async function handleDeleteInitiative(id: string) {
    await fetch(`/api/initiatives/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function handleUpsertInitiative(payload: {
    title: string;
    icon: string;
    description: string;
    assignee: string;
    color: string;
    startMonth: number | null;
    endMonth: number | null;
  }) {
    const request = editingInitiative
      ? fetch(`/api/initiatives/${editingInitiative.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : fetch("/api/initiatives", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, year }),
        });

    await request;
    setEditingInitiative(undefined);
    await refresh();
  }

  async function handleUpsertEpic(payload: {
    title: string;
    icon: string;
    description: string;
    assignee: string;
    color: string;
    initiativeId: string;
  }) {
    const request = editingEpic
      ? fetch(`/api/epics/${editingEpic.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : fetch(`/api/initiatives/${payload.initiativeId}/epics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    await request;
    setEditingEpic(undefined);
    setEditingEpicInitiativeId(null);
    await refresh();
  }

  async function handleDeleteEpic(epicId: string) {
    await fetch(`/api/epics/${epicId}`, { method: "DELETE" });
    await refresh();
  }

  async function scheduleInitiative(initiativeId: string, month: number) {
    const response = await fetch(`/api/initiatives/${initiativeId}/schedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, startMonth: month, endMonth: month }),
    });
    if (!response.ok) {
      throw new Error("Failed to schedule initiative");
    }
  }

  async function unscheduleInitiative(initiativeId: string) {
    const response = await fetch(`/api/initiatives/${initiativeId}/schedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, startMonth: null, endMonth: null }),
    });
    if (!response.ok) {
      throw new Error("Failed to unschedule initiative");
    }
  }

  async function patchInitiativeScheduleRange(initiativeId: string, startMonth: number, endMonth: number) {
    const response = await fetch(`/api/initiatives/${initiativeId}/schedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, startMonth, endMonth }),
    });
    if (!response.ok) {
      throw new Error("Failed to resize initiative");
    }
  }

  async function patchEpicClearPlan(epicId: string) {
    const response = await fetch(`/api/epics/${epicId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planSprint: null,
        planStartMonth: null,
        planEndMonth: null,
      }),
    });
    if (!response.ok) {
      let message = `Could not save (${response.status})`;
      try {
        const body = (await response.json()) as { message?: string };
        if (typeof body?.message === "string") message = body.message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
  }

  async function patchEpicQuarterPlan(
    epicId: string,
    payload: { planSprint: 1 | 2; planStartMonth: number; planEndMonth: number },
  ) {
    const response = await fetch(`/api/epics/${epicId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let message = `Could not save (${response.status})`;
      try {
        const body = (await response.json()) as { message?: string };
        if (typeof body?.message === "string") message = body.message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
  }

  async function createEpicQuick(initiativeId: string, title: string) {
    const response = await fetch(`/api/initiatives/${initiativeId}/epics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error("Failed to create epic");
    }
    await refresh();
  }

  async function createStory(epicId: string, title: string) {
    const response = await fetch(`/api/epics/${epicId}/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error("Failed to create user story");
    }
    await refresh();
  }

  async function createStoryWithDetails(payload: {
    title: string;
    icon: string;
    description: string | null;
    assignee: string | null;
    sprint: number | null;
    estimatedDays: number | null;
    daysLeft: number | null;
    epicId: string;
  }) {
    const response = await fetch(`/api/epics/${payload.epicId}/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("Failed to create story");
    }
    await refresh();
  }

  async function addInitiativeComment(initiativeId: string, body: string) {
    const response = await fetch(`/api/initiatives/${initiativeId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, author: "Planner" }),
    });
    if (!response.ok) {
      throw new Error("Failed to add comment");
    }
    await refresh();
  }

  async function addEpicComment(epicId: string, body: string) {
    const response = await fetch(`/api/epics/${epicId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, author: "Planner" }),
    });
    if (!response.ok) {
      throw new Error("Failed to add epic comment");
    }
    await refresh();
  }

  async function updateStoryDetails(
    storyId: string,
    payload: {
      title: string;
      icon: string;
      description: string | null;
      assignee: string | null;
      sprint: number | null;
      estimatedDays: number | null;
      daysLeft: number | null;
      epicId: string;
    },
  ) {
    const response = await fetch(`/api/stories/${storyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("Failed to update story");
    }
    await refresh();
  }

  async function addStoryComment(storyId: string, body: string) {
    const response = await fetch(`/api/stories/${storyId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, author: "Planner" }),
    });
    if (!response.ok) {
      throw new Error("Failed to add comment");
    }
    await refresh();
  }

  async function onDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : "";

    if (isStoryDraggableId(activeId)) {
      const storyId = parseStoryIdFromDraggable(activeId);
      if (!storyId) return;

      if (overId === STORIES_UNSCHEDULE_DROP_ID) {
        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((init) => ({
              ...init,
              epics: (init.epics ?? []).map((epic) => ({
                ...epic,
                userStories: (epic.userStories ?? []).map((s) =>
                  s.id === storyId ? { ...s, sprint: null } : s,
                ),
              })),
            })),
          );
        });
        try {
          const response = await fetch(`/api/stories/${storyId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sprint: null }),
          });
          if (!response.ok) throw new Error("Failed to update story");
          toast.success("Story moved to unscheduled");
        } catch {
          await refresh();
          toast.error("Failed to clear sprint on story");
        }
        return;
      }

      const kanbanMatch = /^kanban:(\d+):([12]):(todo|inProgress|done|approved)$/.exec(overId);
      if (!kanbanMatch) return;
      const sprint = Number(kanbanMatch[2]) as 1 | 2;
      const status = kanbanMatch[3] as StoryStatus;

      flushSync(() => {
        setInitiatives((prev) =>
          prev.map((init) => ({
            ...init,
            epics: (init.epics ?? []).map((epic) => ({
              ...epic,
              userStories: (epic.userStories ?? []).map((s) =>
                s.id === storyId ? { ...s, status, sprint } : s,
              ),
            })),
          })),
        );
      });
      try {
        const response = await fetch(`/api/stories/${storyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, sprint }),
        });
        if (!response.ok) throw new Error("Failed to update story");
        toast.success("Story updated");
      } catch {
        await refresh();
        toast.error("Failed to move story");
      }
      return;
    }

    if (isEpicPlanDraggableId(activeId)) {
      const epicId = parseEpicIdFromPlanDraggable(activeId);
      if (!epicId) return;

      if (overId === EPICS_UNPLAN_DROP_ID) {
        const initiative = initiatives.find((i) => (i.epics ?? []).some((e) => e.id === epicId));
        const epic = initiative?.epics?.find((e) => e.id === epicId);
        if (!initiative || !epic) return;

        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((i) => ({
              ...i,
              epics: (i.epics ?? []).map((e) =>
                e.id === epicId
                  ? { ...e, planSprint: null, planStartMonth: null, planEndMonth: null }
                  : e,
              ),
            })),
          );
        });
        try {
          await patchEpicClearPlan(epicId);
          toast.success("Epic removed from plan");
        } catch (err) {
          await refresh();
          const description = err instanceof Error ? err.message : undefined;
          toast.error("Failed to remove epic from plan", description ? { description } : undefined);
        }
        return;
      }

      let month: number;
      let planSprint: 1 | 2;
      const epicCell = /^epic-plan:(\d+):([12])$/.exec(overId);
      if (epicCell) {
        month = Number(epicCell[1]);
        planSprint = Number(epicCell[2]) as 1 | 2;
      } else if (overId.startsWith("month:")) {
        const monthMatch = overId.match(/month:(\d+)/);
        if (!monthMatch) return;
        month = Number(monthMatch[1]);
        planSprint = 1;
      } else {
        return;
      }
      if (!Number.isFinite(month)) return;

      const initiative = initiatives.find((i) => (i.epics ?? []).some((e) => e.id === epicId));
      const epic = initiative?.epics?.find((e) => e.id === epicId);
      if (!initiative || !epic) return;

      const wasUnscheduled =
        initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null;

      let nextStart: number;
      let nextEnd: number;
      if (wasUnscheduled) {
        nextStart = month;
        nextEnd = month;
      } else {
        const sm = initiative.startMonth!;
        const em = initiative.endMonth!;
        nextStart = Math.min(sm, month);
        nextEnd = Math.max(em, month);
      }

      const rangeChanged =
        wasUnscheduled ||
        nextStart !== initiative.startMonth ||
        nextEnd !== initiative.endMonth;

      const planMonth = month;

      if (rangeChanged && !wasUnscheduled) {
        toast.message("Initiative range extended", {
          description: `Now spans ${MONTHS[nextStart - 1]}–${MONTHS[nextEnd - 1]} so the epic can sit in ${MONTHS[planMonth - 1]}.`,
        });
      }

      flushSync(() => {
        setInitiatives((prev) =>
          prev.map((i) => {
            if (i.id !== initiative.id) return i;
            return {
              ...i,
              status: InitiativeStatus.scheduled,
              startMonth: nextStart,
              endMonth: nextEnd,
              epics: (i.epics ?? []).map((e) =>
                e.id === epicId
                  ? {
                      ...e,
                      planSprint,
                      planStartMonth: planMonth,
                      planEndMonth: planMonth,
                    }
                  : e,
              ),
            };
          }),
        );
      });

      try {
        if (wasUnscheduled) {
          await scheduleInitiative(initiative.id, planMonth);
        } else if (rangeChanged) {
          await patchInitiativeScheduleRange(initiative.id, nextStart, nextEnd);
        }
        await patchEpicQuarterPlan(epicId, {
          planSprint,
          planStartMonth: planMonth,
          planEndMonth: planMonth,
        });
        setPlanReveal((r) => ({
          nonce: (r?.nonce ?? 0) + 1,
          initiativeId: initiative.id,
          epicId,
        }));
        toast.success("Epic placed on the plan");
      } catch (err) {
        await refresh();
        const description = err instanceof Error ? err.message : undefined;
        toast.error("Failed to place epic", description ? { description } : undefined);
      }
      return;
    }

    if (!isInitiativeDraggableId(activeId)) return;

    const initiativeId = parseInitiativeIdFromDraggable(activeId);
    if (!initiativeId) return;

    if (overId === "initiatives:backlog-drop") {
      flushSync(() => {
        setInitiatives((prev) =>
          prev.map((i) =>
            i.id === initiativeId
              ? { ...i, status: InitiativeStatus.backlog, startMonth: null, endMonth: null }
              : i,
          ),
        );
      });
      try {
        await unscheduleInitiative(initiativeId);
        toast.success("Initiative moved back to backlog");
      } catch {
        await refresh();
        toast.error("Failed to move initiative back");
      }
      return;
    }

    if (!overId.startsWith("month:")) return;

    const monthMatch = overId.match(/month:(\d+)/);
    const month = monthMatch ? Number(monthMatch[1]) : Number.NaN;
    if (!Number.isFinite(month)) return;

    flushSync(() => {
      setInitiatives((prev) =>
        prev.map((i) =>
          i.id === initiativeId
            ? { ...i, status: InitiativeStatus.scheduled, startMonth: month, endMonth: month }
            : i,
        ),
      );
    });
    try {
      await scheduleInitiative(initiativeId, month);
      toast.success("Initiative scheduled");
    } catch {
      await refresh();
      toast.error("Failed to schedule initiative");
    }
  }

  useEffect(() => {
    if (!isResizingPanel) return;

    function onMouseMove(event: MouseEvent) {
      if (!layoutRef.current) return;
      const layoutBounds = layoutRef.current.getBoundingClientRect();
      const proposedWidth = event.clientX - layoutBounds.left;
      const minPanelWidth = 260;
      const minTimelineWidth = 520;
      const maxPanelWidth = Math.max(minPanelWidth, layoutBounds.width - minTimelineWidth);
      const clampedWidth = Math.max(minPanelWidth, Math.min(proposedWidth, maxPanelWidth));
      setPanelWidth(Math.round(clampedWidth));
    }

    function onMouseUp() {
      setIsResizingPanel(false);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizingPanel]);

  return (
    <DragContext onDragEnd={onDragEnd}>
      <main className="min-h-screen bg-gradient-to-br from-slate-100 via-zinc-100 to-slate-200 p-6">
        <div className="mx-auto w-full max-w-[2550px] space-y-5">
          <div className="rounded-2xl bg-card p-5 shadow-lg ring-1 ring-black/5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-[22px] leading-7 font-semibold tracking-tight text-slate-900">{title}</h1>
                <p className="text-[14px] leading-5 font-normal text-slate-600">
                  Initiative planning with quarter-based timeline scheduling.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <div className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium tracking-[0.02em] text-slate-700">
                    {roadmapSummary.totalInitiatives} initiatives
                  </div>
                  <div className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium tracking-[0.02em] text-emerald-800">
                    {roadmapSummary.scheduledInitiatives} scheduled
                  </div>
                  <div className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-medium tracking-[0.02em] text-slate-800">
                    {roadmapSummary.backlogInitiatives} backlog
                  </div>
                  <div className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium tracking-[0.02em] text-amber-800">
                    {roadmapSummary.totalEpics} epics
                  </div>
                  <div className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-medium tracking-[0.02em] text-blue-800">
                    {roadmapSummary.totalStories} user stories
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            ref={layoutRef}
            className={cn("grid items-stretch gap-3", isResizingPanel && "select-none")}
            style={{ gridTemplateColumns: `${panelWidth}px 14px minmax(0, 1fr)` }}
          >
                       <InitiativeListPanel
              initiatives={initiatives}
              focusedQuarterLabel={focusedQuarterLabel}
              activeMonth={activeTimelineMonth}
              activeSprintLane={activeSprintLane}
              storyDragEnabled={isSprintModeActive}
              epicPlanDragEnabled={activeTimelineMonth != null}
              isSprintModeActive={isSprintModeActive}
              planReveal={planReveal}
              onOpenStory={setSelectedStoryId}
              onCreateStory={async (epicId, storyTitle) => {
                try {
                  await createStory(epicId, storyTitle);
                  toast.success("User story added");
                } catch {
                  toast.error("Failed to add user story");
                }
              }}
              onCreateEpic={async (initiativeId, epicTitle) => {
                try {
                  await createEpicQuick(initiativeId, epicTitle);
                  toast.success("Epic added");
                } catch {
                  toast.error("Failed to add epic");
                }
              }}
              onOpenEpic={(epic, initiative) => {
                setEditingEpic(epic);
                setEditingEpicInitiativeId(initiative.id);
                setEpicDialogOpen(true);
              }}
              onCreate={() => {
                setEditingInitiative(undefined);
                setInitiativeDialogOpen(true);
              }}
              onEdit={(initiative) => {
                setEditingInitiative(initiative);
                setInitiativeDialogOpen(true);
              }}
              onDelete={handleDeleteInitiative}
              onDeleteEpic={handleDeleteEpic}
            />
            <div
              className="group relative flex cursor-col-resize items-stretch justify-center"
              onMouseDown={(event) => {
                event.preventDefault();
                setIsResizingPanel(true);
              }}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panel"
            >
              <div className="h-full w-px bg-slate-300 transition group-hover:bg-slate-500" />
              <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" />
            </div>
            <TimelineGrid
              initiatives={initiatives}
              zoom={1}
              focusedQuarterLabel={focusedQuarterLabel}
              onFocusedQuarterChange={setFocusedQuarterLabel}
              onOpenEpic={(epicId) => {
                for (const initiative of initiatives) {
                  const epic = (initiative.epics ?? []).find((e) => e.id === epicId);
                  if (epic) {
                    setEditingEpic(epic);
                    setEditingEpicInitiativeId(initiative.id);
                    setEpicDialogOpen(true);
                    return;
                  }
                }
              }}
              onOpenInitiative={(initiativeId) => {
                const initiative = initiatives.find((i) => i.id === initiativeId);
                if (!initiative) return;
                setEditingInitiative(initiative);
                setInitiativeDialogOpen(true);
              }}
              onResizeInitiativeRange={async (initiativeId, nextStart, nextEnd) => {
                setInitiatives((prev) =>
                  prev.map((i) =>
                    i.id === initiativeId
                      ? { ...i, startMonth: nextStart, endMonth: nextEnd }
                      : i,
                  ),
                );
                try {
                  await patchInitiativeScheduleRange(initiativeId, nextStart, nextEnd);
                } catch {
                  await refresh();
                  toast.error("Failed to resize initiative");
                }
              }}
              onOpenStory={(storyId) => {
                setSelectedStoryId(storyId);
              }}
              onSprintModeChange={(active, month, sprintLane) => {
                setIsSprintModeActive(active);
                setActiveTimelineMonth(month);
                setActiveSprintLane(sprintLane ?? null);
              }}
            />
          </div>
        </div>
      </main>
      <InitiativeFormDialog
        key={currentEditingInitiative?.id ?? (initiativeDialogOpen ? "new-init" : "closed-init")}
        open={initiativeDialogOpen}
        initiative={currentEditingInitiative}
        onOpenEpic={(epicId) => {
          for (const initiative of initiatives) {
            const epic = (initiative.epics ?? []).find((e) => e.id === epicId);
            if (epic) {
              setEditingEpic(epic);
              setEditingEpicInitiativeId(initiative.id);
              setEpicDialogOpen(true);
              return;
            }
          }
        }}
        onRequestCreateEpic={(initiativeId) => {
          setEditingEpic(undefined);
          setEditingEpicInitiativeId(initiativeId);
          setEpicDialogOpen(true);
        }}
        onAddComment={async (initiativeId, body) => {
          try {
            await addInitiativeComment(initiativeId, body);
            toast.success("Comment added");
          } catch {
            toast.error("Failed to add comment");
          }
        }}
        onClose={() => {
          setInitiativeDialogOpen(false);
          setEditingInitiative(undefined);
        }}
        onSubmit={handleUpsertInitiative}
      />
      <EpicFormDialog
        key={currentEditingEpic?.id ?? (epicDialogOpen ? "new-epic" : "closed-epic")}
        open={epicDialogOpen}
        epic={currentEditingEpic}
        initiatives={initiatives}
        lockInitiativeId={editingEpicInitiativeId}
        onOpenStory={(storyId) => {
          setCreatingStoryEpicId(null);
          setSelectedStoryId(storyId);
        }}
        onRequestCreateStory={(epicId) => {
          setSelectedStoryId(null);
          setCreatingStoryEpicId(epicId);
        }}
        onAddComment={async (epicId, body) => {
          try {
            await addEpicComment(epicId, body);
            toast.success("Comment added");
          } catch {
            toast.error("Failed to add comment");
          }
        }}
        onClose={() => {
          setEpicDialogOpen(false);
          setEditingEpic(undefined);
          setEditingEpicInitiativeId(null);
        }}
        onSubmit={handleUpsertEpic}
      />
      <StoryDetailsDialog
        open={Boolean(selectedStory) || Boolean(creatingStoryEpicId)}
        story={selectedStory}
        initiatives={initiatives}
        lockParentEpicId={creatingStoryEpicId}
        onClose={() => {
          setSelectedStoryId(null);
          setCreatingStoryEpicId(null);
        }}
        onCreate={async (payload) => {
          try {
            await createStoryWithDetails(payload);
            toast.success("User story created");
          } catch {
            toast.error("Failed to create story");
          }
        }}
        onSave={async (storyId, payload) => {
          try {
            await updateStoryDetails(storyId, payload);
            toast.success("Story details updated");
          } catch {
            toast.error("Failed to update story");
          }
        }}
        onAddComment={async (storyId, body) => {
          try {
            await addStoryComment(storyId, body);
            toast.success("Comment added");
          } catch {
            toast.error("Failed to add comment");
          }
        }}
      />
    </DragContext>
  );
}
