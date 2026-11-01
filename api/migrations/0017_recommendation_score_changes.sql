-- One persistent last-change badge per shortlisted route and requested plan.
CREATE TABLE recommendation_score_changes (
  owner_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  plan_key TEXT NOT NULL,
  context_key TEXT NOT NULL,
  reference_score INTEGER NOT NULL CHECK(reference_score BETWEEN 0 AND 100),
  change_json TEXT,
  revision TEXT NOT NULL,
  evaluated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, route_id, plan_key),
  FOREIGN KEY (owner_id, route_id) REFERENCES routes(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX recommendation_score_changes_age
  ON recommendation_score_changes(owner_id, evaluated_at);

-- Removal must clear state in the same transaction as the shortlist CAS,
-- including a remove followed immediately by an add on another device.
CREATE TRIGGER clear_removed_route_score_changes
AFTER UPDATE OF selection_json ON route_selections
BEGIN
  DELETE FROM recommendation_score_changes
  WHERE owner_id = NEW.owner_id AND route_id NOT IN (
    SELECT value FROM json_each(NEW.selection_json, '$.routeIds')
  );
END;
CREATE TRIGGER clear_deleted_selection_score_changes
AFTER DELETE ON route_selections
BEGIN
  DELETE FROM recommendation_score_changes WHERE owner_id = OLD.owner_id;
END;
