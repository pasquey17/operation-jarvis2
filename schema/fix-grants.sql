-- fix-grants.sql
-- Run this in the Supabase SQL editor to fix the PostgREST schema cache.
--
-- Root cause: tables created via the SQL editor don't get automatic grants.
-- PostgREST only caches tables visible to the anon/authenticated/service_role
-- roles. Without these grants the table is invisible to the REST API and
-- "notify pgrst, 'reload schema'" has no effect.

grant usage on schema public to anon, authenticated;
grant all on table public.trading_accounts to anon, authenticated, service_role;
grant all on table public.equity_log_entries to anon, authenticated, service_role;
grant all on table public.payouts to anon, authenticated, service_role;

notify pgrst, 'reload schema';
