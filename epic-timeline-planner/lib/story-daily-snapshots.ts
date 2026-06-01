"use server";

import { StoryStatus } from "@/lib/generated/prisma";

import { db } from "@/lib/db";

/**
 * Fields captured into {@link StoryDailySnapshot} per upsert. Extended in
 * Phase B with title / description / priority / labels so closed-period
 * views stay frozen against later renames + metadata edits. Existing call
 * sites pass the whole story object — fields they don't have (e.g. legacy
 * adapters) come through as undefined and become `null` rows, which the
 * projection helper falls back through to the live story.
 */
type SnapshotStory = {
  id: string;
  status: StoryStatus;
  sprint: number | null;
  estimatedDays: number | null;
  daysLeft: number | null;
  assignee: string | null;
  title?: string | null;
  description?: string | null;
  priority?: string | null;
  labels?: string | null;
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
      title: story.title ?? null,
      description: story.description ?? null,
      priority: story.priority ?? null,
      labels: story.labels ?? null,
    },
    update: {
      status: story.status,
      sprint: story.sprint,
      estimatedDays: story.estimatedDays,
      daysLeft: story.daysLeft,
      assignee: story.assignee,
      title: story.title ?? null,
      description: story.description ?? null,
      priority: story.priority ?? null,
      labels: story.labels ?? null,
    },
  });
}
