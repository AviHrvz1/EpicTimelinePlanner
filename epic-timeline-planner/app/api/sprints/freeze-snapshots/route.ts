import { NextResponse } from "next/server";
import { z } from "zod";

import { ACTIVE_RECORD, db } from "@/lib/db";
import { captureStoryDailySnapshot } from "@/lib/story-daily-snapshots";
import {
  YEAR_SPRINT_MAX,
  YEAR_SPRINT_MIN,
  sprintEndDate,
} from "@/lib/year-sprint";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  sprint: z.number().int().min(YEAR_SPRINT_MIN).max(YEAR_SPRINT_MAX),
});

/**
 * Manual sprint-close freeze. Called by the `SprintMoveModal` *before* it
 * PATCHes any story's `sprint` field so that every story currently in the
 * source sprint has a snapshot dated to the sprint's close instant. Once
 * frozen, later edits (or the moves themselves) cannot rewrite that day's
 * snapshot row because the `(storyId, snapshotDate)` unique constraint
 * locks it to the close-day key — future captures use today's date and
 * upsert into a different row.
 *
 * This is the keystone of retro fidelity: closed sprint Status charts read
 * via `projectInitiativesToCloseDate` find the close-day row and render
 * end-of-sprint state regardless of what happens to the live story
 * afterwards.
 */
export async function POST(request: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid payload" },
      { status: 400 },
    );
  }

  const closeInstant = sprintEndDate(parsed.year, parsed.sprint);
  const stories = await db.userStory.findMany({
    where: { ...ACTIVE_RECORD, sprint: parsed.sprint },
    select: {
      id: true,
      title: true,
      description: true,
      assignee: true,
      labels: true,
      priority: true,
      sprint: true,
      estimatedDays: true,
      daysLeft: true,
      status: true,
    },
  });

  for (const story of stories) {
    await captureStoryDailySnapshot(story, closeInstant);
  }

  return NextResponse.json({ frozen: stories.length, closeDate: closeInstant.toISOString() });
}
