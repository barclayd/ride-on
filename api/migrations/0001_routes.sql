CREATE TABLE IF NOT EXISTS routes (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  route_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX IF NOT EXISTS routes_by_owner_created ON routes (owner_id, created_at DESC);
