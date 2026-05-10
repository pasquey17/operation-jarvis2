-- Full Notion property dump per trade row (synced from page.properties).
-- Run once in Supabase SQL editor after backup if needed.

alter table public.trades
  add column if not exists notion_extras jsonb not null default '{}'::jsonb;

comment on column public.trades.notion_extras is
  'JSON snapshot of all Notion page properties (serialized to JSON-safe values). First-class columns remain the source for queries/UI.';
