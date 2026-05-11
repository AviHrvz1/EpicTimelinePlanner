import { PrismaClient } from "@/lib/generated/prisma";

/**
 * Bump when the Prisma schema changes. In development, disconnects a stale client
 * so the next import gets a new `PrismaClient` after `prisma generate`.
 * (e.g. UserStory.backlogOrder / Epic.backlogOrder — old cached clients reject those fields.)
 */
const PRISMA_CLIENT_CACHE_VERSION = 9;

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
