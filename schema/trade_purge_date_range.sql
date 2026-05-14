-- Purge trades in a calendar date window (timestamptz `date` column).
-- Why these rows exist: they were upserted from an older Notion data source / env sync / wrong
-- template before your current OAuth DB. The app only displays what is in `public.trades`.
--
-- SAFER alternative (no delete): run OAuth sync, then POST /api/notion/reconcile-archive with
-- JARVIS_RECONCILE_SECRET — that sets archived=true for notion_ids not in your *current* Notion DB.
--
-- 1) PREVIEW — run first and confirm the rows listed are the ones you want gone.
SELECT notion_id, date, notion_sync_source, archived, pair, model, outcome, rr
FROM public.trades
WHERE user_id = 'aidenpasque11@gmail.com'
  AND date >= '2026-06-04 00:00:00+00'::timestamptz
  AND date <  '2026-11-15 00:00:00+00'::timestamptz
ORDER BY date DESC;

-- 2) HARD DELETE — irreversible. Change user_id if needed (e.g. spasque70@gmail.com).
--    Adjust the date bounds if your rows use Australia-local midnight in `date` (re-run preview).
DELETE FROM public.trades
WHERE user_id = 'aidenpasque11@gmail.com'
  AND date >= '2026-06-04 00:00:00+00'::timestamptz
  AND date <  '2026-11-15 00:00:00+00'::timestamptz;
