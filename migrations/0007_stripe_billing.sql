CREATE TABLE IF NOT EXISTS billing_subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('pro', 'team')),
  status TEXT NOT NULL,
  current_period_end TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_by_user ON billing_subscriptions (user_id, updated_at DESC);
