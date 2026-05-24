import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";

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
  const data: { name?: string; email?: string; team?: string; permission?: string; image?: string | null } = {};

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
  // `image: null` clears the avatar (and unlinks the file); a non-empty
  // upload path replaces it. Anything else is rejected as a defensive check.
  let priorImageToDelete: string | null = null;
  if ("image" in rec) {
    const raw = rec.image;
    if (raw == null) {
      data.image = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed === "") {
        data.image = null;
      } else if (trimmed.startsWith("/uploads/")) {
        data.image = trimmed;
      }
    }
    if ("image" in data) {
      const prior = await db.workspaceUser.findUnique({ where: { id }, select: { image: true } });
      if (prior?.image && prior.image !== data.image) priorImageToDelete = prior.image;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const updated = await db.workspaceUser.update({
      where: { id },
      data,
    });
    // Best-effort cleanup of the replaced avatar so we don't accumulate orphan
    // files on disk. Fired AFTER the DB write succeeded so a failed delete
    // doesn't leave the row pointing at a non-existent file.
    if (priorImageToDelete) {
      void getStorage().delete(priorImageToDelete);
    }
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
    const prior = await db.workspaceUser.findUnique({ where: { id }, select: { image: true } });
    await db.workspaceUser.delete({ where: { id } });
    if (prior?.image) void getStorage().delete(prior.image);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
