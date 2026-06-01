import { PrismaClient } from "@/lib/generated/prisma";

/**
 * Bump when the Prisma schema changes. In development, disconnects a stale client
 * so the next import gets a new `PrismaClient` after `prisma generate`.
 * (e.g. UserStory.backlogOrder / Epic.backlogOrder — old cached clients reject those fields.)
 *
 * Version 13: added WorkspaceUser.image (avatar URL).
 * Version 14: added Team model + WorkspaceUser.ledTeams back-relation.
 * Version 15: regenerated client so runtime engine picks up Epic.priority.
 * Version 16: added Initiative.parentInitiativeId + Epic.parentEpicId for
 *             year-end continuation lineage.
 * Version 17: Phase B+C — StoryDailySnapshot gained title/description/
 *             priority/labels columns; new EpicDailySnapshot table. Closed-
 *             period views read from these to stay frozen at close-day state.
 * Version 18: Phase D — UserStory + Epic gained `deletedAt` for soft
 *             delete. Live views must filter `deletedAt: null` via the
 *             `ACTIVE_RECORD` constant exported below; closed-period
 *             views read soft-deleted rows so history stays intact.
 */
const PRISMA_CLIENT_CACHE_VERSION = 18;

/**
 * Standard live-view filter. Every Prisma `findMany`, `findFirst`,
 * `findUnique` (where the result drives a USER-facing list view of stories
 * or epics) MUST spread this so soft-deleted rows don't leak into the UI.
 *
 * Closed-period scope expansion (sprint-plan / month-team-board / quarter
 * analytics helpers that surface "what was happening at close") intentionally
 * does NOT apply this filter — soft-deleted rows still need to render their
 * snapshot data on the closed view.
 *
 * Usage:
 *   ```ts
 *   const stories = await db.userStory.findMany({
 *     where: { ...ACTIVE_RECORD, epicId },
 *   });
 *   ```
 */
export const ACTIVE_RECORD = { deletedAt: null } as const;

type LegacyGlobal = typeof globalThis & { prisma?: PrismaClient };

type PrismaGlobal = typeof globalThis & {
  __epicPlannerPrisma?: PrismaClient;
  __epicPlannerPrismaVersion?: number;
};

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getDb(): PrismaClient {
  const g = globalThis as PrismaGlobal;

  if (process.env.NODE_ENV === "development") {
    const legacy = (globalThis as LegacyGlobal).prisma;
    if (legacy) {
      void legacy.$disconnect();
      delete (globalThis as LegacyGlobal).prisma;
    }
  }

  const cached = g.__epicPlannerPrisma;
  const version = g.__epicPlannerPrismaVersion;
  if (
    process.env.NODE_ENV === "development" &&
    cached != null &&
    version !== PRISMA_CLIENT_CACHE_VERSION
  ) {
    void cached.$disconnect();
    g.__epicPlannerPrisma = undefined;
    g.__epicPlannerPrismaVersion = undefined;
  }

  if (g.__epicPlannerPrisma == null) {
    g.__epicPlannerPrisma = createPrismaClient();
    g.__epicPlannerPrismaVersion = PRISMA_CLIENT_CACHE_VERSION;
  }

  return g.__epicPlannerPrisma;
}

/**
 * Always read through `getDb()` so hot reload / cache-version bumps cannot leave importers
 * holding a disconnected PrismaClient that predates schema changes (missing delegates).
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getDb();
    const value = Reflect.get(client, prop, client);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});
