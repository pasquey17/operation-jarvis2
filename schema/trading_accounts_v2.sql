-- trading_accounts_v2.sql
-- Run in Supabase SQL editor to create the v2 account tracking tables.
-- IMPORTANT: if a trading_accounts table already exists with the old schema,
-- drop it first (back up any data you need):
--   drop table if exists equity_log_entries cascade;
--   drop table if exists payouts cascade;
--   drop table if exists trading_accounts cascade;

create table if not exists trading_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  type text not null check (type in ('eval','funded','live')),
  firm_name text,
  starting_balance numeric not null,
  current_equity numeric not null,
  profit_target numeric,
  daily_loss_cap numeric,
  max_drawdown numeric,
  default_risk_pct numeric default 1,
  default_pair text,
  status text not null default 'active' check (status in ('active','passed','blown','archived')),
  created_at timestamptz default now(),
  archived_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists equity_log_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references trading_accounts(id) on delete cascade,
  user_id text not null,
  equity numeric not null,
  logged_at timestamptz default now(),
  note text
);

create table if not exists payouts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references trading_accounts(id) on delete cascade,
  user_id text not null,
  amount numeric not null,
  paid_at timestamptz default now(),
  note text
);

create index if not exists idx_trading_accounts_user on trading_accounts(user_id);
create index if not exists idx_equity_log_account on equity_log_entries(account_id);
create index if not exists idx_payouts_account on payouts(account_id);
