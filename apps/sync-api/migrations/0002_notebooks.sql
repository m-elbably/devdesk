CREATE TABLE IF NOT EXISTS notebooks (
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
CREATE INDEX IF NOT EXISTS idx_notebooks_pull ON notebooks (user_id, seq);
