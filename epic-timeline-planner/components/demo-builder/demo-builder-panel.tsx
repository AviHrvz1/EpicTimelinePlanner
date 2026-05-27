"use client";

import { useState } from "react";
import { Database, Loader2, RefreshCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Internal admin page for resetting and reseeding the planner with a
 * curated demo dataset. Two actions:
 *
 *  - **Reset & seed demo** — wipes app data (initiatives, epics, stories,
 *    snapshots, workspace users, dashboards, roadmaps) and reseeds with 10
 *    initiatives × 5 epics × 10 stories, 38 users across 5 teams, and
 *    realistic per-workday story snapshots so all charts look meaningful.
 *  - **Refresh snapshots to today** — extends the existing dataset's
 *    snapshots up to today without changing scope. Useful when you want
 *    "today" to advance without losing the structure.
 *
 * Auth tables (User/Account/Session/etc) are deliberately preserved so the
 * person clicking these buttons doesn't sign themselves out.
 */
export function DemoBuilderPanel() {
  const [busy, setBusy] = useState<"reset" | "refresh" | null>(null);

  const runReset = async () => {
    if (busy) return;
    setBusy("reset");
    const t = toast.loading("Wiping app data and reseeding…");
    try {
      const res = await fetch("/api/demo-builder/reset-seed", { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      const body = (await res.json()) as { initiatives: number; epics: number; stories: number; users: number; snapshots: number };
      // Sprint retrospective docs live in localStorage (not the DB), so the
      // server-side seed can't populate them. Write sample docs for every
      // already-completed sprint of the current plan year so the
      // retrospective tab reads as "team has been holding retros" instead
      // of blank when you navigate back to past sprints.
      seedDemoRetrospectives();
      toast.success(
        `Demo ready — ${body.initiatives} initiatives · ${body.epics} epics · ${body.stories} stories · ${body.users} users · ${body.snapshots} snapshots`,
        { id: t },
      );
      // Force every other surface in the app to refetch its data.
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed", { id: t });
    } finally {
      setBusy(null);
    }
  };

  const runRefresh = async () => {
    if (busy) return;
    setBusy("refresh");
    const t = toast.loading("Extending snapshots to today…");
    try {
      const res = await fetch("/api/demo-builder/refresh-snapshots", { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      const body = (await res.json()) as { added: number; through: string };
      toast.success(`Added ${body.added} snapshots up through ${body.through}`, { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed", { id: t });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto p-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="flex items-start gap-4">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-md shadow-violet-300/60 ring-1 ring-white"
            aria-hidden
          >
            <Sparkles className="size-6" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Demo Builder</h1>
            <p className="mt-1 text-[13.5px] leading-snug text-slate-600">
              Internal page — wipe the planner&rsquo;s app data and reseed it with a curated, realistic demo. Auth /
              login data is preserved, so you won&rsquo;t be signed out.
            </p>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-slate-500">What gets created</h2>
          <ul className="mt-3 grid grid-cols-1 gap-2 text-[13.5px] text-slate-700 sm:grid-cols-2">
            <li><strong>10</strong> initiatives spread across all 4 quarters, one per timeline row</li>
            <li><strong>50</strong> epics (5 per initiative — one for each team)</li>
            <li><strong>500</strong> user stories (10 per epic)</li>
            <li><strong>38</strong> workspace users with photos, across 5 teams</li>
            <li><strong>5</strong> teams — Platform, Mobile, Experience, Data &amp; analytics, Growth</li>
            <li>Per-workday <strong>story snapshots</strong> from sprint start through today</li>
          </ul>
          <p className="mt-3 text-[12.5px] leading-snug text-slate-500">
            Burndown / burnup curves are generated to mostly track ideal, with ~15% of stories running ahead and ~15%
            running behind — enough variance to look real without being noisy.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-slate-500">What gets wiped</h2>
          <ul className="mt-3 grid grid-cols-1 gap-1.5 text-[13.5px] text-slate-700 sm:grid-cols-2">
            <li>All initiatives, epics, user stories</li>
            <li>All story snapshots + comments + history</li>
            <li>All workspace users + uploaded avatars</li>
            <li>All dashboards + dashboard charts</li>
            <li>All roadmaps</li>
            <li className="text-emerald-700"><strong>Kept:</strong> your login + session</li>
          </ul>
        </section>

        <section className="flex flex-wrap items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={runRefresh}
            disabled={!!busy}
            className="h-10 gap-2 px-4 text-[13.5px] font-semibold"
          >
            {busy === "refresh" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCcw className="size-4" aria-hidden />}
            Refresh snapshots to today
          </Button>
          <Button
            type="button"
            onClick={runReset}
            disabled={!!busy}
            className="h-10 gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 px-5 text-[13.5px] font-bold text-white shadow-sm shadow-violet-500/30 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
          >
            {busy === "reset" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Database className="size-4" aria-hidden />}
            Reset &amp; seed demo
          </Button>
        </section>
      </div>
    </div>
  );
}

/**
 * localStorage key shape mirrors `epic-planner-app.tsx`:
 *   - `epicPlanner.sprintRetrospective.v1` → record keyed by
 *     `"<year>:<yearSprint>:<teamId>"` (the retro editor renders one doc
 *     PER TEAM; the bare `"<year>:<yearSprint>"` key is never read).
 *   - Each value: `{ wentWellHtml, improveHtml, actionItems[], updatedAt }`
 *     and each action item is `{ id, title, owner, dueDate }` per the
 *     `SprintRetroActionItem` shape consumed by SprintRetrospectiveEditor.
 *
 * For every sprint that has ended before today, we write a doc for each
 * of the 5 demo teams — that's what the retro accordion expects when
 * "All Teams" is selected. Content rotates through the curated pool so
 * each team's retro reads as a distinct conversation.
 */
const DEMO_RETRO_TEAM_SLUGS = ["platform", "mobile", "experience", "data", "growth"] as const;

function seedDemoRetrospectives() {
  if (typeof window === "undefined") return;
  const STORAGE_KEY = "epicPlanner.sprintRetrospective.v1";
  const now = new Date();
  const year = now.getFullYear();
  // Walk year-sprints 1..24 and pick the ones whose calendar window has
  // already ended (last day of the 2-sprint-per-month split).
  type ActionItem = { id: string; title: string; owner: string; dueDate: string };
  type RetroDoc = {
    wentWellHtml: string;
    improveHtml: string;
    actionItems: ActionItem[];
    updatedAt: string;
  };
  const docs: Record<string, RetroDoc> = {};
  for (let s = 1; s <= 24; s++) {
    const month = Math.ceil(s / 2);
    const lane = s % 2 === 0 ? 2 : 1;
    const lastDay = lane === 1
      ? new Date(year, month - 1, 15, 23, 59, 59, 999)
      : new Date(year, month, 0, 23, 59, 59, 999);
    if (lastDay >= now) break; // future sprint or current — skip
    // Per-team docs — the retro accordion shows one panel per team and
    // pulls each panel's doc by `<year>:<sprint>:<team>`. Vary the
    // content pool by (sprint, team) so two teams in the same sprint
    // don't render identical retros.
    for (let teamIdx = 0; teamIdx < DEMO_RETRO_TEAM_SLUGS.length; teamIdx++) {
      const team = DEMO_RETRO_TEAM_SLUGS[teamIdx]!;
      const variantSeed = (s - 1) + teamIdx;
      const went = DEMO_RETRO_WENT_WELL[variantSeed % DEMO_RETRO_WENT_WELL.length]!;
      const improve = DEMO_RETRO_IMPROVE[variantSeed % DEMO_RETRO_IMPROVE.length]!;
      const actionPool = DEMO_RETRO_ACTIONS[variantSeed % DEMO_RETRO_ACTIONS.length]!;
      // Pick a deterministic owner-due-date pair per action item so the
      // action cards render with an avatar chip + due-date pill (otherwise
      // the card collapses to just the title).
      const actionItems: ActionItem[] = actionPool.map((entry, i) => {
        const owner = entry.owner ?? DEMO_RETRO_OWNERS[(variantSeed + i) % DEMO_RETRO_OWNERS.length]!;
        // Due date sits 1-3 weeks after the sprint closed so it reads as a
        // realistic next-sprint commitment. ISO yyyy-mm-dd to match the
        // <input type="date"> field rendering.
        const due = new Date(lastDay);
        due.setDate(due.getDate() + 7 * (i + 1));
        const dueDate = due.toISOString().slice(0, 10);
        return { id: `demo-${s}-${team}-${i}`, title: entry.title, owner, dueDate };
      });
      docs[`${year}:${s}:${team}`] = {
        wentWellHtml: bulletsToHtml(went),
        improveHtml: bulletsToHtml(improve),
        actionItems,
        updatedAt: lastDay.toISOString(),
      };
    }
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
  } catch {
    /* localStorage may be unavailable (private mode) — best-effort. */
  }
}

function bulletsToHtml(bullets: readonly string[]): string {
  return `<ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DEMO_RETRO_WENT_WELL: readonly (readonly string[])[] = [
  ["Strong cross-team alignment on the launch", "Daily standups stayed under 15 min", "QA caught two critical regressions before release"],
  ["Velocity matched the plan within ±10%", "PR review turnaround improved", "Pairing sessions resolved blockers same-day"],
  ["No production incidents this sprint", "Sprint goals shipped on the planned date", "Customer-research findings made it into the next-sprint plan"],
  ["Refactor unblocked three downstream stories", "On-call load was light", "Design + eng collaboration on the new spec went smoothly"],
];

const DEMO_RETRO_IMPROVE: readonly (readonly string[])[] = [
  ["Estimates were optimistic on the data-warehouse stories", "Tickets started without clear acceptance criteria", "Staging environment was flaky on Wednesday"],
  ["Code review wait time spiked mid-sprint", "Last-minute scope add forced a re-plan", "Test coverage on the new module is still light"],
  ["Mobile build broke twice from un-merged migrations", "Sprint retro started 10 min late", "Documentation for the new auth flow is missing"],
  ["Capacity didn't account for the team offsite", "API contract changed midway and forced rework", "Several stories rolled to the next sprint"],
];

/**
 * Each pool entry is a `{title, owner?}` object so the seeded action card has
 * a real title AND a named owner (chip + initials avatar). When `owner` is
 * omitted the seeder picks one round-robin from `DEMO_RETRO_OWNERS` keyed by
 * sprint+index — deterministic across re-seeds.
 */
const DEMO_RETRO_ACTIONS: readonly (readonly { title: string; owner?: string }[])[] = [
  [
    { title: "Lock acceptance criteria before sprint starts" },
    { title: "Add staging healthcheck alert" },
    { title: "Pair on data-warehouse estimates next time" },
  ],
  [
    { title: "Set 4-hour PR review SLA" },
    { title: "Hold scope changes for next sprint" },
    { title: "Increase unit test coverage to 80%", owner: "Carmen Ortega" },
  ],
  [
    { title: "Add migration-status check to mobile CI" },
    { title: "Move retro to a calendar block" },
    { title: "Write auth-flow runbook", owner: "Diego Park" },
  ],
  [
    { title: "Reserve offsite weeks in capacity board" },
    { title: "Lock API contracts at sprint kickoff" },
    { title: "Triage rollover stories on Monday morning" },
  ],
];

const DEMO_RETRO_OWNERS: readonly string[] = [
  "Aaron Mendel",
  "Carmen Ortega",
  "Diego Park",
  "Priya Shah",
  "Liam Chen",
  "Sophia Reyes",
];
