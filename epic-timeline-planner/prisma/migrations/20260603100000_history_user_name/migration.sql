-- Attribute history entries to the signed-in user who triggered the change.
-- Adds a nullable `userName` to each of the three history tables. Nullable
-- so all existing rows (pre-auth events, automation events, pre-migration
-- entries) stay valid — the UI renders "System" when the column is null.

ALTER TABLE "InitiativeHistory" ADD COLUMN "userName" TEXT;
ALTER TABLE "EpicHistory"       ADD COLUMN "userName" TEXT;
ALTER TABLE "StoryHistory"      ADD COLUMN "userName" TEXT;
