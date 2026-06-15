/**
 * Demo-builder orchestrator. Two entry points:
 *
 *  - `resetAndSeedDemo()` wipes app data (auth preserved) and reseeds with a
 *    realistic-looking 10 inits × 5 epics × 10 stories dataset, 38 demo
 *    users with photos, and per-workday story snapshots so every chart in
 *    the planner shows meaningful curves.
 *  - `refreshDemoSnapshotsToToday()` is the cheap re-run — keeps the scope
 *    intact, just extends story snapshot series up through today (and
 *    updates each story's live `status`/`daysLeft` to the latest
 *    snapshot's values).
 *
 * Both functions are server-only — they import the Prisma client and the
 * Node fs-backed storage adapter.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { StoryStatus } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { captureEpicDailySnapshot } from "@/lib/epic-daily-snapshots";
import { workingDaysBetween } from "@/lib/progress";
import { collectAndUploadDemoAvatars } from "@/lib/demo-builder/avatars";
import {
  DEMO_EPIC_DESCRIPTIONS,
  DEMO_EPIC_TITLES_BY_TEAM,
  DEMO_INITIATIVE_DESCRIPTIONS,
  DEMO_INITIATIVES,
  DEMO_LABELS_POOL,
  DEMO_NAME_POOL,
  DEMO_STORY_DESCRIPTIONS,
  DEMO_STORY_TEMPLATES_BY_TEAM,
  DEMO_TEAM_LABELS,
  DEMO_TEAM_SLUGS,
  DEMO_USER_NAMES_BY_TEAM,
  type DemoTeamSlug,
} from "@/lib/demo-builder/data";
import {
  buildDemoSnapshotSeries,
  pickDemoEpicHealthOverride,
  pickDemoStoryCurve,
} from "@/lib/demo-builder/snapshots";
import { buildTeamLogoDataUrl } from "@/lib/demo-builder/team-logos";
import {
  currentCalendarYearSprint,
  globalSprintFromMonthLane,
  monthLaneFromGlobalSprint,
  sprintEndDate,
  sprintStartDate,
} from "@/lib/year-sprint";

const UPLOADS_AVATARS_DIR = path.join(process.cwd(), "public", "uploads", "avatars");

/**
 * Stable Roadmap id matching `app/api/initiatives/route.ts`'s
 * `DEFAULT_ROADMAP_ID`. The initiatives GET endpoint defaults its filter to
 * this roadmap when no `roadmapId` query param is supplied — so without a
 * Roadmap row matching this id (and initiatives attached to it), the Gantt
 * loads zero rows even though the seed wrote 10 initiatives.
 */
const DEMO_DEFAULT_ROADMAP_ID = "default-roadmap-0000-0000-000000000001";

export interface ResetSeedResult {
  initiatives: number;
  epics: number;
  stories: number;
  users: number;
  snapshots: number;
}

export interface RefreshResult {
  added: number;
  through: string;
}

export type ScenarioKey = "sprintOverflow" | "monthOverflow" | "quarterOverflow" | "yearOverflow";

export interface ScenarioSeedResult {
  scenario: ScenarioKey;
  mutated: number;
}

/**
 * Wipe ALL app data (initiatives, epics, stories, snapshots, comments,
 * history, dashboards, roadmaps, teams, workspace users) and clean the
 * uploaded-avatar folder. Auth tables (User/Account/Session/etc) are
 * left untouched so the caller stays signed in.
 *
 * Used both by `resetAndSeedDemo` (wipe + reseed) and by the standalone
 * "Delete all data" action on the Demo Builder page (wipe only). Kept
 * here so the deletion order — leaf rows → parents → orphan-avatar
 * files — only lives in one place.
 */
export interface WipeAllDataResult {
  initiatives: number;
  epics: number;
  stories: number;
  users: number;
  teams: number;
  dashboards: number;
}

export async function wipeAllData(): Promise<WipeAllDataResult> {
  // Capture pre-wipe counts so the caller can surface "deleted N stories"
  // in a toast. Cheap query — single COUNT per table.
  const [initiatives, epics, stories, users, teams, dashboards] = await Promise.all([
    db.initiative.count(),
    db.epic.count(),
    db.userStory.count(),
    db.workspaceUser.count(),
    // Guarded: older DB snapshots may not have the Team table yet.
    db.team.count().catch(() => 0),
    db.dashboard.count().catch(() => 0),
  ]);

  // Order matters for cascade safety even with onDelete: delete leaf rows
  // first, then parents. Auth tables (User/Account/etc) are NOT touched.
  await db.storyDailySnapshot.deleteMany({});
  await db.storyComment.deleteMany({});
  await db.storyHistory.deleteMany({});
  await db.userStory.deleteMany({});
  await db.epicComment.deleteMany({});
  await db.epicHistory.deleteMany({});
  await db.epic.deleteMany({});
  await db.initiativeComment.deleteMany({});
  await db.initiativeHistory.deleteMany({});
  await db.initiative.deleteMany({});
  await db.dashboardChart.deleteMany({});
  await db.dashboard.deleteMany({});
  try { await db.roadmap.deleteMany({}); } catch { /* table may not exist on older snapshots */ }
  try { await db.team.deleteMany({}); } catch { /* table may not exist on older snapshots */ }
  await db.workspaceUser.deleteMany({});

  // Wipe previously-uploaded avatar files so disk doesn't accumulate
  // orphans. Only touches `public/uploads/avatars/` and only deletes
  // files (not subdirectories).
  await wipeAvatarFolder();

  return { initiatives, epics, stories, users, teams, dashboards };
}

export async function resetAndSeedDemo(): Promise<ResetSeedResult> {
  const planYear = currentPlanYear();
  const today = new Date();

  // 1. Wipe app data (centralised so the standalone wipe action stays
  //    in sync with this seed flow).
  await wipeAllData();

  // 2. Copy avatars from ~/Downloads/users + create workspace users.
  //    Names are pulled per-team from `DEMO_USER_NAMES_BY_TEAM` so the
  //    first few Platform/Experience/Data users share first names with
  //    `defaultMembersForTeam()` — that lets `assigneeMatchRosterForSprintTeam`
  //    dedup default roster + directory entry, so every chip shows the
  //    uploaded photo instead of an avatarless first-name chip.
  //    Each avatar URL pairs with one user by position.
  const avatarUrls = await collectAndUploadDemoAvatars();
  const createdUsers: { name: string; email: string; team: DemoTeamSlug; image: string | null }[] = [];
  const fallbackNames = [...DEMO_NAME_POOL];
  let avatarCursor = 0;
  for (const team of DEMO_TEAM_SLUGS) {
    const namesForTeam = [...DEMO_USER_NAMES_BY_TEAM[team]];
    for (const name of namesForTeam) {
      const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@demo.local`;
      const image = avatarUrls[avatarCursor] ?? null;
      avatarCursor += 1;
      createdUsers.push({ name, email, team, image });
    }
  }
  // If we have more avatars than team-specific names, fill the rest from
  // the flat fallback pool, round-robin across the 5 teams. (Unlikely with
  // the 38 in ~/Downloads/users, but defensive.)
  while (avatarCursor < avatarUrls.length && fallbackNames.length > 0) {
    const name = fallbackNames.shift()!;
    const team = DEMO_TEAM_SLUGS[avatarCursor % DEMO_TEAM_SLUGS.length]!;
    const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@demo.local`;
    const image = avatarUrls[avatarCursor] ?? null;
    avatarCursor += 1;
    createdUsers.push({ name, email, team, image });
  }
  await db.workspaceUser.createMany({
    data: createdUsers.map((u) => ({
      name: u.name,
      email: u.email,
      team: u.team,
      permission: "Viewer",
      status: "active",
      image: u.image,
    })),
  });
  // Index members by team for picking assignees per epic.
  const membersByTeam = new Map<DemoTeamSlug, string[]>();
  for (const slug of DEMO_TEAM_SLUGS) membersByTeam.set(slug, []);
  for (const u of createdUsers) membersByTeam.get(u.team)!.push(u.name);

  // 3b. Create first-class Team rows — one per demo team — with a generated
  //     monogram logo and the first member of each team as its lead.
  //     Membership stays implicit via WorkspaceUser.team === Team.slug, so we
  //     don't write a members table; we only need the lead's id, which we
  //     look up from the freshly-inserted users by name + team.
  const insertedUsers = await db.workspaceUser.findMany({
    select: { id: true, name: true, team: true },
  });
  const userIdByTeamAndName = new Map<string, string>();
  for (const u of insertedUsers) userIdByTeamAndName.set(`${u.team}::${u.name}`, u.id);
  for (let teamIdx = 0; teamIdx < DEMO_TEAM_SLUGS.length; teamIdx++) {
    const slug = DEMO_TEAM_SLUGS[teamIdx]!;
    const leadName = membersByTeam.get(slug)?.[0] ?? null;
    const leadId = leadName ? userIdByTeamAndName.get(`${slug}::${leadName}`) ?? null : null;
    await db.team.create({
      data: {
        slug,
        displayName: DEMO_TEAM_LABELS[slug],
        image: buildTeamLogoDataUrl(slug),
        leadId,
        displayOrder: teamIdx,
      },
    });
  }

  // 4. Ensure the default roadmap exists and includes the seeded year.
  //    The initiatives GET route filters by `roadmapId` (defaulting to
  //    `DEFAULT_ROADMAP_ID`) so initiatives without that link don't render
  //    on the Gantt — even though they exist in the DB.
  const yearsJson = JSON.stringify([planYear]);
  await db.roadmap.upsert({
    where: { id: DEMO_DEFAULT_ROADMAP_ID },
    create: { id: DEMO_DEFAULT_ROADMAP_ID, name: "Default roadmap", years: yearsJson },
    update: { years: yearsJson },
  });

  // 5. Create 10 initiatives, each on its own timelineRow. We deliberately
  //    don't use `prisma.createMany({ include: ... })` (not supported on
  //    sqlite). Instead one inserts, then bulk-insert epics + stories.
  let totalEpics = 0;
  let totalStories = 0;
  let totalSnapshots = 0;
  // Running cursor for initiative timelineRow placement. Each initiative
  // bumps it by its own `rowsReserved` (1 bar + 2–3 packed epic sub-rows)
  // so initiatives stack vertically without overlap regardless of how
  // tightly the epics packed.
  let previousInitiativeBottomRow = 0;
  // Epics whose health curve was overridden to "watch", "atRisk", or
  // "overdue" — kept here so a post-cleanup pass can re-mark their stories
  // with the right open/review mix to land the verdict. Without this final
  // pass the closed-sprint cleanup + current-sprint diversify steps would
  // wipe the slow-burn snapshots and push the epic back to On Track / Done.
  const overrideEpicsByCurve: Record<"watch" | "atRisk" | "overdue", string[]> = {
    watch: [],
    atRisk: [],
    overdue: [],
  };
  for (let initIdx = 0; initIdx < DEMO_INITIATIVES.length; initIdx++) {
    const seed = DEMO_INITIATIVES[initIdx]!;
    const startMonth = seed.startMonth;
    // Lay out the 5 epics sequentially per the seed's `epicLayout`: walk a
    // month cursor, inserting each slot's `gap` before its `span`. Windows
    // are clamped to December so a long span near year-end can't overflow.
    // The initiative's own end is the last epic's end.
    const epicWindows: { start: number; end: number }[] = [];
    {
      let cursor = startMonth;
      for (const slot of seed.epicLayout) {
        cursor = Math.min(12, cursor + slot.gap);
        const eStart = Math.min(12, cursor);
        const eEnd = Math.min(12, eStart + slot.span - 1);
        epicWindows.push({ start: eStart, end: eEnd });
        cursor = eEnd + 1;
      }
    }
    const endMonth = epicWindows.reduce((mx, w) => Math.max(mx, w.end), startMonth);
    // Initiative assignee: pick a member of the first team for visual
    // variety — different team per initiative via round-robin.
    const initTeam = DEMO_TEAM_SLUGS[initIdx % DEMO_TEAM_SLUGS.length]!;
    const initRoster = membersByTeam.get(initTeam) ?? [];
    const initAssignee = initRoster[initIdx % Math.max(1, initRoster.length)] ?? null;

    // Per-initiative row packing. `rowGroups` lists which epic indices share
    // each Gantt sub-row (defaults to one-per-row stairs). We compute the
    // resulting per-epic sub-row offset (1..N) here so it's used by both
    // the initiative row reservation and the per-epic timelineRow below.
    const rowGroups = seed.rowGroups ?? seed.epicLayout.map((_, i) => [i]);
    const subRowByEpicIdx = new Map<number, number>();
    rowGroups.forEach((group, rowIdx) => {
      for (const epicIdx of group) subRowByEpicIdx.set(epicIdx, rowIdx + 1);
    });
    // Reserve `1 + max(rowGroups.length, 3)` rows per initiative — the bar
    // itself plus enough sub-rows to fit the packed epics. The min of 3 keeps
    // a consistent vertical rhythm even on initiatives that pack tightly.
    const rowsReserved = 1 + Math.max(rowGroups.length, 3);

    const initiative = await db.initiative.create({
      data: {
        title: seed.title,
        icon: seed.icon,
        // ~80% of initiatives get a description (skipped on the few where
        // it'd read as boilerplate). Picked deterministically by index.
        description: initIdx % 5 === 4
          ? null
          : DEMO_INITIATIVE_DESCRIPTIONS[initIdx % DEMO_INITIATIVE_DESCRIPTIONS.length]!,
        assignee: initAssignee,
        color: INITIATIVE_COLORS[initIdx % INITIATIVE_COLORS.length]!,
        status: "scheduled",
        startMonth,
        endMonth,
        year: planYear,
        team: initTeam,
        // Each initiative reserves `rowsReserved` Gantt rows: the bar at the
        // top and 2–3 packed sub-rows below for child epics. Epics within
        // each sub-row are sequenced in time so they don't overlap.
        timelineRow: previousInitiativeBottomRow,
        roadmapId: DEMO_DEFAULT_ROADMAP_ID,
        labels: pickDemoLabels(initIdx, 2) ?? null,
      },
    });
    const initiativeRow = previousInitiativeBottomRow;
    previousInitiativeBottomRow += rowsReserved;

    // 5. Create 5 epics under this initiative — one per team. Each epic's
    //    month window comes from the precomputed `epicWindows` (sequential,
    //    non-overlapping, varied lengths). Every epic still covers sprint-1 →
    //    sprint-2 of its range so the bar is wide enough for its label even
    //    when the span is a single month.
    const TEAMS_PER_INITIATIVE = DEMO_TEAM_SLUGS.length;
    for (let teamIdx = 0; teamIdx < TEAMS_PER_INITIATIVE; teamIdx++) {
      const teamSlug = DEMO_TEAM_SLUGS[teamIdx]!;
      const epicStartMonth = epicWindows[teamIdx]!.start;
      const epicEndMonth = epicWindows[teamIdx]!.end;
      // Always sprint-1 → sprint-2 so every epic spans at least 2 sprints.
      // For multi-month epics that's 4+ sprints, plenty of width for the label.
      const planSprint: 1 | 2 = 1;
      const planEndSprint: 1 | 2 = 2;

      const titlePool = DEMO_EPIC_TITLES_BY_TEAM[teamSlug];
      const epicTitle = `${titlePool[initIdx % titlePool.length]}`;
      const teamRoster = membersByTeam.get(teamSlug) ?? [];
      const epicAssignee = teamRoster[(initIdx + teamIdx) % Math.max(1, teamRoster.length)] ?? null;

      const epic = await db.epic.create({
        data: {
          title: `${seed.title} · ${epicTitle}`,
          icon: "📁",
          // ~70% of epics get a description.
          description: (initIdx + teamIdx) % 10 < 7
            ? DEMO_EPIC_DESCRIPTIONS[(initIdx + teamIdx) % DEMO_EPIC_DESCRIPTIONS.length]!
            : null,
          assignee: epicAssignee,
          color: INITIATIVE_COLORS[(initIdx + teamIdx) % INITIATIVE_COLORS.length]!,
          initiativeId: initiative.id,
          roadmapId: DEMO_DEFAULT_ROADMAP_ID,
          planYear,
          planQuarter: Math.ceil(epicStartMonth / 3),
          planSprint,
          planStartMonth: epicStartMonth,
          planEndMonth: epicEndMonth,
          planEndSprint,
          // Packed stair pattern: per-initiative `rowGroups` defines which
          // epics share a sub-row. Epics within a row are sequenced in time
          // (epicLayout order = chronological) so no overlap. The result is
          // a mix of 1–3 epic bars per row across the Gantt.
          timelineRow: initiativeRow + (subRowByEpicIdx.get(teamIdx) ?? teamIdx + 1),
          team: teamSlug,
          originalEstimateDays: null,
          labels: pickDemoLabels(initIdx * 5 + teamIdx, 2) ?? null,
          priority: pickDemoEpicPriority(initIdx * 7 + teamIdx * 13),
        },
      });
      // Phase C: day-1 epic snapshot so closed-period views can resolve to
      // the original seeded epic state. `today` here is the seed run's
      // wall-clock, matching the story snapshot dates also generated below.
      await captureEpicDailySnapshot(epic, today);
      totalEpics += 1;
      const epicPriorityForStories = epic.priority ?? null;

      // 6. Stories — 10 per epic, distributed across the epic's sprints.
      //    Pull the global sprint numbers from `globalSprintFromMonthLane`
      //    so they match the kanban / insights filters exactly.
      const sprintStart = globalSprintFromMonthLane(epicStartMonth, planSprint);
      const sprintEnd = globalSprintFromMonthLane(epicEndMonth, planEndSprint);
      const sprintRange: number[] = [];
      for (let s = sprintStart; s <= sprintEnd; s++) sprintRange.push(s);
      const storyTitles = DEMO_STORY_TEMPLATES_BY_TEAM[teamSlug];
      // Force every story under this epic to a slow burn curve when the
      // epic was designated as Watch, At Risk, or Overdue (see
      // pickDemoEpicHealthOverride). Overdue epics use the same "atRisk"
      // story curve since the snapshot generator only knows about
      // DemoStoryCurve — the overdue verdict comes from `now > planEnd`
      // plus < 100% progress, which we force in the final pass below.
      const epicHealthOverride = pickDemoEpicHealthOverride(initIdx, teamIdx);
      const epicHealthCurve =
        epicHealthOverride === "overdue"
          ? "atRisk"
          : epicHealthOverride;
      if (epicHealthOverride === "atRisk") overrideEpicsByCurve.atRisk.push(epic.id);
      else if (epicHealthOverride === "watch") overrideEpicsByCurve.watch.push(epic.id);
      else if (epicHealthOverride === "overdue") overrideEpicsByCurve.overdue.push(epic.id);

      // Build the snapshot+story rows in-memory first, then bulk-insert.
      const storiesData: Array<{
        title: string;
        sprint: number;
        assignee: string | null;
        estimatedDays: number;
        daysLeft: number;
        status: StoryStatus;
      }> = [];
      for (let s = 0; s < 10; s++) {
        const sprintNum = sprintRange[s % sprintRange.length]!;
        const assignee = teamRoster[(s + teamIdx) % Math.max(1, teamRoster.length)] ?? null;
        const estimatedDays = 2 + (s % 4); // 2..5d, spread sizes
        storiesData.push({
          title: `${storyTitles[s % storyTitles.length]} (${epicTitle})`,
          sprint: sprintNum,
          assignee,
          estimatedDays,
          daysLeft: estimatedDays, // starting value; updated after snapshot generation
          status: StoryStatus.todo,
        });
      }
      // Insert one-by-one because we need each story's id to attach
      // snapshots and update its final state to match the curve.
      for (const story of storiesData) {
        const storySeed = totalStories;
        // Hygiene-deficient story picks — populate the "Needs Attention"
        // hero card with realistic counts (Missing estimate / No sprint
        // / Stalled). Deterministic via modulo so the same seed
        // produces the same demo state every reset. Done stories
        // are exempt because closing a story without a sprint or
        // estimate is a data-entry anomaly the planner already
        // wouldn't see in real workflows.
        const missingEstimate = storySeed % 11 === 7; // ~9%
        const missingSprint = storySeed % 13 === 4; // ~7.5%
        const created = await db.userStory.create({
          data: {
            title: story.title,
            icon: "📄",
            // ~60% of stories get a description.
            description: storySeed % 10 < 6
              ? DEMO_STORY_DESCRIPTIONS[storySeed % DEMO_STORY_DESCRIPTIONS.length]!
              : null,
            assignee: story.assignee,
            sprint: missingSprint ? null : story.sprint,
            estimatedDays: missingEstimate ? null : story.estimatedDays,
            daysLeft: missingEstimate ? null : story.daysLeft,
            status: missingSprint || missingEstimate ? "todo" : story.status,
            epicId: epic.id,
            roadmapId: DEMO_DEFAULT_ROADMAP_ID,
            planYear,
            planQuarter: Math.ceil(epicStartMonth / 3),
            labels: pickDemoLabels(storySeed, 1) ?? null,
            priority: pickDemoStoryPriority(epicPriorityForStories, storySeed),
          },
        });
        totalStories += 1;

        // Stories missing estimate or sprint skip snapshot generation —
        // the burndown math has nothing to draw from them anyway.
        if (missingEstimate || missingSprint) continue;

        const { snapshots, final } = buildDemoSnapshotSeries({
          storyId: created.id,
          sprint: story.sprint,
          estimatedDays: story.estimatedDays,
          today,
          planYear,
          curve: epicHealthCurve ?? pickDemoStoryCurve(created.id),
          assignee: story.assignee,
        });
        if (snapshots.length > 0) {
          await db.storyDailySnapshot.createMany({
            data: snapshots.map((s) => ({
              storyId: s.storyId,
              snapshotDate: s.snapshotDate,
              status: s.status,
              sprint: s.sprint,
              estimatedDays: s.estimatedDays,
              daysLeft: s.daysLeft,
              assignee: s.assignee,
            })),
          });
          totalSnapshots += snapshots.length;
        }
        if (final.status !== story.status || final.daysLeft !== story.daysLeft) {
          await db.userStory.update({
            where: { id: created.id },
            data: { status: final.status, daysLeft: final.daysLeft },
          });
        }
      }

      // Epic-level estimate stays close to the sum of child-story estimates
      // (±10 %) so the new health formula (remainingEffort = epicEst −
      // storyDaysBurned) lets most "natural" epics read On Track when their
      // child stories are burning down on pace. Large over-estimates
      // amplified deltaDays under the new formula and pushed too many epics
      // into At Risk; this tighter band keeps the diversification subtle
      // without flipping verdicts. Only the explicit watch/atRisk
      // override epics (pickDemoEpicHealthOverride) plus a couple of
      // overdue-by-deadline plants below produce the non-onTrack mix.
      const sumOriginal = storiesData.reduce((acc, s) => acc + s.estimatedDays, 0);
      const ESTIMATE_DIVERGENCE_FACTORS = [0.92, 0.96, 1.0, 1.04, 1.08];
      const divergenceIdx = (initIdx * 7 + teamIdx * 13) % ESTIMATE_DIVERGENCE_FACTORS.length;
      const epicOriginalEstimate = Math.max(1, Math.round(sumOriginal * ESTIMATE_DIVERGENCE_FACTORS[divergenceIdx]!));
      // ~9% of epics stay unestimated (no top-down estimate) so the
      // Epic "Unestimated" Needs Attention category populates beyond
      // the brand-new placeholder shells. Deterministic via the same
      // (initIdx, teamIdx) seed.
      const keepUnestimated = (initIdx * 5 + teamIdx * 11) % 11 === 4;
      if (!keepUnestimated) {
        await db.epic.update({
          where: { id: epic.id },
          data: { originalEstimateDays: epicOriginalEstimate },
        });
      }
    }
  }

  // Hygiene seeding: a handful of "empty shell" epics across the
  // workspace (no child stories) so the Epic-level Needs Attention
  // card's "No stories" category and its dependent
  // "Has unestimated children" inversion both have realistic counts
  // to surface. Attached to a sampling of initiatives so they
  // appear in different roadmap rows / quarters.
  const emptyShellInitiatives = await db.initiative.findMany({
    where: { year: planYear },
    select: { id: true, startMonth: true },
    take: 3,
  });
  for (let i = 0; i < emptyShellInitiatives.length; i++) {
    const init = emptyShellInitiatives[i]!;
    const teamSlug = DEMO_TEAM_SLUGS[i % DEMO_TEAM_SLUGS.length]!;
    const startM = init.startMonth ?? 1;
    await db.epic.create({
      data: {
        title: `Discovery placeholder · ${teamSlug}`,
        icon: "📁",
        description: null,
        initiativeId: init.id,
        roadmapId: DEMO_DEFAULT_ROADMAP_ID,
        planYear,
        planQuarter: Math.ceil(startM / 3),
        planSprint: 1,
        planStartMonth: startM,
        planEndMonth: Math.min(12, startM + 1),
        planEndSprint: 2,
        timelineRow: 0,
        team: teamSlug,
        originalEstimateDays: null,
        color: INITIATIVE_COLORS[(i + 3) % INITIATIVE_COLORS.length]!,
      },
    });
    totalEpics += 1;
  }
  // ~2 unscheduled epics: existing epics with planStartMonth wiped.
  // Drives the Epic "Unscheduled" Needs Attention category. Picked
  // by created-at ordering for determinism; epics with non-null
  // start months are safe to null out — no downstream snapshots
  // depend on the field.
  const unscheduledTargets = await db.epic.findMany({
    where: { planYear, planStartMonth: { not: null } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    skip: 7,
    take: 2,
  });
  for (const ep of unscheduledTargets) {
    await db.epic.update({
      where: { id: ep.id },
      data: { planStartMonth: null, planEndMonth: null, planQuarter: null, planSprint: null, planEndSprint: null },
    });
  }

  // Closed-sprint cleanup: 100% done.
  //
  // Earlier versions left a 70/30 done/review mix to give the kanban
  // some texture, but that made every past-window epic land in
  // Overdue — review stories keep their non-zero daysLeft, so the
  // epic-est rollup never reaches 100% and the verdict cliffs to
  // overdue once `now > planEnd`. For the demo's health distribution
  // (most On Track / Done, a handful of explicit Watch / At Risk /
  // Overdue picks) past sprints should read as cleanly closed.
  // Current-sprint diversity is preserved by the separate
  // diversify pass below.
  //
  // Why this matters for the demo: epic-planner-app has a post-close
  // auto-rollover effect that scans all stories on mount and PATCHes any
  // `todo` / `inProgress` story from a closed sprint into the next open
  // sprint. (The rollover deliberately leaves `review` and `done`
  // alone — see [epic-planner-app.tsx].) So:
  //
  // 1. Any `todo` / `inProgress` residuals in closed sprints (from
  //    "behind" curve stories that didn't finish in their sprint window)
  //    get promoted to `review` here — otherwise the rollover would move
  //    them forward and empty the retro view.
  // 2. The remaining `review` stories are split deterministically: ~70%
  //    become `done`, ~30% stay `review` (QA hasn't signed off yet).
  //
  // Current-sprint stories are unaffected (handled by the diversify
  // pass below).
  const closedStories = await db.userStory.findMany({
    where: {
      sprint: { not: null },
      status: { not: StoryStatus.done },
    },
    select: { id: true, sprint: true, planYear: true, status: true },
  });
  const promoteToDoneIds: string[] = [];
  for (const s of closedStories) {
    if (s.sprint == null) continue;
    const seEnd = sprintEndDate(s.planYear ?? planYear, s.sprint);
    if (seEnd >= today) continue; // open / future sprint — keep its live status
    promoteToDoneIds.push(s.id);
  }
  if (promoteToDoneIds.length > 0) {
    // Mark fully done with zero remaining so the epic rollup hits 100%
    // and reads as "Done" (not Overdue) on past-window epics.
    await db.userStory.updateMany({
      where: { id: { in: promoteToDoneIds } },
      data: { status: StoryStatus.done, daysLeft: 0 },
    });
  }
  console.log("[demo-builder] closed-sprint status mix", {
    promotedToDone: promoteToDoneIds.length,
  });

  // Diversify current-sprint statuses. The snapshot-generated `final` state
  // only produces `inProgress` / `review` for the current sprint (anything
  // before today's progress = inProgress, anything fully burned = review) —
  // which means a freshly-seeded current sprint shows only those two
  // statuses on the kanban. Spread ~25% to `todo` (planned but not yet
  // pulled in) and ~10% of the review ones to `done` (QA already signed
  // off) so all four columns have entries — matching what a real mid-sprint
  // board would look like.
  const currentSprint = currentCalendarYearSprint(today);
  const currentSprintStories = await db.userStory.findMany({
    where: { sprint: currentSprint, planYear },
    select: { id: true, status: true, estimatedDays: true },
  });
  // End-of-sprint distribution: ≥80% already QA-signed, the rest split
  // across the other columns so all four show entries. Deterministic per-id
  // hash bucket so the same id always lands in the same bucket across
  // re-seeds.
  //   80% done | 10% review | 5% inProgress | 5% todo
  const toTodoIds: string[] = [];
  const toInProgressIds: string[] = [];
  const toDoneIds: string[] = [];
  const toApprovedIds: string[] = [];
  for (const s of currentSprintStories) {
    let h = 0;
    for (let i = 0; i < s.id.length; i++) h = (h * 31 + s.id.charCodeAt(i)) | 0;
    const bucket = Math.abs(h) % 100;
    if (bucket < 5) toTodoIds.push(s.id);
    else if (bucket < 10) toInProgressIds.push(s.id);
    else if (bucket < 20) toDoneIds.push(s.id);
    else toApprovedIds.push(s.id);
  }
  // `todo` resets daysLeft to the original estimate so the column reads
  // as "unstarted at full size"; the other buckets keep whatever
  // daysLeft the curve generator landed on (mid-sprint snapshot).
  if (toTodoIds.length > 0) {
    for (const id of toTodoIds) {
      const story = currentSprintStories.find((x) => x.id === id);
      const est = story?.estimatedDays ?? null;
      await db.userStory.update({
        where: { id },
        data: { status: StoryStatus.todo, daysLeft: est },
      });
    }
  }
  if (toInProgressIds.length > 0) {
    await db.userStory.updateMany({
      where: { id: { in: toInProgressIds } },
      data: { status: StoryStatus.inProgress },
    });
  }
  if (toDoneIds.length > 0) {
    await db.userStory.updateMany({
      where: { id: { in: toDoneIds } },
      data: { status: StoryStatus.review, daysLeft: 0 },
    });
  }
  if (toApprovedIds.length > 0) {
    await db.userStory.updateMany({
      where: { id: { in: toApprovedIds } },
      data: { status: StoryStatus.done, daysLeft: 0 },
    });
  }
  console.log("[demo-builder] current-sprint mix", {
    sprint: currentSprint,
    todo: toTodoIds.length,
    inProgress: toInProgressIds.length,
    review: toDoneIds.length,
    done: toApprovedIds.length,
  });

  // ── Backfill: every team should have stories in the last 2 closed sprints
  //
  // The month-slicing logic above gives each of the 5 teams a roughly equal
  // share of each initiative's window, but that means some (team × sprint)
  // combos end up empty — e.g. platform happens to land in early-year
  // months of every initiative, so its May/June sprints have zero stories
  // and the retro charts for those team/sprint pairs show "No stories".
  //
  // To make retros usable on every team's accordion for the most recent
  // closed sprints, add 5 filler stories for any (team × last-2-closed-
  // sprints) gap. Stories attach to an existing epic of that team (no new
  // epics created — keeps the Gantt layout untouched).
  const lastTwoClosedSprints: number[] = [];
  for (let s = currentSprint - 1; s >= 1 && lastTwoClosedSprints.length < 2; s--) {
    const seEnd = sprintEndDate(planYear, s);
    if (seEnd < today) lastTwoClosedSprints.push(s);
  }
  console.log("[demo-builder] backfill", {
    planYear,
    currentSprint,
    lastTwoClosedSprints,
    today: today.toISOString(),
  });
  let backfillStoriesAdded = 0;
  let backfillSnapshotsAdded = 0;
  for (const teamSlug of DEMO_TEAM_SLUGS) {
    for (const targetSprint of lastTwoClosedSprints) {
      const existingCount = await db.userStory.count({
        where: { sprint: targetSprint, planYear, epic: { team: teamSlug } },
      });
      console.log("[demo-builder] backfill check", { teamSlug, targetSprint, existingCount });
      if (existingCount > 0) continue;
      // Only attach to an epic whose plan window INCLUDES the target
      // sprint. The previous fallback to "any epic of this team" was
      // creating spurious snapshots in past sprints under future- or
      // active-month epics — that pulled `computeEpicObservedStart`
      // backwards into May for a June epic, which then made the
      // verdict math compute against the extended window and push
      // the epic into At Risk / Overdue. If no eligible epic exists
      // for this (team × sprint), skip — team retro may miss data
      // for that combo but the health distribution stays honest.
      const { month: targetMonth } = monthLaneFromGlobalSprint(targetSprint);
      const teamEpic = await db.epic.findFirst({
        where: {
          team: teamSlug,
          planYear,
          planStartMonth: { lte: targetMonth },
          planEndMonth: { gte: targetMonth },
        },
        orderBy: { planStartMonth: "asc" },
      });
      console.log("[demo-builder] backfill epic pick", {
        teamSlug,
        targetSprint,
        targetMonth,
        epicId: teamEpic?.id,
        epicTitle: teamEpic?.title,
        epicStart: teamEpic?.planStartMonth,
        epicEnd: teamEpic?.planEndMonth,
      });
      if (!teamEpic) continue;
      const roster = membersByTeam.get(teamSlug) ?? [];
      const titlePool = DEMO_STORY_TEMPLATES_BY_TEAM[teamSlug];
      for (let i = 0; i < 5; i++) {
        const assignee = roster[i % Math.max(1, roster.length)] ?? null;
        const estimatedDays = 2 + (i % 4);
        const baseTitle = titlePool[(targetSprint + i) % titlePool.length]!;
        const created = await db.userStory.create({
          data: {
            title: `${baseTitle} (Sprint ${targetSprint})`,
            icon: "📄",
            description: null,
            assignee,
            sprint: targetSprint,
            estimatedDays,
            daysLeft: estimatedDays,
            status: StoryStatus.todo,
            epicId: teamEpic.id,
            roadmapId: DEMO_DEFAULT_ROADMAP_ID,
            planYear,
            planQuarter: Math.ceil(targetMonth / 3),
            labels: null,
            priority: pickDemoStoryPriority(teamEpic.priority ?? null, targetSprint * 7 + i * 31),
          },
        });
        backfillStoriesAdded += 1;
        const { snapshots, final } = buildDemoSnapshotSeries({
          storyId: created.id,
          sprint: targetSprint,
          estimatedDays,
          today,
          planYear,
          curve: pickDemoStoryCurve(created.id),
          assignee,
        });
        if (snapshots.length > 0) {
          await db.storyDailySnapshot.createMany({
            data: snapshots.map((s) => ({
              storyId: s.storyId,
              snapshotDate: s.snapshotDate,
              status: s.status,
              sprint: s.sprint,
              estimatedDays: s.estimatedDays,
              daysLeft: s.daysLeft,
              assignee: s.assignee,
            })),
          });
          backfillSnapshotsAdded += snapshots.length;
        }
        if (final.status !== StoryStatus.todo || final.daysLeft !== estimatedDays) {
          await db.userStory.update({
            where: { id: created.id },
            data: { status: final.status, daysLeft: final.daysLeft },
          });
        }
      }
    }
  }
  totalStories += backfillStoriesAdded;
  totalSnapshots += backfillSnapshotsAdded;
  console.log("[demo-builder] backfill review", { backfillStoriesAdded, backfillSnapshotsAdded });

  // Apply the same 100%-done cleanup to backfilled stories. Same
  // rationale as the main cleanup above — any non-done backfill story
  // in a closed sprint would leak into the verdict math and push an
  // active or future epic to Overdue / At Risk.
  const backfillClosed = await db.userStory.findMany({
    where: {
      sprint: { in: lastTwoClosedSprints },
      planYear,
      status: { not: StoryStatus.done },
    },
    select: { id: true, sprint: true, planYear: true, status: true },
  });
  const backfillToDoneIds: string[] = [];
  for (const s of backfillClosed) {
    if (s.sprint == null) continue;
    const seEnd = sprintEndDate(s.planYear ?? planYear, s.sprint);
    if (seEnd >= today) continue;
    backfillToDoneIds.push(s.id);
  }
  if (backfillToDoneIds.length > 0) {
    await db.userStory.updateMany({
      where: { id: { in: backfillToDoneIds } },
      data: { status: StoryStatus.done, daysLeft: 0 },
    });
  }
  console.log("[demo-builder] backfill status mix", {
    promotedToDone: backfillToDoneIds.length,
  });

  // Ground-truth audit: for each of the last 2 closed sprints, count stories
  // per team (via their parent epic's team) so we can verify what charts
  // should see for each team's retro accordion.
  for (const targetSprint of lastTwoClosedSprints) {
    for (const teamSlug of DEMO_TEAM_SLUGS) {
      const count = await db.userStory.count({
        where: { sprint: targetSprint, planYear, epic: { team: teamSlug } },
      });
      console.log("[demo-builder] audit", { targetSprint, teamSlug, storyCount: count });
    }
  }

  // ── Final pass: lock the override epics into Watch / At Risk health ──
  //
  // The closed-sprint cleanup + current-sprint diversify steps above
  // overwrite the slow-burn snapshot final-state for stories in
  // pickDemoEpicHealthOverride epics — so without this pass the verdict
  // collapses back to On Track / Done.
  //
  // For each override epic we explicitly set a story open/review mix
  // chosen so progress.ts lands in the desired band:
  //   - atRisk: 60 % stories `todo` with full estimatedDays remaining;
  //             40 % `review` with daysLeft=0. With ~33 d total scope and
  //             ~3-4 idealRemaining at end of May, deltaDays ~16 → At Risk.
  //   - watch:  30 % stories `todo` with full estimatedDays remaining;
  //             70 % `review` with daysLeft=0. deltaDays ~6 → Watch.
  // Picks are deterministic via a per-id hash so the same seed keeps the
  // same stories in each bucket across reseeds.
  const forceEpicHealth = async (epicIds: string[], openFraction: number) => {
    // Snapshot bookkeeping: the CFD reconstructs each day's status from
    // the snapshot stream. If we only update `story.status` here without
    // also writing a matching snapshot, the snapshot stream still ends at
    // its last natural-ramp value (e.g. inProgress / 1 day left) — and
    // the chart shows that stale state right up to today, causing a
    // misleading cliff between "yesterday's snapshot says inProgress"
    // and "today's story.status says review". For each forced story we:
    //   1. Delete any snapshot dated >= today's local midnight so a
    //      late natural-ramp snap can't override the forced state.
    //   2. Insert a fresh snapshot at today's timestamp with the
    //      forced status + daysLeft.
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    for (const epicId of epicIds) {
      const stories = await db.userStory.findMany({
        where: { epicId, sprint: { not: null } },
        select: { id: true, estimatedDays: true, sprint: true, assignee: true },
      });
      if (stories.length === 0) continue;
      const storyById = new Map(stories.map((s) => [s.id, s]));
      // Deterministic sort by id-hash, then mark the first `openFraction`
      // share as todo (full daysLeft) and the rest as review (daysLeft 0).
      const hashed = stories.map((s) => {
        let h = 0;
        for (let i = 0; i < s.id.length; i++) h = (h * 31 + s.id.charCodeAt(i)) | 0;
        return { id: s.id, est: s.estimatedDays ?? 3, hash: Math.abs(h) };
      });
      hashed.sort((a, b) => a.hash - b.hash);
      const openCount = Math.max(1, Math.round(stories.length * openFraction));
      const todoIds = hashed.slice(0, openCount).map((s) => s.id);
      const doneIds = hashed.slice(openCount).map((s) => s.id);
      const writeForcedSnapshot = async (storyId: string, status: StoryStatus, daysLeft: number, est: number) => {
        const story = storyById.get(storyId);
        if (!story) return;
        await db.storyDailySnapshot.deleteMany({
          where: { storyId, snapshotDate: { gte: todayStart } },
        });
        await db.storyDailySnapshot.create({
          data: {
            storyId,
            snapshotDate: today,
            status,
            sprint: story.sprint,
            estimatedDays: est,
            daysLeft,
            assignee: story.assignee,
          },
        });
      };
      for (const t of hashed.slice(0, openCount)) {
        await db.userStory.update({
          where: { id: t.id },
          data: { status: StoryStatus.todo, daysLeft: t.est },
        });
        await writeForcedSnapshot(t.id, StoryStatus.todo, t.est, t.est);
      }
      if (doneIds.length > 0) {
        await db.userStory.updateMany({
          where: { id: { in: doneIds } },
          data: { status: StoryStatus.review, daysLeft: 0 },
        });
        for (const d of hashed.slice(openCount)) {
          await writeForcedSnapshot(d.id, StoryStatus.review, 0, d.est);
        }
      }
      console.log("[demo-builder] force epic health", { epicId, todoCount: todoIds.length, doneCount: doneIds.length });
    }
  };
  await forceEpicHealth(overrideEpicsByCurve.atRisk, 0.6);
  await forceEpicHealth(overrideEpicsByCurve.watch, 0.3);
  // Overdue picks already have planEnd in the past — forcing 50% of their
  // stories to remain `todo` keeps progressPercent below 100, so progress.ts
  // hits the (now > end && progress < 100) branch and lands the verdict
  // on Overdue.
  await forceEpicHealth(overrideEpicsByCurve.overdue, 0.5);

  // ── Bump originalEstimateDays on watch + atRisk epics so the new
  //    burndown formula lands the verdict. The basic flow:
  //
  //      deltaDays = (epicEst − storyDaysBurned) − epicEst × ratio
  //                = epicEst × elapsedRatio − storyDaysBurned
  //
  //    Solving for epicEst given a target deltaDays and the epic's
  //    elapsedRatio (= 1 − daysRemaining / totalWorkingDays):
  //
  //      epicEst ≥ (target + storyDaysBurned) / elapsedRatio
  //
  //    Picks above land at the start of their window (elapsedRatio
  //    ~0.05-0.10), so without an estimate bump deltaDays stays near
  //    zero and the verdict collapses back to On Track even when 60 %
  //    of stories are still todo.
  const bumpEpicEstForVerdict = async (
    epicIds: string[],
    targetDeltaDays: number,
  ) => {
    console.log("[demo-builder] bumpEpicEstForVerdict START", {
      target: targetDeltaDays,
      epicCount: epicIds.length,
    });
    for (const epicId of epicIds) {
      const epic = await db.epic.findUnique({
        where: { id: epicId },
        select: {
          title: true,
          originalEstimateDays: true,
          planStartMonth: true,
          planEndMonth: true,
          planSprint: true,
          planEndSprint: true,
          planYear: true,
          userStories: { select: { estimatedDays: true, daysLeft: true, status: true } },
        },
      });
      if (!epic) {
        console.log("[demo-builder] bump skip: epic not found", { epicId });
        continue;
      }
      if (epic.planStartMonth == null || epic.planEndMonth == null) {
        console.log("[demo-builder] bump skip: epic not scheduled", { epicId, title: epic.title });
        continue;
      }
      const startSprint = globalSprintFromMonthLane(
        epic.planStartMonth,
        epic.planSprint === 2 ? 2 : 1,
      );
      const endSprint = globalSprintFromMonthLane(
        epic.planEndMonth,
        epic.planEndSprint === 1 ? 1 : 2,
      );
      const planYearForEpic = epic.planYear ?? planYear;
      const start = sprintStartDate(planYearForEpic, startSprint);
      const end = sprintEndDate(planYearForEpic, endSprint);
      const totalWorkingDays = workingDaysBetween(start, end);
      const daysRemaining = workingDaysBetween(today, end);
      const ratio = totalWorkingDays > 0
        ? Math.min(1, Math.max(0, daysRemaining / totalWorkingDays))
        : 0;
      // We want elapsedRatio large enough that bumping epicEst meaningfully
      // moves deltaDays. If the epic just started (elapsedRatio < 0.05),
      // fall back to a fixed 0.05 floor so the bump still produces a
      // useful estimate; we don't hide picks just because the window
      // happens to begin "now".
      const elapsedRatio = Math.max(0.05, 1 - ratio);
      let totalStoryDays = 0;
      let openStoryDays = 0;
      for (const s of epic.userStories) {
        if (s.estimatedDays == null) continue;
        totalStoryDays += s.estimatedDays;
        const terminal = s.status === StoryStatus.review || s.status === StoryStatus.done;
        if (!terminal) openStoryDays += s.daysLeft ?? s.estimatedDays;
      }
      const storyDaysBurned = Math.max(0, totalStoryDays - openStoryDays);
      const requiredEst = Math.ceil(
        (targetDeltaDays + storyDaysBurned) / elapsedRatio,
      );
      const currentEst = epic.originalEstimateDays ?? 0;
      const finalEst = Math.max(requiredEst, currentEst);
      // Always update (even if currentEst >= requiredEst) so the log line
      // shows up for every pick and we don't silently skip.
      await db.epic.update({
        where: { id: epicId },
        data: { originalEstimateDays: finalEst },
      });
      console.log("[demo-builder] bump epicEst", {
        epicId,
        title: epic.title,
        target: targetDeltaDays,
        elapsedRatio: Number(elapsedRatio.toFixed(3)),
        storyDaysBurned,
        currentEst,
        requiredEst,
        finalEst,
      });
    }
    console.log("[demo-builder] bumpEpicEstForVerdict DONE", { target: targetDeltaDays });
  };
  // Target deltaDays = 8 → comfortably in At Risk band (≥ 4).
  await bumpEpicEstForVerdict(overrideEpicsByCurve.atRisk, 8);
  // Target deltaDays = 2.5 → middle of Watch band (1 < δ < 4).
  await bumpEpicEstForVerdict(overrideEpicsByCurve.watch, 2.5);

  return {
    initiatives: DEMO_INITIATIVES.length,
    epics: totalEpics,
    stories: totalStories,
    users: createdUsers.length,
    snapshots: totalSnapshots,
  };
}

/**
 * Reseeds the demo then forces a handful of stories at the chosen sprint
 * boundary into `inProgress` so the time-travel rollover effect has guaranteed
 * unfinished work to move. Spread across multiple epics so the year-overflow
 * scenario exercises multi-epic continuation creation.
 *
 * Target sprints by scenario:
 *   - sprintOverflow  → S5  (March L1, within Q1)
 *   - quarterOverflow → S6  (March L2, last sprint of Q1, crosses to S7/Apr/Q2)
 *   - monthOverflow   → S8  (April L2, crosses to S9/May, both in Q2)
 *   - yearOverflow    → S24 (December L2, rollover clamps — overflow path)
 */
export async function seedScenario(scenario: ScenarioKey): Promise<ScenarioSeedResult> {
  await resetAndSeedDemo();
  const targetSprint = (
    {
      sprintOverflow: 5,
      quarterOverflow: 6,
      monthOverflow: 8,
      yearOverflow: 24,
    } as const
  )[scenario];

  // Pull a deliberate spread across epics — for the year scenario we want at
  // least 3 distinct epics so continuation creation has to make multiple
  // continuation rows, not just one.
  const candidates = await db.userStory.findMany({
    where: { sprint: targetSprint, status: { notIn: [StoryStatus.review, StoryStatus.done] } },
    take: 30,
    select: { id: true, epicId: true, estimatedDays: true },
    orderBy: { epicId: "asc" },
  });

  // Take up to ~3 stories per epic up to a total of 9 to keep the test set
  // small and predictable.
  const perEpic = new Map<string, number>();
  const picked: typeof candidates = [];
  for (const story of candidates) {
    const count = perEpic.get(story.epicId) ?? 0;
    if (count >= 3) continue;
    perEpic.set(story.epicId, count + 1);
    picked.push(story);
    if (picked.length >= 9) break;
  }

  let mutated = 0;
  for (const story of picked) {
    await db.userStory.update({
      where: { id: story.id },
      data: {
        status: StoryStatus.inProgress,
        daysLeft: Math.max(1, story.estimatedDays ?? 2),
      },
    });
    mutated += 1;
  }

  return { scenario, mutated };
}

/**
 * Cheap re-run: walk every existing demo story and extend its snapshot
 * series from the last snapshot's date up to today. Doesn't touch scope
 * (initiative/epic/user) or wipe anything. Live story `status`/`daysLeft`
 * are updated to the new latest-snapshot values so charts and kanban agree.
 */
export async function refreshDemoSnapshotsToToday(): Promise<RefreshResult> {
  const today = new Date();
  const stories = await db.userStory.findMany({
    where: { sprint: { not: null } },
    select: {
      id: true,
      sprint: true,
      estimatedDays: true,
      assignee: true,
      planYear: true,
      snapshots: { orderBy: { snapshotDate: "desc" }, take: 1, select: { snapshotDate: true } },
    },
  });
  let added = 0;
  for (const story of stories) {
    if (story.sprint == null || story.estimatedDays == null) continue;
    const planYear = story.planYear ?? currentPlanYear();
    const lastDate = story.snapshots[0]?.snapshotDate ?? null;
    const curve = pickDemoStoryCurve(story.id);
    // Re-build the full series from scratch (deterministic given the same
    // story id + estimate + sprint), then only insert dates strictly after
    // `lastDate`. Simpler than incremental math + impossible to under/over-
    // shoot when the curve coefficients are constant.
    const { snapshots, final } = buildDemoSnapshotSeries({
      storyId: story.id,
      sprint: story.sprint,
      estimatedDays: story.estimatedDays,
      today,
      planYear,
      curve,
      assignee: story.assignee ?? null,
    });
    const newSnapshots = lastDate
      ? snapshots.filter((s) => s.snapshotDate.getTime() > lastDate.getTime())
      : snapshots;
    if (newSnapshots.length > 0) {
      await db.storyDailySnapshot.createMany({
        data: newSnapshots.map((s) => ({
          storyId: s.storyId,
          snapshotDate: s.snapshotDate,
          status: s.status,
          sprint: s.sprint,
          estimatedDays: s.estimatedDays,
          daysLeft: s.daysLeft,
          assignee: s.assignee,
        })),
      });
      added += newSnapshots.length;
    }
    await db.userStory.update({
      where: { id: story.id },
      data: { status: final.status, daysLeft: final.daysLeft },
    });
  }

  // Phase C: capture an epic snapshot for every epic dated today. Idempotent
  // via the unique (epicId, snapshotDate) constraint, so re-runs no-op.
  // Demo epics don't change shape between seed runs so a single today-dated
  // snapshot is enough for the projection helper to find values for any
  // future view — pre-today closed views with no matching epic snapshot
  // fall back to the live epic field, which still matches the seeded
  // values until a user edits them.
  const epics = await db.epic.findMany({
    select: {
      id: true,
      title: true,
      description: true,
      icon: true,
      color: true,
      originalEstimateDays: true,
      priority: true,
      labels: true,
      team: true,
      planStartMonth: true,
      planEndMonth: true,
      planSprint: true,
      planEndSprint: true,
      planStartDay: true,
      planEndDay: true,
    },
  });
  for (const epic of epics) {
    await captureEpicDailySnapshot(epic, today);
  }

  return {
    added,
    through: today.toISOString().slice(0, 10),
  };
}

async function wipeAvatarFolder(): Promise<void> {
  try {
    const entries = await fs.readdir(UPLOADS_AVATARS_DIR);
    for (const name of entries) {
      const abs = path.join(UPLOADS_AVATARS_DIR, name);
      const stat = await fs.stat(abs).catch(() => null);
      if (stat?.isFile()) await fs.unlink(abs).catch(() => undefined);
    }
  } catch {
    // Folder missing → nothing to wipe. The LocalStorageAdapter recreates it
    // on first upload.
  }
}

function currentPlanYear(): number {
  return new Date().getFullYear();
}

const INITIATIVE_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#14b8a6", "#0ea5e9", "#f97316", "#84cc16", "#ec4899",
];

/**
 * Pick 0-`maxLabels` labels deterministically from `DEMO_LABELS_POOL`,
 * returning a comma-separated string (the project's labels column format)
 * or `null` when none. Skips ~40% of items entirely so the UI shows a
 * realistic mix of labeled and unlabeled rows.
 */
function pickDemoLabels(seed: number, maxLabels: number): string | null {
  const mod = Math.abs(seed * 2654435761) % 10;
  if (mod < 4) return null; // ~40% no labels
  const count = (mod % maxLabels) + 1;
  const chosen: string[] = [];
  for (let i = 0; i < count; i++) {
    const pick = (seed + i * 31) % DEMO_LABELS_POOL.length;
    const label = DEMO_LABELS_POOL[pick]!;
    if (!chosen.includes(label)) chosen.push(label);
  }
  return chosen.join(", ");
}

/**
 * Deterministic 0..1 sampler so the demo dataset stays stable across reseed
 * runs. Cheap LCG keyed on the caller's integer seed.
 */
function demoUnitSample(seed: number): number {
  const x = Math.abs(seed * 2654435761) % 233280;
  return x / 233280;
}

/**
 * Epic priority distribution skewed toward the middle so the backlog isn't
 * a wall of P1s. Keyed on a stable per-epic seed.
 *   ~5% P0 · ~22% P1 · ~45% P2 · ~18% P3 · ~10% unset
 */
function pickDemoEpicPriority(seed: number): string | null {
  const r = demoUnitSample(seed);
  if (r < 0.05) return "P0";
  if (r < 0.27) return "P1";
  if (r < 0.72) return "P2";
  if (r < 0.90) return "P3";
  return null;
}

/**
 * Story priority is mostly inherited from its epic (clusters feel coherent),
 * with a small chance of drifting one step in either direction and a few
 * stories left unset. P0 epics never have P3 stories, etc. — drift caps at
 * ±1 step from the parent's rung.
 */
function pickDemoStoryPriority(epicPriority: string | null, seed: number): string | null {
  const r = demoUnitSample(seed * 17 + 3);
  if (r < 0.10) return null; // ~10% unset
  if (r < 0.65) return epicPriority; // 55% inherit (including null)
  // Drift ±1 rung toward middle to keep things sensible.
  const order = ["P0", "P1", "P2", "P3"] as const;
  const idx = epicPriority ? order.indexOf(epicPriority as (typeof order)[number]) : 2;
  if (idx < 0) return "P2";
  const drift = demoUnitSample(seed * 31 + 11) < 0.5 ? -1 : 1;
  const next = Math.max(0, Math.min(order.length - 1, idx + drift));
  return order[next]!;
}
