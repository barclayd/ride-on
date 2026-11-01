-- Account pauses are deliberately outside the versioned preference JSON.
CREATE TABLE user_pauses (
  owner_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  until_date TEXT,
  paused_at TEXT NOT NULL
);

-- Survives an explicit resume or a date expiring between two cron ticks.
ALTER TABLE tracking_monitors ADD COLUMN resume_pending INTEGER NOT NULL DEFAULT 0;
