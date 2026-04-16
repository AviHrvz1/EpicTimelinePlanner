import { NextRequest, NextResponse } from "next/server";
import { StoryStatus } from "@/lib/generated/prisma";
import { z } from "zod";

import { db } from "@/lib/db";

const updateStorySchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  icon: z.string().trim().min(1).max(4).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  assignee: z.string().trim().max(120).optional().nullable(),
  sprint: z.number().int().min(1).max(2).optional().nullable(),
  estimatedDays: z.number().int().min(0).max(3650).optional().nullable(),
  daysLeft: z.number().int().min(0).max(3650).optional().nullable(),
  status: z.nativeEnum(StoryStatus).optional(),
  epicId: z.string().uuid().optional(),
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
  const { id } = await context.params;
  const payload = await request.json();
  const parsed = updateStorySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid story update payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const existing = await db.userStory.findUnique({
    where: { id },
    select: {
      title: true,
      icon: true,
      description: true,
      assignee: true,
      sprint: true,
      estimatedDays: true,
      daysLeft: true,
      status: true,
      epicId: true,
      planYear: true,
      planQuarter: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ message: "Story not found" }, { status: 404 });
  }

  const changes: string[] = [];
  const patch = parsed.data;
  if (patch.title !== undefined && patch.title !== existing.title) changes.push("Title updated");
  if (patch.icon !== undefined && patch.icon !== existing.icon) changes.push("Icon updated");
  if (patch.description !== undefined && patch.description !== existing.description)
    changes.push("Description updated");
  if (patch.assignee !== undefined && patch.assignee !== existing.assignee) changes.push("Assignee updated");
  if (patch.sprint !== undefined && patch.sprint !== existing.sprint) changes.push("Sprint updated");
  if (patch.estimatedDays !== undefined && patch.estimatedDays !== existing.estimatedDays)
    changes.push("Estimated days updated");
  if (patch.daysLeft !== undefined && patch.daysLeft !== existing.daysLeft) changes.push("Days left updated");
  if (patch.status !== undefined && patch.status !== existing.status)
    changes.push(`Status changed to ${patch.status}`);
  if (patch.epicId !== undefined && patch.epicId !== existing.epicId) changes.push("Parent epic changed");

  const targetEpicId = patch.epicId ?? existing.epicId;
  const targetEpic = await db.epic.findUnique({
    where: { id: targetEpicId },
    select: {
      planYear: true,
      planQuarter: true,
      planStartMonth: true,
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
      ...(patch.sprint !== undefined ? { sprint: patch.sprint } : {}),
      ...(patch.estimatedDays !== undefined ? { estimatedDays: patch.estimatedDays } : {}),
      ...(patch.daysLeft !== undefined ? { daysLeft: patch.daysLeft } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.epicId !== undefined ? { epicId: patch.epicId } : {}),
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
    },
  });

  return NextResponse.json(story);
}
