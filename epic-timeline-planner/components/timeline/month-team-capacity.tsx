"use client";

import { type ReactNode } from "react";
import { TeamLoadSummary } from "@/components/timeline/team-load-summary";
import { TeamCapacityBucket } from "@/components/timeline/team-capacity-bucket";
import { epicStoryEstimateDaysSum } from "@/lib/epic-estimates";
import { monthTeamCapacityBucketDropId } from "@/lib/epic-dnd-ids";
import {
  MONTH_TEAM_COLUMNS,
  collectMonthEpicsForTeamBoard,
  mergeMonthTeamBoardColumns,
  type MonthTeamBoardPersisted,
} from "@/lib/month-team-board";
import { type InitiativeItem } from "@/lib/types";
import { type MonthTeamCapacityBoard } from "@/lib/month-team-capacity";

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
}: MonthTeamCapacityProps) {
  const rows = collectMonthEpicsForTeamBoard(initiatives, month);
  const mergedColumns =
    monthTeamBoardPersisted != null
      ? mergeMonthTeamBoardColumns(initiatives, month, monthTeamBoardPersisted)
      : null;
  const gradientKey = `month-${year}-${month}`.replace(/[^a-zA-Z0-9]+/g, "-");
  const visibleTeams =
    teamFilterIds.length > 0
      ? MONTH_TEAM_COLUMNS.filter((team) => teamFilterIds.includes(team.id))
      : MONTH_TEAM_COLUMNS;

  let teamTotalCapacity = 0;
  let teamTotalAssigned = 0;
  for (const team of visibleTeams) {
    const cap = Number(capacityBoard.capacities[team.id] ?? 20);
    teamTotalCapacity += Number.isFinite(cap) ? cap : 0;
    const cardRows =
      mergedColumns != null
        ? (mergedColumns.find((c) => c.team.id === team.id)?.cards ?? [])
        : rows.filter((row) => row.epic.team === team.id);
    teamTotalAssigned += cardRows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.epic.originalEstimateDays ?? 0)),
      0,
    );
  }

  return (
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
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {visibleTeams.map((team) => {
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
          return (
            <TeamCapacityBucket
              key={team.id}
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
            />
          );
        })}
      </div>
    </div>
  );
}
