"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, LayoutDashboard, Pencil, Plus, Trash2, X } from "lucide-react";

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
  const [isEditMode, setIsEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Save modal
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveNameDraft, setSaveNameDraft] = useState("");
  const saveNameRef = useRef<HTMLInputElement>(null);
  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Builder panel open/collapsed + resize
  const [builderOpen, setBuilderOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(380);
  const isDraggingPanel = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(380);
  // Full cross-roadmap initiative dataset for charts (not filtered to active roadmap)
  const [allInitiatives, setAllInitiatives] = useState<InitiativeItem[]>(passedInitiatives);

  useEffect(() => {
    const year = new Date().getFullYear();
    fetch(`/api/initiatives?year=${year}&roadmapId=all`)
      .then((r) => r.json())
      .then((data: InitiativeItem[]) => setAllInitiatives(data))
      .catch(() => setAllInitiatives(passedInitiatives));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planYear]);

  useEffect(() => {
    fetch("/api/dashboard/context").then((r) => r.json()).then(setContext).catch(() => null);
  }, []);

  // Load dashboards, then spawn a blank draft as the active working area
  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((list: DashboardItem[]) => {
        const draftId = `draft-${Date.now()}`;
        const draft: DashboardItem = {
          id: draftId,
          slug: "",
          name: `Dashboard ${list.length + 1}`,
          charts: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setDashboards([...list, draft]);
        // Select first saved dashboard if any, otherwise fall back to the blank draft
        const firstSaved = list[0];
        if (firstSaved) {
          setActiveDashboardId(firstSaved.id);
          setCharts(firstSaved.charts);
        } else {
          setActiveDashboardId(draftId);
        }
      })
      .catch(() => null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Create a fresh blank dashboard tab and make it active.
   * Drafts now show as tabs (prepended as the first tab) so users immediately see the new
   * empty dashboard rather than continuing to see whichever dashboard was previously selected.
   */
  function spawnBlankDraft(savedList?: DashboardItem[]) {
    const draftId = `draft-${Date.now()}`;
    const list = savedList ?? dashboards;
    const draft: DashboardItem = {
      id: draftId,
      slug: "",
      name: `New Dashboard ${list.filter((d) => !d.id.startsWith("draft-")).length + 1}`,
      charts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setDashboards((prev) => {
      const withoutOldDrafts = prev.filter((d) => !d.id.startsWith("draft-"));
      return [draft, ...withoutOldDrafts];
    });
    setActiveDashboardId(draftId);
    setCharts([]);
    setDirty(false);
    setIsEditMode(true);
    setBuilderOpen(true);
    setEditTarget(null);
    setConfirmDeleteId(null);
  }

  function ensureDashboard(): string {
    if (activeDashboardId) return activeDashboardId;
    const draftId = `draft-${Date.now()}`;
    const draft: DashboardItem = {
      id: draftId,
      slug: "",
      name: `Dashboard ${dashboards.filter((d) => !d.id.startsWith("draft-")).length + 1}`,
      charts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setDashboards((prev) => [...prev, draft]);
    setActiveDashboardId(draftId);
    return draftId;
  }

  async function renameDashboard(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setDashboards((prev) => prev.map((d) => d.id === id ? { ...d, name: trimmed } : d));
    setRenamingId(null);
    if (!id.startsWith("draft-")) {
      await fetch(`/api/dashboard/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed }) });
    }
  }

  function renameChart(chartId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setCharts((prev) => prev.map((c) => c.id === chartId ? { ...c, title: trimmed } : c));
    setDirty(true);
  }

  /** Merge partial params into a chart's config JSON. Used by gadgets (Sticky Note) to persist their state. */
  function updateChartConfig(chartId: string, partialParams: Record<string, unknown>) {
    setCharts((prev) => prev.map((c) => {
      if (c.id !== chartId) return c;
      let params: Record<string, unknown> = {};
      try { params = JSON.parse(c.config) as Record<string, unknown>; } catch { /* ignore */ }
      return { ...c, config: JSON.stringify({ ...params, ...partialParams }) };
    }));
    setDirty(true);
  }

  async function deleteDashboard(id: string) {
    if (!id.startsWith("draft-")) {
      await fetch(`/api/dashboard/${id}`, { method: "DELETE" });
    }
    setDashboards((prev) => prev.filter((d) => d.id !== id));
    setConfirmDeleteId(null);
    if (activeDashboardId === id) {
      // Switch to the existing draft if there is one, else the first saved dashboard
      const remaining = dashboards.filter((d) => d.id !== id);
      const draft = remaining.find((d) => d.id.startsWith("draft-"));
      const fallback = draft ?? remaining[0];
      if (fallback) {
        setActiveDashboardId(fallback.id);
        setCharts(fallback.charts as DashboardChartItem[]);
      } else {
        setActiveDashboardId(null);
        setCharts([]);
      }
      setDirty(false);
    }
  }

  function openSaveModal() {
    if (!activeDashboardId) return;
    const current = dashboards.find((d) => d.id === activeDashboardId);
    setSaveNameDraft(current?.name ?? "");
    setShowSaveModal(true);
    setTimeout(() => { saveNameRef.current?.focus(); saveNameRef.current?.select(); }, 0);
  }

  async function confirmSave() {
    if (!activeDashboardId) return;
    setShowSaveModal(false);
    setSaving(true);
    const name = saveNameDraft.trim() || dashboards.find((d) => d.id === activeDashboardId)?.name || "My Dashboard";

    const chartsPayload = charts.map((c, i) => ({
      chartType: c.chartType,
      title: c.title,
      config: c.config,
      position: i,
      colSpan: c.colSpan,
      rowSpan: c.rowSpan ?? 1,
    }));

    if (activeDashboardId.startsWith("draft-")) {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, charts: chartsPayload }),
      });
      const rawText = await res.text();
      let created: Record<string, unknown> = {};
      try { created = JSON.parse(rawText); } catch { /* non-JSON body */ }
      if (!res.ok || !created?.id) {
        console.error("[confirmSave] API error status:", res.status, "body:", rawText.slice(0, 500));
        setSaveError(created?.error as string ?? `Save failed (HTTP ${res.status}) — check the server logs.`);
        setSaving(false);
        return;
      }
      setSaveError(null);
      // Replace draft with saved dashboard; select the saved tab; spawn a new blank draft
      setDashboards((prev) => {
        const withoutDraft = prev.filter((d) => d.id !== activeDashboardId);
        const newDraftId = `draft-${Date.now()}`;
        const newDraft: DashboardItem = {
          id: newDraftId,
          slug: "",
          name: `Dashboard ${withoutDraft.length + 2}`,
          charts: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setTimeout(() => {
          setActiveDashboardId(created.id as string);
          setCharts((created.charts ?? []) as DashboardChartItem[]);
          setDirty(false);
        }, 0);
        return [...withoutDraft, created as unknown as DashboardItem, newDraft];
      });
    } else {
      await fetch(`/api/dashboard/${activeDashboardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, charts: chartsPayload }),
      });
      setDashboards((prev) => prev.map((d) => d.id === activeDashboardId ? { ...d, name } : d));
      setSaving(false);
      setDirty(false);
      setIsEditMode(false);
      setBuilderOpen(false);
      setEditTarget(null);
      return;
    }

    setSaving(false);
    setDirty(false);
    setBuilderOpen(false);
  }

  function handleAddCharts(configs: DashboardChartConfig[]) {
    if (editTarget) {
      const config = configs[0];
      if (!config) return;
      setCharts((prev) =>
        prev.map((c) =>
          c.id === editTarget.id
            ? { ...c, chartType: config.chartType, title: config.title, config: JSON.stringify(config.params) }
            : c,
        ),
      );
      setEditTarget(null);
      setDirty(true);
      return;
    }
    const dashId = ensureDashboard();
    const now = Date.now();
    const newCharts: DashboardChartItem[] = configs.map((config, i) => ({
      id: `local-${now}-${i}`,
      dashboardId: dashId,
      chartType: config.chartType,
      title: config.title,
      config: JSON.stringify(config.params),
      position: charts.length + i,
      colSpan: 1,
      rowSpan: 1,
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
      prev.map((c) => (c.id === chartId ? { ...c, colSpan: ((c.colSpan ?? 1) % 3) + 1 as 1 | 2 | 3 } : c)),
    );
    setDirty(true);
  }

  function handleDecreaseSpan(chartId: string) {
    setCharts((prev) =>
      prev.map((c) => {
        if (c.id !== chartId) return c;
        const span = c.colSpan ?? 1;
        return { ...c, colSpan: (span === 1 ? 3 : span - 1) as 1 | 2 | 3 };
      }),
    );
    setDirty(true);
  }

  function handleChangeHeight(chartId: string, delta: 1 | -1) {
    setCharts((prev) =>
      prev.map((c) =>
        c.id === chartId ? { ...c, rowSpan: Math.max(1, Math.min(4, (c.rowSpan ?? 1) + delta)) } : c,
      ),
    );
    setDirty(true);
  }

  function handleReorder(next: DashboardChartItem[]) {
    setCharts(next);
    setDirty(true);
  }

  const startPanelDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingPanel.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;

    function onMouseMove(ev: MouseEvent) {
      if (!isDraggingPanel.current) return;
      const next = Math.max(200, Math.min(560, dragStartWidth.current + ev.clientX - dragStartX.current));
      setPanelWidth(next);
    }
    function onMouseUp() {
      isDraggingPanel.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [panelWidth]);

  const isSavedDashboard = !!activeDashboardId && !activeDashboardId.startsWith("draft-");
  const effectiveEditMode = activeDashboardId?.startsWith("draft-") || isEditMode;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 shadow-md ring-1 ring-slate-200/60">
      {/* Tab bar — browser-style */}
      <div className="flex items-end gap-0 border-b border-slate-200 bg-slate-50 pl-3 pr-4 pt-2">
        {/* Tabs */}
        <div className="flex flex-1 items-end gap-0 overflow-x-auto">
          {dashboards.filter((d) => Boolean(d.id)).map((d) => {
            const isActive = d.id === activeDashboardId;
            const isConfirming = confirmDeleteId === d.id;
            return (
              <div key={d.id} className="group relative shrink-0">
                {isConfirming ? (
                  <div className="mb-[-1px] inline-flex h-9 items-center gap-1.5 rounded-t-md border border-b-0 border-red-300 bg-red-50 px-3 text-[12px] font-semibold text-red-700">
                    <span className="whitespace-nowrap">Delete "{d.name}"?</span>
                    <button
                      onClick={() => deleteDashboard(d.id)}
                      className="rounded-full bg-red-500 p-0.5 text-white hover:bg-red-600 transition-colors"
                      title="Confirm delete"
                    >
                      <Check className="size-2.5" strokeWidth={3} />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded p-0.5 text-red-400 hover:text-red-600 transition-colors"
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
                      setEditTarget(null);
                      // Empty dashboards (drafts or saved-but-no-charts) auto-open the chart builder
                      // so the user lands on the next action instead of an empty canvas.
                      const isEmpty = d.id.startsWith("draft-") || ((d.charts ?? []).length === 0);
                      setIsEditMode(isEmpty);
                      setBuilderOpen(isEmpty);
                    }}
                    className={cn(
                      "group/tab mb-[-1px] inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-t-md border border-b-0 px-4 text-[13px] font-medium leading-none transition-colors",
                      isActive
                        ? "border-slate-200 bg-white text-slate-800 shadow-[0_-1px_0_0_white]"
                        : "border-transparent bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700",
                    )}
                  >
                    {isActive && renamingId === d.id ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => renameDashboard(d.id, renameValue)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); renameDashboard(d.id, renameValue); }
                          if (e.key === "Escape") { setRenamingId(null); }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-32 bg-transparent text-[13px] font-medium text-slate-800 outline-none border-b border-slate-400 leading-none"
                        autoFocus
                      />
                    ) : (
                      <>
                        {d.name}
                        {isActive && (
                          <span
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingId(d.id);
                              setRenameValue(d.name);
                              setTimeout(() => renameInputRef.current?.select(), 0);
                            }}
                            className="ml-0.5 rounded p-0.5 text-slate-300 opacity-0 transition-all group-hover/tab:opacity-100 hover:bg-slate-100 hover:text-slate-500"
                            title="Rename dashboard"
                          >
                            <Pencil className="size-3" />
                          </span>
                        )}
                      </>
                    )}
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(d.id); }}
                      className="ml-0.5 rounded p-0.5 text-slate-300 opacity-0 transition-all group-hover/tab:opacity-100 hover:bg-slate-100 hover:text-slate-500"
                      title="Delete dashboard"
                    >
                      <X className="size-3" />
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Right-side actions */}
        <div className="flex shrink-0 items-center gap-2 self-center">
          {(() => {
            const activeSlug = dashboards.find((d) => d.id === activeDashboardId)?.slug;
            return activeSlug ? (
              <a
                href={`/dashboard/${activeSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open full view"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border-0 px-2.5 text-[12px] font-semibold text-white shadow-none transition-all bg-gradient-to-br from-slate-400 to-slate-500 hover:from-slate-500 hover:to-slate-600 [&_svg]:text-white"
              >
                <ExternalLink className="size-3.5" />
                Full view
              </a>
            ) : null;
          })()}

          {/* Edit button — only for saved dashboards when not already editing */}
          {isSavedDashboard && !isEditMode && (
            <button
              onClick={() => { setIsEditMode(true); setBuilderOpen(true); }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[12px] font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-400 [&_svg]:text-slate-500"
            >
              <Pencil className="size-3.5" />
              Edit
            </button>
          )}

          {/* Done button — exit edit mode on a saved dashboard */}
          {isSavedDashboard && isEditMode && (
            <button
              onClick={() => { setIsEditMode(false); setBuilderOpen(false); setEditTarget(null); }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border-0 px-2.5 text-[12px] font-semibold text-white shadow-none transition-all bg-gradient-to-br from-teal-400 to-teal-500 hover:from-teal-500 hover:to-teal-600 [&_svg]:text-white"
            >
              <Check className="size-3.5" />
              Done
            </button>
          )}

          <button
            onClick={() => spawnBlankDraft()}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border-0 px-2.5 text-[12px] font-semibold shadow-none transition-all",
              "bg-gradient-to-br from-sky-400 via-blue-500 to-sky-500 text-white",
              "hover:from-sky-500 hover:via-blue-600 hover:to-sky-600",
              "[&_svg]:text-white",
            )}
            title="Create a new empty dashboard"
          >
            <Plus className="size-3.5" />
            Dashboard
          </button>

          {activeDashboardId && charts.length > 0 && (dirty || activeDashboardId.startsWith("draft-")) && (
            <button
              onClick={openSaveModal}
              disabled={saving}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border-0 bg-gradient-to-r from-violet-600 to-indigo-600 px-3 text-[12px] font-semibold text-white shadow-sm shadow-violet-500/25 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 transition-all [&_svg]:text-white"
            >
              <Check className="size-3.5" />
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>

      {/* Main split */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Builder panel — only mounted/visible when open and in edit mode */}
        {builderOpen && effectiveEditMode && (
          <>
            <div className="flex shrink-0 flex-col bg-white" style={{ width: panelWidth }}>
              <DashboardChartBuilder
                key={editTarget?.id ?? "new"}
                roadmaps={roadmaps}
                workspaceDirectoryUsers={workspaceDirectoryUsers}
                context={context}
                initiatives={allInitiatives}
                onAddCharts={handleAddCharts}
                editTarget={editTarget}
                onCancelEdit={() => setEditTarget(null)}
              />
            </div>

            {/* Resize handle */}
            <div
              onMouseDown={startPanelDrag}
              className="group relative flex w-2 shrink-0 cursor-col-resize items-center justify-center border-r border-slate-200 bg-white hover:bg-indigo-50 transition-colors"
              title="Drag to resize panel"
            >
              <div className="h-8 w-0.5 rounded-full bg-slate-300 group-hover:bg-indigo-400 transition-colors" />
            </div>
          </>
        )}

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
              isEditMode={!!effectiveEditMode}
              onReorder={handleReorder}
              onRemove={handleRemove}
              onEdit={handleEdit}
              onToggleSpan={handleToggleSpan}
              onDecreaseSpan={handleDecreaseSpan}
              onChangeHeight={handleChangeHeight}
              onRenameChart={renameChart}
              onUpdateConfig={updateChartConfig}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
              <p className="text-sm">Click + New to create a dashboard, then add charts</p>
            </div>
          )}
        </div>
      </div>

      {/* Save modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowSaveModal(false)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h2 className="mb-1 text-base font-bold text-slate-800">Save Dashboard</h2>
            <p className="mb-4 text-xs text-slate-500">Give your dashboard a name before saving.</p>
            <input
              ref={saveNameRef}
              value={saveNameDraft}
              onChange={(e) => setSaveNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmSave(); if (e.key === "Escape") setShowSaveModal(false); }}
              placeholder="Dashboard name…"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            {saveError && (
              <p className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{saveError}</p>
            )}
            <div className="mt-4 flex gap-2.5">
              <button
                onClick={confirmSave}
                disabled={!saveNameDraft.trim()}
                className="flex-1 rounded-xl border-0 bg-gradient-to-r from-violet-600 to-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 transition-all"
              >
                Save
              </button>
              <button
                onClick={() => setShowSaveModal(false)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
