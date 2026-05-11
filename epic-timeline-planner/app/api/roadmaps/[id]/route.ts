import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const updateRoadmapSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  addYear: z.number().int().min(2000).max(2100).optional(),
  removeYear: z.number().int().min(2000).max(2100).optional(),
});

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const roadmap = await db.roadmap.findUnique({ where: { id } });
  if (!roadmap) return NextResponse.json({ message: "Roadmap not found" }, { status: 404 });
  return NextResponse.json({ ...roadmap, years: JSON.parse(roadmap.years) as number[] });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = await request.json();
  const parsed = updateRoadmapSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const roadmap = await db.roadmap.findUnique({ where: { id } });
  if (!roadmap) return NextResponse.json({ message: "Roadmap not found" }, { status: 404 });

  let years = JSON.parse(roadmap.years) as number[];

  if (parsed.data.removeYear != null) {
    const yr = parsed.data.removeYear;
    // Block removal if any initiative is in this year
    const count = await db.initiative.count({ where: { roadmapId: id, year: yr } });
    if (count > 0) {
      return NextResponse.json(
        { message: `Cannot remove year ${yr}: ${count} initiative(s) exist in this year.`, blockedYear: yr },
        { status: 409 },
      );
    }
    years = years.filter((y) => y !== yr);
  }

  if (parsed.data.addYear != null) {
    const yr = parsed.data.addYear;
    if (!years.includes(yr)) years = [...years, yr].sort((a, b) => a - b);
  }

  const updated = await db.roadmap.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      years: JSON.stringify(years),
    },
  });

  return NextResponse.json({ ...updated, years: JSON.parse(updated.years) as number[] });
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const roadmap = await db.roadmap.findUnique({ where: { id } });
  if (!roadmap) return NextResponse.json({ message: "Roadmap not found" }, { status: 404 });

  // Gather counts for confirmation (caller already confirmed; we just return them for record)
  const initiativeCount = await db.initiative.count({ where: { roadmapId: id } });
  const epicCount = await db.epic.count({ where: { roadmapId: id } });
  const storyCount = await db.userStory.count({ where: { roadmapId: id } });
  const snapshotCount = await db.storyDailySnapshot.count({
    where: { story: { epic: { initiative: { roadmapId: id } } } },
  });

  // Cascade delete: stories and snapshots are deleted via Prisma onDelete:Cascade on Epic→Initiative
  // We delete all initiatives; epics/stories/snapshots/comments/history cascade automatically
  await db.$transaction(async (tx) => {
    await tx.initiative.deleteMany({ where: { roadmapId: id } });
    await tx.roadmap.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true, deleted: { initiativeCount, epicCount, storyCount, snapshotCount } });
}

/** Pre-flight: return counts without deleting, so UI can show confirmation. */
export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = (await context.params) as { id: string };
  // Route: POST /api/roadmaps/[id]/counts — but since we can't nest further easily, use query param
  const roadmap = await db.roadmap.findUnique({ where: { id } });
  if (!roadmap) return NextResponse.json({ message: "Roadmap not found" }, { status: 404 });

  const initiativeCount = await db.initiative.count({ where: { roadmapId: id } });
  const epicCount = await db.epic.count({ where: { roadmapId: id } });
  const storyCount = await db.userStory.count({ where: { roadmapId: id } });
  const snapshotCount = await db.storyDailySnapshot.count({
    where: { story: { epic: { initiative: { roadmapId: id } } } },
  });

  return NextResponse.json({ initiativeCount, epicCount, storyCount, snapshotCount });
}
