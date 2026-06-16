/**
 * Regression suite for `lib/sprint-retrospective.ts`.
 *
 * Covers the kanban-matching rule the helper now implements:
 *  - Live-in-sprint stories use LIVE status (matches the kanban now).
 *  - Rolled-out stories (live sprint ≠ target but a snapshot has the
 *    target) use their LAST in-sprint snapshot.
 *  - Stories that never touched the sprint are excluded.
 *  - The "Unscheduled" donut bucket is dropped.
 *  - `totalStories` matches the rendered slices.
 *
 * Fixtures stay minimal — only the fields the projector / builders
 * actually read are populated.
 */
import { describe, it, expect } from "vitest";
import { StoryStatus, InitiativeStatus } from "@/lib/generated/prisma";
import { buildSprintRetrospective } from "./sprint-retrospective";
import { sprintStartDate, sprintEndDate } from "./year-sprint";
import type {
  EpicItem,
  InitiativeItem,
  StoryDailySnapshotItem,
  UserStoryItem,
} from "./types";

// Sprint 11 = June lane 1 (1–15 June) of planYear 2026. June is month 6.
const PLAN_YEAR = 2026;
const SPRINT_11 = 11;
const MONTH_6 = 6;
const startMs = sprintStartDate(PLAN_YEAR, SPRINT_11).getTime();
const closeMs = sprintEndDate(PLAN_YEAR, SPRINT_11).getTime();
const midSprintMs = startMs + 7 * 24 * 60 * 60 * 1000;

function makeSnap(
  storyId: string,
  dateMs: number,
  partial: Partial<StoryDailySnapshotItem>,
): StoryDailySnapshotItem {
  return {
    id: `${storyId}-snap-${dateMs}`,
    storyId,
    snapshotDate: new Date(dateMs).toISOString(),
    status: StoryStatus.todo,
    sprint: SPRINT_11,
    estimatedDays: 3,
    daysLeft: 3,
    assignee: null,
    createdAt: new Date(dateMs).toISOString(),
    ...partial,
  };
}

function makeStory(args: {
  id: string;
  liveSprint?: number | null;
  liveStatus?: StoryStatus;
  liveDaysLeft?: number | null;
  snapshots?: StoryDailySnapshotItem[];
  team?: string | null;
}): UserStoryItem {
  return {
    id: args.id,
    title: args.id,
    icon: "",
    description: null,
    assignee: null,
    team: args.team ?? null,
    labels: null,
    priority: null,
    roadmapId: null,
    planYear: PLAN_YEAR,
    planQuarter: 2,
    sprint: args.liveSprint ?? null,
    estimatedDays: 3,
    daysLeft: args.liveDaysLeft ?? 3,
    status: args.liveStatus ?? StoryStatus.todo,
    epicId: "epic-1",
    comments: [],
    history: [],
    snapshots: args.snapshots ?? [],
    createdAt: new Date(startMs).toISOString(),
    updatedAt: new Date(closeMs).toISOString(),
  };
}

function makeEpic(stories: UserStoryItem[]): EpicItem {
  return {
    id: "epic-1",
    title: "Epic",
    icon: "",
    description: null,
    assignee: null,
    originalEstimateDays: null,
    color: "#000000",
    initiativeId: "init-1",
    roadmapId: null,
    planYear: PLAN_YEAR,
    planQuarter: 2,
    planSprint: SPRINT_11,
    planStartMonth: MONTH_6,
    planEndMonth: MONTH_6,
    planEndSprint: SPRINT_11,
    planStartDay: null,
    planEndDay: null,
    timelineRow: 0,
    team: null,
    labels: null,
    priority: null,
    userStories: stories,
    comments: [],
    history: [],
    createdAt: new Date(startMs).toISOString(),
    updatedAt: new Date(closeMs).toISOString(),
  };
}

function makeWorkspace(stories: UserStoryItem[]): InitiativeItem[] {
  const init: InitiativeItem = {
    id: "init-1",
    title: "Init",
    icon: "",
    description: null,
    assignee: null,
    color: "#000000",
    status: InitiativeStatus.scheduled,
    startMonth: MONTH_6,
    endMonth: MONTH_6,
    startYearSprint: SPRINT_11,
    endYearSprint: SPRINT_11,
    year: PLAN_YEAR,
    roadmapId: null,
    timelineRow: 0,
    team: null,
    labels: null,
    epics: [makeEpic(stories)],
    comments: [],
    history: [],
    createdAt: new Date(startMs).toISOString(),
    updatedAt: new Date(closeMs).toISOString(),
  };
  return [init];
}

function pieValue(
  pie: Array<{ name: string; value: number }>,
  name: string,
): number {
  return pie.find((s) => s.name === name)?.value ?? 0;
}

describe("buildSprintRetrospective", () => {
  it("counts live-in-sprint stories using LIVE status (matches the kanban)", () => {
    // 32 stories live in sprint 11. 31 Done + 1 In Progress — same
    // shape as the user-reported case. Most have stale snapshots
    // dated mid-sprint that say Review/In Progress; the helper
    // should ignore those and read live state.
    const stories: UserStoryItem[] = [];
    for (let i = 0; i < 31; i++) {
      stories.push(
        makeStory({
          id: `done-${i}`,
          liveSprint: SPRINT_11,
          liveStatus: StoryStatus.done,
          liveDaysLeft: 0,
          snapshots: [
            // Stale snapshot from mid-sprint says still in Review.
            makeSnap(`done-${i}`, midSprintMs, {
              status: StoryStatus.review,
              sprint: SPRINT_11,
              daysLeft: 1,
            }),
          ],
        }),
      );
    }
    stories.push(
      makeStory({
        id: "wip-1",
        liveSprint: SPRINT_11,
        liveStatus: StoryStatus.inProgress,
        liveDaysLeft: 3,
        snapshots: [
          makeSnap("wip-1", midSprintMs, {
            status: StoryStatus.todo,
            sprint: SPRINT_11,
            daysLeft: 3,
          }),
        ],
      }),
    );
    const retro = buildSprintRetrospective({
      initiatives: makeWorkspace(stories),
      month: MONTH_6,
      yearSprint: SPRINT_11,
      metric: "storyCount",
      planYear: PLAN_YEAR,
    });
    expect(retro.totalStories).toBe(32);
    expect(pieValue(retro.statusPie, "Done")).toBe(31);
    expect(pieValue(retro.statusPie, "In progress")).toBe(1);
    expect(pieValue(retro.statusPie, "To do")).toBe(0);
    expect(pieValue(retro.statusPie, "Review / Testing")).toBe(0);
  });

  it("includes rolled-out stories via their latest in-sprint snapshot", () => {
    // Story was in sprint 11 mid-window (In Progress, 2d left) then
    // got Move-leftovers → sprint 12 (still In Progress). Sprint 11
    // retrospective must keep it as In Progress at 2d left.
    const stories = [
      makeStory({
        id: "rolled",
        liveSprint: 12, // moved
        liveStatus: StoryStatus.inProgress,
        liveDaysLeft: 2,
        snapshots: [
          makeSnap("rolled", midSprintMs, {
            sprint: SPRINT_11,
            status: StoryStatus.todo,
            daysLeft: 3,
          }),
          makeSnap("rolled", closeMs - 24 * 60 * 60 * 1000, {
            sprint: SPRINT_11,
            status: StoryStatus.inProgress,
            daysLeft: 2,
          }),
          // After the rollover, snapshot says sprint 12. Must be
          // ignored when projecting to sprint 11.
          makeSnap("rolled", closeMs + 24 * 60 * 60 * 1000, {
            sprint: 12,
            status: StoryStatus.inProgress,
            daysLeft: 2,
          }),
        ],
      }),
    ];
    const retro = buildSprintRetrospective({
      initiatives: makeWorkspace(stories),
      month: MONTH_6,
      yearSprint: SPRINT_11,
      metric: "storyCount",
      planYear: PLAN_YEAR,
    });
    expect(retro.totalStories).toBe(1);
    expect(pieValue(retro.statusPie, "In progress")).toBe(1);
  });

  it("excludes stories that never touched the sprint", () => {
    const stories = [
      makeStory({
        id: "ws-orphan",
        liveSprint: null, // workspace-wide, no sprint
        liveStatus: StoryStatus.todo,
        snapshots: [],
      }),
      makeStory({
        id: "different-sprint",
        liveSprint: 12,
        liveStatus: StoryStatus.todo,
        snapshots: [
          makeSnap("different-sprint", midSprintMs, {
            sprint: 12,
            status: StoryStatus.todo,
          }),
        ],
      }),
    ];
    const retro = buildSprintRetrospective({
      initiatives: makeWorkspace(stories),
      month: MONTH_6,
      yearSprint: SPRINT_11,
      metric: "storyCount",
      planYear: PLAN_YEAR,
    });
    expect(retro.totalStories).toBe(0);
  });

  it("never emits an 'Unscheduled' donut bucket", () => {
    const stories = [
      makeStory({
        id: "in-sprint",
        liveSprint: SPRINT_11,
        liveStatus: StoryStatus.done,
        liveDaysLeft: 0,
        snapshots: [],
      }),
      makeStory({
        id: "ws-orphan",
        liveSprint: null,
        liveStatus: StoryStatus.todo,
        snapshots: [],
      }),
    ];
    const retro = buildSprintRetrospective({
      initiatives: makeWorkspace(stories),
      month: MONTH_6,
      yearSprint: SPRINT_11,
      metric: "storyCount",
      planYear: PLAN_YEAR,
    });
    expect(retro.statusPie.find((s) => s.name === "Unscheduled")).toBeUndefined();
    expect(retro.totalStories).toBe(1);
    expect(pieValue(retro.statusPie, "Done")).toBe(1);
  });

  it("honors team filter (only stories whose effective team matches are counted)", () => {
    // Three live-in-sprint stories, only one on team-A.
    const stories = [
      makeStory({
        id: "a1",
        liveSprint: SPRINT_11,
        liveStatus: StoryStatus.done,
        team: "team-A",
      }),
      makeStory({
        id: "b1",
        liveSprint: SPRINT_11,
        liveStatus: StoryStatus.done,
        team: "team-B",
      }),
      makeStory({
        id: "c1",
        liveSprint: SPRINT_11,
        liveStatus: StoryStatus.done,
        team: "team-B",
      }),
    ];
    const retro = buildSprintRetrospective({
      initiatives: makeWorkspace(stories),
      month: MONTH_6,
      yearSprint: SPRINT_11,
      metric: "storyCount",
      planYear: PLAN_YEAR,
      filterEpicTeamIds: ["team-A"],
    });
    expect(retro.totalStories).toBe(1);
    expect(pieValue(retro.statusPie, "Done")).toBe(1);
  });

  it("picks the latest in-sprint snapshot when a story rolled out across multiple sprints", () => {
    // Story was sprint 11 todo → rolled to 12 (review) → rolled to
    // 13 (live). Sprint 11 retrospective sees the LAST sprint=11
    // snapshot, which was "todo".
    const stories = [
      makeStory({
        id: "double-rolled",
        liveSprint: 13,
        liveStatus: StoryStatus.review,
        liveDaysLeft: 0,
        snapshots: [
          makeSnap("double-rolled", startMs + 2 * 24 * 60 * 60 * 1000, {
            sprint: SPRINT_11,
            status: StoryStatus.todo,
            daysLeft: 3,
          }),
          makeSnap("double-rolled", midSprintMs, {
            sprint: SPRINT_11,
            status: StoryStatus.inProgress,
            daysLeft: 2,
          }),
          makeSnap("double-rolled", closeMs + 24 * 60 * 60 * 1000, {
            sprint: 12,
            status: StoryStatus.review,
            daysLeft: 1,
          }),
        ],
      }),
    ];
    const retro = buildSprintRetrospective({
      initiatives: makeWorkspace(stories),
      month: MONTH_6,
      yearSprint: SPRINT_11,
      metric: "storyCount",
      planYear: PLAN_YEAR,
    });
    expect(retro.totalStories).toBe(1);
    expect(pieValue(retro.statusPie, "In progress")).toBe(1);
    expect(pieValue(retro.statusPie, "To do")).toBe(0);
  });
});
