/**
 * Phase C backfill: write one EpicDailySnapshot per epic dated at the
 * earliest known StoryDailySnapshot date under that epic (or today when
 * no story snapshots exist). Closed-period views past that date can then
 * resolve a snapshot row instead of falling back to live epic state.
 *
 * Strategy: one snapshot per epic — covers every date >= earliest snapshot.
 * Future epic edits write their own dated snapshot via captureEpicDailySnapshot,
 * so going forward closed views show the right value for the right day.
 *
 * Idempotent: the unique (epicId, snapshotDate) constraint makes re-runs
 * safe. Skip the upsert when a snapshot for the same epic + date already
 * exists.
 *
 * Usage:
 *   node scripts/backfill-epic-daily-snapshots.js
 */
const { PrismaClient } = require("../lib/generated/prisma");

const db = new PrismaClient();

function startOfUtcDay(input) {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

async function main() {
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
      createdAt: true,
      userStories: {
        select: {
          snapshots: { orderBy: { snapshotDate: "asc" }, take: 1, select: { snapshotDate: true } },
        },
      },
    },
  });
  if (epics.length === 0) {
    console.log("No epics found.");
    return;
  }
  const today = startOfUtcDay(new Date());
  let created = 0;
  let skipped = 0;
  for (const epic of epics) {
    // Earliest date we have data for: min across all child stories'
    // earliest snapshot, falling back to the epic's createdAt.
    let earliestMs = Infinity;
    for (const story of epic.userStories) {
      const snap = story.snapshots[0];
      if (snap == null) continue;
      const ms = new Date(snap.snapshotDate).getTime();
      if (ms < earliestMs) earliestMs = ms;
    }
    const seedDate = earliestMs === Infinity
      ? startOfUtcDay(new Date(epic.createdAt))
      : startOfUtcDay(new Date(earliestMs));
    // Cap at today so we don't write future-dated snapshots.
    const snapshotDate = seedDate.getTime() > today.getTime() ? today : seedDate;
    const existing = await db.epicDailySnapshot.findUnique({
      where: { epicId_snapshotDate: { epicId: epic.id, snapshotDate } },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    await db.epicDailySnapshot.create({
      data: {
        epicId: epic.id,
        snapshotDate,
        title: epic.title,
        description: epic.description,
        icon: epic.icon,
        color: epic.color,
        originalEstimateDays: epic.originalEstimateDays,
        priority: epic.priority,
        labels: epic.labels,
        team: epic.team,
        planStartMonth: epic.planStartMonth,
        planEndMonth: epic.planEndMonth,
        planSprint: epic.planSprint,
        planEndSprint: epic.planEndSprint,
        planStartDay: epic.planStartDay,
        planEndDay: epic.planEndDay,
      },
    });
    created += 1;
  }
  console.log(`Done. Created ${created}, skipped ${skipped} (already had a snapshot at the seed date).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
