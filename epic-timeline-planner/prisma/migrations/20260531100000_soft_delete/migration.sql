-- Phase D: soft delete for UserStory and Epic. Live views filter where
-- deletedAt IS NULL; closed-period views ignore the filter so snapshot
-- data still renders. Cascade FKs stay as-is — soft delete leaves the
-- parent row in place so child rows remain valid.

ALTER TABLE "UserStory" ADD COLUMN "deletedAt" DATETIME;
CREATE INDEX "UserStory_deletedAt_idx" ON "UserStory"("deletedAt");

ALTER TABLE "Epic" ADD COLUMN "deletedAt" DATETIME;
CREATE INDEX "Epic_deletedAt_idx" ON "Epic"("deletedAt");
