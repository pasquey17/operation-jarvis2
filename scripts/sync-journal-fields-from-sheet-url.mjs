#!/usr/bin/env node
/**
 * Same as sync-journal-fields-from-csv.mjs but downloads CSV first (Google Sheets “publish” or File → Download CSV).
 * Set GOOGLE_SHEETS_CSV_URL to the export URL, e.g.
 *   https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=0
 * Sheet must be readable without auth (published / anyone with link).
 *
 * Required env: TARGET_USER_ID, GOOGLE_SHEETS_CSV_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import "dotenv/config";
import { syncJournalFieldsFromCsvText } from "../sync-journal-fields-csv.mjs";

const userId = process.env.TARGET_USER_ID?.trim();
const url = process.env.GOOGLE_SHEETS_CSV_URL?.trim();
const supabaseUrl = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

async function main() {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`CSV fetch failed (${res.status})`);
  const csvText = await res.text();
  const result = await syncJournalFieldsFromCsvText({
    userId,
    csvText,
    supabaseUrl,
    supabaseKey,
  });
  console.log(JSON.stringify({ ...result, source_url: url }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
