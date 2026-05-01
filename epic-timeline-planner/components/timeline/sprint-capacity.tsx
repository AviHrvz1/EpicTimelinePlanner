"use client";

import type { LucideIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, UserRound, Users, UserX, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { collectStoriesForSprintBoard } from "@/lib/sprint-plan";
import { InitiativeItem, UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { sprintCapacityBucketDropId, storyBoardDraggableId } from "@/lib/epic-dnd-ids";
import {
  defaultMembersForTeam,
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
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
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
        "h-[var(--bucket-row-h)] rounded-none border border-slate-200/90 bg-white/95 px-2 py-1 shadow-sm",
        isDragging && "opacity-60",
      )}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 30 : undefined,
      }}
    >
      <div className="flex h-full items-center gap-2">
        <button
          type="button"
          className="cursor-grab rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 active:cursor-grabbing"
          aria-label="Drag story card"
          {...attributes}
          {...listeners}
        >
          ::
        </button>
        <div className="min-w-0 flex-1 pr-1">
          <button
            type="button"
            className="block w-full truncate text-left text-[13px] font-semibold text-slate-900 hover:text-blue-700"
            onClick={() => onOpenStory(card.id)}
          >
            <span className="mr-1.5 inline-flex align-middle text-slate-600">
              <UserStoryIcon className="size-3.5" />
            </span>
            {card.title}
          </button>
        </div>
        <span className="shrink-0 text-[11px] font-semibold text-slate-600">Est</span>
        <input
          type="number"
          min={0}
          max={20}
          step={1}
          value={card.estimatedDays}
          onChange={(event) => onEstimateChange(card.id, Number(event.target.value || 0))}
          className="h-6 w-12 shrink-0 rounded border border-slate-200 bg-white px-1 text-[11px] font-medium text-slate-800"
        />
        <button
          type="button"
          onClick={() => onUnscheduleStory(card.id)}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Remove story from sprint capacity bucket"
          title="Remove from sprint"
        >
          <X className="size-3.5" aria-hidden />
        </button>
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
  const fillPct = Math.max(0, Math.min(100, (assignedTotal / 10) * 100));
  const overCapacity = assignedTotal > capacity;
  const utilization = capacity > 0 ? (assignedTotal / capacity) * 100 : assignedTotal > 0 ? 200 : 0;
  const thermometerPct = Math.max(0, Math.min(100, utilization));
  const capacityMarkerPct = Math.max(0, Math.min(100, (capacity / 10) * 100));
  const memberGradientKey = member.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const fluidStops = overCapacity
    ? { top: "#fb7185", mid: "#ef4444", bot: "#b91c1c" }
    : utilization >= 85
      ? { top: "#fbbf24", mid: "#f59e0b", bot: "#b45309" }
      : { top: "#22d3ee", mid: "#14b8a6", bot: "#0f766e" };
  const bucketFill =
    "linear-gradient(180deg, rgba(186,230,253,0.06) 0%, rgba(56,189,248,0.16) 45%, rgba(2,132,199,0.30) 100%)";

  return (
    <section
      className={cn(
        "min-w-0 rounded-2xl border border-slate-200/85 bg-gradient-to-br from-slate-50/95 via-indigo-50/45 to-sky-100/55 p-3 shadow-sm ring-1 ring-indigo-100/40",
      )}
    >
      <div className="relative mb-2 flex min-h-8 items-center justify-end pr-0.5">
        <p
          className="pointer-events-none absolute left-1/2 top-1/2 flex max-w-[calc(100%-9rem)] items-center justify-center gap-1.5 pr-[84px] text-center text-[15px] font-bold text-slate-800"
          style={{ transform: "translate(-50%, -50%)" }}
        >
          <Users className="size-4 shrink-0 text-indigo-600/90" aria-hidden />
          <span className="truncate">{member}</span>
        </p>
        <label className="relative z-10 inline-flex translate-x-[3px] items-center gap-1 text-[12px] font-semibold text-slate-600">
          Capacity
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={capacity}
            onChange={(event) => onCapacityChange(Number(event.target.value || 0))}
            className="h-7 w-11 shrink-0 rounded-md border border-slate-200/90 bg-white/90 px-1 text-[11px] font-medium text-slate-800 shadow-sm"
          />
          d
        </label>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_56px] gap-2">
        <div
          ref={setNodeRef}
          style={{ ["--bucket-row-h" as string]: "calc((23rem - 1rem) / 10)" }}
          className={cn(
            "relative flex h-[23rem] flex-col overflow-hidden rounded-2xl border-0 bg-white p-2 transition",
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
        <div className="flex h-[23rem] flex-col items-center p-2">
          <div className="text-center">
            <p className="text-[11px] font-semibold text-slate-600">Load</p>
            <p className="text-[13px] font-bold text-slate-700">
              {Math.round(utilization)}%
            </p>
          </div>
          <div className="flex flex-1 items-center py-1">
            <svg viewBox="0 0 84 292" className="h-full w-[4rem]" aria-label="Capacity gauge">
              <defs>
                <linearGradient id={`track-${member}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f8fafc" />
                  <stop offset="100%" stopColor="#eef2f7" />
                </linearGradient>
                <linearGradient id={`fluid-${memberGradientKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={fluidStops.top} />
                  <stop offset="52%" stopColor={fluidStops.mid} />
                  <stop offset="100%" stopColor={fluidStops.bot} />
                </linearGradient>
              </defs>
              <rect x="28" y="8" width="28" height="274" rx="14" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
              <rect x="34" y="16" width="16" height="242" rx="8" fill={`url(#track-${member})`} stroke="#cbd5e1" strokeWidth="1" />
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
                fill={`url(#fluid-${memberGradientKey})`}
                opacity="0.95"
              />
              {overCapacity ? <AlertTriangle x={30} y={-25} className="size-4 text-rose-600" /> : null}
            </svg>
          </div>
          <div className="text-center text-[11px] font-semibold text-slate-600">
            <p>{assignedTotal.toFixed(1)}d</p>
            <p>/ {capacity.toFixed(1)}d</p>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[12px] font-semibold">
        <span className="text-slate-600">{assignedTotal.toFixed(1)}d planned</span>
        <span className={cn("text-slate-500", overCapacity && "inline-flex items-center gap-1 text-rose-600")}>
          {overCapacity ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
          {capacity.toFixed(1)}d available ({Math.round(utilization)}%)
        </span>
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
  const baseMembers = defaultMembersForTeam(selectedTeamId);
  const extraAssigneeColumns = new Set<string>();
  for (const row of rows) {
    const m = sprintCapacityAssigneeBucket(row.story.assignee, fullRoster);
    if (m && !baseMembers.includes(m)) extraAssigneeColumns.add(m);
  }
  for (const key of Object.keys(capacityBoard.assignments ?? {})) {
    if (key === SPRINT_CAPACITY_OTHER_BUCKET) continue;
    if (!baseMembers.includes(key)) extraAssigneeColumns.add(key);
  }
  const needsOtherColumn =
    (capacityBoard.assignments[SPRINT_CAPACITY_OTHER_BUCKET]?.length ?? 0) > 0 ||
    rows.some((row) => sprintCapacityAssigneeBucket(row.story.assignee, fullRoster) == null);
  const sortedExtras = [...extraAssigneeColumns].sort((a, b) => a.localeCompare(b));
  const members = [
    ...baseMembers,
    ...sortedExtras,
    ...(needsOtherColumn ? [SPRINT_CAPACITY_OTHER_BUCKET] : []),
  ];
  const assigneeFilterOptions = useMemo(() => {
    const fromStories = new Set<string>();
    for (const row of rows) {
      fromStories.add(storyAssigneeDisplayLabel(row.story));
    }
    const roster = [...baseMembers];
    const extra = [...fromStories]
      .filter((n) => n !== "Unassigned" && !roster.includes(n))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const out: string[] = [...roster, ...extra];
    if (fromStories.has("Unassigned")) out.push("Unassigned");
    return out;
  }, [rows, baseMembers]);

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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {visibleMembers.map((member) => {
          const assignedIds = capacityBoard.assignments[member] ?? [];
          const cards = assignedIds.map((id) => storyById.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
          const assignedTotal = cards.reduce((sum, card) => sum + card.estimatedDays, 0);
          return (
            <CapacityBucket
              key={member}
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
          );
        })}
      </div>
    </div>
  );
}
