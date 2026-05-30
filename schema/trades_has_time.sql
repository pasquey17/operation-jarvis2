alter table trades add column if not exists has_time boolean default false;
grant all on table trades to anon, authenticated, service_role;
notify pgrst, 'reload schema';
