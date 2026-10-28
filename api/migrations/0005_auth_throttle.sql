-- Per-IP auth attempt buckets for login/register throttling.
CREATE TABLE IF NOT EXISTS auth_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL DEFAULT 0
);
