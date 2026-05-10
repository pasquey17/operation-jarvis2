/**
 * Serialize Notion page `properties` into JSON-safe plain objects for Supabase jsonb.
 * Used by notion-sync.mjs / notion-sync-mum.mjs — keep dependency-free for CLI runs.
 */

function plainRich(rich) {
  if (!Array.isArray(rich)) return "";
  return rich
    .map((b) => (typeof b?.plain_text === "string" ? b.plain_text : ""))
    .join("")
    .trim();
}

function serializeFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .map((f) => {
      if (!f || typeof f !== "object") return null;
      if (f.type === "external" && f.external?.url)
        return { kind: "external", url: String(f.external.url).trim() };
      if (f.type === "file" && f.file?.url)
        return { kind: "file", url: String(f.file.url).trim() };
      return null;
    })
    .filter(Boolean);
}

function serializeFormula(f) {
  if (!f || typeof f !== "object") return null;
  switch (f.type) {
    case "string":
      return f.string ?? null;
    case "boolean":
      return Boolean(f.boolean);
    case "number":
      return typeof f.number === "number" && !Number.isNaN(f.number) ? f.number : null;
    case "date":
      return f.date?.start ?? null;
    default:
      return { type: f.type ?? "unknown" };
  }
}

function serializeNotionProperty(prop) {
  if (!prop || typeof prop !== "object") return null;
  const t = prop.type;
  switch (t) {
    case "title":
      return plainRich(prop.title);
    case "rich_text":
      return plainRich(prop.rich_text);
    case "number":
      return typeof prop.number === "number" && !Number.isNaN(prop.number) ? prop.number : null;
    case "select":
      return prop.select?.name ?? null;
    case "multi_select":
      return Array.isArray(prop.multi_select)
        ? prop.multi_select.map((x) => x?.name).filter(Boolean)
        : [];
    case "status":
      return prop.status?.name ?? null;
    case "date":
      return prop.date?.start
        ? { start: prop.date.start, end: prop.date?.end ?? null }
        : null;
    case "checkbox":
      return Boolean(prop.checkbox);
    case "url":
      return prop.url || null;
    case "email":
      return prop.email || null;
    case "phone_number":
      return prop.phone_number || null;
    case "files":
      return serializeFiles(prop.files);
    case "formula":
      return serializeFormula(prop.formula);
    case "rollup": {
      const r = prop.rollup;
      if (!r || typeof r !== "object") return null;
      if (r.type === "number" && typeof r.number === "number") return r.number;
      if (r.type === "date" && r.date) return r.date?.start ?? null;
      if (r.type === "array" && Array.isArray(r.array)) {
        return r.array.slice(0, 40).map((item) => {
          if (item && typeof item === "object" && "type" in item) {
            return serializeNotionProperty(item);
          }
          return item;
        });
      }
      if (r.type === "incomplete") return null;
      return { type: r.type ?? "rollup" };
    }
    case "relation":
      return Array.isArray(prop.relation) ? prop.relation.map((x) => x?.id).filter(Boolean) : [];
    case "people":
      return Array.isArray(prop.people)
        ? prop.people.map((p) => p?.name || p?.id).filter(Boolean)
        : [];
    case "created_by":
    case "last_edited_by":
      return prop[t]?.name || prop[t]?.id || null;
    case "created_time":
      return prop.created_time || null;
    case "last_edited_time":
      return prop.last_edited_time || null;
    default:
      return { _type: t };
  }
}

/**
 * @param {Record<string, unknown>} props Notion page.properties
 * @returns {Record<string, unknown>}
 */
export function serializeNotionProperties(props) {
  if (!props || typeof props !== "object") return {};
  const out = {};
  for (const [name, prop] of Object.entries(props)) {
    if (!prop || typeof prop !== "object") continue;
    try {
      const v = serializeNotionProperty(prop);
      if (v !== undefined && v !== "") out[name] = v;
      else if (v === "") out[name] = "";
    } catch {
      out[name] = { _error: "serialize_failed", type: prop.type };
    }
  }
  return out;
}
