CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  definition TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'builtin',
  prompt TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
