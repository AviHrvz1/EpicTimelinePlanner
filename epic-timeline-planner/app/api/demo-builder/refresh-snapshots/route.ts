import { NextResponse } from "next/server";

import { refreshDemoSnapshotsToToday } from "@/lib/demo-builder";

export const runtime = "nodejs";

/**
 * Internal admin endpoint — extends each demo story's daily snapshot series
 * up through today (and updates the live `status`/`daysLeft` to match).
 * Cheaper than a full reseed; useful when "today" has advanced but you
 * don't want to lose the structure.
 */
export async function POST() {
  try {
    const result = await refreshDemoSnapshotsToToday();
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Refresh failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
