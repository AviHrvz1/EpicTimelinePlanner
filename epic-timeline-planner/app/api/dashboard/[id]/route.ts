import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dashboard = await db.dashboard.findUnique({
    where: { id },
    include: { charts: { orderBy: { position: "asc" } } },
  });
  if (!dashboard) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(dashboard);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (Array.isArray(body.charts)) {
    await db.dashboardChart.deleteMany({ where: { dashboardId: id } });
    const charts = body.charts as Array<{
      chartType: string;
      title: string;
      config: string;
      position: number;
      colSpan: number;
      rowSpan: number;
    }>;
    for (const chart of charts) {
      await db.dashboardChart.create({
        data: {
          dashboardId: id,
          chartType: chart.chartType,
          title: chart.title,
          config: chart.config,
          position: chart.position,
          colSpan: chart.colSpan ?? 1,
          rowSpan: chart.rowSpan ?? 1,
        },
      });
    }
  }

  const updated = await db.dashboard.update({
    where: { id },
    data: { name: body.name ?? undefined },
    include: { charts: { orderBy: { position: "asc" } } },
  });
  return NextResponse.json(updated);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (body.addChart) {
    const c = body.addChart;
    const count = await db.dashboardChart.count({ where: { dashboardId: id } });
    const chart = await db.dashboardChart.create({
      data: {
        dashboardId: id,
        chartType: c.chartType,
        title: c.title,
        config: typeof c.config === "string" ? c.config : JSON.stringify(c.config ?? {}),
        position: count,
        colSpan: c.colSpan ?? 1,
          rowSpan: c.rowSpan ?? 1,
      },
    });
    await db.dashboard.update({ where: { id }, data: {} });
    return NextResponse.json(chart, { status: 201 });
  }
  return NextResponse.json({ error: "unknown patch op" }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.dashboard.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
