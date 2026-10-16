-- Tracking plans are independent of completed rides and route-library retention.
CREATE TABLE tracking_contexts (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, context_json TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX tracking_context_expiry ON tracking_contexts(expires_at);
CREATE INDEX tracking_context_owner ON tracking_contexts(owner_id, created_at);
CREATE TABLE tracking_recommendations (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, context_id TEXT NOT NULL,
  departure_at TEXT NOT NULL, candidate_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, context_id) REFERENCES tracking_contexts(owner_id, id) ON DELETE CASCADE
);
CREATE TABLE tracking_accounts (
  owner_id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL DEFAULT 0,
  active_id TEXT, mutation_token TEXT
);
CREATE TABLE tracked_rides (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, route_id TEXT NOT NULL,
  departure_at TEXT NOT NULL, finish_at TEXT NOT NULL, time_zone TEXT NOT NULL,
  created_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','inactive')),
  ended_at TEXT, ended_reason TEXT, version INTEGER NOT NULL DEFAULT 1,
  baseline_json TEXT NOT NULL, latest_id TEXT,
  last_attempt_at TEXT, last_success_at TEXT, refresh_result TEXT NOT NULL DEFAULT 'not_checked',
  refresh_reason TEXT, lease_token TEXT, lease_until TEXT,
  PRIMARY KEY(owner_id, id)
);
CREATE UNIQUE INDEX tracking_one_active ON tracked_rides(owner_id) WHERE state = 'active';
CREATE INDEX tracking_history ON tracked_rides(owner_id, created_at DESC, id);
CREATE TABLE tracking_assessments (
  owner_id TEXT NOT NULL, plan_id TEXT NOT NULL, id TEXT NOT NULL,
  created_at TEXT NOT NULL, evidence_hash TEXT NOT NULL, assessment_json TEXT NOT NULL,
  PRIMARY KEY(owner_id, plan_id, id),
  UNIQUE(owner_id, plan_id, evidence_hash),
  FOREIGN KEY(owner_id, plan_id) REFERENCES tracked_rides(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX tracking_assessment_history ON tracking_assessments(owner_id, plan_id, created_at DESC, id);
-- No FK: the opaque action survives explicit plan erasure to prevent resurrection.
CREATE TABLE tracking_actions (
  owner_id TEXT NOT NULL, action_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  plan_id TEXT NOT NULL, outcome TEXT NOT NULL, replaced_id TEXT,
  PRIMARY KEY(owner_id, action_key)
);
CREATE TRIGGER tracking_insert AFTER INSERT ON tracked_rides WHEN NEW.state = 'active' BEGIN
  UPDATE tracking_accounts SET active_id = NEW.id, version = version + 1 WHERE owner_id = NEW.owner_id;
END;
CREATE TRIGGER tracking_end AFTER UPDATE OF state ON tracked_rides
WHEN OLD.state = 'active' AND NEW.state = 'inactive' BEGIN
  UPDATE tracking_accounts SET active_id = NULL, version = version + 1
    WHERE owner_id = NEW.owner_id AND active_id = NEW.id;
END;
