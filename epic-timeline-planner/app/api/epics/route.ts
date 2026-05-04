import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export async function GET() {
  const epics = await db.epic.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      comments: { orderBy: { createdAt: "desc" } },
      history: { orderBy: { createdAt: "desc" } },
      userStories: {
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
