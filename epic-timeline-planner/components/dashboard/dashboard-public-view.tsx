"use client";

import { LayoutDashboard } from "lucide-react";

import { InitiativeItem } from "@/lib/types";
import { DashboardChartItem } from "./types";
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
import { cn } from "@/lib/utils";

type Props = {
  slug: string;
  name: string;
  charts: DashboardChartItem[];
  initiatives: InitiativeItem[];
};

function ReadOnlyChartBody({ chart, initiatives }: { chart: DashboardChartItem; initiatives: InitiativeItem[] }) {
  let params: Record<string, unknown> = {};
  try { params = JSON.parse(chart.config); } catch { /* ignore */ }

  const scopedInitiatives = params.roadmapId
    ? initiatives.filter((i) => i.roadmapId === params.roadmapId)
    : initiatives;

  switch (chart.chartType) {
    case "velocity": {
      let velocityYear = (params.year as number) ?? new Date().getFullYear();
      let startYS = params.startYearSprint as number | undefined;
      let endYS = params.endYearSprint as number | undefined;
      if (startYS == null || endYS == null) {
        const q = params.quarter;
        if (typeof q === "string") {
          const m = q.match(/(\d{4})-Q(\d)/);
          if (m) {
            velocityYear = parseInt(m[1]!, 10);
            const qn = parseInt(m[2]!, 10);
            startYS = (qn - 1) * 6 + 1;
            endYS = qn * 6;
          }
        } else if (typeof q === "number") {
          startYS = (q - 1) * 6 + 1;
          endYS = q * 6;
        }
      }
      return <VelocityChart initiatives={scopedInitiatives} year={velocityYear} startYearSprint={startYS ?? 1} endYearSprint={endYS ?? 24} team={params.team as string | null} />;
    }
    case "burndown":
      return <BurndownChart initiatives={scopedInitiatives} year={(params.year as number) ?? new Date().getFullYear()} quarter={(params.quarter as number) ?? 1} sprint={(params.sprint as number) ?? 1} team={params.team as string | null} />;
    case "epic-burndown":
      return <EpicBurndownChart initiatives={scopedInitiatives} year={(params.year as number) ?? new Date().getFullYear()} quarter={(params.quarter as number) ?? 1} sprint={(params.sprint as number) ?? 1} team={params.team as string | null} />;
    case "cfd":
      return <CfdChart initiatives={scopedInitiatives} year={(params.year as number) ?? new Date().getFullYear()} quarter={(params.quarter as number) ?? 1} sprint={(params.sprint as number) ?? 1} team={params.team as string | null} />;
    case "workload":
      return <WorkloadChart initiatives={scopedInitiatives} year={(params.year as number) ?? new Date().getFullYear()} quarter={(params.quarter as number) ?? 1} sprint={(params.sprint as number) ?? 1} team={params.team as string | null} />;
    case "quarter-status":
      return <QuarterStatusChart initiatives={scopedInitiatives} year={(params.year as number) ?? new Date().getFullYear()} quarter={(params.quarter as number) ?? 1} team={params.team as string | null} />;
    case "story-status":
      return <StoryStatusChart initiatives={scopedInitiatives} year={(params.year as number) ?? new Date().getFullYear()} quarter={(params.quarter as number) ?? 1} sprint={(params.sprint as number) ?? 1} team={params.team as string | null} />;
    case "workload-balance":
      return <WorkloadBalanceChart initiatives={scopedInitiatives} year={(params.year as number) ?? new Date().getFullYear()} quarter={(params.quarter as number) ?? 1} sprint={(params.sprint as number) ?? 1} team={params.team as string | null} />;
    case "sprint-load":
      return <SprintLoadChart initiatives={scopedInitiatives} year={(params.year as number) ?? new Date().getFullYear()} quarter={(params.quarter as number) ?? 1} sprint={(params.sprint as number) ?? 1} team={params.team as string | null} />;
    case "sprint-burnup":
      return <SprintBurnupChart initiatives={scopedInitiatives} year={(params.year as number) ?? new Date().getFullYear()} quarter={(params.quarter as number) ?? 1} sprint={(params.sprint as number) ?? 1} team={params.team as string | null} />;
    case "epic-burnup":
      return <EpicBurnupChart initiatives={scopedInitiatives} year={(params.year as number) ?? new Date().getFullYear()} quarter={(params.quarter as number) ?? 1} sprint={(params.sprint as number) ?? 1} team={params.team as string | null} />;
    default:
      return <div className="flex h-32 items-center justify-center text-sm text-slate-400">Unknown chart type</div>;
  }
}

export function DashboardPublicView({ slug, name, charts, initiatives }: Props) {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur-sm px-6 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2 text-slate-500">
          <LayoutDashboard className="size-4" />
          <span className="text-xs font-mono font-semibold text-slate-400 tracking-wide">{slug}</span>
        </div>
        <div className="h-4 w-px bg-slate-200" />
        <h1 className="text-base font-bold text-slate-800">{name}</h1>
      </header>

      {/* Chart grid */}
      <main className="p-6">
        {charts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-32 text-slate-400">
            <LayoutDashboard className="size-10 opacity-25" />
            <p className="text-sm font-medium">No charts in this dashboard</p>
          </div>
        ) : (
          <div className="grid auto-rows-auto grid-cols-2 gap-4">
            {charts.map((chart) => {
              const rowSpan = chart.rowSpan ?? 1;
              const minHeight = 260 + (rowSpan - 1) * 220;
              return (
                <div
                  key={chart.id}
                  style={{ minHeight }}
                  className={cn(
                    "flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden",
                    chart.colSpan === 2 ? "col-span-2" : "col-span-1",
                  )}
                >
                  <div className="border-b border-slate-100 px-4 py-2.5">
                    <span className="text-sm font-semibold text-slate-700">{chart.title}</span>
                  </div>
                  <div className="flex-1 px-2 py-3">
                    <ReadOnlyChartBody chart={chart} initiatives={initiatives} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
