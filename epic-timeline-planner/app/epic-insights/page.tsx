import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { EpicInsightsView } from "./epic-insights-view";
import type { EpicItem, InitiativeItem, UserStoryItem } from "@/lib/types";

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

async function resolveEpicId(raw: string): Promise<string | null> {
  const match = raw.match(/^EPIC-(\d+)$/i);
  if (!match) return raw; // treat as raw UUID
  const targetIndex = parseInt(match[1], 10) - 1;
  if (targetIndex < 0) return null;

  const allEpics = await db.epic.findMany({
    select: { id: true, createdAt: true, title: true, initiative: { select: { createdAt: true, title: true } } },
  });

  allEpics.sort((a, b) => {
    const aIT = a.initiative ? new Date(a.initiative.createdAt).getTime() : 0;
    const bIT = b.initiative ? new Date(b.initiative.createdAt).getTime() : 0;
    if (aIT !== bIT) return aIT - bIT;
    const tc = (a.initiative?.title ?? "").localeCompare(b.initiative?.title ?? "");
    if (tc !== 0) return tc;
    const ec = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (ec !== 0) return ec;
    return a.title.localeCompare(b.title);
  });

  return allEpics[targetIndex]?.id ?? null;
}

async function resolveInitiativeId(raw: string): Promise<string | null> {
  const match = raw.match(/^INIT-(\d+)$/i);
  if (!match) return raw; // treat as raw UUID
  const targetIndex = parseInt(match[1], 10) - 1;
  if (targetIndex < 0) return null;
  // Match ordering used by the epic dialog when it builds INIT-XX display IDs:
  // sort by createdAt then title.
  const allInitiatives = await db.initiative.findMany({
    select: { id: true, createdAt: true, title: true },
  });
  allInitiatives.sort((a, b) => {
    const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (t !== 0) return t;
    return a.title.localeCompare(b.title);
  });
  return allInitiatives[targetIndex]?.id ?? null;
}

export default async function EpicInsightsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  // Initiative scope takes precedence — when present the view defaults the
  // Epic/Initiative Scope dropdown to that initiative and renders all of its
  // child epics (rather than zooming to a single one).
  const initiativeRaw = typeof params.initiativeDisplayId === "string" ? params.initiativeDisplayId
    : typeof params.initiativeId === "string" ? params.initiativeId
    : null;
  if (initiativeRaw) {
    return renderInitiativeScope(initiativeRaw);
  }

  const raw = typeof params.epicDisplayId === "string" ? params.epicDisplayId
    : typeof params.epicId === "string" ? params.epicId
    : null;
  if (!raw) notFound();

  const epicId = await resolveEpicId(raw);
  if (!epicId) notFound();

  const epic = await db.epic.findUnique({ where: { id: epicId } });
  if (!epic) notFound();

  const initiative = epic.initiativeId
    ? await db.initiative.findUnique({
        where: { id: epic.initiativeId },
        include: {
          comments: { orderBy: { createdAt: "desc" } },
          history: { orderBy: { createdAt: "desc" } },
          epics: {
            where: { id: epicId },
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
    : null;

  const insightsMonth = epic.planStartMonth ?? initiative?.startMonth ?? 1;
  const quarter = quarterFromMonth(insightsMonth);
  const periodMonths = monthsForQuarter(quarter);
  const planYear = initiative?.year ?? epic.planYear ?? new Date().getFullYear();

  const scopedInitiatives: InitiativeItem[] = initiative
    ? [
        {
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
        },
      ]
    : [];

  const displayId = typeof params.epicDisplayId === "string" ? params.epicDisplayId : raw;

  return (
    <EpicInsightsView
      epicId={epicId}
      epicDisplayId={displayId}
      epicTitle={epic.title}
      epicTeam={epic.team ?? null}
      quarter={quarter}
      month={insightsMonth}
      periodMonths={periodMonths}
      planYear={planYear}
      initiatives={scopedInitiatives}
    />
  );
}

async function renderInitiativeScope(raw: string) {
  const initiativeId = await resolveInitiativeId(raw);
  if (!initiativeId) notFound();

  const initiative = await db.initiative.findUnique({
    where: { id: initiativeId },
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
  if (!initiative) notFound();

  const insightsMonth = initiative.startMonth ?? initiative.epics[0]?.planStartMonth ?? 1;
  const quarter = quarterFromMonth(insightsMonth);
  const periodMonths = monthsForQuarter(quarter);
  const planYear = initiative.year;

  const scopedInitiatives: InitiativeItem[] = [
    {
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
    },
  ];

  return (
    <EpicInsightsView
      epicId=""
      epicTitle=""
      epicTeam={null}
      initiativeId={initiative.id}
      initiativeDisplayId={raw}
      initiativeTitle={initiative.title}
      quarter={quarter}
      month={insightsMonth}
      periodMonths={periodMonths}
      planYear={planYear}
      initiatives={scopedInitiatives}
    />
  );
}
