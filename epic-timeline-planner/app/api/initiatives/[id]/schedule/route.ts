import { InitiativeStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const scheduleSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  startMonth: z.number().int().min(1).max(12).nullable(),
  endMonth: z.number().int().min(1).max(12).nullable(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const payload = await request.json();
  const parsed = scheduleSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid schedule payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.startMonth === null || parsed.data.endMonth === null) {
    if (!(parsed.data.startMonth === null && parsed.data.endMonth === null)) {
      return NextResponse.json(
        { message: "startMonth and endMonth must both be null or both be numbers" },
        { status: 400 },
      );
    }

    const initiative = await db.initiative.update({
      where: { id },
      data: {
        year: parsed.data.year,
        startMonth: null,
        endMonth: null,
        status: InitiativeStatus.backlog,
      },
    });

    return NextResponse.json(initiative);
  }

  if (parsed.data.startMonth > parsed.data.endMonth) {
    return NextResponse.json(
      { message: "startMonth must be less than or equal to endMonth" },
      { status: 400 },
    );
  }

  const initiative = await db.initiative.update({
    where: { id },
    data: {
      year: parsed.data.year,
      startMonth: parsed.data.startMonth,
      endMonth: parsed.data.endMonth,
      status: InitiativeStatus.scheduled,
    },
  });

  return NextResponse.json(initiative);
}
