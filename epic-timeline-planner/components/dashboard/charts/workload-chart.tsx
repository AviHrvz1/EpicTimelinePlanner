"use client";

import { AlertTriangle, User, Users } from "lucide-react";

import { buildSprintAnalytics } from "@/lib/sprint-analytics";
import { InitiativeItem } from "@/lib/types";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { cn } from "@/lib/utils";

/** Per-team color classes for the avatar swatch — falls back to violet for unknown teams / assignee rows. */
const TEAM_AVATAR_CLASS: Record<string, string> = {
  platform:   "bg-sky-100 text-sky-700 ring-sky-200/80",
  experience: "bg-violet-100 text-violet-700 ring-violet-200/80",
  data:       "bg-amber-100 text-amber-700 ring-amber-200/80",
  mobile:     "bg-emerald-100 text-emerald-700 ring-emerald-200/80",
  growth:     "bg-rose-100 text-rose-700 ring-rose-200/80",
};
function teamAvatarClass(teamId: string | null | undefined): string {
  return (teamId && TEAM_AVATAR_CLASS[teamId]) || "bg-violet-100 text-violet-700 ring-violet-200/80";
}

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  /** Single-team filter (assignee rows). */
  team?: string | null;
  /** Multi-team filter — when 2+ teams are picked the chart shows one row per team. Takes priority over `team`. */
  teams?: string[] | null;
  metric?: "daysLeft" | "storyCount";
};

/**
 * Workload — dashboard view mirroring the insights "Sprint Load" panel:
 * per-assignee (or per-team when no/multiple team filter) row with avatar initials, label,
 * days/stories breakdown, and a progress bar. Color flips to amber when work
 * exceeds the sprint days remaining, emerald when nothing is left.
 */
export function WorkloadChart({ initiatives, year, quarter, sprint, team, teams, metric = "daysLeft" }: Props) {
  const month = Math.ceil(sprint / 2);
  const teamsFilter: string[] | null = (teams && teams.length > 0) ? teams : (team ? [team] : null);
  const analytics = buildSprintAnalytics(initiatives, month, sprint, metric, year, teamsFilter);

  // Team mode shows one row per team and kicks in for 0 or 2+ teams selected (matches sprint-analytics convention).
  const teamMode = !teamsFilter || teamsFilter.length !== 1;
  const sprintDaysLeft = analytics.workloadSprintCalendarDaysLeft;
  const sprintEnded = sprintDaysLeft === 0;
  const useDays = metric === "daysLeft";

  type Row = {
    key: string;
    label: string;
    initials: string;
    /** Team id (null when this row IS an assignee in single-team mode). Drives the colored avatar in team mode. */
    teamId: string | null;
    // Days mode
    daysLeft: number;
    estTotal: number;
    // Stories mode
    openCount: number;
    totalStories: number;
  };
  const rows: Row[] = teamMode
    ? analytics.workloadByTeam.map((t) => ({
        key: t.teamLabel,
        label: t.teamLabel,
        initials: t.teamLabel.slice(0, 2).toUpperCase(),
        teamId: t.teamId ?? null,
        daysLeft: t.daysLeftTotal,
        estTotal: t.estimatedTotal,
        openCount: t.openCount,
        totalStories: t.storiesByStatus.todo + t.storiesByStatus.inProgress + t.storiesByStatus.done + t.storiesByStatus.approved,
      }))
    : analytics.workloadByAssignee.map((r) => ({
        key: r.assignee,
        label: r.assignee,
        initials: r.assignee.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join(""),
        teamId: null,
        daysLeft: r.daysLeftTotal,
        estTotal: r.estimatedTotal,
        openCount: r.openCount,
        totalStories: r.storiesByStatus.todo + r.storiesByStatus.inProgress + r.storiesByStatus.done + r.storiesByStatus.approved,
      }));

  if (rows.length === 0) {
    return <p className="flex h-full min-h-[180px] items-center justify-center text-xs text-slate-400">No workload for this sprint</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">

      {/* Per-assignee / per-team rows */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {rows.map((row) => {
          const remaining = useDays ? row.daysLeft : row.openCount;
          const total = useDays ? row.estTotal : row.totalStories;
          const done = Math.max(0, total - remaining);
          const rawPct = total > 0 ? (done / total) * 100 : 100;
          const donePct = Math.max(0, Math.min(100, Math.round(rawPct)));
          const atRisk = useDays && sprintDaysLeft > 0 && row.daysLeft > sprintDaysLeft;
          const showEnded = useDays && sprintEnded && row.daysLeft > 0;
          const overByDays = atRisk ? row.daysLeft - sprintDaysLeft : 0;
          const allDone = remaining === 0 && total > 0;
          return (
            <div
              key={row.key}
              className={cn(
                "rounded-lg bg-white px-2 py-1.5 transition-colors hover:bg-slate-50/60",
                atRisk && "hover:bg-amber-50/40",
                showEnded && "hover:bg-rose-50/40",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-1",
                    atRisk
                      ? "bg-amber-100 text-amber-800 ring-amber-200/80"
                      : allDone
                        ? "bg-emerald-100 text-emerald-700 ring-emerald-200/80"
                        // Team mode: avatar takes the team's brand color and shows a Users icon.
                        // Assignee mode: stays violet with initials.
                        : teamMode
                          ? teamAvatarClass(row.teamId)
                          : "bg-violet-100 text-violet-700 ring-violet-200/80",
                  )}
                >
                  {teamMode
                    ? <TeamAvatar slug={row.teamId} sizePx={20} rounded="rounded-full" fallback={<Users className="size-3" />} />
                    : (row.initials || <User className="size-3" />)}
                </span>

                <div className="min-w-0 flex-1">
                  {/* Row 1: name + (warning chip inline) + summary numbers */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-semibold text-slate-800">{row.label}</span>
                    <div className="flex shrink-0 items-center gap-3">
                      {atRisk && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200/80"
                          title={`${row.daysLeft}d of work left but only ${sprintDaysLeft}d remain in the sprint — ${overByDays}d over capacity`}
                        >
                          <AlertTriangle className="size-2.5 shrink-0" aria-hidden />
                          +{overByDays}d over
                        </span>
                      )}
                      {showEnded && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded bg-rose-50 px-1.5 py-px text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200/80"
                          title={`Sprint has ended with ${row.daysLeft}d of work still open`}
                        >
                          <AlertTriangle className="size-2.5 shrink-0" aria-hidden />
                          {row.daysLeft}d unfinished
                        </span>
                      )}
                      <span className="text-[11.5px] tabular-nums text-slate-600">
                        <span className="font-semibold text-slate-800">{useDays ? `${done}d` : done}</span>
                        <span className="ml-0.5 text-slate-400">{useDays ? "est done" : "done"}</span>
                        <span className="mx-1 text-slate-300">·</span>
                        <span className={cn("font-semibold", atRisk ? "text-amber-700" : "text-slate-800")}>
                          {useDays ? `${remaining}d` : remaining}
                        </span>
                        <span className="ml-0.5 text-slate-400">{useDays ? "est left" : "left"}</span>
                      </span>
                    </div>
                  </div>

                  {/* Row 2: progress bar */}
                  <div className="mt-1 relative h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/50">
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-full transition-all",
                        atRisk ? "bg-amber-400" : allDone ? "bg-emerald-400" : "bg-indigo-400",
                      )}
                      style={{ width: `${donePct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
