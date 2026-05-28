"use client";

import { Folder, Users } from "lucide-react";

import { monthTeamLabelForId } from "@/lib/month-team-board";
import type { EpicItem, InitiativeItem } from "@/lib/types";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { cn } from "@/lib/utils";

/** Tailwind classes that color a small team badge. Falls back to slate for unknown teams. */
const TEAM_BADGE_CLASS: Record<string, string> = {
  platform:   "bg-sky-100 text-sky-700 ring-sky-200/80",
  experience: "bg-violet-100 text-violet-700 ring-violet-200/80",
  data:       "bg-amber-100 text-amber-700 ring-amber-200/80",
  mobile:     "bg-emerald-100 text-emerald-700 ring-emerald-200/80",
  growth:     "bg-rose-100 text-rose-700 ring-rose-200/80",
};
function teamBadgeClass(teamId: string | null | undefined): string {
  return (teamId && TEAM_BADGE_CLASS[teamId]) || "bg-slate-100 text-slate-500 ring-slate-200/80";
}

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  /** 1-4 quarter index. */
  quarter: number;
  /** Optional single-team filter on epics. */
  team?: string | null;
  /** Optional multi-team filter — non-empty array takes priority over `team`. */
  teams?: string[] | null;
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_BARS = 10;

function quarterMonthRange(q: number): [number, number] {
  const m1 = (q - 1) * 3 + 1;
  return [m1, m1 + 2];
}

function epicStartDate(year: number, epic: EpicItem): Date {
  const month = epic.planStartMonth ?? 1;
  const lane = epic.planSprint === 2 ? 2 : 1;
  return new Date(year, month - 1, lane === 1 ? 1 : 16);
}
function epicEndDate(year: number, epic: EpicItem): Date {
  const month = epic.planEndMonth ?? epic.planStartMonth ?? 1;
  const lane = epic.planEndSprint === 1 ? 1 : 2;
  const lastDay = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, lane === 1 ? 15 : lastDay);
}

/**
 * Gadget — compact quarter Gantt. Uses a 6-column sub-grid (3 months × 2 sprint lanes)
 * with vertical grid lines, sticky month header, and alternating row backgrounds.
 * Each epic is one row with a colored bar positioned by its plan range within the quarter.
 */
export function MiniGanttCard({ initiatives, year, quarter, team, teams }: Props) {
  const [qStartMonth, qEndMonth] = quarterMonthRange(quarter);
  const qStart = new Date(year, qStartMonth - 1, 1);
  const qEndLastDay = new Date(year, qEndMonth, 0).getDate();
  const qEnd = new Date(year, qEndMonth - 1, qEndLastDay, 23, 59, 59, 999);
  const totalMs = qEnd.getTime() - qStart.getTime();
  const teamsFilter = (teams && teams.length > 0) ? new Set(teams) : (team ? new Set([team]) : null);

  type Row = { id: string; title: string; color: string; initiativeTitle: string; team: string | null; leftPct: number; widthPct: number; progressPct: number };
  const rows: Row[] = [];
  for (const initiative of initiatives) {
    if (initiative.status !== "scheduled") continue;
    if (initiative.startMonth == null || initiative.endMonth == null) continue;
    if (initiative.endMonth < qStartMonth || initiative.startMonth > qEndMonth) continue;
    for (const epic of initiative.epics ?? []) {
      if (teamsFilter && !teamsFilter.has(epic.team ?? "")) continue;
      if (epic.planStartMonth == null || epic.planEndMonth == null) continue;
      if (epic.planEndMonth < qStartMonth || epic.planStartMonth > qEndMonth) continue;
      const s = epicStartDate(year, epic).getTime();
      const e = epicEndDate(year, epic).getTime();
      const startClamped = Math.max(s, qStart.getTime());
      const endClamped = Math.min(e, qEnd.getTime());
      if (endClamped <= startClamped) continue;
      const leftPct = ((startClamped - qStart.getTime()) / totalMs) * 100;
      const widthPct = ((endClamped - startClamped) / totalMs) * 100;
      // Progress = done+approved / total stories under the epic (matches the all-quarters Gantt).
      const stories = epic.userStories ?? [];
      const total = stories.length;
      const done = stories.filter((s) => s.status === "done" || s.status === "approved").length;
      const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
      rows.push({
        id: epic.id,
        title: epic.title,
        color: epic.color || initiative.color || "#6366f1",
        initiativeTitle: initiative.title,
        team: epic.team ?? null,
        leftPct,
        widthPct: Math.max(2, widthPct),
        progressPct,
      });
    }
  }

  const shown = rows.slice(0, MAX_BARS);
  const hiddenCount = rows.length - shown.length;
  // Show a team badge before each epic title when the chart spans multiple teams (either no filter,
  // multi-team filter, or the visible rows naturally include >1 team).
  const distinctTeamsShown = new Set(shown.map((r) => r.team ?? ""));
  const showTeamBadges = (!teamsFilter || teamsFilter.size > 1) && distinctTeamsShown.size > 1;
  const today = new Date();
  const todayInQuarter = today >= qStart && today <= qEnd;
  const todayPct = todayInQuarter ? ((today.getTime() - qStart.getTime()) / totalMs) * 100 : null;

  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 text-center text-slate-400">
        <Folder className="size-7 opacity-30" aria-hidden />
        <p className="text-[12.5px] font-medium">No scheduled epics for Q{quarter} {year}</p>
      </div>
    );
  }

  // Width allocated to the row label column on the left (sticky).
  const LABEL_W = "10.5rem";

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden">
      {/* Header row — label column + month/sprint grid */}
      <div
        className="grid shrink-0 items-center border-b border-slate-200 pb-1.5"
        style={{ gridTemplateColumns: `${LABEL_W} minmax(0, 1fr)` }}
      >
        <div className="pr-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Epic · Initiative</div>
        <div className="relative grid grid-cols-6">
          {[qStartMonth, qStartMonth + 1, qEndMonth].map((m, i) => (
            <div
              key={m}
              className={cn(
                "col-span-2 border-l border-slate-200 px-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500",
                i === 0 && "border-l-0",
              )}
            >
              {MONTH_SHORT[m - 1]}
            </div>
          ))}
          {/* Sub-row: S1 / S2 dividers for each month */}
          <div className="col-span-6 mt-0.5 grid grid-cols-6 text-center text-[9px] font-medium text-slate-400">
            {[1, 2, 1, 2, 1, 2].map((s, i) => (
              <div key={i} className={cn("border-l border-slate-100", i === 0 && "border-l-0")}>
                S{s}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Body — one row per epic */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="relative">
          {shown.map((row, idx) => (
            <div
              key={row.id}
              className={cn(
                "grid items-center border-b border-slate-100 py-1",
                idx % 2 === 1 && "bg-slate-50/40",
              )}
              style={{ gridTemplateColumns: `${LABEL_W} minmax(0, 1fr)` }}
            >
              {/* Label column */}
              <div className="flex min-w-0 flex-col pr-2">
                <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-slate-800">
                  {showTeamBadges && (
                    <TeamAvatar
                      slug={row.team}
                      sizePx={16}
                      title={row.team ? (monthTeamLabelForId(row.team) ?? row.team) : "No team"}
                      fallback={
                        <span
                          className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-md ring-1", teamBadgeClass(row.team))}
                          title={row.team ? (monthTeamLabelForId(row.team) ?? row.team) : "No team"}
                          aria-label={row.team ? (monthTeamLabelForId(row.team) ?? row.team) : "No team"}
                        >
                          <Users className="size-2.5" />
                        </span>
                      }
                    />
                  )}
                  <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} aria-hidden />
                  <span className="truncate">{row.title}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-[10px] font-bold text-slate-500" title={`${row.progressPct}% complete`}>
                    {row.progressPct}%
                  </span>
                </p>
                <p className={cn("truncate text-[10px] text-slate-500", showTeamBadges ? "ml-[1.55rem]" : "ml-3")}>{row.initiativeTitle}</p>
              </div>

              {/* Track with vertical grid lines + bar */}
              <div className="relative h-5 w-full overflow-hidden rounded-md bg-slate-50/70 ring-1 ring-slate-200/60">
                {/* Vertical grid: 6 sub-lanes (3 months × 2 sprints). The dividing line at lane boundary is darker on month boundaries. */}
                <div className="pointer-events-none absolute inset-0 grid grid-cols-6">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-full",
                        i > 0 && (i % 2 === 0 ? "border-l border-slate-300/70" : "border-l border-slate-200/60"),
                      )}
                    />
                  ))}
                </div>
                {/* Epic bar (background — full plan range, faded) */}
                <div
                  className="absolute inset-y-0.5 rounded-md ring-1 ring-black/5"
                  style={{
                    left: `${row.leftPct}%`,
                    width: `${row.widthPct}%`,
                    backgroundColor: row.color,
                    opacity: 0.32,
                  }}
                />
                {/* Progress overlay — sits inside the bar at full opacity. Width = bar width × progressPct */}
                <div
                  className="absolute inset-y-0.5 rounded-md shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] ring-1 ring-black/10"
                  style={{
                    left: `${row.leftPct}%`,
                    width: `${(row.widthPct * row.progressPct) / 100}%`,
                    backgroundColor: row.color,
                  }}
                />
                {/* Today marker */}
                {todayPct != null && (
                  <span
                    className="pointer-events-none absolute inset-y-0 w-px bg-rose-500/80"
                    style={{ left: `${todayPct}%` }}
                    aria-hidden
                  />
                )}
              </div>
            </div>
          ))}

          {/* Today head triangle (top, shared across rows) */}
          {todayPct != null && (
            <span
              className="pointer-events-none absolute top-[-1px] size-2 -translate-x-1/2 rotate-45 bg-rose-500 ring-2 ring-white"
              style={{ left: `calc(${LABEL_W} + (100% - ${LABEL_W}) * ${todayPct / 100})` }}
              aria-hidden
            />
          )}
        </div>

        {hiddenCount > 0 && (
          <p className="px-1 pt-1.5 text-[11px] text-slate-500">… and {hiddenCount} more {hiddenCount === 1 ? "epic" : "epics"}</p>
        )}
      </div>

      {todayInQuarter && (
        <div className="flex shrink-0 items-center justify-end gap-1.5 text-[10px] text-slate-500">
          <span className="size-1.5 rounded-full bg-rose-500" />
          <span>Today</span>
        </div>
      )}
    </div>
  );
}
