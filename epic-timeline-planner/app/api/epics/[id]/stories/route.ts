import { NextRequest, NextResponse } from "next/server";
import { StoryStatus } from "@/lib/generated/prisma";
import { z } from "zod";

import { ACTIVE_RECORD, db } from "@/lib/db";
import { getOptionalUser } from "@/lib/auth-helpers";
import { captureStoryDailySnapshot } from "@/lib/story-daily-snapshots";
import { YEAR_SPRINT_MAX, YEAR_SPRINT_MIN } from "@/lib/year-sprint";

const createStorySchema = z.object({
  title: z.string().trim().min(2).max(160),
  icon: z.string().trim().min(1).max(4).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  assignee: z.string().trim().max(120).optional().nullable(),
  /** Delivery team override (slug). NULL = inherit parent epic.team. */
  team: z.string().trim().max(60).optional().nullable(),
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

  // Phase D: can't add a new story under a soft-deleted epic.
  const epic = await db.epic.findFirst({
    where: { id, ...ACTIVE_RECORD },
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

  // Same invariants as the PATCH route — see app/api/stories/[id]/route.ts
  // for the full explanation. Done stories have daysLeft=0 (review stories
  // keep their remaining estimate because shipping/QA work is outstanding);
  // an unset daysLeft initializes to estimatedDays so health math has a
  // value to read; daysLeft is clamped not to exceed estimatedDays.
  const createStatus = parsed.data.status ?? StoryStatus.todo;
  const createEstimatedDays = parsed.data.estimatedDays ?? null;
  let createDaysLeft = parsed.data.daysLeft ?? null;
  if (createStatus === "done") {
    createDaysLeft = 0;
  } else if (createDaysLeft == null && createEstimatedDays != null) {
    createDaysLeft = createEstimatedDays;
  } else if (
    createEstimatedDays != null &&
    createDaysLeft != null &&
    createDaysLeft > createEstimatedDays
  ) {
    createDaysLeft = createEstimatedDays;
  }

  const sessionUser = await getOptionalUser(request);
  const userName = sessionUser?.name ?? sessionUser?.email ?? null;

  const story = await db.userStory.create({
    data: {
      title: parsed.data.title,
      icon: parsed.data.icon ?? "📄",
      description: parsed.data.description ?? null,
      assignee: parsed.data.assignee ?? null,
      team: parsed.data.team ?? null,
      labels: parsed.data.labels ?? null,
      priority: parsed.data.priority ?? null,
      sprint: parsed.data.sprint ?? null,
      estimatedDays: createEstimatedDays,
      daysLeft: createDaysLeft,
      status: createStatus,
      epicId: id,
      roadmapId: epic.roadmapId,
      planYear: epic.initiative.year,
      planQuarter: epic.planQuarter ?? quarterFromMonth(epic.planStartMonth ?? epic.initiative.startMonth),
      history: {
        create: {
          entry: "Story created",
          userName,
        },
      },
    },
  });
  await captureStoryDailySnapshot(story);

  return NextResponse.json(story, { status: 201 });
}
