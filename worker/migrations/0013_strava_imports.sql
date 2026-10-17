-- A temporary cache, separate from manually logged rides and recommendation data.
-- GPS streams are never stored. Hard expiry also removes derived matches/reviews.
CREATE TABLE strava_import_sessions (
  owner_id TEXT PRIMARY KEY REFERENCES strava_connections(owner_id) ON DELETE CASCADE,
  generation TEXT NOT NULL,
  initialized_at INTEGER NOT NULL,
  last_scan_at INTEGER NOT NULL,
  requested_after INTEGER NOT NULL,
  requested_before INTEGER NOT NULL,
  route_signature TEXT NOT NULL DEFAULT '',
  UNIQUE(owner_id, generation)
);
CREATE TRIGGER strava_import_connection_changed AFTER UPDATE ON strava_connections
WHEN OLD.generation != NEW.generation BEGIN
  DELETE FROM strava_import_sessions WHERE owner_id = OLD.owner_id;
END;
CREATE TABLE strava_activity_cache (
  owner_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  average_speed_mps REAL,
  elevation_gain_m REAL,
  average_power_watts REAL,
  power_source TEXT CHECK(power_source IN ('meter', 'estimated')),
  match_json TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('automatic', 'confirmed', 'dismissed')),
  primary_route_id TEXT,
  reviewed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  first_seen_at INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  notification_at INTEGER,
  PRIMARY KEY(owner_id, activity_id),
  FOREIGN KEY(owner_id, generation) REFERENCES strava_import_sessions(owner_id, generation) ON DELETE CASCADE
);
CREATE INDEX strava_activity_history ON strava_activity_cache(owner_id, primary_route_id, started_at DESC, activity_id);
CREATE INDEX strava_activity_expiry ON strava_activity_cache(expires_at);
CREATE INDEX strava_activity_refresh ON strava_activity_cache(fetched_at);
CREATE TABLE strava_import_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  job_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  completed_revision INTEGER NOT NULL DEFAULT 0,
  event_time INTEGER NOT NULL DEFAULT 0,
  notify_at INTEGER,
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  queued_until INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  UNIQUE(owner_id, generation, job_key),
  FOREIGN KEY(owner_id, generation) REFERENCES strava_import_sessions(owner_id, generation) ON DELETE CASCADE
);
CREATE INDEX strava_import_jobs_due ON strava_import_jobs(due_at, queued_until, lease_until);
-- Shared application quota: one rate-limit response pauses all import reads.
CREATE TABLE strava_import_backoff (id INTEGER PRIMARY KEY CHECK(id=1), until_at INTEGER NOT NULL);
CREATE TABLE strava_push_deliveries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
  device_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected')),
  expires_at INTEGER NOT NULL,
  UNIQUE(owner_id, activity_id, device_id),
  FOREIGN KEY(owner_id, activity_id) REFERENCES strava_activity_cache(owner_id, activity_id) ON DELETE CASCADE
);
