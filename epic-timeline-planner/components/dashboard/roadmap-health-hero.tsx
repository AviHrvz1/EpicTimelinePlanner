"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Activity,
  CalendarOff,
  AlertOctagon,
  AlertTriangle,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleDotDashed,
  FileWarning,
  Flag,
  Folder,
  FolderOpen,
  HeartPulse,
  HelpCircle,
  Info,
  ListTodo,
  PlayCircle,
  Ruler,
  ShieldCheck,
  Sigma,
  StickyNote,
  Users,
  Zap,
} from "lucide-react";

import { UserChip } from "@/components/auth/user-chip";
import { HealthExplainerPopover } from "@/components/dashboard/health-explainer-popover";
import { RoadmapSelector } from "@/components/timeline/roadmap-selector";
import { computeProgress, type HealthStatus } from "@/lib/progress";
import { monthTeamLabelForId } from "@/lib/month-team-board";
import { globalSprintFromMonthLane, sprintEndDate, sprintStartDate } from "@/lib/year-sprint";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { InsightsDrilldownModal } from "@/components/timeline/insights-drilldown-modal";
import type { InitiativeItem, RoadmapItem } from "@/lib/types";
import { cn } from "@/lib/utils";

// "backlogEpic" is a virtual status driven by EPIC placement, not
// story state. Whenever an epic has no Gantt position
// (planStartMonth == null), every one of its stories rolls up under
// this bucket — overriding the story's own `status` field. The point
// is to surface "work committed to but not yet placed" as a single
// slice the planner can click to see what still needs scheduling.
// Stories in scheduled epics fall back to normal status bucketing.
type StoryExecStatus = "backlogEpic" | "todo" | "inProgress" | "review" | "done";

/** Bi-directional map for the Health Distribution legend ↔ middle-panel
 *  HealthFilterMenu wiring. Labels match the strings in the donut slices. */
const HEALTH_LABEL_TO_STATUS: Record<string, HealthStatus> = {
  "On Track": "onTrack",
  "Done": "done",
  "Watch": "watch",
  "At Risk": "atRisk",
  "Overdue": "overdue",
};
const HEALTH_STATUS_TO_LABEL: Record<HealthStatus, string> = {
  onTrack: "On Track",
  done: "Done",
  watch: "Watch",
  atRisk: "At Risk",
  overdue: "Overdue",
};

/** Same bi-directional map for Work Progress legend ↔ middle-panel
 *  Statuses dropdown. Labels match the donut slices in this file. */
const STATUS_LABEL_TO_VALUE: Record<string, StoryExecStatus> = {
  "Backlog epic": "backlogEpic",
  "To do": "todo",
  "In progress": "inProgress",
  "Review / testing": "review",
  "Done": "done",
};
const STATUS_VALUE_TO_LABEL: Record<StoryExecStatus, string> = {
  backlogEpic: "Backlog epic",
  todo: "To do",
  inProgress: "In progress",
  review: "Review / testing",
  done: "Done",
};

/**
 * Roadmap Health hero — replaces the legacy top bar.
 *
 *   Row 1 (compact filter band): logo · title + subtitle · Health
 *     Calculation pill toggle · View pill toggle · Bell · Help · UserChip
 *   Row 2 (tall bordered hero card): six big stat blocks · divider ·
 *     Work Progress donut + legend · divider · Health Distribution
 *     donut + legend + side total
 *
 * Sizing calibrated from the user-supplied reference: 30px stat numbers,
 * 110px donut diameters, ~190px card height. Reuses computeProgress
 * for the health verdict counts so the numbers match the Gantt bars.
 */
export function RoadmapHealthHero({
  initiatives,
  roadmaps,
  selectedRoadmap,
  selectedYear,
  progressBasis,
  onProgressBasisChange,
  summaryBarRef,
  onYearChange,
  onSelectRoadmap,
  onCreateRoadmap,
  onRenameRoadmap,
  onAddYearToRoadmap,
  onRemoveYearFromRoadmap,
  onGetRoadmapCounts,
  onDeleteRoadmap,
  barMode = "epics",
  onBarModeChange,
  showTeamChips = false,
  onShowTeamChipsChange,
  showSprintChips = false,
  onShowSprintChipsChange,
  healthFilter,
  onHealthFilterChange,
  statusFilter,
  onStatusFilterChange,
  onOpenEpicEstimatePanel,
}: {
  initiatives: readonly InitiativeItem[];
  roadmaps: RoadmapItem[];
  selectedRoadmap: RoadmapItem | null;
  selectedYear: number;
  progressBasis: "days" | "stories" | "epicEst";
  onProgressBasisChange: (next: "days" | "stories" | "epicEst") => void;
  /** Ref the legacy TimelineGrid uses as a portal target for summary chips. */
  summaryBarRef: (el: HTMLDivElement | null) => void;
  /** Subtitle-as-roadmap-picker callbacks. All optional; when omitted the
   *  selector renders read-only. */
  onYearChange?: (next: number) => void | Promise<void>;
  onSelectRoadmap?: (id: string, year?: number) => void;
  onCreateRoadmap?: (name: string, years: number[]) => Promise<void>;
  onRenameRoadmap?: (id: string, name: string) => Promise<void>;
  onAddYearToRoadmap?: (id: string, year: number) => Promise<void>;
  onRemoveYearFromRoadmap?: (id: string, year: number) => Promise<{ error?: string }>;
  onGetRoadmapCounts?: (id: string) => Promise<{ initiativeCount: number; epicCount: number; storyCount: number; snapshotCount: number } | null>;
  onDeleteRoadmap?: (id: string) => Promise<void>;
  /** Roadmap bar mode (initiatives vs epics) — Initiatives + Epics stat
   *  blocks become toggles when wired. */
  barMode?: "epics" | "initiatives";
  onBarModeChange?: (next: "epics" | "initiatives") => void;
  /** Gantt team-chip overlay — Teams stat block toggles it. */
  showTeamChips?: boolean;
  onShowTeamChipsChange?: (next: boolean) => void;
  /** Calendar header sprint-chip row — Sprints stat block toggles it. */
  showSprintChips?: boolean;
  onShowSprintChipsChange?: (next: boolean) => void;
  /** Health verdict filter set — Health Distribution legend rows act as
   *  toggles into this set so clicking "On Track" / "Done" / etc. mirrors
   *  the middle-panel HealthFilterMenu. */
  healthFilter?: Set<HealthStatus>;
  onHealthFilterChange?: (next: Set<HealthStatus>) => void;
  /** Story execution status filter set — Work Progress legend rows act
   *  as toggles into this set so clicking "In progress" / "Done" / etc.
   *  mirrors the middle-panel Statuses dropdown. */
  statusFilter?: Set<StoryExecStatus>;
  onStatusFilterChange?: (next: Set<StoryExecStatus>) => void;
  /** Click handler for the Epic Estimates donut legend — opens the same
   *  popover the Gantt "Epic Est." chip opens, pre-scoped to the picked tab. */
  onOpenEpicEstimatePanel?: (
    tab: "estimated" | "partiallyEstimated" | "unestimated" | "epicsNoDesc" | "storiesNoDesc",
  ) => void;
}) {
  const stats = useMemo(() => computeRoadmapStats(initiatives, selectedYear, progressBasis), [
    initiatives,
    selectedYear,
    progressBasis,
  ]);
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);
  const [healthExplainerOpen, setHealthExplainerOpen] = useState(false);
  /** Human label for the active basis — folded into chart titles so the
   *  planner can see at a glance which Health calculation mode drove
   *  the verdicts on screen. */
  const basisLabel =
    progressBasis === "epicEst"
      ? "Epic Days Est."
      : progressBasis === "days"
        ? "Story Days Est."
        : "Stories Count";
  /** Selected team for the Team Progress drilldown. Null = no modal. */
  const [drilldownTeam, setDrilldownTeam] = useState<{
    teamId: string;
    label: string;
  } | null>(null);
  const drilldownStories = useMemo(() => {
    if (!drilldownTeam) return [];
    const out: Array<{
      story: { id: string; title: string; status: string; sprint: number | null; estimatedDays: number | null; daysLeft: number | null; assignee: string | null };
      epicTitle: string;
    }> = [];
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        const teamKey = (epic.team ?? "").trim() || "__unassigned__";
        if (teamKey !== drilldownTeam.teamId) continue;
        for (const story of epic.userStories ?? []) {
          out.push({
            story: {
              id: story.id,
              title: story.title,
              status: String(story.status),
              sprint: story.sprint ?? null,
              estimatedDays: story.estimatedDays ?? null,
              daysLeft: story.daysLeft ?? null,
              assignee: story.assignee ?? null,
            },
            epicTitle: epic.title,
          });
        }
      }
    }
    return out;
  }, [initiatives, drilldownTeam]);

  return (
    <>
    <div className="shrink-0 bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 pt-1.5 pb-0 pl-2 pr-[6px]">
    <div className="relative rounded-lg border border-indigo-200/70 bg-white overflow-hidden">
      {/* Row 1 — compact filter band. Title block stacks: H1 → roadmap
          subtitle → "Health calculation" filter, all left-aligned at the
          same x-position. Right cluster (Bell / Help / UserChip) stays
          top-anchored to keep header height tight. */}
      <div className="flex w-full items-start gap-5 pl-6 pr-6 py-3">
        <div className="min-w-0 shrink-0">
          <h1 className="inline-flex items-center gap-2 text-[22px] font-semibold leading-tight tracking-tight text-slate-900">
            <button
              type="button"
              onClick={() => setIsPanelExpanded((v) => !v)}
              title={isPanelExpanded ? "Collapse Roadmap Health" : "Expand Roadmap Health"}
              aria-label={isPanelExpanded ? "Collapse Roadmap Health" : "Expand Roadmap Health"}
              aria-expanded={isPanelExpanded}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              <ChevronDown
                className={cn(
                  "size-5 transition-transform duration-200",
                  isPanelExpanded ? "rotate-0" : "-rotate-90",
                )}
                strokeWidth={2.2}
                aria-hidden
              />
            </button>
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
              <ShieldCheck className="size-[18px]" aria-hidden />
            </span>
            Roadmap Health
          </h1>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <IconButton icon={Bell} label="Notifications" badge />
          <IconButton icon={HelpCircle} label="Help" />
          <UserChip />
        </div>
        {/* Legacy summary-chip portal target — hidden visually, kept alive
            so TimelineGrid's portal mounts don't crash. */}
        <div ref={summaryBarRef} className="hidden" aria-hidden />
      </div>

      {/* Row 2 — tall bordered hero card. Left padding matches row 1
          (pl-6) so the card's left edge aligns with the Roadmap Health
          shield icon above it. Collapsible via the chevron in the H1. */}
      <div
        className={cn(
          "overflow-hidden transition-[max-height,opacity,padding] duration-300 ease-out",
          isPanelExpanded
            ? "max-h-[1200px] opacity-100 pb-5 pt-1"
            : "max-h-0 opacity-0 pb-0 pt-0",
        )}
        aria-hidden={!isPanelExpanded}
      >
      <div className="overflow-x-auto pl-6 pr-6">
        <div className="flex w-full min-w-min flex-col gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
          {/* In-card header: roadmap picker + Health calculation filter.
              Used to live in row 1 next to the H1; tucked inside the card
              so the title row stays compact. */}
          <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5">
            <RoadmapSelector
              appearance="subtitle"
              roadmaps={roadmaps}
              selectedRoadmap={selectedRoadmap}
              year={selectedYear}
              onYearChange={onYearChange ?? (() => {})}
              onSelectRoadmap={onSelectRoadmap}
              onCreateRoadmap={onCreateRoadmap}
              onRenameRoadmap={onRenameRoadmap}
              onAddYearToRoadmap={onAddYearToRoadmap}
              onRemoveYearFromRoadmap={onRemoveYearFromRoadmap}
              onGetRoadmapCounts={onGetRoadmapCounts}
              onDeleteRoadmap={onDeleteRoadmap}
              extraSuffix={`${stats.epicsCount} epics in scope`}
            />
            <span className="inline-block h-4 w-px shrink-0 bg-slate-300/80" aria-hidden />
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-[18px] items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] leading-[18px] text-slate-500">
                <HeartPulse className="size-[18px] shrink-0 text-rose-500" strokeWidth={2.2} aria-hidden />
                <span className="inline-block translate-y-[1px]">Health calculation</span>
                <Info className="size-3.5 shrink-0 text-slate-400" aria-hidden />
              </span>
              <PillToggle
                value={progressBasis}
                onChange={(v) => onProgressBasisChange(v as "days" | "stories" | "epicEst")}
                options={[
                  { value: "epicEst", label: "Epic Days Est." },
                  { value: "days", label: "Story Days Est." },
                  { value: "stories", label: "Stories Count" },
                ]}
              />
            </div>
            {/* Inline stats: Initiatives · Epics · Stories · Teams · Sprints,
                pushed right next to the roadmap selector + Health calc. */}
            <div className="ml-auto flex shrink-0 items-center gap-x-9">
              <StatBlock
                icon={<Zap className="size-7 text-blue-600" strokeWidth={1.9} aria-hidden />}
                value={stats.initiativesCount}
                label="Initiatives"
                onClick={onBarModeChange ? () => onBarModeChange("initiatives") : undefined}
                active={barMode === "initiatives"}
                title="Show initiative bars on the Gantt"
              />
              <StatBlock
                icon={<Folder className="size-7 text-violet-500" aria-hidden />}
                value={stats.epicsCount}
                label="Epics"
                onClick={onBarModeChange ? () => onBarModeChange("epics") : undefined}
                active={barMode === "epics"}
                title="Show epic bars on the Gantt"
              />
              <StatBlock
                icon={<BookOpen className="size-7 text-sky-500" aria-hidden />}
                value={stats.storiesCount}
                label="Stories"
              />
              <StatBlock
                icon={<Users className="size-7 text-emerald-500" aria-hidden />}
                value={stats.teamsCount}
                label="Teams"
                onClick={onShowTeamChipsChange ? () => onShowTeamChipsChange(!showTeamChips) : undefined}
                active={showTeamChips}
                title="Toggle team labels on the Gantt bars"
              />
              <StatBlock
                icon={<Flag className="size-7 text-amber-500" aria-hidden />}
                value={stats.sprintsCount}
                label="Sprints"
                onClick={onShowSprintChipsChange ? () => onShowSprintChipsChange(!showSprintChips) : undefined}
                active={showSprintChips}
                title="Toggle the sprint-chip row in the calendar header"
              />
            </div>
          </div>
          <div className="mt-2 h-px w-full bg-slate-200/70" aria-hidden />
          {/* Charts row — the original row 2 content, now without the
              stats grid (stats moved up next to the roadmap selector).
              justify-between spreads the four charts across the full
              width of the panel with the dividers absorbing slack. */}
          {/* Responsive layout: cards stay on a single row and shrink
            * to their min widths. Once total content exceeds the
            * container, a horizontal scrollbar lets the user pan the
            * full row instead of cards getting clipped. */}
          <div className="mt-2 flex w-full min-w-0 flex-nowrap items-center justify-between gap-x-2 overflow-x-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.indigo.100)_transparent] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gradient-to-r [&::-webkit-scrollbar-thumb]:from-sky-100 [&::-webkit-scrollbar-thumb]:via-indigo-100 [&::-webkit-scrollbar-thumb]:to-violet-100">
          <TeamProgressCard
            rows={stats.teamProgress}
            unitSuffix={progressBasis === "stories" ? "" : "d"}
            onRowClick={(teamId, label) => setDrilldownTeam({ teamId, label })}
            panelClassName="bg-emerald-50/60 ring-emerald-100"
          />
          <DonutCard
            panelClassName="bg-sky-50/60 ring-sky-100"
            title={
              progressBasis === "stories"
                ? `Work Progress · Stories (${basisLabel})`
                : `Work Progress · Days (${basisLabel})`
            }
            titleIcon={<Activity className="size-3.5 text-blue-500" strokeWidth={2.1} aria-hidden />}
            centerCount={
              progressBasis === "stories"
                ? stats.storiesCount
                : stats.workProgress.backlogEpic +
                  stats.workProgress.todo +
                  stats.workProgress.inProgress +
                  stats.workProgress.review +
                  stats.workProgress.done
            }
            centerLabel={progressBasis === "stories" ? "Stories" : "Days"}
            slices={(() => {
              const suffix = progressBasis === "stories" ? "stories" : "days";
              // Workflow order: Backlog epic → To do → In progress →
              // Review / testing → Done. Reads left-to-right as the
              // natural lifecycle, from "not placed yet" to "shipped".
              return [
                { label: "Backlog epic", value: stats.workProgress.backlogEpic, color: "#a3a3a3", icon: <CalendarOff className="size-3.5" strokeWidth={2} />, valueSuffix: suffix },
                { label: "To do", value: stats.workProgress.todo, color: "#94a3b8", icon: <ListTodo className="size-3.5" strokeWidth={2} />, valueSuffix: suffix },
                { label: "In progress", value: stats.workProgress.inProgress, color: "#3b82f6", icon: <PlayCircle className="size-3.5" strokeWidth={2} />, valueSuffix: suffix },
                { label: "Review / testing", value: stats.workProgress.review, color: "#8b5cf6", icon: <CheckCheck className="size-3.5" strokeWidth={2} />, valueSuffix: suffix },
                { label: "Done", value: stats.workProgress.done, color: "#10b981", icon: <CheckCircle2 className="size-3.5" strokeWidth={2} />, valueSuffix: suffix },
              ];
            })()}
            onSliceClick={
              onStatusFilterChange
                ? (label) => {
                    const value = STATUS_LABEL_TO_VALUE[label];
                    if (!value) return;
                    const next = new Set(statusFilter ?? []);
                    if (next.has(value)) next.delete(value);
                    else next.add(value);
                    onStatusFilterChange(next);
                  }
                : undefined
            }
            activeLabels={
              statusFilter && statusFilter.size > 0
                ? new Set(
                    Array.from(statusFilter).map((v) => STATUS_VALUE_TO_LABEL[v]).filter(Boolean) as string[],
                  )
                : undefined
            }
          />
          <DonutCard
            panelClassName="bg-orange-50/60 ring-orange-100"
            title={`Health Distribution · Epics (${basisLabel})`}
            titleIcon={<HeartPulse className="size-3.5 text-rose-500" strokeWidth={2.1} aria-hidden />}
            titleAction={
              <button
                type="button"
                aria-label="How is health calculated?"
                title="How is health calculated?"
                onClick={() => setHealthExplainerOpen(true)}
                className="inline-flex size-4 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <Info className="size-3.5" aria-hidden />
              </button>
            }
            centerCount={stats.healthDistribution.total}
            centerLabel="Epics"
            slices={[
              // Severity ascending: best outcome (Done) → green
              // (On Track) → amber (Watch) → orange (At Risk) → red
              // (Overdue). Matches the visual intuition of a health
              // gauge — green at the top, red at the bottom.
              { label: "Done", value: stats.healthDistribution.done, color: "#3b82f6", icon: <CheckCheck className="size-3.5" strokeWidth={2} />, valueSuffix: "epics" },
              { label: "On Track", value: stats.healthDistribution.onTrack, color: "#10b981", icon: <Check className="size-3.5" strokeWidth={2.4} />, valueSuffix: "epics" },
              { label: "Watch", value: stats.healthDistribution.watch, color: "#f59e0b", icon: <AlertTriangle className="size-3.5" strokeWidth={2} />, valueSuffix: "epics" },
              { label: "At Risk", value: stats.healthDistribution.atRisk, color: "#fb923c", icon: <AlertTriangle className="size-3.5" strokeWidth={2} />, valueSuffix: "epics" },
              { label: "Overdue", value: stats.healthDistribution.overdue, color: "#ef4444", icon: <AlertOctagon className="size-3.5" strokeWidth={2} />, valueSuffix: "epics" },
            ]}
            onSliceClick={
              onHealthFilterChange
                ? (label) => {
                    const status = HEALTH_LABEL_TO_STATUS[label];
                    if (!status) return;
                    const next = new Set(healthFilter ?? []);
                    if (next.has(status)) next.delete(status);
                    else next.add(status);
                    onHealthFilterChange(next);
                  }
                : undefined
            }
            activeLabels={
              healthFilter && healthFilter.size > 0
                ? new Set(
                    Array.from(healthFilter).map((s) => HEALTH_STATUS_TO_LABEL[s]).filter(Boolean) as string[],
                  )
                : undefined
            }
          />
          <DonutCard
            panelClassName="bg-violet-50/60 ring-violet-100"
            title={
              progressBasis === "epicEst"
                ? `Epic Estimates · Epics (${basisLabel})`
                : `Story Estimates · Stories (${basisLabel})`
            }
            titleIcon={<Sigma className="size-3.5 text-indigo-500" strokeWidth={2.1} aria-hidden />}
            centerCount={
              progressBasis === "epicEst"
                ? stats.epicEstimates.daysSum
                : stats.epicEstimates.estimated + stats.epicEstimates.unestimated
            }
            centerLabel={progressBasis === "epicEst" ? "Total Days" : "Stories"}
            slices={(() => {
              const unitSuffix = progressBasis === "epicEst" ? "epics" : "stories";
              // The 3-tier split (Estimated / Partially / Unestimated)
              // is only meaningful for the epicEst basis — Days /
              // Stories bases split at the STORY level where a story
              // is either sized or it isn't. For epicEst, the
              // Partially row always renders (even when the count is
              // 0) so the legend doubles as a permanent shortcut into
              // the Partially Estimated tab.
              const slices = [
                { label: "Estimated", value: stats.epicEstimates.estimated, color: "#6366f1", icon: <Ruler className="size-3.5" strokeWidth={2} />, valueSuffix: unitSuffix },
              ];
              if (progressBasis === "epicEst") {
                slices.push({
                  label: "Partially estimated",
                  value: stats.epicEstimates.partiallyEstimated,
                  color: "#f59e0b",
                  icon: <CircleDotDashed className="size-3.5" strokeWidth={2} />,
                  valueSuffix: unitSuffix,
                });
              }
              slices.push({ label: "Unestimated", value: stats.epicEstimates.unestimated, color: "#94a3b8", icon: <CircleDashed className="size-3.5" strokeWidth={2} />, valueSuffix: unitSuffix });
              return slices;
            })()}
            onSliceClick={
              onOpenEpicEstimatePanel
                ? (label) =>
                    onOpenEpicEstimatePanel(
                      label === "Estimated"
                        ? "estimated"
                        : label === "Partially estimated"
                          ? "partiallyEstimated"
                          : "unestimated",
                    )
                : undefined
            }
            extraLegendRows={
              onOpenEpicEstimatePanel
                ? [
                    {
                      label: "Stories w/o description",
                      value: stats.storiesWithoutDescCount,
                      pct: stats.storiesCount > 0
                        ? Math.round((stats.storiesWithoutDescCount / stats.storiesCount) * 100)
                        : 0,
                      color: "#f59e0b",
                      icon: <StickyNote className="size-3.5" strokeWidth={2} />,
                      onClick: () => onOpenEpicEstimatePanel("storiesNoDesc"),
                      title: "Open the Estimate Coverage panel · Stories without description tab",
                      valueSuffix: "stories",
                    },
                    {
                      label: "Epics w/o description",
                      value: stats.epicsWithoutDescCount,
                      pct: stats.epicsCount > 0
                        ? Math.round((stats.epicsWithoutDescCount / stats.epicsCount) * 100)
                        : 0,
                      color: "#ec4899",
                      icon: <FileWarning className="size-3.5" strokeWidth={2} />,
                      onClick: () => onOpenEpicEstimatePanel("epicsNoDesc"),
                      title: "Open the Estimate Coverage panel · Epics without description tab",
                      valueSuffix: "epics",
                    },
                  ]
                : undefined
            }
          />
          </div>
        </div>
      </div>
      </div>
    </div>
    </div>
    {drilldownTeam ? (
      <InsightsDrilldownModal
        title={`Team Progress · ${drilldownTeam.label}`}
        icon={<Users className="size-4 text-slate-600" aria-hidden />}
        subtitle={`${drilldownStories.length} stor${drilldownStories.length === 1 ? "y" : "ies"} in scope`}
        onClose={() => setDrilldownTeam(null)}
      >
        <TeamDrilldownTable rows={drilldownStories} />
      </InsightsDrilldownModal>
    ) : null}
    <HealthExplainerPopover open={healthExplainerOpen} onClose={() => setHealthExplainerOpen(false)} />
    </>
  );
}

/* -------- Row-1 pieces -------- */

function PillToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex items-center rounded-full border border-slate-200 bg-white p-0.5 shadow-sm">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[13px] font-medium leading-none transition-colors",
              active
                ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function IconButton({
  icon: Icon,
  label,
  badge,
}: {
  icon: typeof Bell;
  label: string;
  badge?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="relative inline-flex size-9 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 transition hover:text-slate-800 hover:ring-slate-300"
    >
      <Icon className="size-[18px]" aria-hidden />
      {badge ? (
        <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-indigo-500" aria-hidden />
      ) : null}
    </button>
  );
}

/* -------- Row-2 pieces -------- */

function StatBlock({
  icon,
  value,
  suffix,
  label,
  subLabel,
  onClick,
  active = false,
  title,
}: {
  icon: React.ReactNode;
  value: number;
  suffix?: string;
  label: string;
  subLabel?: string;
  /** Wires the block as a button. Omit for read-only display. */
  onClick?: () => void;
  /** Renders the "pressed" visual when this block represents the active
   *  state of a toggle (Initiatives/Epics bar mode, Teams overlay,
   *  Sprints chip row). */
  active?: boolean;
  /** Hover tooltip — explains the toggle behavior. */
  title?: string;
}) {
  const interactive = Boolean(onClick);
  const Wrapper: React.ElementType = interactive ? "button" : "div";
  return (
    <Wrapper
      {...(interactive ? { type: "button", onClick, "aria-pressed": active, title } : {})}
      className={cn(
        "flex shrink-0 items-start gap-3 rounded-lg text-left transition outline-none",
        interactive && "cursor-pointer px-2 py-1.5 -mx-2 -my-1.5",
        interactive && (active
          ? "bg-indigo-50 ring-1 ring-indigo-200/80"
          : "hover:bg-slate-50 ring-1 ring-transparent focus-visible:ring-indigo-300"),
      )}
    >
      <span className="mt-[2px] shrink-0 [&_svg]:size-[18px]">{icon}</span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span
          className={cn(
            "text-[17px] font-semibold tabular-nums tracking-tight",
            active ? "text-indigo-900" : "text-slate-900",
          )}
        >
          {value}
          {suffix ? (
            <span className="ml-0.5 text-[13px] font-semibold opacity-90">{suffix}</span>
          ) : null}
        </span>
        <span
          className={cn(
            "mt-0.5 text-[10.5px] font-medium leading-none",
            active ? "text-indigo-700" : "text-slate-500",
          )}
        >
          {label}
        </span>
        {subLabel ? (
          <span className="mt-1 text-[11px] leading-none text-slate-400">{subLabel}</span>
        ) : null}
      </div>
    </Wrapper>
  );
}

function Divider() {
  return <div className="mx-0.5 hidden h-12 w-px shrink-0 self-center bg-slate-200/80 sm:block" />;
}

/** Story table rendered inside the Team Progress drilldown modal.
 *  Compact layout mirroring the insights drilldown's chrome. */
function TeamDrilldownTable({
  rows,
}: {
  rows: Array<{
    story: {
      id: string;
      title: string;
      status: string;
      sprint: number | null;
      estimatedDays: number | null;
      daysLeft: number | null;
      assignee: string | null;
    };
    epicTitle: string;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-slate-400">
        No stories for this team.
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-[#0897d5] text-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Story</th>
            <th className="px-3 py-2 text-left font-semibold">Epic</th>
            <th className="px-3 py-2 text-left font-semibold">Sprint</th>
            <th className="px-3 py-2 text-left font-semibold">Assignee</th>
            <th className="px-3 py-2 text-left font-semibold">Status</th>
            <th className="px-3 py-2 text-right font-semibold">Est days</th>
            <th className="px-3 py-2 text-right font-semibold">Days left</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ story, epicTitle }, i) => (
            <tr
              key={story.id}
              className={i % 2 === 0 ? "bg-[#d8f2ff]/50" : "bg-white"}
            >
              <td className="px-3 py-2 font-medium text-slate-900">{story.title}</td>
              <td className="px-3 py-2 text-slate-700">{epicTitle}</td>
              <td className="px-3 py-2 text-slate-700">
                {story.sprint != null ? `Sprint ${story.sprint}` : "—"}
              </td>
              <td className="px-3 py-2 text-slate-700">{story.assignee || "Unassigned"}</td>
              <td className="px-3 py-2 text-slate-700">{story.status}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                {Number(story.estimatedDays ?? 0)}d
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                {Number(story.daysLeft ?? 0)}d
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Compact "Team Progress (all epics)" card. Mirrors the insights chart
 *  in spirit — one row per team with avatar, % done, est/left numbers,
 *  and a horizontal progress bar — but trimmed to fit alongside the
 *  three donut cards in the hero band. Rolls up across the entire
 *  roadmap (all quarters) rather than the active month. */
function TeamProgressCard({
  rows,
  unitSuffix = "d",
  onRowClick,
  panelClassName,
}: {
  unitSuffix?: string;
  onRowClick?: (teamId: string, label: string) => void;
  rows: Array<{
    teamId: string;
    label: string;
    estTotal: number;
    daysLeft: number;
    doneDays: number;
    donePct: number;
    status: HealthStatus;
  }>;
  /** Tailwind classes added to the outer card wrapper so this card can sit
   *  on a distinctly tinted background alongside the donut cards in the
   *  dashboard hero. */
  panelClassName?: string;
}) {
  // Tracks whether the workspace actually has any teams defined in the
  // Users directory (via /api/teams). Drives whether to surface the
  // "Create a team" CTA when the rollup is empty: we don't want to nag a
  // planner who has already set up teams but just hasn't assigned any
  // epics to them yet. Starts `null` (unknown) so the CTA stays hidden
  // during the brief fetch window — better to show nothing than to
  // flash the wrong empty state.
  const [hasDefinedTeams, setHasDefinedTeams] = useState<boolean | null>(null);
  useEffect(() => {
    let canceled = false;
    fetch("/api/teams")
      .then((res) => (res.ok ? res.json() : []))
      .then((teams: unknown) => {
        if (canceled) return;
        setHasDefinedTeams(Array.isArray(teams) && teams.length > 0);
      })
      .catch(() => {
        if (canceled) return;
        // Assume teams exist on error so we don't accidentally surface
        // the "Create a team" CTA to someone who already has them.
        setHasDefinedTeams(true);
      });
    return () => {
      canceled = true;
    };
  }, []);
  return (
    <div
      className={cn(
        "flex w-[520px] min-w-[520px] max-w-[520px] shrink-0 flex-col gap-2 rounded-2xl px-7 py-3 ring-1 ring-inset transition-shadow",
        panelClassName ?? "bg-white ring-slate-200/70",
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        <Users className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
        Team Progress (all epics)
      </span>
      <div
        className={cn(
          // Negative right margin extends the scroll region past the
          // card's px-7 padding so the scrollbar sits a touch closer to
          // the right edge of the visible panel rather than floating in
          // the gutter.
          "-mr-4 max-h-[130px] space-y-0.5 overflow-y-auto pr-1.5",
          // Match the project's pastel scrollbar (initiative panel et al.)
          "[scrollbar-color:theme(colors.indigo.100)_transparent]",
          "[&::-webkit-scrollbar]:w-1.5",
          "[&::-webkit-scrollbar-track]:bg-transparent",
          "[&::-webkit-scrollbar-thumb]:rounded-full",
          "[&::-webkit-scrollbar-thumb]:bg-gradient-to-b",
          "[&::-webkit-scrollbar-thumb]:from-sky-100",
          "[&::-webkit-scrollbar-thumb]:via-indigo-100",
          "[&::-webkit-scrollbar-thumb]:to-violet-100",
          "hover:[&::-webkit-scrollbar-thumb]:from-sky-200",
          "hover:[&::-webkit-scrollbar-thumb]:via-indigo-200",
          "hover:[&::-webkit-scrollbar-thumb]:to-violet-200",
        )}
        style={{ scrollbarWidth: "thin" }}
      >
        {/* Empty-state handling. Two distinct cases:
              1. No teams in the Users directory yet → show the "Create a
                 team" CTA so the planner can set one up. Reasons for the
                 rollup being empty in this case: either no rows at all
                 (Σ Story est days / Epic est days bases with no estimates)
                 or only the synthetic "__unassigned__" bucket exists
                 (Stories Count basis with stories but no real team).
              2. Teams exist but no real-team row has data yet → show a
                 plain "No data" line. The planner already created teams;
                 nagging them to create another would be wrong. */}
        {(() => {
          const isEmpty =
            rows.length === 0 ||
            (rows.length === 1 && rows[0].teamId === "__unassigned__");
          if (!isEmpty) return null;
          if (hasDefinedTeams === false) {
            return (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/50 px-3 py-2.5">
                <p className="text-[12.5px] font-semibold text-slate-700">
                  No team has any epic to track yet.
                </p>
                <p className="mt-1 text-[11.5px] leading-snug text-slate-500">
                  <button
                    type="button"
                    onClick={() => {
                      // Open the Users workspace with `?action=addTeam` so
                      // the existing Add Team slide-in form (logo, lead,
                      // members) opens immediately.
                      const url = new URL(window.location.href);
                      url.searchParams.set("view", "users");
                      url.searchParams.set("action", "addTeam");
                      window.history.pushState({}, "", url.toString());
                      window.dispatchEvent(new PopStateEvent("popstate"));
                    }}
                    className="font-semibold text-indigo-600 underline decoration-indigo-300 underline-offset-2 transition-colors hover:text-indigo-700 hover:decoration-indigo-500"
                  >
                    Create a team
                  </button>{" "}
                  so we can roll up its epics here.
                </p>
              </div>
            );
          }
          // hasDefinedTeams === true (or still loading as null): show a
          // friendly empty-state illustration instead of a bare line.
          // A dashed emerald circle wraps the Users glyph so the panel
          // doesn't read as broken when teams exist but no rollup has
          // landed yet.
          return (
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 py-3">
              <div className="flex size-16 items-center justify-center rounded-full border-2 border-dashed border-emerald-300/70 bg-emerald-50/40">
                <Users className="size-7 text-emerald-500/80" strokeWidth={1.8} aria-hidden />
              </div>
              <p className="text-[12.5px] font-medium text-slate-400">No data</p>
            </div>
          );
        })()}
        {!(rows.length === 0 || (rows.length === 1 && rows[0].teamId === "__unassigned__")) && (
          rows.map((row) => {
            const atRisk = row.status === "atRisk" || row.status === "overdue";
            const watch = row.status === "watch";
            const allDone = row.daysLeft === 0 && row.estTotal > 0;
            return (
              <button
                key={row.teamId}
                type="button"
                onClick={onRowClick ? () => onRowClick(row.teamId, row.label) : undefined}
                disabled={!onRowClick}
                className={cn(
                  "w-full rounded-md px-1 py-0.5 text-left transition outline-none",
                  onRowClick
                    ? "cursor-pointer hover:bg-gradient-to-r hover:from-sky-50 hover:via-indigo-50 hover:to-violet-50 hover:ring-1 hover:ring-indigo-200/70 focus-visible:ring-2 focus-visible:ring-indigo-300"
                    : "cursor-default",
                )}
              >
                <div className="flex items-center gap-2">
                  <TeamAvatar
                    slug={row.teamId === "__unassigned__" ? null : row.teamId}
                    sizePx={18}
                    rounded="rounded-full"
                    className={cn(
                      "ring-1",
                      atRisk
                        ? "ring-amber-200/80"
                        : allDone
                          ? "ring-emerald-200/80"
                          : "ring-violet-200/80",
                    )}
                    fallback={
                      <span
                        className={cn(
                          "inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-bold ring-1",
                          atRisk
                            ? "bg-amber-100 text-amber-800 ring-amber-200/80"
                            : allDone
                              ? "bg-emerald-100 text-emerald-700 ring-emerald-200/80"
                              : "bg-violet-100 text-violet-700 ring-violet-200/80",
                        )}
                      >
                        {row.label.slice(0, 2).toUpperCase()}
                      </span>
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="inline-flex min-w-0 items-baseline gap-1">
                        <span className="truncate text-[12px] font-semibold text-slate-800">{row.label}</span>
                        <span className="shrink-0 text-[10.5px] font-semibold tabular-nums text-slate-500">{row.donePct}%</span>
                      </span>
                      <span className="shrink-0 text-[10.5px] tabular-nums text-slate-500">
                        <span className="font-semibold text-slate-700">{row.estTotal}{unitSuffix}</span>
                        <span className="mx-1 text-slate-300">·</span>
                        <span className={cn("font-semibold", atRisk || watch ? "text-amber-700" : "text-slate-700")}>{row.daysLeft}{unitSuffix}</span>
                        <span className="ml-0.5 text-slate-400">left</span>
                      </span>
                    </div>
                    <div className="mt-0.5 relative h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/50">
                      <div
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-full transition-all",
                          atRisk ? "bg-amber-400" : allDone ? "bg-emerald-400" : "bg-indigo-400",
                        )}
                        style={{ width: `${row.donePct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function DonutCard({
  title,
  titleIcon,
  titleAction,
  centerCount,
  centerLabel,
  slices,
  sideTotal,
  onSliceClick,
  activeLabels,
  extraLegendRows,
  panelClassName,
}: {
  title: string;
  /** Optional icon rendered next to the card title — same family of
   *  Lucide icons used elsewhere in the planner. */
  titleIcon?: React.ReactNode;
  /** Optional interactive node rendered after the title text — e.g. an
   *  Info icon button that opens an explainer popover. */
  titleAction?: React.ReactNode;
  /** Tailwind classes added to the outer card wrapper so each chart in the
   *  dashboard hero can sit on a distinctly tinted background panel
   *  (emerald, sky, orange, violet…). When omitted the card renders flat. */
  panelClassName?: string;
  /** When provided, rendered in the donut's center. Pass `null` to skip
   *  the centered total (useful when the donut already shows multiple
   *  colors and a side total reads better). */
  centerCount: number | null;
  centerLabel: string;
  slices: Array<{ label: string; value: number; color: string; icon?: React.ReactNode; valueSuffix?: string }>;
  /** When provided, rendered as a large number to the right of the
   *  legend (Health Distribution uses this since multiple verdicts
   *  share the donut and a side label is cleaner). */
  sideTotal?: { count: number; label: string };
  /** When provided, each legend row becomes a toggle button that fires
   *  with the slice label on click. Used by Health Distribution to
   *  drive the middle-panel health verdict filter. */
  onSliceClick?: (label: string) => void;
  /** Labels currently selected — rendered with a pressed visual. */
  activeLabels?: Set<string>;
  /** Extra legend rows rendered below the slice rows. Not part of the
   *  donut data — used to surface adjacent metrics (e.g. epics /
   *  stories without description) as click-throughs. Pct is pre-computed
   *  by the caller (each extra row may have its own denominator). */
  extraLegendRows?: Array<{
    label: string;
    value: number;
    pct: number;
    color: string;
    icon?: React.ReactNode;
    onClick: () => void;
    title?: string;
    valueSuffix?: string;
  }>;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  // Slice the mouse is currently hovering — used to mirror the legend
  // row's hover/active visual when the cursor is on the SVG arc.
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);
  return (
    <div
      className={cn(
        "flex w-[520px] min-w-[520px] max-w-[520px] shrink-0 flex-col gap-2 rounded-2xl px-7 py-3 ring-1 ring-inset transition-shadow",
        panelClassName ?? "bg-white ring-slate-200/70",
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        {titleIcon ? <span className="inline-flex shrink-0 text-slate-500" aria-hidden>{titleIcon}</span> : null}
        {title}
        {titleAction ?? null}
      </span>
      <div className="flex items-center gap-6">
        <DonutSvg
          total={total}
          slices={slices}
          centerCount={centerCount}
          centerLabel={centerLabel}
          hoveredSlice={hoveredSlice}
          onSliceHover={setHoveredSlice}
          onSliceClick={onSliceClick}
        />
        <ul
          // Fixed minimum widths on each column so all three donut cards
          // (Work Progress, Health Distribution, Epic Estimates) align to
          // the same label / value / percent gutters even when individual
          // labels are shorter. "Stories w/o description" sets the
          // baseline width in Epic Estimates; this min matches it.
          className="grid grid-cols-[minmax(11rem,auto)_minmax(4.25rem,auto)_minmax(2.75rem,auto)] items-center gap-x-4 gap-y-1.5 text-[13px] leading-tight"
        >
          {slices.map((slice) => {
              const pct = total > 0 ? Math.round((slice.value / total) * 100) : 0;
              const active = activeLabels?.has(slice.label) ?? false;
              const isZero = slice.value === 0;
              if (onSliceClick) {
                const isHovered = hoveredSlice === slice.label;
                return (
                  <button
                    key={slice.label}
                    type="button"
                    onClick={() => onSliceClick(slice.label)}
                    onMouseEnter={() => setHoveredSlice(slice.label)}
                    onMouseLeave={() => setHoveredSlice(null)}
                    aria-pressed={active}
                    className={cn(
                      "col-span-3 grid grid-cols-subgrid items-center gap-x-4 rounded-md px-1.5 py-0.5 text-left transition outline-none",
                      "focus-visible:ring-2 focus-visible:ring-indigo-300",
                      isZero && !active && "opacity-55",
                      active
                        ? "bg-indigo-50 ring-1 ring-indigo-200/80"
                        : isHovered
                          ? "bg-gradient-to-r from-sky-50 via-indigo-50 to-violet-50 ring-1 ring-indigo-200/70 shadow-sm"
                          : "ring-1 ring-transparent hover:bg-gradient-to-r hover:from-sky-50 hover:via-indigo-50 hover:to-violet-50 hover:ring-indigo-200/70 hover:shadow-sm",
                    )}
                  >
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      {slice.icon ? (
                        <span className="inline-flex shrink-0" style={{ color: slice.color }} aria-hidden>
                          {slice.icon}
                        </span>
                      ) : (
                        <span
                          className="inline-block size-2 shrink-0 rounded-full"
                          style={{ background: slice.color }}
                          aria-hidden
                        />
                      )}
                      <span className={active ? "font-semibold text-indigo-900" : "text-slate-700"}>
                        {slice.label}
                      </span>
                    </span>
                    <span className={cn("text-left font-semibold tabular-nums", active ? "text-indigo-900" : "text-slate-900")}>
                      {slice.value}
                      {slice.valueSuffix ? (
                        <span className="ml-0.5 text-[10.5px] font-medium text-slate-500">{slice.valueSuffix}</span>
                      ) : null}
                    </span>
                    <span className={cn("text-left text-[12px] tabular-nums", active ? "text-indigo-700" : "text-slate-500")}>
                      ({pct}%)
                    </span>
                  </button>
                );
              }
              return (
                <Fragment key={slice.label}>
                  <span className={cn("flex items-center gap-2 whitespace-nowrap", isZero && "opacity-55")}>
                    {slice.icon ? (
                      <span className="inline-flex shrink-0" style={{ color: slice.color }} aria-hidden>
                        {slice.icon}
                      </span>
                    ) : (
                      <span
                        className="inline-block size-2 shrink-0 rounded-full"
                        style={{ background: slice.color }}
                        aria-hidden
                      />
                    )}
                    <span className="text-slate-700">{slice.label}</span>
                  </span>
                  <span className={cn("text-left font-semibold tabular-nums text-slate-900", isZero && "opacity-55")}>
                    {slice.value}
                    {slice.valueSuffix ? (
                      <span className="ml-0.5 text-[10.5px] font-medium text-slate-500">{slice.valueSuffix}</span>
                    ) : null}
                  </span>
                  <span className={cn("text-left text-[12px] tabular-nums text-slate-500", isZero && "opacity-55")}>
                    ({pct}%)
                  </span>
                </Fragment>
              );
            })}
          {total === 0 ? (
            <li className="col-span-3 text-slate-400">No data</li>
          ) : null}
          {extraLegendRows?.map((row) => (
            <button
              key={`extra-${row.label}`}
              type="button"
              onClick={row.onClick}
              title={row.title ?? row.label}
              className={cn(
                "col-span-3 grid grid-cols-subgrid items-center gap-x-4 rounded-md px-1.5 py-0.5 text-left transition outline-none",
                "ring-1 ring-transparent hover:bg-gradient-to-r hover:from-sky-50 hover:via-indigo-50 hover:to-violet-50 hover:ring-indigo-200/70 hover:shadow-sm",
                "focus-visible:ring-2 focus-visible:ring-indigo-300",
              )}
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                {row.icon ? (
                  <span className="inline-flex shrink-0" style={{ color: row.color }} aria-hidden>
                    {row.icon}
                  </span>
                ) : (
                  <span
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ background: row.color }}
                    aria-hidden
                  />
                )}
                <span className="text-slate-700">{row.label}</span>
              </span>
              <span className="text-left font-semibold tabular-nums text-slate-900">
                {row.value}
                {row.valueSuffix ? (
                  <span className="ml-0.5 text-[10.5px] font-medium text-slate-500">{row.valueSuffix}</span>
                ) : null}
              </span>
              <span className="text-left text-[12px] tabular-nums text-slate-500">
                ({row.pct}%)
              </span>
            </button>
          ))}
        </ul>
        {sideTotal ? (
          <div className="ml-2 flex flex-col items-start leading-tight">
            <span className="text-[28px] font-semibold tabular-nums tracking-tight text-slate-900">
              {sideTotal.count}
            </span>
            <span className="mt-0.5 text-[11px] font-medium leading-none text-slate-500">
              {sideTotal.label}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Inline SVG donut. 140px diameter, 18px stroke. */
function DonutSvg({
  total,
  slices,
  centerCount,
  centerLabel,
  hoveredSlice,
  onSliceHover,
  onSliceClick,
}: {
  total: number;
  slices: Array<{ label: string; value: number; color: string; icon?: React.ReactNode; valueSuffix?: string }>;
  centerCount: number | null;
  centerLabel: string;
  /** Label of the slice the cursor is on (legend OR SVG arc). When set,
   *  the matching arc dims its sibling arcs slightly and the legend row
   *  gets the same hover treatment. */
  hoveredSlice?: string | null;
  onSliceHover?: (label: string | null) => void;
  /** Same callback the legend rows use — clicking an arc behaves like
   *  clicking its legend row. */
  onSliceClick?: (label: string) => void;
}) {
  const radius = 41;
  const inner = 23;
  const strokeWidth = radius - inner;
  const circumference = 2 * Math.PI * radius;
  // Label radius — the SVG stroke is drawn CENTERED on the path circle at
  // r=radius, so the visible band runs (radius - strokeWidth/2) to
  // (radius + strokeWidth/2). Labels go on the path itself so they sit
  // dead-center on the colored ring.
  const labelRadius = radius;
  let cumulative = 0;
  return (
    <div className="relative shrink-0">
      <svg viewBox="-54 -54 108 108" className="size-[130px]" role="img" aria-label={`Total: ${total}`}>
        <circle cx="0" cy="0" r={radius} fill="none" stroke="#e2e8f0" strokeWidth={strokeWidth} />
        {total > 0
          ? slices.map((slice) => {
              if (slice.value <= 0) return null;
              const fraction = slice.value / total;
              // Round to 3 decimals so server-side and client-side
              // serializations match (prevents SSR hydration mismatch
              // on this <circle>'s `stroke-dasharray` / `dashoffset`).
              const dashOn = Math.round(fraction * circumference * 1000) / 1000;
              const dashTotal = Math.round(circumference * 1000) / 1000;
              const dasharray = `${dashOn} ${dashTotal}`;
              const interactive = Boolean(onSliceHover || onSliceClick);
              const isHovered = hoveredSlice === slice.label;
              const isOtherHovered = hoveredSlice != null && !isHovered;
              const node = (
                <circle
                  key={slice.label}
                  cx="0"
                  cy="0"
                  r={radius}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={isHovered ? strokeWidth + 3 : strokeWidth}
                  strokeDasharray={dasharray}
                  strokeDashoffset={Math.round(-cumulative * circumference * 1000) / 1000}
                  transform="rotate(-90)"
                  style={{
                    cursor: interactive ? "pointer" : undefined,
                    opacity: isOtherHovered ? 0.55 : 1,
                    transition: "opacity 120ms ease, stroke-width 120ms ease",
                  }}
                  onMouseEnter={onSliceHover ? () => onSliceHover(slice.label) : undefined}
                  onMouseLeave={onSliceHover ? () => onSliceHover(null) : undefined}
                  onClick={onSliceClick ? () => onSliceClick(slice.label) : undefined}
                />
              );
              cumulative += fraction;
              return node;
            })
          : null}
        {/* Per-slice percentage labels — only render when the slice is wide
            enough (≥7%) to fit the text without overflowing into neighbors. */}
        {total > 0
          ? (() => {
              let running = 0;
              return slices.map((slice) => {
                if (slice.value <= 0) return null;
                const fraction = slice.value / total;
                const midFraction = running + fraction / 2;
                running += fraction;
                if (fraction < 0.08) return null;
                // Convert mid-angle (rotated -90° so 0% = top) to x/y.
                // Round to 3 decimals so server and client serialize
                // identical numbers (React's `toString` precision can
                // differ between Node and the browser, which triggers
                // a hydration mismatch on this `<text>` element).
                const angle = midFraction * 2 * Math.PI - Math.PI / 2;
                const x = Math.round(Math.cos(angle) * labelRadius * 1000) / 1000;
                const y = Math.round(Math.sin(angle) * labelRadius * 1000) / 1000;
                const pct = Math.round(fraction * 100);
                return (
                  <text
                    key={`pct-${slice.label}`}
                    x={x}
                    y={y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{ fontSize: "8px", fontWeight: 700, paintOrder: "stroke" }}
                    fill="#ffffff"
                    stroke="rgba(15, 23, 42, 0.18)"
                    strokeWidth="0.4"
                    aria-hidden
                  >
                    {pct}%
                  </text>
                );
              });
            })()
          : null}
      </svg>
      {centerCount != null ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[20px] font-semibold leading-none tabular-nums text-slate-900">
            {centerCount}
          </span>
          <span className="mt-0.5 text-[10.5px] font-medium leading-none text-slate-500">
            {centerLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* -------- Stats computation -------- */

function computeRoadmapStats(
  initiatives: readonly InitiativeItem[],
  selectedYear: number,
  progressBasis: "days" | "stories" | "epicEst",
) {
  const initiativesCount = initiatives.length;
  let epicsCount = 0;
  let epicsScheduledCount = 0;
  let storiesCount = 0;
  const workProgress = { backlogEpic: 0, todo: 0, inProgress: 0, review: 0, done: 0 };
  const healthDistribution = { onTrack: 0, done: 0, watch: 0, atRisk: 0, overdue: 0, total: 0 };
  /** Epic Estimates coverage — 3-tier split when basis is "epicEst":
   *    • estimated          = epic has originalEstimateDays AND every
   *                           child story has estimatedDays (or no children).
   *    • partiallyEstimated = epic has originalEstimateDays AND at least
   *                           one child story is missing estimatedDays.
   *    • unestimated        = epic has no originalEstimateDays at all.
   *  For days/stories bases the split happens at the story level
   *  (counts of stories estimated vs not) and partiallyEstimated stays 0.
   *  `daysSum` is the total estimated days across estimated epics —
   *  rendered in the donut center as total estimated effort. */
  const epicEstimates = { estimated: 0, partiallyEstimated: 0, unestimated: 0, daysSum: 0 };
  /** Description coverage — counts of epics / stories that don't have any
   *  description text. Surfaces as click-throughs on the Epic Estimates
   *  card legend. */
  let epicsWithoutDescCount = 0;
  let storiesWithoutDescCount = 0;
  const teamIds = new Set<string>();
  const sprintIds = new Set<number>();
  /** Per-team aggregate for the Team Progress card. Sums story-level
   *  estimatedDays / daysLeft across every epic owned by the team, and
   *  rolls the worst per-epic health status up to the team. */
  type TeamAcc = {
    teamId: string;
    estTotal: number;
    daysLeft: number;
    status: HealthStatus;
  };
  const teamAccs = new Map<string, TeamAcc>();
  const STATUS_RANK_LOCAL: Record<HealthStatus, number> = {
    done: 0,
    onTrack: 0,
    watch: 1,
    atRisk: 2,
    overdue: 3,
  };

  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      epicsCount += 1;
      if (epic.planStartMonth != null && epic.planEndMonth != null) {
        epicsScheduledCount += 1;
      }
      const estDays = Number(epic.originalEstimateDays ?? 0);
      // Epic Estimates donut reflects the current basis:
      //  - epicEst: count epics with vs without originalEstimateDays (current)
      //  - days / stories: count STORIES with vs without estimatedDays > 0
      //    (handled in the per-story loop below for stories basis)
      if (progressBasis === "epicEst") {
        if (estDays > 0) {
          // Distinguish fully-estimated (all child stories sized) from
          // partially-estimated (some child stories missing). Epics with
          // no child stories at all count as fully estimated.
          const stories = epic.userStories ?? [];
          const fullyEstimated =
            stories.length === 0 || stories.every((s) => Number(s.estimatedDays ?? 0) > 0);
          if (fullyEstimated) epicEstimates.estimated += 1;
          else epicEstimates.partiallyEstimated += 1;
          epicEstimates.daysSum += estDays;
        } else {
          epicEstimates.unestimated += 1;
        }
      } else {
        // days basis still uses epic-level estimates as the "Total Days"
        // sum, but the slice split happens at the story level below.
        if (estDays > 0) epicEstimates.daysSum += estDays;
      }
      if (!(epic.description ?? "").trim()) epicsWithoutDescCount += 1;
      const team = (epic.team ?? "").trim();
      if (team) teamIds.add(team);

      let epicHealth: HealthStatus | null = null;
      if (epic.planStartMonth != null && epic.planEndMonth != null) {
        const startSprint = globalSprintFromMonthLane(
          epic.planStartMonth,
          epic.planSprint === 2 ? 2 : 1,
        );
        const endSprint = globalSprintFromMonthLane(
          epic.planEndMonth,
          epic.planEndSprint === 1 ? 1 : 2,
        );
        const start = sprintStartDate(selectedYear, startSprint);
        const end = sprintEndDate(selectedYear, endSprint);
        const h = computeProgress({
          stories: epic.userStories ?? [],
          start,
          end,
          basis: progressBasis,
          epicOriginalEstimateDays: epic.originalEstimateDays ?? null,
        });
        const verdict: HealthStatus | null = h.status ?? null;
        if (verdict != null) {
          healthDistribution[verdict] = (healthDistribution[verdict] ?? 0) + 1;
          healthDistribution.total += 1;
          epicHealth = verdict;
        }
      }

      const teamKey = team || "__unassigned__";
      let teamAcc = teamAccs.get(teamKey);
      if (!teamAcc) {
        teamAcc = { teamId: teamKey, estTotal: 0, daysLeft: 0, status: "onTrack" };
        teamAccs.set(teamKey, teamAcc);
      }
      if (epicHealth && STATUS_RANK_LOCAL[epicHealth] > STATUS_RANK_LOCAL[teamAcc.status]) {
        teamAcc.status = epicHealth;
      }

      for (const story of epic.userStories ?? []) {
        storiesCount += 1;
        if (!(story.description ?? "").trim()) storiesWithoutDescCount += 1;
        if (story.sprint != null) sprintIds.add(story.sprint);
        const estDaysStory = Math.max(0, Number(story.estimatedDays ?? 0));
        // Work Progress slice values respect the basis:
        //  - stories: count of stories per status
        //  - days / epicEst: SUM of story estimatedDays per status
        const wpAdd = progressBasis === "stories" ? 1 : estDaysStory;
        // Backlog epic trumps the underlying story status — any
        // story inside an epic that has no Gantt position (i.e. the
        // whole epic is still in the backlog) rolls up under
        // "Backlog epic". Once the epic is scheduled, normal status
        // bucketing takes over.
        if (epic.planStartMonth == null) {
          workProgress.backlogEpic += wpAdd;
        } else {
          switch (story.status) {
            case "inProgress":
              workProgress.inProgress += wpAdd;
              break;
            case "done":
              workProgress.done += wpAdd;
              break;
            case "review":
              workProgress.review += wpAdd;
              break;
            case "todo":
            default:
              workProgress.todo += wpAdd;
          }
        }
        // Epic Estimates donut, when basis is days/stories, splits at the
        // story level — count of stories estimated vs unestimated.
        if (progressBasis !== "epicEst") {
          if (estDaysStory > 0) epicEstimates.estimated += 1;
          else epicEstimates.unestimated += 1;
        }
        // Team Progress per-team rollup:
        //  - stories: estTotal = story count, daysLeft = open story count
        //  - days: estTotal = sum estimatedDays, daysLeft = sum story daysLeft
        //  - epicEst: same as days; the team progress isn't naturally
        //    epic-only since stories drive completion.
        const left = Math.max(
          0,
          story.status === "done"
            ? 0
            : Number(story.daysLeft ?? story.estimatedDays ?? 0),
        );
        if (progressBasis === "stories") {
          teamAcc.estTotal += 1;
          teamAcc.daysLeft += story.status === "done" ? 0 : 1;
        } else {
          teamAcc.estTotal += estDaysStory;
          teamAcc.daysLeft += left;
        }
      }
    }
  }

  const coveragePercent =
    epicsCount === 0 ? 0 : Math.round((epicsScheduledCount / epicsCount) * 100);

  const teamProgress = Array.from(teamAccs.values())
    .filter((t) => t.estTotal > 0)
    .map((t) => {
      const doneDays = Math.max(0, t.estTotal - t.daysLeft);
      const donePct = t.estTotal > 0 ? Math.round((doneDays / t.estTotal) * 100) : 0;
      const label =
        t.teamId === "__unassigned__"
          ? "Unassigned"
          : monthTeamLabelForId(t.teamId) ?? t.teamId;
      return {
        teamId: t.teamId,
        label,
        estTotal: t.estTotal,
        daysLeft: t.daysLeft,
        doneDays,
        donePct,
        status: t.status,
      };
    })
    .sort((a, b) => b.estTotal - a.estTotal);

  return {
    initiativesCount,
    epicsCount,
    epicsScheduledCount,
    storiesCount,
    teamsCount: teamIds.size,
    sprintsCount: sprintIds.size,
    coveragePercent,
    workProgress,
    healthDistribution,
    epicEstimates,
    epicsWithoutDescCount,
    storiesWithoutDescCount,
    teamProgress,
  };
}

