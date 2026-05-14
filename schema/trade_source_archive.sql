-- Optional migration: source tagging + soft-archive for stale Notion rows.
-- Run once in Supabase SQL editor. Required for /api/trades archived filter and OAuth tagging.

alter table public.trades add column if not exists archived boolean not null default false;
alter table public.trades add column if not exists notion_sync_source text;

comment on column public.trades.archived is 'When true, row is hidden from /api/trades unless include_archived=1. Set by POST /api/notion/reconcile-archive.';
comment on column public.trades.notion_sync_source is 'oauth = synced via Notion OAuth mapping; env = legacy NOTION_API_KEY sync; null = unknown legacy.';

create index if not exists trades_user_archived_idx on public.trades (user_id, archived);
