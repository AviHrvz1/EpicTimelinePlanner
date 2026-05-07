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
  onReorder: (next: DashboardChartItem[]) => void;
  onRemove: (id: string) => void;
  onEdit: (chart: DashboardChartItem) => void;
  onToggleSpan: (id: string) => void;
};

export function DashboardCanvas({ charts, initiatives, onReorder, onRemove, onEdit, onToggleSpan }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(event: DragEndEvent) {
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
        <p className="text-sm font-medium">Use the chat to create your first chart</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={charts.map((c) => c.id)} strategy={rectSortingStrategy}>
        <div className="grid auto-rows-auto grid-cols-2 gap-3 p-1">
          {charts.map((chart) => (
            <DashboardChartCard
              key={chart.id}
              chart={chart}
              initiatives={initiatives}
              onRemove={onRemove}
              onEdit={onEdit}
              onToggleSpan={onToggleSpan}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
