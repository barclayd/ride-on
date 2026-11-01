-- Preserve the Strava outbox across its parent's ON DELETE CASCADE rebuild.
CREATE TABLE browser_push_migration_deliveries AS SELECT * FROM strava_push_deliveries;
CREATE TABLE push_devices_next (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL,
  token TEXT NOT NULL, environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
  topic TEXT NOT NULL, platform TEXT NOT NULL CHECK(platform IN ('ios','macos','chrome')),
  version INTEGER NOT NULL DEFAULT 1, registered_at TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'apns' CHECK(transport IN ('apns','web_push')),
  subscription_json TEXT,
  scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all','tracked_rides')),
  UNIQUE(environment, topic, token),
  CHECK((transport = 'apns' AND platform IN ('ios','macos') AND subscription_json IS NULL)
    OR (transport = 'web_push' AND platform = 'chrome' AND subscription_json IS NOT NULL))
);
INSERT INTO push_devices_next(id,owner_id,token,environment,topic,platform,version,registered_at)
  SELECT id,owner_id,token,environment,topic,platform,version,registered_at FROM push_devices;
DROP TABLE push_devices;
ALTER TABLE push_devices_next RENAME TO push_devices;
CREATE INDEX push_device_owner ON push_devices(owner_id);
INSERT INTO strava_push_deliveries SELECT * FROM browser_push_migration_deliveries;
DROP TABLE browser_push_migration_deliveries;
