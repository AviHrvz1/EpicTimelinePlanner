-- Add end sprint lane for epic plan spans (1|2).
ALTER TABLE "Epic" ADD COLUMN "planEndSprint" INTEGER DEFAULT 2;
