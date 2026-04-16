import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const createEpicSchema = z.object({
  title: z.string().trim().min(2).max(120),
  icon: z.string().trim().min(1).max(4).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  assignee: z.string().trim().max(120).optional().nullable(),
  color: z.string().regex(/^#([0-9A-Fa-f]{6})$/).optional(),
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
    select: { year: true, startMonth: true },
  });
  if (!initiative) {
    return NextResponse.json({ message: "Initiative not found" }, { status: 404 });
  }

  const epic = await db.epic.create({
    data: {
      title: parsed.data.title,
      icon: parsed.data.icon ?? "📁",
      description: parsed.data.description || null,
      assignee: parsed.data.assignee || null,
      color: parsed.data.color ?? "#3B82F6",
      initiativeId: id,
      planYear: initiative.year,
      planQuarter: quarterFromMonth(initiative.startMonth),
      history: { create: { entry: "Epic created" } },
    },
  });

  return NextResponse.json(epic, { status: 201 });
}
