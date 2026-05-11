import { EpicPlannerApp } from "@/components/epic-planner-app";
import { db } from "@/lib/db";
import type { RoadmapItem } from "@/lib/types";

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
        orderBy: { createdAt: "asc" as const },
        include: {
          comments: { orderBy: { createdAt: "desc" as const } },
          history: { orderBy: { createdAt: "desc" as const } },
          snapshots: { orderBy: { snapshotDate: "asc" as const } },
        },
      },
    },
  },
};

export default async function Home() {
  const year = new Date().getFullYear();

  const dbRoadmaps = await db.roadmap.findMany({ orderBy: { updatedAt: "desc" } });
  const roadmaps: RoadmapItem[] = dbRoadmaps.map((r) => ({
    id: r.id,
    name: r.name,
    years: JSON.parse(r.years) as number[],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  // Default roadmap: most recently updated (first after orderBy updatedAt desc), fallback to hardcoded default id
  const defaultRoadmap = roadmaps[0] ?? null;
  const defaultRoadmapId = defaultRoadmap?.id ?? DEFAULT_ROADMAP_ID;
  // Default year: current year if in the roadmap's years list, else first year in list
  const defaultYear =
    defaultRoadmap?.years.includes(year) ? year : (defaultRoadmap?.years[0] ?? year);

  const initiatives = await db.initiative.findMany({
    where: { roadmapId: defaultRoadmapId, year: defaultYear },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: INITIATIVE_INCLUDE,
  });

  return (
    <EpicPlannerApp
      initialInitiatives={initiatives}
      year={defaultYear}
      initialRoadmaps={roadmaps}
      initialRoadmapId={defaultRoadmapId}
    />
  );
}
