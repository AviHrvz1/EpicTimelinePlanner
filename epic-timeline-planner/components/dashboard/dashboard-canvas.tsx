"use client";

import { DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { LayoutDashboard } from "lucide-react";

import { InitiativeItem } from "@/lib/types";
import { DashboardChartCard } from "./dashboard-chart-card";
import { DashboardChartItem } from "./types";

type Props = {
  charts: DashboardChartItem[];
  initiatives: InitiativeItem[];
  isEditMode: boolean;
  onReorder: (next: DashboardChartItem[]) => void;
  onRemove: (id: string) => void;
  onEdit: (chart: DashboardChartItem) => void;
  onToggleSpan: (id: string) => void;
  onChangeHeight: (id: string, delta: 1 | -1) => void;
  onRenameChart: (id: string, title: string) => void;
};

export function DashboardCanvas({ charts, initiatives, isEditMode, onReorder, onRemove, onEdit, onToggleSpan, onChangeHeight, onRenameChart }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(event: DragEndEvent) {
    if (!isEditMode) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = charts.findIndex((c) => c.id === active.id);
    const newIndex = charts.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(charts, oldIndex, newIndex).map((c, i) => ({ ...c, position: i }));
    onReorder(reordered);
  }

  if (charts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
        <LayoutDashboard className="size-10 opacity-25" />
        <p className="text-sm font-medium">{isEditMode ? "Use the chart builder to add your first chart" : "No charts yet — click Edit to add charts"}</p>
      </div>
    );
  }

  const grid = (
    <div className="grid auto-rows-auto grid-cols-2 gap-3 p-1">
      {charts.map((chart) => (
        <DashboardChartCard
          key={chart.id}
          chart={chart}
          initiatives={initiatives}
          isEditMode={isEditMode}
          onRemove={onRemove}
          onEdit={onEdit}
          onToggleSpan={onToggleSpan}
          onChangeHeight={onChangeHeight}
          onRenameChart={onRenameChart}
        />
      ))}
    </div>
  );

  if (!isEditMode) return grid;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={charts.map((c) => c.id)} strategy={rectSortingStrategy}>
        {grid}
      </SortableContext>
    </DndContext>
  );
}
