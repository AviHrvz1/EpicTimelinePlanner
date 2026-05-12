/**
 * Seeds Sprint 9 (May 1–15 2026) burndown snapshots so every team's aggregate
 * daily remaining-days tracks close to the chart's linear ideal line.
 *
 * Math: ideal(d) = totalEst × (1 - (d-1)/14)
 * Per-story: snapshot.daysLeft ≈ estimatedDays × (1 - (d-1)/14) + noise
 * → Sum across stories ≈ ideal(d).  Status is derived from daysLeft.
 *
 * Run:  node scripts/seed-sprint9-burndown.js
 */

const { PrismaClient } = require('../lib/generated/prisma');
const db = new PrismaClient();

const SPRINT_YEAR = 2026;
const SPRINT_MONTH = 5;
const SPRINT_DAYS = 15;

function sprintDates() {
  const out = [];
  for (let d = 1; d <= SPRINT_DAYS; d++) out.push(new Date(SPRINT_YEAR, SPRINT_MONTH - 1, d));
  return out;
}

// Seeded PRNG
function makeRng(seed) {
  let s = (seed | 0) >>> 0;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

function buildSnapshots(stories) {
  const dates = sprintDates();
  // Derive seed from story IDs for repeatable jitter
  const seedVal = stories.reduce((a, s) => a ^ parseInt(s.id.replace(/-/g, '').slice(0, 8), 16), 12345);
  const rng = makeRng(seedVal);

  const snapshots = [];
  for (const story of stories) {
    const est = story.estimatedDays || 3;

    for (const date of dates) {
      const d = date.getDate(); // 1…15
      // Linear ideal fraction: 1 at day 1, 0 at day 15
      const idealFrac = Math.max(0, 1 - (d - 1) / (SPRINT_DAYS - 1));
      // Small proportional noise (±10-15% of est) so the line isn't perfectly straight
      const noise = (rng() - 0.5) * Math.min(2, est * 0.15);
      const daysLeft = Math.max(0, Math.round(est * idealFrac + noise));

      let status;
      if (daysLeft === 0) {
        status = story.status === 'approved' ? 'approved' : 'done';
      } else if (daysLeft >= est) {
        status = 'todo';
      } else {
        status = 'inProgress';
      }

      snapshots.push({ storyId: story.id, date, daysLeft, status });
    }
  }
  return snapshots;
}

async function main() {
  const stories = await db.userStory.findMany({
    where: {
      sprint: { in: [9, 1] },
      epic: { team: { in: ['platform', 'data', 'experience', 'mobile', 'growth'] } },
    },
    include: { epic: { select: { team: true } } },
  });

  const storyIds = stories.map(s => s.id);
  const { count: deleted } = await db.storyDailySnapshot.deleteMany({ where: { storyId: { in: storyIds } } });
  console.log(`Deleted ${deleted} old snapshots`);

  const teams = {};
  for (const s of stories) {
    const t = s.epic?.team || 'unknown';
    if (!teams[t]) teams[t] = [];
    teams[t].push(s);
  }

  let totalWritten = 0;
  for (const [team, teamStories] of Object.entries(teams)) {
    const totalEst = teamStories.reduce((sum, s) => sum + (s.estimatedDays || 3), 0);
    const snaps = buildSnapshots(teamStories);

    await Promise.all(
      snaps.map(snap =>
        db.storyDailySnapshot.upsert({
          where: { storyId_snapshotDate: { storyId: snap.storyId, snapshotDate: snap.date } },
          create: { storyId: snap.storyId, snapshotDate: snap.date, daysLeft: snap.daysLeft, status: snap.status },
          update: { daysLeft: snap.daysLeft, status: snap.status },
        })
      )
    );
    totalWritten += snaps.length;

    // Verify: aggregate actual vs linear ideal
    const byDay = {};
    for (const snap of snaps) { const d = snap.date.getDate(); byDay[d] = (byDay[d] || 0) + snap.daysLeft; }
    const ideal = d => Math.round(totalEst * Math.max(0, 1 - (d - 1) / (SPRINT_DAYS - 1)));
    const checkDays = [1, 5, 8, 11, 13, 15];
    const check = checkDays.map(d => `d${d}:${byDay[d] ?? '?'}/${ideal(d)}`).join(' ');
    console.log(`  ${team.padEnd(12)} est=${String(totalEst).padEnd(4)} ${check}`);
  }

  console.log(`\nDone — wrote ${totalWritten} snapshots`);
}

main()
  .catch(e => { console.error(e.message); process.exit(1); })
  .finally(() => db.$disconnect());
