import { AlertOctagon, AlertTriangle, Check } from "lucide-react";

import type { HealthStatus } from "@/lib/progress";
import { cn } from "@/lib/utils";

/**
 * Text label rendered beneath a Gantt bar — mirrors the team-assignment chip's
 * visual weight so the two read as siblings. When `onClick` is set the chip
 * becomes a button (used to open insights in place of the % click target).
 */
export function HealthBadge({
  status,
  tooltip,
  onClick,
  className,
}: {
  status: HealthStatus;
  tooltip?: string;
  onClick?: () => void;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const sharedClass = cn(
    "inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[12px] font-medium leading-none ring-1",
    meta.chip,
    onClick && "cursor-pointer transition-transform duration-150 hover:scale-105 hover:brightness-105",
    className,
  );
  const content = (
    <>
      <Icon className="size-3 shrink-0" aria-hidden />
      <span>{meta.label}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        title={tooltip ?? meta.label}
        aria-label={tooltip ?? meta.label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={sharedClass}
      >
        {content}
      </button>
    );
  }
  return (
    <span title={tooltip ?? meta.label} aria-label={tooltip ?? meta.label} className={sharedClass}>
      {content}
    </span>
  );
}

const STATUS_META: Record<
  HealthStatus,
  { label: string; icon: typeof Check; chip: string }
> = {
  onTrack: {
    label: "On Track",
    icon: Check,
    chip: "bg-emerald-100 text-emerald-800 ring-emerald-300/60",
  },
  watch: {
    label: "Watch",
    icon: AlertTriangle,
    chip: "bg-amber-100 text-amber-800 ring-amber-300/60",
  },
  atRisk: {
    label: "At Risk",
    icon: AlertTriangle,
    chip: "bg-rose-100 text-rose-800 ring-rose-300/60",
  },
  overdue: {
    label: "Overdue",
    icon: AlertOctagon,
    chip: "bg-rose-200 text-rose-900 ring-rose-400/70",
  },
};

/**
 * Builds a human-readable tooltip from the health computation result. Pass
 * the relevant fields from `computeProgress`'s return.
 */
export function formatHealthTooltip(args: {
  status: HealthStatus;
  progressPercent: number;
  remainingEffort: number;
  daysRemaining: number;
  deltaDays: number;
  unestimatedCount: number;
}): string {
  const { status, progressPercent, remainingEffort, daysRemaining, deltaDays, unestimatedCount } = args;
  const label = STATUS_META[status].label;
  const parts: string[] = [`${label} · ${progressPercent}% complete`];
  if (status === "overdue") {
    parts.push(`Past deadline with ${remainingEffort}d of work remaining.`);
  } else if (remainingEffort === 0) {
    parts.push("All estimated effort burned down.");
  } else {
    parts.push(`${remainingEffort}d of work · ${daysRemaining} working days left`);
    if (deltaDays > 0) parts.push(`${deltaDays}d over budget`);
    else if (deltaDays < 0) parts.push(`${-deltaDays}d of buffer`);
  }
  if (unestimatedCount > 0) {
    parts.push(`${unestimatedCount} unestimated ${unestimatedCount === 1 ? "story" : "stories"} excluded`);
  }
  return parts.join(" · ");
}
