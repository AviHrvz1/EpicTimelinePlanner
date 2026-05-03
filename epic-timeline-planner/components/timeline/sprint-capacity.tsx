"use client";

import type { LucideIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Info, UserRound, Users, UserX, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { collectStoriesForSprintBoard } from "@/lib/sprint-plan";
import { InitiativeItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  CAPACITY_DAYS_INPUT_NO_SPIN,
  CAPACITY_ROLLUP_INFO_TOOLTIP_CLASS,
  RollupOverCapWarn,
  rollupOverCapacityPill,
} from "@/components/timeline/team-capacity-bucket";
import { sprintCapacityBucketDropId, storyBoardDraggableId } from "@/lib/epic-dnd-ids";
import {
  fullDeliveryCapacityRoster,
  sprintCapacityAssigneeBucket,
  SPRINT_CAPACITY_OTHER_BUCKET,
  type SprintCapacityBoard as SprintCapacityBoardState,
} from "@/lib/sprint-capacity";
import { MONTH_TEAM_COLUMNS, isKnownEpicTeamId } from "@/lib/month-team-board";
import { TeamLoadSummary } from "@/components/timeline/team-load-summary";
import { UserStoryIcon } from "@/components/ui/user-story-icon";

function storyAssigneeDisplayLabel(story: UserStoryItem): string {
  return story.assignee?.trim() || "Unassigned";
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

type SprintCapacityBoardProps = {
  initiatives: InitiativeItem[];
  month: number;
  yearSprint: number;
  selectedTeamId?: string | null;
  capacityBoard: SprintCapacityBoardState;
  onCapacityChange: (member: string, days: number) => void;
  onEstimateChange: (storyId: string, estimatedDays: number) => void;
  onUnscheduleStory: (storyId: string) => void;
  onOpenStory: (storyId: string) => void;
  teamSelectorSlot?: ReactNode;
};

function CapacityStoryCard({
  card,
  onEstimateChange,
  onUnscheduleStory,
  onOpenStory,
}: {
  card: { id: string; title: string; epicTitle: string; estimatedDays: number };
  onEstimateChange: (storyId: string, estimatedDays: number) => void;
  onUnscheduleStory: (storyId: string) => void;
  onOpenStory: (storyId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: storyBoardDraggableId(card.id),
  });

  return (
    <article
      ref={setNodeRef}
      className={cn(
        "group relative min-h-[2.75rem] rounded-lg border border-slate-200/90 bg-white/95 px-2 py-1.5 shadow-sm",
        isDragging && "opacity-60",
      )}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 30 : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => onUnscheduleStory(card.id)}
        className="absolute right-1.5 top-1/2 z-30 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        aria-label="Remove story from sprint capacity bucket"
        title="Remove from sprint"
      >
        <X className="size-3.5" aria-hidden />
      </button>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pr-8">
        <div className="flex min-w-0 flex-1 basis-[min(100%,14rem)] items-center gap-2">
          <button
            type="button"
            className="mt-0.5 shrink-0 cursor-grab rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 active:cursor-grabbing"
            aria-label="Drag story card"
            {...attributes}
            {...listeners}
          >
            ::
          </button>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="block w-full truncate text-left text-[13px] font-semibold leading-snug text-slate-900 hover:text-blue-700"
              onClick={() => onOpenStory(card.id)}
            >
              <span className="mr-1.5 inline-flex align-middle text-slate-600">
                <UserStoryIcon className="size-3.5" />
              </span>
              {card.title}
            </button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 @min-[18rem]:ml-auto">
          <span className="text-right text-[11px] font-semibold text-slate-600">Est days</span>
          <input
            type="number"
            min={0}
            max={20}
            step={1}
            value={card.estimatedDays}
            onChange={(event) => onEstimateChange(card.id, Number(event.target.value || 0))}
            className={cn(
              "h-[1.375rem] w-11 shrink-0 rounded border border-slate-200 bg-white px-1 text-center text-[11px] font-semibold text-slate-800 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100",
              CAPACITY_DAYS_INPUT_NO_SPIN,
            )}
            aria-label="Story estimate days"
          />
        </div>
      </div>
    </article>
  );
}

function CapacityBucket({
  yearSprint,
  teamKey,
  member,
  capacity,
  assignedTotal,
  cards,
  onCapacityChange,
  onEstimateChange,
  onUnscheduleStory,
  onOpenStory,
}: {
  yearSprint: number;
  teamKey: string;
  member: string;
  capacity: number;
  assignedTotal: number;
  cards: Array<{ id: string; title: string; epicTitle: string; estimatedDays: number }>;
  onCapacityChange: (days: number) => void;
  onEstimateChange: (storyId: string, estimatedDays: number) => void;
  onUnscheduleStory: (storyId: string) => void;
  onOpenStory: (storyId: string) => void;
}) {
  const dropId = sprintCapacityBucketDropId(yearSprint, teamKey, member);
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  const memberGradientKey = member.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const svgKey = `scap-${memberGradientKey}-${teamKey.replace(/[^a-zA-Z0-9]+/g, "-")}-${dropId.replace(/[^a-zA-Z0-9]+/g, "")}`;
  const sprintGaugeMaxDays = 10;
  const sumStoryEstimates = assignedTotal;
  const storiesOverCapacity = sumStoryEstimates > capacity;
  const fillPct = Math.max(0, Math.min(100, capacity > 0 ? (assignedTotal / capacity) * 100 : assignedTotal > 0 ? 100 : 0));
  const overCapacity = storiesOverCapacity;
  const utilization = capacity > 0 ? (assignedTotal / capacity) * 100 : assignedTotal > 0 ? 200 : 0;
  const thermometerPct = Math.max(0, Math.min(100, utilization));
  const capacityMarkerPct = Math.max(
    0,
    Math.min(100, sprintGaugeMaxDays > 0 ? (capacity / sprintGaugeMaxDays) * 100 : 0),
  );
  const fluidStops = overCapacity
    ? { top: "#fb7185", mid: "#ef4444", bot: "#b91c1c" }
    : utilization >= 85
      ? { top: "#fbbf24", mid: "#f59e0b", bot: "#b45309" }
      : { top: "#22d3ee", mid: "#14b8a6", bot: "#0f766e" };
  const bucketFill =
    "linear-gradient(180deg, rgba(186,230,253,0.06) 0%, rgba(56,189,248,0.16) 45%, rgba(2,132,199,0.30) 100%)";
  const sprintRollupInfoId = `sprint-cap-rollup-info-${svgKey}`;
  const sprintStoriesWarnId = `sprint-cap-stories-warn-${svgKey}`;
  const memberTitle = capacityBucketToFilterLabel(member);

  return (
    <section
      className={cn(
        "@container min-w-0 rounded-2xl border border-slate-200/85 bg-gradient-to-br from-slate-50/95 via-indigo-50/45 to-sky-100/55 p-3 shadow-sm ring-1 ring-indigo-100/40",
      )}
    >
      <div className="mb-2 flex flex-col gap-2 pr-0.5">
        <div className="flex min-h-8 min-w-0 items-center justify-center">
          <p className="flex min-w-0 max-w-full items-center justify-center gap-1.5 text-center text-[15px] font-bold text-slate-800">
            <Users className="size-4 shrink-0 text-indigo-600/90" aria-hidden />
            <span className="min-w-0 truncate">{memberTitle}</span>
          </p>
        </div>
        <div className="flex min-h-6 min-w-0 flex-nowrap items-center justify-between gap-x-3">
          <label className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-slate-600">
            Capacity
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={capacity}
              onChange={(event) => onCapacityChange(Number(event.target.value || 0))}
              className={cn(
                "h-5 w-10 shrink-0 rounded border border-slate-200/90 bg-white/90 px-1 py-0 text-center text-[11px] font-medium leading-none text-slate-800 shadow-sm",
                CAPACITY_DAYS_INPUT_NO_SPIN,
              )}
            />
            <span className="text-[11px] font-semibold text-slate-600">Days</span>
          </label>
          <div className="flex min-w-0 shrink items-center justify-end gap-1.5">
            <div className="min-w-0 max-w-full overflow-x-auto overflow-y-visible [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div
                className="flex w-max min-w-0 flex-nowrap items-center justify-end gap-x-2 text-[13px] font-semibold leading-snug text-slate-600"
                role="status"
                aria-live="polite"
              >
                <span
                  className={cn(
                    "whitespace-nowrap",
                    storiesOverCapacity && rollupOverCapacityPill,
                    storiesOverCapacity && "font-medium",
                  )}
                >
                  {storiesOverCapacity ? (
                    <RollupOverCapWarn
                      tooltipId={sprintStoriesWarnId}
                      ariaLabel="Σ Stories exceeds capacity — details"
                    >
                      <span className="font-semibold text-rose-800">Over capacity</span>
                      <span className="mt-0.5 block text-slate-600">
                        Σ Stories is {assignedTotal.toFixed(1)} Days but Capacity is {capacity} Days. Lower story
                        estimates, raise Capacity, or move stories.
                      </span>
                    </RollupOverCapWarn>
                  ) : null}
                  Σ Stories{" "}
                  <span
                    className={cn("tabular-nums", storiesOverCapacity ? "text-white" : "text-slate-800")}
                  >
                    {assignedTotal.toFixed(1)}
                  </span>
                  <span className={cn("ml-1", storiesOverCapacity && "text-white")}>Days</span>
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
                  <strong className="text-slate-800">Σ Stories</strong> — sum of <em>Est days</em> on all user stories in
                  this bucket. The gauge uses this total vs Capacity.
                </span>
                <span className="mt-1 block text-slate-600">
                  Σ Stories turns red when it is greater than Capacity (Days).
                </span>
              </span>
            </span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_56px] gap-2">
        <div
          ref={setNodeRef}
          className={cn(
            "relative flex h-[23rem] flex-col overflow-hidden rounded-2xl border-0 bg-white p-2 transition @[28rem]:h-[26rem]",
            isOver && "ring-2 ring-primary/25",
          )}
        >
          {/* Bucket SVG hidden for now — remove `hidden` from className to show again */}
          <img
            src="/images/sprint-capacity-bucket.svg"
            alt="Capacity bucket"
            className="pointer-events-none absolute top-1 left-1/2 hidden h-[88%] w-[98%] -translate-x-1/2 object-contain opacity-30"
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] transition-all"
            style={{
              height: `${fillPct}%`,
              background: bucketFill,
            }}
          />
          <div className="capacity-bucket-scroll relative z-20 flex min-h-0 flex-1 flex-col-reverse gap-2 overflow-y-auto">
            {cards.length === 0 ? (
              <p className="rounded-md bg-slate-50/90 p-3 text-center text-[12px] font-medium text-slate-500">
                Drop story here
              </p>
            ) : (
              cards.map((card) => (
                <CapacityStoryCard
                  key={card.id}
                  card={card}
                  onEstimateChange={onEstimateChange}
                  onUnscheduleStory={onUnscheduleStory}
                  onOpenStory={onOpenStory}
                />
              ))
            )}
          </div>
        </div>
        <div className="flex h-[23rem] flex-col items-center p-2 @[28rem]:h-[26rem]">
          <div className="text-center">
            <p className="text-[11px] font-semibold text-slate-600">Load</p>
            <p className="text-[13px] font-bold text-slate-700">
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
                  <stop offset="0%" stopColor={fluidStops.top} />
                  <stop offset="52%" stopColor={fluidStops.mid} />
                  <stop offset="100%" stopColor={fluidStops.bot} />
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
                opacity="0.95"
              />
            </svg>
          </div>
          <div className="text-center text-[11px] font-semibold text-slate-600">
            <p>{assignedTotal.toFixed(1)} Days</p>
            <p>/ {capacity.toFixed(1)} Days</p>
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
  onCapacityChange,
  onEstimateChange,
  onUnscheduleStory,
  onOpenStory,
  teamSelectorSlot,
}: SprintCapacityBoardProps) {
  /**
   * Capacity assignment is scoped by sprint board key (year+sprint+team bucket set), not by epic.team.
   * Keep the visible story map broad so assigned cards always render after drop.
   */
  const rows = collectStoriesForSprintBoard(initiatives, month, yearSprint, null);
  const storyById = new Map(
    rows.map((row) => [
      row.story.id,
      {
        id: row.story.id,
        title: row.story.title,
        epicTitle: row.epic.title,
        estimatedDays: Number(row.story.estimatedDays ?? 0),
      },
    ]),
  );
  const fullRoster = fullDeliveryCapacityRoster();
  /**
   * Only show capacity columns and filter chips for people who matter on this sprint — same idea as Kanban
   * (not the full `defaultMembersForTeam` roster). Include a column if they have a story here or already have
   * cards in that bucket from persisted capacity state.
   */
  const memberSet = new Set<string>();
  for (const row of rows) {
    const m = sprintCapacityAssigneeBucket(row.story.assignee, fullRoster);
    if (m) memberSet.add(m);
  }
  for (const [key, ids] of Object.entries(capacityBoard.assignments ?? {})) {
    if (key === SPRINT_CAPACITY_OTHER_BUCKET) continue;
    if (Array.isArray(ids) && ids.length > 0) memberSet.add(key);
  }
  const needsOtherColumn =
    (capacityBoard.assignments[SPRINT_CAPACITY_OTHER_BUCKET]?.length ?? 0) > 0 ||
    rows.some((row) => sprintCapacityAssigneeBucket(row.story.assignee, fullRoster) == null);
  const sortedPeopleCols = [...memberSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const members = [...sortedPeopleCols, ...(needsOtherColumn ? [SPRINT_CAPACITY_OTHER_BUCKET] : [])];

  const assigneeFilterOptions = useMemo(() => {
    const fromStories = new Set<string>();
    for (const row of rows) {
      fromStories.add(storyAssigneeDisplayLabel(row.story));
    }
    const named = [...fromStories]
      .filter((n) => n !== "Unassigned")
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const out: string[] = [...named];
    if (fromStories.has("Unassigned")) out.push("Unassigned");
    return out;
  }, [rows]);

  const [selectedAssigneeFilter, setSelectedAssigneeFilter] = useState<string[]>([]);
  const [assigneeFilterExpanded, setAssigneeFilterExpanded] = useState(false);

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

  const visibleMembers = useMemo(() => {
    if (selectedAssigneeFilter.length === 0) return members;
    return members.filter((m) => selectedAssigneeFilter.includes(capacityBucketToFilterLabel(m)));
  }, [members, selectedAssigneeFilter]);

  const teamKey = selectedTeamId ?? "all";
  const teamLabel =
    selectedTeamId && isKnownEpicTeamId(selectedTeamId)
      ? MONTH_TEAM_COLUMNS.find((t) => t.id === selectedTeamId)?.label ?? "Team"
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

  return (
    <div className="space-y-6 pb-6">
      <TeamLoadSummary
        teamLabel={teamLabel}
        teamLabelSlot={teamSelectorSlot}
        gradientKey={`sprint-${gradientKey}`}
        totalAssigned={teamTotalAssigned}
        totalCapacity={teamTotalCapacity}
      />
      {assigneeFilterOptions.length > 0 ? (
        <div className="shrink-0 px-0.5 py-0.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            People in this sprint
          </p>
          <div
            className="flex min-w-0 items-center py-0.5"
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
                  ? "bg-sky-600 text-white ring-sky-700"
                  : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100",
              )}
            >
              <Users className="size-[15px]" strokeWidth={2.25} aria-hidden />
            </button>
            {assigneeFilterOptions.map((name, idx) => {
              const on = selectedAssigneeFilter.includes(name);
              const Icon = assigneeFilterCircleIcon(name);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleCapacityAssigneeFilter(name)}
                  className={cn(
                    "relative inline-flex h-9 shrink-0 items-center rounded-full text-left text-[11px] font-semibold tracking-[0.02em] ring-1 transition-[margin,transform,background-color,color,box-shadow,width,padding] duration-200",
                    assigneeFilterExpanded ? "w-auto gap-1.5 px-2.5" : "w-9 justify-center px-0",
                    on
                      ? "bg-sky-600 text-white ring-sky-700"
                      : "bg-white text-slate-800 ring-slate-200 hover:bg-slate-100",
                  )}
                  title={name}
                  style={{
                    marginLeft: assigneeFilterExpanded ? 6 : -12,
                    zIndex: assigneeFilterExpanded ? 10 : 10 - Math.min(idx, 9),
                  }}
                >
                  {name === "Unassigned" ? (
                    <Icon className="size-[15px] shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
                  ) : null}
                  {name !== "Unassigned" && !assigneeFilterExpanded ? (
                    <span>{assigneeFilterBadgeLabel(name)}</span>
                  ) : null}
                  {assigneeFilterExpanded ? (
                    <span className="max-w-[12rem] truncate text-[12px]">{name}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {/* flex-wrap + min width so columns drop to the next row when the panel is narrow (not only by viewport breakpoint). */}
      <div className="flex min-w-0 flex-wrap gap-6">
        {visibleMembers.map((member) => {
          const assignedIds = capacityBoard.assignments[member] ?? [];
          const cards = assignedIds.map((id) => storyById.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
          const assignedTotal = cards.reduce((sum, card) => sum + card.estimatedDays, 0);
          return (
            <div
              key={member}
              className="box-border w-full max-w-full min-w-[min(100%,22rem)] grow basis-[22rem]"
            >
              <CapacityBucket
                yearSprint={yearSprint}
                teamKey={teamKey}
                member={member}
                capacity={capacityBoard.capacities[member] ?? 6}
                assignedTotal={assignedTotal}
                cards={cards}
                onCapacityChange={(days) => onCapacityChange(member, days)}
                onEstimateChange={onEstimateChange}
                onUnscheduleStory={onUnscheduleStory}
                onOpenStory={onOpenStory}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
