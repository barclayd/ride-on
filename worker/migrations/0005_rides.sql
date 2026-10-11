CREATE TABLE ride_history_revisions (
  owner_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE ride_geometries (
  owner_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, source_hash)
);
CREATE TABLE rides (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  route_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  route_snapshot TEXT NOT NULL,
  ridden_on TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX rides_by_date ON rides(owner_id, ridden_on DESC, id);
CREATE INDEX rides_by_route ON rides(owner_id, route_id, ridden_on DESC, id);
CREATE TABLE ride_tombstones (
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  PRIMARY KEY (owner_id, idempotency_key)
);
-- Tombstones contain only opaque keys/digests. They prevent delayed retries from
-- resurrecting an undone log, including after the client restarts.
CREATE TRIGGER rides_created AFTER INSERT ON rides BEGIN
  INSERT INTO ride_history_revisions VALUES (NEW.owner_id, 1)
  ON CONFLICT(owner_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER rides_corrected AFTER UPDATE ON rides BEGIN
  INSERT INTO ride_history_revisions VALUES (NEW.owner_id, 1)
  ON CONFLICT(owner_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER rides_deleted AFTER DELETE ON rides BEGIN
  INSERT INTO ride_tombstones VALUES (OLD.owner_id, OLD.idempotency_key, OLD.request_hash);
  INSERT INTO ride_history_revisions VALUES (OLD.owner_id, 1)
  ON CONFLICT(owner_id) DO UPDATE SET revision = revision + 1;
END;
-- Original source hashes are immutable geometry identities. Exact-file enrichment
-- also repairs legacy history without changing the route that was ridden.
CREATE TRIGGER route_geometry_created AFTER INSERT ON routes
WHEN json_type(NEW.route_json, '$.geometry') = 'object' BEGIN
  INSERT INTO ride_geometries VALUES (
    NEW.owner_id, json_extract(NEW.route_json, '$.sourceHash'), json_extract(NEW.route_json, '$.geometry')
  ) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER route_geometry_updated AFTER UPDATE OF route_json ON routes
WHEN json_type(NEW.route_json, '$.geometry') = 'object' BEGIN
  INSERT INTO ride_geometries VALUES (
    NEW.owner_id, json_extract(NEW.route_json, '$.sourceHash'), json_extract(NEW.route_json, '$.geometry')
  ) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER history_geometry_enriched AFTER INSERT ON ride_geometries
WHEN EXISTS (SELECT 1 FROM rides WHERE owner_id = NEW.owner_id AND source_hash = NEW.source_hash) BEGIN
  INSERT INTO ride_history_revisions VALUES (NEW.owner_id, 1)
  ON CONFLICT(owner_id) DO UPDATE SET revision = revision + 1;
END;
