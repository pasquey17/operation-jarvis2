-- trading_accounts_v2_1.sql
-- Run in Supabase SQL editor AFTER trading_accounts_v2.sql and fix-grants.sql.
-- Adds type-specific columns to trading_accounts and gross/net columns to payouts.

alter table public.trading_accounts
  add column if not exists profit_split_pct        numeric,
  add column if not exists payout_frequency        text,
  add column if not exists minimum_trading_days    integer,
  add column if not exists broker_name             text,
  add column if not exists personal_monthly_target numeric;

alter table public.payouts
  add column if not exists gross_amount numeric,
  add column if not exists split_pct    numeric,
  add column if not exists net_amount   numeric;

grant all on table public.trading_accounts  to anon, authenticated, service_role;
grant all on table public.payouts           to anon, authenticated, service_role;
grant all on table public.equity_log_entries to anon, authenticated, service_role;

notify pgrst, 'reload schema';
