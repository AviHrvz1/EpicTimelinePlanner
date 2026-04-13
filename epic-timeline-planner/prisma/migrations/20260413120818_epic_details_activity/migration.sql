-- AlterTable
ALTER TABLE "Epic" ADD COLUMN "assignee" TEXT;

-- CreateTable
CREATE TABLE "EpicComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "body" TEXT NOT NULL,
    "author" TEXT,
    "epicId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EpicComment_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EpicHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entry" TEXT NOT NULL,
    "epicId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EpicHistory_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
