import { StoryStatus } from "@/lib/generated/prisma";
import type { InitiativeItem } from "@/lib/types";
import { YEAR_SPRINT_MAX } from "@/lib/year-sprint";

/**
 * Predictions surface used by the Time Debugger page. For each calendar
 * boundary it scans the currently-loaded `initiatives` and reports:
 *
 *   - How many stories sit in the source sprint, broken down by status
 *     (so the user knows what to expect to see on the "Before" view)
 *   - How many of those will roll forward when the rollover effect fires
 *     (the todo + inProgress count — review/done stay put by design)
 *   - How many epics are affected (parent epics of the rolling stories)
 *   - The destination sprint label
 *
 * The page wires the prediction text into each row so the user has concrete
 * numbers to verify against, instead of generic descriptions that would
 * vary per dataset.
 */
export type BoundaryPrediction = {
  /** Source sprint number (e.g. 5, 6, 8, 24). */
  fromSprint: number;
  /** Destination sprint number (e.g. 6, 7, 9, or `null` for year-end blocked). */
  toSprint: number | null;
  /** Friendly label for the destination (e.g. "Sprint 6", "Sprint 7 (Apr)",
   *  "Sprint 9 (May)", or "blocked — needs continuation"). */
  toLabel: string;
  /** Total stories currently sitting in `fromSprint`. */
  total: number;
  /** Stories with `status === todo` in the source sprint — these will roll. */
  todo: number;
  /** Stories with `status === inProgress` in the source sprint — these will roll. */
  inProgress: number;
  /** Stories with `status === review` — these stay put. */
  review: number;
  /** Stories with `status === done` — these stay put. */
  done: number;
  /** Sum that should roll (todo + inProgress). */
  willRoll: number;
  /** Number of distinct parent epics among the rolling stories. */
  epicCount: number;
  /** Number of distinct parent initiatives among the rolling stories. */
  initiativeCount: number;
};

function emptyPrediction(fromSprint: number, toSprint: number | null, toLabel: string): BoundaryPrediction {
  return {
    fromSprint,
    toSprint,
    toLabel,
    total: 0,
    todo: 0,
    inProgress: 0,
    review: 0,
    done: 0,
    willRoll: 0,
    epicCount: 0,
    initiativeCount: 0,
  };
}

function predictForSourceSprint(
  initiatives: InitiativeItem[],
  fromSprint: number,
  toSprint: number | null,
  toLabel: string,
): BoundaryPrediction {
  const out = emptyPrediction(fromSprint, toSprint, toLabel);
  const rollingEpics = new Set<string>();
  const rollingInits = new Set<string>();
  for (const initiative of initiatives) {
    for (const epic of initiative.epics ?? []) {
      for (const story of epic.userStories ?? []) {
        if (story.sprint !== fromSprint) continue;
        out.total += 1;
        switch (story.status) {
          case StoryStatus.todo:
            out.todo += 1;
            out.willRoll += 1;
            rollingEpics.add(epic.id);
            rollingInits.add(initiative.id);
            break;
          case StoryStatus.inProgress:
            out.inProgress += 1;
            out.willRoll += 1;
            rollingEpics.add(epic.id);
            rollingInits.add(initiative.id);
            break;
          case StoryStatus.review:
            out.review += 1;
            break;
          case StoryStatus.done:
            out.done += 1;
            break;
        }
      }
    }
  }
  out.epicCount = rollingEpics.size;
  out.initiativeCount = rollingInits.size;
  return out;
}

/** Sprint 5 → Sprint 6 (both March, both Q1). Pure sprint boundary. */
export function predictSprintBoundary(initiatives: InitiativeItem[]): BoundaryPrediction {
  return predictForSourceSprint(initiatives, 5, 6, "Sprint 6 (Mar)");
}

/** Sprint 8 → Sprint 9 (Apr → May, both Q2). Month boundary, no quarter crossing. */
export function predictMonthBoundary(initiatives: InitiativeItem[]): BoundaryPrediction {
  return predictForSourceSprint(initiatives, 8, 9, "Sprint 9 (May)");
}

/** Sprint 6 → Sprint 7 (Mar → Apr, Q1 → Q2). Quarter boundary. */
export function predictQuarterBoundary(initiatives: InitiativeItem[]): BoundaryPrediction {
  return predictForSourceSprint(initiatives, 6, 7, "Sprint 7 (Apr, Q2)");
}

/**
 * Sprint 24 → blocked. Stories at the year cap can't roll forward — instead
 * the year-end popup fires offering to add the next year + create continuations.
 * `toSprint` is `null` because there's no within-year destination.
 */
export function predictYearBoundary(initiatives: InitiativeItem[]): BoundaryPrediction {
  return predictForSourceSprint(initiatives, YEAR_SPRINT_MAX, null, "blocked — continuation needed");
}

/** All four predictions in display order. */
export function predictAllBoundaries(initiatives: InitiativeItem[]): {
  sprint: BoundaryPrediction;
  month: BoundaryPrediction;
  quarter: BoundaryPrediction;
  year: BoundaryPrediction;
} {
  return {
    sprint: predictSprintBoundary(initiatives),
    month: predictMonthBoundary(initiatives),
    quarter: predictQuarterBoundary(initiatives),
    year: predictYearBoundary(initiatives),
  };
}
