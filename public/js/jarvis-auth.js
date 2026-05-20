/**
 * Supabase Auth for Jarvis static pages — session gate + authenticated API fetch.
 */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.44.4/+esm";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  LOGIN_PATH,
  APP_HOME_PATH,
} from "./jarvis-config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

let cachedSession = null;
let sessionReady = null;

function isLoginPage() {
  const p = window.location.pathname.replace(/\/$/, "") || "/";
  return p === "/login.html" || p.endsWith("/login.html");
}

async function loadSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  cachedSession = data?.session ?? null;
  return cachedSession;
}

export function getSupabaseClient() {
  return sb;
}

export async function getAccessToken() {
  if (!sessionReady) sessionReady = loadSession();
  await sessionReady;
  return cachedSession?.access_token ?? null;
}

export async function getAuthUserId() {
  if (!sessionReady) sessionReady = loadSession();
  await sessionReady;
  return cachedSession?.user?.id ?? null;
}

export async function getAuthEmail() {
  if (!sessionReady) sessionReady = loadSession();
  await sessionReady;
  return cachedSession?.user?.email ?? null;
}

/**
 * Redirect to login if no session. Call at top of protected pages.
 */
export async function requireAuthPage() {
  if (isLoginPage()) return null;
  const session = await loadSession();
  if (!session) {
    const next = encodeURIComponent(
      window.location.pathname + window.location.search + window.location.hash
    );
    window.location.replace(`${LOGIN_PATH}?next=${next}`);
    return null;
  }
  return session;
}

/**
 * Authenticated fetch — attaches Bearer token; always no-store.
 * @param {string} url
 * @param {RequestInit} [options]
 */
export async function apiFetch(url, options = {}) {
  const token = await getAccessToken();
  if (!token) {
    window.location.replace(LOGIN_PATH);
    throw new Error("Not signed in");
  }
  const headers = new Headers(options.headers || {});
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, {
    ...options,
    headers,
    cache: "no-store",
  });
}

export async function signOut() {
  try {
    await sb.auth.signOut();
  } catch {
    /* ignore */
  }
  cachedSession = null;
  sessionReady = null;
  window.location.replace(LOGIN_PATH);
}

/** @deprecated Settings panel — use initJarvisSettings from jarvis-settings.js */
export async function initNavAuthUi() {
  const { initJarvisSettings } = await import("./jarvis-settings.js");
  await initJarvisSettings();
}

sb.auth.onAuthStateChange((_event, session) => {
  cachedSession = session;
});

export { APP_HOME_PATH, LOGIN_PATH };
