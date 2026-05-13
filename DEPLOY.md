# Deploy checklist (Operation Jarvis)

## Supabase schema (required once per project)

If the Account page shows an error like **Could not find the table `public.trading_accounts` in the schema cache**, the Postgres table has not been created in that Supabase project yet.

1. Open the [Supabase dashboard](https://supabase.com/dashboard) for your project.
2. Go to **SQL Editor**.
3. Paste and run the full contents of **`schema/trading_accounts.sql`** from this repository (creates `trading_accounts`, `account_equity_snapshots`, indexes, and RLS policies).
4. Reload `/account.html`.

The web app does **not** auto-create tables via the REST API; migrations or manual SQL are required for new environments.

## Environment

Set production secrets in the Vercel dashboard (or your host) as described in `CLAUDE.md`. Never commit `.env`.

## Static data

Account page ticker and pair presets read from:

- `public/data/news-today.json` — manual curated lines (not a live scrape).
- `public/data/fx-pairs.json` — static pip sizing hints.
