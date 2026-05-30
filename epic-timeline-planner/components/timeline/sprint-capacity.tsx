"use client";

import type { LucideIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Check, Flag, GripVertical, Info, Maximize2, Minimize2, Pin, PinOff, Search, User, UserRound, Users, UserX, X } from "lucide-react";
import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { capacityGaugeFluidStops } from "@/lib/capacity-thermometer";
import { collectStoriesForSprintBoard } from "@/lib/sprint-plan";
import { InitiativeItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatAssigneeShortLabel } from "@/lib/assignee-display";
import { currentWorkYearSprintForPlan, sprintEndDate } from "@/lib/year-sprint";
import {
  CAPACITY_DAYS_INPUT_NO_SPIN,
  CAPACITY_ROLLUP_INFO_TOOLTIP_CLASS,
  RollupOverCapWarn,
  rollupNeutralPill,
  rollupOverCapacityPill,
} from "@/components/timeline/team-capacity-bucket";
import { UserAvatar, resolveAssigneeAvatar } from "@/components/ui/user-avatar";
import {
  parseSprintCapacityColumnDragId,
  sprintCapacityBucketDropId,
  sprintCapacityColumnDragId,
  sprintCapacityColumnDropId,
  sprintCapacitySlotDropId,
  storyBoardDraggableId,
} from "@/lib/epic-dnd-ids";
import {
  assigneeMatchRosterForSprintTeam,
  orderedSprintCapacityMembers,
  sprintCapacityAssigneeBucket,
  SPRINT_CAPACITY_OTHER_BUCKET,
  type SprintCapacityBoard as SprintCapacityBoardState,
  type SprintWorkspaceDirectoryUser,
} from "@/lib/sprint-capacity";
import { MONTH_TEAM_COLUMNS, isKnownEpicTeamId } from "@/lib/month-team-board";
import { teamLabelForWorkspaceUser } from "@/lib/workspace-users";
import { TeamLoadSummary } from "@/components/timeline/team-load-summary";
import { UserStoryIcon } from "@/components/ui/user-story-icon";

function storyAssigneeDisplayLabel(story: UserStoryItem): string {
  return story.assignee?.trim() || "Unassigned";
}

function DragToAssignIcon({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-block", className)} aria-hidden style={{ width: "1.9rem", height: "1.9rem" }}>
      <span className="absolute top-0 left-0 size-4 shrink-0 flex items-center justify-center">
        <UserRound className="size-4" />
      </span>
      <svg viewBox="0 0 14 16" fill="currentColor" className="absolute size-5" style={{ top: "12px", left: "11px" }} focusable="false">
        <path d="M2 1 L2 13 L5 10 L7.5 15 L9 14.3 L6.5 9.3 L10.5 9.3 Z" stroke="white" strokeWidth="0.85" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function capacityBucketToFilterLabel(bucket: string): string {
  if (bucket === SPRINT_CAPACITY_OTHER_BUCKET) return "Unassigned";
  return bucket;
}

function assigneeFilterBadgeLabel(name: string): string {
  if (name === "Unassigned") return "U";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const p = parts[0]!;
    if (p.length <= 1) return p.toUpperCase();
    return p.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function assigneeFilterCircleIcon(name: string): LucideIcon {
  return name === "Unassigned" ? UserX : UserRound;
}

const CAPACITY_HEADER_ICON_BTN_CLASS =
  "inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200/90 bg-white/90 p-1.5 text-slate-600 shadow-sm outline-none transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-300";

function SprintCapacityColumnChrome({
  yearSprint,
  teamKey,
  member,
  reorderEnabled,
  children,
}: {
  yearSprint: number;
  teamKey: string;
  member: string;
  reorderEnabled: boolean;
  children: (reorderGrip: ReactNode) => ReactNode;
}) {
  const isOther = member === SPRINT_CAPACITY_OTHER_BUCKET;
  const dropId = sprintCapacityColumnDropId(yearSprint, teamKey, member);
  const dragId = sprintCapacityColumnDragId(yearSprint, teamKey, member);
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropId,
    disabled: !reorderEnabled || isOther,
  });
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: dragId,
    disabled: !reorderEnabled || isOther,
  });

  const setColumnRef = (el: HTMLDivElement | null) => {
    setDropRef(el);
    setDragRef(el);
  };

  const columnStyle =
    reorderEnabled && !isOther && (transform != null || isDragging)
      ? {
          transform: transform
            ? `${CSS.Transform.toString(transform)}${isDragging ? " scale(1.015)" : ""}`
            : isDragging
              ? "scale(1.015)"
              : undefined,
          zIndex: isDragging ? 80 : undefined,
          boxShadow: isDragging
            ? "0 20px 40px -14px rgb(15 23 42 / 0.28), 0 0 0 1px rgb(15 23 42 / 0.06)"
            : undefined,
          transition: isDragging ? undefined : "box-shadow 180ms ease",
        }
      : undefined;

  const reorderGrip =
    reorderEnabled && !isOther ? (
      <button
        type="button"
        className={cn(CAPACITY_HEADER_ICON_BTN_CLASS, "cursor-grab active:cursor-grabbing", isDragging && "cursor-grabbing")}
        aria-label={`Reorder ${member} column`}
        title="Drag to reorder column"
        {...listeners}
        {...attributes}
      >
        <GripVertical className="size-3" strokeWidth={2} aria-hidden />
      </button>
    ) : null;

  return (
    <div
      ref={setColumnRef}
      className={cn(
        "relative w-full min-w-0 rounded-xl",
        reorderEnabled && !isOther && isOver && !isDragging && "ring-2 ring-dashed ring-indigo-400/45",
        isDragging && "rounded-xl ring-1 ring-slate-300/80",
      )}
      style={columnStyle}
    >
      {children(reorderGrip)}
    </div>
  );
}

type CapacityStoryCardModel = {
  id: string;
  title: string;
  epicTitle: string;
  estimatedDays: number;
  daysLeft: number | null;
  assigneeLabel: string;
  status: "todo" | "inProgress" | "done" | "approved";
};

type SprintCapacityBoardProps = {
  initiatives: InitiativeItem[];
  month: number;
  yearSprint: number;
  selectedTeamId?: string | null;
  capacityBoard: SprintCapacityBoardState;
  /** Drag grip to reorder person columns (not applied to Other / closed sprint). */
  columnReorderEnabled?: boolean;
  onCapacityChange: (member: string, days: number) => void;
  onEstimateChange: (storyId: string, estimatedDays: number) => void;
  onDaysLeftChange: (storyId: string, daysLeft: number) => void;
  onUnscheduleStory: (storyId: string) => void;
  onOpenStory: (storyId: string) => void;
  teamSelectorSlot?: ReactNode;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  /** Year of the plan — when provided, the board derives `sprintClosed`
   *  internally and (if also given an `onGoToOpenSprint`) renders the
   *  same frosted closed-state overlay the sprint kanban uses (light
   *  slate frost + closed-sign image + jump-to-current-sprint pill).
   *  Data remains visible underneath. */
  planYear?: number;
  /** Fires when the user clicks the jump pill in the closed overlay. */
  onGoToOpenSprint?: (yearSprint: number) => void;
};

function CapacityStoryCard({
  card,
  onEstimateChange,
  onEstimateDraftChange,
  onDaysLeftChange,
  onUnscheduleStory,
  onOpenStory,
  highlight = false,
  readOnly = false,
  workspaceDirectoryUsers = null,
}: {
  card: CapacityStoryCardModel;
  onEstimateChange: (storyId: string, estimatedDays: number) => void;
  /** Mirrors the in-progress draft (or `null` on commit/cancel) up to the
   *  bucket so its thermometer + "Over capacity" badge react live. */
  onEstimateDraftChange?: (storyId: string, days: number | null) => void;
  onDaysLeftChange: (storyId: string, daysLeft: number) => void;
  onUnscheduleStory: (storyId: string) => void;
  onOpenStory: (storyId: string) => void;
  /** Glow the card to mark it as the search match. */
  highlight?: boolean;
  /** When true, the card is non-interactive: inline editors, the
   *  unschedule button, and the drag listeners are all disabled.
   *  Used by the closed-sprint overlay. */
  readOnly?: boolean;
  /** Used to resolve the assignee's avatar photo on the assignee chip. */
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[] | null;
}) {
  const isUnassigned = card.assigneeLabel === "Unassigned";
  const [showAssignHint, setShowAssignHint] = useState(isUnassigned);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isUnassigned) {
      setShowAssignHint(true);
      hintTimerRef.current = setTimeout(() => setShowAssignHint(false), 4200);
    }
    return () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [draftDays, setDraftDays] = useState<number | null>(null);
  const isDirty = draftDays !== null && draftDays !== card.estimatedDays;
  const displayDays = draftDays !== null ? draftDays : card.estimatedDays;

  const [draftDaysLeft, setDraftDaysLeft] = useState<number | null>(null);
  const isDirtyLeft = draftDaysLeft !== null && draftDaysLeft !== (card.daysLeft ?? 0);
  const displayDaysLeft = draftDaysLeft !== null ? draftDaysLeft : (card.daysLeft ?? 0);

  function commitDraftLeft() {
    if (draftDaysLeft !== null) {
      onDaysLeftChange(card.id, draftDaysLeft);
      setDraftDaysLeft(null);
    }
  }
  function cancelDraftLeft() {
    setDraftDaysLeft(null);
  }

  function applyDraftDays(next: number | null) {
    setDraftDays(next);
    onEstimateDraftChange?.(card.id, next);
  }
  function commitDraft() {
    if (draftDays !== null) {
      onEstimateChange(card.id, draftDays);
      applyDraftDays(null);
    }
  }
  function cancelDraft() {
    applyDraftDays(null);
  }
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: storyBoardDraggableId(card.id),
    disabled: readOnly,
  });

  return (
    <article
      ref={setNodeRef}
      className={cn(
        "group/storycap relative min-h-[3.25rem] rounded-lg border border-slate-200/80 bg-white py-2 pl-2 pr-2 shadow-sm transition-colors hover:border-slate-300/70 hover:bg-slate-50/80",
        isDragging && "opacity-60",
        highlight && "border-amber-400 bg-amber-50/60 shadow-md ring-2 ring-amber-300 ring-offset-1 ring-offset-amber-50/40",
      )}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 30 : undefined,
      }}
    >
      {!readOnly ? (
        <button
          type="button"
          onClick={() => onUnscheduleStory(card.id)}
          className="absolute right-1.5 top-1.5 z-50 inline-flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 opacity-0 shadow-sm transition hover:bg-slate-100 hover:text-slate-700 group-hover/storycap:opacity-100 group-focus-within/storycap:opacity-100 focus-visible:opacity-100"
          aria-label="Clear assignee (story stays on sprint)"
          title="Unassign"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
      <div className="flex w-full min-w-0 flex-col gap-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className="shrink-0 cursor-grab rounded border border-slate-200/80 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-100 active:cursor-grabbing"
            aria-label="Drag story to another person or unschedule"
            {...attributes}
            {...listeners}
          >
            ::
          </button>
          <div className="min-w-0 flex-1 pr-[calc(0.375rem+1.5rem+0.25rem)]">
            <button
              type="button"
              className="w-full truncate text-left text-[13px] font-semibold leading-snug text-slate-900 hover:text-blue-700"
              onClick={() => onOpenStory(card.id)}
            >
              <span className="relative mr-1.5 inline-flex align-middle text-slate-600">
                <UserStoryIcon className="size-3.5" />
                {showAssignHint ? (
                  <DragToAssignIcon className="animate-epic-drag-hint-arrow pointer-events-none absolute left-0 top-1/2 size-7 text-emerald-600" />
                ) : null}
              </span>
              {card.title}
            </button>
            <p className="mt-0.5 truncate text-[11px] leading-snug text-slate-500">{card.epicTitle}</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <div
              className={cn(
                "inline-flex max-w-full min-w-0 items-center gap-1 rounded border py-px pl-0.5 pr-1 text-[10px] font-medium leading-tight",
                isUnassigned
                  ? "border-slate-200/70 bg-slate-50 text-slate-500"
                  : "border-emerald-200/80 bg-emerald-50 text-emerald-900",
              )}
              title={card.assigneeLabel}
            >
              {isUnassigned ? (
                <User className="ml-0.5 size-2.5 shrink-0 opacity-80" aria-hidden />
              ) : (
                (() => {
                  const resolved = resolveAssigneeAvatar(card.assigneeLabel, workspaceDirectoryUsers ?? null);
                  return resolved.image ? (
                    <UserAvatar name={resolved.name} image={resolved.image} size={14} className="ring-0" />
                  ) : (
                    <User className="ml-0.5 size-2.5 shrink-0 opacity-80" aria-hidden />
                  );
                })()
              )}
              <span className="min-w-0 truncate">
                {isUnassigned ? card.assigneeLabel : formatAssigneeShortLabel(card.assigneeLabel)}
              </span>
            </div>
            <span
              className={cn(
                "shrink-0 rounded border px-1 py-px text-[10px] font-medium leading-tight",
                card.status === "todo"       && "border-amber-200/80 bg-amber-50 text-amber-800",
                card.status === "inProgress" && "border-blue-200/80 bg-blue-50 text-blue-800",
                card.status === "done"       && "border-emerald-200/80 bg-emerald-50 text-emerald-800",
                card.status === "approved"   && "border-violet-200/80 bg-violet-50 text-violet-800",
              )}
            >
              {card.status === "todo" ? "To do" : card.status === "inProgress" ? "In progress" : card.status === "done" ? "Done" : "Approved"}
            </span>
          </div>
          <div className="grid shrink-0 grid-cols-[auto_2.5rem] items-center gap-x-2 gap-y-1">
              <span className="whitespace-nowrap text-[11px] font-medium text-slate-400">Est. Days left</span>
              <input
                type="number"
                readOnly
                tabIndex={-1}
                value={card.daysLeft ?? 0}
                onChange={() => {}}
                className={cn(
                  "h-5 w-10 rounded border border-slate-200/70 bg-slate-50 px-0.5 text-center text-[10px] font-semibold text-slate-400 pointer-events-none select-none focus:outline-none",
                  CAPACITY_DAYS_INPUT_NO_SPIN,
                )}
                aria-label="Story Days Left"
              />
              <span className="whitespace-nowrap text-[12px] font-semibold text-slate-600">Est Days</span>
            <input
              type="number"
              min={0}
              max={20}
              step={1}
              value={displayDays}
              readOnly={readOnly}
              tabIndex={readOnly ? -1 : undefined}
              onChange={(event) => {
                if (readOnly) return;
                applyDraftDays(Number(event.target.value || 0));
              }}
              onKeyDown={(e) => {
                if (readOnly) return;
                if (e.key === "Enter") commitDraft();
                if (e.key === "Escape") cancelDraft();
              }}
              className={cn(
                "h-5 w-10 shrink-0 rounded border bg-white px-0.5 text-center text-[10px] font-semibold leading-none text-slate-800 focus:outline-none focus:ring-1",
                isDirty
                  ? "border-blue-300 focus:border-blue-400 focus:ring-blue-100"
                  : "border-slate-200 focus:border-blue-300 focus:ring-blue-100",
                readOnly && "cursor-not-allowed select-none bg-slate-50/80 text-slate-500",
                CAPACITY_DAYS_INPUT_NO_SPIN,
              )}
              aria-label="Story Est Days"
            />
            {isDirty && (
              <div className="col-span-2 flex justify-end gap-1">
                <button
                  type="button"
                  onClick={commitDraft}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-emerald-300 bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100"
                  aria-label="Confirm estimate"
                  title="Confirm"
                >
                  <Check className="size-3" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={cancelDraft}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cancel estimate change"
                  title="Cancel"
                >
                  <X className="size-3" strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function StoryDropSlot({
  yearSprint,
  teamKey,
  member,
  index,
}: {
  yearSprint: number;
  teamKey: string;
  member: string;
  index: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: sprintCapacitySlotDropId(yearSprint, teamKey, member, index),
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "my-0.5 min-h-2.5 w-full shrink-0 rounded-md py-0.5 transition",
        isOver ? "min-h-4 bg-violet-100/70 ring-1 ring-violet-300/50" : "bg-transparent",
      )}
      aria-hidden
    />
  );
}

function CapacityBucket({
  yearSprint,
  teamKey,
  member,
  capacity,
  cards,
  onCapacityChange,
  onEstimateChange,
  onDaysLeftChange,
  onUnscheduleStory,
  onOpenStory,
  panelExpandable = false,
  isPanelExpanded = false,
  onExpandPanel,
  onCollapsePanel,
  reorderGrip = null,
  /** Shown as a small label above the bucket when a single delivery team is selected (hidden for all-teams view). */
  teamFilterLabel = null,
  highlightStoryIds = null,
  workspaceDirectoryUsers = null,
  readOnly = false,
}: {
  yearSprint: number;
  teamKey: string;
  member: string;
  capacity: number;
  cards: CapacityStoryCardModel[];
  onCapacityChange: (days: number) => void;
  onEstimateChange: (storyId: string, estimatedDays: number) => void;
  onDaysLeftChange: (storyId: string, daysLeft: number) => void;
  onUnscheduleStory: (storyId: string) => void;
  onOpenStory: (storyId: string) => void;
  panelExpandable?: boolean;
  isPanelExpanded?: boolean;
  onExpandPanel?: () => void;
  onCollapsePanel?: () => void;
  /** Column reorder handle (same size / row as expand control). */
  reorderGrip?: ReactNode;
  teamFilterLabel?: string | null;
  /** Story ids that match the active search query — cards in this set get a
   *  highlighted ring. Null = no search active. */
  highlightStoryIds?: ReadonlySet<string> | null;
  /** Directory for avatar lookup — bucket header shows the person's photo
   *  when present, initials otherwise. */
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[] | null;
  /** Disables interactive controls on every card + the bucket itself.
   *  Used by the closed-sprint overlay. */
  readOnly?: boolean;
}) {
  const dropId = sprintCapacityBucketDropId(yearSprint, teamKey, member);
  const { setNodeRef, isOver } = useDroppable({ id: dropId, disabled: readOnly });
  const [draftCapacity, setDraftCapacity] = useState<number | null>(null);
  const isCapacityDirty = draftCapacity !== null && draftCapacity !== capacity;
  const displayCapacity = draftCapacity !== null ? draftCapacity : capacity;
  function commitCapacity() {
    if (draftCapacity !== null) { onCapacityChange(draftCapacity); setDraftCapacity(null); }
  }
  function cancelCapacity() { setDraftCapacity(null); }
  /** Per-story Est-days drafts mirrored from each CapacityStoryCard while
   *  the user is typing — lets the thermometer / "Over capacity" badge
   *  react live without waiting for save. */
  const [storyEstimateDrafts, setStoryEstimateDrafts] = useState<Record<string, number>>({});
  function handleStoryEstimateDraftChange(storyId: string, days: number | null) {
    setStoryEstimateDrafts((prev) => {
      if (days === null) {
        if (!(storyId in prev)) return prev;
        const { [storyId]: _drop, ...rest } = prev;
        void _drop;
        return rest;
      }
      if (prev[storyId] === days) return prev;
      return { ...prev, [storyId]: days };
    });
  }
  const memberGradientKey = member.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const svgKey = `scap-${memberGradientKey}-${teamKey.replace(/[^a-zA-Z0-9]+/g, "-")}-${dropId.replace(/[^a-zA-Z0-9]+/g, "")}`;
  const sprintGaugeMaxDays = 10;
  const assignedTotal = cards.reduce(
    (sum, c) => sum + (storyEstimateDrafts[c.id] ?? c.estimatedDays),
    0,
  );
  const storiesOverCapacity = assignedTotal > displayCapacity;
  const fillPct = Math.max(
    0,
    Math.min(100, displayCapacity > 0 ? (assignedTotal / displayCapacity) * 100 : assignedTotal > 0 ? 100 : 0),
  );
  const utilization = displayCapacity > 0 ? (assignedTotal / displayCapacity) * 100 : assignedTotal > 0 ? 200 : 0;
  const thermometerPct = Math.max(0, Math.min(100, utilization));
  const capacityMarkerPct = Math.max(
    0,
    Math.min(100, sprintGaugeMaxDays > 0 ? (displayCapacity / sprintGaugeMaxDays) * 100 : 0),
  );
  const stressRatio = displayCapacity > 0 ? assignedTotal / displayCapacity : 0;
  const fluidStops = capacityGaugeFluidStops(stressRatio);
  const bucketFill =
    "linear-gradient(180deg, rgba(186,230,253,0.06) 0%, rgba(56,189,248,0.16) 45%, rgba(2,132,199,0.30) 100%)";
  const sprintRollupInfoId = `sprint-cap-rollup-info-${svgKey}`;
  const sprintStoriesWarnId = `sprint-cap-stories-warn-${svgKey}`;
  const memberTitle = capacityBucketToFilterLabel(member);
  const hasHeaderToolbar =
    Boolean(reorderGrip) || Boolean(panelExpandable && onExpandPanel && onCollapsePanel);
  /** Min height matches the old fixed column; list area below can grow to `bucketScrollMaxClass` before scrolling. */
  const bucketColumnShellClass = isPanelExpanded
    ? "min-h-[28rem]"
    : "min-h-[23rem] @[28rem]:min-h-[26rem]";
  /** 150% of previous fixed list heights before vertical scroll. */
  const bucketScrollMaxClass = isPanelExpanded
    ? "max-h-[min(72vh,66rem)]"
    : "max-h-[34.5rem] @[28rem]:max-h-[39rem]";

  return (
    <section
      className={cn(
        "group @container relative min-h-0 min-w-0 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm",
        "transition-[border-color,box-shadow] duration-200 ease-out",
        "hover:border-slate-300/70 hover:shadow-md",
      )}
    >
      <div className="-mt-1 mb-2 flex flex-col gap-4 pr-0.5">
        {/* 1fr | auto | 1fr keeps the person name centered; label sits in the left fringe only. */}
        <div className="relative grid min-h-8 w-full min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-x-1">
          <div className="flex min-w-0 items-center justify-self-start self-center">
            {teamFilterLabel ? (
              <span
                className="inline-flex max-w-[5.25rem] items-center rounded-sm bg-violet-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-violet-700 ring-1 ring-violet-200/70"
                title={teamFilterLabel}
              >
                <span className="truncate">{teamFilterLabel}</span>
              </span>
            ) : null}
          </div>
          <p className="col-start-2 flex min-h-8 min-w-0 max-w-[min(16rem,85vw)] items-center justify-center gap-2 text-center text-[17px] font-bold text-slate-800">
            {(() => {
              // Bucket title can be a person's name, "Unassigned", or "Others" —
              // only resolve an avatar for real people. The other two read as
              // group labels and get the generic Users icon.
              const isPerson =
                memberTitle && memberTitle !== "Unassigned" && memberTitle !== "Others";
              if (!isPerson) {
                return (
                  <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                    <Users className="size-3.5" aria-hidden />
                  </span>
                );
              }
              const resolved = resolveAssigneeAvatar(memberTitle, workspaceDirectoryUsers ?? null);
              return <UserAvatar name={resolved.name} image={resolved.image} size={28} className="ring-1 ring-white shadow-sm" />;
            })()}
            <span className="min-w-0 truncate">{memberTitle}</span>
          </p>
          <div className="relative min-h-8 min-w-0 justify-self-stretch self-center">
            {hasHeaderToolbar ? (
              /* Toolbar pinned to the right of each bucket header. The
               * reorder grip is now subtly visible even when the user
               * isn't hovering — at ~60% opacity by default, full
               * opacity on hover / focus. Previously the whole toolbar
               * was opacity-0 which hid the grip entirely and made the
               * drag affordance undiscoverable. */
              <div className="absolute right-0 top-1/2 z-10 flex items-center gap-1 -translate-y-1/2 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {reorderGrip}
                {panelExpandable && onExpandPanel && onCollapsePanel ? (
                  isPanelExpanded ? (
                    <button
                      type="button"
                      onClick={onCollapsePanel}
                      className={CAPACITY_HEADER_ICON_BTN_CLASS}
                      aria-label="Show all people buckets"
                      title="Show all people"
                    >
                      <Minimize2 className="size-3" aria-hidden />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onExpandPanel}
                      className={CAPACITY_HEADER_ICON_BTN_CLASS}
                      aria-label="Expand this person bucket to full width"
                      title="Expand bucket"
                    >
                      <Maximize2 className="size-3" aria-hidden />
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex min-h-6 min-w-0 flex-nowrap items-center justify-between gap-x-3">
          <div className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-slate-600">
            Capacity
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={displayCapacity}
              readOnly={readOnly}
              tabIndex={readOnly ? -1 : undefined}
              onChange={(event) => {
                if (readOnly) return;
                setDraftCapacity(Number(event.target.value || 0));
              }}
              onKeyDown={(e) => {
                if (readOnly) return;
                if (e.key === "Enter") commitCapacity();
                if (e.key === "Escape") cancelCapacity();
              }}
              className={cn(
                "h-5 w-10 shrink-0 rounded border bg-white/90 px-1 py-0 text-center text-[11px] font-medium leading-none text-slate-800 focus:outline-none focus:ring-1",
                isCapacityDirty
                  ? "border-blue-300 focus:border-blue-400 focus:ring-blue-100"
                  : "border-slate-200/90 focus:border-blue-300 focus:ring-blue-100",
                readOnly && "cursor-not-allowed bg-slate-50/80 text-slate-500",
                CAPACITY_DAYS_INPUT_NO_SPIN,
              )}
            />
            <span className="text-[13px] font-semibold text-slate-600">Days</span>
            {isCapacityDirty && (
              <>
                <button
                  type="button"
                  onClick={commitCapacity}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-emerald-300 bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100"
                  aria-label="Confirm capacity"
                  title="Confirm"
                >
                  <Check className="size-3" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={cancelCapacity}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cancel capacity change"
                  title="Cancel"
                >
                  <X className="size-3" strokeWidth={2.5} />
                </button>
              </>
            )}
          </div>
          <div className="flex min-w-0 shrink items-center justify-end gap-1.5">
            <div className="min-w-0 max-w-full overflow-x-auto overflow-y-visible [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div
                className="flex w-max min-w-0 flex-nowrap items-center justify-end gap-x-2 text-[13px] font-semibold leading-snug text-slate-600"
                role="status"
                aria-live="polite"
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 whitespace-nowrap px-1.5 py-0.5",
                    storiesOverCapacity ? cn(rollupOverCapacityPill, "font-medium") : rollupNeutralPill,
                  )}
                >
                  {/* Σ | Stories | 2.0 Days — pipe-separated chip
                   *  matches the user-story / initiative / epic dialog
                   *  pattern so the rolled-up totals read consistently
                   *  across the app. */}
                  <span className={cn(storiesOverCapacity ? "text-rose-700" : "text-slate-400")}>Σ</span>
                  <span aria-hidden className="inline-block h-3 w-px self-center bg-slate-300" />
                  <span>Stories</span>
                  <span aria-hidden className="inline-block h-3 w-px self-center bg-slate-300" />
                  <span className={cn("tabular-nums", storiesOverCapacity ? "text-rose-950" : "text-slate-800")}>
                    {assignedTotal.toFixed(1)}
                  </span>
                  <span className={cn(storiesOverCapacity && "text-rose-950")}>Days</span>
                  {storiesOverCapacity ? (
                    <RollupOverCapWarn
                      tooltipId={sprintStoriesWarnId}
                      ariaLabel="Σ Stories exceeds capacity — details"
                    >
                      <span className="font-semibold text-rose-800">Over capacity</span>
                      <span className="mt-0.5 block text-slate-600">
                        Σ Stories is {assignedTotal.toFixed(1)} Days but Capacity is {displayCapacity} Days. Lower story
                        estimates, raise Capacity, or move stories.
                      </span>
                    </RollupOverCapWarn>
                  ) : null}
                </span>
              </div>
            </div>
            <span className="group/sprintrollup relative inline-flex shrink-0">
              <button
                type="button"
                className="rounded p-0.5 text-slate-400 outline-none transition hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-indigo-300"
                aria-label="About sprint capacity rollups"
                aria-describedby={sprintRollupInfoId}
              >
                <Info className="size-4" aria-hidden />
              </button>
              <span
                id={sprintRollupInfoId}
                role="tooltip"
                className={cn(
                  CAPACITY_ROLLUP_INFO_TOOLTIP_CLASS,
                  "group-hover/sprintrollup:opacity-100 group-focus-within/sprintrollup:opacity-100",
                )}
              >
                <span className="block font-semibold text-slate-800">Sprint capacity (per person)</span>
                <span className="mt-1.5 block">
                  <strong className="text-slate-800">Capacity</strong> — how many Days this person can take in this
                  sprint bucket.
                </span>
                <span className="mt-1 block">
                  <strong className="text-slate-800">Σ Stories</strong> — sum of story <em>Est Days</em> in this bucket;
                  the gauge and team load use this total vs Capacity.
                </span>
                <span className="mt-1 block text-slate-600">
                  Σ Stories turns red when it exceeds Capacity (Days).
                </span>
              </span>
            </span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_56px] items-stretch gap-2">
        <div
          ref={setNodeRef}
          className={cn(
            "relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-300/60 p-2 shadow-[inset_0_2px_6px_-2px_rgba(15,23,42,0.18),inset_0_-1px_3px_-1px_rgba(15,23,42,0.10)]",
            "transition-[background-color,box-shadow,border-color] duration-200 ease-out",
            bucketColumnShellClass,
            isOver && "border-violet-300/70 bg-violet-100/50 ring-1 ring-violet-200/50",
          )}
          style={{
            backgroundImage: "linear-gradient(135deg, #eff6ff 0%, #f5f3ff 50%, #fdf2f8 100%)",
          }}
        >
          {/* Bucket SVG hidden for now — remove `hidden` from className to show again */}
          <img
            src="/images/sprint-capacity-bucket.svg"
            alt="Capacity bucket"
            className="pointer-events-none absolute top-1 left-1/2 hidden h-[88%] w-[98%] -translate-x-1/2 object-contain opacity-30"
          />
          <div
            className={cn(
              "capacity-bucket-scroll relative z-20 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden",
              bucketScrollMaxClass,
            )}
          >
            <div className="mt-auto flex w-full min-w-0 flex-col gap-2 pb-0.5">
              {cards.length === 0 ? (
                <>
                  <StoryDropSlot yearSprint={yearSprint} teamKey={teamKey} member={member} index={0} />
                  <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white/70 p-4 text-center text-[12px] font-medium tracking-wide text-slate-400">
                    Drop story here
                    <ArrowDown className="size-3.5 text-slate-300" strokeWidth={2} aria-hidden />
                  </p>
                </>
              ) : (
                <>
                  <StoryDropSlot yearSprint={yearSprint} teamKey={teamKey} member={member} index={0} />
                  {[...cards].reverse().map((card, visualIdx) => (
                    <div key={card.id}>
                      <CapacityStoryCard
                        card={card}
                        onEstimateChange={onEstimateChange}
                        onEstimateDraftChange={handleStoryEstimateDraftChange}
                        onDaysLeftChange={onDaysLeftChange}
                        onUnscheduleStory={onUnscheduleStory}
                        onOpenStory={onOpenStory}
                        highlight={highlightStoryIds?.has(card.id) ?? false}
                        readOnly={readOnly}
                        workspaceDirectoryUsers={workspaceDirectoryUsers}
                      />
                      <StoryDropSlot
                        yearSprint={yearSprint}
                        teamKey={teamKey}
                        member={member}
                        index={visualIdx + 1}
                      />
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
        <div
          className={cn(
            // Mirrors the parent capacity board's lavender→pink gradient
            // so the LOAD / thermometer column visually nests inside the
            // outer surface instead of reading as a slate-50 card on top
            // of the white bucket. Soft inset shadow makes the column
            // feel recessed into the bucket.
            "flex min-h-0 flex-col items-center rounded-xl p-2 shadow-[inset_0_2px_8px_-2px_rgba(15,23,42,0.14),inset_0_-1px_3px_-1px_rgba(15,23,42,0.08)]",
            bucketColumnShellClass,
          )}
          style={{
            backgroundImage: "linear-gradient(135deg, #eff6ff 0%, #f5f3ff 50%, #fdf2f8 100%)",
          }}
        >
          <div className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Load</p>
            <p className="text-[15px] font-bold text-slate-700">
              {Math.round(utilization)}%
            </p>
          </div>
          <div className="flex flex-1 items-center py-1">
            <svg viewBox="0 0 84 292" className="h-full w-[4rem]" aria-label="Capacity gauge">
              <defs>
                <linearGradient id={`track-${svgKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f8fafc" />
                  <stop offset="100%" stopColor="#eef2f7" />
                </linearGradient>
                <linearGradient id={`fluid-${svgKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={fluidStops.top} stopOpacity="1" />
                  <stop offset="42%" stopColor={fluidStops.mid} stopOpacity="0.98" />
                  <stop offset="100%" stopColor={fluidStops.bot} stopOpacity="1" />
                </linearGradient>
                <linearGradient id={`fluid-sheen-${svgKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
                  <stop offset="38%" stopColor="#ffffff" stopOpacity="0" />
                  <stop offset="100%" stopColor="#0f172a" stopOpacity="0.07" />
                </linearGradient>
              </defs>
              <rect x="28" y="8" width="28" height="274" rx="14" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
              <rect x="34" y="16" width="16" height="242" rx="8" fill={`url(#track-${svgKey})`} stroke="#cbd5e1" strokeWidth="1" />
              {Array.from({ length: 10 }, (_, i) => {
                const y = 258 - i * 24.2;
                return <line key={i} x1="56" y1={y} x2="66" y2={y} stroke="#94a3b8" strokeWidth="1.5" opacity="0.9" />;
              })}
              <line
                x1="24"
                x2="68"
                y1={258 - (capacityMarkerPct / 100) * 242}
                y2={258 - (capacityMarkerPct / 100) * 242}
                stroke="#64748b"
                strokeWidth="1.5"
                strokeDasharray="2 3"
                opacity="0.85"
              />
              <rect
                x="36"
                y={258 - (thermometerPct / 100) * 242}
                width="12"
                height={(thermometerPct / 100) * 242}
                rx="6"
                fill={`url(#fluid-${svgKey})`}
                opacity="0.97"
              />
              <rect
                x="36"
                y={258 - (thermometerPct / 100) * 242}
                width="12"
                height={(thermometerPct / 100) * 242}
                rx="6"
                fill={`url(#fluid-sheen-${svgKey})`}
                pointerEvents="none"
              />
            </svg>
          </div>
          <div className="text-center text-[11px] text-slate-500">
            <p className="font-semibold text-slate-700">{assignedTotal.toFixed(1)}d</p>
            <p className="text-slate-400">/ {displayCapacity.toFixed(1)}d</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SprintCapacityBoard({
  initiatives,
  month,
  yearSprint,
  selectedTeamId = null,
  capacityBoard,
  columnReorderEnabled = true,
  onCapacityChange,
  onEstimateChange,
  onDaysLeftChange,
  onUnscheduleStory,
  onOpenStory,
  teamSelectorSlot,
  workspaceDirectoryUsers = [],
  planYear,
  onGoToOpenSprint,
}: SprintCapacityBoardProps) {
  // Closed-state overlay mirrors the sprint kanban: shown when the
  // active sprint's end date has passed. Only renders if `planYear` is
  // provided (without it we can't compute the sprint window).
  const sprintClosed =
    planYear != null && sprintEndDate(planYear, yearSprint).getTime() <= Date.now();
  const workTargetSprint =
    planYear != null ? currentWorkYearSprintForPlan(planYear) : null;
  const showGoToOpenSprint =
    sprintClosed &&
    workTargetSprint != null &&
    workTargetSprint !== yearSprint &&
    Boolean(onGoToOpenSprint);
  /** Same story rows as sprint Kanban for the selected delivery team (or all teams). */
  const rows = collectStoriesForSprintBoard(initiatives, month, yearSprint, selectedTeamId ? [selectedTeamId] : null);
  const storyById = new Map(
    rows.map((row) => [
      row.story.id,
      {
        id: row.story.id,
        title: row.story.title,
        epicTitle: row.epic.title,
        estimatedDays: Number(row.story.estimatedDays ?? 0),
        daysLeft: row.story.daysLeft ?? null,
        assigneeLabel: storyAssigneeDisplayLabel(row.story),
        status: row.story.status,
      } satisfies CapacityStoryCardModel,
    ]),
  );
  const assigneeRoster = assigneeMatchRosterForSprintTeam(selectedTeamId, workspaceDirectoryUsers);
  /**
   * Always include everyone on the selected delivery team (or full combined roster for “All teams”),
   * then add anyone else who has sprint work or persisted bucket assignments.
   */
  const memberSet = new Set<string>(assigneeRoster);
  for (const row of rows) {
    const m = sprintCapacityAssigneeBucket(row.story.assignee, assigneeRoster);
    if (m) memberSet.add(m);
  }
  for (const [key, ids] of Object.entries(capacityBoard.assignments ?? {})) {
    if (key === SPRINT_CAPACITY_OTHER_BUCKET) continue;
    if (Array.isArray(ids) && ids.length > 0 && ids.some((id) => storyById.has(id))) {
      memberSet.add(key);
    }
  }
  const otherIds = capacityBoard.assignments[SPRINT_CAPACITY_OTHER_BUCKET] ?? [];
  const needsOtherColumn =
    otherIds.some((id) => storyById.has(id)) ||
    rows.some((row) => sprintCapacityAssigneeBucket(row.story.assignee, assigneeRoster) == null);
  const sortedPeopleCols = [...memberSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const members = orderedSprintCapacityMembers({
    columnOrder: capacityBoard.columnOrder,
    sortedPeopleCols,
    needsOtherColumn: needsOtherColumn,
  });

  const assigneeFilterOptions = useMemo(() => {
    const labels = new Set<string>(assigneeMatchRosterForSprintTeam(selectedTeamId, workspaceDirectoryUsers));
    for (const row of rows) {
      labels.add(storyAssigneeDisplayLabel(row.story));
    }
    const named = [...labels]
      .filter((n) => n !== "Unassigned")
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const out: string[] = [...named];
    if (labels.has("Unassigned")) out.push("Unassigned");
    return out;
  }, [rows, selectedTeamId, workspaceDirectoryUsers]);

  const [selectedAssigneeFilter, setSelectedAssigneeFilter] = useState<string[]>([]);
  const [assigneeFilterExpanded, setAssigneeFilterExpanded] = useState(false);
  // When the pin is on, the chips above stay expanded even after the cursor
  // leaves the panel. Click the pin again to return to hover-only expansion.
  const [assigneeFilterPinned, setAssigneeFilterPinned] = useState(false);
  const showAssigneeChipsExpanded = assigneeFilterPinned || assigneeFilterExpanded;

  useEffect(() => {
    setSelectedAssigneeFilter([]);
  }, [selectedTeamId, month, yearSprint]);

  useEffect(() => {
    const valid = new Set(assigneeFilterOptions);
    setSelectedAssigneeFilter((prev) => {
      const next = prev.filter((n) => valid.has(n));
      if (next.length === prev.length && next.every((n, i) => n === prev[i])) return prev;
      return next;
    });
  }, [assigneeFilterOptions]);

  const toggleCapacityAssigneeFilter = useCallback((name: string) => {
    setSelectedAssigneeFilter((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const allCapacityAssigneesSelected =
    assigneeFilterOptions.length > 0 && selectedAssigneeFilter.length === assigneeFilterOptions.length;

  const selectAllCapacityAssignees = useCallback(() => {
    setSelectedAssigneeFilter((prev) => {
      if (assigneeFilterOptions.length === 0) return prev;
      if (prev.length === assigneeFilterOptions.length) return [];
      return [...assigneeFilterOptions];
    });
  }, [assigneeFilterOptions]);

  // Story search — live-filter by story title (or USXX ref). When the
  // query matches one or more stories on the board, hide member columns
  // that have none of them and highlight the matched cards.
  const [storySearch, setStorySearch] = useState("");
  useEffect(() => {
    setStorySearch("");
  }, [selectedTeamId, month, yearSprint]);
  const storySearchQuery = storySearch.trim().toLowerCase();
  const searchMatchIds = useMemo(() => {
    if (!storySearchQuery) return null;
    const matches = new Set<string>();
    for (const [, card] of storyById) {
      if (
        card.title.toLowerCase().includes(storySearchQuery) ||
        card.epicTitle.toLowerCase().includes(storySearchQuery)
      ) {
        matches.add(card.id);
      }
    }
    return matches;
  // storyById is rebuilt each render from `rows`; depend on its size + the
  // query so the memo runs when either changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storySearchQuery, rows]);

  const visibleMembers = useMemo(() => {
    let scoped = members;
    if (selectedAssigneeFilter.length > 0) {
      scoped = scoped.filter((m) => selectedAssigneeFilter.includes(capacityBucketToFilterLabel(m)));
    }
    if (searchMatchIds && searchMatchIds.size > 0) {
      scoped = scoped.filter((m) =>
        (capacityBoard.assignments[m] ?? []).some((id) => searchMatchIds.has(id)),
      );
    } else if (searchMatchIds && searchMatchIds.size === 0) {
      // Query typed but nothing matched — keep everything visible so the
      // user sees the "no matches" outcome instead of an empty grid.
      // (visibleMembers stays the same)
    }
    return scoped;
  }, [members, selectedAssigneeFilter, searchMatchIds, capacityBoard.assignments]);

  const [expandedMemberKey, setExpandedMemberKey] = useState<string | null>(null);
  useEffect(() => {
    setExpandedMemberKey(null);
  }, [month, yearSprint, selectedTeamId, selectedAssigneeFilter.join(",")]);

  const teamKey = selectedTeamId ?? "all";
  const teamLabel =
    selectedTeamId && isKnownEpicTeamId(selectedTeamId)
      ? MONTH_TEAM_COLUMNS.find((t) => t.id === selectedTeamId)?.label ?? "Team"
      : selectedTeamId
        ? teamLabelForWorkspaceUser(selectedTeamId)
        : "All teams (combined)";
  const gradientKey = teamKey.replace(/[^a-zA-Z0-9]+/g, "-");

  let teamTotalCapacity = 0;
  let teamTotalAssigned = 0;
  for (const member of visibleMembers) {
    const cap = Number(capacityBoard.capacities[member] ?? 6);
    teamTotalCapacity += Number.isFinite(cap) ? cap : 0;
    const assignedIds = capacityBoard.assignments[member] ?? [];
    const cards = assignedIds.map((id) => storyById.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
    teamTotalAssigned += cards.reduce((sum, card) => sum + card.estimatedDays, 0);
  }

  const sprintStoryCount = rows.length;

  return (
    <div
      className="relative rounded-2xl border border-slate-300/60 p-4 shadow-sm"
      style={{
        backgroundImage: "linear-gradient(135deg, #eff6ff 0%, #f5f3ff 50%, #fdf2f8 100%)",
      }}
    >
      {sprintClosed ? (
        <>
          {/* Mirrors the sprint kanban's closed-state treatment: light
           *  slate frost over the whole board + a closed-sign image
           *  pinned near the top and a jump-to-current-sprint pill so
           *  the user can bounce to the active sprint. Data underneath
           *  stays legible because the frost is only `bg-slate-900/5`
           *  with a 1px backdrop blur. */}
          {/* `pointer-events-auto` makes the frost intercept clicks so
           *  the inline estimate / days-left editors underneath can't
           *  be triggered on a closed sprint. The jump pill at z-30
           *  (also pointer-events-auto) sits above this layer and
           *  remains clickable. */}
          <div className="absolute inset-0 z-20 rounded-2xl bg-slate-900/[0.04] backdrop-blur-[1px]" />
          <div className="pointer-events-none absolute inset-x-3 -top-[28px] z-30 flex w-[min(20rem,calc(100%-1.5rem))] flex-col items-stretch gap-3 left-1/2 -translate-x-1/2">
            <div
              className="flex flex-col items-stretch gap-2.5 px-4 py-3 text-[13px] font-semibold tracking-[0.01em] text-slate-800"
              style={{
                background: "rgba(255, 255, 255, 0.2)",
                borderRadius: "16px",
                boxShadow: "0 2px 16px rgba(15, 23, 42, 0.05)",
                backdropFilter: "blur(1.2px)",
                WebkitBackdropFilter: "blur(1.2px)",
                border: "1px solid rgba(255, 255, 255, 0.44)",
              }}
            >
              <img
                src="/closed-sign-transparent.png"
                alt={`Sprint ${yearSprint} is closed`}
                className="mx-auto block h-auto max-h-44 w-auto object-contain"
                draggable={false}
              />
              {showGoToOpenSprint ? (
                <button
                  type="button"
                  onClick={() => {
                    if (workTargetSprint != null && onGoToOpenSprint) {
                      onGoToOpenSprint(workTargetSprint);
                    }
                  }}
                  className="group/jump pointer-events-auto inline-flex w-full items-center gap-3 rounded-full border border-sky-200/80 bg-gradient-to-r from-sky-50 via-indigo-50 to-violet-50 px-4 py-2 text-left shadow-sm ring-1 ring-white/60 transition-all duration-150 hover:-translate-y-px hover:from-sky-100 hover:via-indigo-100 hover:to-violet-100 hover:shadow-md hover:ring-sky-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-indigo-600 shadow-sm ring-1 ring-indigo-100">
                    <ArrowRight className="size-4 shrink-0 transition-transform duration-150 group-hover/jump:translate-x-0.5" strokeWidth={2.25} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-indigo-500">Jump to</span>
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
                      <span>Current sprint ·</span>
                      <Flag className="size-3.5 shrink-0 text-rose-500" strokeWidth={2.2} aria-hidden />
                      <span>Sprint {workTargetSprint}</span>
                    </span>
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    <div className="space-y-6 pb-6">
      <TeamLoadSummary
        teamLabel={teamLabel}
        teamLabelSlot={teamSelectorSlot}
        gradientKey={`sprint-${gradientKey}`}
        totalAssigned={teamTotalAssigned}
        totalCapacity={teamTotalCapacity}
        sprintStoryCount={sprintStoryCount}
        headerRightSlot={(
          <div className="relative w-[18rem] max-w-full" title={
            storySearchQuery
              ? (searchMatchIds && searchMatchIds.size > 0
                ? `${searchMatchIds.size} match${searchMatchIds.size === 1 ? "" : "es"} — only people with the story are shown`
                : "No matching stories on this sprint")
              : undefined
          }>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              value={storySearch}
              onChange={(e) => setStorySearch(e.target.value)}
              placeholder="Search a story on this sprint…"
              aria-label="Search stories on capacity"
              className="h-7 w-full rounded-md border border-slate-200 bg-white/90 pl-8 pr-8 text-[12.5px] font-medium text-slate-800 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-200/70"
            />
            {storySearchQuery ? (
              <button
                type="button"
                onClick={() => setStorySearch("")}
                aria-label="Clear search"
                title="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        )}
      />
      {assigneeFilterOptions.length > 0 && selectedTeamId != null ? (
        <div className="shrink-0 px-0.5 py-0.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            People in this sprint
          </p>
          <div
            className="flex min-w-0 flex-wrap items-center gap-y-1.5 py-0.5"
            onMouseEnter={() => setAssigneeFilterExpanded(true)}
            onMouseLeave={() => setAssigneeFilterExpanded(false)}
          >
            <button
              type="button"
              aria-pressed={allCapacityAssigneesSelected}
              title={allCapacityAssigneesSelected ? "Clear people filter" : "Show all people"}
              aria-label={allCapacityAssigneesSelected ? "Clear people filter" : "Show all people"}
              onClick={selectAllCapacityAssignees}
              className={cn(
                "relative z-20 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tracking-[0.02em] ring-1 transition",
                allCapacityAssigneesSelected
                  ? "bg-violet-600 text-white ring-violet-700"
                  : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
              )}
            >
              <Users className="size-[15px]" strokeWidth={2.25} aria-hidden />
            </button>
            {assigneeFilterOptions.map((name) => {
              const on = selectedAssigneeFilter.includes(name);
              const Icon = assigneeFilterCircleIcon(name);
              const isUnassigned = name === "Unassigned";
              const resolved = isUnassigned
                ? { name: "", image: null }
                : resolveAssigneeAvatar(name, workspaceDirectoryUsers);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleCapacityAssigneeFilter(name)}
                  className={cn(
                    "relative inline-flex shrink-0 items-center rounded-full text-left font-semibold tracking-[0.02em] ring-1 transition-[margin,transform,background-color,color,box-shadow,height,width,padding] duration-200",
                    // Both states render as an ellipse (avatar at the pill's
                    // left edge + a label on the right) so each chip reads as
                    // ONE shape. Collapsed = smaller, 2-letter initials.
                    showAssigneeChipsExpanded
                      ? "h-9 w-auto gap-1.5 pl-0.5 pr-2.5 text-[11px]"
                      : "h-7 w-auto gap-1 pl-0.5 pr-2 text-[10.5px]",
                    on
                      ? "bg-violet-600 text-white ring-violet-700"
                      : "bg-white text-slate-800 ring-slate-200 hover:bg-slate-50",
                  )}
                  title={name}
                  style={{ marginLeft: 4, zIndex: 10 }}
                >
                  {isUnassigned ? (
                    <Icon className="size-[15px] shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
                  ) : (
                    <UserAvatar
                      name={resolved.name}
                      image={resolved.image}
                      size={showAssigneeChipsExpanded ? 28 : 22}
                      className="ring-0"
                    />
                  )}
                  <span className="max-w-[12rem] truncate">
                    {isUnassigned
                      ? name
                      : showAssigneeChipsExpanded
                        ? formatAssigneeShortLabel(name)
                        : assigneeFilterBadgeLabel(name)}
                  </span>
                </button>
              );
            })}
            {/* Clear-all selections: only when something is selected. */}
            {selectedAssigneeFilter.length > 0 ? (
              <button
                type="button"
                onClick={() => setSelectedAssigneeFilter([])}
                onMouseEnter={(event) => event.stopPropagation()}
                title="Clear all selected assignees"
                aria-label="Clear all selected assignees"
                style={{ marginLeft: 6 }}
                className="relative z-20 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-600 ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200"
              >
                <X className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
              </button>
            ) : null}
            {/* Pin toggle: lock the expanded state on. Clicking to unpin
             *  collapses immediately even with the cursor still hovering. */}
            <button
              type="button"
              aria-pressed={assigneeFilterPinned}
              title={assigneeFilterPinned ? "Unpin — collapse now" : "Pin — keep expanded"}
              aria-label={assigneeFilterPinned ? "Unpin assignee chips" : "Pin assignee chips open"}
              onClick={() => {
                setAssigneeFilterPinned((v) => {
                  if (v) setAssigneeFilterExpanded(false);
                  return !v;
                });
              }}
              onMouseEnter={(event) => event.stopPropagation()}
              style={{ marginLeft: 6 }}
              className={cn(
                "relative z-20 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ring-1 transition",
                assigneeFilterPinned
                  ? "bg-amber-500 text-white ring-amber-600"
                  : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100",
              )}
            >
              {assigneeFilterPinned ? (
                <Pin className="size-4 shrink-0 -rotate-45" strokeWidth={2.25} aria-hidden />
              ) : (
                <PinOff className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
              )}
            </button>
          </div>
        </div>
      ) : null}
      {/* flex-wrap + min width so columns drop to the next row when the panel is narrow (not only by viewport breakpoint). */}
      <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {visibleMembers.map((member) => {
          if (expandedMemberKey != null && expandedMemberKey !== member) {
            return null;
          }
          const assignedIds = capacityBoard.assignments[member] ?? [];
          const cards = assignedIds.map((id) => storyById.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
          const reorderAllowed =
            columnReorderEnabled &&
            expandedMemberKey == null &&
            members.filter((m) => m !== SPRINT_CAPACITY_OTHER_BUCKET).length >= 2;
          return (
            <SprintCapacityColumnCell
              key={member}
              member={member}
              expandedMemberKey={expandedMemberKey}
              yearSprint={yearSprint}
              teamKey={selectedTeamId || "all"}
            >
              <SprintCapacityColumnChrome
                yearSprint={yearSprint}
                teamKey={teamKey}
                member={member}
                reorderEnabled={reorderAllowed}
              >
                {(reorderGrip) => (
                  <div className="box-border w-full max-w-full">
                    <CapacityBucket
                      yearSprint={yearSprint}
                      teamKey={teamKey}
                      member={member}
                      capacity={capacityBoard.capacities[member] ?? 6}
                      cards={cards}
                      onCapacityChange={(days) => onCapacityChange(member, days)}
                      onEstimateChange={onEstimateChange}
                      onDaysLeftChange={onDaysLeftChange}
                      onUnscheduleStory={onUnscheduleStory}
                      onOpenStory={onOpenStory}
                      panelExpandable={visibleMembers.length > 1}
                      isPanelExpanded={expandedMemberKey === member}
                      onExpandPanel={() => setExpandedMemberKey(member)}
                      onCollapsePanel={() => setExpandedMemberKey(null)}
                      reorderGrip={reorderGrip}
                      teamFilterLabel={selectedTeamId ? teamLabel : null}
                      highlightStoryIds={searchMatchIds}
                      workspaceDirectoryUsers={workspaceDirectoryUsers}
                      readOnly={sprintClosed}
                    />
                  </div>
                )}
              </SprintCapacityColumnChrome>
            </SprintCapacityColumnCell>
          );
        })}
      </div>
    </div>
    </div>
  );
}

/**
 * Grid cell wrapping each capacity column. While the column is being
 * dragged for reorder, lifts the cell with `position: relative` + a
 * high z-index so the dragged element stays visually on top of its
 * siblings (otherwise the static grid item below renders above the
 * translated source and the dragged column "disappears" behind it).
 * Tied to dnd-kit's `active.id` so only the actively dragged column
 * gets elevated.
 */
function SprintCapacityColumnCell({
  member,
  expandedMemberKey,
  yearSprint,
  teamKey,
  children,
}: {
  member: string;
  expandedMemberKey: string | null;
  yearSprint: number;
  teamKey: string;
  children: ReactNode;
}) {
  const { active } = useDndContext();
  const activeMember = active?.id ? parseSprintCapacityColumnDragId(String(active.id))?.member : null;
  const isThisColumnDragging = activeMember != null && activeMember === member;
  return (
    <div
      className={cn(
        "relative box-border w-full min-w-0 max-w-full",
        expandedMemberKey === member && "col-span-full",
      )}
      style={isThisColumnDragging ? { zIndex: 90 } : undefined}
      data-capacity-col-key={`${yearSprint}:${teamKey}:${member}`}
    >
      {children}
    </div>
  );
}
