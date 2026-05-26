/**
 * Settings gear + slide-in panel — profile, appearance, account, connections.
 *
 * Run manually in Supabase SQL editor if display_name is missing:
 *   ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS display_name text;
 *
 * Server route needed for Notion disconnect (add to server.mjs when ready):
 *   DELETE /api/notion/disconnect — delete notion_connections row for user, return { success: true }
 *
 * Also add display_name to ALLOWED_FIELDS in handleUserProfile (POST /api/user/profile).
 */
import { apiFetch, getAuthEmail, getAuthUserId, signOut } from "./jarvis-auth.js";

const ONBOARDING_LS_KEY = "jarvis_onboarding";
const THEME_LS_KEY = "jarvis_theme";
const DISPLAY_NAME_LS_PREFIX = "jarvis_display_name_";

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

function initialsFromDisplayName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return parts[0]?.[0]?.toUpperCase() || "";
}

function initialsFromEmail(email) {
  const local = String(email || "").split("@")[0] || "";
  const chunks = local.replace(/[0-9]+/g, " ").split(/[._-]+/).filter(Boolean);
  if (chunks.length >= 2) {
    return (chunks[0][0] + chunks[1][0]).toUpperCase();
  }
  if (local.length >= 2) return local.slice(0, 2).toUpperCase();
  return local[0]?.toUpperCase() || "?";
}

function displayNameStorageKey(userId) {
  const uid = String(userId || "").trim();
  return uid ? DISPLAY_NAME_LS_PREFIX + uid : null;
}

function readCachedDisplayName(userId) {
  const key = displayNameStorageKey(userId);
  if (!key) return "";
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeCachedDisplayName(userId, name) {
  const key = displayNameStorageKey(userId);
  if (!key) return;
  try {
    if (name) localStorage.setItem(key, name);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** @param {"dark"|"light"} theme */
export function applyJarvisTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(t === "light" ? "theme-light" : "theme-dark");
  try {
    localStorage.setItem(THEME_LS_KEY, t);
  } catch {
    /* ignore */
  }
  syncThemeToggleUi(t);
}

function readStoredTheme() {
  try {
    const raw = localStorage.getItem(THEME_LS_KEY);
    return raw === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function initJarvisTheme() {
  applyJarvisTheme(readStoredTheme());
}

function syncThemeToggleUi(theme) {
  const darkBtn = document.getElementById("jv-theme-dark");
  const lightBtn = document.getElementById("jv-theme-light");
  if (!darkBtn || !lightBtn) return;
  const isDark = theme !== "light";
  darkBtn.classList.toggle("jv-settings-theme-btn--active", isDark);
  lightBtn.classList.toggle("jv-settings-theme-btn--active", !isDark);
  darkBtn.setAttribute("aria-pressed", isDark ? "true" : "false");
  lightBtn.setAttribute("aria-pressed", isDark ? "false" : "true");
}

function buildSettingsPanelHtml() {
  return (
    '<header class="jv-settings-panel__head">' +
    '<h2 class="jv-settings-panel__title" id="jv-settings-title">Settings</h2>' +
    '<button type="button" class="jv-settings-panel__close" id="jv-settings-close" aria-label="Close settings">&times;</button>' +
    "</header>" +
    '<div class="jv-settings-panel__body">' +
    '<section class="jv-settings-profile" aria-label="Profile">' +
    '<div class="jv-settings-avatar" id="jv-settings-avatar" aria-hidden="true">—</div>' +
    '<p class="jv-settings-profile__email" id="jv-settings-profile-email">—</p>' +
    '<div class="jv-settings-name-wrap" id="jv-settings-name-wrap">' +
    '<button type="button" class="jv-settings-name-display" id="jv-settings-display-name">Add your name</button>' +
    '<input type="text" class="jv-settings-name-input" id="jv-settings-name-input" maxlength="80" placeholder="Add your name" aria-label="Display name" hidden />' +
    "</div>" +
    "</section>" +
    '<div class="jv-settings-section-divider"><span class="jv-settings-section-label">Appearance</span></div>' +
    '<section class="jv-settings-block" aria-label="Appearance">' +
    '<div class="jv-settings-theme-toggle" role="group" aria-label="Theme">' +
    '<button type="button" class="jv-settings-theme-btn jv-settings-theme-btn--active" id="jv-theme-dark" aria-pressed="true">Dark</button>' +
    '<button type="button" class="jv-settings-theme-btn" id="jv-theme-light" aria-pressed="false">Light</button>' +
    "</div>" +
    "</section>" +
    '<div class="jv-settings-section-divider"><span class="jv-settings-section-label">Account</span></div>' +
    '<section class="jv-settings-block" aria-label="Account">' +
    '<div class="jv-settings-field">' +
    '<span class="jv-settings-field__label">Email</span>' +
    '<span class="jv-settings-field__value" id="jv-settings-email">—</span>' +
    "</div>" +
    '<div class="jv-settings-field">' +
    '<span class="jv-settings-field__label">Timezone</span>' +
    '<span class="jv-settings-field__value" id="jv-settings-timezone">Not set</span>' +
    "</div>" +
    "</section>" +
    '<div class="jv-settings-section-divider"><span class="jv-settings-section-label">Connections</span></div>' +
    '<section class="jv-settings-block jv-settings-notion" aria-label="Connections">' +
    '<div class="jv-settings-notion-head">' +
    '<div class="jv-settings-notion-brand">' +
    '<span class="jv-settings-notion-icon" aria-hidden="true">N</span>' +
    '<span class="jv-settings-notion-label">Notion</span>' +
    "</div>" +
    '<span class="jv-settings-notion-badge jv-settings-notion-badge--off" id="jv-notion-badge">Not connected</span>' +
    "</div>" +
    '<div class="jv-settings-notion-actions">' +
    '<a href="/notion-setup.html" class="jv-settings-link-btn">Update Mapping</a>' +
    '<button type="button" class="jv-settings-sync-btn" id="jv-notion-sync-btn" hidden>Sync</button>' +
    '<button type="button" class="jv-settings-disconnect-btn" id="jv-notion-disconnect-btn" hidden>Disconnect</button>' +
    "</div>" +
    "</section>" +
    '<div class="jv-settings-section-divider jv-settings-section-divider--subtle"></div>' +
    '<section class="jv-settings-block jv-settings-danger" aria-label="Sign out">' +
    '<button type="button" class="jv-settings-logout" id="jv-settings-logout">Logout</button>' +
    "</section>" +
    "</div>"
  );
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
  panel.innerHTML = buildSettingsPanelHtml();

  document.body.appendChild(overlay);
  document.body.appendChild(panel);
}

function updateAvatarInitials(displayName, email) {
  const avatar = document.getElementById("jv-settings-avatar");
  if (!avatar) return;
  const fromName = initialsFromDisplayName(displayName);
  avatar.textContent = fromName || initialsFromEmail(email);
}

function setNotionConnectionUi(connected) {
  const badge = document.getElementById("jv-notion-badge");
  const syncBtn = document.getElementById("jv-notion-sync-btn");
  const disconnectBtn = document.getElementById("jv-notion-disconnect-btn");
  if (badge) {
    badge.textContent = connected ? "Connected ✓" : "Not connected";
    badge.classList.toggle("jv-settings-notion-badge--on", connected);
    badge.classList.toggle("jv-settings-notion-badge--off", !connected);
  }
  if (syncBtn) syncBtn.hidden = !connected;
  if (disconnectBtn) disconnectBtn.hidden = !connected;
}

async function loadProfileSection() {
  const emailEl = document.getElementById("jv-settings-email");
  const profileEmailEl = document.getElementById("jv-settings-profile-email");
  const displayBtn = document.getElementById("jv-settings-display-name");
  const tzEl = document.getElementById("jv-settings-timezone");

  const tz = readOnboardingTimezone();
  if (tzEl) tzEl.textContent = tz || "Not set";

  const [email, userId] = await Promise.all([getAuthEmail(), getAuthUserId()]);
  const emailStr = email || "—";
  if (emailEl) emailEl.textContent = emailStr;
  if (profileEmailEl) profileEmailEl.textContent = emailStr;

  const cachedName = userId ? readCachedDisplayName(userId) : "";
  if (displayBtn) {
    displayBtn.textContent = cachedName || "Add your name";
    displayBtn.classList.toggle("jv-settings-name-display--empty", !cachedName);
  }
  updateAvatarInitials(cachedName, email);

  void apiFetch("/api/notion/connection-status", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { connected: false }))
    .then(({ connected }) => setNotionConnectionUi(!!connected))
    .catch(() => setNotionConnectionUi(false));
}

function populateSettingsFields() {
  loadProfileSection();
  syncThemeToggleUi(readStoredTheme());
}

let settingsOpen = false;
let escapeBound = false;
let nameEditBound = false;

function startNameEdit() {
  const displayBtn = document.getElementById("jv-settings-display-name");
  const input = document.getElementById("jv-settings-name-input");
  if (!displayBtn || !input) return;
  const current =
    displayBtn.classList.contains("jv-settings-name-display--empty")
      ? ""
      : displayBtn.textContent.trim();
  input.value = current;
  displayBtn.hidden = true;
  input.hidden = false;
  input.focus();
  input.select();
}

function cancelNameEdit() {
  const displayBtn = document.getElementById("jv-settings-display-name");
  const input = document.getElementById("jv-settings-name-input");
  if (!displayBtn || !input) return;
  input.hidden = true;
  displayBtn.hidden = false;
}

async function saveDisplayName(raw) {
  const name = String(raw || "").trim();
  const userId = await getAuthUserId();
  const email = await getAuthEmail();
  const displayBtn = document.getElementById("jv-settings-display-name");
  const input = document.getElementById("jv-settings-name-input");

  if (userId) writeCachedDisplayName(userId, name);

  if (displayBtn) {
    displayBtn.textContent = name || "Add your name";
    displayBtn.classList.toggle("jv-settings-name-display--empty", !name);
  }
  updateAvatarInitials(name, email);
  cancelNameEdit();

  if (!name) return;

  try {
    await apiFetch("/api/user/profile", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: name }),
    });
  } catch {
    /* cached locally; server may need display_name in ALLOWED_FIELDS */
  }
}

function wireNameEdit() {
  if (nameEditBound) return;
  nameEditBound = true;

  const displayBtn = document.getElementById("jv-settings-display-name");
  const input = document.getElementById("jv-settings-name-input");

  displayBtn?.addEventListener("click", () => startNameEdit());

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveDisplayName(input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelNameEdit();
    }
  });

  input?.addEventListener("blur", () => {
    if (!input.hidden) void saveDisplayName(input.value);
  });
}

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
    document.getElementById("jv-settings-close")?.focus();
  } else {
    document.body.style.overflow = "";
    btn?.focus();
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
  const panel = document.getElementById("jv-settings-panel");

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
  if (panel && !panel.dataset.jarvisSettingsBound) {
    panel.dataset.jarvisSettingsBound = "1";
    panel.addEventListener("click", (e) => e.stopPropagation());
  }

  wireNameEdit();

  const darkBtn = document.getElementById("jv-theme-dark");
  const lightBtn = document.getElementById("jv-theme-light");
  if (darkBtn && !darkBtn.dataset.jarvisSettingsBound) {
    darkBtn.dataset.jarvisSettingsBound = "1";
    darkBtn.addEventListener("click", () => applyJarvisTheme("dark"));
  }
  if (lightBtn && !lightBtn.dataset.jarvisSettingsBound) {
    lightBtn.dataset.jarvisSettingsBound = "1";
    lightBtn.addEventListener("click", () => applyJarvisTheme("light"));
  }

  const syncBtn = document.getElementById("jv-notion-sync-btn");
  if (syncBtn && !syncBtn.dataset.jarvisSettingsBound) {
    syncBtn.dataset.jarvisSettingsBound = "1";
    syncBtn.addEventListener("click", () => {
      syncBtn.disabled = true;
      syncBtn.textContent = "Syncing…";
      syncBtn.classList.remove("jv-settings-sync-btn--error");
      apiFetch("/api/notion/sync-user", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
        .then((r) => (r.ok ? r.json().then(() => true) : Promise.reject()))
        .then(() => {
          syncBtn.textContent = "✓ Synced";
          setTimeout(() => {
            syncBtn.textContent = "Sync";
            syncBtn.disabled = false;
          }, 2000);
        })
        .catch(() => {
          syncBtn.textContent = "Sync failed";
          syncBtn.classList.add("jv-settings-sync-btn--error");
          syncBtn.disabled = false;
        });
    });
  }

  const disconnectBtn = document.getElementById("jv-notion-disconnect-btn");
  if (disconnectBtn && !disconnectBtn.dataset.jarvisSettingsBound) {
    disconnectBtn.dataset.jarvisSettingsBound = "1";
    disconnectBtn.addEventListener("click", () => {
      if (!confirm("Disconnect Notion? You will need to reconnect to sync trades again.")) return;
      disconnectBtn.disabled = true;
      disconnectBtn.textContent = "Disconnecting…";
      apiFetch("/api/notion/disconnect", { method: "DELETE", cache: "no-store" })
        .then((r) => (r.ok ? r.json().catch(() => ({})) : Promise.reject()))
        .then(() => {
          setNotionConnectionUi(false);
          disconnectBtn.textContent = "Disconnect";
        })
        .catch(() => {
          disconnectBtn.textContent = "Failed";
          setTimeout(() => {
            disconnectBtn.textContent = "Disconnect";
          }, 2000);
        })
        .finally(() => {
          disconnectBtn.disabled = false;
        });
    });
  }
}

/** Mount panel, wire gear + logout. Call after auth on protected pages. */
export async function initJarvisSettings() {
  initJarvisTheme();
  ensureSettingsDom();
  wireSettingsUi();
  bindEscape();
  populateSettingsFields();
}

/** @deprecated Use initJarvisSettings — kept for jarvis-auth.js re-export. */
export async function initNavAuthUi() {
  await initJarvisSettings();
}
