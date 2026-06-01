import { InitiativeStatus } from "@/lib/generated/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db, ACTIVE_RECORD } from "@/lib/db";

const DEFAULT_YEAR = new Date().getFullYear();
const DEFAULT_ROADMAP_ID = "default-roadmap-0000-0000-000000000001";

function buildInitiativeInclude(includeDeleted: boolean) {
  // Phase D: by default filter out soft-deleted rows so live consumers
  // (backlog, current sprint kanban, current capacity panels) never see
  // deleted stories/epics. The timeline view opts in via `includeDeleted=1`
  // because its closed-period scope expansion needs the rows to render
  // snapshot data on closed kanban / capacity / charts.
  const userStoriesFilter = includeDeleted ? {} : { where: ACTIVE_RECORD };
  const epicsFilter = includeDeleted ? {} : { where: ACTIVE_RECORD };
  return {
    comments: { orderBy: { createdAt: "desc" as const } },
    history: { orderBy: { createdAt: "desc" as const } },
    epics: {
      ...epicsFilter,
      orderBy: { createdAt: "asc" as const },
      include: {
        comments: { orderBy: { createdAt: "desc" as const } },
        history: { orderBy: { createdAt: "desc" as const } },
        userStories: {
          ...userStoriesFilter,
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
}

/**
 * Slim include used by `?slim=1` requests (backlog workspace). Drops the
 * heavy `snapshots`/`comments`/`history` trees that the backlog table
 * doesn't display — for the demo dataset of 500 stories × ~30 daily
 * snapshots each, this cuts the response payload from megabytes to ~100KB
 * and the server-side query from ~500-900ms down to ~50ms.
 */
function buildInitiativeIncludeSlim(includeDeleted: boolean) {
  const filter = includeDeleted ? {} : { where: ACTIVE_RECORD };
  return {
    epics: {
      ...filter,
      orderBy: { createdAt: "asc" as const },
      include: {
        userStories: {
          ...filter,
          orderBy: [{ backlogOrder: "asc" as const }, { createdAt: "asc" as const }],
        },
      },
    },
  };
}

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
  // `year=all` drops the year filter — needed by the Backlog workspace,
  // which groups by year client-side and must surface initiatives from any
  // year (otherwise a roadmap with years [2027] looks empty while
  // selectedYear is still 2026).
  const yearParam = request.nextUrl.searchParams.get("year");
  const allYears = yearParam === "all";
  const year = allYears ? undefined : (Number(yearParam) || DEFAULT_YEAR);
  const roadmapIdParam = request.nextUrl.searchParams.get("roadmapId");
  const allRoadmaps = roadmapIdParam === "all";
  const roadmapId = allRoadmaps ? undefined : (roadmapIdParam || DEFAULT_ROADMAP_ID);
  const slim = request.nextUrl.searchParams.get("slim") === "1";
  // Phase D: timeline opts in via `?includeDeleted=1` so closed-period
  // scope expansion can render snapshot data for rows that have since
  // been soft-deleted. Backlog + live consumers leave it absent and get
  // only active rows.
  const includeDeleted = request.nextUrl.searchParams.get("includeDeleted") === "1";
  const initiatives = await db.initiative.findMany({
    where: {
      ...(year !== undefined ? { year } : {}),
      ...(roadmapId ? { roadmapId } : {}),
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: slim ? buildInitiativeIncludeSlim(includeDeleted) : buildInitiativeInclude(includeDeleted),
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
