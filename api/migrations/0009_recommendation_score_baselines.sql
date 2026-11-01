-- Compact score-comparison metadata, independent of the pending ride-learning
-- snapshot migration. No forecast payloads or route geometry are retained here.
CREATE TABLE recommendation_score_baselines (
  owner_id TEXT NOT NULL,
  comparison_key TEXT NOT NULL,
  route_id TEXT NOT NULL,
  score REAL NOT NULL CHECK(score >= 0 AND score <= 100),
  generated_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, comparison_key),
  FOREIGN KEY (owner_id, route_id) REFERENCES routes(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX recommendation_score_baselines_expiry
  ON recommendation_score_baselines(owner_id, expires_at);
CREATE INDEX recommendation_score_baselines_age
  ON recommendation_score_baselines(owner_id, generated_at);
