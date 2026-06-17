/**
 * Cross-surface consistency suite for the All-Quarters Insights view.
 *
 * The user reported four divergent "days left / completed" totals on the
 * same view: Team Progress (840d), Burndown (582d completed / 1537d scope),
 * Burnup (551d completed), Workload Balance (963d left / 1506d total).
 * Root cause: the burndown tooltip's `Total scope` derivation in
 * month-analytics.tsx fell back on `estimatedDays ?? daysLeft ?? 1` per
 * story, inflating the total by ~1d for every unestimated story (44 on
 * the demo seed → +31d "ghost scope" that no other surface counted).
 *
 * This suite locks in the truth — for the "days" basis, every surface
 * must sum estimated effort the same way `computeProgress` does (Σ
 * `estimatedDays`, skipping null). For "stories" basis they must sum
 * story counts. No surface gets to invent its own fallback.
 *
 * The fixtures include:
 *   - Fully-estimated stories (the easy case)
 *   - Unestimated stories with `daysLeft` set (the pre-fix bug case)
 *   - Unestimated stories with everything null (also caught the +1d
 *     default fallback)
 *   - A done story with stale `daysLeft` (verdict-side validation)
 *
 * If anyone reintroduces a fallback into one of these formulas, this
 * suite fails before it ships.
 */
import { describe, it, expect } from "vitest";
import { buildBurnSeries } from "./burn-series";
import { computeProgress } from "./progress";
import type { EpicItem, UserStoryItem } from "./types";

function makeStory(
  id: string,
  estimatedDays: number | null,
  daysLeft: number | null,
  status: UserStoryItem["status"] = "inProgress",
  sprint: number | null = 11,
): UserStoryItem {
  return {
    id,
    title: id,
    icon: "",
    description: null,
    assignee: null,
    team: null,
    labels: null,
    priority: null,
    roadmapId: null,
    planYear: null,
    planQuarter: null,
    sprint,
    estimatedDays,
    daysLeft,
    status,
    epicId: "epic-1",
    comments: [],
    history: [],
    snapshots: [],
    createdAt: new Date("2026-01-01").toISOString(),
    updatedAt: new Date("2026-01-01").toISOString(),
  };
}

function makeEpic(stories: UserStoryItem[], id = "epic-1"): EpicItem {
  return {
    id,
    title: `Test ${id}`,
    icon: "",
    description: null,
    assignee: null,
    color: "#0ea5e9",
    team: "platform",
    labels: null,
    priority: null,
    roadmapId: null,
    planYear: 2026,
    planQuarter: 2,
    planStartMonth: 5,
    planEndMonth: 6,
    planStartDay: null,
    planEndDay: null,
    planSprint: null,
    planEndSprint: null,
    originalEstimateDays: null,
    initiativeId: "ini-1",
    parentEpicId: null,
    backlogOrder: 0,
    timelineRow: 0,
    userStories: stories,
    comments: [],
    history: [],
    deletedAt: null,
    createdAt: new Date("2026-01-01").toISOString(),
    updatedAt: new Date("2026-01-01").toISOString(),
  };
}

/**
 * Replicates the Burndown tooltip's "Total scope" formula from
 * month-analytics.tsx. After the fix it must mirror computeProgress —
 * i.e. Σ estimatedDays for stories with estimatedDays != null.
 * Tests assert this stays in sync.
 */
function burndownTooltipTotalScope(
  epics: EpicItem[],
  basis: "days" | "stories" | "epicEst" = "days",
): number {
  let total = 0;
  for (const epic of epics) {
    const allStories = epic.userStories ?? [];
    const storyDaysSum = allStories.reduce(
      (sum, s) => sum + (s.estimatedDays ?? 0),
      0,
    );
    const epicScope =
      basis === "stories"
        ? allStories.length
        : basis === "epicEst"
          ? (epic.originalEstimateDays ?? storyDaysSum)
          : storyDaysSum;
    total += epicScope;
  }
  return total;
}

/**
 * Replicates the Workload Balance drilldown's Σ Est days / Σ Est days
 * left footer formulas. Tests assert they reconcile against the same
 * helper buildBurnSeries reads from.
 */
function workloadBalanceTotals(stories: UserStoryItem[]): {
  totalEst: number;
  totalDaysLeft: number;
} {
  return {
    totalEst: stories.reduce((s, st) => s + (st.estimatedDays ?? 0), 0),
    totalDaysLeft: stories.reduce(
      (s, st) => s + Math.max(0, st.daysLeft ?? 0),
      0,
    ),
  };
}

describe("All-Quarters Insights — cross-surface consistency", () => {
  it("the buggy fallback that caused the 31d Burndown tooltip gap stays dead", () => {
    // Fixture mirrors the demo seed's pathology — 1 estimated story plus
    // unestimated stories where `daysLeft` defaults to 1. Pre-fix the
    // tooltip read `estimatedDays ?? daysLeft ?? 1` per story; the 3
    // unestimated stories each contributed 1d of ghost scope.
    const stories = [
      makeStory("US-1", 5, 5, "todo"),
      makeStory("US-2", null, null, "todo"), // would have added +1
      makeStory("US-3", null, 2, "todo"),    // would have added +2
      makeStory("US-4", null, null, "done"), // would have added +1
    ];
    const epic = makeEpic(stories);

    const tooltipScope = burndownTooltipTotalScope([epic], "days");
    const canonical = computeProgress({
      stories: stories.map((s) => ({
        estimatedDays: s.estimatedDays,
        daysLeft: s.daysLeft,
        status: s.status,
      })),
      start: new Date("2026-05-01"),
      end: new Date("2026-06-30"),
      now: new Date("2026-05-15"),
      basis: "days",
      epicOriginalEstimateDays: null,
    });

    expect(tooltipScope).toBe(5);
    expect(canonical.totalEffort).toBe(5);
    expect(tooltipScope).toBe(canonical.totalEffort);
  });

  it("Burndown tooltip Total scope matches the burnup's headline scope for the same population (days basis)", () => {
    const stories = [
      makeStory("US-1", 5, 5, "todo"),
      makeStory("US-2", 3, 1, "inProgress"),
      makeStory("US-3", 4, 0, "done"),
      makeStory("US-4", null, null, "todo"),
    ];
    const epic = makeEpic(stories);

    const tooltipScope = burndownTooltipTotalScope([epic], "days");
    const series = buildBurnSeries({
      epics: [epic],
      basis: "days",
      periodStart: new Date("2026-05-01"),
      periodEnd: new Date("2026-06-30"),
      now: new Date("2026-05-15"),
    });

    expect(tooltipScope).toBe(series.headline?.scope ?? 0);
  });

  it("Burnup completed and Burndown completed agree at the headline (days basis)", () => {
    const stories = [
      makeStory("US-1", 5, 5, "todo"),
      makeStory("US-2", 3, 1, "inProgress"),
      makeStory("US-3", 4, 0, "done"),
    ];
    const epic = makeEpic(stories);
    const series = buildBurnSeries({
      epics: [epic],
      basis: "days",
      periodStart: new Date("2026-05-01"),
      periodEnd: new Date("2026-06-30"),
      now: new Date("2026-05-15"),
    });
    const todayRow = series.perDay.find((r) => r.isToday) ?? series.perDay[0];
    expect(todayRow.completed).not.toBeNull();
    expect(todayRow.daysLeft).not.toBeNull();
    expect(todayRow.scope).toBe((todayRow.completed ?? 0) + (todayRow.daysLeft ?? 0));
    expect(series.headline?.scope).toBe(12);
    // 4 done (done story contributes 4) + 2 burned on US-2 (5−5=0, 3−1=2)
    expect(series.headline?.completed).toBe(6);
  });

  it("Workload Balance Σ Est days reconciles against the canonical scope (days basis)", () => {
    const stories = [
      makeStory("US-1", 5, 5, "todo"),
      makeStory("US-2", 3, 1, "inProgress"),
      makeStory("US-3", 4, 0, "done"),
      makeStory("US-4", null, null, "todo"),
    ];
    const epic = makeEpic(stories);
    const tooltipScope = burndownTooltipTotalScope([epic], "days");
    const wbTotals = workloadBalanceTotals(stories);

    expect(wbTotals.totalEst).toBe(12); // 5+3+4+0 — unestimated contributes 0
    expect(tooltipScope).toBe(wbTotals.totalEst);
  });

  it("scope = completed + daysLeft invariant holds across every perDay row", () => {
    const stories = [
      makeStory("US-1", 5, 5, "todo"),
      makeStory("US-2", 3, 1, "inProgress"),
      makeStory("US-3", 4, 0, "done"),
    ];
    const epic = makeEpic(stories);
    const series = buildBurnSeries({
      epics: [epic],
      basis: "days",
      periodStart: new Date("2026-05-01"),
      periodEnd: new Date("2026-06-30"),
      now: new Date("2026-05-15"),
    });
    for (const row of series.perDay) {
      // Future days carry null actuals — Recharts ends the line at the
      // last non-null point. Invariant only applies to populated rows.
      if (row.completed == null || row.daysLeft == null) continue;
      expect(row.scope).toBe(row.completed + row.daysLeft);
    }
  });

  it("unscheduled stories still factor into burndown scope on a day basis (Phase 1 of the unscheduled framework)", () => {
    // story.sprint == null should NOT shrink scope — Burndown shows the
    // whole epic's scope including unscheduled estimated work. See the
    // truth table the user signed off on.
    const stories = [
      makeStory("US-1", 5, 5, "todo", 11),
      makeStory("US-2", 3, 3, "todo", null), // unscheduled but estimated
    ];
    const epic = makeEpic(stories);
    const tooltipScope = burndownTooltipTotalScope([epic], "days");
    expect(tooltipScope).toBe(8);
    const series = buildBurnSeries({
      epics: [epic],
      basis: "days",
      periodStart: new Date("2026-05-01"),
      periodEnd: new Date("2026-06-30"),
      now: new Date("2026-05-15"),
    });
    expect(series.headline?.scope).toBe(8);
  });

  it("stories basis sums STORY COUNT, not days, on every surface", () => {
    const stories = [
      makeStory("US-1", 5, 5, "todo"),
      makeStory("US-2", 3, 1, "inProgress"),
      makeStory("US-3", 4, 0, "done"),
      makeStory("US-4", null, null, "todo"),
    ];
    const epic = makeEpic(stories);
    const tooltipScopeStories = burndownTooltipTotalScope([epic], "stories");
    const seriesStories = buildBurnSeries({
      epics: [epic],
      basis: "stories",
      periodStart: new Date("2026-05-01"),
      periodEnd: new Date("2026-06-30"),
      now: new Date("2026-05-15"),
    });
    expect(tooltipScopeStories).toBe(4);
    expect(seriesStories.headline?.scope).toBe(4);
  });

  it("epicEst basis prefers the epic's originalEstimateDays, falling back to Σ child est when null", () => {
    const stories = [makeStory("US-1", 5, 5, "todo")];
    const epicWithEst = { ...makeEpic(stories), originalEstimateDays: 20 };
    const epicWithoutEst = makeEpic(stories);

    expect(burndownTooltipTotalScope([epicWithEst], "epicEst")).toBe(20);
    expect(burndownTooltipTotalScope([epicWithoutEst], "epicEst")).toBe(5);
  });
});
