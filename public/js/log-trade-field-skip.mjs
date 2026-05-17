/**
 * Shared journal field skip / dedupe rules for LOG TRADE modal and Notion field sync.
 */

export const TRADE_SUMMARY_FIELD_ID = "__trade_summary";
/** Key in journal_trades.custom_data (matches Notion TRADE SUMMARY). */
export const TRADE_SUMMARY_STORAGE_KEY = "Trade Summary";

export const CHART_PHOTO_SLOTS = [
  { id: "htf", label: "HTF" },
  { id: "ltf", label: "LTF" },
  { id: "entry", label: "Entry" },
];

export const CANONICAL_CORE_ORDER = [
  "date",
  "pair",
  "direction",
  "session",
  "outcome",
  "rr",
  "account",
  TRADE_SUMMARY_FIELD_ID,
];

const CORE_FIELD_KEYS = new Set([
  "date",
  "pair",
  "direction",
  "session",
  "outcome",
  "rr",
  "account",
]);

const DIRECTION_FIELD_ALIASES = new Set([
  "position type",
  "position_type",
  "long_short",
  "side",
  "trade_direction",
  "long/short",
]);

/** Template / system fields — not shown as Notion extras in LOG TRADE. */
const SKIP_FIELD_KEYS = new Set([
  ...CORE_FIELD_KEYS,
  ...DIRECTION_FIELD_ALIASES,
  "entry model",
  "trade summary",
  "notes",
  "model",
  "psychology",
  "photos",
  "trade_images",
  "notion_id",
  "user_id",
  TRADE_SUMMARY_FIELD_ID,
]);

export function normalizeFieldKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function shouldSkipJournalFieldName(fieldName) {
  const n = normalizeFieldKey(fieldName);
  if (!n) return true;
  return SKIP_FIELD_KEYS.has(n);
}

export function isCoreFieldId(fieldId) {
  return CANONICAL_CORE_ORDER.includes(String(fieldId || ""));
}

/**
 * Filter + dedupe journal_fields rows before mapping to form defs.
 * @param {Array<{ field_name: string, display_order?: number }>} rows
 */
export function filterAndDedupeJournalFieldRows(rows) {
  const list = Array.isArray(rows) ? [...rows] : [];
  list.sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0));
  const seen = new Set();
  const out = [];
  for (const row of list) {
    const name = row?.field_name;
    if (!name || shouldSkipJournalFieldName(name)) continue;
    const key = normalizeFieldKey(name);
    if (seen.has(key)) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[log-trade] Dropped duplicate journal field:", name);
      }
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return out;
}
