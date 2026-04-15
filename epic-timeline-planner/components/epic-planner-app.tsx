"use client";

import { DragEndEvent } from "@dnd-kit/core";
import { InitiativeStatus, StoryStatus } from "@/lib/generated/prisma";
import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { EpicFormDialog } from "@/components/epics/epic-form-dialog";
import { BacklogPlanningPanel } from "@/components/backlog/backlog-planning-panel";
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
  parseBacklogSlotDropId,
  parseEpicBacklogSlotDropId,
  parseMonthDropTarget,
  parseInitiativeIdFromDraggable,
  isStoryDraggableId,
  parseStoryIdFromDraggable,
  parseMonthEpicKanbanDropId,
} from "@/lib/epic-dnd-ids";
import {
  clientYCenterFromDragEnd,
  inferGanttLaneInsertIndexFromClientY,
} from "@/lib/gantt-lane-from-pointer";
import { MONTHS, QUARTERS } from "@/lib/timeline";
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

/** Insert / move one initiative at a lane index; renumber all scheduled rows0..n-1. */
function computeInitiativeMonthLanePlacement(
  prev: InitiativeItem[],
  initiativeId: string,
  month: number,
  laneIndex: number | undefined,
  isFirstSchedule: boolean,
): { next: InitiativeItem[]; orderedScheduledIds: string[] } {
  const others = prev
    .filter(
      (i) =>
        i.status === InitiativeStatus.scheduled &&
        i.startMonth != null &&
        i.endMonth != null &&
        i.id !== initiativeId,
    )
    .sort((a, b) => a.timelineRow - b.timelineRow || a.title.localeCompare(b.title));

  const current = prev.find((i) => i.id === initiativeId);
  if (!current) return { next: prev, orderedScheduledIds: [] };

  const placedBase: InitiativeItem = {
    ...current,
    status: InitiativeStatus.scheduled,
    startMonth: month,
    endMonth: month,
  };

  let insertAt: number;
  if (laneIndex !== undefined) {
    insertAt = Math.max(0, Math.min(laneIndex, others.length));
  } else if (isFirstSchedule) {
    insertAt = others.length;
  } else {
    const scheduledAll = prev
      .filter(
        (i) =>
          i.status === InitiativeStatus.scheduled &&
          i.startMonth != null &&
          i.endMonth != null,
      )
      .sort((a, b) => a.timelineRow - b.timelineRow || a.title.localeCompare(b.title));
    const prevIdx = scheduledAll.findIndex((i) => i.id === initiativeId);
    insertAt =
      prevIdx >= 0
        ? Math.max(0, Math.min(prevIdx, others.length))
        : Math.max(0, Math.min(current.timelineRow, others.length));
  }

  const newOrder = [...others.slice(0, insertAt), placedBase, ...others.slice(insertAt)];
  const orderedScheduledIds = newOrder.map((i) => i.id);
  const rowById = new Map(newOrder.map((i, idx) => [i.id, idx]));

  const next = prev.map((i) => {
    if (rowById.has(i.id)) {
      const r = rowById.get(i.id)!;
      if (i.id === initiativeId) {
        return { ...i, status: InitiativeStatus.scheduled, startMonth: month, endMonth: month, timelineRow: r };
      }
      return { ...i, timelineRow: r };
    }
    return i;
  });

  return { next, orderedScheduledIds };
}

function epicIsOnPlanForMonth(epic: EpicItem, month: number): boolean {
  if (epic.planSprint == null || epic.planStartMonth == null || epic.planEndMonth == null) return false;
  return epic.planStartMonth <= month && epic.planEndMonth >= month;
}

function monthBacklogEpicIds(
  initiatives: InitiativeItem[],
  month: number,
  epicBacklogOrderByMonth: Record<number, string[]>,
): string[] {
  const base = initiatives
    .filter((initiative) => {
      if (initiative.status !== InitiativeStatus.scheduled) return false;
      if (initiative.startMonth == null || initiative.endMonth == null) return false;
      return !(initiative.endMonth < month || initiative.startMonth > month);
    })
    .flatMap((initiative) => (initiative.epics ?? []).filter((epic) => !epicIsOnPlanForMonth(epic, month)))
    .map((epic) => epic.id);

  const order = epicBacklogOrderByMonth[month] ?? [];
  if (order.length === 0) return base;
  const baseSet = new Set(base);
  const ordered = order.filter((id) => baseSet.has(id));
  const orderedSet = new Set(ordered);
  const rest = base.filter((id) => !orderedSet.has(id));
  return [...ordered, ...rest];
}

function buildStoryRefMaps(initiatives: InitiativeItem[]): {
  byId: Record<string, string>;
  idByRef: Record<string, string>;
} {
  const rows = initiatives
    .flatMap((initiative) =>
      (initiative.epics ?? []).flatMap((epic) =>
        (epic.userStories ?? []).map((story) => ({
          id: story.id,
          createdAt: new Date(story.createdAt).getTime(),
          title: story.title,
        })),
      ),
    )
    .sort((a, b) => a.createdAt - b.createdAt || a.title.localeCompare(b.title));
  const byId: Record<string, string> = {};
  const idByRef: Record<string, string> = {};
  rows.forEach((row, idx) => {
    const ref = String(idx + 1).padStart(2, "0");
    byId[row.id] = ref;
    idByRef[ref] = row.id;
  });
  return { byId, idByRef };
}

export function EpicPlannerApp({ initialInitiatives, year }: PlannerProps) {
  const router = useRouter();
  const pathname = usePathname();
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
  const [activeSprintTab, setActiveSprintTab] = useState<"kanban" | "status">("kanban");
  const [topMode, setTopMode] = useState<"roadmap" | "backlog">("roadmap");
  const [epicBacklogOrderByMonth, setEpicBacklogOrderByMonth] = useState<Record<number, string[]>>({});
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [creatingStoryEpicId, setCreatingStoryEpicId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(520);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [isUrlHydrated, setIsUrlHydrated] = useState(false);
  const hasHydratedFromUrlRef = useRef(false);

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
  const storyRefMaps = useMemo(() => buildStoryRefMaps(initiatives), [initiatives]);

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

  useEffect(() => {
    if (hasHydratedFromUrlRef.current) return;
    hasHydratedFromUrlRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("quarter");
    if (q && QUARTERS.some((item) => item.label === q)) {
      setFocusedQuarterLabel(q);
    }
    const monthRaw = params.get("month");
    if (monthRaw) {
      const month = Number(monthRaw);
      if (Number.isFinite(month) && month >= 1 && month <= 12) {
        setActiveTimelineMonth(month);
      }
    }
    const sprintRaw = params.get("sprint");
    if (sprintRaw === "1" || sprintRaw === "2") {
      setActiveSprintLane(Number(sprintRaw) as 1 | 2);
      setIsSprintModeActive(true);
    }
    const sprintViewRaw = params.get("sprintView");
    if (sprintViewRaw === "kanban" || sprintViewRaw === "status") {
      setActiveSprintTab(sprintViewRaw);
    }
    const epicId = params.get("epic");
    if (epicId) {
      for (const initiative of initialInitiatives) {
        const epic = (initiative.epics ?? []).find((e) => e.id === epicId);
        if (epic) {
          setEditingEpic(epic);
          setEditingEpicInitiativeId(initiative.id);
          setEpicDialogOpen(true);
          break;
        }
      }
    }
    const storyRef = params.get("story");
    if (storyRef) {
      const initialMaps = buildStoryRefMaps(initialInitiatives);
      const resolvedStoryId = initialMaps.idByRef[storyRef] ?? storyRef;
      setSelectedStoryId(resolvedStoryId);
    }
    setIsUrlHydrated(true);
  }, [initialInitiatives]);

  useEffect(() => {
    if (!isUrlHydrated) return;
    const params = new URLSearchParams();
    if (focusedQuarterLabel) params.set("quarter", focusedQuarterLabel);
    if (activeTimelineMonth != null) params.set("month", String(activeTimelineMonth));
    if (activeSprintLane != null) params.set("sprint", String(activeSprintLane));
    if (activeSprintLane != null) params.set("sprintView", activeSprintTab);
    if (epicDialogOpen && editingEpic?.id) params.set("epic", editingEpic.id);
    if (selectedStoryId) params.set("story", storyRefMaps.byId[selectedStoryId] ?? selectedStoryId);
    const next = params.toString();
    const target = next ? `${pathname}?${next}` : pathname;
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== target) {
      router.replace(target, { scroll: false });
    }
  }, [
    isUrlHydrated,
    focusedQuarterLabel,
    activeTimelineMonth,
    activeSprintLane,
    activeSprintTab,
    epicDialogOpen,
    editingEpic?.id,
    selectedStoryId,
    storyRefMaps.byId,
    router,
    pathname,
  ]);

  const handleSprintModeChange = useCallback(
    (active: boolean, month: number | null, sprintLane: 1 | 2 | null) => {
      setIsSprintModeActive(active);
      setActiveTimelineMonth(month);
      setActiveSprintLane(sprintLane ?? null);
      if (sprintLane == null) {
        setActiveSprintTab("kanban");
      }
    },
    [],
  );

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

  async function createStoryQuick(epicId: string, title: string) {
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

  async function scheduleInitiative(initiativeId: string, month: number, timelineRow?: number) {
    const payload: { year: number; startMonth: number; endMonth: number; timelineRow?: number } = {
      year,
      startMonth: month,
      endMonth: month,
    };
    if (timelineRow !== undefined) payload.timelineRow = timelineRow;
    console.log("[gantt-drop] fetch PATCH schedule", { initiativeId, payload });
    const response = await fetch(`/api/initiatives/${initiativeId}/schedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.log("[gantt-drop] schedule PATCH failed", { status: response.status, errText });
      throw new Error("Failed to schedule initiative");
    }
    console.log("[gantt-drop] schedule PATCH ok", { initiativeId });
  }

  async function persistOrderedTimelineRows(orderedIds: string[]) {
    await Promise.all(
      orderedIds.map((id, idx) =>
        fetch(`/api/initiatives/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timelineRow: idx }),
        }).then((res) => {
          if (!res.ok) throw new Error("Failed to save timeline row");
        }),
      ),
    );
  }

  async function persistBacklogOrder(orderedIds: string[]) {
    await Promise.all(
      orderedIds.map((id, idx) =>
        fetch(`/api/initiatives/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timelineRow: idx }),
        }).then((res) => {
          if (!res.ok) throw new Error("Failed to save backlog order");
        }),
      ),
    );
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

  async function deleteStory(storyId: string) {
    const response = await fetch(`/api/stories/${storyId}`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error("Failed to delete story");
    }
    await refresh();
  }

  async function onDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : "";
    console.log("[gantt-drop] app onDragEnd", { activeId, overId });

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
      const nextStatus = status;

      flushSync(() => {
        setInitiatives((prev) =>
          prev.map((init) => ({
            ...init,
            epics: (init.epics ?? []).map((epic) => ({
              ...epic,
              userStories: (epic.userStories ?? []).map((s) =>
                s.id === storyId ? { ...s, status: nextStatus, sprint } : s,
              ),
            })),
          })),
        );
      });
      try {
        const response = await fetch(`/api/stories/${storyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus, sprint }),
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
      if (!epicId) {
        console.log("[gantt-drop] epic branch: no epicId", { activeId });
        return;
      }
      console.log("[gantt-drop] epic branch", { epicId, overId });

      const monthEpicBoard = parseMonthEpicKanbanDropId(overId);
      if (monthEpicBoard && monthEpicBoard.status === "todo") {
        const initiative = initiatives.find((i) => (i.epics ?? []).some((e) => e.id === epicId));
        const epic = initiative?.epics?.find((e) => e.id === epicId);
        if (!initiative || !epic) return;
        const storyIds = (epic.userStories ?? []).map((s) => s.id);
        if (storyIds.length === 0) {
          toast.message("Epic has no stories to reset");
          return;
        }

        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((i) => ({
              ...i,
              epics: (i.epics ?? []).map((e) =>
                e.id === epicId
                  ? {
                      ...e,
                      userStories: (e.userStories ?? []).map((s) => ({
                        ...s,
                        status: StoryStatus.todo,
                      })),
                    }
                  : e,
              ),
            })),
          );
        });

        try {
          await Promise.all(
            storyIds.map(async (storyId) => {
              const response = await fetch(`/api/stories/${storyId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: StoryStatus.todo }),
              });
              if (!response.ok) throw new Error("Failed to update story");
            }),
          );
          toast.success("All epic stories set to To do");
        } catch {
          await refresh();
          toast.error("Failed to reset epic stories");
        }
        return;
      }

      const epicKanbanTodoMatch = /^kanban:(\d+):([12]):todo$/.exec(overId);
      if (epicKanbanTodoMatch) {
        const sprint = Number(epicKanbanTodoMatch[2]) as 1 | 2;
        const initiative = initiatives.find((i) => (i.epics ?? []).some((e) => e.id === epicId));
        const epic = initiative?.epics?.find((e) => e.id === epicId);
        if (!initiative || !epic) return;
        const storyIds = (epic.userStories ?? []).map((s) => s.id);
        if (storyIds.length === 0) {
          toast.message("Epic has no stories to move");
          return;
        }

        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((i) => ({
              ...i,
              epics: (i.epics ?? []).map((e) =>
                e.id === epicId
                  ? {
                      ...e,
                      userStories: (e.userStories ?? []).map((s) => ({
                        ...s,
                        sprint,
                        status: StoryStatus.todo,
                      })),
                    }
                  : e,
              ),
            })),
          );
        });

        try {
          await Promise.all(
            storyIds.map(async (storyId) => {
              const response = await fetch(`/api/stories/${storyId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sprint, status: StoryStatus.todo }),
              });
              if (!response.ok) throw new Error("Failed to update story");
            }),
          );
          toast.success("All epic stories moved to To do");
        } catch {
          await refresh();
          toast.error("Failed to move epic stories");
        }
        return;
      }

      let epicBacklogSlot = parseEpicBacklogSlotDropId(overId);
      if (epicBacklogSlot == null) {
        const overEpicId = parseEpicIdFromPlanDraggable(overId);
        if (overEpicId && activeTimelineMonth != null) {
          const backlogIds = monthBacklogEpicIds(initiatives, activeTimelineMonth, epicBacklogOrderByMonth);
          const overIdx = backlogIds.findIndex((id) => id === overEpicId);
          if (overIdx >= 0) {
            epicBacklogSlot = { month: activeTimelineMonth, index: overIdx };
          }
        }
      }
      if (overId === EPICS_UNPLAN_DROP_ID || epicBacklogSlot != null) {
        const initiative = initiatives.find((i) => (i.epics ?? []).some((e) => e.id === epicId));
        const epic = initiative?.epics?.find((e) => e.id === epicId);
        if (!initiative || !epic) return;
        if (epicBacklogSlot != null) {
          setEpicBacklogOrderByMonth((prev) => {
            const month = epicBacklogSlot.month;
            const current = prev[month] ?? [];
            const without = current.filter((id) => id !== epicId);
            const insertAt = Math.max(0, Math.min(epicBacklogSlot.index, without.length));
            const next = [...without.slice(0, insertAt), epicId, ...without.slice(insertAt)];
            return { ...prev, [month]: next };
          });
        }

        const isAlreadyBacklog =
          epic.planSprint == null && epic.planStartMonth == null && epic.planEndMonth == null;
        if (isAlreadyBacklog) return;

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
          toast.success("Epic moved to backlog");
        } catch (err) {
          await refresh();
          const description = err instanceof Error ? err.message : undefined;
          toast.error("Failed to update epic placement", description ? { description } : undefined);
        }
        return;
      }

      let month: number;
      let planSprint: 1 | 2;
      let dropLaneIndex: number | undefined;
      const epicCell = /^epic-plan:(\d+):([12])$/.exec(overId);
      if (epicCell) {
        month = Number(epicCell[1]);
        planSprint = Number(epicCell[2]) as 1 | 2;
        dropLaneIndex = undefined;
      } else if (overId.startsWith("month:")) {
        const parsed = parseMonthDropTarget(overId);
        if (!parsed) {
          console.log("[gantt-drop] epic month drop: parse failed", { overId });
          return;
        }
        month = parsed.month;
        planSprint = 1;
        dropLaneIndex = parsed.laneIndex;
        console.log("[gantt-drop] epic month drop parsed", { month, dropLaneIndex });
      } else {
        console.log("[gantt-drop] epic branch: overId not epic-plan or month", { overId });
        return;
      }
      if (!Number.isFinite(month)) {
        console.log("[gantt-drop] epic branch: invalid month", { month });
        return;
      }

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
        setInitiatives((prev) => {
          if (wasUnscheduled && dropLaneIndex !== undefined) {
            const L = dropLaneIndex;
            const bumped = prev.map((i) => {
              if (i.status !== InitiativeStatus.scheduled || i.id === initiative.id) return i;
              if (i.timelineRow >= L) return { ...i, timelineRow: i.timelineRow + 1 };
              return i;
            });
            return bumped.map((i) => {
              if (i.id !== initiative.id) return i;
              return {
                ...i,
                status: InitiativeStatus.scheduled,
                startMonth: nextStart,
                endMonth: nextEnd,
                timelineRow: L,
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
            });
          }
          let nextRow: number | undefined;
          if (wasUnscheduled) {
            const maxR = Math.max(
              -1,
              ...prev
                .filter((x) => x.status === InitiativeStatus.scheduled && x.id !== initiative.id)
                .map((x) => x.timelineRow),
            );
            nextRow = maxR + 1;
          }
          return prev.map((i) => {
            if (i.id !== initiative.id) return i;
            return {
              ...i,
              status: InitiativeStatus.scheduled,
              startMonth: nextStart,
              endMonth: nextEnd,
              ...(wasUnscheduled && nextRow !== undefined ? { timelineRow: nextRow } : {}),
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
          });
        });
      });

      try {
        if (wasUnscheduled) {
          console.log("[gantt-drop] epic → scheduleInitiative", {
            initiativeId: initiative.id,
            planMonth,
            dropLaneIndex,
            wasUnscheduled,
          });
          await scheduleInitiative(initiative.id, planMonth, dropLaneIndex);
        } else if (rangeChanged) {
          console.log("[gantt-drop] epic → patchInitiativeScheduleRange", { nextStart, nextEnd });
          await patchInitiativeScheduleRange(initiative.id, nextStart, nextEnd);
        }
        await patchEpicQuarterPlan(epicId, {
          planSprint,
          planStartMonth: planMonth,
          planEndMonth: planMonth,
        });
        toast.success("Epic placed on the plan");
      } catch (err) {
        await refresh();
        const description = err instanceof Error ? err.message : undefined;
        toast.error("Failed to place epic", description ? { description } : undefined);
      }
      return;
    }

    if (!isInitiativeDraggableId(activeId)) {
      console.log("[gantt-drop] no handler for activeId (not initiative)", { activeId, overId });
      return;
    }

    const initiativeId = parseInitiativeIdFromDraggable(activeId);
    if (!initiativeId) return;

    const backlogSlot = parseBacklogSlotDropId(overId);
    if (overId === "initiatives:backlog-drop" || backlogSlot != null) {
      const wasScheduled = initiatives.some(
        (i) => i.id === initiativeId && i.status === InitiativeStatus.scheduled,
      );
      const backlogOrdered = initiatives
        .filter((i) => i.status === InitiativeStatus.backlog && i.id !== initiativeId)
        .sort((a, b) => a.timelineRow - b.timelineRow || a.title.localeCompare(b.title));
      const insertAt = Math.max(
        0,
        Math.min(backlogSlot ?? backlogOrdered.length, backlogOrdered.length),
      );
      const orderedIds = [
        ...backlogOrdered.slice(0, insertAt).map((i) => i.id),
        initiativeId,
        ...backlogOrdered.slice(insertAt).map((i) => i.id),
      ];
      const rowById = new Map(orderedIds.map((id, idx) => [id, idx]));
      flushSync(() => {
        setInitiatives((prev) =>
          prev.map((i) =>
            rowById.has(i.id)
              ? {
                  ...i,
                  status: InitiativeStatus.backlog,
                  startMonth: null,
                  endMonth: null,
                  timelineRow: rowById.get(i.id)!,
                }
              : i,
          ),
        );
      });
      try {
        if (wasScheduled) {
          await unscheduleInitiative(initiativeId);
        }
        await persistBacklogOrder(orderedIds);
        toast.success("Initiative placed in backlog");
      } catch {
        await refresh();
        toast.error("Failed to update backlog placement");
      }
      return;
    }

    if (!overId.startsWith("month:")) {
      console.log("[gantt-drop] initiative: overId not month:*", { overId });
      return;
    }

    const parsedDrop = parseMonthDropTarget(overId);
    if (!parsedDrop) {
      console.log("[gantt-drop] initiative: parseMonthDropTarget null", { overId });
      return;
    }
    const { month, laneIndex: laneFromTarget } = parsedDrop;
    if (!Number.isFinite(month)) {
      console.log("[gantt-drop] initiative: bad month", { month });
      return;
    }

    let laneIndex = laneFromTarget;
    if (laneIndex === undefined) {
      const cy = clientYCenterFromDragEnd(event);
      if (cy !== undefined) {
        const inferred = inferGanttLaneInsertIndexFromClientY(cy);
        if (inferred !== undefined) laneIndex = inferred;
      }
    }

    const initiativeBefore = initiatives.find((i) => i.id === initiativeId);
    if (!initiativeBefore) {
      console.log("[gantt-drop] initiative: not found", { initiativeId });
      return;
    }
    const isFirstSchedule = initiativeBefore.status === InitiativeStatus.backlog;
    console.log("[gantt-drop] initiative month drop", {
      initiativeId,
      month,
      laneIndex,
      laneFromTarget,
      isFirstSchedule,
    });

    const { next: placementNext, orderedScheduledIds } = computeInitiativeMonthLanePlacement(
      initiatives,
      initiativeId,
      month,
      laneIndex,
      isFirstSchedule,
    );
    console.log("[gantt-drop] placement", {
      orderedScheduledIds,
      rowForMoved: orderedScheduledIds.indexOf(initiativeId),
    });

    flushSync(() => setInitiatives(placementNext));
    try {
      if (isFirstSchedule) {
        console.log("[gantt-drop] initiative → scheduleInitiative + persist rows", {
          initiativeId,
          month,
        });
        await scheduleInitiative(initiativeId, month);
        await persistOrderedTimelineRows(orderedScheduledIds);
        toast.success("Initiative scheduled");
        if (focusedQuarterLabel != null) {
          setFocusedQuarterLabel((prev) => {
            if (prev == null) return null;
            const q = QUARTERS.find((quarter) => quarter.label === prev);
            if (q?.months.some((m) => m === month)) return prev;
            const targetQ = QUARTERS.find((quarter) => quarter.months.some((m) => m === month));
            return targetQ?.label ?? prev;
          });
        }
      } else {
        console.log("[gantt-drop] initiative reschedule → patch range + persist rows", {
          initiativeId,
          month,
        });
        await patchInitiativeScheduleRange(initiativeId, month, month);
        await persistOrderedTimelineRows(orderedScheduledIds);
        toast.success("Initiative moved");
        if (focusedQuarterLabel != null) {
          setFocusedQuarterLabel((prev) => {
            if (prev == null) return null;
            const q = QUARTERS.find((quarter) => quarter.label === prev);
            if (q?.months.some((m) => m === month)) return prev;
            const targetQ = QUARTERS.find((quarter) => quarter.months.some((m) => m === month));
            return targetQ?.label ?? prev;
          });
        }
      }
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
      <main className="h-screen overflow-hidden bg-gradient-to-br from-slate-100 via-zinc-100 to-slate-200 p-8">
        <div className="mx-auto flex h-full w-full max-w-[2550px] flex-col gap-5 overflow-hidden">
          <div className="rounded-2xl bg-card p-6 shadow-lg ring-1 ring-black/5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-[26px] leading-8 font-semibold tracking-tight text-slate-900">{title}</h1>
                <p className="text-[15px] leading-6 font-normal text-slate-600">
                  Initiative planning with quarter-based timeline scheduling.
                </p>
                <div className="mt-4 inline-flex rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">
                  <button
                    type="button"
                    onClick={() => setTopMode("roadmap")}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-[13px] font-semibold transition",
                      topMode === "roadmap"
                        ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-300"
                        : "text-slate-600 hover:text-slate-800",
                    )}
                  >
                    Roadmap planning
                  </button>
                  <button
                    type="button"
                    onClick={() => setTopMode("backlog")}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-[13px] font-semibold transition",
                      topMode === "backlog"
                        ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-300"
                        : "text-slate-600 hover:text-slate-800",
                    )}
                  >
                    Backlog
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  <div className="rounded-full bg-slate-100 px-3 py-1.5 text-[14px] font-semibold tracking-[0.02em] text-slate-700">
                    {roadmapSummary.totalInitiatives} initiatives
                  </div>
                  <div className="rounded-full bg-emerald-100 px-3 py-1.5 text-[14px] font-semibold tracking-[0.02em] text-emerald-800">
                    {roadmapSummary.scheduledInitiatives} scheduled
                  </div>
                  <div className="rounded-full bg-slate-200 px-3 py-1.5 text-[14px] font-semibold tracking-[0.02em] text-slate-800">
                    {roadmapSummary.backlogInitiatives} backlog
                  </div>
                  <div className="rounded-full bg-amber-100 px-3 py-1.5 text-[14px] font-semibold tracking-[0.02em] text-amber-800">
                    {roadmapSummary.totalEpics} epics
                  </div>
                  <div className="rounded-full bg-blue-100 px-3 py-1.5 text-[14px] font-semibold tracking-[0.02em] text-blue-800">
                    {roadmapSummary.totalStories} user stories
                  </div>
                </div>
              </div>
            </div>
          </div>

          {topMode === "roadmap" ? (
            <div
              ref={layoutRef}
              className={cn("grid min-h-0 flex-1 items-stretch gap-3", isResizingPanel && "select-none")}
              style={{ gridTemplateColumns: `${panelWidth}px 14px minmax(0, 1fr)` }}
            >
              <InitiativeListPanel
                initiatives={initiatives}
                activeMonth={activeTimelineMonth}
                activeSprintLane={activeSprintLane}
                storyDragEnabled={isSprintModeActive}
                isSprintModeActive={isSprintModeActive}
                onCreateInitiative={() => {
                  setEditingInitiative(undefined);
                  setInitiativeDialogOpen(true);
                }}
                onCreateEpic={() => {
                  setEditingEpic(undefined);
                  const m = activeTimelineMonth;
                  const firstForMonth =
                    m == null
                      ? undefined
                      : initiatives.find(
                          (i) =>
                            i.status === InitiativeStatus.scheduled &&
                            i.startMonth != null &&
                            i.endMonth != null &&
                            i.startMonth <= m &&
                            i.endMonth >= m,
                        );
                  setEditingEpicInitiativeId(firstForMonth?.id ?? null);
                  setEpicDialogOpen(true);
                }}
                onEditInitiative={(initiative) => {
                  setEditingInitiative(initiative);
                  setInitiativeDialogOpen(true);
                }}
                onOpenEpic={(epic, initiative) => {
                  setEditingEpic(epic);
                  setEditingEpicInitiativeId(initiative.id);
                  setEpicDialogOpen(true);
                }}
                onOpenStory={(storyId) => {
                  setSelectedStoryId(storyId);
                }}
                onDeleteEpic={handleDeleteEpic}
                onDeleteInitiative={handleDeleteInitiative}
                onCreateEpicQuick={async (initiativeId, title) => {
                  try {
                    await createEpicQuick(initiativeId, title);
                    toast.success("Epic added");
                  } catch {
                    toast.error("Failed to add epic");
                  }
                }}
                onCreateStoryQuick={async (epicId, title) => {
                  try {
                    await createStoryQuick(epicId, title);
                    toast.success("User story added");
                  } catch {
                    toast.error("Failed to add user story");
                  }
                }}
                epicBacklogOrderByMonth={epicBacklogOrderByMonth}
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
                focusedMonthExternal={activeTimelineMonth}
                activeSprintExternal={activeSprintLane}
                activeSprintTabExternal={activeSprintTab}
                onFocusedQuarterChange={setFocusedQuarterLabel}
                onSprintTabChange={setActiveSprintTab}
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
                onSprintModeChange={handleSprintModeChange}
              />
            </div>
          ) : (
            <BacklogPlanningPanel
              initiatives={initiatives}
              storyRefById={storyRefMaps.byId}
              onOpenStory={(storyId) => {
                setSelectedStoryId(storyId);
              }}
            />
          )}
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
        storyRefById={storyRefMaps.byId}
        onDelete={async (epicId) => {
          try {
            await handleDeleteEpic(epicId);
            toast.success("Epic deleted");
          } catch {
            toast.error("Failed to delete epic");
          }
        }}
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
        onDelete={async (storyId) => {
          try {
            await deleteStory(storyId);
            toast.success("User story deleted");
          } catch {
            toast.error("Failed to delete user story");
          }
        }}
        storyRef={selectedStoryId ? storyRefMaps.byId[selectedStoryId] : undefined}
      />
    </DragContext>
  );
}
