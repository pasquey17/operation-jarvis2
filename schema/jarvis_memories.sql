-- Jarvis conversation memory (one row per extracted observation)
create table if not exists public.jarvis_memories (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  memory text not null,
  category text,
  importance int default 5,
  created_at timestamptz default now(),
  last_referenced timestamptz,
  reference_count int default 0
);

create index if not exists idx_jarvis_memories_user on jarvis_memories(user_id);

alter table public.jarvis_memories enable row level security;

-- Example policy for anon (dev only):
-- create policy "allow anon all on jarvis_memories" on public.jarvis_memories for all using (true) with check (true);
