-- Backfill UserStory.daysLeft so the year-roadmap health/at-risk math can read
-- the field without fallbacks. Three invariants:
--   (a) done/approved stories have daysLeft = 0
--   (b) stories with estimatedDays but no daysLeft initialize to estimatedDays
--       (i.e. assume no progress has been made yet)
--   (c) daysLeft <= estimatedDays for every story (clamp any drift)
-- New mutations are enforced in the POST/PATCH handlers; this migration brings
-- existing rows into compliance one time.

UPDATE UserStory
SET daysLeft = 0
WHERE status IN ('done', 'approved')
  AND (daysLeft IS NULL OR daysLeft > 0);

UPDATE UserStory
SET daysLeft = estimatedDays
WHERE daysLeft IS NULL
  AND estimatedDays IS NOT NULL
  AND status NOT IN ('done', 'approved');

UPDATE UserStory
SET daysLeft = estimatedDays
WHERE estimatedDays IS NOT NULL
  AND daysLeft IS NOT NULL
  AND daysLeft > estimatedDays;
