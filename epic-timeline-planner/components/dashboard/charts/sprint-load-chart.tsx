"use client";

import { AlertTriangle } from "lucide-react";
import { buildSprintAnalytics } from "@/lib/sprint-analytics";
import type { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  initiatives: InitiativeItem[];
  year: number;
  quarter: number;
  sprint: number;
  team?: string | null;
};

export function SprintLoadChart({ initiatives, year, quarter, sprint, team }: Props) {
  const month = Math.ceil(sprint / 2);
  const analytics = buildSprintAnalytics(initiatives, month, sprint, "daysLeft", year, team ? [team] : null);

  const teamMode = !team;
  const sprintDaysLeft = analytics.workloadSprintCalendarDaysLeft;

  const rows = teamMode
    ? analytics.workloadByTeam.map((t) => ({
        key: t.teamLabel,
        label: t.teamLabel,
        initials: t.teamLabel.slice(0, 2).toUpperCase(),
        daysLeft: t.daysLeftTotal,
        estTotal: t.estimatedTotal,
      }))
    : analytics.workloadByAssignee.map((r) => ({
        key: r.assignee,
        label: r.assignee,
        initials: r.assignee.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join(""),
        daysLeft: r.daysLeftTotal,
        estTotal: r.estimatedTotal,
      }));

  if (rows.length === 0) {
    return <p className="flex h-[180px] items-center justify-center text-xs text-slate-400">No load data for this sprint</p>;
  }

  return (
    <div className="max-h-[180px] overflow-y-auto space-y-1.5 pr-1">
      {rows.map((row) => {
        const done = Math.max(0, row.estTotal - row.daysLeft);
        const pct = row.estTotal > 0 ? Math.round((done / row.estTotal) * 100) : 100;
        const atRisk = sprintDaysLeft > 0 && row.daysLeft > sprintDaysLeft;
        return (
          <div key={row.key} className="rounded-lg bg-slate-50 px-2 py-1.5">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[9px] font-bold text-violet-700">
                {row.initials}
              </span>
              <span className="flex-1 truncate text-[11px] font-semibold text-slate-800">{row.label}</span>
              <span className="flex items-center gap-1 shrink-0">
                {atRisk && (
                  <span className="flex items-center gap-0.5 rounded-full bg-amber-50 px-1 py-0.5 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
                    <AlertTriangle className="size-2.5" />
                    {row.daysLeft - sprintDaysLeft}d over
                  </span>
                )}
                <span className="text-[10px] text-slate-500 tabular-nums">{row.daysLeft}d / {row.estTotal}d</span>
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div className={cn("h-full rounded-full", atRisk ? "bg-amber-400" : row.daysLeft === 0 ? "bg-emerald-400" : "bg-indigo-400")} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
