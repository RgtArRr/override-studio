-- Third-party API keys per account (intervals.icu), AES-GCM sealed.
CREATE TABLE IF NOT EXISTS provider_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  api_key TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, provider)
);
