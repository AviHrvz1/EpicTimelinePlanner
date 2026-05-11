import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const epicTeamIdSchema = z.enum(["platform", "experience", "data", "mobile", "growth"]);

const createEpicSchema = z.object({
  title: z.string().trim().min(2).max(120),
  icon: z.string().trim().min(1).max(4).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  assignee: z.string().trim().max(120).optional().nullable(),
  color: z.string().regex(/^#([0-9A-Fa-f]{6})$/).optional(),
  team: epicTeamIdSchema.optional().nullable(),
  originalEstimateDays: z.number().int().min(0).max(5000).optional().nullable(),
  planStartMonth: z.number().int().min(1).max(12).optional().nullable(),
  planEndMonth: z.number().int().min(1).max(12).optional().nullable(),
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
  const parsed = createEpicSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid epic payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const initiative = await db.initiative.findUnique({
    where: { id },
    select: { year: true, startMonth: true, color: true, roadmapId: true },
  });
  if (!initiative) {
    return NextResponse.json({ message: "Initiative not found" }, { status: 404 });
  }

  const planStartMonth = parsed.data.planStartMonth ?? null;
  const planEndMonth = parsed.data.planEndMonth ?? planStartMonth;
  const planQuarterSeed = planStartMonth ?? initiative.startMonth;
  const epic = await db.epic.create({
    data: {
      title: parsed.data.title,
      icon: parsed.data.icon ?? "📁",
      description: parsed.data.description || null,
      assignee: parsed.data.assignee || null,
      color: initiative.color,
      team: parsed.data.team ?? null,
      originalEstimateDays: parsed.data.originalEstimateDays ?? null,
      initiativeId: id,
      roadmapId: initiative.roadmapId,
      planYear: initiative.year,
      planQuarter: quarterFromMonth(planQuarterSeed),
      planStartMonth,
      planEndMonth,
      planEndSprint: 2,
      timelineRow: 0,
      history: { create: { entry: "Epic created" } },
    },
  });

  return NextResponse.json(epic, { status: 201 });
}
