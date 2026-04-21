"use client";

import { AlertTriangle, Users } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import { monthTeamCapacityBucketDropId, epicTimelineDraggableId } from "@/lib/epic-dnd-ids";
import { MONTH_TEAM_COLUMNS, collectMonthEpicsForTeamBoard } from "@/lib/month-team-board";
import { type InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { type MonthTeamCapacityBoard } from "@/lib/month-team-capacity";

type MonthTeamCapacityProps = {
  initiatives: InitiativeItem[];
  year: number;
  month: number;
  capacityBoard: MonthTeamCapacityBoard;
  onCapacityChange: (teamId: string, days: number) => void;
  onOpenEpic: (epicId: string) => void;
};

function TeamEpicCard({
  epicId,
  title,
  initiativeTitle,
  loadDays,
  onOpenEpic,
}: {
  epicId: string;
  title: string;
  initiativeTitle: string;
  loadDays: number;
  onOpenEpic: (epicId: string) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({
    id: epicTimelineDraggableId(epicId),
  });

  return (
    <article
      ref={setNodeRef}
      className={cn(
        "rounded-lg border border-slate-200/90 bg-white/95 p-2 shadow-sm",
        isDragging && "opacity-60",
      )}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 30 : undefined,
      }}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 cursor-grab rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 active:cursor-grabbing"
          aria-label="Drag epic card"
          {...attributes}
          {...listeners}
        >
          ::
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpenEpic(epicId)}
            className="block w-full truncate text-left text-[13px] font-semibold text-slate-900 hover:text-blue-700"
          >
            {title}
          </button>
          <p className="truncate text-[11px] text-slate-500">{initiativeTitle}</p>
        </div>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
          {loadDays.toFixed(1)}d
        </span>
      </div>
    </article>
  );
}

export function MonthTeamCapacityBoard({
  initiatives,
  year,
  month,
  capacityBoard,
  onCapacityChange,
  onOpenEpic,
}: MonthTeamCapacityProps) {
  const rows = collectMonthEpicsForTeamBoard(initiatives, month);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 text-[13px] font-medium text-slate-600">
        Drag epics into team buckets to plan monthly load. Team utilization is based on total estimated story days in assigned epics.
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {MONTH_TEAM_COLUMNS.map((team) => {
          const cards = rows
            .filter((row) => row.epic.team === team.id)
            .map((row) => ({
              epicId: row.epic.id,
              title: row.epic.title,
              initiativeTitle: row.initiative.title,
              loadDays: (row.epic.userStories ?? []).reduce((sum, s) => sum + Number(s.estimatedDays ?? 0), 0),
            }));
          return (
            <TeamCapacityBucket
              key={team.id}
              team={team}
              year={year}
              month={month}
              cards={cards}
              capacity={Number(capacityBoard.capacities[team.id] ?? 20)}
              onCapacityChange={(days) => onCapacityChange(team.id, days)}
              onOpenEpic={onOpenEpic}
            />
          );
        })}
      </div>
    </div>
  );
}

function TeamCapacityBucket({
  team,
  year,
  month,
  cards,
  capacity,
  onCapacityChange,
  onOpenEpic,
}: {
  team: (typeof MONTH_TEAM_COLUMNS)[number];
  year: number;
  month: number;
  cards: Array<{ epicId: string; title: string; initiativeTitle: string; loadDays: number }>;
  capacity: number;
  onCapacityChange: (days: number) => void;
  onOpenEpic: (epicId: string) => void;
}) {
  const assignedTotal = cards.reduce((sum, c) => sum + c.loadDays, 0);
  const utilization = capacity > 0 ? (assignedTotal / capacity) * 100 : assignedTotal > 0 ? 200 : 0;
  const overCapacity = assignedTotal > capacity;
  const fillPct = Math.max(0, Math.min(100, capacity > 0 ? (assignedTotal / capacity) * 100 : 0));
  const gaugePct = Math.max(0, Math.min(100, utilization));
  const markerPct = Math.max(0, Math.min(100, (capacity / 60) * 100));
  const dropId = monthTeamCapacityBucketDropId(year, month, team.id);
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  const gradientKey = team.id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const fluidStops = overCapacity
    ? { top: "#fb7185", mid: "#ef4444", bot: "#b91c1c" }
    : utilization >= 85
      ? { top: "#fbbf24", mid: "#f59e0b", bot: "#b45309" }
      : { top: "#22d3ee", mid: "#14b8a6", bot: "#0f766e" };
  const bucketFill =
    "linear-gradient(180deg, rgba(186,230,253,0.06) 0%, rgba(56,189,248,0.16) 45%, rgba(2,132,199,0.30) 100%)";
  return (
    <section className={cn("min-w-0 rounded-2xl border bg-white p-3 shadow-sm ring-1 ring-slate-100/70", team.tone)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-[15px] font-bold text-slate-800">
          <span className="mr-1.5 inline-flex align-middle text-slate-600">
            <Users className="size-4" />
          </span>
          {team.label}
        </p>
        <label className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-600">
          Capacity
          <input
            type="number"
            min={0}
            max={200}
            step={1}
            value={capacity}
            onChange={(event) => onCapacityChange(Number(event.target.value || 0))}
            className="h-7 w-14 rounded-md border border-slate-200 bg-white px-1 text-[11px] font-medium text-slate-800"
          />
          d
        </label>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_56px] gap-2">
        <div
          ref={setNodeRef}
          className={cn(
            "relative min-h-[21rem] overflow-hidden rounded-2xl border border-slate-300/80 bg-white p-2 transition",
            isOver && "border-primary ring-2 ring-primary/20",
          )}
        >
          <img
            src="/images/sprint-capacity-bucket.svg"
            alt="Team capacity bucket"
            className="pointer-events-none absolute top-1 left-1/2 h-[88%] w-[92%] -translate-x-1/2 object-contain opacity-30"
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] transition-all"
            style={{ height: `${fillPct}%`, background: bucketFill }}
          />
          <div className="relative z-20 flex h-full max-h-full flex-col-reverse gap-2 overflow-y-auto">
            {cards.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-200 bg-white/75 p-3 text-center text-[12px] font-medium text-slate-500">
                Drop epic here
              </p>
            ) : (
              cards.map((card) => <TeamEpicCard key={card.epicId} {...card} onOpenEpic={onOpenEpic} />)
            )}
          </div>
        </div>
        <div className="flex min-h-[21rem] flex-col items-center rounded-2xl border border-slate-200/90 bg-slate-50/80 p-2">
          <div className="text-center">
            <p className="text-[11px] font-semibold text-slate-600">Load</p>
            <p className="text-[13px] font-bold text-slate-700">{Math.round(utilization)}%</p>
          </div>
          <div className="flex flex-1 items-center py-1">
            <svg viewBox="0 0 84 292" className="h-full w-[4rem]" aria-label="Team capacity gauge">
              <defs>
                <linearGradient id={`track-${team.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f8fafc" />
                  <stop offset="100%" stopColor="#eef2f7" />
                </linearGradient>
                <linearGradient id={`fluid-${gradientKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={fluidStops.top} />
                  <stop offset="52%" stopColor={fluidStops.mid} />
                  <stop offset="100%" stopColor={fluidStops.bot} />
                </linearGradient>
              </defs>
              <rect x="28" y="8" width="28" height="274" rx="14" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
              <rect x="34" y="16" width="16" height="242" rx="8" fill={`url(#track-${team.id})`} stroke="#cbd5e1" strokeWidth="1" />
              {Array.from({ length: 10 }, (_, i) => {
                const y = 258 - i * 24.2;
                return <line key={i} x1="56" y1={y} x2="66" y2={y} stroke="#94a3b8" strokeWidth="1.5" opacity="0.9" />;
              })}
              <line
                x1="24"
                x2="68"
                y1={258 - (markerPct / 100) * 242}
                y2={258 - (markerPct / 100) * 242}
                stroke="#64748b"
                strokeWidth="1.5"
                strokeDasharray="2 3"
                opacity="0.85"
              />
              <rect
                x="36"
                y={258 - (gaugePct / 100) * 242}
                width="12"
                height={(gaugePct / 100) * 242}
                rx="6"
                fill={`url(#fluid-${gradientKey})`}
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
        <span className="inline-flex items-center gap-1 text-slate-600">{assignedTotal.toFixed(1)}d planned</span>
        <span className={cn("text-slate-500", overCapacity && "inline-flex items-center gap-1 text-rose-600")}>
          {overCapacity ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
          {capacity.toFixed(1)}d available ({Math.round(utilization)}%)
        </span>
      </div>
    </section>
  );
}
