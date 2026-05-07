import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";

export async function GET() {
  const dashboards = await db.dashboard.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      charts: { orderBy: { position: "asc" } },
    },
  });
  return NextResponse.json(dashboards);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name: string = body.name ?? "New Dashboard";
  const dashboard = await db.dashboard.create({
    data: { name },
    include: { charts: true },
  });
  return NextResponse.json(dashboard, { status: 201 });
}
