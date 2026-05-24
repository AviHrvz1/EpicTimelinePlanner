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
