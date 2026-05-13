-- Trading accounts + manual equity snapshots (Operation Jarvis).
-- Run in Supabase SQL editor after backup if needed.
--
-- RLS: This project uses SUPABASE_SERVICE_ROLE_KEY from server.mjs for writes/reads.
-- If you enable RLS on these tables later, add policies that restrict rows by
-- auth.uid() mapped to user_id, or use a service-role-only pattern.

create table if not exists public.trading_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null default 'Account',
  account_type text not null check (account_type in ('eval', 'funded', 'live')),
  starting_balance numeric,
  profit_target numeric not null default 0,
  max_loss_limit numeric not null default 0,
  daily_loss_limit numeric,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.trading_accounts is
  'Manual trading / eval accounts with profit and loss limits; scoped by user_id.';
comment on column public.trading_accounts.starting_balance is
  'Optional baseline equity for progress math; if null, first snapshot equity is used.';
comment on column public.trading_accounts.profit_target is
  'Dollar distance from baseline toward profit pass (added to baseline = target equity).';
comment on column public.trading_accounts.max_loss_limit is
  'Dollar drawdown allowed from baseline (baseline - max_loss_limit = blow-up floor).';

create table if not exists public.account_equity_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  account_id uuid not null references public.trading_accounts (id) on delete cascade,
  equity numeric not null,
  recorded_at timestamptz not null default now(),
  note text
);

comment on table public.account_equity_snapshots is
  'Time series of account equity; every row must match trading_accounts.user_id.';
comment on column public.account_equity_snapshots.user_id is
  'Denormalized from trading_accounts for queries; server always stamps to match parent row.';

create index if not exists idx_trading_accounts_user on public.trading_accounts (user_id);
create index if not exists idx_trading_accounts_user_archived
  on public.trading_accounts (user_id, archived);
create index if not exists idx_account_snapshots_user_account
  on public.account_equity_snapshots (user_id, account_id, recorded_at desc);

alter table public.trading_accounts enable row level security;
create policy "allow anon all on trading_accounts" on public.trading_accounts
  for all using (true) with check (true);

alter table public.account_equity_snapshots enable row level security;
create policy "allow anon all on account_equity_snapshots" on public.account_equity_snapshots
  for all using (true) with check (true);
