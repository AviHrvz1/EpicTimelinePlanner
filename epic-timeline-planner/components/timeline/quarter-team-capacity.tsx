"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { GripVertical, Search, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { TeamLoadSummary } from "@/components/timeline/team-load-summary";
import { TeamCapacityBucket } from "@/components/timeline/team-capacity-bucket";
import { type CapacityLoadBasis } from "@/lib/capacity-load-basis";
import { epicStoryEstimateDaysSum } from "@/lib/epic-estimates";
import { collectQuarterEpics } from "@/lib/quarter-analytics";
import {
  quarterTeamCapacityBucketDropId,
  quarterTeamCapacityColumnDragId,
  quarterTeamCapacityColumnDropId,
} from "@/lib/epic-dnd-ids";
import {
  monthTeamCapacityBoardKey,
  orderedMonthTeamCapacityTeams,
  type MonthTeamCapacityBoard,
} from "@/lib/month-team-capacity";
import {
  MONTH_TEAM_COLUMNS,
  MONTH_TEAM_IDS,
  orderedEpicsForTeamInQuarterCapacity,
  type MonthTeamBoardPersisted,
} from "@/lib/month-team-board";
import { nowMs as clockNowMs } from "@/lib/clock";
import { projectInitiativesToCloseDate } from "@/lib/story-snapshot-projection";
import { SnapshotHeaderStrip } from "@/components/timeline/snapshot-header-strip";
import { type InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const Q_CAP_COL_GRIP_CLASS =
  "inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200/90 bg-white/90 p-1.5 text-slate-600 shadow-sm outline-none transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-300";

function QuarterTeamCapacityColumnChrome({
  year,
  quarterLabel,
  teamId,
  reorderEnabled,
  children,
}: {
  year: number;
  quarterLabel: string;
  teamId: string;
  reorderEnabled: boolean;
  children: (reorderGrip: ReactNode) => ReactNode;
}) {
  const dropId = quarterTeamCapacityColumnDropId(year, quarterLabel, teamId);
  const dragId = quarterTeamCapacityColumnDragId(year, quarterLabel, teamId);
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: dropId, disabled: !reorderEnabled });
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: dragId,
    disabled: !reorderEnabled,
  });

  const setColumnRef = (el: HTMLDivElement | null) => {
    setDropRef(el);
    setDragRef(el);
  };

  const columnStyle =
    reorderEnabled && (transform != null || isDragging)
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

  const reorderGrip = reorderEnabled ? (
    <button
      type="button"
      className={cn(Q_CAP_COL_GRIP_CLASS, "cursor-grab active:cursor-grabbing", isDragging && "cursor-grabbing")}
      aria-label="Reorder team column"
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
        reorderEnabled && isOver && !isDragging && "ring-2 ring-dashed ring-indigo-400/45",
        isDragging && "rounded-xl ring-1 ring-slate-300/80",
      )}
      style={columnStyle}
    >
      {children(reorderGrip)}
    </div>
  );
}

function quarterFromMonth(month: number): string {
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

function epicPlanningLabel(epic: InitiativeItem["epics"][number]): string {
  const start = epic.planStartMonth;
  const isPlanned = epic.planSprint != null && start != null && epic.planEndMonth != null;
  if (!isPlanned) return "Unscheduled";
  return quarterFromMonth(start);
}

function epicExecutionStatusMeta(epic: InitiativeItem["epics"][number]): { label: string; className: string } {
  const stories = epic.userStories ?? [];
  if (stories.length === 0) {
    return { label: "To Do", className: "border-amber-200/90 bg-amber-50 text-amber-800" };
  }
  if (stories.every((s) => s.status === "approved")) {
    return { label: "Approved", className: "border-violet-200/90 bg-violet-50 text-violet-800" };
  }
  if (stories.every((s) => s.status === "done" || s.status === "approved")) {
    return { label: "Done", className: "border-emerald-200/90 bg-emerald-50 text-emerald-800" };
  }
  const hasProgress = stories.some(
    (s) => s.status === "inProgress" || s.status === "done" || s.status === "approved",
  );
  if (hasProgress) {
    return { label: "In Progress", className: "border-blue-200/90 bg-blue-50 text-blue-800" };
  }
  return { label: "To Do", className: "border-amber-200/90 bg-amber-50 text-amber-800" };
}

type QuarterTeamCapacityBoardProps = {
  initiatives: InitiativeItem[];
  quarterLabel: string;
  quarterMonths: readonly number[];
  year: number;
  monthTeamCapacityByKey: Record<string, MonthTeamCapacityBoard>;
  onCapacityChange: (teamId: string, quarterTotalDays: number) => void;
  onOpenEpic: (epicId: string) => void;
  onRemoveEpicFromCapacity: (epicId: string) => void;
  onEpicOriginalEstimateChange: (epicId: string, estimatedDays: number) => void;
  teamFilterIds?: string[];
  teamSelectorSlot?: ReactNode;
  /** Per-month team board queues (same keys as month plan) for card ordering and auto-assign. */
  monthTeamBoardByKey?: Record<string, MonthTeamBoardPersisted>;
  loadBasis?: CapacityLoadBasis;
  onLoadBasisChange?: (basis: CapacityLoadBasis) => void;
};

export function QuarterTeamCapacityBoard({
  initiatives,
  quarterLabel,
  quarterMonths,
  year,
  monthTeamCapacityByKey,
  onCapacityChange,
  onOpenEpic,
  onRemoveEpicFromCapacity,
  onEpicOriginalEstimateChange,
  teamFilterIds = [],
  teamSelectorSlot,
  monthTeamBoardByKey = {},
  loadBasis = "originalEstimate",
  onLoadBasisChange,
}: QuarterTeamCapacityBoardProps) {
  // Quarter team capacity reads LIVE state. Without auto-rollover surface
  // overflow, the quarter panel only shows epics planned for this quarter,
  // period.
  const rows = collectQuarterEpics(initiatives, quarterMonths);
  const gradientKey = `quarter-${year}-${quarterLabel}`.replace(/[^a-zA-Z0-9]+/g, "-");
  const gaugeScaleMax = 60 * quarterMonths.length;
  const capacityInputMax = 200 * quarterMonths.length;

  const scopeColumnOrder = useMemo(() => {
    for (const m of quarterMonths) {
      const ord = monthTeamCapacityByKey[monthTeamCapacityBoardKey(year, m)]?.columnOrder;
      if (ord?.length) return ord;
    }
    return undefined;
  }, [year, quarterMonths, monthTeamCapacityByKey]);

  const visibleTeamIds =
    teamFilterIds.length > 0 ? MONTH_TEAM_IDS.filter((id) => teamFilterIds.includes(id)) : [...MONTH_TEAM_IDS];
  const orderedTeamIds = orderedMonthTeamCapacityTeams({
    columnOrder: scopeColumnOrder,
    visibleTeamIds,
  });
  const visibleTeams = orderedTeamIds
    .map((id) => MONTH_TEAM_COLUMNS.find((t) => t.id === id))
    .filter((t): t is (typeof MONTH_TEAM_COLUMNS)[number] => Boolean(t));

  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  useEffect(() => {
    setExpandedTeamId(null);
  }, [year, quarterLabel, teamFilterIds.join(",")]);

  // Epic search — live-filter by epic title or parent initiative title.
  // Same pattern as the month + sprint capacity boards.
  const [epicSearch, setEpicSearch] = useState("");
  useEffect(() => {
    setEpicSearch("");
  }, [year, quarterLabel, teamFilterIds.join(",")]);
  const epicSearchQuery = epicSearch.trim().toLowerCase();
  const searchMatchIds = useMemo(() => {
    if (!epicSearchQuery) return null;
    const matches = new Set<string>();
    for (const row of rows) {
      if (
        row.epic.title.toLowerCase().includes(epicSearchQuery) ||
        row.initiative.title.toLowerCase().includes(epicSearchQuery)
      ) {
        matches.add(row.epic.id);
      }
    }
    return matches;
  }, [epicSearchQuery, rows]);

  const filteredVisibleTeams = useMemo(() => {
    if (!searchMatchIds || searchMatchIds.size === 0) return visibleTeams;
    return visibleTeams.filter((team) =>
      rows.some((row) => row.epic.team === team.id && searchMatchIds.has(row.epic.id)),
    );
  }, [visibleTeams, searchMatchIds, rows]);

  const teamQuarterCapacity = new Map<string, number>();
  for (const team of filteredVisibleTeams) {
    let total = 0;
    for (const month of quarterMonths) {
      const key = monthTeamCapacityBoardKey(year, month);
      total += Number(monthTeamCapacityByKey[key]?.capacities?.[team.id] ?? 20);
    }
    teamQuarterCapacity.set(team.id, total);
  }

  let teamTotalCapacity = 0;
  let teamTotalAssigned = 0;
  for (const team of filteredVisibleTeams) {
    teamTotalCapacity += Number(teamQuarterCapacity.get(team.id) ?? 0);
    const cards = rows.filter((row) => row.epic.team === team.id);
    teamTotalAssigned += cards.reduce((sum, row) => {
      if (loadBasis === "child") return sum + epicStoryEstimateDaysSum(row.epic);
      return sum + Math.max(0, Number(row.epic.originalEstimateDays ?? 0));
    }, 0);
  }

  // Snapshot strip for past quarters. With Phase 3 overflow retired the
  // strip is purely the "frozen at <date>" caption above the panel.
  const quarterEndMonth = quarterMonths[quarterMonths.length - 1]!;
  const quarterEndMs = new Date(year, quarterEndMonth, 0, 23, 59, 59, 999).getTime();
  const isPastQuarter = quarterEndMs < clockNowMs();
  const quarterCloseDateLabel = useMemo(() => {
    const d = new Date(year, quarterEndMonth, 0);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }, [year, quarterEndMonth]);
  const nextQuarterLabel = quarterEndMonth < 12
    ? (quarterEndMonth + 1 <= 3 ? "Q1" : quarterEndMonth + 1 <= 6 ? "Q2" : quarterEndMonth + 1 <= 9 ? "Q3" : "Q4")
    : "next quarter";

  return (
    <div
      className="rounded-2xl border border-slate-300/60 p-4 shadow-sm"
      style={{
        backgroundImage: "linear-gradient(135deg, #eff6ff 0%, #f5f3ff 50%, #fdf2f8 100%)",
      }}
    >
    <div className="space-y-6 pb-6">
      {isPastQuarter ? (
        <SnapshotHeaderStrip
          scope="quarter"
          periodLabel={`${quarterLabel} ${year}`}
          closeDateLabel={quarterCloseDateLabel}
          rolledCount={0}
          nextPeriodLabel={nextQuarterLabel}
        />
      ) : null}
      <TeamLoadSummary
        teamLabel={
          teamFilterIds.length > 1
            ? `${teamFilterIds.length} teams selected`
            : teamFilterIds.length === 1
              ? (visibleTeams[0]?.label ?? "Team")
              : "All teams (combined)"
        }
        teamLabelSlot={teamSelectorSlot}
        gradientKey={gradientKey}
        totalAssigned={teamTotalAssigned}
        totalCapacity={teamTotalCapacity}
        loadBasis={loadBasis}
        onLoadBasisChange={onLoadBasisChange}
        headerRightSlot={(
          <div className="relative w-[18rem] max-w-full" title={
            epicSearchQuery
              ? (searchMatchIds && searchMatchIds.size > 0
                ? `${searchMatchIds.size} match${searchMatchIds.size === 1 ? "" : "es"} — only teams with the epic are shown`
                : "No matching epics this quarter")
              : undefined
          }>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              value={epicSearch}
              onChange={(e) => setEpicSearch(e.target.value)}
              placeholder="Search an epic this quarter…"
              aria-label="Search epics on capacity"
              className="h-7 w-full rounded-md border border-slate-200 bg-white/90 pl-8 pr-8 text-[12.5px] font-medium text-slate-800 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-200/70"
            />
            {epicSearchQuery ? (
              <button
                type="button"
                onClick={() => setEpicSearch("")}
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
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredVisibleTeams.map((team) => {
          if (expandedTeamId != null && expandedTeamId !== team.id) {
            return null;
          }
          const candidates = rows.filter((row) => row.epic.team === team.id);
          const orderedRows = orderedEpicsForTeamInQuarterCapacity(
            initiatives,
            team.id,
            candidates,
            quarterMonths,
            year,
            monthTeamBoardByKey,
          );
          const cards = orderedRows.map((row) => {
              const execution = epicExecutionStatusMeta(row.epic);
              return {
                epicId: row.epic.id,
                icon: row.epic.icon,
                title: row.epic.title,
                initiativeTitle: row.initiative.title,
                loadDays: Math.max(0, Number(row.epic.originalEstimateDays ?? 0)),
                childStoryEstimateDays: epicStoryEstimateDaysSum(row.epic),
                originalEstimateDays: Math.max(0, Number(row.epic.originalEstimateDays ?? 0)),
                planningLabel: epicPlanningLabel(row.epic),
                executionStatusLabel: execution.label,
                executionStatusClassName: execution.className,
              };
          });
          const capacity = Number(teamQuarterCapacity.get(team.id) ?? 0);
          const reorderAllowed = expandedTeamId == null && filteredVisibleTeams.length >= 2;
          return (
            <div
              key={team.id}
              className={cn(
                "box-border w-full min-w-0 max-w-full",
                expandedTeamId === team.id && "col-span-full",
              )}
            >
              <QuarterTeamCapacityColumnChrome
                year={year}
                quarterLabel={quarterLabel}
                teamId={team.id}
                reorderEnabled={reorderAllowed}
              >
                {(reorderGrip) => (
                  <TeamCapacityBucket
                    team={team}
                    teamLabelPrefix="Team:"
                    cards={cards}
                    capacity={capacity}
                    onCapacityChange={(days) => onCapacityChange(team.id, days)}
                    onOpenEpic={onOpenEpic}
                    onRemoveEpicFromCapacity={onRemoveEpicFromCapacity}
                    onEpicOriginalEstimateChange={onEpicOriginalEstimateChange}
                    dropId={quarterTeamCapacityBucketDropId(year, quarterLabel, team.id)}
                    gaugeScaleMax={gaugeScaleMax}
                    capacityInputMax={capacityInputMax}
                    panelExpandable={filteredVisibleTeams.length > 1}
                    isPanelExpanded={expandedTeamId === team.id}
                    onExpandPanel={() => setExpandedTeamId(team.id)}
                    onCollapsePanel={() => setExpandedTeamId(null)}
                    reorderGrip={reorderGrip}
                    loadBasis={loadBasis}
                    highlightEpicIds={searchMatchIds}
                  />
                )}
              </QuarterTeamCapacityColumnChrome>
            </div>
          );
        })}
      </div>
    </div>
    </div>
  );
}
