import { NextResponse } from "next/server";

import { db } from "@/lib/db";

/** RAG snapshot: teams, users, sprints, initiatives summary for the LLM context. */
export async function GET() {
  const [initiatives, users] = await Promise.all([
    db.initiative.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        epics: {
          include: {
            userStories: {
              select: {
                id: true,
                status: true,
                sprint: true,
                planYear: true,
                planQuarter: true,
                estimatedDays: true,
                daysLeft: true,
                assignee: true,
              },
            },
          },
        },
      },
    }),
    db.workspaceUser.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Derive unique quarters and sprints from story data
  const sprintSet = new Set<string>();
  const quarterSet = new Set<string>();
  for (const ini of initiatives) {
    for (const epic of ini.epics) {
      for (const story of epic.userStories) {
        if (story.planYear && story.planQuarter) {
          quarterSet.add(`${story.planYear}-Q${story.planQuarter}`);
        }
        if (story.planYear && story.planQuarter && story.sprint) {
          sprintSet.add(`${story.planYear}-Q${story.planQuarter}-S${story.sprint}`);
        }
      }
    }
  }

  const teams = ["platform", "experience", "data", "mobile", "growth"];

  return NextResponse.json({
    teams,
    users: users.map((u) => ({ id: u.id, name: u.name, team: u.team })),
    quarters: [...quarterSet].sort(),
    sprints: [...sprintSet].sort(),
    initiatives: initiatives.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      startMonth: i.startMonth,
      endMonth: i.endMonth,
      year: i.year,
      epicCount: i.epics.length,
    })),
  });
}
