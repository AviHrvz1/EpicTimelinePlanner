-- CreateTable
CREATE TABLE "Roadmap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "years" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable: add roadmapId to Initiative
ALTER TABLE "Initiative" ADD COLUMN "roadmapId" TEXT REFERENCES "Roadmap"("id");

-- AlterTable: add roadmapId to Epic
ALTER TABLE "Epic" ADD COLUMN "roadmapId" TEXT;

-- AlterTable: add roadmapId to UserStory
ALTER TABLE "UserStory" ADD COLUMN "roadmapId" TEXT;

-- Seed default roadmap and backfill existing data
INSERT INTO "Roadmap" ("id", "name", "years", "createdAt", "updatedAt")
VALUES (
  'default-roadmap-0000-0000-000000000001',
  'Roadmap',
  (
    SELECT COALESCE(
      '[' || GROUP_CONCAT(DISTINCT year ORDER BY year ASC) || ']',
      '[' || CAST(strftime('%Y', 'now') AS TEXT) || ']'
    )
    FROM "Initiative"
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Backfill Initiative.roadmapId
UPDATE "Initiative" SET "roadmapId" = 'default-roadmap-0000-0000-000000000001';

-- Backfill Epic.roadmapId
UPDATE "Epic" SET "roadmapId" = 'default-roadmap-0000-0000-000000000001';

-- Backfill UserStory.roadmapId
UPDATE "UserStory" SET "roadmapId" = 'default-roadmap-0000-0000-000000000001';
