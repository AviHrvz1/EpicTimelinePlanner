-- AlterTable
ALTER TABLE "Initiative" ADD COLUMN "startYearSprint" INTEGER;
ALTER TABLE "Initiative" ADD COLUMN "endYearSprint" INTEGER;

-- Backfill: two sprints per calendar month (S1/S2 per month)
UPDATE "Initiative"
SET
  "startYearSprint" = ("startMonth" - 1) * 2 + 1,
  "endYearSprint" = ("endMonth" - 1) * 2 + 2
WHERE "startMonth" IS NOT NULL AND "endMonth" IS NOT NULL;
