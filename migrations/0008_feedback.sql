CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  email TEXT,
  page TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL
);
