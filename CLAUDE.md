# CLAUDE.md — Operation Jarvis Project Bible

## What Jarvis Is

Jarvis is a personal AI trading intelligence OS. It ingests trades logged in Notion, syncs them to Supabase, computes performance stats, and surfaces them through an animated HUD-style web app. An embedded Claude-powered chat acts as a second brain — giving real-time coaching, morning briefings, and trade analysis specific to the trader's actual history. It is not a SaaS product. It is a private tool built for two traders: Aiden and his mum.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js ESM (`server.mjs`), plain `http` module, port 8787 locally |
| Deployment | Vercel — all traffic rewrites to `api/index.mjs`; `vercel.json` configures this |
| Database | Supabase (PostgreSQL via PostgREST REST API) |
| AI | Anthropic Claude API — model `claude-haiku-4-5-20251001` |
| Data source | Notion (via Notion API data_sources query) |
| Frontend | Vanilla JS, no framework, no build step |
| Fonts | Outfit (display) + Share Tech Mono (mono/nav) via Google Fonts |
| Env vars | `.env` locally (gitignored), Vercel dashboard in production |

**Start locally:** `node server.mjs` → http://localhost:8787

**Deploy:** push to `main` → Vercel auto-deploys.

---

## Users

| Name | Email | Notion sync |
|---|---|---|
| Aiden | `aidenpasque11@gmail.com` | `notion-sync.mjs` / `NOTION_API_KEY` |
| Mum (Sandra) | `spasque70@gmail.com` | `notion-sync-mum.mjs` / `NOTION_API_KEY_MUM` |

`currentUserId` defaults to `aidenpasque11@gmail.com` — there is no login gate. Resolution order (**must stay in sync in `app.js` and `journal.html`**): **`jarvis_user` first**, then `user_id`, then default. If both keys exist but differ (e.g. mum set `jarvis_user` while an old `user_id` was still Aiden’s), **`jarvis_user` wins** and `user_id` is updated to match. Do not add a login modal.

---

## Supabase Tables

| Table | Has `user_id`? | Purpose |
|---|---|---|
| `trades` | YES | Notion-synced trade history. Conflict key: `notion_id`. Optional `trade_images` (jsonb array of URLs) for journal charts — `schema/trade_images.sql`. **`notion_extras`** (jsonb) stores a full serialized snapshot of every Notion page property — `schema/notion_extras.sql`. Core columns (`date`, `session`, `outcome`, etc.) remain the source for queries and UI. |
| `journal_trades` | YES | Manually logged trades from the LOG TRADE form. |
| `journal_fields` | YES | Per-user journal field configuration. |
| `user_profiles` | YES | AI-generated trader profiles stored as text blobs. |

All queries against every table must filter by `user_id`. The `trades` table was added a `user_id TEXT` column on 2026-05-07; all historical rows were stamped `aidenpasque11@gmail.com` at that point.

### Notion sync stamps `user_id` on every upsert

- `notion-sync.mjs` → `notionPageToTrade()` returns `user_id: "aidenpasque11@gmail.com"`
- `notion-sync-mum.mjs` → `notionPageToTrade()` returns `user_id: "spasque70@gmail.com"`
- Both files include `user_id` in the explicit upsert column list sent to Supabase.

---

## Required Environment Variables

```
SUPABASE_URL=https://oiyyrpfphefswaesddgw.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=...
NOTION_API_KEY=...           # Aiden's Notion integration
NOTION_API_KEY_MUM=...       # Mum's Notion integration
```

`.env` is on line 1 of `.gitignore`. It is NEVER committed. On Vercel, set all vars in the dashboard under Settings → Environment Variables.

---

## Pages

| File | Route | Status | Description |
|---|---|---|---|
| `public/index.html` | `/` | Live | Home: animated orb, live telemetry, Jarvis chat |
| `public/journal.html` | `/journal.html` | Live | Journal: trade log, filter/review |
| `public/analytics.html` | `/analytics.html` | **Not built** | Nav link exists, returns 404 |
| `public/history.html` | `/history.html` | **Not built** | Nav link exists, returns 404 |
| `public/calendar.html` | `/calendar.html` | **Not built** | Nav link exists, returns 404 |

The nav bar is duplicated inline in `index.html` and `journal.html` — it is not a shared component. When adding pages, copy the full nav block from an existing page.

---

## API Endpoints

| Method | Path | Handler | Description |
|---|---|---|---|
| `GET` | `/api/trades?user_id=eq.{userId}` | `handleTrades` | Fetch all trades. Triggers Notion sync if stale (default: last sync &gt;60s; override with `NOTION_SYNC_INTERVAL_MS`, min 10000). |
| `GET` | `/api/snapshot` | `handleSnapshot` | Snapshot stats — same data as `payload.snapshot` inside `/api/trades`. Runs the same stale Notion sync as `/api/trades`. |
| `POST` | `/api/chat` | `handleChat` | Jarvis chat. Body: `{ message, history, userId }` |
| `POST` | `/api/briefing` | `handleBriefing` | Generate morning briefing from recent trades. |
| `GET` | `/api/sync-notion` | `handleSyncNotion` | Manually trigger Notion → Supabase sync for Aiden. |
| `GET` | `/api/sync-mum` | inline | Manually trigger Notion → Supabase sync for mum. |
| `GET` | `/api/journal-fields?user_id=eq.{userId}` | `handleJournalFields` | Get journal field config for user. |
| `POST` | `/api/log-trade` | `handleLogTrade` | Log a trade to `journal_trades`. |
| `GET` | `/api/init-profiles` | `handleInitProfiles` | Admin: generate initial AI profiles for both users. |

**Note:** `/api/sync` is not used by the app; use `/api/sync-notion` or `/api/sync-mum` to force sync.

---

## CSS Design System

### Colour tokens (`:root` in `style.css`)

```css
--bg: #000000          /* pure black background */
--blue: #00BFFF        /* electric blue — primary accent */
--silver: #C0C0C0      /* silver — secondary accent */
--text: #FFFFFF        /* white body text */
--muted: #8899AA       /* muted grey for secondary labels */
```

Nav uses `#00d4ff` (slightly different electric blue) for active states and brand.

### Fonts

- **Display / body:** `"Outfit"` — weights 200/300/400/500/600
- **Mono / nav / labels:** `"Share Tech Mono"`, fallback `"Courier New"`

### Aesthetic — HUD / Sci-fi OS

- Pure black background with animated particle canvas (`#particle-canvas`, z-index 0, pointer-events none)
- Animated orb canvas (`#orb-canvas`, 560×560 desktop, clamps to 280px on mobile)
- Corner bracket decorations (`.hud-corner--tl/tr/bl/br`) with `rgba(0,191,255,0.18)` border
- Glassmorphism panels: `background: rgba(0,0,0,0.85)` + `backdrop-filter: blur(20px)`
- Border accents: `1px solid rgba(0,212,255,0.2)` or `rgba(0,191,255,0.08)`
- Glow effects: `box-shadow: 0 0 16px rgba(0,191,255,0.65)`
- Border radii: `--radius-panel: 20px`, `--radius-soft: 14px`
- Text: uppercase mono labels at `0.12em` letter-spacing for nav items and eyebrows
- Transitions: `cubic-bezier(0.22, 1, 0.36, 1)` for smooth ease-out

### Mobile breakpoint: `max-width: 768px`

- Nav collapses to hamburger menu
- LOG TRADE button moves inline into chat form row (`.chat-log-trade-btn` becomes visible, fixed `#log-trade-btn` hides)
- Orb canvas: `clamp(160px, 60vw, 280px)`
- All fetches use `cache: 'no-store'` to prevent Safari mobile caching

---

## AI Model

**Always use `claude-haiku-4-5-20251001`** for all Anthropic API calls in this project. Sonnet and Opus are too expensive for per-chat usage. If Anthropic releases a new Haiku model, update the `ANTHROPIC_MODEL` constant in `server.mjs`. Do not switch to Sonnet unless explicitly asked.

Token budgets:
- `MAX_OUTPUT_TOKENS`: 2048 (briefing)
- `MAX_CHAT_OUTPUT_TOKENS`: 768 (chat)
- `MAX_CHAT_MESSAGES`: 5 (conversation history sent to API)
- `MAX_BRIEFING_TRADES`: 30 (trades sent for briefing analysis)

**Chat trade payload:** Default prompts use slim rows — core fields plus truncated `notes` only. Full `notion_extras` is **not** sent on every turn. When the user asks about extra Notion dimensions (psychology, HTF/LTF, volume, tags, etc.) or when their wording matches a property name in `notion_extras`, `handleChat` attaches a **character-capped slice** of `notion_extras` for the scoped trade rows only (`server.mjs`).

---

## Known Bugs / Issues

1. ~~**`/api/sync` 404**~~ — **Fixed:** `boot()` no longer calls `/api/sync`. Use **`GET /api/sync-notion`** or **`GET /api/sync-mum`** manually when you need to force Notion ingest.

2. **Analytics / History / Calendar pages** — Nav links to `/analytics.html`, `/history.html`, `/calendar.html` all 404. These pages have not been built yet.

3. **Nav duplication** — The nav bar HTML is copy-pasted into `index.html` and `journal.html`. Any nav change must be made in both files (and any future pages). A shared partial system does not exist.

4. **Notion sync inside request handler** — `maybeSyncNotion()` runs inline inside `handleTrades`. On Vercel, the function has a 60-second maxDuration. A large Notion database could time out. Consider background sync if this becomes a problem.

5. **`NOTION_VERSION: "2025-09-03"`** — This is a future-dated Notion API version string. Verify it's valid if Notion requests start failing.

---

## Sacred Rules — Never Break These

1. **Never commit `.env`**. It is gitignored. All secrets go in Vercel dashboard env vars for production.

2. **Always filter by `user_id`** on every Supabase query. Tables without `user_id` do not exist. If you add a new table, add `user_id TEXT` from the start.

3. **Both Notion sync files must stamp `user_id`** on every upserted row. Aiden = `aidenpasque11@gmail.com`, mum = `spasque70@gmail.com`. The column list in `upsertTradeBatch()` must include `user_id`.

4. **All frontend fetch calls must include `cache: 'no-store'`**. Mobile Safari caches aggressively. Omitting this causes stale data to show with no error.

5. **`currentUserId` must never be `null` at page load**. Always initialize to `aidenpasque11@gmail.com` at the top of any JS IIFE. Do not gate on a login modal.

6. **Do not add authentication or login UI**. This is a personal private tool. The default user is Aiden. Multi-user is handled purely via `user_id` column filtering, not auth.

7. **Keep the HUD aesthetic**. Black background, electric blue (#00BFFF), silver (#C0C0C0), Share Tech Mono for labels. No white backgrounds, no rounded pastel cards, no Material UI, no Tailwind utility classes outside of the existing system.

8. **Use `claude-haiku-4-5-20251001`** for all AI API calls unless explicitly changed. Do not silently upgrade to Sonnet.

9. **Vercel function entry point is `api/index.mjs`**. `server.mjs` is for local dev. Both must stay in sync — any new API route added to `server.mjs` must also be handled in `api/index.mjs`.

10. **The `trades` table uses `notion_id` as the upsert conflict key**, not date+model. Two trades on the same day with the same model are both kept. Do not add deduplication logic.
