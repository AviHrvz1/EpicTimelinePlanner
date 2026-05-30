import { db } from "@/lib/db";
import type { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";

import { PortfolioInsightsView } from "./portfolio-insights-view";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function quarterFromMonth(month: number): 1 | 2 | 3 | 4 {
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

function monthsForQuarter(q: 1 | 2 | 3 | 4): number[] {
  return [q * 3 - 2, q * 3 - 1, q * 3];
}

/**
 * Roadmap-wide insights — same MonthAnalytics surface as the per-epic /
 * per-initiative page, but rendered against every initiative in the year
 * with no scope pre-selected so the user lands on a true portfolio view.
 */
export default async function PortfolioInsightsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const yearRaw = typeof params.year === "string" ? Number(params.year) : NaN;
  const year = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();

  // Match the planner's default roadmap (most-recently-updated) so the
  // initiatives surfaced here mirror what the user just saw on the Gantt.
  const dbRoadmaps = await db.roadmap.findMany({ orderBy: { updatedAt: "desc" } });
  const roadmapId = typeof params.roadmapId === "string"
    ? params.roadmapId
    : dbRoadmaps[0]?.id ?? null;

  const rawInitiatives = roadmapId
    ? await db.initiative.findMany({
        where: { roadmapId, year },
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
      })
    : [];

  const initiatives: InitiativeItem[] = rawInitiatives.map((initiative) => ({
    id: initiative.id,
    title: initiative.title,
    icon: initiative.icon ?? "🎯",
    description: initiative.description,
    assignee: initiative.assignee,
    color: initiative.color,
    status: initiative.status as InitiativeItem["status"],
    startMonth: initiative.startMonth,
    endMonth: initiative.endMonth,
    startYearSprint: null,
    endYearSprint: null,
    timelineRow: 0,
    year: initiative.year,
    roadmapId: initiative.roadmapId ?? null,
    team: initiative.team ?? null,
    labels: initiative.labels ?? null,
    createdAt: initiative.createdAt.toISOString(),
    updatedAt: initiative.updatedAt.toISOString(),
    comments: initiative.comments.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.author,
      initiativeId: c.initiativeId,
      createdAt: c.createdAt.toISOString(),
    })),
    history: initiative.history.map((h) => ({
      id: h.id,
      entry: h.entry,
      initiativeId: h.initiativeId,
      createdAt: h.createdAt.toISOString(),
    })),
    epics: initiative.epics.map((e): EpicItem => ({
      id: e.id,
      title: e.title,
      icon: e.icon ?? "📁",
      description: e.description,
      assignee: e.assignee,
      color: e.color,
      team: e.team,
      labels: e.labels ?? null,
      priority: e.priority ?? null,
      originalEstimateDays: e.originalEstimateDays,
      planStartMonth: e.planStartMonth,
      planEndMonth: e.planEndMonth,
      planYear: e.planYear,
      planQuarter: e.planQuarter,
      planSprint: null,
      planEndSprint: null,
      planStartDay: null,
      planEndDay: null,
      timelineRow: 0,
      initiativeId: e.initiativeId,
      roadmapId: e.roadmapId ?? null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      comments: e.comments.map((c) => ({
        id: c.id,
        body: c.body,
        author: c.author,
        epicId: c.epicId,
        createdAt: c.createdAt.toISOString(),
      })),
      history: e.history.map((h) => ({
        id: h.id,
        entry: h.entry,
        epicId: h.epicId,
        createdAt: h.createdAt.toISOString(),
      })),
      userStories: e.userStories.map((s): UserStoryItem => ({
        id: s.id,
        title: s.title,
        icon: s.icon ?? "📄",
        description: s.description,
        assignee: s.assignee,
        labels: s.labels,
        priority: s.priority,
        roadmapId: s.roadmapId ?? null,
        planYear: s.planYear,
        planQuarter: s.planQuarter,
        sprint: s.sprint,
        estimatedDays: s.estimatedDays,
        daysLeft: s.daysLeft,
        status: s.status as UserStoryItem["status"],
        epicId: s.epicId,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        comments: s.comments.map((c) => ({
          id: c.id,
          body: c.body,
          author: c.author,
          storyId: c.storyId,
          createdAt: c.createdAt.toISOString(),
        })),
        history: s.history.map((h) => ({
          id: h.id,
          entry: h.entry,
          storyId: h.storyId,
          createdAt: h.createdAt.toISOString(),
        })),
        snapshots: s.snapshots.map((snap) => ({
          id: snap.id,
          storyId: snap.storyId,
          snapshotDate: snap.snapshotDate.toISOString(),
          status: snap.status as UserStoryItem["status"],
          sprint: snap.sprint,
          estimatedDays: snap.estimatedDays,
          daysLeft: snap.daysLeft,
          assignee: snap.assignee,
          createdAt: snap.createdAt.toISOString(),
        })),
      })),
    })),
  }));

  const today = new Date();
  const insightsMonth = today.getFullYear() === year ? today.getMonth() + 1 : 1;
  const quarter = quarterFromMonth(insightsMonth);
  const periodMonths = monthsForQuarter(quarter);

  return (
    <PortfolioInsightsView
      initiatives={initiatives}
      quarter={quarter}
      month={insightsMonth}
      periodMonths={periodMonths}
      planYear={year}
    />
  );
}
