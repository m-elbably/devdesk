-- DevDesk sync schema. Each synced entity gets its own table (per spec), sharing a
-- common shape: key columns for indexing + a JSON `data` blob holding the full record.
-- This keeps the sync endpoints generic while still giving real per-entity tables/indexes.

-- The single-admin rule is a database constraint rather than app code: a partial
-- unique index makes a second admin row impossible no matter which code path
-- tries to insert it.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'user',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_admin ON users (role) WHERE role = 'admin';

CREATE TABLE IF NOT EXISTS workspaces (
  id           TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  revision     INTEGER NOT NULL DEFAULT 0,
  seq          INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  data         TEXT NOT NULL,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_workspaces_pull ON workspaces (user_id, seq);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  revision     INTEGER NOT NULL DEFAULT 0,
  seq          INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  data         TEXT NOT NULL,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_pull ON tasks (user_id, seq);

CREATE TABLE IF NOT EXISTS notes (
  id           TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  revision     INTEGER NOT NULL DEFAULT 0,
  seq          INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  data         TEXT NOT NULL,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notes_pull ON notes (user_id, seq);

CREATE TABLE IF NOT EXISTS snippets (
  id           TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  revision     INTEGER NOT NULL DEFAULT 0,
  seq          INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  data         TEXT NOT NULL,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_snippets_pull ON snippets (user_id, seq);

CREATE TABLE IF NOT EXISTS settings (
  id           TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  revision     INTEGER NOT NULL DEFAULT 0,
  seq          INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  data         TEXT NOT NULL,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_settings_pull ON settings (user_id, seq);

-- Advisory record of each user's last acknowledged pull cursor.
CREATE TABLE IF NOT EXISTS sync_state (
  user_id TEXT PRIMARY KEY,
  cursor  TEXT NOT NULL
);
