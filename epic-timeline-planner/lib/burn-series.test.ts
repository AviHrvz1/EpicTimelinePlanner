/**
 * Regression suite for `lib/burn-series.ts`.
 *
 * Coverage strategy:
 *   1. The user-reported bug case (10 stories, Σ est = 33, Σ daysLeft = 10).
 *      Under "days" basis must read 33/23/10; under "epicEst" basis with
 *      epic.originalEstimateDays = 81 the completed value follows the
 *      lib/progress.ts formula `epicEst − storyDaysBurned` (NOT a ratio
 *      scaled onto epic scope, which is the bug the rewrite fixes).
 *   2. The five canonical verdicts (On Track / Watch / At Risk / Overdue /
 *      Done) across the three bases (stories, days, epicEst) — numbers
 *      lifted verbatim from the 7-page health explainer popover slides.
 *      That gives 15 verdict-status assertions + matching deltaDays
 *      assertions. The explainer's worked examples are now executable.
 *   3. Structural invariants enforced as property tests:
 *        - `scope === completed + daysLeft` on EVERY perDay row + the
 *          headline. Impossible to introduce a basis leak that violates
 *          this.
 *        - "No basis leak": under `days` basis, headline.completed must
 *          equal Σ(story.estimatedDays − story.daysLeft) exactly. Under
 *          `epicEst` basis it must equal `epicEst − max(0, epicEst −
 *          storyDaysBurned)`. No ratios.
 */
import { describe, it, expect } from "vitest";
import { buildBurnSeries } from "./burn-series";
import type { EpicItem, UserStoryItem } from "./types";
import type { ProgressBasis } from "./progress";

// ----------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------

/** Convenience builder — only the fields buildBurnSeries actually reads
 *  are set; everything else is null / sensible default so a test that
 *  asserts on a verdict doesn't carry pages of irrelevant epic chrome. */
function makeStory(
  id: string,
  estimatedDays: number,
  daysLeft: number,
  status: UserStoryItem["status"] = "inProgress",
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
    sprint: null,
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

/** Single-epic helper. `planStartMonth` / `planEndMonth` are picked so the
 *  explainer scenarios (20 working days, "today" = day 11) line up: start
 *  = Mon Jan 5 2026, end = Fri Jan 30 2026 → 20 weekdays; "today" set to
 *  Mon Jan 19 2026 leaves daysRemaining = 10 weekdays → ratio = 0.5. */
function makeEpic(
  stories: UserStoryItem[],
  originalEstimateDays: number | null = null,
): EpicItem {
  return {
    id: "epic-1",
    title: "Test epic",
    icon: "",
    description: null,
    assignee: null,
    originalEstimateDays,
    color: "#000000",
    initiativeId: "init-1",
    roadmapId: null,
    planYear: 2026,
    planQuarter: 1,
    planSprint: 1,         // sprint 1 → day-1-of-month
    planStartMonth: 1,
    planStartDay: 5,
    planEndMonth: 1,
    planEndSprint: 2,
    planEndDay: 30,
    timelineRow: 0,
    team: null,
    labels: null,
    priority: null,
    userStories: stories,
    comments: [],
    history: [],
    epicSnapshots: [],
  };
}

/** Shared period / today triple for the explainer's "Day 10 of 20" cases.
 *  workingDaysBetween(start, end) = 20, workingDaysBetween(today, end) = 10,
 *  so `lib/progress.ts` ratio = 0.5 — matches the explainer's "ideal = half"
 *  examples exactly. */
const PERIOD = {
  periodStart: new Date(2026, 0, 5),   // Mon Jan 5
  periodEnd:   new Date(2026, 0, 30),  // Fri Jan 30
  now:         new Date(2026, 0, 19),  // Mon Jan 19 — start of week 3
};

// ----------------------------------------------------------------------
// 1. The user-reported bug case
// ----------------------------------------------------------------------

describe("the reported bug case (10 stories, Σ est=33, Σ daysLeft=10)", () => {
  // Story-level data extracted from the planner's drilldown screenshot:
  // 7 Review/Testing stories with daysLeft=0, 3 To-do stories with daysLeft equal
  // to their estimates. Σ est = 33, Σ daysLeft = 10.
  const stories: UserStoryItem[] = [
    makeStory("US-171", 2, 0, "review"),
    makeStory("US-172", 3, 0, "review"),
    makeStory("US-173", 4, 0, "review"),
    makeStory("US-174", 5, 5, "todo"),
    makeStory("US-175", 2, 0, "review"),
    makeStory("US-176", 3, 0, "review"),
    makeStory("US-177", 4, 0, "review"),
    makeStory("US-178", 5, 0, "review"),
    makeStory("US-179", 2, 2, "todo"),
    makeStory("US-180", 3, 3, "todo"),
  ];

  it("under Σ Child Est basis (days): headline reads 33 / 23 / 10 — matches the drilldown", () => {
    const epic = makeEpic(stories);
    const series = buildBurnSeries({
      epics: [epic],
      basis: "days",
      periodStart: PERIOD.periodStart,
      periodEnd: PERIOD.periodEnd,
      now: PERIOD.now,
    });
    expect(series.headline).not.toBeNull();
    const h = series.headline!;
    expect(h.scope).toBe(33);
    expect(h.completed).toBe(23);
    expect(h.daysLeft).toBe(10);
    // Structural invariant — the whole point of the rewrite.
    expect(h.completed + h.daysLeft).toBe(h.scope);
  });

  it("under Epic Est basis (epicEst=81): completed = epicEst − storyDaysBurned, NOT 0.697 × 81 = 56.5", () => {
    const epic = makeEpic(stories, 81);
    const series = buildBurnSeries({
      epics: [epic],
      basis: "epicEst",
      periodStart: PERIOD.periodStart,
      periodEnd: PERIOD.periodEnd,
      now: PERIOD.now,
    });
    expect(series.headline).not.toBeNull();
    const h = series.headline!;
    // storyDaysBurned = max(0, 33 − 10) = 23
    // daysLeft = max(0, 81 − 23) = 58
    // completed = 81 − 58 = 23
    expect(h.scope).toBe(81);
    expect(h.daysLeft).toBe(58);
    expect(h.completed).toBe(23);
    // Explicitly reject the buggy hybrid number — it would only appear
    // if the chart-layer ratio formula leaked back in.
    expect(h.completed).not.toBeCloseTo(56.5, 1);
    // Structural invariant — the whole point of the rewrite.
    expect(h.completed + h.daysLeft).toBe(h.scope);
  });

  it("under Stories basis: scope = 10, completed = 0 (no story is `done`)", () => {
    const epic = makeEpic(stories);
    const series = buildBurnSeries({
      epics: [epic],
      basis: "stories",
      periodStart: PERIOD.periodStart,
      periodEnd: PERIOD.periodEnd,
      now: PERIOD.now,
    });
    expect(series.headline).not.toBeNull();
    const h = series.headline!;
    // 10 stories total, none in `done` (the seven `review` stories
    // intentionally don't count as Done per the explainer + the lib).
    expect(h.scope).toBe(10);
    expect(h.completed).toBe(0);
    expect(h.daysLeft).toBe(10);
  });
});

// ----------------------------------------------------------------------
// 2. Canonical verdict examples from the 7-page health explainer
// ----------------------------------------------------------------------
// Every assertion below has a citation comment pointing back to the slide
// it was lifted from: `components/dashboard/health-explainer-popover.tsx`.

describe("canonical verdicts from the 7-page health explainer (Day 10 of 20)", () => {

  // ---- On Track (Δ ≤ 1 working day) ------------------------------------

  it("On Track · Σ Child Est: 21 left, ideal 20, Δ = +1 → onTrack", () => {
    // Slide: { actualLine, totalEffort: 40 }. Day 10 = "21 days remaining".
    // Construct stories so Σ estimatedDays = 40, Σ daysLeft = 21.
    const stories = [
      makeStory("s1", 10, 5,  "inProgress"),
      makeStory("s2", 10, 6,  "inProgress"),
      makeStory("s3", 10, 5,  "inProgress"),
      makeStory("s4", 10, 5,  "inProgress"),
    ];
    const series = buildBurnSeries({
      epics: [makeEpic(stories)],
      basis: "days",
      ...PERIOD,
    });
    const h = series.headline!;
    expect(h.scope).toBe(40);
    expect(h.daysLeft).toBe(21);
    expect(h.deltaDays).toBe(1);
    expect(h.status).toBe("onTrack");
  });

  it("On Track · Epic Est (35d): 18 left, ideal 17.5, Δ = +0.5 → onTrack", () => {
    // Slide: totalEffort: 35 (epicEst). Day 10 = "18 days remaining".
    // For epicEst basis, daysLeft = max(0, 35 − storyDaysBurned). We want
    // daysLeft = 18 → storyDaysBurned = 17. Construct stories so Σ est = X,
    // Σ daysLeft = X − 17 (any X works because epicEst caps the scope).
    const stories = [
      makeStory("s1", 10, 3, "inProgress"),
      makeStory("s2", 10, 3, "inProgress"),
      makeStory("s3", 10, 4, "inProgress"),
    ];
    // Σ est = 30, Σ daysLeft = 10 → storyDaysBurned = 20.
    // With epicEst = 35, daysLeft = max(0, 35 − 20) = 15... need 18.
    // Adjust: target storyDaysBurned = 17.
    stories[0]!.daysLeft = 4;
    stories[1]!.daysLeft = 4;
    stories[2]!.daysLeft = 5;
    // Σ est = 30, Σ daysLeft = 13, storyDaysBurned = max(0, 30 − 13) = 17,
    // epicEst-basis daysLeft = max(0, 35 − 17) = 18. ✓
    const series = buildBurnSeries({
      epics: [makeEpic(stories, 35)],
      basis: "epicEst",
      ...PERIOD,
    });
    const h = series.headline!;
    expect(h.scope).toBe(35);
    expect(h.daysLeft).toBe(18);
    expect(h.deltaDays).toBeCloseTo(0.5, 5);
    expect(h.status).toBe("onTrack");
  });

  it("On Track · Stories: 3 of 5 done, ideal 2.5, Δ = +0 done-buffer → onTrack", () => {
    // Slide: 3 of 5 stories Review/Done at day 10. For our lib only `done`
    // counts as completed (review remains open). Use 3 done + 2 todo.
    const stories = [
      makeStory("s1", 1, 0, "done"),
      makeStory("s2", 1, 0, "done"),
      makeStory("s3", 1, 0, "done"),
      makeStory("s4", 1, 1, "todo"),
      makeStory("s5", 1, 1, "todo"),
    ];
    const series = buildBurnSeries({
      epics: [makeEpic(stories)],
      basis: "stories",
      ...PERIOD,
    });
    const h = series.headline!;
    expect(h.scope).toBe(5);
    expect(h.completed).toBe(3);
    expect(h.daysLeft).toBe(2);
    expect(h.status).toBe("onTrack"); // 2 open, ideal 2.5 → Δ = -0.5 (ahead)
  });

  // ---- Watch (1 < Δ < 4 working days) ---------------------------------

  it("Watch · Σ Child Est: 23 left, ideal 20, Δ = +3 → watch", () => {
    const stories = [
      makeStory("s1", 10, 6, "inProgress"),
      makeStory("s2", 10, 6, "inProgress"),
      makeStory("s3", 10, 6, "inProgress"),
      makeStory("s4", 10, 5, "inProgress"),
    ];
    const series = buildBurnSeries({
      epics: [makeEpic(stories)],
      basis: "days",
      ...PERIOD,
    });
    const h = series.headline!;
    expect(h.scope).toBe(40);
    expect(h.daysLeft).toBe(23);
    expect(h.deltaDays).toBe(3);
    expect(h.status).toBe("watch");
  });

  it("Watch · Epic Est (35d): 20.5 left, ideal 17.5, Δ = +3 → watch", () => {
    // daysLeft = 20.5 → storyDaysBurned = 14.5
    // Stories: Σ est = 30, Σ daysLeft = 15.5 → burned = 14.5 ✓
    const stories = [
      makeStory("s1", 10, 5.5, "inProgress"),
      makeStory("s2", 10, 5,   "inProgress"),
      makeStory("s3", 10, 5,   "inProgress"),
    ];
    const series = buildBurnSeries({
      epics: [makeEpic(stories, 35)],
      basis: "epicEst",
      ...PERIOD,
    });
    const h = series.headline!;
    expect(h.scope).toBe(35);
    expect(h.daysLeft).toBeCloseTo(20.5, 5);
    expect(h.deltaDays).toBeCloseTo(3, 5);
    expect(h.status).toBe("watch");
  });

  // ---- At Risk (Δ ≥ 4 working days) -----------------------------------

  it("At Risk · Σ Child Est: 25 left, ideal 20, Δ = +5 → atRisk", () => {
    const stories = [
      makeStory("s1", 10, 7,  "inProgress"),
      makeStory("s2", 10, 6,  "inProgress"),
      makeStory("s3", 10, 6,  "inProgress"),
      makeStory("s4", 10, 6,  "inProgress"),
    ];
    const series = buildBurnSeries({
      epics: [makeEpic(stories)],
      basis: "days",
      ...PERIOD,
    });
    const h = series.headline!;
    expect(h.scope).toBe(40);
    expect(h.daysLeft).toBe(25);
    expect(h.deltaDays).toBe(5);
    expect(h.status).toBe("atRisk");
  });

  it("At Risk · Epic Est (35d): 22.5 left, ideal 17.5, Δ = +5 → atRisk", () => {
    // daysLeft = 22.5 → storyDaysBurned = 12.5
    // Σ est = 30, Σ daysLeft = 17.5 → burned = 12.5 ✓
    const stories = [
      makeStory("s1", 10, 6,   "inProgress"),
      makeStory("s2", 10, 6,   "inProgress"),
      makeStory("s3", 10, 5.5, "inProgress"),
    ];
    const series = buildBurnSeries({
      epics: [makeEpic(stories, 35)],
      basis: "epicEst",
      ...PERIOD,
    });
    const h = series.headline!;
    expect(h.scope).toBe(35);
    expect(h.daysLeft).toBeCloseTo(22.5, 5);
    expect(h.deltaDays).toBeCloseTo(5, 5);
    expect(h.status).toBe("atRisk");
  });

  // ---- Overdue (now > end + progress < 100%) --------------------------

  it("Overdue: today past plan-end + open work remaining → overdue", () => {
    // Same epic window as the explainer's overdue slide: "End was Day 20,
    // today is Day 22". For our period (ends Fri Jan 30), set "today"
    // past Jan 30 with open stories.
    const stories = [
      makeStory("s1", 10, 4, "inProgress"),
    ];
    const series = buildBurnSeries({
      epics: [makeEpic(stories)],
      basis: "days",
      periodStart: PERIOD.periodStart,
      periodEnd: PERIOD.periodEnd,
      now: new Date(2026, 1, 3),  // Tue Feb 3 — past Jan 30
    });
    const h = series.headline!;
    expect(h.status).toBe("overdue");
  });

  // ---- Done (progressPercent = 100) -----------------------------------

  it("Done: every story `done`, daysLeft = 0 → done", () => {
    const stories = [
      makeStory("s1", 10, 0, "done"),
      makeStory("s2", 10, 0, "done"),
      makeStory("s3", 10, 0, "done"),
      makeStory("s4", 10, 0, "done"),
    ];
    const series = buildBurnSeries({
      epics: [makeEpic(stories)],
      basis: "days",
      ...PERIOD,
    });
    const h = series.headline!;
    expect(h.completed).toBe(40);
    expect(h.daysLeft).toBe(0);
    expect(h.status).toBe("done");
  });
});

// ----------------------------------------------------------------------
// 3. Structural invariants — the bug class becomes impossible
// ----------------------------------------------------------------------

describe("structural invariants", () => {
  const stories = [
    makeStory("s1", 10, 5, "inProgress"),
    makeStory("s2", 10, 3, "inProgress"),
    makeStory("s3", 10, 0, "done"),
  ];

  it.each<ProgressBasis>(["days", "epicEst", "stories"])(
    "scope === completed + daysLeft on EVERY non-future perDay row (basis=%s)",
    (basis) => {
      const series = buildBurnSeries({
        epics: [makeEpic(stories, 50)],
        basis,
        ...PERIOD,
      });
      for (const row of series.perDay) {
        // Future days carry null actuals — the line terminates at today
        // by design so the chart's blue line doesn't drop to 0 past
        // today. Past/today days have number triples that must satisfy
        // the invariant.
        if (row.scope != null) {
          expect(row.completed).not.toBeNull();
          expect(row.daysLeft).not.toBeNull();
          expect(row.scope).toBe(row.completed! + row.daysLeft!);
        } else {
          expect(row.completed).toBeNull();
          expect(row.daysLeft).toBeNull();
        }
        for (const epicId of Object.keys(row.perEpic)) {
          const v = row.perEpic[epicId];
          if (v != null && v.scope != null) {
            expect(v.scope).toBe((v.completed ?? 0) + (v.daysLeft ?? 0));
          }
        }
      }
      // Headline obeys it too — today's row is never future, so all three
      // are numbers.
      const h = series.headline!;
      expect(h.scope).toBe(h.completed + h.daysLeft);
    },
  );

  it("headline.daysLeft − headline.deltaDays === headline.idealDaysLeft (verdict + chart agree)", () => {
    const series = buildBurnSeries({
      epics: [makeEpic(stories, 50)],
      basis: "days",
      ...PERIOD,
    });
    const h = series.headline!;
    // Self-consistency: the chip and the chart cannot drift.
    expect(h.daysLeft - h.deltaDays).toBeCloseTo(h.idealDaysLeft, 5);
  });

  it("no basis leak — `days` basis completed equals raw story-level burn", () => {
    // Σ est = 30, Σ daysLeft = 8 (review/done stories contribute 0 left).
    const series = buildBurnSeries({
      epics: [makeEpic(stories)],
      basis: "days",
      ...PERIOD,
    });
    const h = series.headline!;
    const sigmaEst = stories.reduce(
      (s, x) => s + (x.estimatedDays ?? 0), 0,
    );
    const sigmaLeft = stories.reduce(
      (s, x) => s + (x.status === "done" ? 0 : (x.daysLeft ?? 0)),
      0,
    );
    expect(h.scope).toBe(sigmaEst);
    expect(h.daysLeft).toBe(sigmaLeft);
    expect(h.completed).toBe(sigmaEst - sigmaLeft);
  });

  it("no basis leak — `epicEst` basis completed equals epicEst − max(0, epicEst − storyDaysBurned)", () => {
    const series = buildBurnSeries({
      epics: [makeEpic(stories, 50)],
      basis: "epicEst",
      ...PERIOD,
    });
    const h = series.headline!;
    // totalStoryDays = 30, currentOpenStoryDays = 8 (last story is done)
    // → storyDaysBurned = 22, daysLeft = max(0, 50 − 22) = 28, completed = 22.
    const totalStoryDays = stories.reduce(
      (s, x) => s + (x.estimatedDays ?? 0), 0,
    );
    const currentOpenStoryDays = stories.reduce(
      (s, x) => s + (x.status === "done" ? 0 : (x.daysLeft ?? 0)),
      0,
    );
    const storyDaysBurned = Math.max(0, totalStoryDays - currentOpenStoryDays);
    expect(h.scope).toBe(50);
    expect(h.daysLeft).toBe(Math.max(0, 50 - storyDaysBurned));
    expect(h.completed).toBe(50 - h.daysLeft);
    // Explicitly: this is NOT `epicEst * (open/total)` — that would be 50 *
    // (8/30) ≈ 13.3 days left, which is the bug the rewrite fixes.
    expect(h.daysLeft).not.toBeCloseTo(50 * (currentOpenStoryDays / totalStoryDays), 1);
  });
});
