ALTER TABLE routes ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE routes ADD COLUMN updated_at TEXT;
ALTER TABLE routes ADD COLUMN source_provider TEXT;
ALTER TABLE routes ADD COLUMN source_external_id TEXT;

CREATE UNIQUE INDEX routes_by_source ON routes(owner_id, source_provider, source_external_id);

CREATE TABLE route_selections (
  owner_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  selection_json TEXT NOT NULL
);
