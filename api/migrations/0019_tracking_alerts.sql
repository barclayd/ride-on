-- Existing plans retain every trigger. Choices are independent of the saved
-- recommendation and monitor state; no baseline or delivery history is reset.
ALTER TABLE tracked_rides ADD COLUMN alerts_json TEXT NOT NULL
  DEFAULT '{"triggers":{"rain":true,"wind":true,"cold":true,"betterTime":true}}';
