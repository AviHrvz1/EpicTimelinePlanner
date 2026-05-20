"use client";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Activity as ActivityIcon,
  Bot,
  Bold,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Heading2,
  Heading3,
  History,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Map as MapIcon,
  MessageSquare,
  PlayCircle,
  Quote,
  Tag,
  Trash,
  Type,
  Underline as UnderlineIcon,
  UserRound,
  X,
} from "lucide-react";
import { StoryStatus } from "@/lib/generated/prisma";

import { ActivityCommentComposer } from "@/components/ui/activity-comment-composer";
import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { TeamIdCombobox, blurActiveField } from "@/components/ui/team-id-combobox";
import { Button } from "@/components/ui/button";
import { RichCommentBody } from "@/components/ui/rich-comment-body";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { EpicPlanBarIcon, InitiativePlanBarIcon } from "@/components/timeline/epic-plan-bar";
import { collectAssigneeNameSuggestions } from "@/lib/delivery-assignees";
import { MONTH_TEAM_IDS } from "@/lib/month-team-board";
import { type SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { normalizeWorkspaceUserTeam } from "@/lib/workspace-users";
import { InitiativeItem, UserStoryItem, type RoadmapItem } from "@/lib/types";
import { useDialogPresence } from "@/lib/use-dialog-presence";
import {
  isUsablePlanningSurfaceRect,
  planningDetailPanelAnchorStyle,
  usePlanningSurfaceRect,
} from "@/lib/use-planning-surface-rect";
import { cn } from "@/lib/utils";
import { sprintEndDate, YEAR_SPRINT_MAX } from "@/lib/year-sprint";

function isSystemHistoryEntry(entry: string): boolean {
  return entry.toLowerCase().startsWith("system auto-move:");
}

const STORY_DETAILS_INFO_TOOLTIP_CLASS =
  "pointer-events-none absolute left-1/2 top-0 z-[320] w-48 max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-normal rounded-lg border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/40 px-2.5 py-1.5 text-[12px] font-medium leading-snug text-slate-700 opacity-0 shadow-md ring-1 ring-indigo-100/70 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100";

type StoryWithEpic = UserStoryItem & { epicTitle: string };

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
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  /** Styled confirm (matches planner overlay); falls back to `window.confirm` when omitted. */
  onRequestConfirm?: (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void | Promise<void>;
  }) => void;
  onAddComment: (storyId: string, body: string) => Promise<void>;
  /** Updates the parent epic’s delivery team (saved with the story). */
  onPatchEpicTeam?: (epicId: string, team: string | null) => Promise<void>;
  onOpenInitiative?: (initiativeId: string) => void;
  onOpenEpic?: (epicId: string) => void;
  onOpenStory?: (storyId: string) => void;
  storyRef?: string;
  /** Called after exit animation; use to clear selection in parent without remounting mid-close. */
  onExitComplete?: () => void;
  /** When set, the panel matches this element (e.g. right timeline column). */
  surfaceAnchorRef?: RefObject<HTMLElement | null>;
  roadmaps?: RoadmapItem[];
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
  onRequestConfirm,
  onAddComment,
  onPatchEpicTeam,
  onOpenInitiative,
  onOpenEpic,
  onOpenStory,
  storyRef: _storyRef,
  surfaceAnchorRef,
  roadmaps = [],
  workspaceDirectoryUsers = [],
}: StoryDetailsDialogProps) {
  const statusMeta: Record<StoryStatus, { Icon: typeof ListTodo }> = {
    [StoryStatus.todo]: { Icon: ListTodo },
    [StoryStatus.inProgress]: { Icon: PlayCircle },
    [StoryStatus.done]: { Icon: CheckCheck },
    [StoryStatus.approved]: { Icon: CheckCircle2 },
  };
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("📄");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [labelsDraft, setLabelsDraft] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [labelsAutocompleteOpen, setLabelsAutocompleteOpen] = useState(false);
  const [labelsAutocompleteIndex, setLabelsAutocompleteIndex] = useState(-1);
  const sprintPlanningYear = useMemo(
    () => initiatives[0]?.year ?? new Date().getFullYear(),
    [initiatives],
  );
  const assignableSprints = useMemo(
    () =>
      Array.from({ length: YEAR_SPRINT_MAX }, (_, i) => i + 1).filter(
        (n) => sprintEndDate(sprintPlanningYear, n).getTime() > Date.now(),
      ),
    [sprintPlanningYear],
  );
  const [priority, setPriority] = useState("");
  const [sprint, setSprint] = useState("");
  const [status, setStatus] = useState<StoryStatus>(StoryStatus.todo);
  const [estimatedDays, setEstimatedDays] = useState("");
  const [daysLeft, setDaysLeft] = useState("");
  const [epicId, setEpicId] = useState("");
  const [epicTeamDraft, setEpicTeamDraft] = useState("");
  const allAssigneeNameSuggestions = useMemo(() => {
    if (workspaceDirectoryUsers.length > 0) {
      // Use full names from directory; supplement with any existing story assignees not in the directory
      const set = new Set(workspaceDirectoryUsers.map((u) => u.name.trim()).filter(Boolean));
      for (const init of initiatives) {
        for (const epic of init.epics ?? []) {
          for (const story of epic.userStories ?? []) {
            if (story.assignee?.trim()) set.add(story.assignee.trim());
          }
          if (epic.assignee?.trim()) set.add(epic.assignee.trim());
        }
        if (init.assignee?.trim()) set.add(init.assignee.trim());
      }
      return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    }
    return collectAssigneeNameSuggestions(initiatives);
  }, [initiatives, workspaceDirectoryUsers]);
  const assigneeNameSuggestions = useMemo(() => {
    const teamId = epicTeamDraft.trim();
    if (!teamId || workspaceDirectoryUsers.length === 0) return allAssigneeNameSuggestions;
    const teamMembers = workspaceDirectoryUsers
      .filter((u) => normalizeWorkspaceUserTeam(u.team) === teamId)
      .map((u) => u.name.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return teamMembers.length > 0 ? teamMembers : allAssigneeNameSuggestions;
  }, [allAssigneeNameSuggestions, epicTeamDraft, workspaceDirectoryUsers]);
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [dialogWidthVw, setDialogWidthVw] = useState(60);
  const [activityOpen, setActivityOpen] = useState(true);
  const [detailsPanelWidthPx, setDetailsPanelWidthPx] = useState(264);
  const [activityPanelHeightPx, setActivityPanelHeightPx] = useState(560);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const [isDraggingDialog, setIsDraggingDialog] = useState(false);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);
  const dialogShellRef = useRef<HTMLDivElement | null>(null);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const descriptionEditor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-blue-600 underline decoration-blue-600/40 underline-offset-2",
        },
      }),
      Placeholder.configure({
        placeholder: "Description",
      }),
    ],
    content: description?.trim() ? description : "<p></p>",
    onUpdate: ({ editor }) => {
      setDescription(editor.getHTML());
    },
    immediatelyRender: false,
  });

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
  const selectedBreadcrumbMeta = useMemo(() => {
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (epic.id !== epicId) continue;
        return { initiative, epic };
      }
    }
    return null;
  }, [initiatives, epicId]);
  const parentSelectTooltipText = useMemo(() => {
    if (!selectedBreadcrumbMeta) return "";
    return `${selectedBreadcrumbMeta.initiative.title} › ${selectedBreadcrumbMeta.epic.title}`;
  }, [selectedBreadcrumbMeta]);

  const parentSelectWrapRef = useRef<HTMLSpanElement | null>(null);
  const [isParentSelectTruncated, setIsParentSelectTruncated] = useState(false);

  useLayoutEffect(() => {
    const wrap = parentSelectWrapRef.current;
    const select = wrap?.querySelector("select");
    if (!select || !epicId || !parentSelectTooltipText) {
      setIsParentSelectTruncated(false);
      return;
    }
    const selectedText = select.selectedOptions[0]?.text?.trim() ?? "";
    if (!selectedText) {
      setIsParentSelectTruncated(false);
      return;
    }

    const measure = () => {
      const text = select.selectedOptions[0]?.text?.trim() ?? "";
      if (!text) {
        setIsParentSelectTruncated(false);
        return;
      }
      if (select.scrollWidth > select.clientWidth + 1) {
        setIsParentSelectTruncated(true);
        return;
      }
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) {
        setIsParentSelectTruncated(text.length > 36);
        return;
      }
      const cs = window.getComputedStyle(select);
      ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
      const textW = ctx.measureText(text).width;
      const padFudge = 36;
      setIsParentSelectTruncated(textW > select.clientWidth - padFudge);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(select);
    return () => ro.disconnect();
  }, [epicId, parentSelectTooltipText, open, detailsPanelWidthPx]);
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
  const filteredLabelSuggestions = useMemo(() => {
    const q = newLabel.trim().toLowerCase();
    if (!q) return [];
    return existingLabelSuggestions
      .filter((item) => item.toLowerCase().includes(q) && !labelsDraft.includes(item))
      .slice(0, 8);
  }, [existingLabelSuggestions, labelsDraft, newLabel]);

  useEffect(() => {
    setLabelsAutocompleteIndex(-1);
  }, [newLabel, labelsDraft, filteredLabelSuggestions.length]);

  useEffect(() => {
    if (!epicId) {
      setEpicTeamDraft("");
      return;
    }
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (epic.id !== epicId) continue;
        setEpicTeamDraft(epic.team && MONTH_TEAM_IDS.includes(epic.team) ? epic.team : "");
        return;
      }
    }
    setEpicTeamDraft("");
  }, [epicId, initiatives]);
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
      setSprint("");
      setStatus(StoryStatus.todo);
      setEstimatedDays("");
      setDaysLeft("");
      setEpicId(lockParentEpicId ?? firstEpicId);
    }
    setActivityTab("comments");
  }, [story, initiatives, lockParentEpicId, firstEpicId]);

  useEffect(() => {
    if (open) {
      setDialogWidthVw(60);
      setActivityOpen(true);
      setDetailsPanelWidthPx(340);
      setActivityPanelHeightPx(560);
      setDialogOffset({ x: 0, y: 0 });
      setIsDraggingDialog(false);
      dragStartRef.current = null;
    }
  }, [open]);
  useEffect(() => {
    if (!descriptionEditor) return;
    const next = description?.trim() ? description : "<p></p>";
    if (descriptionEditor.getHTML() !== next) {
      descriptionEditor.commands.setContent(next, { emitUpdate: false });
    }
  }, [descriptionEditor, story?.id, open]);

  const { visible, leaving } = useDialogPresence(open, onExitComplete);
  const surfaceRect = usePlanningSurfaceRect(surfaceAnchorRef, visible);
  const anchored = false;
  const isCreateMode = !story;

  function requestDeleteConfirmation() {
    if (isCreateMode || !story || !onDelete) return;
    const storyTitle = story.title?.trim() || "Untitled story";
    const usRef = displayIds.byStoryId.get(story.id);
    const runDelete = async () => {
      await onDelete(story.id);
      onClose();
    };
    if (onRequestConfirm) {
      onRequestConfirm({
        title: "Delete user story?",
        message: usRef
          ? `${usRef} · ${storyTitle} will be permanently deleted. This cannot be undone.`
          : `“${storyTitle}” will be permanently deleted. This cannot be undone.`,
        confirmLabel: "Delete",
        onConfirm: runDelete,
      });
      return;
    }
    void (async () => {
      if (!window.confirm("Delete this user story?")) return;
      await runDelete();
    })();
  }

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
    blurActiveField();
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    const payload = buildStoryPayload();
    if (!payload) return;
    setSaving(true);
    try {
      if (onPatchEpicTeam) {
        let prevTeam: string | null = null;
        outer: for (const initiative of initiatives) {
          for (const epic of initiative.epics ?? []) {
            if (epic.id !== payload.epicId) continue;
            prevTeam = epic.team && MONTH_TEAM_IDS.includes(epic.team) ? epic.team : null;
            break outer;
          }
        }
        const t = epicTeamDraft.trim();
        const nextTeam = t && MONTH_TEAM_IDS.includes(t) ? t : null;
        if (prevTeam !== nextTeam) {
          await onPatchEpicTeam(payload.epicId, nextTeam);
        }
      }
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

  async function handleCommentAdd(html: string) {
    setCommenting(true);
    try {
      if (!story) return;
      await onAddComment(story.id, html);
    } finally {
      setCommenting(false);
    }
  }

  if (!visible) return null;

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
      setActivityPanelHeightPx(Math.max(180, Math.min(720, next)));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function beginDialogWidthResize(event: React.PointerEvent<HTMLDivElement>) {
    if (anchored || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const fallbackWidth = (window.innerWidth * dialogWidthVw) / 100;
    const startWidth = dialogShellRef.current?.getBoundingClientRect().width ?? fallbackWidth;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      const nextWidth = startWidth - delta;
      const minWidth = Math.min(900, window.innerWidth * 0.55);
      const maxWidth = Math.min(window.innerWidth - 12, 1700);
      const bounded = Math.max(minWidth, Math.min(maxWidth, nextWidth));
      setDialogWidthVw((bounded / window.innerWidth) * 100);
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function beginDialogWidthResizeRight(event: React.PointerEvent<HTMLDivElement>) {
    if (anchored || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const fallbackWidth = (window.innerWidth * dialogWidthVw) / 100;
    const startWidth = dialogShellRef.current?.getBoundingClientRect().width ?? fallbackWidth;
    const startOffsetX = dialogOffset.x;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      const nextWidth = startWidth + delta;
      const minWidth = Math.min(900, window.innerWidth * 0.55);
      const maxWidth = Math.min(window.innerWidth - 12, 1700);
      const bounded = Math.max(minWidth, Math.min(maxWidth, nextWidth));
      setDialogWidthVw((bounded / window.innerWidth) * 100);
      const widthDelta = bounded - startWidth;
      setDialogOffset((prev) => ({ ...prev, x: startOffsetX + widthDelta }));
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
        "fixed inset-0 z-[80] bg-slate-900/30 backdrop-blur-[1px]",
        !anchored && "flex items-stretch justify-end p-0",
        !leaving && "epic-dialog-backdrop",
        leaving && "epic-dialog-backdrop--exit",
        leaving && "pointer-events-none",
      )}
    >
      <div
        ref={dialogShellRef}
        className={cn(
          !leaving ? "epic-dialog-panel-entrance" : "epic-dialog-panel--exit",
          anchored
            ? "fixed flex flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xl ring-1 ring-black/[0.06]"
            : "relative h-full shrink-0",
        )}
        style={
          anchored
            ? surfaceRect
              ? planningDetailPanelAnchorStyle(surfaceRect)
              : undefined
            : { width: `${dialogWidthVw}vw`, maxWidth: "99.5vw" }
        }
      >
        <div
          className={cn(
            "relative flex h-full min-h-0 w-full flex-col p-5",
            anchored
              ? "h-full min-h-0 flex-1 shadow-none ring-0"
              : "h-full min-h-0 rounded-none border-0 bg-white shadow-none",
            isDraggingDialog && "select-none",
          )}
          style={{ transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)` }}
        >
          {!anchored ? (
            <div
              className="absolute inset-y-0 left-0 z-20 w-2.5 cursor-col-resize bg-transparent hover:bg-indigo-200/40"
              onPointerDown={beginDialogWidthResize}
              aria-label="Resize user story panel width"
              role="separator"
            />
          ) : null}
          {!anchored ? (
            <div
              className="absolute inset-y-0 right-0 z-20 w-2.5 cursor-col-resize bg-transparent hover:bg-indigo-200/40"
              onPointerDown={beginDialogWidthResizeRight}
              aria-label="Resize user story panel width from right"
              role="separator"
            />
          ) : null}
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
            <span
              className="inline-flex min-w-0 items-center gap-1 truncate rounded px-1 py-0.5 text-slate-800"
              title={(story?.title ?? title) || "User story"}
            >
              {story ? (displayIds.byStoryId.get(story.id) ?? "User Story") : "User Story"}
            </span>
            <ChevronRight className="size-4 shrink-0 text-slate-400" />
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-base font-medium text-slate-900">
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                <UserStoryIcon />
              </span>
              <span className="truncate">{title || (isCreateMode ? "Create User Story" : "Untitled")}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isCreateMode ? (
              <>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => requestDeleteConfirmation()}
                  aria-label="Delete story"
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="inline-flex h-9 items-center gap-2 rounded-md px-4 text-[13px] font-semibold [&_svg]:text-slate-500"
                  onClick={onClose}
                >
                  <X className="size-4" />
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="inline-flex h-9 items-center gap-2 rounded-md border-0 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-[13px] font-semibold text-white hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 [&_svg]:text-white"
                  onClick={handleSave}
                  disabled={saving}
                >
                  <Check className="size-4" />
                  {saving ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="inline-flex h-9 items-center gap-2 rounded-md px-4 text-[13px] font-semibold [&_svg]:text-slate-500"
                  onClick={onClose}
                >
                  <X className="size-4" />
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="inline-flex h-9 items-center gap-2 rounded-md border-0 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-[13px] font-semibold text-white hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 [&_svg]:text-white"
                  onClick={handleSave}
                  disabled={saving}
                >
                  <Check className="size-4" />
                  {saving ? "Creating..." : "Create"}
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 max-h-[580px] flex-1 overflow-hidden">
            <div
              ref={splitLayoutRef}
              className="grid h-full min-h-0 items-stretch gap-0"
              style={{ gridTemplateColumns: `minmax(0,1fr) 10px ${detailsPanelWidthPx}px` }}
            >
          <section className="flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-xl border-0 bg-white pt-3 pb-0 pl-[5px] pr-[10px]">
            <label className="block shrink-0 space-y-1">
              <p className="flex shrink-0 items-center gap-2 text-lg font-semibold text-slate-800 transition-colors hover:text-indigo-600">
                <Type className="size-5 shrink-0 text-slate-500" aria-hidden />
                Title
              </p>
              <div className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 shadow-sm focus-within:ring-2 focus-within:ring-slate-300/70">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full bg-transparent px-3 py-2 text-base outline-none"
                />
              </div>
            </label>
            <label className="mt-5 flex min-h-0 flex-1 flex-col gap-1">
              <p className="flex shrink-0 items-center gap-2 text-lg font-semibold text-slate-800">
                <FileText className="size-5 shrink-0 text-slate-500" aria-hidden />
                Description
              </p>
                <div className="flex flex-col gap-2 rounded-xl bg-white p-3 shadow-[0_2px_8px_-2px_rgba(15,23,42,0.12)] ring-1 ring-slate-200 transition-all hover:ring-indigo-300 hover:shadow-[0_2px_12px_-2px_rgba(99,102,241,0.18)]">
                <div className="flex shrink-0 flex-wrap gap-1 rounded-md bg-[#0897d5] p-1">
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleBold().run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
                      descriptionEditor?.isActive("bold") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
                    )}
                  >
                    <Bold className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleHeading({ level: 2 }).run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
                      descriptionEditor?.isActive("heading", { level: 2 }) ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
                    )}
                  >
                    <Heading2 className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleHeading({ level: 3 }).run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
                      descriptionEditor?.isActive("heading", { level: 3 }) ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
                    )}
                  >
                    <Heading3 className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      const prev = (descriptionEditor?.getAttributes("link").href as string | undefined) ?? "";
                      const url = window.prompt("Link URL", prev || "https://");
                      if (!descriptionEditor || url == null) return;
                      const trimmed = url.trim();
                      if (!trimmed) {
                        descriptionEditor.chain().focus().extendMarkRange("link").unsetLink().run();
                        return;
                      }
                      descriptionEditor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
                    }}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
                      descriptionEditor?.isActive("link") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
                    )}
                  >
                    <LinkIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleItalic().run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
                      descriptionEditor?.isActive("italic") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
                    )}
                  >
                    <Italic className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleUnderline().run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
                      descriptionEditor?.isActive("underline") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
                    )}
                  >
                    <UnderlineIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleBulletList().run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
                      descriptionEditor?.isActive("bulletList") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
                    )}
                  >
                    <List className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleOrderedList().run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
                      descriptionEditor?.isActive("orderedList") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
                    )}
                  >
                    <ListOrdered className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => descriptionEditor?.chain().focus().toggleBlockquote().run()}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
                      descriptionEditor?.isActive("blockquote") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
                    )}
                  >
                    <Quote className="size-3.5" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto rounded-md px-1 py-2">
                  <EditorContent
                    editor={descriptionEditor}
                    className="focus:outline-none [&_.ProseMirror]:min-h-[calc(17.5rem+16px)] [&_.ProseMirror]:outline-none"
                  />
                </div>
                </div>
            </label>
          </section>
          <div className="relative mx-1.5">
            <div
              className="group absolute inset-y-0 left-1/2 flex w-3 -translate-x-[calc(50%+2px)] cursor-col-resize items-stretch justify-center"
              onPointerDown={beginDetailsPanelResize}
              title="Resize details panel"
              aria-label="Resize details panel"
              role="separator"
            >
              <div className="self-start h-[calc(80%+60px)] w-px bg-slate-300 transition group-hover:bg-slate-500" />
              <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-[calc(50%+2px)]" />
            </div>
          </div>

          <section className="relative z-20 h-full min-h-0 space-y-5 overflow-y-auto rounded-xl bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
            <h3 className="flex items-center gap-2 text-lg font-semibold leading-snug tracking-tight text-slate-800">
              <ClipboardList className="size-5 shrink-0 text-slate-500" aria-hidden />
              Details
            </h3>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-[15px] font-normal text-slate-700">Status</p>
              <div className="flex h-7 items-center gap-1.5 rounded-md border border-blue-300/80 bg-blue-50/35 px-2 shadow-sm transition-colors hover:border-blue-400">
                {(() => {
                  const Icon = statusMeta[status].Icon;
                  return <Icon className="size-3.5 shrink-0 text-slate-600" />;
                })()}
                <select value={status} onChange={(event) => setStatus(event.target.value as StoryStatus)} className="h-7 w-full bg-transparent text-[14px] font-medium text-slate-800 outline-none">
                  <option value={StoryStatus.todo}>To Do</option>
                  <option value={StoryStatus.inProgress}>In Progress</option>
                  <option value={StoryStatus.done}>Done</option>
                  <option value={StoryStatus.approved}>Approved</option>
                </select>
              </div>
            </label>
            {(() => {
              const parentEpic = initiatives.flatMap((i) => i.epics ?? []).find((e) => e.id === epicId);
              const parentInit = initiatives.find((i) => i.id === parentEpic?.initiativeId);
              const roadmap = roadmaps.find((r) => r.id === parentInit?.roadmapId);
              if (!roadmap) return null;
              return (
                <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
                  <p className="text-[15px] font-normal text-slate-700">Roadmap</p>
                  <span className="inline-flex h-7 max-w-[16rem] items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-[13px] font-medium text-blue-800 select-none">
                    <MapIcon className="size-3.5 shrink-0 text-blue-500" aria-hidden />
                    <span className="truncate">{roadmap.name}</span>
                  </span>
                </div>
              );
            })()}
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-[15px] font-normal text-slate-700">Assignee</p>
              <div className="group/assignee relative flex min-w-0 w-full items-center">
                <UserRound className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <AssigneeCombobox
                  value={assignee}
                  onChange={(name) => {
                    setAssignee(name);
                    if (name.trim() && workspaceDirectoryUsers.length > 0) {
                      const nameLower = name.trim().toLowerCase();
                      const match = workspaceDirectoryUsers.find((u) => u.name.trim().toLowerCase() === nameLower);
                      if (match) {
                        const teamId = normalizeWorkspaceUserTeam(match.team);
                        if (teamId) setEpicTeamDraft(teamId);
                      }
                    }
                  }}
                  suggestions={assigneeNameSuggestions}
                  placeholder="Type or pick a name"
                  className={cn("h-7 w-full rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 shadow-sm pl-7 text-[14px] text-slate-800", assignee ? "pr-6" : "pr-1.5")}
                />
                {assignee ? (
                  <button
                    type="button"
                    onClick={() => setAssignee("")}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:text-slate-600 group-hover/assignee:opacity-100"
                    aria-label="Clear assignee"
                    tabIndex={-1}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-[15px] font-normal text-slate-700">Team</p>
              <div className="group/team relative flex min-w-0 w-full items-center">
                <TeamIdCombobox
                  teamId={epicTeamDraft}
                  onTeamIdChange={setEpicTeamDraft}
                  disabled={!epicId}
                  placeholder="Type or pick a team"
                  className="h-7 w-full rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 px-1.5 text-[14px] text-slate-800 shadow-sm disabled:bg-muted/40"
                />
                {epicTeamDraft && !(!epicId) ? (
                  <button
                    type="button"
                    aria-label="Clear team"
                    onClick={() => setEpicTeamDraft("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 flex size-4 items-center justify-center rounded-full text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 group-hover/team:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-[15px] font-normal text-slate-700">Sprint</p>
              <select value={sprint} onChange={(event) => setSprint(event.target.value)} className="h-7 w-full rounded-md border border-blue-300/80 bg-blue-50/35 px-1.5 text-[14px] font-medium text-slate-800">
                <option value="">Not set</option>
                {assignableSprints.map((n) => (
                  <option key={n} value={String(n)}>{`Sprint ${n}`}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3 pt-0.5">
              <p className="text-[15px] font-normal text-slate-700">Est. Days</p>
              <input
                type="number"
                min={0}
                value={estimatedDays}
                onChange={(event) => setEstimatedDays(event.target.value)}
                className="h-7 w-full rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 px-1.5 text-[14px] text-slate-800 shadow-sm"
              />
            </div>
            <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-[15px] font-normal text-slate-700">Est. Days left</p>
              <input
                type="number"
                min={0}
                value={daysLeft}
                onChange={(event) => setDaysLeft(event.target.value)}
                className="h-7 w-full rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 px-1.5 text-[14px] text-slate-800 shadow-sm"
              />
            </div>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-[15px] font-normal text-slate-700">Priority</p>
              <select value={priority} onChange={(event) => setPriority(event.target.value)} className="h-7 w-full rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 px-1.5 text-[14px] text-slate-800 shadow-sm">
                <option value="">Not set</option>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </select>
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-[15px] font-normal text-slate-700">Parent</p>
              <span ref={parentSelectWrapRef} className="group relative min-w-0">
                <select
                  value={epicId}
                  title=""
                  onChange={(event) => setEpicId(event.target.value)}
                  className="h-7 w-full min-w-0 max-w-full truncate rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 shadow-sm px-1.5 text-[14px] text-slate-800 disabled:bg-muted/40"
                  disabled={Boolean(lockParentEpicId)}
                >
                  <option value="">Select epic</option>
                  {initiatives.map((initiative) => (
                    <optgroup key={initiative.id} label={initiative.title}>
                      {(initiative.epics ?? []).map((epic) => (
                        <option key={epic.id} value={epic.id}>
                          {epic.title}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {isParentSelectTruncated && parentSelectTooltipText ? (
                  <span
                    role="tooltip"
                    className={cn(
                      STORY_DETAILS_INFO_TOOLTIP_CLASS,
                      "w-max max-w-[min(22rem,calc(100vw-3rem))]",
                    )}
                  >
                    {parentSelectTooltipText}
                  </span>
                ) : null}
              </span>
            </label>
            <label className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-3">
              <p className="text-[15px] font-normal text-slate-700">Labels</p>
              <div className="relative z-30">
                <div className="flex min-h-6 flex-wrap items-center gap-1 rounded-md border border-slate-300 bg-white transition-colors hover:border-slate-400 px-1.5 py-0.5 shadow-sm">
                  <Tag className="size-3 shrink-0 text-slate-400" aria-hidden />
                  {labelsDraft.map((label) => (
                    <span key={label} className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-700">
                      <Tag className="size-2.5" />
                      {label}
                      <button type="button" onClick={() => removeLabel(label)} className="text-slate-500 hover:text-slate-700">x</button>
                    </span>
                  ))}
                  <input
                    value={newLabel}
                    onChange={(event) => setNewLabel(event.target.value)}
                    onFocus={() => setLabelsAutocompleteOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => {
                        setLabelsAutocompleteOpen(false);
                        setLabelsAutocompleteIndex(-1);
                      }, 120);
                    }}
                    onKeyDown={(event) => {
                      const list = filteredLabelSuggestions;
                      if (event.key === "ArrowDown" && list.length > 0) {
                        event.preventDefault();
                        setLabelsAutocompleteIndex((i) => (i + 1) % list.length);
                        return;
                      }
                      if (event.key === "ArrowUp" && list.length > 0) {
                        event.preventDefault();
                        setLabelsAutocompleteIndex((i) => (i <= 0 ? list.length - 1 : i - 1));
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setLabelsAutocompleteOpen(false);
                        setLabelsAutocompleteIndex(-1);
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const pick = labelsAutocompleteIndex >= 0 ? list[labelsAutocompleteIndex] : null;
                        if (pick) addLabel(pick);
                        else addLabel(newLabel);
                        setLabelsAutocompleteIndex(-1);
                      }
                    }}
                    autoComplete="off"
                    className="h-6 min-w-[8rem] flex-1 bg-transparent px-1 text-[12px] outline-none placeholder:text-slate-400"
                    placeholder="Type to search labels..."
                  />
                  {newLabel.trim().length > 0 ? (
                    <>
                      <button
                        type="button"
                        aria-label="Add label"
                        title="Add label"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          addLabel(newLabel);
                        }}
                        className="inline-flex size-4 shrink-0 items-center justify-center rounded text-emerald-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
                      >
                        <Check className="size-3" strokeWidth={2.5} aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label="Clear input"
                        title="Clear"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setNewLabel("");
                        }}
                        className="inline-flex size-4 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      >
                        <X className="size-3" strokeWidth={2.5} aria-hidden />
                      </button>
                    </>
                  ) : null}
                </div>
                {labelsAutocompleteOpen && filteredLabelSuggestions.length > 0 ? (
                  <ul
                    className="absolute left-0 right-0 top-full z-[200] mt-1 max-h-44 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
                    role="listbox"
                  >
                    {filteredLabelSuggestions.map((item, i) => (
                      <li key={item} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={i === labelsAutocompleteIndex}
                          className={cn(
                            "flex w-full px-3 py-2 text-left text-[14px] text-slate-800 hover:bg-slate-50",
                            i === labelsAutocompleteIndex && "bg-indigo-50 text-indigo-900",
                          )}
                          onMouseEnter={() => setLabelsAutocompleteIndex(i)}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            addLabel(item);
                          }}
                        >
                          {item}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </label>
          </section>
            </div>
            </div>

        <div className="relative z-0 -mt-2 shrink-0">
          <section
            className={cn(
              "ml-[5px] mr-0 mb-0 flex min-h-0 flex-col rounded-xl bg-white ring-1 ring-slate-200 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_2px_4px_rgba(15,23,42,0.08)] transition-all hover:ring-indigo-300 hover:shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_2px_8px_rgba(99,102,241,0.18)]",
              activityOpen ? "space-y-3 p-3" : "p-3",
            )}
            style={activityOpen ? { height: `${activityPanelHeightPx}px` } : undefined}
          >
            <div className="flex w-full items-center justify-between gap-2 rounded-lg">
              <button
                type="button"
                className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-slate-400"
                onClick={() => setActivityOpen((open) => !open)}
                aria-expanded={activityOpen}
              >
                <span className="flex items-center gap-2 text-lg font-semibold text-slate-800 transition-colors group-hover:text-indigo-600">
                  <ChevronDown
                    className={cn("size-5 shrink-0 text-slate-500 transition-transform", !activityOpen && "-rotate-90")}
                    aria-hidden
                  />
                  <ActivityIcon className="size-5 shrink-0 text-slate-500" aria-hidden />
                  Activity
                </span>
              </button>
              {activityOpen ? (
                <div
                  className="inline-flex shrink-0 rounded-lg bg-white p-1 ring-1 ring-slate-200"
                  role="tablist"
                  aria-label="Activity view"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activityTab === "comments"}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm font-medium transition",
                      activityTab === "comments"
                        ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200"
                        : "text-slate-600 hover:bg-slate-100",
                    )}
                    onClick={() => setActivityTab("comments")}
                  >
                    <MessageSquare className="mr-1 inline size-3.5" />
                    Comments
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activityTab === "history"}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm font-medium transition",
                      activityTab === "history"
                        ? "bg-sky-100 text-sky-800 ring-1 ring-sky-200"
                        : "text-slate-600 hover:bg-slate-100",
                    )}
                    onClick={() => setActivityTab("history")}
                  >
                    <History className="mr-1 inline size-3.5" />
                    History
                  </button>
                </div>
              ) : null}
            </div>

            {activityOpen ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                {isCreateMode ? (
                  <p className="text-sm text-slate-500">Create the story first to add comments and history.</p>
                ) : activityTab === "comments" ? (
                  <>
                    <div className="min-h-0 max-h-[40%] shrink space-y-2 overflow-y-auto">
                      {story.comments.length === 0 ? (
                        <p className="text-sm text-slate-500">No comments yet.</p>
                      ) : (
                        story.comments.map((comment) => (
                          <div
                            key={comment.id}
                            className="rounded-md bg-white p-2 text-sm ring-1 ring-slate-200"
                          >
                            <p className="text-[12px] text-slate-500">
                              {comment.author ?? "Team"} - {new Date(comment.createdAt).toLocaleString()}
                            </p>
                            <RichCommentBody body={comment.body} className="mt-1" />
                          </div>
                        ))
                      )}
                    </div>
                    <ActivityCommentComposer
                      key={`${open}-${story.id}-comment`}
                      onSubmit={(html) => handleCommentAdd(html)}
                      disabled={commenting}
                    />
                  </>
                ) : (
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                    {story.history.length === 0 ? (
                      <p className="text-sm text-slate-500">No history yet.</p>
                    ) : (
                      story.history.map((entry) => (
                        <div key={entry.id} className="rounded-md bg-white p-2 text-sm ring-1 ring-slate-200">
                          <p className="inline-flex items-center gap-1.5 text-slate-800">
                            {isSystemHistoryEntry(entry.entry) ? (
                              <span className="inline-flex items-center rounded-md bg-sky-50 px-1 py-0.5 text-sky-700 ring-1 ring-sky-200">
                                <Bot className="size-3.5" aria-hidden />
                              </span>
                            ) : null}
                            <span>{entry.entry}</span>
                          </p>
                          <p className="mt-1 text-[12px] text-slate-500">
                            {new Date(entry.createdAt).toLocaleString()}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>
        </div>
      </div>
    </div>
    </div>
  );
}
