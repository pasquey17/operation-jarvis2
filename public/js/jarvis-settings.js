/**
 * Settings gear + slide-in panel (email, timezone, logout) for classic Jarvis pages.
 */
import { getAuthEmail, signOut } from "./jarvis-auth.js";

const ONBOARDING_LS_KEY = "jarvis_onboarding";

function readOnboardingTimezone() {
  try {
    const raw = localStorage.getItem(ONBOARDING_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const tz =
      parsed && typeof parsed.timezone === "string" ? parsed.timezone.trim() : "";
    return tz || null;
  } catch {
    return null;
  }
}

function ensureSettingsDom() {
  if (document.getElementById("jv-settings-panel")) return;

  const overlay = document.createElement("div");
  overlay.id = "jv-settings-overlay";
  overlay.className = "jv-settings-overlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.tabIndex = -1;

  const panel = document.createElement("aside");
  panel.id = "jv-settings-panel";
  panel.className = "jv-settings-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "jv-settings-title");
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML =
    '<header class="jv-settings-panel__head">' +
    '<h2 class="jv-settings-panel__title" id="jv-settings-title">Settings</h2>' +
    '<button type="button" class="jv-settings-panel__close" id="jv-settings-close" aria-label="Close settings">&times;</button>' +
    "</header>" +
    '<div class="jv-settings-panel__body">' +
    '<div class="jv-settings-field">' +
    '<span class="jv-settings-field__label">Email</span>' +
    '<span class="jv-settings-field__value" id="jv-settings-email">—</span>' +
    "</div>" +
    '<div class="jv-settings-field">' +
    '<span class="jv-settings-field__label">Timezone</span>' +
    '<span class="jv-settings-field__value" id="jv-settings-timezone">Not set</span>' +
    "</div>" +
    '<hr class="jv-settings-divider" />' +
    '<div class="jv-settings-section">' +
    '<span class="jv-settings-field__label">Notion Integration</span>' +
    '<p class="jv-settings-section__desc">Re-run the column mapping wizard to add new fields, fix mismatched columns, or connect a different Notion database.</p>' +
    '<a href="/notion-setup.html" class="jv-settings-notion-link">Update Column Mapping →</a>' +
    "</div>" +
    '<button type="button" class="jv-settings-logout" id="jv-settings-logout">Logout</button>' +
    "</div>";

  document.body.appendChild(overlay);
  document.body.appendChild(panel);
}

function populateSettingsFields() {
  const emailEl = document.getElementById("jv-settings-email");
  const tzEl = document.getElementById("jv-settings-timezone");
  const tz = readOnboardingTimezone();
  if (tzEl) tzEl.textContent = tz || "Not set";
  void getAuthEmail().then((email) => {
    if (emailEl) emailEl.textContent = email || "—";
  });
}

let settingsOpen = false;
let escapeBound = false;

function setSettingsOpen(open) {
  const overlay = document.getElementById("jv-settings-overlay");
  const panel = document.getElementById("jv-settings-panel");
  const btn = document.getElementById("jv-settings-btn");
  if (!overlay || !panel) return;

  settingsOpen = open;
  overlay.classList.toggle("jv-settings--open", open);
  panel.classList.toggle("jv-settings--open", open);
  overlay.setAttribute("aria-hidden", open ? "false" : "true");
  panel.setAttribute("aria-hidden", open ? "false" : "true");
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");

  if (open) {
    populateSettingsFields();
    document.body.style.overflow = "hidden";
    const closeBtn = document.getElementById("jv-settings-close");
    if (closeBtn) closeBtn.focus();
  } else {
    document.body.style.overflow = "";
    if (btn) btn.focus();
  }
}

function bindEscape() {
  if (escapeBound) return;
  escapeBound = true;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settingsOpen) setSettingsOpen(false);
  });
}

function wireSettingsUi() {
  const btn = document.getElementById("jv-settings-btn");
  const overlay = document.getElementById("jv-settings-overlay");
  const closeBtn = document.getElementById("jv-settings-close");
  const logoutBtn = document.getElementById("jv-settings-logout");

  if (btn && !btn.dataset.jarvisSettingsBound) {
    btn.dataset.jarvisSettingsBound = "1";
    btn.addEventListener("click", () => setSettingsOpen(!settingsOpen));
  }
  if (overlay && !overlay.dataset.jarvisSettingsBound) {
    overlay.dataset.jarvisSettingsBound = "1";
    overlay.addEventListener("click", () => setSettingsOpen(false));
  }
  if (closeBtn && !closeBtn.dataset.jarvisSettingsBound) {
    closeBtn.dataset.jarvisSettingsBound = "1";
    closeBtn.addEventListener("click", () => setSettingsOpen(false));
  }
  if (logoutBtn && !logoutBtn.dataset.jarvisSettingsBound) {
    logoutBtn.dataset.jarvisSettingsBound = "1";
    logoutBtn.addEventListener("click", () => {
      void signOut();
    });
  }
  const panel = document.getElementById("jv-settings-panel");
  if (panel && !panel.dataset.jarvisSettingsBound) {
    panel.dataset.jarvisSettingsBound = "1";
    panel.addEventListener("click", (e) => e.stopPropagation());
  }
}

/** Mount panel, wire gear + logout. Call after auth on protected pages. */
export async function initJarvisSettings() {
  ensureSettingsDom();
  wireSettingsUi();
  bindEscape();
  populateSettingsFields();
}

/** @deprecated Use initJarvisSettings — kept for jarvis-auth.js re-export. */
export async function initNavAuthUi() {
  await initJarvisSettings();
}
