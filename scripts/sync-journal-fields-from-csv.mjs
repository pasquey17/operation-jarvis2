#!/usr/bin/env node
/**
 * Upsert journal_fields from the first row of a CSV (exported from Google Sheets or any tool).
 * Each column name becomes a text field (unless JOURNAL_FIELDS_DROPDOWNS_JSON supplies dropdown options).
 *
 * Required env: TARGET_USER_ID, JOURNAL_FIELDS_CSV_PATH, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional env: JOURNAL_FIELDS_DROPDOWNS_JSON — inline JSON object or path to .json file mapping column names → string[]
 *
 * Example:
 *   TARGET_USER_ID=aidenpasque11@gmail.com JOURNAL_FIELDS_CSV_PATH=./fields.csv node scripts/sync-journal-fields-from-csv.mjs
 */

import "dotenv/config";
import { syncJournalFieldsFromCsvFile } from "../sync-journal-fields-csv.mjs";

const userId = process.env.TARGET_USER_ID?.trim();
const csvPath = process.env.JOURNAL_FIELDS_CSV_PATH?.trim();
const supabaseUrl = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

async function main() {
  const result = await syncJournalFieldsFromCsvFile({
    userId,
    csvPath,
    supabaseUrl,
    supabaseKey,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
