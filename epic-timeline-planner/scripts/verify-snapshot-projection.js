/**
 * Verification harness for the close-day projection helpers in
 * `lib/story-snapshot-projection.ts`. Project has no jest/vitest setup,
 * so this script runs assertion-style checks against the compiled helpers
 * to provide automated coverage for the Phase B + C logic without
 * introducing a new build tool.
 *
 * Coverage matrix:
 *   1. projectStoryToCloseDate — no snapshots → returns live story unchanged
 *   2. projectStoryToCloseDate — single snapshot before closeMs → returns projected values
 *   3. projectStoryToCloseDate — multiple snapshots, picks most recent on-or-before
 *   4. projectStoryToCloseDate — all snapshots after closeMs → falls back to live
 *   5. projectStoryToCloseDate — Phase B field null on snapshot → falls back to live title
 *   6. projectEpicToCloseDate — same matrix at the epic level
 *   7. projectInitiativesToCloseDate — walks both story + epic projection in one pass
 *
 * Run:
 *   node scripts/verify-snapshot-projection.js
 *
 * Exit status:
 *   0 — all checks passed
 *   1 — at least one assertion failed (output identifies which)
 */
const path = require("node:path");
const { register } = require("node:module");
const { pathToFileURL } = require("node:url");

// Use Node 22's built-in TS source-loading via tsx if available; otherwise
// fall back to a tiny inline tsconfig pointer so the import compiles.
let projectStoryToCloseDate;
let projectEpicToCloseDate;
let projectInitiativesToCloseDate;
try {
  const mod = require("../lib/story-snapshot-projection.ts");
  projectStoryToCloseDate = mod.projectStoryToCloseDate;
  projectEpicToCloseDate = mod.projectEpicToCloseDate;
  projectInitiativesToCloseDate = mod.projectInitiativesToCloseDate;
} catch (e) {
  console.error("Could not load lib/story-snapshot-projection.ts directly.");
  console.error("Run via tsx instead: `npx tsx scripts/verify-snapshot-projection.js`");
  console.error("Underlying error:", e.message);
  process.exit(2);
}

let failures = 0;
function check(name, predicate) {
  if (predicate) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}`);
    failures += 1;
  }
}

function header(title) {
  console.log(`\n${title}`);
}

const MARCH_15 = new Date("2026-03-15T23:59:59.999Z").getTime();
const MARCH_10 = new Date("2026-03-10T00:00:00.000Z").getTime();
const MARCH_20 = new Date("2026-03-20T00:00:00.000Z").getTime();

function makeStory(overrides = {}) {
  return {
    id: "story-1",
    title: "Live title",
    description: "Live desc",
    priority: "P1",
    labels: "live,labels",
    status: "inProgress",
    sprint: 6,
    estimatedDays: 5,
    daysLeft: 3,
    assignee: "Live Person",
    snapshots: [],
    ...overrides,
  };
}

function makeSnapshot(overrides = {}) {
  return {
    id: "snap-1",
    storyId: "story-1",
    snapshotDate: new Date(MARCH_10).toISOString(),
    status: "todo",
    sprint: 5,
    estimatedDays: 5,
    daysLeft: 5,
    assignee: "Snap Person",
    title: "Snap title",
    description: "Snap desc",
    priority: "P2",
    labels: "snap,labels",
    createdAt: new Date(MARCH_10).toISOString(),
    ...overrides,
  };
}

function makeEpic(overrides = {}) {
  return {
    id: "epic-1",
    title: "Live epic",
    description: "Live epic desc",
    icon: "📁",
    color: "#3B82F6",
    originalEstimateDays: 30,
    priority: "P1",
    labels: "live",
    team: "platform",
    planStartMonth: 3,
    planEndMonth: 3,
    planSprint: 1,
    planEndSprint: 2,
    planStartDay: null,
    planEndDay: null,
    epicSnapshots: [],
    userStories: [],
    comments: [],
    history: [],
    ...overrides,
  };
}

function makeEpicSnap(overrides = {}) {
  return {
    id: "esnap-1",
    epicId: "epic-1",
    snapshotDate: new Date(MARCH_10).toISOString(),
    title: "Snap epic",
    description: "Snap epic desc",
    icon: "🗂",
    color: "#10b981",
    originalEstimateDays: 20,
    priority: "P3",
    labels: "snap",
    team: "experience",
    planStartMonth: 3,
    planEndMonth: 3,
    planSprint: 1,
    planEndSprint: 2,
    planStartDay: null,
    planEndDay: null,
    createdAt: new Date(MARCH_10).toISOString(),
    ...overrides,
  };
}

// ----------------------------------------------------------------------
header("projectStoryToCloseDate");
// 1. No snapshots
{
  const s = makeStory({ snapshots: [] });
  const out = projectStoryToCloseDate(s, MARCH_15);
  check("no snapshots → returns input untouched", out === s);
}
// 2. Single snapshot before close
{
  const s = makeStory({ snapshots: [makeSnapshot()] });
  const out = projectStoryToCloseDate(s, MARCH_15);
  check("status projected from snapshot", out.status === "todo");
  check("title projected from snapshot", out.title === "Snap title");
  check("priority projected from snapshot", out.priority === "P2");
  check("live story untouched", s.status === "inProgress");
}
// 3. Multiple snapshots → most recent on-or-before wins
{
  const s = makeStory({
    snapshots: [
      makeSnapshot({ snapshotDate: new Date(MARCH_10).toISOString(), status: "todo", title: "Old" }),
      makeSnapshot({ id: "snap-2", snapshotDate: new Date("2026-03-14T00:00:00.000Z").toISOString(), status: "done", title: "Mid" }),
      makeSnapshot({ id: "snap-3", snapshotDate: new Date(MARCH_20).toISOString(), status: "approved", title: "Future" }),
    ],
  });
  const out = projectStoryToCloseDate(s, MARCH_15);
  check("picks the Mar 14 snapshot, not the future one", out.status === "done");
  check("title from the mid snapshot", out.title === "Mid");
}
// 4. All snapshots after closeMs → live
{
  const s = makeStory({
    snapshots: [makeSnapshot({ snapshotDate: new Date(MARCH_20).toISOString() })],
  });
  const out = projectStoryToCloseDate(s, MARCH_10);
  check("falls back to live when all snapshots are future", out.status === "inProgress");
  check("title stays live", out.title === "Live title");
}
// 5. Phase B field null on snapshot → fall back to live for that field
{
  const s = makeStory({
    snapshots: [makeSnapshot({ title: null, priority: null })],
  });
  const out = projectStoryToCloseDate(s, MARCH_15);
  check("status from snapshot", out.status === "todo");
  check("null snapshot title falls back to live title", out.title === "Live title");
  check("null snapshot priority falls back to live priority", out.priority === "P1");
}

// ----------------------------------------------------------------------
header("projectEpicToCloseDate");
// 6a. No snapshots
{
  const e = makeEpic({ epicSnapshots: [] });
  const out = projectEpicToCloseDate(e, MARCH_15);
  check("no snapshots → returns input untouched", out === e);
}
// 6b. Single snapshot before close
{
  const e = makeEpic({ epicSnapshots: [makeEpicSnap()] });
  const out = projectEpicToCloseDate(e, MARCH_15);
  check("epic title projected", out.title === "Snap epic");
  check("epic estimate projected", out.originalEstimateDays === 20);
  check("epic team projected", out.team === "experience");
}
// 6c. Snapshot has null fields → fall back
{
  const e = makeEpic({ epicSnapshots: [makeEpicSnap({ team: null, priority: null })] });
  const out = projectEpicToCloseDate(e, MARCH_15);
  check("null snapshot team falls back to live", out.team === "platform");
  check("null snapshot priority falls back to live", out.priority === "P1");
}

// ----------------------------------------------------------------------
header("projectInitiativesToCloseDate");
// 7. Walks epic + story projection in one pass
{
  const story = makeStory({ snapshots: [makeSnapshot()] });
  const epic = makeEpic({ userStories: [story], epicSnapshots: [makeEpicSnap()] });
  const init = { id: "init-1", title: "Live init", epics: [epic] };
  const out = projectInitiativesToCloseDate([init], MARCH_15);
  const projectedEpic = out[0].epics[0];
  const projectedStory = projectedEpic.userStories[0];
  check("epic title projected through batch helper", projectedEpic.title === "Snap epic");
  check("story title projected through batch helper", projectedStory.title === "Snap title");
  check("initiative shell preserved", out[0].id === "init-1" && out[0].title === "Live init");
  check("live input not mutated (story)", story.title === "Live title");
  check("live input not mutated (epic)", epic.title === "Live epic");
}

// ----------------------------------------------------------------------
if (failures === 0) {
  console.log("\nAll snapshot projection checks passed.");
  process.exit(0);
}
console.error(`\n${failures} check(s) failed.`);
process.exit(1);
