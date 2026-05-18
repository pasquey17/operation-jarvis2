-- Weekly deep-think columns on intelligence_files (step 5).
-- Run in Supabase SQL editor after intelligence_files exists.

ALTER TABLE public.intelligence_files
  ADD COLUMN IF NOT EXISTS deep_think TEXT;

ALTER TABLE public.intelligence_files
  ADD COLUMN IF NOT EXISTS deep_think_at TIMESTAMPTZ;

ALTER TABLE public.intelligence_files
  ADD COLUMN IF NOT EXISTS deep_think_trade_count INT;
