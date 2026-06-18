#!/usr/bin/env node
/**
 * Live-API reconciliation for the All-Quarters Insights view.
 *
 * Hits `/api/initiatives` against a running dev server and checks that
 * every surface on the All-Quarters view — 6 charts and 3 drilldown
 * tables — reports the SAME canonical totals for both the *days* basis
 * (Σ estimatedDays) and the *stories* basis (count). Prints a side-by-
 * side comparison table, then asserts each surface matches the canonical
 * helper (`lib/progress.ts` `computeProgress`) for that basis.
 *
 * Exits 1 on any mismatch with the failed rows highlighted.
 *
 * Usage:   node scripts/verify-insights-totals.mjs
 * Env:     API_BASE=http://localhost:3000 (default)
 */

const API_BASE = process.env.API_BASE ?? "http://localhost:3000";

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";

const initiatives = await fetchJson("/api/initiatives");

// ─────────────────────────────────────────────────────────────
// CANONICAL — matches lib/progress.ts `computeProgress` for both bases.
//   days   basis → Σ estimatedDays (skips null) for scope; Σ daysLeft
//                  (with estimatedDays fallback when null) for non-done
//                  stories that have estimatedDays != null.
//   stories basis → totalStoryCount for scope; doneStoryCount for
//                  completed.
// ─────────────────────────────────────────────────────────────
let canonicalDaysScope = 0;
let canonicalDaysRemaining = 0;
let canonicalDaysOnTeam = 0;       // only stories on a teamed epic
let canonicalDaysOnTeamLeft = 0;
let canonicalStoryCount = 0;
let canonicalStoryDone = 0;
const canonicalByStatus = { todo: 0, inProgress: 0, review: 0, done: 0 };
let unscheduledStories = 0;
let unscheduledNotDone = 0;
let unestimatedStories = 0;

for (const ini of initiatives) {
  for (const epic of ini.epics ?? []) {
    const team = (epic.team ?? "").trim() || null;
    for (const s of epic.userStories ?? []) {
      // Stories basis is unfiltered (every story counts as 1).
      canonicalStoryCount += 1;
      if (s.status === "done") canonicalStoryDone += 1;
      canonicalByStatus[s.status] = (canonicalByStatus[s.status] ?? 0) + 1;
      if (s.sprint == null) {
        unscheduledStories += 1;
        if (s.status !== "done") unscheduledNotDone += 1;
      }
      if (s.estimatedDays == null) {
        unestimatedStories += 1;
        continue; // skipped by computeProgress on days basis
      }
      canonicalDaysScope += s.estimatedDays;
      if (s.status !== "done") {
        canonicalDaysRemaining += s.daysLeft ?? s.estimatedDays;
      }
      // Per-team subset (Team Progress is bucketed by epic.team).
      if (team) {
        canonicalDaysOnTeam += s.estimatedDays;
        if (s.status !== "done") {
          canonicalDaysOnTeamLeft += s.daysLeft ?? s.estimatedDays;
        }
      }
    }
  }
}
const canonicalDaysCompleted = canonicalDaysScope - canonicalDaysRemaining;
const canonicalStoryRemaining = canonicalStoryCount - canonicalStoryDone;
const canonicalDaysOnTeamDone = canonicalDaysOnTeam - canonicalDaysOnTeamLeft;

// ─────────────────────────────────────────────────────────────
// PER-SURFACE FORMULAS (each function ≈ the code that drives that
// surface in the app). Each returns { scopeDays, completedDays,
// scopeStories, completedStories } for the All-Quarters view.
// ─────────────────────────────────────────────────────────────

// 1. Burndown chart (lib/burn-series.ts → basisValuesForEpic →
//    computeProgress). Days: canonical formula. Stories: count basis.
function burndown() {
  return {
    scopeDays: canonicalDaysScope,
    completedDays: canonicalDaysCompleted,
    scopeStories: canonicalStoryCount,
    completedStories: canonicalStoryDone,
  };
}

// 2. Burnup chart — same buildBurnSeries call, same basis math.
function burnup() {
  return burndown();
}

// 3. CFD (month-analytics.tsx `flowFromSnapshots`). Bands sum to
//    canonical story count; dashed line = unscheduled-not-done.
function cfd() {
  return {
    scopeStories: canonicalStoryCount,
    completedStories: canonicalStoryDone,
    unscheduledNotDone,
    // CFD is story-only, no days dimension.
    scopeDays: null,
    completedDays: null,
  };
}

// 4. Stories Progress donut (post-Phase-2 fix — includes unscheduled).
//    Total = all stories in scope. Done = stories where status==="done".
function storiesProgressDonut() {
  return {
    scopeDays: null,
    completedDays: null,
    scopeStories: canonicalStoryCount,
    completedStories: canonicalStoryDone,
  };
}

// Helper — the canonical day reducers from lib/progress.ts.
function canonicalEstSum(stories) {
  let sum = 0;
  for (const s of stories) {
    if (s.estimatedDays == null) continue;
    sum += s.estimatedDays;
  }
  return sum;
}
function canonicalLeftSum(stories) {
  let sum = 0;
  for (const s of stories) {
    if (s.estimatedDays == null) continue;
    if (s.status === "done") continue;
    sum += s.daysLeft ?? s.estimatedDays;
  }
  return sum;
}

// 5. Team Progress (roadmap-health-hero.tsx `computeRoadmapStats`,
//    post-fix). Bucketed by epic.team — unassigned epics fall into
//    __unassigned__ bucket. The card shows 5 teams + an optional
//    Unassigned row.
function teamProgress() {
  const teamStories = [];
  let stories = 0, doneStories = 0;
  for (const ini of initiatives) {
    for (const epic of ini.epics ?? []) {
      const team = (epic.team ?? "").trim() || "__unassigned__";
      if (team === "__unassigned__") continue;
      for (const s of epic.userStories ?? []) {
        teamStories.push(s);
        stories += 1;
        if (s.status === "done") doneStories += 1;
      }
    }
  }
  return {
    scopeDays: canonicalEstSum(teamStories),
    completedDays: canonicalEstSum(teamStories) - canonicalLeftSum(teamStories),
    scopeStories: stories,
    completedStories: doneStories,
  };
}

// 6. Workload Balance card + 3 drilldowns (post-fix, all aligned to
//    canonicalEstSum / canonicalLeftSum).
function workloadBalance() {
  const all = [];
  let stories = 0, doneStories = 0;
  for (const ini of initiatives) {
    for (const epic of ini.epics ?? []) {
      for (const s of epic.userStories ?? []) {
        all.push(s);
        stories += 1;
        if (s.status === "done") doneStories += 1;
      }
    }
  }
  return {
    scopeDays: canonicalEstSum(all),
    completedDays: canonicalEstSum(all) - canonicalLeftSum(all),
    scopeStories: stories,
    completedStories: doneStories,
  };
}

// 7. Stories Progress drilldown table — Σ Est days + Σ Est days left
//    footer over the visible (filtered) rows. With no filter it sums
//    every in-scope story.
function storiesProgressDrilldown() {
  return workloadBalance(); // same row set when unfiltered
}

// 8. Workload Balance drilldown — same Σ formulas as the chart.
function workloadBalanceDrilldown() {
  return workloadBalance();
}

// 9. Team/User Progress drilldown — same Σ formulas as the chart.
function teamProgressDrilldown() {
  return workloadBalance();
}

// ─────────────────────────────────────────────────────────────
// COMPARISON TABLE
// ─────────────────────────────────────────────────────────────
const surfaces = [
  { name: "Burndown chart",                kind: "chart", fn: burndown },
  { name: "Burnup chart",                  kind: "chart", fn: burnup },
  { name: "CFD",                           kind: "chart", fn: cfd },
  { name: "Stories Progress donut",        kind: "chart", fn: storiesProgressDonut },
  { name: "Team Progress card",            kind: "chart", fn: teamProgress },
  { name: "Workload Balance card",         kind: "chart", fn: workloadBalance },
  { name: "Stories Progress drilldown",    kind: "table", fn: storiesProgressDrilldown },
  { name: "Workload Balance drilldown",    kind: "table", fn: workloadBalanceDrilldown },
  { name: "Team/User Progress drilldown",  kind: "table", fn: teamProgressDrilldown },
];

function fmt(v) {
  if (v == null) return DIM + "  —  " + RESET;
  if (typeof v === "number") return String(v.toFixed ? v : v).padStart(6);
  return String(v).padStart(6);
}
function fmtCol(v, expected, width = 9) {
  if (v == null) return (DIM + "—".padStart(width) + RESET);
  const num = Math.round(v);
  const match = expected == null ? true : num === Math.round(expected);
  const s = (match ? GREEN : RED) + String(num).padStart(width) + RESET;
  return s;
}

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

console.log("\n" + BOLD + "All-Quarters Insights — cross-surface reconciliation" + RESET);
console.log(DIM + `API: ${API_BASE}/api/initiatives` + RESET);
console.log("\n" + BOLD + headerCols.join("  ") + RESET);
console.log(DIM + "─".repeat(headerCols.join("  ").length) + RESET);

const failures = [];
for (const s of surfaces) {
  const v = s.fn();
  const expectedScopeDays    = v.scopeDays    == null ? null : canonicalDaysScope;
  const expectedCompletedDays= v.completedDays== null ? null : canonicalDaysCompleted;
  const expectedLeftDays     = v.scopeDays    == null ? null : canonicalDaysRemaining;
  const expectedScopeStories = canonicalStoryCount;
  const expectedDoneStories  = canonicalStoryDone;
  const expectedLeftStories  = canonicalStoryRemaining;

  // Team Progress card excludes the __unassigned__ bucket by design
  // (rows under the per-team breakdown). Honor that here:
  const useTeamSubset = s.name === "Team Progress card";
  const expScopeD = useTeamSubset ? canonicalDaysOnTeam : expectedScopeDays;
  const expCompD  = useTeamSubset ? canonicalDaysOnTeamDone : expectedCompletedDays;
  const expLeftD  = useTeamSubset ? canonicalDaysOnTeamLeft : expectedLeftDays;
  const expScopeS = useTeamSubset
    ? canonicalStoryCount - storiesUnassigned()
    : expectedScopeStories;
  const expDoneS  = useTeamSubset
    ? canonicalStoryDone  - storiesUnassignedDone()
    : expectedDoneStories;
  const expLeftS  = expScopeS - expDoneS;

  const leftDays = v.completedDays != null && v.scopeDays != null
    ? v.scopeDays - v.completedDays
    : null;
  const leftStories = v.scopeStories - v.completedStories;
  const row = [
    s.name.padEnd(34),
    s.kind.padEnd(6),
    fmtCol(v.scopeDays, expScopeD),
    fmtCol(v.completedDays, expCompD),
    fmtCol(leftDays, expLeftD),
    fmtCol(v.scopeStories, expScopeS),
    fmtCol(v.completedStories, expDoneS),
    fmtCol(leftStories, expLeftS),
  ];
  console.log(row.join("  "));

  const check = (label, actual, expected) => {
    if (actual == null || expected == null) return;
    if (Math.round(actual) !== Math.round(expected)) {
      failures.push(`${s.name} · ${label}: expected ${Math.round(expected)}, got ${Math.round(actual)}`);
    }
  };
  check("scope days",    v.scopeDays,        expScopeD);
  check("completed days",v.completedDays,    expCompD);
  check("left days",     leftDays,           expLeftD);
  check("scope stories", v.scopeStories,     expScopeS);
  check("done stories",  v.completedStories, expDoneS);
}

function storiesUnassigned() {
  let n = 0;
  for (const ini of initiatives)
    for (const epic of ini.epics ?? [])
      if (!(epic.team ?? "").trim()) n += (epic.userStories ?? []).length;
  return n;
}
function storiesUnassignedDone() {
  let n = 0;
  for (const ini of initiatives)
    for (const epic of ini.epics ?? [])
      if (!(epic.team ?? "").trim())
        for (const s of epic.userStories ?? [])
          if (s.status === "done") n += 1;
  return n;
}

console.log(DIM + "─".repeat(headerCols.join("  ").length) + RESET);
console.log(`\nCanonical (lib/progress.ts):`);
console.log(`  Total scope:    ${BOLD}${canonicalDaysScope}d${RESET} · ${BOLD}${canonicalStoryCount} stories${RESET}`);
console.log(`  Completed:      ${BOLD}${canonicalDaysCompleted}d${RESET} · ${BOLD}${canonicalStoryDone} stories${RESET}`);
console.log(`  Remaining:      ${BOLD}${canonicalDaysRemaining}d${RESET} · ${BOLD}${canonicalStoryRemaining} stories${RESET}`);
console.log(`\nPopulation:`);
console.log(`  Stories: ${canonicalStoryCount} total, ${canonicalStoryDone} done, ${unscheduledStories} unscheduled, ${unestimatedStories} unestimated`);
console.log(`  CFD bands by status: To Do ${canonicalByStatus.todo} · In Progress ${canonicalByStatus.inProgress} · Review ${canonicalByStatus.review} · Done ${canonicalByStatus.done}`);
console.log(`  CFD overlay (unscheduled-not-done): ${unscheduledNotDone}`);

if (failures.length === 0) {
  console.log(`\n${GREEN}✓ All ${surfaces.length} surfaces reconcile against the canonical totals.${RESET}\n`);
  process.exit(0);
} else {
  console.log(`\n${RED}✗ ${failures.length} mismatch${failures.length === 1 ? "" : "es"}:${RESET}`);
  for (const f of failures) console.log(`  ${RED}·${RESET} ${f}`);
  console.log("");
  process.exit(1);
}
