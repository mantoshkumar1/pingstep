CREATE TABLE IF NOT EXISTS oauth_identities (
  provider TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS oauth_identities_by_user ON oauth_identities (user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_states_by_expiry ON oauth_states (expires_at);
