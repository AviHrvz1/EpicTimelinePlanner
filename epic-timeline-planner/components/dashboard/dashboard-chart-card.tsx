"use client";

import { Fragment, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Flag, GripVertical, Pencil, Users, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { InitiativeItem } from "@/lib/types";
import { monthTeamLabelForId } from "@/lib/month-team-board";
import { currentCalendarYearSprint } from "@/lib/year-sprint";
import { BurndownChart } from "./charts/burndown-chart";
import { EpicBurndownChart } from "./charts/epic-burndown-chart";
import { CfdChart } from "./charts/cfd-chart";
import { EpicCfdChart } from "./charts/epic-cfd-chart";
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
  onDecreaseSpan: (id: string) => void;
  onChangeHeight: (id: string, delta: 1 | -1) => void;
  onRenameChart: (id: string, title: string) => void;
};

function ResizePad({
  onUp, onDown, onLeft, onRight,
  disableUp, disableDown,
}: {
  onUp: () => void; onDown: () => void; onLeft: () => void; onRight: () => void;
  disableUp: boolean; disableDown: boolean;
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-7 shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      <polygon points="10,1 14,6.5 6,6.5"
        onClick={disableUp ? undefined : onUp}
        className={cn("transition-colors", disableUp ? "fill-slate-200 cursor-not-allowed" : "fill-slate-400 hover:fill-slate-700 cursor-pointer")} />
      <polygon points="10,19 14,13.5 6,13.5"
        onClick={disableDown ? undefined : onDown}
        className={cn("transition-colors", disableDown ? "fill-slate-200 cursor-not-allowed" : "fill-slate-400 hover:fill-slate-700 cursor-pointer")} />
      <polygon points="1,10 6.5,6 6.5,14"
        onClick={onLeft}
        className="fill-slate-400 hover:fill-slate-700 cursor-pointer transition-colors" />
      <polygon points="19,10 13.5,6 13.5,14"
        onClick={onRight}
        className="fill-slate-400 hover:fill-slate-700 cursor-pointer transition-colors" />
      <circle cx="10" cy="10" r="1.5" className="fill-slate-300" />
    </svg>
  );
}

// Sprint-scoped charts always render the current calendar sprint (auto-roll forward
// when the originally-saved sprint window has ended).
// Sprint-scoped chart types only. Epic charts (epic-burndown, epic-burnup) span
// the epic's own plan start→due range — they're not affected by the dashboard sprint.
const SPRINT_SCOPED_CHART_TYPES = new Set<string>([
  "burndown",
  "cfd",
  "story-status",
  "workload-balance",
  "sprint-load",
  "sprint-burnup",
  "workload",
]);

function resolveCurrentSprintParams(): { year: number; quarter: number; sprint: number } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return { year, quarter: Math.ceil(month / 3), sprint: currentCalendarYearSprint(now) };
}

export function resolveDisplayTitle(chart: DashboardChartItem): string {
  if (!SPRINT_SCOPED_CHART_TYPES.has(chart.chartType)) return chart.title;
  let savedSprint: number | null = null;
  try {
    const parsed = JSON.parse(chart.config) as Record<string, unknown>;
    if (typeof parsed.sprint === "number") savedSprint = parsed.sprint;
  } catch { /* ignore */ }
  const current = resolveCurrentSprintParams().sprint;
  if (savedSprint != null && savedSprint !== current) {
    return chart.title.replace(/Sprint\s+\d+/i, `Sprint ${current}`);
  }
  return chart.title;
}

function renderTitleNodes(chart: DashboardChartItem, displayTitle: string) {
  let teamLabel: string | null = null;
  try {
    const parsed = JSON.parse(chart.config) as Record<string, unknown>;
    if (typeof parsed.team === "string" && parsed.team.length > 0) {
      teamLabel = monthTeamLabelForId(parsed.team) ?? parsed.team;
    }
  } catch { /* ignore */ }

  const parts = displayTitle.split(" · ");
  return parts.map((segment, idx) => {
    const isSprint = /^Sprint\s+\d+$/i.test(segment);
    const isTeam = teamLabel != null && segment === teamLabel;
    return (
      <Fragment key={`${idx}-${segment}`}>
        {idx > 0 && <span className="mx-1 shrink-0 text-slate-300">·</span>}
        <span className="inline-flex shrink-0 items-center gap-1">
          {isSprint && <Flag className="size-3 text-rose-500" aria-hidden />}
          {isTeam && <Users className="size-3 text-indigo-500" aria-hidden />}
          <span className={cn(idx === 0 ? "text-slate-800" : "text-slate-600")}>{segment}</span>
        </span>
      </Fragment>
    );
  });
}

function ChartBody({ chart, initiatives }: { chart: DashboardChartItem; initiatives: InitiativeItem[] }) {
  let params: Record<string, unknown> = {};
  try { params = JSON.parse(chart.config); } catch { /* ignore */ }

  if (SPRINT_SCOPED_CHART_TYPES.has(chart.chartType)) {
    const current = resolveCurrentSprintParams();
    params = { ...params, year: current.year, quarter: current.quarter, sprint: current.sprint };
  }

  const scopedInitiatives = params.roadmapId
    ? initiatives.filter((i) => i.roadmapId === params.roadmapId)
    : initiatives;

  switch (chart.chartType) {
    case "velocity": {
      // Legacy: configs may have a string quarter "YYYY-QN" instead of year + sprint range.
      let velocityYear = (params.year as number) ?? new Date().getFullYear();
      let startYS = params.startYearSprint as number | undefined;
      let endYS = params.endYearSprint as number | undefined;
      if (startYS == null || endYS == null) {
        const q = params.quarter;
        if (typeof q === "string") {
          const m = q.match(/(\d{4})-Q(\d)/);
          if (m) {
            const y = parseInt(m[1]!, 10);
            const qn = parseInt(m[2]!, 10);
            velocityYear = y;
            startYS = (qn - 1) * 6 + 1;
            endYS = qn * 6;
          }
        } else if (typeof q === "number") {
          startYS = (q - 1) * 6 + 1;
          endYS = q * 6;
        }
      }
      return (
        <VelocityChart
          initiatives={scopedInitiatives}
          year={velocityYear}
          startYearSprint={startYS ?? 1}
          endYearSprint={endYS ?? 24}
          team={params.team as string | null}
        />
      );
    }
    case "burndown":
      return (
        <BurndownChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
          metric={params.metric === "storyCount" ? "storyCount" : "daysLeft"}
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
          epicId={params.epicId as string | null}
          metric={params.metric === "storyCount" ? "storyCount" : "daysLeft"}
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
    case "epic-cfd":
      return (
        <EpicCfdChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
          epicId={params.epicId as string | null}
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
          metric={params.metric === "daysLeft" ? "daysLeft" : "storyCount"}
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
          epicId={params.epicId as string | null}
          metric={params.metric === "daysLeft" ? "daysLeft" : "storyCount"}
        />
      );
    default:
      return <div className="flex h-32 items-center justify-center text-sm text-slate-400">Unknown chart type</div>;
  }
}

export function DashboardChartCard({ chart, initiatives, isEditMode, onRemove, onEdit, onToggleSpan, onDecreaseSpan, onChangeHeight, onRenameChart }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chart.id, disabled: !isEditMode });
  const rowSpan = chart.rowSpan ?? 1;
  const cardHeight = 300 + (rowSpan - 1) * 220;
  const displayTitle = resolveDisplayTitle(chart);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(displayTitle);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // Keep local value in sync if parent updates the chart title (e.g. after save/reload)
  if (!renamingTitle && titleValue !== displayTitle) setTitleValue(displayTitle);

  function commitRename() {
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== displayTitle) onRenameChart(chart.id, trimmed);
    else setTitleValue(displayTitle);
    setRenamingTitle(false);
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    height: cardHeight,
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
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitRename(); } else if (e.key === "Escape") { setTitleValue(displayTitle); setRenamingTitle(false); } }}
            className="flex-1 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-sm font-semibold text-slate-700 outline-none ring-1 ring-indigo-300 focus:ring-indigo-500"
            autoFocus
          />
        ) : (
          <span
            className="group/title flex min-w-0 flex-1 items-center gap-1 text-sm font-semibold text-slate-700"
          >
            <span className="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap">
              {renderTitleNodes(chart, displayTitle)}
            </span>
            <button
              onClick={() => { setTitleValue(displayTitle); setRenamingTitle(true); setTimeout(() => titleInputRef.current?.select(), 0); }}
              className="shrink-0 rounded p-0.5 text-slate-300 opacity-0 transition-all group-hover/title:opacity-100 hover:bg-slate-100 hover:text-slate-500"
              title="Rename chart"
            >
              <Pencil className="size-3" />
            </button>
          </span>
        )}
        {isEditMode && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <ResizePad
              onUp={() => onChangeHeight(chart.id, -1)}
              onDown={() => onChangeHeight(chart.id, 1)}
              onLeft={() => onDecreaseSpan(chart.id)}
              onRight={() => onToggleSpan(chart.id)}
              disableUp={rowSpan <= 1}
              disableDown={rowSpan >= 4}
            />
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

      {/* Chart body — min-h-0 ensures flex-1 has a definite height so height="100%" works in ResponsiveContainer */}
      <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
        <ChartBody chart={chart} initiatives={initiatives} />
      </div>
    </div>
  );
}
