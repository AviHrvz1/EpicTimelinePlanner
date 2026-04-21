"use client";

import { TeamLoadSummary } from "@/components/timeline/team-load-summary";
import { TeamCapacityBucket } from "@/components/timeline/team-capacity-bucket";
import { epicEffectiveEstimateDays } from "@/lib/epic-estimates";
import { monthTeamCapacityBucketDropId } from "@/lib/epic-dnd-ids";
import { MONTH_TEAM_COLUMNS, collectMonthEpicsForTeamBoard } from "@/lib/month-team-board";
import { type InitiativeItem } from "@/lib/types";
import { type MonthTeamCapacityBoard } from "@/lib/month-team-capacity";

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
            .map((row) => ({
              epicId: row.epic.id,
              icon: row.epic.icon,
              title: row.epic.title,
              initiativeTitle: row.initiative.title,
              loadDays: epicEffectiveEstimateDays(row.epic, "auto"),
            }));
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
