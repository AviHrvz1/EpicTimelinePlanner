/**
 * Status-rename backfill: rewrite stored history entries for the
 * `done` → `review` / `approved` → `done` lifecycle rename.
 *
 * Each row in the `StoryHistory` table has an `entry` text column. The
 * status-change writer (`app/api/stories/[id]/route.ts:122`) emits
 * `"Status changed to <enum>"`. After the schema rename, those legacy
 * strings still say `done` / `approved` — which now mean the OPPOSITE
 * of what they did when written. Rewriting them is the only way to keep
 * the CFD parser (`lib/sprint-analytics.ts:parseStatusChangeEntry`) and
 * any timeline view that reads the history honest.
 *
 * Two `updateMany` calls do the swap atomically:
 *   - First pass turns the OLD `approved` entries into the NEW `done`.
 *   - Second pass parks the OLD `done` entries on a temp marker so they
 *     don't collide, then turns them into the NEW `review`.
 *
 * Idempotent: a re-run finds zero matches once the swap is committed.
 *
 * Usage:
 *   node scripts/backfill-status-rename-history.js
 */
const { PrismaClient } = require("../lib/generated/prisma");

const db = new PrismaClient();

async function main() {
  // 1. Park OLD `done` entries on a temp marker so step 2 doesn't collide.
  const parked = await db.storyHistory.updateMany({
    where: { entry: "Status changed to done" },
    data: { entry: "Status changed to __rename_review" },
  });

  // 2. Old `approved` becomes the NEW `done`.
  const promotedToDone = await db.storyHistory.updateMany({
    where: { entry: "Status changed to approved" },
    data: { entry: "Status changed to done" },
  });

  // 3. Move parked entries to their final name, `review`.
  const renamedToReview = await db.storyHistory.updateMany({
    where: { entry: "Status changed to __rename_review" },
    data: { entry: "Status changed to review" },
  });

  console.log(
    `Rewrote history entries — parked ${parked.count} → review, ` +
      `promoted ${promotedToDone.count} approved → done, ` +
      `final ${renamedToReview.count} → review.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
