-- Expand user_profiles memory layer (run once in Supabase SQL editor)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS trading_rules TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS edge_map TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS progress_notes TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS jarvis_observations TEXT;
