-- Monitoring and delivery are independent of the immutable accepted snapshot.
CREATE TABLE tracking_monitors (
  owner_id TEXT NOT NULL, plan_id TEXT NOT NULL,
  next_due_at TEXT NOT NULL, queued_until TEXT,
  lease_token TEXT, lease_until TEXT,
  state_json TEXT, input_revision TEXT,
  PRIMARY KEY(owner_id, plan_id),
  FOREIGN KEY(owner_id, plan_id) REFERENCES tracked_rides(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX tracking_monitor_due ON tracking_monitors(next_due_at, owner_id, plan_id);
CREATE TABLE push_devices (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL,
  token TEXT NOT NULL, environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
  topic TEXT NOT NULL, platform TEXT NOT NULL CHECK(platform IN ('ios','macos')),
  version INTEGER NOT NULL DEFAULT 1, registered_at TEXT NOT NULL,
  UNIQUE(environment, topic, token)
);
CREATE INDEX push_device_owner ON push_devices(owner_id);
CREATE TABLE tracking_notifications (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, plan_id TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  assessment_id TEXT, input_revision TEXT NOT NULL,
  decision_json TEXT NOT NULL, payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','superseded','cancelled','failed')),
  accepted_at TEXT,
  FOREIGN KEY(owner_id, plan_id) REFERENCES tracked_rides(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX tracking_notification_history ON tracking_notifications(owner_id, plan_id, created_at DESC, id);
CREATE TABLE push_deliveries (
  notification_id TEXT NOT NULL, device_id TEXT NOT NULL, device_version INTEGER NOT NULL,
  apns_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
  accepted_at TEXT, reason TEXT,
  PRIMARY KEY(notification_id, device_id),
  FOREIGN KEY(notification_id) REFERENCES tracking_notifications(id) ON DELETE CASCADE
);
-- Shared provider tokens avoid signing a different JWT in every Worker isolate.
CREATE TABLE push_provider_tokens (
  key_hash TEXT PRIMARY KEY NOT NULL, token TEXT NOT NULL, issued_at INTEGER NOT NULL
);
INSERT INTO tracking_monitors(owner_id,plan_id,next_due_at)
  SELECT owner_id,id,created_at FROM tracked_rides WHERE state = 'active';
CREATE TRIGGER tracking_monitor_insert AFTER INSERT ON tracked_rides WHEN NEW.state = 'active' BEGIN
  INSERT INTO tracking_monitors(owner_id,plan_id,next_due_at) VALUES (NEW.owner_id,NEW.id,NEW.created_at);
END;
CREATE TRIGGER tracking_monitor_stop AFTER UPDATE OF state ON tracked_rides WHEN NEW.state = 'inactive' BEGIN
  DELETE FROM tracking_monitors WHERE owner_id = NEW.owner_id AND plan_id = NEW.id;
  UPDATE tracking_notifications SET status = 'cancelled' WHERE owner_id = NEW.owner_id AND plan_id = NEW.id AND status = 'pending';
  UPDATE push_deliveries SET status = 'cancelled' WHERE status = 'pending' AND notification_id IN
    (SELECT id FROM tracking_notifications WHERE owner_id = NEW.owner_id AND plan_id = NEW.id);
END;
