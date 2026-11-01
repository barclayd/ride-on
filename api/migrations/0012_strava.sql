-- Ride On ownership only. Stitch owns the shared OAuth credentials and webhook.
-- Ride history is read live and is never persisted here.
CREATE TABLE strava_connections (
  owner_id TEXT PRIMARY KEY REFERENCES auth_user_owners(owner_id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL UNIQUE,
  grant_id TEXT NOT NULL,
  scopes TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  generation TEXT NOT NULL
);
CREATE TABLE strava_flows (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES auth_user_owners(owner_id) ON DELETE CASCADE,
  client_state TEXT NOT NULL,
  challenge TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('created', 'authorizing', 'exchanging', 'ready', 'failed')),
  expires_at INTEGER NOT NULL,
  athlete_id TEXT,
  grant_id TEXT,
  scopes TEXT
);
CREATE INDEX strava_flows_expiry ON strava_flows(expires_at);
CREATE UNIQUE INDEX strava_flows_owner ON strava_flows(owner_id);
CREATE TABLE strava_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
