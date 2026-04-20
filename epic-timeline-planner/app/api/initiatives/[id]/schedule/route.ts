import { InitiativeStatus } from "@/lib/generated/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { clampYearSprint, monthRangeFromYearSprintRange, yearSprintRangeFromMonthRange } from "@/lib/year-sprint";

const scheduleSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  startMonth: z.number().int().min(1).max(12).nullable(),
  endMonth: z.number().int().min(1).max(12).nullable(),
  startYearSprint: z.number().int().min(1).max(24).optional(),
  endYearSprint: z.number().int().min(1).max(24).optional(),
  /** When first scheduling, insert at this Gantt row (0-based) and shift other scheduled rows down. */
  timelineRow: z.number().int().min(0).max(99).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = await request.json();
    const parsed = scheduleSchema.safeParse(payload);

    if (!parsed.success) {
      console.warn("[PATCH schedule] validation failed", id, parsed.error.flatten());
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
        startYearSprint: null,
        endYearSprint: null,
        status: InitiativeStatus.backlog,
        timelineRow: 0,
      },
    });

    return NextResponse.json(initiative);
  }

  const sOpt = parsed.data.startYearSprint;
  const eOpt = parsed.data.endYearSprint;
  if ((sOpt !== undefined) !== (eOpt !== undefined)) {
    return NextResponse.json(
      { message: "startYearSprint and endYearSprint must both be provided or both omitted" },
      { status: 400 },
    );
  }

  if (sOpt === undefined && parsed.data.startMonth > parsed.data.endMonth) {
    return NextResponse.json(
      { message: "startMonth must be less than or equal to endMonth" },
      { status: 400 },
    );
  }

  let finalStartMonth = parsed.data.startMonth;
  let finalEndMonth = parsed.data.endMonth;
  let finalStartYS: number;
  let finalEndYS: number;

  if (sOpt !== undefined && eOpt !== undefined) {
    const a = clampYearSprint(sOpt);
    const b = clampYearSprint(eOpt);
    if (a > b) {
      return NextResponse.json(
        { message: "startYearSprint must be less than or equal to endYearSprint" },
        { status: 400 },
      );
    }
    finalStartYS = a;
    finalEndYS = b;
    const envelope = monthRangeFromYearSprintRange(finalStartYS, finalEndYS);
    finalStartMonth = envelope.startMonth;
    finalEndMonth = envelope.endMonth;
  } else {
    const derived = yearSprintRangeFromMonthRange(parsed.data.startMonth, parsed.data.endMonth);
    finalStartYS = derived.startYearSprint;
    finalEndYS = derived.endYearSprint;
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
        startMonth: finalStartMonth,
        endMonth: finalEndMonth,
        startYearSprint: finalStartYS,
        endYearSprint: finalEndYS,
        status: InitiativeStatus.scheduled,
        ...(nextTimelineRow !== undefined ? { timelineRow: nextTimelineRow } : {}),
      },
    });
  });

    return NextResponse.json(initiative);
  } catch (err) {
    console.error("[PATCH schedule] unhandled error", err);
    const message = err instanceof Error ? err.message : "Schedule update failed";
    return NextResponse.json({ message }, { status: 500 });
  }
}
