-- AddColumn: Initiative.parentInitiativeId for year-end continuation lineage.
ALTER TABLE "Initiative" ADD COLUMN "parentInitiativeId" TEXT REFERENCES "Initiative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Initiative_parentInitiativeId_idx" ON "Initiative"("parentInitiativeId");

-- AddColumn: Epic.parentEpicId for year-end continuation lineage.
ALTER TABLE "Epic" ADD COLUMN "parentEpicId" TEXT REFERENCES "Epic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Epic_parentEpicId_idx" ON "Epic"("parentEpicId");
