"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Save } from "lucide-react";

import { InitiativeItem, RoadmapItem } from "@/lib/types";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { DashboardCanvas } from "./dashboard-canvas";
import { DashboardChartBuilder } from "./dashboard-chart-builder";
import { DashboardChartConfig, DashboardChartItem, DashboardItem } from "./types";

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
  const [editTarget, setEditTarget] = useState<DashboardChartItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const pendingDashboardRef = useRef<string | null>(null);

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
              className={`shrink-0 rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                d.id === activeDashboardId
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {d.name}
            </button>
          ))}
          <button
            onClick={createDashboard}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <Plus className="size-3.5" />
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
