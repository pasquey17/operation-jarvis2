/**
 * LOG TRADE modal — premium rebuild.
 * Drag-to-reorder fields. Per-user chart photo slots. Saves to /api/log-trade.
 */

import {
  TRADE_SUMMARY_FIELD_ID,
  TRADE_SUMMARY_STORAGE_KEY,
  CANONICAL_CORE_ORDER,
  normalizeFieldKey,
  shouldSkipJournalFieldName,
  isCoreFieldId,
  filterAndDedupeJournalFieldRows,
} from "./log-trade-field-skip.mjs";
import {
  loadPhotoSlotsForUser,
  persistPhotoSlotsForUser,
  makePhotoSlotId,
  sortPhotoSlots,
} from "./journal-photo-slots-client.mjs";
import { apiFetch, getAuthUserId } from "./jarvis-auth.js";

export const LOG_DEFAULTS_STORAGE_KEY = "jarvis_log_defaults_v1";
const FIELD_ORDER_KEY_PREFIX = "jarvis_field_order_v4_";
const FIELD_ORDER_KEY_LEGACY = "jarvis_field_order_v3";
const HIDDEN_FIELDS_KEY = "jarvis_hidden_journal_fields_v1";
const PAIR_OTHER = "Other";
const MAX_ORPHAN_PHOTOS = 8;
const MAX_TOTAL_PHOTOS = 24;
const MAX_PHOTO_SLOTS = 12;

const CURATED_PAIRS = ["XAUUSD", "NAS100", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD"];

let ltmOpen = false;
/** @type {{ slot_id: string, label: string, display_order: number }[]} */
let ltmPhotoSlotDefs = [];
/** @type {Record<string, { dataUrl: string, label: string } | null>} */
let ltmSlotPhotos = {};
/** @type {{ dataUrl: string, label: string }[]} */
let ltmExtraPhotos = [];
let ltmFocusedSlotId = null;
let ltmCurrentUserId = "";
let ltmPersistPhotoSlots = async () => {};

async function resolveModalUserId(getUserId) {
  if (typeof getUserId === "function") {
    try {
      const raw = await getUserId();
      const uid = String(raw ?? "").trim();
      if (uid) return uid;
    } catch {
      /* fall through */
    }
  }
  try {
    const authUid = String((await getAuthUserId()) ?? "").trim();
    if (authUid) return authUid;
  } catch {
    /* fall through */
  }
  const auth = globalThis.JarvisAuth;
  if (auth && typeof auth.getUserId === "function") {
    try {
      const legacyUid = String((await auth.getUserId()) ?? "").trim();
      if (legacyUid) return legacyUid;
    } catch {
      /* fall through */
    }
  }
  return "";
}

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

function loadHiddenFieldKeySet() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_FIELDS_KEY) || "[]");
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.map((k) => normalizeFieldKey(k)).filter(Boolean));
  } catch {
    return new Set();
  }
}

function hideJournalFieldKey(fieldId) {
  const key = normalizeFieldKey(fieldId);
  if (!key || isCoreFieldId(fieldId)) return;
  const set = loadHiddenFieldKeySet();
  set.add(key);
  try {
    localStorage.setItem(HIDDEN_FIELDS_KEY, JSON.stringify([...set]));
  } catch {}
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
    const r = await apiFetch("/api/accounts");
    const data = await r.json().catch(() => ({}));
    return Array.isArray(data.accounts) ? data.accounts : [];
  } catch {
    return [];
  }
}

async function fetchJournalTradesForPrefill(userId) {
  try {
    const r = await apiFetch("/api/journal-trades");
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

function deriveLastRRFromRows(rows) {
  for (const row of rows) {
    const outcome = outcomeToLtmSelect(row.outcome || getRowField(row, "outcome", "Outcome"));
    if (outcome === "BE") continue;
    const rrRaw = row.rr != null && row.rr !== "" ? row.rr : getRowField(row, "rr", "RR");
    if (rrRaw === "" || rrRaw == null) continue;
    const n = Number(rrRaw);
    if (Number.isFinite(n) && n >= 0) return String(n);
  }
  return "";
}

function fieldOrderStorageKey(userId) {
  const uid = String(userId || "default").trim().toLowerCase() || "default";
  return `${FIELD_ORDER_KEY_PREFIX}${uid}`;
}

function readSavedFieldOrder(userId) {
  try {
    const key = fieldOrderStorageKey(userId);
    let raw = localStorage.getItem(key);
    if (!raw) {
      raw = localStorage.getItem(FIELD_ORDER_KEY_LEGACY);
    }
    const parsed = JSON.parse(raw || "null");
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Default: core block first, then Notion extras (already sorted by display_order). */
function defaultFieldOrder(allIds) {
  const coreSet = new Set(CANONICAL_CORE_ORDER);
  const corePresent = CANONICAL_CORE_ORDER.filter((id) => allIds.includes(id));
  const extras = allIds.filter((id) => !coreSet.has(id));
  return [...corePresent, ...extras];
}

function loadFieldOrder(allIds, userId) {
  const allSet = new Set(allIds);
  try {
    const saved = readSavedFieldOrder(userId);
    if (!saved?.length) return defaultFieldOrder(allIds);

    const seen = new Set();
    const ordered = [];
    for (const id of saved) {
      if (!id || !allSet.has(id) || seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
    for (const id of allIds) {
      if (!seen.has(id)) ordered.push(id);
    }
    return ordered;
  } catch {
    return defaultFieldOrder(allIds);
  }
}

/** Core fields first by default; user drag order persists in full (per user). */
function buildLogTradeFieldList(coreDefs, journalFieldRows, hiddenKeys, userId) {
  const coreOrdered = CANONICAL_CORE_ORDER.map((id) => coreDefs.find((f) => f.id === id)).filter(Boolean);
  const extras = filterAndDedupeJournalFieldRows(journalFieldRows)
    .filter((f) => !hiddenKeys.has(normalizeFieldKey(f.field_name)))
    .map(notionFieldToDef);
  const allDefs = [...coreOrdered, ...extras];
  const orderedIds = loadFieldOrder(
    allDefs.map((f) => f.id),
    userId
  );
  return orderedIds.map((id) => allDefs.find((f) => f.id === id)).filter(Boolean);
}

function saveFieldOrder(ids, userId) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return;
  try {
    localStorage.setItem(fieldOrderStorageKey(userId), JSON.stringify(list));
  } catch {}
}

function persistFieldOrderFromDom(fieldsList, userId) {
  if (!fieldsList) return;
  const ids = Array.from(fieldsList.querySelectorAll(".ltm-field-row"))
    .map((r) => r.dataset.fieldId)
    .filter(Boolean);
  saveFieldOrder(ids, userId);
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
    {
      id: TRADE_SUMMARY_FIELD_ID,
      label: "Trade summary",
      type: "textarea",
      placeholder: "What happened on this trade?",
    },
  ];
}

function notionFieldToDef(f) {
  const n = (f.field_name || "").toLowerCase();
  let type = "text";
  let options = [];
  if (f.field_type === "dropdown") {
    type = "select";
    try {
      options = JSON.parse(f.field_options || "[]");
    } catch {}
  } else if (f.field_type === "multiselect") {
    type = "multiselect";
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

function buildOutcomeInputHtml(field) {
  const id = fieldInputId(field.id);
  const opts = field.options || ["Win", "Loss", "BE"];
  const chips = opts
    .map((o) => {
      const mod = o === "Win" ? " ltm-outcome-chip--win" : o === "Loss" ? " ltm-outcome-chip--loss" : " ltm-outcome-chip--be";
      return `<button type="button" class="ltm-outcome-chip${mod}" data-outcome="${escAttr(o)}" aria-pressed="false">${escHtml(o)}</button>`;
    })
    .join("");
  const selectOpts = opts.map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join("");
  return `<div class="ltm-outcome-wrap">
    <div class="ltm-outcome-chips" role="group" aria-label="Outcome">${chips}</div>
    <select id="${id}" name="outcome" class="ltm-outcome-select trade-input trade-select ltm-input" required tabindex="-1" aria-hidden="true">
      <option value="">Choose outcome</option>${selectOpts}
    </select>
  </div>`;
}

function syncOutcomeChipsFromSelect(form) {
  if (!form) return;
  const sel = form.elements.namedItem("outcome");
  const v = sel && "value" in sel ? String(sel.value || "") : "";
  form.querySelectorAll(".ltm-outcome-chip").forEach((btn) => {
    const on = btn.dataset.outcome === v;
    btn.classList.toggle("ltm-outcome-chip--active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function initOutcomeChips(form, onOutcomeChange) {
  if (!form) return;
  const sel = form.elements.namedItem("outcome");
  if (!sel) return;

  form.querySelectorAll(".ltm-outcome-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.outcome || "";
      sel.value = v;
      syncOutcomeChipsFromSelect(form);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      if (onOutcomeChange) onOutcomeChange();
    });
  });

  sel.addEventListener("change", () => {
    syncOutcomeChipsFromSelect(form);
    if (onOutcomeChange) onOutcomeChange();
  });

  syncOutcomeChipsFromSelect(form);
}

function initMultiselectFields(container) {
  if (!container) return;
  container.querySelectorAll(".ltm-multiselect-wrap:not([data-ms-inited])").forEach((wrap) => {
    wrap.dataset.msInited = "1";
    const picker = wrap.querySelector("[data-ms-picker]");
    const chipsEl = wrap.querySelector(".ltm-ms-chips");
    if (!picker || !chipsEl) return;

    function addChip(value) {
      if (!value) return;
      const alreadySelected = Array.from(
        wrap.querySelectorAll("input[type='hidden']")
      ).some((inp) => inp.value === value);
      if (alreadySelected) { picker.value = ""; return; }

      const optToRemove = Array.from(picker.options).find((o) => o.value === value);
      if (optToRemove) optToRemove.remove();

      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.name = wrap.dataset.msName;
      inp.value = value;
      inp.dataset.msHidden = "1";
      wrap.appendChild(inp);

      const chip = document.createElement("span");
      chip.className = "ltm-ms-chip";
      chip.dataset.msValue = value;
      const xBtn = document.createElement("button");
      xBtn.type = "button";
      xBtn.className = "ltm-ms-chip-x";
      xBtn.setAttribute("aria-label", `Remove ${value}`);
      xBtn.textContent = "×";
      xBtn.addEventListener("click", () => removeChip(value));
      chip.appendChild(document.createTextNode(value));
      chip.appendChild(xBtn);
      chipsEl.appendChild(chip);

      picker.value = "";
    }

    function removeChip(value) {
      chipsEl.querySelectorAll(".ltm-ms-chip").forEach((el) => {
        if (el.dataset.msValue === value) el.remove();
      });
      wrap.querySelectorAll("input[type='hidden'][data-ms-hidden]").forEach((el) => {
        if (el.value === value) el.remove();
      });
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      picker.appendChild(opt);
    }

    picker.addEventListener("change", () => addChip(picker.value));
    wrap._addChip = addChip;
  });
}

function clearFormValidation(form) {
  if (!form) return;
  form.querySelectorAll(".ltm-field-row--error").forEach((row) => {
    row.classList.remove("ltm-field-row--error");
  });
}

function validateLogTradeForm(form, fieldsList) {
  clearFormValidation(form);
  const checks = [
    { name: "date", label: "Date" },
    { name: "session", label: "Session" },
    { name: "outcome", label: "Outcome" },
  ];

  for (const c of checks) {
    const el = form.elements.namedItem(c.name);
    const val = el && "value" in el ? String(el.value || "").trim() : "";
    if (val) continue;

    const row = fieldsList?.querySelector(`[data-field-id="${c.name}"]`);
    row?.classList.add("ltm-field-row--error");

    if (c.name === "outcome") {
      const chip = form.querySelector(".ltm-outcome-chip");
      chip?.focus();
    } else {
      el?.focus();
    }

    return { ok: false, message: `${c.label} is required.` };
  }

  return { ok: true };
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
    case "multiselect": {
      const opts = (field.options || [])
        .map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`)
        .join("");
      return `<div class="ltm-multiselect-wrap ltm-input" data-ms-name="${escAttr(name)}" role="group" aria-label="${escAttr(field.label || name)}">
  <div class="ltm-ms-chips"></div>
  <select class="ltm-ms-picker" data-ms-picker aria-label="Add ${escAttr(field.label || name)}">
    <option value="">+ ${escHtml(ph)}</option>
    ${opts}
  </select>
</div>`;
    }
    case "yesno":
      return `<select id="${id}" name="${escAttr(name)}" class="trade-input trade-select ltm-input"><option value="">${escHtml(ph)}</option><option value="Yes">Yes</option><option value="No">No</option></select>`;
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
  const inputHtml =
    field.id === "outcome" ? buildOutcomeInputHtml(field) : buildInputHtml(field, today);
  const removable = !isCoreFieldId(field.id);
  const removeBtn = removable
    ? `<button type="button" class="ltm-field-remove" data-remove-field-id="${escAttr(field.id)}" aria-label="Remove field" title="Remove from form">×</button>`
    : "";
  return `<div class="ltm-field-row${removable ? " ltm-field-row--removable" : ""}" data-field-id="${escAttr(field.id)}" draggable="true">
  <div class="ltm-drag-handle" title="Drag to reorder" aria-hidden="true">
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <circle cx="3" cy="3"  r="1.3"/><circle cx="7" cy="3"  r="1.3"/>
      <circle cx="3" cy="8"  r="1.3"/><circle cx="7" cy="8"  r="1.3"/>
      <circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/>
    </svg>
  </div>
  <div class="ltm-field-inner">
    <div class="ltm-label-row">
      <label class="trade-label ltm-label" for="${escAttr(inputId)}">${escHtml(field.label)}</label>
      ${removeBtn}
    </div>
    ${inputHtml}
    ${pairOther}
  </div>
</div>`;
}

function findSlotDef(slotId) {
  return ltmPhotoSlotDefs.find((s) => s.slot_id === slotId);
}

function countFilledPhotos() {
  let n = 0;
  for (const slot of ltmPhotoSlotDefs) {
    if (ltmSlotPhotos[slot.slot_id]?.dataUrl) n += 1;
  }
  n += ltmExtraPhotos.filter((p) => p?.dataUrl).length;
  return n;
}

function updatePhotoCountUI() {
  const el = document.getElementById("ltm-photo-count");
  if (!el) return;
  const n = countFilledPhotos();
  if (!n) {
    el.textContent = "";
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = `${n} photo${n === 1 ? "" : "s"}`;
}

function photosToPayload() {
  const out = [];
  for (const slot of ltmPhotoSlotDefs) {
    const p = ltmSlotPhotos[slot.slot_id];
    if (p?.dataUrl) out.push({ url: p.dataUrl, label: slot.label });
  }
  for (const p of ltmExtraPhotos) {
    if (p?.dataUrl) out.push({ url: p.dataUrl, label: p.label || "Photo" });
  }
  return out;
}

function syncSlotPhotoMap() {
  const next = {};
  for (const slot of ltmPhotoSlotDefs) {
    next[slot.slot_id] = ltmSlotPhotos[slot.slot_id] ?? null;
  }
  ltmSlotPhotos = next;
}

function hydratePhotosFromCustomData(photos) {
  const arr = Array.isArray(photos) ? photos : [];
  ltmExtraPhotos = [];
  syncSlotPhotoMap();
  for (const p of arr) {
    if (!p || typeof p.url !== "string" || !p.url.trim()) continue;
    const labelKey = normalizeFieldKey(p.label);
    const slot = ltmPhotoSlotDefs.find((s) => normalizeFieldKey(s.label) === labelKey);
    if (slot && !ltmSlotPhotos[slot.slot_id]?.dataUrl) {
      ltmSlotPhotos[slot.slot_id] = { dataUrl: p.url.trim(), label: slot.label };
    } else if (ltmExtraPhotos.length < MAX_ORPHAN_PHOTOS) {
      ltmExtraPhotos.push({
        dataUrl: p.url.trim(),
        label: typeof p.label === "string" && p.label.trim() ? p.label.trim() : "Photo",
      });
    }
  }
}

function resetPhotoState() {
  ltmSlotPhotos = {};
  ltmExtraPhotos = [];
  ltmFocusedSlotId = null;
  syncSlotPhotoMap();
}

function buildChartPhotosInnerHtml() {
  if (!ltmPhotoSlotDefs.length) {
    return `<p class="ltm-photo-empty-hint">No photo slots yet — add one below or open Customize form.</p>`;
  }
  const slots = ltmPhotoSlotDefs
    .map(
      (slot) =>
        `<div class="ltm-chart-slot" data-slot-id="${escAttr(slot.slot_id)}">
      <div class="ltm-chart-slot__label-row">
        <span class="ltm-chart-slot__label">${escHtml(slot.label)}</span>
        <button type="button" class="ltm-slot-label-edit" data-slot-edit="${escAttr(slot.slot_id)}" aria-label="Rename ${escAttr(slot.label)}" title="Rename">&#9998;</button>
        <button type="button" class="ltm-slot-def-remove" data-slot-def-remove="${escAttr(slot.slot_id)}" aria-label="Remove slot" title="Remove slot">&times;</button>
      </div>
      <div class="ltm-chart-slot__drop" tabindex="0" role="button" aria-label="Add ${escAttr(slot.label)} photo">
        <span class="ltm-chart-slot__hint">Click here, then paste</span>
        <span class="ltm-chart-slot__sub">Drop, click, or Ctrl+V</span>
      </div>
      <div class="ltm-chart-slot__preview" data-slot-preview="${escAttr(slot.slot_id)}"></div>
    </div>`
    )
    .join("");
  return `<div class="ltm-chart-slots">${slots}</div>
    <div class="ltm-extra-photos" id="ltm-extra-photos"></div>
    <button type="button" class="ltm-add-photo-slot" id="ltm-add-photo-slot">+ Add photo slot</button>`;
}

function refreshPhotoSectionDOM() {
  const section = document.getElementById("ltm-photo-section");
  if (!section) return;
  section.innerHTML = buildChartPhotosInnerHtml();
  delete section.dataset.photoBound;
  renderAllSlotPreviews();
}

function renderSlotPreview(slotId) {
  const el = document.querySelector(`[data-slot-preview="${slotId}"]`);
  if (!el) return;
  const p = ltmSlotPhotos[slotId];
  if (!p?.dataUrl) {
    el.innerHTML = "";
    return;
  }
  const slot = findSlotDef(slotId);
  el.innerHTML = `<div class="ltm-thumb">
    <img class="ltm-thumb-img" src="${escHtml(p.dataUrl)}" alt="${escHtml(slot?.label || "Chart")}">
    <button type="button" class="ltm-thumb-remove" data-slot-clear="${escAttr(slotId)}" aria-label="Remove photo">&times;</button>
  </div>`;
}

function renderExtraPhotoPreviews() {
  const container = document.getElementById("ltm-extra-photos");
  if (!container) return;
  if (!ltmExtraPhotos.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `<div class="ltm-section-label ltm-section-label--orphan">Other photos</div>${ltmExtraPhotos
    .map(
      (p, i) =>
        `<div class="ltm-extra-photo">
      <span class="ltm-extra-photo__label">${escHtml(p.label || "Photo")}</span>
      <div class="ltm-thumb">
        <img class="ltm-thumb-img" src="${escHtml(p.dataUrl)}" alt="">
        <button type="button" class="ltm-thumb-remove" data-extra-idx="${i}" aria-label="Remove">&times;</button>
      </div>
    </div>`
    )
    .join("")}`;
}

function renderAllSlotPreviews() {
  for (const slot of ltmPhotoSlotDefs) renderSlotPreview(slot.slot_id);
  renderExtraPhotoPreviews();
  updatePhotoCountUI();
}

function setSlotPhoto(slotId, dataUrl) {
  const slot = findSlotDef(slotId);
  if (!slot) return false;
  if (countFilledPhotos() >= MAX_TOTAL_PHOTOS && !ltmSlotPhotos[slotId]?.dataUrl) return false;
  ltmSlotPhotos[slotId] = { dataUrl, label: slot.label };
  renderSlotPreview(slotId);
  updatePhotoCountUI();
  return true;
}

function addPhotoToSlot(file, slotId) {
  if (!file || !file.type.startsWith("image/")) return false;
  if (!slotId || !findSlotDef(slotId)) return addPhotoToFocusedOrFirstEmpty(file);
  if (countFilledPhotos() >= MAX_TOTAL_PHOTOS && !ltmSlotPhotos[slotId]?.dataUrl) return false;
  const reader = new FileReader();
  reader.onload = (ev) => setSlotPhoto(slotId, ev.target.result);
  reader.readAsDataURL(file);
  return true;
}

function addPhotoToFocusedOrFirstEmpty(file) {
  if (!file || !file.type.startsWith("image/")) return false;
  if (countFilledPhotos() >= MAX_TOTAL_PHOTOS) return false;
  const targetId =
    ltmFocusedSlotId ||
    ltmPhotoSlotDefs.find((s) => !ltmSlotPhotos[s.slot_id]?.dataUrl)?.slot_id ||
    null;
  if (targetId) {
    const reader = new FileReader();
    reader.onload = (ev) => setSlotPhoto(targetId, ev.target.result);
    reader.readAsDataURL(file);
    return true;
  }
  return false;
}

function clipboardHasImage(e) {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

function isTextInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const t = (el.type || "text").toLowerCase();
    return !["button", "submit", "checkbox", "radio", "file"].includes(t);
  }
  return el.isContentEditable;
}

async function addPhotoSlotDefinition(label, showToast) {
  const name = String(label || "").trim();
  if (!name) return false;
  if (ltmPhotoSlotDefs.length >= MAX_PHOTO_SLOTS) {
    showToast?.(`Maximum ${MAX_PHOTO_SLOTS} photo slots.`, true);
    return false;
  }
  const slot_id = makePhotoSlotId();
  ltmPhotoSlotDefs = sortPhotoSlots([
    ...ltmPhotoSlotDefs,
    { slot_id, label: name, display_order: ltmPhotoSlotDefs.length },
  ]);
  syncSlotPhotoMap();
  await ltmPersistPhotoSlots();
  refreshPhotoSectionDOM();
  mountPhotoSectionHandlers(document.querySelector(".trade-form-overlay"), showToast);
  return true;
}

async function removePhotoSlotDefinition(slotId, showToast) {
  const slot = findSlotDef(slotId);
  if (!slot) return;
  const hasImage = !!ltmSlotPhotos[slotId]?.dataUrl;
  if (hasImage && !confirm(`Remove slot "${slot.label}"? The photo in this trade will be cleared.`)) return;
  ltmPhotoSlotDefs = ltmPhotoSlotDefs.filter((s) => s.slot_id !== slotId);
  delete ltmSlotPhotos[slotId];
  ltmPhotoSlotDefs = sortPhotoSlots(
    ltmPhotoSlotDefs.map((s, i) => ({ ...s, display_order: i }))
  );
  syncSlotPhotoMap();
  await ltmPersistPhotoSlots();
  refreshPhotoSectionDOM();
  mountPhotoSectionHandlers(document.querySelector(".trade-form-overlay"), showToast);
  showToast?.("Photo slot removed.", false);
}

async function renamePhotoSlotDefinition(slotId, newLabel, showToast) {
  const label = String(newLabel || "").trim();
  if (!label) return;
  const idx = ltmPhotoSlotDefs.findIndex((s) => s.slot_id === slotId);
  if (idx < 0) return;
  ltmPhotoSlotDefs[idx] = { ...ltmPhotoSlotDefs[idx], label };
  if (ltmSlotPhotos[slotId]) ltmSlotPhotos[slotId].label = label;
  await ltmPersistPhotoSlots();
  refreshPhotoSectionDOM();
  mountPhotoSectionHandlers(document.querySelector(".trade-form-overlay"), showToast);
  showToast?.("Slot renamed.", false);
}

function mountPhotoSectionHandlers(overlay, showToast) {
  const section = document.getElementById("ltm-photo-section");
  if (!section || section.dataset.photoBound === "1") return;
  section.dataset.photoBound = "1";

  section.addEventListener("focusin", (e) => {
    const drop = e.target.closest(".ltm-chart-slot__drop");
    if (!drop) return;
    const slotEl = drop.closest("[data-slot-id]");
    if (slotEl) ltmFocusedSlotId = slotEl.getAttribute("data-slot-id");
  });

  section.addEventListener("paste", (e) => {
    const drop = e.target.closest(".ltm-chart-slot__drop");
    if (!drop) return;
    const file = clipboardHasImage(e);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    const slotId = drop.closest("[data-slot-id]")?.getAttribute("data-slot-id");
    if (slotId) addPhotoToSlot(file, slotId);
  });

  section.addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-slot-edit]");
    if (editBtn) {
      e.preventDefault();
      const sid = editBtn.getAttribute("data-slot-edit");
      const slot = findSlotDef(sid);
      const next = prompt("Rename photo slot:", slot?.label || "");
      if (next != null) void renamePhotoSlotDefinition(sid, next, showToast);
      return;
    }
    const removeDef = e.target.closest("[data-slot-def-remove]");
    if (removeDef) {
      e.preventDefault();
      void removePhotoSlotDefinition(removeDef.getAttribute("data-slot-def-remove"), showToast);
      return;
    }
    const clearSlot = e.target.closest("[data-slot-clear]");
    if (clearSlot) {
      const sid = clearSlot.getAttribute("data-slot-clear");
      ltmSlotPhotos[sid] = null;
      renderSlotPreview(sid);
      updatePhotoCountUI();
      return;
    }
    const extraBtn = e.target.closest("[data-extra-idx]");
    if (extraBtn) {
      const idx = parseInt(extraBtn.getAttribute("data-extra-idx"), 10);
      if (!isNaN(idx)) {
        ltmExtraPhotos.splice(idx, 1);
        renderExtraPhotoPreviews();
        updatePhotoCountUI();
      }
      return;
    }
    const drop = e.target.closest(".ltm-chart-slot__drop");
    if (drop && !e.target.closest(".ltm-thumb-remove")) {
      const slotId = drop.closest("[data-slot-id]")?.getAttribute("data-slot-id");
      ltmFocusedSlotId = slotId;
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "image/*";
      inp.onchange = () => {
        const f = inp.files?.[0];
        if (f && slotId) addPhotoToSlot(f, slotId);
      };
      inp.click();
    }
  });

  section.addEventListener("dragover", (e) => {
    const drop = e.target.closest(".ltm-chart-slot__drop");
    if (!drop) return;
    e.preventDefault();
    drop.classList.add("ltm-chart-slot__drop--over");
  });
  section.addEventListener("dragleave", (e) => {
    const drop = e.target.closest(".ltm-chart-slot__drop");
    if (drop && !drop.contains(e.relatedTarget)) drop.classList.remove("ltm-chart-slot__drop--over");
  });
  section.addEventListener("drop", (e) => {
    const drop = e.target.closest(".ltm-chart-slot__drop");
    if (!drop) return;
    e.preventDefault();
    drop.classList.remove("ltm-chart-slot__drop--over");
    const slotId = drop.closest("[data-slot-id]")?.getAttribute("data-slot-id");
    const f = e.dataTransfer.files?.[0];
    if (f && slotId) addPhotoToSlot(f, slotId);
  });

  document.getElementById("ltm-add-photo-slot")?.addEventListener("click", () => {
    const name = prompt("Photo slot name (e.g. HTF, Context, Execution):", "");
    if (name != null) void addPhotoSlotDefinition(name, showToast);
  });
}

function buildDocumentPasteHandler(overlay) {
  return (e) => {
    if (!document.body.contains(overlay)) return;
    if (isTextInputFocused()) return;
    const file = clipboardHasImage(e);
    if (!file) return;
    if (ltmFocusedSlotId && findSlotDef(ltmFocusedSlotId)) {
      e.preventDefault();
      addPhotoToSlot(file, ltmFocusedSlotId);
      return;
    }
    if (addPhotoToFocusedOrFirstEmpty(file)) e.preventDefault();
  };
}

function buildCustomizePanelHtml() {
  const rows = ltmPhotoSlotDefs
    .map(
      (s, i) =>
        `<div class="ltm-customize-row" data-customize-slot="${escAttr(s.slot_id)}">
      <input type="text" class="trade-input ltm-input ltm-customize-label" value="${escAttr(s.label)}" maxlength="48" aria-label="Slot name">
      <div class="ltm-customize-order">
        <button type="button" class="ltm-customize-move" data-move-up="${escAttr(s.slot_id)}" ${i === 0 ? "disabled" : ""} aria-label="Move up">&#9650;</button>
        <button type="button" class="ltm-customize-move" data-move-down="${escAttr(s.slot_id)}" ${i === ltmPhotoSlotDefs.length - 1 ? "disabled" : ""} aria-label="Move down">&#9660;</button>
      </div>
      <button type="button" class="ltm-customize-del" data-customize-del="${escAttr(s.slot_id)}" aria-label="Delete slot">&times;</button>
    </div>`
    )
    .join("");
  return `<div class="ltm-customize-panel" id="ltm-customize-panel" hidden>
    <div class="ltm-customize-header">
      <span class="ltm-customize-title">Customize form</span>
      <button type="button" class="ltm-customize-close" id="ltm-customize-close" aria-label="Close">&times;</button>
    </div>
    <p class="ltm-customize-note">Photo slots are saved for your account. Extra journal fields still sync from Notion when connected.</p>
    <div class="ltm-customize-slots" id="ltm-customize-slots">${rows || '<p class="ltm-customize-empty">No photo slots — add one below.</p>'}</div>
    <button type="button" class="ltm-customize-add" id="ltm-customize-add">+ Add photo slot</button>
    <button type="button" class="trade-submit-btn ltm-customize-save" id="ltm-customize-save">Save layout</button>
  </div>`;
}

function refreshCustomizePanelDOM() {
  const existing = document.getElementById("ltm-customize-panel");
  if (!existing) return;
  const parent = existing.parentElement;
  const wasOpen = !existing.hidden;
  existing.remove();
  parent?.insertAdjacentHTML("beforeend", buildCustomizePanelHtml());
  const panel = document.getElementById("ltm-customize-panel");
  if (panel && wasOpen) panel.hidden = false;
}

function bindCustomizePanelEvents(overlay, showToast, closePanel) {
  const panel = document.getElementById("ltm-customize-panel");
  if (!panel) return;

  document.getElementById("ltm-customize-close")?.addEventListener("click", closePanel);

  document.getElementById("ltm-customize-add")?.addEventListener("click", () => {
    const name = prompt("Photo slot name:", "");
    if (name != null && String(name).trim()) {
      void addPhotoSlotDefinition(name, showToast).then(() => refreshCustomizePanelDOM());
    }
  });

  panel.querySelectorAll("[data-customize-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void removePhotoSlotDefinition(btn.getAttribute("data-customize-del"), showToast).then(() =>
        refreshCustomizePanelDOM()
      );
    });
  });

  panel.querySelectorAll("[data-move-up]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-move-up");
      const i = ltmPhotoSlotDefs.findIndex((s) => s.slot_id === id);
      if (i <= 0) return;
      const copy = [...ltmPhotoSlotDefs];
      [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]];
      ltmPhotoSlotDefs = sortPhotoSlots(copy.map((s, idx) => ({ ...s, display_order: idx })));
      refreshCustomizePanelDOM();
      bindCustomizePanelEvents(overlay, showToast, closePanel);
    });
  });

  panel.querySelectorAll("[data-move-down]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-move-down");
      const i = ltmPhotoSlotDefs.findIndex((s) => s.slot_id === id);
      if (i < 0 || i >= ltmPhotoSlotDefs.length - 1) return;
      const copy = [...ltmPhotoSlotDefs];
      [copy[i], copy[i + 1]] = [copy[i + 1], copy[i]];
      ltmPhotoSlotDefs = sortPhotoSlots(copy.map((s, idx) => ({ ...s, display_order: idx })));
      refreshCustomizePanelDOM();
      bindCustomizePanelEvents(overlay, showToast, closePanel);
    });
  });

  document.getElementById("ltm-customize-save")?.addEventListener("click", async () => {
    const labels = panel.querySelectorAll(".ltm-customize-label");
    ltmPhotoSlotDefs = sortPhotoSlots(
      ltmPhotoSlotDefs.map((s, i) => ({
        ...s,
        label: labels[i]?.value?.trim() || s.label,
        display_order: i,
      }))
    );
    syncSlotPhotoMap();
    await ltmPersistPhotoSlots();
    refreshPhotoSectionDOM();
    mountPhotoSectionHandlers(overlay, showToast);
    showToast?.("Form layout saved.", false);
    closePanel();
  });
}

function initCustomizePanel(overlay, showToast) {
  const openBtn = document.getElementById("ltm-customize-btn");
  const panel = document.getElementById("ltm-customize-panel");
  if (!openBtn || !panel) return;

  const closePanel = () => {
    panel.hidden = true;
    openBtn.setAttribute("aria-expanded", "false");
  };

  openBtn.addEventListener("click", () => {
    refreshCustomizePanelDOM();
    const p = document.getElementById("ltm-customize-panel");
    if (!p) return;
    p.hidden = false;
    openBtn.setAttribute("aria-expanded", "true");
    bindCustomizePanelEvents(overlay, showToast, closePanel);
  });

  document.getElementById("ltm-customize-close")?.addEventListener("click", closePanel);
}

function initFieldRemoveHandlers(fieldsList, showToast) {
  if (!fieldsList) return;
  fieldsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".ltm-field-remove");
    if (!btn) return;
    const row = btn.closest(".ltm-field-row");
    const fid = row?.dataset?.fieldId || btn.dataset.removeFieldId;
    if (!fid || isCoreFieldId(fid)) return;
    hideJournalFieldKey(fid);
    row?.remove();
    showToast?.("Field removed from form.", false);
  });
  fieldsList.addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".ltm-field-row");
    if (!row) return;
    const fid = row.dataset.fieldId;
    if (!fid || isCoreFieldId(fid)) return;
    e.preventDefault();
    hideJournalFieldKey(fid);
    row.remove();
    showToast?.("Field removed from form.", false);
  });
  let pressTimer = null;
  fieldsList.addEventListener(
    "touchstart",
    (e) => {
      const row = e.target.closest(".ltm-field-row--removable");
      if (!row) return;
      const fid = row.dataset.fieldId;
      pressTimer = setTimeout(() => {
        hideJournalFieldKey(fid);
        row.remove();
        showToast?.("Field removed from form.", false);
      }, 550);
    },
    { passive: true }
  );
  fieldsList.addEventListener("touchend", () => clearTimeout(pressTimer));
  fieldsList.addEventListener("touchmove", () => clearTimeout(pressTimer));
}

function initFieldDrag(list, userId) {
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
    persistFieldOrderFromDom(list, userId);
  });
}

function initReorderToggle(fieldsList, userId) {
  const btn = document.getElementById("ltm-reorder-toggle");
  if (!btn || !fieldsList) return;
  btn.addEventListener("click", () => {
    const on = fieldsList.classList.toggle("ltm-fields-list--reorder");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "Done reordering" : "Reorder fields";
    if (!on) persistFieldOrderFromDom(fieldsList, userId);
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

function buildOverlayHtml(today, orderedFields, hasAccounts, isEdit) {
  const rowsHtml = orderedFields.map((f) => renderFieldRow(f, today)).join("\n");
  const accountHint = hasAccounts
    ? ""
    : `<p class="ltm-account-hint" id="ltm-account-hint">No trading accounts yet — <a href="/account.html">add one on Account</a>.</p>`;

  return `<div class="trade-form-panel ltm-panel" id="ltm-panel">
  <span class="ltm-corner ltm-corner--tl" aria-hidden="true"></span>
  <span class="ltm-corner ltm-corner--tr" aria-hidden="true"></span>
  <span class="ltm-corner ltm-corner--bl" aria-hidden="true"></span>
  <span class="ltm-corner ltm-corner--br" aria-hidden="true"></span>
  <div class="trade-form-header">
    <span class="trade-form-title" id="ltm-title">LOG TRADE</span>
    <button type="button" class="trade-form-close" id="ltm-close" aria-label="Close">&#x2715;</button>
  </div>
  <div class="trade-form-body ltm-panel-body">
    <form id="ltm-form" autocomplete="off" novalidate>
      <button type="button" class="ltm-reorder-toggle" id="ltm-reorder-toggle" aria-pressed="false">Reorder fields</button>
      <div class="ltm-panel-scroll">
      <div class="ltm-fields-list" id="ltm-fields-list">${rowsHtml}</div>
      ${accountHint}
      <div class="ltm-section-label ltm-section-label--with-count">
        <span>Chart photos</span>
        <span class="ltm-photo-count" id="ltm-photo-count" hidden aria-live="polite"></span>
      </div>
      <div class="ltm-photo-section" id="ltm-photo-section"></div>
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
      <button type="button" class="ltm-customize-btn" id="ltm-customize-btn" aria-expanded="false">&#9998; Customize form</button>
      ${buildCustomizePanelHtml()}
      </div>
      <div class="ltm-actions-sticky trade-form-actions trade-form-actions--split">
        <button type="button" class="trade-delete-btn" id="ltm-delete" hidden>Delete</button>
        ${
          isEdit
            ? ""
            : `<button type="button" class="trade-submit-btn trade-submit-btn--secondary" id="ltm-submit-another">SAVE &amp; LOG ANOTHER</button>`
        }
        <button type="button" class="trade-submit-btn trade-submit-btn--finish" id="ltm-finish-later">SAVE &amp; FINISH LATER</button>
        <button type="submit" class="trade-submit-btn trade-submit-btn--primary" id="ltm-submit">SAVE TRADE</button>
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
  let savedSuccessfully = false;

  const userId = await resolveModalUserId(getUserId);
  ltmCurrentUserId = userId;

  const [prefillRows, journalRows, accounts, journalFieldsRes, photoSlotsLoaded] = await Promise.all([
    typeof fetchTradeRowsForPrefill === "function"
      ? fetchTradeRowsForPrefill().catch(() => [])
      : Promise.resolve([]),
    fetchJournalTradesForPrefill(userId),
    fetchAccounts(userId),
    apiFetch("/api/journal-fields")
      .then((r) => r.json().catch(() => ({})))
      .catch(() => ({})),
    loadPhotoSlotsForUser(userId),
  ]);

  ltmPhotoSlotDefs = photoSlotsLoaded;
  ltmPersistPhotoSlots = async () => {
    ltmPhotoSlotDefs = await persistPhotoSlotsForUser(userId, ltmPhotoSlotDefs);
    syncSlotPhotoMap();
  };
  resetPhotoState();

  const prefill = Array.isArray(prefillRows) ? prefillRows : [];
  const journal = Array.isArray(journalRows) ? journalRows : [];
  const allPrefillRows = [...journal, ...prefill];

  const accountNames = accounts
    .map((a) => String(a.name || "").trim())
    .filter(Boolean);
  const hasAccounts = accountNames.length > 0;

  const pairOptions = mergePairOptions(prefill, journal);
  const coreDefs = buildCoreFieldDefs({ pairOptions, accountNames, hasAccounts });

  const hiddenKeys = loadHiddenFieldKeySet();
  const allFields = Array.isArray(journalFieldsRes.fields) ? journalFieldsRes.fields : [];
  const notionFields = filterAndDedupeJournalFieldRows(allFields)
    .filter((f) => !hiddenKeys.has(normalizeFieldKey(f.field_name)))
    .map(notionFieldToDef);

  const today = new Date().toISOString().slice(0, 10);
  const orderedDefs = buildLogTradeFieldList(coreDefs, allFields, hiddenKeys, userId);

  const defaults = !editId ? deriveDefaultsFromRows(allPrefillRows, accounts) : null;

  const overlay = document.createElement("div");
  overlay.className = "trade-form-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  const lastRR = deriveLastRRFromRows(allPrefillRows);

  overlay.innerHTML = buildOverlayHtml(today, orderedDefs, hasAccounts, Boolean(editId));
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add("trade-form-overlay--visible");
    document.getElementById("ltm-panel")?.classList.add("trade-form-panel--visible");
  });

  const form = document.getElementById("ltm-form");
  initPairOtherToggle(form);

  refreshPhotoSectionDOM();
  mountPhotoSectionHandlers(overlay, showToast);
  initCustomizePanel(overlay, showToast);

  const pasteHandler = buildDocumentPasteHandler(overlay);
  let fieldsList = null;

  async function closeModal() {
    const orderUserId = (await resolveModalUserId(getUserId)) || userId || ltmCurrentUserId;
    if (orderUserId) ltmCurrentUserId = orderUserId;
    if (fieldsList && orderUserId) persistFieldOrderFromDom(fieldsList, orderUserId);
    overlay.classList.remove("trade-form-overlay--visible");
    document.getElementById("ltm-panel")?.classList.remove("trade-form-panel--visible");
    overlay.addEventListener(
      "transitionend",
      () => {
        overlay.remove();
        ltmOpen = false;
        resetPhotoState();
      },
      { once: true }
    );
    document.removeEventListener("paste", pasteHandler);
    document.removeEventListener("keydown", escHandler);
    document.removeEventListener("mouseup", mouseupHandler);
  }

  const escHandler = (e) => {
    if (e.key === "Escape") void closeModal();
  };
  document.addEventListener("keydown", escHandler);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) void closeModal();
  });
  document.getElementById("ltm-close").addEventListener("click", () => {
    void closeModal();
  });

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

    let tradeSummary = "";
    for (const k of Object.keys(cd)) {
      if (k === "photos" || k === "direction") continue;
      const nk = normalizeFieldKey(k);
      if (nk === "trade summary" || nk === "notes") {
        if (!tradeSummary && cd[k] != null && String(cd[k]).trim()) {
          tradeSummary = String(cd[k]).trim();
        }
        continue;
      }
      setFormValue(form, k, cd[k], pairOptions);
    }
    setFormValue(form, TRADE_SUMMARY_FIELD_ID, tradeSummary, pairOptions);

    initPairOtherToggle(form);

    if (Array.isArray(cd.photos)) {
      hydratePhotosFromCustomData(cd.photos);
      renderAllSlotPreviews();
    }

    if (delBtn) {
      delBtn.addEventListener("click", async () => {
        if (!confirm("Delete this trade from your journal? This cannot be undone.")) return;
        delBtn.disabled = true;
        try {
          const q = new URLSearchParams({ id: editId });
          const res = await apiFetch(`/api/journal-trades?${q.toString()}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(readApiErrorMessage(d) || `Delete failed (${res.status})`);
          }
          void closeModal();
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
    syncOutcomeChipsFromSelect(form);
  }

  const rrInp = document.getElementById("ltm-f-rr");
  if (rrInp && lastRR) rrInp.placeholder = lastRR;

  fieldsList = document.getElementById("ltm-fields-list");
  initFieldDrag(fieldsList, userId);
  initReorderToggle(fieldsList, userId);
  const mouseupHandler = () => {};
  document.addEventListener("mouseup", mouseupHandler, { passive: true });

  initFieldRemoveHandlers(fieldsList, showToast);

  document.addEventListener("paste", pasteHandler);

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
    if (shouldSkipJournalFieldName(label)) {
      showToast("That field is already on the form or reserved.", true);
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

  const outcomeEl = form.elements.namedItem("outcome");
  const rrRow = fieldsList.querySelector("[data-field-id='rr']");
  function syncRR() {
    if (rrRow) rrRow.style.display = outcomeEl?.value === "BE" ? "none" : "";
  }
  initOutcomeChips(form, syncRR);
  syncRR();
  initMultiselectFields(fieldsList);

  if (editId && editTrade) {
    const cdMs =
      editTrade.custom_data && typeof editTrade.custom_data === "object"
        ? editTrade.custom_data
        : {};
    fieldsList.querySelectorAll(".ltm-multiselect-wrap[data-ms-inited]").forEach((wrap) => {
      const k = wrap.dataset.msName;
      if (!k || !(k in cdMs)) return;
      const v = cdMs[k];
      if (!v) return;
      const vals = Array.isArray(v) ? v : [String(v)];
      vals.forEach((val) => { if (val && wrap._addChip) wrap._addChip(String(val)); });
    });
  }

  const submitBtn = document.getElementById("ltm-submit");
  const submitAnotherBtn = document.getElementById("ltm-submit-another");
  const finishLaterBtn = document.getElementById("ltm-finish-later");

  function setSavingState(saving) {
    if (submitBtn) {
      submitBtn.disabled = saving;
      if (!saving) submitBtn.textContent = editId ? "SAVE CHANGES" : "SAVE TRADE";
    }
    if (submitAnotherBtn) submitAnotherBtn.disabled = saving;
    if (finishLaterBtn) finishLaterBtn.disabled = saving;
  }

  function resetFormForAnother() {
    clearFormValidation(form);
    if (outcomeEl && "value" in outcomeEl) outcomeEl.value = "";
    syncOutcomeChipsFromSelect(form);
    const rrEl = form.elements.namedItem("rr");
    if (rrEl && "value" in rrEl) rrEl.value = "";
    resetPhotoState();
    renderAllSlotPreviews();
    syncRR();
    setSavingState(false);
    form.querySelector(".ltm-outcome-chip")?.focus?.();
  }

  async function saveTrade({ closeAfter = true, partial = false } = {}) {
    if (!partial) {
      const validation = validateLogTradeForm(form, fieldsList);
      if (!validation.ok) {
        showToast(validation.message, true);
        return;
      }
    } else {
      clearFormValidation(form);
      const dateEl = form.elements.namedItem("date");
      const dateVal = dateEl && "value" in dateEl ? String(dateEl.value || "").trim() : "";
      if (!dateVal) {
        showToast("Date is required.", true);
        dateEl?.focus?.();
        return;
      }
    }

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

    const custom_data = {};
    if (direction) custom_data.direction = direction;

    const summaryVal = (fd.get(TRADE_SUMMARY_FIELD_ID) || "").trim();
    if (summaryVal) custom_data[TRADE_SUMMARY_STORAGE_KEY] = summaryVal;

    for (const f of [...notionFields, ...userAddedFields]) {
      if (shouldSkipJournalFieldName(f.id)) continue;
      if (f.type === "multiselect") {
        const vals = fd.getAll(f.id).map((v) => v.trim()).filter(Boolean);
        if (vals.length) custom_data[f.id] = vals;
      } else {
        const v = (fd.get(f.id) || "").trim();
        if (v) custom_data[f.id] = v;
      }
    }
    const photoPayload = photosToPayload();
    if (photoPayload.length) custom_data.photos = photoPayload;

    setSavingState(true);
    if (submitBtn) submitBtn.textContent = "Saving…";

    try {
      const basePayload = {
        traded_at: `${dateVal}T00:00:00.000Z`,
        pair: pair || null,
        outcome: outcome || null,
        rr: rr !== null && !Number.isNaN(rr) ? rr : null,
        session: session || null,
        account: account || null,
        custom_data,
      };
      const res = await apiFetch(editId ? "/api/journal-trades" : "/api/log-trade", {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editId ? { id: editId, ...basePayload } : basePayload),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(readApiErrorMessage(d) || `Save failed (${res.status})`);
      }

      // Parse response to get the instant read (only present on new trades, not edits).
      const resData = !editId ? await res.json().catch(() => ({})) : {};
      const instantRead = resData?.read ?? null;

      const savedMeta = {
        outcome,
        pair,
        session,
        rr,
        account,
        direction,
        custom_data,
        dateVal,
        userId,
      };

      if (closeAfter || partial) {
        savedSuccessfully = true;
        void closeModal();
        showInstantReadCard(instantRead);
        if (partial) {
          showToast("Saved as incomplete — edit anytime from the journal");
        } else {
          showToast(editId ? "Trade updated." : "Trade logged.");
        }
        if (onTradeSaved) await onTradeSaved(savedMeta);
        return;
      }

      showToast("Trade logged — add another below.");
      showInstantReadCard(instantRead);
      resetFormForAnother();
      if (onTradeSaved) await onTradeSaved(savedMeta);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed.";
      showToast(msg, true);
      setSavingState(false);
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void saveTrade({ closeAfter: true, partial: false });
  });

  if (submitAnotherBtn) {
    submitAnotherBtn.addEventListener("click", () => {
      void saveTrade({ closeAfter: false, partial: false });
    });
  }

  if (finishLaterBtn) {
    finishLaterBtn.addEventListener("click", () => {
      void saveTrade({ closeAfter: true, partial: true });
    });
  }

  form.addEventListener("input", (e) => {
    const row = e.target.closest?.(".ltm-field-row--error");
    if (row) row.classList.remove("ltm-field-row--error");
  });

  if (!editId) {
    const firstChip = form.querySelector(".ltm-outcome-chip");
    firstChip?.focus?.();
  } else {
    document.getElementById("ltm-f-date")?.focus();
  }
}

// ─── Instant read card ────────────────────────────────────────────────────────

let _irStyleInjected = false;
function _injectIrStyles() {
  if (_irStyleInjected) return;
  _irStyleInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    .jarvis-read-card {
      position: fixed;
      bottom: 1.75rem;
      left: 50%;
      transform: translateX(-50%) translateY(0);
      max-width: 480px;
      width: calc(100% - 2rem);
      background: rgba(5, 10, 20, 0.97);
      border-radius: 14px;
      padding: 1rem 1rem 1rem 1.125rem;
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      z-index: 10200;
      animation: jrCardIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
      font-family: "Outfit", sans-serif;
      box-sizing: border-box;
    }
    .jarvis-read-card--green {
      border: 1px solid rgba(0, 212, 255, 0.4);
      box-shadow: 0 0 28px rgba(0, 212, 255, 0.10), 0 6px 40px rgba(0,0,0,0.7);
    }
    .jarvis-read-card--red {
      border: 1px solid rgba(255, 155, 40, 0.45);
      box-shadow: 0 0 28px rgba(255, 155, 40, 0.10), 0 6px 40px rgba(0,0,0,0.7);
    }
    @keyframes jrCardIn {
      from { opacity: 0; transform: translateX(-50%) translateY(18px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes jrCardOut {
      to { opacity: 0; transform: translateX(-50%) translateY(14px); }
    }
    .jarvis-read-card--out { animation: jrCardOut 0.25s ease forwards; }
    .jarvis-read-card__hdr {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      margin-bottom: 0.6rem;
    }
    .jarvis-read-card__dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .jarvis-read-card--green .jarvis-read-card__dot { background: #00d4ff; }
    .jarvis-read-card--red   .jarvis-read-card__dot { background: #ff9a28; }
    .jarvis-read-card__eyebrow {
      font-family: "Share Tech Mono", "Courier New", monospace;
      font-size: 0.6rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #556677;
      flex: 1;
    }
    .jarvis-read-card__close {
      background: none; border: none;
      color: #445566; font-size: 1rem;
      cursor: pointer; padding: 0 2px;
      line-height: 1; flex-shrink: 0;
    }
    .jarvis-read-card__close:hover { color: #aabbcc; }
    .jarvis-read-card__body {
      display: flex;
      align-items: flex-start;
      gap: 0.875rem;
    }
    .jarvis-read-card__grade {
      font-family: "Share Tech Mono", "Courier New", monospace;
      font-size: 1.6rem;
      font-weight: 700;
      line-height: 1;
      min-width: 2.75rem;
      text-align: center;
      flex-shrink: 0;
      padding-top: 0.05em;
      letter-spacing: -0.02em;
    }
    .jarvis-read-card--green .jarvis-read-card__grade { color: #00d4ff; }
    .jarvis-read-card--red   .jarvis-read-card__grade { color: #ff9a28; }
    .jarvis-read-card__msg {
      margin: 0;
      font-size: 0.875rem;
      line-height: 1.55;
      color: #d8e8f4;
      font-weight: 400;
    }
  `;
  document.head.appendChild(s);
}

export function showInstantReadCard(read) {
  if (!read?.found) return;
  _injectIrStyles();
  document.getElementById("jarvis-read-card")?.remove();

  const green = read.type === "green";
  const card = document.createElement("div");
  card.id = "jarvis-read-card";
  card.className = `jarvis-read-card jarvis-read-card--${green ? "green" : "red"}`;
  const gradeHtml = read.grade
    ? `<span class="jarvis-read-card__grade" aria-label="Grade ${escHtml(read.grade)}">${escHtml(read.grade)}</span>`
    : "";
  card.innerHTML = `
    <div class="jarvis-read-card__hdr">
      <span class="jarvis-read-card__dot" aria-hidden="true"></span>
      <span class="jarvis-read-card__eyebrow">Jarvis read</span>
      <button class="jarvis-read-card__close" aria-label="Dismiss">&#x2715;</button>
    </div>
    <div class="jarvis-read-card__body">
      ${gradeHtml}
      <p class="jarvis-read-card__msg">${escHtml(read.message)}</p>
    </div>`;
  document.body.appendChild(card);

  const dismiss = () => {
    card.classList.add("jarvis-read-card--out");
    card.addEventListener("animationend", () => card.remove(), { once: true });
  };
  card.querySelector(".jarvis-read-card__close").addEventListener("click", dismiss);
  setTimeout(dismiss, 10000);
}

