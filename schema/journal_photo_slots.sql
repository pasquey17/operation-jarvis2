-- Per-user LOG TRADE chart photo slot templates (labels + order).
-- Trade images live in journal_trades.custom_data.photos [{ url, label }].

create table if not exists public.journal_photo_slots (
  id            uuid        primary key default gen_random_uuid(),
  user_id       text        not null,
  slot_id       text        not null,
  label         text        not null,
  display_order integer     not null default 0,
  created_at    timestamptz not null default now(),
  unique (user_id, slot_id)
);

create index if not exists journal_photo_slots_user_order_idx
  on public.journal_photo_slots (user_id, display_order asc);

alter table public.journal_photo_slots enable row level security;

create policy "allow anon all on journal_photo_slots" on public.journal_photo_slots
  for all using (true) with check (true);
