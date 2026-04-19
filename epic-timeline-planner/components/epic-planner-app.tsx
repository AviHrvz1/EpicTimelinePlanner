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
import { TimelineGrid, type MonthPlanSurfaceTab } from "@/components/timeline/timeline-grid";
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
  parseMonthTeamSlotDropId,
} from "@/lib/epic-dnd-ids";
import {
  clientYCenterFromDragEnd,
  inferGanttLaneInsertIndexFromClientY,
} from "@/lib/gantt-lane-from-pointer";
import {
  applyEpicTeamQueueMove,
  collectMonthEpicsForTeamBoard,
  isKnownEpicTeamId,
  monthTeamBoardStorageKey,
  MONTH_TEAM_IDS,
  sanitizeMonthTeamBoardPersisted,
  type MonthTeamBoardPersisted,
} from "@/lib/month-team-board";
import { MONTHS, QUARTERS } from "@/lib/timeline";
import { EpicItem, InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { clampYearSprint, globalSprintFromMonthLane } from "@/lib/year-sprint";

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

/** Avoid infinite `router.replace` loops when the browser serializes query params in a different order than `URLSearchParams#toString()`. */
function queryParamsEquivalent(searchA: string, searchB: string): boolean {
  const norm = (s: string) => (s.startsWith("?") ? s.slice(1) : s);
  const a = new URLSearchParams(norm(searchA));
  const b = new URLSearchParams(norm(searchB));
  const keysA = [...new Set(a.keys())].sort();
  const keysB = [...new Set(b.keys())].sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
  }
  for (const k of keysA) {
    if (a.getAll(k).join("\0") !== b.getAll(k).join("\0")) return false;
  }
  return true;
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
  const [selectedYear, setSelectedYear] = useState(year);
  const [initiativeDialogOpen, setInitiativeDialogOpen] = useState(false);
  const [editingInitiative, setEditingInitiative] = useState<InitiativeItem | undefined>(undefined);
  const [epicDialogOpen, setEpicDialogOpen] = useState(false);
  const [editingEpic, setEditingEpic] = useState<EpicItem | undefined>(undefined);
  const [editingEpicInitiativeId, setEditingEpicInitiativeId] = useState<string | null>(null);
  const [focusedQuarterLabel, setFocusedQuarterLabel] = useState<string | null>(null);
  const [isSprintModeActive, setIsSprintModeActive] = useState(false);
  const [activeTimelineMonth, setActiveTimelineMonth] = useState<number | null>(null);
  const [activeYearSprint, setActiveYearSprint] = useState<number | null>(null);
  const [activeSprintTab, setActiveSprintTab] = useState<"kanban" | "status">("kanban");
  const [activeMonthPlanTab, setActiveMonthPlanTab] = useState<MonthPlanSurfaceTab>("epic-gantt");
  /** When sprint Kanban is opened from a team lane: team id for breadcrumb and left epic list. */
  const [sprintStoryBoardTeamId, setSprintStoryBoardTeamId] = useState<string | null>(null);
  const [monthTeamBoardByKey, setMonthTeamBoardByKey] = useState<Record<string, MonthTeamBoardPersisted>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem("epicPlanner.monthTeamBoard.v1");
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, MonthTeamBoardPersisted>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const [topMode, setTopMode] = useState<"roadmap" | "backlog">("roadmap");
  const [epicBacklogOrderByMonth, setEpicBacklogOrderByMonth] = useState<Record<number, string[]>>({});
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [creatingStoryEpicId, setCreatingStoryEpicId] = useState<string | null>(null);
  /** Separate from selection so `open` can go false before IDs clear, allowing exit animation. */
  const [storyDialogOpen, setStoryDialogOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(520);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [isUrlHydrated, setIsUrlHydrated] = useState(false);
  const hasHydratedFromUrlRef = useRef(false);

  const roadmapSummary = useMemo(() => {
    const scheduled = initiatives.filter((i) => i.status === "scheduled");
    const backlog = initiatives.filter((i) => i.status === "backlog");
    const totalEpics = initiatives.reduce((sum, i) => sum + (i.epics?.length ?? 0), 0);
    const totalStories = initiatives.reduce(
      (sum, i) => sum + (i.epics ?? []).reduce((es, e) => es + (e.userStories?.length ?? 0), 0),
      0,
    );
    const completedStories = initiatives.reduce(
      (sum, initiative) =>
        sum +
        (initiative.epics ?? []).reduce(
          (epicSum, epic) =>
            epicSum +
            (epic.userStories ?? []).filter(
              (story) => story.status === StoryStatus.done || story.status === StoryStatus.approved,
            ).length,
          0,
        ),
      0,
    );
    const completionPercent = totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;

    return {
      totalInitiatives: initiatives.length,
      scheduledInitiatives: scheduled.length,
      backlogInitiatives: backlog.length,
      totalEpics,
      totalStories,
      completedStories,
      completionPercent,
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
    if (selectedStoryId != null || creatingStoryEpicId != null) {
      setStoryDialogOpen(true);
    }
  }, [selectedStoryId, creatingStoryEpicId]);

  useEffect(() => {
    if (selectedStoryId == null && creatingStoryEpicId == null) {
      setStoryDialogOpen(false);
    }
  }, [selectedStoryId, creatingStoryEpicId]);

  useEffect(() => {
    if (hasHydratedFromUrlRef.current) return;
    hasHydratedFromUrlRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("quarter");
    if (q && QUARTERS.some((item) => item.label === q)) {
      setFocusedQuarterLabel(q);
    }
    const monthRaw = params.get("month");
    let hydratedMonth: number | null = null;
    if (monthRaw) {
      const month = Number(monthRaw);
      if (Number.isFinite(month) && month >= 1 && month <= 12) {
        hydratedMonth = month;
        setActiveTimelineMonth(month);
      }
    }
    const sprintRaw = params.get("sprint");
    if (sprintRaw != null) {
      const n = Number(sprintRaw);
      if (Number.isFinite(n) && n >= 1 && n <= 24) {
        setActiveYearSprint(clampYearSprint(n));
        setIsSprintModeActive(true);
      }
    }
    const sprintViewRaw = params.get("sprintView");
    if (sprintViewRaw === "kanban" || sprintViewRaw === "status") {
      setActiveSprintTab(sprintViewRaw);
    }
    const planTabRaw = params.get("planTab");
    let hydratedMonthPlanTab: MonthPlanSurfaceTab = "epic-gantt";
    if (hydratedMonth != null) {
      if (planTabRaw === "team") {
        hydratedMonthPlanTab = "team-queue";
      } else if (planTabRaw === "epic") {
        hydratedMonthPlanTab = "epic-gantt";
      } else if (planTabRaw === "sprintBoard") {
        hydratedMonthPlanTab = "sprint-kanban";
      } else if (planTabRaw === "sprintInsights") {
        hydratedMonthPlanTab = "sprint-status";
      } else if (params.get("sprint") != null) {
        hydratedMonthPlanTab = sprintViewRaw === "status" ? "sprint-status" : "sprint-kanban";
      } else {
        hydratedMonthPlanTab = "epic-gantt";
      }
      setActiveMonthPlanTab(hydratedMonthPlanTab);
      if (hydratedMonthPlanTab === "sprint-kanban" || hydratedMonthPlanTab === "sprint-status") {
        const sprintTeamRaw = params.get("sprintTeam");
        if (sprintTeamRaw && MONTH_TEAM_IDS.includes(sprintTeamRaw)) {
          setSprintStoryBoardTeamId(sprintTeamRaw);
        }
      }
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

  const prevTimelineMonthRef = useRef<number | null | "init">("init");
  useEffect(() => {
    if (prevTimelineMonthRef.current === "init") {
      prevTimelineMonthRef.current = activeTimelineMonth;
      return;
    }
    if (prevTimelineMonthRef.current !== activeTimelineMonth) {
      prevTimelineMonthRef.current = activeTimelineMonth;
      if (activeTimelineMonth != null) {
        setActiveMonthPlanTab("epic-gantt");
        setSprintStoryBoardTeamId(null);
      }
    }
  }, [activeTimelineMonth]);

  useEffect(() => {
    try {
      const cleaned = Object.fromEntries(
        Object.entries(monthTeamBoardByKey).map(([k, v]) => [k, sanitizeMonthTeamBoardPersisted(v)]),
      );
      localStorage.setItem("epicPlanner.monthTeamBoard.v1", JSON.stringify(cleaned));
    } catch {
      /* ignore quota / private mode */
    }
  }, [monthTeamBoardByKey]);

  useEffect(() => {
    if (!isUrlHydrated) return;
    const params = new URLSearchParams();
    if (focusedQuarterLabel) params.set("quarter", focusedQuarterLabel);
    if (activeTimelineMonth != null) {
      params.set("month", String(activeTimelineMonth));
      if (activeMonthPlanTab === "epic-gantt") params.set("planTab", "epic");
      else if (activeMonthPlanTab === "team-queue") params.set("planTab", "team");
      else if (activeMonthPlanTab === "sprint-kanban") params.set("planTab", "sprintBoard");
      else params.set("planTab", "sprintInsights");
    }
    if (activeYearSprint != null) params.set("sprint", String(activeYearSprint));
    if (activeYearSprint != null) params.set("sprintView", activeSprintTab);
    if (
      (activeMonthPlanTab === "sprint-kanban" || activeMonthPlanTab === "sprint-status") &&
      isKnownEpicTeamId(sprintStoryBoardTeamId)
    ) {
      params.set("sprintTeam", sprintStoryBoardTeamId);
    }
    if (epicDialogOpen && editingEpic?.id) params.set("epic", editingEpic.id);
    if (selectedStoryId) params.set("story", storyRefMaps.byId[selectedStoryId] ?? selectedStoryId);
    const next = params.toString();
    const target = next ? `${pathname}?${next}` : pathname;
    const targetSearch = next ? `?${next}` : "";
    if (window.location.pathname !== pathname) {
      router.replace(target, { scroll: false });
    } else if (!queryParamsEquivalent(window.location.search, targetSearch)) {
      router.replace(target, { scroll: false });
    }
  }, [
    isUrlHydrated,
    focusedQuarterLabel,
    activeTimelineMonth,
    activeYearSprint,
    activeSprintTab,
    activeMonthPlanTab,
    epicDialogOpen,
    editingEpic?.id,
    selectedStoryId,
    storyRefMaps.byId,
    router,
    pathname,
    sprintStoryBoardTeamId,
  ]);

  const handleSprintModeChange = useCallback(
    (active: boolean, month: number | null, yearSprint: number | null) => {
      setIsSprintModeActive(active);
      setActiveTimelineMonth(month);
      setActiveYearSprint(yearSprint == null ? null : clampYearSprint(yearSprint));
      if (!active || month == null) {
        setSprintStoryBoardTeamId(null);
      }
      if (yearSprint == null) {
        setActiveSprintTab("kanban");
      }
    },
    [],
  );

  const handleMonthPlanTabChange = useCallback((tab: MonthPlanSurfaceTab) => {
    setActiveMonthPlanTab(tab);
    if (tab === "sprint-kanban") setActiveSprintTab("kanban");
    if (tab === "sprint-status") setActiveSprintTab("status");
    if (tab === "epic-gantt" || tab === "team-queue" || tab === "sprint-status") {
      setSprintStoryBoardTeamId(null);
    }
  }, []);

  const openSprintStoryBoard = useCallback((yearSprint: number, teamId: string | null) => {
    setActiveYearSprint(clampYearSprint(yearSprint));
    setActiveSprintTab("kanban");
    setActiveMonthPlanTab("sprint-kanban");
    setSprintStoryBoardTeamId(teamId?.trim() ? teamId.trim() : null);
  }, []);

  async function refresh(targetYear = selectedYear) {
    const data = await parseJson<InitiativeItem[]>(
      await fetch(`/api/initiatives?year=${targetYear}`, { cache: "no-store" }),
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
          body: JSON.stringify({ ...payload, year: selectedYear }),
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
    team: string | null;
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

  async function createInitiativeQuick(title: string) {
    const response = await fetch("/api/initiatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, year: selectedYear }),
    });
    if (!response.ok) {
      throw new Error("Failed to create initiative");
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
      year: selectedYear,
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
      body: JSON.stringify({ year: selectedYear, startMonth: null, endMonth: null }),
    });
    if (!response.ok) {
      throw new Error("Failed to unschedule initiative");
    }
  }

  async function patchInitiativeScheduleRange(initiativeId: string, startMonth: number, endMonth: number) {
    const response = await fetch(`/api/initiatives/${initiativeId}/schedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: selectedYear, startMonth, endMonth }),
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
        const body = (await response.json()) as {
          message?: string;
          issues?: { fieldErrors?: Record<string, string[] | undefined> };
        };
        if (typeof body?.message === "string") message = body.message;
        const details = Object.entries(body?.issues?.fieldErrors ?? {})
          .flatMap(([field, errs]) => (errs ?? []).map((err) => `${field}: ${err}`))
          .join("; ");
        if (details) message = `${message} (${details})`;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
  }

  async function patchEpicQuarterPlan(
    epicId: string,
    payload: { planSprint: number; planStartMonth: number; planEndMonth: number },
  ) {
    const response = await fetch(`/api/epics/${epicId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let message = `Could not save (${response.status})`;
      try {
        const body = (await response.json()) as {
          message?: string;
          issues?: { fieldErrors?: Record<string, string[] | undefined> };
        };
        if (typeof body?.message === "string") message = body.message;
        const details = Object.entries(body?.issues?.fieldErrors ?? {})
          .flatMap(([field, errs]) => (errs ?? []).map((err) => `${field}: ${err}`))
          .join("; ");
        if (details) message = `${message} (${details})`;
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
    status: StoryStatus;
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
      status: StoryStatus;
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
          if (!response.ok) {
            const body = await response.text().catch(() => "");
            console.error("[story-move] unschedule PATCH failed", {
              storyId,
              httpStatus: response.status,
              responseBody: body || undefined,
              patch: { sprint: null },
            });
            throw new Error(`Failed to update story: ${response.status}`);
          }
          toast.success("Story moved to unscheduled");
        } catch (err) {
          console.error("[story-move] unschedule drop failed", {
            storyId,
            overId,
            cause: err instanceof Error ? err.message : String(err),
          });
          await refresh();
          toast.error("Failed to clear sprint on story");
        }
        return;
      }

      const kanbanMatch = /^kanban:(\d+):(todo|inProgress|done|approved)$/.exec(overId);
      if (!kanbanMatch) return;
      const sprint = clampYearSprint(Number(kanbanMatch[1]));
      // Group 1 = year sprint; group 2 = status (there is no third capture).
      const status = kanbanMatch[2] as StoryStatus;
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
        const patchBody = { status: nextStatus, sprint };
        const response = await fetch(`/api/stories/${storyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          console.error("[story-move] kanban PATCH failed", {
            storyId,
            httpStatus: response.status,
            responseBody: body || undefined,
            patch: patchBody,
            overId,
          });
          throw new Error(`Failed to update story: ${response.status}`);
        }
        toast.success("Story updated");
      } catch (err) {
        console.error("[story-move] kanban drop failed", {
          storyId,
          nextStatus,
          sprint,
          overId,
          cause: err instanceof Error ? err.message : String(err),
        });
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

      const teamSlot = parseMonthTeamSlotDropId(overId);
      if (teamSlot) {
        if (teamSlot.year !== selectedYear) {
          toast.message("Switch the roadmap year to update that month’s team board.");
          return;
        }
        const inMonth = collectMonthEpicsForTeamBoard(initiatives, teamSlot.month).some((c) => c.epic.id === epicId);
        if (!inMonth) {
          toast.message("Only epics tied to this month can be queued for a team.");
          return;
        }
        const key = monthTeamBoardStorageKey(teamSlot.year, teamSlot.month);
        setMonthTeamBoardByKey((prev) => {
          const cur = prev[key] ?? { queues: {} };
          return { ...prev, [key]: applyEpicTeamQueueMove(cur, epicId, teamSlot.teamId, teamSlot.index) };
        });
        flushSync(() => {
          setInitiatives((prev) =>
            prev.map((i) => ({
              ...i,
              epics: (i.epics ?? []).map((e) =>
                e.id === epicId ? { ...e, team: teamSlot.teamId } : e,
              ),
            })),
          );
        });
        try {
          const response = await fetch(`/api/epics/${epicId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team: teamSlot.teamId }),
          });
          if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(text || `HTTP ${response.status}`);
          }
          toast.success("Team updated");
        } catch (err) {
          await refresh();
          const description = err instanceof Error ? err.message : undefined;
          toast.error("Failed to save team", description ? { description } : undefined);
        }
        return;
      }

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

      const epicKanbanTodoMatch = /^kanban:(\d+):todo$/.exec(overId);
      if (epicKanbanTodoMatch) {
        const sprint = clampYearSprint(Number(epicKanbanTodoMatch[1]));
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
        const lane = Number(epicCell[2]) as 1 | 2;
        planSprint = lane;
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
          <div className="rounded-2xl bg-card p-4 shadow-lg ring-1 ring-black/5">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <div className="inline-flex flex-col p-1">
                  <img
                    src="/bird-eye-lockup-wide.png"
                    alt="Bird Eye Viewer logo"
                    className="h-[90px] w-auto max-w-[760px] rounded-md object-contain object-left"
                  />
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-3">
                <div className="inline-flex gap-0.5 rounded-lg border border-indigo-200/70 bg-gradient-to-b from-indigo-50/50 to-violet-50/40 p-0.5 shadow-sm ring-1 ring-indigo-100/80">
                  <button
                    type="button"
                    onClick={() => setTopMode("roadmap")}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-[13px] font-semibold transition",
                      topMode === "roadmap"
                        ? "bg-gradient-to-b from-indigo-50 to-violet-50 text-slate-800 shadow-sm ring-1 ring-indigo-300/80"
                        : "text-slate-600 hover:bg-indigo-100/45 hover:text-slate-900",
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
                        ? "bg-gradient-to-b from-indigo-50 to-violet-50 text-slate-800 shadow-sm ring-1 ring-indigo-300/80"
                        : "text-slate-600 hover:bg-indigo-100/45 hover:text-slate-900",
                    )}
                  >
                    Backlog
                  </button>
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
                activeYearSprint={activeYearSprint}
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
                monthEpicTeamFilterId={
                  activeTimelineMonth != null &&
                  activeMonthPlanTab === "sprint-kanban" &&
                  isKnownEpicTeamId(sprintStoryBoardTeamId)
                    ? sprintStoryBoardTeamId
                    : null
                }
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
                currentYear={selectedYear}
                summaryBadges={roadmapSummary}
                onYearChange={async (nextYear) => {
                  if (nextYear === selectedYear) return;
                  setSelectedYear(nextYear);
                  await refresh(nextYear);
                  setFocusedQuarterLabel(null);
                  setActiveTimelineMonth(null);
                  setActiveYearSprint(null);
                  setActiveSprintTab("kanban");
                  setActiveMonthPlanTab("epic-gantt");
                  setSprintStoryBoardTeamId(null);
                }}
                focusedQuarterLabel={focusedQuarterLabel}
                focusedMonthExternal={activeTimelineMonth}
                activeSprintExternal={activeYearSprint}
                activeSprintTabExternal={activeSprintTab}
                monthPlanTab={activeMonthPlanTab}
                onMonthPlanTabChange={handleMonthPlanTabChange}
                monthTeamBoardByKey={monthTeamBoardByKey}
                onEnterSprintStoryBoard={openSprintStoryBoard}
                sprintStoryBoardTeamId={sprintStoryBoardTeamId}
                onSprintStoryBoardTeamChange={setSprintStoryBoardTeamId}
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
              onOpenInitiative={(initiativeId) => {
                const initiative = initiatives.find((item) => item.id === initiativeId);
                if (!initiative) return;
                setEditingInitiative(initiative);
                setInitiativeDialogOpen(true);
              }}
              onOpenEpic={(epicId) => {
                for (const initiative of initiatives) {
                  const epic = (initiative.epics ?? []).find((item) => item.id === epicId);
                  if (!epic) continue;
                  setEditingEpic(epic);
                  setEditingEpicInitiativeId(initiative.id);
                  setEpicDialogOpen(true);
                  return;
                }
              }}
              onOpenStory={(storyId) => {
                setSelectedStoryId(storyId);
              }}
              onCreateInitiativeQuick={async (title) => {
                try {
                  await createInitiativeQuick(title);
                  toast.success("Initiative added");
                } catch {
                  toast.error("Failed to add initiative");
                }
              }}
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
              onPatchStoryQuick={async (storyId, patch) => {
                try {
                  const response = await fetch(`/api/stories/${storyId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch),
                  });
                  if (!response.ok) {
                    throw new Error("Failed to patch story");
                  }
                  await refresh();
                } catch {
                  toast.error("Failed to update story");
                }
              }}
              onPatchInitiativeQuick={async (initiativeId, patch) => {
                try {
                  const response = await fetch(`/api/initiatives/${initiativeId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch),
                  });
                  if (!response.ok) throw new Error("Failed to patch initiative");
                  await refresh();
                } catch {
                  toast.error("Failed to update initiative");
                }
              }}
              onPatchEpicQuick={async (epicId, patch) => {
                try {
                  const response = await fetch(`/api/epics/${epicId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch),
                  });
                  if (!response.ok) throw new Error("Failed to patch epic");
                  await refresh();
                } catch {
                  toast.error("Failed to update epic");
                }
              }}
            />
          )}
        </div>
      </main>
      <InitiativeFormDialog
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
        }}
        onExitComplete={() => {
          setEditingInitiative(undefined);
        }}
        onSubmit={handleUpsertInitiative}
      />
      <EpicFormDialog
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
        }}
        onExitComplete={() => {
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
        open={storyDialogOpen}
        story={selectedStory}
        initiatives={initiatives}
        lockParentEpicId={creatingStoryEpicId}
        onClose={() => {
          setStoryDialogOpen(false);
        }}
        onExitComplete={() => {
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
