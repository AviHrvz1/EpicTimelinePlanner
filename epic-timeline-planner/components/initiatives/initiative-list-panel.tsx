"use client";

import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Circle,
  Folder,
  GripVertical,
  Info,
  ListFilter,
  ListTodo,
  PlayCircle,
  Plus,
  PanelLeftClose,
  Search,
  Eraser,
  Trash2,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { HealthExplainerPopover } from "@/components/dashboard/health-explainer-popover";
import { InitiativeCombobox } from "@/components/ui/initiative-combobox";
import { DragHandleIcon } from "@/components/ui/drag-handle";
import { UserStoryIcon } from "@/components/ui/user-story-icon";
import { EpicPlanBarIcon, InitiativePlanBarIcon } from "@/components/timeline/epic-plan-bar";
import {
  EPICS_UNPLAN_DROP_ID,
  backlogSlotDropId,
  type EpicPlanCompactDragData,
  epicBacklogSlotDropId,
  epicListDraggableId,
  storyListDraggableId,
} from "@/lib/epic-dnd-ids";
import { MONTHS } from "@/lib/timeline";
import { epicDeliveryTeamAssignmentChip, MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { normalizeWorkspaceUserTeam, teamLabelForWorkspaceUser } from "@/lib/workspace-users";
import { InitiativeStatus } from "@/lib/generated/prisma";
import { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";
import { resolveStoryYearSprint, sprintStartDate, sprintEndDate, globalSprintFromMonthLane } from "@/lib/year-sprint";
import { computeProgress, type HealthStatus } from "@/lib/progress";
import { computeEpicHealthVerdict, computeInitiativeHealthVerdict } from "@/lib/epic-health";
import { HealthBadgeWithTextPopover, formatHealthTooltip } from "@/components/timeline/health-badge";
import { rollupWorkflowStatus } from "@/lib/workflow-rollup";
import { resolveAssigneeAvatar, UserAvatar } from "@/components/ui/user-avatar";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { formatAssigneeShortLabel } from "@/lib/assignee-display";
import { cn } from "@/lib/utils";

function epicIsOnPlanForMonth(epic: EpicItem, month: number): boolean {
  if (epic.planStartMonth == null || epic.planEndMonth == null) return false;
  return epic.planStartMonth <= month && epic.planEndMonth >= month;
}

function normalizedEpicTeamId(epic: EpicItem): string {
  const raw = epic.team?.trim();
  if (!raw) return "";
  return normalizeWorkspaceUserTeam(raw);
}

function storyAssigneeDisplayName(story: UserStoryItem): string | null {
  const t = story.assignee?.trim();
  return t || null;
}


/** Same visual language as Gantt bar + insights truncation hovers (indigo gradient). */
const LEFT_PANEL_TRUNCATION_TOOLTIP_CLASS =
  "pointer-events-none w-max max-w-[min(22rem,calc(100vw-2rem))] whitespace-normal rounded-lg border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/40 px-2.5 py-1.5 text-left text-[12px] font-medium leading-snug text-slate-700 shadow-md ring-1 ring-indigo-100/70 backdrop-blur-sm";

function useStoryTitleTruncationFlag(text: string) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = el.scrollWidth > el.clientWidth + 1;
    // Functional bail-out: skip the setState (and the cascading re-render
    // + ResizeObserver callback + layout effect) when the truncation flag
    // is already correct. Without this, the flag can ping-pong on a Jump
    // navigation when the new column width causes the title to toggle
    // between truncated / not, contributing to the max-update-depth loop.
    setIsTruncated((prev) => (prev === next ? prev : next));
  }, []);
  useLayoutEffect(() => {
    measure();
  }, [text, measure]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  return { ref, isTruncated };
}

function LeftPanelStoryTitleTooltipPortal({
  show,
  anchorRef,
  text,
}: {
  show: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  text: string;
}) {
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nextTop = r.bottom + 6;
    const nextLeft = r.left;
    // Bail-out when both coords are unchanged so we don't burn a render
    // cycle on every scroll / resize tick.
    setCoords((prev) => (prev.top === nextTop && prev.left === nextLeft ? prev : { top: nextTop, left: nextLeft }));
  }, [anchorRef]);
  useLayoutEffect(() => {
    if (!show) return;
    updatePosition();
    const onReposition = () => updatePosition();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [show, updatePosition, text]);
  if (!show || typeof document === "undefined") return null;
  return createPortal(
    <div
      role="tooltip"
      style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 9999 }}
      className={LEFT_PANEL_TRUNCATION_TOOLTIP_CLASS}
    >
      {text}
    </div>,
    document.body,
  );
}

function MiddlePanelStoryTitleButton({
  storyTitle,
  ariaLabel,
  onOpen,
  className,
  highlight = false,
}: {
  storyTitle: string;
  ariaLabel: string;
  onOpen: () => void;
  className: string;
  /** When true, paints a yellow highlight on the title — used by search. */
  highlight?: boolean;
}) {
  const { ref, isTruncated } = useStoryTitleTruncationFlag(storyTitle);
  const [hover, setHover] = useState(false);
  return (
    <>
      <span
        className="min-w-0 flex-1"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <button
          ref={ref}
          type="button"
          onClick={onOpen}
          aria-label={ariaLabel}
          className={cn("min-w-0 w-full truncate rounded px-1", highlight && "bg-yellow-100", className)}
        >
          {storyTitle}
        </button>
      </span>
      <LeftPanelStoryTitleTooltipPortal show={hover && isTruncated} anchorRef={ref} text={storyTitle} />
    </>
  );
}

function quarterFromMonth(month: number): string {
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

/** Returns the sorted unique list of quarters spanned by a [start, end] month
 *  range. Used to render one chip per quarter an initiative or epic touches —
 *  a single Q1 chip if it's only Jan–Mar, but [Q1, Q2] if it spans Mar–Apr. */
function quartersFromMonthRange(start: number | null | undefined, end: number | null | undefined): string[] {
  if (start == null) return [];
  const finish = end ?? start;
  const lo = Math.max(1, Math.min(12, start));
  const hi = Math.max(lo, Math.min(12, finish));
  const set = new Set<string>();
  for (let m = lo; m <= hi; m++) set.add(quarterFromMonth(m));
  return Array.from(set).sort();
}

/** Returns the sorted unique list of quarters an initiative touches via its
 *  own startMonth/endMonth AND any of its planned epics. Mirrors the union
 *  that the Gantt would show. */
function quartersForInitiative(initiative: InitiativeItem): string[] {
  const set = new Set<string>();
  for (const q of quartersFromMonthRange(initiative.startMonth ?? null, initiative.endMonth ?? null)) set.add(q);
  for (const epic of initiative.epics ?? []) {
    for (const q of quartersFromMonthRange(epic.planStartMonth ?? null, epic.planEndMonth ?? null)) set.add(q);
  }
  return Array.from(set).sort();
}

type IconFilterOption<T extends string> = {
  value: T;
  label: string;
  icon: ReactNode;
  /** When true, render a horizontal divider ABOVE this option in the
   *  dropdown. Used to group related filters (e.g. health verdicts vs
   *  execution statuses) in a single dropdown without a second control. */
  separatorBefore?: boolean;
  /** Optional small section heading rendered with the separator. */
  sectionLabel?: string;
  /** Icon rendered to the LEFT of the section heading. */
  sectionIcon?: ReactNode;
  /** Tailwind classes applied to every item inside this section (until the
   *  next `separatorBefore`). Lets the dropdown visually distinguish
   *  groups — e.g. a soft tint behind health verdicts. */
  sectionItemClassName?: string;
};

function QuarterProgressGlyph({ steps }: { steps: 1 | 2 | 3 | 4 }) {
  return (
    <span className="inline-flex h-3 w-3 items-end gap-[1px] text-slate-500" aria-hidden>
      {Array.from({ length: 4 }, (_, idx) => (
        <span
          key={idx}
          className={cn(
            "w-[2px] rounded-[1px] bg-current",
            idx === 0 && "h-[4px]",
            idx === 1 && "h-[6px]",
            idx === 2 && "h-[8px]",
            idx === 3 && "h-[10px]",
            idx < steps ? "opacity-95" : "opacity-25",
          )}
        />
      ))}
    </span>
  );
}

function IconFilterSelect<T extends string>({
  values,
  onToggle,
  options,
  ariaLabel,
  allValue,
  disabled = false,
  appearance = "checkbox",
}: {
  values: T[];
  onToggle: (value: T) => void;
  options: IconFilterOption<T>[];
  ariaLabel: string;
  allValue: T;
  disabled?: boolean;
  /** "radio" replaces the checkbox glyph with a single-select radio dot —
   *  signals to the planner that picking another value REPLACES the prior
   *  pick (no accumulation). Used by the Quarters dropdown. */
  appearance?: "checkbox" | "radio";
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const allOption = options.find((opt) => opt.value === allValue) ?? null;
  const isAllSelected = values.includes(allValue) || values.length === 0;
  const selected = isAllSelected
    ? allOption
    : options.find((opt) => opt.value !== allValue && values.includes(opt.value)) ?? allOption;
  if (!selected) return null;
  const selectedCount = isAllSelected ? 0 : values.length;
  const selectedLabel = isAllSelected ? selected.label : selectedCount === 1 ? selected.label : `${selectedCount} selected`;
  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current != null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };
  const closeMenuSoon = () => {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => {
      detailsRef.current?.removeAttribute("open");
      closeTimeoutRef.current = null;
    }, 180);
  };

  return (
    <details
      ref={detailsRef}
      className="group relative"
      onMouseEnter={clearCloseTimeout}
      onMouseLeave={closeMenuSoon}
      onBlur={(event) => {
        clearCloseTimeout();
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) {
          detailsRef.current?.removeAttribute("open");
        }
      }}
    >
      <summary
        className={cn(
          "flex h-9 list-none items-center justify-between gap-1 rounded-lg bg-white px-1.5 text-[13px] outline-none ring-1 ring-slate-200 transition marker:content-none [&::-webkit-details-marker]:hidden",
          disabled ? "cursor-not-allowed opacity-70" : "hover:bg-slate-50 focus:ring-2 focus:ring-ring/40",
        )}
        aria-label={ariaLabel}
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          if (event.key === "Escape") detailsRef.current?.removeAttribute("open");
        }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">{selected.icon}</span>
          <span className={cn("truncate", isAllSelected ? "font-normal text-slate-400" : "font-semibold text-slate-700")}>{selectedLabel}</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-slate-500 transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="absolute top-full left-0 z-50 mt-1 w-full min-w-max rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
        {(() => {
          // Walk forward, remembering the most recent separator's
          // sectionItemClassName so every option after it inherits the same
          // background tint (until the next separator overrides).
          let currentSectionItemClass: string | undefined;
          return options.map((opt) => {
            if (opt.separatorBefore) currentSectionItemClass = opt.sectionItemClassName;
            const itemTone = currentSectionItemClass;
            return (
              <Fragment key={opt.value}>
                {opt.separatorBefore ? (
                  <div
                    className={cn(
                      "mx-1 mt-1.5 mb-1 border-t border-slate-200/80 pt-1",
                      opt.sectionItemClassName,
                    )}
                  >
                    {opt.sectionLabel ? (
                      <span className="inline-flex items-center gap-1.5 px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                        {opt.sectionIcon ? <span className="shrink-0">{opt.sectionIcon}</span> : null}
                        {opt.sectionLabel}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (disabled) return;
                    onToggle(opt.value);
                  }}
                  disabled={disabled}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-100",
                    itemTone,
                    disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
                    (isAllSelected ? opt.value === allValue : values.includes(opt.value)) && "bg-slate-100 text-slate-900",
                  )}
                >
                  {appearance === "radio" ? (
                    <span
                      className={cn(
                        "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
                        (isAllSelected ? opt.value === allValue : values.includes(opt.value))
                          ? "border-slate-700 bg-slate-700"
                          : "border-slate-300 bg-white",
                      )}
                      aria-hidden
                    >
                      {(isAllSelected ? opt.value === allValue : values.includes(opt.value)) ? (
                        <span className="block h-1.5 w-1.5 rounded-full bg-white" />
                      ) : null}
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      tabIndex={-1}
                      readOnly
                      checked={isAllSelected ? opt.value === allValue : values.includes(opt.value)}
                      className="size-3.5 rounded border-slate-300 text-slate-700"
                    />
                  )}
                  <span className="shrink-0">{opt.icon}</span>
                  <span className="whitespace-nowrap">{opt.label}</span>
                </button>
              </Fragment>
            );
          });
        })()}
      </div>
    </details>
  );
}

/**
 * Compact icon button + popover that controls BOTH the health-verdict filter
 * (the rose-tinted block of On Track / Watch / At Risk / Overdue / Done) and
 * the calculation basis (Epic Est (d) / Σ | Child Est (d) / Stories
 * Completed (%)) the verdicts are computed against. Sits next to the eraser so
 * the planner picks the lane separately from the execution-status dropdown.
 */
function HealthFilterMenu({
  healthFilter,
  onHealthFilterChange,
  progressBasis,
  onProgressBasisChange,
  onAnyHealthPicked,
  verdictCounts,
}: {
  healthFilter: Set<HealthStatus> | undefined;
  onHealthFilterChange: ((next: Set<HealthStatus>) => void) | undefined;
  progressBasis: "days" | "stories" | "epicEst";
  onProgressBasisChange: ((next: "days" | "stories" | "epicEst") => void) | undefined;
  onAnyHealthPicked: (() => void) | undefined;
  /** Per-verdict epic count for the panel population AFTER the other
   *  filters (team / status / quarter) but BEFORE the health filter
   *  itself — answers "if I picked this verdict now, how many epics
   *  would I see?" Omit to hide the count column entirely. */
  verdictCounts?: Record<HealthStatus, number>;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const activeCount = healthFilter?.size ?? 0;
  const isActive = activeCount > 0;
  // Drives the HealthExplainerPopover — opened from the small Info icon next
  // to the "Health Verdict" heading, so a planner can learn how each verdict
  // is computed without leaving the filter menu.
  const [healthExplainerOpen, setHealthExplainerOpen] = useState(false);
  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current != null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };
  const closeMenuSoon = () => {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => {
      detailsRef.current?.removeAttribute("open");
      closeTimeoutRef.current = null;
    }, 180);
  };
  // Single shared tooltip state — portalled to document.body so it can extend
  // RIGHT of the popover without being clipped by the panel's overflow-x-hidden
  // scroll container. Each info-icon mouseenter fills this in; mouseleave clears.
  const [hoveredTip, setHoveredTip] = useState<{
    tagline: string;
    hint: string;
    top: number;
    left: number;
  } | null>(null);
  const showInfoTip = (event: React.MouseEvent, tagline: string, hint: string) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setHoveredTip({
      tagline,
      hint,
      top: rect.top + rect.height / 2,
      left: rect.right + 8,
    });
  };
  const hideInfoTip = () => setHoveredTip(null);
  const toggleVerdict = (key: HealthStatus) => {
    if (!onHealthFilterChange) return;
    const next = new Set<HealthStatus>(healthFilter ?? new Set());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onHealthFilterChange(next);
    // Only fire the "user actively picked a filter" callback when the
    // resulting Set has at least one verdict. Unchecking the last verdict
    // must NOT count as a pick — otherwise the parent will keep the
    // progress overlay on after the eraser / final uncheck.
    if (next.size > 0) onAnyHealthPicked?.();
  };
  const clearVerdicts = () => {
    if (!onHealthFilterChange) return;
    onHealthFilterChange(new Set());
  };
  const verdicts: Array<{ value: HealthStatus; label: string; icon: ReactNode; tagline: string; hint: string }> = [
    {
      value: "onTrack",
      label: "On Track",
      icon: <Check className="size-3.5 text-emerald-600" />,
      tagline: "Pacing for the plan end date",
      hint: "Progress is keeping up with the expected pace for today. The epic is on course to land by its plan end.",
    },
    {
      value: "watch",
      label: "Watch",
      icon: <AlertTriangle className="size-3.5 text-amber-600" />,
      tagline: "A little behind, worth a check-in",
      hint: "Progress is slightly under the expected pace. The plan end is still reachable, but a quick review is wise.",
    },
    {
      value: "atRisk",
      label: "At Risk",
      icon: <AlertTriangle className="size-3.5 text-rose-600" />,
      tagline: "Meaningfully behind pace",
      hint: "Progress is far enough behind that the plan end is likely to slip without a scope cut or a date extension.",
    },
    {
      value: "overdue",
      label: "Overdue",
      icon: <AlertOctagon className="size-3.5 text-rose-700" />,
      tagline: "Past the plan end, not finished",
      hint: "Today is past the planned end date and the epic still has open stories. Replan the dates or push the remaining work to close.",
    },
    {
      value: "done",
      label: "Done",
      icon: <CheckCheck className="size-3.5 text-emerald-600" />,
      tagline: "All stories delivered",
      hint: "Every story in this epic is completed. The work has shipped.",
    },
  ];
  const bases: Array<{ value: "days" | "stories" | "epicEst"; label: string; icon: ReactNode; tagline: string; hint: string }> = [
    {
      value: "epicEst",
      label: "Epic days estimate",
      icon: <Folder className="size-3.5 text-violet-500" />,
      tagline: "Size set at the epic level",
      hint: "Each epic contributes the days estimate written on the epic itself. Best when you plan scope per epic and don't track per-story estimates.",
    },
    {
      value: "days",
      label: "Stories days estimate",
      icon: <CalendarDays className="size-3.5 text-sky-500" />,
      tagline: "Size summed from stories",
      hint: "Each story contributes its days estimate, and the totals roll up to the epic. Best when story-level estimates are the source of truth.",
    },
    {
      value: "stories",
      label: "Stories completed",
      icon: <CheckCircle2 className="size-3.5 text-emerald-600" />,
      tagline: "Simple done ÷ total count",
      hint: "Every story counts the same — progress is finished stories divided by total. Best when stories are similar in size or estimates are missing.",
    },
  ];
  return (
    <details
      ref={detailsRef}
      className="group relative"
      onMouseEnter={clearCloseTimeout}
      onMouseLeave={closeMenuSoon}
      onBlur={(event) => {
        clearCloseTimeout();
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) {
          detailsRef.current?.removeAttribute("open");
        }
      }}
    >
      <summary
        className={cn(
          "flex h-9 w-9 list-none items-center justify-center rounded-lg bg-white text-slate-600 outline-none ring-1 ring-slate-200 transition marker:content-none [&::-webkit-details-marker]:hidden",
          "hover:bg-slate-50 hover:text-slate-900 focus:ring-2 focus:ring-ring/40 cursor-pointer",
          isActive && "bg-rose-50/70 text-rose-700 ring-rose-200",
        )}
        title="Health verdict & calculation basis"
        aria-label="Open health verdict filter"
        onKeyDown={(event) => {
          if (event.key === "Escape") detailsRef.current?.removeAttribute("open");
        }}
      >
        <span className="relative">
          <Activity className="size-4" aria-hidden />
          {isActive ? (
            <span
              className="absolute -top-1 -right-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-semibold text-white ring-1 ring-white"
              aria-hidden
            >
              {activeCount}
            </span>
          ) : null}
        </span>
      </summary>
      <div className="absolute top-full right-0 z-50 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
        <div className="mb-1 px-1.5 pt-0.5">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            <ListFilter className="size-3 text-slate-500" aria-hidden />
            Calculation Basis
          </span>
        </div>
        <div className="space-y-0.5">
          {bases.map((b) => {
            const checked = progressBasis === b.value;
            return (
              <button
                key={b.value}
                type="button"
                onClick={() => onProgressBasisChange?.(b.value)}
                disabled={!onProgressBasisChange}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-100",
                  checked && "bg-slate-100 text-slate-900",
                  !onProgressBasisChange && "cursor-not-allowed opacity-60 hover:bg-transparent",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border",
                    checked ? "border-slate-700 bg-slate-700" : "border-slate-300 bg-white",
                  )}
                  aria-hidden
                >
                  {checked ? <span className="block h-1.5 w-1.5 rounded-full bg-white" /> : null}
                </span>
                <span className="shrink-0">{b.icon}</span>
                <span className="whitespace-nowrap">{b.label}</span>
                <span
                  className="ml-auto inline-flex shrink-0 cursor-help text-slate-400 hover:text-slate-600"
                  aria-label={`${b.label}: ${b.tagline}. ${b.hint}`}
                  onMouseEnter={(event) => showInfoTip(event, b.tagline, b.hint)}
                  onMouseLeave={hideInfoTip}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Info className="size-3.5" aria-hidden />
                </span>
              </button>
            );
          })}
        </div>
        <div className="mx-1 mt-1.5 mb-1 flex items-center justify-between gap-2 border-t border-slate-200/80 px-1.5 pt-1.5 pb-1">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            <Activity className="size-3 text-emerald-600" aria-hidden />
            Health Verdict
            <button
              type="button"
              aria-label="How is health calculated?"
              title="How is health calculated?"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setHealthExplainerOpen(true);
              }}
              className="inline-flex size-3.5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <Info className="size-3" aria-hidden />
            </button>
          </span>
          {isActive ? (
            <button
              type="button"
              onClick={clearVerdicts}
              className="text-[10px] font-medium text-slate-500 hover:text-slate-800"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="rounded-md bg-rose-50/55 p-0.5">
          {verdicts.map((v) => {
            const checked = healthFilter?.has(v.value) ?? false;
            return (
              <button
                key={v.value}
                type="button"
                onClick={() => toggleVerdict(v.value)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-slate-700 hover:bg-white/80",
                  checked && "bg-white text-slate-900 shadow-sm ring-1 ring-rose-200/60",
                )}
              >
                <input
                  type="checkbox"
                  tabIndex={-1}
                  readOnly
                  checked={checked}
                  className="size-3.5 rounded border-slate-300 text-slate-700"
                />
                <span className="shrink-0">{v.icon}</span>
                <span className="whitespace-nowrap">{v.label}</span>
                <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
                  {verdictCounts ? (
                    <span
                      className={cn(
                        "min-w-4 text-right tabular-nums text-[11.5px] font-medium",
                        verdictCounts[v.value] > 0 ? "text-slate-600" : "text-slate-300",
                      )}
                      aria-label={`${verdictCounts[v.value]} epic${verdictCounts[v.value] === 1 ? "" : "s"}`}
                    >
                      {verdictCounts[v.value]}
                    </span>
                  ) : null}
                  <span
                    className="inline-flex shrink-0 cursor-help text-slate-400 hover:text-slate-600"
                    aria-label={`${v.label}: ${v.tagline}. ${v.hint}`}
                    onMouseEnter={(event) => showInfoTip(event, v.tagline, v.hint)}
                    onMouseLeave={hideInfoTip}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Info className="size-3.5" aria-hidden />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {hoveredTip && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              style={{
                position: "fixed",
                top: hoveredTip.top,
                left: hoveredTip.left,
                transform: "translateY(-50%)",
                zIndex: 9999,
              }}
              className={cn(LEFT_PANEL_TRUNCATION_TOOLTIP_CLASS, "w-60")}
            >
              <span className="block text-[12.5px] font-semibold tracking-tight text-slate-900">
                {hoveredTip.tagline}
              </span>
              <span className="mt-0.5 block text-[12px] font-normal leading-snug text-slate-600">
                {hoveredTip.hint}
              </span>
            </div>,
            document.body,
          )
        : null}
      <HealthExplainerPopover open={healthExplainerOpen} onClose={() => setHealthExplainerOpen(false)} />
    </details>
  );
}

function TeamFilterAutocomplete({
  values,
  onToggle,
  options,
  ariaLabel,
  allValue,
  disabled = false,
}: {
  values: string[];
  onToggle: (value: string) => void;
  options: IconFilterOption<string>[];
  ariaLabel: string;
  allValue: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isAllSelected = values.includes(allValue) || values.length === 0;
  const selectedNonAll = values.filter((v) => v !== allValue);

  const displayLabel = isAllSelected
    ? ""
    : selectedNonAll.length === 1
      ? (options.find((o) => o.value === selectedNonAll[0])?.label ?? selectedNonAll[0])
      : `${selectedNonAll.length} teams`;

  const placeholder = isAllSelected ? "All Teams" : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0 && filtered[activeIndex]) {
      e.preventDefault();
      onToggle(filtered[activeIndex].value);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          "flex h-9 items-center gap-1 rounded-lg bg-white px-1.5 ring-1 ring-slate-200 transition",
          disabled ? "cursor-not-allowed opacity-70" : "hover:bg-slate-50",
          open && "ring-2 ring-ring/40",
        )}
      >
        <Users className="size-3.5 shrink-0 text-sky-400" />
        <input
          ref={inputRef}
          type="text"
          value={open ? (query.length > 0 ? query : displayLabel) : displayLabel}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          className={cn(
            "min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-slate-700 outline-none placeholder:font-normal placeholder:text-slate-400",
            disabled && "cursor-not-allowed",
          )}
          onFocus={() => { if (!disabled) setOpen(true); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
        />
        {!isAllSelected && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onToggle(allValue); setQuery(""); }}
            className="shrink-0 text-slate-400 hover:text-slate-700"
            aria-label="Clear team filter"
          >
            <X className="size-3" />
          </button>
        )}
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-slate-500 transition", open && "rotate-180")}
          aria-hidden
          onClick={() => { if (!disabled) { setOpen((v) => !v); inputRef.current?.focus(); } }}
        />
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute top-full left-0 z-50 mt-1 max-h-56 w-full min-w-max overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
          role="listbox"
          aria-multiselectable="true"
        >
          {filtered.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-slate-400">No teams found</p>
          ) : (
            filtered.map((opt, idx) => {
              const checked = isAllSelected ? opt.value === allValue : values.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onToggle(opt.value); setQuery(""); inputRef.current?.focus(); }}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-100",
                    checked && "bg-slate-100 text-slate-900",
                    activeIndex === idx && "ring-1 ring-inset ring-slate-300",
                  )}
                >
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    readOnly
                    checked={checked}
                    className="size-3.5 rounded border-slate-300 text-slate-700"
                  />
                  <span className="shrink-0">{opt.icon}</span>
                  <span className="whitespace-nowrap">{opt.label}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function storyStatusMeta(story: UserStoryItem, contextMonth: number | null): {
  sprintLabel: string | null;
  statusLabel: string;
  statusClassName: string;
  /** Hide redundant “Unscheduled” chips when every backlog story looks the same (Linear/Notion-style). */
  showStatusBadge: boolean;
} {
  const resolved =
    story.sprint == null
      ? null
      : contextMonth != null
        ? resolveStoryYearSprint(story, contextMonth)
        : story.sprint >= 3
          ? story.sprint
          : null;
  // Full label ("Sprint 10") on story chips. Uses a non-breaking space
  // so the chip never wraps onto two lines.
  const sprintLabel =
    story.sprint == null ? null : resolved != null ? `Sprint ${resolved}` : `Sprint ${story.sprint}`;

  if (story.sprint == null) {
    return {
      sprintLabel: null,
      statusLabel: "Unscheduled",
      statusClassName: "text-muted-foreground",
      showStatusBadge: false,
    };
  }
  if (story.status === "inProgress") {
    return {
      sprintLabel,
      statusLabel: "In progress",
      statusClassName:
        "border border-blue-200/70 bg-blue-50/80 px-1.5 py-0.5 text-[12px] font-medium text-blue-800",
      showStatusBadge: true,
    };
  }
  if (story.status === "review") {
    return {
      sprintLabel,
      statusLabel: "Review / Testing",
      statusClassName:
        "border border-violet-200/70 bg-violet-50/80 px-1.5 py-0.5 text-[12px] font-medium text-violet-800",
      showStatusBadge: true,
    };
  }
  if (story.status === "done") {
    return {
      sprintLabel,
      statusLabel: "Done",
      statusClassName:
        "border border-emerald-200/70 bg-emerald-50/80 px-1.5 py-0.5 text-[12px] font-medium text-emerald-800",
      showStatusBadge: true,
    };
  }
  return {
    sprintLabel,
    statusLabel: "To do",
    statusClassName:
      "border border-amber-200/70 bg-amber-50/80 px-1.5 py-0.5 text-[12px] font-medium text-amber-900",
    showStatusBadge: true,
  };
}

/** Shared base for INITIATIVE-row status/tag chips in the middle panel. */
const statusBadgeBase =
  "inline-flex items-center rounded-sm px-2.5 py-1 text-[13px] font-semibold leading-none tracking-[0.01em]";

/** Epic row chips read as a slightly de-emphasised echo of the parent
 *  initiative's chip cluster — slightly smaller text (12px vs 13px on
 *  initiative) and ~4px less total vertical height (py-0.5 vs py-1).
 *  That preserves "cohesive group" while restoring a parent-vs-child
 *  hierarchy in an opened initiative. Colors are layered on by callers
 *  via `cn(epicBadgeBase, chipColorClasses)`. */
const epicBadgeBase =
  "inline-flex items-center rounded-sm px-2.5 py-0.5 text-[12px] font-semibold leading-none tracking-[0.01em]";

/** Forces the HealthBadge to match the INITIATIVE row's chip height
 *  (`px-2.5 py-1 text-[13px]`). Tailwind-merge keeps the override last
 *  against the badge's own `px-2 py-0.5 text-[12px]` defaults. */
const healthBadgeInitiativeRowOverride =
  "px-2.5 py-1 text-[13px] leading-none rounded-sm";

/** Forces the HealthBadge to match the EPIC row's chip — `text-[12px]`
 *  and `py-0.5` so it lines up with the slightly-smaller epic chips
 *  alongside it. */
const healthBadgeEpicRowOverride =
  "px-2.5 py-0.5 text-[12px] leading-none rounded-sm";

/** Collapse a sorted-or-unsorted list of quarter labels (`"Q1"`,
 *  `"Q2"`, …) into a single human-readable range or comma list.
 *    ["Q1"]            → "Q1"
 *    ["Q1", "Q2"]      → "Q1-Q2"
 *    ["Q1", "Q2", "Q3"] → "Q1-Q3"
 *    ["Q1", "Q3"]      → "Q1, Q3"     (non-consecutive)
 *    ["Q1", "Q2", "Q4"] → "Q1-Q2, Q4" (one range + tail)
 *  Empty input returns the empty string. */
function collapseQuarterRange(quarters: readonly string[]): string {
  if (quarters.length === 0) return "";
  const nums = quarters
    .map((q) => parseInt(q.replace(/^Q/, ""), 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (nums.length === 0) return "";
  const parts: string[] = [];
  let runStart = nums[0]!;
  let runEnd = nums[0]!;
  for (let i = 1; i <= nums.length; i++) {
    if (i < nums.length && nums[i] === runEnd + 1) {
      runEnd = nums[i]!;
    } else {
      parts.push(runStart === runEnd ? `Q${runStart}` : `Q${runStart}-Q${runEnd}`);
      if (i < nums.length) {
        runStart = nums[i]!;
        runEnd = nums[i]!;
      }
    }
  }
  return parts.join(", ");
}

/** Left-panel initiative/epic cards: track grows to fill the row; summary stays on the same line (nowrap). */
const leftPanelProgressTrackClass =
  "h-1.5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-slate-100 ring-1 ring-slate-200/80";
const leftPanelProgressRowClass = "flex min-w-0 flex-nowrap items-center gap-x-2";
const leftPanelProgressSummaryClass =
  "shrink-0 whitespace-nowrap text-[13px] font-medium tabular-nums tracking-tight text-slate-600";

function epicCompletionMeta(
  epic: EpicItem,
  basis: "days" | "stories" | "epicEst" = "stories",
): {
  total: number;
  finished: number;
  percent: number;
  progressSummary: string;
  progressAria: string;
} {
  const stories = epic.userStories ?? [];
  const total = stories.length;
  const finished = stories.filter((story) => story.status === "review" || story.status === "done").length;
  if (basis === "stories") {
    const percent = total > 0 ? Math.round((finished / total) * 100) : 0;
    return {
      total,
      finished,
      percent,
      progressSummary: `${finished}/${total} stories review · ${percent}%`,
      progressAria:
        total > 0
          ? `${finished} of ${total} stories review or done`
          : "No user stories",
    };
  }
  if (basis === "epicEst") {
    // Use the epic's own Est. Epic Days as the denominator; numerator is
    // the sum of estimatedDays on review/done child stories (so a freshly
    // estimated epic with no delivered stories reads 0%). Lets the middle
    // panel show "how much of the epic budget has been delivered" rather
    // than the rolled-up child story burn-down.
    const epicEstDays = epic.originalEstimateDays ?? 0;
    let completedEffort = 0;
    for (const story of stories) {
      if (story.estimatedDays == null) continue;
      if (story.status === "review" || story.status === "done") {
        completedEffort += story.estimatedDays;
      }
    }
    const percent =
      epicEstDays > 0 ? Math.min(100, Math.round((completedEffort / epicEstDays) * 100)) : 0;
    return {
      total,
      finished,
      percent,
      progressSummary:
        epicEstDays > 0
          ? `${completedEffort}d / ${epicEstDays}d epic est. · ${percent}%`
          : "No epic estimate",
      progressAria:
        epicEstDays > 0
          ? `${completedEffort} of ${epicEstDays} epic-estimated days delivered`
          : "No epic estimate set",
    };
  }
  // days basis — effort burndown across estimated stories
  let totalEffort = 0;
  let remainingEffort = 0;
  for (const story of stories) {
    if (story.estimatedDays == null) continue;
    totalEffort += story.estimatedDays;
    if (story.status !== "review" && story.status !== "done") {
      remainingEffort += story.daysLeft ?? story.estimatedDays;
    }
  }
  const completedEffort = totalEffort - remainingEffort;
  const percent = totalEffort > 0 ? Math.round((completedEffort / totalEffort) * 100) : 0;
  return {
    total,
    finished,
    percent,
    progressSummary:
      totalEffort > 0
        ? `${completedEffort}d / ${totalEffort}d burned · ${percent}%`
        : "No estimated work",
    progressAria:
      totalEffort > 0
        ? `${completedEffort} of ${totalEffort} estimated days burned down`
        : "No estimated work",
  };
}

function epicPlanningStatusMeta(epic: EpicItem): { label: string; className: string } {
  const start = epic.planStartMonth;
  const end = epic.planEndMonth;
  const isPlanned = epic.planSprint != null && start != null && end != null;
  if (!isPlanned) {
    return {
      label: "Unscheduled",
      className: "border border-slate-200/90 bg-slate-100 text-slate-600",
    };
  }
  return {
    label: quarterFromMonth(start),
    className: "border border-violet-200/90 bg-violet-50 text-violet-800",
  };
}

function epicExecutionStatusMeta(epic: EpicItem): { label: string; className: string } {
  const stories = epic.userStories ?? [];
  if (stories.length === 0) {
    return {
      label: "To Do",
      className: "border border-amber-200/90 bg-amber-50 text-amber-800",
    };
  }
  if (stories.every((s) => s.status === "done")) {
    return {
      label: "Done",
      className: "border border-emerald-200/90 bg-emerald-50 text-emerald-800",
    };
  }
  if (stories.every((s) => s.status === "review" || s.status === "done")) {
    return {
      label: "Review / Testing",
      className: "border border-violet-200/90 bg-violet-50 text-violet-800",
    };
  }
  const hasProgress = stories.some(
    (s) => s.status === "inProgress" || s.status === "review" || s.status === "done",
  );
  if (hasProgress) {
    return {
      label: "In Progress",
      className: "border border-blue-200/90 bg-blue-50 text-blue-800",
    };
  }
  return {
    label: "To Do",
    className: "border border-amber-200/90 bg-amber-50 text-amber-800",
  };
}

function initiativeExecutionStatusMeta(initiative: InitiativeItem): { label: string; className: string } {
  const epics = initiative.epics ?? [];
  if (epics.length === 0) {
    return {
      label: "To Do",
      className: "border border-amber-200/90 bg-amber-50 text-amber-800",
    };
  }
  const statuses = epics.map((epic) => epicExecutionStatusMeta(epic).label);
  if (statuses.every((label) => label === "Done")) {
    return {
      label: "Done",
      className: "border border-emerald-200/90 bg-emerald-50 text-emerald-800",
    };
  }
  if (statuses.every((label) => label === "Review / Testing" || label === "Done")) {
    return {
      label: "Review / Testing",
      className: "border border-violet-200/90 bg-violet-50 text-violet-800",
    };
  }
  if (statuses.some((label) => label === "In Progress")) {
    return {
      label: "In Progress",
      className: "border border-blue-200/90 bg-blue-50 text-blue-800",
    };
  }
  if (statuses.some((label) => label === "To Do")) {
    return {
      label: "To Do",
      className: "border border-amber-200/90 bg-amber-50 text-amber-800",
    };
  }
  return {
    label: "In Progress",
    className: "border border-blue-200/90 bg-blue-50 text-blue-800",
  };
}

type InitiativeListPanelProps = {
  initiatives: InitiativeItem[];
  activeMonth: number | null;
  /** Cross-mode "highlight these epic IDs" filter — mirrors the same prop
   *  on TimelineGrid. When set, every epic row whose id isn't in the set
   *  fades; rows in the set stay full-strength. Inert (null/empty) when
   *  no chart has emitted a selection. Phase 2(d) of the Portfolio
   *  Burndown click-to-filter flow. */
  highlightedEpicIds?: ReadonlySet<string> | null;
  /**
   * When true (Roadmap header “Progress” on), show review % and progress bars in initiative/epic cards.
   * Parent keeps this in sync with the timeline grid.
   */
  storyProgressDetailsVisible: boolean;
  /** Whether progress is presented as story-count completion or estimated-days
   *  burn-down. Lifted to the parent so middle panel + Gantt agree. */
  progressBasis?: "days" | "stories" | "epicEst";
  /**
   * When true, show the month epic backlog layout (Epics header, + Epic). When false, show the initiatives
   * tree. The parent sets this from timeline month scope: any drilled-in month (Gantt, sprint, capacity,
   * insights, etc.) uses the epic list for that month.
   */
  useEpicPlanLeftPanel?: boolean;
  activeYearSprint: number | null;
  storyDragEnabled: boolean;
  isSprintModeActive: boolean;
  /** Opens full initiative dialog (optional if `onCreateInitiativeQuick` is used for + Initiative). */
  onCreateInitiative?: () => void;
  /** Opens full epic dialog (optional if inline + Epic via `onCreateEpicQuick` is used). */
  onCreateEpic?: () => void;
  /** When set, + Initiative opens an inline title field in this panel instead of a dialog. Return the new initiative id when creating (needed for parent pickers). */
  onCreateInitiativeQuick?: (title: string) => Promise<string | void>;
  onEditInitiative: (initiative: InitiativeItem) => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onOpenStory: (storyId: string) => void;
  onDeleteEpic: (epicId: string) => void;
  onDeleteInitiative: (id: string) => void;
  onCreateEpicQuick: (initiativeId: string, title: string) => Promise<void>;
  onCreateStoryQuick: (epicId: string, title: string) => Promise<void>;
  epicBacklogOrderByMonth: Record<number, string[]>;
  /** When set (e.g. sprint board scoped to a delivery team), month epic list only shows epics assigned to this team id. */
  monthEpicTeamFilterId?: string | null;
  /**
   * When the user changes the left-panel team filter on a sprint surface, update the sprint board team
   * (Kanban / capacity / insights) so both stay aligned.
   */
  onSprintBoardTeamFilterSync?: (teamId: string | null) => void;
  /** When set (quarter team assignment), list epics for initiatives spanning any of these months (deduped). */
  epicPanelQuarterMonths?: number[] | null;
  /** Label for quarter-scoped list (e.g. `Q1`). */
  epicPanelQuarterLabel?: string | null;
  /** Optional quarter sync from timeline selection. */
  panelQuarterQuickFilter?: "Q1" | "Q2" | "Q3" | "Q4" | null;
  /** Lock quarter filter UI (used in quarter gantt view). */
  panelQuarterFilterLocked?: boolean;
  /** Fires when an initiative accordion opens or closes (initiative list mode). */
  onInitiativeAccordionChange?: (initiativeId: string, isOpen: boolean) => void;
  /** Fires when an epic accordion opens or closes under an initiative card. */
  onEpicAccordionChange?: (epicId: string, isOpen: boolean) => void;
  /** Optional top-chip quick filter sync (Scheduled / Unscheduled epics). */
  panelStatusQuickFilter?: "Scheduled" | "Unscheduled" | null;
  /** Seed the initiative search box from outside (e.g. when the user jumps
   *  from the Backlog's "Schedule" link with a specific epic title). The
   *  panel writes this value into its internal `initiativeSearch` state
   *  whenever the prop CHANGES. Pass empty string to clear search; pass
   *  `null`/`undefined` to leave whatever the user typed alone. */
  prefillSearchQuery?: string | null;
  /** Optional action to hide this entire left panel. */
  onHidePanel?: () => void;
  /**
   * When true, enable epic plan drag handles even if `isSprintModeActive` is true.
   * Used for month epic-gantt tab where the user should be able to drag unscheduled epics onto the month Gantt.
   */
  isOnEpicGanttTab?: boolean;
  /** When true (sprint-capacity tab), unassigned stories show drag handle; scheduled stories skip the scheduled icon. */
  isCapacityPlanningMode?: boolean;
  /**
   * Users directory (and derived custom teams) — merged into the Epics “All teams” filter with Platform /
   * Experience / Data.
   */
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  /** Roadmap plan year — required to compute health verdicts (sprint start/end dates) for the
   *  in-panel health filter chips. */
  planYear?: number;
  /** Shared with the Roadmap Health popover and the Gantt — clicking a chip
   *  here updates the same Set the popover writes to, so the two views
   *  filter in lockstep. */
  healthFilter?: Set<HealthStatus>;
  onHealthFilterChange?: (next: Set<HealthStatus>) => void;
  /** Hero KPI scope. When `"initiative"`, the panel filters its visible
   *  initiatives by the worst-of-children initiative verdict — same as
   *  the Hero's Health Distribution donut at initiative scope. At other
   *  scopes the legacy any-child-epic-matches semantics is preserved so
   *  the Roadmap Health popover keeps behaving as before. */
  heroScope?: "initiative" | "epic" | "story";
  /** Mirrors the Hero KPI strip's "Teams" tile (`showGanttTeamChipsCtrl`
   *  in the parent). When `false`, epic rows in this panel hide their
   *  delivery-team chip — same toggle that hides team chips on the
   *  Gantt bars, so the two surfaces stay in lockstep. Default `false`
   *  (chips off) to match the tile's initial inactive state. */
  showTeamChips?: boolean;
  /** Switch the planner to the Insights tab pre-scoped to a specific
   *  initiative or epic — same callback the epic / initiative dialogs
   *  fire when their "Insights" header button is clicked. The panel
   *  uses it to render a hover-revealed insights icon at the top-right
   *  of each initiative / epic card. When omitted, the icon is not
   *  rendered (callers without an Insights surface stay unchanged). */
  onOpenInsights?: (kind: "epic" | "initiative", id: string) => void;
  /** Parent-owned execution-status filter — currently the Gantt status
   *  filter the Hero's Work Progress donut writes to. When `heroScope`
   *  is `"initiative"` and this set is non-empty, the panel filters its
   *  initiatives by the initiative-level workflow rollup (same recipe
   *  as the Work Progress donut). At other scopes the existing
   *  `panelStatusFilters` dropdown semantics is preserved. */
  externalStatusFilter?: ReadonlySet<"todo" | "inProgress" | "review" | "done" | "backlogEpic"> | null;
  /** Parent-owned team filter — currently driven by the Hero's Team
   *  Progress row clicks. When non-empty, the panel keeps initiatives
   *  whose epics include at least one belonging to the picked team(s).
   *  Applied at every scope (team filtering is meaningful at all three
   *  scopes — an initiative panel showing "Mobile's portfolio" is the
   *  natural read regardless of whether the planner is thinking in
   *  initiatives, epics, or stories). */
  externalTeamFilter?: ReadonlySet<string> | null;
  /** Fires whenever the planner picks a non-"all" option in the unified
   *  Statuses dropdown — either a regular status OR a health verdict. Used
   *  by the parent to force-enable the roadmap Progress toggle so the
   *  filtered effect actually shows up on the Gantt bars. */
  onUserPickedFilter?: () => void;
  /** Fires with a derived `Set<UserStoryItem["status"]>` whenever the
   *  panel's execution-status filter changes. Empty Set means "no filter
   *  active" (matches "all"). Used by the parent to apply the same cut to
   *  the Gantt rows — so picking `In Progress` in the dropdown hides
   *  non-matching epics from the bars too. Plan-only statuses (Scheduled /
   *  Unscheduled) are ignored here since the Gantt only renders scheduled
   *  epics anyway. */
  onPanelStatusFilterDerivedChange?: (next: Set<UserStoryItem["status"]>) => void;
  /** Fires with a derived Set of selected quarters whenever the panel's
   *  quarter filter changes. Empty Set means "All Quarters". Parent uses
   *  this to also cut the Gantt rows to epics whose plan-start quarter is
   *  in the filter. */
  onPanelQuarterFilterDerivedChange?: (next: Set<"Q1" | "Q2" | "Q3" | "Q4">) => void;
  /** Fires with `true` when at least one team has been pinned in the
   *  panel team filter (i.e. user picked something other than "all"). Used
   *  by the parent to force-enable the Gantt's team-chip overlay so the
   *  bars surface which delivery team owns them. */
  onPanelTeamFilterActiveChange?: (active: boolean) => void;
  /** Fires with the derived Set of selected team IDs (empty when "all") so
   *  the parent can apply the same cut to the Gantt rows — picking
   *  `Mobile` in the panel filter hides non-Mobile bars too. */
  onPanelTeamFilterDerivedChange?: (next: Set<string>) => void;
  /** Lets the planner pick which basis the health popover (in the panel
   *  filter row) drives `computeProgress` with. Same values the toolbar
   *  Health chip and the Insights surface use; lifted so changing it
   *  here updates the bars and the Insights chips at the same time. */
  onProgressBasisChange?: (next: "days" | "stories" | "epicEst") => void;
};

function DraggableInitiativeCard({
  initiative,
  onEdit,
  onDelete,
}: {
  initiative: InitiativeItem;
  onEdit: (initiative: InitiativeItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className="rounded-md border border-slate-200/90 bg-white p-3"
      style={{
        borderLeftColor: initiative.color,
        borderLeftWidth: 4,
      }}
    >
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-1 pl-0">
              <span className="inline-flex shrink-0 text-[16px] leading-none text-slate-800">
                {/* Force the canonical initiative icon (Zap) in the list
                    panel — ignore the per-initiative custom icon here so the
                    middle panel reads as a uniform list of initiatives. The
                    custom icon (emoji) still shows on Gantt bars and forms. */}
                <InitiativePlanBarIcon icon={null} className="mr-0 text-slate-700 [&_svg]:text-blue-600" />
              </span>
              <p className="min-w-0 truncate text-[18px] leading-6 font-normal text-slate-900">{initiative.title}</p>
            </div>
            <div className="flex shrink-0 gap-1" />
          </div>
          {initiative.description ? (
            <p className="line-clamp-2 text-[12px] leading-4 text-slate-600">{initiative.description}</p>
          ) : null}
          {initiative.epics.length > 0 ? (
            <p className="text-[11px] text-slate-500">
              {initiative.epics.length} epic{initiative.epics.length !== 1 ? "s" : ""}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DragToKanbanArrowIcon({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-block", className)} aria-hidden style={{ width: "1.9rem", height: "1.9rem" }}>
      {/* user story icon — fully visible top-left */}
      <span className="absolute top-0 left-0 size-4 shrink-0 flex items-center justify-center">
        <UserStoryIcon />
      </span>
      {/* cursor tip sits at bottom-right corner of story icon */}
      <svg viewBox="0 0 14 16" fill="currentColor" className="absolute size-5" style={{ top: "12px", left: "11px" }} focusable="false">
        <path d="M2 1 L2 13 L5 10 L7.5 15 L9 14.3 L6.5 9.3 L10.5 9.3 Z" stroke="white" strokeWidth="0.85" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function DragToGanttArrowIcon({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-block", className)} aria-hidden style={{ width: "1.9rem", height: "1.9rem" }}>
      {/* drag handle icon — fully visible top-left */}
      <GripVertical className="absolute top-0 left-0 size-4 shrink-0" strokeWidth={2} />
      {/* cursor tip sits at bottom-right corner */}
      <svg viewBox="0 0 14 16" fill="currentColor" className="absolute size-5" style={{ top: "12px", left: "11px" }} focusable="false">
        <path d="M2 1 L2 13 L5 10 L7.5 15 L9 14.3 L6.5 9.3 L10.5 9.3 Z" stroke="white" strokeWidth="0.85" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function InitiativeTreeEpicRow({
  epic,
  initiative,
  isEpicOpen,
  onToggleEpic,
  planContextMonth,
  epicPlanDragEnabled,
  onOpenEpic,
  onOpenStory,
  onCreateStoryQuick,
  storyProgressDetailsVisible,
  progressBasis,
  showDragHint = false,
  isCapacityMode = false,
  searchQuery,
  workspaceDirectoryUsers = [],
  showTeamChips = false,
  showHealthChips = false,
  showStatusChips = false,
  onOpenInsights,
}: {
  epic: EpicItem;
  initiative: InitiativeItem;
  isEpicOpen: boolean;
  onToggleEpic: () => void;
  planContextMonth: number | null;
  hideScheduledIcon?: boolean;
  epicPlanDragEnabled: boolean;
  isCapacityMode?: boolean;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onOpenStory: (storyId: string) => void;
  onCreateStoryQuick?: (epicId: string, title: string) => Promise<void>;
  storyProgressDetailsVisible: boolean;
  progressBasis: "days" | "stories" | "epicEst";
  showDragHint?: boolean;
  /** Lowercased active search query. Epic title gets a yellow highlight
   *  when it contains this string; matched story titles ride the same
   *  treatment via MiddlePanelStoryTitleButton's `highlight` prop. */
  searchQuery?: string;
  /** Used to swap the User icon for a real photo on story-row assignee chips. */
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  /** Gated by the Hero KPI strip "Teams" tile — when `false`, the epic's
   *  delivery-team chip is suppressed from the chip cluster. */
  showTeamChips?: boolean;
  /** When wired, the epic row renders a hover-revealed Insights icon at
   *  the card's top-right. Clicking it fires `("epic", epic.id)` so the
   *  parent can switch to the Insights tab pre-scoped to this epic. */
  onOpenInsights?: (kind: "epic" | "initiative", id: string) => void;
  /** Gated by the Hero "Health Distribution" donut — true when the planner
   *  has picked at least one slice (so `healthFilter` is non-empty). When
   *  false, the per-epic health verdict chip is hidden. */
  showHealthChips?: boolean;
  /** Gated by the Hero "Work Progress" donut — true when the planner has
   *  picked at least one slice (so `externalStatusFilter` is non-empty).
   *  When false, the per-epic execution-status chip is hidden. Plan-only
   *  chips (Unscheduled / Q1-Q2 / Scheduled) are NOT gated — they reflect
   *  schedule, not workflow status, and are independent of the donut. */
  showStatusChips?: boolean;
}) {
  const epicTeamId = normalizedEpicTeamId(epic);
  const epicTeamChip = epicTeamId ? epicDeliveryTeamAssignmentChip(epicTeamId) : null;
  // Treat the epic as "already on the Gantt" whenever it has ANY
  // plan range set (or a planSprint). The previous version only
  // counted plans that covered the currently-focused month, so an
  // epic scheduled for April still showed a drag handle in the May
  // view — confusing now that the middle panel shows every epic.
  const isEpicScheduledOnGantt =
    epic.planSprint != null
    || (epic.planStartMonth != null && epic.planEndMonth != null);
  const epicDragData = {
    kind: "epic-plan-compact",
    title: epic.title,
    color: initiative.color,
    icon: epic.icon,
  } satisfies EpicPlanCompactDragData;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: epicListDraggableId(epic.id),
    disabled: isCapacityMode ? Boolean(epicTeamId) : (!epicPlanDragEnabled || isEpicScheduledOnGantt),
    data: epicDragData,
  });
  const stories = [...(epic.userStories ?? [])].sort((a, b) => a.title.localeCompare(b.title));
  const completion = epicCompletionMeta(epic, progressBasis);
  const epicPlanStatus = epicPlanningStatusMeta(epic);
  const epicExecutionStatus = epicExecutionStatusMeta(epic);
  const [storyTitle, setStoryTitle] = useState("");
  const [isAddingStory, setIsAddingStory] = useState(false);

  async function handleAddStory() {
    if (!onCreateStoryQuick) return;
    const title = storyTitle.trim();
    if (!title) return;
    setIsAddingStory(true);
    try {
      await onCreateStoryQuick(epic.id, title);
      setStoryTitle("");
    } finally {
      setIsAddingStory(false);
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md py-1 pl-0.5 pr-0.5 font-sans",
        isDragging && "opacity-60",
      )}
      style={{
        transform: !isDragging && transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 60 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      <div className="group/epic-row relative rounded-md transition-colors hover:bg-sky-50/70">
      {/* Hover-revealed Insights launcher on inner-initiative epic rows.
       *  Sits absolute top-right inside the row, fades in on row hover via
       *  the `group/epic-row` scope above so it does NOT trigger on the
       *  parent initiative card's own hover. */}
      {onOpenInsights ? (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenInsights("epic", epic.id);
          }}
          aria-label={`Open insights for ${epic.title}`}
          title="Open insights scoped to this epic"
          className="absolute right-1 top-1 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md border border-indigo-200 bg-white opacity-0 shadow-sm transition-opacity hover:bg-indigo-50 group-hover/epic-row:opacity-100"
        >
          <img
            src="/dialog-insights-icon.png"
            alt=""
            aria-hidden
            className="size-3 select-none object-contain"
            draggable={false}
          />
        </button>
      ) : null}
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onToggleEpic}
          className="inline-flex h-7 shrink-0 items-center rounded-sm text-slate-400 transition-colors hover:text-slate-600"
          aria-label={isEpicOpen ? "Collapse epic" : "Expand epic"}
          aria-expanded={isEpicOpen}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              isEpicOpen && "rotate-90",
            )}
          />
        </button>
        {(isCapacityMode ? !epicTeamId : (!isEpicScheduledOnGantt && epicPlanDragEnabled)) ? (
          <button
            type="button"
            className="relative inline-flex h-6 shrink-0 cursor-grab items-center rounded-md p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag epic"
            {...listeners}
            {...attributes}
          >
            <DragHandleIcon size="sm" />
            {showDragHint ? (
              <DragToGanttArrowIcon className="animate-epic-drag-hint-arrow pointer-events-none absolute left-0 top-1/2 size-7 text-indigo-500" />
            ) : null}
          </button>
        ) : null}
        {/* Epic-row icon — `size-5` makes it visually proportionate to the
         *  16px epic title to its right (the previous `size-3.5` looked
         *  small/floating after the title size reduction). Container height
         *  matches the title's `leading-6` line box so the icon sits
         *  centered on the epic-name row, not floating between the title
         *  and the secondary initiative line below. */}
        <span className="mr-1.5 inline-flex h-6 shrink-0 items-center" aria-hidden>
          <EpicPlanBarIcon icon={epic.icon} className="mr-0 [&_svg]:size-5 [&_svg]:text-sky-500" />
        </span>
        <button
          type="button"
          onClick={() => onOpenEpic(epic, initiative)}
          className="min-w-0 flex-1 rounded-md pl-0.5 pr-0 text-left font-normal hover:bg-white/90"
          aria-label={`Open epic ${epic.title}`}
        >
          <div className="flex min-w-0 items-center gap-1 pl-0">
            <p
              className={cn(
                "min-w-0 truncate rounded px-1 text-[16px] font-normal leading-6 tracking-tight text-slate-900",
                searchQuery && epic.title.toLowerCase().includes(searchQuery) && "bg-yellow-100",
              )}
            >
              {epic.title}
            </p>
            {epic.parentEpicId ? (
              <span
                className="inline-flex shrink-0 items-center rounded border border-indigo-200/80 bg-indigo-50 px-1 py-px text-[10px] font-semibold leading-tight text-indigo-700"
                title={`Continuation of an epic from ${epic.planYear != null ? epic.planYear - 1 : "the prior year"}`}
              >
                ↩ {epic.planYear != null ? epic.planYear - 1 : "cont"}
              </span>
            ) : null}
          </div>
        </button>
      </div>
      <div className="mt-2 space-y-2 px-0.5">
            <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
              <span className="min-w-0 shrink-0 text-left">
                {completion.total === 0 ? "No stories yet" : `${completion.total} user stor${completion.total === 1 ? "y" : "ies"}`}
              </span>
              <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
                {showHealthChips ? (() => {
                  // Per-epic health verdict — same helper the Gantt
                  // bars + Hero Health Distribution donut use, so the
                  // chip on the row reads identically wherever the
                  // planner sees this epic. Null verdicts (epics
                  // without scheduled work / no estimate) skip the
                  // chip entirely.
                  //
                  // Gated by `showHealthChips` so a Health Distribution
                  // donut pick is what reveals the chip (clearing all
                  // picks hides it again).
                  const v = computeEpicHealthVerdict(epic, initiative.year ?? new Date().getFullYear(), progressBasis);
                  if (!v) return null;
                  return (
                    <HealthBadgeWithTextPopover
                      size="sm"
                      status={v.status}
                      tooltip={formatHealthTooltip(v.result)}
                      className={healthBadgeEpicRowOverride}
                    />
                  );
                })() : null}
                {showTeamChips && epicTeamChip ? (
                  // Apply `epicBadgeBase` AFTER the team chip's own className
                  // so tailwind-merge overrides its smaller padding / font
                  // with the shared epic-badge size (matches the Quarter and
                  // Status chips alongside it on this epic row). Also widen
                  // `max-w` so longer team names like "Data & analytics"
                  // aren't truncated — the chip auto-shrinks if the row is
                  // tight, but no longer caps at 7rem.
                  //
                  // Gated by `showTeamChips` so the Hero KPI strip's
                  // "Teams" tile (which already hides team chips on the
                  // Gantt bars) hides this row's team chip in lockstep.
                  <span className={cn(epicTeamChip.className, epicBadgeBase, "max-w-[10rem] gap-1")}>
                    <TeamAvatar slug={epicTeamChip.slug} sizePx={10} fallback={<Users className="size-2.5 shrink-0" aria-hidden />} />
                    {epicTeamChip.label}
                  </span>
                ) : null}
                {epicPlanStatus.label === "Unscheduled" ? (
                  <span className={cn(epicBadgeBase, epicPlanStatus.className)}>
                    {epicPlanStatus.label}
                  </span>
                ) : (() => {
                  const qs = quartersFromMonthRange(epic.planStartMonth, epic.planEndMonth);
                  if (qs.length === 0) return null;
                  return (
                    <span className={cn(epicBadgeBase, epicPlanStatus.className)}>
                      {collapseQuarterRange(qs)}
                    </span>
                  );
                })()}
                {showStatusChips ? (
                  <span className={cn(epicBadgeBase, epicExecutionStatus.className)}>
                    {epicExecutionStatus.label}
                  </span>
                ) : null}
              </div>
            </div>
            {storyProgressDetailsVisible ? (
              <div className={leftPanelProgressRowClass}>
                <div
                  className={leftPanelProgressTrackClass}
                  role="progressbar"
                  aria-valuenow={completion.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={completion.progressAria}
                >
                  <div
                    className="h-full rounded-[3px] bg-gradient-to-r from-emerald-400 to-violet-500 transition-[width] duration-300 ease-out"
                    style={{ width: `${completion.percent}%` }}
                  />
                </div>
                <span className={leftPanelProgressSummaryClass}>
                  {completion.progressSummary}
                </span>
              </div>
            ) : null}
      </div>
      </div>
      {isEpicOpen ? (
        <div className="mt-3 pl-3">
              {stories.length === 0 && !onCreateStoryQuick ? (
                <p className="text-[11px] text-muted-foreground">No user stories.</p>
              ) : null}
              {stories.length > 0 ? (
                <ul className="space-y-2">
                  {stories.map((story, storyIdx) => {
                    const isLast = storyIdx === stories.length - 1;
                    const meta = storyStatusMeta(story, planContextMonth);
                    const { sprintLabel, statusLabel, statusClassName, showStatusBadge } = meta;
                    const assigneeName = storyAssigneeDisplayName(story);
                    const a11y = [story.title, assigneeName, statusLabel, sprintLabel].filter(Boolean).join(", ");
                    return (
                      <li key={story.id} className="relative pl-6">
                        <span className="absolute left-0 top-0 w-px bg-border/70" style={{ height: isLast ? "14px" : "100%" }} />
                        <span className="absolute left-0 top-[14px] h-px w-4 -translate-y-px bg-border/70" />
                        <div className="group/story flex w-full flex-col rounded-md pr-0.5 pl-0 transition-colors hover:bg-slate-100/70">
                          <div className="flex min-h-[28px] w-full items-center gap-0.5">
                            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                              <UserStoryIcon />
                            </span>
                            <MiddlePanelStoryTitleButton
                              storyTitle={story.title}
                              ariaLabel={a11y}
                              onOpen={() => onOpenStory(story.id)}
                              className="text-left text-[15px] font-normal text-slate-700 antialiased hover:text-foreground"
                              highlight={Boolean(searchQuery && story.title.toLowerCase().includes(searchQuery))}
                            />
                          </div>
                          {assigneeName || sprintLabel || showStatusBadge ? (
                            <div className="mt-1.5 flex w-full flex-wrap items-center justify-end gap-1 pl-6">
                              {assigneeName ? (() => {
                                const resolved = resolveAssigneeAvatar(assigneeName, workspaceDirectoryUsers);
                                return (
                                  <span
                                    className="inline-flex max-w-[7.5rem] shrink-0 items-center gap-1 truncate rounded-sm border border-border/60 bg-background py-0.5 pl-0.5 pr-1 text-[10.5px] font-medium text-slate-600"
                                    title={assigneeName}
                                  >
                                    {resolved.image ? (
                                      <UserAvatar name={resolved.name} image={resolved.image} size={16} />
                                    ) : (
                                      <User className="size-3 shrink-0 text-slate-500" aria-hidden />
                                    )}
                                    <span className="min-w-0 truncate">{formatAssigneeShortLabel(assigneeName)}</span>
                                  </span>
                                );
                              })() : null}
                              {sprintLabel ? (
                                // `inline-flex items-center leading-none` so
                                // the chip's box height is driven by font
                                // size + padding only — matches the status
                                // chip exactly on the same row.
                                <span className="inline-flex max-w-[7rem] items-center truncate rounded-sm border border-border/60 bg-background px-1.5 py-0.5 text-[12px] font-medium leading-none text-muted-foreground">
                                  {sprintLabel}
                                </span>
                              ) : null}
                              {showStatusBadge ? (
                                <span className={cn("inline-flex shrink-0 items-center leading-none tabular-nums", statusClassName)}>{statusLabel}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {onCreateStoryQuick ? (
                <div className={cn("flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1 ring-slate-100", stories.length > 0 && "mt-2")}>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500" aria-hidden>
                    <UserStoryIcon />
                  </span>
                  <input
                    type="text"
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-bwignore="true"
                    data-form-type="other"
                    data-protonpass-ignore="true"
                    data-dashlane-ignored="true"
                    data-keeper-ignored="true"
                    value={storyTitle}
                    onChange={(event) => setStoryTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleAddStory();
                      }
                    }}
                    placeholder="Add user story…"
                    className="h-6 min-w-0 flex-1 bg-transparent text-[13px] text-slate-700 placeholder:text-slate-400 outline-none"
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 h-6 w-6 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                    disabled={isAddingStory || storyTitle.trim().length === 0}
                    onClick={() => void handleAddStory()}
                  >
                    <Plus className="size-3.5" aria-hidden />
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
    </div>
  );
}

function InitiativeTreeCard({
  initiative,
  isOpen,
  onToggle,
  isSprintModeActive,
  onEditInitiative,
  onDeleteInitiative,
  onOpenEpic,
  onOpenStory,
  onDeleteEpic,
  onCreateEpicQuick,
  onCreateStoryQuick,
  onEpicAccordionChange,
  backlogDropIndex,
  planContextMonth,
  epicPlanDragEnabled,
  isCapacityPlanningMode = false,
  storyProgressDetailsVisible,
  progressBasis,
  forceOpenEpicIds,
  searchQuery,
  workspaceDirectoryUsers = [],
  isEpicDimmed,
  showTeamChips = false,
  showHealthChips = false,
  showStatusChips = false,
  onOpenInsights,
}: {
  initiative: InitiativeItem;
  isOpen: boolean;
  onToggle: () => void;
  isSprintModeActive: boolean;
  onEditInitiative: (initiative: InitiativeItem) => void;
  onDeleteInitiative: (id: string) => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onOpenStory: (storyId: string) => void;
  onDeleteEpic: (epicId: string) => void;
  onCreateEpicQuick: (initiativeId: string, title: string) => Promise<void>;
  onCreateStoryQuick: (epicId: string, title: string) => Promise<void>;
  onEpicAccordionChange?: (epicId: string, isOpen: boolean) => void;
  backlogDropIndex?: number;
  planContextMonth: number | null;
  epicPlanDragEnabled: boolean;
  isCapacityPlanningMode?: boolean;
  storyProgressDetailsVisible: boolean;
  progressBasis: "days" | "stories" | "epicEst";
  /** Search-driven force-open set — when an epic id is in this set the epic
   *  accordion opens regardless of the user's local toggle state. Used by
   *  the parent panel to expand epics that contain a matching story. */
  forceOpenEpicIds?: Set<string>;
  /** Lowercased search query — children use this to apply a yellow highlight
   *  ring to titles that include the query. Empty string = no highlight. */
  searchQuery?: string;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  /** Optional dim predicate — when provided, epics for which this returns
   *  true fade. Threaded from the panel-level `highlightedEpicIds` filter
   *  so the same fade rule applies across panel + Gantt. */
  isEpicDimmed?: (epicId: string) => boolean;
  /** Gated by the Hero KPI strip "Teams" tile — forwarded to the inner
   *  epic rows so they hide their team chip in lockstep with the Gantt. */
  showTeamChips?: boolean;
  /** Forwarded — gates the per-row health verdict chip on the initiative
   *  row AND the inner epic rows. Driven by the Hero's Health Distribution
   *  donut (non-empty `healthFilter`). */
  showHealthChips?: boolean;
  /** Forwarded — gates the per-row execution-status chip on the initiative
   *  row AND the inner epic rows. Driven by the Hero's Work Progress donut
   *  (non-empty `externalStatusFilter`). */
  showStatusChips?: boolean;
  /** Forwarded — renders a hover-revealed Insights icon at the top-right
   *  of the initiative card AND each inner epic row. */
  onOpenInsights?: (kind: "epic" | "initiative", id: string) => void;
}) {
  const inMonthView = planContextMonth != null;
  const { setNodeRef: setDropRef, isOver: isBacklogDropOver } = useDroppable({
    id: backlogDropIndex != null ? backlogSlotDropId(backlogDropIndex) : `initiative-card:${initiative.id}`,
    disabled: backlogDropIndex == null,
  });
  const [newestEpicId, setNewestEpicId] = useState<string | null>(null);
  const prevEpicIdsRef = useRef<Set<string>>(new Set(initiative.epics?.map((e) => e.id) ?? []));
  const epics = useMemo(() => {
    const sorted = [...(initiative.epics ?? [])].sort((a, b) => {
      if (a.id === newestEpicId) return 1;
      if (b.id === newestEpicId) return -1;
      return a.title.localeCompare(b.title);
    });
    return sorted;
  }, [initiative.epics, newestEpicId]);
  const initiativeStories = epics.flatMap((e) => e.userStories ?? []);
  const initiativeStoryTotal = initiativeStories.length;
  const initiativeStoryDone = initiativeStories.filter(
    (s) => s.status === "review" || s.status === "done",
  ).length;
  // Basis-aware progress: stories mode counts review tickets, days mode burns
  // down estimated effort. The summary text reflects whichever is active.
  const initiativeProgress = (() => {
    if (progressBasis === "stories") {
      const percent =
        initiativeStoryTotal > 0
          ? Math.round((initiativeStoryDone / initiativeStoryTotal) * 100)
          : 0;
      return {
        percent,
        summary: `${initiativeStoryDone}/${initiativeStoryTotal} stories review · ${percent}%`,
        aria:
          initiativeStoryTotal > 0
            ? `${initiativeStoryDone} of ${initiativeStoryTotal} stories review or done`
            : "No user stories",
      };
    }
    if (progressBasis === "epicEst") {
      // Sum Est. Epic Days across child epics; "delivered" = sum of review
      // child stories' estimatedDays. Same shape as the per-epic version
      // in `epicCompletionMeta` but rolled up across the initiative.
      const initiativeEpicEst = epics.reduce(
        (sum, e) => sum + (e.originalEstimateDays ?? 0),
        0,
      );
      let completedEffort = 0;
      for (const story of initiativeStories) {
        if (story.estimatedDays == null) continue;
        if (story.status === "review" || story.status === "done") {
          completedEffort += story.estimatedDays;
        }
      }
      const percent =
        initiativeEpicEst > 0
          ? Math.min(100, Math.round((completedEffort / initiativeEpicEst) * 100))
          : 0;
      return {
        percent,
        summary:
          initiativeEpicEst > 0
            ? `${completedEffort}d / ${initiativeEpicEst}d epic est. · ${percent}%`
            : "No epic estimates",
        aria:
          initiativeEpicEst > 0
            ? `${completedEffort} of ${initiativeEpicEst} epic-estimated days delivered`
            : "No epic estimates set",
      };
    }
    let totalEffort = 0;
    let remainingEffort = 0;
    for (const story of initiativeStories) {
      if (story.estimatedDays == null) continue;
      totalEffort += story.estimatedDays;
      if (story.status !== "review" && story.status !== "done") {
        remainingEffort += story.daysLeft ?? story.estimatedDays;
      }
    }
    const completedEffort = totalEffort - remainingEffort;
    const percent =
      totalEffort > 0 ? Math.round((completedEffort / totalEffort) * 100) : 0;
    return {
      percent,
      summary:
        totalEffort > 0
          ? `${completedEffort}d / ${totalEffort}d burned · ${percent}%`
          : "No estimated work",
      aria:
        totalEffort > 0
          ? `${completedEffort} of ${totalEffort} estimated days burned down`
          : "No estimated work",
    };
  })();
  const initiativeProgressPct = initiativeProgress.percent;
  const initiativeExecutionStatus = initiativeExecutionStatusMeta(initiative);
  const [epicTitle, setEpicTitle] = useState("");
  const [isAddingEpic, setIsAddingEpic] = useState(false);
  const [openEpicIds, setOpenEpicIds] = useState<Record<string, boolean>>({});
  const [hintEpicId, setHintEpicId] = useState<string | null>(null);

  useEffect(() => {
    const currentIds = new Set(initiative.epics?.map((e) => e.id) ?? []);
    const newId = [...currentIds].find((id) => !prevEpicIdsRef.current.has(id)) ?? null;
    prevEpicIdsRef.current = currentIds;
    if (!newId) return;
    setNewestEpicId(newId);
    setHintEpicId(newId);
    // Auto-open the new epic's accordion so the user can immediately add
    // stories underneath without an extra click.
    setOpenEpicIds((prev) => (prev[newId] ? prev : { ...prev, [newId]: true }));
    const t = setTimeout(() => setHintEpicId(null), 4200);
    return () => clearTimeout(t);
  }, [initiative.epics]);

  async function handleAddEpic() {
    const title = epicTitle.trim();
    if (!title) return;
    setIsAddingEpic(true);
    try {
      await onCreateEpicQuick(initiative.id, title);
      setEpicTitle("");
    } finally {
      setIsAddingEpic(false);
    }
  }

  return (
    <div
      ref={setDropRef}
      className={cn(
        "group/init-card relative rounded-md border border-slate-200/90 p-3 font-sans antialiased",
        isBacklogDropOver && "ring-2 ring-slate-300",
      )}
      style={{
        borderLeftColor: initiative.color,
        borderLeftWidth: 4,
        background: `#ffffff`,
      }}
    >
      {/* Hover-revealed Insights launcher for the initiative card —
       *  scope `group/init-card` so it triggers on the OUTER card hover
       *  only (not on the inner per-epic row hovers, which carry their
       *  own button). */}
      {onOpenInsights ? (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenInsights("initiative", initiative.id);
          }}
          aria-label={`Open insights for ${initiative.title}`}
          title="Open insights scoped to this initiative"
          className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-indigo-200 bg-white opacity-0 shadow-sm transition-opacity hover:bg-indigo-50 group-hover/init-card:opacity-100"
        >
          <img
            src="/dialog-insights-icon.png"
            alt=""
            aria-hidden
            className="size-3.5 select-none object-contain"
            draggable={false}
          />
        </button>
      ) : null}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="group/init">
            <div className="flex min-w-0 items-start gap-0.5">
              <button
                type="button"
                onClick={onToggle}
                className="inline-flex h-7 shrink-0 items-center rounded-sm text-slate-500 transition-colors hover:text-slate-700"
                aria-label={isOpen ? "Collapse initiative" : "Expand initiative"}
                aria-expanded={isOpen}
              >
                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 transition-transform",
                    isOpen && "rotate-90",
                  )}
                />
              </button>
              <div className="min-w-0 flex-1">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onEditInitiative(initiative)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEditInitiative(initiative); } }}
                  className="w-full cursor-pointer rounded-md px-0.5 text-left hover:bg-white/90"
                  aria-label={`Open initiative ${initiative.title}`}
                >
                  <div className="flex w-full min-w-0 items-center gap-1">
                    <div className="flex min-w-0 flex-1 items-center gap-1 pl-0">
                      <span className="inline-flex shrink-0 text-[16px] leading-none text-slate-800">
                        {/* Force the canonical initiative icon (Zap) in the list
                    panel — ignore the per-initiative custom icon here so the
                    middle panel reads as a uniform list of initiatives. The
                    custom icon (emoji) still shows on Gantt bars and forms. */}
                <InitiativePlanBarIcon icon={null} className="mr-0 text-slate-700 [&_svg]:text-blue-600" />
                      </span>
                      <p
                        className={cn(
                          "min-w-0 truncate rounded px-1 text-[18px] font-normal leading-7 tracking-tight text-slate-900",
                          // Yellow highlight when the live search query
                          // matches this initiative's title.
                          searchQuery && initiative.title.toLowerCase().includes(searchQuery) && "bg-yellow-100",
                        )}
                      >
                        {initiative.title}
                      </p>
                      {initiative.parentInitiativeId ? (
                        <span
                          className="inline-flex shrink-0 items-center rounded border border-indigo-200/80 bg-indigo-50 px-1 py-px text-[10px] font-semibold leading-tight text-indigo-700"
                          title={`Continuation of an initiative from ${initiative.year - 1}`}
                        >
                          ↩ {initiative.year - 1}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDeleteInitiative(initiative.id); }}
                      className="shrink-0 rounded p-1 text-slate-300 opacity-0 transition-all group-hover/init:opacity-100 hover:bg-red-50 hover:text-red-500"
                      title="Delete initiative"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  {initiative.description ? (
                    <p className="line-clamp-2 text-[13px] leading-5 text-slate-600">{initiative.description}</p>
                  ) : null}
                </div>
                <div className="mt-2 space-y-2 px-0.5">
                  <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                    <span className="min-w-0 shrink-0 text-left">
                      {epics.length === 0
                        ? "No epics"
                        : `${epics.length} epic${epics.length !== 1 ? "s" : ""}`}
                    </span>
                    <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
                      {showHealthChips ? (() => {
                        // Per-initiative health verdict — worst-of-
                        // children rollup, same helper the Hero's
                        // Health Distribution donut at Initiative
                        // scope uses. Null verdicts (initiative without
                        // scheduled epics, etc.) skip the chip.
                        //
                        // Gated by `showHealthChips` (donut-pick driven).
                        const v = computeInitiativeHealthVerdict(initiative, initiative.year ?? new Date().getFullYear(), progressBasis);
                        if (!v) return null;
                        return (
                          <HealthBadgeWithTextPopover
                            size="sm"
                            status={v.status}
                            tooltip={formatHealthTooltip(v.result)}
                            className={healthBadgeInitiativeRowOverride}
                          />
                        );
                      })() : null}
                      {initiative.status === "scheduled"
                        ? (() => {
                            const qs = quartersForInitiative(initiative);
                            if (qs.length === 0) return null;
                            return (
                              <span className={cn(statusBadgeBase, "bg-violet-100 text-violet-700")}>
                                {collapseQuarterRange(qs)}
                              </span>
                            );
                          })()
                        : null}
                      {initiative.status === "scheduled" ? (
                        <span className={cn(statusBadgeBase, "border border-emerald-200/90 bg-emerald-50 text-emerald-800")}>
                          Scheduled
                        </span>
                      ) : null}
                      {showStatusChips ? (
                        <span className={cn(statusBadgeBase, initiativeExecutionStatus.className)}>
                          {initiativeExecutionStatus.label}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {storyProgressDetailsVisible ? (
                    <div className={leftPanelProgressRowClass}>
                      <div
                        className={leftPanelProgressTrackClass}
                        role="progressbar"
                        aria-valuenow={initiativeProgressPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={initiativeProgress.aria}
                      >
                        <div
                          className="h-full rounded-[3px] bg-gradient-to-r from-emerald-400 to-violet-500 transition-[width] duration-300 ease-out"
                          style={{ width: `${initiativeProgressPct}%` }}
                        />
                      </div>
                      <span className={leftPanelProgressSummaryClass}>
                        {initiativeProgress.summary}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {isOpen ? (
            <div
              className={cn(
                "mt-3 rounded-lg bg-white px-2 py-2 font-sans antialiased",
                // Only show the slim top divider once there's at least
                // one epic — a freshly-created empty initiative now
                // skips both "No epics yet." and its top border.
                epics.length > 0 && "border-t border-border/80 pt-3",
              )}
            >
              <div className="ml-3 pl-2">
                {epics.length === 0 ? null : (
                  <div>
                    {epics.map((epic, epicIdx) => {
                      // Force-open when search matched a story inside this
                      // epic; otherwise honor the user's local toggle.
                      const isEpicOpen =
                        (forceOpenEpicIds?.has(epic.id) ?? false) || (openEpicIds[epic.id] ?? false);
                      const isLast = epicIdx === epics.length - 1;
                      return (
                        <div
                          key={epic.id}
                          className={cn(
                            "relative pl-6 transition-opacity duration-150",
                            isEpicDimmed?.(epic.id) && "opacity-30 saturate-50 hover:opacity-60",
                          )}
                        >
                          <span className="absolute left-0 top-0 w-px bg-border/70" style={{ height: isLast ? "22px" : "100%" }} />
                          <span className="absolute left-0 top-[22px] h-px w-4 -translate-y-px bg-border/70" />
                          <InitiativeTreeEpicRow
                            epic={epic}
                            initiative={initiative}
                            isEpicOpen={isEpicOpen}
                            searchQuery={searchQuery}
                            showTeamChips={showTeamChips}
                            showHealthChips={showHealthChips}
                            showStatusChips={showStatusChips}
                            onOpenInsights={onOpenInsights}
                            showDragHint={hintEpicId === epic.id}
                            onToggleEpic={() =>
                              setOpenEpicIds((prev) => {
                                const next = !(prev[epic.id] ?? false);
                                queueMicrotask(() => onEpicAccordionChange?.(epic.id, next));
                                return {
                                  ...prev,
                                  [epic.id]: next,
                                };
                              })
                            }
                            planContextMonth={planContextMonth}
                            hideScheduledIcon={inMonthView || isSprintModeActive}
                            epicPlanDragEnabled={epicPlanDragEnabled}
                            isCapacityMode={isCapacityPlanningMode}
                            onOpenEpic={onOpenEpic}
                            onOpenStory={onOpenStory}
                            onCreateStoryQuick={onCreateStoryQuick}
                            storyProgressDetailsVisible={storyProgressDetailsVisible}
                            progressBasis={progressBasis}
                            workspaceDirectoryUsers={workspaceDirectoryUsers}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="mt-2.5 border-t border-border/50 pt-2.5">
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-gradient-to-r from-slate-50/80 to-white px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ring-1 ring-slate-200/40">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-600/10 text-slate-600 ring-1 ring-slate-600/10"
                      aria-hidden
                    >
                      <Folder className="size-3" strokeWidth={2} />
                    </span>
                    <input
                      type="text"
                      name={`init-${initiative.id}-quick-item`}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      inputMode="text"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-bwignore="true"
                      data-form-type="other"
                      data-protonpass-ignore="true"
                      value={epicTitle}
                      onChange={(event) => setEpicTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleAddEpic();
                        }
                      }}
                      placeholder="New epic title…"
                      className="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
                      aria-label="New epic title"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 shrink-0 gap-1 bg-indigo-600 px-2 text-[12px] font-semibold text-white shadow-sm hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-45"
                      disabled={isAddingEpic || epicTitle.trim().length === 0}
                      onClick={() => void handleAddEpic()}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SprintEpicCard({
  epic,
  initiative,
  epicPlanDragEnabled,
  storyDragEnabled,
  activeYearSprint,
  onEpicAccordionChange,
  onOpenEpic,
  onOpenStory,
  onDeleteEpic,
  onCreateStoryQuick,
  backlogDropSlot,
  planContextMonth,
  storyProgressDetailsVisible,
  progressBasis,
  isOpenControlled,
  onToggleControlled,
  showDragHint = false,
  isCapacityMode = false,
  workspaceDirectoryUsers = [],
  showTeamChips = false,
  showStatusChips = false,
  showHealthChips = false,
  onOpenInsights,
}: {
  epic: EpicItem;
  initiative: InitiativeItem;
  epicPlanDragEnabled: boolean;
  storyDragEnabled: boolean;
  activeYearSprint: number | null;
  onEpicAccordionChange?: (epicId: string, isOpen: boolean) => void;
  onOpenEpic: (epic: EpicItem, initiative: InitiativeItem) => void;
  onOpenStory: (storyId: string) => void;
  onDeleteEpic: (epicId: string) => void;
  onCreateStoryQuick: (epicId: string, title: string) => Promise<void>;
  backlogDropSlot?: { month: number; index: number };
  planContextMonth: number | null;
  hideScheduledIcon?: boolean;
  storyProgressDetailsVisible: boolean;
  progressBasis: "days" | "stories" | "epicEst";
  isOpenControlled?: boolean;
  onToggleControlled?: () => void;
  showDragHint?: boolean;
  isCapacityMode?: boolean;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  /** Gated by the Hero KPI strip "Teams" tile — when `false`, the epic's
   *  delivery-team chip is suppressed from the chip cluster. */
  showTeamChips?: boolean;
  /** Gated by the Hero "Work Progress" donut — when `false`, the epic's
   *  execution-status chip (In progress / Done / etc.) is hidden. */
  showStatusChips?: boolean;
  /** Gated by the panel's Health filter menu — when `true`, the epic's
   *  health-verdict chip (On Track / Watch / At Risk / Overdue / Done)
   *  appears in the chip cluster. Mirrors the `EpicListItem` pattern so
   *  picking a verdict in the menu surfaces the matching chip on every
   *  card returned by the filter. */
  showHealthChips?: boolean;
  /** Hover-revealed Insights icon at the card's top-right; click fires
   *  `("epic", epic.id)` so the parent can pre-scope the Insights tab. */
  onOpenInsights?: (kind: "epic" | "initiative", id: string) => void;
}) {
  const { active } = useDndContext();
  /** Gantt bars use `timeline-epic:`; those drops should use thin `EpicBacklogDropSlot` targets or unplan strip, not the large card hit area (avoids accidental unplan). */
  const isTimelineEpicDragActive = active != null && String(active.id).startsWith("timeline-epic:");
  const epicTeamId = normalizedEpicTeamId(epic);
  const epicTeamChip = epicTeamId ? epicDeliveryTeamAssignmentChip(epicTeamId) : null;
  // Treat the epic as "already on the Gantt" whenever it has ANY
  // plan range set (or a planSprint). The previous version only
  // counted plans that covered the currently-focused month, so an
  // epic scheduled for April still showed a drag handle in the May
  // view — confusing now that the middle panel shows every epic.
  const isEpicScheduledOnGantt =
    epic.planSprint != null
    || (epic.planStartMonth != null && epic.planEndMonth != null);
  const epicDragData = {
    kind: "epic-plan-compact",
    title: epic.title,
    color: initiative.color,
    icon: epic.icon,
  } satisfies EpicPlanCompactDragData;
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: epicListDraggableId(epic.id),
    disabled: isCapacityMode ? Boolean(epicTeamId) : (!epicPlanDragEnabled || isEpicScheduledOnGantt),
    data: epicDragData,
  });
  const { setNodeRef: setDropRef, isOver: isBacklogDropOver } = useDroppable({
    id: backlogDropSlot ? epicBacklogSlotDropId(backlogDropSlot.month, backlogDropSlot.index) : `epic-card:${epic.id}`,
    disabled: !backlogDropSlot || isTimelineEpicDragActive,
  });
  const [isOpenLocal, setIsOpenLocal] = useState(false);
  const [storyTitle, setStoryTitle] = useState("");
  const [isAddingStory, setIsAddingStory] = useState(false);
  const [hintStoryId, setHintStoryId] = useState<string | null>(null);
  const [newestStoryId, setNewestStoryId] = useState<string | null>(null);
  const allStories = epic.userStories ?? [];
  const prevStoryIdsRef = useRef<Set<string>>(new Set(allStories.map((s) => s.id)));
  const stories = [...allStories].sort((a, b) => {
    if (a.id === newestStoryId) return 1;
    if (b.id === newestStoryId) return -1;
    return a.title.localeCompare(b.title);
  });
  const epicPlanStatus = epicPlanningStatusMeta(epic);
  const epicExecutionStatus = epicExecutionStatusMeta(epic);
  const completion = epicCompletionMeta(epic, progressBasis);
  const isOpen = isOpenControlled ?? isOpenLocal;
  function handleToggle() {
    if (onToggleControlled) {
      onToggleControlled();
      queueMicrotask(() => onEpicAccordionChange?.(epic.id, !(isOpenControlled ?? false)));
    } else {
      setIsOpenLocal((prev) => {
        const next = !prev;
        queueMicrotask(() => onEpicAccordionChange?.(epic.id, next));
        return next;
      });
    }
  }

  useEffect(() => {
    const currentIds = new Set(stories.map((s) => s.id));
    const newId = [...currentIds].find((id) => !prevStoryIdsRef.current.has(id)) ?? null;
    prevStoryIdsRef.current = currentIds;
    if (!newId) return;
    setHintStoryId(newId);
    setNewestStoryId(newId);
    const t = setTimeout(() => setHintStoryId(null), 4200);
    return () => clearTimeout(t);
  }, [stories]);

  async function handleAddStory() {
    const title = storyTitle.trim();
    if (!title) return;
    setIsAddingStory(true);
    try {
      await onCreateStoryQuick(epic.id, title);
      setStoryTitle("");
    } finally {
      setIsAddingStory(false);
    }
  }

  const stripeColor = epic.color?.trim() ? epic.color : initiative.color;

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={cn(
        "group relative rounded-md border border-slate-200/90 bg-white p-3 font-sans antialiased transition-colors hover:bg-sky-50/70",
        isDragging && "opacity-60",
        isBacklogDropOver && "ring-2 ring-slate-300",
      )}
      style={{
        borderLeftColor: stripeColor,
        borderLeftWidth: 4,
        transform: !isDragging && transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 60 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      {/* Hover-revealed Insights launcher — same icon + behavior as the
       *  epic dialog's "Insights" header button. Click switches the
       *  planner to the Insights tab pre-scoped to this epic via the
       *  parent's `onOpenInsights`. The card root has `group relative`,
       *  so `group-hover:opacity-100` fades the button in on row hover
       *  and `z-10` keeps it above the title text it floats over. */}
      {onOpenInsights ? (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenInsights("epic", epic.id);
          }}
          aria-label={`Open insights for ${epic.title}`}
          title="Open insights scoped to this epic"
          className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-indigo-200 bg-white opacity-0 shadow-sm transition-opacity hover:bg-indigo-50 group-hover:opacity-100"
        >
          <img
            src="/dialog-insights-icon.png"
            alt=""
            aria-hidden
            className="size-3.5 select-none object-contain"
            draggable={false}
          />
        </button>
      ) : null}
      <div className="flex min-w-0 items-start gap-0.5">
        <button
          type="button"
          onClick={handleToggle}
          // `h-6` matches the epic title's `leading-6` so the chevron,
          // drag handle, and epic icon all sit on the same baseline as
          // the title's first line under `items-start`. (Title text was
          // resized down from 18px/leading-7 to 16px/leading-6 in the
          // earlier hierarchy pass; these chrome heights followed.)
          className="inline-flex h-6 shrink-0 items-center rounded-sm text-slate-500 transition-colors hover:text-slate-700"
          aria-label={isOpen ? "Collapse epic" : "Expand epic"}
          aria-expanded={isOpen}
        >
          <ChevronRight
            className={cn(
              "size-4 shrink-0 transition-transform",
              isOpen && "rotate-90",
            )}
          />
        </button>
        {(isCapacityMode ? !epicTeamId : (!isEpicScheduledOnGantt && epicPlanDragEnabled)) ? (
          <button
            type="button"
            className="relative inline-flex h-6 shrink-0 cursor-grab items-center rounded-md p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag epic"
            {...listeners}
            {...attributes}
          >
            <DragHandleIcon size="sm" />
            {showDragHint ? (
              <DragToGanttArrowIcon className="animate-epic-drag-hint-arrow pointer-events-none absolute left-0 top-1/2 size-7 text-indigo-500" />
            ) : null}
          </button>
        ) : null}
        {/* Epic-row icon — `size-5` makes it visually proportionate to the
         *  16px epic title to its right (the previous `size-3.5` looked
         *  small/floating after the title size reduction). Container height
         *  matches the title's `leading-6` line box so the icon sits
         *  centered on the epic-name row, not floating between the title
         *  and the secondary initiative line below. */}
        <span className="mr-1.5 inline-flex h-6 shrink-0 items-center" aria-hidden>
          <EpicPlanBarIcon icon={epic.icon} className="mr-0 [&_svg]:size-5 [&_svg]:text-sky-500" />
        </span>
        <div className="min-w-0 flex-1 text-left">
          <button
            type="button"
            onClick={() => onOpenEpic(epic, initiative)}
            className="w-full rounded-md pl-0.5 pr-0 text-left font-normal hover:bg-slate-50"
            aria-label={`Open epic ${epic.title}`}
          >
            <div className="flex w-full min-w-0 items-center gap-0">
              <div className="flex min-w-0 flex-1 items-center gap-0 pl-0">
                <p className="min-w-0 truncate text-[16px] font-normal leading-6 tracking-tight text-slate-900">
                  {epic.title}
                </p>
              </div>
            </div>
            <p className="truncate text-[13px] leading-5 text-slate-600">{initiative.title}</p>
          </button>
              <div className="mt-2 space-y-2 px-0.5">
                <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                  <span className="min-w-0 shrink-0 text-left">
                    {completion.total === 0
                      ? "No stories yet"
                      : `${completion.total} user stor${completion.total === 1 ? "y" : "ies"}`}
                  </span>
                  {/* Epic-view chips (team / quarter / status). Slightly
                   *  larger than the `epicBadgeBase` default — when epics
                   *  are the top-level rows in the middle panel they need
                   *  to match the primary visual weight. */}
                  <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
                    {showHealthChips ? (() => {
                      // Per-epic health verdict — same helper the Gantt
                      // bars + Hero Health Distribution donut + the
                      // EpicListItem panel mode use, so the chip on the
                      // card reads identically wherever the planner sees
                      // this epic. Null verdicts (no plan window / no
                      // estimate) skip the chip entirely.
                      const v = computeEpicHealthVerdict(
                        epic,
                        initiative.year ?? new Date().getFullYear(),
                        progressBasis,
                      );
                      if (!v) return null;
                      return (
                        <HealthBadgeWithTextPopover
                          size="sm"
                          status={v.status}
                          tooltip={formatHealthTooltip(v.result)}
                          className={healthBadgeEpicRowOverride}
                        />
                      );
                    })() : null}
                    {showTeamChips && epicTeamChip ? (
                      <span className={cn(epicTeamChip.className, epicBadgeBase, "text-[12.5px] max-w-[10rem] gap-1")}>
                        <TeamAvatar slug={epicTeamChip.slug} sizePx={10} fallback={<Users className="size-2.5 shrink-0" aria-hidden />} />
                        {epicTeamChip.label}
                      </span>
                    ) : null}
                    {epicPlanStatus.label === "Unscheduled" ? (
                      <span className={cn(epicBadgeBase, "text-[12.5px]", epicPlanStatus.className)}>
                        {epicPlanStatus.label}
                      </span>
                    ) : (() => {
                      const qs = quartersFromMonthRange(epic.planStartMonth, epic.planEndMonth);
                      if (qs.length === 0) return null;
                      return (
                        <span className={cn(epicBadgeBase, "text-[12.5px]", epicPlanStatus.className)}>
                          {collapseQuarterRange(qs)}
                        </span>
                      );
                    })()}
                    {showStatusChips ? (
                      <span className={cn(epicBadgeBase, "text-[12.5px]", epicExecutionStatus.className)}>
                        {epicExecutionStatus.label}
                      </span>
                    ) : null}
                  </div>
                </div>
                {storyProgressDetailsVisible ? (
                  <div className={leftPanelProgressRowClass}>
                    <div
                      className={leftPanelProgressTrackClass}
                      role="progressbar"
                      aria-valuenow={completion.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={completion.progressAria}
                    >
                      <div
                        className="h-full rounded-[3px] bg-gradient-to-r from-emerald-400 to-violet-500 transition-[width] duration-300 ease-out"
                        style={{ width: `${completion.percent}%` }}
                      />
                    </div>
                    <span className={leftPanelProgressSummaryClass}>
                      {completion.progressSummary}
                    </span>
                  </div>
                ) : null}
          </div>
        </div>
      </div>
      {isOpen ? (
        <div className="mt-2 ml-8 space-y-2 font-sans">
          {stories.map((story, storyIdx) => {
            const isLast = storyIdx === stories.length - 1;
            const meta = storyStatusMeta(story, planContextMonth);
            const { sprintLabel, statusLabel, statusClassName, showStatusBadge } = meta;
            const assigneeName = storyAssigneeDisplayName(story);
            const resolvedStorySprint =
              planContextMonth == null ? story.sprint : resolveStoryYearSprint(story, planContextMonth);
            const isScheduledInActiveSprint =
              activeYearSprint != null &&
              resolvedStorySprint != null &&
              resolvedStorySprint === activeYearSprint;
              const a11y = [story.title, assigneeName, statusLabel, sprintLabel].filter(Boolean).join(", ");
              const isAssigned = assigneeName != null;
              return (
                <div key={story.id} className="relative pl-6">
                  <span className="absolute left-0 top-0 w-px bg-border/70" style={{ height: isLast ? "14px" : "100%" }} />
                  <span className="absolute left-0 top-[14px] h-px w-4 -translate-y-px bg-border/70" />
                  <div
                    className="group/story flex w-full flex-col rounded-md pr-0.5 transition-colors hover:bg-muted/40"
                  >
                  <div className="flex min-h-[28px] w-full items-center gap-0.5">
                    {storyDragEnabled ? (
                      isCapacityMode
                        ? (!isAssigned ? <StoryDragHandle storyId={story.id} /> : null)
                        : (!isScheduledInActiveSprint ? <StoryDragHandle storyId={story.id} /> : null)
                    ) : null}
                    <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                      <UserStoryIcon />
                      {hintStoryId === story.id && storyDragEnabled ? (
                        <DragToKanbanArrowIcon className="animate-epic-drag-hint-arrow pointer-events-none absolute left-0 top-1/2 size-7 text-indigo-500" />
                      ) : null}
                    </span>
                    <MiddlePanelStoryTitleButton
                      storyTitle={story.title}
                      ariaLabel={a11y}
                      onOpen={() => onOpenStory(story.id)}
                      className="rounded-md px-0.5 text-left text-[15px] font-normal text-slate-700 hover:text-foreground"
                    />
                  </div>
                  {assigneeName || sprintLabel || showStatusBadge ? (
                    <div className="mt-1.5 flex w-full flex-wrap items-center justify-end gap-1 pl-6">
                      {assigneeName ? (() => {
                        const resolved = resolveAssigneeAvatar(assigneeName, workspaceDirectoryUsers);
                        return (
                          <span
                            className="inline-flex max-w-[7.5rem] shrink-0 items-center gap-1 truncate border border-border/60 bg-background py-0.5 pl-0.5 pr-1 text-[11px] font-medium text-slate-600"
                            title={assigneeName}
                          >
                            {resolved.image ? (
                              <UserAvatar name={resolved.name} image={resolved.image} size={16} />
                            ) : (
                              <User className="size-3 shrink-0 text-slate-500" aria-hidden />
                            )}
                            <span className="min-w-0 truncate">{formatAssigneeShortLabel(assigneeName)}</span>
                          </span>
                        );
                      })() : null}
                      {sprintLabel ? (
                        <span className="max-w-[7rem] truncate rounded-sm border border-border/60 bg-background px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                          {sprintLabel}
                        </span>
                      ) : null}
                      {showStatusBadge ? (
                        <span className={cn("shrink-0 tabular-nums", statusClassName)}>{statusLabel}</span>
                      ) : null}
                    </div>
                  ) : null}
                  </div>
                </div>
              );
          })}
          <div className="mt-1 flex items-center gap-1">
            <input
              type="text"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              data-form-type="other"
              data-protonpass-ignore="true"
              data-dashlane-ignored="true"
              data-keeper-ignored="true"
              value={storyTitle}
              onChange={(event) => setStoryTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleAddStory();
                }
              }}
              placeholder="Add user story"
              className="h-7 w-full rounded-md bg-white px-2 text-[13px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
            />
            <Button
              size="icon-xs"
              variant="outline"
              disabled={isAddingStory || storyTitle.trim().length === 0}
              onClick={() => void handleAddStory()}
            >
              <Plus />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BacklogDropSlot({ index }: { index: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id: backlogSlotDropId(index),
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "my-1 h-1 w-full rounded bg-transparent transition",
        isOver && "h-2 bg-primary/35",
      )}
      aria-hidden
    />
  );
}

function EpicBacklogDropSlot({
  month,
  index,
  disabled = false,
}: {
  month: number;
  index: number;
  disabled?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: epicBacklogSlotDropId(month, index),
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "my-0.5 min-h-2 w-full rounded bg-transparent transition",
        isOver && "min-h-3 bg-slate-300/90",
      )}
      aria-hidden
    />
  );
}

export function InitiativeListPanel({
  initiatives,
  activeMonth,
  storyProgressDetailsVisible,
  progressBasis = "days",
  useEpicPlanLeftPanel,
  activeYearSprint,
  storyDragEnabled,
  isSprintModeActive,
  onCreateInitiative,
  onCreateEpic,
  onCreateInitiativeQuick,
  onEditInitiative,
  onOpenEpic,
  onOpenStory,
  onDeleteEpic,
  onDeleteInitiative,
  onCreateEpicQuick,
  onCreateStoryQuick,
  epicBacklogOrderByMonth,
  monthEpicTeamFilterId = null,
  onSprintBoardTeamFilterSync,
  epicPanelQuarterMonths = null,
  epicPanelQuarterLabel = null,
  panelQuarterQuickFilter = null,
  panelQuarterFilterLocked = false,
  onInitiativeAccordionChange,
  onEpicAccordionChange,
  panelStatusQuickFilter = null,
  prefillSearchQuery = null,
  onHidePanel,
  workspaceDirectoryUsers = [],
  isOnEpicGanttTab = false,
  isCapacityPlanningMode = false,
  planYear,
  healthFilter,
  onHealthFilterChange,
  heroScope,
  showTeamChips = false,
  onOpenInsights,
  externalStatusFilter,
  externalTeamFilter,
  onUserPickedFilter,
  onPanelStatusFilterDerivedChange,
  onPanelQuarterFilterDerivedChange,
  onPanelTeamFilterActiveChange,
  onPanelTeamFilterDerivedChange,
  onProgressBasisChange,
  highlightedEpicIds = null,
}: InitiativeListPanelProps) {
  // Cross-mode "highlight these epics" filter — same semantics as the
  // identical prop on TimelineGrid. We compute the matching helpers once
  // at the top of the component so the deep-nested epic rows can just
  // ask `isEpicDimmed(epic.id)` without re-deriving each render.
  const isHighlightActive =
    highlightedEpicIds != null && highlightedEpicIds.size > 0;
  const isEpicDimmed = (epicId: string): boolean =>
    isHighlightActive && !highlightedEpicIds!.has(epicId);
  const isInitiativeDimmed = (initiative: InitiativeItem): boolean => {
    if (!isHighlightActive) return false;
    // An initiative stays full-strength if it owns any highlighted epic.
    // Avoid `.some(...)` over the empty case (initiative with no epics)
    // since that would always dim — instead treat childless initiatives
    // as dimmed under an active filter.
    const epics = initiative.epics ?? [];
    if (epics.length === 0) return true;
    return !epics.some((e) => highlightedEpicIds!.has(e.id));
  };
  // `isInitiativeDimmed` is reserved for a future iteration that fades the
  // initiative card chrome itself (header, progress bar). Phase 2(d) ships
  // only the epic-row fade since that's where the planner's eye lands.
  void isInitiativeDimmed;
  // Health + execution-status chip visibility on initiative / epic rows
  // is gated by the matching Hero donut state, mirroring the existing
  // Teams-tile pattern.
  //
  // Health chips reveal on EITHER trigger:
  //   (a) The Gantt chip toolbar's "Health" button — opens the
  //       Roadmap Health popover and flips `showRoadmapProgress` (mirrored
  //       here as `storyProgressDetailsVisible`). Treat that toggle as
  //       "the planner is thinking about health right now" and surface
  //       the chips on every initiative + epic row.
  //   (b) A Health Distribution donut slice pick — non-empty
  //       `healthFilter` set means the planner already chose a specific
  //       verdict to focus on; the chips give per-row context.
  // Execution-status chips ONLY reveal on a Work Progress donut pick
  // (non-empty `externalStatusFilter`) — there is no equivalent "Status"
  // button on the toolbar, so a slice pick is the single trigger.
  //
  // Plan chips (Scheduled / Unscheduled / Q1-Q2) are NOT gated — they
  // describe schedule, not workflow status, and are independent of the
  // hero state.
  const showHealthChips =
    (healthFilter?.size ?? 0) > 0 || storyProgressDetailsVisible;
  const showStatusChips = (externalStatusFilter?.size ?? 0) > 0;
  const { active } = useDndContext();
  const isTimelineEpicDragActive = active != null && String(active.id).startsWith("timeline-epic:");
  /** Gantt epic bars must stay on the timeline; do not accept drops on the unplan / month backlog strip. */
  const blockEpicBacklogSlotsForTimelineDrag = isTimelineEpicDragActive;

  const { setNodeRef: setBacklogDropRef } = useDroppable({
    id: "initiatives:backlog-drop",
  });
  const { setNodeRef: setEpicUnplanDropRef, isOver: isEpicUnplanDropOver } = useDroppable({
    id: EPICS_UNPLAN_DROP_ID,
    disabled: isTimelineEpicDragActive,
  });

  const epicPlanPanelMode =
    useEpicPlanLeftPanel === undefined ? activeMonth != null : useEpicPlanLeftPanel;
  const epicListScopeMonth = epicPlanPanelMode ? activeMonth : null;
  const epicPlanDragEnabled = !isSprintModeActive || isOnEpicGanttTab || isCapacityPlanningMode;

  const [newestEpicId, setNewestEpicId] = useState<string | null>(null);
  const prevAllEpicIdsRef = useRef<Set<string>>(
    new Set(initiatives.flatMap((i) => (i.epics ?? []).map((e) => e.id))),
  );
  // Watch for a newly-created epic AND the initiative it lives under, so we
  // can auto-open both their accordions on the next render. Without this,
  // the inline-add flow saves the row but leaves it collapsed, hiding the
  // composer the user would use to add stories.
  const newEpicAutoOpenRef = useRef<{ epicId: string; initiativeId: string } | null>(null);
  useEffect(() => {
    const currentIds = new Set(initiatives.flatMap((i) => (i.epics ?? []).map((e) => e.id)));
    const newId = [...currentIds].find((id) => !prevAllEpicIdsRef.current.has(id)) ?? null;
    prevAllEpicIdsRef.current = currentIds;
    if (newId) {
      setNewestEpicId(newId);
      const parentInit = initiatives.find((i) => (i.epics ?? []).some((e) => e.id === newId));
      if (parentInit) {
        newEpicAutoOpenRef.current = { epicId: newId, initiativeId: parentInit.id };
      }
    }
  }, [initiatives]);

  const [openInitiativeIds, setOpenInitiativeIds] = useState<Record<string, boolean>>({});
  // Auto-open the parent initiative card when a brand-new epic appears under
  // it (top-level "+ Epic" can pick any initiative, so its card might be
  // collapsed). The per-initiative card opens its own epic accordion via its
  // local newEpicAutoOpenRef — wired via the same ref below.
  useEffect(() => {
    const pending = newEpicAutoOpenRef.current;
    if (!pending) return;
    setOpenInitiativeIds((prev) => (prev[pending.initiativeId] ? prev : { ...prev, [pending.initiativeId]: true }));
  }, [initiatives]);
  // Track new initiatives and auto-open their accordion on next render so
  // the user can immediately add epics underneath without an extra click.
  // We also remember the id so the list sort can bubble it to the top
  // regardless of the default `(status, timelineRow, title)` order — the
  // user just made it, they should see it at the top of the list.
  const [newestInitiativeId, setNewestInitiativeId] = useState<string | null>(null);
  const prevInitiativeIdsRef = useRef<Set<string>>(new Set(initiatives.map((i) => i.id)));
  useEffect(() => {
    const currentIds = new Set(initiatives.map((i) => i.id));
    const newId = [...currentIds].find((id) => !prevInitiativeIdsRef.current.has(id)) ?? null;
    prevInitiativeIdsRef.current = currentIds;
    if (newId) {
      setNewestInitiativeId(newId);
      setOpenInitiativeIds((prev) => (prev[newId] ? prev : { ...prev, [newId]: true }));
    }
  }, [initiatives]);
  const [monthEpicOpenIds, setMonthEpicOpenIds] = useState<Record<string, boolean>>({});
  const [initiativeSearch, setInitiativeSearch] = useState("");
  const [initiativeSearchFocused, setInitiativeSearchFocused] = useState(false);
  const [epicSearch, setEpicSearch] = useState("");
  const [epicSearchFocused, setEpicSearchFocused] = useState(false);
  const [inlineNewInitiativeOpen, setInlineNewInitiativeOpen] = useState(false);
  const [inlineNewInitiativeTitle, setInlineNewInitiativeTitle] = useState("");
  const [inlineNewInitiativeSubmitting, setInlineNewInitiativeSubmitting] = useState(false);
  const [inlineNewEpicOpen, setInlineNewEpicOpen] = useState(false);
  const [inlineNewEpicTitle, setInlineNewEpicTitle] = useState("");
  const [inlineNewEpicInitiativeId, setInlineNewEpicInitiativeId] = useState("");
  const [inlineNewEpicSubmitting, setInlineNewEpicSubmitting] = useState(false);
  // Mini "+ New initiative" composer that sits INSIDE the New Epic
  // composer. Lets the planner create an initiative without leaving the
  // epic-create flow: clicking the "+ New" button next to the Initiative
  // field reveals a name input below; submitting creates the initiative
  // (via the same `onCreateInitiativeQuick` the picker uses) and
  // auto-selects it as the epic's parent in `inlineNewEpicInitiativeId`.
  const [epicComposerNewInitOpen, setEpicComposerNewInitOpen] = useState(false);
  const [epicComposerNewInitTitle, setEpicComposerNewInitTitle] = useState("");
  const [epicComposerNewInitSubmitting, setEpicComposerNewInitSubmitting] = useState(false);
  const epicComposerNewInitInputRef = useRef<HTMLInputElement>(null);
  const inlineInitiativeInputRef = useRef<HTMLInputElement>(null);
  const inlineEpicInputRef = useRef<HTMLInputElement>(null);
  const [panelQuarterFilters, setPanelQuarterFilters] = useState<Array<"all" | "Q1" | "Q2" | "Q3" | "Q4">>(["all"]);
  const [panelTeamFilterIds, setPanelTeamFilterIds] = useState<string[]>(["all"]);
  const [panelStatusFilters, setPanelStatusFilters] = useState<Array<
    "all" | "Scheduled" | "Unscheduled" | "To Do" | "In Progress" | "Review / Testing" | "Done"
  >>(["all"]);

  const firstScheduledInitiativeForActiveMonth = useMemo(() => {
    if (activeMonth == null) return undefined;
    return initiatives.find(
      (i) =>
        i.status === InitiativeStatus.scheduled &&
        i.startMonth != null &&
        i.endMonth != null &&
        i.startMonth <= activeMonth &&
        i.endMonth >= activeMonth,
    );
  }, [initiatives, activeMonth]);

  useEffect(() => {
    setInlineNewInitiativeOpen(false);
    setInlineNewEpicOpen(false);
    setInlineNewInitiativeTitle("");
    setInlineNewEpicTitle("");
    setInlineNewEpicInitiativeId("");
    setEpicComposerNewInitOpen(false);
    setEpicComposerNewInitTitle("");
  }, [epicPlanPanelMode]);

  useEffect(() => {
    if (inlineNewInitiativeOpen) inlineInitiativeInputRef.current?.focus();
  }, [inlineNewInitiativeOpen]);

  useEffect(() => {
    if (inlineNewEpicOpen) inlineEpicInputRef.current?.focus();
  }, [inlineNewEpicOpen]);

  // Auto-focus the mini new-initiative input the moment its disclosure
  // expands so the planner can start typing immediately.
  useEffect(() => {
    if (epicComposerNewInitOpen) epicComposerNewInitInputRef.current?.focus();
  }, [epicComposerNewInitOpen]);

  // When the outer New Epic composer closes (Cancel / Add / Escape),
  // also collapse the mini new-initiative composer so it doesn't ghost
  // back open the next time the planner opens the epic flow.
  useEffect(() => {
    if (!inlineNewEpicOpen) {
      setEpicComposerNewInitOpen(false);
      setEpicComposerNewInitTitle("");
    }
  }, [inlineNewEpicOpen]);

  const quarterFilterOptions: IconFilterOption<"all" | "Q1" | "Q2" | "Q3" | "Q4">[] = [
    { value: "all", label: "Quarters", icon: <CalendarDays className="size-3.5 text-violet-400" /> },
    { value: "Q1", label: "Q1", icon: <QuarterProgressGlyph steps={1} /> },
    { value: "Q2", label: "Q2", icon: <QuarterProgressGlyph steps={2} /> },
    { value: "Q3", label: "Q3", icon: <QuarterProgressGlyph steps={3} /> },
    { value: "Q4", label: "Q4", icon: <QuarterProgressGlyph steps={4} /> },
  ];
  const monthFilterOptions: IconFilterOption<"current">[] = [
    {
      value: "current",
      label: activeMonth != null ? MONTHS[activeMonth - 1] ?? `Month ${activeMonth}` : "Current month",
      icon: <CalendarDays className="size-3.5 text-slate-500" />,
    },
  ];
  const teamFilterOptions: IconFilterOption<string>[] = useMemo(() => {
    const customIds = new Map<string, string>();
    for (const u of workspaceDirectoryUsers) {
      const id = normalizeWorkspaceUserTeam(u.team);
      if (!id || MONTH_TEAM_IDS.includes(id)) continue;
      if (!customIds.has(id)) customIds.set(id, teamLabelForWorkspaceUser(id));
    }
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        const raw = epic.team?.trim();
        if (!raw) continue;
        const id = normalizeWorkspaceUserTeam(raw);
        if (!id || MONTH_TEAM_IDS.includes(id)) continue;
        if (!customIds.has(id)) customIds.set(id, teamLabelForWorkspaceUser(id));
      }
    }
    const customOpts = [...customIds.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }))
      .map(([value, label]) => ({
        value,
        label,
        icon: (
          <TeamAvatar
            slug={value}
            sizePx={14}
            fallback={<span className="inline-block size-2.5 shrink-0 rounded-full bg-slate-400" aria-hidden />}
          />
        ),
      }));
    return [
      { value: "all", label: "All Teams", icon: <Users className="size-3.5 text-sky-400" /> },
      ...MONTH_TEAM_COLUMNS.map((team) => ({
        value: team.id,
        label: team.label,
        icon: (
          <TeamAvatar
            slug={team.id}
            sizePx={14}
            fallback={
              <span
                className={cn(
                  "inline-block size-2.5 rounded-full",
                  team.id === "platform" && "bg-sky-500",
                  team.id === "experience" && "bg-violet-500",
                  team.id === "data" && "bg-amber-500",
                  team.id === "mobile" && "bg-emerald-500",
                  team.id === "growth" && "bg-rose-500",
                )}
              />
            }
          />
        ),
      })),
      ...customOpts,
    ];
  }, [workspaceDirectoryUsers, initiatives]);
  /**
   * Execution-status filter only. Health verdicts moved to a dedicated
   * popover button (HealthFilterMenu) next to the eraser, so the planner
   * picks lanes separately and we don't have to muddle two unrelated
   * concerns into one dropdown.
   */
  type StatusFilterValue =
    | "all"
    | "Scheduled"
    | "Unscheduled"
    | "To Do"
    | "In Progress"
    | "Review / Testing"
    | "Done";
  const statusFilterOptions: IconFilterOption<StatusFilterValue>[] = [
    { value: "all", label: "All Statuses", icon: <ListFilter className="size-3.5 text-emerald-400" /> },
    { value: "Scheduled", label: "Scheduled", icon: <CalendarDays className="size-3.5 text-slate-500" /> },
    { value: "Unscheduled", label: "Unscheduled", icon: <Circle className="size-3.5 text-slate-500" /> },
    { value: "To Do", label: "To Do", icon: <ListTodo className="size-3.5 text-slate-500" /> },
    { value: "In Progress", label: "In Progress", icon: <PlayCircle className="size-3.5 text-slate-500" /> },
    { value: "Review / Testing", label: "Review / Testing", icon: <CheckCheck className="size-3.5 text-slate-500" /> },
    { value: "Done", label: "Done", icon: <CheckCircle2 className="size-3.5 text-slate-500" /> },
  ];
  const handleStatusToggle = (value: StatusFilterValue) => {
    // Picking any execution status drops the health filter — the Gantt can't
    // render both pill rows at once, so we always commit to one lane.
    if (value !== "all" && healthFilter && healthFilter.size > 0) {
      onHealthFilterChange?.(new Set());
    }
    setPanelStatusFilters((prev) => toggleMultiFilter(prev, value, "all"));
    onUserPickedFilter?.();
  };
  /**
   * Health-verdict map per epic. Same `computeProgress` math the Gantt /
   * Roadmap Health popover use, with the panel's `planYear` + `progressBasis`
   * so the chip filter matches what the popover already displayed. Epics
   * without a plan window are absent from the map (treated as "no verdict"
   * — they pass through any health filter).
   */
  const healthByEpicId = useMemo(() => {
    const map = new Map<string, HealthStatus>();
    if (planYear == null) return map;
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        const v = computeEpicHealthVerdict(epic, planYear, progressBasis);
        if (v != null) map.set(epic.id, v.status);
      }
    }
    return map;
  }, [initiatives, planYear, progressBasis]);
  const filtersAreDefault =
    panelQuarterFilters.length === 1 &&
    panelQuarterFilters[0] === "all" &&
    panelTeamFilterIds.length === 1 &&
    panelTeamFilterIds[0] === "all" &&
    panelStatusFilters.length === 1 &&
    panelStatusFilters[0] === "all" &&
    (!healthFilter || healthFilter.size === 0);
  const notifySprintTeamFromPanelTeamIds = useCallback(
    (next: string[]) => {
      if (!onSprintBoardTeamFilterSync) return;
      const withoutAll = next.filter((x) => x !== "all");
      if (next.includes("all") || withoutAll.length !== 1) {
        onSprintBoardTeamFilterSync(null);
        return;
      }
      const id = withoutAll[0];
      onSprintBoardTeamFilterSync(id);
    },
    [onSprintBoardTeamFilterSync],
  );

  const handlePanelTeamFilterToggle = useCallback(
    (value: string) => {
      setPanelTeamFilterIds((prev) => {
        const next = toggleMultiFilter(prev, value, "all");
        queueMicrotask(() => notifySprintTeamFromPanelTeamIds(next));
        return next;
      });
    },
    [notifySprintTeamFromPanelTeamIds],
  );

  const resetAllFilters = () => {
    setPanelQuarterFilters(["all"]);
    setPanelTeamFilterIds(["all"]);
    setPanelStatusFilters(["all"]);
    onSprintBoardTeamFilterSync?.(null);
    onHealthFilterChange?.(new Set());
  };
  /**
   * Quarter dropdown is SINGLE-select (radio-style) — a year only ever has
   * a meaningful sequence semantics, never an arbitrary Set, so picking
   * one quarter replaces the prior choice instead of accumulating. Clicking
   * the already-active quarter resets to "all" (year view). Pairs with the
   * sync effect in epic-planner-app.tsx that focuses the Gantt on the
   * picked quarter.
   */
  const handleQuarterPick = (value: "all" | "Q1" | "Q2" | "Q3" | "Q4") => {
    setPanelQuarterFilters((prev) => {
      if (value === "all") return prev.length === 1 && prev[0] === "all" ? prev : ["all"];
      const isAlreadyOnlyPick = prev.length === 1 && prev[0] === value;
      return isAlreadyOnlyPick ? ["all"] : [value];
    });
  };
  /**
   * Bridge the panel's local execution-status filter to the parent so the
   * Gantt can apply the same cut. Only emits the 4 execution statuses
   * (todo / inProgress / review / done) — plan statuses Scheduled /
   * Unscheduled don't translate to the Gantt's "show this bar?" question.
   */
  useEffect(() => {
    if (!onPanelStatusFilterDerivedChange) return;
    const set = new Set<UserStoryItem["status"]>();
    if (!panelStatusFilters.includes("all")) {
      if (panelStatusFilters.includes("To Do")) set.add("todo");
      if (panelStatusFilters.includes("In Progress")) set.add("inProgress");
      if (panelStatusFilters.includes("Review / Testing")) set.add("review");
      if (panelStatusFilters.includes("Done")) set.add("done");
    }
    onPanelStatusFilterDerivedChange(set);
  }, [panelStatusFilters, onPanelStatusFilterDerivedChange]);
  /** Emit selected quarters (empty when "all") so the parent can cut the
   *  Gantt to epics whose plan-start quarter matches. */
  useEffect(() => {
    if (!onPanelQuarterFilterDerivedChange) return;
    const set = new Set<"Q1" | "Q2" | "Q3" | "Q4">();
    if (!panelQuarterFilters.includes("all")) {
      for (const q of panelQuarterFilters) {
        if (q === "Q1" || q === "Q2" || q === "Q3" || q === "Q4") set.add(q);
      }
    }
    onPanelQuarterFilterDerivedChange(set);
  }, [panelQuarterFilters, onPanelQuarterFilterDerivedChange]);
  /** Emit `true` whenever the planner has pinned at least one specific
   *  team. Parent uses this to auto-light the Gantt's team-chip overlay
   *  (otherwise the planner has to find + flip the toolbar toggle). */
  useEffect(() => {
    if (!onPanelTeamFilterActiveChange) return;
    const active = !panelTeamFilterIds.includes("all") && panelTeamFilterIds.length > 0;
    onPanelTeamFilterActiveChange(active);
  }, [panelTeamFilterIds, onPanelTeamFilterActiveChange]);
  /** Emit selected team IDs so the parent can cut the Gantt to those
   *  teams. Empty Set (or "all" sentinel present) means no filter. */
  useEffect(() => {
    if (!onPanelTeamFilterDerivedChange) return;
    const set = new Set<string>();
    if (!panelTeamFilterIds.includes("all")) {
      for (const id of panelTeamFilterIds) {
        if (id !== "all" && id) set.add(id);
      }
    }
    onPanelTeamFilterDerivedChange(set);
  }, [panelTeamFilterIds, onPanelTeamFilterDerivedChange]);
  /** Reverse-direction sync: when the Hero's Team Progress row click
   *  or the Gantt breadcrumb writes to the parent's shared team Set,
   *  mirror it back into the panel's own dropdown state so the panel
   *  UI reflects the active selection. Content-equality guard avoids
   *  a write-back loop with the emit useEffect above (which fires on
   *  every `panelTeamFilterIds` change). Falling back to the "all"
   *  sentinel when external is empty keeps the dropdown's checkbox UI
   *  visually consistent with its own "show everything" idiom. */
  useEffect(() => {
    if (!externalTeamFilter) return;
    const incoming = Array.from(externalTeamFilter);
    setPanelTeamFilterIds((prev) => {
      const prevReal = prev.filter((id) => id !== "all");
      if (
        incoming.length === prevReal.length &&
        incoming.every((id) => prevReal.includes(id))
      ) {
        return prev;
      }
      return incoming.length === 0 ? ["all"] : incoming;
    });
  }, [externalTeamFilter]);
  const toggleMultiFilter = <T extends string>(prev: T[], value: T, allToken: T): T[] => {
    if (value === allToken) return [allToken];
    const withoutAll = prev.filter((x) => x !== allToken);
    if (withoutAll.includes(value)) {
      const next = withoutAll.filter((x) => x !== value);
      return next.length > 0 ? next : [allToken];
    }
    return [...withoutAll, value];
  };
  useEffect(() => {
    // Functional-setter bail-outs: returning `prev` when the array already
    // matches lets React skip the re-render. Without this, every parent
    // render that re-fires this effect creates a fresh `["all"]` array and
    // shows up as a state change, which contributes to the Jump-to-current-
    // sprint max-update-depth cascade.
    if (epicPlanPanelMode) {
      setPanelQuarterFilters((prev) => (prev.length === 1 && prev[0] === "all" ? prev : ["all"]));
      return;
    }
    if (panelQuarterQuickFilter == null) {
      setPanelQuarterFilters((prev) => (prev.length === 1 && prev[0] === "all" ? prev : ["all"]));
      return;
    }
    setPanelQuarterFilters((prev) =>
      prev.length === 1 && prev[0] === panelQuarterQuickFilter ? prev : [panelQuarterQuickFilter],
    );
  }, [epicPlanPanelMode, panelQuarterQuickFilter]);
  useEffect(() => {
    if (panelStatusQuickFilter == null) {
      setPanelStatusFilters((prev) => {
        const withoutQuick = prev.filter((value) => value !== "Scheduled" && value !== "Unscheduled");
        const next = withoutQuick.length > 0 ? withoutQuick : (["all"] as typeof prev);
        // Bail out when the post-filter result is structurally identical
        // to prev so React skips a re-render of the whole panel tree.
        if (next.length === prev.length && next.every((v, i) => v === prev[i])) return prev;
        return next;
      });
      return;
    }
    setPanelStatusFilters((prev) =>
      prev.length === 1 && prev[0] === panelStatusQuickFilter ? prev : [panelStatusQuickFilter],
    );
  }, [panelStatusQuickFilter]);

  /** Pre-fill the search box from a parent-supplied seed. Fires only on
   *  changes (null/undefined → no-op) so the user's manually-typed query
   *  isn't overwritten when the parent re-renders with the same seed. */
  useEffect(() => {
    if (prefillSearchQuery == null) return;
    setInitiativeSearch(prefillSearchQuery);
  }, [prefillSearchQuery]);

  /**
   * Keep left-panel team chips aligned with sprint board team (Kanban / capacity / insights).
   * When the board is scoped to one team, match that chip; when the board is “all teams”, clear a stale
   * single-team chip so epics from every team stay visible in the list.
   */
  useEffect(() => {
    // Functional setter with identity bail-out: writing `["all"]` (or
    // `[id]`) directly creates a fresh array every call, which React
    // treats as a state change even when the logical value is the same
    // — that combined with a re-firing parent callback was driving a
    // max-update-depth loop when the user clicked "View current sprint"
    // on a closed sprint. Returning `prev` when contents already match
    // lets React bail out and stops the cascade.
    if (monthEpicTeamFilterId) {
      setPanelTeamFilterIds((prev) =>
        prev.length === 1 && prev[0] === monthEpicTeamFilterId ? prev : [monthEpicTeamFilterId],
      );
      return;
    }
    if (onSprintBoardTeamFilterSync != null && monthEpicTeamFilterId == null) {
      setPanelTeamFilterIds((prev) =>
        prev.length === 1 && prev[0] === "all" ? prev : ["all"],
      );
    }
  }, [monthEpicTeamFilterId, onSprintBoardTeamFilterSync]);

  const monthAssignedEpics = useMemo(() => {
    // Middle panel's Epics list: include EVERY epic from every
    // initiative, regardless of whether it is planned for the focused
    // month or quarter. The user-controlled filters above the list
    // (Teams / Statuses / Quarters / Health) still narrow the list —
    // but absent any user filter, every epic is visible.
    const rows: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const initiative of initiatives) {
      for (const epic of initiative.epics ?? []) {
        rows.push({ epic, initiative });
      }
    }
    return rows.sort((a, b) => {
      const byInit = a.initiative.title.localeCompare(b.initiative.title);
      if (byInit !== 0) return byInit;
      return a.epic.title.localeCompare(b.epic.title);
    });
  }, [initiatives]);
  /** Month list scope: all epics for the month, or only those on the selected team when viewing that team’s sprint board. */
  const monthPanelEpics = useMemo(() => {
    if (!monthEpicTeamFilterId) return monthAssignedEpics;
    const filterId = normalizeWorkspaceUserTeam(monthEpicTeamFilterId);
    return monthAssignedEpics.filter(({ epic }) => normalizedEpicTeamId(epic) === filterId);
  }, [monthAssignedEpics, monthEpicTeamFilterId]);
  /** Panel epics after team / status / quarter filters but BEFORE the
   *  health filter. Used both as the input to `monthPanelEpicsFiltered`
   *  (which just layers the health step on top) and as the population
   *  for `verdictCountsForPanel` — so the per-verdict counts shown in
   *  the Health menu reflect "if I picked this verdict NOW, given my
   *  current other filters, how many epics would remain." */
  const monthPanelEpicsBeforeHealth = useMemo(() => {
    return monthPanelEpics.filter(({ epic, initiative }) => {
      if (!panelQuarterFilters.includes("all")) {
        const monthForQuarter = epic.planStartMonth ?? initiative.startMonth;
        if (
          monthForQuarter == null ||
          !panelQuarterFilters.includes(quarterFromMonth(monthForQuarter) as "Q1" | "Q2" | "Q3" | "Q4")
        ) {
          return false;
        }
      }
      if (!panelTeamFilterIds.includes("all") && !panelTeamFilterIds.includes(normalizedEpicTeamId(epic))) return false;
      if (!panelStatusFilters.includes("all")) {
        const planning = epicPlanningStatusMeta(epic).label;
        const execution = epicExecutionStatusMeta(epic).label as "To Do" | "In Progress" | "Review / Testing" | "Done";
        const matches =
          (panelStatusFilters.includes("Scheduled") && planning !== "Unscheduled") ||
          (panelStatusFilters.includes("Unscheduled") && planning === "Unscheduled") ||
          panelStatusFilters.includes(execution);
        if (!matches) {
          return false;
        }
      }
      return true;
    });
  }, [monthPanelEpics, panelQuarterFilters, panelStatusFilters, panelTeamFilterIds]);
  const monthPanelEpicsFiltered = useMemo(() => {
    if (!healthFilter || healthFilter.size === 0) return monthPanelEpicsBeforeHealth;
    return monthPanelEpicsBeforeHealth.filter(({ epic }) => {
      const verdict = healthByEpicId.get(epic.id);
      // Skip epics without a verdict (no plan window) when filter is active.
      return verdict != null && healthFilter.has(verdict);
    });
  }, [monthPanelEpicsBeforeHealth, healthFilter, healthByEpicId]);
  /** Per-verdict tallies surfaced as the count column in the Health
   *  menu. Counted from `monthPanelEpicsBeforeHealth` so picking team /
   *  status / quarter narrows the totals; the health filter itself does
   *  not — picking a verdict shouldn't change the counts beside the
   *  other verdicts (each row stays independently selectable). */
  const verdictCountsForPanel = useMemo<Record<HealthStatus, number>>(() => {
    const counts: Record<HealthStatus, number> = {
      onTrack: 0,
      watch: 0,
      atRisk: 0,
      overdue: 0,
      done: 0,
    };
    for (const { epic } of monthPanelEpicsBeforeHealth) {
      const v = healthByEpicId.get(epic.id);
      if (v != null) counts[v] += 1;
    }
    return counts;
  }, [monthPanelEpicsBeforeHealth, healthByEpicId]);
  const planAnchorMonth = epicPanelQuarterMonths?.[0] ?? epicListScopeMonth;

  const monthBacklogEpics = useMemo(() => {
    if (planAnchorMonth == null) return [];
    const base = monthPanelEpics.filter(({ epic }) => !epicIsOnPlanForMonth(epic, planAnchorMonth));
    const order = epicBacklogOrderByMonth[planAnchorMonth] ?? [];
    if (order.length === 0) return base;
    const byId = new Map(base.map((row) => [row.epic.id, row]));
    const ordered: Array<{ epic: EpicItem; initiative: InitiativeItem }> = [];
    for (const id of order) {
      const row = byId.get(id);
      if (row) {
        ordered.push(row);
        byId.delete(id);
      }
    }
    const rest = [...byId.values()].sort((a, b) => a.epic.title.localeCompare(b.epic.title));
    return [...ordered, ...rest];
  }, [monthPanelEpics, planAnchorMonth, epicBacklogOrderByMonth]);
  const filteredMonthBacklogEpics = useMemo(() => {
    const q = epicSearch.trim().toLowerCase();
    const base = q
      ? monthPanelEpicsFiltered.filter(
          ({ epic, initiative }) =>
            epic.title.toLowerCase().includes(q) ||
            initiative.title.toLowerCase().includes(q) ||
            (epic.userStories ?? []).some((s) => s.title.toLowerCase().includes(q)),
        )
      : monthPanelEpicsFiltered;
    if (!newestEpicId) return base;
    const newestIdx = base.findIndex(({ epic }) => epic.id === newestEpicId);
    if (newestIdx <= 0) return base;
    const result = [...base];
    result.unshift(...result.splice(newestIdx, 1));
    return result;
  }, [monthPanelEpicsFiltered, epicSearch, newestEpicId]);

  const epicSearchSuggestionsList = useMemo(() => {
    const titles = monthPanelEpicsFiltered
      .map(({ epic }) => epic.title.trim())
      .filter((t) => t.length > 0);
    return [...new Set(titles)].sort((a, b) => a.localeCompare(b));
  }, [monthPanelEpicsFiltered]);
  const epicSearchSuggestionsFiltered = useMemo(() => {
    const q = epicSearch.trim().toLowerCase();
    if (!q) return epicSearchSuggestionsList.slice(0, 8);
    return epicSearchSuggestionsList
      .filter((entry) => entry.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.localeCompare(b);
      })
      .slice(0, 8);
  }, [epicSearch, epicSearchSuggestionsList]);

  const initiativeList = useMemo(
    () =>
      initiatives
        .slice()
        .sort((a, b) => {
          // The just-created initiative always wins — keeps it visually
          // pinned at the top until the next reload / new creation, so
          // the user doesn't have to scroll for the row they just made.
          if (newestInitiativeId != null) {
            if (a.id === newestInitiativeId) return -1;
            if (b.id === newestInitiativeId) return 1;
          }
          if (a.status !== b.status) return a.status === "backlog" ? -1 : 1;
          return a.timelineRow - b.timelineRow || a.title.localeCompare(b.title);
        }),
    [initiatives, newestInitiativeId],
  );
  // Search-driven auto-expansion: when the user types a query that matches an
  // epic or a story (not just the initiative title), automatically force-open
  // the parent initiative AND the parent epic so the match is visible without
  // requiring extra clicks. When the query clears or stops matching, the
  // forced-open state lifts and the user's own toggle state takes over again.
  const searchExpandedInitiativeIds = useMemo(() => {
    const q = initiativeSearch.trim().toLowerCase();
    if (!q) return new Set<string>();
    const ids = new Set<string>();
    for (const initiative of initiativeList) {
      const epicMatch = (initiative.epics ?? []).some((epic) => epic.title.toLowerCase().includes(q));
      const storyMatch = (initiative.epics ?? []).some((epic) =>
        (epic.userStories ?? []).some((story) => story.title.toLowerCase().includes(q)),
      );
      if (epicMatch || storyMatch) ids.add(initiative.id);
    }
    return ids;
  }, [initiativeList, initiativeSearch]);
  const searchExpandedEpicIds = useMemo(() => {
    const q = initiativeSearch.trim().toLowerCase();
    if (!q) return new Set<string>();
    const ids = new Set<string>();
    for (const initiative of initiativeList) {
      for (const epic of initiative.epics ?? []) {
        const storyMatch = (epic.userStories ?? []).some((story) => story.title.toLowerCase().includes(q));
        if (storyMatch) ids.add(epic.id);
      }
    }
    return ids;
  }, [initiativeList, initiativeSearch]);
  const searchQueryLower = initiativeSearch.trim().toLowerCase();

  const filteredInitiatives = useMemo(() => {
    const q = initiativeSearch.trim().toLowerCase();
    return initiativeList.filter((initiative) => {
      if (q) {
        const initiativeMatch = initiative.title.toLowerCase().includes(q);
        const epicMatch = (initiative.epics ?? []).some((epic) => epic.title.toLowerCase().includes(q));
        const storyMatch = (initiative.epics ?? []).some((epic) =>
          (epic.userStories ?? []).some((story) => story.title.toLowerCase().includes(q)),
        );
        if (!initiativeMatch && !epicMatch && !storyMatch) return false;
      }
      if (!panelQuarterFilters.includes("all")) {
        const initiativeQuarter =
          initiative.startMonth != null
            ? (quarterFromMonth(initiative.startMonth) as "Q1" | "Q2" | "Q3" | "Q4")
            : null;
        const hasEpicInQuarter = (initiative.epics ?? []).some(
          (epic) =>
            epic.planStartMonth != null &&
            panelQuarterFilters.includes(quarterFromMonth(epic.planStartMonth) as "Q1" | "Q2" | "Q3" | "Q4"),
        );
        if (!hasEpicInQuarter && (initiativeQuarter == null || !panelQuarterFilters.includes(initiativeQuarter))) {
          return false;
        }
      }
      // External team filter (Hero's Team Progress row click writes
      // here via the parent's `ganttTeamFilter`). When non-empty, keep
      // only initiatives whose epics include at least one belonging
      // to a picked team. Applied at every scope.
      if (externalTeamFilter && externalTeamFilter.size > 0) {
        const matches = (initiative.epics ?? []).some(
          (epic) => epic.team != null && externalTeamFilter.has(epic.team),
        );
        if (!matches) return false;
      }
      if (!panelTeamFilterIds.includes("all")) {
        const hasTeam = (initiative.epics ?? []).some((epic) =>
          panelTeamFilterIds.includes(normalizedEpicTeamId(epic)),
        );
        if (!hasTeam) return false;
      }
      if (!panelStatusFilters.includes("all")) {
        const hasUnscheduledEpics = (initiative.epics ?? []).some(
          (epic) => epicPlanningStatusMeta(epic).label === "Unscheduled",
        );
        const hasScheduledEpics = (initiative.epics ?? []).some(
          (epic) => epicPlanningStatusMeta(epic).label !== "Unscheduled",
        );
        /**
         * Execution-status check: show this initiative if ANY of its child
         * epics rolls up to a matching status — same "any-of" semantics the
         * Gantt uses. The previous "initiative rolls up to one label" path
         * was too strict (e.g. `Review / Testing` required ALL epics to be
         * in review/done) and produced a 0-row panel while the Gantt still
         * showed plenty of matching bars.
         */
        const epicExecutionLabels = (initiative.epics ?? []).map(
          (epic) => epicExecutionStatusMeta(epic).label,
        );
        const anyEpicMatchesExecution = epicExecutionLabels.some((label) =>
          panelStatusFilters.includes(label as "To Do" | "In Progress" | "Review / Testing" | "Done"),
        );
        const matches =
          (panelStatusFilters.includes("Unscheduled") && (initiative.status === "backlog" || hasUnscheduledEpics)) ||
          (panelStatusFilters.includes("Scheduled") && (initiative.status === "scheduled" || hasScheduledEpics)) ||
          anyEpicMatchesExecution;
        if (!matches) {
          return false;
        }
      }
      // External execution-status filter (currently driven by the
      // Hero's Work Progress donut at initiative scope). When set and
      // we're at initiative scope, fold every story under the
      // initiative through the canonical workflow rollup and keep the
      // initiative only if its rollup falls inside the filter set —
      // matches the donut's "8 in-progress initiatives" exactly,
      // instead of the panel's panel-dropdown any-epic semantics
      // which would return all 10 (any initiative with one in-progress
      // epic anywhere).
      if (
        heroScope === "initiative" &&
        externalStatusFilter &&
        externalStatusFilter.size > 0
      ) {
        const rolled = rollupWorkflowStatus(
          (initiative.epics ?? []).flatMap((e) => e.userStories ?? []),
        );
        if (rolled == null || !externalStatusFilter.has(rolled)) return false;
      }
      if (healthFilter && healthFilter.size > 0) {
        if (heroScope === "initiative") {
          // At initiative scope, match the Hero's Health Distribution
          // donut: each initiative gets a single worst-of-children
          // verdict and the panel keeps only initiatives whose verdict
          // is in the active set.
          const v = computeInitiativeHealthVerdict(initiative, planYear ?? new Date().getFullYear(), progressBasis);
          if (v == null || !healthFilter.has(v.status)) return false;
        } else {
          // Show an initiative only when at least one of its epics has a
          // verdict in the active set — mirrors the popover's "epic-level"
          // selection semantics.
          const epicMatches = (initiative.epics ?? []).some((epic) => {
            const verdict = healthByEpicId.get(epic.id);
            return verdict != null && healthFilter.has(verdict);
          });
          if (!epicMatches) return false;
        }
      }
      return true;
    });
  }, [initiativeList, initiativeSearch, panelQuarterFilters, panelStatusFilters, panelTeamFilterIds, healthFilter, healthByEpicId, heroScope, planYear, progressBasis, externalStatusFilter, externalTeamFilter]);
  const initiativeSearchSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const initiative of initiativeList) {
      if (initiative.title.trim()) set.add(initiative.title);
      for (const epic of initiative.epics ?? []) {
        if (epic.title.trim()) set.add(epic.title);
        for (const story of epic.userStories ?? []) {
          if (story.title.trim()) set.add(story.title);
        }
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [initiativeList]);
  const initiativeSearchSuggestionsFiltered = useMemo(() => {
    const q = initiativeSearch.trim().toLowerCase();
    if (!q) return initiativeSearchSuggestions.slice(0, 8);
    return initiativeSearchSuggestions
      .filter((entry) => entry.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.localeCompare(b);
      })
      .slice(0, 8);
  }, [initiativeSearch, initiativeSearchSuggestions]);
  const showInitiativeBacklogDrop = !epicPlanPanelMode && !isSprintModeActive;

  const showNewButton = epicPlanPanelMode || !isSprintModeActive;

  const initiativePickerOptions = useMemo(
    () =>
      initiatives
        .map((i) => ({ id: i.id, title: i.title }))
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" })),
    [initiatives],
  );

  const handleNewButtonClick = useCallback(() => {
    if (epicPlanPanelMode) {
      if (!onCreateEpicQuick) {
        onCreateEpic?.();
        return;
      }
      const canInline =
        firstScheduledInitiativeForActiveMonth != null ||
        initiatives.length > 0 ||
        onCreateInitiativeQuick != null;
      if (!canInline) {
        toast.message(
          activeMonth != null
            ? "Add an initiative first (or schedule one for this month), then create an epic."
            : "Create an initiative first, then add an epic.",
        );
        return;
      }
      setInlineNewEpicInitiativeId(
        firstScheduledInitiativeForActiveMonth?.id ?? initiatives[0]?.id ?? "",
      );
      setInlineNewInitiativeOpen(false);
      setInlineNewInitiativeTitle("");
      setInlineNewEpicOpen(true);
      return;
    }
    if (onCreateInitiativeQuick) {
      setInlineNewEpicOpen(false);
      setInlineNewEpicTitle("");
      setInlineNewEpicInitiativeId("");
      setInlineNewInitiativeOpen(true);
      return;
    }
    onCreateInitiative?.();
  }, [
    activeMonth,
    epicPlanPanelMode,
    firstScheduledInitiativeForActiveMonth,
    initiatives,
    onCreateEpic,
    onCreateEpicQuick,
    onCreateInitiative,
    onCreateInitiativeQuick,
  ]);

  const submitInlineNewInitiative = useCallback(async () => {
    if (!onCreateInitiativeQuick) return;
    const title = inlineNewInitiativeTitle.trim();
    if (title.length < 2) return;
    setInlineNewInitiativeSubmitting(true);
    try {
      await onCreateInitiativeQuick(title);
      setInlineNewInitiativeTitle("");
      setInlineNewInitiativeOpen(false);
    } catch {
      // Parent surfaces toast and rethrows so the composer stays open.
    } finally {
      setInlineNewInitiativeSubmitting(false);
    }
  }, [inlineNewInitiativeTitle, onCreateInitiativeQuick]);

  const submitInlineNewEpic = useCallback(async () => {
    if (!onCreateEpicQuick || !inlineNewEpicInitiativeId) return;
    const title = inlineNewEpicTitle.trim();
    if (!title) return;
    setInlineNewEpicSubmitting(true);
    try {
      await onCreateEpicQuick(inlineNewEpicInitiativeId, title);
      setInlineNewEpicTitle("");
      setInlineNewEpicInitiativeId("");
      setInlineNewEpicOpen(false);
    } catch {
      // Parent surfaces toast and rethrows so the composer stays open.
    } finally {
      setInlineNewEpicSubmitting(false);
    }
  }, [inlineNewEpicInitiativeId, inlineNewEpicTitle, onCreateEpicQuick]);

  /** Submit the mini "+ New initiative" composer that lives inside the
   *  New Epic flow. Creates the initiative via `onCreateInitiativeQuick`,
   *  auto-selects it as the epic's parent (so the planner doesn't have
   *  to hunt for it in the picker), and collapses the mini composer.
   *  The outer New Epic composer stays open and the epic-title input
   *  re-receives focus so the planner can finish in one go. */
  const submitEpicComposerNewInit = useCallback(async () => {
    if (!onCreateInitiativeQuick) return;
    const title = epicComposerNewInitTitle.trim();
    if (title.length < 2) return;
    setEpicComposerNewInitSubmitting(true);
    try {
      const created = await onCreateInitiativeQuick(title);
      if (typeof created === "string" && created) {
        setInlineNewEpicInitiativeId(created);
      }
      setEpicComposerNewInitTitle("");
      setEpicComposerNewInitOpen(false);
      // Hop focus back to the epic-title input so the next keystroke
      // names the epic — keeps the create flow uninterrupted.
      queueMicrotask(() => inlineEpicInputRef.current?.focus());
    } catch {
      // Parent surfaces the toast on the createInitiativeQuick handler.
    } finally {
      setEpicComposerNewInitSubmitting(false);
    }
  }, [epicComposerNewInitTitle, onCreateInitiativeQuick]);

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white pt-10 pb-4 pl-0 pr-2 shadow-xl ring-1 ring-black/8">
      <div className="z-10 -mr-2 mb-4 flex shrink-0 items-center justify-between border-b border-slate-200 bg-white pr-2 pb-2">
        <div className="min-w-0 pl-5">
          <h2 className="inline-flex items-center gap-2 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-slate-800">
            {epicPlanPanelMode ? (
              <>
                <Folder className="size-6 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
                Epics
              </>
            ) : (
              <>
                <Zap className="size-6 shrink-0 text-blue-600" strokeWidth={1.9} aria-hidden />
                Initiatives
              </>
            )}
          </h2>
        </div>
        <div className="flex items-center gap-2 -mr-1">
          {showNewButton ? (
            <Button
              size="sm"
              variant="default"
              className={cn(
                "h-8 border-0 px-3 text-[13px] font-bold shadow-none",
                // Flat indigo-100 — the middle shade of the breadcrumb panel's
                // sky → indigo → violet gradient. No gradient on the button
                // itself, just the same color the breadcrumb sits at center.
                "bg-indigo-100 text-indigo-900 ring-1 ring-indigo-200/80",
                "hover:bg-indigo-200 hover:text-indigo-900",
                "focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-0 [&_svg]:text-indigo-700",
              )}
              onClick={handleNewButtonClick}
            >
              <Plus className="size-3.5" />
              {epicPlanPanelMode ? "Epic" : "Initiative"}
            </Button>
          ) : null}
          {onHidePanel ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={onHidePanel}
              aria-label="Hide left panel"
              title="Hide left panel"
            >
              <PanelLeftClose className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          // Internal vertical scroll on the initiative list. `direction:
          // rtl` puts the scrollbar on the LEFT edge for an LTR app;
          // the inner div flips back to `ltr` so the cards still read
          // normally. Pastel scrollbar matches the planner's accent.
          "min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-white [direction:rtl] [scrollbar-gutter:stable] mr-1.5 shadow-[inset_-4px_0_8px_-4px_rgba(15,23,42,0.09)] [scrollbar-color:theme(colors.indigo.100)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gradient-to-b [&::-webkit-scrollbar-thumb]:from-sky-100 [&::-webkit-scrollbar-thumb]:via-indigo-100 [&::-webkit-scrollbar-thumb]:to-violet-100",
        )}
      >
        <div className="min-h-0 bg-white ps-5 pe-2 [direction:ltr]">
      {epicPlanPanelMode ? (
        <div className="pt-1 pb-4">
          <div className="pb-5">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 z-10 size-4.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              value={epicSearch}
              onChange={(event) => setEpicSearch(event.target.value)}
              onFocus={() => setEpicSearchFocused(true)}
              onBlur={() => {
                window.setTimeout(() => setEpicSearchFocused(false), 80);
              }}
              placeholder="Search epic..."
              className="h-11 w-full rounded-lg border border-slate-400 bg-white pl-10 pr-9 text-[15px] outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200/70"
              aria-label="Search epics in selected month"
              aria-autocomplete="list"
              aria-expanded={epicSearchFocused && epicSearchSuggestionsFiltered.length > 0}
            />
            {epicSearch ? (
              <button
                type="button"
                onClick={() => setEpicSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:text-slate-600"
                aria-label="Clear search"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
            {epicSearchFocused && epicSearchSuggestionsFiltered.length > 0 ? (
              <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-300 bg-white p-1.5 ring-1 ring-slate-200/90">
                {epicSearchSuggestionsFiltered.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      setEpicSearch(entry);
                      setEpicSearchFocused(false);
                    }}
                    className="block w-full rounded-md px-2.5 py-2 text-left text-[15px] leading-snug text-slate-700 hover:bg-slate-100"
                  >
                    {entry}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-2">
            <TeamFilterAutocomplete
              values={panelTeamFilterIds}
              onToggle={handlePanelTeamFilterToggle}
              options={teamFilterOptions}
              ariaLabel="Filter left panel by team"
              allValue="all"
            />
            <IconFilterSelect
              values={panelStatusFilters}
              onToggle={handleStatusToggle}
              options={statusFilterOptions}
              ariaLabel="Filter left panel by status"
              allValue="all"
            />
            {/* The quarter filter stays interactive in every view (year,
              * quarter, and month). It is never auto-locked to whatever
              * the user just navigated into — they pick freely. */}
            <IconFilterSelect
              values={panelQuarterFilters}
              onToggle={handleQuarterPick}
              options={quarterFilterOptions}
              ariaLabel="Filter left panel by quarter"
              allValue="all"
              disabled={panelQuarterFilterLocked}
              appearance="radio"
            />
            <HealthFilterMenu
              healthFilter={healthFilter}
              onHealthFilterChange={onHealthFilterChange}
              progressBasis={progressBasis}
              onProgressBasisChange={onProgressBasisChange}
              verdictCounts={verdictCountsForPanel}
              onAnyHealthPicked={() => {
                // Picking any health verdict drops the execution-status
                // filter — same mutual-exclusion contract the old unified
                // dropdown enforced.
                if (!panelStatusFilters.includes("all")) setPanelStatusFilters(["all"]);
                onUserPickedFilter?.();
              }}
            />
            <button
              type="button"
              onClick={resetAllFilters}
              disabled={filtersAreDefault}
              title="Reset all filters"
              aria-label="Reset all filters to default"
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200 transition",
                filtersAreDefault
                  ? "cursor-not-allowed text-slate-300"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-ring/40",
              )}
            >
              <Eraser className="size-4" aria-hidden />
            </button>
          </div>
          </div>
          {inlineNewEpicOpen && onCreateEpicQuick && (initiativePickerOptions.length > 0 || onCreateInitiativeQuick) ? (
            <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-gradient-to-br from-slate-50/90 via-white to-violet-50/35 shadow-[0_2px_8px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/50">
              <div
                className="flex gap-3 border-l-[3px] border-slate-400 bg-white/50 px-3 py-3 pl-[14px] backdrop-blur-[1px]"
                style={{
                  borderLeftColor:
                    initiatives.find((i) => i.id === inlineNewEpicInitiativeId)?.color ||
                    firstScheduledInitiativeForActiveMonth?.color ||
                    undefined,
                }}
              >
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-600/10 text-slate-700 ring-1 ring-slate-600/15"
                  aria-hidden
                >
                  <Folder className="size-3.5" strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div>
                    <p className="text-lg font-bold tracking-tight text-slate-900">New epic</p>
                    <p className="mt-1 text-[12px] leading-snug text-slate-600">
                      Choose a parent initiative or create a new one from the field below.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Initiative
                        </p>
                        {onCreateInitiativeQuick ? (
                          // Visible-by-default "+ New initiative" affordance —
                          // gives the planner a one-click path to create an
                          // initiative without first clicking into the picker
                          // field. Toggles the mini composer below the field.
                          <button
                            type="button"
                            className="inline-flex items-center gap-0.5 rounded px-1 text-[11px] font-semibold text-sky-700 hover:text-sky-900 hover:bg-sky-50/80 disabled:opacity-50"
                            disabled={inlineNewEpicSubmitting}
                            onClick={() => setEpicComposerNewInitOpen((v) => !v)}
                            aria-expanded={epicComposerNewInitOpen}
                          >
                            <Plus className="size-3" aria-hidden />
                            New initiative
                          </button>
                        ) : null}
                      </div>
                      <InitiativeCombobox
                        valueId={inlineNewEpicInitiativeId}
                        onValueChange={setInlineNewEpicInitiativeId}
                        options={initiativePickerOptions}
                        onCreateNew={
                          onCreateInitiativeQuick
                            ? async (t) => {
                                const id = await onCreateInitiativeQuick(t);
                                if (typeof id === "string" && id) return id;
                                throw new Error("Initiative was not created");
                              }
                            : undefined
                        }
                        disabled={inlineNewEpicSubmitting}
                        placeholder="Search, pick, or create an initiative"
                        aria-label="Initiative for new epic"
                        className="h-8 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900 shadow-inner shadow-slate-900/5 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-200/70"
                      />
                      {epicComposerNewInitOpen && onCreateInitiativeQuick ? (
                        // Disclosure-triggered mini composer. Submitting
                        // creates the initiative via the same handler the
                        // combobox uses, auto-selects it as the new epic's
                        // parent, and collapses this row.
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-sky-200/80 bg-sky-50/40 px-2 py-1.5">
                          <input
                            ref={epicComposerNewInitInputRef}
                            type="text"
                            value={epicComposerNewInitTitle}
                            onChange={(e) => setEpicComposerNewInitTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void submitEpicComposerNewInit();
                              }
                              if (e.key === "Escape") {
                                setEpicComposerNewInitOpen(false);
                                setEpicComposerNewInitTitle("");
                              }
                            }}
                            placeholder="New initiative name…"
                            autoComplete="off"
                            disabled={epicComposerNewInitSubmitting}
                            className="h-7 min-w-0 flex-1 rounded-md border border-sky-200 bg-white px-2 text-[13px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-200/70"
                            aria-label="New initiative name"
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 shrink-0 gap-1 bg-sky-600 px-2 text-[12px] font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50"
                            disabled={
                              epicComposerNewInitSubmitting ||
                              epicComposerNewInitTitle.trim().length < 2
                            }
                            onClick={() => void submitEpicComposerNewInit()}
                          >
                            <Plus className="size-3.5" aria-hidden />
                            Create
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 shrink-0 px-2 text-[12px] text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                            onClick={() => {
                              setEpicComposerNewInitOpen(false);
                              setEpicComposerNewInitTitle("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={inlineEpicInputRef}
                        type="text"
                        value={inlineNewEpicTitle}
                        onChange={(e) => setInlineNewEpicTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void submitInlineNewEpic();
                          }
                          if (e.key === "Escape") {
                            setInlineNewEpicOpen(false);
                            setInlineNewEpicTitle("");
                            setInlineNewEpicInitiativeId("");
                          }
                        }}
                        placeholder="Name this epic…"
                        autoComplete="off"
                        className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900 shadow-inner shadow-slate-900/5 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-200/70"
                        aria-label="New epic title"
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 shrink-0 gap-1 bg-slate-800 px-2 text-[12px] font-semibold text-white shadow-sm hover:bg-slate-900 disabled:opacity-50"
                        disabled={
                          inlineNewEpicSubmitting ||
                          inlineNewEpicTitle.trim().length === 0 ||
                          !inlineNewEpicInitiativeId
                        }
                        onClick={() => void submitInlineNewEpic()}
                      >
                        <Plus className="size-3.5" aria-hidden />
                        Add
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 shrink-0 px-2 text-[12px] text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        onClick={() => {
                          setInlineNewEpicOpen(false);
                          setInlineNewEpicTitle("");
                          setInlineNewEpicInitiativeId("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[15px] font-medium tracking-[0.01em] text-slate-900">
              {activeMonth != null
                ? `${MONTHS[activeMonth - 1] ?? `Month ${activeMonth}`} Epics (${filteredMonthBacklogEpics.length})`
                : `My Epics (${filteredMonthBacklogEpics.length})`}
            </h3>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                title="Expand all epics"
                aria-label="Expand all epics"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                onClick={() =>
                  setMonthEpicOpenIds(
                    Object.fromEntries(filteredMonthBacklogEpics.map(({ epic }) => [epic.id, true])),
                  )
                }
              >
                <ChevronsDown className="size-4" />
              </button>
              <button
                type="button"
                title="Collapse all epics"
                aria-label="Collapse all epics"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setMonthEpicOpenIds({})}
              >
                <ChevronsUp className="size-4" />
              </button>
            </div>
          </div>
          <div
            ref={setEpicUnplanDropRef}
            className={cn(
              // `space-y-2` adds a consistent 8px gap between epic cards in
              // the Epics panel. Without it, cards sat flush — the colored
              // left stripes touched and the list read as one continuous
              // bar. The `EpicBacklogDropSlot` between cards is rendered
              // inside each card's wrapper `<div>`, so it doesn't pick up
              // a duplicate margin from `space-y-2`.
              "space-y-2 bg-transparent p-0 transition",
              isEpicUnplanDropOver && "bg-transparent",
            )}
          >
            {planAnchorMonth != null ? (
              <EpicBacklogDropSlot
                month={planAnchorMonth}
                index={0}
                disabled={blockEpicBacklogSlotsForTimelineDrag}
              />
            ) : null}
            {filteredMonthBacklogEpics.length === 0 ? (
              <p className="text-[11px] text-slate-700">
                {monthPanelEpics.length === 0
                  ? !panelQuarterFilters.includes("all") ||
                    !panelTeamFilterIds.includes("all") ||
                    !panelStatusFilters.includes("all")
                    ? "No epics match the selected filters."
                    : epicPanelQuarterLabel
                      ? "No epics are under initiatives scheduled in this quarter yet."
                      : "No epics are under initiatives scheduled in this month yet."
                  : "No epics match your search."}
              </p>
            ) : (
              filteredMonthBacklogEpics.map(({ epic, initiative }, idx) => (
                <div key={`backlog-${epic.id}`}>
                  <SprintEpicCard
                    epic={epic}
                    initiative={initiative}
                    epicPlanDragEnabled={epicPlanDragEnabled}
                    storyDragEnabled={isSprintModeActive && storyDragEnabled}
                    activeYearSprint={activeYearSprint}
                    showTeamChips={showTeamChips}
                    showStatusChips={showStatusChips}
                    showHealthChips={showHealthChips}
                    onOpenInsights={onOpenInsights}
                    onEpicAccordionChange={onEpicAccordionChange}
                    onOpenEpic={onOpenEpic}
                    onOpenStory={onOpenStory}
                    onDeleteEpic={onDeleteEpic}
                    onCreateStoryQuick={onCreateStoryQuick}
                    backlogDropSlot={
                      planAnchorMonth != null ? { month: planAnchorMonth, index: idx } : undefined
                    }
                    planContextMonth={planAnchorMonth}
                    hideScheduledIcon={epicPlanPanelMode || isSprintModeActive}
                    storyProgressDetailsVisible={storyProgressDetailsVisible}
                            progressBasis={progressBasis}
                    showDragHint={newestEpicId === epic.id}
                    isCapacityMode={isCapacityPlanningMode}
                    workspaceDirectoryUsers={workspaceDirectoryUsers}
                    isOpenControlled={monthEpicOpenIds[epic.id] ?? false}
                    onToggleControlled={() =>
                      setMonthEpicOpenIds((prev) => ({ ...prev, [epic.id]: !(prev[epic.id] ?? false) }))
                    }
                  />
                  {planAnchorMonth != null ? (
                    <EpicBacklogDropSlot
                      month={planAnchorMonth}
                      index={idx + 1}
                      disabled={blockEpicBacklogSlotsForTimelineDrag}
                    />
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="pt-1 pb-4">
          <div className="pb-5">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 z-10 size-4.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              value={initiativeSearch}
              onChange={(event) => setInitiativeSearch(event.target.value)}
              onFocus={() => setInitiativeSearchFocused(true)}
              onBlur={() => {
                // Allow click on suggestion item before closing.
                window.setTimeout(() => setInitiativeSearchFocused(false), 80);
              }}
              placeholder="Search..."
              className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-9 text-[14px] outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200/70"
              aria-label="Search initiatives, epics, or user stories"
            />
            {initiativeSearch ? (
              <button
                type="button"
                onClick={() => setInitiativeSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:text-slate-600"
                aria-label="Clear search"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
            {initiativeSearchFocused && initiativeSearchSuggestionsFiltered.length > 0 ? (
              <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-300 bg-white p-1.5 ring-1 ring-slate-200/90">
                {initiativeSearchSuggestionsFiltered.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onMouseDown={(event) => {
                      // Prevent blur before click selects.
                      event.preventDefault();
                    }}
                    onClick={() => {
                      setInitiativeSearch(entry);
                      setInitiativeSearchFocused(false);
                    }}
                    className="block w-full rounded-md px-2.5 py-2 text-left text-[15px] leading-snug text-slate-700 hover:bg-slate-100"
                  >
                    {entry}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-2">
            <TeamFilterAutocomplete
              values={panelTeamFilterIds}
              onToggle={handlePanelTeamFilterToggle}
              options={teamFilterOptions}
              ariaLabel="Filter initiatives by team"
              allValue="all"
            />
            <IconFilterSelect
              values={panelStatusFilters}
              onToggle={handleStatusToggle}
              options={statusFilterOptions}
              ariaLabel="Filter initiatives by status"
              allValue="all"
            />
            <IconFilterSelect
              values={panelQuarterFilters}
              onToggle={handleQuarterPick}
              options={quarterFilterOptions}
              ariaLabel="Filter initiatives by quarter"
              allValue="all"
              disabled={panelQuarterFilterLocked}
              appearance="radio"
            />
            <HealthFilterMenu
              healthFilter={healthFilter}
              onHealthFilterChange={onHealthFilterChange}
              progressBasis={progressBasis}
              onProgressBasisChange={onProgressBasisChange}
              onAnyHealthPicked={() => {
                if (!panelStatusFilters.includes("all")) setPanelStatusFilters(["all"]);
                onUserPickedFilter?.();
              }}
            />
            <button
              type="button"
              onClick={resetAllFilters}
              disabled={filtersAreDefault}
              title="Reset all filters"
              aria-label="Reset all filters to default"
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200 transition",
                filtersAreDefault
                  ? "cursor-not-allowed text-slate-300"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-ring/40",
              )}
            >
              <Eraser className="size-4" aria-hidden />
            </button>
          </div>
          </div>
          {inlineNewInitiativeOpen && onCreateInitiativeQuick ? (
            <div className="overflow-hidden rounded-xl border border-sky-200/80 bg-gradient-to-br from-sky-50/95 via-white to-white shadow-[0_2px_8px_rgba(14,165,233,0.12)] ring-1 ring-sky-100/60">
              <div className="flex gap-3 border-l-[3px] border-sky-500 bg-white/55 px-3 py-3 pl-[14px] backdrop-blur-[1px]">
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 ring-1 ring-sky-500/25"
                  aria-hidden
                >
                  <Zap className="size-3.5" strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div>
                    <p className="text-lg font-normal tracking-tight text-slate-900">New initiative</p>
                    <p className="mt-1 text-[12px] leading-snug text-slate-600">
                      Starts in the backlog; schedule it on the roadmap when you are ready.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={inlineInitiativeInputRef}
                      type="text"
                      value={inlineNewInitiativeTitle}
                      onChange={(e) => setInlineNewInitiativeTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void submitInlineNewInitiative();
                        }
                        if (e.key === "Escape") {
                          setInlineNewInitiativeOpen(false);
                          setInlineNewInitiativeTitle("");
                        }
                      }}
                      placeholder="Name your initiative…"
                      autoComplete="off"
                      className="h-8 min-w-0 flex-1 rounded-lg border border-sky-200/90 bg-white px-2.5 text-[13px] text-slate-900 shadow-inner shadow-sky-900/5 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-200/80"
                      aria-label="New initiative title"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 shrink-0 gap-1 bg-sky-600 px-2 text-[12px] font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50"
                      disabled={inlineNewInitiativeSubmitting || inlineNewInitiativeTitle.trim().length < 2}
                      onClick={() => void submitInlineNewInitiative()}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Add
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-[12px] text-slate-600 hover:bg-sky-50 hover:text-slate-900"
                      onClick={() => {
                        setInlineNewInitiativeOpen(false);
                        setInlineNewInitiativeTitle("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {showInitiativeBacklogDrop ? (
            <div
              ref={setBacklogDropRef}
              className="pointer-events-auto -mb-2 h-2 w-full max-w-full shrink-0 opacity-0"
              aria-hidden
            />
          ) : null}
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[15px] font-medium tracking-[0.01em] text-slate-900">
              {panelQuarterQuickFilter
                ? `${panelQuarterQuickFilter} Initiatives (${filteredInitiatives.length})`
                : `Initiatives (${filteredInitiatives.length})`}
            </h3>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                title="Expand all initiatives"
                aria-label="Expand all initiatives"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                onClick={() =>
                  setOpenInitiativeIds(
                    Object.fromEntries(filteredInitiatives.map((i) => [i.id, true])),
                  )
                }
              >
                <ChevronsDown className="size-4" />
              </button>
              <button
                type="button"
                title="Collapse all initiatives"
                aria-label="Collapse all initiatives"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setOpenInitiativeIds({})}
              >
                <ChevronsUp className="size-4" />
              </button>
            </div>
          </div>
          {filteredInitiatives.length === 0 ? (
            <p className="rounded-md border border-slate-200/80 bg-white p-3 text-[12px] leading-4 text-slate-600">
              {initiativeList.length === 0
                ? "No initiatives yet. Add one to begin planning."
                : "No initiatives match your filters/search."}
            </p>
          ) : (
            <>
              <BacklogDropSlot index={0} />
              {filteredInitiatives.map((initiativeRaw, idx) => {
                // Trim down the initiative's epic list to those matching
                // the active health verdict filter — keeps the expanded
                // tree consistent with the verdict the planner picked
                // (otherwise expanding an "Overdue"-filtered initiative
                // would show all its epics, not just the overdue ones).
                const initiative =
                  healthFilter && healthFilter.size > 0
                    ? {
                        ...initiativeRaw,
                        epics: (initiativeRaw.epics ?? []).filter((epic) => {
                          const verdict = healthByEpicId.get(epic.id);
                          return verdict != null && healthFilter.has(verdict);
                        }),
                      }
                    : initiativeRaw;
                return (
                <div key={initiative.id}>
                  <InitiativeTreeCard
                    initiative={initiative}
                    // Search overrides the user's manual toggle — when the
                    // query matches an epic / story inside this initiative,
                    // force the card open so the match is visible.
                    isOpen={
                      searchExpandedInitiativeIds.has(initiative.id) ||
                      (openInitiativeIds[initiative.id] ?? false)
                    }
                    forceOpenEpicIds={searchExpandedEpicIds}
                    searchQuery={searchQueryLower}
                    isSprintModeActive={isSprintModeActive}
                    backlogDropIndex={idx}
                    planContextMonth={activeMonth}
                    epicPlanDragEnabled={epicPlanDragEnabled}
                    isCapacityPlanningMode={isCapacityPlanningMode}
                    storyProgressDetailsVisible={storyProgressDetailsVisible}
                            progressBasis={progressBasis}
                    workspaceDirectoryUsers={workspaceDirectoryUsers}
                    isEpicDimmed={isHighlightActive ? isEpicDimmed : undefined}
                    showTeamChips={showTeamChips}
                    showHealthChips={showHealthChips}
                    showStatusChips={showStatusChips}
                    onOpenInsights={onOpenInsights}
                    onToggle={() => {
                      const next = !(openInitiativeIds[initiative.id] ?? false);
                      setOpenInitiativeIds((prev) => ({ ...prev, [initiative.id]: next }));
                      onInitiativeAccordionChange?.(initiative.id, next);
                    }}
                    onEditInitiative={onEditInitiative}
                    onDeleteInitiative={onDeleteInitiative}
                    onOpenEpic={onOpenEpic}
                    onOpenStory={onOpenStory}
                    onDeleteEpic={onDeleteEpic}
                    onCreateEpicQuick={onCreateEpicQuick}
                    onCreateStoryQuick={onCreateStoryQuick}
                    onEpicAccordionChange={onEpicAccordionChange}
                  />
                  <BacklogDropSlot index={idx + 1} />
                </div>
                );
              })}
            </>
          )}
        </div>
      )}
        </div>
      </div>
    </aside>
  );
}

function StoryDragHandle({ storyId }: { storyId: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: storyListDraggableId(storyId),
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={cn(
        "shrink-0 cursor-grab rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing",
        isDragging && "opacity-60",
      )}
      aria-label="Drag user story"
      {...attributes}
      {...listeners}
    >
      <DragHandleIcon size="sm" />
    </button>
  );
}
