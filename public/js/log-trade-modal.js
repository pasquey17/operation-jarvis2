/**
 * Shared LOG TRADE modal — used by index (app.js) and journal.html.
 * Single prefill, sticky defaults, coach prompts, and /api/log-trade payload.
 */

const CORE_FIELD_NAMES = new Set(["date", "session", "outcome", "rr", "pair", "account"]);
export const LOG_DEFAULTS_STORAGE_KEY = "jarvis_log_defaults_v1";
const LOG_FALLBACK_SAMPLE = 50;

let logTradeModalOpen = false;

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

function getField(obj) {
  for (let i = 1; i < arguments.length; i++) {
    const v = obj[arguments[i]];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

function parseNotionExtrasRow(trade) {
  if (!trade) return null;
  const raw = trade.notion_extras;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string" && raw.trim().charAt(0) === "{") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function classifyAuxFieldRole(fieldName) {
  const n = String(fieldName || "").toLowerCase();
  if (n.indexOf("psych") !== -1) return "psychology";
  if (n.indexOf("summary") !== -1) return "summary";
  if ((n.indexOf("entry") !== -1 && n.indexOf("model") !== -1) || n === "model") return "model";
  return "";
}

function loadLogDefaultsFromStorage() {
  try {
    const raw = localStorage.getItem(LOG_DEFAULTS_STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
}

function customFieldValueFromFormData(fd, f) {
  if (f.field_type === "multiselect") {
    return fd
      .getAll(f.field_name)
      .map((x) => String(x).trim())
      .filter(Boolean)
      .join(", ");
  }
  const v = fd.get(f.field_name);
  return v != null ? String(v).trim() : "";
}

function persistLogDefaultsFromStorage(fd, customFields) {
  try {
    const payload = {
      pair: (fd.get("pair") || "").trim(),
      session: fd.get("session") || "",
      account: (fd.get("account") || "").trim(),
      entry_model: "",
      custom: {},
    };
    for (const f of customFields) {
      const nm = f.field_name;
      const v = customFieldValueFromFormData(fd, f);
      if (v === "") continue;
      const role = classifyAuxFieldRole(nm);
      if (role === "model") payload.entry_model = v;
      payload.custom[nm] = v;
    }
    localStorage.setItem(LOG_DEFAULTS_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

function mostCommonAmong(trades, getter) {
  const counts = {};
  for (const t of trades) {
    const v = getter(t);
    if (!v || !String(v).trim()) continue;
    const k = String(v).trim();
    counts[k] = (counts[k] || 0) + 1;
  }
  let best = "";
  let bestN = 0;
  for (const k of Object.keys(counts)) {
    if (counts[k] > bestN) {
      bestN = counts[k];
      best = k;
    }
  }
  return best;
}

function normalizeSessionForSelect(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  const opts = ["Asia", "London", "New York", "London/New York"];
  const lower = s.toLowerCase();
  for (let i = 0; i < opts.length; i++) {
    if (opts[i].toLowerCase() === lower) return opts[i];
  }
  if (lower.indexOf("london") !== -1 && lower.indexOf("new york") !== -1) return "London/New York";
  if (lower.indexOf("asia") !== -1) return "Asia";
  if (lower.indexOf("london") !== -1) return "London";
  if (lower.indexOf("new york") !== -1 || /\bny\b/.test(lower)) return "New York";
  return "";
}

/**
 * Prefill: last trade via getField → sticky localStorage → modal over recent N trades.
 * New trade: do NOT copy prior outcome or RR.
 */
function applyLogTradePrefills(allTrades, customFields) {
  const sticky = loadLogDefaultsFromStorage();
  const slice =
    allTrades && allTrades.length
      ? allTrades.slice(0, Math.min(LOG_FALLBACK_SAMPLE, allTrades.length))
      : [];
  const last = slice.length ? slice[0] : null;

  function fillPair() {
    const el = document.getElementById("tf-pair");
    if (!el) return;
    const v =
      (last && String(getField(last, "pair", "Pair", "PAIR", "instrument", "symbol")).trim()) ||
      (sticky && sticky.pair) ||
      mostCommonAmong(slice, (t) => getField(t, "pair", "Pair", "PAIR", "instrument", "symbol"));
    if (v) el.value = v;
  }

  function fillSession() {
    const el = document.getElementById("tf-session");
    if (!el) return;
    const raw =
      (last && String(getField(last, "session", "Session", "SESSION")).trim()) ||
      (sticky && sticky.session) ||
      mostCommonAmong(slice, (t) => getField(t, "session", "Session", "SESSION"));
    const norm = normalizeSessionForSelect(raw);
    if (norm) el.value = norm;
  }

  function fillAccount() {
    const el = document.getElementById("tf-account");
    if (!el) return;
    const v =
      (last && String(getField(last, "account", "Account", "ACCOUNT")).trim()) ||
      (sticky && sticky.account) ||
      mostCommonAmong(slice, (t) => getField(t, "account", "Account", "ACCOUNT"));
    if (v) el.value = v;
  }

  fillPair();
  fillSession();
  fillAccount();

  const oe = document.getElementById("tf-outcome");
  if (oe) oe.value = "";
  const re = document.getElementById("tf-rr");
  if (re) re.value = "";

  const extras = last ? parseNotionExtrasRow(last) : null;
  const formEl = document.getElementById("trade-log-form");
  for (const f of customFields) {
    const name = f.field_name;
    if (!name || !formEl?.elements) continue;
    const fdDef = customFields.find((x) => x.field_name === name);
    const el = formEl.elements.namedItem(name);
    let valStr = "";
    if (extras) {
      const nk = Object.keys(extras).find((k) => k.toLowerCase() === name.toLowerCase());
      if (nk && extras[nk] != null) {
        valStr = Array.isArray(extras[nk]) ? extras[nk].map(String).join(", ") : String(extras[nk]);
      }
    }
    if (!String(valStr).trim()) {
      if (sticky?.custom?.[name]) valStr = sticky.custom[name];
      else if (classifyAuxFieldRole(name) === "model" && sticky?.entry_model) {
        valStr = sticky.entry_model;
      } else if (last && classifyAuxFieldRole(name) === "model") {
        const mv = getField(last, "model", "Model", "MODEL", "ENTRY MODEL");
        if (mv) valStr = mv;
      }
    }
    if (!String(valStr).trim()) continue;

    if (fdDef?.field_type === "multiselect") {
      const parts = String(valStr)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      const group = formEl.elements[name];
      const boxes = group?.length != null ? Array.from(group) : group ? [group] : [];
      boxes.forEach((node) => {
        if (node && node.type === "checkbox") {
          node.checked = parts.indexOf(node.value) !== -1;
        }
      });
      continue;
    }

    if (!el || !("value" in el)) continue;
    if (el.tagName === "SELECT" && el.multiple) {
      const parts = String(valStr)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      for (let oi = 0; oi < el.options.length; oi++) {
        el.options[oi].selected = parts.indexOf(el.options[oi].value) !== -1;
      }
    } else {
      el.value = valStr;
    }
  }
}

function renderCustomField(f) {
  const id = `tf-${f.field_name.toLowerCase().replace(/\s+/g, "-")}`;
  const label = escHtml(f.field_name);
  const req = f.is_required ? "required" : "";
  const name = escHtml(f.field_name);
  const role = classifyAuxFieldRole(f.field_name);
  const guidedSummary =
    role === "summary"
      ? `<div class="tf-guided-only" aria-hidden="true">
      <p class="tf-guided-line">What was the actual trigger vs what you hoped would happen?</p>
      <p class="tf-guided-line">What would invalidate first — one sentence.</p>
    </div>`
      : "";
  let psychChips = "";
  if (role === "psychology") {
    psychChips = `<div class="tf-psych-chips tf-guided-only" aria-hidden="true">${["Frustrated", "Focused", "Chasing", "Patient", "Doubt"]
      .map(
        (lab) =>
          `<button type="button" class="tf-psych-chip" data-tf-chip="${escHtml(lab)}">${escHtml(lab)}</button>`
      )
      .join("")}</div>`;
  }

  if (f.field_type === "dropdown") {
    let opts = [];
    try {
      opts = JSON.parse(f.field_options || "[]");
    } catch {}
    const optsHtml = opts.map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join("");
    return `<div class="trade-field trade-field--full"><label class="trade-label" for="${id}">${label}</label><select id="${id}" name="${name}" class="trade-input trade-select" data-custom="1" ${req}><option value="">— select —</option>${optsHtml}</select></div>`;
  }
  if (f.field_type === "multiselect") {
    let opts = [];
    try {
      opts = JSON.parse(f.field_options || "[]");
    } catch {}
    const hint = '<p class="trade-multiselect-hint">Select any that apply</p>';
    const optsHtml = opts
      .map(
        (o) =>
          `<label class="trade-multi-option"><input type="checkbox" name="${escAttr(
            f.field_name
          )}" value="${escAttr(o)}" class="trade-multi-option__input" /><span class="trade-multi-option__text">${escHtml(
            o
          )}</span></label>`
      )
      .join("");
    return `<div class="trade-field trade-field--full" data-multiselect-field="1"><label class="trade-label" id="${id}-legend">${label}</label>${hint}<div class="trade-multiselect-panel trade-input" role="group" aria-labelledby="${id}-legend">${optsHtml}</div></div>`;
  }
  if (f.field_type === "number") {
    return `<div class="trade-field"><label class="trade-label" for="${id}">${label}</label><input id="${id}" type="number" name="${name}" class="trade-input" data-custom="1" step="0.01" ${req}></div>`;
  }
  return `<div class="trade-field trade-field--full">
  <label class="trade-label" for="${id}">${label}</label>
  ${guidedSummary}
  ${psychChips}
  <textarea id="${id}" name="${name}" class="trade-input" data-custom="1" rows="3" ${req}></textarea>
</div>`;
}

function buildOverlayHtml(today, customHtml) {
  return `
    <div class="trade-form-panel" id="trade-form-panel">
      <div class="trade-form-header">
        <span class="trade-form-title">LOG TRADE</span>
        <button type="button" class="trade-form-close" aria-label="Close">&#x2715;</button>
      </div>
      <div class="trade-form-body">
        <form id="trade-log-form" autocomplete="off" novalidate>
          <div class="trade-form-grid">
            <div class="trade-field trade-field--full tf-guided-bar">
              <label class="tf-guided-toggle"><input type="checkbox" id="tf-guided-toggle" autocomplete="off" />
              <span>Coach prompts</span></label>
              <p class="tf-guided-microcopy tf-guided-only">This trains Jarvis for your next session — not grading you.</p>
            </div>
            <div class="trade-field">
              <label class="trade-label" for="tf-date">Date</label>
              <input id="tf-date" type="date" name="date" class="trade-input" value="${escHtml(today)}" required>
            </div>
            <div class="trade-field">
              <label class="trade-label" for="tf-pair">Pair</label>
              <input id="tf-pair" type="text" name="pair" class="trade-input" placeholder="e.g. XAUUSD">
            </div>
            <div class="trade-field">
              <label class="trade-label" for="tf-session">Session</label>
              <select id="tf-session" name="session" class="trade-input trade-select" required>
                <option value="">— select —</option>
                <option value="Asia">Asia</option>
                <option value="London">London</option>
                <option value="New York">New York</option>
                <option value="London/New York">London/New York</option>
              </select>
            </div>
            <div class="trade-field">
              <label class="trade-label" for="tf-outcome">Outcome</label>
              <select id="tf-outcome" name="outcome" class="trade-input trade-select" required>
                <option value="">— select —</option>
                <option value="Win">Win</option>
                <option value="Loss">Loss</option>
                <option value="BE">BE</option>
              </select>
            </div>
            <div class="trade-field" id="tf-rr-field">
              <label class="trade-label" for="tf-rr">RR</label>
              <input id="tf-rr" type="number" name="rr" class="trade-input" step="0.01" min="0" placeholder="e.g. 2.5">
            </div>
            <div class="trade-field">
              <label class="trade-label" for="tf-account">Account</label>
              <input id="tf-account" type="text" name="account" class="trade-input" placeholder="e.g. Main">
            </div>
            <div class="trade-field trade-field--full trade-form-core-end" aria-hidden="true"></div>
            ${customHtml}
          </div>
          <div class="trade-form-actions">
            <button type="submit" class="trade-submit-btn">SAVE TRADE</button>
          </div>
        </form>
      </div>
    </div>`;
}

/**
 * @param {object} options
 * @param {() => string} options.getUserId
 * @param {() => Promise<Array>} options.fetchTradeRowsForPrefill — newest first, same shape as /api/trades records
 * @param {(data: object) => string} options.readApiErrorMessage
 * @param {(msg: string, isError?: boolean) => void} options.showToast
 * @param {(ctx: object) => void | Promise<void>} [options.onTradeSaved] — after successful save + toast
 */
export async function openLogTradeModal(options) {
  const {
    getUserId,
    fetchTradeRowsForPrefill,
    readApiErrorMessage,
    showToast,
    onTradeSaved,
  } = options;

  if (logTradeModalOpen) return;
  logTradeModalOpen = true;

  let tradeRows = [];
  try {
    tradeRows = (await fetchTradeRowsForPrefill()) || [];
  } catch (e) {
    console.warn("[log-trade-modal] prefill fetch", e);
    tradeRows = [];
  }

  const userId = getUserId();
  let customFields = [];
  try {
    const r = await fetch(`/api/journal-fields?user_id=${encodeURIComponent(userId)}`, { cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    const all = Array.isArray(data.fields) ? data.fields : [];
    customFields = all.filter((f) => !CORE_FIELD_NAMES.has(f.field_name.toLowerCase()));
  } catch {}

  const today = new Date().toISOString().slice(0, 10);
  const customHtml = customFields.map(renderCustomField).join("");

  const overlay = document.createElement("div");
  overlay.className = "trade-form-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = buildOverlayHtml(today, customHtml);
  document.body.appendChild(overlay);

  try {
    applyLogTradePrefills(tradeRows, customFields);
  } catch (eDef) {
    console.warn("[log-trade-modal] defaults", eDef);
  }

  const panelEl = document.getElementById("trade-form-panel");
  const guidedCb = document.getElementById("tf-guided-toggle");
  function syncGuidedCoachUi() {
    const on = guidedCb?.checked;
    if (panelEl) panelEl.classList.toggle("trade-form-panel--guided", !!on);
    overlay.querySelectorAll(".tf-guided-only").forEach((node) => {
      node.setAttribute("aria-hidden", on ? "false" : "true");
    });
  }
  guidedCb?.addEventListener("change", syncGuidedCoachUi);
  syncGuidedCoachUi();

  overlay.addEventListener("click", (e) => {
    const chip = e.target.closest(".tf-psych-chip");
    if (!chip) return;
    const lab = chip.getAttribute("data-tf-chip");
    if (!lab) return;
    const row = chip.closest(".trade-field");
    if (!row) return;
    const ta = row.querySelector("textarea.trade-input[data-custom=\"1\"]");
    if (!ta) return;
    const cur = (ta.value || "").trim();
    ta.value = cur ? `${cur}, ${lab}` : lab;
  });

  requestAnimationFrame(() => {
    overlay.classList.add("trade-form-overlay--visible");
    document.getElementById("trade-form-panel")?.classList.add("trade-form-panel--visible");
  });

  function closeForm() {
    overlay.classList.remove("trade-form-overlay--visible");
    document.getElementById("trade-form-panel")?.classList.remove("trade-form-panel--visible");
    overlay.addEventListener(
      "transitionend",
      () => {
        overlay.remove();
        logTradeModalOpen = false;
      },
      { once: true }
    );
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeForm();
  });
  overlay.querySelector(".trade-form-close").addEventListener("click", closeForm);

  const outcomeSelect = document.getElementById("tf-outcome");
  const rrField = document.getElementById("tf-rr-field");
  if (outcomeSelect && rrField) {
    rrField.style.display = outcomeSelect.value === "BE" ? "none" : "";
  }
  outcomeSelect?.addEventListener("change", () => {
    if (rrField) rrField.style.display = outcomeSelect.value === "BE" ? "none" : "";
  });

  const form = document.getElementById("trade-log-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const uid =
      getUserId();
    const dateVal = fd.get("date") || "";
    const pair = (fd.get("pair") || "").trim();
    const session = fd.get("session") || "";
    const outcome = fd.get("outcome") || "";
    const rrRaw = fd.get("rr");
    const rr = rrRaw !== "" && rrRaw !== null ? Number(rrRaw) : null;
    const account = (fd.get("account") || "").trim();

    if (!dateVal || !session || !outcome) {
      showToast("Date, Session and Outcome are required.", true);
      return;
    }

    for (const f of customFields) {
      if (f.field_type !== "multiselect" || !f.is_required) continue;
      const picks = fd.getAll(f.field_name).filter((x) => x != null && String(x).trim());
      if (picks.length === 0) {
        showToast(`Please select at least one option for ${f.field_name}.`, true);
        return;
      }
    }

    const custom_data = {};
    for (const f of customFields) {
      const val = customFieldValueFromFormData(fd, f);
      if (val !== "") custom_data[f.field_name] = val;
    }

    const submitBtn = form.querySelector(".trade-submit-btn");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving…";
    }

    try {
      const res = await fetch("/api/log-trade", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: uid,
          traded_at: `${dateVal}T00:00:00.000Z`,
          pair: pair || null,
          outcome,
          rr: rr !== null && !Number.isNaN(rr) ? rr : null,
          session,
          account: account || null,
          custom_data,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(readApiErrorMessage(d) || `Save failed (${res.status})`);
      }

      persistLogDefaultsFromStorage(fd, customFields);
      closeForm();
      showToast("Trade logged.");

      if (onTradeSaved) {
        await onTradeSaved({
          outcome,
          pair,
          session,
          rr,
          account,
          custom_data,
          dateVal,
          userId: uid,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed.";
      showToast(msg, true);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "SAVE TRADE";
      }
    }
  });

  document.getElementById("tf-date")?.focus();
}
