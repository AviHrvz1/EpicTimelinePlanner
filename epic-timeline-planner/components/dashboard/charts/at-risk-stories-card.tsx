"use client";

import { AlertTriangle, CheckCircle2, User } from "lucide-react";

import { buildSprintAnalytics } from "@/lib/sprint-analytics";
import { monthTeamLabelForId } from "@/lib/month-team-board";
import type { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  /** Single-team filter. */
  team?: string | null;
  /** Multi-team filter — non-empty array takes priority over `team`. */
  teams?: string[] | null;
};

type RiskRow = {
  id: string;
  title: string;
  assignee: string;
  team: string | null;
  daysLeft: number;
  /** How many days the story's daysLeft exceeds the calendar days remaining in the sprint. */
  overByDays: number;
};

/**
 * Gadget — lists in-progress stories whose remaining work exceeds the sprint's
 * calendar days remaining, sorted by severity. Shows up to MAX rows with an
 * "and N more" line when truncated. Empty state celebrates the clean slate.
 */
const MAX = 5;

export function AtRiskStoriesCard({ initiatives, year, sprint, team, teams }: Props) {
  const month = Math.ceil(sprint / 2);
  const teamsFilter: string[] | null = (teams && teams.length > 0) ? teams : (team ? [team] : null);
  const teamFilterSet = teamsFilter ? new Set(teamsFilter) : null;
  const analytics = buildSprintAnalytics(initiatives, month, sprint, "daysLeft", year, teamsFilter);
  const sprintDaysLeft = analytics.workloadSprintCalendarDaysLeft;
  const sprintEnded = sprintDaysLeft === 0;

  const rows: RiskRow[] = [];
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled" || initiative.startMonth == null || initiative.endMonth == null) continue;
    if (initiative.endMonth < month || initiative.startMonth > month) continue;
    for (const epic of initiative.epics ?? []) {
      if (teamFilterSet && !teamFilterSet.has(epic.team ?? "")) continue;
      for (const story of epic.userStories ?? []) {
        if (story.status !== "inProgress") continue;
        if (story.sprint !== sprint) continue;
        const daysLeft = Math.max(0, story.daysLeft ?? 0);
        // Sprint ended → anything still open is over. Otherwise compare against the calendar days remaining.
        const over = sprintEnded ? daysLeft : daysLeft - sprintDaysLeft;
        if (over <= 0) continue;
        rows.push({
          id: story.id,
          title: story.title,
          assignee: story.assignee?.trim() || "Unassigned",
          team: epic.team ?? null,
          daysLeft,
          overByDays: over,
        });
      }
    }
  }
  rows.sort((a, b) => b.overByDays - a.overByDays);
  const shown = rows.slice(0, MAX);
  const hiddenCount = rows.length - shown.length;

  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
          <CheckCircle2 className="size-6 text-emerald-500" />
        </div>
        <p className="text-[14px] font-semibold text-slate-800">No at-risk stories</p>
        <p className="px-3 text-[12px] text-slate-500">
          {sprintEnded
            ? "Sprint wrapped without leftovers."
            : `${sprintDaysLeft} ${sprintDaysLeft === 1 ? "day" : "days"} of sprint left — everything still fits.`}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex shrink-0 items-center justify-between text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
          <AlertTriangle className="size-3.5 text-amber-500" aria-hidden />
          {rows.length} at-risk · {sprintEnded ? "sprint ended" : `${sprintDaysLeft}d left in sprint`}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {shown.map((row) => {
          const severity: "amber" | "rose" = row.overByDays >= 3 ? "rose" : "amber";
          return (
            <div
              key={row.id}
              className={cn(
                "flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 ring-1 transition-colors",
                severity === "rose" ? "ring-rose-200/80" : "ring-amber-200/80",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full ring-1",
                  severity === "rose"
                    ? "bg-rose-50 text-rose-700 ring-rose-200/80"
                    : "bg-amber-50 text-amber-700 ring-amber-200/80",
                )}
              >
                <AlertTriangle className="size-3" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-slate-800">{row.title}</p>
                <p className="mt-px flex items-center gap-1.5 text-[11px] text-slate-500">
                  <User className="size-3 shrink-0 text-slate-400" aria-hidden />
                  <span className="truncate">{row.assignee}</span>
                  {row.team && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="truncate">{monthTeamLabelForId(row.team) ?? row.team}</span>
                    </>
                  )}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-px text-[10px] font-bold tabular-nums",
                  severity === "rose" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700",
                )}
                title={`Story has ${row.daysLeft}d of work but the sprint has ${sprintDaysLeft}d left`}
              >
                +{row.overByDays}d
              </span>
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <p className="px-1 pt-1 text-[11px] text-slate-500">… and {hiddenCount} more at-risk {hiddenCount === 1 ? "story" : "stories"}</p>
        )}
      </div>
    </div>
  );
}
