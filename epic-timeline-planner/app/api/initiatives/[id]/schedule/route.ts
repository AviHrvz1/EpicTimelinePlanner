import { InitiativeStatus } from "@/lib/generated/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const scheduleSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  startMonth: z.number().int().min(1).max(12).nullable(),
  endMonth: z.number().int().min(1).max(12).nullable(),
  /** When first scheduling, insert at this Gantt row (0-based) and shift other scheduled rows down. */
  timelineRow: z.number().int().min(0).max(99).optional(),
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
        timelineRow: 0,
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

  const existing = await db.initiative.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ message: "Initiative not found" }, { status: 404 });
  }

  const isFirstSchedule = existing.status === InitiativeStatus.backlog;

  const initiative = await db.$transaction(async (tx) => {
    let nextTimelineRow: number | undefined;
    if (isFirstSchedule) {
      if (parsed.data.timelineRow !== undefined) {
        const L = parsed.data.timelineRow;
        const victims = await tx.initiative.findMany({
          where: {
            year: parsed.data.year,
            status: InitiativeStatus.scheduled,
            timelineRow: { gte: L },
            NOT: { id },
          },
          orderBy: { timelineRow: "desc" },
          select: { id: true, timelineRow: true },
        });
        for (const v of victims) {
          await tx.initiative.update({
            where: { id: v.id },
            data: { timelineRow: v.timelineRow + 1 },
          });
        }
        nextTimelineRow = L;
      } else {
        const maxAgg = await tx.initiative.aggregate({
          where: { year: parsed.data.year, status: InitiativeStatus.scheduled },
          _max: { timelineRow: true },
        });
        nextTimelineRow = (maxAgg._max.timelineRow ?? -1) + 1;
      }
    }

    return tx.initiative.update({
      where: { id },
      data: {
        year: parsed.data.year,
        startMonth: parsed.data.startMonth,
        endMonth: parsed.data.endMonth,
        status: InitiativeStatus.scheduled,
        ...(nextTimelineRow !== undefined ? { timelineRow: nextTimelineRow } : {}),
      },
    });
  });

  return NextResponse.json(initiative);
}
