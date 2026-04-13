import { NextRequest, NextResponse } from "next/server";
import { StoryStatus } from "@prisma/client";
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
