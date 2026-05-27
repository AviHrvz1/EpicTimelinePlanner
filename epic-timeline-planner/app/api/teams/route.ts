import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { normalizeWorkspaceUserTeam } from "@/lib/workspace-users";

export const runtime = "nodejs";

/**
 * GET /api/teams — list teams sorted by displayOrder then displayName.
 * Returns the bare Team rows; members are intentionally not joined here so
 * the directory page can paginate users independently from team metadata.
 */
export async function GET() {
  const teams = await db.team.findMany({
    orderBy: [{ displayOrder: "asc" }, { displayName: "asc" }],
  });
  return NextResponse.json(teams);
}

/**
 * POST /api/teams — create a team. `slug` is derived from `displayName`
 * via the same normalizer used by WorkspaceUser.team so the two stay in
 * sync (membership is implicit via slug match).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rec = body as Record<string, unknown>;
  const displayName = typeof rec.displayName === "string" ? rec.displayName.trim() : "";
  if (!displayName) {
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }
  const slug = normalizeWorkspaceUserTeam(displayName);
  if (!slug) {
    return NextResponse.json({ error: "Could not derive a valid slug from displayName" }, { status: 400 });
  }
  const description = typeof rec.description === "string" ? rec.description.trim() || null : null;
  const imageRaw = typeof rec.image === "string" ? rec.image.trim() : "";
  const image = imageRaw === "" ? null : imageRaw.startsWith("/uploads/") ? imageRaw : null;
  const leadId = typeof rec.leadId === "string" && rec.leadId.trim() ? rec.leadId.trim() : null;

  try {
    const created = await db.team.create({
      data: { slug, displayName, description, image, leadId },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Create failed";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "A team with that slug already exists" }, { status: 409 });
    }
    if (msg.includes("Foreign key constraint")) {
      return NextResponse.json({ error: "Lead user not found" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
