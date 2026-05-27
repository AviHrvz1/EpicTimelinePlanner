-- First-class Team entity for the directory. Slug is referenced as a plain
-- string by WorkspaceUser.team / Epic.team / Initiative.team — there is no
-- separate members table; membership is implicit via that slug match. Lead
-- is an FK to WorkspaceUser, cleared automatically if the lead is deleted.
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "leadId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Team_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "WorkspaceUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");
CREATE INDEX "Team_displayOrder_idx" ON "Team"("displayOrder");
