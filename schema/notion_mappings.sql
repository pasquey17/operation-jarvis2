CREATE TABLE IF NOT EXISTS notion_mappings (
  user_id     TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  mapping     JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notion_mappings DISABLE ROW LEVEL SECURITY;
