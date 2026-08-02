-- Durable source of truth for the hosted PingStep MVP.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jobs (
  job_key TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  expected_update_interval_seconds INTEGER NOT NULL DEFAULT 300,
  liveness_grace_seconds INTEGER NOT NULL DEFAULT 600,
  expected_duration_seconds INTEGER,
  late_grace_seconds INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (expected_update_interval_seconds > 0),
  CHECK (liveness_grace_seconds >= 0),
  CHECK (expected_duration_seconds IS NULL OR expected_duration_seconds > 0),
  CHECK (late_grace_seconds IS NULL OR late_grace_seconds >= 0)
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  job_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('started', 'step', 'heartbeat', 'succeeded', 'failed', 'cancelled')),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  FOREIGN KEY (job_key) REFERENCES jobs(job_key),
  CHECK (sequence > 0)
);
CREATE INDEX IF NOT EXISTS events_by_run ON events (job_key, run_id, sequence, received_at);

CREATE TABLE IF NOT EXISTS runs (
  job_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'stale', 'succeeded', 'failed')),
  started_at TEXT NOT NULL,
  started_received_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  latest_sequence INTEGER NOT NULL,
  latest_event_type TEXT NOT NULL,
  last_liveness_received_at TEXT NOT NULL,
  liveness_deadline TEXT,
  late_deadline TEXT,
  is_late INTEGER NOT NULL DEFAULT 0 CHECK (is_late IN (0, 1)),
  late_at TEXT,
  late_transitions INTEGER NOT NULL DEFAULT 0,
  stale_at TEXT,
  stale_transitions INTEGER NOT NULL DEFAULT 0,
  job_version TEXT,
  current_step TEXT,
  terminal_event_id TEXT,
  terminal_conflict_json TEXT,
  PRIMARY KEY (job_key, run_id),
  FOREIGN KEY (job_key) REFERENCES jobs(job_key)
);
CREATE INDEX IF NOT EXISTS runs_by_status_update ON runs (status, received_at DESC);
CREATE INDEX IF NOT EXISTS runs_by_liveness_deadline ON runs (status, liveness_deadline);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('stale', 'late')),
  job_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  delivered_at TEXT,
  last_error TEXT,
  FOREIGN KEY (job_key, run_id) REFERENCES runs(job_key, run_id)
);
CREATE INDEX IF NOT EXISTS alerts_for_delivery ON alerts (delivery_status, created_at);
