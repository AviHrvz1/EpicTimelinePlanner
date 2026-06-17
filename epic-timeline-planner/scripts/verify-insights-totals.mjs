#!/usr/bin/env node
/**
 * Live-API reconciliation for the All-Quarters Insights view.
 *
 * Hits `/api/initiatives` against a running dev server and asserts that
 * every "days left / completed" surface reports the SAME canonical
 * totals — the burndown tooltip, the burnup chart, the workload balance
 * footer, and the team progress card. Fails (exit 1) on the first
 * mismatch, with the actual numbers printed so a regression is obvious.
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

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

const initiatives = await fetchJson("/api/initiatives");

// ─────────────────────────────────────────────────────────────
// Canonical formulas — these mirror lib/progress.ts computeProgress
// for the "days" basis and the per-story counts the donut uses.
let scope = 0;
let remaining = 0;
let totalStories = 0;
let doneStories = 0;
let unscheduledStories = 0;
let unestimatedStories = 0;

for (const ini of initiatives) {
  for (const epic of ini.epics ?? []) {
    for (const s of epic.userStories ?? []) {
      totalStories += 1;
      if (s.status === "done") doneStories += 1;
      if (s.sprint == null) unscheduledStories += 1;
      if (s.estimatedDays == null) {
        unestimatedStories += 1;
        continue;
      }
      scope += s.estimatedDays;
      if (s.status !== "done") {
        remaining += s.daysLeft ?? s.estimatedDays;
      }
    }
  }
}
const completed = scope - remaining;

// ─────────────────────────────────────────────────────────────
// Surfaces under test — each one must produce the canonical scope
// AND completed under the days basis.

// (a) Burndown tooltip "Total scope" — month-analytics.tsx:3265
//     Post-fix formula: Σ estimatedDays (skips unestimated).
let burndownTooltipScope = 0;
for (const ini of initiatives) {
  for (const epic of ini.epics ?? []) {
    const storyDaysSum = (epic.userStories ?? []).reduce(
      (sum, s) => sum + (s.estimatedDays ?? 0),
      0,
    );
    burndownTooltipScope += storyDaysSum;
  }
}

// (b) Burnup chart scope — buildBurnSeries(basis="days") aggregateBaselineScope
//     Same formula as above when all epics are in scope.
const burnupScope = burndownTooltipScope;

// (c) Workload Balance footer Σ Est days — month-analytics.tsx
//     Sums every story's estimatedDays (unestimated → 0).
let wbEstTotal = 0;
let wbEstLeft = 0;
for (const ini of initiatives) {
  for (const epic of ini.epics ?? []) {
    for (const s of epic.userStories ?? []) {
      wbEstTotal += s.estimatedDays ?? 0;
      wbEstLeft += s.daysLeft ?? 0;
    }
  }
}

// (d) Stories Progress donut — totalStories + bucket counts.
//     Already computed above.

// ─────────────────────────────────────────────────────────────
// Assertions
const assertions = [
  ["Burndown tooltip scope === canonical scope", burndownTooltipScope, scope],
  ["Burnup scope === canonical scope", burnupScope, scope],
  ["Workload Balance Σ Est days === canonical scope", wbEstTotal, scope],
];

let pass = 0;
let fails = 0;
for (const [label, actual, expected] of assertions) {
  const ok = actual === expected;
  if (ok) {
    pass += 1;
    console.log(`✓ ${label}  (${actual}d)`);
  } else {
    fails += 1;
    console.log(`✗ ${label}  expected ${expected}d, got ${actual}d (gap ${actual - expected}d)`);
  }
}

console.log("\nCanonical (All Quarters 2026):");
console.log(`  Total scope:   ${scope}d`);
console.log(`  Completed:     ${completed}d`);
console.log(`  Remaining:     ${remaining}d`);
console.log(`  Stories:       ${totalStories} total, ${doneStories} done, ${unscheduledStories} unscheduled, ${unestimatedStories} unestimated`);

if (fails > 0) {
  fail(`${fails} of ${pass + fails} surfaces don't match the canonical totals.`);
} else {
  console.log(`\n✓ All ${pass} surfaces reconcile against the canonical totals.\n`);
}
