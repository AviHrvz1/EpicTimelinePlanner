import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const epicTeamIdSchema = z.string().trim().min(1).max(64);

const updateEpicSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  icon: z.string().trim().min(1).max(4).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  assignee: z.string().trim().max(120).optional().nullable(),
  color: z.string().regex(/^#([0-9A-Fa-f]{6})$/).optional(),
  initiativeId: z.string().uuid().optional(),
  planSprint: z.union([z.literal(1), z.literal(2)]).optional().nullable(),
  planEndSprint: z.union([z.literal(1), z.literal(2)]).optional().nullable(),
  planStartMonth: z.number().int().min(1).max(12).optional().nullable(),
  planEndMonth: z.number().int().min(1).max(12).optional().nullable(),
  planStartDay: z.number().int().min(1).max(31).optional().nullable(),
  planEndDay: z.number().int().min(1).max(31).optional().nullable(),
  timelineRow: z.number().int().min(0).max(100000).optional(),
  team: epicTeamIdSchema.optional().nullable(),
  labels: z.string().trim().max(500).optional().nullable(),
  priority: z.string().trim().max(8).optional().nullable(),
  originalEstimateDays: z.number().int().min(0).max(5000).optional().nullable(),
});

function quarterFromMonth(month: number | null | undefined): number | null {
  if (month == null) return null;
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = await request.json();
    const parsed = updateEpicSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid update payload", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const existing = await db.epic.findUnique({
      where: { id },
      select: {
        title: true,
        icon: true,
        description: true,
        assignee: true,
        color: true,
        initiativeId: true,
        planYear: true,
        planQuarter: true,
        planSprint: true,
        planEndSprint: true,
        planStartMonth: true,
        planEndMonth: true,
        planStartDay: true,
        planEndDay: true,
        timelineRow: true,
        team: true,
        labels: true,
        priority: true,
        originalEstimateDays: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ message: "Epic not found" }, { status: 404 });
    }

    const patch = parsed.data;
    const changes: string[] = [];
    if (patch.title !== undefined && patch.title !== existing.title) changes.push("Title updated");
    if (patch.icon !== undefined && patch.icon !== existing.icon) changes.push("Icon updated");
    if (patch.description !== undefined && patch.description !== existing.description)
      changes.push("Description updated");
    if (patch.assignee !== undefined && patch.assignee !== existing.assignee) changes.push("Assignee updated");
    if (patch.initiativeId !== undefined && patch.initiativeId !== existing.initiativeId)
      changes.push("Parent initiative changed");
    if (patch.planSprint !== undefined && patch.planSprint !== existing.planSprint)
      changes.push("Quarter plan sprint updated");
    if (patch.planEndSprint !== undefined && patch.planEndSprint !== existing.planEndSprint)
      changes.push("Quarter plan end sprint updated");
    if (patch.planStartMonth !== undefined && patch.planStartMonth !== existing.planStartMonth)
      changes.push("Quarter plan start month updated");
    if (patch.planEndMonth !== undefined && patch.planEndMonth !== existing.planEndMonth)
      changes.push("Quarter plan end month updated");
    if (patch.timelineRow !== undefined && patch.timelineRow !== existing.timelineRow)
      changes.push("Gantt row updated");
    if (patch.team !== undefined && patch.team !== existing.team) changes.push("Delivery team updated");
    if (patch.labels !== undefined && patch.labels !== existing.labels) changes.push("Labels updated");
    if (patch.priority !== undefined && patch.priority !== existing.priority) changes.push("Priority updated");
    if (patch.originalEstimateDays !== undefined && patch.originalEstimateDays !== existing.originalEstimateDays)
      changes.push("Original estimate updated");

    const nextInitiativeId = patch.initiativeId ?? existing.initiativeId;
    const initiative = await db.initiative.findUnique({
      where: { id: nextInitiativeId },
      select: { year: true, startMonth: true, color: true, roadmapId: true },
    });
    const nextPlanStartMonth =
      patch.planStartMonth !== undefined
        ? patch.planStartMonth
        : existing.planStartMonth ?? initiative?.startMonth ?? null;
    const nextPlanYear = initiative?.year ?? existing.planYear ?? null;
    const nextPlanQuarter = quarterFromMonth(nextPlanStartMonth);

    const epic = await db.epic.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.assignee !== undefined ? { assignee: patch.assignee } : {}),
        ...(initiative?.color != null ? { color: initiative.color } : {}),
        ...(patch.initiativeId !== undefined ? { initiativeId: patch.initiativeId } : {}),
        ...(initiative?.roadmapId != null ? { roadmapId: initiative.roadmapId } : {}),
        ...(patch.planSprint !== undefined ? { planSprint: patch.planSprint } : {}),
        ...(patch.planEndSprint !== undefined ? { planEndSprint: patch.planEndSprint } : {}),
        ...(patch.planStartMonth !== undefined ? { planStartMonth: patch.planStartMonth } : {}),
        ...(patch.planEndMonth !== undefined ? { planEndMonth: patch.planEndMonth } : {}),
        ...(patch.planStartDay !== undefined ? { planStartDay: patch.planStartDay } : {}),
        ...(patch.planEndDay !== undefined ? { planEndDay: patch.planEndDay } : {}),
        ...(patch.timelineRow !== undefined ? { timelineRow: patch.timelineRow } : {}),
        ...(patch.team !== undefined ? { team: patch.team } : {}),
        ...(patch.labels !== undefined ? { labels: patch.labels } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.originalEstimateDays !== undefined ? { originalEstimateDays: patch.originalEstimateDays } : {}),
        planYear: nextPlanYear,
        planQuarter: nextPlanQuarter,
        ...(changes.length > 0
          ? { history: { create: changes.map((entry) => ({ entry })) } }
          : {}),
      },
      include: {
        comments: { orderBy: { createdAt: "desc" } },
        history: { orderBy: { createdAt: "desc" } },
        userStories: {
          orderBy: [{ backlogOrder: "asc" }, { createdAt: "asc" }],
          include: {
            comments: { orderBy: { createdAt: "desc" } },
            history: { orderBy: { createdAt: "desc" } },
          },
        },
      },
    });

    return NextResponse.json(epic);
  } catch (error) {
    console.error("[PATCH /api/epics/[id]]", error);
    const message = error instanceof Error ? error.message : "Failed to update epic";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  await db.epic.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
