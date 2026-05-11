import { NextRequest, NextResponse } from "next/server";
import { StoryStatus } from "@/lib/generated/prisma";
import { z } from "zod";

import { db } from "@/lib/db";
import { captureStoryDailySnapshot } from "@/lib/story-daily-snapshots";
import { YEAR_SPRINT_MAX, YEAR_SPRINT_MIN } from "@/lib/year-sprint";

const createStorySchema = z.object({
  title: z.string().trim().min(2).max(160),
  icon: z.string().trim().min(1).max(4).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  assignee: z.string().trim().max(120).optional().nullable(),
  labels: z.string().trim().max(500).optional().nullable(),
  priority: z.string().trim().max(60).optional().nullable(),
  sprint: z.number().int().min(YEAR_SPRINT_MIN).max(YEAR_SPRINT_MAX).optional().nullable(),
  estimatedDays: z.number().int().min(0).max(3650).optional().nullable(),
  daysLeft: z.number().int().min(0).max(3650).optional().nullable(),
  status: z.nativeEnum(StoryStatus).optional(),
});

function quarterFromMonth(month: number | null | undefined): number | null {
  if (month == null) return null;
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

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

  const epic = await db.epic.findUnique({
    where: { id },
    select: {
      planQuarter: true,
      planStartMonth: true,
      roadmapId: true,
      initiative: { select: { year: true, startMonth: true } },
    },
  });
  if (!epic) {
    return NextResponse.json({ message: "Epic not found" }, { status: 404 });
  }

  const story = await db.userStory.create({
    data: {
      title: parsed.data.title,
      icon: parsed.data.icon ?? "📄",
      description: parsed.data.description ?? null,
      assignee: parsed.data.assignee ?? null,
      labels: parsed.data.labels ?? null,
      priority: parsed.data.priority ?? null,
      sprint: parsed.data.sprint ?? null,
      estimatedDays: parsed.data.estimatedDays ?? null,
      daysLeft: parsed.data.daysLeft ?? null,
      status: parsed.data.status ?? StoryStatus.todo,
      epicId: id,
      roadmapId: epic.roadmapId,
      planYear: epic.initiative.year,
      planQuarter: epic.planQuarter ?? quarterFromMonth(epic.planStartMonth ?? epic.initiative.startMonth),
      history: {
        create: {
          entry: "Story created",
        },
      },
    },
  });
  await captureStoryDailySnapshot(story);

  return NextResponse.json(story, { status: 201 });
}
