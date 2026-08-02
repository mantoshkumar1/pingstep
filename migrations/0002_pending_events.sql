-- Events that arrive before `started` are retained for the contract's 15-minute
-- reordering window, then excluded from the run projection.
CREATE TABLE IF NOT EXISTS pending_events (
  event_id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  expired_at TEXT,
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pending_events_expiry ON pending_events (expires_at);
