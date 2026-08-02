CREATE TABLE IF NOT EXISTS account_plans (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('trial', 'pro', 'team')) DEFAULT 'trial',
  active_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_plans_by_active_until ON account_plans (active_until);

