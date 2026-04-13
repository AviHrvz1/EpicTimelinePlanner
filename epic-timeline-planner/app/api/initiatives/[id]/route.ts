import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const updateInitiativeSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  icon: z.string().trim().min(1).max(4).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  assignee: z.string().trim().max(120).optional().nullable(),
  color: z.string().regex(/^#([0-9A-Fa-f]{6})$/).optional(),
  startMonth: z.number().int().min(1).max(12).optional().nullable(),
  endMonth: z.number().int().min(1).max(12).optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const payload = await request.json();
  const parsed = updateInitiativeSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid update payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const existing = await db.initiative.findUnique({
    where: { id },
    select: {
      title: true,
      icon: true,
      description: true,
      assignee: true,
      color: true,
      startMonth: true,
      endMonth: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ message: "Initiative not found" }, { status: 404 });
  }

  const patch = parsed.data;
  const changes: string[] = [];
  if (patch.title !== undefined && patch.title !== existing.title) changes.push("Title updated");
  if (patch.icon !== undefined && patch.icon !== existing.icon) changes.push("Icon updated");
  if (patch.description !== undefined && patch.description !== existing.description)
    changes.push("Description updated");
  if (patch.assignee !== undefined && patch.assignee !== existing.assignee) changes.push("Assignee updated");
  if (patch.color !== undefined && patch.color !== existing.color) changes.push("Color updated");
  if (patch.startMonth !== undefined && patch.startMonth !== existing.startMonth)
    changes.push("Assigned month updated");
  if (patch.endMonth !== undefined && patch.endMonth !== existing.endMonth) changes.push("End month updated");

  const initiative = await db.initiative.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.assignee !== undefined ? { assignee: patch.assignee } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.startMonth !== undefined ? { startMonth: patch.startMonth } : {}),
      ...(patch.endMonth !== undefined ? { endMonth: patch.endMonth } : {}),
      ...(changes.length > 0
        ? { history: { create: changes.map((entry) => ({ entry })) } }
        : {}),
    },
    include: {
      comments: { orderBy: { createdAt: "desc" } },
      history: { orderBy: { createdAt: "desc" } },
      epics: {
        orderBy: { createdAt: "asc" },
        include: {
          comments: { orderBy: { createdAt: "desc" } },
          history: { orderBy: { createdAt: "desc" } },
          userStories: {
            orderBy: { createdAt: "asc" },
            include: {
              comments: { orderBy: { createdAt: "desc" } },
              history: { orderBy: { createdAt: "desc" } },
            },
          },
        },
      },
    },
  });

  return NextResponse.json(initiative);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  await db.initiative.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
