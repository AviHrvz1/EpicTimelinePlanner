"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Plus, Save, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { InitiativeItem, RoadmapItem } from "@/lib/types";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { DashboardCanvas } from "./dashboard-canvas";
import { DashboardChartBuilder } from "./dashboard-chart-builder";
import { DashboardChartConfig, DashboardChartItem, DashboardItem } from "./types";

type WorkspaceContext = {
  teams: string[];
  users: Array<{ id: string; name: string; team: string }>;
  quarters: string[];
  sprints: string[];
  initiatives: Array<{ id: string; title: string; status: string; year: number }>;
};

type Props = {
  initiatives: InitiativeItem[];
  planYear: number;
  roadmaps?: RoadmapItem[];
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
};

export function DashboardPage({ initiatives: passedInitiatives, planYear, roadmaps = [], workspaceDirectoryUsers = [] }: Props) {
  const [dashboards, setDashboards] = useState<DashboardItem[]>([]);
  const [activeDashboardId, setActiveDashboardId] = useState<string | null>(null);
  const [charts, setCharts] = useState<DashboardChartItem[]>([]);
  const [context, setContext] = useState<WorkspaceContext | null>(null);
  const [editTarget, setEditTarget] = useState<DashboardChartItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // New dashboard name input
  const [creatingName, setCreatingName] = useState(false);
  const [newName, setNewName] = useState("");
  const newNameRef = useRef<HTMLInputElement>(null);
  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Full cross-roadmap initiative dataset for charts (not filtered to active roadmap)
  const [allInitiatives, setAllInitiatives] = useState<InitiativeItem[]>(passedInitiatives);

  useEffect(() => {
    const year = new Date().getFullYear();
    fetch(`/api/initiatives?year=${year}&roadmapId=all`)
      .then((r) => r.json())
      .then((data: InitiativeItem[]) => setAllInitiatives(data))
      .catch(() => setAllInitiatives(passedInitiatives));
  // Re-fetch when planYear changes so charts always see the right year's data
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planYear]);

  useEffect(() => {
    fetch("/api/dashboard/context").then((r) => r.json()).then(setContext).catch(() => null);
  }, []);

  // Load dashboards
  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((list: DashboardItem[]) => {
        setDashboards(list);
        if (list.length > 0 && !activeDashboardId) {
          setActiveDashboardId(list[0].id);
          setCharts(list[0].charts as DashboardChartItem[]);
        }
      })
      .catch(() => null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureDashboard(): Promise<string> {
    if (activeDashboardId) return activeDashboardId;
    const res = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Dashboard" }),
    });
    const created: DashboardItem = await res.json();
    setDashboards((prev) => [created, ...prev]);
    setActiveDashboardId(created.id);
    return created.id;
  }

  function startCreating() {
    setNewName("");
    setCreatingName(true);
    setTimeout(() => newNameRef.current?.focus(), 0);
  }

  async function confirmCreate() {
    const name = newName.trim() || `Dashboard ${dashboards.length + 1}`;
    setCreatingName(false);
    const res = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const created: DashboardItem = await res.json();
    setDashboards((prev) => [...prev, created]);
    setActiveDashboardId(created.id);
    setCharts([]);
    setDirty(false);
  }

  async function deleteDashboard(id: string) {
    await fetch(`/api/dashboard/${id}`, { method: "DELETE" });
    setDashboards((prev) => prev.filter((d) => d.id !== id));
    setConfirmDeleteId(null);
    if (activeDashboardId === id) {
      const remaining = dashboards.filter((d) => d.id !== id);
      if (remaining.length > 0) {
        setActiveDashboardId(remaining[0].id);
        setCharts(remaining[0].charts as DashboardChartItem[]);
      } else {
        setActiveDashboardId(null);
        setCharts([]);
      }
      setDirty(false);
    }
  }

  async function save() {
    if (!activeDashboardId) return;
    setSaving(true);
    await fetch(`/api/dashboard/${activeDashboardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        charts: charts.map((c, i) => ({
          chartType: c.chartType,
          title: c.title,
          config: c.config,
          position: i,
          colSpan: c.colSpan,
        })),
      }),
    });
    setSaving(false);
    setDirty(false);
  }

  async function handleAddCharts(configs: DashboardChartConfig[]) {
    const dashId = await ensureDashboard();
    const now = Date.now();
    const newCharts: DashboardChartItem[] = configs.map((config, i) => ({
      id: `local-${now}-${i}`,
      dashboardId: dashId,
      chartType: config.chartType,
      title: config.title,
      config: JSON.stringify(config.params),
      position: charts.length + i,
      colSpan: 1,
      createdAt: new Date().toISOString(),
    }));
    setCharts((prev) => [...prev, ...newCharts]);
    setDirty(true);
  }

  function handleRemove(chartId: string) {
    setCharts((prev) => prev.filter((c) => c.id !== chartId));
    setDirty(true);
  }

  function handleEdit(chart: DashboardChartItem) {
    setEditTarget(chart);
  }

  function handleToggleSpan(chartId: string) {
    setCharts((prev) =>
      prev.map((c) => (c.id === chartId ? { ...c, colSpan: c.colSpan === 2 ? 1 : 2 } : c)),
    );
    setDirty(true);
  }

  function handleReorder(next: DashboardChartItem[]) {
    setCharts(next);
    setDirty(true);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 shadow-md ring-1 ring-slate-200/60">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
          {dashboards.map((d) => {
            const isActive = d.id === activeDashboardId;
            const isConfirming = confirmDeleteId === d.id;
            return (
              <div key={d.id} className="group relative shrink-0">
                {isConfirming ? (
                  /* Inline delete confirmation */
                  <div className="inline-flex h-7 items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-2.5 text-[11.5px] font-semibold text-red-700 ring-1 ring-red-200 sm:px-3 sm:text-[12px]">
                    <span className="whitespace-nowrap">Delete "{d.name}"?</span>
                    <button
                      onClick={() => deleteDashboard(d.id)}
                      className="ml-0.5 rounded-full bg-red-500 p-0.5 text-white hover:bg-red-600 transition-colors"
                      title="Confirm delete"
                    >
                      <Check className="size-2.5" strokeWidth={3} />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-full p-0.5 text-red-400 hover:text-red-600 transition-colors"
                      title="Cancel"
                    >
                      <X className="size-2.5" strokeWidth={3} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setActiveDashboardId(d.id);
                      setCharts(d.charts as DashboardChartItem[]);
                      setConfirmDeleteId(null);
                      setDirty(false);
                    }}
                    className={cn(
                      "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border-0 pl-2.5 pr-1.5 text-[11.5px] font-semibold leading-none tracking-wide ring-1 transition sm:pl-3 sm:text-[12px]",
                      isActive
                        ? "bg-gradient-to-br from-blue-400 via-blue-500 to-blue-600 text-white ring-blue-500/75 shadow-sm"
                        : "bg-gradient-to-br from-blue-200 via-blue-300 to-blue-300 text-blue-900 ring-blue-300/75 hover:from-blue-300 hover:via-blue-400 hover:to-blue-400",
                    )}
                  >
                    {d.name}
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(d.id); }}
                      className={cn(
                        "ml-0.5 rounded-full p-0.5 transition-all",
                        isActive
                          ? "text-blue-200 opacity-0 group-hover:opacity-100 hover:bg-blue-700/40 hover:text-white"
                          : "text-blue-600/50 opacity-0 group-hover:opacity-100 hover:bg-blue-200 hover:text-blue-800",
                      )}
                      title="Delete dashboard"
                    >
                      <Trash2 className="size-2.5" />
                    </span>
                  </button>
                )}
              </div>
            );
          })}

          {/* New dashboard — inline name input */}
          {creatingName ? (
            <div className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-indigo-300 bg-indigo-50 px-2 ring-1 ring-indigo-200 focus-within:ring-indigo-400">
              <input
                ref={newNameRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmCreate();
                  if (e.key === "Escape") setCreatingName(false);
                }}
                placeholder="Dashboard name…"
                className="w-28 bg-transparent text-[11.5px] font-semibold text-indigo-800 placeholder:font-normal placeholder:text-indigo-400 outline-none sm:text-[12px]"
              />
              <button onClick={confirmCreate} className="rounded-full bg-indigo-500 p-0.5 text-white hover:bg-indigo-600 transition-colors" title="Create">
                <Check className="size-2.5" strokeWidth={3} />
              </button>
              <button onClick={() => setCreatingName(false)} className="rounded-full p-0.5 text-indigo-400 hover:text-indigo-600 transition-colors" title="Cancel">
                <X className="size-2.5" strokeWidth={3} />
              </button>
            </div>
          ) : (
            <button
              onClick={startCreating}
              className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-0 px-2.5 text-[11.5px] font-semibold leading-none tracking-wide ring-1 transition sm:px-3 sm:text-[12px] bg-gradient-to-br from-slate-50 via-slate-100 to-slate-100 text-slate-500 ring-slate-200/75 hover:from-slate-100 hover:via-slate-200 hover:to-slate-200 hover:text-slate-700"
            >
              <Plus className="size-3" />
              New
            </button>
          )}
        </div>

        {dirty && activeDashboardId && (
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            <Save className="size-3.5" />
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>

      {/* Main split */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Builder panel */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-slate-200 bg-white">
          <DashboardChartBuilder
            key={editTarget?.id ?? "new"}
            roadmaps={roadmaps}
            workspaceDirectoryUsers={workspaceDirectoryUsers}
            context={context}
            onAddCharts={handleAddCharts}
          />
        </div>

        {/* Canvas */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4"
          style={{
            backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          {activeDashboardId ? (
            <DashboardCanvas
              charts={charts}
              initiatives={allInitiatives}
              onReorder={handleReorder}
              onRemove={handleRemove}
              onEdit={handleEdit}
              onToggleSpan={handleToggleSpan}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
              <p className="text-sm">Select roadmap or team and click Add to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
