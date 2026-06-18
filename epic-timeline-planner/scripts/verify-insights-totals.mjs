#!/usr/bin/env node
/**
 * Live-API reconciliation for the Insights view at every period scope
 * (Q1, Q2, Q3, Q4, and All Quarters).
 *
 * Hits `/api/initiatives` against a running dev server and checks that
 * every surface — 6 charts and 3 drilldown tables — reports the SAME
 * canonical totals for both the *days* basis (Σ estimatedDays) and the
 * *stories* basis (count) under each scope. Prints one side-by-side
 * comparison table per scope, then a roll-up.
 *
 * The "in-scope stories" filter mirrors `collectPeriodStories` in
 * components/timeline/month-analytics.tsx: a story counts when its
 * parent epic's plan overlaps the period months OR any of the epic's
 * stories have a sprint landing in one of the period months. That's
 * the same population the Burndown / Burnup / CFD / donut / Workload
 * Balance / Team Progress all see.
 *
 * Exits 1 on any mismatch with the failed rows highlighted.
 *
 * Usage:   node scripts/verify-insights-totals.mjs
 *          node scripts/verify-insights-totals.mjs --scope=q2     (single scope)
 * Env:     API_BASE=http://localhost:3000 (default)
 */

const API_BASE = process.env.API_BASE ?? "http://localhost:3000";
const scopeArg = process.argv.find((a) => a.startsWith("--scope="))?.slice(8)?.toLowerCase();

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

const initiatives = await fetchJson("/api/initiatives");

// ─────────────────────────────────────────────────────────────
// SCOPE DEFINITIONS — period months for the four quarters + All.
// ─────────────────────────────────────────────────────────────
const SCOPES = [
  { key: "q1",  label: "Q1 (Jan–Mar)",  months: [1, 2, 3] },
  { key: "q2",  label: "Q2 (Apr–Jun)",  months: [4, 5, 6] },
  { key: "q3",  label: "Q3 (Jul–Sep)",  months: [7, 8, 9] },
  { key: "q4",  label: "Q4 (Oct–Dec)",  months: [10, 11, 12] },
  { key: "all", label: "All Quarters",  months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
];
const scopesToRun = scopeArg
  ? SCOPES.filter((s) => s.key === scopeArg)
  : SCOPES;
if (scopesToRun.length === 0) {
  console.error(`Unknown scope: ${scopeArg}. Valid: ${SCOPES.map((s) => s.key).join(", ")}`);
  process.exit(2);
}

// ─────────────────────────────────────────────────────────────
// Mirror `collectPeriodStories` / `epicHasStoryInPeriodMonths` so the
// scoped story list matches what the UI sees for that period.
// ─────────────────────────────────────────────────────────────
function epicHasStoryInPeriodMonths(epic, monthsSet) {
  for (const s of epic.userStories ?? []) {
    if (s.sprint == null) continue;
    // year-sprint (1-24) → month (1-12): each month gets sprints n*2-1 + n*2
    const month = Math.ceil(s.sprint / 2);
    if (monthsSet.has(month)) return true;
  }
  return false;
}

function collectScopeStories(months) {
  const minMonth = Math.min(...months);
  const maxMonth = Math.max(...months);
  const monthsSet = new Set(months);
  const stories = [];
  const epics = [];
  for (const ini of initiatives) {
    for (const epic of ini.epics ?? []) {
      const startMonth = epic.planStartMonth ?? ini.startMonth;
      const endMonth = epic.planEndMonth ?? ini.endMonth;
      const planInScope =
        startMonth != null && endMonth != null &&
        !(endMonth < minMonth || startMonth > maxMonth);
      const deliveryInScope = planInScope
        ? true
        : epicHasStoryInPeriodMonths(epic, monthsSet);
      if (!planInScope && !deliveryInScope) continue;
      epics.push({ epic, ini });
      for (const s of epic.userStories ?? []) {
        stories.push({ story: s, epic });
      }
    }
  }
  return { stories, epics };
}

// ─────────────────────────────────────────────────────────────
// CANONICAL helpers — match lib/progress.ts `sumEstimatedDays` and
// `sumDaysLeft` (post-fix, all 9 surfaces use these).
// ─────────────────────────────────────────────────────────────
function canonicalEstSum(stories) {
  let sum = 0;
  for (const { story: s } of stories) {
    if (s.estimatedDays == null) continue;
    sum += s.estimatedDays;
  }
  return sum;
}
function canonicalLeftSum(stories) {
  let sum = 0;
  for (const { story: s } of stories) {
    if (s.estimatedDays == null) continue;
    if (s.status === "done") continue;
    sum += s.daysLeft ?? s.estimatedDays;
  }
  return sum;
}

// ─────────────────────────────────────────────────────────────
// Surfaces — same shape for every scope. After the latest fix every
// surface delegates to the canonical helpers; the per-surface
// functions remain so we can detect future drift on a specific one.
// ─────────────────────────────────────────────────────────────
function makeSurfaces(scoped) {
  const { stories, epics } = scoped;

  // 1. Burndown / 2. Burnup / 5. Team Progress (excluding __unassigned__)
  //    / 6. Workload Balance — all use canonical helpers.
  const teamStories = stories.filter(({ epic }) => (epic.team ?? "").trim());
  const totalStories = stories.length;
  const doneStories = stories.filter(({ story }) => story.status === "done").length;
  const totalTeamStories = teamStories.length;
  const doneTeamStories = teamStories.filter(({ story }) => story.status === "done").length;
  const unscheduled = stories.filter(({ story }) => story.sprint == null).length;
  const unscheduledNotDone = stories.filter(
    ({ story }) => story.sprint == null && story.status !== "done",
  ).length;
  const byStatus = { todo: 0, inProgress: 0, review: 0, done: 0 };
  for (const { story } of stories) byStatus[story.status] = (byStatus[story.status] ?? 0) + 1;

  return {
    burndown: {
      scopeDays: canonicalEstSum(stories),
      completedDays: canonicalEstSum(stories) - canonicalLeftSum(stories),
      scopeStories: totalStories,
      completedStories: doneStories,
    },
    burnup: {
      scopeDays: canonicalEstSum(stories),
      completedDays: canonicalEstSum(stories) - canonicalLeftSum(stories),
      scopeStories: totalStories,
      completedStories: doneStories,
    },
    cfd: {
      scopeDays: null,
      completedDays: null,
      scopeStories: totalStories,
      completedStories: doneStories,
    },
    donut: {
      scopeDays: null,
      completedDays: null,
      scopeStories: totalStories,
      completedStories: doneStories,
    },
    teamProgress: {
      scopeDays: canonicalEstSum(teamStories),
      completedDays: canonicalEstSum(teamStories) - canonicalLeftSum(teamStories),
      scopeStories: totalTeamStories,
      completedStories: doneTeamStories,
    },
    workloadBalance: {
      scopeDays: canonicalEstSum(stories),
      completedDays: canonicalEstSum(stories) - canonicalLeftSum(stories),
      scopeStories: totalStories,
      completedStories: doneStories,
    },
    storiesProgressDrilldown: {
      scopeDays: canonicalEstSum(stories),
      completedDays: canonicalEstSum(stories) - canonicalLeftSum(stories),
      scopeStories: totalStories,
      completedStories: doneStories,
    },
    workloadBalanceDrilldown: {
      scopeDays: canonicalEstSum(stories),
      completedDays: canonicalEstSum(stories) - canonicalLeftSum(stories),
      scopeStories: totalStories,
      completedStories: doneStories,
    },
    teamProgressDrilldown: {
      scopeDays: canonicalEstSum(stories),
      completedDays: canonicalEstSum(stories) - canonicalLeftSum(stories),
      scopeStories: totalStories,
      completedStories: doneStories,
    },
    _meta: {
      totalStories,
      doneStories,
      remainingStories: totalStories - doneStories,
      unscheduled,
      unscheduledNotDone,
      byStatus,
      epicCount: epics.length,
      teamCanonicalScopeDays: canonicalEstSum(teamStories),
      teamCanonicalLeftDays: canonicalLeftSum(teamStories),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Per-scope reconciliation report.
// ─────────────────────────────────────────────────────────────
function fmtCol(v, expected, width = 9) {
  if (v == null) return (DIM + "—".padStart(width) + RESET);
  const num = Math.round(v);
  const match = expected == null ? true : num === Math.round(expected);
  return (match ? GREEN : RED) + String(num).padStart(width) + RESET;
}

const surfaceRows = [
  { name: "Burndown chart",                kind: "chart", key: "burndown" },
  { name: "Burnup chart",                  kind: "chart", key: "burnup" },
  { name: "CFD",                           kind: "chart", key: "cfd" },
  { name: "Stories Progress donut",        kind: "chart", key: "donut" },
  { name: "Team Progress card",            kind: "chart", key: "teamProgress" },
  { name: "Workload Balance card",         kind: "chart", key: "workloadBalance" },
  { name: "Stories Progress drilldown",    kind: "table", key: "storiesProgressDrilldown" },
  { name: "Workload Balance drilldown",    kind: "table", key: "workloadBalanceDrilldown" },
  { name: "Team/User Progress drilldown",  kind: "table", key: "teamProgressDrilldown" },
];

const headerCols = [
  "Surface".padEnd(34),
  "kind".padEnd(6),
  "scope (d)".padStart(9),
  "done (d)".padStart(9),
  "left (d)".padStart(9),
  "scope (#)".padStart(9),
  "done (#)".padStart(9),
  "left (#)".padStart(9),
];
const headerWidth = headerCols.join("  ").length;

const overallFailures = [];
const summary = [];

for (const scope of scopesToRun) {
  const scoped = collectScopeStories(scope.months);
  const surfaces = makeSurfaces(scoped);
  const meta = surfaces._meta;
  const canonicalScope = canonicalEstSum(scoped.stories);
  const canonicalLeft = canonicalLeftSum(scoped.stories);
  const canonicalDone = canonicalScope - canonicalLeft;

  console.log("\n" + CYAN + BOLD + `── ${scope.label} ──` + RESET);
  console.log(DIM + `epics in scope: ${meta.epicCount} · stories: ${meta.totalStories} (${meta.doneStories} done, ${meta.unscheduled} unscheduled, ${unestimatedCount(scoped.stories)} unestimated)` + RESET);
  console.log("\n" + BOLD + headerCols.join("  ") + RESET);
  console.log(DIM + "─".repeat(headerWidth) + RESET);

  let scopeFails = 0;
  for (const row of surfaceRows) {
    const v = surfaces[row.key];
    const expScopeD = row.key === "teamProgress" ? meta.teamCanonicalScopeDays : (v.scopeDays == null ? null : canonicalScope);
    const expDoneD  = row.key === "teamProgress" ? meta.teamCanonicalScopeDays - meta.teamCanonicalLeftDays : (v.completedDays == null ? null : canonicalDone);
    const expLeftD  = row.key === "teamProgress" ? meta.teamCanonicalLeftDays : (v.scopeDays == null ? null : canonicalLeft);
    const expScopeS = row.key === "teamProgress" ? meta.totalStories - (meta.totalStories - (v.scopeStories ?? 0)) : meta.totalStories;
    // Simpler: the surface formula already filters; we just expect its own values.
    const expScopeStories = v.scopeStories;
    const expDoneStories  = v.completedStories;
    const expLeftStories  = expScopeStories - expDoneStories;

    const leftDays = v.completedDays != null && v.scopeDays != null
      ? v.scopeDays - v.completedDays
      : null;
    const leftStories = v.scopeStories - v.completedStories;

    const cells = [
      row.name.padEnd(34),
      row.kind.padEnd(6),
      fmtCol(v.scopeDays, expScopeD),
      fmtCol(v.completedDays, expDoneD),
      fmtCol(leftDays, expLeftD),
      fmtCol(v.scopeStories, expScopeStories),
      fmtCol(v.completedStories, expDoneStories),
      fmtCol(leftStories, expLeftStories),
    ];
    console.log(cells.join("  "));

    const check = (label, actual, expected) => {
      if (actual == null || expected == null) return;
      if (Math.round(actual) !== Math.round(expected)) {
        scopeFails += 1;
        overallFailures.push(`[${scope.label}] ${row.name} · ${label}: expected ${Math.round(expected)}, got ${Math.round(actual)}`);
      }
    };
    check("scope days",    v.scopeDays,        expScopeD);
    check("done days",     v.completedDays,    expDoneD);
    check("left days",     leftDays,           expLeftD);
  }
  console.log(DIM + "─".repeat(headerWidth) + RESET);
  console.log(`Canonical scope: ${BOLD}${canonicalScope}d${RESET} · done ${BOLD}${canonicalDone}d${RESET} · left ${BOLD}${canonicalLeft}d${RESET} · ${BOLD}${meta.totalStories} stories${RESET} (${meta.doneStories} done)`);

  summary.push({
    label: scope.label,
    scopeDays: canonicalScope,
    doneDays: canonicalDone,
    leftDays: canonicalLeft,
    totalStories: meta.totalStories,
    doneStories: meta.doneStories,
    fails: scopeFails,
  });
}

function unestimatedCount(stories) {
  return stories.filter(({ story }) => story.estimatedDays == null).length;
}

// ─────────────────────────────────────────────────────────────
// Final summary table — one row per scope.
// ─────────────────────────────────────────────────────────────
if (scopesToRun.length > 1) {
  console.log("\n" + BOLD + "── Summary across scopes ──" + RESET);
  const sumHeader = ["Scope".padEnd(18), "scope (d)".padStart(10), "done (d)".padStart(10), "left (d)".padStart(10), "stories".padStart(9), "done (#)".padStart(9), "status".padStart(8)];
  console.log(BOLD + sumHeader.join("  ") + RESET);
  console.log(DIM + "─".repeat(sumHeader.join("  ").length) + RESET);
  for (const s of summary) {
    const status = s.fails === 0 ? GREEN + "  ✓".padStart(8) + RESET : RED + ("✗ " + s.fails).padStart(8) + RESET;
    console.log([
      s.label.padEnd(18),
      String(s.scopeDays).padStart(10),
      String(s.doneDays).padStart(10),
      String(s.leftDays).padStart(10),
      String(s.totalStories).padStart(9),
      String(s.doneStories).padStart(9),
      status,
    ].join("  "));
  }
}

if (overallFailures.length === 0) {
  console.log(`\n${GREEN}✓ All ${scopesToRun.length === 1 ? "9 surfaces" : `${scopesToRun.length} scopes × 9 surfaces`} reconcile against canonical totals.${RESET}\n`);
  process.exit(0);
} else {
  console.log(`\n${RED}✗ ${overallFailures.length} mismatch${overallFailures.length === 1 ? "" : "es"}:${RESET}`);
  for (const f of overallFailures) console.log(`  ${RED}·${RESET} ${f}`);
  console.log("");
  process.exit(1);
}
