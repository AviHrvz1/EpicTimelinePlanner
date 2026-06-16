/**
 * Diagnostic for the sprint retrospective view.
 *
 * Mirrors the kanban-matching rule used by
 * `lib/sprint-retrospective.ts`:
 *   - Live-in-sprint stories use LIVE status.
 *   - Rolled-out stories use their LATEST in-sprint snapshot.
 *
 * Run:
 *   node scripts/diagnose-sprint-retrospective.js [yearSprint] [planYear]
 *
 * Defaults: yearSprint=11, planYear=2026.
 */
const { PrismaClient } = require("../lib/generated/prisma");

const prisma = new PrismaClient();

const TARGET_SPRINT = Number(process.argv[2] ?? 11);
const PLAN_YEAR = Number(process.argv[3] ?? 2026);

function projectStoryForSprint(story, sprint) {
  if (story.sprint === sprint) {
    return { kept: true, source: "live-in-sprint", status: story.status, sprint };
  }
  // Latest snapshot whose sprint === target.
  let best = null;
  let bestMs = -Infinity;
  for (const snap of story.snapshots ?? []) {
    if (snap.sprint !== sprint) continue;
    const ms = new Date(snap.snapshotDate).getTime();
    if (ms > bestMs) { bestMs = ms; best = snap; }
  }
  if (best == null) return { kept: false, source: "never-in-sprint", liveSprint: story.sprint };
  return { kept: true, source: "rolled-out-via-snapshot", status: best.status, sprint, bestSnapshotDate: new Date(bestMs).toISOString() };
}

async function main() {
  console.log(`Target: planYear=${PLAN_YEAR} yearSprint=${TARGET_SPRINT}`);
  console.log();

  // Union: live-in-sprint OR ever-had-snapshot-with-sprint.
  const live = await prisma.userStory.findMany({
    where: { sprint: TARGET_SPRINT },
    select: { id: true, sprint: true, team: true, status: true, epic: { select: { team: true } }, snapshots: { select: { snapshotDate: true, status: true, sprint: true } } },
  });
  const everInSnap = await prisma.userStory.findMany({
    where: { snapshots: { some: { sprint: TARGET_SPRINT } } },
    select: { id: true, sprint: true, team: true, status: true, epic: { select: { team: true } }, snapshots: { select: { snapshotDate: true, status: true, sprint: true } } },
  });
  const byId = new Map();
  for (const s of live) byId.set(s.id, s);
  for (const s of everInSnap) if (!byId.has(s.id)) byId.set(s.id, s);
  const candidates = [...byId.values()];

  const buckets = { liveInSprint: 0, rolledOut: 0, neverInSprint: 0 };
  const status = { todo: 0, inProgress: 0, review: 0, done: 0 };
  const byTeam = new Map();
  for (const s of candidates) {
    const r = projectStoryForSprint(s, TARGET_SPRINT);
    if (!r.kept) { buckets.neverInSprint += 1; continue; }
    if (r.source === "live-in-sprint") buckets.liveInSprint += 1;
    else buckets.rolledOut += 1;
    status[r.status] = (status[r.status] ?? 0) + 1;
    const team = (s.team ?? s.epic?.team) ?? "(no-team)";
    const row = byTeam.get(team) ?? { total: 0, todo: 0, inProgress: 0, review: 0, done: 0 };
    row.total += 1;
    row[r.status] += 1;
    byTeam.set(team, row);
  }

  console.log(`Candidates: ${candidates.length}`);
  console.log(`  KEPT (live-in-sprint):           ${buckets.liveInSprint}`);
  console.log(`  KEPT (rolled-out via snapshot):  ${buckets.rolledOut}`);
  console.log(`  DROPPED (never in sprint):       ${buckets.neverInSprint}`);
  console.log();
  console.log(`Donut breakdown (all teams):`);
  console.log(`  To do:        ${status.todo}`);
  console.log(`  In progress:  ${status.inProgress}`);
  console.log(`  Review:       ${status.review}`);
  console.log(`  Done:         ${status.done}`);
  console.log(`  TOTAL:        ${status.todo + status.inProgress + status.review + status.done}`);
  console.log();
  console.log(`Per-team:`);
  console.log(`  team               total  toDo  inProg  review  done`);
  for (const [team, r] of [...byTeam.entries()].sort()) {
    console.log(`  ${team.padEnd(18)} ${String(r.total).padStart(5)} ${String(r.todo).padStart(5)} ${String(r.inProgress).padStart(6)} ${String(r.review).padStart(6)} ${String(r.done).padStart(5)}`);
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
