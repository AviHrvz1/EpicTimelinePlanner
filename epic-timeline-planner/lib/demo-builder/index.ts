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
  DEMO_TEAM_SLUGS,
  DEMO_USER_NAMES_BY_TEAM,
  type DemoTeamSlug,
} from "@/lib/demo-builder/data";
import {
  buildDemoSnapshotSeries,
  pickDemoStoryCurve,
} from "@/lib/demo-builder/snapshots";
import {
  currentCalendarYearSprint,
  globalSprintFromMonthLane,
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

export async function resetAndSeedDemo(): Promise<ResetSeedResult> {
  const planYear = currentPlanYear();
  const today = new Date();

  // 1. Wipe app data. Order matters for cascade safety even with onDelete:
  //    delete leaf rows first, then parents. Auth tables (User/Account/etc)
  //    are not touched so the user stays signed in.
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
  // Roadmap may not be present in all installs — guard with try/catch in case
  // the table doesn't exist yet for an older DB snapshot.
  try { await db.roadmap.deleteMany({}); } catch { /* ignore */ }
  await db.workspaceUser.deleteMany({});

  // 2. Wipe previously-uploaded avatar files so disk doesn't accumulate
  //    orphans across reseeds. Only touches `public/uploads/avatars/` and
  //    only deletes files (not subdirectories) for safety.
  await wipeAvatarFolder();

  // 3. Copy avatars from ~/Downloads/users + create workspace users.
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
  for (let initIdx = 0; initIdx < DEMO_INITIATIVES.length; initIdx++) {
    const seed = DEMO_INITIATIVES[initIdx]!;
    const startMonth = seed.startMonth;
    const endMonth = Math.min(12, startMonth + seed.monthSpan - 1);
    // Initiative assignee: pick a member of the first team for visual
    // variety — different team per initiative via round-robin.
    const initTeam = DEMO_TEAM_SLUGS[initIdx % DEMO_TEAM_SLUGS.length]!;
    const initRoster = membersByTeam.get(initTeam) ?? [];
    const initAssignee = initRoster[initIdx % Math.max(1, initRoster.length)] ?? null;

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
        timelineRow: initIdx,
        roadmapId: DEMO_DEFAULT_ROADMAP_ID,
        labels: pickDemoLabels(initIdx, 2) ?? null,
      },
    });

    // 5. Create 5 epics under this initiative — one per team. Each epic
    //    claims a UNIQUE multi-month slot within the initiative's window
    //    so they don't pile up on the same row of the Gantt, AND every
    //    epic always covers both sprints of its month range (planSprint=1,
    //    planEndSprint=2) — narrower than that and the epic title gets
    //    truncated by the bar on the all-quarters view. The floor/ceil
    //    math ensures epic[i+1].start > epic[i].end for any span ≥ 5;
    //    with seeded spans ≥ 10 each epic gets ~2 months of width.
    const TEAMS_PER_INITIATIVE = DEMO_TEAM_SLUGS.length;
    for (let teamIdx = 0; teamIdx < TEAMS_PER_INITIATIVE; teamIdx++) {
      const teamSlug = DEMO_TEAM_SLUGS[teamIdx]!;
      const startOffset = Math.floor((teamIdx * seed.monthSpan) / TEAMS_PER_INITIATIVE);
      const nextStartOffset = Math.floor(((teamIdx + 1) * seed.monthSpan) / TEAMS_PER_INITIATIVE);
      const endOffset = Math.max(startOffset, nextStartOffset - 1);
      const epicStartMonth = Math.min(endMonth, startMonth + startOffset);
      const epicEndMonth = Math.min(endMonth, startMonth + endOffset);
      // Always sprint-1 → sprint-2 so every epic spans at least 2 sprints.
      // For 2-month epics that's 4 sprints, plenty of width for the label.
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
          timelineRow: initIdx,
          team: teamSlug,
          originalEstimateDays: null,
          labels: pickDemoLabels(initIdx * 5 + teamIdx, 2) ?? null,
        },
      });
      totalEpics += 1;

      // 6. Stories — 10 per epic, distributed across the epic's sprints.
      //    Pull the global sprint numbers from `globalSprintFromMonthLane`
      //    so they match the kanban / insights filters exactly.
      const sprintStart = globalSprintFromMonthLane(epicStartMonth, planSprint);
      const sprintEnd = globalSprintFromMonthLane(epicEndMonth, planEndSprint);
      const sprintRange: number[] = [];
      for (let s = sprintStart; s <= sprintEnd; s++) sprintRange.push(s);
      const storyTitles = DEMO_STORY_TEMPLATES_BY_TEAM[teamSlug];

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
        const created = await db.userStory.create({
          data: {
            title: story.title,
            icon: "📄",
            // ~60% of stories get a description.
            description: storySeed % 10 < 6
              ? DEMO_STORY_DESCRIPTIONS[storySeed % DEMO_STORY_DESCRIPTIONS.length]!
              : null,
            assignee: story.assignee,
            sprint: story.sprint,
            estimatedDays: story.estimatedDays,
            daysLeft: story.daysLeft,
            status: story.status,
            epicId: epic.id,
            roadmapId: DEMO_DEFAULT_ROADMAP_ID,
            planYear,
            planQuarter: Math.ceil(epicStartMonth / 3),
            labels: pickDemoLabels(storySeed, 1) ?? null,
          },
        });
        totalStories += 1;

        const { snapshots, final } = buildDemoSnapshotSeries({
          storyId: created.id,
          sprint: story.sprint,
          estimatedDays: story.estimatedDays,
          today,
          planYear,
          curve: pickDemoStoryCurve(created.id),
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

      // Sum story estimates into the epic's `originalEstimateDays` so the
      // capacity/insights "Σ Child" stats are populated.
      const sumOriginal = storiesData.reduce((acc, s) => acc + s.estimatedDays, 0);
      await db.epic.update({
        where: { id: epic.id },
        data: { originalEstimateDays: sumOriginal },
      });
    }
  }

  // Promote ~70% of "done" stories from sprints that finished > 14 days ago
  // to "approved" so the kanban / pie chart show all four statuses, not just
  // todo / inProgress / done. Recently-done stories stay "done" since QA
  // typically lags by a sprint or two.
  const approvedCutoff = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const doneStories = await db.userStory.findMany({
    where: { status: StoryStatus.done, sprint: { not: null } },
    select: { id: true, sprint: true, planYear: true },
  });
  const approveIds: string[] = [];
  for (const s of doneStories) {
    if (s.sprint == null) continue;
    const seEnd = sprintEndDate(s.planYear ?? planYear, s.sprint);
    if (seEnd >= approvedCutoff) continue; // recent — keep as done
    // Deterministic 70% pick based on id hash.
    let h = 0;
    for (let i = 0; i < s.id.length; i++) h = (h * 31 + s.id.charCodeAt(i)) | 0;
    if (Math.abs(h) % 10 < 7) approveIds.push(s.id);
  }
  if (approveIds.length > 0) {
    await db.userStory.updateMany({
      where: { id: { in: approveIds } },
      data: { status: StoryStatus.approved },
    });
  }

  // Diversify current-sprint statuses. The snapshot-generated `final` state
  // only produces `inProgress` / `done` for the current sprint (anything
  // before today's progress = inProgress, anything fully burned = done) —
  // which means a freshly-seeded current sprint shows only those two
  // statuses on the kanban. Spread ~25% to `todo` (planned but not yet
  // pulled in) and ~10% of the done ones to `approved` (QA already signed
  // off) so all four columns have entries — matching what a real mid-sprint
  // board would look like.
  const currentSprint = currentCalendarYearSprint(today);
  const currentSprintStories = await db.userStory.findMany({
    where: { sprint: currentSprint, planYear },
    select: { id: true, status: true, estimatedDays: true },
  });
  const toTodoIds: string[] = [];
  const toApprovedIds: string[] = [];
  for (const s of currentSprintStories) {
    // Deterministic per-id bucket so re-seeds with the same scope produce
    // the same distribution.
    let h = 0;
    for (let i = 0; i < s.id.length; i++) h = (h * 31 + s.id.charCodeAt(i)) | 0;
    const bucket = Math.abs(h) % 100;
    if (bucket < 25 && s.status !== StoryStatus.approved) {
      // 25% → todo, regardless of current status (reset daysLeft to full).
      toTodoIds.push(s.id);
    } else if (bucket >= 90 && s.status === StoryStatus.done) {
      // 10% of done → approved (early QA sign-off).
      toApprovedIds.push(s.id);
    }
  }
  if (toTodoIds.length > 0) {
    // Reset daysLeft to the original estimate so the "to do" column shows
    // each story at its full unstarted size.
    for (const id of toTodoIds) {
      const story = currentSprintStories.find((x) => x.id === id);
      const est = story?.estimatedDays ?? null;
      await db.userStory.update({
        where: { id },
        data: { status: StoryStatus.todo, daysLeft: est },
      });
    }
  }
  if (toApprovedIds.length > 0) {
    await db.userStory.updateMany({
      where: { id: { in: toApprovedIds } },
      data: { status: StoryStatus.approved },
    });
  }

  return {
    initiatives: DEMO_INITIATIVES.length,
    epics: totalEpics,
    stories: totalStories,
    users: createdUsers.length,
    snapshots: totalSnapshots,
  };
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
