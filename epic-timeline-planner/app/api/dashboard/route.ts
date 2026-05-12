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
  try {
    const body = await req.json();
    const name: string = body.name ?? "New Dashboard";
    const charts = Array.isArray(body.charts) ? body.charts as Array<{
      chartType: string; title: string; config: string;
      position: number; colSpan: number; rowSpan: number;
    }> : [];

    const count = await db.dashboard.count();
    const slug = `DASH-${String(count + 1).padStart(2, "0")}`;

    const dashboard = await db.dashboard.create({
      data: {
        name,
        slug,
        charts: charts.length > 0 ? {
          create: charts.map((c) => ({
            chartType: c.chartType,
            title: c.title,
            config: typeof c.config === "string" ? c.config : JSON.stringify(c.config ?? {}),
            position: c.position,
            colSpan: c.colSpan ?? 1,
            rowSpan: c.rowSpan ?? 1,
          })),
        } : undefined,
      },
      include: { charts: { orderBy: { position: "asc" } } },
    });
    return NextResponse.json(dashboard, { status: 201 });
  } catch (err) {
    console.error("[POST /api/dashboard]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
