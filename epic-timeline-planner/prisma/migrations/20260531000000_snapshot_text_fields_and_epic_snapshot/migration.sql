-- Phase B: Story snapshot text fields (additive nullable).
ALTER TABLE "StoryDailySnapshot" ADD COLUMN "title" TEXT;
ALTER TABLE "StoryDailySnapshot" ADD COLUMN "description" TEXT;
ALTER TABLE "StoryDailySnapshot" ADD COLUMN "priority" TEXT;
ALTER TABLE "StoryDailySnapshot" ADD COLUMN "labels" TEXT;

-- Phase C: EpicDailySnapshot table (new).
CREATE TABLE "EpicDailySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "epicId" TEXT NOT NULL,
    "snapshotDate" DATETIME NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "originalEstimateDays" INTEGER,
    "priority" TEXT,
    "labels" TEXT,
    "team" TEXT,
    "planStartMonth" INTEGER,
    "planEndMonth" INTEGER,
    "planSprint" INTEGER,
    "planEndSprint" INTEGER,
    "planStartDay" INTEGER,
    "planEndDay" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EpicDailySnapshot_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EpicDailySnapshot_epicId_snapshotDate_key" ON "EpicDailySnapshot"("epicId", "snapshotDate");
CREATE INDEX "EpicDailySnapshot_snapshotDate_idx" ON "EpicDailySnapshot"("snapshotDate");
