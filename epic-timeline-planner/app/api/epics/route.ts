import { NextResponse } from "next/server";

import { db, ACTIVE_RECORD } from "@/lib/db";

export async function GET() {
  // Phase D: live-view endpoint — filter soft-deleted rows out at both
  // levels so consumers don't see them.
  const epics = await db.epic.findMany({
    where: ACTIVE_RECORD,
    orderBy: { updatedAt: "desc" },
    include: {
      comments: { orderBy: { createdAt: "desc" } },
      history: { orderBy: { createdAt: "desc" } },
      userStories: {
        where: ACTIVE_RECORD,
        orderBy: [{ backlogOrder: "asc" }, { createdAt: "asc" }],
        include: {
          comments: { orderBy: { createdAt: "desc" } },
          history: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  return NextResponse.json(epics);
}
