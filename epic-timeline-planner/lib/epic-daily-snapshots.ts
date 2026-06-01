"use server";

import { db } from "@/lib/db";

/**
 * Fields captured into {@link EpicDailySnapshot} per upsert. Mirrors
 * {@link captureStoryDailySnapshot} — write idempotently on every epic
 * mutation (create, PATCH, year-end continuation create) plus once per
 * day during demo refresh. The projection helper reads these to render
 * closed-period views with the epic's close-day state instead of current
 * live values.
 *
 * Phase C contract: every editable epic field shown anywhere a user can
 * see it should be captured here. Unsnapshotted fields (e.g. relations,
 * audit timestamps) bleed through harmlessly.
 */
type SnapshotEpic = {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  originalEstimateDays: number | null;
  priority: string | null;
  labels: string | null;
  team: string | null;
  planStartMonth: number | null;
  planEndMonth: number | null;
  planSprint: number | null;
  planEndSprint: number | null;
  planStartDay: number | null;
  planEndDay: number | null;
};

function startOfUtcDay(input: Date) {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

export async function captureEpicDailySnapshot(epic: SnapshotEpic, now = new Date()) {
  const snapshotDate = startOfUtcDay(now);
  await db.epicDailySnapshot.upsert({
    where: {
      epicId_snapshotDate: {
        epicId: epic.id,
        snapshotDate,
      },
    },
    create: {
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
    update: {
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
}
