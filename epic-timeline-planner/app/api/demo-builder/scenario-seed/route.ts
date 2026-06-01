import { NextResponse } from "next/server";

import { seedScenario, type ScenarioKey } from "@/lib/demo-builder";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_SCENARIOS: ReadonlyArray<ScenarioKey> = [
  "sprintOverflow",
  "monthOverflow",
  "quarterOverflow",
  "yearOverflow",
];

/**
 * Internal admin endpoint — POST `{ scenario }` reseeds the demo then forces
 * a small group of stories at the requested sprint boundary into inProgress
 * so the client-side rollover effect has guaranteed unfinished work when the
 * user time-travels forward. Returns `{ mutated }` for toast feedback.
 */
export async function POST(request: Request) {
  let scenario: ScenarioKey | null = null;
  try {
    const body = (await request.json()) as { scenario?: unknown };
    if (typeof body.scenario === "string" && (VALID_SCENARIOS as readonly string[]).includes(body.scenario)) {
      scenario = body.scenario as ScenarioKey;
    }
  } catch {
    // Fall through to the validation error below.
  }
  if (scenario == null) {
    return NextResponse.json(
      { error: `scenario must be one of: ${VALID_SCENARIOS.join(", ")}` },
      { status: 400 },
    );
  }
  try {
    const result = await seedScenario(scenario);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Scenario seed failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
