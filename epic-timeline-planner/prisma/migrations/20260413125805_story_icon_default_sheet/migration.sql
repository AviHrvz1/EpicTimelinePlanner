-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserStory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '📄',
    "description" TEXT,
    "assignee" TEXT,
    "sprint" INTEGER,
    "estimatedDays" INTEGER,
    "daysLeft" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "epicId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserStory_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserStory" ("assignee", "createdAt", "daysLeft", "description", "epicId", "estimatedDays", "icon", "id", "sprint", "status", "title", "updatedAt") SELECT "assignee", "createdAt", "daysLeft", "description", "epicId", "estimatedDays", "icon", "id", "sprint", "status", "title", "updatedAt" FROM "UserStory";
DROP TABLE "UserStory";
ALTER TABLE "new_UserStory" RENAME TO "UserStory";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
