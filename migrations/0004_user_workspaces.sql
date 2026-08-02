CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sessions_by_token_hash ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions (expires_at);

ALTER TABLE jobs ADD COLUMN owner_user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS jobs_by_owner ON jobs (owner_user_id, job_key);
