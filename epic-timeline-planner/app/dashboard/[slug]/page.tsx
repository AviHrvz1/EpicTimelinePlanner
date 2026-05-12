import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { DashboardPublicView } from "@/components/dashboard/dashboard-public-view";
import type { InitiativeItem } from "@/lib/types";

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

export default async function DashboardPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const dashboard = await db.dashboard.findFirst({
    where: { slug },
    include: { charts: { orderBy: { position: "asc" } } },
  });
  if (!dashboard) notFound();

  const initiatives = await db.initiative.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: INITIATIVE_INCLUDE,
  });

  const chartItems = dashboard.charts.map((c) => ({
    id: c.id,
    dashboardId: c.dashboardId,
    chartType: c.chartType as never,
    title: c.title,
    config: c.config,
    position: c.position,
    colSpan: c.colSpan as 1 | 2,
    rowSpan: c.rowSpan,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <DashboardPublicView
      slug={slug}
      name={dashboard.name}
      charts={chartItems}
      initiatives={initiatives as unknown as InitiativeItem[]}
    />
  );
}
