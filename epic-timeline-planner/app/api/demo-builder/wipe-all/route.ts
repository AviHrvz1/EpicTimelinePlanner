import { NextResponse } from "next/server";

import { wipeAllData } from "@/lib/demo-builder";

export const runtime = "nodejs";
// Wiping is a few dozen DELETE queries + filesystem scrub for avatars.
// Default route timeout (10s on Vercel free) is enough on typical DBs but
// extend a bit for headroom on slower hosts.
export const maxDuration = 30;

/**
 * Internal admin endpoint — POST wipes ALL app data (initiatives, epics,
 * stories, snapshots, comments, history, dashboards, roadmaps, teams,
 * workspace users, and uploaded-avatar files). Auth tables are preserved
 * so the caller stays signed in.
 *
 * Unlike `/api/demo-builder/reset-seed`, this does NOT reseed afterward
 * — it leaves the workspace empty so the caller can build up from a
 * clean slate.
 */
export async function POST() {
  try {
    const result = await wipeAllData();
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Wipe failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
