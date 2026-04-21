"use client";

import { AlertTriangle } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { collectStoriesForSprintBoard } from "@/lib/sprint-plan";
import { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { sprintCapacityBucketDropId, storyBoardDraggableId } from "@/lib/epic-dnd-ids";
import { defaultMembersForTeam, type SprintCapacityBoard as SprintCapacityBoardState } from "@/lib/sprint-capacity";

type SprintCapacityBoardProps = {
  initiatives: InitiativeItem[];
  month: number;
  yearSprint: number;
  selectedTeamId?: string | null;
  capacityBoard: SprintCapacityBoardState;
  onCapacityChange: (member: string, days: number) => void;
  onEstimateChange: (storyId: string, estimatedDays: number) => void;
  onOpenStory: (storyId: string) => void;
};

function CapacityStoryCard({
  card,
  onEstimateChange,
  onOpenStory,
}: {
  card: { id: string; title: string; epicTitle: string; estimatedDays: number };
  onEstimateChange: (storyId: string, estimatedDays: number) => void;
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
            className="truncate text-left text-[12px] font-semibold text-slate-900 hover:text-blue-700"
            onClick={() => onOpenStory(card.id)}
          >
            {card.title}
          </button>
        </div>
        <span className="shrink-0 text-[10px] font-medium text-slate-600">Est</span>
        <input
          type="number"
          min={0}
          max={20}
          step={1}
          value={card.estimatedDays}
          onChange={(event) => onEstimateChange(card.id, Number(event.target.value || 0))}
          className="h-6 w-14 shrink-0 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-800"
        />
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
  onOpenStory: (storyId: string) => void;
}) {
  const dropId = sprintCapacityBucketDropId(yearSprint, teamKey, member);
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  const fillPct = Math.max(0, Math.min(100, (assignedTotal / 10) * 100));
  const overCapacity = assignedTotal > capacity;
  const utilization = capacity > 0 ? (assignedTotal / capacity) * 100 : assignedTotal > 0 ? 200 : 0;
  const thermometerPct = Math.max(0, Math.min(100, utilization));
  const thermometerTone = overCapacity
    ? "bg-rose-500"
    : utilization >= 85
      ? "bg-amber-500"
      : "bg-emerald-500";

  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-slate-100/70">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-bold text-slate-800">{member}</p>
        <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600">
          Capacity
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={capacity}
            onChange={(event) => onCapacityChange(Number(event.target.value || 0))}
            className="h-7 w-14 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] text-slate-800"
          />
          d
        </label>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_56px] gap-2">
        <div
          ref={setNodeRef}
          style={{ ["--bucket-row-h" as string]: "calc((27rem - 1rem) / 10)" }}
          className={cn(
            "relative min-h-[27rem] overflow-hidden rounded-2xl border border-slate-300/80 bg-slate-50 p-2 transition",
            isOver && "border-primary bg-primary/5 ring-2 ring-primary/20",
          )}
        >
          <img
            src="/images/sprint-capacity-bucket.svg"
            alt="Capacity bucket"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30"
          />
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className="pointer-events-none absolute inset-x-0 border-t border-slate-300/35"
              style={{ top: `${(i + 1) * 10}%` }}
            />
          ))}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 z-[1] bg-gradient-to-t transition-all",
              overCapacity ? "from-rose-400/45 to-amber-200/20" : "from-sky-400/35 to-cyan-200/10",
            )}
            style={{ height: `${fillPct}%` }}
          />
          <div className="relative z-20 flex h-full max-h-full flex-col-reverse gap-2 overflow-y-auto">
            {cards.map((card) => (
              <CapacityStoryCard
                key={card.id}
                card={card}
                onEstimateChange={onEstimateChange}
                onOpenStory={onOpenStory}
              />
            ))}
          </div>
        </div>
        <div className="flex min-h-[27rem] flex-col items-center justify-between rounded-2xl border border-slate-200/90 bg-slate-50/80 p-2">
          <div className="text-center">
            <p className="text-[10px] font-semibold text-slate-600">Load</p>
            <p className={cn("text-[11px] font-bold", overCapacity ? "text-rose-600" : "text-slate-700")}>
              {Math.round(utilization)}%
            </p>
          </div>
          <div className="relative h-[15.5rem] w-8 overflow-hidden rounded-full border border-slate-300 bg-white">
            <div
              className={cn("absolute bottom-0 inset-x-0 transition-all", thermometerTone)}
              style={{ height: `${thermometerPct}%` }}
            />
          </div>
          <div className="text-center text-[10px] font-semibold text-slate-600">
            <p>{assignedTotal.toFixed(1)}d</p>
            <p>/ {capacity.toFixed(1)}d</p>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] font-semibold">
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
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-2 text-[12px] text-slate-600">
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
              onOpenStory={onOpenStory}
            />
          );
        })}
      </div>
    </div>
  );
}
