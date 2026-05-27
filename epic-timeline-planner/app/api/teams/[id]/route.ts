import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { normalizeWorkspaceUserTeam } from "@/lib/workspace-users";

export const runtime = "nodejs";

/**
 * PATCH /api/teams/[id] — partial update. When `displayName` changes the
 * slug also changes — and because membership lives on `WorkspaceUser.team`
 * as the old slug, we transactionally rewrite that column on all matching
 * users so the implicit-membership invariant holds. Same idea applies to
 * Epic.team and Initiative.team.
 */
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

  const prior = await db.team.findUnique({ where: { id } });
  if (!prior) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: {
    displayName?: string;
    slug?: string;
    description?: string | null;
    image?: string | null;
    leadId?: string | null;
    displayOrder?: number;
  } = {};
  let nextSlug: string | null = null;
  let priorImageToDelete: string | null = null;

  if (typeof rec.displayName === "string") {
    const name = rec.displayName.trim();
    if (!name) return NextResponse.json({ error: "displayName cannot be empty" }, { status: 400 });
    data.displayName = name;
    const slug = normalizeWorkspaceUserTeam(name);
    if (!slug) {
      return NextResponse.json({ error: "Could not derive a valid slug from displayName" }, { status: 400 });
    }
    if (slug !== prior.slug) {
      data.slug = slug;
      nextSlug = slug;
    }
  }
  if ("description" in rec) {
    const raw = rec.description;
    if (raw == null) data.description = null;
    else if (typeof raw === "string") data.description = raw.trim() || null;
  }
  if ("image" in rec) {
    const raw = rec.image;
    if (raw == null) data.image = null;
    else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed === "") data.image = null;
      else if (trimmed.startsWith("/uploads/")) data.image = trimmed;
    }
    if ("image" in data && prior.image && prior.image !== data.image) {
      priorImageToDelete = prior.image;
    }
  }
  if ("leadId" in rec) {
    const raw = rec.leadId;
    if (raw == null) data.leadId = null;
    else if (typeof raw === "string") data.leadId = raw.trim() || null;
  }
  if (typeof rec.displayOrder === "number" && Number.isFinite(rec.displayOrder)) {
    data.displayOrder = Math.trunc(rec.displayOrder);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      // When the slug changes, propagate to membership columns so the
      // implicit-membership invariant holds. WorkspaceUser is the canonical
      // members source; Epic.team / Initiative.team are denormalized refs
      // we also need to keep in sync.
      if (nextSlug) {
        await tx.workspaceUser.updateMany({ where: { team: prior.slug }, data: { team: nextSlug } });
        await tx.epic.updateMany({ where: { team: prior.slug }, data: { team: nextSlug } });
        await tx.initiative.updateMany({ where: { team: prior.slug }, data: { team: nextSlug } });
      }
      return tx.team.update({ where: { id }, data });
    });
    if (priorImageToDelete) void getStorage().delete(priorImageToDelete);
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "A team with that slug already exists" }, { status: 409 });
    }
    if (msg.includes("Foreign key constraint")) {
      return NextResponse.json({ error: "Lead user not found" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/teams/[id] — drop the Team row. Membership rows on
 * WorkspaceUser are *not* cleared; the slug stays on users so a deleted
 * team that gets re-added later can recover its members. If the caller
 * wants members detached they can pass `?detachMembers=1`.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const detach = searchParams.get("detachMembers") === "1";
  try {
    const prior = await db.team.findUnique({ where: { id } });
    if (!prior) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.$transaction(async (tx) => {
      if (detach) {
        await tx.workspaceUser.updateMany({ where: { team: prior.slug }, data: { team: "" } });
      }
      await tx.team.delete({ where: { id } });
    });
    if (prior.image) void getStorage().delete(prior.image);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
