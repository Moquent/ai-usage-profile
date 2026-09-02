CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  provider_id TEXT NOT NULL,
  username TEXT NOT NULL,
  card_config TEXT NOT NULL,
  publish_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0)
);

CREATE INDEX IF NOT EXISTS snapshots_received_at_idx ON snapshots(received_at);
