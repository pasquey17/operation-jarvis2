/**
 * LOG TRADE modal — premium rebuild.
 * Drag-to-reorder fields. Photo paste/drop. Saves to /api/log-trade.
 */

export const LOG_DEFAULTS_STORAGE_KEY = "jarvis_log_defaults_v1";
const FIELD_ORDER_KEY = "jarvis_field_order_v3";
const PAIR_OTHER = "Other";

const CURATED_PAIRS = ["XAUUSD", "NAS100", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD"];

const CORE_FIELD_NAMES = new Set([
  "date",
  "pair",
  "direction",
  "session",
  "outcome",
  "rr",
  "account",
]);

const DIRECTION_SKIP_NAMES = new Set([
  "position type",
  "position_type",
  "long_short",
  "side",
  "trade_direction",
  "long/short",
]);

const CANONICAL_CORE_ORDER = [
  "date",
  "pair",
  "direction",
  "session",
  "outcome",
  "rr",
  "account",
];

let ltmOpen = false;
let ltmPhotos = [];

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function normalizeFieldKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function shouldSkipNotionField(fieldName) {
  const n = normalizeFieldKey(fieldName);
  if (CORE_FIELD_NAMES.has(n)) return true;
  if (DIRECTION_SKIP_NAMES.has(n)) return true;
  return false;
}

function getRowField(row, ...keys) {
  if (!row || typeof row !== "object") return "";
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
    const upper = k.toUpperCase();
    if (row[upper] != null && String(row[upper]).trim()) return String(row[upper]).trim();
  }
  return "";
}

function extractDirectionFromRow(row) {
  let raw = getRowField(
    row,
    "direction",
    "Direction",
    "position_type",
    "Position Type",
    "POSITION TYPE",
    "long_short",
    "side"
  );
  if (!raw && row.custom_data && typeof row.custom_data === "object") {
    const cd = row.custom_data;
    raw =
      cd.direction ||
      cd.Direction ||
      cd["Position Type"] ||
      cd["position type"] ||
      "";
  }
  if (!raw) {
    const m = getRowField(row, "model", "Model", "MODEL").toLowerCase();
    if (m.includes("long")) raw = "long";
    else if (m.includes("short")) raw = "short";
  }
  const v = String(raw || "").trim().toLowerCase();
  if (v === "long" || v === "buy" || v === "bull") return "Long";
  if (v === "short" || v === "sell" || v === "bear") return "Short";
  return "";
}

function mergePairOptions(prefillRows, journalRows) {
  const seen = new Map();
  const add = (p) => {
    const t = String(p || "").trim();
    if (!t || t === PAIR_OTHER) return;
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
  };
  CURATED_PAIRS.forEach(add);
  for (const row of [...prefillRows, ...journalRows]) {
    add(getRowField(row, "pair", "Pair", "PAIR"));
    add(getRowField(row, "model", "Model", "MODEL"));
  }
  const list = [...seen.values()].sort((a, b) => a.localeCompare(b));
  list.push(PAIR_OTHER);
  return list;
}

function inferAdelaideSession() {
  try {
    const parts = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Adelaide",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date());
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "12", 10);
    if (hour >= 7 && hour < 15) return "Asia";
    if (hour >= 15 && hour < 20) return "London";
    return "New York";
  } catch {
    return "";
  }
}

async function fetchAccounts(userId) {
  try {
    const r = await fetch(`/api/accounts?user_id=eq.${encodeURIComponent(userId)}`, {
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    return Array.isArray(data.accounts) ? data.accounts : [];
  } catch {
    return [];
  }
}

async function fetchJournalTradesForPrefill(userId) {
  try {
    const r = await fetch(`/api/journal-trades?user_id=eq.${encodeURIComponent(userId)}`, {
      cache: "no-store",
    });
    const data = await r.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function deriveDefaultsFromRows(rows, accounts) {
  let pair = "";
  let account = "";
  let direction = "";
  let session = inferAdelaideSession();

  for (const row of rows) {
    if (!pair) {
      const p = getRowField(row, "pair", "Pair");
      if (p) pair = p;
    }
    if (!account) {
      const a = row.account != null ? String(row.account).trim() : getRowField(row, "account", "Account");
      if (a) account = a;
    }
    if (!direction) direction = extractDirectionFromRow(row);
    if (!session) {
      const s = getRowField(row, "session", "Session");
      if (s) session = s;
    }
  }

  if (!account && accounts.length) {
    account = String(accounts[0].name || "").trim();
  }

  return { pair, account, direction, session };
}

function loadFieldOrder(allIds) {
  try {
    const saved = JSON.parse(localStorage.getItem(FIELD_ORDER_KEY) || "null");
    let ordered = allIds;
    if (Array.isArray(saved) && saved.length) {
      const savedSet = new Set(saved);
      const fromSaved = saved.filter((id) => allIds.includes(id));
      const unseen = allIds.filter((id) => !savedSet.has(id));
      ordered = [...fromSaved, ...unseen];
    }
    const coreSet = new Set(CANONICAL_CORE_ORDER);
    const corePresent = CANONICAL_CORE_ORDER.filter((id) => ordered.includes(id));
    const rest = ordered.filter((id) => !coreSet.has(id));
    return [...corePresent, ...rest];
  } catch {
    return allIds;
  }
}

function saveFieldOrder(ids) {
  try {
    localStorage.setItem(FIELD_ORDER_KEY, JSON.stringify(ids));
  } catch {}
}

function buildCoreFieldDefs({ pairOptions, accountNames, hasAccounts }) {
  const accountOpts = hasAccounts
    ? accountNames
    : ["No account — add on Account page"];

  return [
    { id: "date", label: "Date", type: "date", required: true, placeholderSelect: "Choose date" },
    {
      id: "pair",
      label: "Pair",
      type: "select",
      options: pairOptions,
      allowOther: true,
      placeholderSelect: "Choose pair",
    },
    {
      id: "direction",
      label: "Direction",
      type: "select",
      options: ["Long", "Short"],
      placeholderSelect: "Choose direction",
    },
    {
      id: "session",
      label: "Session",
      type: "select",
      options: ["Asia", "London", "New York", "London/New York"],
      required: true,
      placeholderSelect: "Choose session",
    },
    {
      id: "outcome",
      label: "Outcome",
      type: "select",
      options: ["Win", "Loss", "BE"],
      required: true,
      placeholderSelect: "Choose outcome",
    },
    {
      id: "rr",
      label: "RR",
      type: "number",
      placeholder: "2.5",
      step: "0.01",
      min: "0",
    },
    {
      id: "account",
      label: "Account",
      type: "select",
      options: accountOpts,
      placeholderSelect: hasAccounts ? "Choose account" : "No account yet",
      allowEmptyAccount: !hasAccounts,
    },
  ];
}

function notionFieldToDef(f) {
  const n = (f.field_name || "").toLowerCase();
  let type = "text";
  let options = [];
  if (f.field_type === "dropdown" || f.field_type === "multiselect") {
    type = "select";
    try {
      options = JSON.parse(f.field_options || "[]");
    } catch {}
  } else if (f.field_type === "number") {
    type = "number";
  } else if (f.field_type === "yesno" || f.field_type === "boolean") {
    type = "yesno";
  } else if (
    n.includes("note") ||
    n.includes("summary") ||
    n.includes("comment") ||
    n.includes("journal")
  ) {
    type = "textarea";
  }
  return {
    id: f.field_name,
    label: f.field_name,
    type,
    options,
    placeholderSelect: `Choose ${f.field_name}`,
  };
}

function fieldInputId(fieldId) {
  return `ltm-f-${fieldId.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-_]/g, "").toLowerCase()}`;
}

function buildInputHtml(field, today) {
  const id = fieldInputId(field.id);
  const name = field.id;
  const req = field.required ? "required" : "";
  const ph = field.placeholderSelect || "— select —";

  switch (field.type) {
    case "date":
      return `<input id="${id}" type="date" name="${escAttr(name)}" class="trade-input ltm-input" value="${escHtml(today)}" ${req}>`;
    case "number":
      return `<input id="${id}" type="number" name="${escAttr(name)}" class="trade-input ltm-input" step="${field.step || "1"}" min="${field.min || ""}" placeholder="${escAttr(field.placeholder || "")}">`;
    case "select": {
      const opts = (field.options || [])
        .map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`)
        .join("");
      return `<select id="${id}" name="${escAttr(name)}" class="trade-input trade-select ltm-input" ${req}><option value="">${escHtml(ph)}</option>${opts}</select>`;
    }
    case "yesno":
      return `<select id="${id}" name="${escAttr(name)}" class="trade-input trade-select ltm-input"><option value="">Choose</option><option value="Yes">Yes</option><option value="No">No</option></select>`;
    case "textarea":
      return `<textarea id="${id}" name="${escAttr(name)}" class="trade-input ltm-input ltm-textarea" rows="3"></textarea>`;
    default:
      return `<input id="${id}" type="text" name="${escAttr(name)}" class="trade-input ltm-input" placeholder="${escAttr(field.placeholder || "")}">`;
  }
}

function renderFieldRow(field, today) {
  const inputId = fieldInputId(field.id);
  let pairOther = "";
  if (field.allowOther) {
    pairOther = `<input type="text" name="pair_other" id="ltm-f-pair-other" class="trade-input ltm-input ltm-pair-other" hidden placeholder="Enter pair symbol">`;
  }
  return `<div class="ltm-field-row" data-field-id="${escAttr(field.id)}" draggable="true">
  <div class="ltm-drag-handle" title="Drag to reorder" aria-hidden="true">
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <circle cx="3" cy="3"  r="1.3"/><circle cx="7" cy="3"  r="1.3"/>
      <circle cx="3" cy="8"  r="1.3"/><circle cx="7" cy="8"  r="1.3"/>
      <circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/>
    </svg>
  </div>
  <div class="ltm-field-inner">
    <label class="trade-label ltm-label" for="${escAttr(inputId)}">${escHtml(field.label)}</label>
    ${buildInputHtml(field, today)}
    ${pairOther}
  </div>
</div>`;
}

function renderPhotoPreviews(container) {
  if (!ltmPhotos.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = ltmPhotos
    .map(
      (p, i) =>
        `<div class="ltm-thumb">
      <img class="ltm-thumb-img" src="${escHtml(p.dataUrl)}" alt="Photo ${i + 1}">
      <button type="button" class="ltm-thumb-remove" data-idx="${i}" aria-label="Remove photo">&times;</button>
    </div>`
    )
    .join("");
}

function addPhotoFile(file, previewContainer) {
  if (!file || !file.type.startsWith("image/")) return;
  if (ltmPhotos.length >= 6) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    ltmPhotos.push({ dataUrl: ev.target.result, label: "" });
    renderPhotoPreviews(previewContainer);
  };
  reader.readAsDataURL(file);
}

function initFieldDrag(list) {
  let dragging = null;
  let fromHandle = false;

  list.addEventListener("mousedown", (e) => {
    fromHandle = !!e.target.closest(".ltm-drag-handle");
  });
  document.addEventListener("mouseup", () => {
    fromHandle = false;
  }, { passive: true });

  list.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".ltm-field-row");
    if (!row || !fromHandle) {
      e.preventDefault();
      return;
    }
    dragging = row;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", row.dataset.fieldId || "");
    setTimeout(() => row.classList.add("ltm-dragging"), 0);
  });

  list.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!dragging) return;
    const target = e.target.closest(".ltm-field-row");
    if (!target || target === dragging) return;
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      list.insertBefore(dragging, target);
    } else {
      target.after(dragging);
    }
  });

  list.addEventListener("dragend", () => {
    if (dragging) dragging.classList.remove("ltm-dragging");
    dragging = null;
    fromHandle = false;
    const ids = Array.from(list.querySelectorAll(".ltm-field-row"))
      .map((r) => r.dataset.fieldId)
      .filter(Boolean);
    saveFieldOrder(ids);
  });
}

function initPairOtherToggle(form) {
  const pairSel = form?.elements.namedItem("pair");
  const pairOther = document.getElementById("ltm-f-pair-other");
  if (!pairSel || !pairOther) return;

  const sync = () => {
    const isOther = pairSel.value === PAIR_OTHER;
    pairOther.hidden = !isOther;
    if (isOther) pairOther.removeAttribute("hidden");
    else pairOther.setAttribute("hidden", "");
    if (isOther && !pairOther.value) pairOther.focus();
  };
  pairSel.addEventListener("change", sync);
  sync();
}

function setFormValue(form, name, val, pairOptions) {
  if (!form) return;
  const el = form.elements.namedItem(name);
  if (!el || !("value" in el)) return;

  if (name === "pair") {
    const v = val == null ? "" : String(val).trim();
    if (!v) {
      el.value = "";
      return;
    }
    const match = (pairOptions || []).find((p) => p.toLowerCase() === v.toLowerCase());
    if (match && match !== PAIR_OTHER) {
      el.value = match;
      const other = document.getElementById("ltm-f-pair-other");
      if (other) other.value = "";
    } else {
      el.value = PAIR_OTHER;
      const other = document.getElementById("ltm-f-pair-other");
      if (other) other.value = v;
    }
    return;
  }

  if (name === "account") {
    const v = val == null ? "" : String(val).trim();
    const opts = Array.from(el.options || []).map((o) => o.value);
    if (v && opts.includes(v)) el.value = v;
    else if (!v) el.value = "";
    else {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
      el.value = v;
    }
    return;
  }

  el.value = val == null ? "" : String(val);
}

function applyNewTradeDefaults(form, defaults, pairOptions) {
  if (!form || !defaults) return;
  if (defaults.pair) setFormValue(form, "pair", defaults.pair, pairOptions);
  if (defaults.direction) setFormValue(form, "direction", defaults.direction, pairOptions);
  if (defaults.session) setFormValue(form, "session", defaults.session, pairOptions);
  if (defaults.account) setFormValue(form, "account", defaults.account, pairOptions);
  initPairOtherToggle(form);
}

function buildOverlayHtml(today, orderedFields, hasAccounts) {
  const rowsHtml = orderedFields.map((f) => renderFieldRow(f, today)).join("\n");
  const accountHint = hasAccounts
    ? ""
    : `<p class="ltm-account-hint" id="ltm-account-hint">No trading accounts yet — <a href="/account.html">add one on Account</a>.</p>`;

  return `<div class="trade-form-panel ltm-panel" id="ltm-panel">
  <div class="trade-form-header">
    <span class="trade-form-title" id="ltm-title">LOG TRADE</span>
    <button type="button" class="trade-form-close" id="ltm-close" aria-label="Close">&#x2715;</button>
  </div>
  <div class="trade-form-body">
    <form id="ltm-form" autocomplete="off" novalidate>
      <div class="ltm-fields-list" id="ltm-fields-list">${rowsHtml}</div>
      ${accountHint}
      <div class="ltm-section-label">Photos</div>
      <div class="ltm-photo-section">
        <div class="ltm-dropzone" id="ltm-dropzone" tabindex="0" role="button"
             aria-label="Upload photo — drop files or click to browse">
          <svg class="ltm-dz-icon" width="24" height="24" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span class="ltm-dz-hint">Drop images or paste from clipboard</span>
          <span class="ltm-dz-sub">Click to browse · PNG, JPG, WEBP · max 6</span>
        </div>
        <div class="ltm-photo-previews" id="ltm-photo-previews"></div>
      </div>
      <div class="ltm-section-label">Custom fields</div>
      <div class="ltm-adder-wrap" id="ltm-adder-wrap">
        <button type="button" class="ltm-adder-btn" id="ltm-adder-btn">
          <span aria-hidden="true">+</span> Add field
        </button>
        <div class="ltm-adder-form" id="ltm-adder-form" hidden>
          <input type="text" id="ltm-adder-name" class="trade-input ltm-input ltm-adder-name"
                 placeholder="Field name" maxlength="48" autocomplete="off">
          <select id="ltm-adder-type" class="trade-input trade-select ltm-input ltm-adder-type">
            <option value="text">Text</option>
            <option value="textarea">Long text</option>
            <option value="number">Number</option>
            <option value="yesno">Yes / No</option>
          </select>
          <button type="button" class="ltm-adder-confirm" id="ltm-adder-confirm">Add</button>
          <button type="button" class="ltm-adder-cancel"  id="ltm-adder-cancel">Cancel</button>
        </div>
      </div>
      <div class="trade-form-actions trade-form-actions--split">
        <button type="button" class="trade-delete-btn" id="ltm-delete" hidden>Delete</button>
        <button type="submit" class="trade-submit-btn" id="ltm-submit">SAVE TRADE</button>
      </div>
    </form>
  </div>
  </div>`;
}

function outcomeToLtmSelect(outcomeRaw) {
  const u = String(outcomeRaw || "").trim().toUpperCase();
  if (u === "WIN" || u === "W") return "Win";
  if (u === "LOSS" || u === "L") return "Loss";
  if (u === "BE" || u.includes("BREAK")) return "BE";
  const s = String(outcomeRaw || "").trim();
  if (s === "Win" || s === "Loss" || s === "BE") return s;
  return "";
}

export async function openLogTradeModal(options) {
  const {
    getUserId,
    fetchTradeRowsForPrefill,
    readApiErrorMessage,
    showToast,
    onTradeSaved,
    editTrade,
  } = options;
  const editId = editTrade && typeof editTrade.id === "string" ? editTrade.id.trim() : "";

  if (ltmOpen) return;
  ltmOpen = true;
  ltmPhotos = [];

  const userId = getUserId();

  const [prefillRows, journalRows, accounts, journalFieldsRes] = await Promise.all([
    typeof fetchTradeRowsForPrefill === "function"
      ? fetchTradeRowsForPrefill().catch(() => [])
      : Promise.resolve([]),
    fetchJournalTradesForPrefill(userId),
    fetchAccounts(userId),
    fetch(`/api/journal-fields?user_id=${encodeURIComponent(userId)}`, { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .catch(() => ({})),
  ]);

  const prefill = Array.isArray(prefillRows) ? prefillRows : [];
  const journal = Array.isArray(journalRows) ? journalRows : [];
  const allPrefillRows = [...journal, ...prefill];

  const accountNames = accounts
    .map((a) => String(a.name || "").trim())
    .filter(Boolean);
  const hasAccounts = accountNames.length > 0;

  const pairOptions = mergePairOptions(prefill, journal);
  const coreDefs = buildCoreFieldDefs({ pairOptions, accountNames, hasAccounts });

  let notionFields = [];
  const allFields = Array.isArray(journalFieldsRes.fields) ? journalFieldsRes.fields : [];
  notionFields = allFields
    .filter((f) => !shouldSkipNotionField(f.field_name))
    .map(notionFieldToDef);

  const today = new Date().toISOString().slice(0, 10);
  const allDefs = [...coreDefs, ...notionFields];
  const allIds = allDefs.map((f) => f.id);
  const orderedIds = loadFieldOrder(allIds);
  const orderedDefs = orderedIds.map((id) => allDefs.find((f) => f.id === id)).filter(Boolean);

  const defaults = !editId ? deriveDefaultsFromRows(allPrefillRows, accounts) : null;

  const overlay = document.createElement("div");
  overlay.className = "trade-form-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = buildOverlayHtml(today, orderedDefs, hasAccounts);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add("trade-form-overlay--visible");
    document.getElementById("ltm-panel")?.classList.add("trade-form-panel--visible");
  });

  const form = document.getElementById("ltm-form");
  initPairOtherToggle(form);

  function closeModal() {
    overlay.classList.remove("trade-form-overlay--visible");
    document.getElementById("ltm-panel")?.classList.remove("trade-form-panel--visible");
    overlay.addEventListener(
      "transitionend",
      () => {
        overlay.remove();
        ltmOpen = false;
        ltmPhotos = [];
      },
      { once: true }
    );
    document.removeEventListener("paste", pasteHandler);
    document.removeEventListener("keydown", escHandler);
    document.removeEventListener("mouseup", mouseupHandler);
  }

  const escHandler = (e) => {
    if (e.key === "Escape") closeModal();
  };
  document.addEventListener("keydown", escHandler);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.getElementById("ltm-close").addEventListener("click", closeModal);

  const titleEl = document.getElementById("ltm-title");
  if (titleEl) titleEl.textContent = editId ? "EDIT TRADE" : "LOG TRADE";
  const submitLabel = document.getElementById("ltm-submit");
  if (submitLabel) submitLabel.textContent = editId ? "SAVE CHANGES" : "SAVE TRADE";

  if (editId && editTrade) {
    const delBtn = document.getElementById("ltm-delete");
    if (delBtn) delBtn.hidden = false;

    const ta = editTrade.traded_at ? String(editTrade.traded_at) : "";
    const dateSlice = ta ? ta.slice(0, 10) : today;
    const dateInp = document.getElementById("ltm-f-date");
    if (dateInp) dateInp.value = dateSlice;

    setFormValue(form, "pair", editTrade.pair || "", pairOptions);
    setFormValue(form, "session", editTrade.session || "", pairOptions);
    setFormValue(form, "outcome", outcomeToLtmSelect(editTrade.outcome), pairOptions);
    const rrV = editTrade.rr != null && editTrade.rr !== "" ? editTrade.rr : "";
    setFormValue(form, "rr", rrV === "" ? "" : String(editTrade.rr), pairOptions);
    setFormValue(form, "account", editTrade.account || "", pairOptions);

    const cd =
      editTrade.custom_data && typeof editTrade.custom_data === "object"
        ? editTrade.custom_data
        : {};
    const dirVal = cd.direction || extractDirectionFromRow(editTrade);
    if (dirVal) setFormValue(form, "direction", dirVal, pairOptions);

    for (const k of Object.keys(cd)) {
      if (k === "photos" || k === "direction") continue;
      setFormValue(form, k, cd[k], pairOptions);
    }

    initPairOtherToggle(form);

    if (Array.isArray(cd.photos)) {
      ltmPhotos = cd.photos
        .filter((p) => p && typeof p.url === "string" && p.url.trim())
        .map((p) => ({
          dataUrl: p.url.trim(),
          label: typeof p.label === "string" ? p.label : "",
        }));
      renderPhotoPreviews(document.getElementById("ltm-photo-previews"));
    }

    if (delBtn) {
      delBtn.addEventListener("click", async () => {
        if (!confirm("Delete this trade from your journal? This cannot be undone.")) return;
        delBtn.disabled = true;
        try {
          const q = new URLSearchParams({
            id: editId,
            user_id: `eq.${getUserId()}`,
          });
          const res = await fetch(`/api/journal-trades?${q.toString()}`, {
            method: "DELETE",
            cache: "no-store",
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(readApiErrorMessage(d) || `Delete failed (${res.status})`);
          }
          closeModal();
          showToast("Trade deleted.");
          if (onTradeSaved) await onTradeSaved();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Delete failed.";
          showToast(msg, true);
          delBtn.disabled = false;
        }
      });
    }
  } else if (defaults) {
    applyNewTradeDefaults(form, defaults, pairOptions);
  }

  const fieldsList = document.getElementById("ltm-fields-list");
  initFieldDrag(fieldsList);
  const mouseupHandler = () => {};
  document.addEventListener("mouseup", mouseupHandler, { passive: true });

  const dropzone = document.getElementById("ltm-dropzone");
  const previews = document.getElementById("ltm-photo-previews");

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("ltm-dropzone--over");
  });
  dropzone.addEventListener("dragleave", (e) => {
    if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove("ltm-dropzone--over");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("ltm-dropzone--over");
    Array.from(e.dataTransfer.files).forEach((f) => addPhotoFile(f, previews));
  });
  dropzone.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.multiple = true;
    inp.onchange = () => Array.from(inp.files || []).forEach((f) => addPhotoFile(f, previews));
    inp.click();
  });
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dropzone.click();
    }
  });

  const pasteHandler = (e) => {
    if (!document.body.contains(overlay)) return;
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith("image/")) addPhotoFile(item.getAsFile(), previews);
    }
  };
  document.addEventListener("paste", pasteHandler);

  previews.addEventListener("click", (e) => {
    const btn = e.target.closest(".ltm-thumb-remove");
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if (!isNaN(idx)) {
      ltmPhotos.splice(idx, 1);
      renderPhotoPreviews(previews);
    }
  });

  const adderBtn = document.getElementById("ltm-adder-btn");
  const adderForm = document.getElementById("ltm-adder-form");
  const adderName = document.getElementById("ltm-adder-name");
  const adderType = document.getElementById("ltm-adder-type");
  const adderConfirm = document.getElementById("ltm-adder-confirm");
  const adderCancel = document.getElementById("ltm-adder-cancel");
  const userAddedFields = [];

  adderBtn.addEventListener("click", () => {
    adderBtn.hidden = true;
    adderForm.hidden = false;
    adderName.focus();
  });
  adderCancel.addEventListener("click", () => {
    adderBtn.hidden = false;
    adderForm.hidden = true;
    adderName.value = "";
  });
  adderConfirm.addEventListener("click", () => {
    const label = adderName.value.trim();
    if (!label) {
      adderName.focus();
      return;
    }
    const type = adderType.value;
    const def = { id: label, label, type, options: [] };
    userAddedFields.push(def);
    fieldsList.insertAdjacentHTML("beforeend", renderFieldRow(def, today));
    adderBtn.hidden = false;
    adderForm.hidden = true;
    adderName.value = "";
  });

  const outcomeEl = document.querySelector("#ltm-form [name='outcome']");
  const rrRow = fieldsList.querySelector("[data-field-id='rr']");
  function syncRR() {
    if (rrRow) rrRow.style.display = outcomeEl?.value === "BE" ? "none" : "";
  }
  outcomeEl?.addEventListener("change", syncRR);
  syncRR();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);

    const dateVal = (fd.get("date") || "").trim();
    let pair = (fd.get("pair") || "").trim();
    if (pair === PAIR_OTHER) pair = (fd.get("pair_other") || "").trim();
    const session = (fd.get("session") || "").trim();
    const outcome = (fd.get("outcome") || "").trim();
    const rrRaw = fd.get("rr");
    const rr = rrRaw !== "" && rrRaw !== null ? Number(rrRaw) : null;
    let account = (fd.get("account") || "").trim();
    const direction = (fd.get("direction") || "").trim();

    if (account === "No account — add on Account page") account = "";

    if (!dateVal || !session || !outcome) {
      showToast("Date, Session and Outcome are required.", true);
      return;
    }

    const custom_data = {};
    if (direction) custom_data.direction = direction;

    for (const f of [...notionFields, ...userAddedFields]) {
      const v = (fd.get(f.id) || "").trim();
      if (v) custom_data[f.id] = v;
    }
    if (ltmPhotos.length) {
      custom_data.photos = ltmPhotos.map((p) => ({ url: p.dataUrl, label: p.label }));
    }

    const submitBtn = document.getElementById("ltm-submit");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving…";
    }

    try {
      const basePayload = {
        user_id: getUserId(),
        traded_at: `${dateVal}T00:00:00.000Z`,
        pair: pair || null,
        outcome,
        rr: rr !== null && !Number.isNaN(rr) ? rr : null,
        session,
        account: account || null,
        custom_data,
      };
      const res = await fetch(editId ? "/api/journal-trades" : "/api/log-trade", {
        method: editId ? "PATCH" : "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editId ? { id: editId, ...basePayload } : basePayload),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(readApiErrorMessage(d) || `Save failed (${res.status})`);
      }

      closeModal();
      showToast(editId ? "Trade updated." : "Trade logged.");
      if (onTradeSaved) {
        await onTradeSaved({
          outcome,
          pair,
          session,
          rr,
          account,
          direction,
          custom_data,
          dateVal,
          userId: getUserId(),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed.";
      showToast(msg, true);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = editId ? "SAVE CHANGES" : "SAVE TRADE";
      }
    }
  });

  document.getElementById("ltm-f-date")?.focus();
}
