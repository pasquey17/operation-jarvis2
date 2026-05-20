create table if not exists user_profiles (
  auth_user_id uuid primary key references auth.users(id),
  trading_style text,
  markets text[],
  trading_windows text[],
  biggest_struggle text,
  goals text,
  timezone text,
  onboarding_complete boolean default false,
  onboarding_completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
