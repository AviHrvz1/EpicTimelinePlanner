"use client";

import { AreaChart, Check, TrendingDown } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { monthTeamLabelForId } from "@/lib/month-team-board";
import type { RoadmapItem } from "@/lib/types";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { capacityPlanTeamCatalogFromDirectory } from "@/lib/workspace-users";
import { DashboardChartConfig } from "./types";

type ChartKind = "burndown" | "cfd";

function currentSprintParams(): { year: number; quarter: number; sprint: number; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const half = day <= 15 ? 1 : 2;
  const quarter = Math.ceil(month / 3);
  const yearSprint = (month - 1) * 2 + half;
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mon = MONTHS[month - 1] ?? "";
  const dateRange = half === 1 ? `${mon} 1–15` : `${mon} 16–end`;
  return { year, quarter, sprint: yearSprint, label: `Sprint ${yearSprint} · ${dateRange} ${year}` };
}

type Props = {
  roadmaps: RoadmapItem[];
  workspaceDirectoryUsers: readonly SprintWorkspaceDirectoryUser[];
  onAddCharts: (configs: DashboardChartConfig[]) => void;
};

function MultiToggle<T extends string>({
  options,
  selected,
  onToggle,
  renderLabel,
}: {
  options: T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
  renderLabel: (v: T) => string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {options.map((opt) => {
        const active = selected.has(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
              active
                ? "border-indigo-300 bg-indigo-50 font-semibold text-indigo-800"
                : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-slate-50",
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                active ? "border-indigo-500 bg-indigo-500" : "border-slate-300 bg-white",
              )}
            >
              {active && <Check className="size-2.5 text-white" strokeWidth={3} />}
            </span>
            <span className="truncate">{renderLabel(opt)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function DashboardChartBuilder({ roadmaps, workspaceDirectoryUsers, onAddCharts }: Props) {
  const [chartKind, setChartKind] = useState<ChartKind>("burndown");
  const [selectedRoadmapIds, setSelectedRoadmapIds] = useState<Set<string>>(new Set());
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());

  const teamOptions = useMemo(
    () => capacityPlanTeamCatalogFromDirectory(workspaceDirectoryUsers),
    [workspaceDirectoryUsers],
  );

  const sprintInfo = useMemo(() => currentSprintParams(), []);

  const chartCount = Math.max(
    selectedRoadmapIds.size,
    selectedTeamIds.size,
  ) === 0
    ? 0
    : (selectedRoadmapIds.size || 1) * (selectedTeamIds.size || 1);

  function toggle<T>(set: Set<T>, v: T): Set<T> {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  }

  function handleAdd() {
    const roadmapEntries = selectedRoadmapIds.size > 0
      ? roadmaps.filter((r) => selectedRoadmapIds.has(r.id))
      : [null];
    const teamEntries = selectedTeamIds.size > 0
      ? [...selectedTeamIds]
      : [null];

    const configs: DashboardChartConfig[] = [];
    for (const roadmap of roadmapEntries) {
      for (const teamId of teamEntries) {
        const teamLabel = teamId ? (monthTeamLabelForId(teamId) ?? teamId) : null;
        const roadmapLabel = roadmap ? roadmap.name : null;
        const parts = [
          chartKind === "burndown" ? "Burndown" : "Cumulative Flow",
          roadmapLabel,
          teamLabel,
          `Sprint ${sprintInfo.sprint}`,
        ].filter(Boolean);
        configs.push({
          chartType: chartKind,
          title: parts.join(" · "),
          params: {
            year: sprintInfo.year,
            quarter: sprintInfo.quarter,
            sprint: sprintInfo.sprint,
            ...(roadmap ? { roadmapId: roadmap.id } : {}),
            ...(teamId ? { team: teamId } : {}),
          },
        });
      }
    }
    onAddCharts(configs);

    setSelectedRoadmapIds(new Set());
    setSelectedTeamIds(new Set());
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold text-slate-800">Chart builder</p>
        <p className="text-xs text-slate-400">Burndown &amp; Cumulative Flow for current sprint</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        {/* Chart type */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Chart type</p>
          <div className="flex gap-2">
            {(["burndown", "cfd"] as const).map((kind) => {
              const active = chartKind === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setChartKind(kind)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-semibold transition-colors",
                    active
                      ? kind === "burndown"
                        ? "border-rose-300 bg-rose-50 text-rose-700"
                        : "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                  )}
                >
                  {kind === "burndown"
                    ? <TrendingDown className="size-3.5" />
                    : <AreaChart className="size-3.5" />}
                  {kind === "burndown" ? "Burndown" : "Cumulative Flow"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Current sprint badge */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Sprint</p>
          <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
            <span className="size-2 rounded-full bg-indigo-400 shrink-0" />
            <span className="text-xs font-semibold text-indigo-700">{sprintInfo.label}</span>
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-indigo-400">Current</span>
          </div>
        </div>

        {/* Roadmaps */}
        {roadmaps.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Roadmaps</p>
              {selectedRoadmapIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedRoadmapIds(new Set())}
                  className="text-[10px] text-slate-400 hover:text-slate-600"
                >
                  Clear
                </button>
              )}
            </div>
            <MultiToggle
              options={roadmaps.map((r) => r.id)}
              selected={selectedRoadmapIds}
              onToggle={(id) => setSelectedRoadmapIds((prev) => toggle(prev, id))}
              renderLabel={(id) => roadmaps.find((r) => r.id === id)?.name ?? id}
            />
          </div>
        )}

        {/* Teams */}
        {teamOptions.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Teams</p>
              {selectedTeamIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTeamIds(new Set())}
                  className="text-[10px] text-slate-400 hover:text-slate-600"
                >
                  Clear
                </button>
              )}
            </div>
            <MultiToggle
              options={teamOptions.map((t) => t.id)}
              selected={selectedTeamIds}
              onToggle={(id) => setSelectedTeamIds((prev) => toggle(prev, id))}
              renderLabel={(id) => teamOptions.find((t) => t.id === id)?.label ?? id}
            />
          </div>
        )}
      </div>

      {/* Footer add button */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
        <button
          type="button"
          disabled={chartCount === 0}
          onClick={handleAdd}
          className={cn(
            "w-full rounded-xl py-2.5 text-sm font-semibold transition-colors",
            chartCount > 0
              ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
              : "bg-slate-100 text-slate-400 cursor-not-allowed",
          )}
        >
          {chartCount === 0
            ? "Select roadmap or team"
            : `Add ${chartCount} chart${chartCount !== 1 ? "s" : ""}`}
        </button>
        {chartCount > 1 && (
          <p className="mt-1.5 text-center text-[11px] text-slate-400">
            {selectedRoadmapIds.size || 1} roadmap{(selectedRoadmapIds.size || 1) !== 1 ? "s" : ""} × {selectedTeamIds.size || 1} team{(selectedTeamIds.size || 1) !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </div>
  );
}
