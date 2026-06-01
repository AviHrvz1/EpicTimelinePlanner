import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { StoryStatus } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { captureEpicDailySnapshot } from "@/lib/epic-daily-snapshots";
import { YEAR_SPRINT_MAX } from "@/lib/year-sprint";

export const runtime = "nodejs";

const bodySchema = z.object({
  overflowYear: z.number().int().min(2000).max(2100),
});

/**
 * Year-end continuation creator.
 *
 * POST `{ overflowYear }` finds every initiative in `overflowYear` on this
 * roadmap that has at least one epic with at least one unfinished story whose
 * `sprint` already sits at the year cap (sprint 24) — i.e. work that the
 * client-side rollover effect couldn't move because there's no sprint 25 in
 * `overflowYear`.
 *
 * For each qualifying initiative, this endpoint:
 *   1. Creates a continuation Initiative in `overflowYear + 1` linked via
 *      `parentInitiativeId`, status `scheduled`, no start/end month (so the
 *      planner schedules it later).
 *   2. For each qualifying epic on that initiative, creates a continuation
 *      Epic under the new initiative linked via `parentEpicId`, all plan
 *      fields `null` (it lives in the unscheduled middle panel until the
 *      planner opens the date popover).
 *   3. Migrates each unfinished story (`status ∉ {review, done}` AND
 *      `sprint === YEAR_SPRINT_MAX`) onto the continuation epic by patching
 *      `epicId` and clearing `sprint` so the story shows as unscheduled in
 *      the new year. Writes a history line describing the move.
 *   4. Writes one `EpicHistory` row on the original epic and one on the
 *      continuation epic recording the lineage; same for the initiative
 *      history tables.
 *
 * Idempotent across re-runs: when a qualifying initiative already has a
 * continuation in `overflowYear + 1` (i.e. a child via the self-relation),
 * the endpoint skips creating a new continuation and only adopts any newly-
 * detected stranded stories onto the existing continuation. Returns counts
 * so the client toast can summarise.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const overflowYear = parsed.data.overflowYear;
  const continuationYear = overflowYear + 1;

  const roadmap = await db.roadmap.findUnique({ where: { id } });
  if (!roadmap) return NextResponse.json({ message: "Roadmap not found" }, { status: 404 });
  const roadmapYears = JSON.parse(roadmap.years) as number[];
  if (!roadmapYears.includes(continuationYear)) {
    return NextResponse.json(
      {
        message: `Roadmap does not include ${continuationYear} yet — add it first.`,
        missingYear: continuationYear,
      },
      { status: 409 },
    );
  }

  // Pull every initiative + epic + sprint-24 stranded story in one round-trip
  // so we can plan the writes without N+1 reads.
  const sourceInitiatives = await db.initiative.findMany({
    where: { roadmapId: id, year: overflowYear },
    include: {
      epics: {
        include: {
          userStories: {
            where: {
              sprint: YEAR_SPRINT_MAX,
              status: { notIn: [StoryStatus.review, StoryStatus.done] },
            },
            select: { id: true, title: true, estimatedDays: true, daysLeft: true, status: true },
          },
        },
      },
      continuations: { where: { year: continuationYear }, select: { id: true } },
    },
  });

  let initiativesCreated = 0;
  let initiativesAdopted = 0;
  let epicsCreated = 0;
  let storiesMigrated = 0;
  /** Phase C: ids of continuation epics created inside the transaction.
   *  Captured to {@link EpicDailySnapshot} AFTER the transaction commits —
   *  the snapshot helper uses the global Prisma client, not the transaction
   *  client, so calling it inside `tx` would race the parent commit. If a
   *  snapshot capture fails post-commit, the next epic edit re-captures
   *  with the same data. */
  const newEpicIdsForSnapshot: string[] = [];

  await db.$transaction(async (tx) => {
    for (const init of sourceInitiatives) {
      const qualifyingEpics = init.epics.filter((epic) => epic.userStories.length > 0);
      if (qualifyingEpics.length === 0) continue;

      // 1. Reuse an existing continuation in the new year if one is already
      //    linked back to this source; otherwise create one.
      let continuationInitiativeId: string;
      if (init.continuations.length > 0) {
        continuationInitiativeId = init.continuations[0]!.id;
        initiativesAdopted += 1;
      } else {
        const created = await tx.initiative.create({
          data: {
            title: `${init.title} (cont.)`,
            icon: init.icon,
            description: init.description,
            assignee: init.assignee,
            color: init.color,
            // Scheduled so the new initiative renders on the year strip;
            // dates left null so the planner picks them.
            status: "scheduled",
            startMonth: null,
            endMonth: null,
            startYearSprint: null,
            endYearSprint: null,
            timelineRow: init.timelineRow,
            year: continuationYear,
            roadmapId: id,
            team: init.team,
            labels: init.labels,
            parentInitiativeId: init.id,
            history: {
              create: { entry: `Initiative created as a continuation of "${init.title}" (${overflowYear}).` },
            },
          },
        });
        continuationInitiativeId = created.id;
        initiativesCreated += 1;
        await tx.initiativeHistory.create({
          data: {
            initiativeId: init.id,
            entry: `Continuation initiative "${created.title}" created in ${continuationYear} to carry unfinished work.`,
          },
        });
      }

      // 2. For each qualifying epic, create or reuse a continuation epic and
      //    migrate its stranded stories onto it.
      for (const epic of qualifyingEpics) {
        const existingContinuationEpic = await tx.epic.findFirst({
          where: { parentEpicId: epic.id, initiativeId: continuationInitiativeId },
          select: { id: true },
        });
        let continuationEpicId: string;
        if (existingContinuationEpic != null) {
          continuationEpicId = existingContinuationEpic.id;
        } else {
          const createdEpic = await tx.epic.create({
            data: {
              title: `${epic.title} (cont.)`,
              icon: epic.icon,
              description: epic.description,
              assignee: epic.assignee,
              originalEstimateDays: null,
              color: epic.color,
              initiativeId: continuationInitiativeId,
              roadmapId: id,
              planYear: continuationYear,
              planQuarter: null,
              planSprint: null,
              planStartMonth: null,
              planEndMonth: null,
              planEndSprint: null,
              planStartDay: null,
              planEndDay: null,
              timelineRow: epic.timelineRow,
              backlogOrder: epic.backlogOrder,
              team: epic.team,
              labels: epic.labels,
              priority: epic.priority,
              parentEpicId: epic.id,
              history: {
                create: { entry: `Epic created as a continuation of "${epic.title}" (${overflowYear}).` },
              },
            },
          });
          continuationEpicId = createdEpic.id;
          newEpicIdsForSnapshot.push(createdEpic.id);
          epicsCreated += 1;
          await tx.epicHistory.create({
            data: {
              epicId: epic.id,
              entry: `Continuation epic "${createdEpic.title}" created in ${continuationYear} to carry unfinished stories.`,
            },
          });
        }

        // 3. Migrate stranded stories one-by-one so we can record per-story
        //    history. Bulk updateMany would erase the audit trail.
        for (const story of epic.userStories) {
          await tx.userStory.update({
            where: { id: story.id },
            data: {
              epicId: continuationEpicId,
              roadmapId: id,
              planYear: continuationYear,
              planQuarter: null,
              sprint: null,
              history: {
                create: {
                  entry: `System auto-move: story carried over from "${epic.title}" to continuation in ${continuationYear}.`,
                },
              },
            },
          });
          storiesMigrated += 1;
        }
      }
    }
  });

  // Phase C — capture day-1 snapshots for the continuation epics. Runs
  // post-commit so the helper's global Prisma client sees the epic rows.
  if (newEpicIdsForSnapshot.length > 0) {
    const snapshots = await db.epic.findMany({
      where: { id: { in: newEpicIdsForSnapshot } },
      select: {
        id: true,
        title: true,
        description: true,
        icon: true,
        color: true,
        originalEstimateDays: true,
        priority: true,
        labels: true,
        team: true,
        planStartMonth: true,
        planEndMonth: true,
        planSprint: true,
        planEndSprint: true,
        planStartDay: true,
        planEndDay: true,
      },
    });
    for (const snap of snapshots) {
      await captureEpicDailySnapshot(snap);
    }
  }

  return NextResponse.json({
    initiativesCreated,
    initiativesAdopted,
    epicsCreated,
    storiesMigrated,
    continuationYear,
  });
}
