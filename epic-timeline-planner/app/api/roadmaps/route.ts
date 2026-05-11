import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const createRoadmapSchema = z.object({
  name: z.string().trim().min(1).max(120),
  years: z.array(z.number().int().min(2000).max(2100)).min(1),
});

export async function GET() {
  const roadmaps = await db.roadmap.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { initiatives: true } } },
  });
  return NextResponse.json(
    roadmaps.map((r) => ({
      id: r.id,
      name: r.name,
      years: JSON.parse(r.years) as number[],
      initiativeCount: r._count.initiatives,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  );
}

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const parsed = createRoadmapSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid roadmap payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  const years = [...new Set(parsed.data.years)].sort((a, b) => a - b);
  const roadmap = await db.roadmap.create({
    data: { name: parsed.data.name, years: JSON.stringify(years) },
  });
  return NextResponse.json({ ...roadmap, years }, { status: 201 });
}
