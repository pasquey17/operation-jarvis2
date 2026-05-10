/**
 * Build journal_fields rows from CSV header row (Option B: Sheets → Export CSV, or any spreadsheet).
 * All columns default to field_type "text" unless JOURNAL_FIELDS_DROPDOWNS_JSON maps field names to option arrays.
 *
 * JOURNAL_FIELDS_DROPDOWNS_JSON example (optional file path or inline JSON string):
 * {"Entry Model":["A","B"],"Psychology":["Calm","Angry"]}
 */

import fs from "node:fs";
import { shouldSkipJournalFieldName, upsertJournalFieldsBatch } from "./sync-journal-fields-notion.mjs";

export function parseCsvHeaderLine(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

export function loadDropdownOverridesFromEnv() {
  const raw = process.env.JOURNAL_FIELDS_DROPDOWNS_JSON?.trim();
  if (!raw) return {};
  try {
    const p = raw.startsWith("{") ? raw : fs.readFileSync(raw, "utf8");
    const j = JSON.parse(p);
    return typeof j === "object" && j ? j : {};
  } catch {
    console.warn("[csv-sync] JOURNAL_FIELDS_DROPDOWNS_JSON parse failed — using text for all");
    return {};
  }
}

export function headersToJournalRows(headers, dropdownMap) {
  const rows = [];
  let order = 1;
  const map = dropdownMap || {};

  for (const name of headers) {
    const trimmed = String(name || "").trim();
    if (!trimmed || shouldSkipJournalFieldName(trimmed)) continue;

    const opts = map[trimmed];
    if (Array.isArray(opts) && opts.length) {
      const asStrings = opts.map((x) => String(x).trim()).filter(Boolean);
      rows.push({
        field_name: trimmed,
        field_type: "dropdown",
        field_options: JSON.stringify(asStrings.length ? asStrings : ["—"]),
        is_required: false,
        display_order: order++,
      });
    } else {
      rows.push({
        field_name: trimmed,
        field_type: "text",
        field_options: null,
        is_required: false,
        display_order: order++,
      });
    }
  }

  return rows;
}

export async function syncJournalFieldsFromCsvFile(options) {
  const { userId, csvPath, supabaseUrl, supabaseKey, dropdownMap } = options;

  if (!userId?.trim()) throw new Error("TARGET_USER_ID required");
  if (!csvPath?.trim()) throw new Error("JOURNAL_FIELDS_CSV_PATH required");
  if (!supabaseUrl?.trim()) throw new Error("SUPABASE_URL required");
  if (!supabaseKey?.trim()) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");

  const text = fs.readFileSync(csvPath.trim(), "utf8");
  const firstLine = text.split(/\r?\n/)[0] || "";
  const headers = parseCsvHeaderLine(firstLine);
  const dm = dropdownMap ?? loadDropdownOverridesFromEnv();
  const rows = headersToJournalRows(headers, dm);

  await upsertJournalFieldsBatch(
    supabaseUrl.trim().replace(/\/$/, ""),
    supabaseKey.trim(),
    userId.trim(),
    rows
  );

  return {
    ok: true,
    user_id: userId.trim(),
    synced: rows.length,
    csv_path: csvPath.trim(),
  };
}

export async function syncJournalFieldsFromCsvText(options) {
  const { userId, csvText, supabaseUrl, supabaseKey, dropdownMap } = options;

  const firstLine = String(csvText || "").split(/\r?\n/)[0] || "";
  const headers = parseCsvHeaderLine(firstLine);
  const dm = dropdownMap ?? loadDropdownOverridesFromEnv();
  const rows = headersToJournalRows(headers, dm);

  await upsertJournalFieldsBatch(
    supabaseUrl.trim().replace(/\/$/, ""),
    supabaseKey.trim(),
    userId.trim(),
    rows
  );

  return {
    ok: true,
    user_id: userId.trim(),
    synced: rows.length,
  };
}
