-- =====================================================================
-- journal_fields
-- Defines what fields each user tracks in their trade journal.
-- Covers both standard fields (session, outcome, rr) and custom fields
-- that flow into journal_trades.custom_data.
-- =====================================================================

create table if not exists public.journal_fields (
  id            uuid      primary key default gen_random_uuid(),
  user_id       text      not null,
  field_name    text      not null,
  field_type    text      not null check (field_type in ('text', 'number', 'dropdown', 'multiselect')),
  field_options text,                          -- JSON array string for dropdown/multiselect options
  is_required   boolean   not null default false,
  display_order integer   not null default 0,
  created_at    timestamptz not null default now(),
  unique (user_id, field_name)
);

alter table public.journal_fields enable row level security;

create policy "allow anon all on journal_fields" on public.journal_fields
  for all using (true) with check (true);


-- =====================================================================
-- journal_trades
-- Flexible trade entries. Standard fields are explicit columns.
-- Everything else (entry model, confluence, psychology, etc.) lives in
-- custom_data so users can track whatever they want without schema changes.
-- notion_id links the row back to Notion if the user has it connected.
-- =====================================================================

create table if not exists public.journal_trades (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  traded_at   timestamptz not null,
  pair        text,
  outcome     text,
  rr          numeric,
  session     text,
  account     text,
  custom_data jsonb       not null default '{}'::jsonb,
  notion_id   text        unique,
  created_at  timestamptz not null default now()
);

create index if not exists journal_trades_user_id_idx  on public.journal_trades (user_id);
create index if not exists journal_trades_traded_at_idx on public.journal_trades (traded_at desc);
create index if not exists journal_trades_custom_data_idx on public.journal_trades using gin (custom_data);

alter table public.journal_trades enable row level security;

create policy "allow anon all on journal_trades" on public.journal_trades
  for all using (true) with check (true);


-- =====================================================================
-- Seed: default field schema for Aiden (aidenpasque11@gmail.com)
-- Mirrors his current Notion template: Date, SESSION, Outcome, RR,
-- ENTRY MODEL, TRADE SUMMARY
-- =====================================================================

insert into public.journal_fields
  (user_id, field_name, field_type, field_options, is_required, display_order)
values
  (
    'aidenpasque11@gmail.com',
    'Date',
    'text',
    null,
    true,
    1
  ),
  (
    'aidenpasque11@gmail.com',
    'Session',
    'dropdown',
    '["Asia","London","New York","London/New York"]',
    true,
    2
  ),
  (
    'aidenpasque11@gmail.com',
    'Outcome',
    'dropdown',
    '["Win","Loss","BE"]',
    true,
    3
  ),
  (
    'aidenpasque11@gmail.com',
    'RR',
    'number',
    null,
    false,
    4
  ),
  (
    'aidenpasque11@gmail.com',
    'Entry Model',
    'dropdown',
    '["BOS","MTF Weak Structure","Swing Fail","LTF Range","Premium/Discount","Other"]',
    false,
    5
  ),
  (
    'aidenpasque11@gmail.com',
    'Trade Summary',
    'text',
    null,
    false,
    6
  )
on conflict (user_id, field_name) do nothing;


-- =====================================================================
-- Seed: default field schema for Sherri (spasque70@gmail.com)
-- Mirrors her current Notion template: Date, SESSION, Outcome, RR,
-- ENTRY MODEL, TRADE SUMMARY
-- =====================================================================

insert into public.journal_fields
  (user_id, field_name, field_type, field_options, is_required, display_order)
values
  (
    'spasque70@gmail.com',
    'Date',
    'text',
    null,
    true,
    1
  ),
  (
    'spasque70@gmail.com',
    'Session',
    'dropdown',
    '["Asia","London","New York","London/New York"]',
    true,
    2
  ),
  (
    'spasque70@gmail.com',
    'Outcome',
    'dropdown',
    '["Win","Loss","BE","W/L"]',
    true,
    3
  ),
  (
    'spasque70@gmail.com',
    'RR',
    'number',
    null,
    false,
    4
  ),
  (
    'spasque70@gmail.com',
    'Entry Model',
    'dropdown',
    '["BOS","MTF Weak Structure","Swing Fail","LTF Range","Premium/Discount","Other"]',
    false,
    5
  ),
  (
    'spasque70@gmail.com',
    'Trade Summary',
    'text',
    null,
    false,
    6
  )
on conflict (user_id, field_name) do nothing;
