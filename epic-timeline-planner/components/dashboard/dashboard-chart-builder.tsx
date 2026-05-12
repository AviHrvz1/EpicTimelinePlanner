"use client";

import {
  AreaChart,
  BarChart2,
  Bot,
  Check,
  ChevronLeft,
  PieChart,
  RotateCcw,
  TrendingDown,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { monthTeamLabelForId } from "@/lib/month-team-board";
import type { RoadmapItem } from "@/lib/types";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { capacityPlanTeamCatalogFromDirectory } from "@/lib/workspace-users";
import type { ChartType, DashboardChartConfig, DashboardChartItem, LLMChartProposal, LLMQuestion } from "./types";

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
  "story-status": {
    label: "User Stories Status",
    icon: <PieChart className="size-4 text-sky-500" />,
    description: "Pie breakdown of story statuses in a sprint",
    accent: "border-sky-200 bg-sky-50 text-sky-700",
  },
  "workload-balance": {
    label: "Workload Balance",
    icon: <BarChart2 className="size-4 text-indigo-500" />,
    description: "Stories per assignee / team grouped by status",
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
    label: "Workload",
    icon: <Users className="size-4 text-orange-500" />,
    description: "Days left by assignee for a sprint",
    accent: "border-orange-200 bg-orange-50 text-orange-700",
  },
  "quarter-status": {
    label: "Quarter Status",
    icon: <PieChart className="size-4 text-pink-500" />,
    description: "Story status breakdown for a whole quarter",
    accent: "border-pink-200 bg-pink-50 text-pink-700",
  },
};

const SPRINT_CHART_TYPES = new Set<ChartType>(["burndown", "epic-burndown", "cfd", "story-status", "workload-balance", "sprint-load", "sprint-burnup", "epic-burnup"]);

// Display order: burndowns first, burnups next, then other sprint types, then quarter-level
const CHART_TYPE_ORDER: ChartType[] = [
  "burndown",
  "epic-burndown",
  "sprint-burnup",
  "epic-burnup",
  "cfd",
  "story-status",
  "workload-balance",
  "sprint-load",
  "velocity",
  "workload",
  "quarter-status",
];

// ─── Autocomplete multi-select ────────────────────────────────────────────────

function AutocompleteMultiSelect<T extends string>({
  options,
  selected,
  onToggle,
  renderLabel,
  placeholder,
}: {
  options: T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
  renderLabel: (v: T) => string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = query.trim()
    ? options.filter((o) => renderLabel(o).toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className="flex flex-col gap-2">
      {/* Selected chips */}
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[...selected].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onToggle(v)}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-600 py-1 pl-3 pr-2 text-[11px] font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
            >
              {renderLabel(v)}
              <X className="size-2.5 shrink-0 opacity-75" />
            </button>
          ))}
        </div>
      )}
      {/* Search input */}
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
        <svg className="size-3.5 shrink-0 text-slate-300" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder ?? "Search…"}
          className="flex-1 bg-transparent text-[13px] text-slate-700 placeholder:text-slate-400 outline-none"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="shrink-0 text-slate-300 hover:text-slate-500 transition-colors">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {/* Filtered options */}
      {filtered.length === 0 ? (
        <p className="px-1 py-2 text-xs text-slate-400">No results</p>
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
                  "flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13px] transition-colors",
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
                <span className="truncate">{renderLabel(opt)}</span>
              </button>
            );
          })}
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
  onAdd,
  onBack,
  editTarget,
  onCancelEdit,
}: {
  chartType: ChartType;
  roadmaps: RoadmapItem[];
  workspaceDirectoryUsers: readonly SprintWorkspaceDirectoryUser[];
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

  const [selectedRoadmapIds, setSelectedRoadmapIds] = useState<Set<string>>(initRoadmapIds);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(initTeamIds);

  useEffect(() => {
    setSelectedRoadmapIds(initRoadmapIds);
    setSelectedTeamIds(initTeamIds);
  }, [initRoadmapIds, initTeamIds]);

  const teamOptions = useMemo(
    () => capacityPlanTeamCatalogFromDirectory(workspaceDirectoryUsers),
    [workspaceDirectoryUsers],
  );
  const sprintInfo = useMemo(() => currentSprintParams(), []);

  const isEditing = !!editTarget;
  const chartCount = isEditing
    ? ((selectedRoadmapIds.size === 0 && selectedTeamIds.size === 0) ? 0 : 1)
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
    const roadmapEntries = selectedRoadmapIds.size > 0
      ? roadmaps.filter((r) => selectedRoadmapIds.has(r.id))
      : [null];
    const teamEntries = selectedTeamIds.size > 0 ? [...selectedTeamIds] : [null];

    const configs: DashboardChartConfig[] = [];
    for (const roadmap of roadmapEntries) {
      for (const teamId of teamEntries) {
        const teamLabel = teamId ? (monthTeamLabelForId(teamId) ?? teamId) : null;
        const roadmapLabel = roadmap ? roadmap.name : null;
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
            ...(teamId ? { team: teamId } : {}),
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
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl border shadow-sm", meta.accent)}>
          {meta.icon}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-slate-800 leading-tight">{meta.label}</p>
          <p className="text-[11px] text-slate-400 leading-tight mt-0.5">Select roadmaps &amp; teams</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        {/* Current sprint */}
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Current Sprint</p>
          <div className="flex items-center gap-2.5 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 px-4 py-3 shadow-sm">
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-indigo-500" />
            </span>
            <span className="text-[13px] font-semibold text-indigo-700 tracking-tight">{sprintInfo.label}</span>
          </div>
        </div>

        {/* Roadmaps */}
        {roadmaps.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Roadmaps</p>
              {selectedRoadmapIds.size > 0 && (
                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600">{selectedRoadmapIds.size}</span>
              )}
            </div>
            <AutocompleteMultiSelect
              options={roadmaps.map((r) => r.id)}
              selected={selectedRoadmapIds}
              onToggle={(id) => setSelectedRoadmapIds((prev) => toggle(prev, id))}
              renderLabel={(id) => roadmaps.find((r) => r.id === id)?.name ?? id}
              placeholder="Search roadmaps…"
            />
          </div>
        )}

        {/* Teams */}
        {teamOptions.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Teams</p>
              {selectedTeamIds.size > 0 && (
                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600">{selectedTeamIds.size}</span>
              )}
            </div>
            <AutocompleteMultiSelect
              options={teamOptions.map((t) => t.id)}
              selected={selectedTeamIds}
              onToggle={(id) => setSelectedTeamIds((prev) => toggle(prev, id))}
              renderLabel={(id) => teamOptions.find((t) => t.id === id)?.label ?? id}
              placeholder="Search teams…"
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-4 space-y-2">
        <button
          type="button"
          disabled={chartCount === 0}
          onClick={handleAdd}
          className={cn(
            "w-full rounded-xl py-3 text-[13px] font-bold tracking-tight transition-all shadow-sm",
            chartCount > 0
              ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 shadow-indigo-200"
              : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none",
          )}
        >
          {chartCount === 0
            ? "Select a roadmap or team"
            : isEditing
              ? "Update chart"
              : `Add ${chartCount} chart${chartCount !== 1 ? "s" : ""}`}
        </button>
        {!isEditing && chartCount > 1 && (
          <p className="text-center text-[11px] text-slate-400">
            {selectedRoadmapIds.size || 1} roadmap × {selectedTeamIds.size || 1} team
          </p>
        )}
        {isEditing && (
          <button
            type="button"
            onClick={() => { onCancelEdit?.(); onBack(); }}
            className="w-full rounded-xl border border-slate-200 py-2.5 text-[13px] font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
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
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition-colors">
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
        className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none" />
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
        <p className="px-3 py-2 text-xs text-slate-400">No results</p>
      ) : options.map((o) => {
        const isActive = o === activeMark;
        const label = renderLabel ? renderLabel(o) : o;
        return (
          <button key={o} onClick={() => onSelect(o)}
            className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-indigo-50",
              isActive ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700")}>
            {isActive && <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600 leading-none">Active</span>}
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
        <div className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg border", meta.accent)}>
          {meta.icon}
        </div>
        <p className="flex-1 text-sm font-semibold text-slate-800">{meta.label}</p>
        {editTarget && (
          <button onClick={() => { onCancelEdit?.(); onBack(); }} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="size-3" />
            Cancel
          </button>
        )}
        {history.length > 0 && (
          <button onClick={handleReset} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <RotateCcw className="size-3" />
            Reset
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* History of answered questions */}
        {history.map((h, i) => (
          <div key={i} className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs">
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
            <p className="mb-2 text-xs font-semibold text-slate-700">{step.question}</p>
            <WidgetPicker widget={step.widget} context={context} onSelect={handleAnswer} />
          </div>
        )}

        {/* Proposal */}
        {proposal && !loading && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
            <p className="mb-1 text-xs font-semibold text-indigo-700">Ready to add</p>
            <p className="mb-3 text-xs text-slate-600">{proposal.title}</p>
            <div className="flex gap-2">
              <button
                onClick={() => { onAdd({ chartType: proposal.chartType, title: proposal.title, params: proposal.params }); if (editTarget) { onCancelEdit?.(); onBack(); } else { handleReset(); } }}
                className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                {editTarget ? "Update chart" : "Add to dashboard"}
              </button>
              {editTarget ? (
                <button onClick={() => { onCancelEdit?.(); onBack(); }} className="flex-1 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
              ) : (
                <button onClick={handleReset} className="flex-1 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
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
  onAddCharts: (configs: DashboardChartConfig[]) => void;
  editTarget?: DashboardChartItem | null;
  onCancelEdit?: () => void;
};

export function DashboardChartBuilder({ roadmaps, workspaceDirectoryUsers, context, onAddCharts, editTarget, onCancelEdit }: Props) {
  const [selectedType, setSelectedType] = useState<ChartType | null>(null);

  useEffect(() => {
    if (editTarget) setSelectedType(editTarget.chartType);
  }, [editTarget]);

  function handleAddSingle(config: DashboardChartConfig) {
    onAddCharts([config]);
  }

  if (selectedType && SPRINT_CHART_TYPES.has(selectedType)) {
    return (
      <SprintChartForm
        chartType={selectedType}
        roadmaps={roadmaps}
        workspaceDirectoryUsers={workspaceDirectoryUsers}
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
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex items-center gap-2.5 mb-0.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 shadow-sm">
            <Bot className="size-4 text-white" />
          </div>
          <p className="text-base font-bold text-slate-800">Chart Builder</p>
        </div>
        <p className="mt-1.5 text-sm text-slate-500 pl-0.5">Pick a chart type to get started</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-2">
          {CHART_TYPE_ORDER.map((type) => {
            const meta = CHART_META[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => setSelectedType(type)}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50"
              >
                <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border", meta.accent)}>
                  {meta.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800">{meta.label}</p>
                  <p className="text-[11px] leading-snug text-slate-400">{meta.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
