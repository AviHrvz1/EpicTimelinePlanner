-- Rename StoryStatus values to match new kanban column labels.
--
-- Lifecycle stays the same; the names change:
--   old `done`     → new `review`   (UI label "Review / Testing")
--   old `approved` → new `done`     (UI label "Done", terminal)
--
-- The two updates would collide if run in order, so use a temp value to
-- park the old `done` rows while the old `approved` rows take the `done`
-- slot. SQLite stores enum values as plain TEXT, so a straight UPDATE
-- works. Idempotent — re-runs match nothing.
--
-- StoryDailySnapshot.status is also TEXT (closed-period projection reads
-- it back as a StoryStatus), so it gets the same three-step swap.

UPDATE "UserStory" SET "status" = '__rename_review' WHERE "status" = 'done';
UPDATE "UserStory" SET "status" = 'done'            WHERE "status" = 'approved';
UPDATE "UserStory" SET "status" = 'review'          WHERE "status" = '__rename_review';

UPDATE "StoryDailySnapshot" SET "status" = '__rename_review' WHERE "status" = 'done';
UPDATE "StoryDailySnapshot" SET "status" = 'done'            WHERE "status" = 'approved';
UPDATE "StoryDailySnapshot" SET "status" = 'review'          WHERE "status" = '__rename_review';
