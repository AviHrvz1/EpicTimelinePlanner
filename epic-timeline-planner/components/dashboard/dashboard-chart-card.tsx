"use client";

import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, Maximize2, Minimize2, Pencil, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { InitiativeItem } from "@/lib/types";
import { BurndownChart } from "./charts/burndown-chart";
import { EpicBurndownChart } from "./charts/epic-burndown-chart";
import { CfdChart } from "./charts/cfd-chart";
import { EpicBurnupChart } from "./charts/epic-burnup-chart";
import { QuarterStatusChart } from "./charts/quarter-status-chart";
import { SprintBurnupChart } from "./charts/sprint-burnup-chart";
import { SprintLoadChart } from "./charts/sprint-load-chart";
import { StoryStatusChart } from "./charts/story-status-chart";
import { VelocityChart } from "./charts/velocity-chart";
import { WorkloadBalanceChart } from "./charts/workload-balance-chart";
import { WorkloadChart } from "./charts/workload-chart";
import { DashboardChartItem } from "./types";

type Props = {
  chart: DashboardChartItem;
  initiatives: InitiativeItem[];
  isEditMode: boolean;
  onRemove: (id: string) => void;
  onEdit: (chart: DashboardChartItem) => void;
  onToggleSpan: (id: string) => void;
  onChangeHeight: (id: string, delta: 1 | -1) => void;
  onRenameChart: (id: string, title: string) => void;
};

function ChartBody({ chart, initiatives }: { chart: DashboardChartItem; initiatives: InitiativeItem[] }) {
  let params: Record<string, unknown> = {};
  try { params = JSON.parse(chart.config); } catch { /* ignore */ }

  const scopedInitiatives = params.roadmapId
    ? initiatives.filter((i) => i.roadmapId === params.roadmapId)
    : initiatives;

  switch (chart.chartType) {
    case "velocity":
      return (
        <VelocityChart
          initiatives={scopedInitiatives}
          quarter={(params.quarter as string) ?? "2025-Q1"}
          team={params.team as string | null}
        />
      );
    case "burndown":
      return (
        <BurndownChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
        />
      );
    case "epic-burndown":
      return (
        <EpicBurndownChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
        />
      );
    case "cfd":
      return (
        <CfdChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
        />
      );
    case "workload":
      return (
        <WorkloadChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
        />
      );
    case "quarter-status":
      return (
        <QuarterStatusChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          team={params.team as string | null}
        />
      );
    case "story-status":
      return (
        <StoryStatusChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
        />
      );
    case "workload-balance":
      return (
        <WorkloadBalanceChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
        />
      );
    case "sprint-load":
      return (
        <SprintLoadChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
        />
      );
    case "sprint-burnup":
      return (
        <SprintBurnupChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
        />
      );
    case "epic-burnup":
      return (
        <EpicBurnupChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
        />
      );
    default:
      return <div className="flex h-32 items-center justify-center text-sm text-slate-400">Unknown chart type</div>;
  }
}

export function DashboardChartCard({ chart, initiatives, isEditMode, onRemove, onEdit, onToggleSpan, onChangeHeight, onRenameChart }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chart.id, disabled: !isEditMode });
  const rowSpan = chart.rowSpan ?? 1;
  const minHeight = 260 + (rowSpan - 1) * 220;
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(chart.title);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // Keep local value in sync if parent updates the chart title (e.g. after save/reload)
  if (!renamingTitle && titleValue !== chart.title) setTitleValue(chart.title);

  function commitRename() {
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== chart.title) onRenameChart(chart.id, trimmed);
    else setTitleValue(chart.title);
    setRenamingTitle(false);
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    minHeight,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 overflow-hidden",
        chart.colSpan === 3 ? "col-span-3" : chart.colSpan === 2 ? "col-span-2" : "col-span-1",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        {isEditMode && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none text-slate-300 hover:text-slate-500 active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        )}
        {renamingTitle ? (
          <input
            ref={titleInputRef}
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitRename(); } else if (e.key === "Escape") { setTitleValue(chart.title); setRenamingTitle(false); } }}
            className="flex-1 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-sm font-semibold text-slate-700 outline-none ring-1 ring-indigo-300 focus:ring-indigo-500"
            autoFocus
          />
        ) : (
          <span
            className="group/title flex flex-1 items-center gap-1 truncate text-sm font-semibold text-slate-700"
          >
            <span className="truncate">{chart.title}</span>
            <button
              onClick={() => { setTitleValue(chart.title); setRenamingTitle(true); setTimeout(() => titleInputRef.current?.select(), 0); }}
              className="shrink-0 rounded p-0.5 text-slate-300 opacity-0 transition-all group-hover/title:opacity-100 hover:bg-slate-100 hover:text-slate-500"
              title="Rename chart"
            >
              <Pencil className="size-3" />
            </button>
          </span>
        )}
        {isEditMode && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => onChangeHeight(chart.id, -1)}
              disabled={rowSpan <= 1}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-25 disabled:cursor-not-allowed"
              title="Decrease height"
            >
              <ChevronDown className="size-3.5" />
            </button>
            <button
              onClick={() => onChangeHeight(chart.id, 1)}
              disabled={rowSpan >= 4}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-25 disabled:cursor-not-allowed"
              title="Increase height"
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              onClick={() => onToggleSpan(chart.id)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title={chart.colSpan === 3 ? "Shrink to 1 col" : chart.colSpan === 2 ? "Expand to 3 cols" : "Expand to 2 cols"}
            >
              {chart.colSpan === 3 ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </button>
            <button
              onClick={() => onEdit(chart)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="Edit chart"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={() => onRemove(chart.id)}
              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
              title="Remove chart"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Chart body */}
      <div className="flex-1 px-2 py-3">
        <ChartBody chart={chart} initiatives={initiatives} />
      </div>
    </div>
  );
}
