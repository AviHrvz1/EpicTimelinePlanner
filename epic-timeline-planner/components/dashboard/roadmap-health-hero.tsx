"use client";

import { Fragment, useMemo, type CSSProperties } from "react";
import Image from "next/image";
import {
  Bell,
  Folder,
  HelpCircle,
  Info,
  Layers,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

import { UserChip } from "@/components/auth/user-chip";
import { RoadmapSelector } from "@/components/timeline/roadmap-selector";
import { computeProgress, type HealthStatus } from "@/lib/progress";
import { globalSprintFromMonthLane, sprintEndDate, sprintStartDate } from "@/lib/year-sprint";
import type { InitiativeItem, RoadmapItem } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  onResetView,
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
}: {
  initiatives: readonly InitiativeItem[];
  roadmaps: RoadmapItem[];
  selectedRoadmap: RoadmapItem | null;
  selectedYear: number;
  progressBasis: "days" | "stories" | "epicEst";
  onProgressBasisChange: (next: "days" | "stories" | "epicEst") => void;
  onResetView: () => void;
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
}) {
  const stats = useMemo(() => computeRoadmapStats(initiatives, selectedYear, progressBasis), [
    initiatives,
    selectedYear,
    progressBasis,
  ]);

  return (
    <div className="relative shrink-0 border-b border-slate-200 bg-white">
      {/* Row 1 — compact filter band */}
      <div className="flex w-full items-center gap-5 pl-[3.75rem] pr-6 py-3">
        <HomeLogoButton onClick={onResetView} />
        <div className="min-w-0 shrink-0">
          <h1 className="inline-flex items-center gap-2 text-[22px] font-semibold leading-tight tracking-tight text-slate-900">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
              <ShieldCheck className="size-[18px]" aria-hidden />
            </span>
            Roadmap Health
          </h1>
          <div className="mt-1">
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
          </div>
        </div>
        <div className="ml-6 flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-slate-500">
            Health calculation
            <Info className="size-3 text-slate-400" aria-hidden />
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
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <IconButton icon={Bell} label="Notifications" badge />
          <IconButton icon={HelpCircle} label="Help" />
          <UserChip />
        </div>
        {/* Legacy summary-chip portal target — hidden visually, kept alive
            so TimelineGrid's portal mounts don't crash. */}
        <div ref={summaryBarRef} className="hidden" aria-hidden />
      </div>

      {/* Row 2 — tall bordered hero card. Left padding matches the
          legacy logo reserve (pl-[3.75rem]) so the card's left edge
          aligns with the initiative middle-panel below it. */}
      <div className="overflow-x-auto pl-[3.75rem] pr-6 pb-5 pt-1">
        <div className="flex w-full min-w-min flex-wrap items-center justify-end gap-x-5 gap-y-4 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <StatBlock
            icon={<Layers className="size-7 text-indigo-500" aria-hidden />}
            value={stats.initiativesCount}
            label="Initiatives"
            onClick={onBarModeChange ? () => onBarModeChange("initiatives") : undefined}
            active={barMode === "initiatives"}
            title="Show initiative bars on the Gantt"
          />
          <Divider />
          <StatBlock
            icon={<Folder className="size-7 text-violet-500" aria-hidden />}
            value={stats.epicsCount}
            label="Epics"
            onClick={onBarModeChange ? () => onBarModeChange("epics") : undefined}
            active={barMode === "epics"}
            title="Show epic bars on the Gantt"
          />
          <Divider />
          <StatBlock
            icon={<ScrollText className="size-7 text-sky-500" aria-hidden />}
            value={stats.storiesCount}
            label="Stories"
          />
          <Divider />
          <StatBlock
            icon={<Users className="size-7 text-emerald-500" aria-hidden />}
            value={stats.teamsCount}
            label="Teams"
            onClick={onShowTeamChipsChange ? () => onShowTeamChipsChange(!showTeamChips) : undefined}
            active={showTeamChips}
            title="Toggle team labels on the Gantt bars"
          />
          <Divider />
          <StatBlock
            icon={<Sparkles className="size-7 text-amber-500" aria-hidden />}
            value={stats.sprintsCount}
            label="Sprints"
            onClick={onShowSprintChipsChange ? () => onShowSprintChipsChange(!showSprintChips) : undefined}
            active={showSprintChips}
            title="Toggle the sprint-chip row in the calendar header"
          />
          <Divider />
          <StatBlock
            icon={<ShieldCheck className="size-7 text-emerald-500" aria-hidden />}
            value={stats.coveragePercent}
            suffix="%"
            label="Coverage"
            subLabel={`(${stats.epicsScheduledCount}/${stats.epicsCount})`}
          />
          <Divider />
          <DonutCard
            title="Work Progress (all epics)"
            centerCount={stats.storiesCount}
            centerLabel="Stories"
            slices={[
              { label: "In progress", value: stats.workProgress.inProgress, color: "#3b82f6" },
              { label: "Done", value: stats.workProgress.done, color: "#10b981" },
              { label: "To do", value: stats.workProgress.todo, color: "#cbd5e1" },
              { label: "Review / testing", value: stats.workProgress.review, color: "#8b5cf6" },
            ]}
          />
          <Divider />
          <DonutCard
            title="Health Distribution (all epics)"
            centerCount={null}
            centerLabel=""
            sideTotal={{ count: stats.healthDistribution.total, label: "Total" }}
            slices={[
              { label: "On Track", value: stats.healthDistribution.onTrack, color: "#10b981" },
              { label: "Done", value: stats.healthDistribution.done, color: "#3b82f6" },
              { label: "Watch", value: stats.healthDistribution.watch, color: "#f59e0b" },
              { label: "At Risk", value: stats.healthDistribution.atRisk, color: "#fb923c" },
              { label: "Overdue", value: stats.healthDistribution.overdue, color: "#ef4444" },
            ]}
          />
          <Divider />
          <DonutCard
            title="Epic Estimates (all epics)"
            centerCount={stats.epicEstimates.daysSum}
            centerLabel="Total Days"
            slices={[
              { label: "Estimated", value: stats.epicEstimates.estimated, color: "#6366f1" },
              { label: "Unestimated", value: stats.epicEstimates.unestimated, color: "#cbd5e1" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

/* -------- Row-1 pieces -------- */

function HomeLogoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Back to all-quarters roadmap"
      aria-label="Back to all-quarters roadmap"
      className="group absolute left-1 top-3 inline-flex h-[50px] -translate-x-[5px] cursor-pointer items-start bg-white px-1 pb-[5px] pt-[4px] shadow-[6px_0_8px_-4px_rgba(15,23,42,0.10),0_6px_8px_-4px_rgba(15,23,42,0.22)] transition-transform duration-150 hover:scale-[1.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      <Image
        src="/downloads/Logo-simple.png"
        alt="Bird Eye Viewer"
        width={1024}
        height={1024}
        priority
        quality={100}
        sizes="44px"
        className="block size-[44px] shrink-0 -translate-x-[3px] transition-transform duration-150 group-hover:rotate-[-4deg]"
      />
    </button>
  );
}

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
        "flex shrink-0 items-center gap-3 rounded-lg text-left transition outline-none",
        interactive && "cursor-pointer px-2 py-1.5 -mx-2 -my-1.5",
        interactive && (active
          ? "bg-indigo-50 ring-1 ring-indigo-200/80"
          : "hover:bg-slate-50 ring-1 ring-transparent focus-visible:ring-indigo-300"),
      )}
    >
      <span className="shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span
          className={cn(
            "text-[30px] font-semibold tabular-nums tracking-tight",
            active ? "text-indigo-900" : "text-slate-900",
          )}
        >
          {value}
          {suffix ? (
            <span className="ml-0.5 text-[22px] font-semibold opacity-90">{suffix}</span>
          ) : null}
        </span>
        <span
          className={cn(
            "mt-0.5 text-[13px] font-medium leading-none",
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
  return <div className="mx-1 hidden h-16 w-px shrink-0 self-center bg-slate-200/80 sm:block" />;
}

function DonutCard({
  title,
  centerCount,
  centerLabel,
  slices,
  sideTotal,
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
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        {title}
      </span>
      <div className="flex items-center gap-4">
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
  let dashOffset = 0;
  return (
    <div className="relative shrink-0">
      <svg viewBox="-50 -50 100 100" className="size-[140px]" role="img" aria-label={`Total: ${total}`}>
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
                  strokeDashoffset={-dashOffset}
                  transform="rotate(-90)"
                />
              );
              dashOffset += fraction * circumference;
              return node;
            })
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
  const teamIds = new Set<string>();
  const sprintIds = new Set<number>();

  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      epicsCount += 1;
      if (epic.planStartMonth != null && epic.planEndMonth != null) {
        epicsScheduledCount += 1;
      }
      const estDays = Number(epic.originalEstimateDays ?? 0);
      if (estDays > 0) {
        epicEstimates.estimated += 1;
        epicEstimates.daysSum += estDays;
      } else {
        epicEstimates.unestimated += 1;
      }
      const team = (epic.team ?? "").trim();
      if (team) teamIds.add(team);

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
        }
      }

      for (const story of epic.userStories ?? []) {
        storiesCount += 1;
        if (story.sprint != null) sprintIds.add(story.sprint);
        switch (story.status) {
          case "inProgress":
            workProgress.inProgress += 1;
            break;
          case "done":
            workProgress.done += 1;
            break;
          case "review":
            workProgress.review += 1;
            break;
          case "todo":
          default:
            workProgress.todo += 1;
        }
      }
    }
  }

  const coveragePercent =
    epicsCount === 0 ? 0 : Math.round((epicsScheduledCount / epicsCount) * 100);

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
  };
}
