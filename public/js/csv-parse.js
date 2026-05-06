/**
 * Minimal RFC 4180-style CSV parser (handles quoted fields and newlines in quotes).
 */

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };

  const pushRow = () => {
    if (row.length === 1 && row[0] === "") {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (c === ",") {
      pushField();
      i += 1;
      continue;
    }

    if (c === "\r") {
      i += 1;
      continue;
    }

    if (c === "\n") {
      pushField();
      pushRow();
      i += 1;
      continue;
    }

    field += c;
    i += 1;
  }

  pushField();
  if (row.length > 0 && !(row.length === 1 && row[0] === "")) {
    pushRow();
  }

  if (rows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = rows[0].map((h) => String(h).trim());
  const records = [];

  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      obj[key] = line[c] !== undefined ? String(line[c]).trim() : "";
    }
    records.push(obj);
  }

  return { headers, records };
}

export function normalizeKeys(record) {
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    out[k.trim().toLowerCase()] = v;
  }
  return out;
}
