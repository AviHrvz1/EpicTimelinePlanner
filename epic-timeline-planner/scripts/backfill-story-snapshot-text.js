/**
 * Phase B backfill: populate StoryDailySnapshot.title / description /
 * priority / labels for rows that pre-date the schema migration.
 *
 * Strategy:
 *   For every snapshot row where ANY of (title, description, priority,
 *   labels) is NULL, copy the value from the parent UserStory row. The
 *   parent's current value is the best available approximation — note this
 *   in the header so anyone reading the snapshot understands historical
 *   drift might be smoothed.
 *
 * Idempotent: re-runs only touch rows still NULL on at least one column.
 *
 * Usage:
 *   node scripts/backfill-story-snapshot-text.js
 */
const { PrismaClient } = require("../lib/generated/prisma");

const db = new PrismaClient();

async function main() {
  const rows = await db.storyDailySnapshot.findMany({
    where: {
      OR: [
        { title: null },
        { description: null },
        { priority: null },
        { labels: null },
      ],
    },
    select: { id: true, storyId: true, title: true, description: true, priority: true, labels: true },
  });
  if (rows.length === 0) {
    console.log("Nothing to backfill — every StoryDailySnapshot row already carries text fields.");
    return;
  }
  console.log(`Backfilling ${rows.length} StoryDailySnapshot row(s) with text fields…`);
  const storyIds = Array.from(new Set(rows.map((r) => r.storyId)));
  const stories = await db.userStory.findMany({
    where: { id: { in: storyIds } },
    select: { id: true, title: true, description: true, priority: true, labels: true },
  });
  const storyById = new Map(stories.map((s) => [s.id, s]));
  let updated = 0;
  for (const row of rows) {
    const story = storyById.get(row.storyId);
    if (!story) continue;
    const patch = {};
    if (row.title === null) patch.title = story.title;
    if (row.description === null) patch.description = story.description;
    if (row.priority === null) patch.priority = story.priority;
    if (row.labels === null) patch.labels = story.labels;
    if (Object.keys(patch).length === 0) continue;
    await db.storyDailySnapshot.update({ where: { id: row.id }, data: patch });
    updated += 1;
  }
  console.log(`Done. Updated ${updated} StoryDailySnapshot row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
