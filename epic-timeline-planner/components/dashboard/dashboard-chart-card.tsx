"use client";

import { Fragment, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Flag, GripVertical, SquarePen, StickyNote, Users, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { InitiativeItem } from "@/lib/types";
import { TeamAvatar } from "@/components/ui/team-avatar";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
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
import { SprintCountdownCard } from "./charts/sprint-countdown-card";
import { StickyNoteCard } from "./charts/sticky-note-card";
import { AtRiskStoriesCard } from "./charts/at-risk-stories-card";
import { MiniGanttCard } from "./charts/mini-gantt-card";
import { TeamFocusMixCard } from "./charts/team-focus-mix-card";
import { PortfolioBurndownChart } from "./charts/portfolio-burndown-chart";
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
  /** Merges partial params into the chart's config JSON. Used by gadgets like Sticky Note. */
  onUpdateConfig?: (id: string, partialParams: Record<string, unknown>) => void;
  /** Pass-through for charts that render per-user avatars (Sprint Load etc). */
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  /** Global health basis from the planner (Roadmap Health popover). When set
   *  to "epicEst", the EpicBurndownChart card renders a scope-promise
   *  reference line at the epic's originalEstimateDays. Other chart types
   *  ignore it. Defaults to "days" for public/static dashboards. */
  progressBasis?: "days" | "stories" | "epicEst";
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
  "sprint-countdown",
  "at-risk-stories",
  "team-focus-mix",
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
  let teamSlug: string | null = null;
  try {
    const parsed = JSON.parse(chart.config) as Record<string, unknown>;
    if (typeof parsed.team === "string" && parsed.team.length > 0) {
      teamSlug = parsed.team;
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
          {isTeam && (
            <TeamAvatar
              slug={teamSlug}
              sizePx={12}
              fallback={<Users className="size-3 text-indigo-500" aria-hidden />}
            />
          )}
          <span className={cn(idx === 0 ? "text-slate-800" : "text-slate-600")}>{segment}</span>
        </span>
      </Fragment>
    );
  });
}

function ChartBody({ chart, initiatives, isEditMode, onUpdateConfig, workspaceDirectoryUsers, progressBasis = "days" }: { chart: DashboardChartItem; initiatives: InitiativeItem[]; isEditMode: boolean; onUpdateConfig?: (id: string, partial: Record<string, unknown>) => void; workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[]; progressBasis?: "days" | "stories" | "epicEst" }) {
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
    case "epic-burndown": {
      // Per-chart basis. Falls back to the popover's current default
      // ("days" / "stories" / "epicEst") so legacy chart configs
      // without an explicit basis still render with sensible defaults.
      // Y-axis (metric) is derived from the basis automatically; legacy
      // configs that still carry an explicit `metric` continue to work
      // but newly created charts only carry `basis`.
      const chartBasis = (typeof params.basis === "string" && (params.basis === "days" || params.basis === "stories" || params.basis === "epicEst"))
        ? (params.basis as "days" | "stories" | "epicEst")
        : progressBasis;
      const derivedMetric: "daysLeft" | "storyCount" = chartBasis === "stories" ? "storyCount" : "daysLeft";
      const legacyMetric = params.metric === "storyCount" ? "storyCount" : params.metric === "daysLeft" ? "daysLeft" : null;
      const effectiveMetric = legacyMetric ?? derivedMetric;
      return (
        <EpicBurndownChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
          epicId={params.epicId as string | null}
          metric={effectiveMetric}
          progressBasis={chartBasis}
        />
      );
    }
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
          teams={Array.isArray(params.teams) ? (params.teams as string[]) : null}
          metric={params.metric === "storyCount" ? "storyCount" : "daysLeft"}
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
          metric={params.metric === "daysLeft" ? "daysLeft" : "storyCount"}
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
          workspaceDirectoryUsers={workspaceDirectoryUsers}
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
    case "epic-burnup": {
      const burnupBasis = (typeof params.basis === "string" && (params.basis === "days" || params.basis === "stories" || params.basis === "epicEst"))
        ? (params.basis as "days" | "stories" | "epicEst")
        : progressBasis;
      // Same basis → metric derivation as Epic Burndown above. Burnup's
      // legacy default was "storyCount" so we honor that when only the
      // old `metric` key is present.
      const derivedBurnupMetric: "daysLeft" | "storyCount" = burnupBasis === "stories" ? "storyCount" : "daysLeft";
      const legacyBurnupMetric = params.metric === "daysLeft" ? "daysLeft" : params.metric === "storyCount" ? "storyCount" : null;
      const effectiveBurnupMetric = legacyBurnupMetric ?? derivedBurnupMetric;
      return (
        <EpicBurnupChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
          epicId={params.epicId as string | null}
          metric={effectiveBurnupMetric}
          progressBasis={burnupBasis}
        />
      );
    }
    case "sprint-countdown":
      return (
        <SprintCountdownCard
          year={(params.year as number) ?? new Date().getFullYear()}
          sprint={(params.sprint as number) ?? 1}
        />
      );
    case "sticky-note":
      return (
        <StickyNoteCard
          body={(params.body as string) ?? ""}
          allowEdit={isEditMode}
          onSave={(html) => onUpdateConfig?.(chart.id, { body: html })}
        />
      );
    case "at-risk-stories":
      return (
        <AtRiskStoriesCard
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          team={params.team as string | null}
          teams={Array.isArray(params.teams) ? (params.teams as string[]) : null}
        />
      );
    case "mini-gantt":
      return (
        <MiniGanttCard
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          team={params.team as string | null}
          teams={Array.isArray(params.teams) ? (params.teams as string[]) : null}
        />
      );
    case "team-focus-mix":
      return (
        <TeamFocusMixCard
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          sprint={(params.sprint as number) ?? 1}
          scope={params.focusScope === "quarter" ? "quarter" : "sprint"}
          team={params.team as string | null}
          teams={Array.isArray(params.teams) ? (params.teams as string[]) : null}
        />
      );
    case "portfolio-burndown":
      // Quarter-wide burndown. Reads progressBasis from the global Health
      // calc setting (threaded in via the card props) so the chart and the
      // Health Distribution donut speak the same unit.
      return (
        <PortfolioBurndownChart
          initiatives={scopedInitiatives}
          year={(params.year as number) ?? new Date().getFullYear()}
          quarter={(params.quarter as number) ?? 1}
          team={params.team as string | null}
          progressBasis={progressBasis}
        />
      );
    default:
      return <div className="flex h-32 items-center justify-center text-sm text-slate-400">Unknown chart type</div>;
  }
}

export function DashboardChartCard({ chart, initiatives, isEditMode, onRemove, onEdit, onToggleSpan, onDecreaseSpan, onChangeHeight, onRenameChart, onUpdateConfig, workspaceDirectoryUsers, progressBasis = "days" }: Props) {
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
            className="group/title flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-slate-700"
          >
            {chart.chartType === "sticky-note" && (
              <StickyNote className="size-3.5 shrink-0 text-violet-500" aria-hidden />
            )}
            {/* Title takes only its natural width (no flex-1) so the edit icon
                sits right after the text with a small gap, rather than being
                pushed to the far right of the header. overflow-hidden +
                whitespace-nowrap still clip long titles. */}
            <span className="flex min-w-0 items-center overflow-hidden whitespace-nowrap">
              {renderTitleNodes(chart, displayTitle)}
            </span>
            <button
              onClick={() => { setTitleValue(displayTitle); setRenamingTitle(true); setTimeout(() => titleInputRef.current?.select(), 0); }}
              className="shrink-0 rounded p-0.5 text-slate-300 opacity-0 transition-all group-hover/title:opacity-100 hover:bg-slate-100 hover:text-slate-500"
              title="Rename chart"
            >
              <SquarePen className="size-3.5" strokeWidth={2} />
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
        <ChartBody chart={chart} initiatives={initiatives} isEditMode={isEditMode} onUpdateConfig={onUpdateConfig} workspaceDirectoryUsers={workspaceDirectoryUsers} progressBasis={progressBasis} />
      </div>
    </div>
  );
}
