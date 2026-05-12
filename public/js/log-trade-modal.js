/**
 * LOG TRADE modal — premium rebuild.
 * Opens blank every time. Drag-to-reorder fields. Photo paste/drop with preview.
 * Custom field adder. Saves to /api/log-trade with unchanged payload shape.
 */

export const LOG_DEFAULTS_STORAGE_KEY = "jarvis_log_defaults_v1"; // kept for compat
const FIELD_ORDER_KEY = "jarvis_field_order_v2";
const CORE_FIELD_NAMES = new Set(["date", "session", "outcome", "rr", "pair", "account"]);

let ltmOpen = false;
let ltmPhotos = [];

// ── Escape helpers ──────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// ── Field order persistence ─────────────────────────────────────────────
function loadFieldOrder(allIds) {
  try {
    const saved = JSON.parse(localStorage.getItem(FIELD_ORDER_KEY) || "null");
    if (!Array.isArray(saved) || !saved.length) return allIds;
    const savedSet = new Set(saved);
    const ordered = saved.filter(id => allIds.includes(id));
    const unseen  = allIds.filter(id => !savedSet.has(id));
    return [...ordered, ...unseen];
  } catch { return allIds; }
}

function saveFieldOrder(ids) {
  try { localStorage.setItem(FIELD_ORDER_KEY, JSON.stringify(ids)); } catch {}
}

// ── Core field definitions ──────────────────────────────────────────────
const CORE_FIELD_DEFS = [
  { id: "date",    label: "Date",    type: "date",   required: true },
  { id: "pair",    label: "Pair",    type: "text",   placeholder: "XAUUSD" },
  { id: "session", label: "Session", type: "select",
    options: ["Asia", "London", "New York", "London/New York"], required: true },
  { id: "outcome", label: "Outcome", type: "select",
    options: ["Win", "Loss", "BE"], required: true },
  { id: "rr",      label: "RR",      type: "number", placeholder: "2.5",
    step: "0.01", min: "0" },
  { id: "account", label: "Account", type: "text",   placeholder: "Main" },
];

// ── Convert journal_fields row → internal field def ─────────────────────
function notionFieldToDef(f) {
  const n = (f.field_name || "").toLowerCase();
  let type = "text";
  let options = [];
  if (f.field_type === "dropdown" || f.field_type === "multiselect") {
    type = "select";
    try { options = JSON.parse(f.field_options || "[]"); } catch {}
  } else if (f.field_type === "number") {
    type = "number";
  } else if (f.field_type === "yesno" || f.field_type === "boolean") {
    type = "yesno";
  } else if (
    n.includes("note") || n.includes("summary") ||
    n.includes("comment") || n.includes("journal")
  ) {
    type = "textarea";
  }
  return { id: f.field_name, label: f.field_name, type, options };
}

// ── Stable field input ID from field id ────────────────────────────────
function fieldInputId(fieldId) {
  return `ltm-f-${fieldId.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-_]/g, "").toLowerCase()}`;
}

// ── Build input element HTML ────────────────────────────────────────────
function buildInputHtml(field, today) {
  const id   = fieldInputId(field.id);
  const name = field.id;
  const req  = field.required ? "required" : "";
  switch (field.type) {
    case "date":
      return `<input id="${id}" type="date" name="${escAttr(name)}" class="trade-input ltm-input" value="${escHtml(today)}" ${req}>`;
    case "number":
      return `<input id="${id}" type="number" name="${escAttr(name)}" class="trade-input ltm-input" step="${field.step || "1"}" min="${field.min || ""}" placeholder="${escAttr(field.placeholder || "")}">`;
    case "select": {
      const opts = (field.options || []).map(o =>
        `<option value="${escHtml(o)}">${escHtml(o)}</option>`
      ).join("");
      return `<select id="${id}" name="${escAttr(name)}" class="trade-input trade-select ltm-input" ${req}><option value="">— select —</option>${opts}</select>`;
    }
    case "yesno":
      return `<select id="${id}" name="${escAttr(name)}" class="trade-input trade-select ltm-input"><option value="">— select —</option><option value="Yes">Yes</option><option value="No">No</option></select>`;
    case "textarea":
      return `<textarea id="${id}" name="${escAttr(name)}" class="trade-input ltm-input ltm-textarea" rows="3"></textarea>`;
    default:
      return `<input id="${id}" type="text" name="${escAttr(name)}" class="trade-input ltm-input" placeholder="${escAttr(field.placeholder || "")}">`;
  }
}

// ── Render one draggable field row ──────────────────────────────────────
function renderFieldRow(field, today) {
  const inputId = fieldInputId(field.id);
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
  </div>
</div>`;
}

// ── Photo preview renderer ──────────────────────────────────────────────
function renderPhotoPreviews(container) {
  if (!ltmPhotos.length) { container.innerHTML = ""; return; }
  container.innerHTML = ltmPhotos.map((p, i) =>
    `<div class="ltm-thumb">
      <img class="ltm-thumb-img" src="${escHtml(p.dataUrl)}" alt="Photo ${i + 1}">
      <button type="button" class="ltm-thumb-remove" data-idx="${i}" aria-label="Remove photo">&times;</button>
    </div>`
  ).join("");
}

function addPhotoFile(file, previewContainer) {
  if (!file || !file.type.startsWith("image/")) return;
  if (ltmPhotos.length >= 6) return; // cap at 6
  const reader = new FileReader();
  reader.onload = ev => {
    ltmPhotos.push({ dataUrl: ev.target.result, label: "" });
    renderPhotoPreviews(previewContainer);
  };
  reader.readAsDataURL(file);
}

// ── Drag-and-drop reordering ────────────────────────────────────────────
function initFieldDrag(list) {
  let dragging   = null;
  let fromHandle = false;

  list.addEventListener("mousedown", e => {
    fromHandle = !!e.target.closest(".ltm-drag-handle");
  });
  document.addEventListener("mouseup", () => { fromHandle = false; }, { passive: true });

  list.addEventListener("dragstart", e => {
    const row = e.target.closest(".ltm-field-row");
    if (!row || !fromHandle) { e.preventDefault(); return; }
    dragging = row;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", row.dataset.fieldId || "");
    setTimeout(() => row.classList.add("ltm-dragging"), 0);
  });

  list.addEventListener("dragover", e => {
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
    dragging   = null;
    fromHandle = false;
    const ids = Array.from(list.querySelectorAll(".ltm-field-row"))
      .map(r => r.dataset.fieldId).filter(Boolean);
    saveFieldOrder(ids);
  });
}

// ── Full overlay HTML ───────────────────────────────────────────────────
function buildOverlayHtml(today, orderedFields) {
  const rowsHtml = orderedFields.map(f => renderFieldRow(f, today)).join("\n");
  return `<div class="trade-form-panel ltm-panel" id="ltm-panel">
  <div class="trade-form-header">
    <span class="trade-form-title">LOG TRADE</span>
    <button type="button" class="trade-form-close" id="ltm-close" aria-label="Close">&#x2715;</button>
  </div>
  <div class="trade-form-body">
    <form id="ltm-form" autocomplete="off" novalidate>

      <div class="ltm-fields-list" id="ltm-fields-list">${rowsHtml}</div>

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

      <div class="trade-form-actions">
        <button type="submit" class="trade-submit-btn" id="ltm-submit">SAVE TRADE</button>
      </div>

    </form>
  </div>
</div>`;
}

// ── Main export ─────────────────────────────────────────────────────────
export async function openLogTradeModal(options) {
  const { getUserId, fetchTradeRowsForPrefill, readApiErrorMessage, showToast, onTradeSaved } = options;

  if (ltmOpen) return;
  ltmOpen   = true;
  ltmPhotos = [];

  const userId = getUserId();
  let notionFields = [];
  try {
    const r    = await fetch(`/api/journal-fields?user_id=${encodeURIComponent(userId)}`, { cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    const all  = Array.isArray(data.fields) ? data.fields : [];
    notionFields = all
      .filter(f => !CORE_FIELD_NAMES.has((f.field_name || "").toLowerCase()))
      .map(notionFieldToDef);
  } catch {}

  const today      = new Date().toISOString().slice(0, 10);
  const allDefs    = [...CORE_FIELD_DEFS, ...notionFields];
  const allIds     = allDefs.map(f => f.id);
  const orderedIds = loadFieldOrder(allIds);
  const orderedDefs = orderedIds.map(id => allDefs.find(f => f.id === id)).filter(Boolean);

  const overlay = document.createElement("div");
  overlay.className = "trade-form-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = buildOverlayHtml(today, orderedDefs);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add("trade-form-overlay--visible");
    document.getElementById("ltm-panel")?.classList.add("trade-form-panel--visible");
  });

  // ── Close ────────────────────────────────────────────────────────────
  function closeModal() {
    overlay.classList.remove("trade-form-overlay--visible");
    document.getElementById("ltm-panel")?.classList.remove("trade-form-panel--visible");
    overlay.addEventListener("transitionend", () => {
      overlay.remove();
      ltmOpen   = false;
      ltmPhotos = [];
    }, { once: true });
    document.removeEventListener("paste",   pasteHandler);
    document.removeEventListener("keydown", escHandler);
    document.removeEventListener("mouseup", mouseupHandler);
  }

  const escHandler = e => { if (e.key === "Escape") closeModal(); };
  document.addEventListener("keydown", escHandler);

  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.getElementById("ltm-close").addEventListener("click", closeModal);

  // ── Field drag-and-drop ──────────────────────────────────────────────
  const fieldsList = document.getElementById("ltm-fields-list");
  initFieldDrag(fieldsList);
  const mouseupHandler = () => {};
  document.addEventListener("mouseup", mouseupHandler, { passive: true });

  // ── Photos ───────────────────────────────────────────────────────────
  const dropzone = document.getElementById("ltm-dropzone");
  const previews = document.getElementById("ltm-photo-previews");

  dropzone.addEventListener("dragover", e => {
    e.preventDefault(); dropzone.classList.add("ltm-dropzone--over");
  });
  dropzone.addEventListener("dragleave", e => {
    if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove("ltm-dropzone--over");
  });
  dropzone.addEventListener("drop", e => {
    e.preventDefault(); dropzone.classList.remove("ltm-dropzone--over");
    Array.from(e.dataTransfer.files).forEach(f => addPhotoFile(f, previews));
  });
  dropzone.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
    inp.onchange = () => Array.from(inp.files || []).forEach(f => addPhotoFile(f, previews));
    inp.click();
  });
  dropzone.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dropzone.click(); }
  });

  const pasteHandler = e => {
    if (!document.body.contains(overlay)) return;
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith("image/")) addPhotoFile(item.getAsFile(), previews);
    }
  };
  document.addEventListener("paste", pasteHandler);

  previews.addEventListener("click", e => {
    const btn = e.target.closest(".ltm-thumb-remove");
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if (!isNaN(idx)) { ltmPhotos.splice(idx, 1); renderPhotoPreviews(previews); }
  });

  // ── Custom field adder ───────────────────────────────────────────────
  const adderBtn     = document.getElementById("ltm-adder-btn");
  const adderForm    = document.getElementById("ltm-adder-form");
  const adderName    = document.getElementById("ltm-adder-name");
  const adderType    = document.getElementById("ltm-adder-type");
  const adderConfirm = document.getElementById("ltm-adder-confirm");
  const adderCancel  = document.getElementById("ltm-adder-cancel");
  const userAddedFields = [];

  adderBtn.addEventListener("click", () => {
    adderBtn.hidden = true; adderForm.hidden = false; adderName.focus();
  });
  adderCancel.addEventListener("click", () => {
    adderBtn.hidden = false; adderForm.hidden = true; adderName.value = "";
  });
  adderConfirm.addEventListener("click", () => {
    const label = adderName.value.trim();
    if (!label) { adderName.focus(); return; }
    const type  = adderType.value;
    const def   = { id: label, label, type, options: [] };
    userAddedFields.push(def);
    fieldsList.insertAdjacentHTML("beforeend", renderFieldRow(def, today));
    adderBtn.hidden = false; adderForm.hidden = true; adderName.value = "";
  });

  // ── RR visibility ────────────────────────────────────────────────────
  const outcomeEl = document.querySelector("#ltm-form [name='outcome']");
  const rrRow     = fieldsList.querySelector("[data-field-id='rr']");
  function syncRR() {
    if (rrRow) rrRow.style.display = (outcomeEl?.value === "BE") ? "none" : "";
  }
  outcomeEl?.addEventListener("change", syncRR);
  syncRR();

  // ── Submit ───────────────────────────────────────────────────────────
  const form = document.getElementById("ltm-form");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(form);

    const dateVal = (fd.get("date")    || "").trim();
    const pair    = (fd.get("pair")    || "").trim();
    const session = (fd.get("session") || "").trim();
    const outcome = (fd.get("outcome") || "").trim();
    const rrRaw   = fd.get("rr");
    const rr      = rrRaw !== "" && rrRaw !== null ? Number(rrRaw) : null;
    const account = (fd.get("account") || "").trim();

    if (!dateVal || !session || !outcome) {
      showToast("Date, Session and Outcome are required.", true);
      return;
    }

    const custom_data = {};
    for (const f of [...notionFields, ...userAddedFields]) {
      const v = (fd.get(f.id) || "").trim();
      if (v) custom_data[f.id] = v;
    }
    if (ltmPhotos.length) {
      custom_data.photos = ltmPhotos.map(p => ({ url: p.dataUrl, label: p.label }));
    }

    const submitBtn = document.getElementById("ltm-submit");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

    try {
      const res = await fetch("/api/log-trade", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id:    getUserId(),
          traded_at:  `${dateVal}T00:00:00.000Z`,
          pair:       pair    || null,
          outcome,
          rr:         rr !== null && !Number.isNaN(rr) ? rr : null,
          session,
          account:    account || null,
          custom_data,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(readApiErrorMessage(d) || `Save failed (${res.status})`);
      }

      closeModal();
      showToast("Trade logged.");
      if (onTradeSaved) {
        await onTradeSaved({ outcome, pair, session, rr, account, custom_data, dateVal, userId: getUserId() });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed.";
      showToast(msg, true);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "SAVE TRADE"; }
    }
  });

  document.getElementById("ltm-f-date")?.focus();
}
