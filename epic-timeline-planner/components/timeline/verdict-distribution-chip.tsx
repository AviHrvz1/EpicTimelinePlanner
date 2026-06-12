"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { HealthStatus } from "@/lib/progress";
import { cn } from "@/lib/utils";

/**
 * Per-verdict tally for one row. Sum across keys should match the row's
 * total in-scope work-item count (epics for team rows, stories for user
 * rows + Sprint Load rows).
 */
export type VerdictBuckets = Record<HealthStatus, number>;

/**
 * Visual order of segments inside the bar — Done first (left), Overdue
 * last (right). Severity rises left → right so the eye naturally lands
 * on the right edge for problems.
 */
const SEGMENT_ORDER: HealthStatus[] = ["done", "onTrack", "watch", "atRisk", "overdue"];

/**
 * Segment fills — saturated hex equivalents of the `STATUS_META`
 * palette in `health-badge.tsx`. Inlined as hex (rather than Tailwind
 * classes) because each segment renders as a CSS `flex-grow` element
 * with `backgroundColor` — class-based bg colors don't compose with
 * `style.flexGrow` without a wrapper element per segment.
 */
const SEGMENT_FILL: Record<HealthStatus, string> = {
  done: "#10b981",
  onTrack: "#a7f3d0",
  watch: "#fde68a",
  atRisk: "#fecaca",
  overdue: "#fda4af",
};

const VERDICT_LABEL: Record<HealthStatus, string> = {
  done: "Done",
  onTrack: "On Track",
  watch: "Watch",
  atRisk: "At Risk",
  overdue: "Overdue",
};

/**
 * Compact horizontal segmented bar showing the proportion of in-scope
 * work items in each health bucket, with a total count beside it. Used
 * by Team Progress, Sprint Load, and the Hero `TeamProgressCard` in
 * place of a single worst-of-children verdict word — the proportion IS
 * the information, so the chip can't misrepresent a mixed-state team.
 *
 * When `popoverBody` is supplied, clicking the chip toggles a portaled
 * popover with that body. The popover opens ABOVE the chip (anchored
 * by its bottom edge) since these chips usually sit near the bottom of
 * a scroll-clipped card and a downward popover would clip. Click-
 * outside or Escape closes.
 *
 * Visual order of segments: Done → On Track → Watch → At Risk → Overdue,
 * left → right by severity. The red overdue sliver sits where the eye
 * lands last (right edge) so even a 1-of-50 overdue epic registers as
 * "look here" without screaming.
 */
export function VerdictDistributionChip({
  buckets,
  total,
  ariaLabel,
  popoverBody,
  unitLabel = "epic",
  size = "sm",
  className,
}: {
  buckets: VerdictBuckets;
  /** Pre-computed sum of all bucket values. Passed in (rather than
   *  re-summed inside the chip) so callers can use the same number
   *  they show elsewhere on the row without risk of drift. */
  total: number;
  /** Descriptive label for screen readers, e.g. "Mobile — health distribution". */
  ariaLabel: string;
  /** When supplied, clicking the chip toggles a portaled popover with
   *  this body. Omit for a read-only chip (no click handler attached). */
  popoverBody?: ReactNode;
  /** Used in per-segment `title=""` tooltips and ARIA — "3 epics On
   *  Track" vs "3 stories On Track". */
  unitLabel?: "epic" | "story";
  /** Visual size — `xs` for dense surfaces (Sprint Load), `sm` for the
   *  default Team Progress / Hero density. */
  size?: "xs" | "sm";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  // Anchor the popover by its BOTTOM edge so it stays 6px above the
  // chip regardless of the popover's own height (which varies with
  // how many flagged items the parent lists). Mirrors the positioning
  // model in `TeamHealthBadgeWithList` / `SprintLoadHealthBadge`.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const popW = 384;
      const right = Math.min(window.innerWidth - 8, r.right);
      const left = Math.max(8, right - popW);
      const bottom = Math.max(8, window.innerHeight - r.top + 6);
      setPos({ left, bottom });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  // Outside-click / Escape closes. Defer the listener attach by one
  // tick so the click that opened the popover doesn't immediately
  // close it.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (wrapRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const tid = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(tid);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hasPopover = popoverBody != null;
  const barWidth = size === "xs" ? 56 : 68;
  const barHeight = size === "xs" ? 4 : 5;
  const interactive = hasPopover && total > 0;

  return (
    <span
      ref={wrapRef}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-1.5",
        interactive ? "cursor-pointer" : "cursor-default",
        className,
      )}
      onClick={interactive ? (e) => {
        e.stopPropagation();
        e.preventDefault();
        setOpen((v) => !v);
      } : undefined}
      onMouseDown={interactive ? (e) => e.stopPropagation() : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }
      } : undefined}
      aria-haspopup={interactive ? "dialog" : undefined}
      aria-expanded={interactive ? open : undefined}
      aria-label={ariaLabel}
    >
      <span
        className="inline-flex overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/70"
        style={{ width: barWidth, height: barHeight }}
        aria-hidden
      >
        {total > 0
          ? SEGMENT_ORDER.map((v) => {
              const count = buckets[v] ?? 0;
              if (count <= 0) return null;
              return (
                <span
                  key={v}
                  title={`${count} ${unitLabel}${count === 1 ? "" : "s"} ${VERDICT_LABEL[v]}`}
                  style={{
                    flexGrow: count,
                    backgroundColor: SEGMENT_FILL[v],
                  }}
                />
              );
            })
          : null}
      </span>
      <span
        className={cn(
          "tabular-nums font-semibold text-slate-500",
          size === "xs" ? "text-[10px]" : "text-[10.5px]",
        )}
        aria-hidden
      >
        {total}
      </span>
      {open && pos && typeof document !== "undefined" && hasPopover
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={ariaLabel}
              style={{ position: "fixed", left: pos.left, bottom: pos.bottom, zIndex: 1000 }}
              className="w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3.5 text-left text-slate-800 shadow-xl"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {popoverBody}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
