"use client";

import {
  AlertTriangle,
  AreaChart,
  BarChart2,
  Check,
  ChevronLeft,
  Clock,
  Donut,
  Flag,
  Folder,
  GanttChartSquare,
  Map as MapIcon,
  PieChart,
  RotateCcw,
  StickyNote,
  TrendingDown,
  Users,
  Users2,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { monthTeamLabelForId } from "@/lib/month-team-board";
import type { EpicItem, InitiativeItem, RoadmapItem } from "@/lib/types";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { capacityPlanTeamCatalogFromDirectory } from "@/lib/workspace-users";
import type { ChartType, DashboardChartConfig, DashboardChartItem, LLMChartProposal, LLMQuestion } from "./types";

// ─── Team icon / color map ────────────────────────────────────────────────────

const TEAM_COLOR: Record<string, string> = {
  platform:   "bg-sky-100 text-sky-700 ring-sky-200",
  experience: "bg-violet-100 text-violet-700 ring-violet-200",
  data:       "bg-amber-100 text-amber-700 ring-amber-200",
  mobile:     "bg-emerald-100 text-emerald-700 ring-emerald-200",
  growth:     "bg-rose-100 text-rose-700 ring-rose-200",
};

function teamIconNode(teamId: string): React.ReactNode {
  const color = TEAM_COLOR[teamId] ?? "bg-slate-100 text-slate-500 ring-slate-200";
  return (
    <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md ring-1", color)}>
      <Users className="size-3" />
    </span>
  );
}

const ROADMAP_COLORS = [
  "bg-sky-100 text-sky-700 ring-sky-200",
  "bg-violet-100 text-violet-700 ring-violet-200",
  "bg-emerald-100 text-emerald-700 ring-emerald-200",
  "bg-amber-100 text-amber-700 ring-amber-200",
  "bg-rose-100 text-rose-700 ring-rose-200",
  "bg-cyan-100 text-cyan-700 ring-cyan-200",
  "bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200",
  "bg-lime-100 text-lime-700 ring-lime-200",
];

function roadmapIconNode(index: number): React.ReactNode {
  const color = ROADMAP_COLORS[index % ROADMAP_COLORS.length];
  return (
    <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md ring-1", color)}>
      <MapIcon className="size-3" />
    </span>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

type WorkspaceContext = {
  teams: string[];
  users: Array<{ id: string; name: string; team: string }>;
  quarters: string[];
  sprints: string[];
  initiatives: Array<{ id: string; title: string; status: string; year: number }>;
};

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

const CHART_META: Record<ChartType, { label: string; icon: React.ReactNode; description: string; accent: string }> = {
  burndown: {
    label: "Sprint Burndown",
    icon: <TrendingDown className="size-4 text-rose-500" />,
    description: "Remaining work vs ideal line for a sprint",
    accent: "border-rose-200 bg-rose-50 text-rose-700",
  },
  "epic-burndown": {
    label: "Epic Scope Burndown",
    icon: <TrendingDown className="size-4 text-amber-500" />,
    description: "Epic-level remaining stories vs ideal across a sprint",
    accent: "border-amber-200 bg-amber-50 text-amber-700",
  },
  cfd: {
    label: "Cumulative Flow",
    icon: <AreaChart className="size-4 text-emerald-500" />,
    description: "Story status stacked over time in a sprint",
    accent: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  "epic-cfd": {
    label: "Epic Cumulative Flow",
    icon: <AreaChart className="size-4 text-cyan-500" />,
    description: "Story status stacked over time across an epic's plan range",
    accent: "border-cyan-200 bg-cyan-50 text-cyan-700",
  },
  "story-status": {
    label: "User Stories Status",
    icon: <PieChart className="size-4 text-sky-500" />,
    description: "Pie breakdown of story statuses in a sprint",
    accent: "border-sky-200 bg-sky-50 text-sky-700",
  },
  "workload-balance": {
    label: "Status Breakdown",
    icon: <BarChart2 className="size-4 text-indigo-500" />,
    description: "Stacked bars of stories grouped by status (To do, In progress, Done, Approved)",
    accent: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  "sprint-load": {
    label: "Sprint Load",
    icon: <Users className="size-4 text-violet-500" />,
    description: "Days left vs estimated per assignee / team",
    accent: "border-violet-200 bg-violet-50 text-violet-700",
  },
  "sprint-burnup": {
    label: "Sprint Burnup",
    icon: <AreaChart className="size-4 text-teal-500" />,
    description: "Completed vs scope vs ideal line for a sprint",
    accent: "border-teal-200 bg-teal-50 text-teal-700",
  },
  "epic-burnup": {
    label: "Epic Scope Burnup",
    icon: <AreaChart className="size-4 text-purple-500" />,
    description: "Epic scope completed vs total scope over a sprint",
    accent: "border-purple-200 bg-purple-50 text-purple-700",
  },
  velocity: {
    label: "Velocity",
    icon: <BarChart2 className="size-4 text-amber-500" />,
    description: "Stories completed per sprint across a quarter",
    accent: "border-amber-200 bg-amber-50 text-amber-700",
  },
  workload: {
    label: "Team Capacity",
    icon: <Users className="size-4 text-orange-500" />,
    description: "Per-assignee progress bars: work review vs remaining for the sprint",
    accent: "border-orange-200 bg-orange-50 text-orange-700",
  },
  "quarter-status": {
    label: "Quarter Status",
    icon: <PieChart className="size-4 text-pink-500" />,
    description: "Story status breakdown for a whole quarter",
    accent: "border-pink-200 bg-pink-50 text-pink-700",
  },
  "sprint-countdown": {
    label: "Sprint Countdown",
    icon: <Clock className="size-4 text-indigo-500" />,
    description: "Live ticker showing time remaining in the current sprint",
    accent: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  "sticky-note": {
    label: "Sticky Note",
    icon: <StickyNote className="size-4 text-violet-500" />,
    description: "A pinned note for ad-hoc dashboard commentary",
    accent: "border-violet-200 bg-violet-50 text-violet-700",
  },
  "at-risk-stories": {
    label: "At-Risk Stories",
    icon: <AlertTriangle className="size-4 text-rose-500" />,
    description: "Stories whose remaining work overruns the sprint days left",
    accent: "border-rose-200 bg-rose-50 text-rose-700",
  },
  "mini-gantt": {
    label: "Epics Timeline",
    icon: <GanttChartSquare className="size-4 text-sky-500" />,
    description: "Compact quarter Gantt: epic bars laid out across a 3-month grid",
    accent: "border-sky-200 bg-sky-50 text-sky-700",
  },
  "team-focus-mix": {
    label: "Team Focus Mix",
    icon: <Donut className="size-4 text-fuchsia-500" />,
    description: "Donut of effort split across initiatives — spot too-many-irons-in-the-fire",
    accent: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  },
};

// Gadget chart types — appear under a "Gadgets" header below the chart list.
// One-click add with no configuration form.
const GADGET_CHART_TYPES = new Set<ChartType>(["sprint-countdown", "sticky-note"]);

// Chart types that use the structured SprintChartForm flow (vs. the chat-style OtherChartFlow).
const SPRINT_CHART_TYPES = new Set<ChartType>(["burndown", "epic-burndown", "cfd", "epic-cfd", "story-status", "workload-balance", "workload", "sprint-load", "sprint-burnup", "epic-burnup", "velocity", "at-risk-stories", "mini-gantt", "team-focus-mix"]);

// Display order: burndowns first, burnups next, then other sprint types, then quarter-level
const CHART_TYPE_ORDER: ChartType[] = [
  "burndown",
  "epic-burndown",
  "sprint-burnup",
  "epic-burnup",
  "cfd",
  "epic-cfd",
  "story-status",
  "workload-balance",
  "sprint-load",
  "velocity",
  "workload",
  "at-risk-stories",
  "mini-gantt",
  "team-focus-mix",
  "quarter-status",
];

// ─── Autocomplete multi-select ────────────────────────────────────────────────

function AutocompleteMultiSelect<T extends string>({
  options,
  selected,
  onToggle,
  onSelectAll,
  onClearAll,
  renderLabel,
  renderIcon,
  placeholder,
}: {
  options: T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
  /** Optional bulk actions — when provided, Select all / Clear shortcuts render above the chips. */
  onSelectAll?: () => void;
  onClearAll?: () => void;
  renderLabel: (v: T) => string;
  renderIcon?: (v: T) => React.ReactNode;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const filtered = query.trim()
    ? options.filter((o) => renderLabel(o).toLowerCase().includes(query.toLowerCase()))
    : options;

  useEffect(() => {
    if (!isOpen) return;
    function onDown(e: globalThis.MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isOpen]);

  const allSelected = options.length > 0 && options.every((o) => selected.has(o));

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      {/* Select all / Clear shortcuts — shown only when caller wires the callbacks. */}
      {(onSelectAll || onClearAll) && options.length > 0 && (
        <div className="flex items-center gap-3 text-[11.5px] font-medium">
          {onSelectAll && (
            <button
              type="button"
              onClick={() => { if (!allSelected) onSelectAll(); }}
              disabled={allSelected}
              className={cn(
                "inline-flex items-center gap-1 rounded text-indigo-600 transition-colors hover:text-indigo-800",
                allSelected && "cursor-not-allowed text-slate-400 hover:text-slate-400",
              )}
            >
              <Check className="size-3" />
              Select all ({options.length})
            </button>
          )}
          {onClearAll && selected.size > 0 && (
            <button
              type="button"
              onClick={() => onClearAll()}
              className="inline-flex items-center gap-1 rounded text-slate-500 transition-colors hover:text-slate-700"
            >
              <X className="size-3" />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Selected chips */}
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[...selected].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onToggle(v)}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200"
            >
              {renderLabel(v)}
              <X className="size-2.5 shrink-0 opacity-75" />
            </button>
          ))}
        </div>
      )}
      {/* Search input — clicking opens the list */}
      <div
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 transition-all cursor-pointer"
        onClick={() => setIsOpen(true)}
      >
        <svg className="size-3.5 shrink-0 text-slate-300" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
        </svg>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder ?? "Search…"}
          className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setQuery(""); }}
            className="shrink-0 text-slate-300 hover:text-slate-500 transition-colors"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {/* Filtered options — only shown when the picker is open */}
      {isOpen ? (
        filtered.length === 0 ? (
          <p className="px-1 py-2 text-sm text-slate-400">No results</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm max-h-44 overflow-y-auto">
            {filtered.map((opt, i) => {
              const active = selected.has(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onToggle(opt)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors",
                    i > 0 && "border-t border-slate-50",
                    active
                      ? "bg-indigo-50 font-semibold text-indigo-800"
                      : "text-slate-700 hover:bg-slate-50",
                  )}
                >
                  <span className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-all",
                    active ? "border-indigo-500 bg-indigo-500 shadow-sm" : "border-slate-200 bg-white",
                  )}>
                    {active && <Check className="size-2.5 text-white" strokeWidth={3.5} />}
                  </span>
                  {renderIcon && renderIcon(opt)}
                  <span className="truncate">{renderLabel(opt)}</span>
                </button>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}

// ─── Epic autocomplete (single-select; epics grouped by initiative) ─────────

function EpicAutocomplete({
  options,
  selectedEpicIds,
  onToggle,
  onClearAll,
}: {
  options: Array<{ epic: EpicItem; initiative: InitiativeItem }>;
  selectedEpicIds: Set<string>;
  onToggle: (epicId: string) => void;
  onClearAll: () => void;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const filtered = query.trim()
    ? options.filter((o) => {
        const q = query.toLowerCase();
        return (
          o.epic.title.toLowerCase().includes(q) ||
          o.initiative.title.toLowerCase().includes(q) ||
          (o.epic.team ?? "").toLowerCase().includes(q)
        );
      })
    : options;

  const selectedRows = options.filter((o) => selectedEpicIds.has(o.epic.id));

  useEffect(() => {
    if (!isOpen) return;
    function onDown(e: globalThis.MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      {selectedRows.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {selectedRows.map((row) => (
            <div
              key={row.epic.id}
              className="flex items-center gap-2 rounded-xl bg-indigo-50 ring-1 ring-indigo-200 py-2 pl-3 pr-2 text-[13px]"
            >
              <Folder className="size-3.5 shrink-0 text-indigo-500" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-indigo-900">{row.epic.title}</div>
                <div className="truncate text-[11px] text-indigo-700/80">
                  {row.initiative.title}
                  {row.epic.team ? ` · ${monthTeamLabelForId(row.epic.team) ?? row.epic.team}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onToggle(row.epic.id)}
                className="shrink-0 rounded p-1 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
                aria-label={`Remove ${row.epic.title}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {selectedRows.length > 1 ? (
            <button
              type="button"
              onClick={onClearAll}
              className="self-end rounded px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 transition-all cursor-pointer"
        onClick={() => setIsOpen(true)}
      >
        <svg className="size-3.5 shrink-0 text-slate-300" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
        </svg>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          placeholder={selectedRows.length > 0 ? "Add another epic…" : "Search epic, initiative, or team…"}
          className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setQuery(""); }}
            className="shrink-0 text-slate-300 hover:text-slate-500 transition-colors"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {!isOpen ? null : options.length === 0 ? (
        <p className="px-1 py-2 text-sm text-slate-400">
          No epics in scope. Adjust the Roadmap or Team filter above.
        </p>
      ) : filtered.length === 0 ? (
        <p className="px-1 py-2 text-sm text-slate-400">No epics match “{query}”.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm max-h-64 overflow-y-auto">
          {(() => {
            // Group matched rows by initiative, preserving sort order
            const groups = new Map<string, { initiative: InitiativeItem; epics: EpicItem[] }>();
            for (const row of filtered.slice(0, 120)) {
              const existing = groups.get(row.initiative.id);
              if (existing) existing.epics.push(row.epic);
              else groups.set(row.initiative.id, { initiative: row.initiative, epics: [row.epic] });
            }
            return Array.from(groups.values()).map((group, gIdx) => {
              const initiativeIcon = group.initiative.icon?.trim();
              return (
                <div key={group.initiative.id} className={cn(gIdx > 0 && "border-t border-slate-100")}>
                  {/* Initiative header row */}
                  <div className="flex items-center gap-2 bg-slate-50/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                    {initiativeIcon && initiativeIcon !== "🎯" ? (
                      <span className="text-[13px] leading-none" aria-hidden>{initiativeIcon}</span>
                    ) : (
                      <span
                        className="inline-flex size-4 shrink-0 items-center justify-center rounded"
                        style={{ backgroundColor: group.initiative.color }}
                        aria-hidden
                      >
                        <Zap className="size-2.5 text-white" strokeWidth={2.5} />
                      </span>
                    )}
                    <span className="truncate normal-case tracking-normal text-[12px] font-semibold text-slate-700">{group.initiative.title}</span>
                  </div>
                  {/* Epic rows — indented under the initiative */}
                  {group.epics.map((epic) => {
                    const active = selectedEpicIds.has(epic.id);
                    const teamLabel = epic.team ? monthTeamLabelForId(epic.team) ?? epic.team : null;
                    const epicIcon = epic.icon?.trim();
                    return (
                      <button
                        key={epic.id}
                        type="button"
                        onClick={() => onToggle(epic.id)}
                        className={cn(
                          "flex w-full items-center gap-2 pl-7 pr-3 py-2 text-left text-sm transition-colors",
                          active
                            ? "bg-indigo-50 font-semibold text-indigo-800"
                            : "text-slate-700 hover:bg-slate-50",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-all",
                            active ? "border-indigo-500 bg-indigo-500 shadow-sm" : "border-slate-300 bg-white",
                          )}
                        >
                          {active && <Check className="size-2 text-white" strokeWidth={3.5} />}
                        </span>
                        {epicIcon && epicIcon !== "📁" ? (
                          <span className="text-[13px] leading-none shrink-0" aria-hidden>{epicIcon}</span>
                        ) : (
                          <Folder className={cn("size-3.5 shrink-0", active ? "text-indigo-500" : "text-slate-400")} aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate">{epic.title}</span>
                        {teamLabel ? (
                          <span className={cn(
                            "shrink-0 text-[11px]",
                            active ? "text-indigo-600/90" : "text-slate-400",
                          )}>
                            {teamLabel}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}

// ─── Simplified burndown/cfd form ─────────────────────────────────────────────

function parseChartItemConfig(chart: DashboardChartItem): Record<string, unknown> {
  try { return JSON.parse(chart.config); } catch { return {}; }
}

function chartItemToCollectedParams(chart: DashboardChartItem): CollectedParams {
  const cfg = parseChartItemConfig(chart);
  const year = cfg.year as number | undefined;
  const quarter = cfg.quarter as number | undefined;
  return {
    chartType: chart.chartType,
    year,
    quarter,
    quarterStr: year && quarter ? `${year}-Q${quarter}` : undefined,
    sprint: cfg.sprint as number | undefined,
    team: cfg.team as string | undefined,
    teamAsked: cfg.team !== undefined,
    metric: cfg.metric as string | undefined,
    metricAsked: cfg.metric !== undefined,
  };
}

function SprintChartForm({
  chartType,
  roadmaps,
  workspaceDirectoryUsers,
  initiatives,
  onAdd,
  onBack,
  editTarget,
  onCancelEdit,
}: {
  chartType: ChartType;
  roadmaps: RoadmapItem[];
  workspaceDirectoryUsers: readonly SprintWorkspaceDirectoryUser[];
  initiatives: InitiativeItem[];
  onAdd: (configs: DashboardChartConfig[]) => void;
  onBack: () => void;
  editTarget?: DashboardChartItem | null;
  onCancelEdit?: () => void;
}) {
  const initRoadmapIds = useMemo(() => {
    if (!editTarget) return new Set<string>();
    const cfg = parseChartItemConfig(editTarget);
    return cfg.roadmapId ? new Set([cfg.roadmapId as string]) : new Set<string>();
  }, [editTarget]);

  const initTeamIds = useMemo(() => {
    if (!editTarget) return new Set<string>();
    const cfg = parseChartItemConfig(editTarget);
    return cfg.team ? new Set([cfg.team as string]) : new Set<string>();
  }, [editTarget]);

  const initEpicIds = useMemo(() => {
    if (!editTarget) return new Set<string>();
    const cfg = parseChartItemConfig(editTarget);
    return typeof cfg.epicId === "string" ? new Set([cfg.epicId]) : new Set<string>();
  }, [editTarget]);

  const [selectedRoadmapIds, setSelectedRoadmapIds] = useState<Set<string>>(initRoadmapIds);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(initTeamIds);
  const [selectedEpicIds, setSelectedEpicIds] = useState<Set<string>>(initEpicIds);

  useEffect(() => {
    setSelectedRoadmapIds(initRoadmapIds);
    setSelectedTeamIds(initTeamIds);
    setSelectedEpicIds(initEpicIds);
  }, [initRoadmapIds, initTeamIds, initEpicIds]);

  const isEpicChart = chartType === "epic-burndown" || chartType === "epic-burnup" || chartType === "epic-cfd";
  const isVelocityChart = chartType === "velocity";
  // Epic Burndown / Epic Burnup expose the 3-option basis picker instead
  // of the simpler 2-option metric picker — basis drives the Y-axis
  // automatically (epicEst/days → daysLeft, stories → storyCount), so
  // a separate metric toggle would just enable nonsensical combinations.
  const supportsMetricPicker = chartType === "burndown" || chartType === "sprint-burnup" || chartType === "workload" || chartType === "workload-balance";
  const defaultMetric: "daysLeft" | "storyCount" = chartType === "sprint-burnup" || chartType === "epic-burnup" || chartType === "workload-balance" ? "storyCount" : "daysLeft";
  const initMetric: "daysLeft" | "storyCount" = useMemo(() => {
    if (!editTarget) return defaultMetric;
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(editTarget.config); } catch { /* ignore */ }
    return cfg.metric === "storyCount" || cfg.metric === "daysLeft" ? cfg.metric : defaultMetric;
  }, [editTarget, defaultMetric]);
  const [metric, setMetric] = useState<"daysLeft" | "storyCount">(initMetric);
  useEffect(() => { setMetric(initMetric); }, [initMetric]);

  // ─── Health/progress basis state ──────────────────────────────────────
  // The Epic Est (d) / Σ | Child Est (d) / Stories Completed (%) toggle
  // drives the scope-promise reference line on Epic Burndown / Epic Burnup
  // charts. Stored per-chart in `params.basis` so a chart created with
  // "epicEst" stays on that basis even if the global popover later flips.
  // Defaults to the planner-wide global default ("epicEst") for newly
  // created charts; uses the saved value when editing an existing chart.
  const supportsBasisPicker = chartType === "epic-burndown" || chartType === "epic-burnup";
  const initBasis = useMemo((): "days" | "stories" | "epicEst" => {
    if (!editTarget) return "epicEst";
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(editTarget.config); } catch { /* ignore */ }
    return cfg.basis === "days" || cfg.basis === "stories" || cfg.basis === "epicEst" ? cfg.basis : "epicEst";
  }, [editTarget]);
  const [basis, setBasis] = useState<"days" | "stories" | "epicEst">(initBasis);
  useEffect(() => { setBasis(initBasis); }, [initBasis]);

  // Workload + multi-team toggle: combine teams into ONE chart (default) or fan out to one chart per team.
  const [workloadCombineTeams, setWorkloadCombineTeams] = useState<boolean>(true);

  // ─── Velocity period state ───────────────────────────────────────────────
  const initVelocityRange = useMemo((): { start: number; end: number } => {
    const now = new Date();
    const currentSprint = (now.getMonth()) * 2 + (now.getDate() <= 15 ? 1 : 2);
    let cfg: Record<string, unknown> = {};
    if (editTarget) {
      try { cfg = JSON.parse(editTarget.config); } catch { /* ignore */ }
    }
    const startRaw = cfg.startYearSprint;
    const endRaw = cfg.endYearSprint;
    const start = typeof startRaw === "number" && startRaw >= 1 && startRaw <= 24 ? startRaw : 1;
    const end = typeof endRaw === "number" && endRaw >= 1 && endRaw <= 24 ? endRaw : Math.min(24, Math.max(1, currentSprint));
    return { start, end };
  }, [editTarget]);
  const [velocityStart, setVelocityStart] = useState<number>(initVelocityRange.start);
  const [velocityEnd, setVelocityEnd] = useState<number>(initVelocityRange.end);
  useEffect(() => { setVelocityStart(initVelocityRange.start); setVelocityEnd(initVelocityRange.end); }, [initVelocityRange]);

  const SPRINT_OPTIONS = useMemo(() => Array.from({ length: 24 }, (_, i) => {
    const ys = i + 1;
    const month = Math.ceil(ys / 2);
    const monName = MONTH_NAMES[month - 1] ?? `M${month}`;
    return { value: ys, label: `${monName} · S${ys}` };
  }), []);

  /** Epic options filtered by selected roadmap(s) and team(s), grouped by initiative for display. */
  const epicOptions = useMemo(() => {
    if (!isEpicChart) return [] as Array<{ epic: EpicItem; initiative: InitiativeItem }>;
    const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const initiative of initiatives) {
      if (selectedRoadmapIds.size > 0 && (!initiative.roadmapId || !selectedRoadmapIds.has(initiative.roadmapId))) continue;
      for (const epic of initiative.epics ?? []) {
        if (selectedTeamIds.size > 0) {
          const teamId = epic.team?.trim();
          if (!teamId || !selectedTeamIds.has(teamId)) continue;
        }
        rows.push({ epic, initiative });
      }
    }
    return rows.sort(
      (a, b) =>
        a.initiative.title.localeCompare(b.initiative.title) ||
        a.epic.title.localeCompare(b.epic.title),
    );
  }, [isEpicChart, initiatives, selectedRoadmapIds, selectedTeamIds]);

  const selectedEpicMetaList = useMemo(() => {
    if (selectedEpicIds.size === 0) return [] as Array<{ epic: EpicItem; initiative: InitiativeItem }>;
    const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        if (selectedEpicIds.has(epic.id)) rows.push({ epic, initiative });
      }
    }
    return rows;
  }, [selectedEpicIds, initiatives]);

  // Drop any selected epic that no longer matches the current filter scope.
  useEffect(() => {
    if (!isEpicChart || selectedEpicIds.size === 0) return;
    const validIds = new Set(epicOptions.map((row) => row.epic.id));
    let changed = false;
    const next = new Set<string>();
    for (const id of selectedEpicIds) {
      if (validIds.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelectedEpicIds(next);
  }, [isEpicChart, epicOptions, selectedEpicIds]);

  function toggleEpic(epicId: string) {
    setSelectedEpicIds((prev) => {
      const next = new Set(prev);
      if (next.has(epicId)) next.delete(epicId);
      else next.add(epicId);
      return next;
    });
  }

  const teamOptions = useMemo(
    () => capacityPlanTeamCatalogFromDirectory(workspaceDirectoryUsers),
    [workspaceDirectoryUsers],
  );
  const sprintInfo = useMemo(() => currentSprintParams(), []);

  // Workload, At-Risk Stories, Mini Gantt and Team Focus Mix all render one chart per roadmap;
  // multiple teams collapse into a single chart's `teams` filter.
  const isWorkloadChart = chartType === "workload";
  const isAtRiskChart = chartType === "at-risk-stories";
  const isMiniGanttChart = chartType === "mini-gantt";
  const isTeamFocusMixChart = chartType === "team-focus-mix";
  const combinesTeams = isWorkloadChart || isAtRiskChart || isMiniGanttChart || isTeamFocusMixChart;

  // Team Focus Mix supports a Sprint / Quarter scope toggle.
  const initFocusScope: "sprint" | "quarter" = useMemo(() => {
    if (!editTarget || chartType !== "team-focus-mix") return "sprint";
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(editTarget.config); } catch { /* ignore */ }
    return cfg.focusScope === "quarter" ? "quarter" : "sprint";
  }, [editTarget, chartType]);
  const [focusScope, setFocusScope] = useState<"sprint" | "quarter">(initFocusScope);
  useEffect(() => { setFocusScope(initFocusScope); }, [initFocusScope]);
  const isEditing = !!editTarget;
  const chartCount = isEditing
    ? ((selectedRoadmapIds.size === 0 && selectedTeamIds.size === 0 && selectedEpicIds.size === 0) ? 0 : 1)
    : isEpicChart
      ? selectedEpicIds.size
      : isVelocityChart
        // Velocity requires at least one team — "all teams" is not allowed.
        ? (selectedTeamIds.size === 0 ? 0 : (selectedRoadmapIds.size || 1) * selectedTeamIds.size)
        : combinesTeams
          ? ((selectedRoadmapIds.size === 0 && selectedTeamIds.size === 0)
              // At-risk / mini-gantt / team-focus-mix allow "all roadmaps + all teams" with no selection.
              ? (isAtRiskChart || isMiniGanttChart || isTeamFocusMixChart ? 1 : 0)
              : (selectedRoadmapIds.size || 1) * (
                  // 0 or 1 team → 1 chart; 2+ teams → 1 (combined) for at-risk / mini-gantt / focus-mix, or user toggle for workload
                  selectedTeamIds.size <= 1
                    ? 1
                    : (isWorkloadChart && !workloadCombineTeams) ? selectedTeamIds.size : 1
                ))
          : (selectedRoadmapIds.size === 0 && selectedTeamIds.size === 0)
            ? 0
            : (selectedRoadmapIds.size || 1) * (selectedTeamIds.size || 1);

  function toggle<T>(set: Set<T>, v: T): Set<T> {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  }

  function handleAdd() {
    if (isEpicChart) {
      if (selectedEpicMetaList.length === 0) return;
      const configs: DashboardChartConfig[] = selectedEpicMetaList.map(({ epic, initiative }) => {
        const teamId = epic.team?.trim() || null;
        const teamLabel = teamId ? (monthTeamLabelForId(teamId) ?? teamId) : null;
        // Epic charts span the epic's own plan range, not a sprint — drop the "Sprint N" segment.
        const parts = [
          CHART_META[chartType].label,
          epic.title,
          teamLabel,
        ].filter(Boolean);
        return {
          chartType,
          title: parts.join(" · "),
          params: {
            year: sprintInfo.year,
            quarter: sprintInfo.quarter,
            sprint: sprintInfo.sprint,
            epicId: epic.id,
            ...(initiative.roadmapId ? { roadmapId: initiative.roadmapId } : {}),
            ...(teamId ? { team: teamId } : {}),
            ...(supportsMetricPicker ? { metric } : {}),
            ...(supportsBasisPicker ? { basis } : {}),
          },
        };
      });
      onAdd(configs);
      setSelectedEpicIds(new Set());
      return;
    }

    const roadmapEntries = selectedRoadmapIds.size > 0
      ? roadmaps.filter((r) => selectedRoadmapIds.has(r.id))
      : [null];
    // Velocity requires a team — never fall back to a null "all teams" entry.
    if (isVelocityChart && selectedTeamIds.size === 0) return;
    const teamEntries = selectedTeamIds.size > 0 ? [...selectedTeamIds] : [null];

    const configs: DashboardChartConfig[] = [];
    const velocityStartLo = Math.min(velocityStart, velocityEnd);
    const velocityEndHi = Math.max(velocityStart, velocityEnd);
    const velocityPeriodLabel = `${SPRINT_OPTIONS[velocityStartLo - 1]?.label ?? `S${velocityStartLo}`} → ${SPRINT_OPTIONS[velocityEndHi - 1]?.label ?? `S${velocityEndHi}`}`;

    // Workload / At-Risk / Mini Gantt all collapse multiple teams into one chart per roadmap.
    // Workload alone has a user toggle to fan out per team instead.
    if (combinesTeams) {
      const teamIds = selectedTeamIds.size > 0 ? [...selectedTeamIds] : [];
      // Only workload offers the split-by-team option; the other combining charts always combine.
      const combine = teamIds.length <= 1 || !isWorkloadChart || workloadCombineTeams;
      for (const roadmap of roadmapEntries) {
        const roadmapLabel = roadmap ? roadmap.name : null;
        if (combine) {
          const teamLabelsCsv = teamIds.length > 0
            ? teamIds.map((id) => monthTeamLabelForId(id) ?? id).join(", ")
            : null;
          // Mini Gantt is quarter-scoped — don't tag it with a sprint number; show the quarter instead.
          // Team Focus Mix uses its picked scope (sprint or quarter).
          const periodLabel = isMiniGanttChart
            ? `Q${sprintInfo.quarter} ${sprintInfo.year}`
            : isTeamFocusMixChart && focusScope === "quarter"
              ? `Q${sprintInfo.quarter} ${sprintInfo.year}`
              : `Sprint ${sprintInfo.sprint}`;
          const parts = [
            CHART_META[chartType].label,
            roadmapLabel,
            teamLabelsCsv,
            periodLabel,
          ].filter(Boolean);
          configs.push({
            chartType,
            title: parts.join(" · "),
            params: {
              year: sprintInfo.year,
              quarter: sprintInfo.quarter,
              sprint: sprintInfo.sprint,
              ...(roadmap ? { roadmapId: roadmap.id } : {}),
              ...(teamIds.length === 1 ? { team: teamIds[0] } : {}),
              ...(teamIds.length > 1 ? { teams: teamIds } : {}),
              ...(supportsMetricPicker ? { metric } : {}),
            ...(supportsBasisPicker ? { basis } : {}),
              ...(isTeamFocusMixChart ? { focusScope } : {}),
            },
          });
        } else {
          for (const teamId of teamIds) {
            const teamLabel = monthTeamLabelForId(teamId) ?? teamId;
            const parts = [
              CHART_META[chartType].label,
              roadmapLabel,
              teamLabel,
              `Sprint ${sprintInfo.sprint}`,
            ].filter(Boolean);
            configs.push({
              chartType,
              title: parts.join(" · "),
              params: {
                year: sprintInfo.year,
                quarter: sprintInfo.quarter,
                sprint: sprintInfo.sprint,
                ...(roadmap ? { roadmapId: roadmap.id } : {}),
                team: teamId,
                ...(supportsMetricPicker ? { metric } : {}),
            ...(supportsBasisPicker ? { basis } : {}),
              },
            });
          }
        }
      }
      onAdd(configs);
      setSelectedRoadmapIds(new Set());
      setSelectedTeamIds(new Set());
      return;
    }

    for (const roadmap of roadmapEntries) {
      for (const teamId of teamEntries) {
        const teamLabel = teamId ? (monthTeamLabelForId(teamId) ?? teamId) : null;
        const roadmapLabel = roadmap ? roadmap.name : null;
        const parts = [
          CHART_META[chartType].label,
          roadmapLabel,
          teamLabel,
          isVelocityChart ? velocityPeriodLabel : `Sprint ${sprintInfo.sprint}`,
        ].filter(Boolean);
        configs.push({
          chartType,
          title: parts.join(" · "),
          params: {
            year: sprintInfo.year,
            ...(isVelocityChart
              ? { startYearSprint: velocityStartLo, endYearSprint: velocityEndHi }
              : { quarter: sprintInfo.quarter, sprint: sprintInfo.sprint }),
            ...(roadmap ? { roadmapId: roadmap.id } : {}),
            ...(teamId ? { team: teamId } : {}),
            ...(supportsMetricPicker ? { metric } : {}),
            ...(supportsBasisPicker ? { basis } : {}),
          },
        });
      }
    }
    onAdd(configs);
    setSelectedRoadmapIds(new Set());
    setSelectedTeamIds(new Set());
  }

  const meta = CHART_META[chartType];

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <button type="button" onClick={onBack} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
          <ChevronLeft className="size-4" />
        </button>
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl shadow-sm", meta.accent)}>
          {meta.icon}
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-slate-800 leading-tight">{meta.label}</p>
          <p className="text-[12px] text-slate-400 leading-tight mt-0.5">Select roadmaps &amp; teams</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        {/* Current sprint — for sprint-scoped charts only */}
        {!isVelocityChart && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 pl-0.5"><Flag className="size-3" />Current Sprint</p>
            <div className="flex items-center gap-2.5 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 px-4 py-3 shadow-sm">
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-indigo-500" />
              </span>
              <span className="text-sm font-semibold text-indigo-700 tracking-tight">{sprintInfo.label}</span>
            </div>
          </div>
        )}

        {/* Period — Velocity only */}
        {isVelocityChart && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <Flag className="size-3.5" />
              </span>
              <p className="text-[15px] font-bold text-slate-700">Period</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">From</span>
                <select
                  value={velocityStart}
                  onChange={(e) => setVelocityStart(parseInt(e.target.value, 10))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  {SPRINT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">To</span>
                <select
                  value={velocityEnd}
                  onChange={(e) => setVelocityEnd(parseInt(e.target.value, 10))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  {SPRINT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400 pl-0.5">Defaults to start of year through the current sprint.</p>
          </div>
        )}

        {/* Roadmaps */}
        {roadmaps.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <MapIcon className="size-3.5" />
                </span>
                <p className="text-[15px] font-bold text-slate-700">Roadmaps</p>
              </div>
              {selectedRoadmapIds.size > 0 && (
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-600">{selectedRoadmapIds.size}</span>
              )}
            </div>
            <AutocompleteMultiSelect
              options={roadmaps.map((r) => r.id)}
              selected={selectedRoadmapIds}
              onToggle={(id) => setSelectedRoadmapIds((prev) => toggle(prev, id))}
              onSelectAll={() => setSelectedRoadmapIds(new Set(roadmaps.map((r) => r.id)))}
              onClearAll={() => setSelectedRoadmapIds(new Set())}
              renderLabel={(id) => roadmaps.find((r) => r.id === id)?.name ?? id}
              renderIcon={(id) => roadmapIconNode(roadmaps.findIndex((r) => r.id === id))}
              placeholder="Search roadmaps…"
            />
          </div>
        )}

        {/* Teams */}
        {teamOptions.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Users2 className="size-3.5" />
                </span>
                <p className="text-[15px] font-bold text-slate-700">Teams</p>
              </div>
              {selectedTeamIds.size > 0 && (
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-600">{selectedTeamIds.size}</span>
              )}
            </div>
            <AutocompleteMultiSelect
              options={teamOptions.map((t) => t.id)}
              selected={selectedTeamIds}
              onToggle={(id) => setSelectedTeamIds((prev) => toggle(prev, id))}
              onSelectAll={() => setSelectedTeamIds(new Set(teamOptions.map((t) => t.id)))}
              onClearAll={() => setSelectedTeamIds(new Set())}
              renderLabel={(id) => teamOptions.find((t) => t.id === id)?.label ?? id}
              renderIcon={(id) => teamIconNode(id)}
              placeholder="Search teams…"
            />
          </div>
        )}

        {/* Metric — Burndown/Burnup only */}
        {supportsMetricPicker && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <TrendingDown className="size-3.5" />
              </span>
              <p className="text-[15px] font-bold text-slate-700">Measure by</p>
            </div>
            <div className="inline-flex w-full rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setMetric("daysLeft")}
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-all",
                  metric === "daysLeft" ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700",
                )}
              >
                Days left
              </button>
              <button
                type="button"
                onClick={() => setMetric("storyCount")}
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-all",
                  metric === "storyCount" ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700",
                )}
              >
                Stories
              </button>
            </div>
          </div>
        )}

        {/* Basis — Epic Burndown / Epic Burnup only. Drives the scope-promise
         *  reference line on the chart. Persisted in chart config so the
         *  saved chart stays on this basis even if the popover later flips. */}
        {supportsBasisPicker && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <TrendingDown className="size-3.5" />
              </span>
              <p className="text-[15px] font-bold text-slate-700">Health basis</p>
            </div>
            <div className="inline-flex w-full rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setBasis("epicEst")}
                className={cn(
                  "flex-1 rounded-lg px-2 py-2 text-[12px] font-semibold transition-all",
                  basis === "epicEst" ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700",
                )}
              >
                Epic Est (d)
              </button>
              <button
                type="button"
                onClick={() => setBasis("days")}
                className={cn(
                  "flex-1 rounded-lg px-2 py-2 text-[12px] font-semibold transition-all",
                  basis === "days" ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700",
                )}
              >
                Σ | Child Est (d)
              </button>
              <button
                type="button"
                onClick={() => setBasis("stories")}
                className={cn(
                  "flex-1 rounded-lg px-2 py-2 text-[12px] font-semibold transition-all",
                  basis === "stories" ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700",
                )}
              >
                Stories Completed (%)
              </button>
            </div>
          </div>
        )}

        {/* Team Focus Mix — Sprint vs Quarter scope */}
        {isTeamFocusMixChart && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <Flag className="size-3.5" />
              </span>
              <p className="text-[15px] font-bold text-slate-700">Period</p>
            </div>
            <div className="inline-flex w-full rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setFocusScope("sprint")}
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-all",
                  focusScope === "sprint" ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700",
                )}
              >
                This sprint
              </button>
              <button
                type="button"
                onClick={() => setFocusScope("quarter")}
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-all",
                  focusScope === "quarter" ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700",
                )}
              >
                This quarter
              </button>
            </div>
          </div>
        )}

        {/* Workload-only combine/split toggle — only meaningful with 2+ teams picked. */}
        {isWorkloadChart && selectedTeamIds.size > 1 && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <Users className="size-3.5" />
              </span>
              <p className="text-[15px] font-bold text-slate-700">Multi-team layout</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setWorkloadCombineTeams(true)}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left transition-all",
                  workloadCombineTeams
                    ? "border-indigo-300 bg-indigo-50/60 shadow-sm ring-1 ring-indigo-200"
                    : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <p className="text-[13px] font-semibold text-slate-800">One chart · team rows</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500">Each team becomes a row in a single combined chart.</p>
              </button>
              <button
                type="button"
                onClick={() => setWorkloadCombineTeams(false)}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left transition-all",
                  !workloadCombineTeams
                    ? "border-indigo-300 bg-indigo-50/60 shadow-sm ring-1 ring-indigo-200"
                    : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <p className="text-[13px] font-semibold text-slate-800">One chart per team · user rows</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500">Multiple charts, each broken down by assignee.</p>
              </button>
            </div>
          </div>
        )}

        {/* Epic picker — only for epic-burndown / epic-burnup / epic-cfd; filtered by selected roadmaps + teams. */}
        {isEpicChart ? (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Folder className="size-3.5" />
                </span>
                <p className="text-[15px] font-bold text-slate-700">Epic</p>
              </div>
              {selectedEpicIds.size > 0 ? (
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-600">
                  {selectedEpicIds.size}
                </span>
              ) : null}
            </div>
            <EpicAutocomplete
              options={epicOptions}
              selectedEpicIds={selectedEpicIds}
              onToggle={toggleEpic}
              onClearAll={() => setSelectedEpicIds(new Set())}
            />
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-4 space-y-2">
        <button
          type="button"
          disabled={chartCount === 0}
          onClick={handleAdd}
          className={cn(
            "w-full rounded-xl py-3 text-sm font-bold tracking-tight transition-all shadow-sm",
            chartCount > 0
              ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 shadow-indigo-200"
              : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none",
          )}
        >
          {chartCount === 0
            ? (isVelocityChart ? "Pick at least one team" : "Select a roadmap or team")
            : isEditing
              ? "Update chart"
              : `Add ${chartCount} chart${chartCount !== 1 ? "s" : ""}`}
        </button>
        {!isEditing && chartCount > 1 && (
          <p className="text-center text-xs text-slate-400">
            {selectedRoadmapIds.size || 1} roadmap × {selectedTeamIds.size || 1} team
          </p>
        )}
        {isEditing && (
          <button
            type="button"
            onClick={() => { onCancelEdit?.(); onBack(); }}
            className="w-full rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Q&A flow for velocity / workload / quarter-status ───────────────────────

type CollectedParams = Record<string, unknown> & {
  chartType?: string;
  year?: number;
  quarter?: number;
  quarterStr?: string;
  sprint?: number;
  team?: string;
  teamAsked?: boolean;
  metric?: string;
  metricAsked?: boolean;
};

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const QUARTER_MONTH_RANGES: Record<number, string> = { 1: "Jan–Mar", 2: "Apr–Jun", 3: "Jul–Sep", 4: "Oct–Dec" };

function formatAnswerForDisplay(field: string, raw: string): string {
  switch (field) {
    case "chartType": return CHART_META[raw as ChartType]?.label ?? raw;
    case "year": return raw;
    case "quarter": {
      const m = raw.match(/(\d{4})-Q(\d)/);
      if (!m) return raw;
      return `Q${m[2]} ${m[1]} · ${QUARTER_MONTH_RANGES[parseInt(m[2]!)] ?? ""}`;
    }
    case "sprint": {
      const sm = raw.match(/-S(\d+)$/);
      if (!sm) return raw;
      const n = parseInt(sm[1]!);
      return `Sprint ${n} · ${MONTH_NAMES[Math.ceil(n / 2) - 1] ?? ""} ${n % 2 === 1 ? "1–15" : "16–end"}`;
    }
    case "team": return monthTeamLabelForId(raw) ?? raw;
    default: return raw;
  }
}

function parseAnswer(field: string, raw: string): Partial<CollectedParams> {
  switch (field) {
    case "year": return { year: parseInt(raw, 10) };
    case "quarter": {
      const m = raw.match(/(\d{4})-Q(\d)/);
      if (!m) return {};
      return { year: parseInt(m[1]!), quarter: parseInt(m[2]!), quarterStr: raw };
    }
    case "sprint": {
      const m = raw.match(/-S(\d+)$/);
      if (!m) return {};
      return { sprint: parseInt(m[1]!) };
    }
    case "metric": return { metric: raw === "Story count" ? "storyCount" : "daysLeft", metricAsked: true };
    case "team": return { team: raw === "All teams" ? undefined : raw, teamAsked: true };
    default: return {};
  }
}

type WidgetDef = LLMQuestion["widget"];

function WidgetPicker({
  widget,
  context,
  onSelect,
}: {
  widget: WidgetDef;
  context: WorkspaceContext | null;
  onSelect: (v: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  if (widget.kind === "options") {
    return (
      <div className="flex flex-wrap gap-1.5 pt-1">
        {widget.choices.map((c) => (
          <button key={c} onClick={() => onSelect(c)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700 shadow-sm hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition-colors">
            {c}
          </button>
        ))}
      </div>
    );
  }

  if (widget.kind === "year_picker") {
    const currentYear = new Date().getFullYear();
    const years = context?.initiatives
      ? [...new Set(context.initiatives.map((i) => String(i.year)))].sort((a, b) => b.localeCompare(a))
      : [String(currentYear), String(currentYear - 1)];
    return <ScrollList options={years} activeMark={String(currentYear)} onSelect={onSelect} />;
  }

  if (widget.kind === "quarter_picker") {
    const now = new Date();
    const activeQ = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
    const raw = context?.quarters?.length ? context.quarters : [activeQ];
    const deduped = [...new Set([activeQ, ...raw])].sort((a, b) => b.localeCompare(a));
    const toLabel = (q: string) => {
      const m = q.match(/(\d{4})-Q(\d)/);
      if (!m) return q;
      return `Q${m[2]} ${m[1]} · ${QUARTER_MONTH_RANGES[parseInt(m[2]!)] ?? ""}`;
    };
    const filtered = deduped.filter((q) => !query.trim() || toLabel(q).toLowerCase().includes(query.toLowerCase()));
    return (
      <div className="flex flex-col gap-1 pt-1">
        <SearchInput ref={inputRef} value={query} onChange={setQuery} placeholder="Search quarter…" />
        <ScrollList options={filtered} activeMark={activeQ} onSelect={onSelect} renderLabel={toLabel} />
      </div>
    );
  }

  if (widget.kind === "sprint_picker") {
    const now = new Date();
    let year = now.getFullYear(), q = Math.ceil((now.getMonth() + 1) / 3);
    if (widget.quarter) {
      const m = widget.quarter.match(/(\d{4})-Q(\d)/);
      if (m) { year = parseInt(m[1]!); q = parseInt(m[2]!); }
    }
    const months: number[] = ({ 1:[1,2,3], 2:[4,5,6], 3:[7,8,9], 4:[10,11,12] } as Record<number,number[]>)[q] ?? [];
    const todayYear = now.getFullYear(), todayMonth = now.getMonth() + 1, todayHalf = now.getDate() <= 15 ? 1 : 2;
    const sprints = months.flatMap((month) => [1,2].map((half) => {
      const n = (month - 1) * 2 + half;
      const mon = MONTH_NAMES[month - 1] ?? "";
      const isActive = year === todayYear && month === todayMonth && half === todayHalf;
      return { value: `${year}-Q${q}-S${n}`, label: `Sprint ${n} · ${mon} ${half === 1 ? "1–15" : "16–end"}`, isActive };
    }));
    const active = sprints.find((s) => s.isActive);
    const sorted = active ? [active, ...sprints.filter((s) => !s.isActive)] : sprints;
    const filtered = query.trim() ? sorted.filter((s) => s.label.toLowerCase().includes(query.toLowerCase())) : sorted;
    return (
      <div className="flex flex-col gap-1 pt-1">
        <SearchInput ref={inputRef} value={query} onChange={setQuery} placeholder="Search sprint…" />
        <ScrollList options={filtered.map((s) => s.value)} activeMark={active?.value} renderLabel={(v) => sorted.find((s) => s.value === v)?.label ?? v} onSelect={onSelect} />
      </div>
    );
  }

  if (widget.kind === "team_picker") {
    const teams = context?.teams ?? ["platform", "experience", "data", "mobile", "growth"];
    const options = ["All teams", ...teams];
    const filtered = query.trim() ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())) : options;
    return (
      <div className="flex flex-col gap-1 pt-1">
        <SearchInput ref={inputRef} value={query} onChange={setQuery} placeholder="Search team…" />
        <ScrollList options={filtered} onSelect={onSelect} renderLabel={(t) => monthTeamLabelForId(t) ?? t} />
      </div>
    );
  }

  return null;
}

function SearchInput({ value, onChange, placeholder, ref: inputRef }: { value: string; onChange: (v: string) => void; placeholder: string; ref?: React.RefObject<HTMLInputElement | null> }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-200">
      <svg className="size-3.5 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
      </svg>
      <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none" />
    </div>
  );
}

function ScrollList({ options, activeMark, onSelect, renderLabel }: {
  options: string[];
  activeMark?: string;
  onSelect: (v: string) => void;
  renderLabel?: (v: string) => string;
}) {
  return (
    <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      {options.length === 0 ? (
        <p className="px-3 py-2 text-sm text-slate-400">No results</p>
      ) : options.map((o) => {
        const isActive = o === activeMark;
        const label = renderLabel ? renderLabel(o) : o;
        return (
          <button key={o} onClick={() => onSelect(o)}
            className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-indigo-50",
              isActive ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700")}>
            {isActive && <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[11px] font-bold text-indigo-600 leading-none">Active</span>}
            {label}
          </button>
        );
      })}
    </div>
  );
}

type Step = { question: string; field: string; widget: WidgetDef; display: string } | null;

function OtherChartFlow({
  chartType,
  context,
  onAdd,
  onBack,
  editTarget,
  onCancelEdit,
}: {
  chartType: ChartType;
  context: WorkspaceContext | null;
  onAdd: (config: DashboardChartConfig) => void;
  onBack: () => void;
  editTarget?: DashboardChartItem | null;
  onCancelEdit?: () => void;
}) {
  const initialParams = useMemo<CollectedParams>(
    () => editTarget ? chartItemToCollectedParams(editTarget) : { chartType },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [params, setParams] = useState<CollectedParams>(initialParams);
  const [step, setStep] = useState<Step>(null);
  const [proposal, setProposal] = useState<LLMChartProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{ q: string; a: string }>>([]);

  useEffect(() => {
    fetchNext(initialParams);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchNext(p: CollectedParams) {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: p }),
      });
      const data = await res.json();
      if (data.type === "question") {
        setStep({ question: data.text, field: data.field, widget: data.widget, display: "" });
        setProposal(null);
      } else if (data.type === "chart") {
        setStep(null);
        setProposal(data as LLMChartProposal);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleAnswer(raw: string) {
    if (!step) return;
    const display = formatAnswerForDisplay(step.field, raw);
    setHistory((prev) => [...prev, { q: step.question, a: display }]);
    const next = { ...params, ...parseAnswer(step.field, raw) };
    setParams(next);
    fetchNext(next);
  }

  function handleReset() {
    const fresh = { chartType };
    setParams(fresh);
    setProposal(null);
    setHistory([]);
    fetchNext(fresh);
  }

  const meta = CHART_META[chartType];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <button type="button" onClick={onBack} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <ChevronLeft className="size-4" />
        </button>
        <div className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", meta.accent)}>
          {meta.icon}
        </div>
        <p className="flex-1 text-base font-semibold text-slate-800">{meta.label}</p>
        {editTarget && (
          <button onClick={() => { onCancelEdit?.(); onBack(); }} className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="size-3" />
            Cancel
          </button>
        )}
        {history.length > 0 && (
          <button onClick={handleReset} className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <RotateCcw className="size-3" />
            Reset
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* History of answered questions */}
        {history.map((h, i) => (
          <div key={i} className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
            <p className="font-medium text-slate-500">{h.q}</p>
            <p className="mt-0.5 font-semibold text-slate-800">{h.a}</p>
          </div>
        ))}

        {/* Current question */}
        {loading && (
          <div className="flex items-center gap-1.5 py-2">
            <span className="size-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:300ms]" />
          </div>
        )}

        {step && !loading && (
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-700">{step.question}</p>
            <WidgetPicker widget={step.widget} context={context} onSelect={handleAnswer} />
          </div>
        )}

        {/* Proposal */}
        {proposal && !loading && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
            <p className="mb-1 text-sm font-semibold text-indigo-700">Ready to add</p>
            <p className="mb-3 text-sm text-slate-600">{proposal.title}</p>
            <div className="flex gap-2">
              <button
                onClick={() => { onAdd({ chartType: proposal.chartType, title: proposal.title, params: proposal.params }); if (editTarget) { onCancelEdit?.(); onBack(); } else { handleReset(); } }}
                className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                {editTarget ? "Update chart" : "Add to dashboard"}
              </button>
              {editTarget ? (
                <button onClick={() => { onCancelEdit?.(); onBack(); }} className="flex-1 rounded-lg border border-slate-200 bg-white py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
              ) : (
                <button onClick={handleReset} className="flex-1 rounded-lg border border-slate-200 bg-white py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                  Start over
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main entry ───────────────────────────────────────────────────────────────

type Props = {
  roadmaps: RoadmapItem[];
  workspaceDirectoryUsers: readonly SprintWorkspaceDirectoryUser[];
  context: WorkspaceContext | null;
  /** Full initiatives data — needed by the Epic Burndown / Epic Burnup epic picker. */
  initiatives?: InitiativeItem[];
  onAddCharts: (configs: DashboardChartConfig[]) => void;
  editTarget?: DashboardChartItem | null;
  onCancelEdit?: () => void;
};

export function DashboardChartBuilder({ roadmaps, workspaceDirectoryUsers, context, initiatives = [], onAddCharts, editTarget, onCancelEdit }: Props) {
  const [selectedType, setSelectedType] = useState<ChartType | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  useEffect(() => {
    if (editTarget) setSelectedType(editTarget.chartType);
  }, [editTarget]);

  function handleAddSingle(config: DashboardChartConfig) {
    onAddCharts([config]);
  }

  /** Gadgets add immediately with default config — no form needed. */
  function addGadget(type: ChartType) {
    const sprintInfo = currentSprintParams();
    if (type === "sprint-countdown") {
      onAddCharts([
        {
          chartType: type,
          title: `Sprint ${sprintInfo.sprint} Countdown`,
          params: { year: sprintInfo.year, quarter: sprintInfo.quarter, sprint: sprintInfo.sprint },
        },
      ]);
    } else if (type === "sticky-note") {
      onAddCharts([
        {
          chartType: type,
          title: "Sticky Note",
          params: { body: "" },
        },
      ]);
    }
  }

  if (selectedType && GADGET_CHART_TYPES.has(selectedType)) {
    // Should never happen — gadgets bypass the form via addGadget — but reset just in case.
    setSelectedType(null);
    return null;
  }

  if (selectedType && SPRINT_CHART_TYPES.has(selectedType)) {
    return (
      <SprintChartForm
        chartType={selectedType}
        roadmaps={roadmaps}
        workspaceDirectoryUsers={workspaceDirectoryUsers}
        initiatives={initiatives}
        onAdd={onAddCharts}
        onBack={() => setSelectedType(null)}
        editTarget={editTarget}
        onCancelEdit={onCancelEdit}
      />
    );
  }

  if (selectedType) {
    return (
      <OtherChartFlow
        chartType={selectedType}
        context={context}
        onAdd={handleAddSingle}
        onBack={() => setSelectedType(null)}
        editTarget={editTarget}
        onCancelEdit={onCancelEdit}
      />
    );
  }

  // Step 1: chart type picker
  const q = pickerQuery.trim().toLowerCase();
  const matchesQuery = (type: ChartType) => {
    if (!q) return true;
    const meta = CHART_META[type];
    return meta.label.toLowerCase().includes(q) || meta.description.toLowerCase().includes(q);
  };
  const filteredCharts = CHART_TYPE_ORDER.filter(matchesQuery);
  const filteredGadgets = [...GADGET_CHART_TYPES].filter(matchesQuery);
  const nothingMatches = q.length > 0 && filteredCharts.length === 0 && filteredGadgets.length === 0;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex items-center gap-2.5 mb-0.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
            <Wand2 className="size-4 text-white" />
          </div>
          <p className="text-lg font-bold text-slate-800">Chart Builder</p>
        </div>
        <p className="mt-1.5 text-base text-slate-500 pl-0.5">Pick a chart type to get started</p>
        {/* Autocomplete-style search — filters chart cards + gadgets live by label/description. */}
        <div className="relative mt-3">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
          </svg>
          <input
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            placeholder="Search charts and gadgets…"
            className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-7 text-[13px] text-slate-700 placeholder:text-slate-400 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            autoComplete="off"
          />
          {pickerQuery && (
            <button
              type="button"
              onClick={() => setPickerQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {nothingMatches && (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-[13px] text-slate-500">
            No charts match &ldquo;{pickerQuery}&rdquo;
          </p>
        )}
        <div className="flex flex-col gap-2">
          {filteredCharts.map((type) => {
            const meta = CHART_META[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => setSelectedType(type)}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50"
              >
                <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", meta.accent)}>
                  {meta.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{meta.label}</p>
                  <p className="text-xs leading-snug text-slate-400">{meta.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Gadgets — utility cards that bypass the chart form (added with a single click). */}
        {filteredGadgets.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Gadgets</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="flex flex-col gap-2">
            {filteredGadgets.map((type) => {
              const meta = CHART_META[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => addGadget(type)}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50"
                >
                  <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", meta.accent)}>
                    {meta.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">{meta.label}</p>
                    <p className="text-xs leading-snug text-slate-400">{meta.description}</p>
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold text-indigo-600">Add</span>
                </button>
              );
            })}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
