"use client";

import { AlertTriangle, Users, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { collectStoriesForSprintBoard } from "@/lib/sprint-plan";
import { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { sprintCapacityBucketDropId, storyBoardDraggableId } from "@/lib/epic-dnd-ids";
import { defaultMembersForTeam, type SprintCapacityBoard as SprintCapacityBoardState } from "@/lib/sprint-capacity";
import { UserStoryIcon } from "@/components/ui/user-story-icon";

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
        "h-[var(--bucket-row-h)] rounded-lg border border-slate-200/90 bg-white/95 px-2 py-1 shadow-sm",
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
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-slate-100/70">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-[15px] font-bold text-slate-800">
          <span className="mr-1.5 inline-flex align-middle text-slate-600">
            <Users className="size-4" />
          </span>
          {member}
        </p>
        <label className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-600">
          Capacity
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={capacity}
            onChange={(event) => onCapacityChange(Number(event.target.value || 0))}
            className="h-7 w-12 rounded-md border border-slate-200 bg-white px-1 text-[11px] font-medium text-slate-800"
          />
          d
        </label>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_56px] gap-2">
        <div
          ref={setNodeRef}
          style={{ ["--bucket-row-h" as string]: "calc((23rem - 1rem) / 10)" }}
          className={cn(
            "relative min-h-[23rem] overflow-hidden rounded-2xl border border-slate-300/80 bg-slate-50 p-2 transition",
            isOver && "border-primary bg-primary/5 ring-2 ring-primary/20",
          )}
        >
          <img
            src="/images/sprint-capacity-bucket.svg"
            alt="Capacity bucket"
            className="pointer-events-none absolute inset-y-0 left-1/2 h-full w-[94%] -translate-x-1/2 object-contain opacity-30"
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] transition-all"
            style={{
              height: `${fillPct}%`,
              background: bucketFill,
            }}
          />
          <div className="relative z-20 flex h-full max-h-full flex-col-reverse gap-2 overflow-y-auto">
            {cards.map((card) => (
              <CapacityStoryCard
                key={card.id}
                card={card}
                onEstimateChange={onEstimateChange}
                onUnscheduleStory={onUnscheduleStory}
                onOpenStory={onOpenStory}
              />
            ))}
          </div>
        </div>
        <div className="flex min-h-[23rem] flex-col items-center rounded-2xl border border-slate-200/90 bg-slate-50/80 p-2">
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
              {overCapacity ? <AlertTriangle x={38} y={-2} className="size-4 text-rose-600" /> : null}
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
  const members = defaultMembersForTeam(selectedTeamId);
  const teamKey = selectedTeamId ?? "all";

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 text-[13px] font-medium text-slate-600">
        Drag user stories from the left panel into a developer bucket. Bucket fill and warnings update from planned vs available days.
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {members.map((member) => {
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
