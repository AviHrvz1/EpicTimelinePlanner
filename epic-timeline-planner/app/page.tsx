import { EpicPlannerApp } from "@/components/epic-planner-app";
import { db } from "@/lib/db";

export default async function Home() {
  const year = new Date().getFullYear();
  const initiatives = await db.initiative.findMany({
    where: { year },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: {
      comments: { orderBy: { createdAt: "desc" } },
      history: { orderBy: { createdAt: "desc" } },
      epics: {
        orderBy: { createdAt: "asc" },
        include: {
          comments: { orderBy: { createdAt: "desc" } },
          history: { orderBy: { createdAt: "desc" } },
          userStories: {
            orderBy: { createdAt: "asc" },
            include: {
              comments: { orderBy: { createdAt: "desc" } },
              history: { orderBy: { createdAt: "desc" } },
              snapshots: { orderBy: { snapshotDate: "asc" } },
            },
          },
        },
      },
    },
  });

  return <EpicPlannerApp initialInitiatives={initiatives} year={year} />;
}
