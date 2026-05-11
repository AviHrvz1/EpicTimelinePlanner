import { InitiativeStatus } from "@/lib/generated/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const DEFAULT_YEAR = new Date().getFullYear();
const DEFAULT_ROADMAP_ID = "default-roadmap-0000-0000-000000000001";

const INITIATIVE_INCLUDE = {
  comments: { orderBy: { createdAt: "desc" as const } },
  history: { orderBy: { createdAt: "desc" as const } },
  epics: {
    orderBy: { createdAt: "asc" as const },
    include: {
      comments: { orderBy: { createdAt: "desc" as const } },
      history: { orderBy: { createdAt: "desc" as const } },
      userStories: {
        orderBy: [{ backlogOrder: "asc" as const }, { createdAt: "asc" as const }],
        include: {
          comments: { orderBy: { createdAt: "desc" as const } },
          history: { orderBy: { createdAt: "desc" as const } },
          snapshots: { orderBy: { snapshotDate: "asc" as const } },
        },
      },
    },
  },
};

const createInitiativeSchema = z.object({
  title: z.string().trim().min(2).max(120),
  icon: z.string().trim().max(4).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  assignee: z.string().trim().max(120).optional().nullable(),
  color: z.string().regex(/^#([0-9A-Fa-f]{6})$/).optional(),
  startMonth: z.number().int().min(1).max(12).optional().nullable(),
  endMonth: z.number().int().min(1).max(12).optional().nullable(),
  year: z.number().int().min(2000).max(2100).optional(),
  roadmapId: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year")) || DEFAULT_YEAR;
  const roadmapIdParam = request.nextUrl.searchParams.get("roadmapId");
  const allRoadmaps = roadmapIdParam === "all";
  const roadmapId = allRoadmaps ? undefined : (roadmapIdParam || DEFAULT_ROADMAP_ID);
  const initiatives = await db.initiative.findMany({
    where: { year, ...(roadmapId ? { roadmapId } : {}) },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: INITIATIVE_INCLUDE,
  });
  return NextResponse.json(initiatives);
}

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const parsed = createInitiativeSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid initiative payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const roadmapId = parsed.data.roadmapId ?? DEFAULT_ROADMAP_ID;

  const initiative = await db.initiative.create({
    data: {
      title: parsed.data.title,
      icon: parsed.data.icon ?? "",
      description: parsed.data.description || null,
      assignee: parsed.data.assignee || null,
      color: parsed.data.color ?? "#3B82F6",
      startMonth: parsed.data.startMonth ?? null,
      endMonth: parsed.data.endMonth ?? null,
      year: parsed.data.year ?? DEFAULT_YEAR,
      roadmapId,
      status: InitiativeStatus.backlog,
      history: { create: { entry: "Initiative created" } },
    },
  });

  return NextResponse.json(initiative, { status: 201 });
}
