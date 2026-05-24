import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";

export const runtime = "nodejs";
import {
  normalizeWorkspaceUserPermission,
  normalizeWorkspaceUserTeam,
} from "@/lib/workspace-users";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const team = searchParams.get("team");
  const permission = searchParams.get("permission");

  const where: {
    AND: Array<Record<string, unknown>>;
  } = { AND: [] };

  if (team === "__none__") {
    where.AND.push({ team: "" });
  } else if (team && team !== "all") {
    where.AND.push({ team });
  }
  if (permission && permission !== "all") {
    where.AND.push({ permission });
  }

  let users = await db.workspaceUser.findMany({
    where: where.AND.length > 0 ? where : undefined,
    orderBy: [{ name: "asc" }],
  });
  if (q) {
    users = users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.permission.toLowerCase().includes(q) ||
        (u.team && u.team.toLowerCase().includes(q)),
    );
  }
  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rec = body as Record<string, unknown>;
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  const email = typeof rec.email === "string" ? rec.email.trim().toLowerCase() : "";
  if (!name || !email) {
    return NextResponse.json({ error: "name and email are required" }, { status: 400 });
  }
  const team = normalizeWorkspaceUserTeam(typeof rec.team === "string" ? rec.team : "");
  const permission = normalizeWorkspaceUserPermission(
    typeof rec.permission === "string" ? rec.permission : undefined,
  );
  // Avatar URL is opaque to this route — it's the value `/api/uploads/avatar`
  // returned. We only store strings that look like our own upload paths or
  // null/empty (cleared). Anything else is rejected as a defensive check.
  const imageRaw = typeof rec.image === "string" ? rec.image.trim() : "";
  const image = imageRaw === "" ? null : imageRaw.startsWith("/uploads/") ? imageRaw : null;

  try {
    const created = await db.workspaceUser.create({
      data: { name, email, team, permission, status: "active", image },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Create failed";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
