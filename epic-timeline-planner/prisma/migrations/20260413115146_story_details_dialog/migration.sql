-- AlterTable
ALTER TABLE "UserStory" ADD COLUMN "assignee" TEXT;
ALTER TABLE "UserStory" ADD COLUMN "daysLeft" INTEGER;
ALTER TABLE "UserStory" ADD COLUMN "description" TEXT;
ALTER TABLE "UserStory" ADD COLUMN "estimatedDays" INTEGER;

-- CreateTable
CREATE TABLE "StoryComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "body" TEXT NOT NULL,
    "author" TEXT,
    "storyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryComment_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "UserStory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoryHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entry" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryHistory_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "UserStory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
