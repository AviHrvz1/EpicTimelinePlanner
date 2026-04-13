import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const createStorySchema = z.object({
  title: z.string().trim().min(2).max(160),
  icon: z.string().trim().min(1).max(4).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  assignee: z.string().trim().max(120).optional().nullable(),
  sprint: z.number().int().min(1).max(2).optional().nullable(),
  estimatedDays: z.number().int().min(0).max(3650).optional().nullable(),
  daysLeft: z.number().int().min(0).max(3650).optional().nullable(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const payload = await request.json();
  const parsed = createStorySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid story payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const story = await db.userStory.create({
    data: {
      title: parsed.data.title,
      icon: parsed.data.icon ?? "📄",
      description: parsed.data.description ?? null,
      assignee: parsed.data.assignee ?? null,
      sprint: parsed.data.sprint ?? null,
      estimatedDays: parsed.data.estimatedDays ?? null,
      daysLeft: parsed.data.daysLeft ?? null,
      epicId: id,
      history: {
        create: {
          entry: "Story created",
        },
      },
    },
  });

  return NextResponse.json(story, { status: 201 });
}
