CREATE TABLE IF NOT EXISTS notion_connections (
  user_id        TEXT PRIMARY KEY,
  access_token   TEXT NOT NULL,
  workspace_name TEXT,
  workspace_id   TEXT,
  bot_id         TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
