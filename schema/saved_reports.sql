-- Saved (cached) AI-generated reports.
-- Run in Supabase SQL editor.
--
-- period_key = "{type}:{dateFrom}" e.g. "week:2026-06-09", "month:2026-06-01", "quarter:2026-04-01"
-- This is deterministic: dateFrom is always the first day of the period.
-- Unique on (user_id, report_type, period_key) — one saved copy per user per period.

CREATE TABLE IF NOT EXISTS public.saved_reports (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              TEXT NOT NULL,
  report_type          TEXT NOT NULL,   -- 'week' | 'month' | 'quarter'
  period_key           TEXT NOT NULL,   -- '{type}:{dateFrom}'
  date_from            TEXT NOT NULL,   -- 'YYYY-MM-DD'
  date_to              TEXT NOT NULL,   -- 'YYYY-MM-DD'
  html                 TEXT NOT NULL,
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_regenerated_at  TIMESTAMPTZ,     -- set on current-period regenerations

  CONSTRAINT saved_reports_user_type_period_uq UNIQUE (user_id, report_type, period_key)
);

CREATE INDEX IF NOT EXISTS saved_reports_user_type_idx
  ON public.saved_reports (user_id, report_type);

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow anon all on saved_reports" ON public.saved_reports
  FOR ALL USING (true) WITH CHECK (true);
