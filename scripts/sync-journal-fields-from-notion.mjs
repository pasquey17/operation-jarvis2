#!/usr/bin/env node
/**
 * Upsert Supabase journal_fields from a Notion data source schema.
 *
 * Required env: TARGET_USER_ID, NOTION_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Required env: NOTION_DATA_SOURCE_ID (your trades DB data source UUID — same family as notion-sync NOTION_DATA_SOURCE_ID)
 *
 * Example (Aiden, from repo root):
 *   NOTION_DATA_SOURCE_ID=262e0ffd0a52818abf00000bc795ba54 TARGET_USER_ID=aidenpasque11@gmail.com node scripts/sync-journal-fields-from-notion.mjs
 *
 * Example (mum — use her integration key + her data source id if different):
 *   NOTION_API_KEY=$NOTION_API_KEY_MUM NOTION_DATA_SOURCE_ID=<her_ds_id> TARGET_USER_ID=spasque70@gmail.com node scripts/sync-journal-fields-from-notion.mjs
 */

import "dotenv/config";
import { syncJournalFieldsFromNotion } from "../sync-journal-fields-notion.mjs";

const userId = process.env.TARGET_USER_ID?.trim();
const notionApiKey = process.env.NOTION_API_KEY?.trim();
const dataSourceId = process.env.NOTION_DATA_SOURCE_ID?.trim();
const supabaseUrl = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

async function main() {
  const result = await syncJournalFieldsFromNotion({
    userId,
    notionApiKey,
    dataSourceId,
    supabaseUrl,
    supabaseKey,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
