"use client";

import { type ReactNode, useEffect, useState } from "react";
import { GripVertical } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { TeamLoadSummary } from "@/components/timeline/team-load-summary";
import { TeamCapacityBucket } from "@/components/timeline/team-capacity-bucket";
import { type CapacityLoadBasis } from "@/lib/capacity-load-basis";
import { epicStoryEstimateDaysSum } from "@/lib/epic-estimates";
import {
  monthTeamCapacityBucketDropId,
  monthTeamCapacityColumnDragId,
  monthTeamCapacityColumnDropId,
} from "@/lib/epic-dnd-ids";
import {
  MONTH_TEAM_COLUMNS,
  MONTH_TEAM_IDS,
  collectMonthEpicsForTeamBoard,
  mergeMonthTeamBoardColumns,
  type MonthTeamBoardPersisted,
} from "@/lib/month-team-board";
import { type InitiativeItem } from "@/lib/types";
import {
  orderedMonthTeamCapacityTeams,
  type MonthTeamCapacityBoard,
} from "@/lib/month-team-capacity";
import { cn } from "@/lib/utils";

const MONTH_CAP_COL_GRIP_CLASS =
  "inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200/90 bg-white/90 p-1.5 text-slate-600 shadow-sm outline-none transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-300";

function MonthTeamCapacityColumnChrome({
  year,
  month,
  teamId,
  reorderEnabled,
  children,
}: {
  year: number;
  month: number;
  teamId: string;
  reorderEnabled: boolean;
  children: (reorderGrip: ReactNode) => ReactNode;
}) {
  const dropId = monthTeamCapacityColumnDropId(year, month, teamId);
  const dragId = monthTeamCapacityColumnDragId(year, month, teamId);
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
      className={cn(MONTH_CAP_COL_GRIP_CLASS, "cursor-grab active:cursor-grabbing", isDragging && "cursor-grabbing")}
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

type MonthTeamCapacityProps = {
  initiatives: InitiativeItem[];
  year: number;
  month: number;
  capacityBoard: MonthTeamCapacityBoard;
  onCapacityChange: (teamId: string, days: number) => void;
  onOpenEpic: (epicId: string) => void;
  onRemoveEpicFromCapacity: (epicId: string) => void;
  onEpicOriginalEstimateChange: (epicId: string, estimatedDays: number) => void;
  teamFilterIds?: string[];
  teamSelectorSlot?: ReactNode;
  /** When set, epic cards use the same queue order as the month team board. */
  monthTeamBoardPersisted?: MonthTeamBoardPersisted | null;
  loadBasis?: CapacityLoadBasis;
  onLoadBasisChange?: (basis: CapacityLoadBasis) => void;
};

export function MonthTeamCapacityBoard({
  initiatives,
  year,
  month,
  capacityBoard,
  onCapacityChange,
  onOpenEpic,
  onRemoveEpicFromCapacity,
  onEpicOriginalEstimateChange,
  teamFilterIds = [],
  teamSelectorSlot,
  monthTeamBoardPersisted = null,
  loadBasis = "originalEstimate",
  onLoadBasisChange,
}: MonthTeamCapacityProps) {
  const rows = collectMonthEpicsForTeamBoard(initiatives, month);
  const mergedColumns =
    monthTeamBoardPersisted != null
      ? mergeMonthTeamBoardColumns(initiatives, month, monthTeamBoardPersisted)
      : null;
  const gradientKey = `month-${year}-${month}`.replace(/[^a-zA-Z0-9]+/g, "-");
  const visibleTeamIds =
    teamFilterIds.length > 0 ? MONTH_TEAM_IDS.filter((id) => teamFilterIds.includes(id)) : [...MONTH_TEAM_IDS];
  const orderedTeamIds = orderedMonthTeamCapacityTeams({
    columnOrder: capacityBoard.columnOrder,
    visibleTeamIds,
  });
  const visibleTeams = orderedTeamIds
    .map((id) => MONTH_TEAM_COLUMNS.find((t) => t.id === id))
    .filter((t): t is (typeof MONTH_TEAM_COLUMNS)[number] => Boolean(t));

  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  useEffect(() => {
    setExpandedTeamId(null);
  }, [year, month, teamFilterIds.join(",")]);

  let teamTotalCapacity = 0;
  let teamTotalAssigned = 0;
  for (const team of visibleTeams) {
    const cap = Number(capacityBoard.capacities[team.id] ?? 20);
    teamTotalCapacity += Number.isFinite(cap) ? cap : 0;
    const cardRows =
      mergedColumns != null
        ? (mergedColumns.find((c) => c.team.id === team.id)?.cards ?? [])
        : rows.filter((row) => row.epic.team === team.id);
    teamTotalAssigned += cardRows.reduce((sum, row) => {
      if (loadBasis === "child") return sum + epicStoryEstimateDaysSum(row.epic);
      return sum + Math.max(0, Number(row.epic.originalEstimateDays ?? 0));
    }, 0);
  }

  return (
    <div className="rounded-2xl border border-slate-300/60 bg-slate-200/60 p-4 shadow-sm">
    <div className="space-y-6 pb-6">
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
      />
      <div className="flex flex-wrap gap-6">
        {visibleTeams.map((team) => {
          if (expandedTeamId != null && expandedTeamId !== team.id) {
            return null;
          }
          const cardRows =
            mergedColumns != null
              ? (mergedColumns.find((c) => c.team.id === team.id)?.cards ?? [])
              : rows.filter((row) => row.epic.team === team.id);
          const cards = cardRows.map((row) => {
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
          const reorderAllowed = expandedTeamId == null && visibleTeams.length >= 2;
          return (
            <div
              key={team.id}
              className={cn(
                "box-border w-full max-w-full min-w-[min(100%,23rem)] grow basis-[23rem]",
                expandedTeamId === team.id && "min-w-0 basis-full max-w-none",
              )}
            >
              <MonthTeamCapacityColumnChrome
                year={year}
                month={month}
                teamId={team.id}
                reorderEnabled={reorderAllowed}
              >
                {(reorderGrip) => (
                  <TeamCapacityBucket
                    team={team}
                    teamLabelPrefix="Team:"
                    cards={cards}
                    capacity={Number(capacityBoard.capacities[team.id] ?? 20)}
                    onCapacityChange={(days) => onCapacityChange(team.id, days)}
                    onOpenEpic={onOpenEpic}
                    onRemoveEpicFromCapacity={onRemoveEpicFromCapacity}
                    onEpicOriginalEstimateChange={onEpicOriginalEstimateChange}
                    dropId={monthTeamCapacityBucketDropId(year, month, team.id)}
                    gaugeScaleMax={60}
                    capacityInputMax={200}
                    panelExpandable={visibleTeams.length > 1}
                    isPanelExpanded={expandedTeamId === team.id}
                    onExpandPanel={() => setExpandedTeamId(team.id)}
                    onCollapsePanel={() => setExpandedTeamId(null)}
                    reorderGrip={reorderGrip}
                    loadBasis={loadBasis}
                  />
                )}
              </MonthTeamCapacityColumnChrome>
            </div>
          );
        })}
      </div>
    </div>
    </div>
  );
}
