-- Shared public weather only: no route identities, GPX or owner details.
CREATE TABLE ground_evidence_days (
  cache_key TEXT NOT NULL,
  date TEXT NOT NULL,
  day_json TEXT NOT NULL,
  retained_until INTEGER NOT NULL,
  PRIMARY KEY (cache_key, date)
);
CREATE INDEX ground_evidence_retention ON ground_evidence_days(retained_until);
CREATE TABLE ground_evidence_leases (
  cache_key TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE ground_evidence_usage (
  date TEXT PRIMARY KEY,
  http_attempts INTEGER NOT NULL,
  reserved_units INTEGER NOT NULL
);
