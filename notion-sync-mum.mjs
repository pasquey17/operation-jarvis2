import 'dotenv/config';
import { pathToFileURL } from "node:url";

/**
 * Notion → Supabase sync for `public.trades` (mum).
 * Each Notion page maps 1-to-1 to a row; notion_id is the unique conflict key.
 * No date+model deduplication — two trades on the same day with the same model are both kept.
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const DEFAULT_NOTION_DATA_SOURCE_ID = "294f9844-43a9-82da-bfa3-07deb7d0693f";
const UPSERT_BATCH_SIZE = 200;

function normalizeDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function plainFromRichText(rich) {
  if (!Array.isArray(rich)) return "";
  return rich.map((b) => (typeof b?.plain_text === "string" ? b.plain_text : "")).join("").trim();
}

function notionPageToTrade(page) {
  if (!page || page.object !== "page" || page.in_trash) return null;
  const p = page.properties;
  if (!p || typeof p !== "object") return null;

  const dateRaw = p.Date?.date?.start;
  if (dateRaw == null || String(dateRaw).trim() === "") return null;
  const dateIso = normalizeDate(dateRaw);
  if (!dateIso) return null;

  const session = p.SESSION?.select?.name ?? null;
  const outcome =
    p.Outcome?.select?.name ??
    p.Outcome?.status?.name ??
    p.OUTCOME?.select?.name ??
    p.OUTCOME?.status?.name ??
    p.Result?.select?.name ??
    p.Result?.status?.name ??
    p.RESULT?.select?.name ??
    p.RESULT?.status?.name ??
    p.win?.select?.name ??
    p.win?.status?.name ??
    p.WIN?.select?.name ??
    p.WIN?.status?.name ??
    p["Win/Loss"]?.select?.name ??
    p["Win/Loss"]?.status?.name ??
    p["W/L"]?.select?.name ??
    p["W/L"]?.status?.name ??
    p["Trade Outcome"]?.select?.name ??
    p["Trade Outcome"]?.status?.name ??
    null;
  const rr = typeof p.RR?.number === "number" && !Number.isNaN(p.RR.number) ? p.RR.number : null;
  const model = p["ENTRY MODEL"]?.select?.name != null ? String(p["ENTRY MODEL"].select.name) : "";
  const notes = plainFromRichText(p["TRADE SUMMARY"]?.rich_text);

  return {
    notion_id: page.id,
    date: dateIso,
    user_id: "spasque70@gmail.com",
    session,
    outcome,
    rr,
    model,
    notes,
    updated_at: new Date().toISOString(),
  };
}

async function fetchAllNotionPages(notionKey, dataSourceId) {
  const results = [];
  let cursor = undefined;
  let firstPage = true;

  for (;;) {
    const body = {};
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`${NOTION_API}/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Notion query failed (${res.status}): ${text.slice(0, 500)}`);
      err.status = res.status;
      throw err;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Notion returned invalid JSON");
    }

    if (!Array.isArray(data.results)) {
      if (firstPage) throw new Error("Notion response missing or invalid results array");
      break;
    }
    firstPage = false;
    results.push(...data.results);

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return results;
}

async function upsertTradeBatch(supabaseUrl, supabaseKey, rows) {
  if (!rows.length) return;

  // Explicit column list ensures ON CONFLICT DO UPDATE overwrites every field.
  const columns = "notion_id,date,user_id,session,outcome,rr,model,notes,updated_at";
  const res = await fetch(
    `${supabaseUrl}/rest/v1/trades?on_conflict=notion_id&columns=${columns}`,
    {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    }
  );

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Supabase upsert failed (${res.status}): ${text.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
}

/**
 * Fetches all pages from Notion, maps each to a trade row, upserts into `trades` by notion_id.
 * @returns {Promise<{ ok: true, fetched: number, upserted: number } | { ok: false, skipped?: boolean, reason?: string, error?: string }>}
 */
export async function syncNotionToSupabaseMum() {
  const notionKey = process.env.NOTION_API_KEY_MUM?.trim();
  const dataSourceId = (
    process.env.NOTION_DATA_SOURCE_ID_MUM || DEFAULT_NOTION_DATA_SOURCE_ID
  ).trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();

  if (!notionKey) {
    console.warn("[notion-sync-mum] NOTION_API_KEY_MUM not set — skipping mum sync.");
    return { ok: false, skipped: true, reason: "NOTION_API_KEY_MUM missing" };
  }
  if (!supabaseUrl || !supabaseKey) {
    console.warn("[notion-sync-mum] SUPABASE_URL or Supabase key not set — skipping mum sync.");
    return { ok: false, skipped: true, reason: "Supabase config missing" };
  }

  const pages = await fetchAllNotionPages(notionKey, dataSourceId);
  const fetched = pages.length;

  const rows = [];
  for (const page of pages) {
    const t = notionPageToTrade(page);
    if (t) rows.push(t);
  }
  const upserted = rows.length;

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    await upsertTradeBatch(supabaseUrl, supabaseKey, rows.slice(i, i + UPSERT_BATCH_SIZE));
  }

  console.log(`[notion-sync-mum] fetched ${fetched} pages → upserted ${upserted} trades`);

  return { ok: true, fetched, upserted };
}

export async function runNotionSync() {
  return await syncNotionToSupabaseMum();
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun && !process.env.VERCEL) {
  void runNotionSync();
}
