/**
 * One-time data fix: re-populate `daysLeft` on existing `review` stories.
 *
 * Before the daysLeft invariant tightened, both `done` and `approved` (now
 * `review` and `done` post-rename) zeroed daysLeft on PATCH/POST — the
 * implicit semantic was "engineering work is complete." After the rename
 * those two statuses split: `done` is shipped, `review` is QA-pending.
 * Sprint burndown and progress % should still treat review work as open,
 * so review stories need real daysLeft values again.
 *
 * Conservative default: set daysLeft = estimatedDays for review rows where
 * daysLeft is currently 0. That treats review as "shipping/QA work still
 * fully ahead" — overstated for already-tested cards but underestimated
 * is worse (a 0 daysLeft makes burndown still drop). Planners can adjust
 * specific cards from the kanban.
 *
 * Idempotent: only rows where (status = "review" AND daysLeft = 0) match.
 * Re-runs after manual adjustments leave non-zero daysLeft untouched.
 *
 * Usage:
 *   node scripts/backfill-review-days-left.js
 */
const { PrismaClient } = require("../lib/generated/prisma");

const db = new PrismaClient();

async function main() {
  const candidates = await db.userStory.findMany({
    where: { status: "review", daysLeft: 0 },
    select: { id: true, estimatedDays: true },
  });
  if (candidates.length === 0) {
    console.log("No review stories with daysLeft = 0 — nothing to backfill.");
    return;
  }

  let updated = 0;
  for (const row of candidates) {
    // Skip rows without an estimate — there's nothing to copy and the
    // story has no measurable work to track anyway.
    if (row.estimatedDays == null || row.estimatedDays <= 0) continue;
    await db.userStory.update({
      where: { id: row.id },
      data: { daysLeft: row.estimatedDays },
    });
    updated += 1;
  }
  console.log(
    `Backfilled daysLeft on ${updated} review stor${updated === 1 ? "y" : "ies"} ` +
      `(of ${candidates.length} candidates).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
