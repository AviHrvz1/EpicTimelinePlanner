"use client";

import { TeamLoadSummary } from "@/components/timeline/team-load-summary";
import { TeamCapacityBucket } from "@/components/timeline/team-capacity-bucket";
import { epicEffectiveEstimateDays } from "@/lib/epic-estimates";
import { monthTeamCapacityBucketDropId } from "@/lib/epic-dnd-ids";
import { MONTH_TEAM_COLUMNS, collectMonthEpicsForTeamBoard } from "@/lib/month-team-board";
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
};

export function MonthTeamCapacityBoard({
  initiatives,
  year,
  month,
  capacityBoard,
  onCapacityChange,
  onOpenEpic,
  onRemoveEpicFromCapacity,
}: MonthTeamCapacityProps) {
  const rows = collectMonthEpicsForTeamBoard(initiatives, month);
  const gradientKey = `month-${year}-${month}`.replace(/[^a-zA-Z0-9]+/g, "-");

  let teamTotalCapacity = 0;
  let teamTotalAssigned = 0;
  for (const team of MONTH_TEAM_COLUMNS) {
    const cap = Number(capacityBoard.capacities[team.id] ?? 20);
    teamTotalCapacity += Number.isFinite(cap) ? cap : 0;
    const cards = rows.filter((row) => row.epic.team === team.id);
    teamTotalAssigned += cards.reduce(
      (sum, row) => sum + epicEffectiveEstimateDays(row.epic, "auto"),
      0,
    );
  }

  return (
    <div className="space-y-6 pb-6">
      <TeamLoadSummary
        teamLabel="All teams (combined)"
        gradientKey={gradientKey}
        totalAssigned={teamTotalAssigned}
        totalCapacity={teamTotalCapacity}
      />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {MONTH_TEAM_COLUMNS.map((team) => {
          const cards = rows
            .filter((row) => row.epic.team === team.id)
            .map((row) => {
              const execution = epicExecutionStatusMeta(row.epic);
              return {
                epicId: row.epic.id,
                icon: row.epic.icon,
                title: row.epic.title,
                initiativeTitle: row.initiative.title,
                loadDays: epicEffectiveEstimateDays(row.epic, "auto"),
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
