-- Attach screenshot / chart URLs to each trade row for journal display.
-- Run once in Supabase SQL editor after backup if needed.

alter table public.trades
  add column if not exists trade_images jsonb not null default '[]'::jsonb;

comment on column public.trades.trade_images is
  'Array of image URLs (from Notion file properties or uploads), newest-first optional.';
