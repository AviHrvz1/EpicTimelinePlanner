"use client";

import { TeamLoadSummary } from "@/components/timeline/team-load-summary";
import { TeamCapacityBucket } from "@/components/timeline/team-capacity-bucket";
import { epicEffectiveEstimateDays } from "@/lib/epic-estimates";
import { collectQuarterEpics } from "@/lib/quarter-analytics";
import { quarterTeamCapacityBucketDropId } from "@/lib/epic-dnd-ids";
import { monthTeamCapacityBoardKey, type MonthTeamCapacityBoard } from "@/lib/month-team-capacity";
import { MONTH_TEAM_COLUMNS } from "@/lib/month-team-board";
import { type InitiativeItem } from "@/lib/types";

function quarterFromMonth(month: number): string {
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

function epicPlanningLabel(epic: InitiativeItem["epics"][number]): string {
  const isPlanned = epic.planSprint != null && epic.planStartMonth != null && epic.planEndMonth != null;
  if (!isPlanned) return "Unscheduled";
  return quarterFromMonth(epic.planStartMonth);
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
}: QuarterTeamCapacityBoardProps) {
  const rows = collectQuarterEpics(initiatives, quarterMonths);
  const gradientKey = `quarter-${year}-${quarterLabel}`.replace(/[^a-zA-Z0-9]+/g, "-");
  const gaugeScaleMax = 60 * quarterMonths.length;
  const capacityInputMax = 200 * quarterMonths.length;

  const teamQuarterCapacity = new Map<string, number>();
  for (const team of MONTH_TEAM_COLUMNS) {
    let total = 0;
    for (const month of quarterMonths) {
      const key = monthTeamCapacityBoardKey(year, month);
      total += Number(monthTeamCapacityByKey[key]?.capacities?.[team.id] ?? 20);
    }
    teamQuarterCapacity.set(team.id, total);
  }

  let teamTotalCapacity = 0;
  let teamTotalAssigned = 0;
  for (const team of MONTH_TEAM_COLUMNS) {
    teamTotalCapacity += Number(teamQuarterCapacity.get(team.id) ?? 0);
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
          const capacity = Number(teamQuarterCapacity.get(team.id) ?? 0);
          return (
            <TeamCapacityBucket
              key={team.id}
              team={team}
              teamLabelPrefix="Team:"
              cards={cards}
              capacity={capacity}
              onCapacityChange={(days) => onCapacityChange(team.id, days)}
              onOpenEpic={onOpenEpic}
              onRemoveEpicFromCapacity={onRemoveEpicFromCapacity}
              dropId={quarterTeamCapacityBucketDropId(year, quarterLabel, team.id)}
              gaugeScaleMax={gaugeScaleMax}
              capacityInputMax={capacityInputMax}
            />
          );
        })}
      </div>
    </div>
  );
}
