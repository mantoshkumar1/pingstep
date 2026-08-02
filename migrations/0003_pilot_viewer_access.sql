-- A one-time, per-job viewer token gives a pilot user read-only access to that job.
-- As with ingest tokens, only the SHA-256 hash is stored.
ALTER TABLE jobs ADD COLUMN viewer_token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_by_viewer_token_hash ON jobs (viewer_token_hash);
