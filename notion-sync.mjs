import 'dotenv/config';
import { pathToFileURL } from "node:url";
import { fetchTradeImagesFromNotionPageBlocks } from "./notion-page-images.mjs";

/**
 * Notion → Supabase sync for `public.trades`.
 * Each Notion page maps 1-to-1 to a row; notion_id is the unique conflict key.
 * No date+model deduplication — two trades on the same day with the same model are both kept.
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const DEFAULT_NOTION_DATA_SOURCE_ID = "262e0ffd0a52818abf00000bc795ba54";
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

/** Collect HTTPS URLs from every Notion `files` property on the page. */
function extractTradeImagesFromProps(props) {
  const urls = [];
  if (!props || typeof props !== "object") return urls;
  for (const prop of Object.values(props)) {
    if (!prop || prop.type !== "files" || !Array.isArray(prop.files)) continue;
    for (const f of prop.files) {
      if (!f) continue;
      const u =
        f.type === "external" && f.external?.url
          ? String(f.external.url).trim()
          : f.type === "file" && f.file?.url
            ? String(f.file.url).trim()
            : "";
      if (u && /^https?:\/\//i.test(u)) urls.push(u);
    }
  }
  return urls;
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
  const outcome = p.Outcome?.select?.name ?? null;
  const rr = typeof p.RR?.number === "number" && !Number.isNaN(p.RR.number) ? p.RR.number : null;
  const model = p["ENTRY MODEL"]?.select?.name != null ? String(p["ENTRY MODEL"].select.name) : "";
  const notes = plainFromRichText(p["TRADE SUMMARY"]?.rich_text);
  const pair = p["PAIR"]?.select?.name || plainFromRichText(p["PAIR"]?.rich_text) || null;
  const direction = p["POSITION TYPE"]?.select?.name || plainFromRichText(p["POSITION TYPE"]?.rich_text) || null;

  const propUrls = extractTradeImagesFromProps(p);
  const trade_images = propUrls.map((url) => ({ url, label: "" }));

  return {
    notion_id: page.id,
    date: dateIso,
    user_id: "aidenpasque11@gmail.com",
    session,
    outcome,
    rr,
    model,
    notes,
    pair,
    direction,
    trade_images,
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

const BODY_IMAGE_CONCURRENCY = Math.min(
  8,
  Math.max(1, Number(process.env.NOTION_BODY_IMAGE_CONCURRENCY) || 6)
);

function normalizeTradeImageEntry(x) {
  if (typeof x === "string") {
    const u = x.trim();
    if (!/^https?:\/\//i.test(u)) return null;
    return { url: u, label: "" };
  }
  if (x && typeof x === "object" && typeof x.url === "string") {
    const u = x.url.trim();
    if (!/^https?:\/\//i.test(u)) return null;
    return {
      url: u,
      label: typeof x.label === "string" ? x.label.trim() : "",
    };
  }
  return null;
}

function mergeTradeImages(baseList, fromBlocks) {
  const merged = [];
  const seen = new Set();
  // Prefer page-body images first — same URL appears in Files with label ""
  // and under headings from the block walker; captions must win.
  for (const raw of fromBlocks || []) {
    const n = normalizeTradeImageEntry(raw);
    if (n && !seen.has(n.url)) {
      seen.add(n.url);
      merged.push(n);
    }
  }
  for (const raw of baseList || []) {
    const n = normalizeTradeImageEntry(raw);
    if (n && !seen.has(n.url)) {
      seen.add(n.url);
      merged.push(n);
    }
  }
  return merged;
}

/**
 * Merge Notion **page body** image/file blocks into trade_images (your charts live under headings, not Files columns).
 */
async function enrichTradeRowsWithPageBodyImages(notionKey, pages) {
  const rows = [];
  for (let i = 0; i < pages.length; i += BODY_IMAGE_CONCURRENCY) {
    const chunk = pages.slice(i, i + BODY_IMAGE_CONCURRENCY);
    const batch = await Promise.all(
      chunk.map(async (page) => {
        const t = notionPageToTrade(page);
        if (!t) return null;
        try {
          const fromBlocks = await fetchTradeImagesFromNotionPageBlocks(notionKey, page.id, {
            maxUrls: 48,
            maxBlockRequests: 150,
          });
          t.trade_images = mergeTradeImages(t.trade_images, fromBlocks);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[notion-sync] page body images ${page?.id}: ${msg}`);
        }
        return t;
      })
    );
    for (const t of batch) if (t) rows.push(t);
  }
  return rows;
}

async function upsertTradeBatch(supabaseUrl, supabaseKey, rows) {
  if (!rows.length) return;

  // Explicit column list ensures ON CONFLICT DO UPDATE overwrites every field.
  const columns =
    "notion_id,date,user_id,session,outcome,rr,model,notes,pair,direction,trade_images,updated_at";
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
export async function syncNotionToSupabase() {
  const notionKey = process.env.NOTION_API_KEY?.trim();
  const dataSourceId = (
    process.env.NOTION_DATA_SOURCE_ID || DEFAULT_NOTION_DATA_SOURCE_ID
  ).trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();

  if (!notionKey) {
    console.warn("[notion-sync] NOTION_API_KEY not set — skipping sync.");
    return { ok: false, skipped: true, reason: "NOTION_API_KEY missing" };
  }
  if (!supabaseUrl || !supabaseKey) {
    console.warn("[notion-sync] SUPABASE_URL or Supabase key not set — skipping sync.");
    return { ok: false, skipped: true, reason: "Supabase config missing" };
  }

  const pages = await fetchAllNotionPages(notionKey, dataSourceId);
  const fetched = pages.length;

  const rows = await enrichTradeRowsWithPageBodyImages(notionKey, pages);
  const upserted = rows.length;

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    await upsertTradeBatch(supabaseUrl, supabaseKey, rows.slice(i, i + UPSERT_BATCH_SIZE));
  }

  console.log(`[notion-sync] fetched ${fetched} pages → upserted ${upserted} trades`);

  return { ok: true, fetched, upserted };
}

export async function runNotionSync() {
  return await syncNotionToSupabase();
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun && !process.env.VERCEL) {
  void runNotionSync();
}
