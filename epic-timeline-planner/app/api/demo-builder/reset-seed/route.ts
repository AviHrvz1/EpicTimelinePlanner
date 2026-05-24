import { NextResponse } from "next/server";

import { resetAndSeedDemo } from "@/lib/demo-builder";

export const runtime = "nodejs";
// Demo seeding writes a few hundred rows and copies avatar files — give it
// plenty of headroom. Default route timeout is fine for dev but slow VMs may
// need this hint.
export const maxDuration = 60;

/**
 * Internal admin endpoint — POST wipes app data (preserving auth) and
 * reseeds 10 inits × 5 epics × 10 stories + 38 users with avatars + per-
 * workday story snapshots. Returns a small counts payload the caller can
 * surface in a toast.
 */
export async function POST() {
  try {
    const result = await resetAndSeedDemo();
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Reset failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
