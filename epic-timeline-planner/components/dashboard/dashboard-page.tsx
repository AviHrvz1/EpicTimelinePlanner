"use client";

import { useEffect, useState } from "react";
import { Plus, Save } from "lucide-react";

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

export function DashboardPage({ initiatives, planYear, roadmaps = [], workspaceDirectoryUsers = [] }: Props) {
  const [dashboards, setDashboards] = useState<DashboardItem[]>([]);
  const [activeDashboardId, setActiveDashboardId] = useState<string | null>(null);
  const [charts, setCharts] = useState<DashboardChartItem[]>([]);
  const [context, setContext] = useState<WorkspaceContext | null>(null);
  const [editTarget, setEditTarget] = useState<DashboardChartItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

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

  async function createDashboard() {
    const res = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Dashboard ${dashboards.length + 1}` }),
    });
    const created: DashboardItem = await res.json();
    setDashboards((prev) => [created, ...prev]);
    setActiveDashboardId(created.id);
    setCharts([]);
    setDirty(false);
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
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {dashboards.map((d) => (
            <button
              key={d.id}
              onClick={() => {
                setActiveDashboardId(d.id);
                setCharts(d.charts as DashboardChartItem[]);
                setDirty(false);
              }}
              className={`inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-0 px-2.5 text-[11.5px] font-semibold leading-none tracking-wide ring-1 transition sm:px-3 sm:text-[12px] ${
                d.id === activeDashboardId
                  ? "bg-gradient-to-br from-blue-100 via-blue-200 to-blue-200 text-blue-950 ring-blue-300/75 shadow-sm hover:from-blue-100 hover:via-blue-200 hover:to-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
                  : "bg-gradient-to-br from-blue-50 via-blue-100 to-blue-100 text-blue-950 ring-blue-200/75 hover:from-blue-100 hover:via-blue-200 hover:to-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
              }`}
            >
              {d.name}
            </button>
          ))}
          <button
            onClick={createDashboard}
            className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-0 px-2.5 text-[11.5px] font-semibold leading-none tracking-wide ring-1 transition sm:px-3 sm:text-[12px] bg-gradient-to-br from-slate-50 via-slate-100 to-slate-100 text-slate-500 ring-slate-200/75 hover:from-slate-100 hover:via-slate-200 hover:to-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40"
          >
            <Plus className="size-3" />
            New
          </button>
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
              initiatives={initiatives}
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
