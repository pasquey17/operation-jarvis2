/**
 * Map Notion trade DB schema → Supabase journal_fields (per user).
 * Used by CLI `scripts/sync-journal-fields-from-notion.mjs` and POST /api/admin/sync-journal-fields.
 *
 * Notion → Jarvis journal_fields:
 * - rich_text, email, phone_number, url → text
 * - number → number
 * - select, status → dropdown (options from Notion schema)
 * - multi_select → multiselect
 * - checkbox → dropdown ["Yes","No"]
 * - date → text (skip property names matching core "date" etc.; see shouldSkipJournalFieldName)
 * - title, files, formula, rollup, relation, people, created_*, last_edited_*, unique_id → skipped
 *
 * Core/template skips: public/js/log-trade-field-skip.mjs (keep in sync with LOG TRADE modal).
 */

import { shouldSkipJournalFieldName as shouldSkipJournalFieldNameShared } from "./public/js/log-trade-field-skip.mjs";

const NOTION_API = "https://api.notion.com/v1";
export const NOTION_VERSION = "2025-09-03";

const SKIP_TYPES = new Set([
  "title",
  "files",
  "formula",
  "rollup",
  "relation",
  "people",
  "created_by",
  "created_time",
  "last_edited_by",
  "last_edited_time",
  "unique_id",
  "button",
  "verification",
]);

export function shouldSkipJournalFieldName(name) {
  return shouldSkipJournalFieldNameShared(name);
}

export function mapNotionPropertyToJournalField(propName, prop) {
  if (!prop || typeof prop.type !== "string") return { skip: true, reason: "invalid" };
  const type = prop.type;

  if (shouldSkipJournalFieldName(propName)) {
    return { skip: true, reason: "core_column" };
  }

  if (SKIP_TYPES.has(type)) {
    return { skip: true, reason: type };
  }

  const base = {
    field_name: propName.trim(),
    is_required: false,
  };

  if (type === "rich_text" || type === "email" || type === "phone_number" || type === "url") {
    return { row: { ...base, field_type: "text", field_options: null } };
  }

  if (type === "number") {
    return { row: { ...base, field_type: "number", field_options: null } };
  }

  if (type === "checkbox") {
    return {
      row: {
        ...base,
        field_type: "dropdown",
        field_options: JSON.stringify(["Yes", "No"]),
      },
    };
  }

  if (type === "select") {
    const opts = (prop.select?.options || [])
      .map((o) => (o && typeof o.name === "string" ? o.name.trim() : ""))
      .filter(Boolean);
    return {
      row: {
        ...base,
        field_type: "dropdown",
        field_options: JSON.stringify(opts.length ? opts : ["—"]),
      },
    };
  }

  if (type === "multi_select") {
    const opts = (prop.multi_select?.options || [])
      .map((o) => (o && typeof o.name === "string" ? o.name.trim() : ""))
      .filter(Boolean);
    return {
      row: {
        ...base,
        field_type: "multiselect",
        field_options: JSON.stringify(opts.length ? opts : ["—"]),
      },
    };
  }

  if (type === "status") {
    const opts = (prop.status?.options || [])
      .map((o) => (o && typeof o.name === "string" ? o.name.trim() : ""))
      .filter(Boolean);
    return {
      row: {
        ...base,
        field_type: "dropdown",
        field_options: JSON.stringify(opts.length ? opts : ["—"]),
      },
    };
  }

  if (type === "date") {
    if (shouldSkipJournalFieldName(propName)) {
      return { skip: true, reason: "core_date" };
    }
    return { row: { ...base, field_type: "text", field_options: null } };
  }

  return { skip: true, reason: `unsupported_${type}` };
}

export async function fetchNotionDataSourceSchema(notionKey, dataSourceId) {
  const res = await fetch(`${NOTION_API}/data_sources/${encodeURIComponent(dataSourceId)}`, {
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": NOTION_VERSION,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Notion data_sources retrieve failed (${res.status}): ${text.slice(0, 500)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Notion returned invalid JSON for data source");
  }
  return data;
}

/**
 * Property names in Notion UI column order when available (data source schema keys or sample page).
 * @param {string[]} propertyOrder
 * @param {Record<string, unknown>} properties
 */
export function orderedNotionPropertyNames(propertyOrder, properties) {
  if (!properties || typeof properties !== "object") return [];
  const keys = Object.keys(properties);
  if (!Array.isArray(propertyOrder) || !propertyOrder.length) return keys;
  const seen = new Set();
  const out = [];
  for (const name of propertyOrder) {
    if (!name || !properties[name] || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  for (const name of keys) {
    if (!seen.has(name)) out.push(name);
  }
  return out;
}

function propertiesToJournalRows(properties, propertyOrder) {
  if (!properties || typeof properties !== "object") return { rows: [], skipped: [] };

  const rows = [];
  const skipped = [];
  let order = 1;
  const names = orderedNotionPropertyNames(propertyOrder, properties);

  for (const name of names) {
    const prop = properties[name];
    const mapped = mapNotionPropertyToJournalField(name, prop);
    if (mapped?.skip) {
      skipped.push({ name, reason: mapped.reason || "skip" });
      continue;
    }
    if (mapped?.row) {
      rows.push({
        ...mapped.row,
        display_order: order++,
      });
    }
  }

  return { rows, skipped };
}

export async function fetchNotionDatabaseSchema(notionKey, databaseId) {
  const res = await fetch(`${NOTION_API}/databases/${encodeURIComponent(databaseId)}`, {
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": NOTION_VERSION,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Notion databases retrieve failed (${res.status}): ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Notion returned invalid JSON for database");
  }
}

/** Sample page property key order often matches Notion column order in the UI. */
export async function fetchNotionPropertyOrderFromQuery(notionKey, queryUrl) {
  const res = await fetch(queryUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 1 }),
  });
  const text = await res.text();
  if (!res.ok) return [];
  try {
    const data = JSON.parse(text);
    const first = data?.results?.[0];
    if (first?.properties && typeof first.properties === "object") {
      return Object.keys(first.properties);
    }
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Resolve schema properties + column order for OAuth-mapped trade DB / data source.
 */
export async function resolveNotionJournalSchema(notionKey, { databaseId, dataSourceId }) {
  const dbId = String(databaseId || "").trim();
  let dsId = dataSourceId != null ? String(dataSourceId).trim().replace(/-/g, "") : "";

  if (!dsId && dbId) {
    const dbSchema = await fetchNotionDatabaseSchema(notionKey, dbId);
    const dataSources = Array.isArray(dbSchema?.data_sources) ? dbSchema.data_sources : [];
    if (dataSources.length > 0) {
      const rawId = dataSources[0].id ?? dataSources[0];
      dsId = String(rawId).replace(/-/g, "");
    }
    if (!dsId && dbSchema?.properties && typeof dbSchema.properties === "object") {
      const properties = dbSchema.properties;
      const propertyOrder = Object.keys(properties);
      const pageOrder = await fetchNotionPropertyOrderFromQuery(
        notionKey,
        `${NOTION_API}/databases/${encodeURIComponent(dbId)}/query`
      );
      return {
        properties,
        propertyOrder: pageOrder.length ? pageOrder : propertyOrder,
      };
    }
  }

  if (dsId) {
    const ds = await fetchNotionDataSourceSchema(notionKey, dsId);
    const properties = ds?.properties;
    if (!properties || typeof properties !== "object") {
      return { properties: {}, propertyOrder: [] };
    }
    const schemaOrder = Object.keys(properties);
    const pageOrder = await fetchNotionPropertyOrderFromQuery(
      notionKey,
      `${NOTION_API}/data_sources/${encodeURIComponent(dsId)}/query`
    );
    return {
      properties,
      propertyOrder: pageOrder.length ? pageOrder : schemaOrder,
      data_source_id: dsId,
    };
  }

  if (dbId) {
    const dbSchema = await fetchNotionDatabaseSchema(notionKey, dbId);
    const properties = dbSchema?.properties ?? {};
    const propertyOrder = Object.keys(properties);
    const pageOrder = await fetchNotionPropertyOrderFromQuery(
      notionKey,
      `${NOTION_API}/databases/${encodeURIComponent(dbId)}/query`
    );
    return {
      properties,
      propertyOrder: pageOrder.length ? pageOrder : propertyOrder,
    };
  }

  return { properties: {}, propertyOrder: [] };
}

/** OAuth access token + mapped database / data source → journal_fields (Notion column order). */
export async function syncJournalFieldsFromOAuthConnection(options) {
  const {
    userId,
    accessToken,
    databaseId,
    dataSourceId,
    supabaseUrl,
    supabaseKey,
  } = options;

  if (!userId?.trim()) throw new Error("userId required");
  if (!accessToken?.trim()) throw new Error("accessToken required");
  if (!supabaseUrl?.trim()) throw new Error("SUPABASE_URL required");
  if (!supabaseKey?.trim()) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");

  const { properties, propertyOrder } = await resolveNotionJournalSchema(accessToken.trim(), {
    databaseId,
    dataSourceId,
  });
  const { rows, skipped } = propertiesToJournalRows(properties, propertyOrder);

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
    skipped,
  };
}

export async function upsertJournalFieldsBatch(supabaseUrl, supabaseKey, userId, rows) {
  if (!rows.length) return;
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/journal_fields`;
  const withUser = rows.map((r) => ({
    user_id: userId,
    field_name: r.field_name,
    field_type: r.field_type,
    field_options: r.field_options,
    is_required: Boolean(r.is_required),
    display_order: r.display_order,
  }));

  const res = await fetch(`${url}?on_conflict=user_id,field_name`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(withUser),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase journal_fields upsert failed (${res.status}): ${text.slice(0, 500)}`);
  }
}

export async function syncJournalFieldsFromNotion(options) {
  const {
    userId,
    notionApiKey,
    dataSourceId,
    supabaseUrl,
    supabaseKey,
  } = options;

  if (!userId?.trim()) throw new Error("userId required");
  if (!notionApiKey?.trim()) throw new Error("NOTION_API_KEY required");
  if (!dataSourceId?.trim()) throw new Error("NOTION_DATA_SOURCE_ID required");
  if (!supabaseUrl?.trim()) throw new Error("SUPABASE_URL required");
  if (!supabaseKey?.trim()) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");

  const { properties, propertyOrder } = await resolveNotionJournalSchema(notionApiKey.trim(), {
    databaseId: null,
    dataSourceId: dataSourceId.trim(),
  });
  const { rows, skipped } = propertiesToJournalRows(properties, propertyOrder);

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
    skipped,
    notion_data_source_id: dataSourceId.trim(),
  };
}
