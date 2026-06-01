"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, ExternalLink, Eye, History, RotateCcw, TimerReset } from "lucide-react";
import { toast } from "sonner";

import { clockOverrideKey, now as clockNow } from "@/lib/clock";
import { predictAllBoundaries, type BoundaryPrediction } from "@/lib/time-debugger-predictions";
import { YEAR_SPRINT_MAX } from "@/lib/year-sprint";
import type { InitiativeItem, RoadmapItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Internal debugging surface that walks the user through each calendar
 * rollover boundary (sprint / month / quarter / year). For each boundary
 * the panel:
 *
 *   - Scans the currently-loaded initiatives and predicts the rollover
 *     using {@link predictAllBoundaries} so the expected results carry
 *     concrete counts from the user's actual data, not generic prose.
 *   - Exposes two clock-jump buttons: "Before" (the boundary's last
 *     instant) and "After" (the boundary's first instant). Each writes
 *     to `sessionStorage[clockOverrideKey()]` and reloads the page so
 *     every "now()" reader sees the new fake time.
 *   - Shows a checklist of views to verify in each state, with the
 *     concrete numbers baked into the expected-result lines.
 *
 * Reset to real time at the bottom clears the override. Data is never
 * touched — only the clock the app reads.
 */

type TimeDebuggerProps = {
  initiatives: InitiativeItem[];
  roadmaps: RoadmapItem[];
  selectedRoadmapId: string | null;
  selectedYear: number;
};

type Row = {
  index: number;
  title: string;
  beforeLabel: string;
  beforeIso: string;
  afterLabel: string;
  afterIso: string;
  description: string;
  prediction: BoundaryPrediction;
  /** Expected-result entries rendered under "After Step 1". */
  beforeChecks: ChecklistEntry[];
  /** Expected-result entries rendered under "After Step 2". */
  afterChecks: ChecklistEntry[];
};

type ChecklistEntry = {
  id: string;
  title: string;
  expected: string;
  /** When set, renders an `Open ↗` button that loads the URL. Omit for
   *  items the user only needs to watch on screen (e.g. popup fires). */
  openUrl?: string;
};

function isoForDayInstant(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(year, month - 1, day, hour, minute, 0).toISOString();
}

function statusBreakdown(p: BoundaryPrediction): string {
  return `${p.total} total · ${p.todo} todo · ${p.inProgress} inProgress · ${p.review} review · ${p.done} done`;
}

export function TimeDebuggerPanel({
  initiatives,
  roadmaps,
  selectedRoadmapId,
  selectedYear,
}: TimeDebuggerProps) {
  const [clockSummary, setClockSummary] = useState("");

  useEffect(() => {
    const refresh = () => {
      if (typeof window === "undefined") return;
      const raw = window.sessionStorage.getItem(clockOverrideKey());
      if (!raw) {
        setClockSummary(`Real time · ${clockNow().toLocaleString()}`);
        return;
      }
      setClockSummary(`Override · ${new Date(raw).toLocaleString()}`);
    };
    refresh();
    const id = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(id);
  }, []);

  const setClockAndReload = (iso: string | null, label: string) => {
    try {
      if (iso == null) window.sessionStorage.removeItem(clockOverrideKey());
      else window.sessionStorage.setItem(clockOverrideKey(), iso);
      toast.success(`Clock → ${label}. Reloading…`);
      window.setTimeout(() => window.location.reload(), 350);
    } catch {
      toast.error("Could not set clock override (sessionStorage blocked)");
    }
  };

  const predictions = useMemo(() => predictAllBoundaries(initiatives), [initiatives]);

  const activeRoadmap = roadmaps.find((r) => r.id === selectedRoadmapId) ?? null;
  const nextYearAlreadyConfigured = activeRoadmap?.years.includes(selectedYear + 1) ?? false;

  const rows: Row[] = useMemo(() => {
    const planYear = selectedYear;

    // 1 · Sprint boundary — Sprint 5 ends Mar 15 23:59, Sprint 6 starts Mar 16.
    const sprintRow: Row = {
      index: 1,
      title: "Sprint boundary",
      beforeLabel: "Mar 15, 23:30",
      beforeIso: isoForDayInstant(planYear, 3, 15, 23, 30),
      afterLabel: "Mar 16, 00:30",
      afterIso: isoForDayInstant(planYear, 3, 16, 0, 30),
      description:
        "Within March, within Q1. Auto-rollover is gone — Sprint 5 close surfaces a Move button. After Step 2 + Move confirm, Sprint 5 keeps only its done cards; the rest land in Sprint 6.",
      prediction: predictions.sprint,
      beforeChecks: [
        {
          id: "sprint-5-kanban-before",
          title: "Sprint 5 kanban",
          expected: `${predictions.sprint.total} cards live in their columns. No snapshot strip. No move button.`,
          openUrl: `?view=roadmap&sprint=5`,
        },
        {
          id: "sprint-5-capacity-before",
          title: "Sprint 5 capacity",
          expected: `${predictions.sprint.total} cards distributed across assignee buckets. No snapshot strip.`,
          openUrl: `?view=roadmap&sprint=5&sprintView=capacity`,
        },
        {
          id: "sprint-5-status-before",
          title: "Sprint 5 Status charts",
          expected: `Pie reads ${predictions.sprint.todo} todo / ${predictions.sprint.inProgress} inProgress / ${predictions.sprint.review} review / ${predictions.sprint.done} done. No charts framing strip.`,
          openUrl: `?view=roadmap&sprint=5&sprintView=status`,
        },
        {
          id: "sprint-6-kanban-before",
          title: "Sprint 6 kanban",
          expected: `Empty or only newly-planned S6 work.`,
          openUrl: `?view=roadmap&sprint=6`,
        },
      ],
      afterChecks: [
        {
          id: "sprint-5-kanban-after",
          title: "Sprint 5 kanban (closed)",
          expected: `Not dimmed. Snapshot strip + a "Move ${predictions.sprint.willRoll + predictions.sprint.review} unfinished to Sprint 6" button. Clicking it opens the confirmation modal with todo + inProgress + review pre-checked (${predictions.sprint.done} done excluded).`,
          openUrl: `?view=roadmap&sprint=5`,
        },
        {
          id: "sprint-5-kanban-after-move",
          title: "Sprint 5 kanban after Move confirm",
          expected: `Only the ${predictions.sprint.done} done card${predictions.sprint.done === 1 ? "" : "s"} remain in the Done column. To Do / In Progress / Review / Testing columns are empty.`,
          openUrl: `?view=roadmap&sprint=5`,
        },
        {
          id: "sprint-5-capacity-after",
          title: "Sprint 5 capacity (closed)",
          expected: `Not dimmed. Move button visible. After Move confirm: only done cards remain in their assignee buckets.`,
          openUrl: `?view=roadmap&sprint=5&sprintView=capacity`,
        },
        {
          id: "sprint-5-status-after",
          title: "Sprint 5 Status charts (closed)",
          expected: `Charts framing strip. Pie still reads ${predictions.sprint.todo} todo / ${predictions.sprint.inProgress} inProgress / ${predictions.sprint.review} review / ${predictions.sprint.done} done (frozen at Mar 15 close, not current state — even after Move confirm).`,
          openUrl: `?view=roadmap&sprint=5&sprintView=status`,
        },
        {
          id: "sprint-6-kanban-after",
          title: "Sprint 6 kanban (active)",
          expected: `After Move confirm: ${predictions.sprint.willRoll + predictions.sprint.review} carried-over cards across ${predictions.sprint.epicCount} epic${predictions.sprint.epicCount === 1 ? "" : "s"}, each with ↩ S5 pill.`,
          openUrl: `?view=roadmap&sprint=6`,
        },
      ],
    };

    // 2 · Month boundary — Apr 30 → May 1, both Q2.
    const monthRow: Row = {
      index: 2,
      title: "Month boundary",
      beforeLabel: "Apr 30, 23:30",
      beforeIso: isoForDayInstant(planYear, 4, 30, 23, 30),
      afterLabel: "May 1, 00:30",
      afterIso: isoForDayInstant(planYear, 5, 1, 0, 30),
      description:
        "April → May, both Q2. Without auto-month-rollover, May's capacity panel only shows epics planned for May — no overflow surface. The April → May sprint boundary still gets a Move button on the closed Sprint 8 view.",
      prediction: predictions.month,
      beforeChecks: [
        {
          id: "apr-capacity-before",
          title: "April month capacity",
          expected: "Live. No snapshot strip. Epics in their planned home.",
          openUrl: `?view=roadmap&monthPlan=month-capacity&month=4`,
        },
        {
          id: "apr-insights-before",
          title: "April month insights",
          expected: "Live data. No charts framing strip.",
          openUrl: `?view=roadmap&monthPlan=month-status&month=4`,
        },
        {
          id: "may-capacity-before",
          title: "May month capacity",
          expected: "Empty or only May-planned epics. No OVRFLW pills.",
          openUrl: `?view=roadmap&monthPlan=month-capacity&month=5`,
        },
        {
          id: "q2-capacity-before",
          title: "Q2 capacity",
          expected: "All Q2 epics live. No snapshot strip.",
          openUrl: `?view=roadmap&quarter=Q2&quarterTab=capacity`,
        },
      ],
      afterChecks: [
        {
          id: "apr-capacity-after",
          title: "April month capacity (past)",
          expected: "Snapshot strip. April-planned epics still in their slot — even after Sprint 8's Move confirm. (Epic-level overflow has been retired; only sprint kanban shows the move.)",
          openUrl: `?view=roadmap&monthPlan=month-capacity&month=4`,
        },
        {
          id: "apr-insights-after",
          title: "April month insights (past)",
          expected: "Charts framing strip. Pie / workload reflect Apr 30 close, not current state.",
          openUrl: `?view=roadmap&monthPlan=month-status&month=4`,
        },
        {
          id: "may-capacity-after",
          title: "May month capacity (active)",
          expected: "Only May-planned epics here. No OVRFLW pills (Phase 3 retired). If a Sprint 8 → Sprint 9 move happened, the stories show up under their parent epic's planned home (April), not as a May overflow.",
          openUrl: `?view=roadmap&monthPlan=month-capacity&month=5`,
        },
        {
          id: "q2-capacity-after",
          title: "Q2 capacity (still active)",
          expected: "Still live (both months are Q2). No snapshot strip.",
          openUrl: `?view=roadmap&quarter=Q2&quarterTab=capacity`,
        },
      ],
    };

    // 3 · Quarter boundary — Mar 31 → Apr 1, Q1 → Q2.
    const quarterRow: Row = {
      index: 3,
      title: "Quarter boundary",
      beforeLabel: "Mar 31, 23:30",
      beforeIso: isoForDayInstant(planYear, 3, 31, 23, 30),
      afterLabel: "Apr 1, 00:30",
      afterIso: isoForDayInstant(planYear, 4, 1, 0, 30),
      description: "March → April, Q1 → Q2. Verifies the month AND quarter strips fire.",
      prediction: predictions.quarter,
      beforeChecks: [
        {
          id: "mar-capacity-before",
          title: "March month capacity + insights",
          expected: "All live. No snapshot strips.",
          openUrl: `?view=roadmap&monthPlan=month-capacity&month=3`,
        },
        {
          id: "q1-capacity-before",
          title: "Q1 quarter capacity + insights",
          expected: "All live. No snapshot strips.",
          openUrl: `?view=roadmap&quarter=Q1&quarterTab=capacity`,
        },
        {
          id: "apr-capacity-before-q",
          title: "April month capacity",
          expected: "Empty or only April-planned epics.",
          openUrl: `?view=roadmap&monthPlan=month-capacity&month=4`,
        },
        {
          id: "q2-capacity-before-q",
          title: "Q2 quarter capacity",
          expected: "Empty or only Q2-planned epics.",
          openUrl: `?view=roadmap&quarter=Q2&quarterTab=capacity`,
        },
      ],
      afterChecks: [
        {
          id: "mar-capacity-after",
          title: "March month capacity + insights (past)",
          expected: `Snapshot strips on board and charts surfaces. Charts read Mar 31 state.`,
          openUrl: `?view=roadmap&monthPlan=month-capacity&month=3`,
        },
        {
          id: "q1-capacity-after",
          title: "Q1 quarter capacity + insights (past)",
          expected: `Snapshot strips on both surfaces.`,
          openUrl: `?view=roadmap&quarter=Q1&quarterTab=capacity`,
        },
        {
          id: "apr-capacity-after-q",
          title: "April month capacity (active)",
          expected: "Only April-planned epics here. No OVRFLW pills.",
          openUrl: `?view=roadmap&monthPlan=month-capacity&month=4`,
        },
        {
          id: "q2-capacity-after-q",
          title: "Q2 quarter capacity (active)",
          expected: "Only Q2-planned epics here. No OVRFLW pills.",
          openUrl: `?view=roadmap&quarter=Q2&quarterTab=capacity`,
        },
      ],
    };

    // 4 · Year boundary — Dec 31 → Jan 1 next year.
    const yearRow: Row = {
      index: 4,
      title: "Year boundary",
      beforeLabel: `Dec 31 ${planYear}, 23:30`,
      beforeIso: isoForDayInstant(planYear, 12, 31, 23, 30),
      afterLabel: `Jan 1 ${planYear + 1}, 00:30`,
      afterIso: isoForDayInstant(planYear + 1, 1, 1, 0, 30),
      description: `Sprint ${YEAR_SPRINT_MAX} (Dec) can't move forward inside the same year. The closed sprint's move button surfaces the "Add ${planYear + 1}" continuation flow instead of a within-year move.`,
      prediction: predictions.year,
      beforeChecks: [
        {
          id: "y-before-roadmap",
          title: `${planYear} roadmap`,
          expected: "Live view. No popup. No closed-year snapshot strip.",
          openUrl: `?view=roadmap&year=${planYear}`,
        },
      ],
      afterChecks: [
        {
          id: "y-popup",
          title: "Sprint 24 close-sprint button + year-end popup",
          expected: nextYearAlreadyConfigured
            ? `Sprint 24's Move button shows "Move N to Sprint 1 (${planYear + 1})" because ${planYear + 1} is already in the roadmap.`
            : `Sprint 24's Move button reads "Add ${planYear + 1} and continue" because the roadmap has no ${planYear + 1}. Clicking it surfaces the year-end overflow modal: "${predictions.year.willRoll} stor${predictions.year.willRoll === 1 ? "y" : "ies"} didn't fit in ${planYear}". Lists ${predictions.year.epicCount} epic${predictions.year.epicCount === 1 ? "" : "s"} under ${predictions.year.initiativeCount} initiative${predictions.year.initiativeCount === 1 ? "" : "s"}. Has [Add ${planYear + 1}] button.`,
        },
        {
          id: "y-add-action",
          title: `Click [Add ${planYear + 1}]`,
          expected: `Toast: "${planYear + 1} added — ${predictions.year.epicCount} continuation epic${predictions.year.epicCount === 1 ? "" : "s"}, ${predictions.year.willRoll} stor${predictions.year.willRoll === 1 ? "y" : "ies"} carried over". Roadmap now lists ${planYear + 1}.`,
        },
        {
          id: "y-cont-backlog",
          title: `${planYear + 1} backlog`,
          expected: `${predictions.year.epicCount} continuation epic${predictions.year.epicCount === 1 ? "" : "s"} with ↩ ${planYear} pill, all unscheduled.`,
          openUrl: `?view=roadmap&year=${planYear + 1}`,
        },
        {
          id: "y-back-prev",
          title: `${planYear} view (after adding ${planYear + 1})`,
          expected: "Closed-year snapshot strip at top of the timeline.",
          openUrl: `?view=roadmap&year=${planYear}`,
        },
      ],
    };

    return [sprintRow, monthRow, quarterRow, yearRow];
  }, [predictions, selectedYear, nextYearAlreadyConfigured]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto p-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="flex items-start gap-4">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md shadow-amber-300/60 ring-1 ring-white"
            aria-hidden
          >
            <Clock className="size-6" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Time Debugger</h1>
            <p className="mt-1 text-[13.5px] leading-snug text-slate-600">
              Walk through each rollover boundary against your current data. Each row predicts the
              transition with concrete counts, then jumps the clock to the boundary&rsquo;s edge so
              you can verify what you see. This page never modifies your data — only the clock the
              app reads.
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">
              <Clock className="size-3" aria-hidden />
              {clockSummary || "…"}
            </p>
          </div>
        </header>

        {rows.map((row) => (
          <BoundarySection
            key={row.title}
            row={row}
            onJump={setClockAndReload}
            yearForLinks={row.title === "Year boundary" ? selectedYear + 1 : selectedYear}
          />
        ))}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-slate-500">
            When you&rsquo;re review debugging
          </h2>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setClockAndReload(null, "Real time")}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-[13.5px] font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <RotateCcw className="size-4" aria-hidden />
              Reset clock to real time
            </button>
          </div>
          <p className="mt-2 text-[12.5px] leading-snug text-slate-500">
            Clears the override only. Data is untouched — anything that rolled / continuations /
            migrated stories stay. Use Demo Builder&rsquo;s Reset &amp; seed demo to get a clean dataset.
          </p>
        </section>
      </div>
    </div>
  );
}

function BoundarySection({
  row,
  onJump,
  yearForLinks,
}: {
  row: Row;
  onJump: (iso: string | null, label: string) => void;
  yearForLinks: number;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-start gap-3">
        <span
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700"
          aria-hidden
        >
          {row.index}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold tracking-tight text-slate-900">{row.title}</h2>
          <p className="mt-1 text-[12.5px] leading-snug text-slate-600">{row.description}</p>
          <p className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11.5px] font-semibold text-slate-700">
            <History className="size-3 text-slate-500" aria-hidden />
            Current Sprint {row.prediction.fromSprint} contents · {statusBreakdown(row.prediction)} ·{" "}
            {row.prediction.epicCount} epic{row.prediction.epicCount === 1 ? "" : "s"} affected
          </p>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onJump(row.beforeIso, `Step 1 (Before) — ${row.beforeLabel}`)}
          className="inline-flex h-auto items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-[12.5px] font-semibold text-amber-900 transition hover:border-amber-300 hover:bg-amber-100"
        >
          <TimerReset className="size-4 shrink-0 text-amber-700" aria-hidden />
          <span className="flex min-w-0 flex-col">
            <span>Step 1 — Before</span>
            <span className="text-[10.5px] font-medium text-amber-800/80">
              {row.beforeLabel} ({row.title.toLowerCase()} still active)
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onJump(row.afterIso, `Step 2 (After) — ${row.afterLabel}`)}
          className="inline-flex h-auto items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-left text-[12.5px] font-semibold text-indigo-900 transition hover:border-indigo-300 hover:bg-indigo-100"
        >
          <Clock className="size-4 shrink-0 text-indigo-700" aria-hidden />
          <span className="flex min-w-0 flex-col">
            <span>Step 2 — After</span>
            <span className="text-[10.5px] font-medium text-indigo-800/80">
              {row.afterLabel} ({row.title === "Year boundary" ? "next year started" : "next period started"})
            </span>
          </span>
        </button>
      </div>

      <Checklist title="After Step 1 you should see" entries={row.beforeChecks} yearForLinks={yearForLinks} accent="amber" />
      <Checklist title="After Step 2 you should see" entries={row.afterChecks} yearForLinks={yearForLinks} accent="indigo" />
    </section>
  );
}

function Checklist({
  title,
  entries,
  yearForLinks,
  accent,
}: {
  title: string;
  entries: ChecklistEntry[];
  yearForLinks: number;
  accent: "amber" | "indigo";
}) {
  // Local tick state — ephemeral, just for the user's own progress tracking.
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="mt-4">
      <h3
        className={cn(
          "text-[11.5px] font-bold uppercase tracking-wider",
          accent === "amber" ? "text-amber-700" : "text-indigo-700",
        )}
      >
        ▼ {title}
      </h3>
      <ul className="mt-2 space-y-2">
        {entries.map((entry) => {
          const isTicked = ticked.has(entry.id);
          return (
            <li
              key={entry.id}
              className="flex items-start gap-2 rounded-md border border-slate-200/80 bg-slate-50/60 p-2.5"
            >
              <button
                type="button"
                onClick={() => toggle(entry.id)}
                aria-pressed={isTicked}
                className={cn(
                  "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition",
                  isTicked
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-slate-300 bg-white text-transparent hover:border-slate-400",
                )}
                aria-label="Toggle verified"
              >
                {isTicked ? <Eye className="size-2.5" aria-hidden /> : null}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-slate-900">{entry.title}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-slate-600">{entry.expected}</p>
              </div>
              {entry.openUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    // Append yearForLinks for completeness when the URL doesn't already pin one.
                    const url = entry.openUrl!.includes("year=")
                      ? entry.openUrl!
                      : `${entry.openUrl!}&year=${yearForLinks}`;
                    window.open(url, "_blank", "noopener");
                  }}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  Open <ExternalLink className="size-3" aria-hidden />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
