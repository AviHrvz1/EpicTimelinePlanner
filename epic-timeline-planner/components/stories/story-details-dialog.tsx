"use client";

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, History, MessageSquare, Plus, Tag, Trash, X } from "lucide-react";
import { StoryStatus } from "@/lib/generated/prisma";

import { Button } from "@/components/ui/button";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { EpicPlanBarIcon, InitiativePlanBarIcon } from "@/components/timeline/epic-plan-bar";
import { monthTeamLabelForId } from "@/lib/month-team-board";
import { MONTHS } from "@/lib/timeline";
import { InitiativeItem, UserStoryItem } from "@/lib/types";
import { useDialogPresence } from "@/lib/use-dialog-presence";
import {
  isUsablePlanningSurfaceRect,
  planningDetailPanelAnchorStyle,
  usePlanningSurfaceRect,
} from "@/lib/use-planning-surface-rect";
import { cn } from "@/lib/utils";
import { YEAR_SPRINT_MAX } from "@/lib/year-sprint";

type StoryWithEpic = UserStoryItem & { epicTitle: string };
type ChildStoryDraft = {
  title: string;
  sprint: string;
  status: StoryStatus;
  assignee: string;
  priority: string;
  estimatedDays: string;
  daysLeft: string;
};

function quarterLabelFromMonth(month: number | null | undefined): string | null {
  if (month == null) return null;
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

type StoryDetailsDialogProps = {
  open: boolean;
  story: StoryWithEpic | null;
  initiatives: InitiativeItem[];
  lockParentEpicId?: string | null;
  onClose: () => void;
  onCreate: (payload: {
    title: string;
    icon: string;
    description: string | null;
    assignee: string | null;
    labels: string | null;
    priority: string | null;
    sprint: number | null;
    estimatedDays: number | null;
    daysLeft: number | null;
    status: StoryStatus;
    epicId: string;
  }) => Promise<void>;
  onSave: (
    storyId: string,
    payload: {
      title: string;
      icon: string;
      description: string | null;
      assignee: string | null;
      labels: string | null;
      priority: string | null;
      sprint: number | null;
      estimatedDays: number | null;
      daysLeft: number | null;
      status: StoryStatus;
      epicId: string;
    },
  ) => Promise<void>;
  onDelete?: (storyId: string) => Promise<void>;
  onAddComment: (storyId: string, body: string) => Promise<void>;
  onOpenInitiative?: (initiativeId: string) => void;
  onOpenEpic?: (epicId: string) => void;
  onOpenStory?: (storyId: string) => void;
  storyRef?: string;
  /** Called after exit animation; use to clear selection in parent without remounting mid-close. */
  onExitComplete?: () => void;
  /** When set, the panel matches this element (e.g. right timeline column). */
  surfaceAnchorRef?: RefObject<HTMLElement | null>;
};

export function StoryDetailsDialog({
  open,
  story,
  initiatives,
  lockParentEpicId,
  onClose,
  onExitComplete,
  onCreate,
  onSave,
  onDelete,
  onAddComment,
  onOpenInitiative,
  onOpenEpic,
  onOpenStory,
  storyRef,
  surfaceAnchorRef,
}: StoryDetailsDialogProps) {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("📄");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [labelsDraft, setLabelsDraft] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [priority, setPriority] = useState("");
  const [quarterDraft, setQuarterDraft] = useState("");
  const [monthDraft, setMonthDraft] = useState("");
  const [yearDraft, setYearDraft] = useState("");
  const [sprint, setSprint] = useState("");
  const [status, setStatus] = useState<StoryStatus>(StoryStatus.todo);
  const [estimatedDays, setEstimatedDays] = useState("");
  const [daysLeft, setDaysLeft] = useState("");
  const [epicId, setEpicId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [dialogWidthVw, setDialogWidthVw] = useState(50);
  const [detailsPanelWidthPx, setDetailsPanelWidthPx] = useState(296);
  const [activityPanelHeightPx, setActivityPanelHeightPx] = useState(220);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const [isDraggingDialog, setIsDraggingDialog] = useState(false);
  const [childStoryDrafts, setChildStoryDrafts] = useState<Record<string, ChildStoryDraft>>({});
  const [nestedStoryId, setNestedStoryId] = useState<string | null>(null);
  const [childEditingCell, setChildEditingCell] = useState<{
    rowId: string;
    field: "title" | "sprint" | "status" | "assignee" | "priority" | "estimatedDays" | "daysLeft";
  } | null>(null);
  const [childEditingValue, setChildEditingValue] = useState("");
  const [newChildTitle, setNewChildTitle] = useState("");
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);
  const lastAutosavePayloadRef = useRef<string>("");
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);

  const allEpics = useMemo(
    () =>
      initiatives.flatMap((initiative) =>
        (initiative.epics ?? []).map((epic) => ({
          id: epic.id,
          title: epic.title,
          initiativeTitle: initiative.title,
        })),
      ),
    [initiatives],
  );

  const firstEpicId = allEpics[0]?.id ?? "";
  const selectedEpicMeta = useMemo(() => {
    if (!epicId) return null;
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (epic.id !== epicId) continue;
        const team = monthTeamLabelForId(epic.team) ?? "Not set";
        const quarter = epic.planQuarter != null ? `Q${epic.planQuarter}` : quarterLabelFromMonth(epic.planStartMonth);
        const month =
          epic.planStartMonth == null
            ? null
            : epic.planEndMonth != null && epic.planEndMonth !== epic.planStartMonth
              ? `${MONTHS[epic.planStartMonth - 1]}-${MONTHS[epic.planEndMonth - 1]}`
              : MONTHS[epic.planStartMonth - 1];
        const year = epic.planYear ?? initiative.year ?? null;
        return { team, quarter, month, year };
      }
    }
    return null;
  }, [initiatives, epicId]);
  const selectedBreadcrumbMeta = useMemo(() => {
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (epic.id !== epicId) continue;
        return { initiative, epic };
      }
    }
    return null;
  }, [initiatives, epicId]);
  const existingLabelSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        for (const row of epic.userStories ?? []) {
          const parts = (row.labels ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
          for (const part of parts) set.add(part);
        }
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [initiatives]);
  const siblingStories = useMemo(() => {
    if (!selectedBreadcrumbMeta) return [] as UserStoryItem[];
    return (selectedBreadcrumbMeta.epic.userStories ?? []).filter((row) => row.id !== story?.id);
  }, [selectedBreadcrumbMeta, story?.id]);
  const nestedStory = useMemo(() => {
    if (!nestedStoryId) return null;
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        const row = (epic.userStories ?? []).find((item) => item.id === nestedStoryId);
        if (row) return { ...row, epicTitle: epic.title } satisfies StoryWithEpic;
      }
    }
    return null;
  }, [initiatives, nestedStoryId]);
  useEffect(() => {
    const next: Record<string, ChildStoryDraft> = {};
    for (const row of siblingStories) {
      next[row.id] = {
        title: row.title ?? "",
        sprint: row.sprint == null ? "" : String(row.sprint),
        status: row.status ?? StoryStatus.todo,
        assignee: row.assignee ?? "",
        priority: row.priority ?? "",
        estimatedDays: row.estimatedDays == null ? "" : String(row.estimatedDays),
        daysLeft: row.daysLeft == null ? "" : String(row.daysLeft),
      };
    }
    setChildStoryDrafts(next);
  }, [siblingStories]);
  useEffect(() => {
    if (Object.keys(childStoryDrafts).length === 0) return;
    const totals = Object.values(childStoryDrafts).reduce(
      (acc, row) => {
        const est = Number(row.estimatedDays);
        const left = Number(row.daysLeft);
        if (Number.isFinite(est) && est >= 0) acc.est += est;
        if (Number.isFinite(left) && left >= 0) acc.left += left;
        return acc;
      },
      { est: 0, left: 0 },
    );
    setEstimatedDays(String(Math.round(totals.est)));
    setDaysLeft(String(Math.round(totals.left)));
  }, [childStoryDrafts]);
  const displayIds = useMemo(() => {
    const byInitiativeId = new Map<string, string>();
    const byEpicId = new Map<string, string>();
    const byStoryId = new Map<string, string>();

    const initiativesSorted = [...initiatives].sort((a, b) => {
      const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (t !== 0) return t;
      return a.title.localeCompare(b.title);
    });
    initiativesSorted.forEach((initiative, index) => {
      byInitiativeId.set(initiative.id, `INIT-${String(index + 1).padStart(2, "0")}`);
    });

    const allEpics = initiatives
      .flatMap((initiative) => initiative.epics ?? [])
      .sort((a, b) => {
        const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (t !== 0) return t;
        return a.title.localeCompare(b.title);
      });
    allEpics.forEach((epic, index) => {
      byEpicId.set(epic.id, `EPIC-${String(index + 1).padStart(2, "0")}`);
    });

    const allStories = initiatives
      .flatMap((initiative) => initiative.epics ?? [])
      .flatMap((epic) => epic.userStories ?? [])
      .sort((a, b) => {
        const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (t !== 0) return t;
        return a.title.localeCompare(b.title);
      });
    allStories.forEach((row, index) => {
      byStoryId.set(row.id, `US-${String(index + 1).padStart(2, "0")}`);
    });

    return { byInitiativeId, byEpicId, byStoryId };
  }, [initiatives]);

  useEffect(() => {
    if (story) {
      setTitle(story.title ?? "");
      setIcon(story.icon === "🧩" ? "📄" : (story.icon ?? "📄"));
      setDescription(story.description ?? "");
      setAssignee(story.assignee ?? "");
      setLabelsDraft(
        (story.labels ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
      setPriority(story.priority ?? "");
      setNewLabel("");
      setQuarterDraft(selectedEpicMeta?.quarter ?? "");
      setMonthDraft(selectedEpicMeta?.month ?? "");
      setYearDraft(selectedEpicMeta?.year != null ? String(selectedEpicMeta.year) : "");
      setSprint(story.sprint == null ? "" : String(story.sprint));
      setStatus(story.status ?? StoryStatus.todo);
      setEstimatedDays(story.estimatedDays == null ? "" : String(story.estimatedDays));
      setDaysLeft(story.daysLeft == null ? "" : String(story.daysLeft));
      setEpicId(story.epicId);
    } else {
      setTitle("");
      setIcon("📄");
      setDescription("");
      setAssignee("");
      setLabelsDraft([]);
      setPriority("");
      setNewLabel("");
      setQuarterDraft(selectedEpicMeta?.quarter ?? "");
      setMonthDraft(selectedEpicMeta?.month ?? "");
      setYearDraft(selectedEpicMeta?.year != null ? String(selectedEpicMeta.year) : "");
      setSprint("");
      setStatus(StoryStatus.todo);
      setEstimatedDays("");
      setDaysLeft("");
      setEpicId(lockParentEpicId ?? firstEpicId);
    }
    setCommentBody("");
    setActivityTab("comments");
  }, [story, initiatives, lockParentEpicId, firstEpicId, selectedEpicMeta]);

  useEffect(() => {
    if (open) {
      setDialogWidthVw(50);
      setDetailsPanelWidthPx(296);
      setActivityPanelHeightPx(220);
      setDialogOffset({ x: 0, y: 0 });
      setIsDraggingDialog(false);
      dragStartRef.current = null;
    }
  }, [open]);

  const { visible, leaving } = useDialogPresence(open, onExitComplete);
  const surfaceRect = usePlanningSurfaceRect(surfaceAnchorRef, visible);
  const anchored = false;
  const isCreateMode = !story;

  function buildStoryPayload() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle || !epicId) return null;
    return {
      title: normalizedTitle,
      icon: icon.trim() || "📄",
      description: description.trim() ? description.trim() : null,
      assignee: assignee.trim() ? assignee.trim() : null,
      labels: labelsDraft.length > 0 ? labelsDraft.join(", ") : null,
      priority: priority.trim() ? priority.trim() : null,
      sprint: sprint.trim() === "" ? null : Number(sprint),
      estimatedDays: estimatedDays.trim() === "" ? null : Number(estimatedDays),
      daysLeft: daysLeft.trim() === "" ? null : Number(daysLeft),
      status,
      epicId,
    };
  }

  async function handleSave() {
    const payload = buildStoryPayload();
    if (!payload) return;
    setSaving(true);
    try {
      if (isCreateMode) {
        await onCreate(payload);
      } else {
        await onSave(story.id, payload);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!open || isCreateMode || !story) return;
    const payload = buildStoryPayload();
    if (!payload) return;
    const payloadKey = JSON.stringify(payload);
    if (payloadKey === lastAutosavePayloadRef.current) return;
    const timer = window.setTimeout(async () => {
      try {
        await onSave(story.id, payload);
        lastAutosavePayloadRef.current = payloadKey;
      } catch {
        // Keep editing; next change will retry autosave.
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    open,
    isCreateMode,
    story,
    title,
    icon,
    description,
    assignee,
    labelsDraft,
    priority,
    sprint,
    estimatedDays,
    daysLeft,
    status,
    epicId,
    onSave,
  ]);

  if (!visible) return null;

  async function handleCommentAdd() {
    const normalizedComment = commentBody.trim();
    if (!normalizedComment) return;

    setCommenting(true);
    try {
      if (!story) return;
      await onAddComment(story.id, normalizedComment);
      setCommentBody("");
    } finally {
      setCommenting(false);
    }
  }

  async function handleDelete() {
    if (isCreateMode || !story || !onDelete) return;
    const confirmed = window.confirm("Delete this user story?");
    if (!confirmed) return;
    await onDelete(story.id);
    onClose();
  }

  async function handleSaveChildStory(row: UserStoryItem) {
    const draft = childStoryDrafts[row.id];
    if (!draft || !draft.title.trim()) return;
    await onSave(row.id, {
      title: draft.title.trim(),
      icon: row.icon?.trim() || "📄",
      description: row.description ?? null,
      assignee: draft.assignee.trim() || null,
      labels: row.labels ?? null,
      priority: row.priority ?? null,
      sprint: draft.sprint.trim() === "" ? null : Number(draft.sprint),
      estimatedDays: row.estimatedDays ?? null,
      daysLeft: row.daysLeft ?? null,
      status: draft.status,
      epicId: row.epicId,
    });
  }

  function beginChildCellEdit(
    row: UserStoryItem,
    field: "title" | "sprint" | "status" | "assignee" | "priority" | "estimatedDays" | "daysLeft",
  ) {
    const draft = childStoryDrafts[row.id];
    if (!draft) return;
    const value =
      field === "title"
        ? draft.title
        : field === "sprint"
          ? draft.sprint
          : field === "status"
            ? draft.status
          : field === "assignee"
            ? draft.assignee
            : field === "priority"
              ? draft.priority
              : field === "estimatedDays"
                ? draft.estimatedDays
                : draft.daysLeft;
    setChildEditingCell({ rowId: row.id, field });
    setChildEditingValue(value ?? "");
  }

  async function confirmChildCellEdit(row: UserStoryItem) {
    if (!childEditingCell || childEditingCell.rowId !== row.id) return;
    const existing = childStoryDrafts[row.id];
    if (!existing) return;
    const next: ChildStoryDraft =
      childEditingCell.field === "title"
        ? { ...existing, title: childEditingValue }
        : childEditingCell.field === "sprint"
          ? { ...existing, sprint: childEditingValue }
          : childEditingCell.field === "status"
            ? { ...existing, status: childEditingValue as StoryStatus }
            : childEditingCell.field === "assignee"
              ? { ...existing, assignee: childEditingValue }
              : childEditingCell.field === "priority"
                ? { ...existing, priority: childEditingValue }
                : childEditingCell.field === "estimatedDays"
                  ? { ...existing, estimatedDays: childEditingValue }
                  : { ...existing, daysLeft: childEditingValue };
    setChildStoryDrafts((prev) => ({ ...prev, [row.id]: next }));
    setChildEditingCell(null);
    setChildEditingValue("");
    await onSave(row.id, {
      title: next.title.trim(),
      icon: row.icon?.trim() || "📄",
      description: row.description ?? null,
      assignee: next.assignee.trim() || null,
      labels: row.labels ?? null,
      priority: next.priority.trim() || null,
      sprint: next.sprint.trim() === "" ? null : Number(next.sprint),
      estimatedDays: next.estimatedDays.trim() === "" ? null : Number(next.estimatedDays),
      daysLeft: next.daysLeft.trim() === "" ? null : Number(next.daysLeft),
      status: next.status,
      epicId: row.epicId,
    });
  }

  async function handleAddChildStory() {
    const epicForChild = selectedBreadcrumbMeta?.epic?.id;
    const normalized = newChildTitle.trim();
    if (!epicForChild || !normalized) return;
    await onCreate({
      title: normalized,
      icon: "📄",
      description: null,
      assignee: null,
      labels: null,
      priority: null,
      sprint: null,
      estimatedDays: null,
      daysLeft: null,
      status: StoryStatus.todo,
      epicId: epicForChild,
    });
    setNewChildTitle("");
  }

  function addLabel(label: string) {
    const normalized = label.trim();
    if (!normalized) return;
    setLabelsDraft((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    setNewLabel("");
  }

  function removeLabel(label: string) {
    setLabelsDraft((prev) => prev.filter((item) => item !== label));
  }

  function beginDialogDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: dialogOffset.x,
      startY: dialogOffset.y,
    };
    setIsDraggingDialog(true);

    function onPointerMove(moveEvent: PointerEvent) {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = moveEvent.clientX - start.pointerX;
      const dy = moveEvent.clientY - start.pointerY;
      setDialogOffset({ x: start.startX + dx, y: start.startY + dy });
    }

    function onPointerUp() {
      setIsDraggingDialog(false);
      dragStartRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function beginDetailsPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = detailsPanelWidthPx;
    const containerWidth = splitLayoutRef.current?.getBoundingClientRect().width ?? 0;
    const maxWidth = containerWidth > 0 ? Math.max(240, Math.floor(containerWidth - 320)) : 760;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      // Dragging left grows details panel; dragging right shrinks it.
      const next = startWidth - delta;
      setDetailsPanelWidthPx(Math.max(240, Math.min(maxWidth, next)));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function beginActivityPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = activityPanelHeightPx;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientY - startY;
      // Drag up => larger activity panel.
      const next = startHeight - delta;
      setActivityPanelHeightPx(Math.max(140, Math.min(520, next)));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-[1px]",
        !anchored && "flex items-stretch justify-end p-0",
        !leaving && "epic-dialog-backdrop",
        leaving && "epic-dialog-backdrop--exit",
        leaving && "pointer-events-none",
      )}
    >
      <div
        className={cn(
          !leaving ? "epic-dialog-panel-entrance" : "epic-dialog-panel--exit",
          anchored
            ? "fixed flex flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xl ring-1 ring-black/[0.06]"
            : "relative h-full shrink-0",
        )}
        style={
          anchored
            ? planningDetailPanelAnchorStyle(surfaceRect)
            : { width: `${dialogWidthVw}vw`, maxWidth: `${dialogWidthVw}vw` }
        }
      >
        <div
          className={cn(
            "flex h-full min-h-0 w-full flex-col p-5",
            anchored
              ? "h-full min-h-0 flex-1 shadow-none ring-0"
              : "h-full min-h-0 rounded-none border-0 bg-white shadow-none",
            isDraggingDialog && "select-none",
          )}
          style={{ transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)` }}
        >
        <div className="mb-4 flex cursor-move items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5" onPointerDown={beginDialogDrag}>
          <div className="flex min-w-0 items-center gap-1 text-sm font-semibold text-slate-700">
            <button
              type="button"
              onClick={() => selectedBreadcrumbMeta?.initiative && onOpenInitiative?.(selectedBreadcrumbMeta.initiative.id)}
              className="inline-flex min-w-0 items-center gap-1 truncate cursor-pointer rounded px-1 py-0.5 text-blue-700 underline decoration-blue-300 underline-offset-2 hover:bg-blue-50"
              title={selectedBreadcrumbMeta?.initiative?.title ?? "Open initiative"}
            >
              <InitiativePlanBarIcon
                icon={selectedBreadcrumbMeta?.initiative?.icon}
                className="mr-0 text-[11px] [&_svg]:size-3 [&_svg]:text-blue-600"
              />
              {selectedBreadcrumbMeta?.initiative
                ? (displayIds.byInitiativeId.get(selectedBreadcrumbMeta.initiative.id) ?? "Initiative")
                : "Initiative"}
            </button>
            <ChevronRight className="size-4 shrink-0 text-slate-400" />
            <button
              type="button"
              onClick={() => selectedBreadcrumbMeta?.epic && onOpenEpic?.(selectedBreadcrumbMeta.epic.id)}
              className="inline-flex min-w-0 items-center gap-1 truncate cursor-pointer rounded px-1 py-0.5 text-blue-700 underline decoration-blue-300 underline-offset-2 hover:bg-blue-50"
              title={selectedBreadcrumbMeta?.epic?.title ?? "Open epic"}
            >
              <EpicPlanBarIcon icon={selectedBreadcrumbMeta?.epic?.icon} className="mr-0 text-[11px] [&_svg]:size-3 [&_svg]:text-slate-600" />
              {selectedBreadcrumbMeta?.epic
                ? (displayIds.byEpicId.get(selectedBreadcrumbMeta.epic.id) ?? "Epic")
                : "Epic"}
            </button>
            <ChevronRight className="size-4 shrink-0 text-slate-400" />
            <button
              type="button"
              onClick={() => story && onOpenStory?.(story.id)}
              className="inline-flex min-w-0 items-center gap-1 truncate cursor-pointer rounded px-1 py-0.5 text-blue-700 underline decoration-blue-300 underline-offset-2 hover:bg-blue-50"
              title={(story?.title ?? title) || "Open user story"}
            >
              <UserStoryIcon className="size-3.5" />
              {story ? (displayIds.byStoryId.get(story.id) ?? "User Story") : "User Story"}
            </button>
            <ChevronRight className="size-4 shrink-0 text-slate-400" />
            <span className="truncate text-slate-900">{title || (isCreateMode ? "Create User Story" : "Untitled")}</span>
          </div>
          <div className="flex items-center gap-2">
            {!isCreateMode ? (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => void handleDelete()}
                aria-label="Delete story"
                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              >
                <Trash className="size-4" />
              </Button>
            ) : (
              <Button className="px-3 text-xs font-medium" onClick={handleSave} disabled={saving}>
                {saving ? "Creating..." : "Create"}
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close story details">
              <X />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            ref={splitLayoutRef}
            className="grid min-h-0 gap-0"
            style={{ gridTemplateColumns: `minmax(0,1fr) 10px ${detailsPanelWidthPx}px` }}
          >
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <label className="block space-y-1">
              <p className="text-sm font-medium text-slate-600">Title</p>
              <div className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-slate-300/70">
                <input
                  value={icon}
                  onChange={(event) => setIcon(event.target.value)}
                  maxLength={2}
                  className="w-12 border-r border-slate-200 bg-transparent px-2 py-2 text-center text-xl outline-none"
                />
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full bg-transparent px-3 py-2 text-base outline-none"
                />
              </div>
            </label>
            <label className="mt-5 block space-y-1">
              <p className="text-sm font-medium text-slate-600">Description</p>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="h-40 w-full rounded-md border bg-background px-3 py-2 text-base"
              />
            </label>
            <div className="mt-5 space-y-2">
              <p className="text-sm font-medium text-slate-600">User Stories Children</p>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">ID</th>
                      <th className="px-2 py-1.5 font-medium">Type</th>
                      <th className="px-2 py-1.5 font-medium">Story</th>
                      <th className="px-2 py-1.5 font-medium">Sprint</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 font-medium">Assignee</th>
                      <th className="px-2 py-1.5 font-medium">Priority</th>
                      <th className="px-2 py-1.5 font-medium">Est Days</th>
                      <th className="px-2 py-1.5 font-medium">Est Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-slate-100 bg-blue-50/40">
                      <td className="px-2 py-1.5 text-slate-400">-</td>
                      <td className="px-2 py-1.5">
                        <span className="inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                          User Story
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1">
                          <input
                            value={newChildTitle}
                            onChange={(event) => setNewChildTitle(event.target.value)}
                            placeholder="Add child user story title"
                            className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-800"
                          />
                          <Button type="button" size="sm" variant="outline" onClick={() => void handleAddChildStory()}>
                            Add
                          </Button>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-slate-400">Not set</td>
                      <td className="px-2 py-1.5 text-slate-400">To Do</td>
                      <td className="px-2 py-1.5 text-slate-400">Unassigned</td>
                      <td className="px-2 py-1.5 text-slate-400">Not set</td>
                      <td className="px-2 py-1.5 text-slate-400">-</td>
                      <td className="px-2 py-1.5 text-slate-400">-</td>
                    </tr>
                    {siblingStories.length === 0 ? (
                      <tr>
                        <td className="px-2 py-2 text-slate-500" colSpan={9}>No sibling stories in this epic.</td>
                      </tr>
                    ) : (
                      siblingStories.slice(0, 6).map((row) => (
                        <tr key={row.id} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 text-slate-600">
                            <button
                              type="button"
                              onClick={() => setNestedStoryId(row.id)}
                              className="rounded px-1 py-0.5 text-blue-700 hover:bg-blue-50 hover:underline"
                              title={row.title}
                            >
                              {displayIds.byStoryId.get(row.id) ?? row.id}
                            </button>
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              User Story
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-slate-800">
                            {childEditingCell?.rowId === row.id && childEditingCell.field === "title" ? (
                              <div className="flex items-center gap-1">
                                <input
                                  value={childEditingValue}
                                  onChange={(event) => setChildEditingValue(event.target.value)}
                                  className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-800"
                                />
                                <button type="button" onClick={() => void confirmChildCellEdit(row)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => beginChildCellEdit(row, "title")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                {childStoryDrafts[row.id]?.title ?? row.title}
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">
                            {childEditingCell?.rowId === row.id && childEditingCell.field === "sprint" ? (
                              <div className="flex items-center gap-1">
                                <select value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-700">
                                  <option value="">Not set</option>
                                  {Array.from({ length: YEAR_SPRINT_MAX }, (_, i) => (
                                    <option key={i + 1} value={String(i + 1)}>{`Sprint ${i + 1}`}</option>
                                  ))}
                                </select>
                                <button type="button" onClick={() => void confirmChildCellEdit(row)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => beginChildCellEdit(row, "sprint")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                {childStoryDrafts[row.id]?.sprint ? `Sprint ${childStoryDrafts[row.id]?.sprint}` : "Not set"}
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">
                            {childEditingCell?.rowId === row.id && childEditingCell.field === "status" ? (
                              <div className="flex items-center gap-1">
                                <select value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-700">
                                  <option value={StoryStatus.todo}>To Do</option>
                                  <option value={StoryStatus.inProgress}>In Progress</option>
                                  <option value={StoryStatus.done}>Done</option>
                                  <option value={StoryStatus.approved}>Approved</option>
                                </select>
                                <button type="button" onClick={() => void confirmChildCellEdit(row)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => beginChildCellEdit(row, "status")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                {childStoryDrafts[row.id]?.status ?? row.status}
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">
                            {childEditingCell?.rowId === row.id && childEditingCell.field === "assignee" ? (
                              <div className="flex items-center gap-1">
                                <input value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-700" placeholder="Unassigned" />
                                <button type="button" onClick={() => void confirmChildCellEdit(row)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => beginChildCellEdit(row, "assignee")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                {(childStoryDrafts[row.id]?.assignee ?? row.assignee)?.trim() || "Unassigned"}
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">
                            {childEditingCell?.rowId === row.id && childEditingCell.field === "priority" ? (
                              <div className="flex items-center gap-1">
                                <select value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-700">
                                  <option value="">Not set</option>
                                  <option value="P0">P0</option>
                                  <option value="P1">P1</option>
                                  <option value="P2">P2</option>
                                  <option value="P3">P3</option>
                                </select>
                                <button type="button" onClick={() => void confirmChildCellEdit(row)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => beginChildCellEdit(row, "priority")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                {childStoryDrafts[row.id]?.priority?.trim() || "Not set"}
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">
                            {childEditingCell?.rowId === row.id && childEditingCell.field === "estimatedDays" ? (
                              <div className="flex items-center gap-1">
                                <input type="number" min={0} value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-[3.5rem] rounded-md border bg-white px-1.5 py-1 text-xs text-slate-700" />
                                <button type="button" onClick={() => void confirmChildCellEdit(row)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => beginChildCellEdit(row, "estimatedDays")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                {childStoryDrafts[row.id]?.estimatedDays || "-"}
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">
                            {childEditingCell?.rowId === row.id && childEditingCell.field === "daysLeft" ? (
                              <div className="flex items-center gap-1">
                                <input type="number" min={0} value={childEditingValue} onChange={(event) => setChildEditingValue(event.target.value)} className="w-[3.5rem] rounded-md border bg-white px-1.5 py-1 text-xs text-slate-700" />
                                <button type="button" onClick={() => void confirmChildCellEdit(row)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="size-3.5" /></button>
                                <button type="button" onClick={() => setChildEditingCell(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-3.5" /></button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => beginChildCellEdit(row, "daysLeft")} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-100">
                                {childStoryDrafts[row.id]?.daysLeft || "-"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
          <div className="relative mx-1.5">
            <div
              className="group absolute inset-y-0 left-1/2 flex w-3 -translate-x-1/2 cursor-col-resize items-stretch justify-center"
              onPointerDown={beginDetailsPanelResize}
              title="Resize details panel"
              aria-label="Resize details panel"
              role="separator"
            >
              <div className="h-full w-px bg-slate-300 transition group-hover:bg-slate-500" />
              <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" />
            </div>
          </div>

          <section className="space-y-2.5 rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-3.5">
            <h3 className="inline-flex w-fit rounded bg-slate-200/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">Details</h3>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
              <p className="text-[12px] font-semibold text-slate-600">Status</p>
              <select value={status} onChange={(event) => setStatus(event.target.value as StoryStatus)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[15px] text-slate-800">
                <option value={StoryStatus.todo}>To Do</option>
                <option value={StoryStatus.inProgress}>In Progress</option>
                <option value={StoryStatus.done}>Done</option>
                <option value={StoryStatus.approved}>Approved</option>
              </select>
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
              <p className="text-[12px] font-semibold text-slate-600">Assignee</p>
              <input value={assignee} onChange={(event) => setAssignee(event.target.value)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[15px] text-slate-800" placeholder="e.g. Avi" />
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
              <p className="text-[12px] font-semibold text-slate-600">Team</p>
              <input value={selectedEpicMeta?.team ?? "Not set"} readOnly className="h-9 w-full rounded-md border border-slate-300 bg-slate-100 px-2.5 text-[15px] text-slate-700" />
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
              <p className="text-[12px] font-semibold text-slate-600">Sprint</p>
              <select value={sprint} onChange={(event) => setSprint(event.target.value)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[15px] text-slate-800">
                <option value="">Not set</option>
                {Array.from({ length: YEAR_SPRINT_MAX }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>{`Sprint ${i + 1}`}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-[5.75rem_minmax(0,1fr)_4.75rem_minmax(0,1fr)] items-center gap-2 pt-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Est Days</p>
              <input
                type="number"
                min={0}
                value={estimatedDays}
                onChange={(event) => setEstimatedDays(event.target.value)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[14px] text-slate-800"
              />
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Est Left</p>
              <input
                type="number"
                min={0}
                value={daysLeft}
                onChange={(event) => setDaysLeft(event.target.value)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[14px] text-slate-800"
              />
            </div>
            <div className="pt-0.5">
              <div className="mb-1 grid grid-cols-3 gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Quarter</p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Month</p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Year</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={quarterDraft}
                  onChange={(event) => setQuarterDraft(event.target.value)}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[14px] text-slate-800"
                >
                  <option value="">Not set</option>
                  <option value="Q1">Q1</option>
                  <option value="Q2">Q2</option>
                  <option value="Q3">Q3</option>
                  <option value="Q4">Q4</option>
                </select>
                <select
                  value={monthDraft}
                  onChange={(event) => setMonthDraft(event.target.value)}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[14px] text-slate-800"
                >
                  <option value="">Not set</option>
                  {MONTHS.map((month) => (
                    <option key={month} value={month}>
                      {month}
                    </option>
                  ))}
                </select>
                <select
                  value={yearDraft}
                  onChange={(event) => setYearDraft(event.target.value)}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[14px] text-slate-800"
                >
                  <option value="">Not set</option>
                  {Array.from({ length: 8 }, (_, idx) => {
                    const year = new Date().getFullYear() - 2 + idx;
                    return (
                      <option key={year} value={String(year)}>
                        {year}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
              <p className="text-[12px] font-semibold text-slate-600">Priority</p>
              <select value={priority} onChange={(event) => setPriority(event.target.value)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[15px] text-slate-800">
                <option value="">Not set</option>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </select>
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-start gap-2">
              <p className="pt-2 text-[12px] font-semibold text-slate-600">Labels</p>
              <div className="space-y-1">
                <div className="flex min-h-9 flex-wrap gap-1.5 rounded-md border border-slate-300 bg-white p-2">
                  {labelsDraft.length === 0 ? <span className="text-xs text-slate-400">No labels yet.</span> : null}
                  {labelsDraft.map((label) => (
                    <span key={label} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      <Tag className="size-3" />
                      {label}
                      <button type="button" onClick={() => removeLabel(label)} className="text-slate-500 hover:text-slate-700">x</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={newLabel}
                    onChange={(event) => setNewLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addLabel(newLabel);
                      }
                    }}
                    list="story-label-suggestions"
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[14px]"
                    placeholder="Add label"
                  />
                  <Button type="button" size="sm" variant="outline" className="h-9 px-3" onClick={() => addLabel(newLabel)}>Add</Button>
                </div>
                <datalist id="story-label-suggestions">
                  {existingLabelSuggestions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
              <p className="text-[12px] font-semibold text-slate-600">Parent</p>
              <select value={epicId} onChange={(event) => setEpicId(event.target.value)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[15px] text-slate-800 disabled:bg-muted/40" disabled={Boolean(lockParentEpicId)}>
                <option value="">Select epic</option>
                {initiatives.map((initiative) => (
                  <optgroup key={initiative.id} label={initiative.title}>
                    {(initiative.epics ?? []).map((epic) => (
                      <option key={epic.id} value={epic.id}>{epic.title}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </section>
          </div>
        </div>

        <div className="mt-3">
          <div
            className="group relative mb-1 flex h-3 cursor-row-resize items-center justify-center"
            onPointerDown={beginActivityPanelResize}
            title="Resize activity panel height"
            aria-label="Resize activity panel height"
            role="separator"
          >
            <div className="h-px w-full bg-slate-300 transition group-hover:bg-slate-500" />
            <div className="absolute left-0 top-1/2 h-3 w-full -translate-y-1/2" />
          </div>
          <section
            className="flex min-h-0 flex-col space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
            style={{ height: `${activityPanelHeightPx}px` }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">Activity</h3>
              <div className="inline-flex rounded-lg bg-white p-1 ring-1 ring-slate-200">
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-sm font-medium transition ${
                    activityTab === "comments"
                      ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                  onClick={() => setActivityTab("comments")}
                >
                  <MessageSquare className="mr-1 inline size-3.5" />
                  Comments
                </button>
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-sm font-medium transition ${
                    activityTab === "history"
                      ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                  onClick={() => setActivityTab("history")}
                >
                  <History className="mr-1 inline size-3.5" />
                  History
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
            {isCreateMode ? (
              <p className="text-sm text-slate-500">Create the story first to add comments and history.</p>
            ) : activityTab === "comments" ? (
              <>
                <div className="space-y-2">
                  {story.comments.length === 0 ? (
                    <p className="text-sm text-slate-500">No comments yet.</p>
                  ) : (
                    story.comments.map((comment) => (
                      <div key={comment.id} className="rounded-md bg-white p-2 text-sm ring-1 ring-slate-200">
                        <p className="text-[12px] text-slate-500">
                          {comment.author ?? "Team"} - {new Date(comment.createdAt).toLocaleString()}
                        </p>
                        <p className="mt-1 text-slate-800">{comment.body}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                    placeholder="Write a comment..."
                  />
                  <Button size="sm" variant="outline" onClick={handleCommentAdd} disabled={commenting}>
                    <Plus />
                    Add
                  </Button>
                </div>
              </>
            ) : (
                <div className="space-y-2">
                {story.history.length === 0 ? (
                  <p className="text-sm text-slate-500">No history yet.</p>
                ) : (
                  story.history.map((entry) => (
                    <div key={entry.id} className="rounded-md bg-white p-2 text-sm ring-1 ring-slate-200">
                      <p className="text-slate-800">{entry.entry}</p>
                      <p className="mt-1 text-[12px] text-slate-500">
                        {new Date(entry.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
            </div>
          </section>
        </div>
        </div>
        {nestedStoryId != null ? (
          <StoryDetailsDialog
            open
            story={nestedStory}
            initiatives={initiatives}
            lockParentEpicId={null}
            onClose={() => setNestedStoryId(null)}
            onExitComplete={() => setNestedStoryId(null)}
            onCreate={onCreate}
            onSave={onSave}
            onDelete={onDelete}
            onAddComment={onAddComment}
            onOpenInitiative={onOpenInitiative}
            onOpenEpic={onOpenEpic}
            onOpenStory={(storyId) => setNestedStoryId(storyId)}
            storyRef={nestedStoryId}
            surfaceAnchorRef={surfaceAnchorRef}
          />
        ) : null}
      </div>
    </div>
  );
}
