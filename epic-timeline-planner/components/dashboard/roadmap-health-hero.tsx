"use client";

import { Fragment, useMemo, useState, type CSSProperties } from "react";
import {
  Bell,
  BookOpen,
  ChevronDown,
  Flag,
  Folder,
  HeartPulse,
  HelpCircle,
  Info,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";

import { UserChip } from "@/components/auth/user-chip";
import { RoadmapSelector } from "@/components/timeline/roadmap-selector";
import { computeProgress, type HealthStatus } from "@/lib/progress";
import { monthTeamLabelForId } from "@/lib/month-team-board";
import { globalSprintFromMonthLane, sprintEndDate, sprintStartDate } from "@/lib/year-sprint";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { InsightsDrilldownModal } from "@/components/timeline/insights-drilldown-modal";
import type { InitiativeItem, RoadmapItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type StoryExecStatus = "todo" | "inProgress" | "review" | "done";

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
  "In progress": "inProgress",
  "Done": "done",
  "To do": "todo",
  "Review / testing": "review",
};
const STATUS_VALUE_TO_LABEL: Record<StoryExecStatus, string> = {
  inProgress: "In progress",
  done: "Done",
  todo: "To do",
  review: "Review / testing",
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
    tab: "estimated" | "unestimated" | "epicsNoDesc" | "storiesNoDesc",
  ) => void;
}) {
  const stats = useMemo(() => computeRoadmapStats(initiatives, selectedYear, progressBasis), [
    initiatives,
    selectedYear,
    progressBasis,
  ]);
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);
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
    <div className="shrink-0 bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 pt-1.5 pb-0 pl-2 pr-[16px]">
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
        <div className="flex w-full min-w-min flex-col gap-3 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
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
                  { value: "stories", label: "Stories Completed" },
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
          <div className="h-px w-full bg-slate-200/70" aria-hidden />
          {/* Charts row — the original row 2 content, now without the
              stats grid (stats moved up next to the roadmap selector).
              justify-between spreads the four charts across the full
              width of the panel with the dividers absorbing slack. */}
          <div className="flex w-full min-w-min flex-nowrap items-center justify-between gap-x-6">
          <TeamProgressCard
            rows={stats.teamProgress}
            unitSuffix={progressBasis === "stories" ? "" : "d"}
            onRowClick={(teamId, label) => setDrilldownTeam({ teamId, label })}
          />
          <Divider />
          <DonutCard
            title="Work Progress (all epics)"
            centerCount={
              progressBasis === "stories"
                ? stats.storiesCount
                : stats.workProgress.inProgress +
                  stats.workProgress.done +
                  stats.workProgress.todo +
                  stats.workProgress.review
            }
            centerLabel={progressBasis === "stories" ? "Stories" : "Days"}
            slices={[
              { label: "In progress", value: stats.workProgress.inProgress, color: "#3b82f6" },
              { label: "Done", value: stats.workProgress.done, color: "#10b981" },
              { label: "To do", value: stats.workProgress.todo, color: "#cbd5e1" },
              { label: "Review / testing", value: stats.workProgress.review, color: "#8b5cf6" },
            ]}
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
          <Divider />
          <DonutCard
            title="Health Distribution (all epics)"
            centerCount={stats.healthDistribution.total}
            centerLabel="Total"
            slices={[
              { label: "On Track", value: stats.healthDistribution.onTrack, color: "#10b981" },
              { label: "Done", value: stats.healthDistribution.done, color: "#3b82f6" },
              { label: "Watch", value: stats.healthDistribution.watch, color: "#f59e0b" },
              { label: "At Risk", value: stats.healthDistribution.atRisk, color: "#fb923c" },
              { label: "Overdue", value: stats.healthDistribution.overdue, color: "#ef4444" },
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
          <Divider />
          <DonutCard
            title={
              progressBasis === "epicEst"
                ? "Epic Estimates (all epics)"
                : "Story Estimates (all stories)"
            }
            centerCount={
              progressBasis === "epicEst"
                ? stats.epicEstimates.daysSum
                : stats.epicEstimates.estimated + stats.epicEstimates.unestimated
            }
            centerLabel={progressBasis === "epicEst" ? "Total Days" : "Stories"}
            slices={[
              { label: "Estimated", value: stats.epicEstimates.estimated, color: "#6366f1" },
              { label: "Unestimated", value: stats.epicEstimates.unestimated, color: "#cbd5e1" },
            ]}
            onSliceClick={
              onOpenEpicEstimatePanel
                ? (label) => onOpenEpicEstimatePanel(label === "Estimated" ? "estimated" : "unestimated")
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
                      onClick: () => onOpenEpicEstimatePanel("storiesNoDesc"),
                      title: "Open the Estimate Coverage panel · Stories without description tab",
                    },
                    {
                      label: "Epics w/o description",
                      value: stats.epicsWithoutDescCount,
                      pct: stats.epicsCount > 0
                        ? Math.round((stats.epicsWithoutDescCount / stats.epicsCount) * 100)
                        : 0,
                      color: "#ec4899",
                      onClick: () => onOpenEpicEstimatePanel("epicsNoDesc"),
                      title: "Open the Estimate Coverage panel · Epics without description tab",
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
      <span className="mt-[2px] shrink-0 [&_svg]:size-6">{icon}</span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span
          className={cn(
            "text-[24px] font-semibold tabular-nums tracking-tight",
            active ? "text-indigo-900" : "text-slate-900",
          )}
        >
          {value}
          {suffix ? (
            <span className="ml-0.5 text-[18px] font-semibold opacity-90">{suffix}</span>
          ) : null}
        </span>
        <span
          className={cn(
            "mt-0.5 text-[12px] font-medium leading-none",
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
}) {
  return (
    <div className="flex w-[640px] shrink-0 flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        Team Progress (all epics)
      </span>
      <div
        className={cn(
          "max-h-[135px] space-y-1 overflow-y-auto pr-1.5",
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
        {rows.length === 0 ? (
          <div className="text-[13px] text-slate-400">No data</div>
        ) : (
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
  centerCount,
  centerLabel,
  slices,
  sideTotal,
  onSliceClick,
  activeLabels,
  extraLegendRows,
}: {
  title: string;
  /** When provided, rendered in the donut's center. Pass `null` to skip
   *  the centered total (useful when the donut already shows multiple
   *  colors and a side total reads better). */
  centerCount: number | null;
  centerLabel: string;
  slices: Array<{ label: string; value: number; color: string }>;
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
    onClick: () => void;
    title?: string;
  }>;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        {title}
      </span>
      <div className="flex items-center gap-6">
        <DonutSvg
          total={total}
          slices={slices}
          centerCount={centerCount}
          centerLabel={centerLabel}
        />
        <ul className="grid grid-cols-[auto_minmax(2rem,auto)_minmax(2.75rem,auto)] items-center gap-x-4 gap-y-1.5 text-[13px] leading-tight">
          {slices
            .filter((s) => s.value > 0)
            .map((slice) => {
              const pct = total > 0 ? Math.round((slice.value / total) * 100) : 0;
              const active = activeLabels?.has(slice.label) ?? false;
              if (onSliceClick) {
                return (
                  <button
                    key={slice.label}
                    type="button"
                    onClick={() => onSliceClick(slice.label)}
                    aria-pressed={active}
                    className={cn(
                      "col-span-3 grid grid-cols-subgrid items-center gap-x-4 rounded-md px-1.5 py-0.5 text-left transition outline-none",
                      "focus-visible:ring-2 focus-visible:ring-indigo-300",
                      active
                        ? "bg-indigo-50 ring-1 ring-indigo-200/80"
                        : "ring-1 ring-transparent hover:bg-gradient-to-r hover:from-sky-50 hover:via-indigo-50 hover:to-violet-50 hover:ring-indigo-200/70 hover:shadow-sm",
                    )}
                  >
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <span
                        className="inline-block size-2 shrink-0 rounded-full"
                        style={{ background: slice.color }}
                        aria-hidden
                      />
                      <span className={active ? "font-semibold text-indigo-900" : "text-slate-700"}>
                        {slice.label}
                      </span>
                    </span>
                    <span className={cn("text-left font-semibold tabular-nums", active ? "text-indigo-900" : "text-slate-900")}>
                      {slice.value}
                    </span>
                    <span className={cn("text-left text-[12px] tabular-nums", active ? "text-indigo-700" : "text-slate-500")}>
                      ({pct}%)
                    </span>
                  </button>
                );
              }
              return (
                <Fragment key={slice.label}>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <span
                      className="inline-block size-2 shrink-0 rounded-full"
                      style={{ background: slice.color }}
                      aria-hidden
                    />
                    <span className="text-slate-700">{slice.label}</span>
                  </span>
                  <span className="text-left font-semibold tabular-nums text-slate-900">
                    {slice.value}
                  </span>
                  <span className="text-left text-[12px] tabular-nums text-slate-500">
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
                <span
                  className="inline-block size-2 shrink-0 rounded-full"
                  style={{ background: row.color }}
                  aria-hidden
                />
                <span className="text-slate-700">{row.label}</span>
              </span>
              <span className="text-left font-semibold tabular-nums text-slate-900">
                {row.value}
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
}: {
  total: number;
  slices: Array<{ label: string; value: number; color: string }>;
  centerCount: number | null;
  centerLabel: string;
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
      <svg viewBox="-50 -50 100 100" className="size-[160px]" role="img" aria-label={`Total: ${total}`}>
        <circle cx="0" cy="0" r={radius} fill="none" stroke="#e2e8f0" strokeWidth={strokeWidth} />
        {total > 0
          ? slices.map((slice) => {
              if (slice.value <= 0) return null;
              const fraction = slice.value / total;
              const dasharray = `${fraction * circumference} ${circumference}`;
              const node = (
                <circle
                  key={slice.label}
                  cx="0"
                  cy="0"
                  r={radius}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dasharray}
                  strokeDashoffset={-cumulative * circumference}
                  transform="rotate(-90)"
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
                const angle = midFraction * 2 * Math.PI - Math.PI / 2;
                const x = Math.cos(angle) * labelRadius;
                const y = Math.sin(angle) * labelRadius;
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
          <span className="text-[28px] font-semibold leading-none tabular-nums text-slate-900">
            {centerCount}
          </span>
          <span className="mt-1 text-[12px] font-medium leading-none text-slate-500">
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
  const workProgress = { inProgress: 0, done: 0, todo: 0, review: 0 };
  const healthDistribution = { onTrack: 0, done: 0, watch: 0, atRisk: 0, overdue: 0, total: 0 };
  /** Epic Estimates coverage: how many epics have an `originalEstimateDays` set
   *  vs not. `daysSum` is the total estimated days across the estimated epics —
   *  used as the donut center so planners see total estimated effort at a glance. */
  const epicEstimates = { estimated: 0, unestimated: 0, daysSum: 0 };
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
          epicEstimates.estimated += 1;
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
