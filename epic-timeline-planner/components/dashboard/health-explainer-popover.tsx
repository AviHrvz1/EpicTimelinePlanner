"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Calendar,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Layers,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Slide definitions                                                  */
/* ------------------------------------------------------------------ */

type Badge = {
  icon: React.ReactNode;
  bg: string;
  fg: string;
  ring: string;
  /** Stroke color used for the slide's chart accent + footer accent. */
  accent: string;
};

const BADGE: Record<string, Badge> = {
  gantt:   { icon: <Calendar className="size-3.5" strokeWidth={2.3} />,      bg: "bg-sky-50",      fg: "text-sky-700",     ring: "ring-sky-200",     accent: "rgb(14 165 233)" },
  basis:   { icon: <Layers className="size-3.5" strokeWidth={2.2} />,        bg: "bg-indigo-50",   fg: "text-indigo-700",  ring: "ring-indigo-200",  accent: "rgb(99 102 241)" },
  intro:   { icon: <BookOpen className="size-3.5" strokeWidth={2.3} />,      bg: "bg-slate-100",   fg: "text-slate-700",   ring: "ring-slate-200",   accent: "rgb(100 116 139)" },
  onTrack: { icon: <Check className="size-3.5" strokeWidth={2.6} />,         bg: "bg-emerald-50",  fg: "text-emerald-700", ring: "ring-emerald-200", accent: "rgb(16 185 129)" },
  watch:   { icon: <AlertTriangle className="size-3.5" strokeWidth={2.2} />, bg: "bg-amber-50",    fg: "text-amber-700",   ring: "ring-amber-200",   accent: "rgb(245 158 11)" },
  atRisk:  { icon: <AlertTriangle className="size-3.5" strokeWidth={2.2} />, bg: "bg-orange-50",   fg: "text-orange-700",  ring: "ring-orange-200",  accent: "rgb(251 146 60)" },
  overdue: { icon: <AlertOctagon className="size-3.5" strokeWidth={2.2} />,  bg: "bg-rose-50",     fg: "text-rose-700",    ring: "ring-rose-200",    accent: "rgb(239 68 68)" },
  done:    { icon: <CheckCheck className="size-3.5" strokeWidth={2.4} />,    bg: "bg-blue-50",     fg: "text-blue-700",    ring: "ring-blue-200",    accent: "rgb(59 130 246)" },
};

type Annotation =
  | { kind: "delta"; atDay: number; label: string }
  | { kind: "pin"; atDay: number; label: string };

type Basis = "stories" | "story_days" | "epic_days";

const BASIS_LABELS: Record<Basis, string> = {
  stories: "Stories Completed (%)",
  story_days: "Σ | Child Est (d)",
  epic_days: "Epic Est (d)",
};

/** Per-basis chart + headline data for a verdict slide. */
type BasisVariant = {
  actualLine: number[];
  totalDays: number;
  totalEffort: number;
  yAxisUnit: string;
  yAxisTitle: string;
  exampleHeadline: string;
  annotation: Annotation;
};

type Slide = {
  key: string;
  /** Title chip text (short, e.g. "On Track"). */
  title: string;
  /** One-line header subtitle. */
  question: string;
  badge: Badge;
  /** Right-pane body — list of <p>/<ul> blocks. */
  paragraphs: React.ReactNode[];
  /** Threshold rule, monospace. */
  rule?: string;
  /** Headline pill shown above the prose, accent-tinted. */
  exampleHeadline?: string;
  /** Actual remaining line — one y-value per working day. */
  actualLine: number[];
  /** Annotation drawn on the chart. */
  annotation?: Annotation;
  /** Override total working days (X axis range). */
  totalDays?: number;
  /** Override total effort (Y axis range). */
  totalEffort?: number;
  /** Y axis unit label appended to tick values ("d" by default). */
  yAxisUnit?: string;
  /** Y axis title text ("Days of effort remaining" by default). */
  yAxisTitle?: string;
  /** When provided, replaces the burndown chart on the left pane with a
   *  custom visualization (used by the basis slide). */
  customLeftPane?: React.ReactNode;
  /** Per-basis variants. When present, the verdict slide renders a basis
   *  toggle in the right pane and the chart + headline switch with it. */
  byBasis?: Record<Basis, BasisVariant>;
};

const SLIDES: Slide[] = [
  {
    key: "basis",
    title: "Health calculation",
    question: "Three ways we count progress",
    badge: BADGE.basis,
    paragraphs: [
      <p key="p1">
        The dashboard lets you pick how progress is measured. The toggle at the top of
        the Roadmap Health hero switches between three modes:
      </p>,
      <ul key="p2" className="ml-4 list-disc space-y-2 text-[13px] text-slate-700">
        <li>
          <strong>Stories Completed (%)</strong>: count of stories in Review/Done out of the total.
          Simplest, ignores effort. A 1-day story and a 10-day story count the same.
        </li>
        <li>
          <strong>Σ | Child Est (d)</strong>: sum of every story's{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] font-mono">estimatedDays</code>{" "}
          as the baseline. Most granular once every story has been estimated.
        </li>
        <li>
          <strong>Epic Est (d)</strong> (default): uses the epic's own{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] font-mono">originalEstimateDays</code>{" "}
          as the baseline. Works from the moment the epic is created, before any
          stories have been broken down. That's why it's the default.
        </li>
      </ul>,
      <p key="p3">
        The Δ verdict logic on the rest of the slides is the same in every mode. What
        changes is only the units on the Y axis (or, for Stories mode, the % count
        shown).
      </p>,
    ],
    rule: "Choose the basis on the dashboard · Δ thresholds apply identically across all three",
    actualLine: [],
    customLeftPane: <BasisIllustration />,
  },
  {
    key: "intro",
    title: "Health at a glance",
    question: "How we determine an epic's health?",
    badge: BADGE.gantt,
    paragraphs: [
      <p key="p1">
        We measure an epic's health by comparing its <strong>actual progress</strong> to
        its <strong>planned pace</strong>, inside the window the planner set on the
        Gantt.
      </p>,
      <p key="p2">
        The <strong>X axis</strong> is the count of <strong>working days</strong>{" "}
        between the epic's start and end dates on the Gantt (Saturdays and Sundays
        don't tick).
      </p>,
      <p key="p3">
        The <strong>Y axis</strong> starts at the baseline you chose with the basis
        toggle — by default that's the epic's{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] font-mono">Days Est</code>{" "}
        field on the details form (40 in the example below). Switch the toggle and the
        Y title, ticks, and callout update to match.
      </p>,
      <p key="p4">
        The orange dashed line is the <strong>ideal pace</strong>, a straight slope from the baseline at Day 0 down to zero on the last day. The blue line is the{" "}
        <strong>actual remaining work</strong>, recalculated every day from the open
        stories.
      </p>,
      <p key="p5">
        Health is decided by where the blue line sits versus the orange one{" "}
        <em>right now</em>. If they hug each other the epic is healthy. The further the
        blue drifts above, the worse the verdict.
      </p>,
    ],
    rule: "Health = where actual line sits relative to ideal line at today",
    actualLine: [],
    // Stub variants — the intro slide renders the GanttContextIllustration
    // (a `customLeftPane`-shaped React node, special-cased in the slide
    // render to receive the live `basis` prop), so these BasisVariant
    // values aren't actually consumed. They exist only so `slide.byBasis`
    // is truthy and the BasisToggle UI appears.
    byBasis: {
      epic_days: { actualLine: [], totalDays: 20, totalEffort: 40, yAxisUnit: "d", yAxisTitle: "", exampleHeadline: "", annotation: { kind: "pin", atDay: 0, label: "" } },
      story_days: { actualLine: [], totalDays: 20, totalEffort: 40, yAxisUnit: "d", yAxisTitle: "", exampleHeadline: "", annotation: { kind: "pin", atDay: 0, label: "" } },
      stories: { actualLine: [], totalDays: 20, totalEffort: 40, yAxisUnit: "%", yAxisTitle: "", exampleHeadline: "", annotation: { kind: "pin", atDay: 0, label: "" } },
    },
  },
  {
    key: "onTrack",
    title: "On Track",
    question: "How we determined On Track?",
    badge: BADGE.onTrack,
    paragraphs: [
      <p key="p1">
        The team is keeping up. The actual line sits <em>on</em> the ideal line or no
        more than one working day above it. Whichever basis you pick, the verdict is the
        same: progress closely matches the steady pace the plan assumed.
      </p>,
      <p key="p2">
        <strong>At the story level:</strong> stories are entering Review/Done roughly
        when they should. If a few overrun their estimates, others completing early are
        making up for it.
      </p>,
    ],
    rule: "Δ ≤ 1 working day above the ideal line",
    actualLine: [],
    byBasis: {
      stories: {
        actualLine: [5, 5, 4, 4, 4, 4, 3, 3, 3, 2, 2],
        totalDays: 20,
        totalEffort: 5,
        yAxisUnit: "",
        yAxisTitle: "Stories",
        exampleHeadline: "Day 10 of 20 · 3 of 5 stories Review or Done (60%) · ideal 50% → On Track",
        annotation: { kind: "delta", atDay: 10, label: "3 vs 2.5" },
      },
      story_days: {
        actualLine: [40, 38, 36, 34, 31, 29, 26.5, 25, 23.5, 22, 21],
        totalDays: 20,
        totalEffort: 40,
        yAxisUnit: "d",
        yAxisTitle: "Σ | Child Est (d)",
        exampleHeadline: "Day 10 of 20 · 21 days remaining · ideal = 20 · Δ = +1 → On Track",
        annotation: { kind: "delta", atDay: 10, label: "Δ = +1" },
      },
      epic_days: {
        actualLine: [35, 33, 31, 30, 27, 25, 23, 22, 21, 19, 18],
        totalDays: 20,
        totalEffort: 35,
        yAxisUnit: "d",
        yAxisTitle: "Epic Est (d)",
        exampleHeadline: "Day 10 of 20 · 18 days remaining · ideal = 17.5 · Δ = +0.5 → On Track",
        annotation: { kind: "delta", atDay: 10, label: "Δ = +0.5" },
      },
    },
  },
  {
    key: "watch",
    title: "Watch",
    question: "How we determined Watch?",
    badge: BADGE.watch,
    paragraphs: [
      <p key="p1">
        The team is slipping but not yet in trouble. The actual line has drifted above
        the ideal by 1 to 4 working days. Worth a quick check on what's blocking, but no
        escalation needed yet.
      </p>,
      <p key="p2">
        <strong>At the story level:</strong> one or two stories are taking longer than
        estimated (their{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] font-mono">daysLeft</code>{" "}
        isn't dropping as fast as time is passing), or a Review story has bounced back
        into In Progress.
      </p>,
    ],
    rule: "1 < Δ < 4 working days above the ideal line",
    actualLine: [],
    byBasis: {
      stories: {
        actualLine: [5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4],
        totalDays: 20,
        totalEffort: 5,
        yAxisUnit: "",
        yAxisTitle: "Stories",
        exampleHeadline: "Day 10 of 20 · 1 of 5 stories done (20%) · ideal 50% → Watch",
        annotation: { kind: "delta", atDay: 10, label: "4 vs 2.5" },
      },
      story_days: {
        actualLine: [40, 39, 37, 35, 33, 31, 29, 27, 25.5, 24, 23],
        totalDays: 20,
        totalEffort: 40,
        yAxisUnit: "d",
        yAxisTitle: "Σ | Child Est (d)",
        exampleHeadline: "Day 10 of 20 · 23 days remaining · ideal = 20 · Δ = +3 → Watch",
        annotation: { kind: "delta", atDay: 10, label: "Δ = +3" },
      },
      epic_days: {
        actualLine: [35, 34, 33, 31, 29, 27.5, 26, 24.5, 23, 21.5, 20.5],
        totalDays: 20,
        totalEffort: 35,
        yAxisUnit: "d",
        yAxisTitle: "Epic Est (d)",
        exampleHeadline: "Day 10 of 20 · 20.5 days remaining · ideal = 17.5 · Δ = +3 → Watch",
        annotation: { kind: "delta", atDay: 10, label: "Δ = +3" },
      },
    },
  },
  {
    key: "atRisk",
    title: "At Risk",
    question: "How we determined At Risk?",
    badge: BADGE.atRisk,
    paragraphs: [
      <p key="p1">
        The team is clearly behind. The actual line sits 4+ working days above the
        ideal. Without intervention (scoping work out, adding help, or pushing the end
        date), this epic will overrun.
      </p>,
      <p key="p2">
        <strong>At the story level:</strong> several stories are stuck in Todo or In
        Progress past where they should be, and the sum of their{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] font-mono">daysLeft</code>{" "}
        exceeds what fits in the remaining calendar.
      </p>,
    ],
    rule: "Δ ≥ 4 working days above the ideal line",
    actualLine: [],
    byBasis: {
      stories: {
        actualLine: [5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4],
        totalDays: 20,
        totalEffort: 5,
        yAxisUnit: "",
        yAxisTitle: "Stories",
        exampleHeadline: "Day 10 of 20 · 1 of 5 stories done (20%) · ideal 50% → At Risk",
        annotation: { kind: "delta", atDay: 10, label: "4 vs 2.5" },
      },
      story_days: {
        actualLine: [40, 39.5, 38.5, 37, 35.5, 33.5, 32, 30, 28, 26.5, 25],
        totalDays: 20,
        totalEffort: 40,
        yAxisUnit: "d",
        yAxisTitle: "Σ | Child Est (d)",
        exampleHeadline: "Day 10 of 20 · 25 days remaining · ideal = 20 · Δ = +5 → At Risk",
        annotation: { kind: "delta", atDay: 10, label: "Δ = +5" },
      },
      epic_days: {
        actualLine: [35, 34.5, 33.5, 32.5, 31, 29.5, 28, 26.5, 25, 23.5, 22.5],
        totalDays: 20,
        totalEffort: 35,
        yAxisUnit: "d",
        yAxisTitle: "Epic Est (d)",
        exampleHeadline: "Day 10 of 20 · 22.5 days remaining · ideal = 17.5 · Δ = +5 → At Risk",
        annotation: { kind: "delta", atDay: 10, label: "Δ = +5" },
      },
    },
  },
  {
    key: "overdue",
    title: "Overdue",
    question: "How we determined Overdue?",
    badge: BADGE.overdue,
    paragraphs: [
      <p key="p1">
        The end date is already in the past and the epic isn't done yet. Overdue
        overrides every other verdict. Even if the team is burning fast right now, the
        calendar is already wrong.
      </p>,
      <p key="p2">
        <strong>At the story level:</strong> at least one story is still not in Done (or
        Review, depending on workflow) when the plan said the whole epic should already
        be wrapped. The fix is either pushing the epic's end date or finishing the open
        stories.
      </p>,
    ],
    rule: "Now is past the end date AND progress < 100%",
    actualLine: [],
    byBasis: {
      stories: {
        actualLine: [5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1],
        totalDays: 20,
        totalEffort: 5,
        yAxisUnit: "",
        yAxisTitle: "Stories",
        exampleHeadline: "End was Day 20 · Today is Day 22 · 1 of 5 stories still open → Overdue",
        annotation: { kind: "pin", atDay: 22, label: "Past end · 1 open" },
      },
      story_days: {
        actualLine: [40, 38, 36, 34, 31, 29, 26, 24, 22, 20, 18, 16, 14, 12, 11, 10, 9, 8, 7, 5, 4, 4, 4],
        totalDays: 20,
        totalEffort: 40,
        yAxisUnit: "d",
        yAxisTitle: "Σ | Child Est (d)",
        exampleHeadline: "End was Day 20 · Today is Day 22 · 4 days still remain → Overdue",
        annotation: { kind: "pin", atDay: 22, label: "Past end · 4 days left" },
      },
      epic_days: {
        actualLine: [35, 33, 31, 29, 27, 25, 23, 21, 19, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3.5, 3.5, 3.5],
        totalDays: 20,
        totalEffort: 35,
        yAxisUnit: "d",
        yAxisTitle: "Epic Est (d)",
        exampleHeadline: "End was Day 20 · Today is Day 22 · 3.5 days from budget still remain → Overdue",
        annotation: { kind: "pin", atDay: 22, label: "Past end · 3.5d left" },
      },
    },
  },
  {
    key: "done",
    title: "Done",
    question: "How we determined Done?",
    badge: BADGE.done,
    paragraphs: [
      <p key="p1">
        Every piece of work in the epic is finished. The actual line has reached zero
        before (or on) the end date. There is nothing left to burn.
      </p>,
      <p key="p2">
        <strong>At the story level:</strong> every child story is in <em>Review</em> or{" "}
        <em>Done</em>. The sum of their remaining{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] font-mono">daysLeft</code>{" "}
        is zero, and the epic-est budget has fully burnt down at the same pace. Done
        overrides On Track / Watch / At Risk because there is no work left to evaluate.
      </p>,
      <p key="p3">
        Done is also the only verdict where the chart's <em>actual</em> line meets the X
        axis. From that moment forward, the epic stops drifting upward against the
        ideal line because there is nothing left to drift.
      </p>,
    ],
    rule: "progress ≥ 100% (in the selected basis)",
    actualLine: [],
    byBasis: {
      stories: {
        actualLine: [5, 5, 4, 4, 3, 3, 3, 2, 2, 1, 0],
        totalDays: 20,
        totalEffort: 5,
        yAxisUnit: "",
        yAxisTitle: "Stories",
        exampleHeadline: "Day 10 of 20 · 5 of 5 stories Review or Done (100%) → Done",
        annotation: { kind: "pin", atDay: 10, label: "All 5 stories done" },
      },
      story_days: {
        actualLine: [40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 0],
        totalDays: 20,
        totalEffort: 40,
        yAxisUnit: "d",
        yAxisTitle: "Σ | Child Est (d)",
        exampleHeadline: "Day 10 of 20 · 0 days remaining · 100% burnt → Done",
        annotation: { kind: "pin", atDay: 10, label: "0d remaining" },
      },
      epic_days: {
        actualLine: [35, 31.5, 28, 24.5, 21, 17.5, 14, 10.5, 7, 3.5, 0],
        totalDays: 20,
        totalEffort: 35,
        yAxisUnit: "d",
        yAxisTitle: "Epic Est (d)",
        exampleHeadline: "Day 10 of 20 · 0 days remaining · budget fully burnt → Done",
        annotation: { kind: "pin", atDay: 10, label: "0d remaining" },
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/* Popover shell                                                      */
/* ------------------------------------------------------------------ */

type Props = {
  open: boolean;
  onClose: () => void;
};

export function HealthExplainerPopover({ open, onClose }: Props) {
  const [index, setIndex] = useState(0);
  // Selected basis persists across verdict slides while the popover is open.
  // Defaults to story_days (the dashboard's default selection).
  // Default matches the dashboard's own default (`epicEst` in epic-planner-app.tsx)
  // so the explainer's first verdict slide reflects what the user actually sees on
  // the dashboard. Story est days is only meaningful once stories have been
  // decomposed and estimated; epic est days works from day 1 of planning.
  const [basis, setBasis] = useState<Basis>("epic_days");

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setBasis("epic_days");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((i) => Math.min(SLIDES.length - 1, i + 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const slide = SLIDES[index];
  // Verdict slides have basis-specific chart + headline data. Overlay
  // the selected basis variant onto the slide for rendering.
  const variant = slide.byBasis ? slide.byBasis[basis] : null;
  const chartActualLine = variant ? variant.actualLine : slide.actualLine;
  const chartTotalDays = variant ? variant.totalDays : slide.totalDays ?? 20;
  const chartTotalEffort = variant ? variant.totalEffort : slide.totalEffort ?? 40;
  const chartAnnotation = variant ? variant.annotation : slide.annotation;
  const chartYAxisUnit = variant ? variant.yAxisUnit : slide.yAxisUnit ?? "d";
  const chartYAxisTitle = variant ? variant.yAxisTitle : slide.yAxisTitle ?? "Days of effort remaining";
  const activeExampleHeadline = variant ? variant.exampleHeadline : slide.exampleHeadline;
  const atFirst = index === 0;
  const atLast = index === SLIDES.length - 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[9900] flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px] px-4 py-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="How health is calculated"
    >
      <div
        className="relative flex w-full max-w-[1040px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_-12px_rgba(15,23,42,0.45)] ring-1 ring-black/5"
        onClick={(event) => event.stopPropagation()}
        style={{ borderTop: `3px solid ${slide.badge.accent}` }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1",
                  slide.badge.bg,
                  slide.badge.fg,
                  slide.badge.ring,
                )}
              >
                {slide.badge.icon}
                {slide.title}
              </span>
              <span className="text-[11px] font-medium tabular-nums text-slate-400">
                {index + 1} / {SLIDES.length}
              </span>
            </div>
            <h2 className="mt-2 text-[18px] font-semibold leading-tight tracking-tight text-slate-900">
              {slide.question}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* Body — two-column on wide layouts */}
        <div className="grid gap-6 px-6 pb-5 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="rounded-xl bg-slate-50/60 p-3 ring-1 ring-slate-200/70">
            {/* The intro slide's custom illustration needs the live basis
                so its Y title, Y tick labels, and "Days Est" callout update
                with the toggle. Other slides either use a static custom
                pane (e.g. the basis-overview slide) or the BurndownExample
                fed by byBasis values. */}
            {slide.key === "intro" ? (
              <GanttContextIllustration basis={basis} />
            ) : slide.customLeftPane ?? (
              <BurndownExample
                actualLine={chartActualLine}
                totalDays={chartTotalDays}
                totalEffort={chartTotalEffort}
                annotation={chartAnnotation}
                accent={slide.badge.accent}
                yAxisUnit={chartYAxisUnit}
                yAxisTitle={chartYAxisTitle}
                showGanttStrip={Boolean(slide.byBasis)}
              />
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            {slide.byBasis ? (
              <BasisToggle value={basis} onChange={setBasis} accent={slide.badge.accent} />
            ) : null}
            {activeExampleHeadline ? (
              <div
                className="rounded-md px-3 py-2 text-[12.5px] font-semibold tabular-nums"
                style={{
                  background: `color-mix(in srgb, ${slide.badge.accent} 10%, white)`,
                  color: slide.badge.accent,
                  border: `1px solid color-mix(in srgb, ${slide.badge.accent} 28%, white)`,
                }}
              >
                {activeExampleHeadline}
              </div>
            ) : null}
            <div className="space-y-3 text-[13.5px] leading-relaxed text-slate-700">
              {slide.key === "intro"
                ? renderIntroParagraphs(basis)
                : slide.key === "atRisk"
                  ? renderAtRiskParagraphs(basis)
                  : slide.key === "done"
                    ? renderDoneParagraphs(basis)
                    : slide.paragraphs}
            </div>
            {slide.rule ? (
              <div className="mt-auto rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                  Rule
                </div>
                <div className="mt-0.5 break-words font-mono text-[12px] text-slate-700">
                  {slide.rule}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200/70 bg-slate-50/40 px-4 py-3">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={atFirst}
            aria-label="Previous slide"
            className={cn(
              "inline-flex h-9 items-center gap-1 rounded-md px-3 text-[13px] font-medium transition-colors",
              atFirst
                ? "cursor-not-allowed text-slate-300"
                : "text-slate-700 hover:bg-white hover:shadow-sm",
            )}
          >
            <ChevronLeft className="size-4" aria-hidden />
            Back
          </button>

          <div className="flex items-center gap-1.5" role="tablist" aria-label="Slides">
            {SLIDES.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Go to ${s.title}`}
                aria-selected={i === index}
                role="tab"
                className={cn(
                  "h-2 rounded-full transition-all",
                  i === index ? "w-6" : "w-2 bg-slate-300 hover:bg-slate-400",
                )}
                style={i === index ? { background: s.badge.accent } : undefined}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(SLIDES.length - 1, i + 1))}
            disabled={atLast}
            aria-label="Next slide"
            className={cn(
              "inline-flex h-9 items-center gap-1 rounded-md px-3 text-[13px] font-medium transition-colors",
              atLast
                ? "cursor-not-allowed text-slate-300"
                : "text-slate-700 hover:bg-white hover:shadow-sm",
            )}
          >
            Next
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Burndown SVG                                                       */
/* ------------------------------------------------------------------ */

// Conventional burndown colors. Verdict color stays on the chrome (badge,
// headline pill, Δ label, dot indicator), but the chart itself is always
// blue (actual) + orange (ideal) for cross-slide consistency.
const ACTUAL_BLUE = "rgb(37 99 235)";
const IDEAL_ORANGE = "rgb(249 115 22)";

// Hard-coded calendar dates for the running example epic: 20 working days
// from Mar 16 → Apr 12. Index by day number (Day 0 = Mar 16). 23 entries
// so the Overdue slide (Day 22) is covered too.
const DAY_TO_DATE = [
  "Mar 16", "Mar 17", "Mar 18", "Mar 19", "Mar 20",
  "Mar 23", "Mar 24", "Mar 25", "Mar 26", "Mar 27",
  "Mar 30", "Mar 31", "Apr 1",  "Apr 2",  "Apr 3",
  "Apr 6",  "Apr 7",  "Apr 8",  "Apr 9",  "Apr 10",
  "Apr 12", "Apr 13", "Apr 14",
];

function dateForDay(d: number): string {
  if (d < 0) return DAY_TO_DATE[0];
  if (d >= DAY_TO_DATE.length) return DAY_TO_DATE[DAY_TO_DATE.length - 1];
  return DAY_TO_DATE[d];
}

function BurndownExample({
  actualLine: actualLineFull,
  totalDays,
  totalEffort,
  annotation,
  accent,
  yAxisUnit = "d",
  yAxisTitle = "Days of effort remaining",
  showGanttStrip = false,
  useDateLabels = false,
}: {
  actualLine: number[];
  totalDays: number;
  totalEffort: number;
  annotation?: Annotation;
  accent: string;
  yAxisUnit?: string;
  yAxisTitle?: string;
  /** When true, renders a mini Gantt strip below the burndown showing the
   *  same window with a "Today" vertical line at the annotation day. */
  showGanttStrip?: boolean;
  /** When true, X axis labels show calendar dates (Mar 16, Mar 30, Apr 12)
   *  instead of "Day 0 / Day 10 / Day 20". Used on the intro slide. */
  useDateLabels?: boolean;
}) {
  const W = 540;
  // Total SVG height: add a Gantt strip when requested. 130px gives room
  // for the "Today" pill + downward triangle on top (matches the planner's
  // Gantt today indicator), then the month band, epic bar, and start/end
  // labels below.
  const GANTT_H = showGanttStrip ? 130 : 0;
  const H = 310 + GANTT_H;
  const PAD_L = 72;
  const PAD_R = 18;
  const PAD_T = 24;
  // X-axis labels and title live in the original 60px bottom band; the Gantt
  // strip lives BELOW that band.
  const PAD_B = 60 + GANTT_H;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const ganttTop = H - GANTT_H + 6;

  // The actual line should only run from Day 0 up to "today". For delta-
  // annotated slides, "today" is annotation.atDay. For Overdue (pin) and
  // the intro slide, render the full line as supplied.
  const actualLine = useMemo(() => {
    if (annotation && annotation.kind === "delta") {
      return actualLineFull.slice(0, annotation.atDay + 1);
    }
    return actualLineFull;
  }, [actualLineFull, annotation]);

  const lastDay = actualLineFull.length - 1;
  const xMax = Math.max(totalDays, lastDay);

  const xFor = useMemo(
    () => (d: number) => PAD_L + (d / Math.max(1, xMax)) * plotW,
    [xMax, plotW],
  );
  const yFor = useMemo(
    () => (effort: number) => PAD_T + (1 - Math.min(1, Math.max(0, effort / totalEffort))) * plotH,
    [totalEffort, plotH],
  );

  const idealStartX = xFor(0);
  const idealStartY = yFor(totalEffort);
  const idealEndX = xFor(totalDays);
  const idealEndY = yFor(0);

  const actualPath = actualLine
    .map((y, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(y).toFixed(2)}`)
    .join(" ");

  const yTickStep = totalEffort > 0 ? totalEffort / 4 : 1;
  const yTicks = Array.from({ length: 5 }, (_, i) => i * yTickStep);

  // Major X labels: 0, mid, totalDays, and the last-day overflow point (Overdue).
  const xMajorDays = useMemo(() => {
    const set = new Set<number>();
    set.add(0);
    set.add(Math.round(totalDays / 2));
    set.add(totalDays);
    if (lastDay > totalDays) set.add(lastDay);
    return Array.from(set).sort((a, b) => a - b);
  }, [totalDays, lastDay]);

  // Delta bracket geometry (only for "delta" annotation type).
  const delta = useMemo(() => {
    if (!annotation || annotation.kind !== "delta") return null;
    const day = annotation.atDay;
    const actualY = actualLine[Math.min(day, actualLine.length - 1)];
    const idealY = totalDays > 0 ? totalEffort * Math.max(0, 1 - day / totalDays) : 0;
    const x = xFor(day);
    const yI = yFor(idealY);
    const yA = yFor(actualY);
    return { day, actualY, idealY, x, yI, yA, label: annotation.label };
  }, [annotation, actualLine, totalDays, totalEffort, xFor, yFor]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" aria-hidden role="img">
      <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="white" />

      {/* Y gridlines */}
      {yTicks.map((t, i) => {
        const y = yFor(t);
        return (
          <line
            key={`hg-${i}`}
            x1={PAD_L}
            y1={y}
            x2={W - PAD_R}
            y2={y}
            stroke={i === 0 || i === yTicks.length - 1 ? "rgb(203 213 225)" : "rgb(226 232 240)"}
            strokeWidth={1}
            strokeDasharray={i === 0 || i === yTicks.length - 1 ? undefined : "3 3"}
          />
        );
      })}

      {/* Axis lines */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} stroke="rgb(148 163 184)" strokeWidth={1.25} />
      <line x1={PAD_L} y1={PAD_T + plotH} x2={W - PAD_R} y2={PAD_T + plotH} stroke="rgb(148 163 184)" strokeWidth={1.25} />

      {/* Y tick marks + labels */}
      {yTicks.map((t, i) => {
        const y = yFor(t);
        return (
          <g key={`yt-${i}`}>
            <line x1={PAD_L - 5} y1={y} x2={PAD_L} y2={y} stroke="rgb(148 163 184)" strokeWidth={1} />
            <text
              x={PAD_L - 9}
              y={y + 4}
              textAnchor="end"
              className="fill-slate-600"
              style={{ fontSize: 10.5, fontWeight: 500 }}
            >
              {Math.round(t)}{yAxisUnit}
            </text>
          </g>
        );
      })}

      {/* X minor ticks at every day, no label */}
      {Array.from({ length: xMax + 1 }, (_, d) => d).map((d) => {
        if (xMajorDays.includes(d)) return null;
        const x = xFor(d);
        return (
          <line
            key={`xtm-${d}`}
            x1={x}
            y1={PAD_T + plotH}
            x2={x}
            y2={PAD_T + plotH + 3}
            stroke="rgb(148 163 184)"
            strokeWidth={1}
          />
        );
      })}

      {/* X major ticks + label (date when useDateLabels, "Day N" otherwise) */}
      {xMajorDays.map((d) => {
        const x = xFor(d);
        return (
          <g key={`xtM-${d}`}>
            <line x1={x} y1={PAD_T + plotH} x2={x} y2={PAD_T + plotH + 6} stroke="rgb(100 116 139)" strokeWidth={1.25} />
            <text
              x={x}
              y={PAD_T + plotH + 20}
              textAnchor="middle"
              className="fill-slate-600"
              style={{ fontSize: 11, fontWeight: 600 }}
            >
              {useDateLabels ? dateForDay(d) : `Day ${d}`}
            </text>
            {/* Sub-label with the calendar date below the working-day label,
                so viewers can map "Day 10" back to the actual Mar 30 date
                without flipping between slides. Skipped in date-label mode
                (intro slide) to avoid showing the date twice. */}
            {!useDateLabels ? (
              <text
                x={x}
                y={PAD_T + plotH + 32}
                textAnchor="middle"
                className="fill-slate-400"
                style={{ fontSize: 9.5, fontWeight: 500 }}
              >
                {dateForDay(d)}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* Axis titles */}
      <text
        x={PAD_L + plotW / 2}
        y={PAD_T + plotH + 42}
        textAnchor="middle"
        className="fill-slate-700"
        style={{ fontSize: 11.5, fontWeight: 700 }}
      >
        {useDateLabels ? "Calendar date (working days only)" : "Working days from epic start"}
      </text>
      <text
        x={16}
        y={PAD_T + plotH / 2}
        textAnchor="middle"
        transform={`rotate(-90 16 ${PAD_T + plotH / 2})`}
        className="fill-slate-700"
        style={{ fontSize: 11.5, fontWeight: 700 }}
      >
        {yAxisTitle}
      </text>

      {/* End-of-window vertical guide when actual extends past totalDays (Overdue) */}
      {lastDay > totalDays ? (
        <g>
          <line
            x1={xFor(totalDays)}
            y1={PAD_T}
            x2={xFor(totalDays)}
            y2={PAD_T + plotH}
            stroke="rgb(244 63 94)"
            strokeWidth={1.25}
            strokeDasharray="4 3"
          />
          <text
            x={xFor(totalDays) + 4}
            y={PAD_T + 12}
            className="fill-rose-500"
            style={{ fontSize: 10, fontWeight: 700 }}
          >
            End date
          </text>
        </g>
      ) : null}

      {/* Ideal line */}
      <line
        x1={idealStartX}
        y1={idealStartY}
        x2={idealEndX}
        y2={idealEndY}
        stroke={IDEAL_ORANGE}
        strokeWidth={2}
        strokeDasharray="6 4"
      />

      {/* Actual line + per-day data point markers (always blue, regardless
          of the slide's verdict color — verdict is conveyed by the chrome). */}
      <path
        d={actualPath}
        stroke={ACTUAL_BLUE}
        strokeWidth={2.6}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {actualLine.map((y, i) => {
        const isHighlight =
          i === 0 ||
          i === actualLine.length - 1 ||
          (annotation && i === annotation.atDay);
        return (
          <circle
            key={`pt-${i}`}
            cx={xFor(i)}
            cy={yFor(y)}
            r={isHighlight ? 3.5 : 2.2}
            fill="white"
            stroke={ACTUAL_BLUE}
            strokeWidth={1.6}
          />
        );
      })}

      {/* Delta bracket: vertical dashed line with up arrow at the ideal point and
          down arrow at the actual point. Placed alongside the line at `atDay`. */}
      {delta ? (
        <g>
          <circle cx={delta.x} cy={delta.yI} r={3.2} fill={IDEAL_ORANGE} />
          <circle cx={delta.x} cy={delta.yA} r={4} fill={ACTUAL_BLUE} stroke="white" strokeWidth={1.6} />
          <line
            x1={delta.x}
            y1={delta.yI}
            x2={delta.x}
            y2={delta.yA}
            stroke="rgb(71 85 105)"
            strokeWidth={1.5}
            strokeDasharray="3 2"
          />
          {/* Arrow pointing up to the ideal point */}
          <path
            d={`M ${delta.x - 4} ${delta.yI + 5.5} L ${delta.x} ${delta.yI + 1.2} L ${delta.x + 4} ${delta.yI + 5.5}`}
            fill="none"
            stroke="rgb(71 85 105)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Arrow pointing down to the actual point */}
          <path
            d={`M ${delta.x - 4} ${delta.yA - 5.5} L ${delta.x} ${delta.yA - 1.2} L ${delta.x + 4} ${delta.yA - 5.5}`}
            fill="none"
            stroke="rgb(71 85 105)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Δ label */}
          {(() => {
            const labelWidth = Math.max(58, delta.label.length * 7);
            const flipsLeft = delta.x + labelWidth + 14 > W - PAD_R;
            const labelX = flipsLeft ? delta.x - labelWidth - 10 : delta.x + 10;
            const labelY = (delta.yI + delta.yA) / 2 - 11;
            return (
              <g transform={`translate(${labelX} ${labelY})`}>
                <rect width={labelWidth} height={22} rx={5} fill="white" stroke="rgb(148 163 184)" />
                <text
                  x={labelWidth / 2}
                  y={15}
                  textAnchor="middle"
                  className="fill-slate-800"
                  style={{ fontSize: 11.5, fontWeight: 700 }}
                >
                  {delta.label}
                </text>
              </g>
            );
          })()}
        </g>
      ) : null}

      {/* Generic pin annotation (Overdue case — no delta math, just labelled marker on the actual line) */}
      {annotation && annotation.kind === "pin"
        ? (() => {
            const day = annotation.atDay;
            const actualY = actualLine[Math.min(day, actualLine.length - 1)];
            const x = xFor(day);
            const y = yFor(actualY);
            const labelWidth = Math.max(64, annotation.label.length * 6.5);
            const flipsLeft = x + labelWidth + 14 > W - PAD_R;
            const labelX = flipsLeft ? x - labelWidth - 10 : x + 10;
            return (
              <g>
                <circle cx={x} cy={y} r={5} fill={accent} stroke="white" strokeWidth={2} />
                <g transform={`translate(${labelX} ${y - 11})`}>
                  <rect width={labelWidth} height={22} rx={5} fill="white" stroke="rgb(203 213 225)" />
                  <text
                    x={labelWidth / 2}
                    y={15}
                    textAnchor="middle"
                    className="fill-slate-700"
                    style={{ fontSize: 11, fontWeight: 600 }}
                  >
                    {annotation.label}
                  </text>
                </g>
              </g>
            );
          })()
        : null}

      {/* Gantt strip below the burndown. Today indicator sits on TOP of the
          strip (pill + downward triangle) so it matches the planner's actual
          Gantt today indicator. The teal vertical line then pierces the
          month band and the epic bar below. */}
      {showGanttStrip ? (() => {
        // Today pill anchored to the top of the strip.
        const pillY = ganttTop + 4;
        const pillH = 22;
        const triangleApexY = pillY + pillH + 6;
        // Layout below the Today indicator.
        const monthY = pillY + pillH + 14;
        const monthH = 18;
        const barY = monthY + monthH + 6;
        const barH = 22;
        const barX0 = xFor(0);
        const barX1 = xFor(totalDays);
        const todayDay = annotation?.atDay;
        const todayX = todayDay !== undefined ? xFor(todayDay) : null;
        // The month divider falls between Day 11 (Mar 31) and Day 12 (Apr 1).
        const monthDividerX = xFor(11.5);
        // Week ticks every 5 working days (Mar 16, Mar 23, Mar 30, Apr 6, Apr 12).
        const weekDays = [0, 5, 10, 15, 20];
        // Teal palette — matches the planner's Gantt today indicator (not
        // the per-slide verdict accent, since this represents a UI element).
        const TEAL_BG = "rgb(204 251 241)";   // teal-100
        const TEAL_LINE = "rgb(45 212 191)";   // teal-400
        const TEAL_TEXT = "rgb(15 118 110)";   // teal-700
        const todayPillText = todayDay !== undefined ? `Today · ${dateForDay(todayDay)}` : "";
        const todayPillW = Math.max(100, todayPillText.length * 6.6);
        return (
          <g>
            {/* Section title on the left — vertically centered with the month band */}
            <text x={PAD_L - 9} y={monthY + 11} textAnchor="end" className="fill-slate-500" style={{ fontSize: 9.5, fontWeight: 700 }}>
              Gantt
            </text>
            <text x={PAD_L - 9} y={monthY + 22} textAnchor="end" className="fill-slate-400" style={{ fontSize: 8.5, fontWeight: 500 }}>
              timeline
            </text>

            {/* Month band. No explicit divider line — the "March 2026" and
                "April 2026" labels are enough to communicate where the months
                split, and a dashed vertical line here reads as a second
                "Today" indicator competing with the real one. */}
            <rect x={PAD_L} y={monthY} width={plotW} height={monthH} rx={3} fill="rgb(241 245 249)" />
            <text x={(barX0 + monthDividerX) / 2} y={monthY + 12} textAnchor="middle" className="fill-slate-700" style={{ fontSize: 9.5, fontWeight: 700 }}>
              March 2026
            </text>
            <text x={(monthDividerX + barX1) / 2} y={monthY + 12} textAnchor="middle" className="fill-slate-700" style={{ fontSize: 9.5, fontWeight: 700 }}>
              April 2026
            </text>

            {/* Week tick marks on the bar */}
            {weekDays.map((d) => (
              <line
                key={`wk-${d}`}
                x1={xFor(d)}
                y1={barY}
                x2={xFor(d)}
                y2={barY + barH}
                stroke="rgb(226 232 240)"
                strokeWidth={1}
              />
            ))}

            {/* Gantt row background */}
            <rect x={PAD_L} y={barY} width={plotW} height={barH} rx={3} fill="white" stroke="rgb(226 232 240)" strokeWidth={1} />
            {/* Epic bar from Day 0 to Day totalDays */}
            <rect x={barX0} y={barY + 3} width={barX1 - barX0} height={barH - 6} rx={4} fill="rgb(99 102 241)" opacity={0.92} />
            {/* Folder glyph + "Example epic" label, centered together as a
                group. Matches the planner's epic-bar convention which prefixes
                the bar text with the epic's icon (📁 by default). */}
            {(() => {
              const cx = (barX0 + barX1) / 2;
              const labelText = "Example epic";
              const approxTextW = labelText.length * 5.6;
              const groupW = approxTextW + 16;
              const startX = cx - groupW / 2;
              return (
                <g transform={`translate(${startX}, ${barY + barH / 2 - 6})`}>
                  {/* Folder glyph — simplified Lucide Folder shape, white stroke. */}
                  <path
                    // y=1.5 instead of the original 2.5 — shifts the whole
                    // glyph up 1px so its visual center lands with the text's
                    // x-height center instead of sitting just below it.
                    // transform shifts the glyph 1.5px to the left so the
                    // icon doesn't crowd the "Example epic" label next to it.
                    transform="translate(-1.5 0)"
                    d="M1.5 1.5h3.2l1.4 1.4h6.4c0.6 0 1 0.4 1 1v5.2c0 0.6-0.4 1-1 1H1.5c-0.6 0-1-0.4-1-1V2.5c0-0.6 0.4-1 1-1Z"
                    fill="none"
                    stroke="white"
                    strokeWidth={1.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <text
                    x={16}
                    y={9}
                    className="fill-white"
                    style={{ fontSize: 10.5, fontWeight: 700 }}
                  >
                    {labelText}
                  </text>
                </g>
              );
            })()}

            {/* Start / End leader lines and labels */}
            <line x1={barX0} y1={barY + barH} x2={barX0} y2={barY + barH + 8} stroke="rgb(99 102 241)" strokeWidth={1.25} />
            <text x={barX0} y={barY + barH + 19} textAnchor="middle" className="fill-indigo-700" style={{ fontSize: 10, fontWeight: 700 }}>
              {dateForDay(0)}
            </text>
            <text x={barX0} y={barY + barH + 29} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 8.5, fontWeight: 600 }}>
              Start
            </text>

            <line x1={barX1} y1={barY + barH} x2={barX1} y2={barY + barH + 8} stroke="rgb(99 102 241)" strokeWidth={1.25} />
            <text x={barX1} y={barY + barH + 19} textAnchor="middle" className="fill-indigo-700" style={{ fontSize: 10, fontWeight: 700 }}>
              {dateForDay(totalDays)}
            </text>
            <text x={barX1} y={barY + barH + 29} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 8.5, fontWeight: 600 }}>
              End
            </text>

            {/* Today vertical line + pill — drawn LAST so they paint on top of
                the month band, the bar, and the start/end leaders. Previously
                rendered first, where the band/bar's opaque fills covered the
                line and created a phantom gap below the triangle. */}
            {todayX !== null ? (
              <line
                x1={todayX}
                y1={triangleApexY + 4}
                x2={todayX}
                y2={barY + barH + 4}
                stroke={TEAL_LINE}
                strokeWidth={1.75}
                strokeDasharray="3 3"
              />
            ) : null}
            {todayX !== null ? (() => {
              const pillX = Math.min(plotW + PAD_L - todayPillW, Math.max(PAD_L, todayX - todayPillW / 2));
              return (
                <g>
                  <rect
                    x={pillX}
                    y={pillY}
                    width={todayPillW}
                    height={pillH}
                    rx={6}
                    fill={TEAL_BG}
                    stroke={TEAL_LINE}
                    strokeWidth={1.4}
                  />
                  <text
                    x={pillX + todayPillW / 2}
                    y={pillY + 15}
                    textAnchor="middle"
                    style={{ fontSize: 11, fontWeight: 700, fill: TEAL_TEXT }}
                  >
                    {todayPillText}
                  </text>
                  {/* Downward triangle pointing from the pill onto the line */}
                  <path
                    d={`M ${todayX - 6} ${pillY + pillH} L ${todayX} ${triangleApexY + 4} L ${todayX + 6} ${pillY + pillH} Z`}
                    fill={TEAL_BG}
                    stroke={TEAL_LINE}
                    strokeWidth={1.4}
                    strokeLinejoin="round"
                  />
                </g>
              );
            })() : null}
          </g>
        );
      })() : null}

      {/* In-chart legend (top right) */}
      <g transform={`translate(${W - PAD_R - 168} ${PAD_T + 4})`}>
        <rect width={168} height={36} rx={6} fill="white" stroke="rgb(226 232 240)" />
        <line x1={8} y1={12} x2={26} y2={12} stroke={IDEAL_ORANGE} strokeWidth={2} strokeDasharray="5 4" />
        <text x={32} y={15.5} className="fill-slate-600" style={{ fontSize: 10, fontWeight: 500 }}>
          Ideal pace
        </text>
        <line x1={8} y1={26} x2={26} y2={26} stroke={ACTUAL_BLUE} strokeWidth={2.4} />
        <circle cx={17} cy={26} r={2.4} fill="white" stroke={ACTUAL_BLUE} strokeWidth={1.6} />
        <text x={32} y={29.5} className="fill-slate-600" style={{ fontSize: 10, fontWeight: 500 }}>
          Actual remaining
        </text>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Slide 1 — Gantt context illustration                                */
/* ------------------------------------------------------------------ */

function GanttContextIllustration({ basis = "epic_days" }: { basis?: Basis }) {
  // Two stacks: a compact Gantt strip on top that aligns horizontally with
  // the burndown chart below it. The epic bar on the Gantt spans EXACTLY
  // from `chartL` to `chartR` so Day 0 / Day 20 on the burndown line up
  // vertically with Start / End on the Gantt. The Y axis is annotated to
  // call out that its top value is the epic's "Days Est" field.
  //
  // The same Y SCALE (0–50, with 40 highlighted) is used in every basis —
  // what changes are the LABELS the viewer reads. For story_days the
  // highlighted 40 reads as "Σ child story estimates"; for stories it
  // reads as 100% (i.e. all stories pending) and the tick labels switch
  // to %. The illustrative chart shape stays identical so the verdict
  // mechanic on the next slides applies uniformly.
  const isStoriesBasis = basis === "stories";
  const yTickLabel = (value: number): string => {
    if (isStoriesBasis) {
      // Map the 0/10/20/30/40 grid to 0%/25%/50%/75%/100%; 50 (the axis
      // breathing-room cap) renders blank since 125% has no meaning.
      if (value === 0) return "0%";
      if (value === 10) return "25%";
      if (value === 20) return "50%";
      if (value === 30) return "75%";
      if (value === 40) return "100%";
      return "";
    }
    return `${value}d`;
  };
  const yAxisTitle =
    basis === "stories"
      ? "% of stories pending"
      : basis === "story_days"
        ? "Σ child story est. days"
        : "Σ Days Est on the epic";
  const calloutText =
    basis === "stories"
      ? "↓ 100% = all child stories pending"
      : basis === "story_days"
        ? "↓ 40d = Σ of child story estimates"
        : '↓ 40d = epic\'s "Days Est" value';
  const W = 580;
  const H = 480;
  const PAD_L = 20;
  const PAD_R = 20;

  // ---- Burndown chart (bottom, full-size) — computed FIRST because the
  //      Gantt above is rendered using its chartL / chartR bounds so they
  //      align horizontally.
  const chartTop = 180;
  const chartL = 70;
  const chartR = W - 20;
  const chartB = H - 50;
  const chartT = chartTop + 24;
  const chartW = chartR - chartL;
  const chartH = chartB - chartT;
  const totalDays = 20;
  // The actual "Days Est" the team set on the epic. The ideal line goes from
  // this value at Day 0 down to zero at Day totalDays.
  const totalEffort = 40;
  // The Y axis itself extends a step higher than totalEffort so there is
  // breathing room above the 40d marker for the "= Days Est value" callout
  // pill, and the planner-facing chart isn't visually capped by the data.
  const yAxisMax = 50;
  const xForDay = (d: number) => chartL + (d / totalDays) * chartW;
  const yForEffort = (e: number) => chartT + (1 - e / yAxisMax) * chartH;

  // ---- Gantt strip (top) — rendered between chartL and chartR so the epic
  //      bar matches the burndown's X axis below.
  const stripY = 56;
  const stripH = 26;
  // Month divider at Day 11.5 (after Mar 31, before Apr 1).
  const monthDivider = xForDay(11.5);
  const epicX = xForDay(0);
  const epicEndX = xForDay(20);
  const epicW = epicEndX - epicX;

  // Actual line drifting clearly above the ideal so they read as two
  // distinct curves on the page (about +2-3d delta at midpoint).
  const actualPoints = [
    [0, 40], [1, 39.5], [2, 38.5], [3, 37], [4, 36], [5, 34.5],
    [6, 33], [7, 31], [8, 29], [9, 27.5], [10, 26],
    [11, 24], [12, 22], [13, 19.5], [14, 17], [15, 14.5],
    [16, 12], [17, 9.5], [18, 6.5], [19, 3.5], [20, 0],
  ];
  const actualPath = actualPoints
    .map(([d, e], i) => `${i === 0 ? "M" : "L"} ${xForDay(d).toFixed(2)} ${yForEffort(e).toFixed(2)}`)
    .join(" ");

  const dateTickDays = [0, 5, 10, 15, 20];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" aria-hidden role="img">
      {/* ============ Gantt strip ============ */}
      <text x={PAD_L} y={24} className="fill-slate-500" style={{ fontSize: 10.5, fontWeight: 700 }}>
        1 · Epic on the Gantt
      </text>

      {/* Month band — spans the same horizontal extent as the chart below
          so March/April map exactly to working days 0-11 / 12-20. */}
      <rect x={chartL} y={stripY - 20} width={chartW} height={20} rx={3} fill="rgb(241 245 249)" />
      <text x={(chartL + monthDivider) / 2} y={stripY - 6} textAnchor="middle" className="fill-slate-700" style={{ fontSize: 10.5, fontWeight: 700 }}>
        March 2026
      </text>
      <text x={(monthDivider + chartR) / 2} y={stripY - 6} textAnchor="middle" className="fill-slate-700" style={{ fontSize: 10.5, fontWeight: 700 }}>
        April 2026
      </text>

      {/* Week tick marks every 5 working days, matching the burndown X axis */}
      {[5, 10, 15].map((d) => (
        <line key={`wk-${d}`} x1={xForDay(d)} y1={stripY} x2={xForDay(d)} y2={stripY + stripH} stroke="rgb(226 232 240)" strokeWidth={1} />
      ))}

      {/* Gantt row background */}
      <rect x={chartL} y={stripY} width={chartW} height={stripH} rx={3} fill="white" stroke="rgb(226 232 240)" strokeWidth={1} />

      {/* Epic bar — spans Day 0 to Day 20 (the FULL chart X axis below) */}
      <rect x={epicX} y={stripY + 3} width={epicW} height={stripH - 6} rx={4} fill="rgb(99 102 241)" opacity={0.92} />
      {(() => {
        const cx = epicX + epicW / 2;
        const labelText = "Example epic";
        const approxTextW = labelText.length * 5.6;
        // Wider intentional gap (5px) between icon and text, plus icon shifted
        // up 2px in the path, so the folder sits clearly to the upper-left
        // of the label rather than crowding against its baseline.
        const groupW = approxTextW + 20;
        const startX = cx - groupW / 2;
        return (
          <g transform={`translate(${startX}, ${stripY + stripH / 2 - 7})`}>
            <path
              d="M1.5 1.5h3.2l1.4 1.4h6.4c0.6 0 1 0.4 1 1v5.2c0 0.6-0.4 1-1 1H1.5c-0.6 0-1-0.4-1-1V2.5c0-0.6 0.4-1 1-1Z"
              fill="none"
              stroke="white"
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text x={19} y={10} className="fill-white" style={{ fontSize: 10.5, fontWeight: 700 }}>
              {labelText}
            </text>
          </g>
        );
      })()}

      {/* Start / End labels */}
      <line x1={epicX} y1={stripY + stripH} x2={epicX} y2={stripY + stripH + 10} stroke="rgb(99 102 241)" strokeWidth={1.25} />
      <text x={epicX} y={stripY + stripH + 22} textAnchor="middle" className="fill-indigo-700" style={{ fontSize: 10.5, fontWeight: 700 }}>
        Mar 16
      </text>
      <text x={epicX} y={stripY + stripH + 33} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 9, fontWeight: 600 }}>
        Start
      </text>

      <line x1={epicEndX} y1={stripY + stripH} x2={epicEndX} y2={stripY + stripH + 10} stroke="rgb(99 102 241)" strokeWidth={1.25} />
      <text x={epicEndX} y={stripY + stripH + 22} textAnchor="middle" className="fill-indigo-700" style={{ fontSize: 10.5, fontWeight: 700 }}>
        Apr 12
      </text>
      <text x={epicEndX} y={stripY + stripH + 33} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 9, fontWeight: 600 }}>
        End
      </text>

      {/* "20 working days" bracket between start and end so the viewer doesn't
          have to count for themselves. Horizontal double-headed arrow under
          the Start/End leader lines, with a pill-shaped label in the middle. */}
      {(() => {
        const by = stripY + stripH + 50;
        const midX = (epicX + epicEndX) / 2;
        const labelW = 100;
        const labelH = 18;
        const labelLeft = midX - labelW / 2;
        return (
          <g>
            {/* Arrow shaft (split around the label) */}
            <line x1={epicX + 4} y1={by} x2={labelLeft - 2} y2={by} stroke="rgb(99 102 241)" strokeWidth={1.4} />
            <line x1={labelLeft + labelW + 2} y1={by} x2={epicEndX - 4} y2={by} stroke="rgb(99 102 241)" strokeWidth={1.4} />
            {/* Left arrowhead */}
            <path d={`M ${epicX + 8} ${by - 4} L ${epicX + 4} ${by} L ${epicX + 8} ${by + 4}`} fill="none" stroke="rgb(99 102 241)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
            {/* Right arrowhead */}
            <path d={`M ${epicEndX - 8} ${by - 4} L ${epicEndX - 4} ${by} L ${epicEndX - 8} ${by + 4}`} fill="none" stroke="rgb(99 102 241)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
            {/* Label pill */}
            <rect x={labelLeft} y={by - labelH / 2} width={labelW} height={labelH} rx={4} fill="white" stroke="rgb(99 102 241)" strokeWidth={1.2} />
            <text x={midX} y={by + 4} textAnchor="middle" className="fill-indigo-700" style={{ fontSize: 11, fontWeight: 700 }}>
              20 working days
            </text>
          </g>
        );
      })()}

      {/* Connector down to the burndown — starts below the "20 working days" bracket */}
      <line x1={(epicX + epicEndX) / 2} y1={stripY + stripH + 62} x2={(epicX + epicEndX) / 2} y2={chartTop - 4} stroke="rgb(100 116 139)" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d={`M ${(epicX + epicEndX) / 2 - 5} ${chartTop - 8} L ${(epicX + epicEndX) / 2} ${chartTop - 2} L ${(epicX + epicEndX) / 2 + 5} ${chartTop - 8}`} fill="none" stroke="rgb(100 116 139)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />

      {/* ============ Burndown chart ============ */}
      <text x={PAD_L} y={chartTop + 16} className="fill-slate-500" style={{ fontSize: 10.5, fontWeight: 700 }}>
        2 · Burndown inside that window
      </text>
      <text x={chartR} y={chartTop + 16} textAnchor="end" className="fill-slate-500" style={{ fontSize: 10, fontWeight: 600 }}>
        20 working days
      </text>

      {/* Y axis title (rotated) — basis-dependent */}
      <text
        x={16}
        y={(chartT + chartB) / 2}
        textAnchor="middle"
        transform={`rotate(-90 16 ${(chartT + chartB) / 2})`}
        className="fill-slate-700"
        style={{ fontSize: 11, fontWeight: 700 }}
      >
        {yAxisTitle}
      </text>

      {/* "Days Est" callout — now lives entirely INSIDE the chart, in the
          headroom between the 50d top of the Y axis and the highlighted 40d
          marker (which is the actual Days Est value). A short down-arrow
          from the pill points straight at the 40d label. */}
      {(() => {
        const y40 = yForEffort(40);
        const y50 = yForEffort(50);
        const pillH = 18;
        // Center the pill vertically in the 50d → 40d band.
        const pillCenterY = (y40 + y50) / 2;
        const pillY = pillCenterY - pillH / 2;
        const pillW = 220;
        const pillX = chartL + 30;
        const arrowX = chartL + 14;
        return (
          <g>
            {/* Arrow shaft + arrowhead pointing DOWN at the 40d label so the
                viewer reads "this 40d is the Days Est value". */}
            <line x1={arrowX} y1={pillCenterY} x2={arrowX} y2={y40 - 4} stroke="rgb(99 102 241)" strokeWidth={1.4} />
            <path
              d={`M ${arrowX - 4} ${y40 - 8} L ${arrowX} ${y40 - 2} L ${arrowX + 4} ${y40 - 8}`}
              fill="none"
              stroke="rgb(99 102 241)"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Pill — text changes with the active basis */}
            <rect x={pillX} y={pillY} width={pillW} height={pillH} rx={4} fill="white" stroke="rgb(99 102 241)" strokeWidth={1.2} />
            <text x={pillX + pillW / 2} y={pillCenterY + 4} textAnchor="middle" className="fill-indigo-700" style={{ fontSize: 10, fontWeight: 700 }}>
              {calloutText}
            </text>
          </g>
        );
      })()}

      {/* Y gridlines + tick labels. 0d and 50d (the axis bounds) are the
          solid frame lines; 40d (the Days Est value) is emphasized so its
          significance reads at a glance; the other ticks are dashed. */}
      {[0, 10, 20, 30, 40, 50].map((eff) => {
        const y = yForEffort(eff);
        const isFrame = eff === 0 || eff === 50;
        const isDaysEst = eff === 40;
        return (
          <g key={`y-${eff}`}>
            <line
              x1={chartL}
              y1={y}
              x2={chartR}
              y2={y}
              stroke={isFrame ? "rgb(203 213 225)" : isDaysEst ? "rgb(99 102 241)" : "rgb(226 232 240)"}
              strokeWidth={isDaysEst ? 1.25 : 1}
              strokeDasharray={isFrame ? undefined : "3 3"}
            />
            <line x1={chartL - 4} y1={y} x2={chartL} y2={y} stroke="rgb(148 163 184)" strokeWidth={1} />
            <text
              x={chartL - 8}
              y={y + 4}
              textAnchor="end"
              className={isDaysEst ? "fill-indigo-700" : "fill-slate-600"}
              style={{ fontSize: 10.5, fontWeight: isDaysEst ? 700 : 500 }}
            >
              {yTickLabel(eff)}
            </text>
          </g>
        );
      })}

      {/* Axis lines */}
      <line x1={chartL} y1={chartT} x2={chartL} y2={chartB} stroke="rgb(148 163 184)" strokeWidth={1.25} />
      <line x1={chartL} y1={chartB} x2={chartR} y2={chartB} stroke="rgb(148 163 184)" strokeWidth={1.25} />

      {/* X minor ticks every day */}
      {Array.from({ length: totalDays + 1 }, (_, d) => d).map((d) => {
        if (dateTickDays.includes(d)) return null;
        const x = xForDay(d);
        return <line key={`xm-${d}`} x1={x} y1={chartB} x2={x} y2={chartB + 3} stroke="rgb(148 163 184)" strokeWidth={1} />;
      })}

      {/* X major ticks + calendar date labels (matching the Gantt above) */}
      {dateTickDays.map((d) => {
        const x = xForDay(d);
        return (
          <g key={`xM-${d}`}>
            <line x1={x} y1={chartB} x2={x} y2={chartB + 6} stroke="rgb(100 116 139)" strokeWidth={1.25} />
            <text x={x} y={chartB + 20} textAnchor="middle" className="fill-slate-600" style={{ fontSize: 10.5, fontWeight: 600 }}>
              {dateForDay(d)}
            </text>
          </g>
        );
      })}

      {/* X axis title */}
      <text x={(chartL + chartR) / 2} y={chartB + 38} textAnchor="middle" className="fill-slate-700" style={{ fontSize: 11, fontWeight: 700 }}>
        Calendar date (working days only)
      </text>

      {/* Ideal line */}
      <line
        x1={xForDay(0)}
        y1={yForEffort(40)}
        x2={xForDay(20)}
        y2={yForEffort(0)}
        stroke={IDEAL_ORANGE}
        strokeWidth={2.4}
        strokeDasharray="6 4"
      />

      {/* Actual line (clearly above ideal for a few days mid-window) */}
      <path d={actualPath} stroke={ACTUAL_BLUE} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {actualPoints.map(([d, e], i) => (
        <circle
          key={`pt-${i}`}
          cx={xForDay(d)}
          cy={yForEffort(e)}
          r={i === 0 || i === actualPoints.length - 1 ? 3.2 : 2.2}
          fill="white"
          stroke={ACTUAL_BLUE}
          strokeWidth={1.6}
        />
      ))}

      {/* In-chart legend (top right) */}
      <g transform={`translate(${chartR - 170} ${chartT + 4})`}>
        <rect width={168} height={36} rx={6} fill="white" stroke="rgb(226 232 240)" />
        <line x1={8} y1={12} x2={26} y2={12} stroke={IDEAL_ORANGE} strokeWidth={2.2} strokeDasharray="5 4" />
        <text x={32} y={15.5} className="fill-slate-600" style={{ fontSize: 10, fontWeight: 500 }}>
          Ideal pace
        </text>
        <line x1={8} y1={26} x2={26} y2={26} stroke={ACTUAL_BLUE} strokeWidth={2.4} />
        <circle cx={17} cy={26} r={2.4} fill="white" stroke={ACTUAL_BLUE} strokeWidth={1.6} />
        <text x={32} y={29.5} className="fill-slate-600" style={{ fontSize: 10, fontWeight: 500 }}>
          Actual remaining
        </text>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Slide 2 — Three-bases comparison illustration                       */
/* ------------------------------------------------------------------ */

function BasisIllustration() {
  return (
    <div className="flex h-full flex-col gap-3 px-1 py-1">
      {/* Mockup of where the user picks the basis on the actual dashboard.
          Mirrors the Roadmap Health hero row: HeartPulse + "Health calculation"
          + Info icon + PillToggle with the three options. The "Epic Est (d)"
          pill is shown as active (highlighted indigo) — the dashboard default. */}
      <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
          What you see on the dashboard
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-slate-600">
            <HeartPulseGlyph />
            <span>Health calculation</span>
            <InfoGlyph />
          </span>
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-white p-0.5 shadow-sm">
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium leading-none text-indigo-700 ring-1 ring-indigo-200">
              Epic Est (d)
            </span>
            <span className="rounded-full px-2.5 py-1 text-[11px] font-medium leading-none text-slate-600">
              Σ | Child Est (d)
            </span>
            <span className="rounded-full px-2.5 py-1 text-[11px] font-medium leading-none text-slate-600">
              Stories Completed (%)
            </span>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Pick one of three modes. The verdict on every epic recomputes against the
          mode you select.
        </p>
      </div>

      <BasisRow
        title="Epic Est (d)"
        subtitle="Epic's own originalEstimateDays · 'Epic Est (d)' (default)"
        progressLabel="16 / 35d burnt"
        progressPct={46}
        accent="rgb(20 184 166)"
        highlight
        rendering={<BasisBar pct={46} accent="rgb(20 184 166)" labels={["35d", "0d"]} />}
      />
      <BasisRow
        title="Σ | Child Est (d)"
        subtitle="Sum of estimatedDays · 'Σ | Child Est (d)'"
        progressLabel="18 / 40d burnt"
        progressPct={45}
        accent="rgb(37 99 235)"
        rendering={<BasisBar pct={45} accent="rgb(37 99 235)" labels={["40d", "0d"]} />}
      />
      <BasisRow
        title="Stories Completed (%)"
        subtitle="Count by headcount · matches 'Stories Completed (%)' pill"
        progressLabel="3 / 5 done"
        progressPct={60}
        accent="rgb(99 102 241)"
        rendering={
          <div className="flex items-center gap-1.5">
            {[true, true, true, false, false].map((done, i) => (
              <span
                key={i}
                className="inline-flex size-5 items-center justify-center rounded-full text-[10px] font-bold"
                style={{
                  background: done ? "rgb(99 102 241)" : "white",
                  color: done ? "white" : "rgb(148 163 184)",
                  border: done ? "none" : "1.5px solid rgb(203 213 225)",
                }}
              >
                {done ? "✓" : ""}
              </span>
            ))}
          </div>
        }
      />
      <div className="mt-auto rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 px-3 py-2 text-[11.5px] leading-relaxed text-indigo-900">
        <ArrowRight className="mr-1 inline size-3.5 -translate-y-0.5" aria-hidden />
        Verdict logic (Δ thresholds on the next slides) applies the same in every mode.
      </div>
    </div>
  );
}

// Tiny inline SVG glyphs that mirror lucide HeartPulse + Info, so the
// dashboard-toggle mockup above looks visually identical without pulling
// in the full lucide components (which would scale differently).
function HeartPulseGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="rgb(244 63 94)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
    </svg>
  );
}
function InfoGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="rgb(148 163 184)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Per-verdict basis toggle (Stories Completed % / Σ | Child Est d / Epic Est d) */
/* ------------------------------------------------------------------ */

/** At Risk story-level paragraph — basis-aware so the "what fits in
 *  the calendar" framing speaks the active basis. Mode-neutral
 *  paragraph 1 (Δ ≥ 4 working days mechanic) is reused as-is. */
function renderAtRiskParagraphs(basis: Basis): React.ReactNode[] {
  const storyLevel =
    basis === "stories" ? (
      <p key="p2">
        <strong>At the story level:</strong> too few child stories are reaching{" "}
        <em>Review</em> or <em>Done</em> for the percent-complete line to catch up to
        plan before the end date.
      </p>
    ) : basis === "story_days" ? (
      <p key="p2">
        <strong>At the story level:</strong> several stories are stuck in <em>Todo</em>{" "}
        or <em>In Progress</em> past where they should be, and the sum of their{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] font-mono">daysLeft</code>{" "}
        exceeds what fits in the remaining calendar.
      </p>
    ) : (
      <p key="p2">
        <strong>At the story level:</strong> several stories are stuck in <em>Todo</em>{" "}
        or <em>In Progress</em> past where they should be — the epic-est budget can&apos;t
        fit in what&apos;s left of the calendar.
      </p>
    );
  return [
    <p key="p1">
      The team is clearly behind. The actual line sits 4+ working days above the
      ideal. Without intervention (scoping work out, adding help, or pushing the end
      date), this epic will overrun.
    </p>,
    storyLevel,
  ];
}

/** Done story-level paragraph — basis-aware. Each mode names the
 *  signal the planner actually sees on the chart in that mode (epic
 *  budget burnt down to 0d / Σ daysLeft = 0 / 100% of stories done). */
function renderDoneParagraphs(basis: Basis): React.ReactNode[] {
  const storyLevel =
    basis === "stories" ? (
      <p key="p2">
        <strong>At the story level:</strong> every child story is in <em>Review</em> or{" "}
        <em>Done</em> — that&apos;s 100% of them. Done overrides On Track / Watch / At
        Risk because there is no work left to evaluate.
      </p>
    ) : basis === "story_days" ? (
      <p key="p2">
        <strong>At the story level:</strong> every child story is in <em>Review</em> or{" "}
        <em>Done</em>, and the sum of their remaining{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] font-mono">daysLeft</code>{" "}
        is zero. Done overrides On Track / Watch / At Risk because there is no work
        left to evaluate.
      </p>
    ) : (
      <p key="p2">
        <strong>At the story level:</strong> every child story is in <em>Review</em> or{" "}
        <em>Done</em>, and the epic-est budget has burnt down to zero. Done overrides
        On Track / Watch / At Risk because there is no work left to evaluate.
      </p>
    );
  return [
    <p key="p1">
      Every piece of work in the epic is finished. The actual line has reached zero
      before (or on) the end date. There is nothing left to burn.
    </p>,
    storyLevel,
    <p key="p3">
      Done is also the only verdict where the chart&apos;s <em>actual</em> line meets
      the X axis. From that moment forward, the epic stops drifting upward against
      the ideal line because there is nothing left to drift.
    </p>,
  ];
}

/** Intro-slide paragraphs. Paragraph 3 (the Y-axis explanation) is the
 *  only basis-dependent block — it names the concrete baseline shown in
 *  the chart on the left ("40d" for the days bases, "100%" for stories).
 *  The other paragraphs are mode-neutral and re-used verbatim across
 *  every basis. Kept as a single render function (rather than three
 *  arrays) so the shared lines live in exactly one place. */
function renderIntroParagraphs(basis: Basis): React.ReactNode[] {
  const yAxisParagraph =
    basis === "stories" ? (
      <p key="p3">
        The <strong>Y axis</strong> is the percent of child stories still pending —
        <strong> 100%</strong> in the example below means every story is still to do.
        Switch the basis toggle and the Y title, ticks, and callout update together.
      </p>
    ) : basis === "story_days" ? (
      <p key="p3">
        The <strong>Y axis</strong> starts at the sum of every child story&apos;s{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] font-mono">estimatedDays</code>{" "}
        — <strong>40d</strong> in the example below. Switch the basis toggle and the Y
        title, ticks, and callout update together.
      </p>
    ) : (
      <p key="p3">
        The <strong>Y axis</strong> starts at the epic&apos;s{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] font-mono">Days Est</code>{" "}
        field on the details form — <strong>40d</strong> in the example below. Switch the
        basis toggle and the Y title, ticks, and callout update together.
      </p>
    );
  return [
    <p key="p1">
      We measure an epic&apos;s health by comparing its <strong>actual progress</strong> to
      its <strong>planned pace</strong>, inside the window the planner set on the
      Gantt.
    </p>,
    <p key="p2">
      The <strong>X axis</strong> is the count of <strong>working days</strong>{" "}
      between the epic&apos;s start and end dates on the Gantt (Saturdays and Sundays
      don&apos;t tick).
    </p>,
    yAxisParagraph,
    <p key="p4">
      The orange dashed line is the <strong>ideal pace</strong>, a straight slope from
      the baseline at Day 0 down to zero on the last day. The blue line is the{" "}
      <strong>actual remaining work</strong>, recalculated every day from the open
      stories.
    </p>,
    <p key="p5">
      Health is decided by where the blue line sits versus the orange one{" "}
      <em>right now</em>. If they hug each other the epic is healthy. The further the
      blue drifts above, the worse the verdict.
    </p>,
  ];
}

function BasisToggle({
  value,
  onChange,
  accent,
}: {
  value: Basis;
  onChange: (next: Basis) => void;
  accent: string;
}) {
  // Order matches the dashboard's Health calculation PillToggle:
  // Epic Est (d) → Σ | Child Est (d) → Stories Completed (%).
  const options: Basis[] = ["epic_days", "story_days", "stories"];
  return (
    // Tight padding + smaller font + whitespace-nowrap keep all three
    // labels on a single line. "Stories Completed (%)" is the
    // longest; at text-[10.5px] with px-1.5 it fits the right-pane
    // width comfortably and the buttons stay short (single-line
    // height) instead of doubling in height when the label wrapped.
    <div className="inline-flex w-full items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white p-0.5 text-[10.5px] font-semibold leading-tight">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              "flex-1 whitespace-nowrap rounded-md px-1.5 py-1 transition-colors",
              active ? "text-white shadow-sm" : "text-slate-600 hover:bg-slate-100",
            )}
            style={active ? { background: accent } : undefined}
            aria-pressed={active}
          >
            {BASIS_LABELS[opt]}
          </button>
        );
      })}
    </div>
  );
}

function BasisRow({
  title,
  subtitle,
  progressLabel,
  progressPct,
  accent,
  rendering,
  highlight = false,
}: {
  title: string;
  subtitle: string;
  progressLabel: string;
  progressPct: number;
  accent: string;
  rendering: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-white p-2.5",
        highlight ? "border-indigo-300 ring-1 ring-indigo-200" : "border-slate-200",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex size-2.5 shrink-0 rounded-full" style={{ background: accent }} />
            <span className="text-[12.5px] font-semibold text-slate-800">{title}</span>
          </div>
          <p className="ml-4 text-[10.5px] leading-tight text-slate-500">{subtitle}</p>
        </div>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-600">
          {progressLabel}
        </span>
      </div>
      <div className="mt-2 ml-4">{rendering}</div>
    </div>
  );
}

function BasisBar({ pct, accent, labels }: { pct: number; accent: string; labels: [string, string] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 shrink-0 text-right text-[9px] font-semibold tabular-nums text-slate-400">
        {labels[0]}
      </span>
      <div className="relative h-2.5 flex-1 rounded-full bg-slate-100">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: accent }}
        />
      </div>
      <span className="w-5 shrink-0 text-[9px] font-semibold tabular-nums text-slate-400">
        {labels[1]}
      </span>
    </div>
  );
}
