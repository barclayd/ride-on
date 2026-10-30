-- Feedback is independently versioned; date corrections invalidate its timing.
ALTER TABLE rides ADD COLUMN experience_json TEXT CHECK(experience_json IS NULL OR json_valid(experience_json));
ALTER TABLE rides ADD COLUMN experience_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rides ADD COLUMN weather_route_json TEXT CHECK(weather_route_json IS NULL OR json_valid(weather_route_json));
ALTER TABLE rides ADD COLUMN recommendation_id TEXT;

CREATE TABLE ride_weather (
  owner_id TEXT NOT NULL,
  ride_id TEXT NOT NULL,
  experience_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  evidence_json TEXT,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  token TEXT,
  PRIMARY KEY(owner_id, ride_id),
  FOREIGN KEY(owner_id, ride_id) REFERENCES rides(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX ride_weather_due ON ride_weather(status, next_attempt_at);
CREATE TABLE ride_learning_settings (
  owner_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  reset_at TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE ride_weather_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE ride_weather_usage (
  date TEXT PRIMARY KEY,
  units INTEGER NOT NULL
);
CREATE TABLE recommendation_snapshots (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  PRIMARY KEY(owner_id, id)
);
CREATE INDEX recommendation_snapshot_expiry ON recommendation_snapshots(created_at);

CREATE TRIGGER ride_experience_changed AFTER UPDATE OF experience_json ON rides
WHEN NEW.experience_version <> OLD.experience_version BEGIN
  INSERT INTO ride_weather(owner_id, ride_id, experience_version)
  VALUES (NEW.owner_id, NEW.id, NEW.experience_version)
  ON CONFLICT(owner_id, ride_id) DO UPDATE SET
    experience_version = NEW.experience_version, status = 'pending', reason = NULL,
    evidence_json = NULL, next_attempt_at = 0, attempts = 0, lease_until = 0, token = NULL;
END;
