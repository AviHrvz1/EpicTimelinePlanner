import { PrismaClient } from "@/lib/generated/prisma";

/**
 * Bump when the Prisma schema changes. In development, disconnects a stale client
 * so the next import gets a new `PrismaClient` after `prisma generate`.
 */
const PRISMA_CLIENT_CACHE_VERSION = 3;

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

export const db = getDb();
