/**
 * Seeds Q1-Q2 (sprints 1..8) velocity history per team so the dashboard's
 * Velocity chart has Committed-vs-Completed bars to render.
 *
 * For each team in [platform, experience, data, mobile, growth]:
 *   - Creates a "Velocity demo (<team>)" Initiative covering Jan-Apr (months 1-4)
 *   - Adds one Epic under it
 *   - For each sprint S1..S8, generates N user stories per a per-team plan
 *     (committed = total stories, completed = stories with status done/approved)
 *   - For each story, writes snapshots: day-1 (todo / inProgress), and last day
 *     (final status), so latestSnapshotAtDay returns the right state at any cutoff.
 *
 * Idempotent: removes any prior "Velocity demo" initiative before re-seeding.
 *
 * Run:  node scripts/seed-velocity-history.js
 */

const { PrismaClient } = require("../lib/generated/prisma");
const crypto = require("crypto");

const db = new PrismaClient();

const YEAR = 2026;
const ROADMAP_ID = "default-roadmap-0000-0000-000000000001";

const TEAMS = ["platform", "experience", "data", "mobile", "growth"];

// Per-team plan: array of (committed, completed) for sprints S1..S8.
const PLAN = {
  platform:   [[8, 5], [8, 6], [9, 8], [10, 8], [9, 9], [11, 10], [10, 9], [12, 11]],
  experience: [[6, 4], [7, 6], [7, 6], [8, 7], [6, 5], [8, 7], [7, 7], [8, 8]],
  data:       [[5, 3], [5, 4], [6, 5], [6, 5], [7, 6], [7, 7], [8, 7], [7, 7]],
  mobile:     [[4, 2], [5, 3], [5, 4], [6, 5], [5, 4], [6, 5], [6, 6], [7, 6]],
  growth:     [[3, 2], [3, 3], [4, 3], [4, 4], [4, 3], [5, 4], [5, 5], [5, 5]],
};

const TEAM_COLOR = {
  platform: "#0EA5E9",
  experience: "#8B5CF6",
  data: "#F59E0B",
  mobile: "#10B981",
  growth: "#F43F5E",
};

const STORY_TITLES = {
  platform:   ["Migrate service to mesh", "Tune sharding key", "Upgrade k8s nodes", "Patch CVE backports", "Add tracing sidecar", "Tighten RBAC policies", "Drain noisy neighbour", "Roll out new ingress"],
  experience: ["Polish onboarding step", "Tweak welcome copy", "A/B test CTA", "Reduce empty-state friction", "Refine tooltip set", "Localise sign-up", "Refactor wizard frame", "Add in-app help"],
  data:       ["Backfill events table", "New cohort dimension", "Repair metric pipeline", "Optimise warehouse query", "Schema migration round", "Quality dashboards", "Anomaly alerts", "Retention rollup"],
  mobile:     ["Rebuild nav stack", "Theme system polish", "Offline sync chunk", "Performance fix pass", "Crash triage round", "Release pipeline tweak", "Accessibility audit", "Permissions UX"],
  growth:     ["Referral tile copy", "Variant experiment", "Funnel instrumentation", "Win-back email", "Activation nudge", "Pricing test", "Landing hero swap", "Lifecycle drip"],
};

// Sprint S → (month, lane). 24 sprints/year, 2 sprints/month.
function sprintMonth(yearSprint) { return Math.ceil(yearSprint / 2); }
function sprintLane(yearSprint) { return yearSprint % 2 === 1 ? 1 : 2; }
function startOfDay(d) { const out = new Date(d); out.setHours(0, 0, 0, 0); return out; }

function sprintStartDate(year, yearSprint) {
  const month = sprintMonth(yearSprint);
  const lane = sprintLane(yearSprint);
  return startOfDay(new Date(year, month - 1, lane === 1 ? 1 : 16));
}

function sprintEndDate(year, yearSprint) {
  const month = sprintMonth(yearSprint);
  const lane = sprintLane(yearSprint);
  const lastDay = new Date(year, month, 0).getDate();
  return startOfDay(new Date(year, month - 1, lane === 1 ? 15 : lastDay));
}

function uuid() { return crypto.randomUUID(); }

async function clearPrevious() {
  // Remove any prior "Velocity demo" initiatives (cascade removes epics + stories + snapshots).
  await db.initiative.deleteMany({ where: { title: { startsWith: "Velocity demo (" } } });
}

async function seedTeam(team, baseRow) {
  const now = new Date();
  const initiativeId = uuid();
  const epicId = uuid();

  await db.initiative.create({
    data: {
      id: initiativeId,
      title: `Velocity demo (${team})`,
      icon: "📈",
      description: "Generated history for the dashboard Velocity chart.",
      color: TEAM_COLOR[team] ?? "#3B82F6",
      status: "scheduled",
      startMonth: 1,
      endMonth: 4,
      startYearSprint: 1,
      endYearSprint: 8,
      timelineRow: baseRow,
      year: YEAR,
      roadmapId: ROADMAP_ID,
      createdAt: now,
      updatedAt: now,
    },
  });

  await db.epic.create({
    data: {
      id: epicId,
      title: `${team[0].toUpperCase() + team.slice(1)} delivery (Q1-Q2)`,
      icon: "📁",
      color: TEAM_COLOR[team] ?? "#3B82F6",
      initiativeId,
      planYear: YEAR,
      planQuarter: 1,
      planSprint: 1,
      planStartMonth: 1,
      planEndMonth: 4,
      planEndSprint: 2,
      planStartDay: 1,
      planEndDay: null,
      timelineRow: 0,
      backlogOrder: 0,
      team,
      roadmapId: ROADMAP_ID,
      createdAt: now,
      updatedAt: now,
    },
  });

  const stories = [];
  const snapshots = [];
  const titles = STORY_TITLES[team] ?? [];
  for (let s = 1; s <= 8; s++) {
    const [committed, completed] = PLAN[team][s - 1];
    const month = sprintMonth(s);
    const planQuarter = Math.ceil(month / 3);
    const start = sprintStartDate(YEAR, s);
    const end = sprintEndDate(YEAR, s);
    const titleSeed = titles[(s - 1) % titles.length] ?? `${team} work`;

    for (let i = 0; i < committed; i++) {
      const storyId = uuid();
      const isCompleted = i < completed;
      const status = isCompleted ? (i % 3 === 0 ? "approved" : "done") : (i % 2 === 0 ? "inProgress" : "todo");
      const estimated = 2 + (i % 4); // 2..5
      const daysLeft = isCompleted ? 0 : Math.max(0, estimated - 2 - (i % 2));

      stories.push({
        id: storyId,
        title: `S${s} · ${titleSeed} #${i + 1}`,
        icon: "📄",
        description: null,
        assignee: null,
        labels: null,
        priority: null,
        planYear: YEAR,
        planQuarter,
        sprint: s,
        estimatedDays: estimated,
        daysLeft,
        status,
        backlogOrder: 0,
        epicId,
        roadmapId: ROADMAP_ID,
        createdAt: now,
        updatedAt: now,
      });

      // Snapshots: day 1 (committed/started) and last day (final status).
      const day1Status = "todo";
      const midStatus = isCompleted ? "inProgress" : (status === "inProgress" ? "inProgress" : "todo");
      const finalStatus = status;

      snapshots.push({
        id: uuid(),
        storyId,
        snapshotDate: start,
        status: day1Status,
        sprint: s,
        estimatedDays: estimated,
        daysLeft: estimated,
        assignee: null,
        createdAt: now,
      });

      const midDate = new Date(start.getTime() + Math.floor((end.getTime() - start.getTime()) / 2));
      midDate.setHours(0, 0, 0, 0);
      snapshots.push({
        id: uuid(),
        storyId,
        snapshotDate: midDate,
        status: midStatus,
        sprint: s,
        estimatedDays: estimated,
        daysLeft: midStatus === "todo" ? estimated : Math.ceil(estimated / 2),
        assignee: null,
        createdAt: now,
      });

      snapshots.push({
        id: uuid(),
        storyId,
        snapshotDate: end,
        status: finalStatus,
        sprint: s,
        estimatedDays: estimated,
        daysLeft,
        assignee: null,
        createdAt: now,
      });
    }
  }

  if (stories.length > 0) {
    await db.userStory.createMany({ data: stories });
  }
  if (snapshots.length > 0) {
    await db.storyDailySnapshot.createMany({ data: snapshots });
  }

  return { stories: stories.length, snapshots: snapshots.length };
}

async function main() {
  console.log("Clearing previous Velocity demo data…");
  await clearPrevious();
  let baseRow = 50; // sit below existing rows
  const totals = {};
  for (const team of TEAMS) {
    const { stories, snapshots } = await seedTeam(team, baseRow);
    baseRow += 1;
    totals[team] = { stories, snapshots };
    console.log(`  ${team}: ${stories} stories, ${snapshots} snapshots`);
  }
  console.log("Done.");
  console.table(totals);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
