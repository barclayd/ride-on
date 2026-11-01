-- Product decision: retain only the local ride date with route/ownership and
-- synchronization identifiers. Matching evidence remains a seven-day cache.
ALTER TABLE strava_activity_cache ADD COLUMN ridden_on TEXT NOT NULL DEFAULT '';
UPDATE strava_activity_cache SET ridden_on=substr(started_at,1,10);
ALTER TABLE strava_activity_cache DROP COLUMN average_speed_mps;
ALTER TABLE strava_activity_cache DROP COLUMN elevation_gain_m;
ALTER TABLE strava_activity_cache DROP COLUMN average_power_watts;
ALTER TABLE strava_activity_cache DROP COLUMN power_source;

CREATE TABLE strava_ride_history (
  owner_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  ridden_on TEXT NOT NULL,
  primary_route_id TEXT,
  decision TEXT NOT NULL CHECK(decision IN ('automatic','confirmed','dismissed')),
  version INTEGER NOT NULL,
  verified_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id,activity_id),
  FOREIGN KEY(owner_id,primary_route_id) REFERENCES routes(owner_id,id) ON DELETE CASCADE,
  FOREIGN KEY(owner_id,generation) REFERENCES strava_import_sessions(owner_id,generation) ON DELETE CASCADE
);
CREATE INDEX strava_ride_dates ON strava_ride_history(owner_id,primary_route_id,ridden_on DESC,activity_id);
CREATE INDEX strava_ride_revalidation ON strava_ride_history(verified_at);
INSERT INTO strava_ride_history
SELECT a.owner_id,a.generation,a.activity_id,a.ridden_on,a.primary_route_id,a.decision,a.version,a.fetched_at
FROM strava_activity_cache a
WHERE (a.primary_route_id IS NOT NULL OR a.decision!='automatic')
AND (a.primary_route_id IS NULL OR EXISTS(SELECT 1 FROM routes r WHERE r.id=a.primary_route_id AND r.owner_id=a.owner_id));
