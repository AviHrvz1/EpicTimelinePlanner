"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Maximize2, Minimize2, Pencil, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { InitiativeItem } from "@/lib/types";
import { BurndownChart } from "./charts/burndown-chart";
import { CfdChart } from "./charts/cfd-chart";
import { QuarterStatusChart } from "./charts/quarter-status-chart";
import { VelocityChart } from "./charts/velocity-chart";
import { WorkloadChart } from "./charts/workload-chart";
import { DashboardChartItem } from "./types";

type Props = {
  chart: DashboardChartItem;
  initiatives: InitiativeItem[];
  onRemove: (id: string) => void;
  onEdit: (chart: DashboardChartItem) => void;
  onToggleSpan: (id: string) => void;
};

function ChartBody({ chart, initiatives }: { chart: DashboardChartItem; initiatives: InitiativeItem[] }) {
  let params: Record<string, unknown> = {};
  try { params = JSON.parse(chart.config); } catch { /* ignore */ }

  switch (chart.chartType) {
    case "velocity":
      return (
        <VelocityChart
          initiatives={initiatives}
          quarter={(params.quarter as string) ?? "2025-Q1"}
          team={params.team as string | null}
        />
      );
    case "burndown":
      return (
        <BurndownChart
          initiatives={initiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
        />
      );
    case "cfd":
      return (
        <CfdChart
          initiatives={initiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
        />
      );
    case "workload":
      return (
        <WorkloadChart
          initiatives={initiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
        />
      );
    case "quarter-status":
      return (
        <QuarterStatusChart
          initiatives={initiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          team={params.team as string | null}
        />
      );
    default:
      return <div className="flex h-32 items-center justify-center text-sm text-slate-400">Unknown chart type</div>;
  }
}

export function DashboardChartCard({ chart, initiatives, onRemove, onEdit, onToggleSpan }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chart.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 overflow-hidden",
        chart.colSpan === 2 ? "col-span-2" : "col-span-1",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <span className="flex-1 truncate text-sm font-semibold text-slate-700">{chart.title}</span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => onToggleSpan(chart.id)}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title={chart.colSpan === 2 ? "Shrink to 1 column" : "Expand to 2 columns"}
          >
            {chart.colSpan === 2 ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
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
      </div>

      {/* Chart body */}
      <div className="flex-1 px-2 py-3">
        <ChartBody chart={chart} initiatives={initiatives} />
      </div>
    </div>
  );
}
