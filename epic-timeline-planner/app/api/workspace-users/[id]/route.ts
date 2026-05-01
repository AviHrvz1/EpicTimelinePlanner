import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";

export const runtime = "nodejs";
import {
  normalizeWorkspaceUserPermission,
  normalizeWorkspaceUserTeam,
} from "@/lib/workspace-users";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rec = body as Record<string, unknown>;
  const data: { name?: string; email?: string; team?: string; permission?: string } = {};

  if (typeof rec.name === "string") {
    const name = rec.name.trim();
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    data.name = name;
  }
  if (typeof rec.email === "string") {
    const email = rec.email.trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "email cannot be empty" }, { status: 400 });
    data.email = email;
  }
  if (typeof rec.team === "string") {
    data.team = normalizeWorkspaceUserTeam(rec.team);
  }
  if (typeof rec.permission === "string") {
    data.permission = normalizeWorkspaceUserPermission(rec.permission);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const updated = await db.workspaceUser.update({
      where: { id },
      data,
    });
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
    if (msg.includes("Record to update not found")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    await db.workspaceUser.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
