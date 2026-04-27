"use server";

import { StoryStatus } from "@/lib/generated/prisma";

import { db } from "@/lib/db";

type SnapshotStory = {
  id: string;
  status: StoryStatus;
  sprint: number | null;
  estimatedDays: number | null;
  daysLeft: number | null;
  assignee: string | null;
};

function startOfUtcDay(input: Date) {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

export async function captureStoryDailySnapshot(story: SnapshotStory, now = new Date()) {
  const snapshotDate = startOfUtcDay(now);
  await db.storyDailySnapshot.upsert({
    where: {
      storyId_snapshotDate: {
        storyId: story.id,
        snapshotDate,
      },
    },
    create: {
      storyId: story.id,
      snapshotDate,
      status: story.status,
      sprint: story.sprint,
      estimatedDays: story.estimatedDays,
      daysLeft: story.daysLeft,
      assignee: story.assignee,
    },
    update: {
      status: story.status,
      sprint: story.sprint,
      estimatedDays: story.estimatedDays,
      daysLeft: story.daysLeft,
      assignee: story.assignee,
    },
  });
}
