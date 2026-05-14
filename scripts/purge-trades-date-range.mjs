/**
 * Preview or delete trades in public.trades by user_id + date range (uses SERVICE ROLE).
 *
 * Usage (from repo root):
 *   node scripts/purge-trades-date-range.mjs --dry-run
 *   node scripts/purge-trades-date-range.mjs --execute
 *
 * Defaults match the June 4 – Nov 14, 2026 window; override with flags:
 *   --user=aidenpasque11@gmail.com
 *   --from=2026-06-04
 *   --to=2026-11-14   (inclusive end day; script uses end of that UTC day)
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";

function arg(name, def) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!p) return def;
  return p.slice(name.length + 3);
}

const dryRun = process.argv.includes("--dry-run");
const execute = process.argv.includes("--execute");
const userId = arg("user", "aidenpasque11@gmail.com");
const fromDay = arg("from", "2026-06-04");
const toDayInclusive = arg("to", "2026-11-14");

const url = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

if (!dryRun && !execute) {
  console.error("Pass --dry-run (list + count) or --execute (DELETE).");
  process.exit(1);
}

const startIso = `${fromDay}T00:00:00.000Z`;
const endIso = `${toDayInclusive}T23:59:59.999Z`;
const table = "trades";

function buildRangeParams(extra) {
  const q = new URLSearchParams();
  q.set("user_id", `eq.${userId}`);
  q.set("date", `gte.${startIso}`);
  q.append("date", `lte.${endIso}`);
  if (extra) for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q;
}

const listQ = buildRangeParams({
  select: "notion_id,date,notion_sync_source,pair,model,outcome,rr",
  order: "date.desc",
});
const endpoint = `${url}/rest/v1/${table}?${listQ.toString()}`;

async function main() {
  const getRes = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const text = await getRes.text();
  if (!getRes.ok) {
    console.error("GET failed:", getRes.status, text.slice(0, 500));
    process.exit(1);
  }
  const rows = JSON.parse(text);
  console.log(`Matched ${rows.length} row(s) for user=${userId} date [${fromDay} .. ${toDayInclusive}]`);
  if (rows.length && rows.length <= 50) console.log(JSON.stringify(rows, null, 2));
  else if (rows.length) console.log("First 5:", JSON.stringify(rows.slice(0, 5), null, 2));

  if (dryRun) {
    console.log("\nDry run only. Re-run with --execute to DELETE these rows.");
    return;
  }

  const delUrl = `${url}/rest/v1/${table}?${buildRangeParams().toString()}`;
  const delRes = await fetch(delUrl, {
    method: "DELETE",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=representation",
    },
  });
  const delText = await delRes.text();
  if (!delRes.ok) {
    console.error("DELETE failed:", delRes.status, delText.slice(0, 800));
    process.exit(1);
  }
  let deleted = [];
  try {
    deleted = delText ? JSON.parse(delText) : [];
  } catch {
    deleted = [];
  }
  console.log(`Deleted ${Array.isArray(deleted) ? deleted.length : "?"} row(s).`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) void main();
