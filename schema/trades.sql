-- Run in Supabase SQL editor to set up or migrate the trades table.
-- notion_id is the unique key — each Notion page maps to exactly one row.

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  date timestamptz not null,
  user_id text,
  session text,
  outcome text,
  rr numeric,
  model text not null default '',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trades enable row level security;

-- If upgrading from the old date+model unique constraint, run:
--   alter table public.trades drop constraint if exists trades_date_model_key;
--   alter table public.trades add column if not exists notion_id text unique;
--   alter table public.trades add column if not exists user_id text;

-- Example policy for anon (dev only):
-- create policy "allow anon all on trades" on public.trades for all using (true) with check (true);

-- Persistent memory layer: one row per user, accumulates over time.
create table if not exists public.user_profiles (
  user_id text primary key,
  trading_summary text,
  psychological_patterns text,
  key_triggers text,
  strengths text,
  last_updated timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

-- Example policy for anon (dev only):
-- create policy "allow anon all on user_profiles" on public.user_profiles for all using (true) with check (true);
