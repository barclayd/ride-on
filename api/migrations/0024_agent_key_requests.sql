-- The requesting computer holds the secret. Approval stores only its hash.
CREATE TABLE agent_key_requests (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_in_days INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  user_id TEXT REFERENCES auth_user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX agent_key_requests_expiry ON agent_key_requests(expires_at);
