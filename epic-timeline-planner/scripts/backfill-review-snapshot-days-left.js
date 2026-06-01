/**
 * One-time data fix on `StoryDailySnapshot.daysLeft` for historical review
 * snapshots.
 *
 * Before the `done`/`review` enum rework + the daysLeft invariant change,
 * moving a story to (then-named) `done` (which we now call `review`)
 * zeroed daysLeft on the live row AND on each daily snapshot. Now that
 * review is "engineering complete, awaiting QA/ship", review work is
 * NOT terminal and shouldn't disappear from burndown charts. Closed
 * sprint analytics read snapshots — so we rewrite the snapshot column to
 * keep those charts honest with the new semantics.
 *
 * For every snapshot row where (status = "review" AND daysLeft = 0),
 * set daysLeft = the snapshot's own estimatedDays. The snapshot table
 * captured estimatedDays at the same instant as status/daysLeft (per
 * `lib/story-daily-snapshots.ts`) so the row is self-contained.
 *
 * Idempotent: re-runs match nothing.
 *
 * Usage:
 *   node scripts/backfill-review-snapshot-days-left.js
 */
const { PrismaClient } = require("../lib/generated/prisma");

const db = new PrismaClient();

async function main() {
  const candidates = await db.storyDailySnapshot.findMany({
    where: { status: "review", daysLeft: 0 },
    select: { id: true, estimatedDays: true },
  });
  if (candidates.length === 0) {
    console.log("No review snapshots with daysLeft = 0 — nothing to rewrite.");
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (const row of candidates) {
    if (row.estimatedDays == null || row.estimatedDays <= 0) {
      skipped += 1;
      continue;
    }
    await db.storyDailySnapshot.update({
      where: { id: row.id },
      data: { daysLeft: row.estimatedDays },
    });
    updated += 1;
  }
  console.log(
    `Rewrote ${updated} review snapshot${updated === 1 ? "" : "s"} ` +
      `(of ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}; ` +
      `${skipped} skipped for null/zero estimatedDays).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
