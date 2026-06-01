import { NextRequest, NextResponse } from "next/server";
import { StoryStatus } from "@/lib/generated/prisma";
import { z } from "zod";

import { ACTIVE_RECORD, db } from "@/lib/db";
import { captureStoryDailySnapshot } from "@/lib/story-daily-snapshots";
import { YEAR_SPRINT_MAX, YEAR_SPRINT_MIN } from "@/lib/year-sprint";

const updateStorySchema = z.object({
  // Allow legacy one-character titles during incremental inline edits.
  title: z.string().trim().min(1).max(160).optional(),
  icon: z.string().trim().min(1).max(4).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  assignee: z.string().trim().max(120).optional().nullable(),
  labels: z.string().trim().max(500).optional().nullable(),
  priority: z.string().trim().max(60).optional().nullable(),
  /** Year sprint 1–24, or legacy 1–2 (month lane) per `resolveStoryYearSprint`. */
  sprint: z.number().int().min(YEAR_SPRINT_MIN).max(YEAR_SPRINT_MAX).optional().nullable(),
  estimatedDays: z.number().int().min(0).max(3650).optional().nullable(),
  daysLeft: z.number().int().min(0).max(3650).optional().nullable(),
  status: z.nativeEnum(StoryStatus).optional(),
  /** Kanban column order (per status) on the sprint board. */
  backlogOrder: z.number().int().min(0).max(10_000).optional(),
  epicId: z.string().uuid().optional(),
  /** Optional explicit history line for system-driven updates (e.g. sprint auto-rollover). */
  historyEntry: z.string().trim().min(1).max(240).optional(),
});

function quarterFromMonth(month: number | null | undefined): number | null {
  if (month == null) return null;
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
  const { id } = await context.params;
  const payload = await request.json();
  const parsed = updateStorySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid story update payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Phase D: edit endpoint refuses soft-deleted rows. Soft-deleted stories
  // surface only in closed-period views; edits in the present would either
  // resurrect them or corrupt the snapshot trail.
  const existing = await db.userStory.findFirst({
    where: { id, ...ACTIVE_RECORD },
    select: {
      title: true,
      icon: true,
      description: true,
      assignee: true,
      labels: true,
      priority: true,
      sprint: true,
      estimatedDays: true,
      daysLeft: true,
      status: true,
      backlogOrder: true,
      epicId: true,
      planYear: true,
      planQuarter: true,
      roadmapId: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ message: "Story not found" }, { status: 404 });
  }

  const changes: string[] = [];
  const patch = parsed.data;

  // Maintain three invariants on (estimatedDays, daysLeft, status) so the
  // year-roadmap health/at-risk math can trust the fields without fallbacks:
  //   (a) review/done stories always have daysLeft = 0
  //   (b) when estimatedDays is set on a story with no daysLeft, daysLeft is
  //       initialized to match (i.e. "no progress made yet")
  //   (c) when estimatedDays is lowered below daysLeft, clamp daysLeft down
  //       so daysLeft <= estimatedDays always holds
  const effectiveStatus = patch.status ?? existing.status;
  const effectiveEstimatedDays =
    patch.estimatedDays !== undefined ? patch.estimatedDays : existing.estimatedDays;
  let effectiveDaysLeft =
    patch.daysLeft !== undefined ? patch.daysLeft : existing.daysLeft;
  if (effectiveStatus === "review" || effectiveStatus === "done") {
    effectiveDaysLeft = 0;
  } else if (effectiveDaysLeft == null && effectiveEstimatedDays != null) {
    effectiveDaysLeft = effectiveEstimatedDays;
  } else if (
    effectiveEstimatedDays != null &&
    effectiveDaysLeft != null &&
    effectiveDaysLeft > effectiveEstimatedDays
  ) {
    effectiveDaysLeft = effectiveEstimatedDays;
  }
  const persistDaysLeft = effectiveDaysLeft !== existing.daysLeft;
  if (persistDaysLeft && patch.daysLeft === undefined) changes.push("Days left adjusted");
  if (patch.title !== undefined && patch.title !== existing.title) changes.push("Title updated");
  if (patch.icon !== undefined && patch.icon !== existing.icon) changes.push("Icon updated");
  if (patch.description !== undefined && patch.description !== existing.description)
    changes.push("Description updated");
  if (patch.assignee !== undefined && patch.assignee !== existing.assignee) changes.push("Assignee updated");
  if (patch.labels !== undefined && patch.labels !== existing.labels) changes.push("Labels updated");
  if (patch.priority !== undefined && patch.priority !== existing.priority) changes.push("Priority updated");
  if (patch.sprint !== undefined && patch.sprint !== existing.sprint) {
    changes.push(patch.historyEntry ?? "Sprint updated");
  }
  if (patch.estimatedDays !== undefined && patch.estimatedDays !== existing.estimatedDays)
    changes.push("Estimated days updated");
  if (patch.daysLeft !== undefined && patch.daysLeft !== existing.daysLeft) changes.push("Days left updated");
  if (patch.status !== undefined && patch.status !== existing.status)
    changes.push(`Status changed to ${patch.status}`);
  if (patch.backlogOrder !== undefined && patch.backlogOrder !== existing.backlogOrder)
    changes.push("Kanban order updated");
  if (patch.epicId !== undefined && patch.epicId !== existing.epicId) changes.push("Parent epic changed");

  const targetEpicId = patch.epicId ?? existing.epicId;
  // Phase D: can't move a story to a soft-deleted epic.
  const targetEpic = await db.epic.findFirst({
    where: { id: targetEpicId, ...ACTIVE_RECORD },
    select: {
      planYear: true,
      planQuarter: true,
      planStartMonth: true,
      roadmapId: true,
      initiative: { select: { year: true, startMonth: true } },
    },
  });
  const nextPlanYear = targetEpic?.planYear ?? targetEpic?.initiative.year ?? existing.planYear ?? null;
  const nextPlanQuarter =
    targetEpic?.planQuarter ??
    quarterFromMonth(targetEpic?.planStartMonth ?? targetEpic?.initiative.startMonth ?? null) ??
    existing.planQuarter ??
    null;

  const story = await db.userStory.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.assignee !== undefined ? { assignee: patch.assignee } : {}),
      ...(patch.labels !== undefined ? { labels: patch.labels } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.sprint !== undefined ? { sprint: patch.sprint } : {}),
      ...(patch.estimatedDays !== undefined ? { estimatedDays: patch.estimatedDays } : {}),
      ...(persistDaysLeft ? { daysLeft: effectiveDaysLeft } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.backlogOrder !== undefined ? { backlogOrder: patch.backlogOrder } : {}),
      ...(patch.epicId !== undefined ? { epicId: patch.epicId } : {}),
      ...(targetEpic?.roadmapId != null ? { roadmapId: targetEpic.roadmapId } : {}),
      planYear: nextPlanYear,
      planQuarter: nextPlanQuarter,
      ...(changes.length > 0
        ? {
            history: {
              create: changes.map((entry) => ({ entry })),
            },
          }
        : {}),
    },
    include: {
      comments: {
        orderBy: { createdAt: "desc" },
      },
      history: {
        orderBy: { createdAt: "desc" },
      },
      snapshots: {
        orderBy: { snapshotDate: "asc" },
      },
    },
  });
  await captureStoryDailySnapshot(story);

  return NextResponse.json(story);
  } catch (err) {
    console.error("[PATCH /api/stories/[id]]", err);
    const message = err instanceof Error ? err.message : "Story update failed";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const existing = await db.userStory.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt != null) {
      return NextResponse.json({ message: "Story not found" }, { status: 404 });
    }
    // Phase D: soft delete — flip the timestamp instead of removing the row.
    // The story disappears from live views (which filter `deletedAt IS NULL`
    // via `ACTIVE_RECORD`) but its snapshots stay, so closed-period kanban /
    // capacity / charts still render the card.
    await db.userStory.update({ where: { id }, data: { deletedAt: new Date() } });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[DELETE /api/stories/[id]]", err);
    const message = err instanceof Error ? err.message : "Story delete failed";
    return NextResponse.json({ message }, { status: 500 });
  }
}
